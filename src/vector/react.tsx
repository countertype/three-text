/// <reference types="@react-three/fiber" />
import { forwardRef, useEffect, useRef, useState } from 'react';
import * as THREE from 'three';
import { Text as VectorText, type VectorTextResult, type TextOptions } from './index';
import { useDeepCompareMemo } from '../react/utils';

export interface TextProps extends Omit<TextOptions, 'text' | 'color'> {
  children: string;
  font: string | ArrayBuffer;
  fillColor?: THREE.ColorRepresentation;
  position?: [number, number, number];
  rotation?: [number, number, number];
  scale?: [number, number, number];
  positionNode?: any;
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
      positionNode,
      onLoad,
      onError,
      ...restOptions
    } = props;

    const memoizedTextOptions = useDeepCompareMemo(restOptions);
    const [group, setGroup] = useState<THREE.Group | null>(null);
    const [error, setError] = useState<Error | null>(null);
    const resultRef = useRef<VectorTextResult | null>(null);
    const opRef = useRef<Promise<VectorTextResult | null>>(Promise.resolve(null));
    const onLoadRef = useRef(onLoad);
    const onErrorRef = useRef(onError);
    onLoadRef.current = onLoad;
    onErrorRef.current = onError;

    useEffect(() => {
      let cancelled = false;

      async function setup() {
        try {
          setError(null);

          const color = new THREE.Color(fillColor);

          const resultPromise = opRef.current.catch(() => null).then(() => {
            if (cancelled) return null;

            const colorArr: [number, number, number] = [color.r, color.g, color.b];

            return resultRef.current
              ? resultRef.current.update({
                  text: children,
                  font,
                  color: colorArr,
                  ...memoizedTextOptions
                })
              : VectorText.create({
                  text: children,
                  font,
                  color: colorArr,
                  ...memoizedTextOptions
                });
          });

          opRef.current = resultPromise.catch(() => null);

          const result = await resultPromise;

          if (!result) return;

          if (cancelled) {
            result.dispose();
            return;
          }

          if (positionNode && result.mesh?.material) {
            (result.mesh.material as any).positionNode = positionNode;
            (result.mesh.material as any).needsUpdate = true;
          }

          const prev = resultRef.current;
          resultRef.current = result;
          setGroup(result.group);

          if (onLoadRef.current) onLoadRef.current(result);

          requestAnimationFrame(() => prev?.dispose());
        } catch (err) {
          const e = err as Error;
          if (!cancelled) {
            setError(e);
            if (onErrorRef.current) onErrorRef.current(e);
            else console.error('three-text/vector/react:', e);
          }
        }
      }

      setup();

      return () => {
        cancelled = true;
      };
    }, [children, font, memoizedTextOptions, fillColor]);

    useEffect(() => {
      const result = resultRef.current;
      if (result?.mesh?.material) {
        (result.mesh.material as any).positionNode = positionNode ?? null;
        (result.mesh.material as any).needsUpdate = true;
      }
    }, [positionNode]);

    useEffect(() => {
      return () => {
        resultRef.current?.dispose();
        resultRef.current = null;
      };
    }, []);

    if (error || !group) {
      return null;
    }

    return (
      <group ref={ref} position={position} rotation={rotation} scale={scale}>
        <primitive object={group} />
      </group>
    );
  }
);

export const Text = Object.assign(TextInner, {
  setHarfBuzzPath: VectorText.setHarfBuzzPath,
  setHarfBuzzBuffer: VectorText.setHarfBuzzBuffer,
  init: VectorText.init,
  registerPattern: VectorText.registerPattern,
  preloadPatterns: VectorText.preloadPatterns,
  setMaxFontCacheMemoryMB: VectorText.setMaxFontCacheMemoryMB,
  enableWoff2: VectorText.enableWoff2,
  create: VectorText.create
});
