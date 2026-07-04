// Knuth-Plass line breaking with Liang hyphenation
// References: break.lua (SILE), tex.web (TeX), linebreak.c (LuaTeX), pTeX, xeCJK

import { perfLogger } from '../../utils/PerformanceLogger';
import { logger } from '../../utils/Logger';
import {
  DEFAULT_TOLERANCE,
  DEFAULT_PRETOLERANCE,
  DEFAULT_EMERGENCY_STRETCH,
  SPACE_STRETCH_RATIO,
  SPACE_SHRINK_RATIO
} from './constants';
import type {
  TextAlign,
  TextDirection,
  LineInfo,
  HyphenationPatternsMap,
  HyphenationTrieNode
} from '../types';

export enum ItemType {
  BOX, // character or word with fixed width
  GLUE, // stretchable/shrinkable space
  PENALTY, // potential breakpoint with penalty cost
  DISCRETIONARY // hyphenation point with pre/post/no-break forms
}

// TeX fitness classes (tex.web lines 16099-16105)
export enum FitnessClass {
  VERY_LOOSE = 0, // lines stretching more than their stretchability
  LOOSE = 1, // lines stretching 0.5 to 1.0 of their stretchability
  DECENT = 2, // all other lines
  TIGHT = 3 // lines shrinking 0.5 to 1.0 of their shrinkability
}

interface Item {
  type: ItemType;
  width: number;
  text?: string;
  originIndex?: number;
}

export interface Box extends Item {
  type: ItemType.BOX;
}

export interface Glue extends Item {
  type: ItemType.GLUE;
  stretch: number; // amount the space can grow
  shrink: number; // amount the space can compress
}

export interface Penalty extends Item {
  type: ItemType.PENALTY;
  penalty: number; // cost of breaking here (10000 = infinity)
  flagged?: boolean; // marks consecutive hyphenated lines
}

export interface Discretionary extends Item {
  type: ItemType.DISCRETIONARY;
  preBreak: string; // text before break (e.g., hyphen)
  postBreak: string; // text after break (usually empty)
  noBreak: string; // text if no break (usually empty)
  preBreakWidth: number; // width of preBreak text
  penalty: number; // cost of breaking here
  flagged?: boolean; // marks consecutive hyphenated lines
}

interface BreakNode {
  position: number; // position in item list
  line: number; // line number
  fitness: FitnessClass; // fitness class of this line
  totalDemerits: number; // accumulated demerits from start
  previous: BreakNode | null; // previous break in solution
  hyphenated: boolean; // whether this line ends with hyphen
  active: boolean; // whether node is still viable
  activeIndex: number; // index in activeList for O(1) removal
  // Cumulative width/stretch/shrink up to this node's position
  cumWidth: number;
  cumStretch: number;
  cumShrink: number;
}

// Active node management with Map for lookup by (position, fitness)
class ActiveNodeList {
  private nodesByKey: Map<number, BreakNode> = new Map();
  private activeList: BreakNode[] = [];

  private getKey(position: number, fitness: FitnessClass): number {
    return (position << 2) | fitness;
  }

  // Insert or update node - returns true if node was added/updated
  insert(node: BreakNode): boolean {
    const key = this.getKey(node.position, node.fitness);
    const existing = this.nodesByKey.get(key);

    if (existing) {
      // Update existing if new one is better
      if (node.totalDemerits < existing.totalDemerits) {
        existing.totalDemerits = node.totalDemerits;
        existing.previous = node.previous;
        existing.hyphenated = node.hyphenated;
        existing.line = node.line;
        existing.cumWidth = node.cumWidth;
        existing.cumStretch = node.cumStretch;
        existing.cumShrink = node.cumShrink;
        return true;
      }
      return false;
    }

    // Add new node
    node.active = true;
    node.activeIndex = this.activeList.length;
    this.activeList.push(node);
    this.nodesByKey.set(key, node);
    return true;
  }

  deactivate(node: BreakNode): void {
    if (!node.active) return;
    node.active = false;

    const idx = node.activeIndex;
    const lastIdx = this.activeList.length - 1;

    if (idx !== lastIdx) {
      const lastNode = this.activeList[lastIdx];
      this.activeList[idx] = lastNode;
      lastNode.activeIndex = idx;
    }

    this.activeList.pop();
  }

  getActive(): BreakNode[] {
    return this.activeList;
  }

  size(): number {
    return this.activeList.length;
  }
}

export interface LineBreakOptions {
  text: string;
  width?: number;
  align?: TextAlign;
  direction?: TextDirection;
  hyphenate?: boolean;
  language?: string;
  measureText: (text: string) => number;
  measureTextWidths?: (text: string) => number[];
  respectExistingBreaks?: boolean;
  hyphenationPatterns?: HyphenationPatternsMap;
  unitsPerEm?: number;
  letterSpacing?: number;
  tolerance?: number;
  pretolerance?: number;
  emergencyStretch?: number;
  autoEmergencyStretch?: number;
  lefthyphenmin?: number;
  righthyphenmin?: number;
  linepenalty?: number;
  adjdemerits?: number;
  hyphenpenalty?: number;
  exhyphenpenalty?: number;
  doublehyphendemerits?: number;
  finalhyphendemerits?: number;
}

interface LineBreakContext {
  linePenalty: number;
  adjDemerits: number;
  doubleHyphenDemerits: number;
  finalHyphenDemerits: number;
  hyphenPenalty: number;
  exHyphenPenalty: number;
  currentAlign: TextAlign;
  unitsPerEm?: number;
  letterSpacingFU?: number;
}

