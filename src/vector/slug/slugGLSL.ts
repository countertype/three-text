// Slug GLSL adapter for Three.js, using RawShaderMaterial with the
// reference GLSL shaders. Works with both WebGLRenderer and
// WebGPURenderer (via GLSL-to-WGSL transpilation)
//
// Compared to the TSL adapter (slugTSL.ts):
//   - Works with any Three.js renderer (no node-material dependency)
//   - Uses native Uint32 band texture (no float conversion)
//   - Supports GLSL animation injection via animationDeclarations/animationBody
//   - Same tradeoff: no vertex dilation (may cause sub-pixel edge clipping at extreme zoom)
//
// Requires peer dependency: three

// @ts-ignore - three is a peer dependency
import * as THREE from 'three';

import type { SlugGPUData } from './types';
import { unpackSlugVertices } from './unpackVertices';
import { fragmentShaderGLSL300 } from './shaderStrings';

// Three.js GLSL3 mode prepends #version 300 es, so strip it from the raw shader
const fragShader = fragmentShaderGLSL300.replace(/^#version\s+300\s+es\s*\n/, '');

export interface SlugGLSLMeshOptions {
  color?: { r: number; g: number; b: number };
  // GLSL preamble injected before main(): uniforms, helpers, etc
  animationDeclarations?: string;
  // GLSL body injected inside main(), must write `outPos` (vec3)
  animationBody?: string;
  // Initial values for animation uniforms declared in animationDeclarations
  uniforms?: Record<string, THREE.IUniform>;
  // Enable rotated RGSS-4 adaptive supersampling (4 samples per pixel)
  adaptiveSupersampling?: boolean;
}

export interface SlugGLSLMesh {
  mesh: THREE.Mesh;
  uniforms: Record<string, THREE.IUniform>;
  setOffset(x: number, y: number, z?: number): void;
  setColor(r: number, g: number, b: number): void;
  dispose(): void;
}

function buildVertexShader(options?: SlugGLSLMeshOptions): string {
  const decl = options?.animationDeclarations ?? '';
  const body = options?.animationBody ?? 'vec3 outPos = position;';

  return `precision highp float;
precision highp int;

in vec3 position;
in vec2 slugTexcoord;
in vec4 slugBanding;
in vec4 slugGlyph;
in vec4 slugColor;
in vec3 glyphCenter;
in float glyphIndex;

uniform mat4 modelViewMatrix;
uniform mat4 projectionMatrix;
uniform float time;
${decl}

out vec2 v_texcoord;
flat out vec4 v_banding;
flat out ivec4 v_glyph;
out vec4 v_color;

void main() {
    v_texcoord = slugTexcoord;
    v_banding = slugBanding;
    v_glyph = ivec4(slugGlyph);
    v_color = slugColor;

    ${body}

    gl_Position = projectionMatrix * modelViewMatrix * vec4(outPos, 1.0);
}
`;
}

export function createSlugGLSLMesh(
  gpuData: SlugGPUData,
  options?: SlugGLSLMeshOptions
): SlugGLSLMesh {
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

  // Curve texture: RGBA32F
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

  // Band texture: native RGBA32UI (no float conversion needed)
  const bandTex = new THREE.DataTexture(
    gpuData.bandTexture.data,
    gpuData.bandTexture.width,
    gpuData.bandTexture.height
  );
  bandTex.format = THREE.RGBAIntegerFormat;
  bandTex.type = THREE.UnsignedIntType;
  bandTex.internalFormat = 'RGBA32UI';
  bandTex.minFilter = THREE.NearestFilter;
  bandTex.magFilter = THREE.NearestFilter;
  bandTex.generateMipmaps = false;
  bandTex.needsUpdate = true;

  const col = options?.color ?? { r: 1, g: 1, b: 1 };
  const colorUniform = new THREE.Vector4(col.r, col.g, col.b, 1.0);

  const uniforms: Record<string, THREE.IUniform> = {
    curveTexture: { value: curveTex },
    bandTexture: { value: bandTex },
    time: { value: 0 },
    u_color: { value: colorUniform },
    ...options?.uniforms,
  };

  const frag = options?.adaptiveSupersampling
    ? '#define SLUG_ADAPTIVE_SUPERSAMPLE\n' + fragShader
    : fragShader;

  const material = new THREE.RawShaderMaterial({
    glslVersion: THREE.GLSL3,
    uniforms,
    vertexShader: buildVertexShader(options),
    fragmentShader: frag,
    transparent: true,
    depthWrite: false,
    side: THREE.DoubleSide,
  });

  const mesh = new THREE.Mesh(geo, material);

  return {
    mesh,
    uniforms,
    setOffset(x: number, y: number, z = 0) {
      mesh.position.set(x, y, z);
    },
    setColor(r: number, g: number, b: number) {
      colorUniform.set(r, g, b, 1.0);
    },
    dispose() {
      geo.dispose();
      material.dispose();
      curveTex.dispose();
      bandTex.dispose();
    }
  };
}
