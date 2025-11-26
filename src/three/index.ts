// Three.js adapter - wraps core text processing and returns BufferGeometry
// This is a thin convenience layer for Three.js users

import { BufferGeometry, Float32BufferAttribute, Uint32BufferAttribute } from 'three';
import { Text as TextCore } from '../core/Text';
import type { TextOptions, TextGeometryInfo as CoreTextGeometryInfo, LoadedFont } from '../core/types';
import type { HyphenationTrieNode } from '../hyphenation';

// Three.js specific interface that includes BufferGeometry
export interface ThreeTextGeometryInfo extends Omit<CoreTextGeometryInfo, 'vertices' | 'normals' | 'indices' | 'colors' | 'glyphAttributes'> {
  geometry: BufferGeometry;
  // Utility methods from core
  getLoadedFont(): LoadedFont | undefined;
  getCacheStatistics(): any;
  clearCache(): void;
  measureTextWidth(text: string, letterSpacing?: number): number;
}

export class Text {
  // Delegate static methods to core
  static setHarfBuzzPath = TextCore.setHarfBuzzPath;
  static setHarfBuzzBuffer = TextCore.setHarfBuzzBuffer;
  static init = TextCore.init;
  static registerPattern = TextCore.registerPattern;
  static preloadPatterns = TextCore.preloadPatterns;

  // Main API - wraps core result in BufferGeometry
  static async create(options: TextOptions): Promise<ThreeTextGeometryInfo> {
    const coreResult = await TextCore.create(options);
    
    // Create BufferGeometry from raw arrays
    const geometry = new BufferGeometry();
    geometry.setAttribute('position', new Float32BufferAttribute(coreResult.vertices, 3));
    geometry.setAttribute('normal', new Float32BufferAttribute(coreResult.normals, 3));
    geometry.setIndex(new Uint32BufferAttribute(coreResult.indices, 1));
    
    // Add optional color attribute (only if provided)
    if (coreResult.colors) {
      geometry.setAttribute('color', new Float32BufferAttribute(coreResult.colors, 3));
    }
    
    if (coreResult.glyphAttributes) {
      geometry.setAttribute('glyphCenter', new Float32BufferAttribute(coreResult.glyphAttributes.glyphCenter, 3));
      geometry.setAttribute('glyphIndex', new Float32BufferAttribute(coreResult.glyphAttributes.glyphIndex, 1));
      geometry.setAttribute('glyphLineIndex', new Float32BufferAttribute(coreResult.glyphAttributes.glyphLineIndex, 1));
    }
    
    geometry.computeBoundingBox();
    
    // Return Three.js specific interface with utility methods
    return {
      geometry,
      glyphs: coreResult.glyphs,
      planeBounds: coreResult.planeBounds,
      stats: coreResult.stats,
      query: coreResult.query,
      coloredRanges: coreResult.coloredRanges,
      // Pass through utility methods from core
      getLoadedFont: coreResult.getLoadedFont,
      getCacheStatistics: coreResult.getCacheStatistics,
      clearCache: coreResult.clearCache,
      measureTextWidth: coreResult.measureTextWidth
    };
  }
}

// Re-export types for convenience
export type { TextOptions, ThreeTextGeometryInfo as TextGeometryInfo, LoadedFont };
export type { HyphenationTrieNode };
