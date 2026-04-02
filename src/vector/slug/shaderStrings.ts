// Slug shader source re-exports
// The .glsl/.wgsl files are the single source of truth, imported as strings
// at build time via the glslPlugin in rollup.config.js

// @ts-ignore - resolved by rollup glslPlugin
import vertGLSL from './shaders/slug.vert.glsl';
// @ts-ignore - resolved by rollup glslPlugin
import fragGLSL from './shaders/slug.frag.glsl';
// @ts-ignore - resolved by rollup glslPlugin
import vertWGSL from './shaders/slug.vert.wgsl';
// @ts-ignore - resolved by rollup glslPlugin
import fragWGSL from './shaders/slug.frag.wgsl';

export const vertexShaderGLSL300: string = vertGLSL;
export const fragmentShaderGLSL300: string = fragGLSL;
export const vertexShaderWGSL: string = vertWGSL;
export const fragmentShaderWGSL: string = fragWGSL;
