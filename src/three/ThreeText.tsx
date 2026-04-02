/// <reference types="@react-three/fiber" />
import { forwardRef, useEffect, useMemo, useRef, useState } from 'react';
import * as THREE from 'three';
import { Text as ThreeText } from './index';
import type {
  TextOptions,
  ThreeTextGeometryInfo as TextGeometryInfo
} from './index';
import { useDeepCompareMemo } from '../react/utils';

export interface ThreeTextProps extends Omit<TextOptions, 'text'> {
  children: string;
  font: string | ArrayBuffer;
  material?: THREE.Material;
  position?: [number, number, number];
  rotation?: [number, number, number];
  scale?: [number, number, number];
  onLoad?: (geometry: THREE.BufferGeometry, info: TextGeometryInfo) => void;
  onError?: (error: Error) => void;
  vertexColors?: boolean;
}

export const Text = forwardRef<THREE.Mesh, ThreeTextProps>(
  function Text(props, ref) {
    const {
      children,
      font,
      material,
      position = [0, 0, 0],
      rotation = [0, 0, 0],
      scale = [1, 1, 1],
      onLoad,
      onError,
      vertexColors = true,
      ...restOptions
    } = props;

    const [geometry, setGeometry] = useState<THREE.BufferGeometry | null>(
      null
    );
    const [error, setError] = useState<Error | null>(null);
    const textRef = useRef<TextGeometryInfo | null>(null);
    const opRef = useRef<Promise<TextGeometryInfo | null>>(Promise.resolve(null));
    const onLoadRef = useRef(onLoad);
    const onErrorRef = useRef(onError);
    onLoadRef.current = onLoad;
    onErrorRef.current = onError;

    const defaultMaterial = useMemo(() => {
      return new THREE.MeshBasicMaterial({
        color: 0xffffff,
        side: THREE.DoubleSide,
        vertexColors
      });
    }, [vertexColors]);

    const finalMaterial = material || defaultMaterial;

    const memoizedTextOptions = useDeepCompareMemo(restOptions);

    useEffect(() => {
      let cancelled = false;

      async function setupText() {
        try {
          setError(null);

          if (cancelled) return;

          const textPromise = opRef.current.catch(() => null).then(() => {
            if (cancelled) return null;

            return textRef.current
              ? textRef.current.update({
                  text: children,
                  font,
                  ...memoizedTextOptions
                })
              : ThreeText.create({
                  text: children,
                  font,
                  ...memoizedTextOptions
                });
          });

          opRef.current = textPromise.catch(() => null);

          const text = await textPromise;

          if (!text) return;

          if (cancelled) {
            text.dispose();
            return;
          }

          const prev = textRef.current;
          textRef.current = text;
          setGeometry(text.geometry);
          if (onLoadRef.current) onLoadRef.current(text.geometry, text);
          requestAnimationFrame(() => prev?.dispose());
        } catch (err) {
          const error = err as Error;
          if (!cancelled) {
            setError(error);
            if (onErrorRef.current) onErrorRef.current(error);
            else console.error('ThreeText error:', error);
          }
        }
      }

      setupText();

      return () => {
        cancelled = true;
      };
    }, [font, children, memoizedTextOptions]);

    // Cleanup geometry on unmount
    useEffect(() => {
      return () => {
        textRef.current?.dispose();
        textRef.current = null;
      };
    }, []);

    // Cleanup default material when it changes or on unmount
    useEffect(() => {
      return () => {
        defaultMaterial.dispose();
      };
    }, [defaultMaterial]);

    if (error || !geometry) {
      return null;
    }

    return (
      <mesh
        ref={ref}
        geometry={geometry}
        material={finalMaterial}
        position={position}
        rotation={rotation}
        scale={scale}
      />
    );
  }
);
