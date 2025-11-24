import { Vec3 } from '../vectors';
import { ProcessedGeometry } from '../types';

const DEFAULT_CACHE_SIZE_MB = 250;

interface LRUNode {
  key: string;
  data: GlyphData;
  prev: LRUNode | null;
  next: LRUNode | null;
}

export interface GlyphData {
  geometry: ProcessedGeometry;
  vertices: Float32Array;
  normals: Float32Array;
  indices: Uint16Array | Uint32Array;
  bounds: {
    min: Vec3;
    max: Vec3;
  };
  useCount: number;
}

export interface GlyphInstance {
  glyphId: number;
  position: Vec3;
  scale: number;
  textIndex: number;
  lineIndex: number;
}

export interface GlyphCacheStats {
  hits: number;
  misses: number;
  totalGlyphs: number;
  uniqueGlyphs: number;
  cacheSize: number;
  saved: number;
  memoryUsage: number;
}

export class GlyphCache {
  private cache = new Map<string, LRUNode>();
  private head: LRUNode | null = null;
  private tail: LRUNode | null = null;

  private stats: GlyphCacheStats = {
    hits: 0,
    misses: 0,
    totalGlyphs: 0,
    uniqueGlyphs: 0,
    cacheSize: 0,
    saved: 0,
    memoryUsage: 0
  };

  private maxCacheSize?: number; // bytes

  constructor(maxCacheSizeMB?: number) {
    if (maxCacheSizeMB) {
      this.maxCacheSize = maxCacheSizeMB * 1024 * 1024;
    }
  }

  private getCacheKey(
    fontId: string,
    glyphId: number,
    depth: number,
    removeOverlaps: boolean
  ): string {
    // Round depth to avoid floating point precision issues
    const roundedDepth = Math.round(depth * 1000) / 1000;
    return `${fontId}_${glyphId}_${roundedDepth}_${removeOverlaps}`;
  }

  has(
    fontId: string,
    glyphId: number,
    depth: number,
    removeOverlaps: boolean
  ): boolean {
    const key = this.getCacheKey(fontId, glyphId, depth, removeOverlaps);
    return this.cache.has(key);
  }

  get(
    fontId: string,
    glyphId: number,
    depth: number,
    removeOverlaps: boolean
  ): GlyphData | undefined {
    const key = this.getCacheKey(fontId, glyphId, depth, removeOverlaps);
    const node = this.cache.get(key);

    if (node) {
      this.stats.hits++;
      this.stats.saved++;
      node.data.useCount++;
      // Move to head (most recently used)
      this.moveToHead(node);
      this.stats.totalGlyphs++;
      return node.data;
    } else {
      this.stats.misses++;
      this.stats.totalGlyphs++;
      return undefined;
    }
  }

  set(
    fontId: string,
    glyphId: number,
    depth: number,
    removeOverlaps: boolean,
    glyph: GlyphData
  ): void {
    const key = this.getCacheKey(fontId, glyphId, depth, removeOverlaps);
    const memoryUsage = this.calculateMemoryUsage(glyph);

    // LRU eviction when memory limit exceeded
    if (
      this.maxCacheSize &&
      this.stats.memoryUsage + memoryUsage > this.maxCacheSize
    ) {
      this.evictLRU(memoryUsage);
    }

    const node: LRUNode = {
      key,
      data: glyph,
      prev: null,
      next: null
    };

    this.cache.set(key, node);
    this.addToHead(node);
    this.stats.uniqueGlyphs = this.cache.size;
    this.stats.cacheSize++;
    this.stats.memoryUsage += memoryUsage;
  }

  private calculateMemoryUsage(glyph: GlyphData): number {
    let size = 0;

    // 3 floats per vertex * 4 bytes per float
    size += glyph.vertices.length * 4;

    // 3 floats per normal * 4 bytes per float
    size += glyph.normals.length * 4;

    // Indices (Uint16Array or Uint32Array)
    size += glyph.indices.length * glyph.indices.BYTES_PER_ELEMENT;

    // Bounds (2 Vec3s = 6 floats * 4 bytes)
    size += 24;

    // Object overhead
    size += 256;

    return size;
  }

  // LRU eviction
  private evictLRU(requiredSpace: number): void {
    let freedSpace = 0;

    while (this.tail && freedSpace < requiredSpace) {
      const memoryUsage = this.calculateMemoryUsage(this.tail.data);
      const nodeToRemove = this.tail;

      this.removeTail();
      this.cache.delete(nodeToRemove.key);

      this.stats.memoryUsage -= memoryUsage;
      this.stats.cacheSize--;
      freedSpace += memoryUsage;
    }
  }

  private addToHead(node: LRUNode): void {
    if (!this.head) {
      this.head = this.tail = node;
    } else {
      node.next = this.head;
      this.head.prev = node;
      this.head = node;
    }
  }

  private removeNode(node: LRUNode): void {
    if (node.prev) {
      node.prev.next = node.next;
    } else {
      this.head = node.next;
    }

    if (node.next) {
      node.next.prev = node.prev;
    } else {
      this.tail = node.prev;
    }
  }

  private removeTail(): void {
    if (this.tail) {
      this.removeNode(this.tail);
    }
  }

  private moveToHead(node: LRUNode): void {
    if (node === this.head) return;

    this.removeNode(node);
    this.addToHead(node);
  }

  clear(): void {
    this.cache.clear();
    this.head = null;
    this.tail = null;
    this.stats = {
      hits: 0,
      misses: 0,
      totalGlyphs: 0,
      uniqueGlyphs: 0,
      cacheSize: 0,
      saved: 0,
      memoryUsage: 0
    };
  }

  getStats(): GlyphCacheStats {
    const hitRate =
      this.stats.totalGlyphs > 0
        ? (this.stats.hits / this.stats.totalGlyphs) * 100
        : 0;

    this.stats.uniqueGlyphs = this.cache.size;

    return {
      ...this.stats,
      hitRate,
      memoryUsageMB: this.stats.memoryUsage / (1024 * 1024)
    } as GlyphCacheStats & { hitRate: number; memoryUsageMB: number };
  }
}

export const globalGlyphCache = new GlyphCache(DEFAULT_CACHE_SIZE_MB);
