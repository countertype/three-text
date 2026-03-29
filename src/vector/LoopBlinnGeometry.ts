import type { BoundingBox } from '../utils/vectors';
import type { VectorTextGeometryInfo } from '../core/types';

const CONTOUR_EPSILON = 0.001;
const CURVE_LINEARITY_EPSILON = 1e-5;

interface QuadraticSegment {
  p0x: number;
  p0y: number;
  p1x: number;
  p1y: number;
  p2x: number;
  p2y: number;
}

interface ContourVertex {
  x: number;
  y: number;
}

export interface LoopBlinnContour {
  vertices: ContourVertex[];
  segments: QuadraticSegment[];
}

export interface LoopBlinnMeshData {
  interiorPositions: Float32Array;
  interiorIndices: Uint32Array;
  curvePositions: Float32Array;
  fillPositions: Float32Array;
  fillIndices: Uint32Array;
  planeBounds: BoundingBox;
  stats: {
    glyphCount: number;
    contourCount: number;
    interiorTriangleCount: number;
    curveTriangleCount: number;
  };
}

function nearlyEqual(a: number, b: number, epsilon: number): boolean {
  return Math.abs(a - b) < epsilon;
}

function decodeGlyphQuadraticSegments(
  vectorGeo: VectorTextGeometryInfo,
  glyphIndex: number
): QuadraticSegment[] {
  const output: QuadraticSegment[] = [];
  const segData = vectorGeo.segments.data;
  const texelsPerSegment = vectorGeo.segmentTexelsPerSegment;
  const segStart = vectorGeo.instances.segmentRange[glyphIndex * 2];
  const segCount = vectorGeo.instances.segmentRange[glyphIndex * 2 + 1];

  for (let segmentIndex = 0; segmentIndex < segCount; segmentIndex++) {
    const texelBase = (segStart + segmentIndex) * texelsPerSegment * 4;
    output.push({
      p0x: segData[texelBase],
      p0y: segData[texelBase + 1],
      p1x: segData[texelBase + 2],
      p1y: segData[texelBase + 3],
      p2x: segData[texelBase + 4],
      p2y: segData[texelBase + 5]
    });
  }

  return output;
}

export function extractContours(segments: QuadraticSegment[]): LoopBlinnContour[] {
  const contours: LoopBlinnContour[] = [];
  let contourVertices: ContourVertex[] = [];
  let contourSegments: QuadraticSegment[] = [];

  const pushCurrentContour = (): void => {
    if (contourVertices.length < 3) {
      contourVertices = [];
      contourSegments = [];
      return;
    }

    const first = contourVertices[0];
    const last = contourVertices[contourVertices.length - 1];
    if (
      nearlyEqual(first.x, last.x, CONTOUR_EPSILON) &&
      nearlyEqual(first.y, last.y, CONTOUR_EPSILON)
    ) {
      contourVertices.pop();
    }

    if (contourVertices.length >= 3) {
      contours.push({
        vertices: contourVertices,
        segments: contourSegments
      });
    }

    contourVertices = [];
    contourSegments = [];
  };

  for (const segment of segments) {
    if (contourVertices.length === 0) {
      contourVertices.push(
        { x: segment.p0x, y: segment.p0y },
        { x: segment.p2x, y: segment.p2y }
      );
      contourSegments.push(segment);
      continue;
    }

    const previousEnd = contourVertices[contourVertices.length - 1];
    if (
      nearlyEqual(segment.p0x, previousEnd.x, CONTOUR_EPSILON) &&
      nearlyEqual(segment.p0y, previousEnd.y, CONTOUR_EPSILON)
    ) {
      contourVertices.push({ x: segment.p2x, y: segment.p2y });
      contourSegments.push(segment);
      continue;
    }

    pushCurrentContour();
    contourVertices.push(
      { x: segment.p0x, y: segment.p0y },
      { x: segment.p2x, y: segment.p2y }
    );
    contourSegments.push(segment);
  }

  pushCurrentContour();
  return contours;
}

function triangulateContourFan(
  vertices: ContourVertex[],
  offsetX: number,
  offsetY: number,
  positions: number[],
  indices: number[]
): number {
  const baseIndex = positions.length / 3;

  for (const vertex of vertices) {
    positions.push(vertex.x + offsetX, vertex.y + offsetY, 0);
  }

  if (vertices.length < 3) return 0;

  for (let index = 1; index < vertices.length - 1; index++) {
    indices.push(baseIndex, baseIndex + index, baseIndex + index + 1);
  }

  return vertices.length - 2;
}

