import { Cache } from '../../utils/Cache';
import type { GlyphData, GlyphContours, GlyphOutline } from '../types';

export function getGlyphCacheKey(
  fontId: string,
  glyphId: number,
  depth: number,
  removeOverlaps: boolean
): string {
  const roundedDepth = Math.round(depth * 1000) / 1000;
  return `${fontId}_${glyphId}_${roundedDepth}_${removeOverlaps}`;
}

export const globalGlyphCache = new Cache<string, GlyphData>();

export function createGlyphCache(): Cache<string, GlyphData> {
  return new Cache<string, GlyphData>();
}

export const globalContourCache = new Cache<string, GlyphContours>();

export const globalWordCache = new Cache<string, GlyphData>();

export const globalClusteringCache = new Cache<
  string,
  {
    glyphIds: number[];
    positions: { x: number; y: number }[];
    groups: number[][];
  }
>();

export const globalOutlineCache = new Cache<string, GlyphOutline>();
