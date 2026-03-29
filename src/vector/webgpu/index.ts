/// <reference types="@webgpu/types" />

import type { VectorGeometryData } from '../LoopBlinnGeometry';

interface GeometryResources {
  interiorPositionBuffer: GPUBuffer;
  interiorIndexBuffer: GPUBuffer;
  interiorIndexCount: number;
  interiorIndexFormat: GPUIndexFormat;
  curvePositionBuffer: GPUBuffer;
  curveVertexCount: number;
  fillPositionBuffer: GPUBuffer;
  fillIndexBuffer: GPUBuffer;
  fillIndexCount: number;
}

export interface WebGPUVectorRenderer {
  setGeometry(data: VectorGeometryData): void;
  render(
    passEncoder: GPURenderPassEncoder,
    mvp: Float32Array,
    color: Float32Array
  ): void;
  dispose(): void;
}

export interface WebGPUVectorRendererOptions {
  depthStencilFormat?: GPUTextureFormat;
  sampleCount?: number;
}

function createBufferWithData(
  device: GPUDevice,
  data: ArrayBufferView,
  usage: GPUBufferUsageFlags
): GPUBuffer {
  const byteLength = Math.max(4, data.byteLength);
  const buffer = device.createBuffer({
    size: byteLength,
    usage,
    mappedAtCreation: true
  });

  if (data.byteLength > 0) {
    const mapped = new Uint8Array(buffer.getMappedRange());
    mapped.set(new Uint8Array(data.buffer, data.byteOffset, data.byteLength));
  }

  buffer.unmap();
  return buffer;
}

function createGeometryResources(
  device: GPUDevice,
  data: VectorGeometryData
): GeometryResources {
  const interiorPositionBuffer = createBufferWithData(
    device,
    data.interiorPositions,
    GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST
  );
  const interiorIndexBuffer = createBufferWithData(
    device,
    data.interiorIndices,
    GPUBufferUsage.INDEX | GPUBufferUsage.COPY_DST
  );
  const curvePositionBuffer = createBufferWithData(
    device,
    data.curvePositions,
    GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST
  );

  const fillPositionBuffer = createBufferWithData(
    device,
    data.fillPositions,
    GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST
  );
  const fillIndexBuffer = createBufferWithData(
    device,
    data.fillIndices,
    GPUBufferUsage.INDEX | GPUBufferUsage.COPY_DST
  );

  return {
    interiorPositionBuffer,
    interiorIndexBuffer,
    interiorIndexCount: data.interiorIndices.length,
    interiorIndexFormat:
      data.interiorIndices instanceof Uint16Array ? 'uint16' : 'uint32',
    curvePositionBuffer,
    curveVertexCount: data.curvePositions.length / 3,
    fillPositionBuffer,
    fillIndexBuffer,
    fillIndexCount: data.fillIndices.length
  };
}

function destroyGeometryResources(resources: GeometryResources): void {
  resources.interiorPositionBuffer.destroy();
  resources.interiorIndexBuffer.destroy();
  resources.curvePositionBuffer.destroy();
  resources.fillPositionBuffer.destroy();
  resources.fillIndexBuffer.destroy();
}