// TeX parameters (tex.web lines 4934-4936, 4997-4999)
const DEFAULT_HYPHEN_PENALTY = 50; // \hyphenpenalty
const DEFAULT_EX_HYPHEN_PENALTY = 50; // \exhyphenpenalty
const DEFAULT_DOUBLE_HYPHEN_DEMERITS = 10000; // \doublehyphendemerits
const DEFAULT_FINAL_HYPHEN_DEMERITS = 5000; // \finalhyphendemerits
const DEFAULT_LINE_PENALTY = 10; // \linepenalty
const DEFAULT_FITNESS_DIFF_DEMERITS = 10000; // \adjdemerits
const DEFAULT_LEFT_HYPHEN_MIN = 2; // \lefthyphenmin
const DEFAULT_RIGHT_HYPHEN_MIN = 3; // \righthyphenmin

// TeX special values (tex.web lines 2335, 3258, 3259)
const INF_BAD = 10000; // inf_bad - infinitely bad badness
const INFINITY_PENALTY = 10000; // inf_penalty - never break here
const EJECT_PENALTY = -10000; // eject_penalty - force break here

// Retry increment when no breakpoints found
const EMERGENCY_STRETCH_INCREMENT = 0.1;

export class LineBreak {
  // TeX: badness function (tex.web lines 2337-2348)
  // Computes badness = 100 * (t/s)³ where t=adjustment, s=stretchability
  // Simplified from TeX's fixed-point integer arithmetic to floating-point
  //
  // Returns INF_BAD+1 for overfull boxes so they're rejected even when
  // threshold=INF_BAD in emergency pass
  private static badness(t: number, s: number): number {
    if (t === 0) return 0;
    if (s <= 0) return INF_BAD + 1;
    const r = Math.abs(t / s);
    if (r > 10) return INF_BAD + 1;
    return Math.min(Math.round(100 * r ** 3), INF_BAD);
  }

  // TeX fitness classification (tex.web lines 16099-16105, 16799-16812)
  // TeX uses badness thresholds 12 and 99, which correspond to ratios ~0.5 and ~1.0
  // We use ratio directly since we compute it anyway. Well, and because SILE does
  // it this way. Thanks Simon :)
  private static fitnessClass(ratio: number): FitnessClass {
    if (ratio < -0.5) return FitnessClass.TIGHT; // shrinking significantly
    if (ratio < 0.5) return FitnessClass.DECENT; // normal
    if (ratio < 1) return FitnessClass.LOOSE; // stretching 0.5-1.0
    return FitnessClass.VERY_LOOSE; // stretching > 1.0
  }

  public static findHyphenationPoints(
    word: string,
    language: string = 'en-us',
    availablePatterns?: HyphenationPatternsMap,
    lefthyphenmin: number = DEFAULT_LEFT_HYPHEN_MIN,
    righthyphenmin: number = DEFAULT_RIGHT_HYPHEN_MIN
  ): number[] {
    let patternTrie: HyphenationTrieNode | undefined;

    if (availablePatterns && availablePatterns[language]) {
      patternTrie = availablePatterns[language];
    } else {
      return [];
    }

    if (!patternTrie) return [];

    const lowerWord = word.toLowerCase();
    const paddedWord = `.${lowerWord}.`;
    const points = new Array(paddedWord.length).fill(0);

    for (let i = 0; i < paddedWord.length; i++) {
      let node = patternTrie;
      for (let j = i; j < paddedWord.length; j++) {
        const char = paddedWord[j];
        if (!node.children || !node.children[char]) break;
        node = node.children[char];
        if (node.patterns) {
          for (let k = 0; k < node.patterns.length; k++) {
            const pos = i + k;
            if (pos < points.length) {
              points[pos] = Math.max(points[pos], node.patterns[k]);
            }
          }
        }
      }
    }

    const hyphenPoints: number[] = [];
    for (let i = 2; i < paddedWord.length - 2; i++) {
      if (points[i] % 2 === 1) {
        hyphenPoints.push(i - 1);
      }
    }

    return hyphenPoints.filter(
      (pos) => pos >= lefthyphenmin && word.length - pos >= righthyphenmin
    );
  }

  public static itemizeText(
    text: string,
    measureText: (text: string) => number,
    measureTextWidths: ((text: string) => number[]) | undefined,
    hyphenate: boolean = false,
    language: string = 'en-us',
    availablePatterns?: HyphenationPatternsMap,
    lefthyphenmin: number = DEFAULT_LEFT_HYPHEN_MIN,
    righthyphenmin: number = DEFAULT_RIGHT_HYPHEN_MIN,
    context?: LineBreakContext,
    lineWidth?: number
  ): Item[] {
    const items: Item[] = [];

    items.push(
      ...this.itemizeParagraph(
        text,
        measureText,
        measureTextWidths,
        hyphenate,
        language,
        availablePatterns,
        lefthyphenmin,
        righthyphenmin,
        context,
        lineWidth
      )
    );

    // Final glue and penalty
    items.push({
      type: ItemType.GLUE,
      width: 0,
      stretch: 10000000,
      shrink: 0,
      text: '',
      originIndex: text.length
    } as Glue);
    items.push({
      type: ItemType.PENALTY,
      width: 0,
      penalty: EJECT_PENALTY,
      text: '',
      originIndex: text.length
    } as Penalty);

    return items;
  }

