import { Vec3 } from '../utils/vectors';
import { perfLogger } from '../utils/PerformanceLogger';
import { isLogEnabled } from '../utils/Logger';
import {
  GlyphGeometryInfo,
  GlyphContours,
  LoadedFont,
  GlyphCluster,
  GlyphData
} from '../core/types';
import {
  globalContourCache,
  globalWordCache,
  globalClusteringCache,
  getGlyphCacheKey
} from '../core/cache/sharedCaches';
import { Tessellator } from './geometry/Tessellator';
import { Extruder } from './geometry/Extruder';
import { BoundaryClusterer } from './geometry/BoundaryClusterer';
import { GlyphContourCollector } from './GlyphContourCollector';
import {
  getSharedDrawCallbackHandler,
  DrawCallbackHandler
} from '../core/shaping/DrawCallbacks';
import { CurveFidelityConfig, GeometryOptimizationOptions } from '../core/types';
import { HarfBuzzGlyph } from '../core/types';
import { Cache } from '../utils/Cache';
import { DEFAULT_CURVE_FIDELITY } from './geometry/Polygonizer';
import { DEFAULT_OPTIMIZATION_CONFIG } from './geometry/PathOptimizer';

export interface InstancedTextGeometry {
  vertices: Float32Array;
  normals: Float32Array;
  indices: Uint32Array;
  glyphInfos: GlyphGeometryInfo[];
  planeBounds: {
    min: { x: number; y: number; z: number };
    max: { x: number; y: number; z: number };
  };
}

type GeometryTask = {
  data: GlyphData;
  px: number;
  py: number;
  pz: number;
  vertexStart: number;
};

export class GlyphGeometryBuilder {
  private cache: Cache<string, GlyphData>;
  private tessellator: Tessellator;
  private extruder: Extruder;
  private fontId: string = 'default';
  private cacheKeyPrefix: string = 'default';
  private curveFidelityConfig?: CurveFidelityConfig;
  private curveSteps?: number;
  private geometryOptimizationOptions?: GeometryOptimizationOptions;
  private clusterer: BoundaryClusterer;
  private collector: GlyphContourCollector;
  private drawCallbacks: DrawCallbackHandler;
  private loadedFont: LoadedFont;
  private wordCache: Cache<string, GlyphData>;
  private contourCache: Cache<string, GlyphContours>;
  private clusteringCache: Cache<
    string,
    {
      glyphIds: number[];
      positions: { x: number; y: number }[];
      groups: number[][];
    }
  >;
  private emptyGlyphs: Set<number> = new Set();
  private clusterPositions: Vec3[] = [];
  private clusterContoursScratch: number[][] = [];
  private taskScratch: GeometryTask[] = [];

  constructor(cache: Cache<string, GlyphData>, loadedFont: LoadedFont) {
    this.cache = cache;
    this.loadedFont = loadedFont;
    this.tessellator = new Tessellator();
    this.extruder = new Extruder();
    this.clusterer = new BoundaryClusterer();
    this.collector = new GlyphContourCollector();
    this.drawCallbacks = getSharedDrawCallbackHandler(this.loadedFont);
    this.drawCallbacks.createDrawFuncs(this.loadedFont, this.collector);
    this.contourCache = globalContourCache;
    this.wordCache = globalWordCache;
    this.clusteringCache = globalClusteringCache;
  }

  public getOptimizationStats() {
    return this.collector.getOptimizationStats();
  }

  public setCurveFidelityConfig(config?: CurveFidelityConfig): void {
    this.curveFidelityConfig = config;
    this.collector.setCurveFidelityConfig(config);
    this.updateCacheKeyPrefix();
  }

  public setCurveSteps(curveSteps?: number): void {
    // Normalize: unset for undefined/null/non-finite/<=0
    if (curveSteps === undefined || curveSteps === null) {
      this.curveSteps = undefined;
    } else if (!Number.isFinite(curveSteps)) {
      this.curveSteps = undefined;
    } else {
      const stepsInt = Math.round(curveSteps);
      this.curveSteps = stepsInt >= 1 ? stepsInt : undefined;
    }

    this.collector.setCurveSteps(this.curveSteps);
    this.updateCacheKeyPrefix();
  }

