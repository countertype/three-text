import {
  BufferGeometry,
  Float32BufferAttribute,
  Uint32BufferAttribute
} from 'three';
import { Text as TextCore } from '../core/Text';
import { MeshGeometryBuilder } from '../mesh/MeshGeometryBuilder';
import type {
  TextOptions,
  TextGeometryInfo as CoreTextGeometryInfo,
  TextLayoutHandle,
  LoadedFont
} from '../core/types';
import type { HyphenationTrieNode } from '../hyphenation';

export interface ThreeTextGeometryInfo
  extends Omit<
    CoreTextGeometryInfo,
    'vertices' | 'normals' | 'indices' | 'colors' | 'glyphAttributes'
  > {
  geometry: BufferGeometry;
  getLoadedFont(): LoadedFont | undefined;
  getCacheSize(): number;
  clearCache(): void;
  measureTextWidth(text: string, letterSpacing?: number): number;
  update(options: Partial<TextOptions>): Promise<ThreeTextGeometryInfo>;
  dispose(): void;
}

function buildThreeResult(
  layoutHandle: TextLayoutHandle,
  meshPipeline: MeshGeometryBuilder,
  options: TextOptions
): ThreeTextGeometryInfo {
  const meshResult = meshPipeline.build(layoutHandle, options);

  const geometry = new BufferGeometry();
  geometry.setAttribute(
    'position',
    new Float32BufferAttribute(meshResult.vertices, 3)
  );
  geometry.setAttribute(
    'normal',
    new Float32BufferAttribute(meshResult.normals, 3)
  );
  geometry.setIndex(new Uint32BufferAttribute(meshResult.indices, 1));

  if (meshResult.colors) {
    geometry.setAttribute(
      'color',
      new Float32BufferAttribute(meshResult.colors, 3)
    );
  }

  if (meshResult.glyphAttributes) {
    geometry.setAttribute(
      'glyphCenter',
      new Float32BufferAttribute(meshResult.glyphAttributes.glyphCenter, 3)
    );
    geometry.setAttribute(
      'glyphIndex',
      new Float32BufferAttribute(meshResult.glyphAttributes.glyphIndex, 1)
    );
    geometry.setAttribute(
      'glyphLineIndex',
      new Float32BufferAttribute(meshResult.glyphAttributes.glyphLineIndex, 1)
    );
    geometry.setAttribute(
      'glyphProgress',
      new Float32BufferAttribute(meshResult.glyphAttributes.glyphProgress, 1)
    );
    geometry.setAttribute(
      'glyphBaselineY',
      new Float32BufferAttribute(meshResult.glyphAttributes.glyphBaselineY, 1)
    );
  }

  geometry.computeBoundingBox();

  const update = async (newOptions: Partial<TextOptions>): Promise<ThreeTextGeometryInfo> => {
    const mergedOptions: TextOptions = { ...options };
    for (const key in newOptions) {
      const value = newOptions[key as keyof TextOptions];
      if (value !== undefined) {
        (mergedOptions as any)[key] = value;
      }
    }

    if (
      newOptions.font !== undefined ||
      newOptions.fontVariations !== undefined ||
      newOptions.fontFeatures !== undefined
    ) {
      const newLayout = await layoutHandle.update(mergedOptions);
      meshPipeline.setFont(newLayout.loadedFont, newLayout.fontId);
      meshPipeline.reset();
      layoutHandle = newLayout;
      options = mergedOptions;
      return buildThreeResult(layoutHandle, meshPipeline, options);
    }

    const newLayout = await layoutHandle.update(mergedOptions);
    layoutHandle = newLayout;
    options = mergedOptions;
    return buildThreeResult(layoutHandle, meshPipeline, options);
  };

  return {
    geometry,
    glyphs: meshResult.glyphs,
    planeBounds: meshResult.planeBounds,
    stats: meshResult.stats,
    query: meshResult.query,
    coloredRanges: meshResult.coloredRanges,
    getLoadedFont: () => layoutHandle.getLoadedFont(),
    getCacheSize: () => meshPipeline.getCacheSize(),
    clearCache: () => meshPipeline.clearCache(),
    measureTextWidth: (text: string, letterSpacing?: number) =>
      layoutHandle.measureTextWidth(text, letterSpacing),
    update,
    dispose: () => {
      geometry.dispose();
      layoutHandle.dispose();
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

  static async create(options: TextOptions): Promise<ThreeTextGeometryInfo> {
    const layoutHandle = await TextCore.create(options);
    const meshPipeline = new MeshGeometryBuilder(
      layoutHandle.loadedFont,
      layoutHandle.fontId
    );
    return buildThreeResult(layoutHandle, meshPipeline, options);
  }
}

export type {
  TextOptions,
  ThreeTextGeometryInfo as TextGeometryInfo,
  LoadedFont
};
export type { HyphenationTrieNode };
