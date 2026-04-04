#version 300 es
// GLSL 300 es port of the Slug vertex shader
// Eric Lengyel, MIT License, 2017

precision highp float;
precision highp int;

// Per-vertex attributes (5 x vec4, matching Slug reference layout)
layout(location = 0) in vec4 a_pos; // .xy = object-space position, .zw = outward normal
layout(location = 1) in vec4 a_tex; // .xy = em-space sample coords, .z = packed glyph loc, .w = packed band max + flags
layout(location = 2) in vec4 a_jac; // inverse Jacobian (2x2): (j00, j01, j10, j11)
layout(location = 3) in vec4 a_bnd; // (bandScaleX, bandScaleY, bandOffsetX, bandOffsetY)
layout(location = 4) in vec4 a_col; // vertex color RGBA

uniform mat4 slug_matrix;    // MVP matrix (rows as vec4s)
uniform vec2 slug_viewport;  // viewport dimensions in pixels

out vec4 v_color;
out vec2 v_texcoord;
flat out vec4 v_banding;
flat out ivec4 v_glyph;

void SlugUnpack(vec4 tex, vec4 bnd, out vec4 vbnd, out ivec4 vgly) {
    uvec2 g = floatBitsToUint(tex.zw);
    vgly = ivec4(g.x & 0xFFFFu, g.x >> 16u, g.y & 0xFFFFu, g.y >> 16u);
    vbnd = bnd;
}

vec2 SlugDilate(vec4 pos, vec4 tex, vec4 jac, vec4 m0, vec4 m1, vec4 m3, vec2 dim, out vec2 vpos) {
    vec2 n = normalize(pos.zw);
    float s = dot(m3.xy, pos.xy) + m3.w;
    float t = dot(m3.xy, n);

    float u = (s * dot(m0.xy, n) - t * (dot(m0.xy, pos.xy) + m0.w)) * dim.x;
    float v = (s * dot(m1.xy, n) - t * (dot(m1.xy, pos.xy) + m1.w)) * dim.y;

    float s2 = s * s;
    float st = s * t;
    float uv = u * u + v * v;
    vec2 d = pos.zw * (s2 * (st + sqrt(uv)) / (uv - st * st));

    vpos = pos.xy + d;
    return vec2(tex.x + dot(d, jac.xy), tex.y + dot(d, jac.zw));
}

void main() {
    vec2 p;

    // Dynamic dilation: expand quad by a pixel to prevent edge clipping
    v_texcoord = SlugDilate(a_pos, a_tex, a_jac,
                            slug_matrix[0], slug_matrix[1], slug_matrix[3],
                            slug_viewport, p);

    // MVP transform on dilated position
    gl_Position.x = p.x * slug_matrix[0].x + p.y * slug_matrix[0].y + slug_matrix[0].w;
    gl_Position.y = p.x * slug_matrix[1].x + p.y * slug_matrix[1].y + slug_matrix[1].w;
    gl_Position.z = p.x * slug_matrix[2].x + p.y * slug_matrix[2].y + slug_matrix[2].w;
    gl_Position.w = p.x * slug_matrix[3].x + p.y * slug_matrix[3].y + slug_matrix[3].w;

    SlugUnpack(a_tex, a_bnd, v_banding, v_glyph);
    v_color = a_col;
}