  public setGeometryOptimization(options?: GeometryOptimizationOptions): void {
    this.geometryOptimizationOptions = options;
    this.collector.setGeometryOptimization(options);
    this.updateCacheKeyPrefix();
  }

  public setFontId(fontId: string): void {
    this.fontId = fontId;
    this.updateCacheKeyPrefix();
  }

  private updateCacheKeyPrefix(): void {
    this.cacheKeyPrefix = `${this.fontId}__${this.getGeometryConfigSignature()}`;
  }

  private getGeometryConfigSignature(): string {
    const curveSignature = (() => {
      if (this.curveSteps !== undefined) {
        return `cf:steps:${this.curveSteps}`;
      }

      const distanceTolerance =
        this.curveFidelityConfig?.distanceTolerance ??
        DEFAULT_CURVE_FIDELITY.distanceTolerance!;
      const angleTolerance =
        this.curveFidelityConfig?.angleTolerance ??
        DEFAULT_CURVE_FIDELITY.angleTolerance!;

      return `cf:${distanceTolerance.toFixed(4)},${angleTolerance.toFixed(4)}`;
    })();

    const enabled =
      this.geometryOptimizationOptions?.enabled ??
      DEFAULT_OPTIMIZATION_CONFIG.enabled;
    const areaThreshold =
      this.geometryOptimizationOptions?.areaThreshold ??
      DEFAULT_OPTIMIZATION_CONFIG.areaThreshold;

    // Use fixed precision to keep cache keys stable and avoid float noise
    return [
      curveSignature,
      `opt:${enabled ? 1 : 0},${areaThreshold.toFixed(4)}`
    ].join('|');
  }

