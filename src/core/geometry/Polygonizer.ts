/**
 * @license
 * Anti-Grain Geometry - Version 2.4
 * Copyright (C) 2002-2005 Maxim Shemanarev (McSeem)
 *
 * This software is a partial port of the AGG library, specifically the adaptive
 * subdivision algorithm for polygonization. The original software was available
 * at http://www.antigrain.com and was distributed under the BSD 3-Clause License
 *
 * Redistribution and use in source and binary forms, with or without
 * modification, are permitted provided that the following conditions
 * are met:
 *
 * 1. Redistributions of source code must retain the above copyright
 *    notice, this list of conditions and the following disclaimer.
 *
 * 2. Redistributions in binary form must reproduce the above copyright
 *    notice, this list of conditions and the following disclaimer in
 *    the documentation and/or other materials provided with the
 *    distribution.
 *
 * 3. The name of the author may not be used to endorse or promote
 *    products derived from this software without specific prior
 *    written permission.
 *
 * THIS SOFTWARE IS PROVIDED BY THE AUTHOR ``AS IS'' AND ANY EXPRESS OR
 * IMPLIED WARRANTIES, INCLUDING, BUT NOT LIMITED TO, THE IMPLIED
 * WARRANTIES OF MERCHANTABILITY AND FITNESS FOR A PARTICULAR PURPOSE
 * ARE DISCLAIMED. IN NO EVENT SHALL THE AUTHOR BE LIABLE FOR ANY DIRECT,
 * INDIRECT, INCIDENTAL, SPECIAL, EXEMPLARY, OR CONSEQUENTIAL DAMAGES
 * (INCLUDING, BUT NOT LIMITED TO, PROCUREMENT OF SUBSTITUTE GOODS OR
 * SERVICES; LOSS OF USE, DATA, OR PROFITS; OR BUSINESS INTERRUPTION)
 * HOWEVER CAUSED AND ON ANY THEORY OF LIABILITY, WHETHER IN CONTRACT,
 * STRICT LIABILITY, OR TORT (INCLUDING NEGLIGENCE OR OTHERWISE) ARISING
 * IN ANY WAY OUT OF THE USE OF THIS SOFTWARE, EVEN IF ADVISED OF THE
 * POSSIBILITY OF SUCH DAMAGE.
 */

import { Vec2 } from '../vectors';
import { CurveFidelityConfig } from '../types';

export const DEFAULT_CURVE_FIDELITY: CurveFidelityConfig = {
  distanceTolerance: 0.5,
  angleTolerance: 0.2 // ~11.5 degrees
};

export const COLLINEARITY_EPSILON = 1e-6;
const RECURSION_LIMIT = 16;

export class Polygonizer {
  private curveFidelityConfig: CurveFidelityConfig;

  constructor(curveFidelityConfig?: CurveFidelityConfig) {
    this.curveFidelityConfig = {
      ...DEFAULT_CURVE_FIDELITY,
      ...curveFidelityConfig
    };
  }

  public setCurveFidelityConfig(curveFidelityConfig?: CurveFidelityConfig) {
    this.curveFidelityConfig = {
      ...DEFAULT_CURVE_FIDELITY,
      ...curveFidelityConfig
    };
  }

  public polygonizeQuadratic(
    start: Vec2,
    control: Vec2,
    end: Vec2
  ): Vec2[] {
    const points: Vec2[] = [];
    this.recursiveQuadratic(
      start.x,
      start.y,
      control.x,
      control.y,
      end.x,
      end.y,
      points
    );
    this.addPoint(end.x, end.y, points);
    return points;
  }

  public polygonizeCubic(
    start: Vec2,
    control1: Vec2,
    control2: Vec2,
    end: Vec2
  ): Vec2[] {
    const points: Vec2[] = [];
    this.recursiveCubic(
      start.x,
      start.y,
      control1.x,
      control1.y,
      control2.x,
      control2.y,
      end.x,
      end.y,
      points
    );
    this.addPoint(end.x, end.y, points);
    return points;
  }

