import { Vector2, BufferGeometry, Vector3 } from 'three';
import type { HyphenationTrieNode } from '../hyphenation';
export type { HyphenationTrieNode };

export interface Path {
  points: Vector2[];
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
  position: Vector3;
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
  isVariable?: boolean;
  variationAxes?: { [key: string]: VariationAxis };
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
  shape: (font: HarfBuzzFont, buffer: HarfBuzzBuffer) => void;
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
  geometry: BufferGeometry;
  glyphs: GlyphGeometryInfo[];
  planeBounds: {
    min: { x: number; y: number; z: number };
    max: { x: number; y: number; z: number };
  };
  stats: {
    trianglesGenerated: number;
    verticesGenerated: number;
    pointsRemovedByVisvalingam: number;
    pointsRemovedByColinear: number;
    originalPointCount: number;
  };
  query(options: TextQueryOptions): TextRange[];
  coloredRanges?: ColoredRange[];
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
  font?: string | ArrayBuffer;
  size?: number;
  depth?: number;
  lineHeight?: number;
  letterSpacing?: number;
  separateGlyphsWithAttributes?: boolean;
  fontVariations?: { [key: string]: number };
  maxTextLength?: number;
  removeOverlaps?: boolean;
  curveFidelity?: CurveFidelityConfig;
  geometryOptimization?: GeometryOptimizationOptions;
  layout?: LayoutOptions;
  color?: [number, number, number] | ColorOptions;
  maxCacheSizeMB?: number;
}

export interface HyphenationPatternsMap {
  [language: string]: HyphenationTrieNode;
}

export interface CurveFidelityConfig {
  distanceTolerance?: number;
  angleTolerance?: number;
}

export interface GeometryOptimizationOptions {
  enabled?: boolean;
  areaThreshold?: number;
  colinearThreshold?: number;
  minSegmentLength?: number;
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
  looseness?: number;
  disableSingleWordDetection?: boolean;
}
