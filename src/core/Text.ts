const DEFAULT_MAX_TEXT_LENGTH = 100000;
const DEFAULT_FONT_SIZE = 72;

import { TextLayout } from './layout/TextLayout';
import {
  DEFAULT_TOLERANCE,
  DEFAULT_PRETOLERANCE,
  DEFAULT_EMERGENCY_STRETCH
} from './layout/constants';
import type {
  TextOptions,
  GlyphGeometryInfo,
  TextGeometryInfo,
  TextHandle,
  FontMetrics,
  LoadedFont,
  HarfBuzzInstance,
  ColorOptions,
  ColoredRange,
  TextQueryOptions
} from './types';
import { perfLogger } from '../utils/PerformanceLogger';
import { logger } from '../utils/Logger';
import { FontLoader } from './font/FontLoader';
import { FontMetadataExtractor } from './font/FontMetadata';
import { setWoff2Decoder } from './font/WoffConverter';
import { TextMeasurer } from './shaping/TextMeasurer';
import { loadPattern } from '../hyphenation/HyphenationPatternLoader';
import type { HyphenationTrieNode } from '../hyphenation';
import { GlyphGeometryBuilder } from './cache/GlyphGeometryBuilder';
import { TextShaper } from './shaping/TextShaper';
import { globalGlyphCache } from './cache/sharedCaches';
import { HarfBuzzLoader } from './shaping/HarfBuzzLoader';
import { TextRangeQuery } from './layout/TextRangeQuery';
import { loadBinary } from '../utils/loadBinary';

declare global {
  interface Window {
    hbjs?: any;
    createHarfBuzz?: () => Promise<any>;
  }
}

export class Text {
  private static patternCache = new Map<string, HyphenationTrieNode>();
  private static hbInitPromise: Promise<HarfBuzzInstance> | null = null;
  private static fontCache = new Map<string, LoadedFont>();
  private static fontCacheMemoryBytes = 0;
  private static maxFontCacheMemoryBytes = Infinity;
  private static fontIdCounter = 0;

  // Enable WOFF2 font support (adds ~45KB to bundle if imported)
  // Usage: import { woff2Decode } from 'woff2-decode'; Text.enableWoff2(woff2Decode);
  public static enableWoff2(decoder: (data: ArrayBuffer | Uint8Array) => Uint8Array | Promise<Uint8Array>): void {
    setWoff2Decoder(decoder);
  }

  // Stringify with sorted keys for cache stability
  private static stableStringify(obj: { [key: string]: any }): string {
    const keys = Object.keys(obj).sort();
    let result = '';
    for (let i = 0; i < keys.length; i++) {
      if (i > 0) result += ',';
      result += keys[i] + ':' + obj[keys[i]];
    }
    return result;
  }

  private fontLoader: FontLoader;
  private loadedFont?: LoadedFont;
  private currentFontId: string = '';
  private geometryBuilder?: GlyphGeometryBuilder;
  private textShaper?: TextShaper;
  private textLayout?: TextLayout;

  private constructor() {
    if (!Text.hbInitPromise) {
      Text.hbInitPromise = HarfBuzzLoader.getHarfBuzz();
    }
    this.fontLoader = new FontLoader(() => Text.hbInitPromise!);
  }

  public static setHarfBuzzPath(path: string): void {
    HarfBuzzLoader.setWasmPath(path);
    Text.hbInitPromise = null;
  }

  public static setHarfBuzzBuffer(wasmBuffer: ArrayBuffer): void {
    HarfBuzzLoader.setWasmBuffer(wasmBuffer);
    Text.hbInitPromise = null;
  }

  // Initialize HarfBuzz WASM (optional - create() calls this if needed)
  public static init(): Promise<HarfBuzzInstance> {
    if (!Text.hbInitPromise) {
      Text.hbInitPromise = HarfBuzzLoader.getHarfBuzz();
    }
    return Text.hbInitPromise;
  }

