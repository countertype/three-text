import type { Path, ProcessedGeometry } from '../types';
import { GluTesselator, GLU_TESS, WINDING } from 'libtess-ts';
import { logger } from '../../utils/Logger';
import { perfLogger } from '../../utils/PerformanceLogger';

export class Tessellator {
  public process(
    paths: Path[],
    removeOverlaps: boolean = true,
    isCFF: boolean = false,
    needsExtrusionContours: boolean = true
  ): ProcessedGeometry {
    if (paths.length === 0) {
      return { triangles: { vertices: [], indices: [] }, contours: [] };
    }

    const valid = paths.filter((path) => path.points.length >= 3);
    if (valid.length === 0) {
      return { triangles: { vertices: [], indices: [] }, contours: [] };
    }

    logger.log(
      `Tessellator: removeOverlaps=${removeOverlaps}, processing ${valid.length} paths`
    );

    return this.tessellate(
      valid,
      removeOverlaps,
      isCFF,
      needsExtrusionContours
    );
  }

  public processContours(
    contours: number[][],
    removeOverlaps: boolean = true,
    isCFF: boolean = false,
    needsExtrusionContours: boolean = true
  ): ProcessedGeometry {
    if (contours.length === 0) {
      return { triangles: { vertices: [], indices: [] }, contours: [] };
    }

    return this.tessellateContours(
      contours,
      removeOverlaps,
      isCFF,
      needsExtrusionContours
    );
  }

  private tessellate(
    paths: Path[],
    removeOverlaps: boolean,
    isCFF: boolean,
    needsExtrusionContours: boolean
  ): ProcessedGeometry {
    // libtess expects CCW winding; TTF outer contours are CW
    const needsWindingReversal = !isCFF && !removeOverlaps;
    let originalContours: number[][] | undefined;
    let tessContours: number[][];

    if (needsWindingReversal) {
      tessContours = this.pathsToContours(paths, true);
      if (removeOverlaps || needsExtrusionContours) {
        originalContours = this.pathsToContours(paths);
      }
    } else {
      originalContours = this.pathsToContours(paths);
      tessContours = originalContours;
    }

    let extrusionContours: number[][] = needsExtrusionContours
      ? needsWindingReversal
        ? tessContours
        : (originalContours ?? this.pathsToContours(paths))
      : [];

    if (removeOverlaps) {
      logger.log('Two-pass: boundary extraction then triangulation');

      perfLogger.start('Tessellator.boundaryPass', {
        contourCount: tessContours.length
      });
      const boundaryResult = this.performTessellation(
        originalContours!,
        'boundary'
      );
      perfLogger.end('Tessellator.boundaryPass');

      if (!boundaryResult) {
        logger.warn('libtess returned empty result from boundary pass');
        return { triangles: { vertices: [], indices: [] }, contours: [] };
      }

      // Boundary pass normalizes winding (outer CCW, holes CW)
      tessContours = this.boundaryToContours(boundaryResult);
      if (needsExtrusionContours) {
        extrusionContours = tessContours;
      }
      logger.log(
        `Boundary pass created ${tessContours.length} contours. Starting triangulation pass.`
      );
    } else {
      logger.log(`Single-pass triangulation for ${isCFF ? 'CFF' : 'TTF'}`);
    }

    perfLogger.start('Tessellator.triangulationPass', {
      contourCount: tessContours.length
    });
    const triangleResult = this.performTessellation(tessContours, 'triangles');
    perfLogger.end('Tessellator.triangulationPass');
    if (!triangleResult) {
      const warning = removeOverlaps
        ? 'libtess returned empty result from triangulation pass'
        : 'libtess returned empty result from single-pass triangulation';
      logger.warn(warning);
      return {
        triangles: { vertices: [], indices: [] },
        contours: extrusionContours
      };
    }

    return {
      triangles: {
        vertices: triangleResult.vertices,
        indices: triangleResult.indices || []
      },
      contours: extrusionContours,
      contoursAreBoundary: removeOverlaps
    };
  }

