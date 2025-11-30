// p5.js adapter

import { Text as TextCore } from '../core/Text';
import type { TextGeometryInfo, TextOptions } from '../core/types';

interface P5Vector {
  x: number;
  y: number;
  z: number;
}

interface P5Geometry {
  vertices: P5Vector[];
  faces: number[][];
  vertexNormals: P5Vector[];
}

interface P5Instance {
  Geometry: new () => P5Geometry;
  createVector(x: number, y: number, z: number): P5Vector;
  _decrementPreload(): void;
}

interface ThreeTextFont {
  buffer: ArrayBuffer | null;
  path: string;
  variations?: { [key: string]: number };
}

declare global {
  interface Window {
    p5?: any;
  }
}

function convertToP5Geometry(
  p5Instance: P5Instance,
  textGeometry: TextGeometryInfo
): P5Geometry {
  const { vertices, normals, indices } = textGeometry;

  const P5GeometryClass =
    (p5Instance as any).constructor?.Geometry ||
    (typeof window !== 'undefined' && (window as any).p5?.Geometry);

  if (!P5GeometryClass) {
    throw new Error('p5.Geometry not found. Ensure p5.js is loaded.');
  }

  const geom = new P5GeometryClass();

  const createVec = (x: number, y: number, z: number) => {
    if (typeof p5Instance.createVector === 'function') {
      return p5Instance.createVector(x, y, z);
    }
    const globalCreateVector =
      typeof window !== 'undefined' && (window as any).createVector;
    if (globalCreateVector) {
      return globalCreateVector(x, y, z);
    }
    throw new Error('createVector not found');
  };

  // p5 uses +Y up, we use +Y down
  for (let i = 0; i < vertices.length; i += 3) {
    geom.vertices.push(
      createVec(vertices[i], -vertices[i + 1], vertices[i + 2])
    );
  }

  for (let i = 0; i < normals.length; i += 3) {
    geom.vertexNormals.push(
      createVec(normals[i], -normals[i + 1], normals[i + 2])
    );
  }

  // Convert indices to faces
  for (let i = 0; i < indices.length; i += 3) {
    geom.faces.push([indices[i], indices[i + 1], indices[i + 2]]);
  }

  return geom;
}

let shaperInitialized = false;

if (typeof window !== 'undefined' && window.p5) {
  const p5 = window.p5;

  p5.prototype.loadThreeTextShaper = function (wasmPath: string) {
    if (shaperInitialized) {
      return;
    }

    TextCore.setHarfBuzzPath(wasmPath);
    shaperInitialized = true;

    TextCore.init()
      .then(() => {
        this._decrementPreload();
      })
      .catch((err: Error) => {
        console.error('Failed to load text shaper:', err);
        this._decrementPreload();
      });
  };

  p5.prototype.loadThreeTextFont = function (
    fontPath: string,
    fontVariations?: { [key: string]: number }
  ): ThreeTextFont {
    const fontRef: ThreeTextFont = {
      buffer: null,
      path: fontPath,
      variations: fontVariations
    };

    fetch(fontPath)
      .then((res) => {
        if (!res.ok) {
          throw new Error(`Failed to load font: HTTP ${res.status}`);
        }
        return res.arrayBuffer();
      })
      .then((buffer) => {
        fontRef.buffer = buffer;
        this._decrementPreload();
      })
      .catch((err: Error) => {
        console.error(`Failed to load font ${fontPath}:`, err);
        this._decrementPreload();
      });

    return fontRef;
  };

  p5.prototype.createThreeTextGeometry = async function (
    text: string,
    options: Omit<TextOptions, 'text' | 'font'> & { font: ThreeTextFont }
  ) {
    if (!options.font || !options.font.buffer) {
      console.error('Font not loaded. Use loadThreeTextFont() in preload().');
      return null;
    }

    const { font, ...coreOptions } = options;

    try {
      const result = await TextCore.create({
        text,
        font: font.buffer!,
        fontVariations: font.variations,
        ...coreOptions
      });

      const p5Instance = this as P5Instance;
      const geometry = convertToP5Geometry(p5Instance, result);

      return {
        geometry,
        planeBounds: result.planeBounds,
        glyphs: result.glyphs
      };
    } catch (err) {
      console.error('Failed to create text geometry:', err);
      return null;
    }
  };

  p5.prototype.registerPreloadMethod('loadThreeTextShaper', p5.prototype);
  p5.prototype.registerPreloadMethod('loadThreeTextFont', p5.prototype);
}

export { convertToP5Geometry as createP5Geometry };
