import { Vec3 } from '../../utils/vectors';
import {
  LoadedFont,
  GlyphGeometryInfo,
  LineInfo,
  TextDirection,
  HarfBuzzGlyph,
  GlyphCluster,
  ColorOptions
} from '../types';
import { TextMeasurer } from './TextMeasurer';
import { perfLogger } from '../../utils/PerformanceLogger';
import { SPACE_STRETCH_RATIO, SPACE_SHRINK_RATIO } from '../layout/constants';
import { convertFontFeaturesToString } from './fontFeatures';
import { LineBreak } from '../layout/LineBreak';

export interface ShapedResult {
  geometry: any;
  glyphInfos: GlyphGeometryInfo[];
  planeBounds: {
    min: { x: number; y: number; z: number };
    max: { x: number; y: number; z: number };
  };
  cacheStats?: {
    hits: number;
    misses: number;
    hitRate: number;
  };
}

export class TextShaper {
  private loadedFont: LoadedFont;
  private cachedSpaceWidth: Map<number, number> = new Map();

  constructor(loadedFont: LoadedFont) {
    this.loadedFont = loadedFont;
  }

  public shapeLines(
    lineInfos: LineInfo[],
    scaledLineHeight: number,
    letterSpacing: number,
    align: string,
    direction: TextDirection,
    color?: [number, number, number] | ColorOptions,
    originalText?: string
  ): GlyphCluster[][] {
    perfLogger.start('TextShaper.shapeLines', {
      lineCount: lineInfos.length
    });
    try {
      const clustersByLine: GlyphCluster[][] = [];

      lineInfos.forEach((lineInfo, lineIndex) => {
        const clusters = this.shapeLineIntoClusters(
          lineInfo,
          lineIndex,
          scaledLineHeight,
          letterSpacing,
          align,
          direction
        );
        clustersByLine.push(clusters);
      });
      return clustersByLine;
    } finally {
      perfLogger.end('TextShaper.shapeLines');
    }
  }

