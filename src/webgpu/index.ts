// WebGPU adapter - lightweight utility to create GPU buffers from core geometry

/// <reference types="@webgpu/types" />

import type { TextGeometryInfo } from '../core/types';

export interface WebGPUBufferSet {
  buffers: {
    vertex: GPUBuffer; // Interleaved position + normal
    color?: GPUBuffer;
    indices: GPUBuffer;
  };
  layout: {
    vertex: GPUVertexBufferLayout;
    color?: GPUVertexBufferLayout;
  };
  indexFormat: GPUIndexFormat;
  vertexCount: number;
  dispose(): void;
}

export function createWebGPUBuffers(
  device: GPUDevice,
  textGeometry: TextGeometryInfo
): WebGPUBufferSet {
  const { vertices, normals, indices, colors } = textGeometry;
  const vertexCount = indices.length;

  // Interleave position and normal data for better cache coherency
  // Layout: [px, py, pz, nx, ny, nz, px, py, pz, nx, ny, nz, ...]
  const interleavedData = new Float32Array((vertices.length / 3) * 6);
  for (let i = 0; i < vertices.length / 3; i++) {
    const baseIndex = i * 6;
    const vertIndex = i * 3;

    // Position (NO FLIP - pass through)
    interleavedData[baseIndex] = vertices[vertIndex];
    interleavedData[baseIndex + 1] = vertices[vertIndex + 1];
    interleavedData[baseIndex + 2] = vertices[vertIndex + 2];

    // Normal (NO FLIP - pass through)
    interleavedData[baseIndex + 3] = normals[vertIndex];
    interleavedData[baseIndex + 4] = normals[vertIndex + 1];
    interleavedData[baseIndex + 5] = normals[vertIndex + 2];
  }

  // Create vertex buffer with interleaved data
  const vertexBuffer = device.createBuffer({
    size: interleavedData.byteLength,
    usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST,
    mappedAtCreation: true
  });
  new Float32Array(vertexBuffer.getMappedRange()).set(interleavedData);
  vertexBuffer.unmap();

  // Create index buffer (NO FLIP - pass through)
  const indexBuffer = device.createBuffer({
    size: indices.byteLength,
    usage: GPUBufferUsage.INDEX | GPUBufferUsage.COPY_DST,
    mappedAtCreation: true
  });
  new Uint32Array(indexBuffer.getMappedRange()).set(indices);
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

  return {
    buffers,
    layout,
    indexFormat: 'uint32',
    vertexCount,
    dispose() {
      vertexBuffer.destroy();
      indexBuffer.destroy();
      if (colorBuffer) colorBuffer.destroy();
    }
  };
}
