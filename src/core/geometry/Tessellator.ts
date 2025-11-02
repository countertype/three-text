import type { Path, ProcessedGeometry } from '../types';
import { tesselate, WINDING, ELEMENT } from 'tess2-ts';
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
      const boundaryResult = this.performTessellation(
        contours,
        ELEMENT.BOUNDARY_CONTOURS
      );
      if (!boundaryResult) {
        debugLogger.warn('Tess2 returned empty result from boundary pass');
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

    // Triangulate the (possibly cleaned) contours
    const triangleResult = this.performTessellation(contours, ELEMENT.POLYGONS);
    if (!triangleResult) {
      const warning = removeOverlaps
        ? 'Tess2 returned empty result from triangulation pass'
        : 'Tess2 returned empty result from single-pass triangulation';
      debugLogger.warn(warning);
      return { triangles: { vertices: [], indices: [] }, contours };
    }

    return {
      triangles: {
        vertices: Array.from(triangleResult.vertices),
        indices: Array.from(triangleResult.elements)
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

  private performTessellation(contours: number[][], elementType: number) {
    const result = tesselate({
      contours,
      windingRule: WINDING.NONZERO,
      elementType,
      polySize: 3,
      vertexSize: 2,
      strict: false
    });

    return result?.vertices && result?.elements ? result : null;
  }

  private boundaryToContours(boundaryResult: {
    vertices: number[];
    elements: number[];
  }): number[][] {
    const contours: number[][] = [];

    // Elements format: [start_index, vertex_count, start_index, vertex_count, ...]
    for (let i = 0; i < boundaryResult.elements.length; i += 2) {
      const start = boundaryResult.elements[i];
      const count = boundaryResult.elements[i + 1];
      const contour: number[] = [];

      for (let j = 0; j < count; j++) {
        const idx = (start + j) * 2;
        contour.push(
          boundaryResult.vertices[idx],
          boundaryResult.vertices[idx + 1]
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
