import { Vec2 } from '../utils/vectors';
import type {
  GlyphCluster,
  LoadedFont,
  GlyphOutline,
  OutlineSegment,
  OutlineSegmentType,
  VectorGlyphInfo,
  VectorTextGeometryInfo,
  PackedFloatTexture
} from '../core/types';
import { Cache } from '../utils/Cache';
import { globalOutlineCache } from '../core/cache/sharedCaches';
import { GlyphOutlineCollector } from './GlyphOutlineCollector';
import {
  getSharedDrawCallbackHandler,
  DrawCallbackHandler
} from '../core/shaping/DrawCallbacks';

type SegmentRange = { start: number; count: number };

function ceilDiv(a: number, b: number): number {
  return Math.floor((a + b - 1) / b);
}

function createPackedTexture(
  texelCount: number,
  width: number
): PackedFloatTexture {
  const height = Math.max(1, ceilDiv(texelCount, width));
  return { width, height, data: new Float32Array(width * height * 4) };
}

type QuadSeg = {
  type: 1; // quadratic
  contourId: number;
  p0: Vec2;
  p1: Vec2;
  p2: Vec2;
};

// All cubic-to-quadratic work uses scalar x/y to avoid per-recursion
// Vec2 allocations. Only the final emitted QuadSegs create Vec2s.

function cubicToQuadraticsAdaptive(
  contourId: number,
  p0x: number, p0y: number,
  p1x: number, p1y: number,
  p2x: number, p2y: number,
  p3x: number, p3y: number,
  tol2: number,
  depth: number,
  out: QuadSeg[]
) {
  // Approximate quad control points
  const c0x = p0x + 0.75 * (p1x - p0x);
  const c0y = p0y + 0.75 * (p1y - p0y);
  const c1x = p3x + 0.75 * (p2x - p3x);
  const c1y = p3y + 0.75 * (p2y - p3y);
  const mx = (c0x + c1x) * 0.5;
  const my = (c0y + c1y) * 0.5;

  // Error: sample cubic vs piecewise quads at t=0.25, 0.5, 0.75
  let maxErr2 = 0;
  for (let si = 0; si < 3; si++) {
    const t = 0.25 + si * 0.25;
    const u = 1 - t;
    const uu = u * u;
    const uuu = uu * u;
    const tt = t * t;
    const ttt = tt * t;
    const cx = uuu * p0x + 3 * uu * t * p1x + 3 * u * tt * p2x + ttt * p3x;
    const cy = uuu * p0y + 3 * uu * t * p1y + 3 * u * tt * p2y + ttt * p3y;

    let qx: number, qy: number;
    if (t < 0.5) {
      const qt = t * 2;
      const qu = 1 - qt;
      qx = qu * qu * p0x + 2 * qu * qt * c0x + qt * qt * mx;
      qy = qu * qu * p0y + 2 * qu * qt * c0y + qt * qt * my;
    } else {
      const qt = (t - 0.5) * 2;
      const qu = 1 - qt;
      qx = qu * qu * mx + 2 * qu * qt * c1x + qt * qt * p3x;
      qy = qu * qu * my + 2 * qu * qt * c1y + qt * qt * p3y;
    }

    const dx = cx - qx, dy = cy - qy;
    const e2 = dx * dx + dy * dy;
    if (e2 > maxErr2) maxErr2 = e2;
  }

  if (maxErr2 <= tol2 || depth <= 0) {
    out.push(
      { type: 1, contourId, p0: new Vec2(p0x, p0y), p1: new Vec2(c0x, c0y), p2: new Vec2(mx, my) },
      { type: 1, contourId, p0: new Vec2(mx, my), p1: new Vec2(c1x, c1y), p2: new Vec2(p3x, p3y) }
    );
    return;
  }

  // De Casteljau split at t=0.5, pure scalar
  const p01x = (p0x + p1x) * 0.5;
  const p01y = (p0y + p1y) * 0.5;
  const p12x = (p1x + p2x) * 0.5;
  const p12y = (p1y + p2y) * 0.5;
  const p23x = (p2x + p3x) * 0.5;
  const p23y = (p2y + p3y) * 0.5;
  const p012x = (p01x + p12x) * 0.5;
  const p012y = (p01y + p12y) * 0.5;
  const p123x = (p12x + p23x) * 0.5;
  const p123y = (p12y + p23y) * 0.5;
  const p0123x = (p012x + p123x) * 0.5;
  const p0123y = (p012y + p123y) * 0.5;

  cubicToQuadraticsAdaptive(contourId, p0x, p0y, p01x, p01y, p012x, p012y, p0123x, p0123y, tol2, depth - 1, out);
  cubicToQuadraticsAdaptive(contourId, p0123x, p0123y, p123x, p123y, p23x, p23y, p3x, p3y, tol2, depth - 1, out);
}

