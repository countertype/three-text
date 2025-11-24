import { Vec2 } from '../vectors';
import type { ProcessedGeometry, Triangles } from '../types';

export interface ExtrusionResult {
  vertices: number[];
  normals: number[];
  indices: number[];
}

export class Extruder {
  constructor() {}

  public extrude(
    geometry: ProcessedGeometry,
    depth: number = 0,
    unitsPerEm: number
  ): ExtrusionResult {
    const vertices: number[] = [];
    const normals: number[] = [];
    const indices: number[] = [];

    if (depth === 0) {
      this.addFlatFaces(geometry.triangles, vertices, normals, indices);
    } else {
      this.addFrontAndBackFaces(
        geometry.triangles,
        vertices,
        normals,
        indices,
        depth,
        unitsPerEm
      );

      for (const contour of geometry.contours) {
        this.addSideWalls(contour, vertices, normals, indices, depth);
      }
    }

    return { vertices, normals, indices };
  }

  private addFlatFaces(
    triangulatedData: Triangles,
    vertices: number[],
    normals: number[],
    indices: number[]
  ): void {
    const baseIndex = vertices.length / 3;
    const points = triangulatedData.vertices;
    const triangleIndices = triangulatedData.indices;

    for (let i = 0; i < points.length; i += 2) {
      vertices.push(points[i], points[i + 1], 0);
      normals.push(0, 0, -1);
    }

    // Add triangle indices
    for (let i = 0; i < triangleIndices.length; i++) {
      indices.push(baseIndex + triangleIndices[i]);
    }
  }

  private addFrontAndBackFaces(
    triangulatedData: Triangles,
    vertices: number[],
    normals: number[],
    indices: number[],
    depth: number,
    unitsPerEm: number
  ): void {
    const baseIndex = vertices.length / 3;
    const points = triangulatedData.vertices;
    const triangleIndices = triangulatedData.indices;

    for (let i = 0; i < points.length; i += 2) {
      vertices.push(points[i], points[i + 1], 0);
      normals.push(0, 0, -1);
    }

    // Minimum offset to prevent z-fighting between front and back faces
    const minBackOffset = unitsPerEm * 0.000025;
    const backZ = depth <= minBackOffset ? minBackOffset : depth;

    for (let i = 0; i < points.length; i += 2) {
      vertices.push(points[i], points[i + 1], backZ);
      normals.push(0, 0, 1);
    }

    const numPoints = points.length / 2;

    for (let i = 0; i < triangleIndices.length; i++) {
      indices.push(baseIndex + triangleIndices[i]);
    }

    for (let i = triangleIndices.length - 1; i >= 0; i--) {
      indices.push(baseIndex + triangleIndices[i] + numPoints);
    }
  }

  private addSideWalls(
    points: number[],
    vertices: number[],
    normals: number[],
    indices: number[],
    depth: number
  ): void {
    for (let i = 0; i < points.length - 2; i += 2) {
      const p0x = points[i];
      const p0y = points[i + 1];
      const p1x = points[i + 2];
      const p1y = points[i + 3];

      const edge = new Vec2(p1x - p0x, p1y - p0y);
      const normal = new Vec2(edge.y, -edge.x).normalize();

      const wallBaseIndex = vertices.length / 3;
      vertices.push(p0x, p0y, 0, p1x, p1y, 0, p0x, p0y, depth, p1x, p1y, depth);

      normals.push(
        normal.x,
        normal.y,
        0,
        normal.x,
        normal.y,
        0,
        normal.x,
        normal.y,
        0,
        normal.x,
        normal.y,
        0
      );

      indices.push(
        wallBaseIndex,
        wallBaseIndex + 1,
        wallBaseIndex + 2,
        wallBaseIndex + 1,
        wallBaseIndex + 3,
        wallBaseIndex + 2
      );
    }
  }
}
