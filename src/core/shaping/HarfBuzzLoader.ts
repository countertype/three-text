import type { HarfBuzzInstance } from '../types';

// These will be bundled by Rollup
// @ts-expect-error - no declarations for harfbuzzjs/hb.js
import createHarfBuzz from 'harfbuzzjs/hb.js';
// @ts-expect-error - no declarations for harfbuzzjs/hbjs.js
import hbjs from 'harfbuzzjs/hbjs.js';

let harfbuzzPromise: Promise<HarfBuzzInstance> | null = null;
let wasmPath: string | null = null;
let wasmBuffer: ArrayBuffer | null = null; // Add buffer option

export const HarfBuzzLoader = {
  setWasmPath(path: string): void {
    wasmPath = path;
    wasmBuffer = null; // Clear buffer if path is set
    harfbuzzPromise = null;
  },

  setWasmBuffer(buffer: ArrayBuffer): void {
    wasmBuffer = buffer;
    wasmPath = null; // Clear path if buffer is set
    harfbuzzPromise = null;
  },

  async getHarfBuzz(): Promise<HarfBuzzInstance> {
    if (harfbuzzPromise) {
      return harfbuzzPromise;
    }

    harfbuzzPromise = new Promise(async (resolve, reject) => {
      try {
        const moduleConfig: any = {};

        if (wasmBuffer) {
          moduleConfig.wasmBinary = wasmBuffer;
        } else if (wasmPath) {
          moduleConfig.locateFile = (path: string, scriptDirectory: string) => {
            if (path.endsWith('.wasm')) {
              return wasmPath!;
            }
            return scriptDirectory + path;
          };
        } else {
          throw new Error(
            'HarfBuzz WASM path or buffer must be set before initialization.'
          );
        }

        const hbModule = await createHarfBuzz(moduleConfig);
        const hb = hbjs(hbModule);
        const module = {
          addFunction: hbModule.addFunction,
          exports: hbModule.wasmExports,
          removeFunction: hbModule.removeFunction
        };
        resolve({ hb, module });
      } catch (error) {
        reject(new Error(`Failed to initialize HarfBuzz: ${error}`));
      }
    });

    return harfbuzzPromise;
  }
};
