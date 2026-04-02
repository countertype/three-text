// Loop-Blinn TSL adapter for Three.js WebGPURenderer.
// Creates meshes with TSL node materials for Loop-Blinn curve evaluation
// and Kokojima stencil fill. Works on WebGL (r170+) and WebGPU (r182+).
// Requires peer dependencies: three, three/tsl

// @ts-ignore - three is a peer dependency
import * as THREE from 'three';
// @ts-ignore - three/tsl is a peer dependency
import { Fn, vec4, float, uv, dFdx, dFdy, sqrt, clamp, Discard } from 'three/tsl';

import type { VectorGeometryData } from './LoopBlinnGeometry';

export interface VectorMeshes {
  interiorMesh: THREE.Object3D;
  curveMesh: THREE.Object3D;
  fillMesh: THREE.Mesh;
  setOffset(x: number, y: number, z?: number): void;
  dispose(): void;
}

// TSL fragment node: evaluates u^2 - v = 0 per fragment with
// screen-space derivative antialiasing. Discards outside fragments.
// UV convention per triangle: p0=(0,0), p1=(0.5,0), p2=(1,1)
export const loopBlinnFragment = Fn(() => {
  const curveUV = uv();

  const px = dFdx(curveUV);
  const py = dFdy(curveUV);
  const fx = float(2.0).mul(curveUV.x).mul(px.x).sub(px.y);
  const fy = float(2.0).mul(curveUV.x).mul(py.x).sub(py.y);
  const denom = sqrt(fx.mul(fx).add(fy.mul(fy)));

  const f = curveUV.x.mul(curveUV.x).sub(curveUV.y);
  const sd = f.div(denom.max(1e-6));
  const alpha = clamp(float(0.5).sub(sd), 0.0, 1.0);

  Discard(alpha.lessThanEqual(0.0));

  return vec4(1.0, 1.0, 1.0, alpha);
});

function setGlyphAttrsOnGeometry(
  geo: THREE.BufferGeometry,
  attrs: VectorGeometryData['interiorGlyphAttrs'],
  offsetX = 0,
  offsetY = 0
): void {
  if (!attrs) return;

  const glyphCenter = new Float32Array(attrs.glyphCenter);
  if (offsetX !== 0 || offsetY !== 0) {
    for (let i = 0; i < glyphCenter.length; i += 3) {
      glyphCenter[i] += offsetX;
      glyphCenter[i + 1] += offsetY;
    }
  }

  geo.setAttribute('glyphCenter', new THREE.Float32BufferAttribute(glyphCenter, 3));
  geo.setAttribute('glyphIndex', new THREE.Float32BufferAttribute(attrs.glyphIndex, 1));
  geo.setAttribute('glyphProgress', new THREE.Float32BufferAttribute(attrs.glyphProgress, 1));
  geo.setAttribute('glyphLineIndex', new THREE.Float32BufferAttribute(attrs.glyphLineIndex, 1));
  geo.setAttribute('glyphBaselineY', new THREE.Float32BufferAttribute(attrs.glyphBaselineY, 1));
}

// Nonzero winding via two-sided stencil: front faces increment,
// back faces decrement. Three.js materials only expose one set of
// stencil ops (no front/back split), so we use two single-sided
// meshes per pass. A Three.js PR to add stencilBack* properties
// would let us collapse these back to one DoubleSide mesh each.
function applyStencilNonzero(mat: THREE.Material, side: THREE.Side): void {
  mat.depthTest = false;
  mat.depthWrite = false;
  mat.side = side;
  (mat as any).stencilWrite = true;
  (mat as any).stencilFunc = THREE.AlwaysStencilFunc;
  (mat as any).stencilRef = 0;
  (mat as any).stencilFuncMask = 0xFF;
  (mat as any).stencilWriteMask = 0xFF;
  (mat as any).stencilFail = THREE.KeepStencilOp;
  (mat as any).stencilZFail = THREE.KeepStencilOp;
  (mat as any).stencilZPass = side === THREE.FrontSide
    ? THREE.IncrementWrapStencilOp
    : THREE.DecrementWrapStencilOp;
}

