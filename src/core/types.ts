import type { HyphenationTrieNode } from '../hyphenation';
import type { CacheStats } from '../utils/Cache';
import type { Vec2, Vec3, BoundingBox } from '../utils/vectors';
export type { HyphenationTrieNode };

export interface Path {
  points: Vec2[];
  glyphIndex: number;
  bounds?: {
    minX: number;
    minY: number;
    maxX: number;
    maxY: number;
  };
}

export interface HarfBuzzGlyph {
  g: number; // glyphId
  cl: number; // cluster (original index in the line string)
  ax: number; // advance x
  ay: number; // advance y
  dx: number; // offset x
  dy: number; // offset y
  x?: number; // relative x position within word
  y?: number; // relative y position within word
  lineIndex: number;
  absoluteTextIndex: number;
}

export interface GlyphCluster {
  text: string;
  glyphs: HarfBuzzGlyph[];
  position: Vec3;
}

export interface GlyphContours {
  glyphId: number;
  paths: Path[];
  bounds: {
    min: { x: number; y: number };
    max: { x: number; y: number };
  };
}

export type TextAlign = 'left' | 'center' | 'right' | 'justify';
export type TextDirection = 'ltr' | 'rtl';

export interface LineInfo {
  text: string;
  originalStart: number;
  originalEnd: number;
  xOffset: number;
  adjustmentRatio?: number;
  isLastLine?: boolean;
  naturalWidth?: number;
  endedWithHyphen?: boolean;
}

export interface LoadedFont {
  hb: HarfBuzzAPI;
  fontBlob: HarfBuzzBlob;
  face: HarfBuzzFace;
  font: HarfBuzzFont;
  module: HarfBuzzModule;
  upem: number;
  metrics: ExtractedMetrics;
  fontVariations?: { [key: string]: number };
  fontFeatures?: { [tag: string]: boolean | number };
  isVariable?: boolean;
  variationAxes?: { [key: string]: VariationAxis };
  availableFeatures?: string[];
  featureNames?: { [tag: string]: string };
  _buffer?: ArrayBuffer;
}

export interface HarfBuzzModule {
  addFunction: (func: Function, signature: string) => number;
  exports: any;
  removeFunction: (ptr: number) => void;
}

export interface VariationAxis {
  min: number;
  default: number;
  max: number;
  name?: string;
}

export interface HarfBuzzAPI {
  createBlob: (data: Uint8Array) => HarfBuzzBlob;
  createFace: (blob: HarfBuzzBlob, index: number) => HarfBuzzFace;
  createFont: (face: HarfBuzzFace) => HarfBuzzFont;
  createBuffer: () => HarfBuzzBuffer;
  shape: (
    font: HarfBuzzFont,
    buffer: HarfBuzzBuffer,
    features?: string
  ) => void;
}

export interface HarfBuzzBlob {
  destroy: () => void;
}

export interface HarfBuzzFace {
  destroy: () => void;
  getAxisInfos: () => { [tag: string]: VariationAxis };
}

export interface HarfBuzzFont {
  ptr: number;
  destroy: () => void;
  setScale: (xScale: number, yScale: number) => void;
  setVariations: (variations: { [key: string]: number }) => void;
}

export interface HarfBuzzBuffer {
  addText: (text: string) => void;
  guessSegmentProperties: () => void;
  setDirection: (direction: string) => void;
  json: (font: HarfBuzzFont) => any[];
  destroy: () => void;
}

export interface HarfBuzzInstance {
  hb: HarfBuzzAPI;
  module: HarfBuzzModule;
}

// Raw metrics from font tables (OS/2, hhea, STAT)
export interface ExtractedMetrics {
  isCFF: boolean;
  unitsPerEm: number;
  hheaAscender: number | null;
  hheaDescender: number | null;
  hheaLineGap: number | null;
  typoAscender: number | null;
  typoDescender: number | null;
  typoLineGap: number | null;
  winAscent: number | null;
  winDescent: number | null;
  axisNames: { [tag: string]: string } | null;
}

export interface VerticalMetrics {
  ascender: number;
  descender: number;
  lineGap: number;
}

export interface FontMetrics {
  ascender: number;
  descender: number;
  lineGap: number;
  unitsPerEm: number;
  naturalLineHeight: number;
}

export interface ProcessedPath {
  outer: Path;
  holes: Path[];
}

export interface Triangles {
  vertices: number[];
  indices: number[];
}

export interface ProcessedGeometry {
  triangles: Triangles;
  contours: number[][];
  contoursAreBoundary?: boolean;
}

export interface GlyphData {
  geometry: ProcessedGeometry;
  vertices: Float32Array;
  normals: Float32Array;
  indices: Uint32Array;
  bounds: {
    min: { x: number; y: number; z: number };
    max: { x: number; y: number; z: number };
  };
  useCount: number;
}

