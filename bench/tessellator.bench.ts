import { describe, bench } from 'vitest';
import { Tessellator } from '../src/mesh/geometry/Tessellator';
import { Vec2 } from '../src/core/vectors';
import type { Path } from '../src/core/types';

function pathFromXY(points: Array<[number, number]>, glyphIndex: number): Path {
  return {
    glyphIndex,
    points: points.map(([x, y]) => new Vec2(x, y))
  };
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

const multiContours: Path[] = [
  pathFromXY(
    [
      [0, 0],
      [0, 40],
      [40, 40],
      [40, 0]
    ],
    0
  ),
  pathFromXY(
    [
      [60, 0],
      [60, 40],
      [100, 40],
      [100, 0]
    ],
    0
  ),
  pathFromXY(
    [
      [0, 60],
      [0, 100],
      [40, 100],
      [40, 60]
    ],
    0
  ),
  pathFromXY(
    [
      [60, 60],
      [60, 100],
      [100, 100],
      [100, 60]
    ],
    0
  ),
  pathFromXY(
    [
      [120, 0],
      [120, 100],
      [160, 100],
      [160, 0]
    ],
    0
  )
];

const tessellator = new Tessellator();

describe('Tessellator performance', () => {
  bench('process ttf removeOverlaps:false square', () => {
    tessellator.process([squareCW], false, false);
  });

  bench('process ttf removeOverlaps:false square+hole', () => {
    tessellator.process([squareCW, holeCCW], false, false);
  });

  bench('process ttf removeOverlaps:false multi(5)', () => {
    tessellator.process(multiContours, false, false);
  });

  bench('process ttf removeOverlaps:true square+hole', () => {
    tessellator.process([squareCW, holeCCW], true, false);
  });

  bench('process cff removeOverlaps:false square+hole', () => {
    tessellator.process([squareCW, holeCCW], false, true);
  });
});
