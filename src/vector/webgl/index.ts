import type { VectorGeometryData } from '../LoopBlinnGeometry';

interface ProgramWithMvp {
  program: WebGLProgram;
  mvp: WebGLUniformLocation;
}

interface ColorProgram extends ProgramWithMvp {
  color: WebGLUniformLocation;
}

interface GeometryResources {
  interiorVAO: WebGLVertexArrayObject;
  interiorPositionBuffer: WebGLBuffer;
  interiorIndexBuffer: WebGLBuffer;
  interiorIndexCount: number;
  curveVAO: WebGLVertexArrayObject;
  curvePositionBuffer: WebGLBuffer;
  curveVertexCount: number;
  fillVAO: WebGLVertexArrayObject;
  fillPositionBuffer: WebGLBuffer;
  fillIndexBuffer: WebGLBuffer;
  fillIndexCount: number;
}

export interface WebGLVectorRenderer {
  setGeometry(data: VectorGeometryData): void;
  render(mvp: Float32Array, color: Float32Array): void;
  dispose(): void;
}

function assertCreate<T>(value: T | null, label: string): T {
  if (!value) {
    throw new Error(`Failed to create ${label}`);
  }
  return value;
}

function compileShader(
  gl: WebGL2RenderingContext,
  type: GLenum,
  source: string
): WebGLShader {
  const shader = assertCreate(gl.createShader(type), 'shader');
  gl.shaderSource(shader, source);
  gl.compileShader(shader);

  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    const info = gl.getShaderInfoLog(shader) || 'unknown shader compile error';
    gl.deleteShader(shader);
    throw new Error(info);
  }

  return shader;
}

function linkProgram(
  gl: WebGL2RenderingContext,
  vertexSource: string,
  fragmentSource: string
): WebGLProgram {
  const vertexShader = compileShader(gl, gl.VERTEX_SHADER, vertexSource);
  const fragmentShader = compileShader(gl, gl.FRAGMENT_SHADER, fragmentSource);
  const program = assertCreate(gl.createProgram(), 'program');

  gl.attachShader(program, vertexShader);
  gl.attachShader(program, fragmentShader);
  gl.linkProgram(program);

  gl.deleteShader(vertexShader);
  gl.deleteShader(fragmentShader);

  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
    const info = gl.getProgramInfoLog(program) || 'unknown program link error';
    gl.deleteProgram(program);
    throw new Error(info);
  }

  return program;
}

function getUniform(
  gl: WebGL2RenderingContext,
  program: WebGLProgram,
  name: string
): WebGLUniformLocation {
  const location = gl.getUniformLocation(program, name);
  if (!location) {
    throw new Error(`Missing uniform "${name}"`);
  }
  return location;
}

function createProgramWithMvp(
  gl: WebGL2RenderingContext,
  vertexSource: string,
  fragmentSource: string
): ProgramWithMvp {
  const program = linkProgram(gl, vertexSource, fragmentSource);
  return {
    program,
    mvp: getUniform(gl, program, 'u_mvp')
  };
}

function createColorProgram(
  gl: WebGL2RenderingContext,
  vertexSource: string,
  fragmentSource: string
): ColorProgram {
  const program = linkProgram(gl, vertexSource, fragmentSource);
  return {
    program,
    mvp: getUniform(gl, program, 'u_mvp'),
    color: getUniform(gl, program, 'u_color')
  };
}