  private tessellateContours(
    contours: number[][],
    removeOverlaps: boolean,
    isCFF: boolean,
    needsExtrusionContours: boolean
  ): ProcessedGeometry {
    const needsWindingReversal = !isCFF && !removeOverlaps;
    let originalContours: number[][] | undefined;
    let tessContours: number[][];

    if (needsWindingReversal) {
      tessContours = this.reverseContours(contours);
      if (removeOverlaps || needsExtrusionContours) {
        originalContours = contours;
      }
    } else {
      originalContours = contours;
      tessContours = contours;
    }

    let extrusionContours: number[][] = needsExtrusionContours
      ? needsWindingReversal
        ? tessContours
        : (originalContours ?? contours)
      : [];

    if (removeOverlaps) {
      logger.log('Two-pass: boundary extraction then triangulation');

      perfLogger.start('Tessellator.boundaryPass', {
        contourCount: tessContours.length
      });
      const boundaryResult = this.performTessellation(
        originalContours!,
        'boundary'
      );
      perfLogger.end('Tessellator.boundaryPass');

      if (!boundaryResult) {
        logger.warn('libtess returned empty result from boundary pass');
        return { triangles: { vertices: [], indices: [] }, contours: [] };
      }

      tessContours = this.boundaryToContours(boundaryResult);
      if (needsExtrusionContours) {
        extrusionContours = tessContours;
      }
      logger.log(
        `Boundary pass created ${tessContours.length} contours. Starting triangulation pass.`
      );
    } else {
      logger.log(`Single-pass triangulation for ${isCFF ? 'CFF' : 'TTF'}`);
    }

    perfLogger.start('Tessellator.triangulationPass', {
      contourCount: tessContours.length
    });
    const triangleResult = this.performTessellation(tessContours, 'triangles');
    perfLogger.end('Tessellator.triangulationPass');
    if (!triangleResult) {
      const warning = removeOverlaps
        ? 'libtess returned empty result from triangulation pass'
        : 'libtess returned empty result from single-pass triangulation';
      logger.warn(warning);
      return {
        triangles: { vertices: [], indices: [] },
        contours: extrusionContours
      };
    }

    return {
      triangles: {
        vertices: triangleResult.vertices,
        indices: triangleResult.indices || []
      },
      contours: extrusionContours,
      contoursAreBoundary: removeOverlaps
    };
  }

  private pathsToContours(
    paths: Path[],
    reversePoints: boolean = false
  ): number[][] {
    const contours: number[][] = new Array(paths.length);

    for (let p = 0; p < paths.length; p++) {
      const points = paths[p].points;
      const pointCount = points.length;

      // Clipper-style paths can be explicitly closed by repeating the first point at the end
      // Normalize to a single closing vertex for stable side wall generation
      const isClosed =
        pointCount > 1 &&
        points[0].x === points[pointCount - 1].x &&
        points[0].y === points[pointCount - 1].y;
      const end = isClosed ? pointCount - 1 : pointCount;

      // +1 to append a closing vertex
      const contour = new Array((end + 1) * 2);
      let i = 0;

      if (reversePoints) {
        for (let k = end - 1; k >= 0; k--) {
          const pt = points[k];
          contour[i++] = pt.x;
          contour[i++] = pt.y;
        }
      } else {
        for (let k = 0; k < end; k++) {
          const pt = points[k];
          contour[i++] = pt.x;
          contour[i++] = pt.y;
        }
      }

      // Some glyphs omit closePath, leaving gaps in extruded side walls
      if (i >= 2) {
        contour[i++] = contour[0];
        contour[i++] = contour[1];
      }

      contours[p] = contour;
    }

    return contours;
  }

  private reverseContours(contours: number[][]): number[][] {
    const reversed: number[][] = new Array(contours.length);
    for (let i = 0; i < contours.length; i++) {
      reversed[i] = this.reverseContour(contours[i]);
    }
    return reversed;
  }

  private reverseContour(contour: number[]): number[] {
    const len = contour.length;
    if (len === 0) return [];

    const isClosed =
      len >= 4 &&
      contour[0] === contour[len - 2] &&
      contour[1] === contour[len - 1];
    const end = isClosed ? len - 2 : len;
    if (end === 0) return [];

    const reversed = new Array(end + 2);
    let out = 0;
    for (let i = end - 2; i >= 0; i -= 2) {
      reversed[out++] = contour[i];
      reversed[out++] = contour[i + 1];
    }
    if (out >= 2) {
      reversed[out++] = reversed[0];
      reversed[out++] = reversed[1];
    }
    return reversed;
  }