  public static isCJK(char: string): boolean {
    const code = char.codePointAt(0);
    if (code === undefined) return false;

    return (
      (code >= 0x4e00 && code <= 0x9fff) || // CJK Unified Ideographs
      (code >= 0x3400 && code <= 0x4dbf) || // CJK Extension A
      (code >= 0x20000 && code <= 0x2a6df) || // CJK Extension B
      (code >= 0x2a700 && code <= 0x2b73f) || // CJK Extension C
      (code >= 0x2b740 && code <= 0x2b81f) || // CJK Extension D
      (code >= 0x2b820 && code <= 0x2ceaf) || // CJK Extension E
      (code >= 0xf900 && code <= 0xfaff) || // CJK Compatibility Ideographs
      (code >= 0x3040 && code <= 0x309f) || // Hiragana
      (code >= 0x30a0 && code <= 0x30ff) || // Katakana
      (code >= 0xac00 && code <= 0xd7af) || // Hangul Syllables
      (code >= 0x1100 && code <= 0x11ff) || // Hangul Jamo
      (code >= 0x3130 && code <= 0x318f) || // Hangul Compatibility Jamo
      (code >= 0xa960 && code <= 0xa97f) || // Hangul Jamo Extended-A
      (code >= 0xd7b0 && code <= 0xd7ff) || // Hangul Jamo Extended-B
      (code >= 0xffa0 && code <= 0xffdc) // Halfwidth Hangul
    );
  }

  // Closing punctuation - no line break before (UAX #14 CL, JIS X 4051)
  public static isCJClosingPunctuation(char: string): boolean {
    const code = char.charCodeAt(0);
    return (
      code === 0x3001 || // 、
      code === 0x3002 || // 。
      code === 0xff0c || // ，
      code === 0xff0e || // ．
      code === 0xff1a || // ：
      code === 0xff1b || // ；
      code === 0xff01 || // ！
      code === 0xff1f || // ？
      code === 0xff09 || // ）
      code === 0x3011 || // 】
      code === 0xff5d || // ｝
      code === 0x300d || // 」
      code === 0x300f || // 』
      code === 0x3009 || // 〉
      code === 0x300b || // 》
      code === 0x3015 || // 〕
      code === 0x3017 || // 〗
      code === 0x3019 || // 〙
      code === 0x301b || // 〛
      code === 0x30fc || // ー
      code === 0x2014 || // —
      code === 0x2026 || // …
      code === 0x2025 // ‥
    );
  }

  // Opening punctuation - no line break after (UAX #14 OP, JIS X 4051)
  public static isCJOpeningPunctuation(char: string): boolean {
    const code = char.charCodeAt(0);
    return (
      code === 0xff08 || // （
      code === 0x3010 || // 【
      code === 0xff5b || // ｛
      code === 0x300c || // 「
      code === 0x300e || // 『
      code === 0x3008 || // 〈
      code === 0x300a || // 《
      code === 0x3014 || // 〔
      code === 0x3016 || // 〖
      code === 0x3018 || // 〘
      code === 0x301a // 〚
    );
  }

  public static isCJPunctuation(char: string): boolean {
    return (
      this.isCJClosingPunctuation(char) || this.isCJOpeningPunctuation(char)
    );
  }

  private static itemizeCJKText(
    text: string,
    measureText: (text: string) => number,
    measureTextWidths: ((text: string) => number[]) | undefined,
    context: LineBreakContext | undefined,
    startOffset: number = 0,
    glueParams?: { width: number; stretch: number; shrink: number }
  ): Item[] {
    const items: Item[] = [];
    const chars = Array.from(text);
    const widths = measureTextWidths ? measureTextWidths(text) : null;
    let textPosition = startOffset;

    let glueWidth: number, glueStretch: number, glueShrink: number;

    if (glueParams) {
      glueWidth = glueParams.width;
      glueStretch = glueParams.stretch;
      glueShrink = glueParams.shrink;
    } else {
      const baseCharWidth = measureText('字');
      glueWidth = 0;
      glueStretch = baseCharWidth * 0.04;
      glueShrink = baseCharWidth * 0.04;
    }

    for (let i = 0; i < chars.length; i++) {
      const char = chars[i];
      const nextChar = i < chars.length - 1 ? chars[i + 1] : null;

      if (/\s/.test(char)) {
        const width = widths
          ? (widths[i] ?? measureText(char))
          : measureText(char);
        items.push({
          type: ItemType.GLUE,
          width,
          stretch: width * SPACE_STRETCH_RATIO,
          shrink: width * SPACE_SHRINK_RATIO,
          text: char,
          originIndex: textPosition
        } as Glue);
        textPosition += char.length;
        continue;
      }

      items.push({
        type: ItemType.BOX,
        width: widths ? (widths[i] ?? measureText(char)) : measureText(char),
        text: char,
        originIndex: textPosition
      } as Box);

      textPosition += char.length;

      if (nextChar && !/\s/.test(nextChar)) {
        let canBreak = true;
        if (this.isCJClosingPunctuation(nextChar)) canBreak = false;
        if (this.isCJOpeningPunctuation(char)) canBreak = false;
        const isPunctPair =
          this.isCJPunctuation(char) && this.isCJPunctuation(nextChar);

        if (canBreak && !isPunctPair) {
          items.push({
            type: ItemType.GLUE,
            width: glueWidth,
            stretch: glueStretch,
            shrink: glueShrink,
            text: '',
            originIndex: textPosition
          } as Glue);
        }
      }
    }

    return items;
  }

