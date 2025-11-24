// WebGL adapter - lightweight utility to create WebGL buffers from core geometry

import type { TextGeometryInfo } from '../core/types';

export interface WebGLBufferSet {
  buffers: {
    position: WebGLBuffer;
    normal: WebGLBuffer;
    color?: WebGLBuffer;
    indices: WebGLBuffer;
    glyphCenter?: WebGLBuffer;
    glyphIndex?: WebGLBuffer;
    glyphLineIndex?: WebGLBuffer;
  };
  attributes: {
    position: { size: number; type: GLenum; normalized: boolean };
    normal: { size: number; type: GLenum; normalized: boolean };
    color?: { size: number; type: GLenum; normalized: boolean };
    glyphCenter?: { size: number; type: GLenum; normalized: boolean };
    glyphIndex?: { size: number; type: GLenum; normalized: boolean };
    glyphLineIndex?: { size: number; type: GLenum; normalized: boolean };
  };
  drawCount: number;
  mode: GLenum;
  dispose(): void;
}

export function createWebGLBuffers(
  gl: WebGLRenderingContext | WebGL2RenderingContext,
  textGeometry: TextGeometryInfo
): WebGLBufferSet {
  const { vertices, normals, indices, colors, glyphAttributes } = textGeometry;

  // Create position buffer
  const positionBuffer = gl.createBuffer();
  if (!positionBuffer) throw new Error('Failed to create position buffer');
  gl.bindBuffer(gl.ARRAY_BUFFER, positionBuffer);
  gl.bufferData(gl.ARRAY_BUFFER, vertices, gl.STATIC_DRAW);

  // Create normal buffer
  const normalBuffer = gl.createBuffer();
  if (!normalBuffer) throw new Error('Failed to create normal buffer');
  gl.bindBuffer(gl.ARRAY_BUFFER, normalBuffer);
  gl.bufferData(gl.ARRAY_BUFFER, normals, gl.STATIC_DRAW);

  // Create index buffer
  const indexBuffer = gl.createBuffer();
  if (!indexBuffer) throw new Error('Failed to create index buffer');
  gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, indexBuffer);
  gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, indices, gl.STATIC_DRAW);

  const buffers: WebGLBufferSet['buffers'] = {
    position: positionBuffer,
    normal: normalBuffer,
    indices: indexBuffer
  };

  const attributes: WebGLBufferSet['attributes'] = {
    position: { size: 3, type: gl.FLOAT, normalized: false },
    normal: { size: 3, type: gl.FLOAT, normalized: false }
  };

  // Optional color buffer
  if (colors) {
    const colorBuffer = gl.createBuffer();
    if (!colorBuffer) throw new Error('Failed to create color buffer');
    gl.bindBuffer(gl.ARRAY_BUFFER, colorBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, colors, gl.STATIC_DRAW);
    buffers.color = colorBuffer;
    attributes.color = { size: 3, type: gl.FLOAT, normalized: false };
  }

  // Optional glyph attribute buffers
  if (glyphAttributes) {
    const glyphCenterBuffer = gl.createBuffer();
    if (!glyphCenterBuffer) throw new Error('Failed to create glyphCenter buffer');
    gl.bindBuffer(gl.ARRAY_BUFFER, glyphCenterBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, glyphAttributes.glyphCenter, gl.STATIC_DRAW);
    buffers.glyphCenter = glyphCenterBuffer;
    attributes.glyphCenter = { size: 3, type: gl.FLOAT, normalized: false };

    const glyphIndexBuffer = gl.createBuffer();
    if (!glyphIndexBuffer) throw new Error('Failed to create glyphIndex buffer');
    gl.bindBuffer(gl.ARRAY_BUFFER, glyphIndexBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, glyphAttributes.glyphIndex, gl.STATIC_DRAW);
    buffers.glyphIndex = glyphIndexBuffer;
    attributes.glyphIndex = { size: 1, type: gl.FLOAT, normalized: false };

    const glyphLineIndexBuffer = gl.createBuffer();
    if (!glyphLineIndexBuffer) throw new Error('Failed to create glyphLineIndex buffer');
    gl.bindBuffer(gl.ARRAY_BUFFER, glyphLineIndexBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, glyphAttributes.glyphLineIndex, gl.STATIC_DRAW);
    buffers.glyphLineIndex = glyphLineIndexBuffer;
    attributes.glyphLineIndex = { size: 1, type: gl.FLOAT, normalized: false };
  }

  return {
    buffers,
    attributes,
    drawCount: indices.length,
    mode: gl.TRIANGLES,
    dispose() {
      gl.deleteBuffer(positionBuffer);
      gl.deleteBuffer(normalBuffer);
      gl.deleteBuffer(indexBuffer);
      if (buffers.color) gl.deleteBuffer(buffers.color);
      if (buffers.glyphCenter) gl.deleteBuffer(buffers.glyphCenter);
      if (buffers.glyphIndex) gl.deleteBuffer(buffers.glyphIndex);
      if (buffers.glyphLineIndex) gl.deleteBuffer(buffers.glyphLineIndex);
    }
  };
}

