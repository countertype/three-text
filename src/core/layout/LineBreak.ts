// Based on TeX's line breaking (Knuth, Plass, Liang)

import { perfLogger } from '../../utils/PerformanceLogger';
import { debugLogger } from '../../utils/DebugLogger';
import {
  FITNESS_TIGHT_THRESHOLD,
  FITNESS_NORMAL_THRESHOLD,
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
  BOX, // a character or word with a fixed width
  GLUE, // stretchable space between boxes
  PENALTY, // potential breakpoint with an associated penalty
  DISCRETIONARY // discretionary break with pre/post/no-break forms
}

export enum FitnessClass {
  TIGHT = 0,
  NORMAL = 1,
  LOOSE = 2,
  VERY_LOOSE = 3
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
  stretch: number; // amount the space can stretch
  shrink: number; // amount the space can shrink
}

export interface Penalty extends Item {
  type: ItemType.PENALTY;
  penalty: number; // cost of breaking at this point (infinity means no break allowed)
  flagged?: boolean; // for tracking consecutive hyphenated breaks
}

export interface Discretionary extends Item {
  type: ItemType.DISCRETIONARY;
  preBreak: string; // text to insert before break (e.g., hyphen)
  postBreak: string; // text to insert after break (usually empty)
  noBreak: string; // text to use if no break occurs (usually empty)
  preBreakWidth: number; // width of preBreak text
  penalty: number; // penalty for breaking here
  flagged?: boolean; // for tracking consecutive hyphenated breaks
}

interface BreakNode {
  position: number; // position in the item list
  line: number; // line number
  fitness: FitnessClass; // fitness class of this line
  totalDemerits: number; // total demerits up to this breakpoint
  totalWidth: number; // total width of content
  previous: BreakNode | null; // previous break in the solution
  active: boolean; // whether this node is still active
  activeListIndex?: number; // position in active list
}

// ActiveNodeList maintains all currently viable breakpoints as we scan through the text.
// Each node represents a potential break with accumulated demerits (total "cost" from start).
//
// Demerits = cumulative penalty score from text start to this break, calculated as:
//   (line_penalty + badness)² + penalty² + flagged/fitness adjustments (tex.web §859)
// Lower demerits = better line breaks. TeX minimizes total demerits across the paragraph.
//
// Implementation differs from TeX:
// - Hash map for O(1) lookups by position+fitness
// - Separate array containing only active nodes
// - Each node tracks its array index for swap-and-pop removal

class ActiveNodeList {
  private nodesByKey: Map<number, BreakNode>;
  private activeList: BreakNode[];
  private allNodes: Set<BreakNode>;

  constructor() {
    this.nodesByKey = new Map();
    this.activeList = [];
    this.allNodes = new Set();
  }

  private getKey(position: number, fitness: FitnessClass): number {
    return (position << 2) | fitness;
  }

  insert(node: BreakNode): void {
    const key = this.getKey(node.position, node.fitness);
    const existing = this.nodesByKey.get(key);

    if (existing && node.totalDemerits < existing.totalDemerits) {
      existing.totalDemerits = node.totalDemerits;
      existing.previous = node.previous;
      existing.totalWidth = node.totalWidth;
    } else if (!existing) {
      this.nodesByKey.set(key, node);
      this.allNodes.add(node);
      node.activeListIndex = this.activeList.length;
      this.activeList.push(node);
    }
  }

  findExisting(position: number, fitness: FitnessClass): BreakNode | undefined {
    return this.nodesByKey.get(this.getKey(position, fitness));
  }

  getAllActive(): BreakNode[] {
    return this.activeList;
  }

  // Swap-and-pop removal
  deactivateNode(node: BreakNode): void {
    if (node.active && node.activeListIndex !== undefined) {
      node.active = false;
      const idx = node.activeListIndex;
      const last = this.activeList.length - 1;

      if (idx !== last) {
        const lastNode = this.activeList[last];
        this.activeList[idx] = lastNode;
        lastNode.activeListIndex = idx;
      }

      this.activeList.pop();
      node.activeListIndex = undefined;
    }
  }

