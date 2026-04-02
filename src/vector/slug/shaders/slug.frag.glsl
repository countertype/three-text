#version 300 es
// GLSL 300 es port of the Slug fragment shader
// Eric Lengyel, MIT License, 2017

precision highp float;
precision highp int;

#define kLogBandTextureWidth 12

in vec4 v_color;
in vec2 v_texcoord;
flat in vec4 v_banding;
flat in ivec4 v_glyph;

uniform sampler2D curveTexture;     // RGBA32F control points
uniform highp usampler2D bandTexture; // RGBA32UI band data

layout(location = 0) out vec4 outColor;

uint CalcRootCode(float y1, float y2, float y3) {
    uint i1 = floatBitsToUint(y1) >> 31u;
    uint i2 = floatBitsToUint(y2) >> 30u;
    uint i3 = floatBitsToUint(y3) >> 29u;

    uint shift = (i2 & 2u) | (i1 & ~2u);
    shift = (i3 & 4u) | (shift & ~4u);

    return (0x2E74u >> shift) & 0x0101u;
}

vec2 SolveHorizPoly(vec4 p12, vec2 p3) {
    vec2 a = p12.xy - p12.zw * 2.0 + p3;
    vec2 b = p12.xy - p12.zw;
    float ra = 1.0 / a.y;
    float rb = 0.5 / b.y;

    float d = sqrt(max(b.y * b.y - a.y * p12.y, 0.0));
    float t1 = (b.y - d) * ra;
    float t2 = (b.y + d) * ra;

    if (abs(a.y) < 1.0 / 65536.0) t1 = t2 = p12.y * rb;

    return vec2((a.x * t1 - b.x * 2.0) * t1 + p12.x, (a.x * t2 - b.x * 2.0) * t2 + p12.x);
}

vec2 SolveVertPoly(vec4 p12, vec2 p3) {
    vec2 a = p12.xy - p12.zw * 2.0 + p3;
    vec2 b = p12.xy - p12.zw;
    float ra = 1.0 / a.x;
    float rb = 0.5 / b.x;

    float d = sqrt(max(b.x * b.x - a.x * p12.x, 0.0));
    float t1 = (b.x - d) * ra;
    float t2 = (b.x + d) * ra;

    if (abs(a.x) < 1.0 / 65536.0) t1 = t2 = p12.x * rb;

    return vec2((a.y * t1 - b.y * 2.0) * t1 + p12.y, (a.y * t2 - b.y * 2.0) * t2 + p12.y);
}

ivec2 CalcBandLoc(ivec2 glyphLoc, uint offset) {
    ivec2 bandLoc = ivec2(glyphLoc.x + int(offset), glyphLoc.y);
    bandLoc.y += bandLoc.x >> kLogBandTextureWidth;
    bandLoc.x &= (1 << kLogBandTextureWidth) - 1;
    return bandLoc;
}

float CalcCoverage(float xcov, float ycov, float xwgt, float ywgt, int flags) {
    float coverage = max(abs(xcov * xwgt + ycov * ywgt) / max(xwgt + ywgt, 1.0 / 65536.0), min(abs(xcov), abs(ycov)));

#if defined(SLUG_EVENODD)
    if ((flags & 0x1000) == 0) {
#endif
        coverage = clamp(coverage, 0.0, 1.0);
#if defined(SLUG_EVENODD)
    } else {
        coverage = 1.0 - abs(1.0 - fract(coverage * 0.5) * 2.0);
    }
#endif

#if defined(SLUG_WEIGHT)
    coverage = sqrt(coverage);
#endif

    return coverage;
}

