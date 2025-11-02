/// <reference types="@react-three/fiber" />
import { useEffect, useState, useMemo, useRef, forwardRef } from "react";
import * as THREE from "three";
import { Text } from "../core/Text";
import type { TextOptions, TextGeometryInfo } from "../core/types";

function deepEqual(a: any, b: any): boolean {
  if (a === b) return true;
  if (a == null || b == null) return false;
  if (typeof a !== 'object' || typeof b !== 'object') return false;
  
  const keysA = Object.keys(a);
  const keysB = Object.keys(b);
  
  if (keysA.length !== keysB.length) return false;
  
  for (const key of keysA) {
    if (!keysB.includes(key)) return false;
    if (!deepEqual(a[key], b[key])) return false;
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

export interface ThreeTextProps extends Omit<TextOptions, "text"> {
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

export const ThreeText = forwardRef<THREE.Mesh, ThreeTextProps>(
  function ThreeText(props, ref) {
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

    const [geometry, setGeometry] = useState<THREE.BufferGeometry | null>(null);
    const [error, setError] = useState<Error | null>(null);

    const defaultMaterial = useMemo(
      () =>
        new THREE.MeshBasicMaterial({
          color: 0xffffff,
          side: THREE.DoubleSide,
        }),
      []
    );

    const finalMaterial = material || defaultMaterial;

    const memoizedTextOptions = useDeepCompareMemo(restOptions);

    useEffect(() => {
      let cancelled = false;

      async function setupText() {
        try {
          setError(null);

          if (cancelled) return;

          const text = await Text.create({
            text: children,
            font,
            ...memoizedTextOptions,
          });

          if (
            text.geometry &&
            !text.geometry.attributes.color &&
            vertexColors
          ) {
            const vertexCount = text.geometry.attributes.position.count;
            const colors = new Float32Array(vertexCount * 3).fill(1.0);
            text.geometry.setAttribute(
              "color",
              new THREE.BufferAttribute(colors, 3)
            );
          }

          if (!cancelled) {
            setGeometry(text.geometry);
            if (onLoad) onLoad(text.geometry, text);
          }
        } catch (err) {
          const error = err as Error;
          if (!cancelled) {
            setError(error);
            if (onError) onError(error);
            else console.error("ThreeText error:", error);
          }
        }
      }

      setupText();

      return () => {
        cancelled = true;
      };
    }, [font, children, memoizedTextOptions, onLoad, onError, vertexColors]);

    // Handle geometry and material cleanup
    useEffect(() => {
      return () => {
        if (geometry) {
          geometry.dispose();
        }
        if (!material && defaultMaterial) {
          defaultMaterial.dispose();
        }
      };
    }, [geometry, material, defaultMaterial]);

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
