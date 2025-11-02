import { perfLogger } from '../../utils/PerformanceLogger';
import { FontMetadataExtractor } from './FontMetadata';
import { LoadedFont, HarfBuzzInstance } from '../types';
import {
  FONT_SIGNATURE_TRUE_TYPE,
  FONT_SIGNATURE_OPEN_TYPE_CFF,
  FONT_SIGNATURE_TRUE_TYPE_COLLECTION
} from './constants';
import { debugLogger } from '../../utils/DebugLogger';
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
      debugLogger.log('WOFF font detected, decompressing...');
      fontBuffer = await WoffConverter.decompressWoff(fontBuffer);
    } else if (format === 'woff2') {
      throw new Error(
        'WOFF2 fonts are not yet supported. Please use WOFF or TTF/OTF format.'
      );
    }

    const view = new DataView(fontBuffer);
    const sfntVersion = view.getUint32(0);

    const validSignatures = [
      FONT_SIGNATURE_TRUE_TYPE,
      FONT_SIGNATURE_OPEN_TYPE_CFF,
      FONT_SIGNATURE_TRUE_TYPE_COLLECTION
    ];

    if (!validSignatures.includes(sfntVersion)) {
      throw new Error(
        `Invalid font format. Expected TrueType or OpenType, got signature: 0x${sfntVersion.toString(
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
      const metrics = FontMetadataExtractor.extractMetadata(fontBuffer);

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
        variationAxes
      };
    } catch (error) {
      debugLogger.error('Failed to load font:', error);
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
      debugLogger.error('Error destroying font resources:', error);
    }
  }
}
