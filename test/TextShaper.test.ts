import { describe, it, expect, vi } from 'vitest';
import { Vector3 } from 'three';
import { TextShaper } from '../src/core/shaping/TextShaper';
import type {
  LoadedFont,
  HarfBuzzGlyph,
  LineInfo,
  TextDirection
} from '../src/core/types';

describe('TextShaper', () => {
  it('correctly groups glyphs into clusters with accurate positioning', () => {
    // Mock HarfBuzz glyph output for "Hello World"
    const mockHbGlyphs: HarfBuzzGlyph[] = [
      // H e l l o
      {
        g: 1,
        cl: 0,
        ax: 100,
        ay: 0,
        dx: 0,
        dy: 0,
        lineIndex: 0,
        absoluteTextIndex: 0
      },
      {
        g: 2,
        cl: 1,
        ax: 80,
        ay: 0,
        dx: 0,
        dy: 0,
        lineIndex: 0,
        absoluteTextIndex: 1
      },
      {
        g: 3,
        cl: 2,
        ax: 60,
        ay: 0,
        dx: 0,
        dy: 0,
        lineIndex: 0,
        absoluteTextIndex: 2
      },
      {
        g: 4,
        cl: 3,
        ax: 60,
        ay: 0,
        dx: 0,
        dy: 0,
        lineIndex: 0,
        absoluteTextIndex: 3
      },
      {
        g: 5,
        cl: 4,
        ax: 90,
        ay: 0,
        dx: 0,
        dy: 0,
        lineIndex: 0,
        absoluteTextIndex: 4
      },
      // Space
      {
        g: 0,
        cl: 5,
        ax: 50,
        ay: 0,
        dx: 0,
        dy: 0,
        lineIndex: 0,
        absoluteTextIndex: 5
      },
      // W o r l d
      {
        g: 6,
        cl: 6,
        ax: 120,
        ay: 0,
        dx: 0,
        dy: 0,
        lineIndex: 0,
        absoluteTextIndex: 6
      },
      {
        g: 7,
        cl: 7,
        ax: 90,
        ay: 0,
        dx: 0,
        dy: 0,
        lineIndex: 0,
        absoluteTextIndex: 7
      },
      {
        g: 8,
        cl: 8,
        ax: 70,
        ay: 0,
        dx: 0,
        dy: 0,
        lineIndex: 0,
        absoluteTextIndex: 8
      },
      {
        g: 9,
        cl: 9,
        ax: 60,
        ay: 0,
        dx: 0,
        dy: 0,
        lineIndex: 0,
        absoluteTextIndex: 9
      },
      {
        g: 10,
        cl: 10,
        ax: 100,
        ay: 0,
        dx: 0,
        dy: 0,
        lineIndex: 0,
        absoluteTextIndex: 10
      }
    ];

    const mockLoadedFont = {
      hb: {
        createBuffer: () => ({
          addText: vi.fn(),
          guessSegmentProperties: vi.fn(),
          setDirection: vi.fn(),
          json: () => mockHbGlyphs,
          destroy: vi.fn()
        }),
        shape: vi.fn()
      },
      font: {},
      upem: 1000
    } as unknown as LoadedFont;

    const mockGeometryBuilder = {} as any;

    const shaper = new TextShaper(mockLoadedFont, mockGeometryBuilder);

    const lineInfo: LineInfo = {
      text: 'Hello World',
      originalStart: 0,
      originalEnd: 10,
      xOffset: 10 // Start line with an offset
    };

    const clusters = (shaper as any).shapeLineIntoClusters(
      lineInfo,
      0,
      100,
      0.01,
      'left',
      'ltr',
      new Set<number>()
    );

    expect(clusters).toHaveLength(2);

    // Test the first cluster: "Hello"
    expect(clusters[0].text).toBe('Hello');
    expect(clusters[0].position.x).toBe(10); // Should match the line's xOffset
    expect(clusters[0].position.y).toBe(0);

    // Test the second cluster: "World"
    const helloWidth = 100 + 80 + 60 + 60 + 90;
    const spaceWidth = 50;
    const letterSpacing = 0.01 * 1000; // 0.01em
    // The 5 letters of "Hello" have 5 spacing gaps after them. The space itself also has one.
    const expectedWorldStartX =
      10 + helloWidth + 5 * letterSpacing + spaceWidth + letterSpacing;

    expect(clusters[1].text).toBe('World');
    expect(clusters[1].position.x).toBeCloseTo(expectedWorldStartX);

    // Check relative position of 'r' in "World"
    const wAdvance = 120;
    const oAdvance = 90;
    const expectedRRelativeX =
      wAdvance + letterSpacing + oAdvance + letterSpacing;
    const rGlyph = clusters[1].glyphs[2];
    expect(rGlyph.x).toBeCloseTo(expectedRRelativeX);
  });
});
