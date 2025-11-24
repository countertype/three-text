import { Vec2, Vec3, Box3 as Box3Core } from '../vectors';
import { GlyphCache, GlyphData, GlyphInstance } from './GlyphCache';
import { perfLogger } from '../../utils/PerformanceLogger';
import {
  Path,
  GlyphGeometryInfo,
  GlyphContours,
  LoadedFont,
  GlyphCluster
} from '../types';
import { Tessellator } from '../geometry/Tessellator';
import { Extruder } from '../geometry/Extruder';
import { BoundaryClusterer } from '../geometry/BoundaryClusterer';
import { GlyphContourCollector } from './GlyphContourCollector';
import { DrawCallbackHandler } from '../shaping/DrawCallbacks';
import { CurveFidelityConfig, GeometryOptimizationOptions } from '../types';
import { HarfBuzzGlyph } from '../types';

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

export class GlyphGeometryBuilder {
  private cache: GlyphCache;
  private tessellator: Tessellator;
  private extruder: Extruder;
  private fontId: string = 'default';
  private clusterer: BoundaryClusterer;
  private collector: GlyphContourCollector;
  private drawCallbacks: DrawCallbackHandler;
  private loadedFont: LoadedFont;
  private wordCache = new Map<string, GlyphData>();

  constructor(cache: GlyphCache, loadedFont: LoadedFont) {
    this.cache = cache;
    this.loadedFont = loadedFont;
    this.tessellator = new Tessellator();
    this.extruder = new Extruder();
    this.clusterer = new BoundaryClusterer();
    this.collector = new GlyphContourCollector();
    this.drawCallbacks = new DrawCallbackHandler();
    this.drawCallbacks.createDrawFuncs(this.loadedFont, this.collector);
  }

  public getOptimizationStats() {
    return this.collector.getOptimizationStats();
  }

  public setCurveFidelityConfig(config?: CurveFidelityConfig): void {
    this.collector.setCurveFidelityConfig(config);
  }

  public setGeometryOptimization(options?: GeometryOptimizationOptions): void {
    this.collector.setGeometryOptimization(options);
  }

  public setFontId(fontId: string): void {
    this.fontId = fontId;
  }

  // Build instanced geometry from glyph contours
  public buildInstancedGeometry(
    clustersByLine: GlyphCluster[][],
    depth: number,
    removeOverlaps: boolean,
    isCFF: boolean,
    separateGlyphs: boolean = false
  ): InstancedTextGeometry {
    perfLogger.start('GlyphGeometryBuilder.buildInstancedGeometry', {
      lineCount: clustersByLine.length,
      wordCount: clustersByLine.flat().length,
      depth,
      removeOverlaps
    });

    const vertices: number[] = [];
    const normals: number[] = [];
    const indices: number[] = [];
    const glyphInfos: GlyphGeometryInfo[] = [];

    const planeBounds = {
      min: { x: Infinity, y: Infinity, z: 0 },
      max: { x: -Infinity, y: -Infinity, z: depth }
    };

    for (let lineIndex = 0; lineIndex < clustersByLine.length; lineIndex++) {
      const line = clustersByLine[lineIndex];
      for (const cluster of line) {
        // Step 1: Get contours for all glyphs in the cluster
        const clusterGlyphContours: GlyphContours[] = [];
        for (const glyph of cluster.glyphs) {
          clusterGlyphContours.push(this.getContoursForGlyph(glyph.g));
        }

        // Step 2: Check for overlaps within the cluster
        const relativePositions = cluster.glyphs.map(
          (g) => new Vec3(g.x, g.y, 0)
        );
        const boundaryGroups = this.clusterer.cluster(
          clusterGlyphContours,
          relativePositions
        );
        const hasOverlaps = separateGlyphs
          ? false
          : boundaryGroups.some((group) => group.length > 1);

        if (hasOverlaps) {
          // Cluster-level caching
          const clusterKey = `${this.fontId}_${cluster.text}_${depth}_${removeOverlaps}`;
          let cachedCluster = this.wordCache.get(clusterKey);

          if (!cachedCluster) {
            const clusterPaths: Path[] = [];
            for (let i = 0; i < clusterGlyphContours.length; i++) {
              const glyphContours = clusterGlyphContours[i];
              const glyph = cluster.glyphs[i];
              for (const path of glyphContours.paths) {
                clusterPaths.push({
                  ...path,
                  points: path.points.map(
                    (p) =>
                      new Vec2(p.x + (glyph.x ?? 0), p.y + (glyph.y ?? 0))
                  )
                });
              }
            }
            cachedCluster = this.tessellateGlyphCluster(
              clusterPaths,
              depth,
              isCFF
            );
            this.wordCache.set(clusterKey, cachedCluster);
          }

          const vertexOffset = vertices.length / 3;
          this.appendGeometry(
            vertices,
            normals,
            indices,
            cachedCluster,
            cluster.position,
            vertexOffset
          );

          const clusterVertexCount = cachedCluster.vertices.length / 3;
          for (let i = 0; i < cluster.glyphs.length; i++) {
            const glyph = cluster.glyphs[i];
            const glyphContours = clusterGlyphContours[i];

            const absoluteGlyphPosition = new Vec3(
              cluster.position.x + (glyph.x ?? 0),
              cluster.position.y + (glyph.y ?? 0),
              cluster.position.z
            );

            const glyphInfo = this.createGlyphInfo(
              glyph,
              vertexOffset,
              clusterVertexCount,
              absoluteGlyphPosition,
              glyphContours,
              depth
            );
            glyphInfos.push(glyphInfo);
            this.updatePlaneBounds(glyphInfo.bounds, planeBounds);
          }
        } else {
          // Glyph-level caching
          for (let i = 0; i < cluster.glyphs.length; i++) {
            const glyph = cluster.glyphs[i];
            const glyphContours = clusterGlyphContours[i];
            const glyphPosition = new Vec3(
              cluster.position.x + (glyph.x ?? 0),
              cluster.position.y + (glyph.y ?? 0),
              cluster.position.z
            );

            // Skip glyphs with no paths (spaces, zero-width characters, etc.)
            if (glyphContours.paths.length === 0) {
              const glyphInfo = this.createGlyphInfo(
                glyph,
                0,
                0,
                glyphPosition,
                glyphContours,
                depth
              );
              glyphInfos.push(glyphInfo);
              continue;
            }

            let cachedGlyph = this.cache.get(
              this.fontId,
              glyph.g,
              depth,
              removeOverlaps
            );

            if (!cachedGlyph) {
              cachedGlyph = this.tessellateGlyph(
                glyphContours,
                depth,
                removeOverlaps,
                isCFF
              );
              this.cache.set(
                this.fontId,
                glyph.g,
                depth,
                removeOverlaps,
                cachedGlyph
              );
            }

            const vertexOffset = vertices.length / 3;
            this.appendGeometry(
              vertices,
              normals,
              indices,
              cachedGlyph,
              glyphPosition,
              vertexOffset
            );

            const glyphInfo = this.createGlyphInfo(
              glyph,
              vertexOffset,
              cachedGlyph.vertices.length / 3,
              glyphPosition,
              glyphContours,
              depth
            );
            glyphInfos.push(glyphInfo);
            this.updatePlaneBounds(glyphInfo.bounds, planeBounds);
          }
        }
      }
    }

    const vertexArray = new Float32Array(vertices);
    const normalArray = new Float32Array(normals);
    const indexArray = new Uint32Array(indices);

    perfLogger.end('GlyphGeometryBuilder.buildInstancedGeometry');

    return {
      vertices: vertexArray,
      normals: normalArray,
      indices: indexArray,
      glyphInfos,
      planeBounds
    };
  }

