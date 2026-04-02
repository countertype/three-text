import { LoadedFont } from '../types';
import { logger } from '../../utils/Logger';

export interface GlyphDrawCollector {
  setPosition(x: number, y: number): void;
  updatePosition(dx: number, dy: number): void;
  onMoveTo(x: number, y: number): void;
  onLineTo(x: number, y: number): void;
  onQuadTo(cx: number, cy: number, x: number, y: number): void;
  onCubicTo(
    c1x: number,
    c1y: number,
    c2x: number,
    c2y: number,
    x: number,
    y: number
  ): void;
  onClosePath(): void;
}

export class DrawCallbackHandler {
  private moveTo_func: number | null = null;
  private lineTo_func: number | null = null;
  private quadTo_func: number | null = null;
  private cubicTo_func: number | null = null;
  private closePath_func: number | null = null;
  private drawFuncsPtr: number = 0;
  private collector?: GlyphDrawCollector;
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

  public setCollector(collector: GlyphDrawCollector): void {
    this.collector = collector;
  }

  public createDrawFuncs(
    font: LoadedFont,
    collector: GlyphDrawCollector
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
      logger.warn('Error destroying draw callbacks:', error);
    }

    this.collector = undefined;
  }
}

// Share a single DrawCallbackHandler per HarfBuzz module to avoid leaking
// wasm function pointers when users create many Text instances
const sharedDrawCallbackHandlers = new WeakMap<object, DrawCallbackHandler>();

export function getSharedDrawCallbackHandler(
  font: LoadedFont
): DrawCallbackHandler {
  const key = font.module as unknown as object;
  const existing = sharedDrawCallbackHandlers.get(key);
  if (existing) return existing;

  const handler = new DrawCallbackHandler();
  sharedDrawCallbackHandlers.set(key, handler);
  return handler;
}
