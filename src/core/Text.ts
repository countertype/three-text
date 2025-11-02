const DEFAULT_MAX_TEXT_LENGTH = 100000;

import { BufferGeometry, Float32BufferAttribute } from 'three';
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
  FontMetrics,
  LoadedFont,
  HarfBuzzInstance,
  ColorOptions,
  ColoredRange,
  TextQueryOptions
} from './types';
import { perfLogger } from '../utils/PerformanceLogger';
import { debugLogger } from '../utils/DebugLogger';
import { FontLoader } from './font/FontLoader';
import { FontMetadataExtractor } from './font/FontMetadata';
import { TextMeasurer } from './shaping/TextMeasurer';
import { loadPattern } from '../hyphenation/HyphenationPatternLoader';
import type { HyphenationTrieNode } from '../hyphenation';
import { GlyphGeometryBuilder } from './cache/GlyphGeometryBuilder';
import { TextShaper } from './shaping/TextShaper';
import { globalGlyphCache, GlyphCache } from './cache/GlyphCache';
import { HarfBuzzLoader } from './shaping/HarfBuzzLoader';
import { TextRangeQuery } from './layout/TextRangeQuery';

declare global {
  interface Window {
    hbjs?: any;
    createHarfBuzz?: () => Promise<any>;
  }
}

interface TextConfig {
  maxCacheSizeMB?: number;
}

export class Text {
  private static patternCache = new Map<string, HyphenationTrieNode>();
  private static hbInitPromise: Promise<HarfBuzzInstance> | null = null;
  private static fontCache = new Map<string, LoadedFont>();
  private static fontIdCounter = 0;

  private fontLoader: FontLoader;
  private loadedFont?: LoadedFont;
  private currentFontId: string = '';
  private geometryBuilder?: GlyphGeometryBuilder;
  private textShaper?: TextShaper;
  private textLayout?: TextLayout;

