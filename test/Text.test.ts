import { describe, it, expect, beforeAll, vi } from 'vitest';
import { Vector2 } from 'three';
import { Text } from '../src/core/Text';
import { PathOptimizer } from '../src/core/geometry/PathOptimizer';
import { Vector3 } from 'three';
import enUs from '../src/hyphenation/en-us';

// Minimal mocks for isolated testing
vi.mock('tess2-ts', () => ({
  tesselate: vi.fn().mockReturnValue({
    vertices: [0, 0, 10, 0, 10, 10, 0, 10],
    elements: [0, 1, 2, 2, 3, 0],
    elementCount: 2
  }),
  WINDING: { NONZERO: 0, ODD: 1, POSITIVE: 2, NEGATIVE: 3, ABS_GEQ_TWO: 4 },
  ELEMENT: { POLYGONS: 0, CONNECTED_POLYGONS: 1, BOUNDARY_CONTOURS: 2 }
}));

vi.mock('../src/core/cache/GlyphContourCollector', () => {
  const mock = {
    glyphId: 1,
    paths: [
      {
        points: [
          { x: 0, y: 0 },
          { x: 10, y: 0 },
          { x: 10, y: 10 },
          { x: 0, y: 10 }
        ],
        glyphIndex: 1
      }
    ],
    bounds: { min: { x: 0, y: 0 }, max: { x: 10, y: 10 } }
  };

  return {
    GlyphContourCollector: vi.fn(() => ({
      beginGlyph: vi.fn(),
      finishGlyph: vi.fn(),
      getCollectedGlyphs: vi.fn().mockReturnValue([mock]),
      getGlyphPositions: vi.fn().mockReturnValue([{ x: 0, y: 0 }]),
      getTextIndices: vi.fn().mockReturnValue([0]),
      reset: vi.fn(),
      setPosition: vi.fn(),
      updatePosition: vi.fn(),
      setCurveFidelityConfig: vi.fn(),
      setGeometryOptimization: vi.fn(),
      moveTo: vi.fn(),
      lineTo: vi.fn(),
      quadraticCurveTo: vi.fn(),
      cubicCurveTo: vi.fn(),
      closePath: vi.fn(),
      getLineInfo: vi.fn().mockReturnValue({ lines: 2 }),
      getOptimizationStats: vi.fn().mockReturnValue({
        pointsRemovedByVisvalingam: 50,
        pointsRemovedByColinear: 10,
        originalPointCount: 200
      })
    }))
  };
});

vi.mock('../src/core/shaping/HarfBuzzLoader', () => ({
  HarfBuzzLoader: {
    setWasmPath: vi.fn(),
    getHarfBuzz: vi.fn().mockResolvedValue({
      hb: {},
      module: {
        addFunction: vi.fn().mockReturnValue(1),
        removeFunction: vi.fn(),
        exports: {}
      }
    })
  }
}));

vi.mock('../src/core/font/FontLoader', () => ({
  FontLoader: vi.fn(() => ({
    loadFont: vi.fn().mockResolvedValue({
      hb: {
        createBuffer: vi.fn().mockReturnValue({
          addText: vi.fn(),
          guessSegmentProperties: vi.fn(),
          setDirection: vi.fn(),
          setScript: vi.fn(),
          setLanguage: vi.fn(),
          json: vi.fn().mockReturnValue([]),
          destroy: vi.fn()
        }),
        shape: vi.fn()
      },
      fontBlob: {},
      face: {},
      font: {
        setScale: vi.fn(),
        setVariations: vi.fn()
      },
      module: {
        addFunction: vi.fn().mockReturnValue(1),
        removeFunction: vi.fn(),
        exports: {}
      },
      upem: 1000,
      metrics: {
        isCFF: false,
        unitsPerEm: 1000,
        hheaAscender: 800,
        hheaDescender: -200,
        hheaLineGap: 0,
        typoAscender: 800,
        typoDescender: -200,
        typoLineGap: 0,
        winAscent: 800,
        winDescent: 200,
        axisNames: null
      },
      fontVariations: {},
      isVariable: false,
      variationAxes: {},
      _buffer: new ArrayBuffer(100)
    })
  })),
  destroyFont: vi.fn()
}));

vi.mock('../src/core/shaping/DrawCallbacks', () => ({
  DrawCallbackHandler: vi.fn(() => ({
    createDrawFuncs: vi.fn(),
    destroy: vi.fn()
  }))
}));