  public static async create(options: TextOptions): Promise<TextHandle> {
    if (!options.font) {
      throw new Error(
        'Font is required. Specify options.font as a URL string or ArrayBuffer.'
      );
    }

    // Initialize HarfBuzz if not already done
    if (!Text.hbInitPromise) {
      Text.hbInitPromise = HarfBuzzLoader.getHarfBuzz();
    }

    const loadedFont = await Text.resolveFont(options);

    const text = new Text();
    text.setLoadedFont(loadedFont);

    const result = await text.createGeometry(options);

    // Recursive update function
    const update = async (newOptions: Partial<TextOptions>): Promise<any> => {
      // Merge options - preserve font from original options if not provided
      const mergedOptions: TextOptions = { ...options };
      for (const key in newOptions) {
        const value = newOptions[key as keyof TextOptions];
        if (value !== undefined) {
          (mergedOptions as any)[key] = value;
        }
      }

      // If font definition or configuration changed, reload font and reset helpers
      if (
        newOptions.font !== undefined ||
        newOptions.fontVariations !== undefined ||
        newOptions.fontFeatures !== undefined
      ) {
        const newLoadedFont = await Text.resolveFont(mergedOptions);
        text.setLoadedFont(newLoadedFont);

        // Reset geometry builder and shaper to use new font
        text.resetHelpers();
      }

      // Update closure options for next time
      options = mergedOptions;

      const newResult = await text.createGeometry(options);

      return {
        ...newResult,
        getLoadedFont: () => text.getLoadedFont(),
        getCacheSize: () => text.getCacheSize(),
        clearCache: () => text.clearCache(),
        measureTextWidth: (textString: string, letterSpacing?: number) =>
          text.measureTextWidth(textString, letterSpacing),
        update
      };
    };

    return {
      ...result,
      getLoadedFont: () => text.getLoadedFont(),
      getCacheSize: () => text.getCacheSize(),
      clearCache: () => text.clearCache(),
      measureTextWidth: (textString: string, letterSpacing?: number) =>
        text.measureTextWidth(textString, letterSpacing),
      update
    };
  }

  private static async resolveFont(options: TextOptions): Promise<LoadedFont> {
    const baseFontKey =
      typeof options.font === 'string'
        ? options.font
        : `buffer-${Text.generateFontContentHash(options.font)}`;

    let fontKey = baseFontKey;
    if (options.fontVariations) {
      fontKey += `_var_${Text.stableStringify(options.fontVariations)}`;
    }
    if (options.fontFeatures) {
      fontKey += `_feat_${Text.stableStringify(options.fontFeatures)}`;
    }

    let loadedFont = Text.fontCache.get(fontKey);
    if (!loadedFont) {
      loadedFont = await Text.loadAndCacheFont(
        fontKey,
        options.font!,
        options.fontVariations,
        options.fontFeatures
      );
    }
    return loadedFont;
  }

  private static async loadAndCacheFont(
    fontKey: string,
    font: string | ArrayBuffer,
    fontVariations?: { [key: string]: number },
    fontFeatures?: { [tag: string]: boolean | number }
  ): Promise<LoadedFont> {
    const tempText = new Text();
    await tempText.loadFont(font, fontVariations, fontFeatures);
    const loadedFont = tempText.getLoadedFont()!;
    Text.fontCache.set(fontKey, loadedFont);
    Text.trackFontCacheAdd(loadedFont);
    Text.enforceFontCacheMemoryLimit();
    return loadedFont;
  }

  private static trackFontCacheAdd(loadedFont: LoadedFont) {
    const size = loadedFont._buffer?.byteLength ?? 0;
    Text.fontCacheMemoryBytes += size;
  }

  private static trackFontCacheRemove(fontKey: string) {
    const font = Text.fontCache.get(fontKey);
    if (!font) return;
    const size = font._buffer?.byteLength ?? 0;
    Text.fontCacheMemoryBytes -= size;
    if (Text.fontCacheMemoryBytes < 0) Text.fontCacheMemoryBytes = 0;
  }

  private static enforceFontCacheMemoryLimit(): void {
    if (Text.maxFontCacheMemoryBytes === Infinity) return;
    while (
      Text.fontCacheMemoryBytes > Text.maxFontCacheMemoryBytes &&
      Text.fontCache.size > 0
    ) {
      const firstKey = Text.fontCache.keys().next().value;
      if (firstKey === undefined) break;
      Text.trackFontCacheRemove(firstKey);
      Text.fontCache.delete(firstKey);
    }
  }

