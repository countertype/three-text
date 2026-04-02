/// <reference types="@react-three/fiber" />
import { forwardRef, useEffect, useRef, useState } from 'react';
import * as THREE from 'three';
import { Text as VectorTextCore } from './index';
import type { VectorTextResult } from './index';
import {
  createVectorMeshes,
  type VectorMeshes
} from './loopBlinnTSL';
import type { TextOptions } from '../core/types';
import { useDeepCompareMemo } from '../react/utils';

const hasNodeMaterials = typeof (THREE as any).MeshBasicNodeMaterial !== 'undefined';

export interface TextProps extends Omit<TextOptions, 'text' | 'color'> {
  children: string;
  font: string | ArrayBuffer;
  fillColor?: THREE.ColorRepresentation;
  position?: [number, number, number];
  rotation?: [number, number, number];
  scale?: [number, number, number];
  onLoad?: (result: VectorTextResult) => void;
  onError?: (error: Error) => void;
}

const TextInner = forwardRef<THREE.Group, TextProps>(
  function TextInner(props, ref) {
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
    const [meshes, setMeshes] = useState<VectorMeshes | null>(null);
    const [error, setError] = useState<Error | null>(null);
    const resultRef = useRef<VectorTextResult | null>(null);
    const meshesRef = useRef<VectorMeshes | null>(null);

    useEffect(() => {
      let cancelled = false;

      if (!hasNodeMaterials) {
        const err = new Error(
          'three-text/vector/react requires MeshBasicNodeMaterial (Three.js r170+ with node materials / WebGPU build)'
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

          const lb = createVectorMeshes(result.geometryData, fillColor);
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
            else console.error('three-text/vector/react:', e);
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

export const Text = Object.assign(TextInner, {
  setHarfBuzzPath: VectorTextCore.setHarfBuzzPath,
  setHarfBuzzBuffer: VectorTextCore.setHarfBuzzBuffer,
  init: VectorTextCore.init,
  registerPattern: VectorTextCore.registerPattern,
  preloadPatterns: VectorTextCore.preloadPatterns,
  setMaxFontCacheMemoryMB: VectorTextCore.setMaxFontCacheMemoryMB,
  enableWoff2: VectorTextCore.enableWoff2,
  create: VectorTextCore.create
});
