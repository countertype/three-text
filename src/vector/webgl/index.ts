// Raw WebGL2 Slug vector text renderer
// Standalone, no dependency on Three.js

import type { SlugGPUData } from '../slug/types';
import { vertexShaderGLSL300, fragmentShaderGLSL300 } from '../slug/shaderStrings';

export interface WebGLVectorRenderer {
  setGeometry(data: SlugGPUData): void;
  render(mvp: Float32Array, color: Float32Array): void;
  dispose(): void;
}

function compileShader(gl: WebGL2RenderingContext, type: number, source: string): WebGLShader {
  const shader = gl.createShader(type);
  if (!shader) throw new Error('Failed to create shader');
  gl.shaderSource(shader, source);
  gl.compileShader(shader);
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    const info = gl.getShaderInfoLog(shader);
    gl.deleteShader(shader);
    throw new Error(`Shader compile failed: ${info}`);
  }
  return shader;
}

function createProgram(gl: WebGL2RenderingContext, vsSrc: string, fsSrc: string): WebGLProgram {
  const vs = compileShader(gl, gl.VERTEX_SHADER, vsSrc);
  const fs = compileShader(gl, gl.FRAGMENT_SHADER, fsSrc);
  const prog = gl.createProgram();
  if (!prog) throw new Error('Failed to create program');
  gl.attachShader(prog, vs);
  gl.attachShader(prog, fs);
  gl.linkProgram(prog);
  if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) {
    const info = gl.getProgramInfoLog(prog);
    gl.deleteProgram(prog);
    throw new Error(`Program link failed: ${info}`);
  }
  gl.deleteShader(vs);
  gl.deleteShader(fs);
  return prog;
}

function createRGBA32FTexture(
  gl: WebGL2RenderingContext,
  data: Float32Array,
  width: number,
  height: number
): WebGLTexture {
  const tex = gl.createTexture();
  if (!tex) throw new Error('Failed to create texture');
  gl.bindTexture(gl.TEXTURE_2D, tex);
  gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA32F, width, height, 0, gl.RGBA, gl.FLOAT, data);
  gl.bindTexture(gl.TEXTURE_2D, null);
  return tex;
}

function createRGBA32UITexture(
  gl: WebGL2RenderingContext,
  data: Uint32Array,
  width: number,
  height: number
): WebGLTexture {
  const tex = gl.createTexture();
  if (!tex) throw new Error('Failed to create texture');
  gl.bindTexture(gl.TEXTURE_2D, tex);
  gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA32UI, width, height, 0, gl.RGBA_INTEGER, gl.UNSIGNED_INT, data);
  gl.bindTexture(gl.TEXTURE_2D, null);
  return tex;
}

interface WebGL2Resources {
  program: WebGLProgram;
  vao: WebGLVertexArrayObject;
  vbo: WebGLBuffer;
  ibo: WebGLBuffer;
  curveTexture: WebGLTexture;
  bandTexture: WebGLTexture;
  uniforms: {
    slug_matrix: WebGLUniformLocation;
    slug_viewport: WebGLUniformLocation;
    curveTexture: WebGLUniformLocation;
    bandTexture: WebGLUniformLocation;
  };
  indexCount: number;
}

