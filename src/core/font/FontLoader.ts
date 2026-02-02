import { perfLogger } from '../../utils/PerformanceLogger';
import { FontMetadataExtractor } from './FontMetadata';
import { LoadedFont, HarfBuzzInstance } from '../types';
import {
  FONT_SIGNATURE_TRUE_TYPE,
  FONT_SIGNATURE_OPEN_TYPE_CFF
} from './constants';
import { logger } from '../../utils/Logger';
import { WoffConverter } from './WoffConverter';

export class FontLoader {
  private getHarfBuzzInstance: () => Promise<HarfBuzzInstance>;

  constructor(getHarfBuzzInstance: () => Promise<HarfBuzzInstance>) {
    this.getHarfBuzzInstance = getHarfBuzzInstance;
  }

  public async loadFont(
    fontBuffer: ArrayBuffer,
    fontVariations?: { [key: string]: number }
  ): Promise<LoadedFont> {
    perfLogger.start('FontLoader.loadFont', {
      bufferSize: fontBuffer.byteLength
    });

    if (!fontBuffer || fontBuffer.byteLength < 12) {
      throw new Error('Invalid font buffer: too small to be a valid font file');
    }

    // Check if this is a WOFF font and decompress if needed
    const format = WoffConverter.detectFormat(fontBuffer);
    if (format === 'woff') {
      logger.log('WOFF font detected, decompressing...');
      fontBuffer = await WoffConverter.decompressWoff(fontBuffer);
    } else if (format === 'woff2') {
      logger.log('WOFF2 font detected, decompressing...');
      fontBuffer = WoffConverter.decompressWoff2(fontBuffer);
    }

    const view = new DataView(fontBuffer);
    const sfntVersion = view.getUint32(0);

    const validSignatures = [
      FONT_SIGNATURE_TRUE_TYPE,
      FONT_SIGNATURE_OPEN_TYPE_CFF
    ];

    if (!validSignatures.includes(sfntVersion)) {
      throw new Error(
        `Invalid font format. Expected TTF/OTF/WOFF/WOFF2, got signature: 0x${sfntVersion.toString(
          16
        )}`
      );
    }

    const { hb, module } = await this.getHarfBuzzInstance();

    try {
      const fontBlob = hb.createBlob(new Uint8Array(fontBuffer));
      const face = hb.createFace(fontBlob, 0);
      const font = hb.createFont(face);

      if (fontVariations) {
        font.setVariations(fontVariations);
      }

      const axisInfos = face.getAxisInfos();
      const isVariable = Object.keys(axisInfos).length > 0;

      const { metrics, features: featureData } =
        FontMetadataExtractor.extractAll(fontBuffer);

      // Merge axis names from STAT table with HarfBuzz axis info
      let variationAxes: { [key: string]: any } | undefined = undefined;
      if (isVariable && axisInfos) {
        variationAxes = {};
        for (const [tag, info] of Object.entries(axisInfos)) {
          variationAxes[tag] = {
            ...(info as any),
            name: metrics.axisNames?.[tag] || null
          };
        }
      }

      return {
        hb,
        fontBlob,
        face,
        font,
        module,
        upem: metrics.unitsPerEm,
        metrics,
        fontVariations,
        isVariable,
        variationAxes,
        availableFeatures: featureData?.tags,
        featureNames: featureData?.names,
        _buffer: fontBuffer // For stable font ID generation
      };
    } catch (error) {
      logger.error('Failed to load font:', error);
      throw error;
    } finally {
      perfLogger.end('FontLoader.loadFont');
    }
  }

  public static destroyFont(loadedFont: LoadedFont): void {
    try {
      if (loadedFont.font && typeof loadedFont.font.destroy === 'function') {
        loadedFont.font.destroy();
      }

      if (loadedFont.face && typeof loadedFont.face.destroy === 'function') {
        loadedFont.face.destroy();
      }

      if (
        loadedFont.fontBlob &&
        typeof loadedFont.fontBlob.destroy === 'function'
      ) {
        loadedFont.fontBlob.destroy();
      }
    } catch (error) {
      logger.error('Error destroying font resources:', error);
    }
  }
}
