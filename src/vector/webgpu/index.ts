/// <reference types="@webgpu/types" />

// Raw WebGPU Slug vector text renderer
// Standalone, no dependency on Three.js

import type { SlugGPUData } from '../slug/types';
import { vertexShaderWGSL, fragmentShaderWGSL } from '../slug/shaderStrings';

export interface WebGPUVectorRenderer {
  setGeometry(data: SlugGPUData): void;
  render(
    passEncoder: GPURenderPassEncoder,
    mvp: Float32Array,
    color: Float32Array,
    viewportWidth?: number,
    viewportHeight?: number
  ): void;
  dispose(): void;
}

export interface WebGPUVectorRendererOptions {
  sampleCount?: number;
}

interface WebGPUResources {
  pipeline: GPURenderPipeline;
  bindGroup: GPUBindGroup;
  vertexBuffer: GPUBuffer;
  indexBuffer: GPUBuffer;
  uniformBuffer: GPUBuffer;
  indexCount: number;
}

function createResources(
  device: GPUDevice,
  gpuData: SlugGPUData,
  format: GPUTextureFormat,
  sampleCount: number
): WebGPUResources {
  const uniformBuffer = device.createBuffer({
    size: 80,
    usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
  });

  const curveTexture = device.createTexture({
    size: [gpuData.curveTexture.width, gpuData.curveTexture.height],
    format: 'rgba32float',
    usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST,
  });
  device.queue.writeTexture(
    { texture: curveTexture },
    gpuData.curveTexture.data.buffer as ArrayBuffer,
    { bytesPerRow: gpuData.curveTexture.width * 16 },
    [gpuData.curveTexture.width, gpuData.curveTexture.height]
  );

  const bandTexture = device.createTexture({
    size: [gpuData.bandTexture.width, gpuData.bandTexture.height],
    format: 'rgba32uint',
    usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST,
  });
  device.queue.writeTexture(
    { texture: bandTexture },
    gpuData.bandTexture.data.buffer as ArrayBuffer,
    { bytesPerRow: gpuData.bandTexture.width * 16 },
    [gpuData.bandTexture.width, gpuData.bandTexture.height]
  );

  const vertexBuffer = device.createBuffer({
    size: gpuData.vertices.byteLength,
    usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST,
  });
  device.queue.writeBuffer(vertexBuffer, 0, gpuData.vertices.buffer as ArrayBuffer);

  const indexBuffer = device.createBuffer({
    size: gpuData.indices.byteLength,
    usage: GPUBufferUsage.INDEX | GPUBufferUsage.COPY_DST,
  });
  device.queue.writeBuffer(indexBuffer, 0, gpuData.indices.buffer as ArrayBuffer);

  const vertModule = device.createShaderModule({ code: vertexShaderWGSL });
  const fragModule = device.createShaderModule({ code: fragmentShaderWGSL });

  const bindGroupLayout = device.createBindGroupLayout({
    entries: [
      { binding: 0, visibility: GPUShaderStage.VERTEX, buffer: { type: 'uniform' } },
      { binding: 1, visibility: GPUShaderStage.FRAGMENT, texture: { sampleType: 'unfilterable-float' } },
      { binding: 2, visibility: GPUShaderStage.FRAGMENT, texture: { sampleType: 'uint' } },
    ],
  });

  const bindGroup = device.createBindGroup({
    layout: bindGroupLayout,
    entries: [
      { binding: 0, resource: { buffer: uniformBuffer } },
      { binding: 1, resource: curveTexture.createView() },
      { binding: 2, resource: bandTexture.createView() },
    ],
  });

  const pipelineLayout = device.createPipelineLayout({
    bindGroupLayouts: [bindGroupLayout],
  });

  const stride = 20 * 4;
  const vertexBufferLayout: GPUVertexBufferLayout = {
    arrayStride: stride,
    attributes: [
      { shaderLocation: 0, offset: 0, format: 'float32x4' },
      { shaderLocation: 1, offset: 16, format: 'float32x4' },
      { shaderLocation: 2, offset: 32, format: 'float32x4' },
      { shaderLocation: 3, offset: 48, format: 'float32x4' },
      { shaderLocation: 4, offset: 64, format: 'float32x4' },
    ],
  };

  const pipeline = device.createRenderPipeline({
    layout: pipelineLayout,
    vertex: {
      module: vertModule,
      entryPoint: 'vs_main',
      buffers: [vertexBufferLayout],
    },
    fragment: {
      module: fragModule,
      entryPoint: 'fs_main',
      targets: [{
        format,
        blend: {
          color: { srcFactor: 'src-alpha', dstFactor: 'one-minus-src-alpha', operation: 'add' },
          alpha: { srcFactor: 'one', dstFactor: 'one-minus-src-alpha', operation: 'add' },
        },
      }],
    },
    primitive: {
      topology: 'triangle-list',
      cullMode: 'none',
    },
    multisample: {
      count: sampleCount,
    },
  });

  return { pipeline, bindGroup, vertexBuffer, indexBuffer, uniformBuffer, indexCount: gpuData.indices.length };
}

function draw(
  device: GPUDevice,
  pass: GPURenderPassEncoder,
  res: WebGPUResources,
  mvpMatrix: Float32Array,
  viewportWidth: number,
  viewportHeight: number
): void {
  const uniformData = new Float32Array(20);
  uniformData.set(mvpMatrix, 0);
  uniformData[16] = viewportWidth;
  uniformData[17] = viewportHeight;
  device.queue.writeBuffer(res.uniformBuffer, 0, uniformData);

  pass.setPipeline(res.pipeline);
  pass.setBindGroup(0, res.bindGroup);
  pass.setVertexBuffer(0, res.vertexBuffer);
  pass.setIndexBuffer(res.indexBuffer, 'uint16');
  pass.drawIndexed(res.indexCount);
}

export function createWebGPUVectorRenderer(
  device: GPUDevice,
  format: GPUTextureFormat,
  options?: WebGPUVectorRendererOptions
): WebGPUVectorRenderer {
  let resources: WebGPUResources | null = null;
  const sampleCount = options?.sampleCount ?? 1;

  return {
    setGeometry(data: SlugGPUData): void {
      if (resources) this.dispose();
      resources = createResources(device, data, format, sampleCount);
    },

    render(
      passEncoder: GPURenderPassEncoder,
      mvp: Float32Array,
      _color: Float32Array,
      viewportWidth?: number,
      viewportHeight?: number
    ): void {
      if (!resources) return;
      draw(device, passEncoder, resources, mvp, viewportWidth ?? 1, viewportHeight ?? 1);
    },

    dispose(): void {
      if (!resources) return;
      resources.vertexBuffer.destroy();
      resources.indexBuffer.destroy();
      resources.uniformBuffer.destroy();
      resources = null;
    }
  };
}

export type { SlugGPUData };
