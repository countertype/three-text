import type { ProcessedGeometry } from '../../core/types';

export interface ExtrusionResult {
  vertices: Float32Array;
  normals: Float32Array;
  indices: Uint32Array;
}

export class Extruder {
  constructor() {}

  public extrude(
    geometry: ProcessedGeometry,
    depth: number = 0,
    unitsPerEm: number
  ): ExtrusionResult {
    const points = geometry.triangles.vertices;
    const triangleIndices = geometry.triangles.indices;
    const contours = geometry.contours;
    const contoursAreBoundary = geometry.contoursAreBoundary === true;
    const pointLen = points.length;
    const numPoints = pointLen / 2;

    // Use boundary contours for side walls when available
    let boundaryEdges: number[] = [];
    let sideEdgeCount = 0;
    let useContours = false;
    if (depth !== 0) {
      if (contoursAreBoundary && contours.length > 0) {
        useContours = true;
        for (const contour of contours) {
          const contourPointCount = contour.length >> 1;
          if (contourPointCount >= 2) {
            sideEdgeCount += contourPointCount - 1;
          }
        }
      } else {
        // Use a directionless key (min/max) to detect shared edges.
        // Store the directed edge (a->b) and mark as null when seen twice.
        // Keys pack two indices via multiplication (21 bits each, exact in
        // a float64) — 16-bit shift packing silently collided past 65,535
        // vertices per tessellation.
        const PACK = 0x200000; // 2^21
        const edgeMap = new Map<number, number | null>();

        const triLen = triangleIndices.length;
        for (let i = 0; i < triLen; i += 3) {
          const a = triangleIndices[i];
          const b = triangleIndices[i + 1];
          const c = triangleIndices[i + 2];

          let key: number, packed: number;

          if (a < b) {
            key = a * PACK + b;
          } else {
            key = b * PACK + a;
          }
          packed = a * PACK + b;
          let data = edgeMap.get(key);
          if (data === undefined) {
            edgeMap.set(key, packed);
          } else if (data !== null) {
            edgeMap.set(key, null);
          }

          if (b < c) {
            key = b * PACK + c;
          } else {
            key = c * PACK + b;
          }
          packed = b * PACK + c;
          data = edgeMap.get(key);
          if (data === undefined) {
            edgeMap.set(key, packed);
          } else if (data !== null) {
            edgeMap.set(key, null);
          }

          if (c < a) {
            key = c * PACK + a;
          } else {
            key = a * PACK + c;
          }
          packed = c * PACK + a;
          data = edgeMap.get(key);
          if (data === undefined) {
            edgeMap.set(key, packed);
          } else if (data !== null) {
            edgeMap.set(key, null);
          }
        }

        boundaryEdges = [];
        for (const packedEdge of edgeMap.values()) {
          if (packedEdge === null) continue;
          boundaryEdges.push(Math.floor(packedEdge / PACK), packedEdge % PACK);
        }
        sideEdgeCount = boundaryEdges.length >> 1;
      }
    }

    const sideVertexCount = sideEdgeCount * 4;
    const baseVertexCount = depth === 0 ? numPoints : numPoints * 2;
    const vertexCount = baseVertexCount + sideVertexCount;

    const vertices = new Float32Array(vertexCount * 3);
    const normals = new Float32Array(vertexCount * 3);

    const indexCount =
      depth === 0
        ? triangleIndices.length
        : triangleIndices.length * 2 + sideEdgeCount * 6;
    const indices = new Uint32Array(indexCount);

    if (depth === 0) {
      for (let p = 0, vPos = 0; p < pointLen; p += 2, vPos += 3) {
        vertices[vPos] = points[p];
        vertices[vPos + 1] = points[p + 1];
        vertices[vPos + 2] = 0;

        normals[vPos] = 0;
        normals[vPos + 1] = 0;
        normals[vPos + 2] = 1;
      }

      indices.set(triangleIndices);

      return { vertices, normals, indices };
    }

    const minBackOffset = unitsPerEm * 0.000025;
    const backZ = depth <= minBackOffset ? minBackOffset : depth;

    const backOffset = numPoints * 3;
    for (let p = 0, vi = 0, base0 = 0; p < pointLen; p += 2, vi++, base0 += 3) {
      const x = points[p];
      const y = points[p + 1];

      // Cap at z=0
      vertices[base0] = x;
      vertices[base0 + 1] = y;
      vertices[base0 + 2] = 0;
      normals[base0] = 0;
      normals[base0 + 1] = 0;
      normals[base0 + 2] = -1;

      // Cap at z=depth
      const baseD = base0 + backOffset;
      vertices[baseD] = x;
      vertices[baseD + 1] = y;
      vertices[baseD + 2] = backZ;
      normals[baseD] = 0;
      normals[baseD + 1] = 0;
      normals[baseD + 2] = 1;
    }

    // Front cap faces -Z, reverse winding from libtess CCW output
    const triLen = triangleIndices.length;
    for (let i = 0; i < triLen; i++) {
      indices[i] = triangleIndices[triLen - 1 - i];
    }

    // Back cap faces +Z, use original winding
    for (let i = 0; i < triLen; i++) {
      indices[triLen + i] = triangleIndices[i] + numPoints;
    }

    let nextVertex = numPoints * 2;
    let idxPos = triLen * 2;
    if (useContours) {
      for (const contour of contours) {
        const contourLen = contour.length;
        if (contourLen < 4) continue;

        for (let i = 0; i < contourLen - 2; i += 2) {
          const p0x = contour[i];
          const p0y = contour[i + 1];
          const p1x = contour[i + 2];
          const p1y = contour[i + 3];

          const ex = p1x - p0x;
          const ey = p1y - p0y;
          const lenSq = ex * ex + ey * ey;
          let nx = 0;
          let ny = 0;
          if (lenSq > 1e-10) {
            const invLen = 1 / Math.sqrt(lenSq);
            nx = ey * invLen;
            ny = -ex * invLen;
          }

          const base = nextVertex * 3;

          vertices[base] = p0x;
          vertices[base + 1] = p0y;
          vertices[base + 2] = 0;

          vertices[base + 3] = p1x;
          vertices[base + 4] = p1y;
          vertices[base + 5] = 0;

          vertices[base + 6] = p0x;
          vertices[base + 7] = p0y;
          vertices[base + 8] = backZ;

          vertices[base + 9] = p1x;
          vertices[base + 10] = p1y;
          vertices[base + 11] = backZ;

          normals[base] = nx;
          normals[base + 1] = ny;
          normals[base + 2] = 0;

          normals[base + 3] = nx;
          normals[base + 4] = ny;
          normals[base + 5] = 0;

          normals[base + 6] = nx;
          normals[base + 7] = ny;
          normals[base + 8] = 0;

          normals[base + 9] = nx;
          normals[base + 10] = ny;
          normals[base + 11] = 0;

          const baseVertex = nextVertex;
          indices[idxPos] = baseVertex;
          indices[idxPos + 1] = baseVertex + 1;
          indices[idxPos + 2] = baseVertex + 2;
          indices[idxPos + 3] = baseVertex + 1;
          indices[idxPos + 4] = baseVertex + 3;
          indices[idxPos + 5] = baseVertex + 2;
          idxPos += 6;

          nextVertex += 4;
        }
      }
    } else {
      for (let e = 0; e < sideEdgeCount; e++) {
        const edgeIndex = e << 1;
        const u = boundaryEdges[edgeIndex];
        const v = boundaryEdges[edgeIndex + 1];
        const u2 = u << 1;
        const v2 = v << 1;
        const p0x = points[u2];
        const p0y = points[u2 + 1];
        const p1x = points[v2];
        const p1y = points[v2 + 1];

        const ex = p1x - p0x;
        const ey = p1y - p0y;
        const lenSq = ex * ex + ey * ey;
        let nx = 0;
        let ny = 0;
        if (lenSq > 1e-10) {
          const invLen = 1 / Math.sqrt(lenSq);
          nx = ey * invLen;
          ny = -ex * invLen;
        }

        const base = nextVertex * 3;

        vertices[base] = p0x;
        vertices[base + 1] = p0y;
        vertices[base + 2] = 0;

        vertices[base + 3] = p1x;
        vertices[base + 4] = p1y;
        vertices[base + 5] = 0;

        vertices[base + 6] = p0x;
        vertices[base + 7] = p0y;
        vertices[base + 8] = backZ;

        vertices[base + 9] = p1x;
        vertices[base + 10] = p1y;
        vertices[base + 11] = backZ;

        normals[base] = nx;
        normals[base + 1] = ny;
        normals[base + 2] = 0;

        normals[base + 3] = nx;
        normals[base + 4] = ny;
        normals[base + 5] = 0;

        normals[base + 6] = nx;
        normals[base + 7] = ny;
        normals[base + 8] = 0;

        normals[base + 9] = nx;
        normals[base + 10] = ny;
        normals[base + 11] = 0;

        const baseVertex = nextVertex;
        indices[idxPos] = baseVertex;
        indices[idxPos + 1] = baseVertex + 1;
        indices[idxPos + 2] = baseVertex + 2;
        indices[idxPos + 3] = baseVertex + 1;
        indices[idxPos + 4] = baseVertex + 3;
        indices[idxPos + 5] = baseVertex + 2;
        idxPos += 6;

        nextVertex += 4;
      }
    }

    return { vertices, normals, indices };
  }
}
