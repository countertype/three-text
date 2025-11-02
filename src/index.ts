export { Text } from './core/Text';
export { DEFAULT_CURVE_FIDELITY } from './core/geometry/Polygonizer';
export { FontMetadataExtractor } from './core/font/FontMetadata';
export { globalGlyphCache } from './core/cache/GlyphCache';
export type {
  GlyphCache,
  GlyphCacheStats,
  GlyphData
} from './core/cache/GlyphCache';

export type {
  TextAlign,
  TextDirection,
  LineInfo,
  LoadedFont,
  HarfBuzzModule,
  HarfBuzzAPI,
  HarfBuzzBlob,
  HarfBuzzFace,
  HarfBuzzFont,
  HarfBuzzBuffer,
  HarfBuzzInstance,
  VariationAxis,
  ExtractedMetrics,
  VerticalMetrics,
  FontMetrics,
  ProcessedGeometry,
  Triangles,
  GlyphGeometryInfo,
  TextGeometryInfo,
  TextOptions,
  ColorOptions,
  ColorByRange,
  ColoredRange,
  PathInfo,
  HyphenationPatternsMap,
  CurveFidelityConfig,
  LayoutOptions,
  GeometryOptimizationOptions,
  TextRange,
  TextQueryOptions
} from './core/types';

export type { HyphenationTrieNode } from './hyphenation';
