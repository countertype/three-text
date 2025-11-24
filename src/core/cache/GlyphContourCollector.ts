import { Vec2 } from '../vectors';
import { Path, GlyphContours } from '../types';
import {
  PathOptimizer,
  DEFAULT_OPTIMIZATION_CONFIG,
  OptimizationStats
} from '../geometry/PathOptimizer';
import { Polygonizer, COLLINEARITY_EPSILON } from '../geometry/Polygonizer';
import { CurveFidelityConfig, GeometryOptimizationOptions } from '../types';

export class GlyphContourCollector {
  private currentGlyphId: number = 0;
  private currentTextIndex: number = 0;
  private currentGlyphPaths: Path[] = [];
  private currentPath: Path | null = null;
  private currentPoint: Vec2 | null = null;
  private currentGlyphBounds = {
    min: new Vec2(Infinity, Infinity),
    max: new Vec2(-Infinity, -Infinity)
  };

  private collectedGlyphs: GlyphContours[] = [];
  private glyphPositions: Vec2[] = [];
  private glyphTextIndices: number[] = [];

  private polygonizer: Polygonizer;
  private pathOptimizer: PathOptimizer;

  private currentPosition: Vec2 = new Vec2(0, 0);

  constructor(
    curveFidelityConfig?: CurveFidelityConfig,
    optimizationConfig?: GeometryOptimizationOptions
  ) {
    this.polygonizer = new Polygonizer(curveFidelityConfig);
    this.pathOptimizer = new PathOptimizer({
      ...DEFAULT_OPTIMIZATION_CONFIG,
      ...optimizationConfig
    });
  }

  public setPosition(x: number, y: number): void {
    this.currentPosition.set(x, y);
  }

  public updatePosition(dx: number, dy: number): void {
    this.currentPosition.x += dx;
    this.currentPosition.y += dy;
  }

  public beginGlyph(glyphId: number, textIndex: number): void {
    // Finish any previous glyph
    if (this.currentGlyphPaths.length > 0) {
      this.finishGlyph();
    }

    this.currentGlyphId = glyphId;
    this.currentTextIndex = textIndex;
    this.currentGlyphPaths = [];
    this.currentGlyphBounds.min.set(Infinity, Infinity);
    this.currentGlyphBounds.max.set(-Infinity, -Infinity);

    // Record position for this glyph
    this.glyphPositions.push(this.currentPosition.clone());
  }