function toQuadratics(segments: OutlineSegment[]): QuadSeg[] {
  const out: QuadSeg[] = [];
  // tol=0.25 font units; pre-squared for the scalar subdivision
  const tol2 = 0.25 * 0.25;
  const maxDepth = 4;

  for (let i = 0; i < segments.length; i++) {
    const s = segments[i];
    const type: OutlineSegmentType = s.type;

    if (type === 0) {
      const p0 = s.p0;
      const p2 = s.p1;
      out.push({
        type: 1,
        contourId: s.contourId,
        p0,
        p1: new Vec2((p0.x + p2.x) * 0.5, (p0.y + p2.y) * 0.5),
        p2
      });
      continue;
    }

    if (type === 1) {
      out.push({
        type: 1,
        contourId: s.contourId,
        p0: s.p0,
        p1: s.p1,
        p2: s.p2!
      });
      continue;
    }

    cubicToQuadraticsAdaptive(
      s.contourId,
      s.p0.x, s.p0.y, s.p1.x, s.p1.y,
      s.p2!.x, s.p2!.y, s.p3!.x, s.p3!.y,
      tol2, maxDepth, out
    );
  }
  return out;
}

// Packs glyph outlines into GPU-friendly textures and instance
// attributes for vector rendering without tessellation
export class GlyphVectorGeometryBuilder {
  private outlineCache: Cache<string, GlyphOutline>;
  private drawCallbacks: DrawCallbackHandler;
  private collector: GlyphOutlineCollector;
  private loadedFont: LoadedFont;
  private fontId: string = 'default';
  private cacheKeyPrefix: string = 'default';
  private emptyGlyphs: Set<number> = new Set();

  constructor(loadedFont: LoadedFont, cache: Cache<string, GlyphOutline> = globalOutlineCache) {
    this.loadedFont = loadedFont;
    this.outlineCache = cache;
    this.collector = new GlyphOutlineCollector();
    this.drawCallbacks = getSharedDrawCallbackHandler(this.loadedFont);
    this.drawCallbacks.createDrawFuncs(this.loadedFont, this.collector);
  }

  public setFontId(fontId: string): void {
    this.fontId = fontId;
    this.cacheKeyPrefix = `${this.fontId}__outline`;
  }

  public clearCache(): void {
    this.outlineCache.clear();
    this.emptyGlyphs.clear();
  }

  public getCacheStats() {
    return this.outlineCache.getStats();
  }

  private getOutlineForGlyph(glyphId: number): GlyphOutline {
    if (this.emptyGlyphs.has(glyphId)) {
      return {
        glyphId,
        textIndex: 0,
        segments: [],
        bounds: { min: { x: 0, y: 0 }, max: { x: 0, y: 0 } }
      };
    }

    const key = `${this.cacheKeyPrefix}_${glyphId}`;
    const cached = this.outlineCache.get(key);
    if (cached) return cached;

    this.drawCallbacks.setCollector(this.collector);
    this.collector.reset();
    this.collector.beginGlyph(glyphId, 0);
    this.loadedFont.module.exports.hb_font_draw_glyph(
      this.loadedFont.font.ptr,
      glyphId,
      this.drawCallbacks.getDrawFuncsPtr(),
      0
    );
    this.collector.finishGlyph();
    const collected = this.collector.getCollectedGlyphs()[0];

    const outline =
      collected ?? {
        glyphId,
        textIndex: 0,
        segments: [],
        bounds: { min: { x: 0, y: 0 }, max: { x: 0, y: 0 } }
      };

    if (outline.segments.length === 0) {
      this.emptyGlyphs.add(glyphId);
    }

    this.outlineCache.set(key, outline);
    return outline;
  }