  private constructor(config?: TextConfig) {
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

  // Initialize HarfBuzz WASM manually (optional - called automatically by create())
  public static init(): Promise<HarfBuzzInstance> {
    if (!Text.hbInitPromise) {
      Text.hbInitPromise = HarfBuzzLoader.getHarfBuzz();
    }
    return Text.hbInitPromise;
  }

  public static async create(
    options: TextOptions
  ): Promise<
    TextGeometryInfo &
      Pick<
        Text,
        | 'getLoadedFont'
        | 'getCacheStatistics'
        | 'clearCache'
        | 'measureTextWidth'
      >
  > {
    if (!options.font) {
      throw new Error(
        'Font is required. Specify options.font as a URL string or ArrayBuffer.'
      );
    }

    // Initialize HarfBuzz if not already done
    if (!Text.hbInitPromise) {
      Text.hbInitPromise = HarfBuzzLoader.getHarfBuzz();
    }

    const baseFontKey =
      typeof options.font === 'string'
        ? options.font
        : `buffer-${Text.generateFontContentHash(options.font)}`;

    const fontKey = options.fontVariations
      ? `${baseFontKey}_${JSON.stringify(options.fontVariations)}`
      : baseFontKey;

    let loadedFont = Text.fontCache.get(fontKey);
    if (!loadedFont) {
      loadedFont = await Text.loadAndCacheFont(
        fontKey,
        options.font,
        options.fontVariations
      );
    }

    const text = new Text({ maxCacheSizeMB: options.maxCacheSizeMB });
    text.setLoadedFont(loadedFont);

    const { font, maxCacheSizeMB, ...geometryOptions } = options;
    const result = await text.createGeometry(geometryOptions);

    return {
      ...result,
      getLoadedFont: () => text.getLoadedFont(),
      getCacheStatistics: () => text.getCacheStatistics(),
      clearCache: () => text.clearCache(),
      measureTextWidth: (textString: string, letterSpacing?: number) =>
        text.measureTextWidth(textString, letterSpacing)
    };
  }

  private static async loadAndCacheFont(
    fontKey: string,
    font: string | ArrayBuffer,
    fontVariations?: { [key: string]: number }
  ): Promise<LoadedFont> {
    const tempText = new Text();
    await tempText.loadFont(font, fontVariations);
    const loadedFont = tempText.getLoadedFont()!;
    Text.fontCache.set(fontKey, loadedFont);
    // Don't destroy tempText - the cached font references its HarfBuzz objects
    return loadedFont;
  }

  private static generateFontContentHash(buffer?: ArrayBuffer): string {
    if (buffer) {
      // Hash of first and last bytes plus length for uniqueness
      const view = new Uint8Array(buffer);
      return `${view[0]}_${view[Math.floor(view.length / 2)]}_${view[view.length - 1]}_${view.length}`;
    } else {
      // Fallback to counter if no buffer available
      return `${++Text.fontIdCounter}`;
    }
  }

  private setLoadedFont(loadedFont: LoadedFont): void {
    this.loadedFont = loadedFont;

    const contentHash = Text.generateFontContentHash(loadedFont._buffer);
    this.currentFontId = `font_${contentHash}`;
    if (loadedFont.fontVariations) {
      this.currentFontId += `_${JSON.stringify(loadedFont.fontVariations)}`;
    }
  }

  private async loadFont(
    fontSrc: string | ArrayBuffer,
    fontVariations?: { [key: string]: number }
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
      typeof fontSrc === 'string'
        ? await fetch(fontSrc).then((res) => {
            if (!res.ok) {
              throw new Error(
                `Failed to load font from ${fontSrc}: HTTP ${res.status} ${res.statusText}`
              );
            }
            return res.arrayBuffer();
          })
        : fontSrc;

    try {
      if (this.loadedFont) {
        this.destroy();
      }
      this.loadedFont = await this.fontLoader.loadFont(
        fontBuffer,
        fontVariations
      );

      const contentHash = Text.generateFontContentHash(fontBuffer);
      this.currentFontId = `font_${contentHash}`;
      if (fontVariations) {
        this.currentFontId += `_${JSON.stringify(fontVariations)}`;
      }
    } catch (error) {
      debugLogger.error('Failed to load font:', error);
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
      size: options.size || 72,
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
        const cache = options.maxCacheSizeMB
          ? new GlyphCache(options.maxCacheSizeMB)
          : globalGlyphCache;
        this.geometryBuilder = new GlyphGeometryBuilder(
          cache,
          this.loadedFont!
        );
        this.geometryBuilder.setFontId(this.currentFontId);
      }

      this.geometryBuilder.setCurveFidelityConfig(options.curveFidelity);
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

      const shapedResult = this.geometryBuilder.buildInstancedGeometry(
        clustersByLine,
        layoutData.depth,
        shouldRemoveOverlaps,
        this.loadedFont.metrics.isCFF,
        options.separateGlyphsWithAttributes || false
      );

      const cacheStats = this.geometryBuilder.getCacheStats();

      const result = this.finalizeGeometry(
        shapedResult.geometry,
        shapedResult.glyphInfos,
        shapedResult.planeBounds,
        options,
        cacheStats,
        options.text
      );

      if (options.separateGlyphsWithAttributes) {
        this.addGlyphAttributes(result.geometry, result.glyphs);
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
          debugLogger.warn(`Failed to load patterns for ${language}: ${error}`);
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
        JSON.stringify(options.fontVariations) !==
        JSON.stringify(this.loadedFont.fontVariations)
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
      size = 72,
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
      doublehyphendemerits,
      looseness,
      disableSingleWordDetection
    } = layout;

    let widthInFontUnits: number | undefined;
    if (width !== undefined) {
      widthInFontUnits = width * (this.loadedFont.upem / size);
    }

    const depthInFontUnits = depth * (this.loadedFont.upem / size);

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
      looseness,
      disableSingleWordDetection,
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
      size
    };
  }

