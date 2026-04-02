export { packSlugData } from './SlugPacker';
export { lineToQuadratic, cubicToQuadratics } from './curveUtils';
export { unpackSlugVertices } from './unpackVertices';
export { vertexShaderGLSL300, fragmentShaderGLSL300, vertexShaderWGSL, fragmentShaderWGSL } from './shaderStrings';

export type {
  QuadCurve,
  SlugVec2,
  SlugShape,
  SlugPackedTexture,
  SlugGPUData,
  SlugPackOptions
} from './types';
export type { SlugVertexArrays } from './unpackVertices';

export { createSlugTSLMesh } from './slugTSL';
export type { SlugTSLMesh } from './slugTSL';