function createGeometryResources(
  gl: WebGL2RenderingContext,
  data: VectorGeometryData
): GeometryResources {
  const interiorVAO = assertCreate(gl.createVertexArray(), 'interior VAO');
  const interiorPositionBuffer = assertCreate(
    gl.createBuffer(),
    'interior position buffer'
  );
  const interiorIndexBuffer = assertCreate(gl.createBuffer(), 'interior index buffer');

  gl.bindVertexArray(interiorVAO);
  gl.bindBuffer(gl.ARRAY_BUFFER, interiorPositionBuffer);
  gl.bufferData(gl.ARRAY_BUFFER, data.interiorPositions, gl.STATIC_DRAW);
  gl.enableVertexAttribArray(0);
  gl.vertexAttribPointer(0, 3, gl.FLOAT, false, 0, 0);
  gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, interiorIndexBuffer);
  gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, data.interiorIndices, gl.STATIC_DRAW);

  const curveVAO = assertCreate(gl.createVertexArray(), 'curve VAO');
  const curvePositionBuffer = assertCreate(gl.createBuffer(), 'curve position buffer');

  gl.bindVertexArray(curveVAO);
  gl.bindBuffer(gl.ARRAY_BUFFER, curvePositionBuffer);
  gl.bufferData(gl.ARRAY_BUFFER, data.curvePositions, gl.STATIC_DRAW);
  gl.enableVertexAttribArray(0);
  gl.vertexAttribPointer(0, 3, gl.FLOAT, false, 0, 0);

  const fillVAO = assertCreate(gl.createVertexArray(), 'fill VAO');
  const fillPositionBuffer = assertCreate(gl.createBuffer(), 'fill position buffer');
  const fillIndexBuffer = assertCreate(gl.createBuffer(), 'fill index buffer');

  gl.bindVertexArray(fillVAO);
  gl.bindBuffer(gl.ARRAY_BUFFER, fillPositionBuffer);
  gl.bufferData(gl.ARRAY_BUFFER, data.fillPositions, gl.STATIC_DRAW);
  gl.enableVertexAttribArray(0);
  gl.vertexAttribPointer(0, 3, gl.FLOAT, false, 0, 0);
  gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, fillIndexBuffer);
  gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, data.fillIndices, gl.STATIC_DRAW);

  gl.bindVertexArray(null);
  gl.bindBuffer(gl.ARRAY_BUFFER, null);
  gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, null);

  return {
    interiorVAO,
    interiorPositionBuffer,
    interiorIndexBuffer,
    interiorIndexCount: data.interiorIndices.length,
    curveVAO,
    curvePositionBuffer,
    curveVertexCount: data.curvePositions.length / 3,
    fillVAO,
    fillPositionBuffer,
    fillIndexBuffer,
    fillIndexCount: data.fillIndices.length
  };
}

function destroyGeometryResources(
  gl: WebGL2RenderingContext,
  resources: GeometryResources
): void {
  gl.deleteVertexArray(resources.interiorVAO);
  gl.deleteBuffer(resources.interiorPositionBuffer);
  gl.deleteBuffer(resources.interiorIndexBuffer);
  gl.deleteVertexArray(resources.curveVAO);
  gl.deleteBuffer(resources.curvePositionBuffer);
  gl.deleteVertexArray(resources.fillVAO);
  gl.deleteBuffer(resources.fillPositionBuffer);
  gl.deleteBuffer(resources.fillIndexBuffer);
}