  private static generateFontContentHash(buffer?: ArrayBuffer): string {
    if (buffer) {
      // FNV-1a hash sampling 32 points
      const view = new Uint8Array(buffer);
      let hash = 2166136261;

      const samplePoints = Math.min(32, view.length);
      const step = Math.floor(view.length / samplePoints);

      for (let i = 0; i < samplePoints; i++) {
        const index = i * step;
        hash ^= view[index];
        hash = Math.imul(hash, 16777619);
      }

      hash ^= view.length;
      hash = Math.imul(hash, 16777619);

      return (hash >>> 0).toString(36);
    } else {
      return `c${++Text.fontIdCounter}`;
    }
  }

  private setLoadedFont(loadedFont: LoadedFont): void {
    this.loadedFont = loadedFont;

    const contentHash = Text.generateFontContentHash(loadedFont._buffer);
    this.currentFontId = `font_${contentHash}`;
    if (loadedFont.fontVariations) {
      this.currentFontId += `_var_${Text.stableStringify(loadedFont.fontVariations)}`;
    }
    if (loadedFont.fontFeatures) {
      this.currentFontId += `_feat_${Text.stableStringify(loadedFont.fontFeatures)}`;
    }
  }

  private async loadFont(
    fontSrc: string | ArrayBuffer,
    fontVariations?: { [key: string]: number },
    fontFeatures?: { [tag: string]: boolean | number }
  ) {
    perfLogger.start('Text.loadFont', {
      fontSrc:
        typeof fontSrc === 'string' ? fontSrc : `buffer(${fontSrc.byteLength})`
    });

    if (!Text.hbInitPromise) {
      Text.hbInitPromise = HarfBuzzLoader.getHarfBuzz();
    }
    await Text.hbInitPromise;

    const fontBuffer =
      typeof fontSrc === 'string' ? await loadBinary(fontSrc) : fontSrc;

    try {
      if (this.loadedFont) {
        this.destroy();
      }
      this.loadedFont = await this.fontLoader.loadFont(
        fontBuffer,
        fontVariations
      );

      if (fontFeatures) {
        this.loadedFont.fontFeatures = fontFeatures;
      }

      const contentHash = Text.generateFontContentHash(fontBuffer);
      this.currentFontId = `font_${contentHash}`;
      if (fontVariations) {
        this.currentFontId += `_var_${Text.stableStringify(fontVariations)}`;
      }
      if (fontFeatures) {
        this.currentFontId += `_feat_${Text.stableStringify(fontFeatures)}`;
      }
    } catch (error) {
      logger.error('Failed to load font:', error);
      throw error;
    } finally {
      perfLogger.end('Text.loadFont');
    }
  }

