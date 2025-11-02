import { debugLogger } from '../../utils/DebugLogger';
import { FONT_SIGNATURE_WOFF, FONT_SIGNATURE_WOFF2 } from './constants';

// Uses DecompressionStream to decompress WOFF (WOFF is just zlib compressed TTF/OTF so we can use deflate)
export class WoffConverter {
  public static detectFormat(
    buffer: ArrayBuffer
  ): 'woff' | 'woff2' | 'ttf/otf' {
    if (buffer.byteLength < 4) {
      return 'ttf/otf';
    }

    const view = new DataView(buffer);
    const signature = view.getUint32(0);

    if (signature === FONT_SIGNATURE_WOFF) {
      return 'woff';
    }
    if (signature === FONT_SIGNATURE_WOFF2) {
      return 'woff2';
    }
    return 'ttf/otf';
  }

  public static async decompressWoff(
    woffBuffer: ArrayBuffer
  ): Promise<ArrayBuffer> {
    const view = new DataView(woffBuffer);
    const data = new Uint8Array(woffBuffer);

    // WOFF Header structure:
    // Offset  Size  Description
    // 0       4     signature (0x774F4646 'wOFF')
    // 4       4     flavor (TTF = 0x00010000, CFF = 0x4F54544F)
    // 8       4     length (total size)
    // 12      2     numTables
    // 14      2     reserved
    // 16      4     totalSfntSize (size of uncompressed font)
    // 20      2     majorVersion
    // 22      2     minorVersion
    // 24      4     metaOffset
    // 28      4     metaLength
    // 32      4     metaOrigLength
    // 36      4     privOffset
    // 40      4     privLength

    const signature = view.getUint32(0);
    if (signature !== FONT_SIGNATURE_WOFF) {
      throw new Error('Not a valid WOFF font');
    }

    const flavor = view.getUint32(4);
    const numTables = view.getUint16(12);
    const totalSfntSize = view.getUint32(16);

    // Check for DecompressionStream support
    if (typeof DecompressionStream === 'undefined') {
      throw new Error(
        'WOFF fonts require DecompressionStream API (Chrome 80+, Firefox 113+, Safari 16.4+). ' +
          'Please use TTF/OTF fonts or upgrade your browser.'
      );
    }

    // Create the output buffer for the TTF/OTF font
    const sfntData = new Uint8Array(totalSfntSize);
    const sfntView = new DataView(sfntData.buffer);

    // Write SFNT header. The flavor (0x00010000 for TrueType, 0x4F54544F for CFF)
    // determines glyph winding order and will be detected by FontMetadataExtractor.
    sfntView.setUint32(0, flavor);
    sfntView.setUint16(4, numTables); // numTables
    const searchRange = 2 ** Math.floor(Math.log2(numTables)) * 16;
    sfntView.setUint16(6, searchRange);
    sfntView.setUint16(8, Math.floor(Math.log2(numTables)));
    sfntView.setUint16(10, numTables * 16 - searchRange);

    // Read and decompress table directory
    let woffOffset = 44; // Start of table directory
    let sfntOffset = 12 + numTables * 16; // Start of table data

    const tableDirectory: Array<{
      tag: number;
      checksum: number;
      offset: number;
      length: number;
      origLength: number;
    }> = [];

    // Read WOFF table directory
    for (let i = 0; i < numTables; i++) {
      const tableOffset = 44 + i * 20;
      tableDirectory.push({
        tag: view.getUint32(tableOffset),
        offset: view.getUint32(tableOffset + 4),
        length: view.getUint32(tableOffset + 8), // compressed length
        origLength: view.getUint32(tableOffset + 12),
        checksum: view.getUint32(tableOffset + 16)
      });
    }

    // Sort tables by tag (required for SFNT)
    tableDirectory.sort((a, b) => a.tag - b.tag);

    // Write SFNT table directory and decompress tables
    for (let i = 0; i < numTables; i++) {
      const table = tableDirectory[i];
      const dirOffset = 12 + i * 16;

      // Write SFNT table directory entry
      sfntView.setUint32(dirOffset, table.tag);
      sfntView.setUint32(dirOffset + 4, table.checksum);
      sfntView.setUint32(dirOffset + 8, sfntOffset);
      sfntView.setUint32(dirOffset + 12, table.origLength);

      // Decompress or copy table data
      if (table.length === table.origLength) {
        // Uncompressed table - just copy
        sfntData.set(
          data.subarray(table.offset, table.offset + table.length),
          sfntOffset
        );
      } else {
        // Compressed table - decompress using DecompressionStream
        const compressedData = data.subarray(
          table.offset,
          table.offset + table.length
        );

        const decompressed = await WoffConverter.decompressZlib(compressedData);

        if (decompressed.byteLength !== table.origLength) {
          throw new Error(
            `Decompression failed: expected ${table.origLength} bytes, got ${decompressed.byteLength}`
          );
        }

        sfntData.set(new Uint8Array(decompressed), sfntOffset);
      }

      // Add padding to 4-byte boundary
      sfntOffset += table.origLength;
      const padding = (4 - (table.origLength % 4)) % 4;
      sfntOffset += padding;
    }

    debugLogger.log('WOFF font decompressed successfully');
    return sfntData.buffer.slice(0, sfntOffset);
  }

  private static async decompressZlib(
    compressedData: Uint8Array
  ): Promise<ArrayBuffer> {
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(compressedData);
        controller.close();
      }
    }).pipeThrough(
      new DecompressionStream('deflate') as unknown as ReadableWritablePair<
        Uint8Array,
        Uint8Array
      >
    );

    const response = new Response(stream);
    return response.arrayBuffer();
  }
}