  private applyColorSystem(
    geometry: BufferGeometry,
    glyphInfoArray: GlyphGeometryInfo[],
    color: [number, number, number] | ColorOptions,
    originalText: string
  ): ColoredRange[] {
    const vertexCount = geometry.attributes.position.count;
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

      // Apply text-based coloring using query system
      if (color.byText) {
        const rangeQuery = new TextRangeQuery(originalText, glyphInfoArray);
        const textRanges = rangeQuery.execute({
          byText: Object.keys(color.byText)
        });

        textRanges.forEach((range) => {
          const targetColor = color.byText![range.originalText];
          if (targetColor) {
            range.glyphs.forEach((glyph) => {
              for (let i = 0; i < glyph.vertexCount; i++) {
                const vertexIndex = (glyph.vertexStart + i) * 3;
                if (vertexIndex >= 0 && vertexIndex < colors.length) {
                  colors[vertexIndex] = targetColor[0];
                  colors[vertexIndex + 1] = targetColor[1];
                  colors[vertexIndex + 2] = targetColor[2];
                }
              }
            });

            coloredRanges.push({
              start: range.start,
              end: range.end,
              originalText: range.originalText,
              color: targetColor,
              bounds: range.bounds,
              glyphs: range.glyphs,
              lineIndices: range.lineIndices
            });
          }
        });
      }

      // Apply range coloring
      if (color.byCharRange) {
        color.byCharRange.forEach((range) => {
          const rangeGlyphs: GlyphGeometryInfo[] = [];

          for (const glyph of glyphInfoArray) {
            if (glyph.textIndex >= range.start && glyph.textIndex < range.end) {
              rangeGlyphs.push(glyph);
              for (let i = 0; i < glyph.vertexCount; i++) {
                const vertexIndex = (glyph.vertexStart + i) * 3;
                if (vertexIndex >= 0 && vertexIndex < colors.length) {
                  colors[vertexIndex] = range.color[0];
                  colors[vertexIndex + 1] = range.color[1];
                  colors[vertexIndex + 2] = range.color[2];
                }
              }
            }
          }

          coloredRanges.push({
            start: range.start,
            end: range.end,
            originalText: originalText.slice(range.start, range.end),
            color: range.color,
            bounds: [], // Would calculate from glyphs if needed
            glyphs: rangeGlyphs,
            lineIndices: [...new Set(rangeGlyphs.map((g) => g.lineIndex))]
          });
        });
      }
    }

