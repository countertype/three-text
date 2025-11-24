import { GlyphGeometryInfo, TextRange, TextQueryOptions } from '../types';
import { Box3 as Box3Core, Vec3 } from '../vectors';

export class TextRangeQuery {
  private glyphsByTextIndex = new Map<number, GlyphGeometryInfo[]>();

  constructor(
    private text: string,
    glyphs: GlyphGeometryInfo[]
  ) {
    glyphs.forEach((g) => {
      const existing = this.glyphsByTextIndex.get(g.textIndex) || [];
      existing.push(g);
      this.glyphsByTextIndex.set(g.textIndex, existing);
    });
  }

  public execute(options: TextQueryOptions): TextRange[] {
    const ranges: TextRange[] = [];

    if (options.byText) {
      ranges.push(...this.findByText(options.byText));
    }

    if (options.byCharRange) {
      ranges.push(...this.findByCharRange(options.byCharRange));
    }

    return ranges;
  }

  private findByText(patterns: string[]): TextRange[] {
    const ranges: TextRange[] = [];
    for (const pattern of patterns) {
      let index = 0;
      while ((index = this.text.indexOf(pattern, index)) !== -1) {
        ranges.push(
          this.createTextRange(index, index + pattern.length, pattern)
        );
        index += pattern.length;
      }
    }
    return ranges;
  }

  private findByCharRange(
    ranges: { start: number; end: number }[]
  ): TextRange[] {
    return ranges.map((range) => {
      const text = this.text.slice(range.start, range.end);
      return this.createTextRange(range.start, range.end, text);
    });
  }

  private createTextRange(
    start: number,
    end: number,
    originalText: string
  ): TextRange {
    const relevantGlyphs: GlyphGeometryInfo[] = [];
    const lineGroups = new Map<number, GlyphGeometryInfo[]>();

    for (let i = start; i < end; i++) {
      const glyphs = this.glyphsByTextIndex.get(i);
      if (glyphs) {
        for (const glyph of glyphs) {
          relevantGlyphs.push(glyph);

          const lineGlyphs = lineGroups.get(glyph.lineIndex) || [];
          lineGlyphs.push(glyph);
          lineGroups.set(glyph.lineIndex, lineGlyphs);
        }
      }
    }

    const bounds = Array.from(lineGroups.values()).map((lineGlyphs) =>
      this.calculateBounds(lineGlyphs)
    );

    return {
      start,
      end,
      originalText,
      bounds,
      glyphs: relevantGlyphs,
      lineIndices: Array.from(lineGroups.keys()).sort((a, b) => a - b)
    };
  }

  private calculateBounds(glyphs: GlyphGeometryInfo[]): {
    min: { x: number; y: number; z: number };
    max: { x: number; y: number; z: number };
  } {
    if (glyphs.length === 0) {
      return {
        min: { x: 0, y: 0, z: 0 },
        max: { x: 0, y: 0, z: 0 }
      };
    }

    const box = new Box3Core();

    for (const glyph of glyphs) {
      const glyphBox = new Box3Core(
        new Vec3(glyph.bounds.min.x, glyph.bounds.min.y, glyph.bounds.min.z),
        new Vec3(glyph.bounds.max.x, glyph.bounds.max.y, glyph.bounds.max.z)
      );
      box.union(glyphBox);
    }

    return {
      min: { x: box.min.x, y: box.min.y, z: box.min.z },
      max: { x: box.max.x, y: box.max.y, z: box.max.z }
    };
  }
}