  private appendGeometry(
    vertices: number[],
    normals: number[],
    indices: number[],
    data: GlyphData,
    position: Vec3,
    offset: number
  ) {
    for (let j = 0; j < data.vertices.length; j += 3) {
      vertices.push(
        data.vertices[j] + position.x,
        data.vertices[j + 1] + position.y,
        data.vertices[j + 2] + position.z
      );
    }
    for (let j = 0; j < data.normals.length; j++) {
      normals.push(data.normals[j]);
    }
    for (let j = 0; j < data.indices.length; j++) {
      indices.push(data.indices[j] + offset);
    }
  }

  private createGlyphInfo(
    glyph: HarfBuzzGlyph,
    vertexStart: number,
    vertexCount: number,
    position: Vec3,
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
          x: contours.bounds.min.x + position.x,
          y: contours.bounds.min.y + position.y,
          z: position.z
        },
        max: {
          x: contours.bounds.max.x + position.x,
          y: contours.bounds.max.y + position.y,
          z: position.z + depth
        }
      }
    };
  }

  private getContoursForGlyph(glyphId: number): GlyphContours {
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

    // Return empty contours for glyphs with no paths (e.g., space, zero-width characters)
    if (!collected) {
      return {
        glyphId,
        paths: [],
        bounds: {
          min: { x: 0, y: 0 },
          max: { x: 0, y: 0 }
        }
      };
    }

    return collected;
  }

  private tessellateGlyphCluster(
    paths: Path[],
    depth: number,
    isCFF: boolean
  ): GlyphData {
    const processedGeometry = this.tessellator.process(paths, true, isCFF);
    return this.extrudeAndPackage(processedGeometry, depth);
  }

  private extrudeAndPackage(processedGeometry: any, depth: number): GlyphData {
    const extrudedResult = this.extruder.extrude(
      processedGeometry,
      depth,
      this.loadedFont.upem
    );

    // Compute bounding box from vertices
    const vertices = extrudedResult.vertices;
    let minX = Infinity, minY = Infinity, minZ = Infinity;
    let maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;
    
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

    const vertexCount = extrudedResult.vertices.length / 3;
    const IndexArray = vertexCount < 65536 ? Uint16Array : Uint32Array;

    return {
      geometry: processedGeometry,
      vertices: new Float32Array(extrudedResult.vertices),
      normals: new Float32Array(extrudedResult.normals),
      indices: new IndexArray(extrudedResult.indices),
      bounds: { min: boundsMin, max: boundsMax },
      useCount: 1
    };
  }

  // Tessellate a glyph for caching
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
      isCFF
    );

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
    const planeBox = new Box3Core(
      new Vec3(planeBounds.min.x, planeBounds.min.y, planeBounds.min.z),
      new Vec3(planeBounds.max.x, planeBounds.max.y, planeBounds.max.z)
    );

    const glyphBox = new Box3Core(
      new Vec3(glyphBounds.min.x, glyphBounds.min.y, glyphBounds.min.z),
      new Vec3(glyphBounds.max.x, glyphBounds.max.y, glyphBounds.max.z)
    );

    planeBox.union(glyphBox);
    planeBounds.min.x = planeBox.min.x;
    planeBounds.min.y = planeBox.min.y;
    planeBounds.min.z = planeBox.min.z;
    planeBounds.max.x = planeBox.max.x;
    planeBounds.max.y = planeBox.max.y;
    planeBounds.max.z = planeBox.max.z;
  }

  public getCacheStats() {
    return this.cache.getStats();
  }

  public clearCache() {
    this.cache.clear();
    this.wordCache.clear();
  }
}