  size(): number {
    return this.allNodes.size;
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
  respectExistingBreaks?: boolean;
  hyphenationPatterns?: HyphenationPatternsMap;
  unitsPerEm?: number;

  // Max badness with hyphenation in second pass (TeX default: 800)
  tolerance?: number;

  // Max badness without hyphenation in first pass (TeX default: 100)
  pretolerance?: number;

  // Extra stretchability added in the emergency pass when no good breaks found (TeX's default: 0)
  emergencyStretch?: number;

  // Auto-calculate emergency stretch as percentage of line width (e.g., 0.1 = 10%)
  // When set, overrides emergencyStretch. Defaults to 10% for non-hyphenated text
  autoEmergencyStretch?: number;

  // TeX hyphenation minimums (\lefthyphenmin and \righthyphenmin)
  lefthyphenmin?: number; // min characters before hyphen
  righthyphenmin?: number; // min characters after hyphen

  // Penalties and demerits
  linepenalty?: number; // added to every line's badness before squaring
  adjdemerits?: number; // demerits when fitness classes differ by >1
  hyphenpenalty?: number; // penalty at automatic hyphenation points
  exhyphenpenalty?: number; // penalty at explicit hyphen characters
  doublehyphendemerits?: number; // demerits for consecutive hyphenated breaks

  // Looseness: adjust paragraph length by n lines
  looseness?: number;

  // Disable automatic detection and prevention of short single-word lines
  // When enabled (default), iteratively applies emergency stretch to eliminate
  // isolated words on lines that are less than 50% of the target width.
  disableSingleWordDetection?: boolean;
}

interface LineBreakContext {
  linePenalty: number;
  adjDemerits: number;
  doubleHyphenDemerits: number;
  hyphenPenalty: number;
  exHyphenPenalty: number;
  currentAlign: TextAlign;
  unitsPerEm?: number;
}

// TeX defaults
const DEFAULT_HYPHEN_PENALTY = 50;
const DEFAULT_EX_HYPHEN_PENALTY = 50;
const DEFAULT_DOUBLE_HYPHEN_DEMERITS = 10000;
const DEFAULT_LINE_PENALTY = 10;
const DEFAULT_FITNESS_DIFF_DEMERITS = 10000;

const FORCED_BREAK = -Infinity;

const DEFAULT_LEFT_HYPHEN_MIN = 2;
const DEFAULT_RIGHT_HYPHEN_MIN = 4;

const INF_BAD = 10000;

// Non TeX default: emergency stretch for non-hyphenated text (10% of line width)
const DEFAULT_EMERGENCY_STRETCH_NO_HYPHEN = 0.1;

// Another non TeX default: Single-word line detection thresholds
const SINGLE_WORD_WIDTH_THRESHOLD = 0.5; // Lines < 50% of width are problematic
const SINGLE_WORD_EMERGENCY_STRETCH_INCREMENT = 0.1; // Add 10% per iteration

export class LineBreak {
  // Calculate badness according to TeX's formula (tex.web §108, line 2337)
  // Given t (desired adjustment) and s (available stretch/shrink)
  // Returns approximation to 100(t/s)³, representing how "bad" a line is
  // Constants are derived from TeX's fixed-point arithmetic:
  //   297³ ≈ 100×2¹⁸, so (297t/s)³/2¹⁸ ≈ 100(t/s)³
  private static badness(t: number, s: number): number {
    if (t === 0) return 0;
    if (s <= 0) return INF_BAD;

    let r: number;
    if (t <= 7230584) {
      r = Math.floor((t * 297) / s);
    } else if (s >= 1663497) {
      r = Math.floor(t / Math.floor(s / 297));
    } else {
      r = t;
    }

    if (r > 1290) return INF_BAD;

    return Math.floor((r * r * r + 131072) / 262144);
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

    const filteredPoints = hyphenPoints.filter(
      (pos) => pos >= lefthyphenmin && word.length - pos >= righthyphenmin
    );

    return filteredPoints;
  }

  public static itemizeText(
    text: string,
    measureText: (text: string) => number, // function to measure text width
    hyphenate: boolean = false,
    language: string = 'en-us',
    availablePatterns?: HyphenationPatternsMap,
    lefthyphenmin: number = DEFAULT_LEFT_HYPHEN_MIN,
    righthyphenmin: number = DEFAULT_RIGHT_HYPHEN_MIN,
    context?: LineBreakContext
  ): Item[] {
    const items: Item[] = [];

    items.push(
      ...this.itemizeParagraph(
        text,
        measureText,
        hyphenate,
        language,
        availablePatterns,
        lefthyphenmin,
        righthyphenmin,
        context
      )
    );

    // Final glue and penalty to end the paragraph
    // Use infinite stretch to fill the last line
    items.push({
      type: ItemType.GLUE,
      width: 0,
      stretch: Infinity,
      shrink: 0,
      text: '',
      originIndex: text.length
    } as Glue);
    items.push({
      type: ItemType.PENALTY,
      width: 0,
      penalty: -Infinity,
      text: '',
      originIndex: text.length
    } as Penalty);

    return items;
  }