  private async createGeometry(
    options: TextOptions
  ): Promise<TextGeometryInfo> {
    perfLogger.start('Text.createGeometry', {
      textLength: options.text.length,
      size: options.size || DEFAULT_FONT_SIZE,
      hasLayout: !!options.layout,
      mode: 'cached'
    });

    try {
      if (!this.loadedFont) {
        throw new Error(
          'Font not loaded. Use Text.create() with a font option.'
        );
      }

      const updatedOptions = await this.prepareHyphenation(options);
      this.validateOptions(updatedOptions);
      options = updatedOptions;
      this.updateFontVariations(options);

      if (!this.geometryBuilder) {
        this.geometryBuilder = new GlyphGeometryBuilder(
          globalGlyphCache,
          this.loadedFont!
        );
        this.geometryBuilder.setFontId(this.currentFontId);
      }

      // Curve flattening: either use fixed-step De Casteljau (`curveSteps`) OR
      // adaptive AGG-style tolerances (`curveFidelity`)
      const useCurveSteps =
        options.curveSteps !== undefined &&
        options.curveSteps !== null &&
        options.curveSteps > 0;
      this.geometryBuilder.setCurveSteps(options.curveSteps);
      this.geometryBuilder.setCurveFidelityConfig(
        useCurveSteps ? undefined : options.curveFidelity
      );
      this.geometryBuilder.setGeometryOptimization(
        options.geometryOptimization
      );

      this.loadedFont.font.setScale(this.loadedFont.upem, this.loadedFont.upem);

      if (!this.textShaper) {
        this.textShaper = new TextShaper(
          this.loadedFont,
          this.geometryBuilder!
        );
      }

      const layoutData = this.prepareLayout(options);

      // Auto-detect: variable fonts need overlap removal, static fonts can use fast path
      // Allow manual override via options.removeOverlaps
      const shouldRemoveOverlaps: boolean =
        options.removeOverlaps ?? this.loadedFont.isVariable ?? false;

      const clustersByLine = this.textShaper!.shapeLines(
        layoutData.lines,
        layoutData.scaledLineHeight,
        layoutData.letterSpacing,
        layoutData.align,
        layoutData.direction,
        options.color,
        options.text
      );

      // Pre-compute which character indices will be colored. This allows geometry building
      // to selectively use glyph-level caching (separate vertices) only for clusters containing
      // colored text, while non-colored clusters can still use fast cluster-level merging
      let coloredTextIndices: Set<number> | undefined;
      let byTextMatches:
        | { pattern: string; start: number; end: number }[]
        | undefined;
      if (
        options.color &&
        typeof options.color === 'object' &&
        !Array.isArray(options.color)
      ) {
        if (options.color.byText || options.color.byCharRange) {
          // Glyphs don't exist yet, so we scan text directly
          coloredTextIndices = new Set<number>();
          if (options.color.byText) {
            byTextMatches = [];
            for (const pattern of Object.keys(options.color.byText)) {
              let index = 0;
              while ((index = options.text.indexOf(pattern, index)) !== -1) {
                byTextMatches.push({
                  pattern,
                  start: index,
                  end: index + pattern.length
                });
                for (let i = index; i < index + pattern.length; i++) {
                  coloredTextIndices.add(i);
                }
                index += pattern.length;
              }
            }
          }
          if (options.color.byCharRange) {
            for (const range of options.color.byCharRange) {
              for (let i = range.start; i < range.end; i++) {
                coloredTextIndices.add(i);
              }
            }
          }
        }
      }

      const shapedResult = this.geometryBuilder.buildInstancedGeometry(
        clustersByLine,
        layoutData.depth,
        shouldRemoveOverlaps,
        this.loadedFont.metrics.isCFF,
        layoutData.pixelsPerFontUnit,
        options.perGlyphAttributes ?? false,
        coloredTextIndices
      );

      const result = this.finalizeGeometry(
        shapedResult.vertices,
        shapedResult.normals,
        shapedResult.indices,
        shapedResult.glyphInfos,
        shapedResult.planeBounds,
        options,
        options.text,
        byTextMatches
      );

      if (options.perGlyphAttributes) {
        const glyphAttrs = this.createGlyphAttributes(
          result.vertices.length / 3,
          result.glyphs
        );
        result.glyphAttributes = glyphAttrs;
      }

      return result;
    } finally {
      perfLogger.end('Text.createGeometry');
    }
  }

  private async prepareHyphenation(options: TextOptions): Promise<TextOptions> {
    if (options.layout?.hyphenate !== false && options.layout?.width) {
      const language = options.layout?.language || 'en-us';

      if (!options.layout?.hyphenationPatterns?.[language]) {
        try {
          // Check if pattern is already cached (from registerPattern or previous load)
          if (!Text.patternCache.has(language)) {
            const pattern = await loadPattern(
              language,
              options.layout?.patternsPath
            );
            Text.patternCache.set(language, pattern);
          }

          return {
            ...options,
            layout: {
              ...options.layout,
              hyphenationPatterns: {
                ...options.layout?.hyphenationPatterns,
                [language]: Text.patternCache.get(language)!
              }
            }
          };
        } catch (error) {
          logger.warn(`Failed to load patterns for ${language}: ${error}`);
          return {
            ...options,
            layout: {
              ...options.layout,
              hyphenate: false
            }
          };
        }
      }
    }
    return options;
  }

  private validateOptions(options: TextOptions): void {
    if (!options.text) {
      throw new Error('Text content is required');
    }

    const maxLength = options.maxTextLength ?? DEFAULT_MAX_TEXT_LENGTH;
    if (options.text.length > maxLength) {
      throw new Error(`Text exceeds ${maxLength} character limit`);
    }
  }