    geometry.setAttribute('color', new Float32BufferAttribute(colors, 3));
    return coloredRanges;
  }

  private finalizeGeometry(
    geometry: BufferGeometry,
    glyphInfoArray: GlyphGeometryInfo[],
    planeBounds: {
      min: { x: number; y: number; z: number };
      max: { x: number; y: number; z: number };
    },
    options: TextOptions,
    cacheStats?: any,
    originalText?: string
  ) {
    const { layout = {}, size = 72 } = options;
    const { width, align = layout.direction === 'rtl' ? 'right' : 'left' } =
      layout;

    if (!this.textLayout) {
      this.textLayout = new TextLayout(this.loadedFont!);
    }

    const alignmentResult = this.textLayout.applyAlignment(geometry, {
      width,
      align,
      planeBounds
    });

    const offset = alignmentResult.offset;
    planeBounds.min.x = alignmentResult.adjustedBounds.min.x;
    planeBounds.max.x = alignmentResult.adjustedBounds.max.x;

    const finalScale = size / this.loadedFont!.upem;
    geometry.scale(finalScale, finalScale, finalScale);

    planeBounds.min.x *= finalScale;
    planeBounds.min.y *= finalScale;
    planeBounds.min.z *= finalScale;
    planeBounds.max.x *= finalScale;
    planeBounds.max.y *= finalScale;
    planeBounds.max.z *= finalScale;

    for (let i = 0; i < glyphInfoArray.length; i++) {
      const glyphInfo = glyphInfoArray[i];

      if (offset !== 0) {
        glyphInfo.bounds.min.x += offset;
        glyphInfo.bounds.max.x += offset;
      }

      glyphInfo.bounds.min.x *= finalScale;
      glyphInfo.bounds.min.y *= finalScale;
      glyphInfo.bounds.min.z *= finalScale;
      glyphInfo.bounds.max.x *= finalScale;
      glyphInfo.bounds.max.y *= finalScale;
      glyphInfo.bounds.max.z *= finalScale;
    }

    const coloredRanges = options.color
      ? this.applyColorSystem(
          geometry,
          glyphInfoArray,
          options.color,
          options.text
        )
      : undefined;

    // Collect optimization stats for return value
    const optimizationStats = this.geometryBuilder!.getOptimizationStats();
    const trianglesGenerated = geometry.index ? geometry.index.count / 3 : 0;
    const verticesGenerated = geometry.attributes.position.count;

    return {
      geometry,
      glyphs: glyphInfoArray,
      planeBounds,
      stats: {
        trianglesGenerated,
        verticesGenerated,
        pointsRemovedByVisvalingam:
          optimizationStats.pointsRemovedByVisvalingam,
        pointsRemovedByColinear: optimizationStats.pointsRemovedByColinear,
        originalPointCount: optimizationStats.originalPointCount,
        ...(cacheStats || {})
      },
      query: (options: TextQueryOptions) => {
        if (!originalText) {
          throw new Error('Original text not available for querying');
        }
        const queryInstance = new TextRangeQuery(originalText, glyphInfoArray);
        return queryInstance.execute(options);
      },
      coloredRanges
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
            debugLogger.warn(
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

  public getLoadedFont(): LoadedFont | undefined {
    return this.loadedFont;
  }

  public measureTextWidth(text: string, letterSpacing: number = 0): number {
    if (!this.loadedFont) {
      throw new Error('Font not loaded. Call loadFont() first');
    }

    return TextMeasurer.measureTextWidth(this.loadedFont, text, letterSpacing);
  }

  public getCacheStatistics() {
    if (this.geometryBuilder) {
      return this.geometryBuilder.getCacheStats();
    }
    return null;
  }

  public clearCache() {
    if (this.geometryBuilder) {
      this.geometryBuilder.clearCache();
    }
  }

  private addGlyphAttributes(
    geometry: BufferGeometry,
    glyphs: GlyphGeometryInfo[]
  ): void {
    const vertexCount = geometry.attributes.position.count;
    const glyphCenters = new Float32Array(vertexCount * 3);
    const glyphIndices = new Float32Array(vertexCount);
    const glyphLineIndices = new Float32Array(vertexCount);

    glyphs.forEach((glyph, index) => {
      const centerX = (glyph.bounds.min.x + glyph.bounds.max.x) / 2;
      const centerY = (glyph.bounds.min.y + glyph.bounds.max.y) / 2;
      const centerZ = (glyph.bounds.min.z + glyph.bounds.max.z) / 2;

      for (let i = 0; i < glyph.vertexCount; i++) {
        const vertexIndex = glyph.vertexStart + i;

        if (vertexIndex < vertexCount) {
          glyphCenters[vertexIndex * 3] = centerX;
          glyphCenters[vertexIndex * 3 + 1] = centerY;
          glyphCenters[vertexIndex * 3 + 2] = centerZ;

          glyphIndices[vertexIndex] = index;
          glyphLineIndices[vertexIndex] = glyph.lineIndex;
        }
      }
    });

    geometry.setAttribute(
      'glyphCenter',
      new Float32BufferAttribute(glyphCenters, 3)
    );
    geometry.setAttribute(
      'glyphIndex',
      new Float32BufferAttribute(glyphIndices, 1)
    );
    geometry.setAttribute(
      'glyphLineIndex',
      new Float32BufferAttribute(glyphLineIndices, 1)
    );
  }

  public destroy(): void {
    if (!this.loadedFont) {
      return;
    }

    const currentFont = this.loadedFont;

    try {
      FontLoader.destroyFont(currentFont);
    } catch (error) {
      debugLogger.warn('Error destroying HarfBuzz objects:', error);
    } finally {
      this.loadedFont = undefined;
      this.textLayout = undefined;
      this.textShaper = undefined;
    }
  }
}
