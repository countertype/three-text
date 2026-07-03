import { Text as TextCore } from '../../core/Text';
import { GlyphOutlineCollector } from '../GlyphOutlineCollector';
import { globalOutlineCache } from '../../core/cache/sharedCaches';
import { Cache } from '../../utils/Cache';
import {
  getSharedDrawCallbackHandler,
  DrawCallbackHandler
} from '../../core/shaping/DrawCallbacks';
import type {
  TextOptions,
  TextLayoutHandle,
  GlyphCluster,
  GlyphOutline,
  VectorGlyphInfo,
  LoadedFont,
  TextQueryOptions,
  TextRange
} from '../../core/types';
import type { BoundingBox } from '../../utils/vectors';
import type { QuadCurve, SlugShape, SlugGPUData } from '../slug/types';
import { packSlugData } from '../slug/SlugPacker';
import { cubicToQuadratics } from '../slug/curveUtils';
import { TextRangeQuery } from '../../core/layout/TextRangeQuery';
import type { HyphenationTrieNode } from '../../hyphenation';

export interface VectorTextResult {
  gpuData: SlugGPUData;
  glyphs: VectorGlyphInfo[];
  planeBounds: BoundingBox;
  query(options: TextQueryOptions): TextRange[];
  getLoadedFont(): LoadedFont | undefined;
  measureTextWidth(text: string, letterSpacing?: number): number;
  update(options: Partial<TextOptions>): Promise<VectorTextResult>;
  dispose(): void;
}

interface OutlineContext {
  loadedFont: LoadedFont;
  outlineCache: Cache<string, GlyphOutline>;
  drawCallbacks: DrawCallbackHandler;
  collector: GlyphOutlineCollector;
  cacheKeyPrefix: string;
  emptyGlyphs: Set<number>;
}

function createOutlineContext(
  loadedFont: LoadedFont,
  fontId: string,
  cache: Cache<string, GlyphOutline> = globalOutlineCache
): OutlineContext {
  const collector = new GlyphOutlineCollector();
  const drawCallbacks = getSharedDrawCallbackHandler(loadedFont);
  drawCallbacks.createDrawFuncs(loadedFont, collector);
  return {
    loadedFont,
    outlineCache: cache,
    drawCallbacks,
    collector,
    cacheKeyPrefix: `${fontId}__outline`,
    emptyGlyphs: new Set(),
  };
}

function getOutlineForGlyph(ctx: OutlineContext, glyphId: number): GlyphOutline {
  if (ctx.emptyGlyphs.has(glyphId)) {
    return {
      glyphId,
      textIndex: 0,
      segments: [],
      bounds: { min: { x: 0, y: 0 }, max: { x: 0, y: 0 } }
    };
  }

  const key = `${ctx.cacheKeyPrefix}_${glyphId}`;
  const cached = ctx.outlineCache.get(key);
  if (cached) return cached;

  ctx.drawCallbacks.setCollector(ctx.collector);
  ctx.collector.reset();
  ctx.collector.beginGlyph(glyphId, 0);
  ctx.loadedFont.module.exports.hb_font_draw_glyph(
    ctx.loadedFont.font.ptr,
    glyphId,
    ctx.drawCallbacks.getDrawFuncsPtr(),
    0
  );
  ctx.collector.finishGlyph();
  const collected = ctx.collector.getCollectedGlyphs()[0];

  const outline =
    collected ?? {
      glyphId,
      textIndex: 0,
      segments: [],
      bounds: { min: { x: 0, y: 0 }, max: { x: 0, y: 0 } }
    };

  if (outline.segments.length === 0) {
    ctx.emptyGlyphs.add(glyphId);
  }

  ctx.outlineCache.set(key, outline);
  return outline;
}

function collectForSlug(
  ctx: OutlineContext,
  clustersByLine: GlyphCluster[][],
  scale: number
): { gpuData: SlugGPUData; glyphs: VectorGlyphInfo[]; planeBounds: BoundingBox } {
  const seen = new Set<number>();
  const outlinesByGlyph = new Map<number, GlyphOutline>();
  for (const line of clustersByLine) {
    for (const cluster of line) {
      for (const g of cluster.glyphs) {
        if (!seen.has(g.g)) {
          seen.add(g.g);
          outlinesByGlyph.set(g.g, getOutlineForGlyph(ctx, g.g));
        }
      }
    }
  }

  const shapes: SlugShape[] = [];
  const glyphInfos: VectorGlyphInfo[] = [];

  // Curves are built once per unique glyph id; the packer dedups texel data
  // by shape key, so repeat instances only carry their own bounds/quad.
  // (Shapes sharing a key must be translation-equivalent, which holds here:
  // same outline, same scale, differing only in px/py.)
  const curvesByGlyph = new Map<number, QuadCurve[]>();

  for (const line of clustersByLine) {
    for (const cluster of line) {
      for (const g of cluster.glyphs) {
        const outline = outlinesByGlyph.get(g.g);
        if (!outline || outline.segments.length === 0) continue;

        const px = (cluster.position.x + (g.x ?? 0)) * scale;
        const py = (cluster.position.y + (g.y ?? 0)) * scale;

        let curves = curvesByGlyph.get(g.g);
        if (curves === undefined) {
          curves = [];
          for (const seg of outline.segments) {
            switch (seg.type) {
              // line to quadratic
              case 0: {
                const x0 = seg.p0.x * scale + px, y0 = seg.p0.y * scale + py;
                const x1 = seg.p1.x * scale + px, y1 = seg.p1.y * scale + py;
                curves.push({
                  p1: [x0, y0],
                  p2: [(x0 + x1) * 0.5, (y0 + y1) * 0.5],
                  p3: [x1, y1],
                });
                break;
              }
              // quadratic
              case 1:
                curves.push({
                  p1: [seg.p0.x * scale + px, seg.p0.y * scale + py],
                  p2: [seg.p1.x * scale + px, seg.p1.y * scale + py],
                  p3: [seg.p2!.x * scale + px, seg.p2!.y * scale + py],
                });
                break;
              // cubic to quadratic
              case 2: {
                const quads = cubicToQuadratics(
                  [seg.p0.x, seg.p0.y],
                  [seg.p1.x, seg.p1.y],
                  [seg.p2!.x, seg.p2!.y],
                  [seg.p3!.x, seg.p3!.y]
                );
                for (const q of quads) {
                  curves.push({
                    p1: [q.p1[0] * scale + px, q.p1[1] * scale + py],
                    p2: [q.p2[0] * scale + px, q.p2[1] * scale + py],
                    p3: [q.p3[0] * scale + px, q.p3[1] * scale + py],
                  });
                }
                break;
              }
            }
          }
          curvesByGlyph.set(g.g, curves);
        }

        const bounds: [number, number, number, number] = [
          outline.bounds.min.x * scale + px,
          outline.bounds.min.y * scale + py,
          outline.bounds.max.x * scale + px,
          outline.bounds.max.y * scale + py,
        ];

        glyphInfos.push({
          textIndex: g.absoluteTextIndex,
          lineIndex: g.lineIndex,
          vertexStart: 0,
          vertexCount: 0,
          segmentStart: 0,
          segmentCount: outline.segments.length,
          bounds: {
            min: { x: bounds[0], y: bounds[1], z: 0 },
            max: { x: bounds[2], y: bounds[3], z: 0 },
          },
        });

        shapes.push({ curves, bounds, key: g.g });
      }
    }
  }

  const gpuData = packSlugData(shapes);
  const planeBounds = computePlaneBounds(glyphInfos);
  return { gpuData, glyphs: glyphInfos, planeBounds };
}