  private recursiveQuadratic(
    x1: number,
    y1: number,
    x2: number,
    y2: number,
    x3: number,
    y3: number,
    points: Vec2[],
    level: number = 0
  ) {
    if (level > RECURSION_LIMIT) return;

    // De Casteljau subdivision: split the curve at t=0.5
    // First calculate midpoints of the two line segments
    const x12 = (x1 + x2) / 2;
    const y12 = (y1 + y2) / 2;
    const x23 = (x2 + x3) / 2;
    const y23 = (y2 + y3) / 2;
    // Then find the midpoint of those midpoints - this is the curve point at t=0.5
    const x123 = (x12 + x23) / 2;
    const y123 = (y12 + y23) / 2;

    const dx = x3 - x1;
    const dy = y3 - y1;
    const d = Math.abs((x2 - x3) * dy - (y2 - y3) * dx);

    const baseTolerance =
      this.curveFidelityConfig.distanceTolerance ??
      DEFAULT_CURVE_FIDELITY.distanceTolerance!;
    const distanceTolerance = baseTolerance * baseTolerance;

    if (d > COLLINEARITY_EPSILON) {
      // Regular case
      // Recursion terminates when the curve is flat enough (deviation from straight line is within tolerance)
      if (d * d <= distanceTolerance * (dx * dx + dy * dy)) {
        // Angle check
        const angleTolerance =
          this.curveFidelityConfig.angleTolerance ??
          DEFAULT_CURVE_FIDELITY.angleTolerance!;
        if (angleTolerance > 0) {
          let da = Math.abs(
            Math.atan2(y3 - y2, x3 - x2) - Math.atan2(y2 - y1, x2 - x1)
          );
          if (da >= Math.PI) da = 2 * Math.PI - da;

          if (da < angleTolerance) {
            this.addPoint(x2, y2, points);
            return;
          }
        } else {
          this.addPoint(x2, y2, points);
          return;
        }
      }
    } else {
      // Collinear case
      const da = dx * dx + dy * dy;
      if (da === 0) {
        const d2 = (x2 - x1) * (x2 - x1) + (y2 - y1) * (y2 - y1);
        if (d2 <= distanceTolerance) {
          this.addPoint(x2, y2, points);
          return;
        }
      } else {
        const d2 = ((x2 - x1) * dx + (y2 - y1) * dy) / da;
        if (d2 > 0 && d2 < 1 && d * d <= distanceTolerance * da) {
          this.addPoint(x2, y2, points);
          return;
        }
      }
    }

    // Continue subdividing
    this.recursiveQuadratic(x1, y1, x12, y12, x123, y123, points, level + 1);
    this.recursiveQuadratic(x123, y123, x23, y23, x3, y3, points, level + 1);
  }

