import type {
  TextOptions,
  GlyphGeometryInfo,
  TextGeometryInfo,
  TextLayoutResult,
  ColorOptions,
  ColoredRange,
  TextQueryOptions,
  GlyphCluster
} from '../core/types';
import { GlyphGeometryBuilder } from './GlyphGeometryBuilder';
import { globalGlyphCache } from '../core/cache/sharedCaches';
import { TextLayout } from '../core/layout/TextLayout';
import { TextRangeQuery } from '../core/layout/TextRangeQuery';
import { perfLogger } from '../utils/PerformanceLogger';
import type { LoadedFont } from '../core/types';

export class MeshGeometryBuilder {
  private geometryBuilder?: GlyphGeometryBuilder;
  private textLayout?: TextLayout;
  private loadedFont: LoadedFont;
  private fontId: string;

  constructor(loadedFont: LoadedFont, fontId: string) {
    this.loadedFont = loadedFont;
    this.fontId = fontId;
  }

  setFont(loadedFont: LoadedFont, fontId: string): void {
    this.loadedFont = loadedFont;
    this.fontId = fontId;
    this.geometryBuilder = undefined;
  }

  build(layout: TextLayoutResult, options: TextOptions): TextGeometryInfo {
    perfLogger.start('MeshGeometryBuilder.build', {
      textLength: options.text.length
    });

    try {
      if (!this.geometryBuilder) {
        this.geometryBuilder = new GlyphGeometryBuilder(
          globalGlyphCache,
          this.loadedFont
        );
        this.geometryBuilder.setFontId(this.fontId);
      }

      const useCurveSteps =
        options.curveSteps !== undefined &&
        options.curveSteps !== null &&
        options.curveSteps > 0;
      this.geometryBuilder.setCurveSteps(options.curveSteps);
      this.geometryBuilder.setCurveFidelityConfig(
        useCurveSteps ? undefined : options.curveFidelity
      );
      this.geometryBuilder.setGeometryOptimization(
        options.geometryOptimization
      );

      const shouldRemoveOverlaps: boolean =
        options.removeOverlaps ?? this.loadedFont.isVariable ?? false;

      let coloredTextIndices: Set<number> | undefined;
      let byTextMatches:
        | { pattern: string; start: number; end: number }[]
        | undefined;
      if (
        options.color &&
        typeof options.color === 'object' &&
        !Array.isArray(options.color)
      ) {
        if (options.color.byText || options.color.byCharRange) {
          coloredTextIndices = new Set<number>();
          if (options.color.byText) {
            byTextMatches = [];
            for (const pattern of Object.keys(options.color.byText)) {
              let index = 0;
              while ((index = options.text.indexOf(pattern, index)) !== -1) {
                byTextMatches.push({
                  pattern,
                  start: index,
                  end: index + pattern.length
                });
                for (let i = index; i < index + pattern.length; i++) {
                  coloredTextIndices.add(i);
                }
                index += pattern.length;
              }
            }
          }
          if (options.color.byCharRange) {
            for (const range of options.color.byCharRange) {
              for (let i = range.start; i < range.end; i++) {
                coloredTextIndices.add(i);
              }
            }
          }
        }
      }

      const shapedResult = this.geometryBuilder.buildInstancedGeometry(
        layout.clustersByLine,
        layout.layoutData.depth,
        shouldRemoveOverlaps,
        this.loadedFont.metrics.isCFF,
        layout.layoutData.pixelsPerFontUnit,
        options.perGlyphAttributes ?? false,
        coloredTextIndices
      );

      const result = this.finalizeGeometry(
        shapedResult.vertices,
        shapedResult.normals,
        shapedResult.indices,
        shapedResult.glyphInfos,
        shapedResult.planeBounds,
        options,
        options.text,
        byTextMatches
      );

      if (options.perGlyphAttributes) {
        const glyphAttrs = this.createGlyphAttributes(
          result.vertices.length / 3,
          result.glyphs
        );
        result.glyphAttributes = glyphAttrs;
      }

      return result;
    } finally {
      perfLogger.end('MeshGeometryBuilder.build');
    }
  }