  private static itemizeParagraph(
    text: string,
    measureText: (text: string) => number,
    measureTextWidths: ((text: string) => number[]) | undefined,
    hyphenate: boolean,
    language: string,
    availablePatterns: HyphenationPatternsMap | undefined,
    lefthyphenmin: number,
    righthyphenmin: number,
    context: LineBreakContext | undefined,
    lineWidth?: number
  ): Item[] {
    const items: Item[] = [];
    const chars = Array.from(text);

    // Inter-character glue for CJK justification
    // Matches pTeX's default \kanjiskip behavior
    let cjkGlueParams:
      | { width: number; stretch: number; shrink: number }
      | undefined;
    const getCjkGlueParams = () => {
      if (!cjkGlueParams) {
        const baseCharWidth = measureText('字');
        cjkGlueParams = {
          width: 0,
          stretch: baseCharWidth * 0.04,
          shrink: baseCharWidth * 0.04
        };
      }
      return cjkGlueParams;
    };

    let buffer = '';
    let bufferStart = 0;
    let bufferScript: 'cjk' | 'word' | null = null;
    let textPosition = 0;

    const flushBuffer = () => {
      if (buffer.length === 0) return;

      if (bufferScript === 'cjk') {
        items.push(
          ...this.itemizeCJKText(
            buffer,
            measureText,
            measureTextWidths,
            context,
            bufferStart,
            getCjkGlueParams()
          )
        );
      } else {
        items.push(
          ...this.itemizeWordBased(
            buffer,
            bufferStart,
            measureText,
            hyphenate,
            language,
            availablePatterns,
            lefthyphenmin,
            righthyphenmin,
            context,
            lineWidth
          )
        );
      }

      buffer = '';
      bufferScript = null;
    };

    for (let i = 0; i < chars.length; i++) {
      const char = chars[i];
      const isCJKChar = this.isCJK(char);
      const currentScript = isCJKChar ? 'cjk' : 'word';

      if (bufferScript !== null && bufferScript !== currentScript) {
        flushBuffer();
        bufferStart = textPosition;
      }

      if (bufferScript === null) {
        bufferScript = currentScript;
        bufferStart = textPosition;
      }

      buffer += char;
      textPosition += char.length;
    }

    flushBuffer();
    return items;
  }

