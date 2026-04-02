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

import { Vec2 } from '../../utils/vectors';
import { CurveFidelityConfig } from '../../core/types';

export const DEFAULT_CURVE_FIDELITY: CurveFidelityConfig = {
  distanceTolerance: 0.5,
  angleTolerance: 0.2,
  cuspLimit: 0,
  collinearityEpsilon: 1e-6,
  recursionLimit: 16
};

export const COLLINEARITY_EPSILON =
  DEFAULT_CURVE_FIDELITY.collinearityEpsilon!;

// Module-level state for the recursive subdivision functions,
// set from instance config before each polygonize call

// Output array, reset before each polygonize call
let _out: Vec2[];

// Cached tolerance state
let _distTolSq = 0;
let _colEps = 0;
let _maxLvl = 0;
let _angleTol = 0;
let _tanAngSq = 0;
let _cuspLim = 0;
let _tanCuspSq = 0;

// Collinearity checks in the recursive core prevent near-duplicate points
function emit(x: number, y: number): void {
  _out.push(new Vec2(x, y));
}

// Quadratic recursive subdivision (AGG curve3_div)
function quadRec(
  x1: number, y1: number,
  x2: number, y2: number,
  x3: number, y3: number,
  level: number
): void {
  if (level > _maxLvl) return;

  const x12 = (x1 + x2) * 0.5;
  const y12 = (y1 + y2) * 0.5;
  const x23 = (x2 + x3) * 0.5;
  const y23 = (y2 + y3) * 0.5;
  const x123 = (x12 + x23) * 0.5;
  const y123 = (y12 + y23) * 0.5;

  const dx = x3 - x1;
  const dy = y3 - y1;
  let d = Math.abs((x2 - x3) * dy - (y2 - y3) * dx);

  if (d > _colEps) {
    if (d * d <= _distTolSq * (dx * dx + dy * dy)) {
      if (_angleTol > 0) {
        const v1x = x2 - x1;
        const v1y = y2 - y1;
        const v2x = x3 - x2;
        const v2y = y3 - y2;
        const cross = v1x * v2y - v1y * v2x;
        const dot = v1x * v2x + v1y * v2y;
        if (dot > 0 && cross * cross < _tanAngSq * dot * dot) {
          emit(x123, y123);
          return;
        }
      } else {
        emit(x123, y123);
        return;
      }
    }
  } else {
    let da = dx * dx + dy * dy;
    if (da === 0) {
      d = (x2 - x1) * (x2 - x1) + (y2 - y1) * (y2 - y1);
    } else {
      d = ((x2 - x1) * dx + (y2 - y1) * dy) / da;
      if (d > 0 && d < 1) return;
      if (d <= 0) d = (x2 - x1) * (x2 - x1) + (y2 - y1) * (y2 - y1);
      else if (d >= 1) d = (x2 - x3) * (x2 - x3) + (y2 - y3) * (y2 - y3);
      else {
        const px = x1 + d * dx;
        const py = y1 + d * dy;
        d = (x2 - px) * (x2 - px) + (y2 - py) * (y2 - py);
      }
    }
    if (d < _distTolSq) {
      emit(x2, y2);
      return;
    }
  }

  const nl = level + 1;
  quadRec(x1, y1, x12, y12, x123, y123, nl);
  quadRec(x123, y123, x23, y23, x3, y3, nl);
}

// Cubic recursive subdivision (AGG curve4_div)
// cubicBegin handles level 0, which always subdivides
function cubicBegin(
  x1: number, y1: number,
  x2: number, y2: number,
  x3: number, y3: number,
  x4: number, y4: number
): void {
  const x12 = (x1 + x2) * 0.5;
  const y12 = (y1 + y2) * 0.5;
  const x23 = (x2 + x3) * 0.5;
  const y23 = (y2 + y3) * 0.5;
  const x34 = (x3 + x4) * 0.5;
  const y34 = (y3 + y4) * 0.5;
  const x123 = (x12 + x23) * 0.5;
  const y123 = (y12 + y23) * 0.5;
  const x234 = (x23 + x34) * 0.5;
  const y234 = (y23 + y34) * 0.5;
  const x1234 = (x123 + x234) * 0.5;
  const y1234 = (y123 + y234) * 0.5;
  cubicRec(x1, y1, x12, y12, x123, y123, x1234, y1234, 1);
  cubicRec(x1234, y1234, x234, y234, x34, y34, x4, y4, 1);
}

