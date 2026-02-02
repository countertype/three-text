import { describe, it, beforeAll } from 'vitest';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import { Text } from '../src/core/Text';
import { perfLogger } from '../src/utils/PerformanceLogger';
import enUs from '../src/hyphenation/en-us';

const require = createRequire(import.meta.url);

const EXAMPLE_TEXT = `three-text renders and formats text from TTF, OTF, WOFF, and WOFF2 font files as 3D geometry. It uses Tex-based parameters for breaking text into paragraphs across multiple lines, and turns font outlines into 3D shapes on the fly, caching their geometries for low CPU overhead in languages with lots of repeating glyphs. Variable fonts are supported as static instances at a given axis coordinate. The library has a framework-agnostic core that returns raw vertex data, with lightweight adapters for Three.js, React Three Fiber, p5.js, WebGL and WebGPU. Under the hood, three-text relies on HarfBuzz for text shaping, Knuth-Plass line breaking, Liang hyphenation, libtess by Eric Veach for removing overlaps and triangulation, curve polygonization from Maxim Shemanarev's Anti-Grain Geometry, and Visvalingam-Whyatt line simplification`;

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

describe.runIf(process.env.THREE_TEXT_LOG === 'true')(
  'Pipeline perf with example text (real HarfBuzz + real font)',
  () => {
    it('runs the full pipeline and prints per-stage timings', async () => {
      const coldIterations = 5;
      const warmIterations = 5;

      const config = {
        text: EXAMPLE_TEXT,
        font: fontBuffer,
        size: 72,
        depth: 7,
        lineHeight: 1.33,
        layout: {
          width: 1400,
          align: 'justify',
          direction: 'ltr',
          hyphenate: true,
          language: 'en-us'
        }
      };
      const overlapWord = 'W'.repeat(60);
      const overlapText = Array.from({ length: 20 }, () => overlapWord).join(' ');
      const overlapConfig = {
        ...config,
        text: overlapText,
        letterSpacing: -0.15,
        removeOverlaps: true,
        layout: {
          ...config.layout,
          width: 20000,
          align: 'left',
          hyphenate: false
        }
      };

      // Cold runs – first few passes through the pipeline in this process
      perfLogger.clear();
      for (let i = 0; i < coldIterations; i++) {
        // eslint-disable-next-line no-await-in-loop
        await Text.create(config);
      }

      console.log('\n=== COLD (first runs in this process) ===');
      perfLogger.printSummary();

      // Warm runs – V8 and caches are already hot
      perfLogger.clear();

      for (let i = 0; i < warmIterations; i++) {
        // eslint-disable-next-line no-await-in-loop
        await Text.create(config);
      }

      console.log('\n=== WARM (after V8 optimization and caching) ===');
      perfLogger.printSummary();

      perfLogger.clear();
      for (let i = 0; i < warmIterations; i++) {
        // eslint-disable-next-line no-await-in-loop
        await Text.create(overlapConfig);
      }

      console.log('\n=== OVERLAP WARM ===');
      perfLogger.printSummary();
    }, 30000);
  }
);