  private updateFontVariations(options: TextOptions): void {
    if (options.fontVariations && this.loadedFont) {
      if (
        Text.stableStringify(options.fontVariations) !==
        Text.stableStringify(this.loadedFont.fontVariations || {})
      ) {
        this.loadedFont.font.setVariations(options.fontVariations);
        this.loadedFont.fontVariations = options.fontVariations;
      }
    }
  }

  private prepareLayout(options: TextOptions) {
    if (!this.loadedFont) {
      throw new Error('Font not loaded. Use Text.create() with a font option');
    }

    const {
      text,
      size = DEFAULT_FONT_SIZE,
      depth = 0,
      lineHeight = 1.0,
      letterSpacing = 0,
      layout = {}
    } = options;

    const {
      width,
      direction = 'ltr',
      align = direction === 'rtl' ? 'right' : 'left',
      respectExistingBreaks = true,
      hyphenate = true,
      language = 'en-us',
      tolerance = DEFAULT_TOLERANCE,
      pretolerance = DEFAULT_PRETOLERANCE,
      emergencyStretch = DEFAULT_EMERGENCY_STRETCH,
      autoEmergencyStretch,
      hyphenationPatterns,
      lefthyphenmin,
      righthyphenmin,
      linepenalty,
      adjdemerits,
      hyphenpenalty,
      exhyphenpenalty,
      doublehyphendemerits
    } = layout;

    const fontUnitsPerPixel = this.loadedFont.upem / size;

    let widthInFontUnits: number | undefined;
    if (width !== undefined) {
      widthInFontUnits = width * fontUnitsPerPixel;
    }

    // Keep depth behavior consistent with Extruder: extremely small non-zero depths
    // are clamped to a minimum back offset to prevent Z fighting
    const rawDepthInFontUnits = depth * fontUnitsPerPixel;
    const minExtrudeDepth = this.loadedFont.upem * 0.000025;
    const depthInFontUnits =
      rawDepthInFontUnits <= 0
        ? 0
        : Math.max(rawDepthInFontUnits, minExtrudeDepth);

    if (!this.textLayout) {
      this.textLayout = new TextLayout(this.loadedFont);
    }
    const layoutResult = this.textLayout.computeLines({
      text,
      width: widthInFontUnits,
      align,
      direction,
      hyphenate,
      language,
      respectExistingBreaks,
      tolerance,
      pretolerance,
      emergencyStretch,
      autoEmergencyStretch,
      hyphenationPatterns,
      lefthyphenmin,
      righthyphenmin,
      linepenalty,
      adjdemerits,
      hyphenpenalty,
      exhyphenpenalty,
      doublehyphendemerits,
      letterSpacing
    });

    const metrics = FontMetadataExtractor.getVerticalMetrics(
      this.loadedFont.metrics
    );
    const fontLineHeight = metrics.ascender - metrics.descender;
    const scaledLineHeight = fontLineHeight * lineHeight;

    return {
      lines: layoutResult.lines,
      scaledLineHeight,
      letterSpacing,
      align,
      direction,
      depth: depthInFontUnits,
      size,
      pixelsPerFontUnit: 1 / fontUnitsPerPixel
    };
  }