  public buildInstancedGeometry(
    clustersByLine: GlyphCluster[][],
    depth: number,
    removeOverlaps: boolean,
    isCFF: boolean,
    scale: number,
    separateGlyphs: boolean = false,
    coloredTextIndices?: Set<number>
  ): InstancedTextGeometry {
    if (isLogEnabled) {
      let wordCount = 0;
      for (let i = 0; i < clustersByLine.length; i++) {
        wordCount += clustersByLine[i].length;
      }
      perfLogger.start('GlyphGeometryBuilder.buildInstancedGeometry', {
        lineCount: clustersByLine.length,
        wordCount,
        depth,
        removeOverlaps
      });
    } else {
      perfLogger.start('GlyphGeometryBuilder.buildInstancedGeometry');
    }

    const tasks = this.taskScratch;
    tasks.length = 0;
    let taskCount = 0;
    let totalVertexFloats = 0;
    let totalNormalFloats = 0;
    let totalIndexCount = 0;
    let vertexCursor = 0; // vertex offset (not float offset)

    const pushTask = (
      data: GlyphData,
      px: number,
      py: number,
      pz: number
    ): number => {
      const vertexStart = vertexCursor;
      let task = tasks[taskCount];
      if (task) {
        task.data = data;
        task.px = px;
        task.py = py;
        task.pz = pz;
        task.vertexStart = vertexStart;
      } else {
        task = { data, px, py, pz, vertexStart };
        tasks[taskCount] = task;
      }
      taskCount++;
      totalVertexFloats += data.vertices.length;
      totalNormalFloats += data.normals.length;
      totalIndexCount += data.indices.length;
      vertexCursor += data.vertices.length / 3;
      return vertexStart;
    };
    const glyphInfos: GlyphGeometryInfo[] = [];

    const planeBounds = {
      min: { x: Infinity, y: Infinity, z: 0 },
      max: { x: -Infinity, y: -Infinity, z: depth }
    };

    for (let lineIndex = 0; lineIndex < clustersByLine.length; lineIndex++) {
      const line = clustersByLine[lineIndex];
      for (const cluster of line) {
        const clusterX = cluster.position.x;
        const clusterY = cluster.position.y;
        const clusterZ = cluster.position.z;

        const clusterGlyphContours: GlyphContours[] = [];
        for (const glyph of cluster.glyphs) {
          clusterGlyphContours.push(this.getContoursForGlyph(glyph.g));
        }

        let boundaryGroups: number[][];
        if (cluster.glyphs.length <= 1) {
          boundaryGroups = [[0]];
        } else {
          // Check clustering cache (same text + glyph IDs + positions = same overlap groups)
          // Key must be font-specific; glyph ids/bounds differ between fonts
          // Positions must match since overlap detection depends on relative glyph placement
          const cacheKey = `${this.cacheKeyPrefix}_${cluster.text}`;
          const cached = this.clusteringCache.get(cacheKey);

          let isValid = false;
          if (cached && cached.glyphIds.length === cluster.glyphs.length) {
            isValid = true;
            for (let i = 0; i < cluster.glyphs.length; i++) {
              const glyph = cluster.glyphs[i];
              const cachedPos = cached.positions[i];
              if (
                cached.glyphIds[i] !== glyph.g ||
                cachedPos.x !== (glyph.x ?? 0) ||
                cachedPos.y !== (glyph.y ?? 0)
              ) {
                isValid = false;
                break;
              }
            }
          }

          if (isValid && cached) {
            boundaryGroups = cached.groups;
          } else {
            const glyphCount = cluster.glyphs.length;
            if (this.clusterPositions.length < glyphCount) {
              for (let i = this.clusterPositions.length; i < glyphCount; i++) {
                this.clusterPositions.push(new Vec3(0, 0, 0));
              }
            }
            this.clusterPositions.length = glyphCount;
            for (let i = 0; i < glyphCount; i++) {
              const glyph = cluster.glyphs[i];
              const pos = this.clusterPositions[i];
              pos.x = glyph.x ?? 0;
              pos.y = glyph.y ?? 0;
              pos.z = 0;
            }
            boundaryGroups = this.clusterer.cluster(
              clusterGlyphContours,
              this.clusterPositions
            );

            this.clusteringCache.set(cacheKey, {
              glyphIds: cluster.glyphs.map((g) => g.g),
              positions: cluster.glyphs.map((g) => ({
                x: g.x ?? 0,
                y: g.y ?? 0
              })),
              groups: boundaryGroups
            });
          }
        }

        const forceSeparate = separateGlyphs;

        // Split boundary groups so colored and non-colored glyphs don't merge together
        // This preserves overlap removal within each color class while keeping
        // geometry separate for accurate vertex coloring
        let finalGroups = boundaryGroups;
        if (coloredTextIndices && coloredTextIndices.size > 0) {
          finalGroups = [];
          for (const group of boundaryGroups) {
            if (group.length <= 1) {
              finalGroups.push(group);
            } else {
              // Split group into colored and non-colored sub-groups
              const coloredIndices: number[] = [];
              const nonColoredIndices: number[] = [];
              for (const idx of group) {
                const glyph = cluster.glyphs[idx];
                if (coloredTextIndices.has(glyph.absoluteTextIndex)) {
                  coloredIndices.push(idx);
                } else {
                  nonColoredIndices.push(idx);
                }
              }
              // Add non-empty sub-groups
              if (coloredIndices.length > 0) {
                finalGroups.push(coloredIndices);
              }
              if (nonColoredIndices.length > 0) {
                finalGroups.push(nonColoredIndices);
              }
            }
          }
        }

        // Iterate over the geometric groups identified by BoundaryClusterer
        // logical groups (words) split into geometric sub-groups
        for (const groupIndices of finalGroups) {
          const isOverlappingGroup = groupIndices.length > 1;
          const shouldCluster = isOverlappingGroup && !forceSeparate;

          if (shouldCluster) {
            // Cluster-level caching for this specific group of overlapping glyphs
            const subClusterGlyphs = groupIndices.map((i) => cluster.glyphs[i]);
            const clusterKey = this.getClusterKey(
              subClusterGlyphs,
              depth,
              removeOverlaps
            );

            let cachedCluster = this.wordCache.get(clusterKey);

            if (!cachedCluster) {
              const clusterContours = this.clusterContoursScratch;
              let contourIndex = 0;
              const refX = subClusterGlyphs[0].x ?? 0;
              const refY = subClusterGlyphs[0].y ?? 0;

              for (let i = 0; i < groupIndices.length; i++) {
                const originalIndex = groupIndices[i];
                const glyphContours = clusterGlyphContours[originalIndex];
                const glyph = cluster.glyphs[originalIndex];

                const relX = (glyph.x ?? 0) - refX;
                const relY = (glyph.y ?? 0) - refY;

                for (const path of glyphContours.paths) {
                  const points = path.points;
                  const pointCount = points.length;
                  if (pointCount < 3) continue;

                  const isClosed =
                    pointCount > 1 &&
                    points[0].x === points[pointCount - 1].x &&
                    points[0].y === points[pointCount - 1].y;
                  const end = isClosed ? pointCount - 1 : pointCount;

                  const needed = (end + 1) * 2;
                  let contour = clusterContours[contourIndex];
                  if (!contour || contour.length < needed) {
                    contour = new Array(needed);
                    clusterContours[contourIndex] = contour;
                  } else {
                    contour.length = needed;
                  }
                  let out = 0;
                  for (let k = 0; k < end; k++) {
                    const pt = points[k];
                    contour[out++] = pt.x + relX;
                    contour[out++] = pt.y + relY;
                  }
                  if (out >= 2) {
                    contour[out++] = contour[0];
                    contour[out++] = contour[1];
                  }
                  contourIndex++;
                }
              }
              clusterContours.length = contourIndex;
              cachedCluster = this.tessellateGlyphCluster(
                clusterContours,
                depth,
                isCFF
              );
              this.wordCache.set(clusterKey, cachedCluster);
            }

            // Calculate the absolute position of this sub-cluster based on its first glyph

            // (since the cached geometry is relative to that first glyph)
            const firstGlyphInGroup = subClusterGlyphs[0];
            const groupPosX = clusterX + (firstGlyphInGroup.x ?? 0);
            const groupPosY = clusterY + (firstGlyphInGroup.y ?? 0);
            const groupPosZ = clusterZ;
            const vertexStart = pushTask(
              cachedCluster,
              groupPosX,
              groupPosY,
              groupPosZ
            );

            const clusterVertexCount = cachedCluster.vertices.length / 3;

            for (let i = 0; i < groupIndices.length; i++) {
              const originalIndex = groupIndices[i];
              const glyph = cluster.glyphs[originalIndex];
              const glyphContours = clusterGlyphContours[originalIndex];

              const glyphPosX = clusterX + (glyph.x ?? 0);
              const glyphPosY = clusterY + (glyph.y ?? 0);
              const glyphPosZ = clusterZ;

              const glyphInfo = this.createGlyphInfo(
                glyph,
                vertexStart,
                clusterVertexCount,
                glyphPosX,
                glyphPosY,
                glyphPosZ,
                glyphContours,
                depth
              );
              glyphInfos.push(glyphInfo);
              this.updatePlaneBounds(glyphInfo.bounds, planeBounds);
            }
          } else {
            // Glyph-level caching (standard path for isolated glyphs or when forced separate)
            for (const i of groupIndices) {
              const glyph = cluster.glyphs[i];
              const glyphContours = clusterGlyphContours[i];
              const glyphPosX = clusterX + (glyph.x ?? 0);
              const glyphPosY = clusterY + (glyph.y ?? 0);
              const glyphPosZ = clusterZ;

              // Skip glyphs with no paths (spaces, zero-width characters, etc.)
              if (glyphContours.paths.length === 0) {
                const glyphInfo = this.createGlyphInfo(
                  glyph,
                  0,
                  0,
                  glyphPosX,
                  glyphPosY,
                  glyphPosZ,
                  glyphContours,
                  depth
                );
                glyphInfos.push(glyphInfo);
                continue;
              }

              const glyphCacheKey = getGlyphCacheKey(
                this.cacheKeyPrefix,
                glyph.g,
                depth,
                removeOverlaps
              );
              let cachedGlyph = this.cache.get(glyphCacheKey);

              if (!cachedGlyph) {
                cachedGlyph = this.tessellateGlyph(
                  glyphContours,
                  depth,
                  removeOverlaps,
                  isCFF
                );
                this.cache.set(glyphCacheKey, cachedGlyph);
              } else {
                cachedGlyph.useCount++;
              }

              const vertexStart = pushTask(
                cachedGlyph,
                glyphPosX,
                glyphPosY,
                glyphPosZ
              );

              const glyphInfo = this.createGlyphInfo(
                glyph,
                vertexStart,
                cachedGlyph.vertices.length / 3,
                glyphPosX,
                glyphPosY,
                glyphPosZ,
                glyphContours,
                depth
              );
              glyphInfos.push(glyphInfo);
              this.updatePlaneBounds(glyphInfo.bounds, planeBounds);
            }
          }
        }
      }
    }
    tasks.length = taskCount;
    const vertexArray = new Float32Array(totalVertexFloats);
    const normalArray = new Float32Array(totalNormalFloats);
    const indexArray = new Uint32Array(totalIndexCount);

    let vertexPos = 0; // float index (multiple of 3)
    let normalPos = 0; // float index (multiple of 3)
    let indexPos = 0; // index count

    for (let t = 0; t < tasks.length; t++) {
      const task = tasks[t];
      const v = task.data.vertices;
      const n = task.data.normals;
      const idx = task.data.indices;

      const px = task.px;
      const py = task.py;
      const pz = task.pz;

      const offsetX = px * scale;
      const offsetY = py * scale;
      const offsetZ = pz * scale;
      const vLen = v.length;
      let outPos = vertexPos;
      for (let j = 0; j < vLen; j += 3) {
        vertexArray[outPos] = v[j] * scale + offsetX;
        vertexArray[outPos + 1] = v[j + 1] * scale + offsetY;
        vertexArray[outPos + 2] = v[j + 2] * scale + offsetZ;
        outPos += 3;
      }
      vertexPos = outPos;

      normalArray.set(n, normalPos);
      normalPos += n.length;

      const vertexStart = task.vertexStart;
      const idxLen = idx.length;
      let outIndexPos = indexPos;
      for (let j = 0; j < idxLen; j++) {
        indexArray[outIndexPos++] = idx[j] + vertexStart;
      }
      indexPos = outIndexPos;
    }
    perfLogger.end('GlyphGeometryBuilder.buildInstancedGeometry');

    planeBounds.min.x *= scale;
    planeBounds.min.y *= scale;
    planeBounds.min.z *= scale;
    planeBounds.max.x *= scale;
    planeBounds.max.y *= scale;
    planeBounds.max.z *= scale;

    for (let i = 0; i < glyphInfos.length; i++) {
      glyphInfos[i].bounds.min.x *= scale;
      glyphInfos[i].bounds.min.y *= scale;
      glyphInfos[i].bounds.min.z *= scale;
      glyphInfos[i].bounds.max.x *= scale;
      glyphInfos[i].bounds.max.y *= scale;
      glyphInfos[i].bounds.max.z *= scale;
    }

    return {
      vertices: vertexArray,
      normals: normalArray,
      indices: indexArray,
      glyphInfos,
      planeBounds
    };
  }

