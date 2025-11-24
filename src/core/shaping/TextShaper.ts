import { Vec3 } from '../vectors';
import {
  LoadedFont,
  GlyphGeometryInfo,
  LineInfo,
  TextDirection,
  HarfBuzzGlyph,
  GlyphCluster,
  ColorOptions
} from '../types';
import { GlyphGeometryBuilder } from '../cache/GlyphGeometryBuilder';
import { TextMeasurer } from './TextMeasurer';
import { perfLogger } from '../../utils/PerformanceLogger';
import { SPACE_STRETCH_RATIO, SPACE_SHRINK_RATIO } from '../layout/constants';

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

// Shapes text with glyph caching
export class TextShaper {
  private loadedFont: LoadedFont;
  private geometryBuilder: GlyphGeometryBuilder;
  private cachedSpaceWidth: Map<number, number> = new Map();

  constructor(loadedFont: LoadedFont, geometryBuilder: GlyphGeometryBuilder) {
    this.loadedFont = loadedFont;
    this.geometryBuilder = geometryBuilder;
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

    // Calculate color boundaries once for the entire text before line processing
    const colorBoundaries = new Set<number>();
    if (
      color &&
      typeof color === 'object' &&
      'byText' in color &&
      color.byText &&
      originalText
    ) {
      for (const textToColor of Object.keys(color.byText)) {
        let index = 0;
        while ((index = originalText.indexOf(textToColor, index)) !== -1) {
          colorBoundaries.add(index);
          colorBoundaries.add(index + textToColor.length);
          index += textToColor.length;
        }
      }
    }

    const clustersByLine: GlyphCluster[][] = [];

    lineInfos.forEach((lineInfo, lineIndex) => {
      const clusters = this.shapeLineIntoClusters(
        lineInfo,
        lineIndex,
        scaledLineHeight,
        letterSpacing,
        align,
        direction,
        colorBoundaries
      );
      clustersByLine.push(clusters);
    });
    return clustersByLine;
  }

  private shapeLineIntoClusters(
    lineInfo: LineInfo,
    lineIndex: number,
    scaledLineHeight: number,
    letterSpacing: number,
    align: string,
    direction: TextDirection,
    colorBoundaries: Set<number>
  ): GlyphCluster[] {
    const buffer = this.loadedFont.hb.createBuffer();
    if (direction === 'rtl') {
      buffer.setDirection('rtl');
    }

    buffer.addText(lineInfo.text);
    buffer.guessSegmentProperties();
    this.loadedFont.hb.shape(this.loadedFont.font, buffer);
    const glyphInfos: HarfBuzzGlyph[] = buffer.json(this.loadedFont.font);
    buffer.destroy();

    const clusters: GlyphCluster[] = [];
    let currentClusterGlyphs: HarfBuzzGlyph[] = [];
    let currentClusterText = '';
    let clusterStartPosition = new Vec3();

    let cursor = new Vec3(
      lineInfo.xOffset,
      -lineIndex * scaledLineHeight,
      0
    );
    const letterSpacingFU = letterSpacing * this.loadedFont.upem;

    const spaceAdjustment = this.calculateSpaceAdjustment(
      lineInfo,
      align,
      letterSpacing
    );

    for (let i = 0; i < glyphInfos.length; i++) {
      const glyph = glyphInfos[i];
      const isWhitespace = /\s/.test(lineInfo.text[glyph.cl]);

      // Inserted hyphens inherit the color of the last character in the word
      if (
        lineInfo.endedWithHyphen &&
        glyph.cl === lineInfo.text.length - 1 &&
        lineInfo.text[glyph.cl] === '-'
      ) {
        glyph.absoluteTextIndex = lineInfo.originalEnd;
      } else {
        glyph.absoluteTextIndex = lineInfo.originalStart + glyph.cl;
      }

      glyph.lineIndex = lineIndex;

      const isBoundary = colorBoundaries.has(glyph.absoluteTextIndex);

      if (isWhitespace || isBoundary) {
        if (currentClusterGlyphs.length > 0) {
          clusters.push({
            text: currentClusterText,
            glyphs: currentClusterGlyphs,
            position: clusterStartPosition.clone()
          });
          currentClusterGlyphs = [];
          currentClusterText = '';
        }
      }

      const absoluteGlyphPosition = cursor
        .clone()
        .add(new Vec3(glyph.dx, glyph.dy, 0));

      if (!isWhitespace) {
        if (currentClusterGlyphs.length === 0) {
          clusterStartPosition.copy(absoluteGlyphPosition);
        }
        glyph.x = absoluteGlyphPosition.x - clusterStartPosition.x;
        glyph.y = absoluteGlyphPosition.y - clusterStartPosition.y;
        currentClusterGlyphs.push(glyph);
        currentClusterText += lineInfo.text[glyph.cl];
      }

      cursor.x += glyph.ax;
      cursor.y += glyph.ay;

      if (letterSpacingFU !== 0 && i < glyphInfos.length - 1) {
        cursor.x += letterSpacingFU;
      }

      if (isWhitespace) {
        cursor.x += spaceAdjustment;
      }
    }

    if (currentClusterGlyphs.length > 0) {
      clusters.push({
        text: currentClusterText,
        glyphs: currentClusterGlyphs,
        position: clusterStartPosition.clone()
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

      const stretchFactor = SPACE_STRETCH_RATIO;
      const shrinkFactor = SPACE_SHRINK_RATIO;

      if (lineInfo.adjustmentRatio > 0) {
        spaceAdjustment =
          lineInfo.adjustmentRatio * naturalSpaceWidth * stretchFactor;
      } else if (lineInfo.adjustmentRatio < 0) {
        spaceAdjustment =
          lineInfo.adjustmentRatio * naturalSpaceWidth * shrinkFactor;
      }
    }

    return spaceAdjustment;
  }

  public clearCache(): void {
    this.geometryBuilder.clearCache();
  }

  public getCacheStats() {
    return this.geometryBuilder.getCacheStats();
  }
}