  private applyColorSystem(
    vertices: Float32Array,
    glyphInfoArray: GlyphGeometryInfo[],
    color: [number, number, number] | ColorOptions,
    originalText: string,
    byTextMatches?: { pattern: string; start: number; end: number }[]
  ): { colors: Float32Array; coloredRanges: ColoredRange[] } {
    const vertexCount = vertices.length / 3;
    const colors = new Float32Array(vertexCount * 3);
    const coloredRanges: ColoredRange[] = [];

    // Simple case: array color for all text
    if (Array.isArray(color)) {
      for (let i = 0; i < vertexCount; i++) {
        const baseIndex = i * 3;
        colors[baseIndex] = color[0]; // R
        colors[baseIndex + 1] = color[1]; // G
        colors[baseIndex + 2] = color[2]; // B
      }

      // Return single range covering all text
      coloredRanges.push({
        start: 0,
        end: originalText.length,
        originalText,
        color,
        bounds: [], // Would need to calculate if needed
        glyphs: glyphInfoArray,
        lineIndices: [...new Set(glyphInfoArray.map((g) => g.lineIndex))]
      });
    } else {
      // More complex case: object with default/byText/byCharRange
      const defaultColor = color.default || [1, 1, 1];

      for (let i = 0; i < colors.length; i += 3) {
        colors[i] = defaultColor[0];
        colors[i + 1] = defaultColor[1];
        colors[i + 2] = defaultColor[2];
      }

      // Build glyph index once for both byText and byCharRange
      let glyphsByTextIndex: Map<number, GlyphGeometryInfo[]> | undefined;
      if ((color.byText && byTextMatches) || color.byCharRange) {
        glyphsByTextIndex = new Map();
        for (const glyph of glyphInfoArray) {
          const existing = glyphsByTextIndex.get(glyph.textIndex);
          if (existing) {
            existing.push(glyph);
          } else {
            glyphsByTextIndex.set(glyph.textIndex, [glyph]);
          }
        }
      }

      if (color.byText && byTextMatches && glyphsByTextIndex) {
        for (const match of byTextMatches) {
          const targetColor = color.byText[match.pattern];
          if (!targetColor) continue;

          const matchGlyphs: GlyphGeometryInfo[] = [];
          const lineGroups = new Map<number, GlyphGeometryInfo[]>();

          for (let i = match.start; i < match.end; i++) {
            const glyphs = glyphsByTextIndex.get(i);
            if (glyphs) {
              for (const glyph of glyphs) {
                matchGlyphs.push(glyph);
                const lineGlyphs = lineGroups.get(glyph.lineIndex);
                if (lineGlyphs) {
                  lineGlyphs.push(glyph);
                } else {
                  lineGroups.set(glyph.lineIndex, [glyph]);
                }
                // Color vertices owned by this glyph
                for (let v = 0; v < glyph.vertexCount; v++) {
                  const vertexIndex = (glyph.vertexStart + v) * 3;
                  if (vertexIndex >= 0 && vertexIndex < colors.length) {
                    colors[vertexIndex] = targetColor[0];
                    colors[vertexIndex + 1] = targetColor[1];
                    colors[vertexIndex + 2] = targetColor[2];
                  }
                }
              }
            }
          }

          // Calculate bounds per line for collision detection
          const bounds = Array.from(lineGroups.values()).map((lineGlyphs) =>
            this.calculateGlyphBounds(lineGlyphs)
          );

          coloredRanges.push({
            start: match.start,
            end: match.end,
            originalText: match.pattern,
            color: targetColor,
            bounds,
            glyphs: matchGlyphs,
            lineIndices: Array.from(lineGroups.keys()).sort((a, b) => a - b)
          });
        }
      }

      // Apply range coloring
      if (color.byCharRange && glyphsByTextIndex) {
        for (const range of color.byCharRange) {
          const rangeGlyphs: GlyphGeometryInfo[] = [];
          const lineGroups = new Map<number, GlyphGeometryInfo[]>();

          for (let i = range.start; i < range.end; i++) {
            const glyphs = glyphsByTextIndex.get(i);
            if (glyphs) {
              for (const glyph of glyphs) {
                rangeGlyphs.push(glyph);
                const lineGlyphs = lineGroups.get(glyph.lineIndex);
                if (lineGlyphs) {
                  lineGlyphs.push(glyph);
                } else {
                  lineGroups.set(glyph.lineIndex, [glyph]);
                }
                // Color vertices owned by this glyph
                for (let v = 0; v < glyph.vertexCount; v++) {
                  const vertexIndex = (glyph.vertexStart + v) * 3;
                  if (vertexIndex >= 0 && vertexIndex < colors.length) {
                    colors[vertexIndex] = range.color[0];
                    colors[vertexIndex + 1] = range.color[1];
                    colors[vertexIndex + 2] = range.color[2];
                  }
                }
              }
            }
          }

          // Calculate bounds per line for collision detection
          const bounds = Array.from(lineGroups.values()).map((lineGlyphs) =>
            this.calculateGlyphBounds(lineGlyphs)
          );

          coloredRanges.push({
            start: range.start,
            end: range.end,
            originalText: originalText.slice(range.start, range.end),
            color: range.color,
            bounds,
            glyphs: rangeGlyphs,
            lineIndices: Array.from(lineGroups.keys()).sort((a, b) => a - b)
          });
        }
      }
    }

    return { colors, coloredRanges };
  }

