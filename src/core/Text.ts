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
  TextLayoutResult,
  TextLayoutHandle,
  FontMetrics,
  LoadedFont,
  HarfBuzzInstance
} from './types';
import { perfLogger } from '../utils/PerformanceLogger';
import { logger } from '../utils/Logger';
import { FontLoader } from './font/FontLoader';
import { FontMetadataExtractor } from './font/FontMetadata';
import { setWoff2Decoder } from './font/WoffConverter';
import { TextMeasurer } from './shaping/TextMeasurer';
import { loadPattern } from '../hyphenation/HyphenationPatternLoader';
import type { HyphenationTrieNode } from '../hyphenation';
import { TextShaper } from './shaping/TextShaper';
import { HarfBuzzLoader } from './shaping/HarfBuzzLoader';
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
  private static fontLoadPromises = new Map<string, Promise<LoadedFont>>();
  private static fontRefCounts = new Map<string, number>();
  private static fontCacheMemoryBytes = 0;
  private static maxFontCacheMemoryBytes = Infinity;
  private static fontIdCounter = 0;

  public static enableWoff2(decoder: (data: ArrayBuffer | Uint8Array) => Uint8Array | Promise<Uint8Array>): void {
    setWoff2Decoder(decoder);
  }

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
  private currentFontCacheKey?: string;
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

  public static init(): Promise<HarfBuzzInstance> {
    if (!Text.hbInitPromise) {
      Text.hbInitPromise = HarfBuzzLoader.getHarfBuzz();
    }
    return Text.hbInitPromise;
  }

  public static async create(options: TextOptions): Promise<TextLayoutHandle> {
    if (!options.font) {
      throw new Error(
        'Font is required. Specify options.font as a URL string or ArrayBuffer.'
      );
    }

    if (!Text.hbInitPromise) {
      Text.hbInitPromise = HarfBuzzLoader.getHarfBuzz();
    }

    const { loadedFont, fontKey } = await Text.resolveFont(options);

    const text = new Text();
    text.setLoadedFont(loadedFont, fontKey);

    const result = await text.createLayout(options);

    const update = async (newOptions: Partial<TextOptions>): Promise<TextLayoutHandle> => {
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
        const { loadedFont: newLoadedFont, fontKey: newFontKey } =
          await Text.resolveFont(mergedOptions);
        text.setLoadedFont(newLoadedFont, newFontKey);
        text.resetHelpers();
      }

      options = mergedOptions;

      const newResult = await text.createLayout(options);

      return {
        ...newResult,
        getLoadedFont: () => text.getLoadedFont(),
        measureTextWidth: (textString: string, letterSpacing?: number) =>
          text.measureTextWidth(textString, letterSpacing),
        update,
        dispose: () => text.destroy()
      };
    };

    return {
      ...result,
      getLoadedFont: () => text.getLoadedFont(),
      measureTextWidth: (textString: string, letterSpacing?: number) =>
        text.measureTextWidth(textString, letterSpacing),
      update,
      dispose: () => text.destroy()
    };
  }

  private static retainFont(fontKey: string): void {
    Text.fontRefCounts.set(fontKey, (Text.fontRefCounts.get(fontKey) ?? 0) + 1);
  }

  private static releaseFont(fontKey: string, loadedFont: LoadedFont): void {
    const nextCount = (Text.fontRefCounts.get(fontKey) ?? 0) - 1;

    if (nextCount > 0) {
      Text.fontRefCounts.set(fontKey, nextCount);
      return;
    }

    Text.fontRefCounts.delete(fontKey);

    // Cached fonts stay alive while present in the cache. If a font has been
    // evicted, destroy it once the last live handle releases it.
    if (!Text.fontCache.has(fontKey)) {
      FontLoader.destroyFont(loadedFont);
    }
  }

  private static async resolveFont(
    options: TextOptions
  ): Promise<{ loadedFont: LoadedFont; fontKey: string }> {
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
      let loadPromise = Text.fontLoadPromises.get(fontKey);
      if (!loadPromise) {
        loadPromise = Text.loadAndCacheFont(
          fontKey,
          options.font!,
          options.fontVariations,
          options.fontFeatures
        ).finally(() => {
          Text.fontLoadPromises.delete(fontKey);
        });
        Text.fontLoadPromises.set(fontKey, loadPromise);
      }
      loadedFont = await loadPromise;
    }

    Text.retainFont(fontKey);
    return { loadedFont, fontKey };
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
      const font = Text.fontCache.get(firstKey);
      Text.trackFontCacheRemove(firstKey);
      Text.fontCache.delete(firstKey);
      if ((Text.fontRefCounts.get(firstKey) ?? 0) <= 0 && font) {
        FontLoader.destroyFont(font);
      }
    }
  }

  private static generateFontContentHash(buffer?: ArrayBuffer): string {
    if (buffer) {
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

  private setLoadedFont(loadedFont: LoadedFont, fontKey?: string): void {
    if (this.loadedFont && this.loadedFont !== loadedFont) {
      this.releaseCurrentFont();
    }

    this.loadedFont = loadedFont;
    this.currentFontCacheKey = fontKey;

    const contentHash = Text.generateFontContentHash(loadedFont._buffer);
    this.currentFontId = `font_${contentHash}`;
    if (loadedFont.fontVariations) {
      this.currentFontId += `_var_${Text.stableStringify(loadedFont.fontVariations)}`;
    }
    if (loadedFont.fontFeatures) {
      this.currentFontId += `_feat_${Text.stableStringify(loadedFont.fontFeatures)}`;
    }
  }

  private releaseCurrentFont(): void {
    if (!this.loadedFont) return;

    const currentFont = this.loadedFont;
    const currentFontKey = this.currentFontCacheKey;

    try {
      if (currentFontKey) {
        Text.releaseFont(currentFontKey, currentFont);
      } else {
        FontLoader.destroyFont(currentFont);
      }
    } catch (error) {
      logger.warn('Error destroying HarfBuzz objects:', error);
    } finally {
      this.loadedFont = undefined;
      this.currentFontCacheKey = undefined;
      this.textLayout = undefined;
      this.textShaper = undefined;
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

  private async createLayout(
    options: TextOptions
  ): Promise<TextLayoutResult> {
    perfLogger.start('Text.createLayout', {
      textLength: options.text.length,
      size: options.size || DEFAULT_FONT_SIZE,
      hasLayout: !!options.layout
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

      this.loadedFont.font.setScale(this.loadedFont.upem, this.loadedFont.upem);

      if (!this.textShaper) {
        this.textShaper = new TextShaper(this.loadedFont);
      }

      const layoutData = this.prepareLayout(options);

      const clustersByLine = this.textShaper!.shapeLines(
        layoutData.lines,
        layoutData.scaledLineHeight,
        layoutData.letterSpacing,
        layoutData.align,
        layoutData.direction,
        options.color,
        options.text
      );

      return {
        clustersByLine,
        layoutData,
        options,
        loadedFont: this.loadedFont,
        fontId: this.currentFontId
      };
    } finally {
      perfLogger.end('Text.createLayout');
    }
  }

  private async prepareHyphenation(options: TextOptions): Promise<TextOptions> {
    if (options.layout?.hyphenate !== false && options.layout?.width) {
      const language = options.layout?.language || 'en-us';

      if (!options.layout?.hyphenationPatterns?.[language]) {
        try {
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

  private resetHelpers(): void {
    this.textShaper = undefined;
    this.textLayout = undefined;
  }

  public destroy(): void {
    if (!this.loadedFont) {
      return;
    }

    this.releaseCurrentFont();
  }
}