function computePlaneBounds(glyphInfos: VectorGlyphInfo[]): BoundingBox {
  if (glyphInfos.length === 0) {
    return { min: { x: 0, y: 0, z: 0 }, max: { x: 0, y: 0, z: 0 } };
  }
  let minX = Infinity, minY = Infinity;
  let maxX = -Infinity, maxY = -Infinity;
  for (const g of glyphInfos) {
    if (g.bounds.min.x < minX) minX = g.bounds.min.x;
    if (g.bounds.min.y < minY) minY = g.bounds.min.y;
    if (g.bounds.max.x > maxX) maxX = g.bounds.max.x;
    if (g.bounds.max.y > maxY) maxY = g.bounds.max.y;
  }
  return { min: { x: minX, y: minY, z: 0 }, max: { x: maxX, y: maxY, z: 0 } };
}

function buildVectorResult(
  layoutHandle: TextLayoutHandle,
  ctx: OutlineContext,
  options: TextOptions
): VectorTextResult {
  const scale = layoutHandle.layoutData.pixelsPerFontUnit;

  let cachedQuery: TextRangeQuery | null = null;

  const update = async (newOptions: Partial<TextOptions>): Promise<VectorTextResult> => {
    const mergedOptions: TextOptions = { ...options };
    for (const key in newOptions) {
      const value = newOptions[key as keyof TextOptions];
      if (value !== undefined) {
        (mergedOptions as any)[key] = value;
      }
    }

    if (
      newOptions.font !== undefined ||
      newOptions.fontVariations !== undefined ||
      newOptions.fontFeatures !== undefined
    ) {
      const newLayout = await layoutHandle.update(mergedOptions);
      const newCtx = createOutlineContext(
        newLayout.loadedFont,
        newLayout.fontId,
        globalOutlineCache
      );
      layoutHandle = newLayout;
      options = mergedOptions;
      return buildVectorResult(layoutHandle, newCtx, options);
    }

    const newLayout = await layoutHandle.update(mergedOptions);
    layoutHandle = newLayout;
    options = mergedOptions;
    return buildVectorResult(layoutHandle, ctx, options);
  };

  const { gpuData, glyphs, planeBounds } =
    collectForSlug(ctx, layoutHandle.clustersByLine, scale);

  return {
    gpuData,
    glyphs,
    planeBounds,
    query: (queryOptions: TextQueryOptions): TextRange[] => {
      if (!cachedQuery) {
        cachedQuery = new TextRangeQuery(options.text, glyphs);
      }
      return cachedQuery.execute(queryOptions);
    },
    getLoadedFont: () => layoutHandle.getLoadedFont(),
    measureTextWidth: (text: string, letterSpacing?: number) =>
      layoutHandle.measureTextWidth(text, letterSpacing),
    update,
    dispose: () => {
      layoutHandle.dispose();
    }
  };
}

export class Text {
  static setHarfBuzzPath = TextCore.setHarfBuzzPath;
  static setHarfBuzzBuffer = TextCore.setHarfBuzzBuffer;
  static init = TextCore.init;
  static registerPattern = TextCore.registerPattern;
  static preloadPatterns = TextCore.preloadPatterns;
  static setMaxFontCacheMemoryMB = TextCore.setMaxFontCacheMemoryMB;
  static enableWoff2 = TextCore.enableWoff2;

  static async create(options: TextOptions): Promise<VectorTextResult> {
    const layoutHandle = await TextCore.create(options);
    const ctx = createOutlineContext(
      layoutHandle.loadedFont,
      layoutHandle.fontId,
      globalOutlineCache
    );
    return buildVectorResult(layoutHandle, ctx, options);
  }
}

export type {
  TextOptions,
  VectorTextResult as TextGeometryInfo,
  VectorGlyphInfo,
  LoadedFont
};
export type { HyphenationTrieNode };
export type { SlugGPUData } from '../slug/types';