function cubicRec(
  x1: number, y1: number,
  x2: number, y2: number,
  x3: number, y3: number,
  x4: number, y4: number,
  level: number
): void {
  if (level > _maxLvl) return;

  const x12 = (x1 + x2) * 0.5;
  const y12 = (y1 + y2) * 0.5;
  const x23 = (x2 + x3) * 0.5;
  const y23 = (y2 + y3) * 0.5;
  const x34 = (x3 + x4) * 0.5;
  const y34 = (y3 + y4) * 0.5;
  const x123 = (x12 + x23) * 0.5;
  const y123 = (y12 + y23) * 0.5;
  const x234 = (x23 + x34) * 0.5;
  const y234 = (y23 + y34) * 0.5;
  const x1234 = (x123 + x234) * 0.5;
  const y1234 = (y123 + y234) * 0.5;

  const dx = x4 - x1;
  const dy = y4 - y1;
  let d2 = Math.abs((x2 - x4) * dy - (y2 - y4) * dx);
  let d3 = Math.abs((x3 - x4) * dy - (y3 - y4) * dx);

  const sc = (d2 > _colEps ? 2 : 0) + (d3 > _colEps ? 1 : 0);

  switch (sc) {
    case 0: {
      let k = dx * dx + dy * dy;
      if (k === 0) {
        d2 = (x2 - x1) * (x2 - x1) + (y2 - y1) * (y2 - y1);
        d3 = (x3 - x1) * (x3 - x1) + (y3 - y1) * (y3 - y1);
      } else {
        k = 1 / k;
        let t1 = x2 - x1;
        let t2 = y2 - y1;
        d2 = k * (t1 * dx + t2 * dy);
        t1 = x3 - x1;
        t2 = y3 - y1;
        d3 = k * (t1 * dx + t2 * dy);
        if (d2 > 0 && d2 < 1 && d3 > 0 && d3 < 1) return;
        if (d2 <= 0) d2 = (x2 - x1) * (x2 - x1) + (y2 - y1) * (y2 - y1);
        else if (d2 >= 1) d2 = (x2 - x4) * (x2 - x4) + (y2 - y4) * (y2 - y4);
        else {
          const px = x1 + d2 * dx, py = y1 + d2 * dy;
          d2 = (x2 - px) * (x2 - px) + (y2 - py) * (y2 - py);
        }
        if (d3 <= 0) d3 = (x3 - x1) * (x3 - x1) + (y3 - y1) * (y3 - y1);
        else if (d3 >= 1) d3 = (x3 - x4) * (x3 - x4) + (y3 - y4) * (y3 - y4);
        else {
          const px = x1 + d3 * dx, py = y1 + d3 * dy;
          d3 = (x3 - px) * (x3 - px) + (y3 - py) * (y3 - py);
        }
      }
      if (d2 > d3) {
        if (d2 < _distTolSq) { emit(x2, y2); return; }
      } else {
        if (d3 < _distTolSq) { emit(x3, y3); return; }
      }
      break;
    }

    case 1:
      if (d3 * d3 <= _distTolSq * (dx * dx + dy * dy)) {
        if (_angleTol > 0) {
          const v1x = x3 - x2, v1y = y3 - y2;
          const v2x = x4 - x3, v2y = y4 - y3;
          const cross = v1x * v2y - v1y * v2x;
          const dot = v1x * v2x + v1y * v2y;
          if (dot > 0 && cross * cross < _tanAngSq * dot * dot) {
            emit(x2, y2); emit(x3, y3); return;
          }
          if (_cuspLim > 0 &&
              (dot <= 0 || cross * cross > _tanCuspSq * dot * dot)) {
            emit(x3, y3); return;
          }
        } else {
          emit(x23, y23); return;
        }
      }
      break;

    case 2:
      if (d2 * d2 <= _distTolSq * (dx * dx + dy * dy)) {
        if (_angleTol > 0) {
          const v1x = x2 - x1, v1y = y2 - y1;
          const v2x = x3 - x2, v2y = y3 - y2;
          const cross = v1x * v2y - v1y * v2x;
          const dot = v1x * v2x + v1y * v2y;
          if (dot > 0 && cross * cross < _tanAngSq * dot * dot) {
            emit(x2, y2); emit(x3, y3); return;
          }
          if (_cuspLim > 0 &&
              (dot <= 0 || cross * cross > _tanCuspSq * dot * dot)) {
            emit(x2, y2); return;
          }
        } else {
          emit(x23, y23); return;
        }
      }
      break;

    case 3: {
      if ((d2 + d3) * (d2 + d3) <= _distTolSq * (dx * dx + dy * dy)) {
        if (_angleTol > 0) {
          const a1x = x2 - x1, a1y = y2 - y1;
          const a2x = x3 - x2, a2y = y3 - y2;
          const c1 = a1x * a2y - a1y * a2x;
          const dot1 = a1x * a2x + a1y * a2y;
          const b2x = x4 - x3, b2y = y4 - y3;
          const c2 = a2x * b2y - a2y * b2x;
          const dot2 = a2x * b2x + a2y * b2y;

          // Sum of unsigned angles via tangent addition identity
          if (dot1 > 0 && dot2 > 0) {
            const ac1 = c1 < 0 ? -c1 : c1;
            const ac2 = c2 < 0 ? -c2 : c2;
            const cc = ac1 * dot2 + ac2 * dot1;
            const cd = dot1 * dot2 - ac1 * ac2;
            if (cd > 0 && cc * cc < _tanAngSq * cd * cd) {
              emit(x23, y23); return;
            }
          }

          if (_cuspLim > 0) {
            if (dot1 <= 0 || c1 * c1 > _tanCuspSq * dot1 * dot1) {
              emit(x2, y2); return;
            }
            if (dot2 <= 0 || c2 * c2 > _tanCuspSq * dot2 * dot2) {
              emit(x3, y3); return;
            }
          }
        } else {
          emit(x23, y23); return;
        }
      }
      break;
    }
  }

  const nl = level + 1;
  cubicRec(x1, y1, x12, y12, x123, y123, x1234, y1234, nl);
  cubicRec(x1234, y1234, x234, y234, x34, y34, x4, y4, nl);
}

