export { Text } from './core/Text';
export { MeshGeometryBuilder } from './mesh/MeshGeometryBuilder';
export { DEFAULT_CURVE_FIDELITY } from './mesh/geometry/Polygonizer';
export { FontMetadataExtractor } from './core/font/FontMetadata';
export { globalGlyphCache, createGlyphCache, globalOutlineCache } from './core/cache/sharedCaches';
export {
  DrawCallbackHandler,
  getSharedDrawCallbackHandler
} from './core/shaping/DrawCallbacks';
export type { GlyphDrawCollector } from './core/shaping/DrawCallbacks';
export { TextRangeQuery } from './core/layout/TextRangeQuery';
export type { CacheStats } from './utils/Cache';

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
  GlyphData,
  GlyphGeometryInfo,
  GlyphCluster,
  TextGeometryInfo,
  TextHandle,
  TextLayoutData,
  TextLayoutResult,
  TextLayoutHandle,
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
