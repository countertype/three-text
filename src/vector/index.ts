import { Text as TextCore } from '../core/Text';
import { GlyphVectorGeometryBuilder } from './GlyphVectorGeometryBuilder';
import { globalOutlineCache } from '../core/cache/sharedCaches';
import { buildVectorGeometry } from './LoopBlinnGeometry';
import type {
  TextOptions,
  TextLayoutHandle,
  VectorGlyphInfo,
  LoadedFont,
  TextQueryOptions,
  TextRange
} from '../core/types';
import type { VectorGeometryData } from './LoopBlinnGeometry';
import { TextRangeQuery } from '../core/layout/TextRangeQuery';
import type { HyphenationTrieNode } from '../hyphenation';

export interface VectorTextResult {
  glyphs: VectorGlyphInfo[];
  geometryData: VectorGeometryData;
  query(options: TextQueryOptions): TextRange[];
  getLoadedFont(): LoadedFont | undefined;
  measureTextWidth(text: string, letterSpacing?: number): number;
  update(options: Partial<TextOptions>): Promise<VectorTextResult>;
  dispose(): void;
}

function buildVectorResult(
  layoutHandle: TextLayoutHandle,
  vectorBuilder: GlyphVectorGeometryBuilder,
  options: TextOptions
): VectorTextResult {
  const scale = layoutHandle.layoutData.pixelsPerFontUnit;

  const { loopBlinnInput, glyphs } =
    vectorBuilder.buildForLoopBlinn(layoutHandle.clustersByLine, scale);
  const geometryData = buildVectorGeometry(loopBlinnInput);

  let cachedQuery: TextRangeQuery | null = null;

  const update = async (newOptions: Partial<TextOptions>): Promise<VectorTextResult> => {
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
      const newBuilder = new GlyphVectorGeometryBuilder(
        newLayout.loadedFont,
        globalOutlineCache
      );
      newBuilder.setFontId(newLayout.fontId);
      layoutHandle = newLayout;
      options = mergedOptions;
      return buildVectorResult(layoutHandle, newBuilder, options);
    }

    const newLayout = await layoutHandle.update(mergedOptions);
    layoutHandle = newLayout;
    options = mergedOptions;
    return buildVectorResult(layoutHandle, vectorBuilder, options);
  };

  return {
    glyphs,
    geometryData,
    query: (queryOptions: TextQueryOptions): TextRange[] => {
      if (!cachedQuery) {
        cachedQuery = new TextRangeQuery(options.text, glyphs);
      }
      return cachedQuery.execute(queryOptions);
    },
    getLoadedFont: () => layoutHandle.getLoadedFont(),
    measureTextWidth: (text: string, letterSpacing?: number) =>
      layoutHandle.measureTextWidth(text, letterSpacing),
    update,
    dispose: () => layoutHandle.dispose()
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
    const layoutHandle = await TextCore.create(options);
    const vectorBuilder = new GlyphVectorGeometryBuilder(
      layoutHandle.loadedFont,
      globalOutlineCache
    );
    vectorBuilder.setFontId(layoutHandle.fontId);
    return buildVectorResult(layoutHandle, vectorBuilder, options);
  }
}

export type {
  TextOptions,
  VectorTextResult as TextGeometryInfo,
  VectorGlyphInfo,
  LoadedFont
};
export type { HyphenationTrieNode };
export {
  buildVectorGeometry,
  extractContours
} from './LoopBlinnGeometry';
export type {
  VectorGeometryData,
  VectorGlyphAttributes,
  GlyphRange,
  VectorContour,
  LoopBlinnInput,
  LoopBlinnGlyphInput,
  QuadraticSegment
} from './LoopBlinnGeometry';
export { createVectorMeshes } from './loopBlinnTSL';
export type { VectorMeshes } from './loopBlinnTSL';
