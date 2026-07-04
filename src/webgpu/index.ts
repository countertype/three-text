// WebGPU adapter - lightweight utility to create GPU buffers from core geometry

/// <reference types="@webgpu/types" />

import type { TextGeometryInfo } from '../core/types';

export interface WebGPUBufferSet {
  buffers: {
    vertex: GPUBuffer; // Interleaved position + normal
    color?: GPUBuffer;
    indices: GPUBuffer;
    glyphCenter?: GPUBuffer;
    glyphIndex?: GPUBuffer;
    glyphLineIndex?: GPUBuffer;
    glyphProgress?: GPUBuffer;
    glyphBaselineY?: GPUBuffer;
  };
  layout: {
    vertex: GPUVertexBufferLayout;
    color?: GPUVertexBufferLayout;
    glyphCenter?: GPUVertexBufferLayout;
    glyphIndex?: GPUVertexBufferLayout;
    glyphLineIndex?: GPUVertexBufferLayout;
    glyphProgress?: GPUVertexBufferLayout;
    glyphBaselineY?: GPUVertexBufferLayout;
  };
  indexCount: number;
  indexFormat: GPUIndexFormat;
  dispose(): void;
}

export function createWebGPUBuffers(
  device: GPUDevice,
  textGeometry: TextGeometryInfo
): WebGPUBufferSet {
  const { vertices, normals, indices, colors, glyphAttributes } = textGeometry;
  const indexCount = indices.length;
  const indexFormat: GPUIndexFormat =
    indices instanceof Uint16Array ? 'uint16' : 'uint32';

  // Interleave position and normal data for cache coherency,
  // written directly into the mapped GPU buffer
  // Layout: [px, py, pz, nx, ny, nz, px, py, pz, nx, ny, nz, ...]
  const vertexCount = vertices.length / 3;
  const vertexBuffer = device.createBuffer({
    size: vertexCount * 6 * 4,
    usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST,
    mappedAtCreation: true
  });
  const interleavedData = new Float32Array(vertexBuffer.getMappedRange());
  for (let i = 0; i < vertexCount; i++) {
    const baseIndex = i * 6;
    const vertIndex = i * 3;

    // Position
    interleavedData[baseIndex] = vertices[vertIndex];
    interleavedData[baseIndex + 1] = vertices[vertIndex + 1];
    interleavedData[baseIndex + 2] = vertices[vertIndex + 2];

    // Normal
    interleavedData[baseIndex + 3] = normals[vertIndex];
    interleavedData[baseIndex + 4] = normals[vertIndex + 1];
    interleavedData[baseIndex + 5] = normals[vertIndex + 2];
  }
  vertexBuffer.unmap();

  // mappedAtCreation requires a 4-byte-aligned size, and the mapped view
  // must match the element type of the indices
  const indexBuffer = device.createBuffer({
    size: (indices.byteLength + 3) & ~3,
    usage: GPUBufferUsage.INDEX | GPUBufferUsage.COPY_DST,
    mappedAtCreation: true
  });
  const indexSource = indices as Uint32Array | Uint16Array;
  if (indexSource instanceof Uint16Array) {
    new Uint16Array(indexBuffer.getMappedRange(), 0, indexSource.length).set(
      indexSource
    );
  } else {
    new Uint32Array(indexBuffer.getMappedRange(), 0, indexSource.length).set(
      indexSource
    );
  }
  indexBuffer.unmap();

  // Vertex buffer layout for interleaved data
  const vertexLayout: GPUVertexBufferLayout = {
    arrayStride: 24, // 6 floats * 4 bytes = 24 bytes per vertex
    attributes: [
      {
        shaderLocation: 0,
        offset: 0,
        format: 'float32x3' // position
      },
      {
        shaderLocation: 1,
        offset: 12, // 3 floats * 4 bytes
        format: 'float32x3' // normal
      }
    ]
  };

  const buffers: WebGPUBufferSet['buffers'] = {
    vertex: vertexBuffer,
    indices: indexBuffer
  };

  const layout: WebGPUBufferSet['layout'] = {
    vertex: vertexLayout
  };

  // Optional color buffer
  let colorBuffer: GPUBuffer | undefined;
  let colorLayout: GPUVertexBufferLayout | undefined;

  if (colors) {
    colorBuffer = device.createBuffer({
      size: colors.byteLength,
      usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST,
      mappedAtCreation: true
    });
    new Float32Array(colorBuffer.getMappedRange()).set(colors);
    colorBuffer.unmap();

    colorLayout = {
      arrayStride: 12, // 3 floats * 4 bytes
      attributes: [
        {
          shaderLocation: 2,
          offset: 0,
          format: 'float32x3'
        }
      ]
    };

    buffers.color = colorBuffer;
    layout.color = colorLayout;
  }

  // Optional glyph attribute buffers
  let glyphCenterBuffer: GPUBuffer | undefined;
  let glyphIndexBuffer: GPUBuffer | undefined;
  let glyphLineIndexBuffer: GPUBuffer | undefined;
  let glyphProgressBuffer: GPUBuffer | undefined;
  let glyphBaselineYBuffer: GPUBuffer | undefined;

  if (glyphAttributes) {
    let nextShaderLocation = colors ? 3 : 2;

    glyphCenterBuffer = device.createBuffer({
      size: glyphAttributes.glyphCenter.byteLength,
      usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST,
      mappedAtCreation: true
    });
    new Float32Array(glyphCenterBuffer.getMappedRange()).set(
      glyphAttributes.glyphCenter
    );
    glyphCenterBuffer.unmap();
    buffers.glyphCenter = glyphCenterBuffer;
    layout.glyphCenter = {
      arrayStride: 12,
      attributes: [
        { shaderLocation: nextShaderLocation++, offset: 0, format: 'float32x3' }
      ]
    };

    glyphIndexBuffer = device.createBuffer({
      size: glyphAttributes.glyphIndex.byteLength,
      usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST,
      mappedAtCreation: true
    });
    new Float32Array(glyphIndexBuffer.getMappedRange()).set(
      glyphAttributes.glyphIndex
    );
    glyphIndexBuffer.unmap();
    buffers.glyphIndex = glyphIndexBuffer;
    layout.glyphIndex = {
      arrayStride: 4,
      attributes: [
        { shaderLocation: nextShaderLocation++, offset: 0, format: 'float32' }
      ]
    };

    glyphLineIndexBuffer = device.createBuffer({
      size: glyphAttributes.glyphLineIndex.byteLength,
      usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST,
      mappedAtCreation: true
    });
    new Float32Array(glyphLineIndexBuffer.getMappedRange()).set(
      glyphAttributes.glyphLineIndex
    );
    glyphLineIndexBuffer.unmap();
    buffers.glyphLineIndex = glyphLineIndexBuffer;
    layout.glyphLineIndex = {
      arrayStride: 4,
      attributes: [
        { shaderLocation: nextShaderLocation++, offset: 0, format: 'float32' }
      ]
    };

    glyphProgressBuffer = device.createBuffer({
      size: glyphAttributes.glyphProgress.byteLength,
      usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST,
      mappedAtCreation: true
    });
    new Float32Array(glyphProgressBuffer.getMappedRange()).set(
      glyphAttributes.glyphProgress
    );
    glyphProgressBuffer.unmap();
    buffers.glyphProgress = glyphProgressBuffer;
    layout.glyphProgress = {
      arrayStride: 4,
      attributes: [
        { shaderLocation: nextShaderLocation++, offset: 0, format: 'float32' }
      ]
    };

    glyphBaselineYBuffer = device.createBuffer({
      size: glyphAttributes.glyphBaselineY.byteLength,
      usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST,
      mappedAtCreation: true
    });
    new Float32Array(glyphBaselineYBuffer.getMappedRange()).set(
      glyphAttributes.glyphBaselineY
    );
    glyphBaselineYBuffer.unmap();
    buffers.glyphBaselineY = glyphBaselineYBuffer;
    layout.glyphBaselineY = {
      arrayStride: 4,
      attributes: [
        { shaderLocation: nextShaderLocation++, offset: 0, format: 'float32' }
      ]
    };
  }

  return {
    buffers,
    layout,
    indexCount,
    indexFormat,
    dispose() {
      vertexBuffer.destroy();
      indexBuffer.destroy();
      if (colorBuffer) colorBuffer.destroy();
      if (glyphCenterBuffer) glyphCenterBuffer.destroy();
      if (glyphIndexBuffer) glyphIndexBuffer.destroy();
      if (glyphLineIndexBuffer) glyphLineIndexBuffer.destroy();
      if (glyphProgressBuffer) glyphProgressBuffer.destroy();
      if (glyphBaselineYBuffer) glyphBaselineYBuffer.destroy();
    }
  };
}