  private getClusterKey(
    glyphs: HarfBuzzGlyph[],
    depth: number,
    removeOverlaps: boolean
  ): string {
    if (glyphs.length === 0) return '';

    const refX = glyphs[0].x ?? 0;
    const refY = glyphs[0].y ?? 0;

    const parts = glyphs.map((g) => {
      const relX = (g.x ?? 0) - refX;
      const relY = (g.y ?? 0) - refY;
      return `${g.g}:${relX},${relY}`;
    });

    const ids = parts.join('|');
    const roundedDepth = Math.round(depth * 1000) / 1000;
    return `${this.cacheKeyPrefix}_${ids}_${roundedDepth}_${removeOverlaps}`;
  }

  private createGlyphInfo(
    glyph: HarfBuzzGlyph,
    vertexStart: number,
    vertexCount: number,
    positionX: number,
    positionY: number,
    positionZ: number,
    contours: GlyphContours,
    depth: number
  ): GlyphGeometryInfo {
    return {
      textIndex: glyph.absoluteTextIndex,
      lineIndex: glyph.lineIndex,
      vertexStart,
      vertexCount,
      bounds: {
        min: {
          x: contours.bounds.min.x + positionX,
          y: contours.bounds.min.y + positionY,
          z: positionZ
        },
        max: {
          x: contours.bounds.max.x + positionX,
          y: contours.bounds.max.y + positionY,
          z: positionZ + depth
        }
      }
    };
  }

