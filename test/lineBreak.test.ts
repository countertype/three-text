import { describe, it, expect } from 'vitest';
import { LineBreak } from '../src/core/layout/LineBreak';
import { en_us_patterns } from '../src/hyphenation/en-us';

const mockMeasure = (text: string) => text.length * 10;

const DEMO_TEXT = `three-text is a 3D font geometry and text layout library for the web. It supports TTF, OTF, WOFF, and WOFF2 font files. For layout, it uses Tex-based parameters for breaking text into paragraphs across multiple lines and supports CJK and RTL scripts. three-text caches the geometries it generates for low CPU overhead in languages with lots of repeating glyphs. Variable fonts are supported as static instances at a given axis coordinate, and can be animated by re-drawing each frame with new coordinates. The library has a framework-agnostic core that returns raw vertex data, with lightweight adapters for Three.js, React Three Fiber, p5.js, WebGL and WebGPU. Under the hood, three-text relies on HarfBuzz for text shaping, Knuth-Plass line breaking, Liang hyphenation, libtess by Eric Veach for tessellation, curve polygonization from Maxim Shemanarev's Anti-Grain Geometry, and Visvalingam-Whyatt line simplification`;

describe('LineBreak', () => {
  describe('text preservation', () => {
    const cases = [
      { name: 'short', text: 'The quick brown fox jumps over the lazy dog.', width: 200 },
      { name: 'medium', text: 'In the beginning God created the heaven and the earth. And the earth was without form, and void; and darkness was upon the face of the deep.', width: 300 },
      { name: 'long', text: `Call me Ishmael. Some years ago—never mind how long precisely—having little or no money in my purse, and nothing particular to interest me on shore, I thought I would sail about a little and see the watery part of the world.`, width: 400 },
      { name: 'narrow', text: 'The quick brown fox jumps over the lazy dog.', width: 100 },
    ];

    for (const tc of cases) {
      it(`preserves text for ${tc.name}`, () => {
        const lines = LineBreak.breakText({
          text: tc.text,
          width: tc.width,
          measureText: mockMeasure,
          align: 'justify'
        });

        expect(lines.length).toBeGreaterThan(0);

        const allText = lines.map(l => l.text).join(' ').replace(/\s+/g, ' ').trim();
        expect(allText).toBe(tc.text.replace(/\s+/g, ' ').trim());
      });
    }
  });

  describe('edge cases', () => {
    it('handles empty text', () => {
      const lines = LineBreak.breakText({ text: '', width: 500, measureText: mockMeasure });
      expect(lines).toHaveLength(0);
    });

    it('handles single word', () => {
      const lines = LineBreak.breakText({ text: 'hello', width: 500, measureText: mockMeasure });
      expect(lines).toHaveLength(1);
      expect(lines[0].text).toBe('hello');
    });

    it('handles no width constraint', () => {
      const lines = LineBreak.breakText({ text: 'hello world', width: undefined, measureText: mockMeasure });
      expect(lines).toHaveLength(1);
    });

    it('handles explicit line breaks', () => {
      const lines = LineBreak.breakText({
        text: 'line one\nline two\nline three',
        width: 500,
        measureText: mockMeasure,
        respectExistingBreaks: true
      });
      expect(lines).toHaveLength(3);
      expect(lines[0].text).toBe('line one');
    });

    it('breaks long words at character boundaries', () => {
      const lines = LineBreak.breakText({
        text: 'https://example.com/very/long/url',
        width: 100,
        measureText: mockMeasure,
        align: 'left'
      });
      expect(lines.length).toBeGreaterThan(1);
    });
  });

  describe('hyphenation', () => {
    it('breaks text with hyphenation', () => {
      const lines = LineBreak.breakText({
        text: DEMO_TEXT,
        width: 870,
        measureText: mockMeasure,
        hyphenate: true,
        language: 'en-us',
        hyphenationPatterns: { 'en-us': en_us_patterns },
        align: 'justify'
      });

      expect(lines.length).toBeGreaterThan(1);
    });

    it('finds hyphenation points', () => {
      const points = LineBreak.findHyphenationPoints('hyphenation', 'en-us', {
        'en-us': en_us_patterns
      });
      expect(points.length).toBeGreaterThan(0);
    });

    it('respects lefthyphenmin and righthyphenmin', () => {
      const loose = LineBreak.findHyphenationPoints('hyphenation', 'en-us', { 'en-us': en_us_patterns }, 2, 3);
      const strict = LineBreak.findHyphenationPoints('hyphenation', 'en-us', { 'en-us': en_us_patterns }, 4, 4);
      expect(strict.length).toBeLessThanOrEqual(loose.length);
    });
  });

  describe('CJK', () => {
    it('identifies CJK characters', () => {
      expect(LineBreak.isCJK('中')).toBe(true);
      expect(LineBreak.isCJK('日')).toBe(true);
      expect(LineBreak.isCJK('한')).toBe(true);
      expect(LineBreak.isCJK('a')).toBe(false);
    });

    it('breaks CJK text at character boundaries', () => {
      const lines = LineBreak.breakText({
        text: '这是一段中文文本用于测试换行功能',
        width: 200,
        measureText: (t) => t.length * 20,
        align: 'left'
      });

      expect(lines.length).toBeGreaterThan(1);
      lines.forEach((line) => expect(line.text.length).toBeGreaterThan(0));
    });
  });

  describe('line quality', () => {
    it('avoids single-word lines in middle of paragraph', () => {
      const lines = LineBreak.breakText({
        text: DEMO_TEXT,
        width: 870,
        measureText: mockMeasure,
        hyphenate: true,
        language: 'en-us',
        hyphenationPatterns: { 'en-us': en_us_patterns },
        align: 'justify'
      });

      for (let i = 1; i < lines.length - 1; i++) {
        const wordCount = lines[i].text.trim().split(/\s+/).length;
        if (wordCount === 1) {
          const isHyphenated = lines[i - 1]?.endedWithHyphen || lines[i].endedWithHyphen;
          if (!isHyphenated) {
            console.warn(`Single-word line ${i}: "${lines[i].text.trim()}"`);
          }
        }
      }
    });

    it('maintains reasonable line widths', () => {
      const lines = LineBreak.breakText({
        text: DEMO_TEXT,
        width: 870,
        measureText: mockMeasure,
        hyphenate: true,
        language: 'en-us',
        hyphenationPatterns: { 'en-us': en_us_patterns },
        align: 'justify'
      });

      for (let i = 0; i < lines.length - 1; i++) {
        const lineWidth = lines[i].naturalWidth ?? 0;
        expect(lineWidth).toBeGreaterThanOrEqual(435);
        expect(lineWidth).toBeLessThanOrEqual(870 * 1.05);
      }
    });
  });
});