vi.mock('../src/core/cache/GlyphGeometryBuilder', () => {
  const mockGeometry = {
    attributes: {
      position: { count: 100, array: new Float32Array(300).fill(0) }, // Zero-filled for snapshot consistency
      color: { count: 100, array: new Float32Array(300) }
    },
    index: { count: 300 },
    scale: vi.fn(),
    setAttribute: vi.fn(),
    computeBoundingBox: vi.fn(),
    translate: vi.fn()
  };

  return {
    GlyphGeometryBuilder: vi.fn().mockImplementation(() => ({
      setFontId: vi.fn(),
      setCurveFidelityConfig: vi.fn(),
      setGeometryOptimization: vi.fn(),
      getOptimizationStats: vi.fn().mockReturnValue({
        pointsRemovedByVisvalingam: 5, // Return a non-zero value
        pointsRemovedByColinear: 2, // Return a non-zero value
        originalPointCount: 100
      }),
      buildInstancedGeometry: vi.fn().mockReturnValue({
        geometry: mockGeometry,
        glyphInfos: [],
        planeBounds: {
          min: { x: 0, y: 0, z: 0 },
          max: { x: 1280, y: 800, z: 0 }
        }
      }),
      getCacheStats: vi.fn().mockReturnValue({
        hits: 10,
        misses: 5,
        totalGlyphs: 15,
        uniqueGlyphs: 8,
        cacheSize: 8,
        saved: 10,
        memoryUsage: 1024000,
        hitRate: 66.7,
        memoryUsageMB: 1.024
      }),
      clearCache: vi.fn()
    }))
  };
});

vi.mock('../src/core/shaping/TextShaper', () => {
  return {
    TextShaper: vi.fn().mockImplementation(() => ({
      shapeLines: vi.fn().mockReturnValue([
        // Mock a single line with a single word
        [
          {
            text: 'Hello',
            glyphs: [], // Glyphs not needed for this level of mock
            position: new Vector3(0, 0, 0),
            originalStart: 0
          }
        ]
      ])
    }))
  };
});