  private writeSegmentToTexture(
    tex: PackedFloatTexture,
    texelIndex: number,
    a: number,
    b: number,
    c: number,
    d: number
  ) {
    const i = texelIndex * 4;
    tex.data[i] = a;
    tex.data[i + 1] = b;
    tex.data[i + 2] = c;
    tex.data[i + 3] = d;
  }

  private segmentAABB(seg: OutlineSegment): { minX: number; minY: number; maxX: number; maxY: number } {
    let minX = seg.p0.x;
    let minY = seg.p0.y;
    let maxX = seg.p0.x;
    let maxY = seg.p0.y;

    const p1 = seg.p1;
    if (p1.x < minX) minX = p1.x;
    if (p1.y < minY) minY = p1.y;
    if (p1.x > maxX) maxX = p1.x;
    if (p1.y > maxY) maxY = p1.y;

    const p2 = seg.p2;
    if (p2) {
      if (p2.x < minX) minX = p2.x;
      if (p2.y < minY) minY = p2.y;
      if (p2.x > maxX) maxX = p2.x;
      if (p2.y > maxY) maxY = p2.y;
    }

    const p3 = seg.p3;
    if (p3) {
      if (p3.x < minX) minX = p3.x;
      if (p3.y < minY) minY = p3.y;
      if (p3.x > maxX) maxX = p3.x;
      if (p3.y > maxY) maxY = p3.y;
    }

    return { minX, minY, maxX, maxY };
  }