export interface PathInfo {
  start: number;
  count: number;
}

export interface GlyphGeometryInfo {
  textIndex: number;
  lineIndex: number;
  vertexStart: number;
  vertexCount: number;
  bounds: {
    min: { x: number; y: number; z: number };
    max: { x: number; y: number; z: number };
  };
  paths?: PathInfo[];
}

export interface TextRange {
  start: number;
  end: number;
  originalText: string;
  bounds: {
    min: { x: number; y: number; z: number };
    max: { x: number; y: number; z: number };
  }[];
  glyphs: GlyphGeometryInfo[];
  lineIndices: number[];
}

export interface TextQueryOptions {
  byText?: string[];
  byCharRange?: { start: number; end: number }[];
}

export interface TextGeometryInfo {
  vertices: Float32Array;
  normals: Float32Array;
  indices: Uint32Array;
  colors?: Float32Array;
  glyphAttributes?: {
    glyphCenter: Float32Array;
    glyphIndex: Float32Array;
    glyphLineIndex: Float32Array;
    glyphProgress: Float32Array;
    glyphBaselineY: Float32Array;
  };
  glyphs: GlyphGeometryInfo[];
  planeBounds: BoundingBox;
  stats: {
    trianglesGenerated: number;
    verticesGenerated: number;
    pointsRemovedByVisvalingam: number;
    originalPointCount: number;
  } & Partial<CacheStats & { hitRate: number; memoryUsageMB: number }>;
  query(options: TextQueryOptions): TextRange[];
  coloredRanges?: ColoredRange[];
}

export interface TextHandle extends TextGeometryInfo {
  getLoadedFont(): LoadedFont | undefined;
  getCacheSize(): number;
  clearCache(): void;
  measureTextWidth(text: string, letterSpacing?: number): number;
  update(options: Partial<TextOptions>): Promise<TextHandle>;
}

export interface ColorByRange {
  start: number;
  end: number;
  color: [number, number, number];
}

export interface ColorOptions {
  default?: [number, number, number];
  byText?: { [text: string]: [number, number, number] };
  byCharRange?: ColorByRange[];
}

export interface ColoredRange {
  start: number;
  end: number;
  originalText: string;
  color: [number, number, number];
  bounds: {
    min: { x: number; y: number; z: number };
    max: { x: number; y: number; z: number };
  }[];
  glyphs: GlyphGeometryInfo[];
  lineIndices: number[];
}

export interface TextOptions {
  text: string;
  font: string | ArrayBuffer;
  size?: number;
  depth?: number;
  lineHeight?: number;
  letterSpacing?: number;
  perGlyphAttributes?: boolean;
  fontVariations?: { [key: string]: number };
  fontFeatures?: { [tag: string]: boolean | number };
  maxTextLength?: number;
  removeOverlaps?: boolean;
  curveSteps?: number; // Fixed segments per curve; overrides curveFidelity when set
  curveFidelity?: CurveFidelityConfig;
  geometryOptimization?: GeometryOptimizationOptions;
  layout?: LayoutOptions;
  color?: [number, number, number] | ColorOptions;
}

export interface HyphenationPatternsMap {
  [language: string]: HyphenationTrieNode;
}

export interface CurveFidelityConfig {
  distanceTolerance?: number; // max deviation from true curve, in font units (default: 0.5)
  angleTolerance?: number; // min angle between segments before subdivision stops, in radians (default: 0.2)
  cuspLimit?: number; // per-segment angle ceiling for cusp detection on cubics (default: 0, disabled)
  collinearityEpsilon?: number; // threshold below which points are treated as collinear (default: 1e-6)
  recursionLimit?: number; // max subdivision depth (default: 16)
}

export interface GeometryOptimizationOptions {
  enabled?: boolean; // Enable Visvalingam-Whyatt simplification (default: true)
  areaThreshold?: number; // Min triangle area for Visvalingam-Whyatt (default: 1.0)
}

export interface LayoutOptions {
  width?: number;
  align?: TextAlign;
  direction?: TextDirection;
  respectExistingBreaks?: boolean;
  hyphenate?: boolean;
  language?: string;
  patternsPath?: string;
  tolerance?: number;
  pretolerance?: number;
  emergencyStretch?: number;
  autoEmergencyStretch?: number;
  hyphenationPatterns?: HyphenationPatternsMap;
  lefthyphenmin?: number;
  righthyphenmin?: number;
  linepenalty?: number;
  adjdemerits?: number;
  hyphenpenalty?: number;
  exhyphenpenalty?: number;
  doublehyphendemerits?: number;
}