  private calculateGlyphBounds(glyphs: GlyphGeometryInfo[]): {
    min: { x: number; y: number; z: number };
    max: { x: number; y: number; z: number };
  } {
    if (glyphs.length === 0) {
      return {
        min: { x: 0, y: 0, z: 0 },
        max: { x: 0, y: 0, z: 0 }
      };
    }

    let minX = Infinity,
      minY = Infinity,
      minZ = Infinity;
    let maxX = -Infinity,
      maxY = -Infinity,
      maxZ = -Infinity;

    for (const glyph of glyphs) {
      if (glyph.bounds.min.x < minX) minX = glyph.bounds.min.x;
      if (glyph.bounds.min.y < minY) minY = glyph.bounds.min.y;
      if (glyph.bounds.min.z < minZ) minZ = glyph.bounds.min.z;
      if (glyph.bounds.max.x > maxX) maxX = glyph.bounds.max.x;
      if (glyph.bounds.max.y > maxY) maxY = glyph.bounds.max.y;
      if (glyph.bounds.max.z > maxZ) maxZ = glyph.bounds.max.z;
    }

    return {
      min: { x: minX, y: minY, z: minZ },
      max: { x: maxX, y: maxY, z: maxZ }
    };
  }

  private finalizeGeometry(
    vertices: Float32Array,
    normals: Float32Array,
    indices: Uint32Array,
    glyphInfoArray: GlyphGeometryInfo[],
    planeBounds: {
      min: { x: number; y: number; z: number };
      max: { x: number; y: number; z: number };
    },
    options: TextOptions,
    originalText?: string,
    byTextMatches?: { pattern: string; start: number; end: number }[]
  ): TextGeometryInfo {
    const { layout = {} } = options;
    const { width, align = layout.direction === 'rtl' ? 'right' : 'left' } =
      layout;

    if (!this.textLayout) {
      this.textLayout = new TextLayout(this.loadedFont!);
    }

    const alignmentResult = this.textLayout.computeAlignmentOffset({
      width,
      align,
      planeBounds
    });

    const offset = alignmentResult.offset;
    planeBounds.min.x = alignmentResult.adjustedBounds.min.x;
    planeBounds.max.x = alignmentResult.adjustedBounds.max.x;

    if (offset !== 0) {
      for (let i = 0; i < vertices.length; i += 3) {
        vertices[i] += offset;
      }
      for (let i = 0; i < glyphInfoArray.length; i++) {
        glyphInfoArray[i].bounds.min.x += offset;
        glyphInfoArray[i].bounds.max.x += offset;
      }
    }

    let colors: Float32Array | undefined;
    let coloredRanges: ColoredRange[] | undefined;

    if (options.color) {
      const colorResult = this.applyColorSystem(
        vertices,
        glyphInfoArray,
        options.color,
        options.text,
        byTextMatches
      );
      colors = colorResult.colors;
      coloredRanges = colorResult.coloredRanges;
    }

    // Collect optimization stats for return value
    const optimizationStats = this.geometryBuilder!.getOptimizationStats();
    const trianglesGenerated = indices.length / 3;
    const verticesGenerated = vertices.length / 3;

    return {
      vertices,
      normals,
      indices,
      colors,
      glyphs: glyphInfoArray,
      planeBounds,
      stats: {
        trianglesGenerated,
        verticesGenerated,
        pointsRemovedByVisvalingam:
          optimizationStats.pointsRemovedByVisvalingam,
        originalPointCount: optimizationStats.originalPointCount
      },
      query: (() => {
        let cachedQuery: TextRangeQuery | null = null;
        return (options: TextQueryOptions) => {
          if (!originalText) {
            throw new Error('Original text not available for querying');
          }
          if (!cachedQuery) {
            cachedQuery = new TextRangeQuery(originalText, glyphInfoArray);
          }
          return cachedQuery.execute(options);
        };
      })(),
      coloredRanges,
      glyphAttributes: undefined
    };
  }

  public getFontMetrics(): FontMetrics {
    if (!this.loadedFont) {
      throw new Error('Font not loaded. Call loadFont() first');
    }

    return FontMetadataExtractor.getFontMetrics(this.loadedFont.metrics);
  }

