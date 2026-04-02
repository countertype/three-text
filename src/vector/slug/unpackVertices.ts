// Restructures the tightly-packed vertex buffer from SlugPacker into
// separate per-attribute arrays for GPU attribute binding

import type { SlugGPUData } from './types';

const FLOATS_PER_VERT = 20;

export interface SlugVertexArrays {
  positions: Float32Array;
  texcoords: Float32Array;
  bandings: Float32Array;
  glyphData: Float32Array;
  colors: Float32Array;
  glyphCenters: Float32Array;
  glyphIndices: Float32Array;
}

export function unpackSlugVertices(gpuData: SlugGPUData): SlugVertexArrays {
  const vertCount = gpuData.shapeCount * 4;
  const positions = new Float32Array(vertCount * 3);
  const texcoords = new Float32Array(vertCount * 2);
  const bandings = new Float32Array(vertCount * 4);
  const glyphData = new Float32Array(vertCount * 4);
  const colors = new Float32Array(vertCount * 4);

  const srcF = gpuData.vertices;
  const srcU = new Uint32Array(srcF.buffer, srcF.byteOffset, srcF.length);

  for (let i = 0; i < vertCount; i++) {
    const s = i * FLOATS_PER_VERT;
    positions[i * 3] = srcF[s];
    positions[i * 3 + 1] = srcF[s + 1];
    positions[i * 3 + 2] = 0;

    texcoords[i * 2] = srcF[s + 4];
    texcoords[i * 2 + 1] = srcF[s + 5];

    bandings[i * 4] = srcF[s + 12];
    bandings[i * 4 + 1] = srcF[s + 13];
    bandings[i * 4 + 2] = srcF[s + 14];
    bandings[i * 4 + 3] = srcF[s + 15];

    // Unpack glyph location and band metadata from bit-packed fields
    const g0 = srcU[s + 6];
    const g1 = srcU[s + 7];
    glyphData[i * 4] = g0 & 0xFFFF;
    glyphData[i * 4 + 1] = (g0 >>> 16) & 0xFFFF;
    glyphData[i * 4 + 2] = g1 & 0xFFFF;
    glyphData[i * 4 + 3] = (g1 >>> 16) & 0xFFFF;

    colors[i * 4] = srcF[s + 16];
    colors[i * 4 + 1] = srcF[s + 17];
    colors[i * 4 + 2] = srcF[s + 18];
    colors[i * 4 + 3] = srcF[s + 19];
  }

  // Per-glyph center: average of quad corner positions
  const glyphCenters = new Float32Array(vertCount * 3);
  const glyphIndices = new Float32Array(vertCount);
  for (let g = 0; g < gpuData.shapeCount; g++) {
    const base = g * 4;
    let cx = 0, cy = 0;
    for (let v = 0; v < 4; v++) {
      cx += positions[(base + v) * 3];
      cy += positions[(base + v) * 3 + 1];
    }
    cx *= 0.25;
    cy *= 0.25;
    for (let v = 0; v < 4; v++) {
      const idx = base + v;
      glyphCenters[idx * 3] = cx;
      glyphCenters[idx * 3 + 1] = cy;
      glyphCenters[idx * 3 + 2] = 0;
      glyphIndices[idx] = g;
    }
  }

  return { positions, texcoords, bandings, glyphData, colors, glyphCenters, glyphIndices };
}
