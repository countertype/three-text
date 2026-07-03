// Pure Slug algorithm types, no dependency on three-text internals
// Based on Eric Lengyel's reference implementation (MIT License, 2017)

export interface QuadCurve {
  p1: [number, number];
  p2: [number, number];
  p3: [number, number];
}

export type SlugVec2 = [number, number];

export interface SlugShape {
  curves: QuadCurve[];
  bounds: [number, number, number, number]; // minX, minY, maxX, maxY
  // Optional dedup key. Shapes sharing a key must have translation-equivalent
  // curves; the packer stores texels once per key, so texture size is
  // O(unique keys) rather than O(shapes)
  key?: number | string;
}

export interface SlugPackedTexture {
  data: Float32Array | Uint32Array;
  width: number;
  height: number;
}

export interface SlugGPUData {
  curveTexture: SlugPackedTexture & { data: Float32Array };
  bandTexture: SlugPackedTexture & { data: Uint32Array };
  // 5 attribs x 4 components x 4 verts per shape, tightly packed per-shape
  vertices: Float32Array;
  indices: Uint16Array;
  shapeCount: number;
}

export interface SlugPackOptions {
  bandCount?: number; // bands per axis per glyph (default: 16)
  evenOdd?: boolean;  // use even-odd fill rule (default: false, nonzero)
}