  public static async preloadPatterns(
    languages: string[],
    patternsPath?: string
  ): Promise<void> {
    await Promise.all(
      languages.map(async (language) => {
        if (!Text.patternCache.has(language)) {
          try {
            const pattern = await loadPattern(language, patternsPath);
            Text.patternCache.set(language, pattern);
          } catch (error) {
            logger.warn(
              `Failed to pre-load patterns for ${language}: ${error}`
            );
          }
        }
      })
    );
  }

  public static registerPattern(
    language: string,
    pattern: HyphenationTrieNode
  ): void {
    Text.patternCache.set(language, pattern);
  }

  public static setMaxFontCacheMemoryMB(limitMB: number): void {
    Text.maxFontCacheMemoryBytes =
      limitMB === Infinity
        ? Infinity
        : Math.max(1, Math.floor(limitMB)) * 1024 * 1024;
    Text.enforceFontCacheMemoryLimit();
  }

  public getLoadedFont(): LoadedFont | undefined {
    return this.loadedFont;
  }

  public measureTextWidth(text: string, letterSpacing: number = 0): number {
    if (!this.loadedFont) {
      throw new Error('Font not loaded. Call loadFont() first');
    }

    return TextMeasurer.measureTextWidth(this.loadedFont, text, letterSpacing);
  }

  public getCacheSize(): number {
    if (this.geometryBuilder) {
      return this.geometryBuilder.getCacheStats().size;
    }
    return 0;
  }

  public clearCache() {
    if (this.geometryBuilder) {
      this.geometryBuilder.clearCache();
    }
  }

  private createGlyphAttributes(
    vertexCount: number,
    glyphs: GlyphGeometryInfo[]
  ): {
    glyphCenter: Float32Array;
    glyphIndex: Float32Array;
    glyphLineIndex: Float32Array;
    glyphProgress: Float32Array;
    glyphBaselineY: Float32Array;
  } {
    const glyphCenters = new Float32Array(vertexCount * 3);
    const glyphIndices = new Float32Array(vertexCount);
    const glyphLineIndices = new Float32Array(vertexCount);
    const glyphProgress = new Float32Array(vertexCount);
    const glyphBaselineY = new Float32Array(vertexCount);

    let minX = Infinity;
    let maxX = -Infinity;
    for (let i = 0; i < glyphs.length; i++) {
      const cx = (glyphs[i].bounds.min.x + glyphs[i].bounds.max.x) / 2;
      if (cx < minX) minX = cx;
      if (cx > maxX) maxX = cx;
    }
    const range = maxX - minX;

    for (let index = 0; index < glyphs.length; index++) {
      const glyph = glyphs[index];
      const centerX = (glyph.bounds.min.x + glyph.bounds.max.x) / 2;
      const centerY = (glyph.bounds.min.y + glyph.bounds.max.y) / 2;
      const centerZ = (glyph.bounds.min.z + glyph.bounds.max.z) / 2;
      const baselineY = glyph.bounds.min.y;
      const progress = range > 0 ? (centerX - minX) / range : 0;

      const start = glyph.vertexStart;
      const end = Math.min(start + glyph.vertexCount, vertexCount);
      if (end <= start) continue;

      glyphIndices.fill(index, start, end);
      glyphLineIndices.fill(glyph.lineIndex, start, end);
      glyphProgress.fill(progress, start, end);
      glyphBaselineY.fill(baselineY, start, end);

      for (let v = start * 3; v < end * 3; v += 3) {
        glyphCenters[v] = centerX;
        glyphCenters[v + 1] = centerY;
        glyphCenters[v + 2] = centerZ;
      }
    }

    return {
      glyphCenter: glyphCenters,
      glyphIndex: glyphIndices,
      glyphLineIndex: glyphLineIndices,
      glyphProgress,
      glyphBaselineY
    };
  }

  private resetHelpers(): void {
    this.geometryBuilder = undefined;
    this.textShaper = undefined;
    this.textLayout = undefined;
  }

  public destroy(): void {
    if (!this.loadedFont) {
      return;
    }

    const currentFont = this.loadedFont;

    try {
      FontLoader.destroyFont(currentFont);
    } catch (error) {
      logger.warn('Error destroying HarfBuzz objects:', error);
    } finally {
      this.loadedFont = undefined;
      this.textLayout = undefined;
      this.textShaper = undefined;
    }
  }
}
