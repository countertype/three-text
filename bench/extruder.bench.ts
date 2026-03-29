import { describe, bench } from 'vitest';
import { Tessellator } from '../src/mesh/geometry/Tessellator';
import { Extruder } from '../src/mesh/geometry/Extruder';
import { Vec2 } from '../src/core/vectors';
import type { Path } from '../src/core/types';

function pathFromXY(points: Array<[number, number]>, glyphIndex: number): Path {
  return {
    glyphIndex,
    points: points.map(([x, y]) => new Vec2(x, y))
  };
}

function regularPolygonXY(
  sides: number,
  radius: number,
  cx: number,
  cy: number,
  clockwise: boolean
): Array<[number, number]> {
  const points: Array<[number, number]> = new Array(sides);
  for (let i = 0; i < sides; i++) {
    const t = (i / sides) * Math.PI * 2;
    const a = clockwise ? -t : t;
    points[i] = [cx + Math.cos(a) * radius, cy + Math.sin(a) * radius];
  }
  return points;
}

const squareCW = pathFromXY(
  [
    [0, 0],
    [0, 100],
    [100, 100],
    [100, 0]
  ],
  0
);

const holeCCW = pathFromXY(
  [
    [25, 25],
    [75, 25],
    [75, 75],
    [25, 75]
  ],
  0
);

const tessellator = new Tessellator();
const processed = tessellator.process([squareCW, holeCCW], true, false);

const ringOuter = pathFromXY(regularPolygonXY(128, 100, 0, 0, true), 0);
const ringHole = pathFromXY(regularPolygonXY(64, 50, 0, 0, false), 0);
const processedRing = tessellator.process([ringOuter, ringHole], true, false);

const extruder = new Extruder();
const unitsPerEm = 1000;

describe('Extruder performance', () => {
  bench('extrude depth:0 square+hole', () => {
    extruder.extrude(processed, 0, unitsPerEm);
  });

  bench('extrude depth:7 square+hole', () => {
    extruder.extrude(processed, 7, unitsPerEm);
  });

  bench('extrude depth:0 ring(128)', () => {
    extruder.extrude(processedRing, 0, unitsPerEm);
  });

  bench('extrude depth:7 ring(128)', () => {
    extruder.extrude(processedRing, 7, unitsPerEm);
  });
});
