// WGSL port of the reference Slug pixel shader
// by Eric Lengyel, MIT License, Copyright 2017

const kLogBandTextureWidth: u32 = 12u;

@group(0) @binding(1) var curveTexture: texture_2d<f32>;
@group(0) @binding(2) var bandTexture: texture_2d<u32>;

struct FragmentInput {
    @location(0) color: vec4<f32>,
    @location(1) texcoord: vec2<f32>,
    @location(2) @interpolate(flat) banding: vec4<f32>,
    @location(3) @interpolate(flat) glyph: vec4<i32>,
};

fn CalcRootCode(y1: f32, y2: f32, y3: f32) -> u32 {
    let i1 = bitcast<u32>(y1) >> 31u;
    let i2 = bitcast<u32>(y2) >> 30u;
    let i3 = bitcast<u32>(y3) >> 29u;

    var shift = (i2 & 2u) | (i1 & ~2u);
    shift = (i3 & 4u) | (shift & ~4u);

    return (0x2E74u >> shift) & 0x0101u;
}

fn SolveHorizPoly(p12: vec4<f32>, p3: vec2<f32>) -> vec2<f32> {
    let a = p12.xy - p12.zw * 2.0 + p3;
    let b = p12.xy - p12.zw;
    let ra = 1.0 / a.y;
    let rb = 0.5 / b.y;

    let d = sqrt(max(b.y * b.y - a.y * p12.y, 0.0));
    var t1 = (b.y - d) * ra;
    var t2 = (b.y + d) * ra;

    if (abs(a.y) < 1.0 / 65536.0) {
        t1 = p12.y * rb;
        t2 = t1;
    }

    return vec2<f32>(
        (a.x * t1 - b.x * 2.0) * t1 + p12.x,
        (a.x * t2 - b.x * 2.0) * t2 + p12.x
    );
}

fn SolveVertPoly(p12: vec4<f32>, p3: vec2<f32>) -> vec2<f32> {
    let a = p12.xy - p12.zw * 2.0 + p3;
    let b = p12.xy - p12.zw;
    let ra = 1.0 / a.x;
    let rb = 0.5 / b.x;

    let d = sqrt(max(b.x * b.x - a.x * p12.x, 0.0));
    var t1 = (b.x - d) * ra;
    var t2 = (b.x + d) * ra;

    if (abs(a.x) < 1.0 / 65536.0) {
        t1 = p12.x * rb;
        t2 = t1;
    }

    return vec2<f32>(
        (a.y * t1 - b.y * 2.0) * t1 + p12.y,
        (a.y * t2 - b.y * 2.0) * t2 + p12.y
    );
}

fn CalcBandLoc(glyphLoc: vec2<i32>, offset: u32) -> vec2<i32> {
    var bandLoc = vec2<i32>(glyphLoc.x + i32(offset), glyphLoc.y);
    let bandShift = kLogBandTextureWidth;
    let bandMask = i32((1u << bandShift) - 1u);
    bandLoc.y += bandLoc.x >> bandShift;
    bandLoc.x &= bandMask;
    return bandLoc;
}

fn CalcCoverage(xcov: f32, ycov: f32, xwgt: f32, ywgt: f32) -> f32 {
    var coverage = max(
        abs(xcov * xwgt + ycov * ywgt) / max(xwgt + ywgt, 1.0 / 65536.0),
        min(abs(xcov), abs(ycov))
    );
    coverage = clamp(coverage, 0.0, 1.0);
    return coverage;
}

fn SlugRender(renderCoord: vec2<f32>, bandTransform: vec4<f32>, glyphData: vec4<i32>) -> f32 {
    let emsPerPixel = fwidth(renderCoord);
    let pixelsPerEm = 1.0 / emsPerPixel;

    var bandMax = glyphData.zw;
    bandMax.y &= 0x00FF;

    let bandIndex = clamp(
        vec2<i32>(renderCoord * bandTransform.xy + bandTransform.zw),
        vec2<i32>(0, 0),
        bandMax
    );
    let glyphLoc = glyphData.xy;

    var xcov = 0.0;
    var xwgt = 0.0;

    let hbandData = textureLoad(bandTexture, vec2<i32>(glyphLoc.x + bandIndex.y, glyphLoc.y), 0).xy;
    let hbandLoc = CalcBandLoc(glyphLoc, hbandData.y);

    for (var ci = 0; ci < i32(hbandData.x); ci++) {
        let curveLoc = vec2<i32>(textureLoad(bandTexture, vec2<i32>(hbandLoc.x + ci, hbandLoc.y), 0).xy);

        let p12 = textureLoad(curveTexture, curveLoc, 0) - vec4<f32>(renderCoord, renderCoord);
        let p3 = textureLoad(curveTexture, vec2<i32>(curveLoc.x + 1, curveLoc.y), 0).xy - renderCoord;

        if (max(max(p12.x, p12.z), p3.x) * pixelsPerEm.x < -0.5) { break; }

        let code = CalcRootCode(p12.y, p12.w, p3.y);
        if (code != 0u) {
            let r = SolveHorizPoly(p12, p3) * pixelsPerEm.x;

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

    var ycov = 0.0;
    var ywgt = 0.0;

    let vbandData = textureLoad(bandTexture, vec2<i32>(glyphLoc.x + bandMax.y + 1 + bandIndex.x, glyphLoc.y), 0).xy;
    let vbandLoc = CalcBandLoc(glyphLoc, vbandData.y);

    for (var ci = 0; ci < i32(vbandData.x); ci++) {
        let curveLoc = vec2<i32>(textureLoad(bandTexture, vec2<i32>(vbandLoc.x + ci, vbandLoc.y), 0).xy);
        let p12 = textureLoad(curveTexture, curveLoc, 0) - vec4<f32>(renderCoord, renderCoord);
        let p3 = textureLoad(curveTexture, vec2<i32>(curveLoc.x + 1, curveLoc.y), 0).xy - renderCoord;

        if (max(max(p12.y, p12.w), p3.y) * pixelsPerEm.y < -0.5) { break; }

        let code = CalcRootCode(p12.x, p12.z, p3.x);
        if (code != 0u) {
            let r = SolveVertPoly(p12, p3) * pixelsPerEm.y;

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

    return CalcCoverage(xcov, ycov, xwgt, ywgt);
}

@fragment
fn fs_main(in: FragmentInput) -> @location(0) vec4<f32> {
    let coverage = SlugRender(in.texcoord, in.banding, in.glyph);
    return in.color * coverage;
}
