/// <reference types="@react-three/fiber" />
import { forwardRef, useEffect, useRef, useState } from 'react';
import * as THREE from 'three';
import { Text as VectorTextCore } from './index';
import type { VectorTextResult } from './index';
import {
  createLoopBlinnTSLMeshes,
  type LoopBlinnTSLMeshes
} from './loopBlinnTSL';
import type { TextOptions } from '../core/types';

function deepEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (a == null || b == null) return false;
  if (typeof a !== 'object' || typeof b !== 'object') return false;

  if (Array.isArray(a) || Array.isArray(b)) {
    if (!Array.isArray(a) || !Array.isArray(b)) return false;
    if (a.length !== b.length) return false;
    for (let i = 0; i < a.length; i++) {
      if (!deepEqual(a[i], b[i])) return false;
    }
    return true;
  }

  const keysA = Object.keys(a as object);
  const keysB = Object.keys(b as object);
  if (keysA.length !== keysB.length) return false;
  for (const key of keysA) {
    if (!Object.prototype.hasOwnProperty.call(b, key)) return false;
    if (
      !deepEqual(
        (a as Record<string, unknown>)[key],
        (b as Record<string, unknown>)[key]
      )
    ) {
      return false;
    }
  }
  return true;
}

function useDeepCompareMemo<T>(value: T): T {
  const ref = useRef<T>(value);
  if (!deepEqual(value, ref.current)) {
    ref.current = value;
  }
  return ref.current;
}

function colorToRgb(
  color: THREE.ColorRepresentation | undefined
): { r: number; g: number; b: number } | undefined {
  if (color === undefined) return undefined;
  const c = new THREE.Color(color);
  return { r: c.r, g: c.g, b: c.b };
}

export interface VectorTextProps extends Omit<TextOptions, 'text' | 'color'> {
  children: string;
  font: string | ArrayBuffer;
  /** Fill color for Loop-Blinn stencil fill pass (default `#ffffff`) */
  fillColor?: THREE.ColorRepresentation;
  position?: [number, number, number];
  rotation?: [number, number, number];
  scale?: [number, number, number];
  onLoad?: (result: VectorTextResult) => void;
  onError?: (error: Error) => void;
}

const VectorTextInner = forwardRef<THREE.Group, VectorTextProps>(
  function VectorTextInner(props, ref) {
    const {
      children,
      font,
      fillColor = '#ffffff',
      position = [0, 0, 0],
      rotation = [0, 0, 0],
      scale = [1, 1, 1],
      onLoad,
      onError,
      ...restOptions
    } = props;

    const memoizedTextOptions = useDeepCompareMemo(restOptions);
    const [meshes, setMeshes] = useState<LoopBlinnTSLMeshes | null>(null);
    const [error, setError] = useState<Error | null>(null);
    const resultRef = useRef<VectorTextResult | null>(null);
    const meshesRef = useRef<LoopBlinnTSLMeshes | null>(null);

    useEffect(() => {
      let cancelled = false;

      if (typeof (THREE as unknown as { MeshBasicNodeMaterial?: unknown })
        .MeshBasicNodeMaterial === 'undefined') {
        const err = new Error(
          'VectorText requires THREE.MeshBasicNodeMaterial (Three.js r170+ with node materials / WebGPU build)'
        );
        setError(err);
        if (onError) onError(err);
        else console.error(err.message);
        return;
      }

      async function setup() {
        try {
          setError(null);

          const result = await VectorTextCore.create({
            text: children,
            font,
            ...memoizedTextOptions
          });

          if (cancelled) {
            result.dispose();
            return;
          }

          resultRef.current?.dispose();
          resultRef.current = result;

          const bounds = result.geometryData.planeBounds;
          const cx = (bounds.min.x + bounds.max.x) * 0.5;
          const cy = (bounds.min.y + bounds.max.y) * 0.5;

          const rgb = colorToRgb(fillColor);
          const lb = createLoopBlinnTSLMeshes(result.geometryData, rgb);
          lb.setOffset(-cx, -cy, 0);
          lb.interiorMesh.renderOrder = 0;
          lb.curveMesh.renderOrder = 1;
          lb.fillMesh.renderOrder = 2;

          meshesRef.current?.dispose();
          meshesRef.current = lb;
          setMeshes(lb);
          if (onLoad) onLoad(result);
        } catch (err) {
          const e = err as Error;
          if (!cancelled) {
            setError(e);
            if (onError) onError(e);
            else console.error('VectorText error:', e);
          }
        }
      }

      setup();

      return () => {
        cancelled = true;
        meshesRef.current?.dispose();
        meshesRef.current = null;
        resultRef.current?.dispose();
        resultRef.current = null;
        setMeshes(null);
      };
    }, [children, font, memoizedTextOptions, fillColor, onLoad, onError]);

    if (error || !meshes) {
      return null;
    }

    return (
      <group ref={ref} position={position} rotation={rotation} scale={scale}>
        <primitive object={meshes.interiorMesh} />
        <primitive object={meshes.curveMesh} />
        <primitive object={meshes.fillMesh} />
      </group>
    );
  }
);

export const VectorText = Object.assign(VectorTextInner, {
  setHarfBuzzPath: VectorTextCore.setHarfBuzzPath,
  setHarfBuzzBuffer: VectorTextCore.setHarfBuzzBuffer,
  init: VectorTextCore.init,
  registerPattern: VectorTextCore.registerPattern,
  preloadPatterns: VectorTextCore.preloadPatterns,
  setMaxFontCacheMemoryMB: VectorTextCore.setMaxFontCacheMemoryMB,
  enableWoff2: VectorTextCore.enableWoff2,
  create: VectorTextCore.create
});
