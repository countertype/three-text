import { LineBreak } from './LineBreak';
import { TextMeasurer } from '../shaping/TextMeasurer';
import { LineInfo, TextAlign, LoadedFont, LayoutOptions } from '../types';

export interface TextLayoutOptions extends LayoutOptions {
  text: string;
  letterSpacing: number;
}

export interface LayoutResult {
  lines: LineInfo[];
}

export interface AlignmentOptions {
  width?: number;
  align: TextAlign;
  planeBounds: {
    min: { x: number; y: number; z: number };
    max: { x: number; y: number; z: number };
  };
}

export class TextLayout {
  private loadedFont: LoadedFont;

  constructor(loadedFont: LoadedFont) {
    this.loadedFont = loadedFont;
  }

  public computeLines(options: TextLayoutOptions): LayoutResult {
    const {
      text,
      width,
      align,
      direction,
      hyphenate,
      language,
      respectExistingBreaks,
      tolerance,
      pretolerance,
      emergencyStretch,
      autoEmergencyStretch,
      hyphenationPatterns,
      lefthyphenmin,
      righthyphenmin,
      linepenalty,
      adjdemerits,
      hyphenpenalty,
      exhyphenpenalty,
      doublehyphendemerits,
      letterSpacing
    } = options;

    let lines: LineInfo[];

    if (width) {
      // Each measurement is a HarfBuzz shape round-trip and strings repeat
      // heavily; font and letterSpacing are fixed for this call
      const widthMemo = new Map<string, number>();

      // Line breaking uses a measureText function that already includes letterSpacing,
      // so widths passed into LineBreak.breakText account for tracking
      lines = LineBreak.breakText({
        text,
        width,
        align,
        direction,
        hyphenate,
        language,
        respectExistingBreaks,
        tolerance,
        pretolerance,
        emergencyStretch,
        autoEmergencyStretch,
        hyphenationPatterns,
        lefthyphenmin,
        righthyphenmin,
        linepenalty,
        adjdemerits,
        hyphenpenalty,
        exhyphenpenalty,
        doublehyphendemerits,
        unitsPerEm: this.loadedFont.upem,
        letterSpacing,
        measureText: (textToMeasure: string) => {
          let measured = widthMemo.get(textToMeasure);
          if (measured === undefined) {
            measured = TextMeasurer.measureTextWidth(
              this.loadedFont,
              textToMeasure,
              letterSpacing // Letter spacing included in width measurements
            );
            widthMemo.set(textToMeasure, measured);
          }
          return measured;
        },
        measureTextWidths: (textToMeasure: string) =>
          TextMeasurer.measureTextWidths(
            this.loadedFont,
            textToMeasure,
            letterSpacing
          )
      });
    } else {
      // No width specified, just split on newlines
      const linesArray = text.split('\n');
      lines = [];
      let currentIndex = 0;
      for (const line of linesArray) {
        const originalEnd =
          line.length === 0 ? currentIndex : currentIndex + line.length - 1;
        lines.push({
          text: line,
          originalStart: currentIndex,
          originalEnd,
          xOffset: 0
        });
        currentIndex += line.length + 1;
      }
    }

    return { lines };
  }

  public applyAlignment(
    vertices: Float32Array,
    options: AlignmentOptions
  ): {
    offset: number;
    adjustedBounds: {
      min: { x: number; y: number; z: number };
      max: { x: number; y: number; z: number };
    };
  } {
    const { offset, adjustedBounds } = this.computeAlignmentOffset(options);
    if (offset !== 0) {
      for (let i = 0; i < vertices.length; i += 3) {
        vertices[i] += offset;
      }
    }
    return { offset, adjustedBounds };
  }

  public computeAlignmentOffset(options: AlignmentOptions): {
    offset: number;
    adjustedBounds: {
      min: { x: number; y: number; z: number };
      max: { x: number; y: number; z: number };
    };
  } {
    const { width, align, planeBounds } = options;
    let offset = 0;

    const adjustedBounds = {
      min: { ...planeBounds.min },
      max: { ...planeBounds.max }
    };

    if (width && (align === 'center' || align === 'right')) {
      const lineWidth = planeBounds.max.x - planeBounds.min.x;
      if (align === 'center') {
        offset = (width - lineWidth) / 2 - planeBounds.min.x;
      } else {
        offset = width - planeBounds.max.x;
      }
    }

    if (offset !== 0) {
      adjustedBounds.min.x += offset;
      adjustedBounds.max.x += offset;
    }

    return { offset, adjustedBounds };
  }
}