float SlugRenderSingle(vec2 renderCoord, vec2 emsPerPixel, vec4 bandTransform, ivec4 glyphData) {
    int curveIndex;

    vec2 pixelsPerEm = 1.0 / emsPerPixel;

    ivec2 bandMax = glyphData.zw;
    bandMax.y &= 0x00FF;

    ivec2 bandIndex = clamp(ivec2(renderCoord * bandTransform.xy + bandTransform.zw), ivec2(0, 0), bandMax);
    ivec2 glyphLoc = glyphData.xy;

    float xcov = 0.0;
    float xwgt = 0.0;

    uvec2 hbandData = texelFetch(bandTexture, ivec2(glyphLoc.x + bandIndex.y, glyphLoc.y), 0).xy;
    ivec2 hbandLoc = CalcBandLoc(glyphLoc, hbandData.y);

    for (curveIndex = 0; curveIndex < int(hbandData.x); curveIndex++) {
        ivec2 curveLoc = ivec2(texelFetch(bandTexture, ivec2(hbandLoc.x + curveIndex, hbandLoc.y), 0).xy);

        vec4 p12 = texelFetch(curveTexture, curveLoc, 0) - vec4(renderCoord, renderCoord);
        vec2 p3 = texelFetch(curveTexture, ivec2(curveLoc.x + 1, curveLoc.y), 0).xy - renderCoord;

        if (max(max(p12.x, p12.z), p3.x) * pixelsPerEm.x < -0.5) break;

        uint code = CalcRootCode(p12.y, p12.w, p3.y);
        if (code != 0u) {
            vec2 r = SolveHorizPoly(p12, p3) * pixelsPerEm.x;

            if ((code & 1u) != 0u) {
                xcov += clamp(r.x + 0.5, 0.0, 1.0);
                xwgt = max(xwgt, clamp(1.0 - abs(r.x) * 2.0, 0.0, 1.0));
            }

            if (code > 1u) {
                xcov -= clamp(r.y + 0.5, 0.0, 1.0);
                xwgt = max(xwgt, clamp(1.0 - abs(r.y) * 2.0, 0.0, 1.0));
            }
        }
    }

    float ycov = 0.0;
    float ywgt = 0.0;

    uvec2 vbandData = texelFetch(bandTexture, ivec2(glyphLoc.x + bandMax.y + 1 + bandIndex.x, glyphLoc.y), 0).xy;
    ivec2 vbandLoc = CalcBandLoc(glyphLoc, vbandData.y);

    for (curveIndex = 0; curveIndex < int(vbandData.x); curveIndex++) {
        ivec2 curveLoc = ivec2(texelFetch(bandTexture, ivec2(vbandLoc.x + curveIndex, vbandLoc.y), 0).xy);
        vec4 p12 = texelFetch(curveTexture, curveLoc, 0) - vec4(renderCoord, renderCoord);
        vec2 p3 = texelFetch(curveTexture, ivec2(curveLoc.x + 1, curveLoc.y), 0).xy - renderCoord;

        if (max(max(p12.y, p12.w), p3.y) * pixelsPerEm.y < -0.5) break;

        uint code = CalcRootCode(p12.x, p12.z, p3.x);
        if (code != 0u) {
            vec2 r = SolveVertPoly(p12, p3) * pixelsPerEm.y;

            if ((code & 1u) != 0u) {
                ycov -= clamp(r.x + 0.5, 0.0, 1.0);
                ywgt = max(ywgt, clamp(1.0 - abs(r.x) * 2.0, 0.0, 1.0));
            }

            if (code > 1u) {
                ycov += clamp(r.y + 0.5, 0.0, 1.0);
                ywgt = max(ywgt, clamp(1.0 - abs(r.y) * 2.0, 0.0, 1.0));
            }
        }
    }

    return CalcCoverage(xcov, ycov, xwgt, ywgt, glyphData.w);
}

float SlugRender(vec2 renderCoord, vec4 bandTransform, ivec4 glyphData) {
    vec2 emsPerPixel = fwidth(renderCoord);

#if defined(SLUG_ADAPTIVE_SUPERSAMPLE)
    // Per-pixel rotated RGSS-4.  The base RGSS offsets are rotated by a
    // unique angle per fragment (interleaved gradient noise).  This converts
    // structured aliasing shimmer into uncorrelated grain that the eye
    // naturally filters out, much closer to how hardware MSAA on many small
    // triangles behaves perceptually.
    float noise = fract(52.9829189 * fract(dot(gl_FragCoord.xy, vec2(0.06711056, 0.00583715))));
    float angle = noise * 6.2831853;
    float ca = cos(angle), sa = sin(angle);

    // Base RGSS offsets rotated by per-pixel angle
    vec2 o0 = vec2(ca * -0.375 - sa *  0.125, sa * -0.375 + ca *  0.125) * emsPerPixel;
    vec2 o1 = vec2(ca *  0.125 - sa *  0.375, sa *  0.125 + ca *  0.375) * emsPerPixel;
    vec2 o2 = vec2(ca *  0.375 - sa * -0.125, sa *  0.375 + ca * -0.125) * emsPerPixel;
    vec2 o3 = vec2(ca * -0.125 - sa * -0.375, sa * -0.125 + ca * -0.375) * emsPerPixel;

    float coverage =
        SlugRenderSingle(renderCoord + o0, emsPerPixel, bandTransform, glyphData) +
        SlugRenderSingle(renderCoord + o1, emsPerPixel, bandTransform, glyphData) +
        SlugRenderSingle(renderCoord + o2, emsPerPixel, bandTransform, glyphData) +
        SlugRenderSingle(renderCoord + o3, emsPerPixel, bandTransform, glyphData);
    return coverage * 0.25;
#else
    return SlugRenderSingle(renderCoord, emsPerPixel, bandTransform, glyphData);
#endif
}

void main() {
    float coverage = SlugRender(v_texcoord, v_banding, v_glyph);
    outColor = v_color * coverage;
}