  private static itemizeWordBased(
    text: string,
    startOffset: number,
    measureText: (text: string) => number,
    hyphenate: boolean,
    language: string,
    availablePatterns: HyphenationPatternsMap | undefined,
    lefthyphenmin: number,
    righthyphenmin: number,
    context: LineBreakContext | undefined,
    lineWidth?: number
  ): Item[] {
    const items: Item[] = [];
    const tokens = text.match(/\S+|\s+/g) || [];
    let currentIndex = 0;

    for (const token of tokens) {
      const tokenStartIndex = startOffset + currentIndex;

      if (/\s+/.test(token)) {
        const width = measureText(token);
        items.push({
          type: ItemType.GLUE,
          width,
          stretch: width * SPACE_STRETCH_RATIO,
          shrink: width * SPACE_SHRINK_RATIO,
          text: token,
          originIndex: tokenStartIndex
        } as Glue);
        currentIndex += token.length;
      } else {
        if (lineWidth && token.includes('-') && !token.includes('\u00AD')) {
          const tokenWidth = measureText(token);
          if (tokenWidth > lineWidth) {
            // Break long hyphenated tokens into characters (break-all behavior)
            const chars = Array.from(token);
            for (let i = 0; i < chars.length; i++) {
              items.push({
                type: ItemType.BOX,
                width: measureText(chars[i]),
                text: chars[i],
                originIndex: tokenStartIndex + i
              } as Box);

              if (i < chars.length - 1) {
                items.push({
                  type: ItemType.PENALTY,
                  width: 0,
                  penalty: 5000,
                  originIndex: tokenStartIndex + i + 1
                } as Penalty);
              }
            }
            currentIndex += token.length;
            continue;
          }
        }

        const segments = token.split(/(-)/);
        let segmentIndex = tokenStartIndex;

        for (const segment of segments) {
          if (!segment) continue;

          if (segment === '-') {
            items.push({
              type: ItemType.DISCRETIONARY,
              width: measureText('-'),
              preBreak: '-',
              postBreak: '',
              noBreak: '-',
              preBreakWidth: measureText('-'),
              penalty: context?.exHyphenPenalty ?? DEFAULT_EX_HYPHEN_PENALTY,
              flagged: true,
              text: '-',
              originIndex: segmentIndex
            } as Discretionary);
            segmentIndex += 1;
          } else if (segment.includes('\u00AD')) {
            const parts = segment.split('\u00AD');
            let runningIndex = 0;
            for (let k = 0; k < parts.length; k++) {
              const partText = parts[k];
              if (partText.length > 0) {
                items.push({
                  type: ItemType.BOX,
                  width: measureText(partText),
                  text: partText,
                  originIndex: segmentIndex + runningIndex
                } as Box);
                runningIndex += partText.length;
              }
              if (k < parts.length - 1) {
                items.push({
                  type: ItemType.DISCRETIONARY,
                  width: 0,
                  preBreak: '-',
                  postBreak: '',
                  noBreak: '',
                  preBreakWidth: measureText('-'),
                  penalty: context?.hyphenPenalty ?? DEFAULT_HYPHEN_PENALTY,
                  flagged: true,
                  text: '',
                  originIndex: segmentIndex + runningIndex
                } as Discretionary);
                runningIndex += 1;
              }
            }
          } else if (
            hyphenate &&
            segment.length >= lefthyphenmin + righthyphenmin &&
            /^\p{L}+$/u.test(segment)
          ) {
            const hyphenPoints = this.findHyphenationPoints(
              segment,
              language,
              availablePatterns,
              lefthyphenmin,
              righthyphenmin
            );

            if (hyphenPoints.length > 0) {
              let lastPoint = 0;
              for (const point of hyphenPoints) {
                const part = segment.substring(lastPoint, point);
                items.push({
                  type: ItemType.BOX,
                  width: measureText(part),
                  text: part,
                  originIndex: segmentIndex + lastPoint
                } as Box);
                items.push({
                  type: ItemType.DISCRETIONARY,
                  width: 0,
                  preBreak: '-',
                  postBreak: '',
                  noBreak: '',
                  preBreakWidth: measureText('-'),
                  penalty: context?.hyphenPenalty ?? DEFAULT_HYPHEN_PENALTY,
                  flagged: true,
                  text: '',
                  originIndex: segmentIndex + point
                } as Discretionary);
                lastPoint = point;
              }
              items.push({
                type: ItemType.BOX,
                width: measureText(segment.substring(lastPoint)),
                text: segment.substring(lastPoint),
                originIndex: segmentIndex + lastPoint
              } as Box);
            } else {
              const wordWidth = measureText(segment);
              if (lineWidth && wordWidth > lineWidth) {
                // Word longer than line width - break into characters
                const chars = Array.from(segment);
                for (let i = 0; i < chars.length; i++) {
                  items.push({
                    type: ItemType.BOX,
                    width: measureText(chars[i]),
                    text: chars[i],
                    originIndex: segmentIndex + i
                  } as Box);

                  if (i < chars.length - 1) {
                    items.push({
                      type: ItemType.PENALTY,
                      width: 0,
                      penalty: 5000,
                      originIndex: segmentIndex + i + 1
                    } as Penalty);
                  }
                }
              } else {
                items.push({
                  type: ItemType.BOX,
                  width: wordWidth,
                  text: segment,
                  originIndex: segmentIndex
                } as Box);
              }
            }
          } else {
            const wordWidth = measureText(segment);
            if (lineWidth && wordWidth > lineWidth) {
              // Word longer than line width - break into characters
              const chars = Array.from(segment);
              for (let i = 0; i < chars.length; i++) {
                items.push({
                  type: ItemType.BOX,
                  width: measureText(chars[i]),
                  text: chars[i],
                  originIndex: segmentIndex + i
                } as Box);

                if (i < chars.length - 1) {
                  items.push({
                    type: ItemType.PENALTY,
                    width: 0,
                    penalty: 5000,
                    originIndex: segmentIndex + i + 1
                  } as Penalty);
                }
              }
            } else {
              items.push({
                type: ItemType.BOX,
                width: wordWidth,
                text: segment,
                originIndex: segmentIndex
              } as Box);
            }
          }
          segmentIndex += segment.length;
        }
        currentIndex += token.length;
      }
    }
    return items;
  }

