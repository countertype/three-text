import { Vec2 } from '../utils/vectors';
import type { GlyphOutline, OutlineSegmentType } from '../core/types';

export class GlyphOutlineCollector {
  private currentGlyphId: number = 0;
  private currentTextIndex: number = 0;
  private inGlyph: boolean = false;

  private currentSegments: {
    type: OutlineSegmentType;
    contourId: number;
    p0: Vec2;
    p1: Vec2;
    p2?: Vec2;
    p3?: Vec2;
  }[] = [];

  private currentPoint: Vec2 | null = null;
  private contourStartPoint: Vec2 | null = null;
  private contourId: number = 0;

  private currentGlyphBounds = {
    min: new Vec2(Infinity, Infinity),
    max: new Vec2(-Infinity, -Infinity)
  };

  private collectedGlyphs: GlyphOutline[] = [];
  private currentPosition: Vec2 = new Vec2(0, 0);

  public setPosition(x: number, y: number): void {
    this.currentPosition.set(x, y);
  }

  public updatePosition(dx: number, dy: number): void {
    this.currentPosition.x += dx;
    this.currentPosition.y += dy;
  }

  public beginGlyph(glyphId: number, textIndex: number): void {
    if (this.currentSegments.length > 0) {
      this.finishGlyph();
    }

    this.currentGlyphId = glyphId;
    this.currentTextIndex = textIndex;
    this.inGlyph = true;
    this.currentSegments = [];
    this.currentPoint = null;
    this.contourStartPoint = null;
    this.contourId = 0;
    this.currentGlyphBounds.min.set(Infinity, Infinity);
    this.currentGlyphBounds.max.set(-Infinity, -Infinity);
  }

  public finishGlyph(): void {
    if (this.currentSegments.length > 0) {
      this.collectedGlyphs.push({
        glyphId: this.currentGlyphId,
        textIndex: this.currentTextIndex,
        segments: this.currentSegments,
        bounds: {
          min: {
            x: this.currentGlyphBounds.min.x,
            y: this.currentGlyphBounds.min.y
          },
          max: {
            x: this.currentGlyphBounds.max.x,
            y: this.currentGlyphBounds.max.y
          }
        }
      });
    } else {
      this.collectedGlyphs.push({
        glyphId: this.currentGlyphId,
        textIndex: this.currentTextIndex,
        segments: [],
        bounds: {
          min: { x: 0, y: 0 },
          max: { x: 0, y: 0 }
        }
      });
    }

    this.currentSegments = [];
    this.currentPoint = null;
    this.contourStartPoint = null;
    this.inGlyph = false;
    this.currentGlyphId = 0;
    this.currentTextIndex = 0;
  }

  public onMoveTo(x: number, y: number): void {
    const p = new Vec2(x, y);
    this.updateBounds(p);
    this.currentPoint = p;
    this.contourStartPoint = p;
    this.contourId++;
  }

  public onLineTo(x: number, y: number): void {
    if (!this.currentPoint) return;
    const p1 = new Vec2(x, y);
    const p0 = this.currentPoint;
    this.updateBounds(p1);
    this.currentSegments.push({
      type: 0,
      contourId: this.contourId,
      p0,
      p1
    });
    this.currentPoint = p1;
  }

  public onQuadTo(cx: number, cy: number, x: number, y: number): void {
    if (!this.currentPoint) return;
    const p0 = this.currentPoint;
    const p1 = new Vec2(cx, cy);
    const p2 = new Vec2(x, y);
    this.updateBounds(p1);
    this.updateBounds(p2);
    this.currentSegments.push({
      type: 1,
      contourId: this.contourId,
      p0,
      p1,
      p2
    });
    this.currentPoint = p2;
  }

  public onCubicTo(
    c1x: number,
    c1y: number,
    c2x: number,
    c2y: number,
    x: number,
    y: number
  ): void {
    if (!this.currentPoint) return;
    const p0 = this.currentPoint;
    const p1 = new Vec2(c1x, c1y);
    const p2 = new Vec2(c2x, c2y);
    const p3 = new Vec2(x, y);
    this.updateBounds(p1);
    this.updateBounds(p2);
    this.updateBounds(p3);
    this.currentSegments.push({
      type: 2,
      contourId: this.contourId,
      p0,
      p1,
      p2,
      p3
    });
    this.currentPoint = p3;
  }

  public onClosePath(): void {
    if (!this.currentPoint || !this.contourStartPoint) return;
    const p0 = this.currentPoint;
    const p1 = this.contourStartPoint;
    if (p0.x !== p1.x || p0.y !== p1.y) {
      this.currentSegments.push({
        type: 0,
        contourId: this.contourId,
        p0,
        p1
      });
    }
    this.currentPoint = p1;
    this.contourStartPoint = null;
  }

  public getCollectedGlyphs(): GlyphOutline[] {
    if (this.inGlyph) {
      this.finishGlyph();
    }
    return this.collectedGlyphs;
  }

  public reset(): void {
    this.collectedGlyphs = [];
    this.currentGlyphId = 0;
    this.currentTextIndex = 0;
    this.currentSegments = [];
    this.currentPoint = null;
    this.contourStartPoint = null;
    this.contourId = 0;
    this.currentPosition.set(0, 0);
    this.currentGlyphBounds.min.set(Infinity, Infinity);
    this.currentGlyphBounds.max.set(-Infinity, -Infinity);
  }

  private updateBounds(p: Vec2): void {
    this.currentGlyphBounds.min.x = Math.min(this.currentGlyphBounds.min.x, p.x);
    this.currentGlyphBounds.min.y = Math.min(this.currentGlyphBounds.min.y, p.y);
    this.currentGlyphBounds.max.x = Math.max(this.currentGlyphBounds.max.x, p.x);
    this.currentGlyphBounds.max.y = Math.max(this.currentGlyphBounds.max.y, p.y);
  }
}