  private getContoursForGlyph(glyphId: number): GlyphContours {
    // Fast path: skip HarfBuzz draw for known-empty glyphs (spaces, zero-width, etc)
    if (this.emptyGlyphs.has(glyphId)) {
      return {
        glyphId,
        paths: [],
        bounds: {
          min: { x: 0, y: 0 },
          max: { x: 0, y: 0 }
        }
      };
    }

    const key = `${this.cacheKeyPrefix}_${glyphId}`;
    const cached = this.contourCache.get(key);
    if (cached) {
      return cached;
    }

    // Rebind collector before draw operation
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

    const contours = collected || {
      glyphId,
      paths: [],
      bounds: {
        min: { x: 0, y: 0 },
        max: { x: 0, y: 0 }
      }
    };

    // Mark glyph as empty for future fast-path
    if (contours.paths.length === 0) {
      this.emptyGlyphs.add(glyphId);
    }

    this.contourCache.set(key, contours);
    return contours;
  }

  private tessellateGlyphCluster(
    contours: number[][],
    depth: number,
    isCFF: boolean
  ): GlyphData {
    const processedGeometry = this.tessellator.processContours(
      contours,
      true,
      isCFF,
      depth !== 0
    );
    return this.extrudeAndPackage(processedGeometry, depth);
  }

