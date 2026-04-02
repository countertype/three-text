// Slug TSL adapter for Three.js WebGPURenderer (and WebGL via r170+)
//
// Creates a single Three.js Mesh with a NodeMaterial that implements
// the Slug algorithm: per-fragment winding number evaluation via
// band-accelerated ray-curve intersection
//
// Works on both WebGPU and WebGL backends via Three.js TSL
//
// Compared to the raw GLSL/WGSL standalone renderers, this adapter
// trades some features for Three.js integration:
//   - No vertex dilation (may cause sub-pixel edge clipping at extreme zoom)
//   - No adaptive supersampling (single-sample per fragment)
//
// Requires peer dependencies: three, three/tsl

// @ts-ignore - three is a peer dependency
import * as THREE from 'three';
// @ts-ignore - three/webgpu is a peer dependency
import { MeshBasicNodeMaterial } from 'three/webgpu';
// @ts-ignore - three/tsl is a peer dependency; multiline to satisfy ts-ignore on next line only
import { Fn, float, int, uint, vec2, vec4, ivec2, attribute, varying, uniform, textureLoad, Loop, If, Break, select, clamp, sqrt, max, min, abs, fwidth } from 'three/tsl';

import type { SlugGPUData } from './types';
import { unpackSlugVertices } from './unpackVertices';

export interface SlugTSLMesh {
  mesh: THREE.Mesh;
  // Set position offset (e.g. to center the text)
  setOffset(x: number, y: number, z?: number): void;
  // Update text color without rebuilding the mesh
  setColor(r: number, g: number, b: number): void;
  dispose(): void;
}

const LOG_BAND_TEX_W = 12;
const BAND_TEX_W_MASK = (1 << LOG_BAND_TEX_W) - 1;

// Determines which quadratic roots to evaluate from the signs of
// control-point y-coordinates, using direct sign comparisons instead
// of the original floatBitsToUint encoding.
// Returns a 16-bit value where bit 0 = evaluate root 1,
// bit 8 = evaluate root 2 (matching the 0x0101 mask convention)
const calcRootCode = Fn(([y1, y2, y3]: any[]) => {
  const s1 = select(y1.lessThan(0), uint(1), uint(0));
  const s2 = select(y2.lessThan(0), uint(1), uint(0));
  const s3 = select(y3.lessThan(0), uint(1), uint(0));
  const shift = s1.bitOr(s2.shiftLeft(1)).bitOr(s3.shiftLeft(2));
  return uint(0x2E74).shiftRight(shift).bitAnd(uint(0x0101));
});

// Solve horizontal quadratic: finds x-intercepts where the curve
// crosses the fragment's y = 0 line
const solveHorizPoly = Fn(([p12, p3]: any[]) => {
  const ax = p12.x.sub(p12.z.mul(2)).add(p3.x);
  const ay = p12.y.sub(p12.w.mul(2)).add(p3.y);
  const bx = p12.x.sub(p12.z);
  const by = p12.y.sub(p12.w);
  const ra = float(1).div(ay);
  const rb = float(0.5).div(by);
  const d = sqrt(max(by.mul(by).sub(ay.mul(p12.y)), 0));
  const t1 = by.sub(d).mul(ra).toVar();
  const t2 = by.add(d).mul(ra).toVar();
  If(abs(ay).lessThan(float(1.0 / 65536.0)), () => {
    const fb = p12.y.mul(rb);
    t1.assign(fb);
    t2.assign(fb);
  });
  return vec2(
    ax.mul(t1).sub(bx.mul(2)).mul(t1).add(p12.x),
    ax.mul(t2).sub(bx.mul(2)).mul(t2).add(p12.x)
  );
});

// Solve vertical quadratic: finds y-intercepts where the curve
// crosses the fragment's x = 0 line
const solveVertPoly = Fn(([p12, p3]: any[]) => {
  const ax = p12.x.sub(p12.z.mul(2)).add(p3.x);
  const ay = p12.y.sub(p12.w.mul(2)).add(p3.y);
  const bx = p12.x.sub(p12.z);
  const by = p12.y.sub(p12.w);
  const ra = float(1).div(ax);
  const rb = float(0.5).div(bx);
  const d = sqrt(max(bx.mul(bx).sub(ax.mul(p12.x)), 0));
  const t1 = bx.sub(d).mul(ra).toVar();
  const t2 = bx.add(d).mul(ra).toVar();
  If(abs(ax).lessThan(float(1.0 / 65536.0)), () => {
    const fb = p12.x.mul(rb);
    t1.assign(fb);
    t2.assign(fb);
  });
  return vec2(
    ay.mul(t1).sub(by.mul(2)).mul(t1).add(p12.y),
    ay.mul(t2).sub(by.mul(2)).mul(t2).add(p12.y)
  );
});

// Compute a band-texture coordinate with row wrapping
// Equivalent to CalcBandLoc in the GLSL reference
const calcBandLoc = Fn(([glyphX, glyphY, offset]: any[]) => {
  const bx = glyphX.add(offset).toVar();
  const by = glyphY.add(bx.shiftRight(LOG_BAND_TEX_W)).toVar();
  bx.assign(bx.bitAnd(BAND_TEX_W_MASK));
  return ivec2(bx, by);
});