function createResources(gl: WebGL2RenderingContext, gpuData: SlugGPUData, fragSrc: string): WebGL2Resources {
  gl.getExtension('EXT_color_buffer_float');

  const program = createProgram(gl, vertexShaderGLSL300, fragSrc);

  const uniforms = {
    slug_matrix: gl.getUniformLocation(program, 'slug_matrix')!,
    slug_viewport: gl.getUniformLocation(program, 'slug_viewport')!,
    curveTexture: gl.getUniformLocation(program, 'curveTexture')!,
    bandTexture: gl.getUniformLocation(program, 'bandTexture')!,
  };

  const vao = gl.createVertexArray();
  if (!vao) throw new Error('Failed to create VAO');
  gl.bindVertexArray(vao);

  const vbo = gl.createBuffer();
  if (!vbo) throw new Error('Failed to create VBO');
  gl.bindBuffer(gl.ARRAY_BUFFER, vbo);
  gl.bufferData(gl.ARRAY_BUFFER, gpuData.vertices, gl.STATIC_DRAW);

  const stride = 20 * 4;
  gl.enableVertexAttribArray(0);
  gl.vertexAttribPointer(0, 4, gl.FLOAT, false, stride, 0);
  gl.enableVertexAttribArray(1);
  gl.vertexAttribPointer(1, 4, gl.FLOAT, false, stride, 4 * 4);
  gl.enableVertexAttribArray(2);
  gl.vertexAttribPointer(2, 4, gl.FLOAT, false, stride, 8 * 4);
  gl.enableVertexAttribArray(3);
  gl.vertexAttribPointer(3, 4, gl.FLOAT, false, stride, 12 * 4);
  gl.enableVertexAttribArray(4);
  gl.vertexAttribPointer(4, 4, gl.FLOAT, false, stride, 16 * 4);

  const ibo = gl.createBuffer();
  if (!ibo) throw new Error('Failed to create IBO');
  gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, ibo);
  gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, gpuData.indices, gl.STATIC_DRAW);

  gl.bindVertexArray(null);

  const curveTexture = createRGBA32FTexture(
    gl, gpuData.curveTexture.data, gpuData.curveTexture.width, gpuData.curveTexture.height
  );
  const bandTexture = createRGBA32UITexture(
    gl, gpuData.bandTexture.data, gpuData.bandTexture.width, gpuData.bandTexture.height
  );

  return { program, vao, vbo, ibo, curveTexture, bandTexture, uniforms, indexCount: gpuData.indices.length };
}

function draw(
  gl: WebGL2RenderingContext,
  res: WebGL2Resources,
  mvpMatrix: Float32Array,
  viewportWidth: number,
  viewportHeight: number
): void {
  gl.useProgram(res.program);
  gl.uniformMatrix4fv(res.uniforms.slug_matrix, false, mvpMatrix);
  gl.uniform2f(res.uniforms.slug_viewport, viewportWidth, viewportHeight);

  gl.activeTexture(gl.TEXTURE0);
  gl.bindTexture(gl.TEXTURE_2D, res.curveTexture);
  gl.uniform1i(res.uniforms.curveTexture, 0);

  gl.activeTexture(gl.TEXTURE1);
  gl.bindTexture(gl.TEXTURE_2D, res.bandTexture);
  gl.uniform1i(res.uniforms.bandTexture, 1);

  gl.bindVertexArray(res.vao);
  gl.enable(gl.BLEND);
  gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
  gl.drawElements(gl.TRIANGLES, res.indexCount, gl.UNSIGNED_SHORT, 0);
  gl.bindVertexArray(null);
}

export interface WebGLVectorRendererOptions {
  // Enable rotated RGSS-4 adaptive supersampling (4 samples per pixel)
  adaptiveSupersampling?: boolean;
}

export function createWebGLVectorRenderer(
  gl: WebGL2RenderingContext,
  options?: WebGLVectorRendererOptions
): WebGLVectorRenderer {
  let resources: WebGL2Resources | null = null;
  const fragSrc = options?.adaptiveSupersampling
    ? '#define SLUG_ADAPTIVE_SUPERSAMPLE\n' + fragmentShaderGLSL300
    : fragmentShaderGLSL300;

  return {
    setGeometry(data: SlugGPUData): void {
      if (resources) this.dispose();
      resources = createResources(gl, data, fragSrc);
    },

    render(mvp: Float32Array, _color: Float32Array): void {
      if (!resources) return;
      draw(gl, resources, mvp, gl.drawingBufferWidth, gl.drawingBufferHeight);
    },

    dispose(): void {
      if (!resources) return;
      const gl2 = gl;
      gl2.deleteTexture(resources.curveTexture);
      gl2.deleteTexture(resources.bandTexture);
      gl2.deleteBuffer(resources.vbo);
      gl2.deleteBuffer(resources.ibo);
      gl2.deleteVertexArray(resources.vao);
      gl2.deleteProgram(resources.program);
      resources = null;
    }
  };
}

export type { SlugGPUData };
