import type { QuadCurve, SlugVec2 } from './types';

const DEFAULT_MAX_ERROR = 0.01;
const DEFAULT_MAX_DEPTH = 8;

function cloneVec2(p: SlugVec2): SlugVec2 {
  return [p[0], p[1]];
}

export function lineToQuadratic(p0: SlugVec2, p1: SlugVec2): QuadCurve {
  const mx = (p0[0] + p1[0]) * 0.5;
  const my = (p0[1] + p1[1]) * 0.5;
  return { p1: cloneVec2(p0), p2: [mx, my], p3: cloneVec2(p1) };
}

export function cubicToQuadratics(
  p0: SlugVec2,
  p1: SlugVec2,
  p2: SlugVec2,
  p3: SlugVec2,
  options?: { maxError?: number; maxDepth?: number }
): QuadCurve[] {
  const maxError = options?.maxError ?? DEFAULT_MAX_ERROR;
  const maxDepth = options?.maxDepth ?? DEFAULT_MAX_DEPTH;
  const out: QuadCurve[] = [];

  const recurse = (
    rp0: SlugVec2,
    rp1: SlugVec2,
    rp2: SlugVec2,
    rp3: SlugVec2,
    depth: number
  ): void => {
    // Error bound for best-fit quadratic approximation of this cubic:
    // |P3 - 3*P2 + 3*P1 - P0| / 6
    const dx = rp3[0] - 3 * rp2[0] + 3 * rp1[0] - rp0[0];
    const dy = rp3[1] - 3 * rp2[1] + 3 * rp1[1] - rp0[1];
    const err = dx * dx + dy * dy;
    const threshold = maxError * maxError * 36;

    if (err <= threshold || depth >= maxDepth) {
      const qx = (3 * (rp1[0] + rp2[0]) - rp0[0] - rp3[0]) * 0.25;
      const qy = (3 * (rp1[1] + rp2[1]) - rp0[1] - rp3[1]) * 0.25;
      out.push({ p1: cloneVec2(rp0), p2: [qx, qy], p3: cloneVec2(rp3) });
      return;
    }

    const m01x = (rp0[0] + rp1[0]) * 0.5, m01y = (rp0[1] + rp1[1]) * 0.5;
    const m12x = (rp1[0] + rp2[0]) * 0.5, m12y = (rp1[1] + rp2[1]) * 0.5;
    const m23x = (rp2[0] + rp3[0]) * 0.5, m23y = (rp2[1] + rp3[1]) * 0.5;
    const m012x = (m01x + m12x) * 0.5, m012y = (m01y + m12y) * 0.5;
    const m123x = (m12x + m23x) * 0.5, m123y = (m12y + m23y) * 0.5;
    const midx = (m012x + m123x) * 0.5, midy = (m012y + m123y) * 0.5;

    recurse(rp0, [m01x, m01y], [m012x, m012y], [midx, midy], depth + 1);
    recurse([midx, midy], [m123x, m123y], [m23x, m23y], rp3, depth + 1);
  };

  recurse(p0, p1, p2, p3, 0);
  return out;
}