// Create a Three.js Mesh from SlugGPUData using TSL node materials.
// Returns a single transparent mesh suitable for any Three.js scene.
// The Slug algorithm evaluates per-fragment coverage analytically,
// so no stencil buffer or multi-pass rendering is required
export function createSlugTSLMesh(
  gpuData: SlugGPUData,
  color?: { r: number; g: number; b: number }
): SlugTSLMesh {
  const attrs = unpackSlugVertices(gpuData);

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(attrs.positions, 3));
  geo.setAttribute('slugTexcoord', new THREE.Float32BufferAttribute(attrs.texcoords, 2));
  geo.setAttribute('slugBanding', new THREE.Float32BufferAttribute(attrs.bandings, 4));
  geo.setAttribute('slugGlyph', new THREE.Float32BufferAttribute(attrs.glyphData, 4));
  geo.setAttribute('slugColor', new THREE.Float32BufferAttribute(attrs.colors, 4));
  geo.setAttribute('glyphCenter', new THREE.Float32BufferAttribute(attrs.glyphCenters, 3));
  geo.setAttribute('glyphIndex', new THREE.Float32BufferAttribute(attrs.glyphIndices, 1));
  geo.setIndex(new THREE.BufferAttribute(gpuData.indices, 1));

  const curveTex = new THREE.DataTexture(
    gpuData.curveTexture.data,
    gpuData.curveTexture.width,
    gpuData.curveTexture.height,
    THREE.RGBAFormat,
    THREE.FloatType
  );
  curveTex.minFilter = THREE.NearestFilter;
  curveTex.magFilter = THREE.NearestFilter;
  curveTex.generateMipmaps = false;
  curveTex.needsUpdate = true;

  // Band texture: convert Uint32 to Float32 (values are small ints, exact in f32)
  const bandFloat = new Float32Array(gpuData.bandTexture.data.length);
  for (let i = 0; i < bandFloat.length; i++) {
    bandFloat[i] = gpuData.bandTexture.data[i];
  }
  const bandTex = new THREE.DataTexture(
    bandFloat,
    gpuData.bandTexture.width,
    gpuData.bandTexture.height,
    THREE.RGBAFormat,
    THREE.FloatType
  );
  bandTex.minFilter = THREE.NearestFilter;
  bandTex.magFilter = THREE.NearestFilter;
  bandTex.generateMipmaps = false;
  bandTex.needsUpdate = true;

  // Varyings: vertex attributes interpolated to fragment stage
  const vTexcoord = varying(attribute('slugTexcoord', 'vec2'), 'v_texcoord');
  const vBanding = varying(attribute('slugBanding', 'vec4'), 'v_banding');
  const vGlyph = varying(attribute('slugGlyph', 'vec4'), 'v_glyph');
  const vColor = varying(attribute('slugColor', 'vec4'), 'v_color');

  // Color uniform (allows dynamic color updates)
  const textColor = uniform(new THREE.Color(color?.r ?? 1, color?.g ?? 1, color?.b ?? 1));

  // Main per-fragment evaluation: SlugRenderSingle ported to TSL
  // Evaluates horizontal and vertical band loops to compute
  // analytic winding-number coverage
  const slugRenderSingle = Fn((
    [renderCoord, emsPerPixel, bandTransform, glyphData]: any[]
  ) => {
    const pixelsPerEm = vec2(
      float(1).div(emsPerPixel.x),
      float(1).div(emsPerPixel.y)
    );

    const glyphLocX = glyphData.x.toInt();
    const glyphLocY = glyphData.y.toInt();
    const bandMaxX = glyphData.z.toInt();
    const bandMaxY = glyphData.w.toInt().bitAnd(0xFF);

    const bandIdxX = max(min(
      renderCoord.x.mul(bandTransform.x).add(bandTransform.z).toInt(),
      bandMaxX
    ), int(0));
    const bandIdxY = max(min(
      renderCoord.y.mul(bandTransform.y).add(bandTransform.w).toInt(),
      bandMaxY
    ), int(0));

    // Horizontal band loop
    const xcov = float(0).toVar();
    const xwgt = float(0).toVar();

    const hbandData = textureLoad(bandTex, ivec2(glyphLocX.add(bandIdxY), glyphLocY));
    const hCurveCount = hbandData.x.toInt();
    const hListOffset = hbandData.y.toInt();
    const hbandLoc = calcBandLoc(glyphLocX, glyphLocY, hListOffset);

    const hIdx = int(0).toVar();
    Loop(hIdx.lessThan(hCurveCount), () => {
      const clEntry = textureLoad(bandTex, ivec2(hbandLoc.x.add(hIdx), hbandLoc.y));
      const cLocX = clEntry.x.toInt();
      const cLocY = clEntry.y.toInt();

      const rawP12 = textureLoad(curveTex, ivec2(cLocX, cLocY));
      const rawP3 = textureLoad(curveTex, ivec2(cLocX.add(1), cLocY));

      const p12 = vec4(
        rawP12.x.sub(renderCoord.x), rawP12.y.sub(renderCoord.y),
        rawP12.z.sub(renderCoord.x), rawP12.w.sub(renderCoord.y)
      );
      const p3 = vec2(rawP3.x.sub(renderCoord.x), rawP3.y.sub(renderCoord.y));

      If(max(max(p12.x, p12.z), p3.x).mul(pixelsPerEm.x).lessThan(-0.5), () => {
        Break();
      });

      const code = calcRootCode(p12.y, p12.w, p3.y);
      If(code.notEqual(uint(0)), () => {
        const r = solveHorizPoly(p12, p3).mul(pixelsPerEm.x);

        If(code.bitAnd(uint(1)).notEqual(uint(0)), () => {
          xcov.addAssign(clamp(r.x.add(0.5), 0, 1));
          xwgt.assign(max(xwgt, clamp(float(1).sub(abs(r.x).mul(2)), 0, 1)));
        });

        If(code.greaterThan(uint(1)), () => {
          xcov.subAssign(clamp(r.y.add(0.5), 0, 1));
          xwgt.assign(max(xwgt, clamp(float(1).sub(abs(r.y).mul(2)), 0, 1)));
        });
      });

      hIdx.addAssign(1);
    });

    // Vertical band loop
    const ycov = float(0).toVar();
    const ywgt = float(0).toVar();

    const vbandOffset = bandMaxY.add(1).add(bandIdxX);
    const vbandData = textureLoad(bandTex, ivec2(glyphLocX.add(vbandOffset), glyphLocY));
    const vCurveCount = vbandData.x.toInt();
    const vListOffset = vbandData.y.toInt();
    const vbandLoc = calcBandLoc(glyphLocX, glyphLocY, vListOffset);

    const vIdx = int(0).toVar();
    Loop(vIdx.lessThan(vCurveCount), () => {
      const clEntry = textureLoad(bandTex, ivec2(vbandLoc.x.add(vIdx), vbandLoc.y));
      const cLocX = clEntry.x.toInt();
      const cLocY = clEntry.y.toInt();

      const rawP12 = textureLoad(curveTex, ivec2(cLocX, cLocY));
      const rawP3 = textureLoad(curveTex, ivec2(cLocX.add(1), cLocY));

      const p12 = vec4(
        rawP12.x.sub(renderCoord.x), rawP12.y.sub(renderCoord.y),
        rawP12.z.sub(renderCoord.x), rawP12.w.sub(renderCoord.y)
      );
      const p3 = vec2(rawP3.x.sub(renderCoord.x), rawP3.y.sub(renderCoord.y));

      If(max(max(p12.y, p12.w), p3.y).mul(pixelsPerEm.y).lessThan(-0.5), () => {
        Break();
      });

      const code = calcRootCode(p12.x, p12.z, p3.x);
      If(code.notEqual(uint(0)), () => {
        const r = solveVertPoly(p12, p3).mul(pixelsPerEm.y);

        If(code.bitAnd(uint(1)).notEqual(uint(0)), () => {
          ycov.subAssign(clamp(r.x.add(0.5), 0, 1));
          ywgt.assign(max(ywgt, clamp(float(1).sub(abs(r.x).mul(2)), 0, 1)));
        });

        If(code.greaterThan(uint(1)), () => {
          ycov.addAssign(clamp(r.y.add(0.5), 0, 1));
          ywgt.assign(max(ywgt, clamp(float(1).sub(abs(r.y).mul(2)), 0, 1)));
        });
      });

      vIdx.addAssign(1);
    });

    // CalcCoverage (nonzero winding rule)
    const coverage = max(
      abs(xcov.mul(xwgt).add(ycov.mul(ywgt))).div(
        max(xwgt.add(ywgt), float(1.0 / 65536.0))
      ),
      min(abs(xcov), abs(ycov))
    );
    return clamp(coverage, 0, 1);
  });

  // Top-level fragment node
  const fragmentNode = Fn(() => {
    const emsPerPixel = fwidth(vTexcoord);
    const coverage = slugRenderSingle(vTexcoord, emsPerPixel, vBanding, vGlyph);
    return vec4(textColor.x, textColor.y, textColor.z, vColor.w.mul(coverage));
  })();

  // Material & mesh

  const material = new MeshBasicNodeMaterial();
  material.fragmentNode = fragmentNode;
  material.transparent = true;
  material.depthWrite = false;
  material.side = THREE.DoubleSide;

  const mesh = new THREE.Mesh(geo, material);

  return {
    mesh,
    setOffset(x: number, y: number, z = 0) {
      mesh.position.set(x, y, z);
    },
    setColor(r: number, g: number, b: number) {
      textColor.value.setRGB(r, g, b);
    },
    dispose() {
      geo.dispose();
      material.dispose();
      curveTex.dispose();
      bandTex.dispose();
    }
  };
}