  private static itemizeParagraph(
    text: string,
    measureText: (text: string) => number,
    hyphenate: boolean,
    language: string,
    availablePatterns: HyphenationPatternsMap | undefined,
    lefthyphenmin: number,
    righthyphenmin: number,
    context: LineBreakContext | undefined
  ): Item[] {
    const items: Item[] = [];
    // First split into words and spaces
    const tokens = text.match(/\S+|\s+/g) || [];
    let currentIndex = 0;

    for (let i = 0; i < tokens.length; i++) {
      const token = tokens[i];
      const tokenStartIndex = currentIndex;

      if (/\s+/.test(token)) {
        // Handle spaces
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
        // Process word, splitting on explicit hyphens
        // Split on hyphens while keeping them in the result
        const segments = token.split(/(-)/);
        let segmentIndex = tokenStartIndex;

        for (let j = 0; j < segments.length; j++) {
          const segment = segments[j];

          if (!segment) continue; // Skip empty segments

          if (segment === '-') {
            // Handle explicit hyphen as discretionary break
            items.push({
              type: ItemType.DISCRETIONARY,
              width: measureText('-'), // Width of hyphen in normal flow
              preBreak: '-', // Hyphen appears before break
              postBreak: '', // Nothing after break
              noBreak: '-', // Hyphen if no break
              preBreakWidth: measureText('-'),
              penalty: context?.exHyphenPenalty ?? DEFAULT_EX_HYPHEN_PENALTY,
              flagged: true,
              text: '-',
              originIndex: segmentIndex
            } as Discretionary);
            segmentIndex += 1;
          } else {
            // Process non-hyphen segment
            // First handle soft hyphens (U+00AD)
            if (segment.includes('\u00AD')) {
              const partsWithMarkers = segment.split('\u00AD');
              let runningIndex = 0;
              for (let k = 0; k < partsWithMarkers.length; k++) {
                const partText = partsWithMarkers[k];
                if (partText.length > 0) {
                  items.push({
                    type: ItemType.BOX,
                    width: measureText(partText),
                    text: partText,
                    originIndex: segmentIndex + runningIndex
                  } as Box);
                  runningIndex += partText.length;
                }
                if (k < partsWithMarkers.length - 1) {
                  items.push({
                    type: ItemType.DISCRETIONARY,
                    width: 0, // No width in normal flow
                    preBreak: '-', // Hyphen appears before break
                    postBreak: '', // Nothing after break
                    noBreak: '', // Nothing if no break (word continues)
                    preBreakWidth: measureText('-'),
                    penalty: context?.hyphenPenalty ?? DEFAULT_HYPHEN_PENALTY,
                    flagged: true,
                    text: '',
                    originIndex: segmentIndex + runningIndex
                  } as Discretionary);
                  runningIndex += 1; // Account for the soft hyphen character
                }
              }
            } else if (
              hyphenate &&
              segment.length >= lefthyphenmin + righthyphenmin
            ) {
              // Apply hyphenation patterns only to segments between explicit hyphens
              const hyphenPoints = LineBreak.findHyphenationPoints(
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
                    width: 0, // No width in normal flow
                    preBreak: '-', // Hyphen appears before break
                    postBreak: '', // Nothing after break
                    noBreak: '', // Nothing if no break (word continues)
                    preBreakWidth: measureText('-'),
                    penalty: context?.hyphenPenalty ?? DEFAULT_HYPHEN_PENALTY,
                    flagged: true,
                    text: '',
                    originIndex: segmentIndex + point
                  } as Discretionary);
                  lastPoint = point;
                }

                const lastPart = segment.substring(lastPoint);
                items.push({
                  type: ItemType.BOX,
                  width: measureText(lastPart),
                  text: lastPart,
                  originIndex: segmentIndex + lastPoint
                } as Box);
              } else {
                // No hyphenation points, add as single box
                items.push({
                  type: ItemType.BOX,
                  width: measureText(segment),
                  text: segment,
                  originIndex: segmentIndex
                } as Box);
              }
            } else {
              // No hyphenation, add as single box
              items.push({
                type: ItemType.BOX,
                width: measureText(segment),
                text: segment,
                originIndex: segmentIndex
              } as Box);
            }
            segmentIndex += segment.length;
          }
        }
        currentIndex += token.length;
      }
    }
    return items;
  }

  // Detect if breakpoints create problematic single-word lines
  private static hasSingleWordLines(
    items: Item[],
    breakpoints: number[],
    lineWidth: number
  ): boolean {
    // Check each line segment (except the last, which can naturally be short)
    let lineStart = 0;

    for (let i = 0; i < breakpoints.length - 1; i++) {
      const breakpoint = breakpoints[i];

      // Count glue items (spaces) between line start and breakpoint
      let glueCount = 0;
      let totalWidth = 0;

      for (let j = lineStart; j < breakpoint; j++) {
        if (items[j].type === ItemType.GLUE) {
          glueCount++;
        }
        if (items[j].type !== ItemType.PENALTY) {
          totalWidth += items[j].width;
        }
      }

      // Single word line = no glue items
      if (glueCount === 0 && totalWidth > 0) {
        const widthRatio = totalWidth / lineWidth;
        if (widthRatio < SINGLE_WORD_WIDTH_THRESHOLD) {
          return true;
        }
      }

      lineStart = breakpoint + 1;
    }
    return false;
  }

  public static breakText(options: LineBreakOptions): LineInfo[] {
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
      hyphenationPatterns,
      unitsPerEm,
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
      looseness = 0,
      disableSingleWordDetection = false
    } = options;

    // Handle multiple paragraphs by processing each independently
    if (respectExistingBreaks && text.includes('\n')) {
      const paragraphs = text.split('\n');
      const allLines: LineInfo[] = [];
      let currentOriginOffset = 0;

      for (const paragraph of paragraphs) {
        if (paragraph.length === 0) {
          // Add an empty line for empty paragraphs
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
          // Process paragraph independently
          const paragraphLines = LineBreak.breakText({
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
      debugLogger.warn(`Hyphenation patterns for ${language} not available`);
      useHyphenation = false;
    }

    // Calculate initial emergency stretch (TeX default: 0)
    let initialEmergencyStretch = emergencyStretch;
    if (autoEmergencyStretch !== undefined && width) {
      // autoEmergencyStretch overrides everything
      initialEmergencyStretch = width * autoEmergencyStretch;
    } else if (
      !useHyphenation &&
      emergencyStretch === DEFAULT_EMERGENCY_STRETCH &&
      width
    ) {
      // Default: non-hyphenated text gets 10% (has fewer breakpoints)
      initialEmergencyStretch = width * DEFAULT_EMERGENCY_STRETCH_NO_HYPHEN;
    }

    const context: LineBreakContext = {
      linePenalty: linepenalty,
      adjDemerits: adjdemerits,
      doubleHyphenDemerits: doublehyphendemerits,
      hyphenPenalty: hyphenpenalty,
      exHyphenPenalty: exhyphenpenalty,
      currentAlign: align,
      unitsPerEm
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

    // Itemize text once, including all potential hyphenation points
    const allItems = LineBreak.itemizeText(
      text,
      measureText,
      useHyphenation,
      language,
      hyphenationPatterns,
      lefthyphenmin,
      righthyphenmin,
      context
    );

    if (allItems.length === 0) {
      return [];
    }

    // Iteratively increase emergency stretch to eliminate short single-word lines.
    // Post-processing approach preserves TeX algorithm integrity while itemization
    // (the expensive part) happens once
    const MAX_ITERATIONS = 5;
    let iteration = 0;
    let currentEmergencyStretch = initialEmergencyStretch;
    let resultLines: LineInfo[] | null = null;
    const singleWordDetectionEnabled = !disableSingleWordDetection;

    while (iteration < MAX_ITERATIONS) {
      // Three-pass approach for optimal line breaking:
      // First pass: Try without hyphenation using pretolerance (fast)
      // Second pass: Enable hyphenation if available, use tolerance (quality)
      // Final pass: Emergency stretch for difficult paragraphs (last resort)

      // First pass: no hyphenation
      let currentItems = useHyphenation
        ? allItems.filter(
            (item) =>
              item.type !== ItemType.DISCRETIONARY ||
              (item as Discretionary).penalty !==
                (context?.hyphenPenalty ?? DEFAULT_HYPHEN_PENALTY)
          )
        : allItems;

      let breaks = LineBreak.findBreakpoints(
        currentItems,
        width,
        pretolerance,
        looseness,
        false,
        0,
        context
      );

      // Second pass: with hyphenation
      if (breaks.length === 0 && useHyphenation) {
        currentItems = allItems;
        breaks = LineBreak.findBreakpoints(
          currentItems,
          width,
          tolerance,
          looseness,
          false,
          0,
          context
        );
      }

      // Final pass: emergency stretch
      if (breaks.length === 0) {
        currentItems = allItems;
        breaks = LineBreak.findBreakpoints(
          currentItems,
          width,
          INF_BAD + 1,
          looseness,
          true,
          currentEmergencyStretch,
          context
        );
      }

      // Force with infinite tolerance if still no breaks found
      if (breaks.length === 0) {
        breaks = LineBreak.findBreakpoints(
          currentItems,
          width,
          Infinity,
          looseness,
          true,
          currentEmergencyStretch,
          context
        );
      }

      // Create lines from breaks
      if (breaks.length > 0) {
        const cumulativeWidths =
          LineBreak.computeCumulativeWidths(currentItems);
        resultLines = LineBreak.createLines(
          text,
          currentItems,
          breaks,
          width,
          align,
          direction,
          cumulativeWidths,
          context
        );

        // Check for single-word lines if detection is enabled
        if (
          singleWordDetectionEnabled &&
          breaks.length > 1 &&
          LineBreak.hasSingleWordLines(currentItems, breaks, width)
        ) {
          // Increase emergency stretch and try again
          currentEmergencyStretch +=
            width * SINGLE_WORD_EMERGENCY_STRETCH_INCREMENT;
          iteration++;
          continue;
        }

        break;
      }

      break;
    }

    perfLogger.end('LineBreak.breakText');

    if (resultLines && resultLines.length > 0) {
      return resultLines;
    }

    // Fallback: single line
    const measuredWidth = measureText(text);
    return [
      {
        text,
        originalStart: 0,
        originalEnd: text.length - 1,
        xOffset: 0,
        adjustmentRatio: 0,
        isLastLine: true,
        naturalWidth: measuredWidth,
        endedWithHyphen: false
      }
    ];
  }

  private static findBreakpoints(
    items: Item[], // array of items (boxes, glues, penalties)
    lineWidth: number, // desired line width
    threshold: number = Infinity, // maximum badness allowed for a break
    looseness: number = 0, // desired line count adjustment
    isFinalPass: boolean = false, // whether this is the final pass
    emergencyStretch: number = 0, // emergency stretch added to background stretchability
    context?: LineBreakContext
  ): number[] {
    // Pre-compute cumulative widths for fast range queries
    const cumulativeWidths = LineBreak.computeCumulativeWidths(items);

    const activeNodes = new ActiveNodeList();

    activeNodes.insert({
      position: 0,
      line: 0,
      fitness: FitnessClass.NORMAL,
      totalDemerits: 0,
      totalWidth: 0,
      previous: null,
      active: true
    });

    for (let i = 0; i < items.length; i++) {
      const item = items[i];

      if (
        item.type === ItemType.PENALTY &&
        (item as Penalty).penalty < Infinity
      ) {
        LineBreak.considerBreak(
          items,
          activeNodes,
          i,
          lineWidth,
          threshold,
          emergencyStretch,
          cumulativeWidths,
          context
        );
      }

      if (
        item.type === ItemType.DISCRETIONARY &&
        (item as Discretionary).penalty < Infinity
      ) {
        LineBreak.considerBreak(
          items,
          activeNodes,
          i,
          lineWidth,
          threshold,
          emergencyStretch,
          cumulativeWidths,
          context
        );
      }

      if (
        item.type === ItemType.GLUE &&
        i > 0 &&
        items[i - 1].type === ItemType.BOX
      ) {
        LineBreak.considerBreak(
          items,
          activeNodes,
          i,
          lineWidth,
          threshold,
          emergencyStretch,
          cumulativeWidths,
          context
        );
      }

      LineBreak.deactivateNodes(
        activeNodes,
        i,
        lineWidth,
        cumulativeWidths.minWidths
      );
    }

    const breakpoints: number[] = [];

    let bestNode: BreakNode | null = null;

    if (looseness === 0) {
      // Find the node with lowest demerits
      const allActive = activeNodes.getAllActive();
      let lowestDemerits = Infinity;
      for (const node of allActive) {
        if (!node.active) continue;
        if (node.totalDemerits < lowestDemerits) {
          lowestDemerits = node.totalDemerits;
          bestNode = node;
        }
      }
    } else {
      // Looseness adjustment: find best node with desired line count
      const allActive = activeNodes.getAllActive();

      // Find bestLine from lowest-demerit node (TeX: best_line = line_number(best_bet))
      let bestLine = 0;
      let fewestDemeritsForBaseline = Infinity;
      for (const node of allActive) {
        if (!node.active) continue;
        if (node.totalDemerits < fewestDemeritsForBaseline) {
          fewestDemeritsForBaseline = node.totalDemerits;
          bestLine = node.line;
        }
      }

      // Find best node for desired looseness relative to bestLine
      let actualLooseness = 0;
      let fewestDemerits = Infinity;

      for (const node of allActive) {
        if (!node.active) continue;

        const lineDiff = node.line - bestLine;

        if (
          (lineDiff < actualLooseness && looseness <= lineDiff) ||
          (lineDiff > actualLooseness && looseness >= lineDiff)
        ) {
          bestNode = node;
          actualLooseness = lineDiff;
          fewestDemerits = node.totalDemerits;
        } else if (
          lineDiff === actualLooseness &&
          node.totalDemerits < fewestDemerits
        ) {
          bestNode = node;
          fewestDemerits = node.totalDemerits;
        }
      }

      // If we couldn't achieve the desired looseness and it's not the final pass,
      // return empty to try again with different parameters
      if (!isFinalPass && actualLooseness !== looseness && bestNode) {
        return [];
      }
    }

    if (!bestNode) {
      return [];
    }

    while (bestNode && bestNode.position > 0) {
      breakpoints.unshift(bestNode.position);
      bestNode = bestNode.previous;
    }

    return breakpoints;
  }

  private static considerBreak(
    items: Item[],
    activeNodes: ActiveNodeList,
    breakpoint: number,
    lineWidth: number,
    threshold: number = Infinity,
    emergencyStretch: number = 0,
    cumulativeWidths?: {
      widths: number[];
      stretches: number[];
      shrinks: number[];
      minWidths: number[];
    },
    context?: LineBreakContext
  ): void {
    const penalty =
      items[breakpoint].type === ItemType.PENALTY
        ? (items[breakpoint] as Penalty).penalty
        : 0;

    const isForcedBreak = penalty <= -Infinity;

    let consideredNodes = 0;
    let acceptedBreaks = 0;

    const allActiveNodes = activeNodes.getAllActive();

    for (let i = 0; i < allActiveNodes.length; i++) {
      const node = allActiveNodes[i];

      if (!node.active) continue;

      consideredNodes++;

      const adjustmentData = LineBreak.computeAdjustmentRatio(
        items,
        node.position,
        breakpoint,
        node.line,
        lineWidth,
        cumulativeWidths,
        context
      );

      const {
        ratio: r,
        adjustment,
        stretch,
        shrink,
        totalWidth
      } = adjustmentData;

      // Calculate badness according to TeX formula
      let badness: number;
      if (adjustment > 0) {
        // Add emergency stretch to the background stretchability
        const effectiveStretch = stretch + emergencyStretch;
        if (effectiveStretch <= 0) {
          // Overfull box - badness is infinite + 1
          badness = INF_BAD + 1;
        } else {
          badness = LineBreak.badness(adjustment, effectiveStretch);
        }
      } else if (adjustment < 0) {
        if (shrink <= 0) {
          // Can't shrink - overfull box
          badness = INF_BAD + 1;
        } else if (-adjustment > shrink) {
          // Overfull box (can't shrink enough)
          badness = INF_BAD + 1;
        } else {
          badness = LineBreak.badness(-adjustment, shrink);
        }
      } else {
        badness = 0;
      }

      if (!isForcedBreak && r < -1) {
        // Too tight, skip unless forced
        continue;
      }

      const fitnessClass = LineBreak.computeFitnessClass(
        badness,
        adjustment > 0
      );

      if (!isForcedBreak && badness > threshold) {
        continue;
      }

      // Initialize demerits based on TeX formula with saturation check
      let flaggedDemerits = 0;
      let fitnessDemerits = 0;
      const configuredLinePenalty = context?.linePenalty ?? 0;
      let d = configuredLinePenalty + badness;
      let demerits = Math.abs(d) >= 10000 ? 100000000 : d * d;

      const breakpointPenalty =
        items[breakpoint].type === ItemType.PENALTY
          ? (items[breakpoint] as Penalty).penalty
          : items[breakpoint].type === ItemType.DISCRETIONARY
            ? (items[breakpoint] as Discretionary).penalty
            : 0;

      // TeX penalty handling: pi != 0 check, then positive/negative logic
      if (breakpointPenalty !== 0) {
        if (breakpointPenalty > 0) {
          demerits += breakpointPenalty * breakpointPenalty;
        } else if (breakpointPenalty > FORCED_BREAK) {
          demerits -= breakpointPenalty * breakpointPenalty;
        }
      }

      const breakpointFlagged =
        (items[breakpoint].type === ItemType.PENALTY &&
          (items[breakpoint] as Penalty).flagged) ||
        (items[breakpoint].type === ItemType.DISCRETIONARY &&
          (items[breakpoint] as Discretionary).flagged);

      const nodeFlagged =
        node.position > 0 &&
        ((items[node.position].type === ItemType.PENALTY &&
          (items[node.position] as Penalty).flagged) ||
          (items[node.position].type === ItemType.DISCRETIONARY &&
            (items[node.position] as Discretionary).flagged));

      if (breakpointFlagged && nodeFlagged) {
        flaggedDemerits = context?.doubleHyphenDemerits ?? 0;
        demerits += flaggedDemerits;
      }

      if (Math.abs(fitnessClass - node.fitness) > 1) {
        fitnessDemerits = context?.adjDemerits ?? 0;
        demerits += fitnessDemerits;
      }

      if (isForcedBreak) {
        demerits = 0;
      }

      const totalDemerits = node.totalDemerits + demerits;
      let existingNode = activeNodes.findExisting(breakpoint, fitnessClass);

      if (existingNode) {
        if (totalDemerits < existingNode.totalDemerits) {
          existingNode.totalDemerits = totalDemerits;
          existingNode.previous = node;
          existingNode.totalWidth = totalWidth;
          acceptedBreaks++;
        }
      } else {
        activeNodes.insert({
          position: breakpoint,
          line: node.line + 1,
          fitness: fitnessClass,
          totalDemerits,
          totalWidth,
          previous: node,
          active: true
        });
        acceptedBreaks++;
      }
    }
  }

  private static computeAdjustmentRatio(
    items: Item[],
    lineStart: number,
    lineEnd: number,
    _lineNumber: number,
    lineWidth: number,
    cumulativeWidths?: {
      widths: number[];
      stretches: number[];
      shrinks: number[];
      minWidths: number[];
    },
    _context?: LineBreakContext
  ): {
    ratio: number;
    adjustment: number;
    stretch: number;
    shrink: number;
    totalWidth: number;
  } {
    let totalWidth = 0;
    let totalStretch = 0;
    let totalShrink = 0;

    if (cumulativeWidths) {
      // Fast path: use cumulative widths
      totalWidth =
        cumulativeWidths.widths[lineEnd] - cumulativeWidths.widths[lineStart];
      totalStretch =
        cumulativeWidths.stretches[lineEnd] -
        cumulativeWidths.stretches[lineStart];
      totalShrink =
        cumulativeWidths.shrinks[lineEnd] - cumulativeWidths.shrinks[lineStart];

      for (let i = lineStart; i < lineEnd; i++) {
        const item = items[i];
        if (item.type === ItemType.PENALTY) {
          totalWidth -= item.width; // Subtract penalty widths
        }
      }
    } else {
      // Fallback: compute from scratch
      for (let i = lineStart; i < lineEnd; i++) {
        const item = items[i];

        // Penalties never contribute width (they're just break points)
        if (item.type === ItemType.PENALTY) {
          continue;
        }

        totalWidth += item.width;

        if (item.type === ItemType.GLUE) {
          totalStretch += (item as Glue).stretch;
          totalShrink += (item as Glue).shrink;
        }
      }
    }

    if (
      lineEnd < items.length &&
      (items[lineEnd].type === ItemType.PENALTY ||
        items[lineEnd].type === ItemType.DISCRETIONARY)
    ) {
      totalWidth +=
        items[lineEnd].type === ItemType.PENALTY
          ? items[lineEnd].width
          : (items[lineEnd] as Discretionary).preBreakWidth;
    }

    const adjustment = lineWidth - totalWidth;

    let ratio;
    if (adjustment > 0 && totalStretch > 0) {
      ratio = adjustment / totalStretch;
    } else if (adjustment < 0 && totalShrink > 0) {
      ratio = adjustment / totalShrink;
    } else if (adjustment === 0) {
      ratio = 0;
    } else {
      ratio = adjustment > 0 ? 3 : -1;
    }

    return {
      ratio,
      adjustment,
      stretch: totalStretch,
      shrink: totalShrink,
      totalWidth
    };
  }

  private static computeFitnessClass(
    badness: number,
    stretching: boolean
  ): FitnessClass {
    // TeX fitness classification based on badness (tex.web lines 16799-16803, 16810-16813)
    if (stretching) {
      // Stretching: decent_fit (0-12), loose_fit (13-99), very_loose_fit (100+)
      if (badness <= FITNESS_TIGHT_THRESHOLD) return FitnessClass.NORMAL;
      if (badness <= FITNESS_NORMAL_THRESHOLD) return FitnessClass.LOOSE;
      return FitnessClass.VERY_LOOSE;
    } else {
      // Shrinking: decent_fit (0-12), tight_fit (13+)
      if (badness <= FITNESS_TIGHT_THRESHOLD) return FitnessClass.NORMAL;
      return FitnessClass.TIGHT;
    }
  }

  // Pre-compute cumulative arrays for width, stretch, shrink, and minimum width
  private static computeCumulativeWidths(items: Item[]): {
    widths: number[];
    stretches: number[];
    shrinks: number[];
    minWidths: number[];
  } {
    const n = items.length + 1;
    const widths = new Array(n);
    const stretches = new Array(n);
    const shrinks = new Array(n);
    const minWidths = new Array(n);

    widths[0] = 0;
    stretches[0] = 0;
    shrinks[0] = 0;
    minWidths[0] = 0;

    for (let i = 0; i < items.length; i++) {
      const item = items[i];

      widths[i + 1] = widths[i] + item.width;

      if (item.type === ItemType.PENALTY) {
        minWidths[i + 1] = minWidths[i];
      } else if (item.type === ItemType.GLUE) {
        const glue = item as Glue;
        stretches[i + 1] = stretches[i] + glue.stretch;
        shrinks[i + 1] = shrinks[i] + glue.shrink;
        minWidths[i + 1] = minWidths[i] + Math.max(0, glue.width - glue.shrink);
      } else {
        stretches[i + 1] = stretches[i];
        shrinks[i + 1] = shrinks[i];
        minWidths[i + 1] = minWidths[i] + item.width;
      }
    }

    return { widths, stretches, shrinks, minWidths };
  }

  // Deactivate nodes that can't lead to good line breaks
  // TeX recalculates minWidth each time, we use cumulative arrays for lookup
  private static deactivateNodes(
    activeNodeList: ActiveNodeList,
    currentPosition: number,
    lineWidth: number,
    minWidths: number[]
  ): void {
    const activeNodes = activeNodeList.getAllActive();

    for (let i = activeNodes.length - 1; i >= 0; i--) {
      const node = activeNodes[i];

      if (!node.active) continue;

      const minWidth = minWidths[currentPosition] - minWidths[node.position];

      if (minWidth > lineWidth) {
        activeNodeList.deactivateNode(node);
      }
    }
  }

  // Create LineInfo objects from the breakpoints
  private static createLines(
    text: string,
    items: Item[],
    breakpoints: number[],
    lineWidth: number,
    align: TextAlign,
    direction: TextDirection,
    cumulativeWidths?: {
      widths: number[];
      stretches: number[];
      shrinks: number[];
      minWidths: number[];
    },
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
      // Final line created separately if content remains after last breakpoint
      const willHaveFinalLine =
        breakpoints[breakpoints.length - 1] + 1 < items.length - 1;
      const isLastLine = willHaveFinalLine
        ? false
        : i === breakpoints.length - 1;

      const lineTextParts: string[] = [];
      let originalStart = -1;
      let originalEnd = -1;
      let naturalWidth = 0;

      for (let j = lineStart; j < breakpoint; j++) {
        const item = items[j];

        // Skip penalties and discretionaries with no display text (potential break positions only)
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
          if (disc.noBreak) {
            lineTextParts.push(disc.noBreak);
          }
        }

        naturalWidth += item.width;
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

          if (breakItem.originIndex !== undefined) {
            originalEnd = breakItem.originIndex - 1;
          }
        } else if (breakItem.type === ItemType.DISCRETIONARY) {
          const disc = breakItem as Discretionary;
          if (disc.preBreak) {
            lineTextParts.push(disc.preBreak);
            naturalWidth += disc.preBreakWidth;
            endedWithHyphen = disc.flagged || false;

            if (breakItem.originIndex !== undefined) {
              originalEnd = breakItem.originIndex - 1;
            }
          }
        }
      }

      const lineText = lineTextParts.join('');

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
        const adjustmentData = LineBreak.computeAdjustmentRatio(
          items,
          lineStart,
          breakpoint,
          i,
          lineWidth,
          cumulativeWidths,
          context
        );
        adjustmentRatio = adjustmentData.ratio;
      }

      lines.push({
        text: lineText,
        originalStart,
        originalEnd,
        xOffset,
        adjustmentRatio,
        isLastLine: false,
        naturalWidth: naturalWidth,
        endedWithHyphen: endedWithHyphen
      });

      lineStart = breakpoint + 1;
    }

    if (lineStart < items.length - 1) {
      const finalLineTextParts: string[] = [];
      let finalOriginalStart = -1;
      let finalOriginalEnd = -1;
      let finalNaturalWidth = 0;

      for (let j = lineStart; j < items.length - 1; j++) {
        const item = items[j];

        if (item.type === ItemType.PENALTY) {
          continue;
        }

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

        if (item.text) {
          finalLineTextParts.push(item.text);
        }

        finalNaturalWidth += item.width;
      }

      const finalLineText = finalLineTextParts.join('');

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
        text: finalLineText,
        originalStart: finalOriginalStart,
        originalEnd: finalOriginalEnd,
        xOffset: finalXOffset,
        adjustmentRatio: 0, // Last line has no adjustment
        isLastLine: true,
        naturalWidth: finalNaturalWidth,
        endedWithHyphen: false
      });

      if (lines.length > 1) {
        lines[lines.length - 2].isLastLine = false;
      }
      lines[lines.length - 1].isLastLine = true;
    } else if (lines.length > 0) {
      lines[lines.length - 1].isLastLine = true;
    }

    return lines;
  }
}