export class Polygonizer {
  private curveFidelityConfig: CurveFidelityConfig;
  private curveSteps: number | null = null;

  // Precomputed tolerances
  private _distTolSq: number = 0;
  private _angleTol: number = 0;
  private _tanAngSq: number = 0;
  private _cuspLim: number = 0;
  private _tanCuspSq: number = 0;
  private _colEps: number = 0;
  private _maxLvl: number = 0;

  constructor(curveFidelityConfig?: CurveFidelityConfig) {
    this.curveFidelityConfig = {
      ...DEFAULT_CURVE_FIDELITY,
      ...curveFidelityConfig
    };
    this.precompute();
  }

  public setCurveFidelityConfig(curveFidelityConfig?: CurveFidelityConfig) {
    this.curveFidelityConfig = {
      ...DEFAULT_CURVE_FIDELITY,
      ...curveFidelityConfig
    };
    this.precompute();
  }

  private precompute() {
    const c = this.curveFidelityConfig;
    const dt = c.distanceTolerance ?? DEFAULT_CURVE_FIDELITY.distanceTolerance!;
    this._distTolSq = dt * dt;
    this._angleTol = c.angleTolerance ?? DEFAULT_CURVE_FIDELITY.angleTolerance!;
    this._tanAngSq = this._angleTol > 0
      ? Math.tan(this._angleTol) ** 2 : 0;
    this._cuspLim = c.cuspLimit ?? 0;
    this._tanCuspSq = this._cuspLim > 0
      ? Math.tan(this._cuspLim) ** 2 : 0;
    this._colEps = c.collinearityEpsilon ?? DEFAULT_CURVE_FIDELITY.collinearityEpsilon!;
    this._maxLvl = c.recursionLimit ?? DEFAULT_CURVE_FIDELITY.recursionLimit!;
  }