  private recursiveCubic(
    x1: number,
    y1: number,
    x2: number,
    y2: number,
    x3: number,
    y3: number,
    x4: number,
    y4: number,
    points: Vec2[],
    level: number = 0
  ) {
    if (level > RECURSION_LIMIT) return;

    // De Casteljau subdivision for cubic curves
    const x12 = (x1 + x2) / 2;
    const y12 = (y1 + y2) / 2;
    const x23 = (x2 + x3) / 2;
    const y23 = (y2 + y3) / 2;
    const x34 = (x3 + x4) / 2;
    const y34 = (y3 + y4) / 2;
    const x123 = (x12 + x23) / 2;
    const y123 = (y12 + y23) / 2;
    const x234 = (x23 + x34) / 2;
    const y234 = (y23 + y34) / 2;
    const x1234 = (x123 + x234) / 2;
    const y1234 = (y123 + y234) / 2;

    const dx = x4 - x1;
    const dy = y4 - y1;

    const d2 = Math.abs((x2 - x4) * dy - (y2 - y4) * dx);
    const d3 = Math.abs((x3 - x4) * dy - (y3 - y4) * dx);

    const baseTolerance =
      this.curveFidelityConfig.distanceTolerance ??
      DEFAULT_CURVE_FIDELITY.distanceTolerance!;
    const distanceTolerance = baseTolerance * baseTolerance;

    let switchCondition = 0;

    if (d2 > COLLINEARITY_EPSILON) switchCondition |= 1;
    if (d3 > COLLINEARITY_EPSILON) switchCondition |= 2;

    switch (switchCondition) {
      case 0:
        // All collinear OR p1==p4
        const k = dx * dx + dy * dy;
        if (k === 0) {
          const d2_sq = (x2 - x1) * (x2 - x1) + (y2 - y1) * (y2 - y1);
          const d3_sq = (x3 - x1) * (x3 - x1) + (y3 - y1) * (y3 - y1);
          if (d2_sq <= distanceTolerance && d3_sq <= distanceTolerance) {
            this.addPoint(x2, y2, points);
            this.addPoint(x3, y3, points);
            return;
          }
        } else {
          const da1 = ((x2 - x1) * dx + (y2 - y1) * dy) / k;
          const da2 = ((x3 - x1) * dx + (y3 - y1) * dy) / k;
          if (
            da1 > 0 &&
            da1 < 1 &&
            da2 > 0 &&
            da2 < 1 &&
            (d2 + d3) * (d2 + d3) <= distanceTolerance * k
          ) {
            this.addPoint(x2, y2, points);
            this.addPoint(x3, y3, points);
            return;
          }
        }
        break;

      case 1:
        // p1,p2,p4 are collinear, p3 is not
        if (d3 * d3 <= distanceTolerance * (dx * dx + dy * dy)) {
          const angleTolerance =
            this.curveFidelityConfig.angleTolerance ??
            DEFAULT_CURVE_FIDELITY.angleTolerance!;
          if (angleTolerance > 0) {
            let da1 = Math.abs(
              Math.atan2(y4 - y3, x4 - x3) - Math.atan2(y3 - y2, x3 - x2)
            );
            if (da1 >= Math.PI) da1 = 2 * Math.PI - da1;

            if (da1 < angleTolerance) {
              this.addPoint(x2, y2, points);
              this.addPoint(x3, y3, points);
              return;
            }
          } else {
            this.addPoint(x2, y2, points);
            this.addPoint(x3, y3, points);
            return;
          }
        }
        break;

      case 2:
        // p1,p3,p4 are collinear, p2 is not
        if (d2 * d2 <= distanceTolerance * (dx * dx + dy * dy)) {
          const angleTolerance =
            this.curveFidelityConfig.angleTolerance ??
            DEFAULT_CURVE_FIDELITY.angleTolerance!;
          if (angleTolerance > 0) {
            let da1 = Math.abs(
              Math.atan2(y3 - y2, x3 - x2) - Math.atan2(y2 - y1, x2 - x1)
            );
            if (da1 >= Math.PI) da1 = 2 * Math.PI - da1;

            if (da1 < angleTolerance) {
              this.addPoint(x2, y2, points);
              this.addPoint(x3, y3, points);
              return;
            }
          } else {
            this.addPoint(x2, y2, points);
            this.addPoint(x3, y3, points);
            return;
          }
        }
        break;

      case 3:
        // Regular case
        if ((d2 + d3) * (d2 + d3) <= distanceTolerance * (dx * dx + dy * dy)) {
          const angleTolerance =
            this.curveFidelityConfig.angleTolerance ??
            DEFAULT_CURVE_FIDELITY.angleTolerance!;
          if (angleTolerance > 0) {
            let da1 = Math.abs(
              Math.atan2(y3 - y2, x3 - x2) - Math.atan2(y2 - y1, x2 - x1)
            );
            let da2 = Math.abs(
              Math.atan2(y4 - y3, x4 - x3) - Math.atan2(y3 - y2, x3 - x2)
            );
            if (da1 >= Math.PI) da1 = 2 * Math.PI - da1;
            if (da2 >= Math.PI) da2 = 2 * Math.PI - da2;

            if (da1 + da2 < angleTolerance) {
              this.addPoint(x2, y2, points);
              this.addPoint(x3, y3, points);
              return;
            }
          } else {
            this.addPoint(x2, y2, points);
            this.addPoint(x3, y3, points);
            return;
          }
        }
        break;
    }

    // Continue subdividing
    this.recursiveCubic(
      x1,
      y1,
      x12,
      y12,
      x123,
      y123,
      x1234,
      y1234,
      points,
      level + 1
    );
    this.recursiveCubic(
      x1234,
      y1234,
      x234,
      y234,
      x34,
      y34,
      x4,
      y4,
      points,
      level + 1
    );
  }

  private addPoint(x: number, y: number, points: Vec2[]) {
    const newPoint = new Vec2(x, y);

    if (points.length === 0) {
      points.push(newPoint);
      return;
    }

    const lastPoint = points[points.length - 1];
    const dx = newPoint.x - lastPoint.x;
    const dy = newPoint.y - lastPoint.y;
    const distanceSquared = dx * dx + dy * dy;

    if (distanceSquared > COLLINEARITY_EPSILON * COLLINEARITY_EPSILON) {
      points.push(newPoint);
    }
  }
}