  public buildVectorGeometry(
    clustersByLine: GlyphCluster[][],
    scale: number,
    segmentTextureWidth: number = 1024,
    bandCount: number = 0,
    tileCountX: number = 0,
    tileCountY: number = 0
  ): Omit<VectorTextGeometryInfo, 'query'> {
    // Base quad: positions in [-1,1] with UV in [0,1]
    const quadVertices = new Float32Array([
      -1, -1, 0, 0,
      -1,  1, 0, 1,
       1,  1, 1, 1,
       1, -1, 1, 0
    ]);
    const quadIndices = new Uint16Array([0, 1, 2, 0, 2, 3]);

    // Collect unique glyph IDs so we pack segment data once per glyph
    const uniqueGlyphIds: number[] = [];
    const seen = new Set<number>();
    for (const line of clustersByLine) {
      for (const cluster of line) {
        for (const g of cluster.glyphs) {
          if (!seen.has(g.g)) {
            seen.add(g.g);
            uniqueGlyphIds.push(g.g);
          }
        }
      }
    }

    const outlinesByGlyph = new Map<number, GlyphOutline>();
    const rangesByGlyph = new Map<number, SegmentRange>();
    const glyphDataIndexByGlyphId = new Map<number, number>();
    const quadSegsByGlyph = new Map<number, QuadSeg[]>();

    let totalSegments = 0;
    for (let gi = 0; gi < uniqueGlyphIds.length; gi++) {
      const glyphId = uniqueGlyphIds[gi];
      const outline = this.getOutlineForGlyph(glyphId);
      outlinesByGlyph.set(glyphId, outline);
      glyphDataIndexByGlyphId.set(glyphId, gi);
      const quadSegs = toQuadratics(outline.segments);
      quadSegsByGlyph.set(glyphId, quadSegs);
      totalSegments += quadSegs.length;
    }

    // Pack segments into RGBA32F texels: 3 texels per segment (12 floats)
    const segmentTexelsPerSegment = 3;
    const segmentTexelCount = totalSegments * segmentTexelsPerSegment;
    const segmentsTex = createPackedTexture(segmentTexelCount, segmentTextureWidth);

    // Segment bounds: 1 texel per segment (minX,minY,maxX,maxY), conservative hull AABB
    const boundsTex = createPackedTexture(totalSegments, segmentTextureWidth);
    // Keep bounds in CPU arrays for banding/tiling calculations (scaled, local coords)
    const segMinX = new Float32Array(totalSegments);
    const segMaxX = new Float32Array(totalSegments);
    const segMinY = new Float32Array(totalSegments);
    const segMaxY = new Float32Array(totalSegments);

    let segmentCursor = 0;
    for (const glyphId of uniqueGlyphIds) {
      const outline = outlinesByGlyph.get(glyphId)!;
      const start = segmentCursor;
      const quadSegs = quadSegsByGlyph.get(glyphId)!;
      const count = quadSegs.length;
      rangesByGlyph.set(glyphId, { start, count });

      for (let i = 0; i < count; i++) {
        const seg = quadSegs[i];
        // texel base for this segment
        const tBase = (segmentCursor + i) * segmentTexelsPerSegment;

        // Scale to match the mesh pipeline's output units
        const p0x = seg.p0.x * scale;
        const p0y = seg.p0.y * scale;
        const p1x = seg.p1.x * scale;
        const p1y = seg.p1.y * scale;
        const p2x = seg.p2.x * scale;
        const p2y = seg.p2.y * scale;
        const p3x = 0;
        const p3y = 0;

        // Texel 0: p0.xy, p1.xy
        this.writeSegmentToTexture(segmentsTex, tBase + 0, p0x, p0y, p1x, p1y);
        // Texel 1: p2.xy, p3.xy
        this.writeSegmentToTexture(segmentsTex, tBase + 1, p2x, p2y, p3x, p3y);
        // Texel 2: type, contourId, reserved, reserved
        this.writeSegmentToTexture(
          segmentsTex,
          tBase + 2,
          1, // quadratic-only
          seg.contourId,
          0,
          0
        );

        // Bounds texel (conservative AABB from control points, scaled)
        const aabb = this.segmentAABB(seg);
        const sMinX = aabb.minX * scale;
        const sMaxX = aabb.maxX * scale;
        const sMinY = aabb.minY * scale;
        const sMaxY = aabb.maxY * scale;
        this.writeSegmentToTexture(
          boundsTex,
          segmentCursor + i,
          sMinX,
          sMinY,
          sMaxX,
          sMaxY
        );
        segMinX[segmentCursor + i] = sMinX;
        segMaxX[segmentCursor + i] = sMaxX;
        segMinY[segmentCursor + i] = sMinY;
        segMaxY[segmentCursor + i] = sMaxY;
      }

      segmentCursor += count;
    }

    // Per-glyph bounds from the packed segments, not the original outline,
    // since cubic->quadratic approximation can slightly overshoot
    const glyphMinX = new Float32Array(uniqueGlyphIds.length);
    const glyphMinY = new Float32Array(uniqueGlyphIds.length);
    const glyphMaxX = new Float32Array(uniqueGlyphIds.length);
    const glyphMaxY = new Float32Array(uniqueGlyphIds.length);
    for (let gi = 0; gi < uniqueGlyphIds.length; gi++) {
      const glyphId = uniqueGlyphIds[gi];
      const range = rangesByGlyph.get(glyphId)!;
      if (range.count === 0) {
        glyphMinX[gi] = 0;
        glyphMinY[gi] = 0;
        glyphMaxX[gi] = 0;
        glyphMaxY[gi] = 0;
        continue;
      }
      let minX = Infinity;
      let minY = Infinity;
      let maxX = -Infinity;
      let maxY = -Infinity;
      for (let si = 0; si < range.count; si++) {
        const segIndex = range.start + si;
        const x0 = segMinX[segIndex];
        const x1 = segMaxX[segIndex];
        const y0 = segMinY[segIndex];
        const y1 = segMaxY[segIndex];
        if (x0 < minX) minX = x0;
        if (y0 < minY) minY = y0;
        if (x1 > maxX) maxX = x1;
        if (y1 > maxY) maxY = y1;
      }
      glyphMinX[gi] = minX;
      glyphMinY[gi] = minY;
      glyphMaxX[gi] = maxX;
      glyphMaxY[gi] = maxY;
    }

    // Y-bands: partition each glyph into horizontal bands so the shader
    // only tests segments overlapping the current fragment's Y range
    const useBands = bandCount > 0;
    const bandRangesTex = useBands
      ? createPackedTexture(uniqueGlyphIds.length * bandCount, segmentTextureWidth)
      : undefined;

    let bandIndexRefsTotal = 0;
    let bandListsByGlyph: number[][][] = [];
    if (useBands) {
      bandListsByGlyph = new Array(uniqueGlyphIds.length);
      for (let gi = 0; gi < uniqueGlyphIds.length; gi++) {
        const glyphId = uniqueGlyphIds[gi];
        const range = rangesByGlyph.get(glyphId)!;

        const gMinY = glyphMinY[gi];
        const gMaxY = glyphMaxY[gi];
        const height = gMaxY - gMinY;
        const invBandH = height > 1e-8 ? bandCount / height : 0;

        const bands: number[][] = new Array(bandCount);
        for (let bi = 0; bi < bandCount; bi++) bands[bi] = [];

        for (let si = 0; si < range.count; si++) {
          const segIndex = range.start + si;
          const s0 = segMinY[segIndex];
          const s1 = segMaxY[segIndex];

          let b0 = 0;
          let b1 = bandCount - 1;
          if (invBandH > 0) {
            b0 = Math.floor((s0 - gMinY) * invBandH);
            b1 = Math.floor((s1 - gMinY) * invBandH);
            if (b0 < 0) b0 = 0;
            if (b1 < 0) b1 = 0;
            if (b0 >= bandCount) b0 = bandCount - 1;
            if (b1 >= bandCount) b1 = bandCount - 1;
          }
          if (b1 < b0) {
            const tmp = b0;
            b0 = b1;
            b1 = tmp;
          }

          for (let bi = b0; bi <= b1; bi++) {
            bands[bi].push(segIndex);
          }
        }

        // Sort by maxX descending so the shader can early-exit leftward
        for (let bi = 0; bi < bandCount; bi++) {
          bands[bi].sort((a, b) => segMaxX[b] - segMaxX[a]);
        }

        bandListsByGlyph[gi] = bands;
        for (let bi = 0; bi < bandCount; bi++) {
          bandIndexRefsTotal += bands[bi].length;
        }
      }
    }

    const bandIndicesTex = useBands
      ? createPackedTexture(bandIndexRefsTotal, segmentTextureWidth)
      : undefined;

    if (useBands && bandRangesTex && bandIndicesTex) {
      let bandIndexCursor = 0;
      for (let gi = 0; gi < uniqueGlyphIds.length; gi++) {
        const bands = bandListsByGlyph[gi];
        for (let bi = 0; bi < bandCount; bi++) {
          const list = bands[bi];
          const start = bandIndexCursor;
          const count = list.length;

          // bandRanges texel: (start, count, 0, 0)
          this.writeSegmentToTexture(
            bandRangesTex,
            gi * bandCount + bi,
            start,
            count,
            0,
            0
          );

          for (let k = 0; k < count; k++) {
            const segIndex = list[k];
            // bandIndices texel.x = segIndex
            this.writeSegmentToTexture(
              bandIndicesTex,
              bandIndexCursor++,
              segIndex,
              0,
              0,
              0
            );
          }
        }
      }
    }

    // X-bands: same idea along the horizontal axis for vertical ray tests
    const xBandCount = bandCount; // Use same count for both axes
    const xBandRangesTex = useBands
      ? createPackedTexture(uniqueGlyphIds.length * xBandCount, segmentTextureWidth)
      : undefined;

    let xBandIndexRefsTotal = 0;
    let xBandListsByGlyph: number[][][] = [];
    if (useBands) {
      xBandListsByGlyph = new Array(uniqueGlyphIds.length);
      for (let gi = 0; gi < uniqueGlyphIds.length; gi++) {
        const glyphId = uniqueGlyphIds[gi];
        const range = rangesByGlyph.get(glyphId)!;

        const gMinX = glyphMinX[gi];
        const gMaxX = glyphMaxX[gi];
        const width = gMaxX - gMinX;
        const invBandW = width > 1e-8 ? xBandCount / width : 0;

        const bands: number[][] = new Array(xBandCount);
        for (let bi = 0; bi < xBandCount; bi++) bands[bi] = [];

        for (let si = 0; si < range.count; si++) {
          const segIndex = range.start + si;
          const s0 = segMinX[segIndex];
          const s1 = segMaxX[segIndex];

          let b0 = 0;
          let b1 = xBandCount - 1;
          if (invBandW > 0) {
            b0 = Math.floor((s0 - gMinX) * invBandW);
            b1 = Math.floor((s1 - gMinX) * invBandW);
            if (b0 < 0) b0 = 0;
            if (b1 < 0) b1 = 0;
            if (b0 >= xBandCount) b0 = xBandCount - 1;
            if (b1 >= xBandCount) b1 = xBandCount - 1;
          }
          if (b1 < b0) {
            const tmp = b0;
            b0 = b1;
            b1 = tmp;
          }

          for (let bi = b0; bi <= b1; bi++) {
            bands[bi].push(segIndex);
          }
        }

        // Sort by maxY descending so the shader can early-exit downward
        for (let bi = 0; bi < xBandCount; bi++) {
          bands[bi].sort((a, b) => segMaxY[b] - segMaxY[a]);
        }

        xBandListsByGlyph[gi] = bands;
        for (let bi = 0; bi < xBandCount; bi++) {
          xBandIndexRefsTotal += bands[bi].length;
        }
      }
    }

    const xBandIndicesTex = useBands
      ? createPackedTexture(xBandIndexRefsTotal, segmentTextureWidth)
      : undefined;

    if (useBands && xBandRangesTex && xBandIndicesTex) {
      let xBandIndexCursor = 0;
      for (let gi = 0; gi < uniqueGlyphIds.length; gi++) {
        const bands = xBandListsByGlyph[gi];
        for (let bi = 0; bi < xBandCount; bi++) {
          const list = bands[bi];
          const start = xBandIndexCursor;
          const count = list.length;

          // xBandRanges texel: (start, count, 0, 0)
          this.writeSegmentToTexture(
            xBandRangesTex,
            gi * xBandCount + bi,
            start,
            count,
            0,
            0
          );

          for (let k = 0; k < count; k++) {
            const segIndex = list[k];
            // xBandIndices texel.x = segIndex
            this.writeSegmentToTexture(
              xBandIndicesTex,
              xBandIndexCursor++,
              segIndex,
              0,
              0,
              0
            );
          }
        }
      }
    }

    // Build 2D tile grid (optional acceleration, Pathfinder-style)
    const useTiles = tileCountX > 0 && tileCountY > 0;
    const tileCount = useTiles ? tileCountX * tileCountY : 0;
    const tileRangesTex = useTiles
      ? createPackedTexture(uniqueGlyphIds.length * tileCount, segmentTextureWidth)
      : undefined;

    let tileIndexRefsTotal = 0;
    let tileListsByGlyph: number[][][] = [];
    if (useTiles) {
      tileListsByGlyph = new Array(uniqueGlyphIds.length);
      for (let gi = 0; gi < uniqueGlyphIds.length; gi++) {
        const glyphId = uniqueGlyphIds[gi];
        const range = rangesByGlyph.get(glyphId)!;

        const gMinX = glyphMinX[gi];
        const gMaxX = glyphMaxX[gi];
        const gMinY = glyphMinY[gi];
        const gMaxY = glyphMaxY[gi];
        const width = gMaxX - gMinX;
        const height = gMaxY - gMinY;

        const invTileW = width > 1e-8 ? tileCountX / width : 0;
        const invTileH = height > 1e-8 ? tileCountY / height : 0;

        const tiles: number[][] = new Array(tileCount);
        for (let ti = 0; ti < tileCount; ti++) tiles[ti] = [];

        for (let si = 0; si < range.count; si++) {
          const segIndex = range.start + si;
          const x0 = segMinX[segIndex];
          const x1 = segMaxX[segIndex];
          const y0 = segMinY[segIndex];
          const y1 = segMaxY[segIndex];

          let tx0 = 0;
          let tx1 = tileCountX - 1;
          let ty0 = 0;
          let ty1 = tileCountY - 1;

          if (invTileW > 0) {
            tx0 = Math.floor((x0 - gMinX) * invTileW);
            tx1 = Math.floor((x1 - gMinX) * invTileW);
            if (tx0 < 0) tx0 = 0;
            if (tx1 < 0) tx1 = 0;
            if (tx0 >= tileCountX) tx0 = tileCountX - 1;
            if (tx1 >= tileCountX) tx1 = tileCountX - 1;
          }
          if (invTileH > 0) {
            ty0 = Math.floor((y0 - gMinY) * invTileH);
            ty1 = Math.floor((y1 - gMinY) * invTileH);
            if (ty0 < 0) ty0 = 0;
            if (ty1 < 0) ty1 = 0;
            if (ty0 >= tileCountY) ty0 = tileCountY - 1;
            if (ty1 >= tileCountY) ty1 = tileCountY - 1;
          }
          if (tx1 < tx0) {
            const t = tx0;
            tx0 = tx1;
            tx1 = t;
          }
          if (ty1 < ty0) {
            const t = ty0;
            ty0 = ty1;
            ty1 = t;
          }

          for (let ty = ty0; ty <= ty1; ty++) {
            const rowBase = ty * tileCountX;
            for (let tx = tx0; tx <= tx1; tx++) {
              tiles[rowBase + tx].push(segIndex);
            }
          }
        }

        tileListsByGlyph[gi] = tiles;
        for (let ti = 0; ti < tileCount; ti++) {
          tileIndexRefsTotal += tiles[ti].length;
        }
      }
    }

    const tileIndicesTex = useTiles
      ? createPackedTexture(tileIndexRefsTotal, segmentTextureWidth)
      : undefined;

    if (useTiles && tileRangesTex && tileIndicesTex) {
      let tileIndexCursor = 0;
      for (let gi = 0; gi < uniqueGlyphIds.length; gi++) {
        const tiles = tileListsByGlyph[gi];
        for (let ti = 0; ti < tileCount; ti++) {
          const list = tiles[ti];
          const start = tileIndexCursor;
          const count = list.length;

          // tileRanges texel: (start, count, 0, 0)
          this.writeSegmentToTexture(
            tileRangesTex,
            gi * tileCount + ti,
            start,
            count,
            0,
            0
          );

          for (let k = 0; k < count; k++) {
            const segIndex = list[k];
            // tileIndices texel.x = segIndex
            this.writeSegmentToTexture(
              tileIndicesTex,
              tileIndexCursor++,
              segIndex,
              0,
              0,
              0
            );
          }
        }
      }
    }

    // Count instances (glyph occurrences) with non-empty outlines
    let glyphInstanceCount = 0;
    for (const line of clustersByLine) {
      for (const cluster of line) {
        for (const g of cluster.glyphs) {
          const range = rangesByGlyph.get(g.g);
          if (range && range.count > 0) glyphInstanceCount++;
        }
      }
    }

    const instances = {
      position: new Float32Array(glyphInstanceCount * 3),
      bounds: new Float32Array(glyphInstanceCount * 4),
      segmentRange: new Uint32Array(glyphInstanceCount * 2),
      glyphDataIndex: new Uint32Array(glyphInstanceCount),
      glyphIndex: new Uint32Array(glyphInstanceCount),
      textIndex: new Uint32Array(glyphInstanceCount),
      lineIndex: new Uint32Array(glyphInstanceCount)
    };

    const glyphInfos: VectorGlyphInfo[] = [];
    const planeBounds = {
      min: { x: Infinity, y: Infinity, z: 0 },
      max: { x: -Infinity, y: -Infinity, z: 0 }
    };

    let instanceCursor = 0;
    for (const line of clustersByLine) {
      for (const cluster of line) {
        const clusterX = cluster.position.x;
        const clusterY = cluster.position.y;
        const clusterZ = cluster.position.z;

        for (const g of cluster.glyphs) {
          const range = rangesByGlyph.get(g.g);
          if (!range || range.count === 0) continue;

          const px = (clusterX + (g.x ?? 0)) * scale;
          const py = (clusterY + (g.y ?? 0)) * scale;
          const pz = clusterZ * scale;

          const gi = glyphDataIndexByGlyphId.get(g.g) ?? 0;
          const bMinX = glyphMinX[gi];
          const bMinY = glyphMinY[gi];
          const bMaxX = glyphMaxX[gi];
          const bMaxY = glyphMaxY[gi];

          // Instance attributes
          instances.position[instanceCursor * 3 + 0] = px;
          instances.position[instanceCursor * 3 + 1] = py;
          instances.position[instanceCursor * 3 + 2] = pz;

          instances.bounds[instanceCursor * 4 + 0] = bMinX;
          instances.bounds[instanceCursor * 4 + 1] = bMinY;
          instances.bounds[instanceCursor * 4 + 2] = bMaxX;
          instances.bounds[instanceCursor * 4 + 3] = bMaxY;

          instances.segmentRange[instanceCursor * 2 + 0] = range.start;
          instances.segmentRange[instanceCursor * 2 + 1] = range.count;

          instances.glyphDataIndex[instanceCursor] =
            glyphDataIndexByGlyphId.get(g.g) ?? 0;
          instances.glyphIndex[instanceCursor] = g.g;
          instances.textIndex[instanceCursor] = g.absoluteTextIndex;
          instances.lineIndex[instanceCursor] = g.lineIndex;

          // Glyph info for querying/selection (world bounds)
          const glyphInfo: VectorGlyphInfo = {
            textIndex: g.absoluteTextIndex,
            lineIndex: g.lineIndex,
            vertexStart: 0,
            vertexCount: 0,
            segmentStart: range.start,
            segmentCount: range.count,
            bounds: {
              min: { x: px + bMinX, y: py + bMinY, z: pz },
              max: { x: px + bMaxX, y: py + bMaxY, z: pz }
            }
          };
          glyphInfos.push(glyphInfo);

          // Update plane bounds
          if (glyphInfo.bounds.min.x < planeBounds.min.x)
            planeBounds.min.x = glyphInfo.bounds.min.x;
          if (glyphInfo.bounds.min.y < planeBounds.min.y)
            planeBounds.min.y = glyphInfo.bounds.min.y;
          if (glyphInfo.bounds.min.z < planeBounds.min.z)
            planeBounds.min.z = glyphInfo.bounds.min.z;

          if (glyphInfo.bounds.max.x > planeBounds.max.x)
            planeBounds.max.x = glyphInfo.bounds.max.x;
          if (glyphInfo.bounds.max.y > planeBounds.max.y)
            planeBounds.max.y = glyphInfo.bounds.max.y;
          if (glyphInfo.bounds.max.z > planeBounds.max.z)
            planeBounds.max.z = glyphInfo.bounds.max.z;

          instanceCursor++;
        }
      }
    }

    if (glyphInfos.length === 0) {
      planeBounds.min.x = 0;
      planeBounds.min.y = 0;
      planeBounds.min.z = 0;
      planeBounds.max.x = 0;
      planeBounds.max.y = 0;
      planeBounds.max.z = 0;
    }

    return {
      quadVertices,
      quadIndices,
      instances,
      segmentTexelsPerSegment,
      segments: segmentsTex,
      segmentBounds: boundsTex,
      bandCount: useBands ? bandCount : undefined,
      bandRanges: bandRangesTex,
      bandIndices: bandIndicesTex,
      xBandCount: useBands ? xBandCount : undefined,
      xBandRanges: xBandRangesTex,
      xBandIndices: xBandIndicesTex,
      tileCountX: useTiles ? tileCountX : undefined,
      tileCountY: useTiles ? tileCountY : undefined,
      tileRanges: tileRangesTex,
      tileIndices: tileIndicesTex,
      glyphs: glyphInfos,
      planeBounds
    };
  }
}