  private performTessellation(
    contours: number[][],
    mode: 'triangles' | 'boundary'
  ): {
    vertices: number[];
    indices?: number[];
    contourIndices?: number[][];
  } | null {
    const tess = new GluTesselator();

    tess.gluTessProperty(GLU_TESS.WINDING_RULE, WINDING.NONZERO);

    const vertices: number[] = [];
    const indices: number[] = [];
    const contourIndices: number[][] = [];
    let currentContour: number[] = [];

    if (mode === 'boundary') {
      tess.gluTessProperty(GLU_TESS.BOUNDARY_ONLY, 1);
    }

    if (mode === 'triangles') {
      tess.gluTessCallback(GLU_TESS.VERTEX_DATA, (data: any) => {
        indices.push(data);
      });
    } else {
      tess.gluTessCallback(GLU_TESS.BEGIN, () => {
        currentContour = [];
      });

      tess.gluTessCallback(GLU_TESS.VERTEX_DATA, (data: any) => {
        currentContour.push(data);
      });

      tess.gluTessCallback(GLU_TESS.END, () => {
        if (currentContour.length > 0) {
          contourIndices.push(currentContour);
        }
      });
    }

    tess.gluTessCallback(GLU_TESS.COMBINE, (coords: number[]) => {
      const idx = vertices.length / 2;
      vertices.push(coords[0], coords[1]);
      return idx;
    });

    tess.gluTessCallback(GLU_TESS.ERROR, (errno: number) => {
      logger.warn(`libtess error: ${errno}`);
    });

    tess.gluTessNormal(0, 0, 1);

    tess.gluTessBeginPolygon();

    for (const contour of contours) {
      tess.gluTessBeginContour();

      for (let i = 0; i < contour.length; i += 2) {
        const idx = vertices.length / 2;
        vertices.push(contour[i], contour[i + 1]);
        tess.gluTessVertex([contour[i], contour[i + 1]], idx);
      }

      tess.gluTessEndContour();
    }

    tess.gluTessEndPolygon();

    if (vertices.length === 0) {
      return null;
    }

    if (mode === 'triangles') {
      return { vertices, indices };
    } else {
      return { vertices, contourIndices };
    }
  }

  private boundaryToContours(boundaryResult: {
    vertices: number[];
    contourIndices?: number[][];
  }): number[][] {
    if (!boundaryResult.contourIndices) {
      return [];
    }

    const contours: number[][] = [];

    for (const indices of boundaryResult.contourIndices) {
      const contour: number[] = [];

      for (const idx of indices) {
        const vertIdx = idx * 2;
        contour.push(
          boundaryResult.vertices[vertIdx],
          boundaryResult.vertices[vertIdx + 1]
        );
      }

      if (contour.length > 2) {
        if (
          contour[0] !== contour[contour.length - 2] ||
          contour[1] !== contour[contour.length - 1]
        ) {
          contour.push(contour[0], contour[1]);
        }
      }
      contours.push(contour);
    }

    return contours;
  }

  // Check if contours need winding normalization via boundary pass
  // Returns false if topology is simple enough to skip the expensive pass
  private needsWindingNormalization(contours: number[][]): boolean {
    if (contours.length === 0) return false;

    // Heuristic 1: Single contour never needs normalization
    if (contours.length === 1) return false;

    // Heuristic 2: All same winding = all outers, no holes
    // Compute signed areas
    let firstSign: number | null = null;
    for (const contour of contours) {
      const area = this.signedArea(contour);
      const sign = area >= 0 ? 1 : -1;

      if (firstSign === null) {
        firstSign = sign;
      } else if (sign !== firstSign) {
        // Mixed winding detected → might have holes or complex topology
        return true;
      }
    }

    // All same winding → simple topology, no normalization needed
    return false;
  }

  // Compute signed area (CCW = positive, CW = negative)
  private signedArea(contour: number[]): number {
    let area = 0;
    const len = contour.length;
    if (len < 6) return 0; // Need at least 3 points

    for (let i = 0; i < len; i += 2) {
      const x1 = contour[i];
      const y1 = contour[i + 1];
      const x2 = contour[(i + 2) % len];
      const y2 = contour[(i + 3) % len];
      area += x1 * y2 - x2 * y1;
    }

    return area / 2;
  }
}