  // TeX: line_break inner loop (tex.web lines 16169-17256)
  // Finds optimal breakpoints using Knuth-Plass algorithm
  private static lineBreak(
    items: Item[],
    lineWidth: number,
    threshold: number,
    emergencyStretch: number,
    context: LineBreakContext
  ): BreakNode | null {
    const activeNodes = new ActiveNodeList();

    // Start node with zero cumulative width
    activeNodes.insert({
      position: 0,
      line: 0,
      fitness: FitnessClass.DECENT,
      totalDemerits: 0,
      previous: null,
      hyphenated: false,
      active: true,
      activeIndex: 0,
      cumWidth: 0,
      cumStretch: 0,
      cumShrink: 0
    });

    // Cumulative width from paragraph start, representing items[0..i-1]
    let cumWidth = 0;
    let cumStretch = 0;
    let cumShrink = 0;

    // Process each item
    for (let i = 0; i < items.length; i++) {
      const item = items[i];

      // Check if this is a legal breakpoint
      const isBreakpoint =
        (item.type === ItemType.PENALTY &&
          (item as Penalty).penalty < INFINITY_PENALTY) ||
        item.type === ItemType.DISCRETIONARY ||
        (item.type === ItemType.GLUE &&
          i > 0 &&
          items[i - 1].type === ItemType.BOX);

      if (!isBreakpoint) {
        // Accumulate width for non-breakpoint items
        if (item.type === ItemType.BOX) {
          cumWidth += item.width;
        } else if (item.type === ItemType.GLUE) {
          const glue = item as Glue;
          cumWidth += glue.width;
          cumStretch += glue.stretch;
          cumShrink += glue.shrink;
        } else if (item.type === ItemType.DISCRETIONARY) {
          cumWidth += item.width;
        }
        continue;
      }

      // Get penalty and flagged status
      let pi = 0;
      let flagged = false;
      if (item.type === ItemType.PENALTY) {
        pi = (item as Penalty).penalty;
        flagged = (item as Penalty).flagged || false;
      } else if (item.type === ItemType.DISCRETIONARY) {
        pi = (item as Discretionary).penalty;
        flagged = (item as Discretionary).flagged || false;
      }

      // Width added at break
      let breakWidth = 0;
      if (item.type === ItemType.DISCRETIONARY) {
        breakWidth = (item as Discretionary).preBreakWidth;
      }

      // Best for each fitness class
      const bestNode: (BreakNode | null)[] = [null, null, null, null];
      const bestDemerits = [Infinity, Infinity, Infinity, Infinity];

      // Nodes to deactivate
      const toDeactivate: BreakNode[] = [];

      // Try each active node as predecessor
      const active = activeNodes.getActive();
      for (let j = 0; j < active.length; j++) {
        const a = active[j];

        // Line width from a to i
        const lineW = cumWidth - a.cumWidth + breakWidth;
        const lineStretch = cumStretch - a.cumStretch;
        const lineShrink = cumShrink - a.cumShrink;

        const shortfall = lineWidth - lineW;
        let ratio: number;

        if (shortfall > 0) {
          const effectiveStretch = lineStretch + emergencyStretch;
          ratio =
            effectiveStretch > 0 ? shortfall / effectiveStretch : Infinity;
        } else if (shortfall < 0) {
          ratio = lineShrink > 0 ? shortfall / lineShrink : -Infinity;
        } else {
          ratio = 0;
        }

        // Calculate badness
        const bad = this.badness(
          shortfall,
          shortfall > 0 ? lineStretch + emergencyStretch : lineShrink
        );

        // Check feasibility
        if (ratio < -1) {
          toDeactivate.push(a);
          continue;
        }

        if (pi !== EJECT_PENALTY && bad > threshold) {
          continue;
        }

        // Calculate demerits
        let demerits = context.linePenalty + bad;
        if (Math.abs(demerits) >= 10000) {
          demerits = 100000000;
        } else {
          demerits = demerits * demerits;
        }

        if (pi > 0) {
          demerits += pi * pi;
        } else if (pi > EJECT_PENALTY) {
          demerits -= pi * pi;
        }

        if (flagged && a.hyphenated) {
          demerits += context.doubleHyphenDemerits;
        }

        const fitness = this.fitnessClass(ratio);

        if (Math.abs(fitness - a.fitness) > 1) {
          demerits += context.adjDemerits;
        }

        const totalDemerits = a.totalDemerits + demerits;

        if (totalDemerits < bestDemerits[fitness]) {
          bestDemerits[fitness] = totalDemerits;
          bestNode[fitness] = {
            position: i,
            line: a.line + 1,
            fitness,
            totalDemerits,
            previous: a,
            hyphenated: flagged,
            active: true,
            activeIndex: -1,
            cumWidth: cumWidth,
            cumStretch: cumStretch,
            cumShrink: cumShrink
          };
        }
      }

      // Deactivate nodes
      for (const node of toDeactivate) {
        activeNodes.deactivate(node);
      }

      // Insert best nodes
      for (let f = 0; f < 4; f++) {
        if (bestNode[f]) {
          activeNodes.insert(bestNode[f]!);
        }
      }

      if (activeNodes.size() === 0 && pi !== EJECT_PENALTY) {
        return null;
      }

      // Accumulate width after evaluating this breakpoint
      if (item.type === ItemType.BOX) {
        cumWidth += item.width;
      } else if (item.type === ItemType.GLUE) {
        const glue = item as Glue;
        cumWidth += glue.width;
        cumStretch += glue.stretch;
        cumShrink += glue.shrink;
      } else if (item.type === ItemType.DISCRETIONARY) {
        cumWidth += item.width;
      }
    }

    // Find best solution
    let best: BreakNode | null = null;
    let bestTotal = Infinity;

    for (const node of activeNodes.getActive()) {
      if (node.totalDemerits < bestTotal) {
        bestTotal = node.totalDemerits;
        best = node;
      }
    }

    return best;
  }