  getCacheSize(): number {
    return this.geometryBuilder?.getCacheStats().size ?? 0;
  }

  clearCache(): void {
    this.geometryBuilder?.clearCache();
  }

  reset(): void {
    this.geometryBuilder = undefined;
    this.textLayout = undefined;
  }

  private finalizeGeometry(
    vertices: Float32Array,
    normals: Float32Array,
    indices: Uint32Array,
    glyphInfoArray: GlyphGeometryInfo[],
    planeBounds: {
      min: { x: number; y: number; z: number };
      max: { x: number; y: number; z: number };
    },
    options: TextOptions,
    originalText?: string,
    byTextMatches?: { pattern: string; start: number; end: number }[]
  ): TextGeometryInfo {
    const { layout = {} } = options;
    const { width, align = layout.direction === 'rtl' ? 'right' : 'left' } =
      layout;

    if (!this.textLayout) {
      this.textLayout = new TextLayout(this.loadedFont);
    }

    const alignmentResult = this.textLayout.computeAlignmentOffset({
      width,
      align,
      planeBounds
    });

    const offset = alignmentResult.offset;
    planeBounds.min.x = alignmentResult.adjustedBounds.min.x;
    planeBounds.max.x = alignmentResult.adjustedBounds.max.x;

    if (offset !== 0) {
      for (let i = 0; i < vertices.length; i += 3) {
        vertices[i] += offset;
      }
      for (let i = 0; i < glyphInfoArray.length; i++) {
        glyphInfoArray[i].bounds.min.x += offset;
        glyphInfoArray[i].bounds.max.x += offset;
      }
    }

    let colors: Float32Array | undefined;
    let coloredRanges: ColoredRange[] | undefined;

    if (options.color) {
      const colorResult = this.applyColorSystem(
        vertices,
        glyphInfoArray,
        options.color,
        options.text,
        byTextMatches
      );
      colors = colorResult.colors;
      coloredRanges = colorResult.coloredRanges;
    }

    const optimizationStats = this.geometryBuilder!.getOptimizationStats();
    const trianglesGenerated = indices.length / 3;
    const verticesGenerated = vertices.length / 3;

    return {
      vertices,
      normals,
      indices,
      colors,
      glyphs: glyphInfoArray,
      planeBounds,
      stats: {
        trianglesGenerated,
        verticesGenerated,
        pointsRemovedByVisvalingam:
          optimizationStats.pointsRemovedByVisvalingam,
        originalPointCount: optimizationStats.originalPointCount
      },
      query: (() => {
        let cachedQuery: TextRangeQuery | null = null;
        return (queryOptions: TextQueryOptions) => {
          if (!originalText) {
            throw new Error('Original text not available for querying');
          }
          if (!cachedQuery) {
            cachedQuery = new TextRangeQuery(originalText, glyphInfoArray);
          }
          return cachedQuery.execute(queryOptions);
        };
      })(),
      coloredRanges,
      glyphAttributes: undefined
    };
  }

