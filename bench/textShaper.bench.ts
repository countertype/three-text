import { describe, bench, beforeAll } from 'vitest';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import { Text } from '../src/core/Text';
import { TextShaper } from '../src/core/shaping/TextShaper';
import { GlyphGeometryBuilder } from '../src/core/cache/GlyphGeometryBuilder';
import { globalGlyphCache } from '../src/core/cache/sharedCaches';
import type { LineInfo, LoadedFont } from '../src/core/types';

const require = createRequire(import.meta.url);

const SAMPLE_TEXT = `three-text renders and formats text from TTF, OTF, WOFF, and WOFF2 font files as 3D geometry. It uses Tex-based parameters for breaking text into paragraphs across multiple lines.`;

const CJK_TEXT = `这是一段中文测试文本，用于测试中日韩字符的处理性能。文字排版需要特殊处理。`;

let loadedFont: LoadedFont;
let geometryBuilder: GlyphGeometryBuilder;
let shaper: TextShaper;
let latinLines: LineInfo[];
let cjkLines: LineInfo[];

function createLineInfos(text: string, linesCount: number): LineInfo[] {
  const words = text.split(' ');
  const wordsPerLine = Math.ceil(words.length / linesCount);
  const lines: LineInfo[] = [];
  let offset = 0;

  for (let i = 0; i < linesCount; i++) {
    const lineWords = words.slice(i * wordsPerLine, (i + 1) * wordsPerLine);
    const lineText = lineWords.join(' ');
    lines.push({
      text: lineText,
      xOffset: 0,
      originalStart: offset,
      originalEnd: offset + lineText.length,
      isLastLine: i === linesCount - 1,
      endedWithHyphen: false
    });
    offset += lineText.length + 1;
  }
  return lines;
}

function createCJKLineInfos(text: string, linesCount: number): LineInfo[] {
  const chars = Array.from(text);
  const charsPerLine = Math.ceil(chars.length / linesCount);
  const lines: LineInfo[] = [];
  let offset = 0;

  for (let i = 0; i < linesCount; i++) {
    const lineChars = chars.slice(i * charsPerLine, (i + 1) * charsPerLine);
    const lineText = lineChars.join('');
    lines.push({
      text: lineText,
      xOffset: 0,
      originalStart: offset,
      originalEnd: offset + lineText.length,
      isLastLine: i === linesCount - 1,
      endedWithHyphen: false,
      adjustmentRatio: 0.1 // Trigger justify logic
    });
    offset += lineText.length;
  }
  return lines;
}

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
  const fontBuffer = fontNodeBuffer.buffer.slice(
    fontNodeBuffer.byteOffset,
    fontNodeBuffer.byteOffset + fontNodeBuffer.byteLength
  );

  await Text.init();

  const textInstance = await Text.create({
    text: 'test',
    font: fontBuffer,
    size: 72,
    depth: 1
  });

  loadedFont = textInstance.getLoadedFont()!;
  geometryBuilder = new GlyphGeometryBuilder(globalGlyphCache, loadedFont);
  shaper = new TextShaper(loadedFont, geometryBuilder);

  latinLines = createLineInfos(SAMPLE_TEXT, 4);
  cjkLines = createCJKLineInfos(CJK_TEXT, 3);
});

describe('TextShaper.shapeLines performance', () => {
  bench('Latin text (4 lines, ~160 chars)', () => {
    shaper.shapeLines(latinLines, 1.2 * loadedFont.upem, 0, 'left', 'ltr');
  });

  bench('Latin text justified (4 lines)', () => {
    const justifyLines = latinLines.map((l, i) => ({
      ...l,
      adjustmentRatio: i < 3 ? 0.15 : 0
    }));
    shaper.shapeLines(justifyLines, 1.2 * loadedFont.upem, 0, 'justify', 'ltr');
  });

  bench('Latin text with letter spacing (4 lines)', () => {
    shaper.shapeLines(latinLines, 1.2 * loadedFont.upem, 0.05, 'left', 'ltr');
  });

  bench('CJK text justified (3 lines, ~50 chars)', () => {
    shaper.shapeLines(cjkLines, 1.2 * loadedFont.upem, 0, 'justify', 'ltr');
  });
});
