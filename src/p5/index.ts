// p5.js adapter - converts core geometry to p5.Geometry

import type { TextGeometryInfo } from '../core/types';

// p5.js types (minimal for what we need)
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
}

export function createP5Geometry(
  p5Instance: P5Instance | any,
  textGeometry: TextGeometryInfo
): P5Geometry {
  // In global mode, p5.Geometry exists but createVector is global
  // In instance mode, both are on the instance
  const P5Geometry = p5Instance.Geometry || (window as any).p5?.Geometry;
  const createVec = p5Instance.createVector || (window as any).createVector;
  
  if (!P5Geometry || !createVec) {
    throw new Error('p5.js not found. Make sure p5.js is loaded before calling this function.');
  }
  
  const geom = new P5Geometry();
  const { vertices, normals, indices } = textGeometry;
  
  // Convert vertices (flip Y for p5.js coordinate system)
  for (let i = 0; i < vertices.length; i += 3) {
    geom.vertices.push(
      createVec(
        vertices[i],
        -vertices[i + 1],
        vertices[i + 2]
      )
    );
  }
  
  // Convert normals (flip Y)
  for (let i = 0; i < normals.length; i += 3) {
    geom.vertexNormals.push(
      createVec(
        normals[i],
        -normals[i + 1],
        normals[i + 2]
      )
    );
  }
  
  // Convert indices to faces
  for (let i = 0; i < indices.length; i += 3) {
    geom.faces.push([
      indices[i],
      indices[i + 1],
      indices[i + 2]
    ]);
  }
  
  return geom;
}


