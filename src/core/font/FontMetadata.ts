import { ExtractedMetrics, FontMetrics, VerticalMetrics } from '../types';
import {
  FONT_SIGNATURE_TRUE_TYPE,
  FONT_SIGNATURE_OPEN_TYPE_CFF,
  TABLE_TAG_HEAD,
  TABLE_TAG_HHEA,
  TABLE_TAG_OS2,
  TABLE_TAG_FVAR,
  TABLE_TAG_STAT,
  TABLE_TAG_NAME,
  TABLE_TAG_CFF,
  TABLE_TAG_CFF2,
  TABLE_TAG_GSUB,
  TABLE_TAG_GPOS
} from './constants';
import { parseTableDirectory, TableDirectoryEntry } from './TableDirectory';

export interface FontDataExtraction {
  metrics: ExtractedMetrics;
  features: { tags: string[]; names: { [tag: string]: string } } | undefined;
}

// OpenType tag prefixes as uint16 for bitwise comparison
const TAG_SS_PREFIX = 0x7373; // 'ss'
const TAG_CV_PREFIX = 0x6376; // 'cv'

interface NameRecord {
  offset: number;
  length: number;
  platformID: number;
  encodingID: number;
}

const utf16beDecoder = new TextDecoder('utf-16be');

export class FontMetadataExtractor {
  public static extractMetadata(fontBuffer: ArrayBuffer): ExtractedMetrics {
    if (!fontBuffer || fontBuffer.byteLength < 12) {
      throw new Error('Invalid font buffer: too small to be a valid font file');
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

    const tableDirectory = parseTableDirectory(view);

    const isCFF =
      tableDirectory.has(TABLE_TAG_CFF) || tableDirectory.has(TABLE_TAG_CFF2);
    const headTableOffset = tableDirectory.get(TABLE_TAG_HEAD)?.offset ?? 0;
    const hheaTableOffset = tableDirectory.get(TABLE_TAG_HHEA)?.offset ?? 0;
    const os2TableOffset = tableDirectory.get(TABLE_TAG_OS2)?.offset ?? 0;
    const fvarTableOffset = tableDirectory.get(TABLE_TAG_FVAR)?.offset ?? 0;
    const statTableOffset = tableDirectory.get(TABLE_TAG_STAT)?.offset ?? 0;
    const nameTableOffset = tableDirectory.get(TABLE_TAG_NAME)?.offset ?? 0;

    const unitsPerEm = headTableOffset
      ? view.getUint16(headTableOffset + 18)
      : 1000;

    let hheaMetrics = null;
    if (hheaTableOffset) {
      hheaMetrics = {
        ascender: view.getInt16(hheaTableOffset + 4),
        descender: view.getInt16(hheaTableOffset + 6),
        lineGap: view.getInt16(hheaTableOffset + 8)
      };
    }

    let os2Metrics = null;
    if (os2TableOffset) {
      os2Metrics = {
        typoAscender: view.getInt16(os2TableOffset + 68),
        typoDescender: view.getInt16(os2TableOffset + 70),
        typoLineGap: view.getInt16(os2TableOffset + 72),
        winAscent: view.getUint16(os2TableOffset + 74),
        winDescent: view.getUint16(os2TableOffset + 76)
      };
    }

    // Extract axis names only for variable fonts (fvar table present) with STAT table
    let axisNames: { [tag: string]: string } | null = null;
    if (fvarTableOffset && statTableOffset && nameTableOffset) {
      axisNames = this.extractAxisNames(view, statTableOffset, nameTableOffset);
    }

    return {
      isCFF,
      unitsPerEm,
      hheaAscender: hheaMetrics?.ascender || null,
      hheaDescender: hheaMetrics?.descender || null,
      hheaLineGap: hheaMetrics?.lineGap || null,
      typoAscender: os2Metrics?.typoAscender || null,
      typoDescender: os2Metrics?.typoDescender || null,
      typoLineGap: os2Metrics?.typoLineGap || null,
      winAscent: os2Metrics?.winAscent || null,
      winDescent: os2Metrics?.winDescent || null,
      axisNames
    };
  }

  public static extractFeatureTags(
    fontBuffer: ArrayBuffer
  ): { tags: string[]; names: { [tag: string]: string } } | undefined {
    const view = new DataView(fontBuffer);

    const tableDirectory = parseTableDirectory(view);
    const gsubTableOffset = tableDirectory.get(TABLE_TAG_GSUB)?.offset ?? 0;
    const gposTableOffset = tableDirectory.get(TABLE_TAG_GPOS)?.offset ?? 0;
    const nameTableOffset = tableDirectory.get(TABLE_TAG_NAME)?.offset ?? 0;

    const features = new Set<string>();
    const featureNames: { [tag: string]: string } = {};

    try {
      if (gsubTableOffset) {
        const gsubData = this.extractFeatureDataFromTable(
          view,
          gsubTableOffset,
          nameTableOffset
        );
        gsubData.features.forEach((f) => features.add(f));
        Object.assign(featureNames, gsubData.names);
      }

      if (gposTableOffset) {
        const gposData = this.extractFeatureDataFromTable(
          view,
          gposTableOffset,
          nameTableOffset
        );
        gposData.features.forEach((f) => features.add(f));
        Object.assign(featureNames, gposData.names);
      }
    } catch (e) {
      return undefined;
    }

    const featureArray = Array.from(features).sort();
    if (featureArray.length === 0) return undefined;

    return {
      tags: featureArray,
      names: Object.keys(featureNames).length > 0 ? featureNames : {}
    };
  }

  private static extractFeatureDataFromTable(
    view: DataView,
    tableOffset: number,
    nameTableOffset: number
  ): { features: string[]; names: { [tag: string]: string } } {
    const featureListOffset = view.getUint16(tableOffset + 6);
    const featureListStart = tableOffset + featureListOffset;
    const featureCount = view.getUint16(featureListStart);

    const features: string[] = [];
    const names: { [tag: string]: string } = {};

    for (let i = 0; i < featureCount; i++) {
      const recordOffset = featureListStart + 2 + i * 6;
      const tag = String.fromCharCode(
        view.getUint8(recordOffset),
        view.getUint8(recordOffset + 1),
        view.getUint8(recordOffset + 2),
        view.getUint8(recordOffset + 3)
      );
      features.push(tag);

      // Extract feature name for stylistic sets and character variants
      if (/^(ss\d{2}|cv\d{2})$/.test(tag) && nameTableOffset) {
        const featureOffset = view.getUint16(recordOffset + 4);
        const featureTableStart = featureListStart + featureOffset;

        // Feature table structure:
        // uint16 FeatureParams offset
        // uint16 LookupCount
        // uint16[LookupCount] LookupListIndex

        const featureParamsOffset = view.getUint16(featureTableStart);

        // FeatureParams for ss features:
        // uint16 Version (should be 0)
        // uint16 UINameID
        if (featureParamsOffset !== 0) {
          const paramsStart = featureTableStart + featureParamsOffset;
          const version = view.getUint16(paramsStart);

          if (version === 0) {
            const nameID = view.getUint16(paramsStart + 2);
            const name = this.getNameFromNameTable(
              view,
              nameTableOffset,
              nameID
            );
            if (name) {
              names[tag] = name;
            }
          }
        }
      }
    }

    return { features, names };
  }

  private static extractAxisNames(
    view: DataView,
    statOffset: number,
    nameOffset: number
  ): { [tag: string]: string } | null {
    try {
      const majorVersion = view.getUint16(statOffset);
      if (majorVersion < 1) return null;

      const designAxisSize = view.getUint16(statOffset + 4);
      const designAxisCount = view.getUint16(statOffset + 6);
      const designAxisOffset = view.getUint32(statOffset + 8);

      const axisNames: { [tag: string]: string } = {};

      // Read each design axis record (size specified by designAxisSize)
      for (let i = 0; i < designAxisCount; i++) {
        const axisRecordOffset =
          statOffset + designAxisOffset + i * designAxisSize;
        const axisTag = String.fromCharCode(
          view.getUint8(axisRecordOffset),
          view.getUint8(axisRecordOffset + 1),
          view.getUint8(axisRecordOffset + 2),
          view.getUint8(axisRecordOffset + 3)
        );
        const axisNameID = view.getUint16(axisRecordOffset + 4);
        const name = this.getNameFromNameTable(view, nameOffset, axisNameID);
        if (name) {
          axisNames[axisTag] = name;
        }
      }

      return Object.keys(axisNames).length > 0 ? axisNames : null;
    } catch (e) {
      return null;
    }
  }

  private static getNameFromNameTable(
    view: DataView,
    nameOffset: number,
    nameID: number
  ): string | null {
    try {
      const count = view.getUint16(nameOffset + 2);
      const stringOffset = view.getUint16(nameOffset + 4);

      for (let i = 0; i < count; i++) {
        const recordOffset = nameOffset + 6 + i * 12;
        const platformID = view.getUint16(recordOffset);
        const encodingID = view.getUint16(recordOffset + 2);
        const languageID = view.getUint16(recordOffset + 4);
        const recordNameID = view.getUint16(recordOffset + 6);
        const length = view.getUint16(recordOffset + 8);
        const offset = view.getUint16(recordOffset + 10);

        if (recordNameID !== nameID) continue;

        // Accept Unicode platform or Windows US English
        if (platformID !== 0 && !(platformID === 3 && languageID === 0x0409)) {
          continue;
        }

        const stringStart = nameOffset + stringOffset + offset;
        const bytes = new Uint8Array(view.buffer, stringStart, length);

        if (platformID === 0 || (platformID === 3 && encodingID === 1)) {
          let str = '';
          for (let j = 0; j < bytes.length; j += 2) {
            str += String.fromCharCode((bytes[j] << 8) | bytes[j + 1]);
          }
          return str;
        }
        return new TextDecoder('ascii').decode(bytes);
      }

      return null;
    } catch (e) {
      return null;
    }
  }

  public static extractAll(fontBuffer: ArrayBuffer): FontDataExtraction {
    if (!fontBuffer || fontBuffer.byteLength < 12) {
      throw new Error('Invalid font buffer: too small to be a valid font file');
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

    const tableDirectory = parseTableDirectory(view);
    const nameTableOffset = tableDirectory.get(TABLE_TAG_NAME)?.offset ?? 0;
    const nameIndex = nameTableOffset
      ? this.buildNameIndex(view, nameTableOffset)
      : null;

    const metrics = this.extractMetricsWithIndex(
      view,
      tableDirectory,
      nameIndex
    );
    const features = this.extractFeaturesWithIndex(
      view,
      tableDirectory,
      nameIndex
    );

    return { metrics, features };
  }

  // Index name records by nameID; prefers Unicode (platform 0) or Windows US English
  private static buildNameIndex(
    view: DataView,
    nameOffset: number
  ): Map<number, NameRecord> {
    const index = new Map<number, NameRecord>();
    const count = view.getUint16(nameOffset + 2);
    const stringOffset = view.getUint16(nameOffset + 4);

    for (let i = 0; i < count; i++) {
      const recordOffset = nameOffset + 6 + i * 12;
      const platformID = view.getUint16(recordOffset);
      const encodingID = view.getUint16(recordOffset + 2);
      const languageID = view.getUint16(recordOffset + 4);
      const nameID = view.getUint16(recordOffset + 6);
      const length = view.getUint16(recordOffset + 8);
      const offset = view.getUint16(recordOffset + 10);

      if (platformID === 0 || (platformID === 3 && languageID === 0x0409)) {
        if (!index.has(nameID)) {
          index.set(nameID, {
            offset: nameOffset + stringOffset + offset,
            length,
            platformID,
            encodingID
          });
        }
      }
    }
    return index;
  }

  private static getNameFromIndex(
    view: DataView,
    nameIndex: Map<number, NameRecord> | null,
    nameID: number
  ): string | null {
    if (!nameIndex) return null;
    const record = nameIndex.get(nameID);
    if (!record) return null;

    try {
      const bytes = new Uint8Array(view.buffer, record.offset, record.length);

      // UTF-16BE for Unicode/Windows platform with encoding 1
      if (
        record.platformID === 0 ||
        (record.platformID === 3 && record.encodingID === 1)
      ) {
        return utf16beDecoder.decode(bytes);
      }
      // ASCII fallback
      return new TextDecoder('ascii').decode(bytes);
    } catch {
      return null;
    }
  }

  private static extractMetricsWithIndex(
    view: DataView,
    tableDirectory: Map<number, TableDirectoryEntry>,
    nameIndex: Map<number, NameRecord> | null
  ): ExtractedMetrics {
    const isCFF =
      tableDirectory.has(TABLE_TAG_CFF) || tableDirectory.has(TABLE_TAG_CFF2);
    const headTableOffset = tableDirectory.get(TABLE_TAG_HEAD)?.offset ?? 0;
    const hheaTableOffset = tableDirectory.get(TABLE_TAG_HHEA)?.offset ?? 0;
    const os2TableOffset = tableDirectory.get(TABLE_TAG_OS2)?.offset ?? 0;
    const fvarTableOffset = tableDirectory.get(TABLE_TAG_FVAR)?.offset ?? 0;
    const statTableOffset = tableDirectory.get(TABLE_TAG_STAT)?.offset ?? 0;

    const unitsPerEm = headTableOffset
      ? view.getUint16(headTableOffset + 18)
      : 1000;

    let hheaMetrics = null;
    if (hheaTableOffset) {
      hheaMetrics = {
        ascender: view.getInt16(hheaTableOffset + 4),
        descender: view.getInt16(hheaTableOffset + 6),
        lineGap: view.getInt16(hheaTableOffset + 8)
      };
    }

    let os2Metrics = null;
    if (os2TableOffset) {
      os2Metrics = {
        typoAscender: view.getInt16(os2TableOffset + 68),
        typoDescender: view.getInt16(os2TableOffset + 70),
        typoLineGap: view.getInt16(os2TableOffset + 72),
        winAscent: view.getUint16(os2TableOffset + 74),
        winDescent: view.getUint16(os2TableOffset + 76)
      };
    }

    let axisNames: { [tag: string]: string } | null = null;
    if (fvarTableOffset && statTableOffset && nameIndex) {
      axisNames = this.extractAxisNamesWithIndex(
        view,
        statTableOffset,
        nameIndex
      );
    }

    return {
      isCFF,
      unitsPerEm,
      hheaAscender: hheaMetrics?.ascender || null,
      hheaDescender: hheaMetrics?.descender || null,
      hheaLineGap: hheaMetrics?.lineGap || null,
      typoAscender: os2Metrics?.typoAscender || null,
      typoDescender: os2Metrics?.typoDescender || null,
      typoLineGap: os2Metrics?.typoLineGap || null,
      winAscent: os2Metrics?.winAscent || null,
      winDescent: os2Metrics?.winDescent || null,
      axisNames
    };
  }

  private static extractAxisNamesWithIndex(
    view: DataView,
    statOffset: number,
    nameIndex: Map<number, NameRecord>
  ): { [tag: string]: string } | null {
    try {
      const majorVersion = view.getUint16(statOffset);
      if (majorVersion < 1) return null;

      const designAxisSize = view.getUint16(statOffset + 4);
      const designAxisCount = view.getUint16(statOffset + 6);
      const designAxisOffset = view.getUint32(statOffset + 8);

      const axisNames: { [tag: string]: string } = {};

      for (let i = 0; i < designAxisCount; i++) {
        const axisRecordOffset =
          statOffset + designAxisOffset + i * designAxisSize;
        const axisTag = String.fromCharCode(
          view.getUint8(axisRecordOffset),
          view.getUint8(axisRecordOffset + 1),
          view.getUint8(axisRecordOffset + 2),
          view.getUint8(axisRecordOffset + 3)
        );
        const axisNameID = view.getUint16(axisRecordOffset + 4);
        const name = this.getNameFromIndex(view, nameIndex, axisNameID);
        if (name) {
          axisNames[axisTag] = name;
        }
      }

      return Object.keys(axisNames).length > 0 ? axisNames : null;
    } catch {
      return null;
    }
  }

  private static extractFeaturesWithIndex(
    view: DataView,
    tableDirectory: Map<number, TableDirectoryEntry>,
    nameIndex: Map<number, NameRecord> | null
  ): { tags: string[]; names: { [tag: string]: string } } | undefined {
    const gsubTableOffset = tableDirectory.get(TABLE_TAG_GSUB)?.offset ?? 0;
    const gposTableOffset = tableDirectory.get(TABLE_TAG_GPOS)?.offset ?? 0;

    // Tags stored as uint32 during iteration, converted to strings at end
    const featureTags = new Set<number>();
    const featureNames: { [tag: string]: string } = {};

    try {
      if (gsubTableOffset) {
        this.extractFeatureData(
          view,
          gsubTableOffset,
          nameIndex,
          featureTags,
          featureNames
        );
      }

      if (gposTableOffset) {
        this.extractFeatureData(
          view,
          gposTableOffset,
          nameIndex,
          featureTags,
          featureNames
        );
      }
    } catch {
      return undefined;
    }

    if (featureTags.size === 0) return undefined;

    // Numeric sort preserves alphabetical order for big-endian tags
    const sortedTags = Array.from(featureTags).sort((a, b) => a - b);
    const featureArray = sortedTags.map(this.tagToString);

    return {
      tags: featureArray,
      names: Object.keys(featureNames).length > 0 ? featureNames : {}
    };
  }

  private static extractFeatureData(
    view: DataView,
    tableOffset: number,
    nameIndex: Map<number, NameRecord> | null,
    featureTags: Set<number>,
    featureNames: { [tag: string]: string }
  ): void {
    const featureListOffset = view.getUint16(tableOffset + 6);
    const featureListStart = tableOffset + featureListOffset;
    const featureCount = view.getUint16(featureListStart);

    for (let i = 0; i < featureCount; i++) {
      const recordOffset = featureListStart + 2 + i * 6;
      const tagBytes = view.getUint32(recordOffset);
      featureTags.add(tagBytes);

      // Stylistic sets (ss01-ss20) and character variants (cv01-cv99) may have UI names
      const prefix = (tagBytes >> 16) & 0xffff;
      if (!nameIndex) continue;
      if (prefix !== TAG_SS_PREFIX && prefix !== TAG_CV_PREFIX) continue;

      const d1 = (tagBytes >> 8) & 0xff;
      const d2 = tagBytes & 0xff;
      if (d1 < 0x30 || d1 > 0x39 || d2 < 0x30 || d2 > 0x39) continue;

      const featureOffset = view.getUint16(recordOffset + 4);
      const featureTableStart = featureListStart + featureOffset;
      const featureParamsOffset = view.getUint16(featureTableStart);
      if (featureParamsOffset === 0) continue;

      const paramsStart = featureTableStart + featureParamsOffset;
      const version = view.getUint16(paramsStart);
      if (version !== 0) continue;

      const nameID = view.getUint16(paramsStart + 2);
      const name = this.getNameFromIndex(view, nameIndex, nameID);
      if (name) {
        const tag = String.fromCharCode(
          (tagBytes >> 24) & 0xff,
          (tagBytes >> 16) & 0xff,
          (tagBytes >> 8) & 0xff,
          tagBytes & 0xff
        );
        featureNames[tag] = name;
      }
    }
  }

  private static tagToString(tag: number): string {
    return String.fromCharCode(
      (tag >> 24) & 0xff,
      (tag >> 16) & 0xff,
      (tag >> 8) & 0xff,
      tag & 0xff
    );
  }

  // Metric priority: typo > hhea > win > fallback (ignoring line gap per Google's approach)
  public static getVerticalMetrics(metrics: ExtractedMetrics): VerticalMetrics {
    if (metrics.typoAscender !== null && metrics.typoDescender !== null) {
      return {
        ascender: metrics.typoAscender,
        descender: metrics.typoDescender,
        lineGap: 0
      };
    }

    if (metrics.hheaAscender !== null && metrics.hheaDescender !== null) {
      return {
        ascender: metrics.hheaAscender,
        descender: metrics.hheaDescender,
        lineGap: 0
      };
    }

    if (metrics.winAscent !== null && metrics.winDescent !== null) {
      return {
        ascender: metrics.winAscent,
        descender: -metrics.winDescent, // winDescent is typically positive
        lineGap: 0
      };
    }

    // Last resort - default based on UPM
    return {
      ascender: Math.round(metrics.unitsPerEm * 0.8),
      descender: -Math.round(metrics.unitsPerEm * 0.2),
      lineGap: 0
    };
  }

  public static getFontMetrics(metrics: ExtractedMetrics): FontMetrics {
    const verticalMetrics = FontMetadataExtractor.getVerticalMetrics(metrics);
    return {
      ascender: verticalMetrics.ascender,
      descender: verticalMetrics.descender,
      lineGap: verticalMetrics.lineGap,
      unitsPerEm: metrics.unitsPerEm,
      naturalLineHeight: verticalMetrics.ascender - verticalMetrics.descender
    };
  }
}
