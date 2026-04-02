/// <reference types="@react-three/fiber" />
import { forwardRef, useEffect, useRef, useState } from 'react';
import * as THREE from 'three';
import { Text as VectorText, type VectorResult, type VectorTextOptions } from './index';
import { useDeepCompareMemo } from '../react/utils';

export interface TextProps extends Omit<VectorTextOptions, 'text' | 'color'> {
  children: string;
  font: string | ArrayBuffer;
  fillColor?: THREE.ColorRepresentation;
  position?: [number, number, number];
  rotation?: [number, number, number];
  scale?: [number, number, number];
  onLoad?: (result: VectorResult) => void;
  onError?: (error: Error) => void;
}

const TextInner = forwardRef<THREE.Group, TextProps>(
  function TextInner(props, ref) {
    const {
      children,
      font,
      fillColor = '#ffffff',
      positionNode,
      colorNode,
      position = [0, 0, 0],
      rotation = [0, 0, 0],
      scale = [1, 1, 1],
      onLoad,
      onError,
      ...restOptions
    } = props;

    const memoizedTextOptions = useDeepCompareMemo(restOptions);
    const [group, setGroup] = useState<THREE.Group | null>(null);
    const [error, setError] = useState<Error | null>(null);
    const resultRef = useRef<VectorResult | null>(null);
    const opRef = useRef<Promise<VectorResult | null>>(Promise.resolve(null));
    const onLoadRef = useRef(onLoad);
    const onErrorRef = useRef(onError);
    onLoadRef.current = onLoad;
    onErrorRef.current = onError;

    useEffect(() => {
      let cancelled = false;

      async function setup() {
        try {
          setError(null);

          const resultPromise = opRef.current.catch(() => null).then(() => {
            if (cancelled) return null;

            return resultRef.current
              ? resultRef.current.update({
                  text: children,
                  font,
                  color: fillColor,
                  positionNode,
                  colorNode,
                  ...memoizedTextOptions
                })
              : VectorText.create({
                  text: children,
                  font,
                  color: fillColor,
                  positionNode,
                  colorNode,
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
    }, [children, font, memoizedTextOptions, fillColor, positionNode, colorNode]);

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
