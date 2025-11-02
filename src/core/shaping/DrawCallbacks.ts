import { LoadedFont } from '../types';
import { GlyphContourCollector } from '../cache/GlyphContourCollector';
import { debugLogger } from '../../utils/DebugLogger';

// HarfBuzz callbacks
export class DrawCallbackHandler {
  private moveTo_func: number | null = null;
  private lineTo_func: number | null = null;
  private quadTo_func: number | null = null;
  private cubicTo_func: number | null = null;
  private closePath_func: number | null = null;
  private drawFuncsPtr: number = 0;
  private collector?: GlyphContourCollector;
  private position = { x: 0, y: 0 };

  public setPosition(x: number, y: number): void {
    this.position.x = x;
    this.position.y = y;
    if (this.collector) {
      this.collector.setPosition(x, y);
    }
  }

  public updatePosition(dx: number, dy: number): void {
    this.position.x += dx;
    this.position.y += dy;
    if (this.collector) {
      this.collector.updatePosition(dx, dy);
    }
  }

  public createDrawFuncs(
    font: LoadedFont,
    collector: GlyphContourCollector
  ): void {
    if (!font || !font.module || !font.hb) {
      throw new Error('Invalid font object');
    }

    this.collector = collector;

    if (this.drawFuncsPtr) {
      return;
    }

    const module = font.module;

    // Collect contours at origin - position applied during instancing
    this.moveTo_func = module.addFunction(
      (
        _dfuncs: number,
        _draw_data: number,
        _draw_state: number,
        to_x: number,
        to_y: number
      ) => {
        this.collector?.onMoveTo(to_x, to_y);
      },
      'viiiffi'
    );

    this.lineTo_func = module.addFunction(
      (
        _dfuncs: number,
        _draw_data: number,
        _draw_state: number,
        to_x: number,
        to_y: number
      ) => {
        this.collector?.onLineTo(to_x, to_y);
      },
      'viiiffi'
    );

    this.quadTo_func = module.addFunction(
      (
        _dfuncs: number,
        _draw_data: number,
        _draw_state: number,
        c_x: number,
        c_y: number,
        to_x: number,
        to_y: number
      ) => {
        this.collector?.onQuadTo(c_x, c_y, to_x, to_y);
      },
      'viiiffffi'
    );

    this.cubicTo_func = module.addFunction(
      (
        _dfuncs: number,
        _draw_data: number,
        _draw_state: number,
        c1_x: number,
        c1_y: number,
        c2_x: number,
        c2_y: number,
        to_x: number,
        to_y: number
      ) => {
        this.collector?.onCubicTo(c1_x, c1_y, c2_x, c2_y, to_x, to_y);
      },
      'viiiffffffi'
    );

    this.closePath_func = module.addFunction(
      (_dfuncs: number, _draw_data: number, _draw_state: number) => {
        this.collector?.onClosePath();
      },
      'viiii'
    );

    // Create HarfBuzz draw functions object using the module exports
    this.drawFuncsPtr = module.exports.hb_draw_funcs_create();
    module.exports.hb_draw_funcs_set_move_to_func(
      this.drawFuncsPtr,
      this.moveTo_func,
      0,
      0
    );
    module.exports.hb_draw_funcs_set_line_to_func(
      this.drawFuncsPtr,
      this.lineTo_func,
      0,
      0
    );
    module.exports.hb_draw_funcs_set_quadratic_to_func(
      this.drawFuncsPtr,
      this.quadTo_func,
      0,
      0
    );
    module.exports.hb_draw_funcs_set_cubic_to_func(
      this.drawFuncsPtr,
      this.cubicTo_func,
      0,
      0
    );
    module.exports.hb_draw_funcs_set_close_path_func(
      this.drawFuncsPtr,
      this.closePath_func,
      0,
      0
    );
  }

  public getDrawFuncsPtr(): number {
    if (!this.drawFuncsPtr) {
      throw new Error('Draw functions not initialized');
    }
    return this.drawFuncsPtr;
  }

  public destroy(font: LoadedFont): void {
    if (!font || !font.module || !font.hb) {
      return;
    }

    const module = font.module;

    try {
      if (this.drawFuncsPtr) {
        module.exports.hb_draw_funcs_destroy(this.drawFuncsPtr);
        this.drawFuncsPtr = 0;
      }

      if (this.moveTo_func !== null) {
        module.removeFunction(this.moveTo_func);
        this.moveTo_func = null;
      }
      if (this.lineTo_func !== null) {
        module.removeFunction(this.lineTo_func);
        this.lineTo_func = null;
      }
      if (this.quadTo_func !== null) {
        module.removeFunction(this.quadTo_func);
        this.quadTo_func = null;
      }
      if (this.cubicTo_func !== null) {
        module.removeFunction(this.cubicTo_func);
        this.cubicTo_func = null;
      }
      if (this.closePath_func !== null) {
        module.removeFunction(this.closePath_func);
        this.closePath_func = null;
      }
    } catch (error) {
      debugLogger.warn('Error destroying draw callbacks:', error);
    }

    this.collector = undefined;
  }
}