// Three meshes rendered in order (via renderOrder or sequential draws):
//   1. interiorMesh - nonzero stencil winding (fan interiors, no color output)
//   2. curveMesh    - nonzero stencil winding (Loop-Blinn curve eval, alpha-to-coverage)
//   3. fillMesh     - color where stencil != 0, then zeros stencil
export function createVectorMeshes(
  data: VectorGeometryData,
  color?: THREE.ColorRepresentation
): VectorMeshes {
  const interiorGeo = new THREE.BufferGeometry();
  interiorGeo.setAttribute('position', new THREE.Float32BufferAttribute(data.interiorPositions, 3));
  interiorGeo.setIndex(new THREE.BufferAttribute(data.interiorIndices, 1));
  setGlyphAttrsOnGeometry(interiorGeo, data.interiorGlyphAttrs);

  const curveGeo = new THREE.BufferGeometry();
  curveGeo.setAttribute('position', new THREE.Float32BufferAttribute(data.curvePositions, 3));
  const curveVertCount = data.curvePositions.length / 3;
  const curveUVs = new Float32Array(curveVertCount * 2);
  for (let i = 0; i < curveVertCount; i += 3) {
    curveUVs[i * 2]     = 0;   curveUVs[i * 2 + 1] = 0;     // p0
    curveUVs[i * 2 + 2] = 0.5; curveUVs[i * 2 + 3] = 0;     // p1
    curveUVs[i * 2 + 4] = 1;   curveUVs[i * 2 + 5] = 1;     // p2
  }
  curveGeo.setAttribute('uv', new THREE.Float32BufferAttribute(curveUVs, 2));
  setGlyphAttrsOnGeometry(curveGeo, data.curveGlyphAttrs);

  const fillGeo = new THREE.BufferGeometry();
  fillGeo.setAttribute('position', new THREE.Float32BufferAttribute(data.fillPositions, 3));
  fillGeo.setIndex(new THREE.BufferAttribute(data.fillIndices, 1));
  setGlyphAttrsOnGeometry(fillGeo, data.fillGlyphAttrs);

  function makeStencilPair(geo: THREE.BufferGeometry, extra?: (mat: any) => void) {
    const frontMat = new (THREE as any).MeshBasicNodeMaterial();
    applyStencilNonzero(frontMat, THREE.FrontSide);
    frontMat.colorWrite = false;
    const backMat = new (THREE as any).MeshBasicNodeMaterial();
    applyStencilNonzero(backMat, THREE.BackSide);
    backMat.colorWrite = false;
    if (extra) { extra(frontMat); extra(backMat); }
    const group = new THREE.Group();
    group.add(new THREE.Mesh(geo, frontMat), new THREE.Mesh(geo, backMat));
    return { group, materials: [frontMat, backMat] };
  }

  const interior = makeStencilPair(interiorGeo);
  const curve = makeStencilPair(curveGeo, (mat) => {
    mat.alphaToCoverage = true;
    mat.fragmentNode = loopBlinnFragment();
  });

  // Color fill material - renders where stencil != 0
  const colorMat = new (THREE as any).MeshBasicNodeMaterial();
  colorMat.depthTest = false;
  colorMat.depthWrite = false;
  colorMat.side = THREE.DoubleSide;
  colorMat.stencilWrite = true;
  colorMat.stencilFunc = THREE.NotEqualStencilFunc;
  colorMat.stencilRef = 0;
  colorMat.stencilFuncMask = 0xFF;
  colorMat.stencilWriteMask = 0xFF;
  colorMat.stencilFail = THREE.KeepStencilOp;
  colorMat.stencilZFail = THREE.KeepStencilOp;
  colorMat.stencilZPass = THREE.ZeroStencilOp;
  if (color !== undefined) {
    colorMat.color = new THREE.Color(color);
  }

  const interiorMesh = interior.group;
  const curveMesh = curve.group;
  const fillMesh = new THREE.Mesh(fillGeo, colorMat);

  return {
    interiorMesh,
    curveMesh,
    fillMesh,
    setOffset(x: number, y: number, z = 0) {
      interiorMesh.position.set(x, y, z);
      curveMesh.position.set(x, y, z);
      fillMesh.position.set(x, y, z);
    },
    dispose() {
      interiorGeo.dispose();
      curveGeo.dispose();
      fillGeo.dispose();
      interior.materials.forEach(m => m.dispose());
      curve.materials.forEach(m => m.dispose());
      colorMat.dispose();
    }
  };
}
