// Three.js adapter - wraps core text processing and returns BufferGeometry
// This is a thin convenience layer for Three.js users

import {
  BufferGeometry,
  Float32BufferAttribute,
  Uint32BufferAttribute
} from 'three';
import { Text as TextCore } from '../core/Text';
import type {
  TextOptions,
  TextGeometryInfo as CoreTextGeometryInfo,
  LoadedFont,
  TextHandle as CoreTextHandle
} from '../core/types';
import type { HyphenationTrieNode } from '../hyphenation';

// Three.js specific interface that includes BufferGeometry
export interface ThreeTextGeometryInfo
  extends Omit<
    CoreTextGeometryInfo,
    'vertices' | 'normals' | 'indices' | 'colors' | 'glyphAttributes'
  > {
  geometry: BufferGeometry;
  // Utility methods from core
  getLoadedFont(): LoadedFont | undefined;
  getCacheSize(): number;
  clearCache(): void;
  measureTextWidth(text: string, letterSpacing?: number): number;
  update(options: Partial<TextOptions>): Promise<ThreeTextGeometryInfo>;
}

function convertToThree(result: CoreTextHandle): ThreeTextGeometryInfo {
  // Create BufferGeometry from raw arrays
  const geometry = new BufferGeometry();
  geometry.setAttribute(
    'position',
    new Float32BufferAttribute(result.vertices, 3)
  );
  geometry.setAttribute(
    'normal',
    new Float32BufferAttribute(result.normals, 3)
  );
  geometry.setIndex(new Uint32BufferAttribute(result.indices, 1));

  // Add optional color attribute (only if provided)
  if (result.colors) {
    geometry.setAttribute(
      'color',
      new Float32BufferAttribute(result.colors, 3)
    );
  }

  if (result.glyphAttributes) {
    geometry.setAttribute(
      'glyphCenter',
      new Float32BufferAttribute(result.glyphAttributes.glyphCenter, 3)
    );
    geometry.setAttribute(
      'glyphIndex',
      new Float32BufferAttribute(result.glyphAttributes.glyphIndex, 1)
    );
    geometry.setAttribute(
      'glyphLineIndex',
      new Float32BufferAttribute(result.glyphAttributes.glyphLineIndex, 1)
    );
    geometry.setAttribute(
      'glyphProgress',
      new Float32BufferAttribute(result.glyphAttributes.glyphProgress, 1)
    );
    geometry.setAttribute(
      'glyphBaselineY',
      new Float32BufferAttribute(result.glyphAttributes.glyphBaselineY, 1)
    );
  }

  geometry.computeBoundingBox();

  // Return Three.js specific interface with utility methods
  return {
    geometry,
    glyphs: result.glyphs,
    planeBounds: result.planeBounds,
    stats: result.stats,
    query: result.query,
    coloredRanges: result.coloredRanges,
    // Pass through utility methods from core
    getLoadedFont: result.getLoadedFont,
    getCacheSize: result.getCacheSize,
    clearCache: result.clearCache,
    measureTextWidth: result.measureTextWidth,
    update: async (newOptions: Partial<TextOptions>) => {
      const newCoreResult = await result.update(newOptions);
      return convertToThree(newCoreResult);
    }
  };
}

export class Text {
  // Delegate static methods to core
  static setHarfBuzzPath = TextCore.setHarfBuzzPath;
  static setHarfBuzzBuffer = TextCore.setHarfBuzzBuffer;
  static init = TextCore.init;
  static registerPattern = TextCore.registerPattern;
  static preloadPatterns = TextCore.preloadPatterns;
  static setMaxFontCacheMemoryMB = TextCore.setMaxFontCacheMemoryMB;
  static enableWoff2 = TextCore.enableWoff2;

  // Main API - wraps core result in BufferGeometry
  static async create(options: TextOptions): Promise<ThreeTextGeometryInfo> {
    const coreResult = await TextCore.create(options);
    return convertToThree(coreResult);
  }
}

// Re-export types for convenience
export type {
  TextOptions,
  ThreeTextGeometryInfo as TextGeometryInfo,
  LoadedFont
};
export type { HyphenationTrieNode };