  // Main entry point for line breaking
  // Implements the multi-pass approach similar to TeX's line_break (tex.web lines 16054-17067)
  // 1. First pass without hyphenation (pretolerance)
  // 2. Second pass with hyphenation (tolerance)
  // 3. Emergency stretch passes with increasing stretchability
  public static breakText(options: LineBreakOptions): LineInfo[] {
    if (!options.text || options.text.length === 0) {
      return [];
    }

    perfLogger.start('LineBreak.breakText', {
      textLength: options.text.length,
      width: options.width,
      align: options.align || 'left',
      hyphenate: options.hyphenate || false
    });

    const {
      text,
      width,
      align = 'left',
      direction = 'ltr',
      hyphenate = false,
      language = 'en-us',
      respectExistingBreaks = true,
      measureText,
      measureTextWidths,
      hyphenationPatterns,
      unitsPerEm,
      letterSpacing = 0,
      tolerance = DEFAULT_TOLERANCE,
      pretolerance = DEFAULT_PRETOLERANCE,
      emergencyStretch = DEFAULT_EMERGENCY_STRETCH,
      autoEmergencyStretch,
      lefthyphenmin = DEFAULT_LEFT_HYPHEN_MIN,
      righthyphenmin = DEFAULT_RIGHT_HYPHEN_MIN,
      linepenalty = DEFAULT_LINE_PENALTY,
      adjdemerits = DEFAULT_FITNESS_DIFF_DEMERITS,
      hyphenpenalty = DEFAULT_HYPHEN_PENALTY,
      exhyphenpenalty = DEFAULT_EX_HYPHEN_PENALTY,
      doublehyphendemerits = DEFAULT_DOUBLE_HYPHEN_DEMERITS,
      finalhyphendemerits = DEFAULT_FINAL_HYPHEN_DEMERITS
    } = options;

    // Handle multiple paragraphs
    if (respectExistingBreaks && text.includes('\n')) {
      const paragraphs = text.split('\n');
      const allLines: LineInfo[] = [];
      let currentOriginOffset = 0;

      for (const paragraph of paragraphs) {
        if (paragraph.length === 0) {
          allLines.push({
            text: '',
            originalStart: currentOriginOffset,
            originalEnd: currentOriginOffset,
            xOffset: 0,
            isLastLine: true,
            naturalWidth: 0,
            endedWithHyphen: false
          });
        } else {
          const paragraphLines = this.breakText({
            ...options,
            text: paragraph,
            respectExistingBreaks: false
          });

          paragraphLines.forEach((line) => {
            line.originalStart += currentOriginOffset;
            line.originalEnd += currentOriginOffset;
          });

          allLines.push(...paragraphLines);
        }

        currentOriginOffset += paragraph.length + 1;
      }

      perfLogger.end('LineBreak.breakText');
      return allLines;
    }

    let useHyphenation = hyphenate;
    if (
      useHyphenation &&
      (!hyphenationPatterns || !hyphenationPatterns[language])
    ) {
      logger.warn(`Hyphenation patterns for ${language} not available`);
      useHyphenation = false;
    }

    let initialEmergencyStretch = emergencyStretch;
    if (autoEmergencyStretch !== undefined && width) {
      initialEmergencyStretch = width * autoEmergencyStretch;
    }

    const context: LineBreakContext = {
      linePenalty: linepenalty,
      adjDemerits: adjdemerits,
      doubleHyphenDemerits: doublehyphendemerits,
      finalHyphenDemerits: finalhyphendemerits,
      hyphenPenalty: hyphenpenalty,
      exHyphenPenalty: exhyphenpenalty,
      currentAlign: align,
      unitsPerEm,
      letterSpacingFU: unitsPerEm ? letterSpacing * unitsPerEm : 0
    };

    if (!width || width === Infinity) {
      const measuredWidth = measureText(text);
      perfLogger.end('LineBreak.breakText');
      return [
        {
          text,
          originalStart: 0,
          originalEnd: text.length - 1,
          xOffset: 0,
          isLastLine: true,
          naturalWidth: measuredWidth,
          endedWithHyphen: false
        }
      ];
    }

    // First pass: without hyphenation
    let items = this.itemizeText(
      text,
      measureText,
      measureTextWidths,
      false,
      language,
      hyphenationPatterns,
      lefthyphenmin,
      righthyphenmin,
      context,
      width
    );
    let best = this.lineBreak(items, width, pretolerance, 0, context);

    // Second pass: with hyphenation
    if (!best && useHyphenation) {
      items = this.itemizeText(
        text,
        measureText,
        measureTextWidths,
        true,
        language,
        hyphenationPatterns,
        lefthyphenmin,
        righthyphenmin,
        context,
        width
      );
      best = this.lineBreak(items, width, tolerance, 0, context);
    }

    // Third pass: with emergency stretch, retry with increasing amounts
    if (!best) {
      const MAX_EMERGENCY_ITERATIONS = 5;
      for (let i = 0; i < MAX_EMERGENCY_ITERATIONS && !best; i++) {
        const currentStretch =
          initialEmergencyStretch + i * width * EMERGENCY_STRETCH_INCREMENT;
        best = this.lineBreak(items, width, tolerance, currentStretch, context);

        // Fourth pass: high threshold with current stretch
        if (!best) {
          best = this.lineBreak(items, width, INF_BAD, currentStretch, context);
        }
      }
    }

    if (best) {
      const breakpoints: number[] = [];
      let node: BreakNode | null = best;
      while (node && node.position > 0) {
        breakpoints.unshift(node.position);
        node = node.previous;
      }

      perfLogger.end('LineBreak.breakText');
      return this.postLineBreak(
        text,
        items,
        breakpoints,
        width,
        align,
        direction,
        context
      );
    }

    perfLogger.end('LineBreak.breakText');
    return [
      {
        text,
        originalStart: 0,
        originalEnd: text.length - 1,
        xOffset: 0,
        adjustmentRatio: 0,
        isLastLine: true,
        naturalWidth: measureText(text),
        endedWithHyphen: false
      }
    ];
  }