function shouldSkipCurveSegment(segment: QuadraticSegment): boolean {
  const dx = segment.p2x - segment.p0x;
  const dy = segment.p2y - segment.p0y;
  const lenSq = dx * dx + dy * dy;
  if (lenSq <= 0) return true;

  const cross = (segment.p1x - segment.p0x) * dy - (segment.p1y - segment.p0y) * dx;
  return Math.abs(cross) < CURVE_LINEARITY_EPSILON * lenSq;
}

export function buildLoopBlinnMeshData(
  vectorGeo: VectorTextGeometryInfo
): LoopBlinnMeshData {
  const interiorPositions: number[] = [];
  const interiorIndices: number[] = [];
  const curvePositions: number[] = [];

  const glyphCount = vectorGeo.instances.glyphIndex.length;
  let contourCount = 0;
  let interiorTriangleCount = 0;
  let curveTriangleCount = 0;

  // Per-glyph fill quads: 4 verts (12 floats) + 6 indices per glyph
  const fillPositions = new Float32Array(glyphCount * 12);
  const fillIndices = new Uint32Array(glyphCount * 6);

  for (let glyphIndex = 0; glyphIndex < glyphCount; glyphIndex++) {
    const glyphOffsetX = vectorGeo.instances.position[glyphIndex * 3];
    const glyphOffsetY = vectorGeo.instances.position[glyphIndex * 3 + 1];
    const segments = decodeGlyphQuadraticSegments(vectorGeo, glyphIndex);
    const contours = extractContours(segments);
    contourCount += contours.length;

    for (const contour of contours) {
      interiorTriangleCount += triangulateContourFan(
        contour.vertices,
        glyphOffsetX,
        glyphOffsetY,
        interiorPositions,
        interiorIndices
      );

      for (const segment of contour.segments) {
        if (shouldSkipCurveSegment(segment)) continue;

        curvePositions.push(
          glyphOffsetX + segment.p0x,
          glyphOffsetY + segment.p0y,
          0,
          glyphOffsetX + segment.p1x,
          glyphOffsetY + segment.p1y,
          0,
          glyphOffsetX + segment.p2x,
          glyphOffsetY + segment.p2y,
          0
        );
        curveTriangleCount++;
      }
    }

    // Fill quad from per-glyph instance bounds
    const bMinX = vectorGeo.instances.bounds[glyphIndex * 4];
    const bMinY = vectorGeo.instances.bounds[glyphIndex * 4 + 1];
    const bMaxX = vectorGeo.instances.bounds[glyphIndex * 4 + 2];
    const bMaxY = vectorGeo.instances.bounds[glyphIndex * 4 + 3];
    const fp = glyphIndex * 12;
    fillPositions[fp]     = glyphOffsetX + bMinX;
    fillPositions[fp + 1] = glyphOffsetY + bMinY;
    fillPositions[fp + 2] = 0;
    fillPositions[fp + 3] = glyphOffsetX + bMaxX;
    fillPositions[fp + 4] = glyphOffsetY + bMinY;
    fillPositions[fp + 5] = 0;
    fillPositions[fp + 6] = glyphOffsetX + bMaxX;
    fillPositions[fp + 7] = glyphOffsetY + bMaxY;
    fillPositions[fp + 8] = 0;
    fillPositions[fp + 9]  = glyphOffsetX + bMinX;
    fillPositions[fp + 10] = glyphOffsetY + bMaxY;
    fillPositions[fp + 11] = 0;

    const fi = glyphIndex * 6;
    const fv = glyphIndex * 4;
    fillIndices[fi]     = fv;
    fillIndices[fi + 1] = fv + 1;
    fillIndices[fi + 2] = fv + 2;
    fillIndices[fi + 3] = fv;
    fillIndices[fi + 4] = fv + 2;
    fillIndices[fi + 5] = fv + 3;
  }

  return {
    interiorPositions: new Float32Array(interiorPositions),
    interiorIndices: new Uint32Array(interiorIndices),
    curvePositions: new Float32Array(curvePositions),
    fillPositions,
    fillIndices,
    planeBounds: {
      min: {
        x: vectorGeo.planeBounds.min.x,
        y: vectorGeo.planeBounds.min.y,
        z: vectorGeo.planeBounds.min.z
      },
      max: {
        x: vectorGeo.planeBounds.max.x,
        y: vectorGeo.planeBounds.max.y,
        z: vectorGeo.planeBounds.max.z
      }
    },
    stats: {
      glyphCount,
      contourCount,
      interiorTriangleCount,
      curveTriangleCount
    }
  };
}
