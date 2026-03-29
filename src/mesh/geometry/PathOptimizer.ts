import { Vec2 } from '../../utils/vectors';
import type { Path } from '../../core/types';

export interface OptimizationConfig {
  enabled: boolean;
  areaThreshold: number;
}

export interface OptimizationStats {
  pointsRemovedByVisvalingam: number;
  originalPointCount: number;
}

export const DEFAULT_OPTIMIZATION_CONFIG: OptimizationConfig = {
  enabled: true,
  areaThreshold: 1.0
};

// Scratch buffers reused across calls. Grown on demand, never shrunk
let _cap = 1024;
let _px = new Float64Array(_cap);
let _py = new Float64Array(_cap);
let _area = new Float64Array(_cap);
let _prev = new Int32Array(_cap);
let _next = new Int32Array(_cap);
let _heap = new Int32Array(_cap);
let _hpos = new Int32Array(_cap);

function ensureCap(n: number): void {
  if (n <= _cap) return;
  _cap = 1;
  while (_cap < n) _cap <<= 1;
  _px = new Float64Array(_cap);
  _py = new Float64Array(_cap);
  _area = new Float64Array(_cap);
  _prev = new Int32Array(_cap);
  _next = new Int32Array(_cap);
  _heap = new Int32Array(_cap);
  _hpos = new Int32Array(_cap);
}

export class PathOptimizer {
  private config: OptimizationConfig;
  private stats: OptimizationStats = {
    pointsRemovedByVisvalingam: 0,
    originalPointCount: 0
  };

  constructor(config: OptimizationConfig) {
    this.config = config;
  }

  public setConfig(config: OptimizationConfig) {
    this.config = config;
  }

  public optimizePath(path: Path): Path {
    const points = path.points;
    const n = points.length;

    if (n < 5 || !this.config.enabled) {
      if (this.config.enabled) this.stats.originalPointCount += n;
      return path;
    }

    this.stats.originalPointCount += n;

    const removed = simplifyVW(points, n, this.config.areaThreshold);
    if (removed === 0) return path;

    this.stats.pointsRemovedByVisvalingam += removed;

    const result = new Array<Vec2>(n - removed);
    let idx = 0;
    let out = 0;
    while (idx >= 0) {
      result[out++] = points[idx];
      idx = _next[idx];
    }

    return { ...path, points: result };
  }

  public getStats(): OptimizationStats {
    return { ...this.stats };
  }

  public resetStats(): void {
    this.stats = {
      pointsRemovedByVisvalingam: 0,
      originalPointCount: 0
    };
  }
}