  private applyColorSystem(
    vertices: Float32Array,
    glyphInfoArray: GlyphGeometryInfo[],
    color: [number, number, number] | ColorOptions,
    originalText: string,
    byTextMatches?: { pattern: string; start: number; end: number }[]
  ): { colors: Float32Array; coloredRanges: ColoredRange[] } {
    const vertexCount = vertices.length / 3;
    const colors = new Float32Array(vertexCount * 3);
    const coloredRanges: ColoredRange[] = [];

    if (Array.isArray(color)) {
      for (let i = 0; i < vertexCount; i++) {
        const baseIndex = i * 3;
        colors[baseIndex] = color[0];
        colors[baseIndex + 1] = color[1];
        colors[baseIndex + 2] = color[2];
      }

      coloredRanges.push({
        start: 0,
        end: originalText.length,
        originalText,
        color,
        bounds: [],
        glyphs: glyphInfoArray,
        lineIndices: [...new Set(glyphInfoArray.map((g) => g.lineIndex))]
      });
    } else {
      const defaultColor = color.default || [1, 1, 1];

      for (let i = 0; i < colors.length; i += 3) {
        colors[i] = defaultColor[0];
        colors[i + 1] = defaultColor[1];
        colors[i + 2] = defaultColor[2];
      }

      let glyphsByTextIndex: Map<number, GlyphGeometryInfo[]> | undefined;
      if ((color.byText && byTextMatches) || color.byCharRange) {
        glyphsByTextIndex = new Map();
        for (const glyph of glyphInfoArray) {
          const existing = glyphsByTextIndex.get(glyph.textIndex);
          if (existing) {
            existing.push(glyph);
          } else {
            glyphsByTextIndex.set(glyph.textIndex, [glyph]);
          }
        }
      }

      if (color.byText && byTextMatches && glyphsByTextIndex) {
        for (const match of byTextMatches) {
          const targetColor = color.byText[match.pattern];
          if (!targetColor) continue;

          const matchGlyphs: GlyphGeometryInfo[] = [];
          const lineGroups = new Map<number, GlyphGeometryInfo[]>();

          for (let i = match.start; i < match.end; i++) {
            const glyphs = glyphsByTextIndex.get(i);
            if (glyphs) {
              for (const glyph of glyphs) {
                matchGlyphs.push(glyph);
                const lineGlyphs = lineGroups.get(glyph.lineIndex);
                if (lineGlyphs) {
                  lineGlyphs.push(glyph);
                } else {
                  lineGroups.set(glyph.lineIndex, [glyph]);
                }
                for (let v = 0; v < glyph.vertexCount; v++) {
                  const vertexIndex = (glyph.vertexStart + v) * 3;
                  if (vertexIndex >= 0 && vertexIndex < colors.length) {
                    colors[vertexIndex] = targetColor[0];
                    colors[vertexIndex + 1] = targetColor[1];
                    colors[vertexIndex + 2] = targetColor[2];
                  }
                }
              }
            }
          }

          const bounds = Array.from(lineGroups.values()).map((lineGlyphs) =>
            this.calculateGlyphBounds(lineGlyphs)
          );

          coloredRanges.push({
            start: match.start,
            end: match.end,
            originalText: match.pattern,
            color: targetColor,
            bounds,
            glyphs: matchGlyphs,
            lineIndices: Array.from(lineGroups.keys()).sort((a, b) => a - b)
          });
        }
      }

      if (color.byCharRange && glyphsByTextIndex) {
        for (const range of color.byCharRange) {
          const rangeGlyphs: GlyphGeometryInfo[] = [];
          const lineGroups = new Map<number, GlyphGeometryInfo[]>();

          for (let i = range.start; i < range.end; i++) {
            const glyphs = glyphsByTextIndex.get(i);
            if (glyphs) {
              for (const glyph of glyphs) {
                rangeGlyphs.push(glyph);
                const lineGlyphs = lineGroups.get(glyph.lineIndex);
                if (lineGlyphs) {
                  lineGlyphs.push(glyph);
                } else {
                  lineGroups.set(glyph.lineIndex, [glyph]);
                }
                for (let v = 0; v < glyph.vertexCount; v++) {
                  const vertexIndex = (glyph.vertexStart + v) * 3;
                  if (vertexIndex >= 0 && vertexIndex < colors.length) {
                    colors[vertexIndex] = range.color[0];
                    colors[vertexIndex + 1] = range.color[1];
                    colors[vertexIndex + 2] = range.color[2];
                  }
                }
              }
            }
          }

          const bounds = Array.from(lineGroups.values()).map((lineGlyphs) =>
            this.calculateGlyphBounds(lineGlyphs)
          );

          coloredRanges.push({
            start: range.start,
            end: range.end,
            originalText: originalText.slice(range.start, range.end),
            color: range.color,
            bounds,
            glyphs: rangeGlyphs,
            lineIndices: Array.from(lineGroups.keys()).sort((a, b) => a - b)
          });
        }
      }
    }

    return { colors, coloredRanges };
  }

