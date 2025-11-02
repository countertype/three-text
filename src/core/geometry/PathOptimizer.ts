import { Vector2 } from 'three';
import { MinHeap } from '../../utils/MinHeap';
import type { Path } from '../types';

interface VWPoint {
  index: number;
  area: number;
  prev: VWPoint | null;
  next: VWPoint | null;
}

export interface OptimizationConfig {
  enabled: boolean;
  areaThreshold: number;
  colinearThreshold: number;
  minSegmentLength: number;
}

export interface OptimizationStats {
  pointsRemovedByVisvalingam: number;
  pointsRemovedByColinear: number;
  originalPointCount: number;
}

export const DEFAULT_OPTIMIZATION_CONFIG: OptimizationConfig = {
  enabled: true,
  areaThreshold: 1.0, // Remove triangles smaller than 1 square font unit
  colinearThreshold: 0.0087, // ~0.5 degrees in radians
  minSegmentLength: 10
};

export class PathOptimizer {
  private config: OptimizationConfig;
  private stats: OptimizationStats = {
    pointsRemovedByVisvalingam: 0,
    pointsRemovedByColinear: 0,
    originalPointCount: 0
  };

  constructor(config: OptimizationConfig) {
    this.config = config;
  }

  public setConfig(config: OptimizationConfig) {
    this.config = config;
  }

  public optimizePath(path: Path): Path {
    if (!this.config.enabled || path.points.length <= 2) {
      return path;
    }

    this.stats.originalPointCount += path.points.length;

    let points = [...path.points];

    if (points.length < 5) {
      return path;
    }

    points = this.simplifyPathVW(points, this.config.areaThreshold);

    if (points.length < 3) {
      return path;
    }

    points = this.removeColinearPoints(points, this.config.colinearThreshold);

    if (points.length < 3) {
      return path;
    }

    return {
      ...path,
      points
    };
  }

  // Visvalingam-Whyatt algorithm
  private simplifyPathVW(points: Vector2[], areaThreshold: number): Vector2[] {
    if (points.length <= 3) return points;

    const originalLength = points.length;
    const minPoints = 3;

    const pointList: VWPoint[] = points.map((p, i) => ({
      index: i,
      area: Infinity,
      prev: null,
      next: null
    }));

    for (let i = 0; i < pointList.length; i++) {
      pointList[i].prev = pointList[i - 1] || null;
      pointList[i].next = pointList[i + 1] || null;
    }

    const heap = new MinHeap<VWPoint>((a, b) => a.area - b.area);

    for (let i = 1; i < pointList.length - 1; i++) {
      const p = pointList[i];
      p.area = this.calculateTriangleArea(
        points[p.prev!.index],
        points[p.index],
        points[p.next!.index]
      );
      heap.insert(p);
    }

    let remainingPoints = originalLength;
    while (!heap.isEmpty() && remainingPoints > minPoints) {
      const p = heap.extractMin();
      if (!p || p.area > areaThreshold) {
        break;
      }

      if (this.config.minSegmentLength > 0 && p.prev && p.next) {
        const prevPoint = points[p.prev.index];
        const currentPoint = points[p.index];
        const nextPoint = points[p.next.index];
        const len1 = prevPoint.distanceTo(currentPoint);
        const len2 = currentPoint.distanceTo(nextPoint);

        if (
          len1 < this.config.minSegmentLength ||
          len2 < this.config.minSegmentLength
        ) {
          continue;
        }
      }

      if (p.prev) p.prev.next = p.next;
      if (p.next) p.next.prev = p.prev;

      remainingPoints--;
      if (p.prev && p.prev.prev) {
        p.prev.area = this.calculateTriangleArea(
          points[p.prev.prev.index],
          points[p.prev.index],
          points[p.next!.index]
        );
        heap.update(p.prev);
      }

      if (p.next && p.next.next) {
        p.next.area = this.calculateTriangleArea(
          points[p.prev!.index],
          points[p.next.index],
          points[p.next.next.index]
        );
        heap.update(p.next);
      }
    }

    const simplifiedPoints: Vector2[] = [];
    let current: VWPoint | null = pointList[0];
    while (current) {
      simplifiedPoints.push(points[current.index]);
      current = current.next;
    }

    const pointsRemoved = originalLength - simplifiedPoints.length;
    this.stats.pointsRemovedByVisvalingam += pointsRemoved;

    return simplifiedPoints;
  }

  private removeColinearPoints(
    points: Vector2[],
    threshold: number
  ): Vector2[] {
    if (points.length <= 2) return points;

    const result: Vector2[] = [points[0]];

    for (let i = 1; i < points.length - 1; i++) {
      const prev = points[i - 1];
      const current = points[i];
      const next = points[i + 1];

      const v1 = new Vector2(current.x - prev.x, current.y - prev.y);
      const v2 = new Vector2(next.x - current.x, next.y - current.y);

      const angle = Math.abs(v1.angle() - v2.angle());
      const normalizedAngle = Math.min(angle, 2 * Math.PI - angle);

      if (
        normalizedAngle > threshold ||
        v1.length() < this.config.minSegmentLength ||
        v2.length() < this.config.minSegmentLength
      ) {
        result.push(current);
      } else {
        this.stats.pointsRemovedByColinear++;
      }
    }

    result.push(points[points.length - 1]);
    return result;
  }

  // Shoelace formula
  private calculateTriangleArea(p1: Vector2, p2: Vector2, p3: Vector2): number {
    return Math.abs(
      (p1.x * (p2.y - p3.y) + p2.x * (p3.y - p1.y) + p3.x * (p1.y - p2.y)) / 2
    );
  }

  public getStats(): OptimizationStats {
    return { ...this.stats };
  }

  public resetStats(): void {
    this.stats = {
      pointsRemovedByVisvalingam: 0,
      pointsRemovedByColinear: 0,
      originalPointCount: 0
    };
  }
}
