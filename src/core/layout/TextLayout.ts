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
      looseness,
      disableSingleWordDetection,
      letterSpacing
    } = options;

    let lines: LineInfo[];

    if (width) {
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
        looseness,
        disableSingleWordDetection,
        unitsPerEm: this.loadedFont.upem,
        measureText: (textToMeasure: string) =>
          TextMeasurer.measureTextWidth(
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
        lines.push({
          text: line,
          originalStart: currentIndex,
          originalEnd: currentIndex + line.length - 1,
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
      } else if (align === 'right') {
        offset = width - planeBounds.max.x;
      }

      if (offset !== 0) {
        // Translate vertices
        for (let i = 0; i < vertices.length; i += 3) {
          vertices[i] += offset;
        }

        adjustedBounds.min.x += offset;
        adjustedBounds.max.x += offset;
      }
    }

    return { offset, adjustedBounds };
  }
}
