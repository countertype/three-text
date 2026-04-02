import { describe, bench } from 'vitest';
import {
  Polygonizer,
  DEFAULT_CURVE_FIDELITY
} from '../src/mesh/geometry/Polygonizer';
import { Vec2 } from '../src/core/vectors';

describe('Polygonizer performance', () => {
  const polygonizer = new Polygonizer(DEFAULT_CURVE_FIDELITY);

  const quadraticCurves = [
    {
      start: new Vec2(0, 0),
      control: new Vec2(50, 100),
      end: new Vec2(100, 0)
    },
    {
      start: new Vec2(0, 0),
      control: new Vec2(10, 100),
      end: new Vec2(100, 0)
    },
    { start: new Vec2(0, 0), control: new Vec2(50, 10), end: new Vec2(100, 0) },
    {
      start: new Vec2(0, 0),
      control: new Vec2(500, 1000),
      end: new Vec2(1000, 0)
    }
  ];

  const cubicCurves = [
    {
      start: new Vec2(0, 0),
      control1: new Vec2(33, 100),
      control2: new Vec2(67, -100),
      end: new Vec2(100, 0)
    },
    {
      start: new Vec2(0, 0),
      control1: new Vec2(10, 100),
      control2: new Vec2(90, 100),
      end: new Vec2(100, 0)
    },
    {
      start: new Vec2(0, 0),
      control1: new Vec2(30, 10),
      control2: new Vec2(70, 10),
      end: new Vec2(100, 0)
    },
    {
      start: new Vec2(0, 0),
      control1: new Vec2(333, 1000),
      control2: new Vec2(667, -1000),
      end: new Vec2(1000, 0)
    }
  ];

  bench('polygonizeQuadratic - batch(100)', () => {
    for (let i = 0; i < 100; i++) {
      const c = quadraticCurves[i & 3];
      polygonizer.polygonizeQuadratic(c.start, c.control, c.end);
    }
  });

  bench('polygonizeCubic - batch(100)', () => {
    for (let i = 0; i < 100; i++) {
      const c = cubicCurves[i & 3];
      polygonizer.polygonizeCubic(c.start, c.control1, c.control2, c.end);
    }
  });

  bench('mixed curves - typical glyph(20)', () => {
    for (let i = 0; i < 10; i++) {
      const q = quadraticCurves[i & 3];
      polygonizer.polygonizeQuadratic(q.start, q.control, q.end);
    }
    for (let i = 0; i < 10; i++) {
      const c = cubicCurves[i & 3];
      polygonizer.polygonizeCubic(c.start, c.control1, c.control2, c.end);
    }
  });
});
