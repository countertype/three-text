import type { Path, ProcessedGeometry } from '../types';
import * as libtess from 'libtess';
import { debugLogger } from '../../utils/DebugLogger';

export class Tessellator {
  public process(
    paths: Path[],
    removeOverlaps: boolean = true,
    isCFF: boolean = false
  ): ProcessedGeometry {
    if (paths.length === 0) {
      return { triangles: { vertices: [], indices: [] }, contours: [] };
    }

    const valid = paths.filter((path) => path.points.length >= 3);
    if (valid.length === 0) {
      return { triangles: { vertices: [], indices: [] }, contours: [] };
    }

    debugLogger.log(
      `Tessellator: removeOverlaps=${removeOverlaps}, processing ${valid.length} paths`
    );

    return this.tessellate(valid, removeOverlaps, isCFF);
  }

  private tessellate(
    paths: Path[],
    removeOverlaps: boolean,
    isCFF: boolean
  ): ProcessedGeometry {
    // TTF fonts have opposite winding from tessellator expectations
    const normalizedPaths =
      !isCFF && !removeOverlaps
        ? paths.map((p) => this.reverseWinding(p))
        : paths;

    let contours = this.pathsToContours(normalizedPaths);

    if (removeOverlaps) {
      debugLogger.log('Two-pass: boundary extraction then triangulation');

      // Extract boundaries to remove overlaps
      const boundaryResult = this.performTessellation(contours, 'boundary');
      if (!boundaryResult) {
        debugLogger.warn('libtess returned empty result from boundary pass');
        return { triangles: { vertices: [], indices: [] }, contours: [] };
      }

      // Convert boundary elements back to contours
      contours = this.boundaryToContours(boundaryResult);
      debugLogger.log(
        `Boundary pass created ${contours.length} contours. Starting triangulation pass.`
      );
    } else {
      debugLogger.log(`Single-pass triangulation for ${isCFF ? 'CFF' : 'TTF'}`);
    }

    // Triangulate the contours
    const triangleResult = this.performTessellation(contours, 'triangles');
    if (!triangleResult) {
      const warning = removeOverlaps
        ? 'libtess returned empty result from triangulation pass'
        : 'libtess returned empty result from single-pass triangulation';
      debugLogger.warn(warning);
      return { triangles: { vertices: [], indices: [] }, contours };
    }

    return {
      triangles: {
        vertices: triangleResult.vertices,
        indices: triangleResult.indices || []
      },
      contours
    };
  }

  private pathsToContours(paths: Path[]): number[][] {
    return paths.map((path) => {
      const contour: number[] = [];
      for (const point of path.points) {
        contour.push(point.x, point.y);
      }
      return contour;
    });
  }

  private performTessellation(
    contours: number[][],
    mode: 'triangles' | 'boundary'
  ): { vertices: number[]; indices?: number[]; contourIndices?: number[][] } | null {
    const tess = new libtess.GluTesselator();
    
    // Set winding rule to NON-ZERO
    tess.gluTessProperty(
      libtess.gluEnum.GLU_TESS_WINDING_RULE,
      libtess.windingRule.GLU_TESS_WINDING_NONZERO
    );

    const vertices: number[] = [];
    const indices: number[] = [];
    const contourIndices: number[][] = [];
    let currentContour: number[] = [];

    if (mode === 'boundary') {
      tess.gluTessProperty(libtess.gluEnum.GLU_TESS_BOUNDARY_ONLY, true);
    }

    if (mode === 'triangles') {
      tess.gluTessCallback(libtess.gluEnum.GLU_TESS_VERTEX_DATA, (data: any) => {
        indices.push(data);
      });
    } else {
      tess.gluTessCallback(libtess.gluEnum.GLU_TESS_BEGIN, () => {
        currentContour = [];
      });
      
      tess.gluTessCallback(libtess.gluEnum.GLU_TESS_VERTEX_DATA, (data: any) => {
        currentContour.push(data);
      });
      
      tess.gluTessCallback(libtess.gluEnum.GLU_TESS_END, () => {
        if (currentContour.length > 0) {
          contourIndices.push([...currentContour]);
        }
      });
    }

    tess.gluTessCallback(libtess.gluEnum.GLU_TESS_COMBINE, (coords: number[]) => {
      const idx = vertices.length / 2;
      vertices.push(coords[0], coords[1]);
      return idx;
    });

    tess.gluTessCallback(libtess.gluEnum.GLU_TESS_ERROR, (errno: number) => {
      debugLogger.warn(`libtess error: ${errno}`);
    });

    tess.gluTessNormal(0, 0, 1);

    tess.gluTessBeginPolygon(null);

    for (const contour of contours) {
      tess.gluTessBeginContour();
      
      for (let i = 0; i < contour.length; i += 2) {
        const idx = vertices.length / 2;
        vertices.push(contour[i], contour[i + 1]);
        tess.gluTessVertex([contour[i], contour[i + 1], 0], idx);
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

      // Ensure contour is closed for side wall generation
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

  private reverseWinding(path: Path): Path {
    return {
      ...path,
      points: [...path.points].reverse()
    };
  }
}
