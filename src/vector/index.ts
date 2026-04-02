import { Text as TextCore, type VectorTextResult as VectorCoreResult } from './core';
import type {
  TextOptions,
  VectorGlyphInfo,
  LoadedFont,
  TextQueryOptions,
  TextRange
} from '../core/types';
import type { BoundingBox } from '../utils/vectors';
import type { SlugGPUData } from './slug/types';
import { createSlugGLSLMesh, type SlugGLSLMesh } from './slug/slugGLSL';
import type { HyphenationTrieNode } from '../hyphenation';
// @ts-ignore - three is a peer dependency
import * as THREE from 'three';

export interface VectorTextResult {
  group: THREE.Group;
  mesh: THREE.Mesh;
  gpuData: SlugGPUData;
  glyphs: VectorGlyphInfo[];
  planeBounds: BoundingBox;
  query(options: TextQueryOptions): TextRange[];
  getLoadedFont(): LoadedFont | undefined;
  measureTextWidth(text: string, letterSpacing?: number): number;
  update(options: Partial<TextOptions>): Promise<VectorTextResult>;
  dispose(): void;
}

function parseColor(color: TextOptions['color']): { r: number; g: number; b: number } {
  if (!color) return { r: 1, g: 1, b: 1 };
  if (Array.isArray(color)) return { r: color[0], g: color[1], b: color[2] };
  if (color.default) return { r: color.default[0], g: color.default[1], b: color.default[2] };
  return { r: 1, g: 1, b: 1 };
}

interface SlugMeshAdapter {
  mesh: THREE.Mesh;
  setOffset(x: number, y: number, z?: number): void;
  setColor(r: number, g: number, b: number): void;
  dispose(): void;
}

async function createMesh(
  gpuData: SlugGPUData,
  color: { r: number; g: number; b: number },
  adaptiveSupersampling?: boolean
): Promise<SlugMeshAdapter> {
  try {
    const { createSlugTSLMesh } = await import('./slug/slugTSL');
    return createSlugTSLMesh(gpuData, color);
  } catch {
    return createSlugGLSLMesh(gpuData, { color, adaptiveSupersampling });
  }
}

async function wrapCoreResult(
  coreResult: VectorCoreResult,
  options: TextOptions
): Promise<VectorTextResult> {
  const color = parseColor(options.color);
  const slugMesh = await createMesh(coreResult.gpuData, color, options.adaptiveSupersampling);

  const geo = slugMesh.mesh.geometry;
  geo.computeBoundingBox();
  const center = new THREE.Vector3();
  geo.boundingBox!.getCenter(center);
  geo.translate(-center.x, -center.y, -center.z);

  const gcAttr = geo.getAttribute('glyphCenter');
  if (gcAttr) {
    const arr = gcAttr.array as Float32Array;
    for (let i = 0; i < arr.length; i += 3) {
      arr[i] -= center.x;
      arr[i + 1] -= center.y;
      arr[i + 2] -= center.z;
    }
    gcAttr.needsUpdate = true;
  }

  const group = new THREE.Group();
  group.add(slugMesh.mesh);

  return {
    group,
    mesh: slugMesh.mesh,
    gpuData: coreResult.gpuData,
    glyphs: coreResult.glyphs,
    planeBounds: coreResult.planeBounds,
    query: (queryOptions) => coreResult.query(queryOptions),
    getLoadedFont: () => coreResult.getLoadedFont(),
    measureTextWidth: (text, letterSpacing) => coreResult.measureTextWidth(text, letterSpacing),
    update: async (newOptions) => {
      const mergedOptions: TextOptions = { ...options };
      for (const key in newOptions) {
        const value = newOptions[key as keyof TextOptions];
        if (value !== undefined) {
          (mergedOptions as any)[key] = value;
        }
      }
      const newCore = await coreResult.update(newOptions);
      return wrapCoreResult(newCore, mergedOptions);
    },
    dispose: () => {
      slugMesh.dispose();
      coreResult.dispose();
    }
  };
}

export class Text {
  static setHarfBuzzPath = TextCore.setHarfBuzzPath;
  static setHarfBuzzBuffer = TextCore.setHarfBuzzBuffer;
  static init = TextCore.init;
  static registerPattern = TextCore.registerPattern;
  static preloadPatterns = TextCore.preloadPatterns;
  static setMaxFontCacheMemoryMB = TextCore.setMaxFontCacheMemoryMB;
  static enableWoff2 = TextCore.enableWoff2;

  static async create(options: TextOptions): Promise<VectorTextResult> {
    const coreResult = await TextCore.create(options);
    return wrapCoreResult(coreResult, options);
  }
}

export type {
  TextOptions,
  VectorTextResult as TextGeometryInfo,
  VectorGlyphInfo,
  LoadedFont
};
export type { HyphenationTrieNode };
export { createSlugGLSLMesh } from './slug/slugGLSL';
export type { SlugGLSLMesh, SlugGLSLMeshOptions } from './slug/slugGLSL';
export type { SlugGPUData } from './slug/types';