export function createWebGPUVectorRenderer(
  device: GPUDevice,
  format: GPUTextureFormat,
  options: WebGPUVectorRendererOptions = {}
): WebGPUVectorRenderer {
  const depthStencilFormat = options.depthStencilFormat ?? 'depth24plus-stencil8';
  const sampleCount = options.sampleCount ?? 4;

  const uniformBuffer = device.createBuffer({
    size: 80,
    usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST
  });

  const bindGroupLayout = device.createBindGroupLayout({
    entries: [
      {
        binding: 0,
        visibility: GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT,
        buffer: { type: 'uniform' }
      }
    ]
  });

  const pipelineLayout = device.createPipelineLayout({
    bindGroupLayouts: [bindGroupLayout]
  });

  const bindGroup = device.createBindGroup({
    layout: bindGroupLayout,
    entries: [{ binding: 0, resource: { buffer: uniformBuffer } }]
  });

  const vertexBufferLayout: GPUVertexBufferLayout = {
    arrayStride: 12,
    attributes: [{ shaderLocation: 0, offset: 0, format: 'float32x3' }]
  };

  const baseVertexShader = `
struct Uniforms {
  mvp: mat4x4<f32>,
  color: vec4<f32>,
}

@group(0) @binding(0) var<uniform> uniforms: Uniforms;

struct VertexInput {
  @location(0) position: vec3<f32>,
}

struct VertexOutput {
  @builtin(position) position: vec4<f32>,
}

@vertex
fn main(input: VertexInput) -> VertexOutput {
  var output: VertexOutput;
  output.position = uniforms.mvp * vec4<f32>(input.position, 1.0);
  return output;
}`;

  const curveVertexShader = `
struct Uniforms {
  mvp: mat4x4<f32>,
  color: vec4<f32>,
}

@group(0) @binding(0) var<uniform> uniforms: Uniforms;

struct VertexInput {
  @location(0) position: vec3<f32>,
}

struct VertexOutput {
  @builtin(position) position: vec4<f32>,
  @location(0) uv: vec2<f32>,
}

@vertex
fn main(input: VertexInput, @builtin(vertex_index) vertexIndex: u32) -> VertexOutput {
  let localVertex = vertexIndex % 3u;
  let u = f32(localVertex) * 0.5;
  var output: VertexOutput;
  output.uv = vec2<f32>(u, floor(u));
  output.position = uniforms.mvp * vec4<f32>(input.position, 1.0);
  return output;
}`;

  const stencilFragmentShader = `
@fragment
fn main() -> @location(0) vec4<f32> {
  return vec4<f32>(1.0);
}`;

  const curveFragmentShader = `
struct FragmentInput {
  @location(0) uv: vec2<f32>,
}

@fragment
fn main(input: FragmentInput) -> @location(0) vec4<f32> {
  let px = dpdx(input.uv);
  let py = dpdy(input.uv);
  let fx = 2.0 * input.uv.x * px.x - px.y;
  let fy = 2.0 * input.uv.x * py.x - py.y;
  let denom = sqrt(fx * fx + fy * fy);

  if (denom < 1e-6) {
    discard;
  }

  let sd = (input.uv.x * input.uv.x - input.uv.y) / denom;
  let alpha = clamp(0.5 - sd, 0.0, 1.0);
  if (alpha <= 0.0) {
    discard;
  }

  return vec4<f32>(1.0, 1.0, 1.0, alpha);
}`;

  const colorFragmentShader = `
struct Uniforms {
  mvp: mat4x4<f32>,
  color: vec4<f32>,
}

@group(0) @binding(0) var<uniform> uniforms: Uniforms;

@fragment
fn main() -> @location(0) vec4<f32> {
  return uniforms.color;
}`;

  const baseStencilStateFront: GPUStencilFaceState = {
    compare: 'always',
    failOp: 'keep',
    depthFailOp: 'keep',
    passOp: 'invert'
  };

  const baseStencilStateBack: GPUStencilFaceState = {
    compare: 'always',
    failOp: 'keep',
    depthFailOp: 'keep',
    passOp: 'invert'
  };

  const colorStencilStateFront: GPUStencilFaceState = {
    compare: 'not-equal',
    failOp: 'keep',
    depthFailOp: 'keep',
    passOp: 'zero'
  };

  const colorStencilStateBack: GPUStencilFaceState = {
    compare: 'not-equal',
    failOp: 'keep',
    depthFailOp: 'keep',
    passOp: 'zero'
  };

  const interiorPipeline = device.createRenderPipeline({
    layout: pipelineLayout,
    vertex: {
      module: device.createShaderModule({ code: baseVertexShader }),
      entryPoint: 'main',
      buffers: [vertexBufferLayout]
    },
    fragment: {
      module: device.createShaderModule({ code: stencilFragmentShader }),
      entryPoint: 'main',
      targets: [{ format, writeMask: 0 }]
    },
    primitive: {
      topology: 'triangle-list',
      cullMode: 'none'
    },
    depthStencil: {
      format: depthStencilFormat,
      depthWriteEnabled: false,
      depthCompare: 'always',
      stencilFront: baseStencilStateFront,
      stencilBack: baseStencilStateBack,
      stencilReadMask: 0xff,
      stencilWriteMask: 0xff
    },
    multisample: {
      count: sampleCount,
      alphaToCoverageEnabled: false
    }
  });

  const curvePipeline = device.createRenderPipeline({
    layout: pipelineLayout,
    vertex: {
      module: device.createShaderModule({ code: curveVertexShader }),
      entryPoint: 'main',
      buffers: [vertexBufferLayout]
    },
    fragment: {
      module: device.createShaderModule({ code: curveFragmentShader }),
      entryPoint: 'main',
      targets: [{ format, writeMask: 0 }]
    },
    primitive: {
      topology: 'triangle-list',
      cullMode: 'none'
    },
    depthStencil: {
      format: depthStencilFormat,
      depthWriteEnabled: false,
      depthCompare: 'always',
      stencilFront: baseStencilStateFront,
      stencilBack: baseStencilStateBack,
      stencilReadMask: 0xff,
      stencilWriteMask: 0xff
    },
    multisample: {
      count: sampleCount,
      alphaToCoverageEnabled: true
    }
  });

  const colorPipeline = device.createRenderPipeline({
    layout: pipelineLayout,
    vertex: {
      module: device.createShaderModule({ code: baseVertexShader }),
      entryPoint: 'main',
      buffers: [vertexBufferLayout]
    },
    fragment: {
      module: device.createShaderModule({ code: colorFragmentShader }),
      entryPoint: 'main',
      targets: [{ format, writeMask: GPUColorWrite.ALL }]
    },
    primitive: {
      topology: 'triangle-list',
      cullMode: 'none'
    },
    depthStencil: {
      format: depthStencilFormat,
      depthWriteEnabled: false,
      depthCompare: 'always',
      stencilFront: colorStencilStateFront,
      stencilBack: colorStencilStateBack,
      stencilReadMask: 0xff,
      stencilWriteMask: 0xff
    },
    multisample: {
      count: sampleCount,
      alphaToCoverageEnabled: false
    }
  });

  const uniformData = new Float32Array(20);
  let geometryResources: GeometryResources | null = null;

  return {
    setGeometry(data: VectorGeometryData): void {
      if (geometryResources) {
        destroyGeometryResources(geometryResources);
      }
      geometryResources = createGeometryResources(device, data);
    },

    render(
      passEncoder: GPURenderPassEncoder,
      mvp: Float32Array,
      color: Float32Array
    ): void {
      if (!geometryResources) {
        return;
      }

      uniformData.set(mvp, 0);
      uniformData[16] = color[0];
      uniformData[17] = color[1];
      uniformData[18] = color[2];
      uniformData[19] = color[3];
      device.queue.writeBuffer(uniformBuffer, 0, uniformData);

      passEncoder.setBindGroup(0, bindGroup);
      passEncoder.setStencilReference(0);

      if (geometryResources.interiorIndexCount > 0) {
        passEncoder.setPipeline(interiorPipeline);
        passEncoder.setVertexBuffer(0, geometryResources.interiorPositionBuffer);
        passEncoder.setIndexBuffer(
          geometryResources.interiorIndexBuffer,
          geometryResources.interiorIndexFormat
        );
        passEncoder.drawIndexed(geometryResources.interiorIndexCount);
      }

      if (geometryResources.curveVertexCount > 0) {
        passEncoder.setPipeline(curvePipeline);
        passEncoder.setVertexBuffer(0, geometryResources.curvePositionBuffer);
        passEncoder.draw(geometryResources.curveVertexCount);
      }

      passEncoder.setPipeline(colorPipeline);
      passEncoder.setVertexBuffer(0, geometryResources.fillPositionBuffer);
      passEncoder.setIndexBuffer(geometryResources.fillIndexBuffer, 'uint32');
      passEncoder.drawIndexed(geometryResources.fillIndexCount);
    },

    dispose(): void {
      if (geometryResources) {
        destroyGeometryResources(geometryResources);
        geometryResources = null;
      }
      uniformBuffer.destroy();
    }
  };
}