  private shapeLineIntoClusters(
    lineInfo: LineInfo,
    lineIndex: number,
    scaledLineHeight: number,
    letterSpacing: number,
    align: string,
    direction: TextDirection
  ): GlyphCluster[] {
    const buffer = this.loadedFont.hb.createBuffer();
    if (direction === 'rtl') {
      buffer.setDirection('rtl');
    }

    buffer.addText(lineInfo.text);
    buffer.guessSegmentProperties();

    const featuresString = convertFontFeaturesToString(
      this.loadedFont.fontFeatures
    );
    this.loadedFont.hb.shape(this.loadedFont.font, buffer, featuresString);

    const glyphInfos: HarfBuzzGlyph[] = buffer.json(this.loadedFont.font);
    buffer.destroy();

    const clusters: GlyphCluster[] = [];
    let currentClusterGlyphs: HarfBuzzGlyph[] = [];
    let clusterTextChars: string[] = [];
    let clusterStartX = 0;
    let clusterStartY = 0;

    let cursorX = lineInfo.xOffset;
    let cursorY = -lineIndex * scaledLineHeight;
    const cursorZ = 0;
    // Apply letter spacing after each glyph to match width measurements used during line breaking
    const letterSpacingFU = letterSpacing * this.loadedFont.upem;

    const spaceAdjustment = this.calculateSpaceAdjustment(
      lineInfo,
      align,
      letterSpacing
    );

    const cjkAdjustment = this.calculateCJKAdjustment(lineInfo, align);
    const lineText = lineInfo.text;
    const lineTextLength = lineText.length;
    const glyphCount = glyphInfos.length;
    let nextCharIsCJK: boolean | undefined;

    for (let i = 0; i < glyphCount; i++) {
      const glyph = glyphInfos[i];
      const charIndex = glyph.cl;
      const char = lineText[charIndex];
      const charCode = char.charCodeAt(0);
      const isWhitespace =
        charCode === 32 || charCode === 9 || charCode === 10 || charCode === 13;

      // Inserted hyphens inherit the color of the last character in the word
      if (
        lineInfo.endedWithHyphen &&
        charIndex === lineTextLength - 1 &&
        char === '-'
      ) {
        glyph.absoluteTextIndex = lineInfo.originalEnd;
      } else {
        glyph.absoluteTextIndex = lineInfo.originalStart + charIndex;
      }

      glyph.lineIndex = lineIndex;

      // Cluster boundaries are based on whitespace only.
      // Coloring is applied later via vertex colors and must never affect shaping/kerning.
      if (isWhitespace) {
        if (currentClusterGlyphs.length > 0) {
          clusters.push({
            text: clusterTextChars.join(''),
            glyphs: currentClusterGlyphs,
            position: new Vec3(clusterStartX, clusterStartY, cursorZ)
          });
          currentClusterGlyphs = [];
          clusterTextChars = [];
        }
      }

      const absoluteGlyphX = cursorX + glyph.dx;
      const absoluteGlyphY = cursorY + glyph.dy;

      if (!isWhitespace) {
        if (currentClusterGlyphs.length === 0) {
          clusterStartX = absoluteGlyphX;
          clusterStartY = absoluteGlyphY;
        }
        glyph.x = absoluteGlyphX - clusterStartX;
        glyph.y = absoluteGlyphY - clusterStartY;
        currentClusterGlyphs.push(glyph);
        clusterTextChars.push(char);
      }

      cursorX += glyph.ax;
      cursorY += glyph.ay;

      if (letterSpacingFU !== 0 && i < glyphCount - 1) {
        cursorX += letterSpacingFU;
      }

      if (isWhitespace) {
        cursorX += spaceAdjustment;
      }

      // CJK glue adjustment (must match exactly where LineBreak adds glue)
      if (cjkAdjustment !== 0 && i < glyphCount - 1 && !isWhitespace) {
        const nextGlyph = glyphInfos[i + 1];
        const nextChar = lineText[nextGlyph.cl];
        const isCJK =
          nextCharIsCJK !== undefined ? nextCharIsCJK : LineBreak.isCJK(char);
        nextCharIsCJK = nextChar ? LineBreak.isCJK(nextChar) : false;

        if (isCJK && nextCharIsCJK) {
          let shouldApply = true;

          if (LineBreak.isCJClosingPunctuation(nextChar)) {
            shouldApply = false;
          }

          if (LineBreak.isCJOpeningPunctuation(char)) {
            shouldApply = false;
          }

          if (
            LineBreak.isCJPunctuation(char) &&
            LineBreak.isCJPunctuation(nextChar)
          ) {
            shouldApply = false;
          }

          if (shouldApply) {
            cursorX += cjkAdjustment;
          }
        }
      } else {
        nextCharIsCJK = undefined;
      }
    }

    if (currentClusterGlyphs.length > 0) {
      clusters.push({
        text: clusterTextChars.join(''),
        glyphs: currentClusterGlyphs,
        position: new Vec3(clusterStartX, clusterStartY, cursorZ)
      });
    }

    return clusters;
  }

  private calculateSpaceAdjustment(
    lineInfo: LineInfo,
    align: string,
    letterSpacing: number
  ): number {
    let spaceAdjustment = 0;

    if (
      lineInfo.adjustmentRatio !== undefined &&
      align === 'justify' &&
      !lineInfo.isLastLine
    ) {
      let naturalSpaceWidth = this.cachedSpaceWidth.get(letterSpacing);
      if (naturalSpaceWidth === undefined) {
        naturalSpaceWidth = TextMeasurer.measureTextWidth(
          this.loadedFont,
          ' ',
          letterSpacing
        );
        this.cachedSpaceWidth.set(letterSpacing, naturalSpaceWidth);
      }

      const width = naturalSpaceWidth!;
      const stretchFactor = SPACE_STRETCH_RATIO;
      const shrinkFactor = SPACE_SHRINK_RATIO;

      if (lineInfo.adjustmentRatio > 0) {
        spaceAdjustment = lineInfo.adjustmentRatio * width * stretchFactor;
      } else if (lineInfo.adjustmentRatio < 0) {
        spaceAdjustment = lineInfo.adjustmentRatio * width * shrinkFactor;
      }
    }

    return spaceAdjustment;
  }

  private calculateCJKAdjustment(lineInfo: LineInfo, align: string): number {
    if (
      lineInfo.adjustmentRatio === undefined ||
      align !== 'justify' ||
      lineInfo.isLastLine
    ) {
      return 0;
    }

    const baseCharWidth = this.loadedFont.upem;
    const glueStretch = baseCharWidth * 0.04;
    const glueShrink = baseCharWidth * 0.04;

    if (lineInfo.adjustmentRatio > 0) {
      return lineInfo.adjustmentRatio * glueStretch;
    } else if (lineInfo.adjustmentRatio < 0) {
      return lineInfo.adjustmentRatio * glueShrink;
    }

    return 0;
  }

}