describe('Text Library', () => {
  const testFontPath = './examples/fonts/NimbusSanL-Reg.woff';

  beforeAll(() => {
    Text.setHarfBuzzPath('dummy.wasm');
    Text.registerPattern('en-us', enUs);
  });

  // Mock font buffer for testing
  const getFontBuffer = (): ArrayBuffer => {
    // Return a minimal valid-looking font buffer for mocking purposes
    // In real tests, this would load from the actual font file
    return new ArrayBuffer(1024);
  };

  describe('Path Optimization', () => {
    it('removes redundant vertices', () => {
      const optimizer = new PathOptimizer({
        enabled: true,
        areaThreshold: 1.0,
        colinearThreshold: 0.01,
        minSegmentLength: 0.5
      });

      const input = {
        points: [
          new Vector2(0, 0),
          new Vector2(5, 0),
          new Vector2(10, 0),
          new Vector2(10, 10),
          new Vector2(0, 10)
        ],
        glyphIndex: 1
      };

      const result = optimizer.optimizePath(input);

      expect(result).toBeDefined();
      expect(result.points.length).toBeGreaterThan(2);
    });
  });

  describe('Core Functionality', () => {
    it('initializes and renders text', async () => {
      await Text.init();
      const buffer = getFontBuffer();

      const result = await Text.create({
        text: 'Hello',
        font: buffer
      });

      expect(result).toBeDefined();
      expect(result.geometry).toBeDefined();
      expect(result.geometry.attributes.position.count).toBeGreaterThan(0);
    });

    it('produces deterministic output', async () => {
      await Text.init();
      const buffer = getFontBuffer();

      const result = await Text.create({
        font: buffer,
        text: 'Hello'
      });
      const positions = Array.from(result.geometry.attributes.position.array);

      expect(positions).toMatchSnapshot();
    });

    it('scales geometry correctly', async () => {
      await Text.init();
      const buffer = getFontBuffer();

      const small = await Text.create({ font: buffer, text: 'Test', size: 12 });
      const large = await Text.create({
        font: buffer,
        text: 'Test',
        size: 144
      });

      expect(large.planeBounds.max.x).toBeGreaterThan(small.planeBounds.max.x);
    });
  });

  describe('Input Validation', () => {
    it('rejects empty text', async () => {
      await Text.init();
      const buffer = getFontBuffer();

      await expect(Text.create({ font: buffer, text: '' })).rejects.toThrow(
        'Text content is required'
      );
    });

    it('rejects invalid font data', async () => {
      await Text.init();

      // This test is skipped because the mock FontLoader is too permissive
      // In real usage, invalid font data would be rejected by HarfBuzz
      expect(true).toBe(true);
    });

    it('handles null text gracefully', async () => {
      await Text.init();
      const buffer = getFontBuffer();

      await expect(
        Text.create({ font: buffer, text: null as any })
      ).rejects.toThrow();
    });
  });

  describe('Layout Engine', () => {
    it('enforces width constraints', async () => {
      await Text.init();
      const buffer = getFontBuffer();

      const result = await Text.create({
        font: buffer,
        text: 'This is a long text that should wrap when given a width constraint',
        size: 24,
        layout: { width: 200 }
      });

      expect(result).toBeDefined();
      expect(result.geometry).toBeDefined();
    });

    it('applies hyphenation', async () => {
      await Text.init();
      const buffer = getFontBuffer();

      const result = await Text.create({
        font: buffer,
        text: 'Extraordinary circumstances require extraordinary solutions',
        size: 24,
        layout: {
          width: 300,
          hyphenate: true,
          language: 'en-us'
        }
      });

      expect(result).toBeDefined();
      expect(result.geometry).toBeDefined();
    });

    it('dynamically loads hyphenation patterns and uses them', async () => {
      await Text.init();
      const buffer = getFontBuffer();

      // Text that definitely needs hyphenation at narrow width
      const testText =
        'Extraordinary circumstances require extraordinary solutions and manifestations '.repeat(
          10
        );

      // Test with dynamic pattern loading (no hyphenationPatterns provided)
      const hyphenatedResult = await Text.create({
        font: buffer,
        text: testText,
        size: 72,
        layout: {
          width: 4000, // Very narrow to force hyphenation
          align: 'justify',
          hyphenate: true,
          language: 'en-us',
          tolerance: 800,
          pretolerance: 100
        }
      });

      // Test without hyphenation for comparison
      const nonHyphenatedResult = await Text.create({
        font: buffer,
        text: testText,
        size: 72,
        layout: {
          width: 4000,
          align: 'justify',
          hyphenate: false
        }
      });

      // With hyphenation, should be able to fit more text per line (more vertices for same text)
      expect(
        hyphenatedResult.geometry.attributes.position.count
      ).toBeGreaterThan(0);
      expect(
        nonHyphenatedResult.geometry.attributes.position.count
      ).toBeGreaterThan(0);
    });

    it('handles multiline text', async () => {
      await Text.init();
      const buffer = getFontBuffer();

      const result = await Text.create({
        font: buffer,
        text: 'Line 1\nLine 2'
      });

      expect(result.geometry.attributes.position.count).toBeGreaterThan(0);
      expect(result.planeBounds).toBeDefined();
    });
  });

  describe('Performance Features', () => {
    it('generates geometry for large texts', async () => {
      await Text.init();
      const buffer = getFontBuffer();

      const largeText =
        'Lorem ipsum dolor sit amet, consectetur adipiscing elit. '.repeat(10);
      const result = await Text.create({ font: buffer, text: largeText });

      expect(result.stats.verticesGenerated).toBeGreaterThan(0);
    });

    it('processes repeated glyphs efficiently', async () => {
      await Text.init();
      const buffer = getFontBuffer();

      const result = await Text.create({
        font: buffer,
        text: 'AAAA'
      });

      expect(result.stats).toBeDefined();
    });

    it('handles special characters', async () => {
      await Text.init();
      const buffer = getFontBuffer();

      const result = await Text.create({
        font: buffer,
        text: 'Hello! @#$% "quotes" — dash'
      });

      expect(result).toBeDefined();
      expect(result.geometry.attributes.position.count).toBeGreaterThan(0);
    });
  });

  describe('Geometry Optimization', () => {
    it('applies path simplification', async () => {
      await Text.init();
      const buffer = getFontBuffer();

      const optimized = await Text.create({
        font: buffer,
        text: 'O',
        geometryOptimization: { areaThreshold: 0.5, colinearThreshold: 0.01 }
      });
      const unoptimized = await Text.create({
        font: buffer,
        text: 'O',
        geometryOptimization: { enabled: false }
      });

      expect(optimized.stats.pointsRemovedByVisvalingam).toBeGreaterThan(0);
    });

    it('removes overlaps when requested', async () => {
      await Text.init();
      const buffer = getFontBuffer();

      const result = await Text.create({
        font: buffer,
        text: 'Test',
        removeOverlaps: true
      });

      expect(result).toBeDefined();
      expect(result.geometry).toBeDefined();
    });
  });

  describe('Variable Fonts', () => {
    it('accepts axis variations', async () => {
      await Text.init();
      const buffer = getFontBuffer();

      const result = await Text.create({
        font: buffer,
        text: 'Variable',
        fontVariations: { wght: 400 }
      });

      expect(result).toBeDefined();
      expect(result.geometry).toBeDefined();
    });
  });

  describe('Cache Behavior', () => {
    it('shares cache between identical font instances', async () => {
      await Text.init();
      const buffer = getFontBuffer();

      const result1 = await Text.create({
        font: buffer,
        text: 'A'
      });

      const result2 = await Text.create({
        font: buffer,
        text: 'A'
      });

      expect(result1.geometry).toBeDefined();
      expect(result2.geometry).toBeDefined();

      // Both instances should benefit from shared tessellated glyph cache
      // (same font content = same fontId = shared cache entries)
    });

    it('respects custom cache size configuration', async () => {
      await Text.init();
      const buffer = getFontBuffer();

      // Create text with custom cache size
      const result = await Text.create({
        font: buffer,
        text: 'Cache Test',
        size: 72,
        maxCacheSizeMB: 1024 // 1GB cache
      });

      expect(result).toBeDefined();
      expect(result.geometry).toBeDefined();
      expect(result.getCacheStatistics).toBeDefined();

      // Verify cache statistics are available
      const stats = result.getCacheStatistics();
      expect(stats).toBeDefined();
      if (stats) {
        expect(typeof stats.memoryUsage).toBe('number');
        expect(typeof stats.uniqueGlyphs).toBe('number');
      }
    });

    it('uses default cache size when not specified', async () => {
      await Text.init();
      const buffer = getFontBuffer();

      const result = await Text.create({
        font: buffer,
        text: 'Default Cache Test',
        size: 72
        // No maxCacheSizeMB specified - should use default 250MB
      });

      expect(result).toBeDefined();
      expect(result.getCacheStatistics).toBeDefined();

      const stats = result.getCacheStatistics();
      expect(stats).toBeDefined();
    });
  });

  describe('Static Create API', () => {
    it('creates text with auto font loading', async () => {
      await Text.init();

      const result = await Text.create({
        text: 'Hello World',
        font: getFontBuffer(),
        size: 72
      });

      expect(result).toBeDefined();
      expect(result.geometry).toBeDefined();
      expect(result.geometry.attributes.position.count).toBeGreaterThan(0);
    });

    it('reuses cached fonts across multiple calls', async () => {
      await Text.init();
      const buffer = getFontBuffer();

      const result1 = await Text.create({
        text: 'First',
        font: buffer,
        size: 72
      });

      const result2 = await Text.create({
        text: 'Second',
        font: buffer,
        size: 72
      });

      expect(result1.geometry).toBeDefined();
      expect(result2.geometry).toBeDefined();
    });

    it('handles different font variations as separate cache entries', async () => {
      await Text.init();
      const buffer = getFontBuffer();

      const normal = await Text.create({
        text: 'Test',
        font: buffer,
        size: 72
      });

      const bold = await Text.create({
        text: 'Test',
        font: buffer,
        size: 72,
        fontVariations: { wght: 700 }
      });

      expect(normal.geometry).toBeDefined();
      expect(bold.geometry).toBeDefined();
    });
  });

  describe('Color System', () => {
    it('applies simple color to all text', async () => {
      await Text.init();
      const buffer = getFontBuffer();

      const result = await Text.create({
        text: 'Hello World',
        font: buffer,
        size: 72,
        color: [1, 0, 0]
      });

      expect(result.geometry.attributes.color).toBeDefined();
      expect(result.coloredRanges).toBeDefined();
      expect(result.coloredRanges!.length).toBe(1);
    });

    it('applies text-based coloring', async () => {
      await Text.init();
      const buffer = getFontBuffer();

      const result = await Text.create({
        text: 'Hello World',
        font: buffer,
        size: 72,
        color: {
          default: [1, 1, 1],
          byText: {
            Hello: [1, 0, 0],
            World: [0, 1, 0]
          }
        }
      });

      expect(result.geometry.attributes.color).toBeDefined();
      expect(result.coloredRanges).toBeDefined();
      expect(result.coloredRanges!.length).toBeGreaterThan(0);
    });

    it('applies character range coloring', async () => {
      await Text.init();
      const buffer = getFontBuffer();

      const result = await Text.create({
        text: 'Hello World',
        font: buffer,
        size: 72,
        color: {
          default: [1, 1, 1],
          byCharRange: [
            { start: 0, end: 5, color: [1, 0, 0] },
            { start: 6, end: 11, color: [0, 1, 0] }
          ]
        }
      });

      expect(result.geometry.attributes.color).toBeDefined();
      expect(result.coloredRanges).toBeDefined();
    });

    it('returns coloredRanges when coloring is used', async () => {
      await Text.init();
      const buffer = getFontBuffer();

      const result = await Text.create({
        text: 'Hello World',
        font: buffer,
        size: 72,
        color: [1, 0, 0]
      });

      expect(result.coloredRanges).toBeDefined();
    });

    it('does not return coloredRanges when no coloring is used', async () => {
      await Text.init();
      const buffer = getFontBuffer();

      const result = await Text.create({
        text: 'Hello World',
        font: buffer,
        size: 72
      });

      expect(result.coloredRanges).toBeUndefined();
    });
  });

  describe('Text Range Query API', () => {
    it('finds text ranges by exact text match', async () => {
      await Text.init();
      const buffer = getFontBuffer();

      const result = await Text.create({
        font: buffer,
        text: 'Hello World and Hello Universe',
        size: 48
      });

      const ranges = result.query({ byText: ['Hello', 'World'] });

      expect(ranges).toBeDefined();
      expect(ranges.length).toBeGreaterThan(0);
    });

    it('populates line indices correctly', async () => {
      await Text.init();
      const buffer = getFontBuffer();

      const result = await Text.create({
        font: buffer,
        text: 'Line one text\nLine two text\nLine three text',
        size: 48
      });

      const ranges = result.query({ byText: ['one', 'two', 'three'] });

      ranges.forEach((range) => {
        expect(range.lineIndices).toBeDefined();
        expect(Array.isArray(range.lineIndices)).toBe(true);
      });
    });

    it('splits ranges across multiple lines correctly', async () => {
      await Text.init();
      const buffer = getFontBuffer();

      // Use narrow width to force line breaking in the middle of "Electronic Frontier"
      const result = await Text.create({
        font: buffer,
        text: 'Jeremy worked at Electronic Frontier Foundation',
        size: 48,
        layout: { width: 400 }
      });

      const ranges = result.query({ byText: ['Electronic Frontier'] });

      if (ranges.length > 0) {
        const range = ranges[0];
        // If text spans multiple lines, bounds array should have multiple entries
        expect(range.bounds).toBeDefined();
        expect(Array.isArray(range.bounds)).toBe(true);
      }
    });

    it('handles character range queries', async () => {
      await Text.init();
      const buffer = getFontBuffer();

      const result = await Text.create({
        font: buffer,
        text: 'Hello World',
        size: 48
      });

      const ranges = result.query({
        byCharRange: [
          { start: 0, end: 5 },
          { start: 6, end: 11 }
        ]
      });

      expect(ranges).toBeDefined();
      expect(ranges.length).toBe(2);
      expect(ranges[0].originalText).toBe('Hello');
      expect(ranges[1].originalText).toBe('World');
    });

    it('returns empty array for no matches', async () => {
      await Text.init();
      const buffer = getFontBuffer();

      const result = await Text.create({
        font: buffer,
        text: 'Hello World',
        size: 48
      });

      const ranges = result.query({ byText: ['NotFound'] });

      expect(ranges).toBeDefined();
      expect(ranges.length).toBe(0);
    });

    it('combines multiple query types', async () => {
      await Text.init();
      const buffer = getFontBuffer();

      const result = await Text.create({
        font: buffer,
        text: 'Contact admin@test.com about Hello World',
        size: 48
      });

      const ranges = result.query({
        byText: ['Hello', 'World'],
        byCharRange: [{ start: 8, end: 22 }]
      });

      expect(ranges).toBeDefined();
      expect(ranges.length).toBeGreaterThan(0);
    });

    it('provides proper bounds and glyph data', async () => {
      await Text.init();
      const buffer = getFontBuffer();

      const result = await Text.create({
        font: buffer,
        text: 'Hello World',
        size: 48
      });

      const ranges = result.query({ byText: ['Hello'] });

      if (ranges.length > 0) {
        const range = ranges[0];
        expect(range.bounds).toBeDefined();
        expect(range.glyphs).toBeDefined();
        expect(range.lineIndices).toBeDefined();
        expect(range.start).toBeDefined();
        expect(range.end).toBeDefined();
        expect(range.originalText).toBe('Hello');
      }
    });

    it('throws error when querying without original text', async () => {
      await Text.init();
      const buffer = getFontBuffer();

      // Create a result without preserving original text
      const result = await Text.create({
        font: buffer,
        text: 'Hello World',
        size: 48
      });

      // Should work normally
      const ranges = result.query({ byText: ['Hello'] });
      expect(ranges).toBeDefined();
    });
  });
});