  public finishGlyph(): void {
    if (this.currentPath) {
      this.finishPath();
    }

    if (this.currentGlyphPaths.length > 0) {
      this.collectedGlyphs.push({
        glyphId: this.currentGlyphId,
        paths: [...this.currentGlyphPaths],
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

      // Track textIndex separately
      this.glyphTextIndices.push(this.currentTextIndex);
    }

    this.currentGlyphPaths = [];
  }

  public onMoveTo(x: number, y: number): void {
    if (this.currentPath) {
      this.finishPath();
    }
    this.currentPoint = new Vec2(x, y);
    this.updateBounds(this.currentPoint);
    this.currentPath = {
      points: [this.currentPoint],
      glyphIndex: this.currentGlyphId
    };
  }

  public onLineTo(x: number, y: number): void {
    if (!this.currentPath || !this.currentPoint) return;
    const point = new Vec2(x, y);
    this.updateBounds(point);
    this.currentPath.points.push(point);
    this.currentPoint = point;
  }

  public onQuadTo(cx: number, cy: number, x: number, y: number): void {
    if (!this.currentPath || !this.currentPoint) return;

    const start = this.currentPoint;
    const control = new Vec2(cx, cy);
    const end = new Vec2(x, y);

    const dx = end.x - start.x;
    const dy = end.y - start.y;
    const d = Math.abs((control.x - end.x) * dy - (control.y - end.y) * dx);

    if (d < COLLINEARITY_EPSILON) {
      this.onLineTo(x, y);
      return;
    }

    const flattenedPoints = this.polygonizer.polygonizeQuadratic(
      start,
      control,
      end
    );

    for (const point of flattenedPoints) {
      this.updateBounds(point);
    }

    for (let i = 0; i < flattenedPoints.length; i++) {
      this.currentPath.points.push(flattenedPoints[i]);
    }
    this.currentPoint = end;
  }

  public onCubicTo(
    c1x: number,
    c1y: number,
    c2x: number,
    c2y: number,
    x: number,
    y: number
  ): void {
    if (!this.currentPath || !this.currentPoint) return;

    const start = this.currentPoint;
    const control1 = new Vec2(c1x, c1y);
    const control2 = new Vec2(c2x, c2y);
    const end = new Vec2(x, y);

    const dx = end.x - start.x;
    const dy = end.y - start.y;
    const d1 = Math.abs((control1.x - end.x) * dy - (control1.y - end.y) * dx);
    const d2 = Math.abs((control2.x - end.x) * dy - (control2.y - end.y) * dx);

    if (d1 < COLLINEARITY_EPSILON && d2 < COLLINEARITY_EPSILON) {
      this.onLineTo(x, y);
      return;
    }

    const flattenedPoints = this.polygonizer.polygonizeCubic(
      start,
      control1,
      control2,
      end
    );

    for (const point of flattenedPoints) {
      this.updateBounds(point);
    }

    for (let i = 0; i < flattenedPoints.length; i++) {
      this.currentPath.points.push(flattenedPoints[i]);
    }
    this.currentPoint = end;
  }

  public onClosePath(): void {
    if (!this.currentPath || !this.currentPoint) return;
    const firstPoint = this.currentPath.points[0];

    if (!this.currentPoint.equals(firstPoint)) {
      this.currentPath.points.push(firstPoint);
    }

    this.finishPath();
  }

  private finishPath(): void {
    if (this.currentPath) {
      const path = this.pathOptimizer.optimizePath(this.currentPath);
      this.currentGlyphPaths.push(path);
      this.currentPath = null;
      this.currentPoint = null;
    }
  }

  private updateBounds(point: Vec2): void {
    this.currentGlyphBounds.min.x = Math.min(
      this.currentGlyphBounds.min.x,
      point.x
    );
    this.currentGlyphBounds.min.y = Math.min(
      this.currentGlyphBounds.min.y,
      point.y
    );
    this.currentGlyphBounds.max.x = Math.max(
      this.currentGlyphBounds.max.x,
      point.x
    );
    this.currentGlyphBounds.max.y = Math.max(
      this.currentGlyphBounds.max.y,
      point.y
    );
  }

  public getCollectedGlyphs(): GlyphContours[] {
    // Finish any pending glyph
    if (this.currentGlyphPaths.length > 0) {
      this.finishGlyph();
    }
    return this.collectedGlyphs;
  }

  public getGlyphPositions(): Vec2[] {
    return this.glyphPositions;
  }

  public getTextIndices(): number[] {
    return this.glyphTextIndices;
  }

  public reset(): void {
    this.collectedGlyphs = [];
    this.glyphPositions = [];
    this.glyphTextIndices = [];
    this.currentGlyphPaths = [];
    this.currentPath = null;
    this.currentPoint = null;
    this.currentGlyphId = 0;
    this.currentTextIndex = 0;
    this.currentPosition.set(0, 0);
    this.currentGlyphBounds = {
      min: new Vec2(Infinity, Infinity),
      max: new Vec2(-Infinity, -Infinity)
    };
  }

  public setCurveFidelityConfig(config?: CurveFidelityConfig): void {
    this.polygonizer.setCurveFidelityConfig(config);
  }

  public setGeometryOptimization(options?: GeometryOptimizationOptions): void {
    this.pathOptimizer.setConfig({
      ...DEFAULT_OPTIMIZATION_CONFIG,
      ...options
    });
  }

  public getOptimizationStats(): OptimizationStats {
    return this.pathOptimizer.getStats();
  }
}
