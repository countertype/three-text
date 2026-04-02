import { Text as CoreText, type VectorTextResult } from './core';
import { createVectorMeshes, loopBlinnFragment, type VectorMeshes, type VectorMeshOptions } from './loopBlinnTSL';
import type { TextOptions } from '../core/types';

export interface VectorTextOptions extends TextOptions {
  color?: any;
  positionNode?: any;
  colorNode?: any;
  center?: boolean;
}

export interface VectorResult extends VectorTextResult {
  group: import('three').Group;
  interiorGeometry: import('three').BufferGeometry;
  curveGeometry: import('three').BufferGeometry;
  fillGeometry: import('three').BufferGeometry;
  updateMaterials(options?: VectorMeshOptions): void;
  update(newOptions: Partial<VectorTextOptions>): Promise<VectorResult>;
}

function wrapResult(
  coreResult: VectorTextResult,
  opts: VectorTextOptions
): VectorResult {
  const meshes = createVectorMeshes(coreResult.geometryData, {
    color: opts.color,
    positionNode: opts.positionNode,
    colorNode: opts.colorNode,
    center: opts.center,
  });

  return {
    glyphs: coreResult.glyphs,
    geometryData: coreResult.geometryData,
    group: meshes.group,
    interiorGeometry: meshes.interiorGeometry,
    curveGeometry: meshes.curveGeometry,
    fillGeometry: meshes.fillGeometry,
    query: coreResult.query,
    getLoadedFont: coreResult.getLoadedFont,
    measureTextWidth: coreResult.measureTextWidth,
    updateMaterials: meshes.updateMaterials,
    async update(newOptions: Partial<VectorTextOptions>): Promise<VectorResult> {
      const newCore = await coreResult.update(newOptions);
      return wrapResult(newCore, { ...opts, ...newOptions });
    },
    dispose() {
      meshes.dispose();
      coreResult.dispose();
    }
  };
}

export class Text {
  static setHarfBuzzPath = CoreText.setHarfBuzzPath;
  static setHarfBuzzBuffer = CoreText.setHarfBuzzBuffer;
  static init = CoreText.init;
  static registerPattern = CoreText.registerPattern;
  static preloadPatterns = CoreText.preloadPatterns;
  static setMaxFontCacheMemoryMB = CoreText.setMaxFontCacheMemoryMB;
  static enableWoff2 = CoreText.enableWoff2;

  static async create(options: VectorTextOptions): Promise<VectorResult> {
    const coreResult = await CoreText.create(options);
    return wrapResult(coreResult, options);
  }
}

export { createVectorMeshes, loopBlinnFragment };
export type { VectorMeshes, VectorMeshOptions };
export type { VectorTextResult } from './core';

export {
  buildVectorGeometry,
  extractContours
} from './LoopBlinnGeometry';
export type { TextOptions } from '../core/types';
export type {
  VectorGeometryData,
  VectorGlyphAttributes,
  GlyphRange,
  VectorContour,
  LoopBlinnInput,
  LoopBlinnGlyphInput,
  QuadraticSegment
} from './LoopBlinnGeometry';
export type {
  VectorGlyphInfo,
  LoadedFont
} from '../core/types';
export type { HyphenationTrieNode } from '../hyphenation';