  private calculateGlyphBounds(glyphs: GlyphGeometryInfo[]): {
    min: { x: number; y: number; z: number };
    max: { x: number; y: number; z: number };
  } {
    if (glyphs.length === 0) {
      return {
        min: { x: 0, y: 0, z: 0 },
        max: { x: 0, y: 0, z: 0 }
      };
    }

    let minX = Infinity,
      minY = Infinity,
      minZ = Infinity;
    let maxX = -Infinity,
      maxY = -Infinity,
      maxZ = -Infinity;

    for (const glyph of glyphs) {
      if (glyph.bounds.min.x < minX) minX = glyph.bounds.min.x;
      if (glyph.bounds.min.y < minY) minY = glyph.bounds.min.y;
      if (glyph.bounds.min.z < minZ) minZ = glyph.bounds.min.z;
      if (glyph.bounds.max.x > maxX) maxX = glyph.bounds.max.x;
      if (glyph.bounds.max.y > maxY) maxY = glyph.bounds.max.y;
      if (glyph.bounds.max.z > maxZ) maxZ = glyph.bounds.max.z;
    }

    return {
      min: { x: minX, y: minY, z: minZ },
      max: { x: maxX, y: maxY, z: maxZ }
    };
  }

  private createGlyphAttributes(
    vertexCount: number,
    glyphs: GlyphGeometryInfo[]
  ): {
    glyphCenter: Float32Array;
    glyphIndex: Float32Array;
    glyphLineIndex: Float32Array;
    glyphProgress: Float32Array;
    glyphBaselineY: Float32Array;
  } {
    const glyphCenters = new Float32Array(vertexCount * 3);
    const glyphIndices = new Float32Array(vertexCount);
    const glyphLineIndices = new Float32Array(vertexCount);
    const glyphProgress = new Float32Array(vertexCount);
    const glyphBaselineY = new Float32Array(vertexCount);

    let minX = Infinity;
    let maxX = -Infinity;
    for (let i = 0; i < glyphs.length; i++) {
      const cx = (glyphs[i].bounds.min.x + glyphs[i].bounds.max.x) / 2;
      if (cx < minX) minX = cx;
      if (cx > maxX) maxX = cx;
    }
    const range = maxX - minX;

    for (let index = 0; index < glyphs.length; index++) {
      const glyph = glyphs[index];
      const centerX = (glyph.bounds.min.x + glyph.bounds.max.x) / 2;
      const centerY = (glyph.bounds.min.y + glyph.bounds.max.y) / 2;
      const centerZ = (glyph.bounds.min.z + glyph.bounds.max.z) / 2;
      const baselineY = glyph.bounds.min.y;
      const progress = range > 0 ? (centerX - minX) / range : 0;

      const start = glyph.vertexStart;
      const end = Math.min(start + glyph.vertexCount, vertexCount);
      if (end <= start) continue;

      glyphIndices.fill(index, start, end);
      glyphLineIndices.fill(glyph.lineIndex, start, end);
      glyphProgress.fill(progress, start, end);
      glyphBaselineY.fill(baselineY, start, end);

      for (let v = start * 3; v < end * 3; v += 3) {
        glyphCenters[v] = centerX;
        glyphCenters[v + 1] = centerY;
        glyphCenters[v + 2] = centerZ;
      }
    }

    return {
      glyphCenter: glyphCenters,
      glyphIndex: glyphIndices,
      glyphLineIndex: glyphLineIndices,
      glyphProgress,
      glyphBaselineY
    };
  }
}