  // TeX: post_line_break (tex.web lines 17260-17448)
  // Creates the actual lines from the computed breakpoints
  private static postLineBreak(
    text: string,
    items: Item[],
    breakpoints: number[],
    lineWidth: number,
    align: TextAlign,
    direction: TextDirection,
    context?: LineBreakContext
  ): LineInfo[] {
    if (breakpoints.length === 0) {
      return [
        {
          text,
          originalStart: 0,
          originalEnd: text.length - 1,
          xOffset: 0
        }
      ];
    }

    const lines: LineInfo[] = [];
    let lineStart = 0;

    for (let i = 0; i < breakpoints.length; i++) {
      const breakpoint = breakpoints[i];
      const willHaveFinalLine =
        breakpoints[breakpoints.length - 1] + 1 < items.length - 1;
      const isLastLine = willHaveFinalLine
        ? false
        : i === breakpoints.length - 1;

      const lineTextParts: string[] = [];
      let originalStart = -1;
      let originalEnd = -1;
      let naturalWidth = 0;
      let totalStretch = 0;
      let totalShrink = 0;

      for (let j = lineStart; j < breakpoint; j++) {
        const item = items[j];

        if (
          (item.type === ItemType.PENALTY && !item.text) ||
          (item.type === ItemType.DISCRETIONARY &&
            !(item as Discretionary).noBreak)
        ) {
          continue;
        }

        if (item.originIndex !== undefined) {
          if (originalStart === -1 || item.originIndex < originalStart)
            originalStart = item.originIndex;
          const textLength = item.text ? item.text.length : 0;
          const itemEnd = item.originIndex + textLength - 1;
          if (itemEnd > originalEnd) originalEnd = itemEnd;
        }

        if (item.text) {
          lineTextParts.push(item.text);
        } else if (item.type === ItemType.DISCRETIONARY) {
          const disc = item as Discretionary;
          if (disc.noBreak) lineTextParts.push(disc.noBreak);
        }

        naturalWidth += item.width;

        if (item.type === ItemType.GLUE) {
          totalStretch += (item as Glue).stretch;
          totalShrink += (item as Glue).shrink;
        }
      }

      const breakItem = items[breakpoint];
      let endedWithHyphen = false;

      if (breakpoint < items.length) {
        if (
          breakItem.type === ItemType.PENALTY &&
          (breakItem as Penalty).flagged
        ) {
          lineTextParts.push('-');
          naturalWidth += breakItem.width;
          endedWithHyphen = true;
          if (breakItem.originIndex !== undefined)
            originalEnd = breakItem.originIndex - 1;
        } else if (breakItem.type === ItemType.DISCRETIONARY) {
          const disc = breakItem as Discretionary;
          if (disc.preBreak) {
            lineTextParts.push(disc.preBreak);
            naturalWidth += disc.preBreakWidth;
            endedWithHyphen = disc.flagged || false;
            if (breakItem.originIndex !== undefined)
              originalEnd = breakItem.originIndex - 1;
          }
        }
      }

      const lineText = lineTextParts.join('');

      if (context?.letterSpacingFU && naturalWidth !== 0) {
        naturalWidth -= context.letterSpacingFU;
      }

      let xOffset = 0;
      let adjustmentRatio = 0;
      let effectiveAlign = align;

      if (align === 'justify' && isLastLine) {
        effectiveAlign = direction === 'rtl' ? 'right' : 'left';
      }

      if (effectiveAlign === 'center') {
        xOffset = (lineWidth - naturalWidth) / 2;
      } else if (effectiveAlign === 'right') {
        xOffset = lineWidth - naturalWidth;
      } else if (effectiveAlign === 'justify' && !isLastLine) {
        const shortfall = lineWidth - naturalWidth;
        if (shortfall > 0 && totalStretch > 0) {
          adjustmentRatio = shortfall / totalStretch;
        } else if (shortfall < 0 && totalShrink > 0) {
          adjustmentRatio = shortfall / totalShrink;
        }
      }

      lines.push({
        text: lineText,
        originalStart,
        originalEnd,
        xOffset,
        adjustmentRatio,
        isLastLine: false,
        naturalWidth,
        endedWithHyphen
      });

      lineStart = breakpoint + 1;
    }

    // Handle remaining content
    if (lineStart < items.length - 1) {
      const finalLineTextParts: string[] = [];
      let finalOriginalStart = -1;
      let finalOriginalEnd = -1;
      let finalNaturalWidth = 0;

      for (let j = lineStart; j < items.length - 1; j++) {
        const item = items[j];

        if (item.type === ItemType.PENALTY) continue;

        if (item.originIndex !== undefined) {
          if (
            finalOriginalStart === -1 ||
            item.originIndex < finalOriginalStart
          ) {
            finalOriginalStart = item.originIndex;
          }
          if (item.originIndex > finalOriginalEnd) {
            finalOriginalEnd = item.originIndex;
          }
        }

        if (item.text) finalLineTextParts.push(item.text);
        finalNaturalWidth += item.width;
      }

      if (context?.letterSpacingFU && finalNaturalWidth !== 0) {
        finalNaturalWidth -= context.letterSpacingFU;
      }

      let finalXOffset = 0;
      let finalEffectiveAlign = align;

      if (align === 'justify') {
        finalEffectiveAlign = direction === 'rtl' ? 'right' : 'left';
      }

      if (finalEffectiveAlign === 'center') {
        finalXOffset = (lineWidth - finalNaturalWidth) / 2;
      } else if (finalEffectiveAlign === 'right') {
        finalXOffset = lineWidth - finalNaturalWidth;
      }

      lines.push({
        text: finalLineTextParts.join(''),
        originalStart: finalOriginalStart,
        originalEnd: finalOriginalEnd,
        xOffset: finalXOffset,
        adjustmentRatio: 0,
        isLastLine: true,
        naturalWidth: finalNaturalWidth,
        endedWithHyphen: false
      });

      if (lines.length > 1) lines[lines.length - 2].isLastLine = false;
      lines[lines.length - 1].isLastLine = true;
    } else if (lines.length > 0) {
      lines[lines.length - 1].isLastLine = true;
    }

    return lines;
  }
}