  private extrudeAndPackage(processedGeometry: any, depth: number): GlyphData {
    perfLogger.start('Extruder.extrude', {
      depth,
      upem: this.loadedFont.upem
    });
    const extrudedResult = this.extruder.extrude(
      processedGeometry,
      depth,
      this.loadedFont.upem
    );
    perfLogger.end('Extruder.extrude');

    const vertices = extrudedResult.vertices;
    let minX = Infinity,
      minY = Infinity,
      minZ = Infinity;
    let maxX = -Infinity,
      maxY = -Infinity,
      maxZ = -Infinity;

    for (let i = 0; i < vertices.length; i += 3) {
      const x = vertices[i];
      const y = vertices[i + 1];
      const z = vertices[i + 2];

      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
      if (z < minZ) minZ = z;
      if (z > maxZ) maxZ = z;
    }

    const boundsMin = new Vec3(minX, minY, minZ);
    const boundsMax = new Vec3(maxX, maxY, maxZ);

    return {
      geometry: processedGeometry,
      vertices: extrudedResult.vertices,
      normals: extrudedResult.normals,
      indices: extrudedResult.indices,
      bounds: { min: boundsMin, max: boundsMax },
      useCount: 1
    };
  }

  private tessellateGlyph(
    glyphContours: GlyphContours,
    depth: number,
    removeOverlaps: boolean,
    isCFF: boolean
  ): GlyphData {
    perfLogger.start('GlyphGeometryBuilder.tessellateGlyph', {
      glyphId: glyphContours.glyphId,
      pathCount: glyphContours.paths.length
    });
    const processedGeometry = this.tessellator.process(
      glyphContours.paths,
      removeOverlaps,
      isCFF,
      depth !== 0
    );
    perfLogger.end('GlyphGeometryBuilder.tessellateGlyph');

    return this.extrudeAndPackage(processedGeometry, depth);
  }

  private updatePlaneBounds(
    glyphBounds: {
      min: { x: number; y: number; z: number };
      max: { x: number; y: number; z: number };
    },
    planeBounds: {
      min: { x: number; y: number; z: number };
      max: { x: number; y: number; z: number };
    }
  ): void {
    const pMin = planeBounds.min;
    const pMax = planeBounds.max;
    const gMin = glyphBounds.min;
    const gMax = glyphBounds.max;

    if (gMin.x < pMin.x) pMin.x = gMin.x;
    if (gMin.y < pMin.y) pMin.y = gMin.y;
    if (gMin.z < pMin.z) pMin.z = gMin.z;

    if (gMax.x > pMax.x) pMax.x = gMax.x;
    if (gMax.y > pMax.y) pMax.y = gMax.y;
    if (gMax.z > pMax.z) pMax.z = gMax.z;
  }

  public getCacheStats() {
    return this.cache.getStats();
  }

  public clearCache() {
    this.cache.clear();
    this.wordCache.clear();
    this.clusteringCache.clear();
    this.contourCache.clear();
  }
}