// Visvalingam-Whyatt simplification. Iteratively removes the point
// whose removal causes the smallest change in contour area (measured
// as the triangle formed with its two neighbors) until all remaining
// triangles exceed areaThreshold
//
// Uses parallel typed arrays for the linked list and a binary min-heap
// with an index-based position map for O(log n) extract and update.
// Coordinates are flattened into Float64Array to keep area computation
// on contiguous memory. Areas are stored as 2x actual (skipping the
// shoelace /2) and the threshold is doubled to match
//
// Returns the number of points removed. The caller reads _next[] to
// walk the surviving linked list
function simplifyVW(
  points: Vec2[],
  n: number,
  areaThreshold: number
): number {
  if (n <= 3) return 0;

  ensureCap(n);

  const px = _px;
  const py = _py;
  const area = _area;
  const prev = _prev;
  const next = _next;
  const heap = _heap;
  const hpos = _hpos;

  // Flatten coordinates and initialize doubly-linked list
  for (let i = 0; i < n; i++) {
    const p = points[i];
    px[i] = p.x;
    py[i] = p.y;
    prev[i] = i - 1;
    next[i] = i + 1;
  }
  next[n - 1] = -1;

  // Compute triangle areas for interior points and seed the heap
  const heapLen0 = n - 2;
  area[0] = Infinity;
  area[n - 1] = Infinity;
  for (let i = 1; i < n - 1; i++) {
    area[i] = area2x(px, py, i - 1, i, i + 1);
    heap[i - 1] = i;
    hpos[i] = i - 1;
  }
  hpos[0] = -1;
  hpos[n - 1] = -1;

  // Bottom-up heapify, O(n)
  let heapLen = heapLen0;
  for (let i = (heapLen >> 1) - 1; i >= 0; i--) {
    siftDown(heap, hpos, area, i, heapLen);
  }

  const threshold2x = areaThreshold * 2;
  const maxRemovals = n - 3;
  let removed = 0;

  while (heapLen > 0 && removed < maxRemovals) {
    const minIdx = heap[0];
    if (area[minIdx] > threshold2x) break;

    // Extract min
    heapLen--;
    if (heapLen > 0) {
      const last = heap[heapLen];
      heap[0] = last;
      hpos[last] = 0;
      siftDown(heap, hpos, area, 0, heapLen);
    }
    hpos[minIdx] = -1;

    // Unlink
    const pi = prev[minIdx];
    const ni = next[minIdx];
    if (pi >= 0) next[pi] = ni;
    if (ni >= 0) prev[ni] = pi;
    removed++;

    // Recompute prev neighbor's area and update heap position
    if (pi >= 0 && prev[pi] >= 0) {
      const oldArea = area[pi];
      const newArea = area2x(px, py, prev[pi], pi, ni);
      area[pi] = newArea;
      const pos = hpos[pi];
      if (pos >= 0) {
        if (newArea < oldArea) siftUp(heap, hpos, area, pos);
        else if (newArea > oldArea) siftDown(heap, hpos, area, pos, heapLen);
      }
    }

    // Same for next neighbor
    if (ni >= 0 && next[ni] >= 0) {
      const oldArea = area[ni];
      const newArea = area2x(px, py, pi, ni, next[ni]);
      area[ni] = newArea;
      const pos = hpos[ni];
      if (pos >= 0) {
        if (newArea < oldArea) siftUp(heap, hpos, area, pos);
        else if (newArea > oldArea) siftDown(heap, hpos, area, pos, heapLen);
      }
    }
  }

  return removed;
}

function siftUp(
  heap: Int32Array,
  hpos: Int32Array,
  area: Float64Array,
  i: number
): void {
  const idx = heap[i];
  const val = area[idx];
  while (i > 0) {
    const parent = (i - 1) >> 1;
    const pidx = heap[parent];
    if (area[pidx] <= val) break;
    heap[i] = pidx;
    hpos[pidx] = i;
    i = parent;
  }
  heap[i] = idx;
  hpos[idx] = i;
}

function siftDown(
  heap: Int32Array,
  hpos: Int32Array,
  area: Float64Array,
  i: number,
  len: number
): void {
  const idx = heap[i];
  const val = area[idx];
  const half = len >> 1;
  while (i < half) {
    let child = (i << 1) + 1;
    let childIdx = heap[child];
    let childVal = area[childIdx];
    const right = child + 1;
    if (right < len) {
      const rIdx = heap[right];
      const rVal = area[rIdx];
      if (rVal < childVal) {
        child = right;
        childIdx = rIdx;
        childVal = rVal;
      }
    }
    if (childVal >= val) break;
    heap[i] = childIdx;
    hpos[childIdx] = i;
    i = child;
  }
  heap[i] = idx;
  hpos[idx] = i;
}

// Doubled triangle area via the shoelace formula. Skipping the /2
// means callers compare against a doubled threshold instead
function area2x(
  px: Float64Array,
  py: Float64Array,
  i1: number,
  i2: number,
  i3: number
): number {
  const v =
    px[i1] * (py[i2] - py[i3]) +
    px[i2] * (py[i3] - py[i1]) +
    px[i3] * (py[i1] - py[i2]);
  return v < 0 ? -v : v;
}