export function createWebGLVectorRenderer(
  gl: WebGL2RenderingContext
): WebGLVectorRenderer {
  const interiorVertexShader = `#version 300 es
layout(location = 0) in vec3 a_position;
uniform mat4 u_mvp;
void main() {
  gl_Position = u_mvp * vec4(a_position, 1.0);
}`;

  const interiorFragmentShader = `#version 300 es
precision highp float;
out vec4 outColor;
void main() {
  outColor = vec4(1.0);
}`;

  const curveVertexShader = `#version 300 es
layout(location = 0) in vec3 a_position;
uniform mat4 u_mvp;
out vec2 v_uv;
void main() {
  int localVertex = gl_VertexID % 3;
  float u = float(localVertex) * 0.5;
  v_uv = vec2(u, floor(u));
  gl_Position = u_mvp * vec4(a_position, 1.0);
}`;

  const curveFragmentShader = `#version 300 es
precision highp float;
in vec2 v_uv;
out vec4 outColor;
void main() {
  vec2 px = dFdx(v_uv);
  vec2 py = dFdy(v_uv);
  float fx = 2.0 * v_uv.x * px.x - px.y;
  float fy = 2.0 * v_uv.x * py.x - py.y;
  float denom = sqrt(fx * fx + fy * fy);
  if (denom < 1e-6) {
    discard;
  }
  float sd = (v_uv.x * v_uv.x - v_uv.y) / denom;
  float alpha = clamp(0.5 - sd, 0.0, 1.0);
  if (alpha <= 0.0) {
    discard;
  }
  outColor = vec4(1.0, 1.0, 1.0, alpha);
}`;

  const colorVertexShader = interiorVertexShader;
  const colorFragmentShader = `#version 300 es
precision highp float;
uniform vec4 u_color;
out vec4 outColor;
void main() {
  outColor = u_color;
}`;

  const interiorProgram = createProgramWithMvp(
    gl,
    interiorVertexShader,
    interiorFragmentShader
  );
  const curveProgram = createProgramWithMvp(gl, curveVertexShader, curveFragmentShader);
  const colorProgram = createColorProgram(gl, colorVertexShader, colorFragmentShader);

  let geometryResources: GeometryResources | null = null;

  return {
    setGeometry(data: VectorGeometryData): void {
      if (geometryResources) {
        destroyGeometryResources(gl, geometryResources);
      }
      geometryResources = createGeometryResources(gl, data);
    },

    render(mvp: Float32Array, color: Float32Array): void {
      if (!geometryResources) {
        return;
      }

      gl.disable(gl.CULL_FACE);
      gl.disable(gl.DEPTH_TEST);
      gl.depthMask(false);

      // No stencil clear needed - the fill pass resets stencil to 0
      // via passOp ZERO wherever stencil was non-zero, and per-glyph
      // fill quads cover all stencil writes from interior/curve passes
      gl.enable(gl.STENCIL_TEST);
      gl.stencilMask(0xff);
      gl.stencilFunc(gl.ALWAYS, 0, 0xff);
      // Nonzero winding: front faces increment, back faces decrement
      gl.stencilOpSeparate(gl.FRONT, gl.KEEP, gl.KEEP, gl.INCR_WRAP);
      gl.stencilOpSeparate(gl.BACK, gl.KEEP, gl.KEEP, gl.DECR_WRAP);
      gl.colorMask(false, false, false, false);

      if (geometryResources.interiorIndexCount > 0) {
        gl.useProgram(interiorProgram.program);
        gl.uniformMatrix4fv(interiorProgram.mvp, false, mvp);
        gl.bindVertexArray(geometryResources.interiorVAO);
        gl.drawElements(
          gl.TRIANGLES,
          geometryResources.interiorIndexCount,
          gl.UNSIGNED_INT,
          0
        );
      }

      if (geometryResources.curveVertexCount > 0) {
        gl.enable(gl.SAMPLE_ALPHA_TO_COVERAGE);
        gl.useProgram(curveProgram.program);
        gl.uniformMatrix4fv(curveProgram.mvp, false, mvp);
        gl.bindVertexArray(geometryResources.curveVAO);
        gl.drawArrays(gl.TRIANGLES, 0, geometryResources.curveVertexCount);
        gl.disable(gl.SAMPLE_ALPHA_TO_COVERAGE);
      }

      gl.stencilFunc(gl.NOTEQUAL, 0, 0xff);
      gl.stencilOp(gl.KEEP, gl.KEEP, gl.ZERO);
      gl.colorMask(true, true, true, true);

      gl.useProgram(colorProgram.program);
      gl.uniformMatrix4fv(colorProgram.mvp, false, mvp);
      gl.uniform4fv(colorProgram.color, color);
      gl.bindVertexArray(geometryResources.fillVAO);
      gl.drawElements(gl.TRIANGLES, geometryResources.fillIndexCount, gl.UNSIGNED_INT, 0);

      gl.bindVertexArray(null);
      gl.useProgram(null);
      gl.disable(gl.STENCIL_TEST);
      gl.depthMask(true);
    },

    dispose(): void {
      if (geometryResources) {
        destroyGeometryResources(gl, geometryResources);
        geometryResources = null;
      }
      gl.deleteProgram(interiorProgram.program);
      gl.deleteProgram(curveProgram.program);
      gl.deleteProgram(colorProgram.program);
    }
  };
}
