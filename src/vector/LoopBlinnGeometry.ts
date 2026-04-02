import type { BoundingBox } from '../utils/vectors';

const CONTOUR_EPSILON = 0.001;
const CURVE_LINEARITY_EPSILON = 1e-5;

export interface QuadraticSegment {
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

export interface VectorContour {
  vertices: ContourVertex[];
  segments: QuadraticSegment[];
}

export interface VectorGlyphAttributes {
  glyphCenter: Float32Array;
  glyphIndex: Float32Array;
  glyphProgress: Float32Array;
  glyphLineIndex: Float32Array;
  glyphBaselineY: Float32Array;
}

export interface GlyphRange {
  interiorIndexStart: number;
  interiorIndexCount: number;
  curveVertexStart: number;
  curveVertexCount: number;
}

export interface VectorGeometryData {
  interiorPositions: Float32Array;
  interiorIndices: Uint32Array;
  curvePositions: Float32Array;
  fillPositions: Float32Array;
  fillIndices: Uint32Array;
  glyphRanges: GlyphRange[];
  interiorGlyphAttrs?: VectorGlyphAttributes;
  curveGlyphAttrs?: VectorGlyphAttributes;
  fillGlyphAttrs?: VectorGlyphAttributes;
  planeBounds: BoundingBox;
  stats: {
    glyphCount: number;
    contourCount: number;
    interiorTriangleCount: number;
    curveTriangleCount: number;
  };
}

export interface LoopBlinnGlyphInput {
  offsetX: number;
  offsetY: number;
  segments: QuadraticSegment[];
  bounds: { minX: number; minY: number; maxX: number; maxY: number };
  lineIndex: number;
  baselineY: number;
}

export interface LoopBlinnInput {
  glyphs: LoopBlinnGlyphInput[];
  planeBounds: BoundingBox;
}

function nearlyEqual(a: number, b: number, epsilon: number): boolean {
  return Math.abs(a - b) < epsilon;
}

export function extractContours(segments: QuadraticSegment[]): VectorContour[] {
  const contours: VectorContour[] = [];
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

function fillGlyphAttrs(
  center: [number, number, number],
  idx: number,
  progress: number,
  lineIdx: number,
  baselineY: number,
  vertCount: number,
  gc: number[], gi: number[], gp: number[], gl: number[], gb: number[]
): void {
  for (let v = 0; v < vertCount; v++) {
    gc.push(center[0], center[1], center[2]);
    gi.push(idx);
    gp.push(progress);
    gl.push(lineIdx);
    gb.push(baselineY);
  }
}

function packAttrs(
  gc: number[], gi: number[], gp: number[], gl: number[], gb: number[]
): VectorGlyphAttributes {
  return {
    glyphCenter: new Float32Array(gc),
    glyphIndex: new Float32Array(gi),
    glyphProgress: new Float32Array(gp),
    glyphLineIndex: new Float32Array(gl),
    glyphBaselineY: new Float32Array(gb)
  };
}

export function buildVectorGeometry(
  input: LoopBlinnInput
): VectorGeometryData {
  const interiorPositions: number[] = [];
  const interiorIndices: number[] = [];
  const curvePositions: number[] = [];

  const iGC: number[] = [], iGI: number[] = [], iGP: number[] = [],
        iGL: number[] = [], iGB: number[] = [];
  const cGC: number[] = [], cGI: number[] = [], cGP: number[] = [],
        cGL: number[] = [], cGB: number[] = [];
  const fGC: number[] = [], fGI: number[] = [], fGP: number[] = [],
        fGL: number[] = [], fGB: number[] = [];

  const glyphCount = input.glyphs.length;
  let contourCount = 0;
  let interiorTriangleCount = 0;
  let curveTriangleCount = 0;
  const glyphRanges: GlyphRange[] = [];

  const fillPositions = new Float32Array(glyphCount * 12);
  const fillIndices = new Uint32Array(glyphCount * 6);

  for (let i = 0; i < glyphCount; i++) {
    const glyph = input.glyphs[i];
    const { minX, minY, maxX, maxY } = glyph.bounds;
    const cx = glyph.offsetX + (minX + maxX) * 0.5;
    const cy = glyph.offsetY + (minY + maxY) * 0.5;
    const center: [number, number, number] = [cx, cy, 0];
    const progress = glyphCount > 1 ? i / (glyphCount - 1) : 0;

    const intIdxStart = interiorIndices.length;
    const curveVertStart = curvePositions.length / 3;

    const contours = extractContours(glyph.segments);
    contourCount += contours.length;

    for (const contour of contours) {
      const intVertsBefore = interiorPositions.length / 3;
      interiorTriangleCount += triangulateContourFan(
        contour.vertices,
        glyph.offsetX,
        glyph.offsetY,
        interiorPositions,
        interiorIndices
      );
      const intVertsAfter = interiorPositions.length / 3;
      fillGlyphAttrs(
        center,
        i,
        progress,
        glyph.lineIndex,
        glyph.baselineY,
        intVertsAfter - intVertsBefore,
        iGC,
        iGI,
        iGP,
        iGL,
        iGB
      );

      for (const segment of contour.segments) {
        if (shouldSkipCurveSegment(segment)) continue;

        curvePositions.push(
          glyph.offsetX + segment.p0x,
          glyph.offsetY + segment.p0y,
          0,
          glyph.offsetX + segment.p1x,
          glyph.offsetY + segment.p1y,
          0,
          glyph.offsetX + segment.p2x,
          glyph.offsetY + segment.p2y,
          0
        );
        curveTriangleCount++;
        fillGlyphAttrs(
          center,
          i,
          progress,
          glyph.lineIndex,
          glyph.baselineY,
          3,
          cGC,
          cGI,
          cGP,
          cGL,
          cGB
        );
      }
    }

    glyphRanges.push({
      interiorIndexStart: intIdxStart,
      interiorIndexCount: interiorIndices.length - intIdxStart,
      curveVertexStart: curveVertStart,
      curveVertexCount: (curvePositions.length / 3) - curveVertStart
    });

    const fp = i * 12;
    fillPositions[fp]     = glyph.offsetX + minX;
    fillPositions[fp + 1] = glyph.offsetY + minY;
    fillPositions[fp + 2] = 0;
    fillPositions[fp + 3] = glyph.offsetX + maxX;
    fillPositions[fp + 4] = glyph.offsetY + minY;
    fillPositions[fp + 5] = 0;
    fillPositions[fp + 6] = glyph.offsetX + maxX;
    fillPositions[fp + 7] = glyph.offsetY + maxY;
    fillPositions[fp + 8] = 0;
    fillPositions[fp + 9]  = glyph.offsetX + minX;
    fillPositions[fp + 10] = glyph.offsetY + maxY;
    fillPositions[fp + 11] = 0;

    fillGlyphAttrs(
      center,
      i,
      progress,
      glyph.lineIndex,
      glyph.baselineY,
      4,
      fGC,
      fGI,
      fGP,
      fGL,
      fGB
    );

    const fi = i * 6;
    const fv = i * 4;
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
    glyphRanges,
    interiorGlyphAttrs: packAttrs(iGC, iGI, iGP, iGL, iGB),
    curveGlyphAttrs: packAttrs(cGC, cGI, cGP, cGL, cGB),
    fillGlyphAttrs: packAttrs(fGC, fGI, fGP, fGL, fGB),
    planeBounds: input.planeBounds,
    stats: {
      glyphCount,
      contourCount,
      interiorTriangleCount,
      curveTriangleCount
    }
  };
}
