// WGSL port of the reference Slug vertex shader
// Original HLSL by Eric Lengyel, MIT License, Copyright 2017

struct Uniforms {
    slug_matrix: mat4x4<f32>,
    slug_viewport: vec2<f32>,
};

@group(0) @binding(0) var<uniform> u: Uniforms;

struct VertexInput {
    @location(0) a_pos: vec4<f32>,
    @location(1) a_tex: vec4<f32>,
    @location(2) a_jac: vec4<f32>,
    @location(3) a_bnd: vec4<f32>,
    @location(4) a_col: vec4<f32>,
};

struct VertexOutput {
    @builtin(position) position: vec4<f32>,
    @location(0) color: vec4<f32>,
    @location(1) texcoord: vec2<f32>,
    @location(2) @interpolate(flat) banding: vec4<f32>,
    @location(3) @interpolate(flat) glyph: vec4<i32>,
};

fn SlugUnpack(tex: vec4<f32>, bnd: vec4<f32>) -> VertexOutput {
    var out: VertexOutput;
    let g = bitcast<vec2<u32>>(tex.zw);
    out.glyph = vec4<i32>(
        i32(g.x & 0xFFFFu),
        i32(g.x >> 16u),
        i32(g.y & 0xFFFFu),
        i32(g.y >> 16u)
    );
    out.banding = bnd;
    return out;
}

fn SlugDilate(
    pos: vec4<f32>, tex: vec4<f32>, jac: vec4<f32>,
    m0: vec4<f32>, m1: vec4<f32>, m3: vec4<f32>,
    dim: vec2<f32>
) -> vec4<f32> {
    // Returns vec4(dilated_pos.xy, new_texcoord.xy)
    let n = normalize(pos.zw);
    let s = dot(m3.xy, pos.xy) + m3.w;
    let t = dot(m3.xy, n);

    let u_val = (s * dot(m0.xy, n) - t * (dot(m0.xy, pos.xy) + m0.w)) * dim.x;
    let v_val = (s * dot(m1.xy, n) - t * (dot(m1.xy, pos.xy) + m1.w)) * dim.y;

    let s2 = s * s;
    let st = s * t;
    let uv = u_val * u_val + v_val * v_val;
    let d = pos.zw * (s2 * (st + sqrt(uv)) / (uv - st * st));

    let vpos = pos.xy + d;
    let vtex = vec2<f32>(tex.x + dot(d, jac.xy), tex.y + dot(d, jac.zw));
    return vec4<f32>(vpos, vtex);
}

@vertex
fn vs_main(in: VertexInput) -> VertexOutput {
    let dilated = SlugDilate(
        in.a_pos, in.a_tex, in.a_jac,
        u.slug_matrix[0], u.slug_matrix[1], u.slug_matrix[3],
        u.slug_viewport
    );

    let p = dilated.xy;
    var out = SlugUnpack(in.a_tex, in.a_bnd);

    out.position = vec4<f32>(
        p.x * u.slug_matrix[0].x + p.y * u.slug_matrix[0].y + u.slug_matrix[0].w,
        p.x * u.slug_matrix[1].x + p.y * u.slug_matrix[1].y + u.slug_matrix[1].w,
        p.x * u.slug_matrix[2].x + p.y * u.slug_matrix[2].y + u.slug_matrix[2].w,
        p.x * u.slug_matrix[3].x + p.y * u.slug_matrix[3].y + u.slug_matrix[3].w
    );

    out.texcoord = dilated.zw;
    out.color = in.a_col;
    return out;
}
