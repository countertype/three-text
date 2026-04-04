// CPU-side data packer for the Slug algorithm
// Faithful to Eric Lengyel's reference layout (MIT License, 2017)
//
// Takes generic quadratic Bezier shapes (not text-specific) and produces
// GPU-ready packed textures + vertex attribute buffers

import type { SlugShape, SlugGPUData, SlugPackOptions } from './types';

const TEX_WIDTH = 4096;
const LOG_TEX_WIDTH = 12;

const _f32 = new Float32Array(1);
const _u32 = new Uint32Array(_f32.buffer);

function floatAsUint(f: number): number {
  _f32[0] = f;
  return _u32[0];
}

function uintAsFloat(u: number): number {
  _u32[0] = u;
  return _f32[0];
}

interface CurveEntry {
  p1x: number; p1y: number;
  p2x: number; p2y: number;
  p3x: number; p3y: number;
  minX: number; minY: number;
  maxX: number; maxY: number;
  curveTexX: number;
  curveTexY: number;
}

interface BandEntry {
  curveCount: number;
  listOffset: number; // relative to glyph data start in band texture
}

// Pack an array of shapes into Slug's GPU data layout
// Each shape is a closed region defined by quadratic Bezier curves
export function packSlugData(
  shapes: SlugShape[],
  options?: SlugPackOptions
): SlugGPUData {
  const bandCount = options?.bandCount ?? 16;
  const evenOdd = options?.evenOdd ?? false;

  const allCurves: CurveEntry[][] = [];
  let curveTexelCount = 0;
  let totalCurves = 0;
  for (const shape of shapes) {
    totalCurves += shape.curves.length;
  }
  const curveTexHeight = Math.ceil((totalCurves * 2) / TEX_WIDTH) + 1;
  const curveData = new Float32Array(TEX_WIDTH * curveTexHeight * 4);

  let curveX = 0;
  let curveY = 0;

  for (const shape of shapes) {
    const entries: CurveEntry[] = [];
    const [ox, oy] = shape.bounds;
    for (const curve of shape.curves) {
      if (curveX >= TEX_WIDTH - 1) {
        curveX = 0;
        curveY++;
      }

      // Glyph-local space (relative to bounds min) keeps renderCoord
      // subtraction near zero, preserving float32 precision in the solver
      const lp1x = curve.p1[0] - ox, lp1y = curve.p1[1] - oy;
      const lp2x = curve.p2[0] - ox, lp2y = curve.p2[1] - oy;
      const lp3x = curve.p3[0] - ox, lp3y = curve.p3[1] - oy;

      const base = (curveY * TEX_WIDTH + curveX) * 4;
      curveData[base + 0] = lp1x;
      curveData[base + 1] = lp1y;
      curveData[base + 2] = lp2x;
      curveData[base + 3] = lp2y;

      const base2 = base + 4;
      curveData[base2 + 0] = lp3x;
      curveData[base2 + 1] = lp3y;

      const minX = Math.min(lp1x, lp2x, lp3x);
      const minY = Math.min(lp1y, lp2y, lp3y);
      const maxX = Math.max(lp1x, lp2x, lp3x);
      const maxY = Math.max(lp1y, lp2y, lp3y);

      entries.push({
        p1x: lp1x, p1y: lp1y,
        p2x: lp2x, p2y: lp2y,
        p3x: lp3x, p3y: lp3y,
        minX, minY, maxX, maxY,
        curveTexX: curveX,
        curveTexY: curveY
      });

      curveX += 2;
      curveTexelCount += 2;
    }
    allCurves.push(entries);
  }

  const actualCurveTexHeight = curveY + 1;

  // Band texture layout per shape (relative to glyphLoc):
  //   [0 .. hBandMax]                     h-band headers
  //   [hBandMax+1 .. hBandMax+1+vBandMax] v-band headers
  //   [hBandMax+vBandMax+2 .. ]           curve index lists
  const shapeBandData: {
    hBands: BandEntry[];
    vBands: BandEntry[];
    hLists: number[][]; // each is [curveTexX, curveTexY, ...]
    vLists: number[][];
    totalTexels: number;
    bandMaxX: number;
    bandMaxY: number;
  }[] = [];

  let totalBandTexels = 0;

  for (let si = 0; si < shapes.length; si++) {
    const shape = shapes[si];
    const curves = allCurves[si];
    if (curves.length === 0) {
      shapeBandData.push({
        hBands: [], vBands: [], hLists: [], vLists: [],
        totalTexels: 0, bandMaxX: 0, bandMaxY: 0
      });
      continue;
    }

    const [bMinX, bMinY, bMaxX, bMaxY] = shape.bounds;
    const w = bMaxX - bMinX;
    const h = bMaxY - bMinY;

    const hBandCount = Math.min(bandCount, 255); // max 255 (fits in 8 bits)
    const vBandCount = Math.min(bandCount, 255);
    const bandMaxY = hBandCount - 1;
    const bandMaxX = vBandCount - 1;

    // Horizontal bands (partition y-axis)
    const hBands: BandEntry[] = [];
    const hLists: number[][] = [];
    const bandH = h / hBandCount;

    for (let bi = 0; bi < hBandCount; bi++) {
      const bandMinY = bi * bandH;
      const bandMaxYCoord = bandMinY + bandH;
      const list: { curve: CurveEntry; sortKey: number }[] = [];
      for (const c of curves) {
        if (c.maxY >= bandMinY && c.minY <= bandMaxYCoord) {
          list.push({ curve: c, sortKey: c.maxX });
        }
      }
      list.sort((a, b) => b.sortKey - a.sortKey);
      const flatList: number[] = [];
      for (const item of list) {
        flatList.push(item.curve.curveTexX, item.curve.curveTexY);
      }
      hBands.push({ curveCount: list.length, listOffset: 0 });
      hLists.push(flatList);
    }

    // Vertical bands (partition x-axis)
    const vBands: BandEntry[] = [];
    const vLists: number[][] = [];
    const bandW = w / vBandCount;

    for (let bi = 0; bi < vBandCount; bi++) {
      const bandMinX = bi * bandW;
      const bandMaxXCoord = bandMinX + bandW;
      const list: { curve: CurveEntry; sortKey: number }[] = [];
      for (const c of curves) {
        if (c.maxX >= bandMinX && c.minX <= bandMaxXCoord) {
          list.push({ curve: c, sortKey: c.maxY });
        }
      }
      list.sort((a, b) => b.sortKey - a.sortKey);
      const flatList: number[] = [];
      for (const item of list) {
        flatList.push(item.curve.curveTexX, item.curve.curveTexY);
      }
      vBands.push({ curveCount: list.length, listOffset: 0 });
      vLists.push(flatList);
    }

    const headerTexels = hBandCount + vBandCount;
    let listTexels = 0;
    for (const l of hLists) listTexels += l.length / 2;
    for (const l of vLists) listTexels += l.length / 2;

    const total = headerTexels + listTexels;

    shapeBandData.push({
      hBands, vBands, hLists, vLists,
      totalTexels: total, bandMaxX, bandMaxY
    });

    totalBandTexels += total;
  }

  const bandTexHeight = Math.max(1, Math.ceil(totalBandTexels / TEX_WIDTH) + shapes.length * 2);
  const bandData = new Uint32Array(TEX_WIDTH * bandTexHeight * 4);

  let bandX = 0;
  let bandY = 0;

  const glyphLocs: { x: number; y: number }[] = [];

  for (let si = 0; si < shapes.length; si++) {
    const sd = shapeBandData[si];
    if (sd.totalTexels === 0) {
      glyphLocs.push({ x: 0, y: 0 });
      continue;
    }

    // Band headers are read without CalcBandLoc wrapping, so all
    // headers for a glyph must fit within a single texture row
    const minContiguous = sd.hBands.length + sd.vBands.length;
    if (bandX + minContiguous > TEX_WIDTH) {
      bandX = 0;
      bandY++;
    }

    const glyphLocX = bandX;
    const glyphLocY = bandY;
    glyphLocs.push({ x: glyphLocX, y: glyphLocY });

    let listStartOffset = sd.hBands.length + sd.vBands.length;

    // Curve lists aren't row-wrapped by the shader, so pad to avoid crossing
    const ensureListFits = (listLen: number) => {
      if (listLen === 0) return;
      const startX = (glyphLocX + listStartOffset) & ((1 << LOG_TEX_WIDTH) - 1);
      if (startX + listLen > TEX_WIDTH) {
        listStartOffset += (TEX_WIDTH - startX);
      }
    };

    for (let bi = 0; bi < sd.hBands.length; bi++) {
      const listLen = sd.hLists[bi].length / 2;
      ensureListFits(listLen);
      sd.hBands[bi].listOffset = listStartOffset;
      listStartOffset += listLen;
    }
    for (let bi = 0; bi < sd.vBands.length; bi++) {
      const listLen = sd.vLists[bi].length / 2;
      ensureListFits(listLen);
      sd.vBands[bi].listOffset = listStartOffset;
      listStartOffset += listLen;
    }

    for (let bi = 0; bi < sd.hBands.length; bi++) {
      const tx = glyphLocX + bi;
      const ty = glyphLocY;
      const idx = (ty * TEX_WIDTH + tx) * 4;
      bandData[idx + 0] = sd.hBands[bi].curveCount;
      bandData[idx + 1] = sd.hBands[bi].listOffset;
      bandData[idx + 2] = 0;
      bandData[idx + 3] = 0;
    }

    const vBandStart = glyphLocX + sd.hBands.length;
    for (let bi = 0; bi < sd.vBands.length; bi++) {
      const tx = vBandStart + bi;
      const ty = glyphLocY;
      const idx = (ty * TEX_WIDTH + tx) * 4;
      bandData[idx + 0] = sd.vBands[bi].curveCount;
      bandData[idx + 1] = sd.vBands[bi].listOffset;
      bandData[idx + 2] = 0;
      bandData[idx + 3] = 0;
    }

    const texWidthMask = (1 << LOG_TEX_WIDTH) - 1;

    for (let bi = 0; bi < sd.hBands.length; bi++) {
      const list = sd.hLists[bi];
      const baseOffset = sd.hBands[bi].listOffset;
      for (let ci = 0; ci < list.length; ci += 2) {
        let bx = glyphLocX + baseOffset + (ci >> 1);
        const by = glyphLocY + (bx >> LOG_TEX_WIDTH);
        bx &= texWidthMask;
        const idx = (by * TEX_WIDTH + bx) * 4;
        bandData[idx + 0] = list[ci];
        bandData[idx + 1] = list[ci + 1];
        bandData[idx + 2] = 0;
        bandData[idx + 3] = 0;
      }
    }

    for (let bi = 0; bi < sd.vBands.length; bi++) {
      const list = sd.vLists[bi];
      const baseOffset = sd.vBands[bi].listOffset;
      for (let ci = 0; ci < list.length; ci += 2) {
        let bx = glyphLocX + baseOffset + (ci >> 1);
        const by = glyphLocY + (bx >> LOG_TEX_WIDTH);
        bx &= texWidthMask;
        const idx = (by * TEX_WIDTH + bx) * 4;
        bandData[idx + 0] = list[ci];
        bandData[idx + 1] = list[ci + 1];
        bandData[idx + 2] = 0;
        bandData[idx + 3] = 0;
      }
    }

    let endBx = glyphLocX + listStartOffset;
    bandY = glyphLocY + (endBx >> LOG_TEX_WIDTH);
    bandX = endBx & texWidthMask;
  }

  const actualBandTexHeight = bandY + 1;

  const FLOATS_PER_VERTEX = 20; // 5 attribs * 4 components
  const VERTS_PER_SHAPE = 4;
  const vertices = new Float32Array(shapes.length * VERTS_PER_SHAPE * FLOATS_PER_VERTEX);
  const indices = new Uint16Array(shapes.length * 6);

  const cornerNormals: [number, number][] = [
    [-1, -1],
    [ 1, -1],
    [ 1,  1],
    [-1,  1],
  ];

  for (let si = 0; si < shapes.length; si++) {
    const shape = shapes[si];
    const sd = shapeBandData[si];
    const glyph = glyphLocs[si];
    const [bMinX, bMinY, bMaxX, bMaxY] = shape.bounds;
    const w = bMaxX - bMinX;
    const h = bMaxY - bMinY;

    const corners: [number, number][] = [
      [bMinX, bMinY],
      [bMaxX, bMinY],
      [bMaxX, bMaxY],
      [bMinX, bMaxY],
    ];

    const emCorners: [number, number][] = [
      [0, 0],
      [w, 0],
      [w, h],
      [0, h],
    ];

    const texZ = uintAsFloat((glyph.x & 0xFFFF) | ((glyph.y & 0xFFFF) << 16));

    let texWBits = (sd.bandMaxX & 0xFF) | ((sd.bandMaxY & 0xFF) << 16);
    if (evenOdd) texWBits |= 0x10000000; // E flag at bit 28
    const texW = uintAsFloat(texWBits);

    const bandScaleX = w > 0 ? sd.vBands.length / w : 0;
    const bandScaleY = h > 0 ? sd.hBands.length / h : 0;

    for (let vi = 0; vi < 4; vi++) {
      const base = (si * 4 + vi) * FLOATS_PER_VERTEX;

      // pos: .xy = position, .zw = normal
      vertices[base + 0] = corners[vi][0];
      vertices[base + 1] = corners[vi][1];
      vertices[base + 2] = cornerNormals[vi][0];
      vertices[base + 3] = cornerNormals[vi][1];

      // tex: .xy = em-space coords, .z = packed glyph loc, .w = packed band max
      vertices[base + 4] = emCorners[vi][0];
      vertices[base + 5] = emCorners[vi][1];
      vertices[base + 6] = texZ;
      vertices[base + 7] = texW;

      // jac: identity (em-space is a translation of object-space)
      vertices[base + 8] = 1.0;
      vertices[base + 9] = 0.0;
      vertices[base + 10] = 0.0;
      vertices[base + 11] = 1.0;

      // bnd: band scale (offset zero in glyph-local space)
      vertices[base + 12] = bandScaleX;
      vertices[base + 13] = bandScaleY;
      vertices[base + 14] = 0;
      vertices[base + 15] = 0;

      // col
      vertices[base + 16] = 1.0;
      vertices[base + 17] = 1.0;
      vertices[base + 18] = 1.0;
      vertices[base + 19] = 1.0;
    }

    const vBase = si * 4;
    const iBase = si * 6;
    indices[iBase + 0] = vBase + 0;
    indices[iBase + 1] = vBase + 1;
    indices[iBase + 2] = vBase + 2;
    indices[iBase + 3] = vBase + 0;
    indices[iBase + 4] = vBase + 2;
    indices[iBase + 5] = vBase + 3;
  }

  return {
    curveTexture: {
      data: curveData.slice(0, TEX_WIDTH * actualCurveTexHeight * 4),
      width: TEX_WIDTH,
      height: actualCurveTexHeight
    },
    bandTexture: {
      data: bandData.slice(0, TEX_WIDTH * actualBandTexHeight * 4),
      width: TEX_WIDTH,
      height: actualBandTexHeight
    },
    vertices,
    indices,
    shapeCount: shapes.length
  };
}

