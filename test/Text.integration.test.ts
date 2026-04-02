import { describe, it, beforeAll, expect } from 'vitest';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import { Text } from '../src/core/Text';
import { MeshGeometryBuilder } from '../src/mesh/MeshGeometryBuilder';
import type { TextOptions } from '../src/core/types';
import enUs from '../src/hyphenation/en-us';

const require = createRequire(import.meta.url);

let fontBuffer: ArrayBuffer;

beforeAll(async () => {
  const hbWasmPath = require.resolve('../node_modules/harfbuzzjs/hb.wasm');
  const hbNodeBuffer = fs.readFileSync(hbWasmPath);
  const hbArrayBuffer = hbNodeBuffer.buffer.slice(
    hbNodeBuffer.byteOffset,
    hbNodeBuffer.byteOffset + hbNodeBuffer.byteLength
  );
  Text.setHarfBuzzBuffer(hbArrayBuffer);

  const fontPath = require.resolve('../examples/fonts/NimbusSanL-Reg.woff');
  const fontNodeBuffer = fs.readFileSync(fontPath);
  fontBuffer = fontNodeBuffer.buffer.slice(
    fontNodeBuffer.byteOffset,
    fontNodeBuffer.byteOffset + fontNodeBuffer.byteLength
  );

  await Text.init();
  Text.registerPattern('en-us', enUs);
});

describe('Text integration with real HarfBuzz and font', () => {
  it('creates geometry and glyph metadata end-to-end', async () => {
    const options: TextOptions = {
      text: 'Integration test for three-text with hyphenation.',
      font: fontBuffer,
      size: 48,
      depth: 4,
      lineHeight: 1.2,
      layout: {
        width: 600,
        align: 'justify',
        direction: 'ltr',
        hyphenate: true,
        language: 'en-us'
      }
    };
    const layoutResult = await Text.create(options);
    const meshBuilder = new MeshGeometryBuilder(
      layoutResult.loadedFont,
      layoutResult.fontId
    );
    const result = meshBuilder.build(layoutResult, options);

    expect(result).toBeDefined();
    expect(result.vertices.length).toBeGreaterThan(0);
    expect(result.indices.length).toBeGreaterThan(0);
    expect(result.glyphs.length).toBeGreaterThan(0);

    expect(result.planeBounds.max.x).toBeGreaterThan(result.planeBounds.min.x);
    expect(result.planeBounds.max.y).toBeGreaterThan(result.planeBounds.min.y);

    const loadedFont = layoutResult.getLoadedFont();
    expect(loadedFont).toBeDefined();
    expect(loadedFont?.upem).toBeGreaterThan(0);
  });

  // WOFF2 decoding is tested in the woff2-decode package
});