  // Set module-level state from instance tolerances
  private activate(): void {
    _distTolSq = this._distTolSq;
    _angleTol = this._angleTol;
    _tanAngSq = this._tanAngSq;
    _cuspLim = this._cuspLim;
    _tanCuspSq = this._tanCuspSq;
    _colEps = this._colEps;
    _maxLvl = this._maxLvl;
    _out = [];
  }

  // Fixed-step subdivision; overrides adaptive curveFidelity when set
  public setCurveSteps(curveSteps?: number) {
    if (curveSteps === undefined || curveSteps === null) {
      this.curveSteps = null;
      return;
    }
    if (!Number.isFinite(curveSteps)) {
      this.curveSteps = null;
      return;
    }
    const stepsInt = Math.round(curveSteps);
    this.curveSteps = stepsInt >= 1 ? stepsInt : null;
  }

  public polygonizeQuadratic(start: Vec2, control: Vec2, end: Vec2): Vec2[] {
    if (this.curveSteps !== null) {
      return this.polygonizeQuadraticFixedSteps(
        start, control, end, this.curveSteps
      );
    }

    this.activate();
    quadRec(start.x, start.y, control.x, control.y, end.x, end.y, 0);
    emit(end.x, end.y);
    return _out;
  }

  public polygonizeCubic(
    start: Vec2, control1: Vec2, control2: Vec2, end: Vec2
  ): Vec2[] {
    if (this.curveSteps !== null) {
      return this.polygonizeCubicFixedSteps(
        start, control1, control2, end, this.curveSteps
      );
    }

    this.activate();
    cubicBegin(
      start.x, start.y, control1.x, control1.y,
      control2.x, control2.y, end.x, end.y
    );
    emit(end.x, end.y);
    return _out;
  }

  private polygonizeQuadraticFixedSteps(
    start: Vec2, control: Vec2, end: Vec2, steps: number
  ): Vec2[] {
    this.activate();
    for (let i = 1; i <= steps; i++) {
      const t = i / steps;
      const x12 = start.x + (control.x - start.x) * t;
      const y12 = start.y + (control.y - start.y) * t;
      const x23 = control.x + (end.x - control.x) * t;
      const y23 = control.y + (end.y - control.y) * t;
      emit(x12 + (x23 - x12) * t, y12 + (y23 - y12) * t);
    }
    return _out;
  }

  private polygonizeCubicFixedSteps(
    start: Vec2, control1: Vec2, control2: Vec2, end: Vec2, steps: number
  ): Vec2[] {
    this.activate();
    for (let i = 1; i <= steps; i++) {
      const t = i / steps;
      const x12 = start.x + (control1.x - start.x) * t;
      const y12 = start.y + (control1.y - start.y) * t;
      const x23 = control1.x + (control2.x - control1.x) * t;
      const y23 = control1.y + (control2.y - control1.y) * t;
      const x34 = control2.x + (end.x - control2.x) * t;
      const y34 = control2.y + (end.y - control2.y) * t;
      const x123 = x12 + (x23 - x12) * t;
      const y123 = y12 + (y23 - y12) * t;
      const x234 = x23 + (x34 - x23) * t;
      const y234 = y23 + (y34 - y23) * t;
      emit(x123 + (x234 - x123) * t, y123 + (y234 - y123) * t);
    }
    return _out;
  }
}
