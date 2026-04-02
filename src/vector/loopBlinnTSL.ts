// Loop-Blinn TSL adapter for Three.js WebGPURenderer.
// Creates meshes with TSL node materials for Loop-Blinn curve evaluation
// and Kokojima stencil fill. Works on WebGL (r170+) and WebGPU (r182+).
// Requires peer dependencies: three, three/tsl

// @ts-ignore - three is a peer dependency
import * as THREE from 'three';
// @ts-ignore - three/webgpu provides node material classes
import { MeshBasicNodeMaterial } from 'three/webgpu';
// @ts-ignore - three/tsl is a peer dependency
import { Fn, vec4, float, uv, dFdx, dFdy, sqrt, clamp, Discard } from 'three/tsl';

import type { VectorGeometryData } from './LoopBlinnGeometry';

export interface VectorMeshOptions {
  color?: THREE.ColorRepresentation;
  positionNode?: any;
  colorNode?: any;
  center?: boolean;
}

export interface VectorMeshes {
  group: THREE.Group;
  interiorMesh: THREE.Object3D;
  curveMesh: THREE.Object3D;
  fillMesh: THREE.Mesh;
  interiorGeometry: THREE.BufferGeometry;
  curveGeometry: THREE.BufferGeometry;
  fillGeometry: THREE.BufferGeometry;
  setOffset(x: number, y: number, z?: number): void;
  updateMaterials(options?: VectorMeshOptions): void;
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

function createStencilMaterials(opts: VectorMeshOptions) {
  function makePair(extra?: (mat: any) => void) {
    const mats = [THREE.FrontSide, THREE.BackSide].map(side => {
      const mat = new MeshBasicNodeMaterial();
      applyStencilNonzero(mat, side);
      mat.colorWrite = false;
      if (opts.positionNode) mat.positionNode = opts.positionNode;
      if (extra) extra(mat);
      return mat;
    });
    return mats;
  }

  const interiorMats = makePair();
  const curveMats = makePair((mat) => {
    mat.alphaToCoverage = true;
    mat.fragmentNode = loopBlinnFragment();
  });

  const fillMat = new MeshBasicNodeMaterial();
  fillMat.depthTest = false;
  fillMat.depthWrite = false;
  fillMat.side = THREE.DoubleSide;
  fillMat.stencilWrite = true;
  fillMat.stencilFunc = THREE.NotEqualStencilFunc;
  fillMat.stencilRef = 0;
  fillMat.stencilFuncMask = 0xFF;
  fillMat.stencilWriteMask = 0xFF;
  fillMat.stencilFail = THREE.KeepStencilOp;
  fillMat.stencilZFail = THREE.KeepStencilOp;
  fillMat.stencilZPass = THREE.ZeroStencilOp;
  if (opts.positionNode) fillMat.positionNode = opts.positionNode;
  if (opts.colorNode) {
    fillMat.colorNode = opts.colorNode;
  } else if (opts.color !== undefined) {
    fillMat.color = new THREE.Color(opts.color);
  }

  return { interiorMats, curveMats, fillMat };
}

// Three meshes rendered in order (via renderOrder or sequential draws):
//   1. interiorMesh - nonzero stencil winding (fan interiors, no color output)
//   2. curveMesh    - nonzero stencil winding (Loop-Blinn curve eval, alpha-to-coverage)
//   3. fillMesh     - color where stencil != 0, then zeros stencil
export function createVectorMeshes(
  data: VectorGeometryData,
  options?: VectorMeshOptions | THREE.ColorRepresentation
): VectorMeshes {
  const opts: VectorMeshOptions =
    (options !== null && options !== undefined && typeof options === 'object' && !(options instanceof THREE.Color))
      ? options as VectorMeshOptions
      : { color: options as THREE.ColorRepresentation | undefined };

  const interiorGeo = new THREE.BufferGeometry();
  interiorGeo.setAttribute('position', new THREE.Float32BufferAttribute(data.interiorPositions, 3));
  interiorGeo.setIndex(new THREE.BufferAttribute(data.interiorIndices, 1));
  setGlyphAttrsOnGeometry(interiorGeo, data.interiorGlyphAttrs);

  const curveGeo = new THREE.BufferGeometry();
  curveGeo.setAttribute('position', new THREE.Float32BufferAttribute(data.curvePositions, 3));
  const curveVertCount = data.curvePositions.length / 3;
  const curveUVs = new Float32Array(curveVertCount * 2);
  for (let i = 0; i < curveVertCount; i += 3) {
    curveUVs[i * 2]     = 0;   curveUVs[i * 2 + 1] = 0;
    curveUVs[i * 2 + 2] = 0.5; curveUVs[i * 2 + 3] = 0;
    curveUVs[i * 2 + 4] = 1;   curveUVs[i * 2 + 5] = 1;
  }
  curveGeo.setAttribute('uv', new THREE.Float32BufferAttribute(curveUVs, 2));
  setGlyphAttrsOnGeometry(curveGeo, data.curveGlyphAttrs);

  const fillGeo = new THREE.BufferGeometry();
  fillGeo.setAttribute('position', new THREE.Float32BufferAttribute(data.fillPositions, 3));
  fillGeo.setIndex(new THREE.BufferAttribute(data.fillIndices, 1));
  setGlyphAttrsOnGeometry(fillGeo, data.fillGlyphAttrs);

  if (opts.center !== false && data.planeBounds) {
    const cx = (data.planeBounds.min.x + data.planeBounds.max.x) * 0.5;
    const cy = (data.planeBounds.min.y + data.planeBounds.max.y) * 0.5;
    for (const geo of [interiorGeo, curveGeo, fillGeo]) {
      geo.translate(-cx, -cy, 0);
      const gc = geo.attributes.glyphCenter as THREE.BufferAttribute | undefined;
      if (gc) {
        for (let i = 0; i < gc.count; i++) {
          gc.setX(i, gc.getX(i) - cx);
          gc.setY(i, gc.getY(i) - cy);
        }
      }
    }
  }

  let { interiorMats, curveMats, fillMat } = createStencilMaterials(opts);

  const interiorMesh = new THREE.Group();
  interiorMats.forEach(mat => {
    const m = new THREE.Mesh(interiorGeo, mat);
    m.renderOrder = 0;
    interiorMesh.add(m);
  });
  const curveMesh = new THREE.Group();
  curveMats.forEach(mat => {
    const m = new THREE.Mesh(curveGeo, mat);
    m.renderOrder = 1;
    curveMesh.add(m);
  });
  const fillMesh = new THREE.Mesh(fillGeo, fillMat);
  fillMesh.renderOrder = 2;

  const group = new THREE.Group();
  group.add(interiorMesh, curveMesh, fillMesh);

  return {
    group,
    interiorMesh,
    curveMesh,
    fillMesh,
    interiorGeometry: interiorGeo,
    curveGeometry: curveGeo,
    fillGeometry: fillGeo,
    setOffset(x: number, y: number, z = 0) {
      interiorMesh.position.set(x, y, z);
      curveMesh.position.set(x, y, z);
      fillMesh.position.set(x, y, z);
    },
    updateMaterials(newOpts?: VectorMeshOptions) {
      const merged = { ...opts, ...newOpts };
      const created = createStencilMaterials(merged);
      interiorMesh.children.forEach((c, i) => {
        const m = c as THREE.Mesh;
        (m.material as THREE.Material).dispose();
        m.material = created.interiorMats[i];
      });
      curveMesh.children.forEach((c, i) => {
        const m = c as THREE.Mesh;
        (m.material as THREE.Material).dispose();
        m.material = created.curveMats[i];
      });
      (fillMesh.material as THREE.Material).dispose();
      fillMesh.material = created.fillMat;
      interiorMats = created.interiorMats;
      curveMats = created.curveMats;
      fillMat = created.fillMat;
    },
    dispose() {
      interiorGeo.dispose();
      curveGeo.dispose();
      fillGeo.dispose();
      interiorMesh.children.forEach(c => ((c as THREE.Mesh).material as THREE.Material).dispose());
      curveMesh.children.forEach(c => ((c as THREE.Mesh).material as THREE.Material).dispose());
      (fillMesh.material as THREE.Material).dispose();
    }
  };
}
