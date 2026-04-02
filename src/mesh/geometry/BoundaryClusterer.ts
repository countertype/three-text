import { Vec3 } from '../../utils/vectors';
import type { GlyphContours } from '../../core/types';
import { perfLogger } from '../../utils/PerformanceLogger';

interface BBox {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

const OVERLAP_EPSILON = 1e-3;

export class BoundaryClusterer {
  constructor() {}

  public cluster(
    glyphContoursList: GlyphContours[],
    positions: Vec3[]
  ): number[][] {
    perfLogger.start('BoundaryClusterer.cluster', {
      glyphCount: glyphContoursList.length
    });

    const n = glyphContoursList.length;
    if (n === 0) {
      perfLogger.end('BoundaryClusterer.cluster');
      return [];
    }
    if (n === 1) {
      perfLogger.end('BoundaryClusterer.cluster');
      return [[0]];
    }

    const result = this.clusterSweepLine(glyphContoursList, positions);
    perfLogger.end('BoundaryClusterer.cluster');
    return result;
  }

  private clusterSweepLine(
    glyphContoursList: GlyphContours[],
    positions: Vec3[]
  ): number[][] {
    const n = glyphContoursList.length;

    const bounds = new Array<BBox>(n);
    const events = new Array<[number, number, number]>(2 * n);

    let eventIndex = 0;
    for (let i = 0; i < n; i++) {
      bounds[i] = this.getWorldBounds(glyphContoursList[i], positions[i]);
      events[eventIndex++] = [bounds[i].minX, 0, i];
      events[eventIndex++] = [bounds[i].maxX, 1, i];
    }

    events.sort((a, b) => a[0] - b[0] || a[1] - b[1]);

    const parent = Array.from({ length: n }, (_, i) => i);
    const rank = new Array<number>(n).fill(0);

    function find(x: number): number {
      return parent[x] === x ? x : (parent[x] = find(parent[x]));
    }

    function union(x: number, y: number): void {
      const px = find(x);
      const py = find(y);
      if (px === py) return;

      if (rank[px] < rank[py]) {
        parent[px] = py;
      } else if (rank[px] > rank[py]) {
        parent[py] = px;
      } else {
        parent[py] = px;
        rank[px]++;
      }
    }

    const active = new Set<number>();

    for (const [, eventType, glyphIndex] of events) {
      if (eventType === 0) {
        const bounds1 = bounds[glyphIndex];

        for (const activeIndex of active) {
          const bounds2 = bounds[activeIndex];

          if (
            bounds1.minY < bounds2.maxY + OVERLAP_EPSILON &&
            bounds1.maxY > bounds2.minY - OVERLAP_EPSILON
          ) {
            union(glyphIndex, activeIndex);
          }
        }

        active.add(glyphIndex);
      } else {
        active.delete(glyphIndex);
      }
    }

    const clusters = new Map<number, number[]>();
    for (let i = 0; i < n; i++) {
      const root = find(i);
      let list = clusters.get(root);
      if (!list) {
        list = [];
        clusters.set(root, list);
      }
      list.push(i);
    }

    return Array.from(clusters.values());
  }

  private getWorldBounds(contours: GlyphContours, position: Vec3): BBox {
    return {
      minX: contours.bounds.min.x + position.x,
      minY: contours.bounds.min.y + position.y,
      maxX: contours.bounds.max.x + position.x,
      maxY: contours.bounds.max.y + position.y
    };
  }
}
