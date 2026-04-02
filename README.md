# three-text

[![npm version](https://img.shields.io/npm/v/three-text.svg)](https://www.npmjs.com/package/three-text)
[![TypeScript](https://img.shields.io/badge/built%20with-TypeScript-007acc.svg)](https://www.typescriptlang.org/)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](https://opensource.org/licenses/MIT)

High fidelity 3D text rendering and layout for the web

![Screenshot of three-text example file](https://countertype.com/assets/three-text/3D.png)

[Live demo](https://countertype.com/tools/three-text/demo)

## Overview

> [!CAUTION]
> three-text is in alpha release and the API may break rapidly. This warning will likely last until summer of 2026. If API stability is important to you, consider pinning your version. Community feedback is encouraged; please open an issue if you have any suggestions or feedback, thank you

**three-text** is a 3D font rendering and text layout library for the web. It supports TTF, OTF, WOFF, and WOFF2 font files and uses [TeX](https://en.wikipedia.org/wiki/TeX)-based parameters for layout, with support for CJK and RTL scripts. Two rendering pipelines share the same core: **mesh** (extrudable, deformable geometry) and **vector** (resolution-independent GPU outlines). Contours and geometries are cached per glyph for low CPU overhead in text-heavy scenes. Variable fonts are supported

The library has a framework-agnostic core with lightweight adapters for [Three.js](https://threejs.org), [React Three Fiber](https://docs.pmnd.rs/react-three-fiber), [p5.js](https://p5js.org), [WebGL](https://developer.mozilla.org/en-US/docs/Web/API/WebGL_API), and [WebGPU](https://developer.mozilla.org/en-US/docs/Web/API/WebGPU_API)

Under the hood, three-text relies on a core of [harfbuzzjs](https://github.com/harfbuzz/harfbuzzjs) (based on [HarfBuzz](https://github.com/harfbuzz/harfbuzz) by Behdad Esfahbod et al) for text shaping, [Knuth-Plass](http://www.eprg.org/G53DOC/pdfs/knuth-plass-breaking.pdf) line breaking (with [SILE](https://github.com/sile-typesetter/sile/blob/master/core/break.lua) and LuaTex being the closest modern references), [Liang](https://tug.org/docs/liang/liang-thesis.pdf) hyphenation and the [TeX hyphenation patterns](https://github.com/hyphenation/tex-hyphen), and [woff-lib](https://github.com/countertype/woff-lib) for optional WOFF2 support. The mesh text pipeline uses [libtess-ts](https://github.com/countertype/libtess-ts) (a port of the [GLU tessellator](https://www.songho.ca/opengl/gl_tessellation.html) by Eric Veach) for removing overlaps and triangulation, adaptive curve polygonization from Maxim Shemanarev's [Anti-Grain Geometry](https://web.archive.org/web/20060128212843/http://www.antigrain.com/research/adaptive_bezier/index.html), and [Visvalingam-Whyatt](https://hull-repository.worktribe.com/preview/376364/000870493786962263.pdf) [line simplification](https://bost.ocks.org/mike/simplify/). The vector pipeline uses [Slug](https://github.com/EricLengyel/Slug) by Eric Lengyel for resolution-independent curve rendering

## Table of contents

- [Overview](#overview)
- [Getting started](#getting-started)
- [Architecture](#architecture)
  - [Mesh vs vector](#mesh-vs-vector)
  - [Basic Usage](#basic-usage)
  - [Coordinate systems](#coordinate-systems)
- [Development and examples](#development-and-examples)
- [Why three-text?](#why-three-text)
- [Library structure](#library-structure)
- [Key concepts and methods](#key-concepts-and-methods)
- [Configuration](#configuration)
- [Querying text content](#querying-text-content)
- [API reference](#api-reference)
- [Memory management](#memory-management)
- [Debugging](#debugging)
- [Browser compatibility](#browser-compatibility)
- [Testing](#testing)
- [Build system](#build-system)
- [Build outputs](#build-outputs)
- [Acknowledgements](#acknowledgements)
- [License](#license)

## Getting started

```bash
npm install three-text
```

For Three.js projects, also install:
```bash
npm install three
```

`harfbuzzjs` is a direct dependency and will be installed automatically

## Architecture

three-text has a framework-agnostic core that processes fonts and generates geometry data. Lightweight adapters convert this data to framework-specific formats:

- **`three-text`** - Three.js adapter (default export, returns mesh `BufferGeometry`)
- **`three-text/mesh`** - Same as above (explicit alias)
- **`three-text/mesh/react`** - React Three Fiber component for extruded mesh text
- **`three-text/three/react`** - Deprecated, use `three-text/mesh/react`
- **`three-text/mesh/webgl`** - WebGL mesh buffer utility
- **`three-text/mesh/webgpu`** - WebGPU mesh buffer utility
- **`three-text/mesh/p5`** - p5.js adapter
- **`three-text/core`** - Framework-agnostic core (returns raw arrays)
- **`three-text/vector`** - Vector rendering (Slug per-fragment curve evaluation), `Text.create()` returns a `THREE.Group`
- **`three-text/vector/react`** - React Three Fiber component for vector text
- **`three-text/vector/core`** - Framework-agnostic vector core (returns raw `SlugGPUData`, no Three.js dependency)
- **`three-text/vector/webgl`** - Raw WebGL2 vector renderer (no Three.js dependency)
- **`three-text/vector/webgpu`** - Raw WebGPU vector renderer (no Three.js dependency)

Most users will just `import { Text } from 'three-text'` for Three.js projects with mesh, or `import { Text } from 'three-text/vector'` for vector text

### Mesh vs vector

The library offers two rendering modes that share the same core (HarfBuzz shaping, Knuth-Plass justification, glyph caching):

- **Mesh** (`three-text` (default) / `three-text/mesh`): triangulated geometry you can extrude, light, and shade. Use for 3D text, text in a scene graph, or anywhere you need depth
- **Vector** (`three-text/vector`): resolution-independent rendering on the GPU via per-fragment curve evaluation. Use for flat text that needs to stay sharp at arbitrary zoom

Both can be used in the same project from separate entry points

**React Three Fiber:** both `three-text/mesh/react` and `three-text/vector/react` export `Text`

### Basic Usage

#### Mesh (Three.js)

Extruded `BufferGeometry` that you can light, shade, and deform like any mesh:

```javascript
import { Text } from 'three-text';
import { woff2Decode } from 'woff-lib/woff2/decode';
import * as THREE from 'three';

Text.setHarfBuzzPath('/hb/hb.wasm');
Text.enableWoff2(woff2Decode); // Optional, for WOFF2 support
const result = await Text.create({
  text: 'Hello World',
  font: '/fonts/Font.woff2',
  size: 72
});

const mesh = new THREE.Mesh(result.geometry, material);
scene.add(mesh);
```

#### Vector (Three.js)

Resolution-independent outlines via per-fragment curve evaluation (see [Vector rendering](#vector-rendering)):

```javascript
import { Text } from 'three-text/vector';

Text.setHarfBuzzPath('/hb/hb.wasm');
const result = await Text.create({
  text: 'Hello Vector',
  font: '/fonts/Font.woff2',
  size: 72,
  color: [1, 1, 1]
});
scene.add(result.group);
```

`Text.create()` returns a `THREE.Group` ready for `scene.add()`. Uses TSL node materials when the renderer supports them (Three.js r170+), otherwise falls back to a GLSL `RawShaderMaterial` that works with any WebGL2 renderer

#### Mesh + vector in one scene

Alias one import to avoid the name collision between `Text` components. The entry points share a core (shaping, layout, font cache) so you can mix them freely; fonts load once regardless of which entry point requests them:

```javascript
import { Text as MeshText } from 'three-text';
import { Text as VectorText } from 'three-text/vector';

MeshText.setHarfBuzzPath('/hb/hb.wasm');

const heading = await MeshText.create({
  text: 'Heading',
  font: '/fonts/Font.woff2',
  size: 72, depth: 10
});
scene.add(new THREE.Mesh(heading.geometry, material));

const caption = await VectorText.create({
  text: 'Caption text',
  font: '/fonts/Font.woff2',
  size: 24,
  color: [1, 1, 1]
});
scene.add(caption.group);
```

#### React Three Fiber — mesh

```jsx
import { Canvas } from '@react-three/fiber';
import { Text } from 'three-text/mesh/react';

Text.setHarfBuzzPath('/hb/hb.wasm');

function App() {
  return (
    <Canvas>
      <ambientLight />
      <Text font="/fonts/Font.woff" size={72} depth={10}>
        Hello React
      </Text>
    </Canvas>
  );
}
```

#### React Three Fiber — vector

The vector `Text` component creates a single mesh with a TSL node material that evaluates curve coverage per fragment. Requires a renderer that supports `MeshBasicNodeMaterial` (Three.js r170+). With WebGPU, pass a `WebGPURenderer` and await `init()` (see the [three.js WebGPU examples](https://threejs.org/examples/?q=webgpu)):

```jsx
import { Canvas } from '@react-three/fiber';
import * as THREE from 'three/webgpu';
import { Text } from 'three-text/vector/react';

Text.setHarfBuzzPath('/hb/hb.wasm');

function App() {
  return (
    <Canvas
      gl={async (props) => {
        const renderer = new THREE.WebGPURenderer({
          canvas: props.canvas,
          antialias: true
        });
        await renderer.init();
        return renderer;
      }}
    >
      <Text font="/fonts/Font.woff" size={72} fillColor="#ffffff">
        Sharp vector text
      </Text>
    </Canvas>
  );
}
```

#### React Three Fiber — both in one app

Since both adapters export `Text`, alias one at the import site:

```jsx
import { Canvas } from '@react-three/fiber';
import * as THREE from 'three/webgpu';
import { Text as MeshText } from 'three-text/mesh/react';
import { Text as VectorText } from 'three-text/vector/react';

MeshText.setHarfBuzzPath('/hb/hb.wasm');

function App() {
  return (
    <Canvas
      gl={async (props) => {
        const renderer = new THREE.WebGPURenderer({
          canvas: props.canvas,
          antialias: true
        });
        await renderer.init();
        return renderer;
      }}
    >
      <MeshText font="/fonts/Font.woff" size={72} depth={10}>
        Extruded heading
      </MeshText>
      <VectorText font="/fonts/Font.woff" size={24} fillColor="#cccccc">
        Sharp caption
      </VectorText>
    </Canvas>
  );
}
```

#### p5.js

```javascript
import 'three-text/p5';
import { woff2Decode } from 'woff-lib/woff2/decode';

let font;
let textResult;

function preload() {
  loadThreeTextShaper('/hb/hb.wasm');
  enableThreeTextWoff2(woff2Decode); // Optional, for WOFF2 support
  font = loadThreeTextFont('/fonts/Font.woff2');
}

async function setup() {
  createCanvas(400, 400, WEBGL);
  textResult = await createThreeTextGeometry('Hello p5!', {
    font: font,
    size: 72,
    depth: 30
  });
}

function draw() {
  background(200);
  lights();
  if (textResult) model(textResult.geometry);
}
```

`createThreeTextGeometry()` accepts all the same options as Three.js (`layout`, `fontVariations`, `depth`, etc.) and returns `{ geometry, planeBounds, glyphs }`. Use `planeBounds` to center the text

#### Vector rendering

**Raw WebGL2 (via `three-text/vector/webgl`):**

```javascript
import { Text } from 'three-text/vector';
import { createWebGLVectorRenderer } from 'three-text/vector/webgl';
import { woff2Decode } from 'woff-lib/woff2/decode';

Text.setHarfBuzzPath('/hb/hb.wasm');
Text.enableWoff2(woff2Decode);

const gl = canvas.getContext('webgl2', { antialias: true });
const renderer = createWebGLVectorRenderer(gl, {
  adaptiveSupersampling: true
});

const result = await Text.create({ text: 'Hello', font: '/fonts/Font.woff2', size: 72 });
renderer.setGeometry(result.gpuData);

// In render loop:
renderer.render(mvpMatrix, new Float32Array([1, 1, 1, 1]));
```

**Raw WebGPU (via `three-text/vector/webgpu`):**

```javascript
import { Text } from 'three-text/vector';
import { createWebGPUVectorRenderer } from 'three-text/vector/webgpu';
import { woff2Decode } from 'woff-lib/woff2/decode';

Text.setHarfBuzzPath('/hb/hb.wasm');
Text.enableWoff2(woff2Decode);

const renderer = createWebGPUVectorRenderer(device, format, {
  sampleCount: 4
});

const result = await Text.create({ text: 'Hello', font: '/fonts/Font.woff2', size: 72 });
renderer.setGeometry(result.gpuData);

// In render pass:
renderer.render(passEncoder, mvpMatrix, new Float32Array([1, 1, 1, 1]));
```

**Adaptive supersampling** is available on the GLSL code path (raw WebGL2 renderer, `createSlugGLSLMesh`, and Three.js vector when TSL is unavailable). It uses rotated-grid supersampling (RGSS, 4 samples per pixel) with a per-fragment rotation angle derived from interleaved gradient noise. This converts structured aliasing shimmer into uncorrelated grain that the eye naturally filters out. Pass `adaptiveSupersampling: true` to enable it. The TSL and WebGPU paths do not currently support this option

#### GLSL animation injection

For custom vertex animations, `createSlugGLSLMesh` gives direct access to the GLSL vertex shader. This is exported from `three-text/vector` and builds a Three.js `Mesh` backed by a `RawShaderMaterial`:

```javascript
import { Text, createSlugGLSLMesh } from 'three-text/vector';

const result = await Text.create({
  text: 'Hello',
  font: '/fonts/Font.woff2',
  size: 72,
  perGlyphAttributes: true
});

const { mesh, uniforms } = createSlugGLSLMesh(result.gpuData, {
  color: { r: 1, g: 1, b: 1 },
  adaptiveSupersampling: true,
  animationDeclarations: `
    uniform float waveAmplitude;
  `,
  animationBody: `
    vec3 outPos = position;
    outPos.y += sin(glyphIndex * 0.5 + time) * waveAmplitude;
  `,
  uniforms: {
    waveAmplitude: { value: 10.0 }
  }
});
scene.add(mesh);
```

The vertex shader provides `position` (vec3), `glyphCenter` (vec3), `glyphIndex` (float), and `time` (float) for use in your animation body. Your code must write a `vec3 outPos` that becomes the final vertex position

The main interactive demo (`examples/index.html`) uses `WebGPURenderer` with TSL node materials for both mesh and vector paths. A `WebGLRenderer` variant for mesh mode is available at `examples/index-webgl.html`

### Coordinate systems

The core library uses a right-handed coordinate system with +Y down. Text extrudes from z=0 toward positive Z

**Three.js, WebGL, WebGPU:** Geometry is used as-is. Front cap normals point +Z

**p5.js:** The adapter flips Y coordinates (p5 uses +Y up) but preserves Z. When using `directionalLight(r, g, b, x, y, z)`, note that p5 negates the direction vector internally

### Setup

The library bundles harfbuzzjs but requires the WASM binary to be available at runtime. You have two options for providing it:

#### Option 1: Path-Based Loading (recommended for most uses)

This is the simplest and recommended approach. The library's internal caching ensures the WASM file is fetched only once, even if you create multiple `Text` instances

Copy the WASM binary to a public directory:

```bash
cp node_modules/harfbuzzjs/hb.wasm public/hb/
```

Then, before any `Text.create()` calls, configure the path:

```javascript
import { Text } from 'three-text';
Text.setHarfBuzzPath('/hb/hb.wasm');
```

The path configuration is shared across all adapters

#### Option 2: Buffer-based loading

This method is essential for applications that use Web Workers, as it is the only way to share a single fetched resource across multiple threads. It gives you full control over loading and prevents each worker from re-downloading the WASM binary


```javascript
import { Text } from 'three-text';

// Main thread
const wasmResponse = await fetch('/hb/hb.wasm');
const wasmBuffer = await wasmResponse.arrayBuffer();

// worker.js
self.onmessage = (e) => {
  const { wasmBuffer } = e.data;
  Text.setHarfBuzzBuffer(wasmBuffer);
};
```

The library will prioritize the buffer if both a path and a buffer have been set

#### Platform-specific notes

**NW.js with CommonJS:** If using `require()` to load the CJS build in NW.js, use Option 2 (buffer-based loading). NW.js's [dual-context architecture](https://docs.nwjs.io/For%20Users/Advanced/JavaScript%20Contexts%20in%20NW.js/#separate-context-mode) causes path resolution issues in this specific scenario. ESM imports and bundled code work normally

**Electron with `file://` protocol:** If loading HTML directly from the filesystem (not via a dev server), use Option 2 (buffer-based loading) or enable `nodeIntegration` in your `BrowserWindow`

### Hyphenation patterns

**For ES Modules (recommended):** Import and register only the languages you need:

```javascript
import enUs from 'three-text/patterns/en-us';
import { Text } from 'three-text';

Text.registerPattern('en-us', enUs);
```

**For UMD builds:** Copy patterns to your public directory and load via script tags:

```bash
cp -r node_modules/three-text/dist/patterns public/patterns/
```


## Development and examples

`three-text` is built with TypeScript, and requires Node for compilation. If you don't already have Node installed on your system, visit [nodejs.org](https://nodejs.org) to download and install it

To clone the repo and try the demo:

```bash
git clone --recurse-submodules git@github.com:countertype/three-text.git
cd three-text
npm install
npm run build
npm run serve
```

Then navigate to `http://127.0.0.1:8080/examples/`

Although Three.js has deprecated UMD, for maximum device support there is also an example of the library without ESM at `http://127.0.0.1:8080/examples/index-umd.html`

For React developers, there's also a React Three Fiber example with Vite and Leva GUI controls:

```bash
cd examples/react-three-fiber
npm install
npm run dev
```

Then navigate to `http://localhost:3000`

## Why three-text?

three-text renders text from real font files (TTF, OTF, WOFF, WOFF2) with two pipelines:

- **Mesh**: tessellated 3D geometry that can be extruded, lit, and shaded like any model
- **Vector**: resolution-independent outlines rendered directly from curve data on the GPU, sharp at any zoom or angle

Both share the same layout engine (HarfBuzz shaping, Knuth-Plass line breaking) and glyph cache, so a paragraph of 1000 words might only require 50 unique glyphs to be processed

Existing solutions take different approaches:

- **Three.js native TextGeometry** extrudes 2D outlines from facetype.js JSON. True 3D geometry with depth, but no support for real fonts or OpenType features needed for many of the world's scripts
- **three-bmfont-text** renders from pre-generated SDF atlas textures built offline at fixed sizes
- **troika-three-text** generates SDF glyphs at runtime via HarfBuzz. More flexible than bmfont, but still an image-space technique with artifacts up close

three-text produces actual geometry from font files, sharper at close distances than bitmap approaches, with control over typesetting and paragraph justification via TeX-based parameters

### Why Slug

The vector path uses the Slug algorithm by Eric Lengyel. Each glyph is a single quad; the fragment shader evaluates curve coverage analytically to compute a winding number. Because it operates on winding rather than geometry, it naturally handles the self-intersecting contours that variable fonts produce when axes like weight push outlines into each other

## Library structure

```
three-text/
├── src/
│   ├── core/                   # Framework-agnostic text engine
│   │   ├── Text.ts             # Core API, font loading, shaping, layout
│   │   ├── vectors.ts          # Vec2, Vec3, Box3Core
│   │   ├── types.ts            # TypeScript interfaces
│   │   ├── cache/              # Glyph caching system
│   │   ├── font/               # Font loading and metrics
│   │   ├── shaping/            # HarfBuzz text shaping
│   │   └── layout/             # Line breaking and text layout
│   ├── mesh/                   # Mesh geometry pipeline
│   │   ├── MeshGeometryBuilder.ts      # Orchestrates mesh output from layout
│   │   ├── GlyphGeometryBuilder.ts     # Instanced geometry from glyph contours
│   │   ├── GlyphContourCollector.ts    # Collects draw callbacks for mesh path
│   │   └── geometry/                   # Tessellation, extrusion, optimization
│   ├── three/                  # Three.js adapter
│   │   ├── index.ts            # BufferGeometry wrapper
│   │   ├── react.tsx           # React component export
│   │   └── ThreeText.tsx       # React Three Fiber component
│   ├── vector/                 # Vector rendering (Slug)
│   │   ├── index.ts            # Main entry point (Text.create → result.group)
│   │   ├── react.tsx           # React Three Fiber component
│   │   ├── slug/               # Slug per-fragment curve evaluation
│   │   ├── core/                          # Outline collection and Slug packing
│   │   └── GlyphOutlineCollector.ts       # Collects draw callbacks for vector path
│   ├── webgl/                  # WebGL mesh buffer utility
│   ├── webgpu/                 # WebGPU mesh buffer utility
│   ├── p5/                     # p5.js adapter
│   ├── hyphenation/            # Language-specific hyphenation patterns
│   └── utils/                  # Performance logging, data structures
├── examples/                   # Demos for all adapters
└── dist/                       # Built library (ESM, CJS, UMD)
```

## Key concepts and methods

### Text shaping

Text shaping is the process of converting a string of Unicode text into positioned glyphs. This is handled entirely by HarfBuzz, which processes OTF and TTF font binaries, shaping them according to the OpenType specification by applying features like kerning, contextual alternates, mark positioning, and diacritic placement. A font and a text string go in; low-level drawing instructions come out

### Line breaking

For text justification, the Knuth-Plass algorithm finds optimal line breaks by minimizing the total "badness" of a paragraph. Unlike greedy algorithms that make locally optimal (per-line) decisions, Knuth-Plass considers all possible break points across the entire paragraph

The algorithm models text using three fundamental elements:

- **Boxes**: Non-breakable content such as letters, words, or inline objects
- **Glue**: Stretchable and shrinkable spaces between boxes with natural width, maximum stretch, and maximum shrink values
- **Penalties**: Potential break points with associated costs, including hyphenation points and explicit breaks

Line badness is calculated based on how much glue must stretch or shrink from its natural width to achieve the target line length. The algorithm finds the sequence of breaks that minimizes total badness across the paragraph

This uses a three-pass approach: first without hyphenation (pretolerance), then with hyphenation (tolerance), and finally with emergency stretch for difficult paragraphs that cannot be broken acceptably

For book typesetting, TeX uses delta nodes to efficiently handle long paragraphs that may span multiple pages with many possible break points. Since three-text isn't a page layout engine, we take a simpler approach and store cumulative widths directly on each break candidate

#### Hyphenation

Hyphenation uses patterns derived from the Tex hyphenation project, converted into optimized trie structures for efficient lookup. The library supports over 70 languages with patterns that follow Liang's algorithm for finding valid hyphenation points while avoiding false positives

### Geometry generation and optimization

By default, three-text runs in mesh mode, generating triangulated geometry from glyph outlines that you can extrude, light, or deform. The mesh pipeline runs once per unique glyph (or glyph cluster), with intermediate results cached to avoid redundant work:

1. **Path collection**: HarfBuzz callbacks provide low level drawing operations
2. **Curve polygonization**: Flattens bezier curves into line segments, placing more points where curves are tight
3. **Geometry optimization**:
   - **Visvalingam-Whyatt simplification**: removes vertices that form tiny triangles with their neighbors, smoothing out subtle bumps while preserving sharp corners
4. **Overlap removal**: removes self-intersections and resolves overlapping paths between glyphs, preserving correct winding rules for triangulation
5. **Triangulation**: converts cleaned 2D shapes into triangles using libtess2 with non-zero winding rule
6. **Mesh construction**: generates 2D or 3D geometry with front faces and optional depth/extrusion (back faces and side walls)

The multi-stage geometry approach (curve polygonization followed by cleanup, then triangulation) reduces triangle counts and removes overlaps in variable fonts

### Vector rendering

The vector pipeline (`three-text/vector`) renders glyphs directly from their mathematical outlines without tessellation or curve flattening. Text stays sharp at any zoom level and the geometry footprint is small: one quad per glyph

Each quad's fragment shader casts rays against band-indexed curve data to compute a winding number, resolving inside/outside analytically. This is the [Slug](https://jcgt.org/published/0006/02/02/) algorithm by Eric Lengyel. Because winding is evaluated per fragment from the original curves, self-intersecting contours in variable fonts are handled correctly without any special-case geometry processing

#### Glyph caching

The library uses a hybrid caching strategy to maximize performance while ensuring visual correctness

By default, it operates with glyph-level cache. The geometry for each unique character (`a`, `b`, `c`...) is generated only once and stored for reuse, avoiding redundant computation

For text with tight tracking, connected scripts, or complex kerning pairs, individual glyphs can overlap. The system detects overlaps within each word and handles them at the sub-cluster level: only the specific glyphs that overlap are tessellated together as a group, while non-overlapping glyphs in the same word continue to use individual glyph caching


#### Flat geometry mode

When `depth` is 0 in mesh mode, the library generates single-sided geometry, reducing triangles by approximately 50%

- Use `THREE.DoubleSide` for flat text so it remains visible from both sides
- For extruded text, `THREE.FrontSide` is typical since front and back faces are separate geometry


## Configuration

### Curve fidelity

Font outlines are bezier curves, but screens render curves flattened into many line segments. The library uses one of two modes:

**Adaptive (default)** - The algorithm splits each curve at its midpoint, checks if the resulting line segment is close enough to the true curve, and recurses until it is. Tight curves get more segments; gentle curves get fewer. Two tolerances control when to stop subdividing:

- `distanceTolerance`: how far the line segment can stray from the true curve, in font units. Lower values trace the curve more faithfully (default: `0.5`)
- `angleTolerance`: the maximum angle between adjacent segments, in radians. Smaller values preserve sharp corners better (default: `0.2`)

**Fixed-step** - Divides each curve into exactly `curveSteps` segments, regardless of curvature. Simpler and predictable. Overrides adaptive mode when set

```javascript
// Adaptive (default)
const text = await Text.create({
  text: 'Sample',
  font: '/fonts/Font.ttf',
  curveFidelity: { 
    distanceTolerance: 0.2,
    angleTolerance: 0.1
  },
});

// Fixed-step: 32 segments per curve
const text = await Text.create({
  text: 'Sample',
  font: '/fonts/Font.ttf',
  curveSteps: 32,
});
```

### Geometry optimization

After curve polygonization, the library applies Visvalingam-Whyatt simplification. Unlike curve flattening, which operates on each bezier independently, V-W sees the complete assembled path. The algorithm looks at each vertex and the triangle it forms with its two neighbors. Vertices that form tiny triangles - nearly collinear with their neighbors - are removed first. The process repeats until no triangle is smaller than `areaThreshold`, measured in square font units. Sharp corners form large triangles, so they survive; subtle bumps form small ones and get smoothed out:

```javascript
const text = await Text.create({
  text: 'Sample text',
  font: '/fonts/Font.ttf',
  // Fixed-step: 32 segments per curve
  curveSteps: 32,
  geometryOptimization: {
    areaThreshold: 1.0,  // remove triangles < 1 font unit²
  },
});
```

Defaults work well for most fonts. Adjust thresholds based on quality requirements and testing

### Line breaking parameters

The Knuth-Plass algorithm provides extensive control over line breaking quality:

#### Basic parameters

- **pretolerance** (100): Maximum badness for the first pass without hyphenation
- **tolerance** (800): Maximum badness for the second pass with hyphenation
- **emergencyStretch** (0): Additional stretchability for difficult paragraphs
- **autoEmergencyStretch** (0.1): Emergency stretch as percentage of line width (e.g., 0.1 = 10%). Defaults to 10% for non-hyphenated text

#### Advanced parameters

- **linepenalty** (10): Base penalty added to each line's badness before squaring

#### Hyphenation control

- **lefthyphenmin** (2): Minimum characters before a hyphen
- **righthyphenmin** (4): Minimum characters after a hyphen
- **hyphenpenalty** (50): Penalty for breaking at automatic hyphenation points
- **exhyphenpenalty** (50): Penalty for breaking at explicit hyphens
- **doublehyphendemerits** (10000): Additional demerits for consecutive hyphenated lines

#### Line quality

- **adjdemerits** (10000): Demerits when adjacent lines have incompatible fitness classes (very tight next to very loose)

Lower penalty/tolerance values produce tighter spacing but may fail to find acceptable breaks for challenging text

### Hyphenation

Import and register patterns statically for better tree-shaking:

```javascript
  import enUs from 'three-text/patterns/en-us';
  import { Text } from 'three-text';

  Text.setHarfBuzzPath('/hb/hb.wasm');
  Text.registerPattern('en-us', enUs);

  const text = await Text.create({
  text: 'Long text content',
  font: '/fonts/Font.ttf',
  layout: {
    width: 400,
    language: 'en-us',
  },
});
```

**Alternative:** Patterns can also load dynamically where preferred (requires pattern files to be deployed):

```javascript
const text = await Text.create({
  text: 'Long text content',
  font: '/fonts/Font.ttf',
  layout: {
    width: 400,
    language: 'fr',
    patternsPath: '/patterns/', // Optional, defaults to '/patterns/'
  },
});
```

### Variable fonts

Variable fonts allow dynamic adjustment of typographic characteristics through variation axes:

```javascript
const text = await Text.create({
  text: 'Sample text',
  font: '/fonts/VariableFont.ttf',
  fontVariations: {
    wght: 700, // Weight
    wdth: 125, // Width
    slnt: -15, // Slant
    opsz: 14,  // Optical size
  },
});
```

As long as the axis is valid, it will be available by its [4-character tag](https://learn.microsoft.com/en-us/typography/opentype/spec/fvar#variationaxisrecord)

#### Axis information and STAT table support

The library automatically extracts axis information from variable fonts, including human-readable names from the [Style Attributes (STAT)](https://learn.microsoft.com/en-us/typography/opentype/spec/stat) table when available:

```javascript
const loadedFont = text.getLoadedFont();
if (loadedFont?.variationAxes) {
  console.log(loadedFont.variationAxes);
  // Output for fonts with STAT table:
  // {
  //   wght: { min: 100, default: 400, max: 900, name: "Weight" },
  //   wdth: { min: 75, default: 100, max: 125, name: "Width" },
  //   opsz: { min: 8, default: 14, max: 144, name: "Optical Size" },
  //   XOPQ: { min: 27, default: 96, max: 175, name: "Parametric Thick Stroke" }
  // }
}
```

For fonts with a STAT table, human-readable axis names are automatically extracted. This enables user interfaces to display "Weight" instead of "wght", or "Optical Size" instead of "opsz". Custom parametric axes will also have their proper names extracted if defined

Axis values are applied through HarfBuzz, which handles the interpolation between master designs

The library automatically removes overlaps (self-intersections) in variable fonts. Static fonts skip this step by default, but a `removeOverlaps` parameter can be set to `false`

```javascript
const text = await Text.create({
  text: 'Sample text',
  font: '/fonts/VariableFont.ttf',
  fontVariations: { wght: 500 },
  removeOverlaps: false,
});
```

### OpenType features

The `fontFeatures` option controls OpenType layout features using 4-character tags from the [feature registry](https://learn.microsoft.com/en-us/typography/opentype/spec/featuretags):

```javascript
const text = await Text.create({
  text: 'Difficult ffi ffl',
  font: '/fonts/Font.ttf',
  fontFeatures: {
    liga: true,
    dlig: true,
    kern: false,
    ss01: 1,
    cv01: 3,
  },
});
```

Values can be boolean (`true`/`false`) to enable or disable, or numeric for features accepting variant indices. Explicitly disabling a feature overrides the font's defaults

Common tags include [`liga`](https://learn.microsoft.com/en-us/typography/opentype/spec/features_ko#liga) (ligatures),  [`calt`](https://learn.microsoft.com/en-us/typography/opentype/spec/features_ae#calt) (contextual alternates), [`tnum`](https://learn.microsoft.com/en-us/typography/opentype/spec/features_pt#tnum) (tabular numbers), sylistic alternates [`ss01`-`ss20`](https://learn.microsoft.com/en-us/typography/opentype/spec/features_pt#ss01--ss20) and character variants [`cv01`-`cv99`](https://learn.microsoft.com/en-us/typography/opentype/spec/features_ae#cv01--cv99). Feature availability depends on the font

### Per-glyph attributes

For shader-based animations and interactive effects, the library can generate per-vertex attributes that identify which glyph each vertex belongs to. Both mesh and vector entry points support this: pass `perGlyphAttributes: true` to `Text.create()`

```javascript
const text = await Text.create({
  text: 'Sample text',
  font: '/fonts/Font.ttf',
  perGlyphAttributes: true,
});

// Geometry includes these vertex attributes:
// - glyphCenter (vec3): center point of each glyph
// - glyphIndex (float): sequential glyph index
// - glyphLineIndex (float): line number
// - glyphProgress (float): normalized position (0..1) along text run
// - glyphBaselineY (float): Y coordinate of glyph baseline
```

**Mesh:** attributes live on the extruded `geometry`. **Vector:** the same attributes are present on the Slug quad mesh, where each glyph is a single quad with `glyphIndex` and `glyphCenter` attributes

This option bypasses overlap-based clustering and adds vertex attributes suitable for per-character manipulation in vertex shaders (or TSL `positionNode` displacements). Each unique glyph is still tessellated only once and cached for reuse. The tradeoff is potential visual artifacts where glyphs actually overlap (tight kerning, cursive scripts)

## Querying text content

After creating text geometry, use the `query()` method to find text ranges:

```javascript
const text = await Text.create({
  text: 'Contact us at hello@example.com or visit our website',
  font: '/fonts/Font.ttf',
  layout: { width: 800, align: 'justify' },
});

const ranges = text.query({
  byText: ['Contact', 'website'],
});
```

Each range contains:

- start/end character indices
- bounds: array of bounding boxes (multiple if text spans lines)
- glyphs: relevant glyph geometry data
- lineIndices: which lines the range spans

### Query types

The API supports two query strategies:

#### Text matching

```javascript
// Find exact text matches (case-sensitive)
const ranges = text.query({
  byText: ['hello', 'world', 'Hello world'],
});
```

#### Character ranges

```javascript
// Direct character index ranges
const ranges = text.query({
  byCharRange: [
    { start: 0, end: 5 },   // First 5 characters
    { start: 10, end: 20 }, // Characters 10-20
  ],
});
```

### Combining query types

Multiple query types can be used together:

```javascript
const ranges = text.query({
  byText: ['OpenType', 'TypeScript'],
  byCharRange: [{ start: 0, end: 5 }],
});
// Returns all matches as a single TextRange[] array
```

### Text coloring

The `color` option accepts either a single RGB array for uniform coloring or an object for selective coloring. Coloring is applied during geometry creation, after line breaking and hyphenation

```javascript
// Uniform coloring
const text = await Text.create({
  text: 'Hello world',
  font: '/fonts/Font.ttf',
  color: [1, 0.5, 0],
});

// Selective coloring
const text = await Text.create({
  text: 'Warning: connection failed at line 42',
  font: '/fonts/Font.ttf',
  color: {
    default: [1, 1, 1],
    byText: {
      Warning: [1, 0, 0],
      connection: [1, 1, 0],
    },
    // byCharRange: [{ start: 35, end: 37, color: [0, 1, 1] }],
  },
});
```

Text matching occurs after layout processing, so patterns like "connection" will be found even if hyphenation splits them across lines. The `coloredRanges` property on the returned object contains the resolved color assignments for programmatic access to the colored parts of the geometry

When using selective coloring with `byText` or `byCharRange`, colored glyphs are kept geometrically separate from adjacent non-colored glyphs. This ensures accurate vertex coloring while still allowing overlap removal between glyphs of the same color status, e.g. two adjacent colored letters that overlap will still be properly merged

## API reference

The library's full TypeScript definitions are the most complete source of truth for the API. The core data structures and configuration options can be found in `src/core/types.ts`

### Core API

#### `Text.create(options: TextOptions): Promise<TextGeometryInfo>`

Creates text geometry with automatic font loading and HarfBuzz initialization

**Core (`three-text`) returns:**
- `vertices: Float32Array` - Vertex positions
- `normals: Float32Array` - Vertex normals
- `indices: Uint32Array` - Triangle indices
- `colors?: Float32Array` - Vertex colors (if color option used)
- `glyphAttributes?` - Per-glyph shader attributes (if requested)
- `glyphs: GlyphGeometryInfo[]` - Per-glyph metadata
- `planeBounds` - Overall text bounds
- `stats` - Performance and optimization statistics
- `query(options)` - Method to find text ranges
- `getLoadedFont()` - Access to font metadata
- `getCacheStatistics()` - Cache performance data
- `clearCache()` - Clear the glyph cache
- `measureTextWidth(text, letterSpacing?)` - Measure text width
- `update(options)` - Re-render with new options while preserving font/cache state

**Three.js adapter (`three-text/three`) returns:**
- `geometry: BufferGeometry` - Three.js geometry
- Plus all the above except vertices/normals/indices/colors/glyphAttributes

##### `update(options: Partial<TextOptions>): Promise<TextGeometryInfo>`

Returns new geometry with updated options. Font and glyph data are cached globally by default, so performance is similar to calling `Text.create()` again; the method is provided for ergonomics when working with the same font configuration across multiple renders

```javascript
const text = await Text.create({
  font: '/fonts/Font.ttf',
  text: 'Hello',
  size: 72
});

const mesh = new THREE.Mesh(text.geometry, material);
scene.add(mesh);

// Later, update the text
const updated = await text.update({ text: 'World' });
mesh.geometry.dispose();
mesh.geometry = updated.geometry;
```

For most use cases, this is primarily an API convenience over calling `create()` again

Options merge at the top level - to remove a nested property like `layout.width`, pass `{ layout: { width: undefined } }`

##### `Text.setHarfBuzzPath(path: string): void`

**Required.** Sets the path for the HarfBuzz WASM binary. Must be called before `Text.create()`

##### `Text.registerPattern(language: string, pattern: HyphenationTrieNode): void`

Registers a hyphenation pattern for a language. Use with static imports for tree-shaking

##### `Text.init(): Promise<HarfBuzzInstance>`

Initializes HarfBuzz WebAssembly. Called automatically by `create()`, but can be called explicitly for early initialization

##### `Text.preloadPatterns(languages: string[]): Promise<void>`

Preloads hyphenation patterns for specified languages. Useful for avoiding async pattern loading during text rendering

##### `Text.setMaxFontCacheMemoryMB(limitMB: number): void`

Sets an upper bound for the font cache, measured by the raw font buffer size, eviction is FIFO by insertion order

#### Instance Methods

The following methods are available on instances created by `Text.create()`:

##### `getFontMetrics(): FontMetrics`

Returns font metrics including ascender, descender, line gap, and units per em. Useful for text layout calculations

### Key Interfaces

Below are the most important configuration interfaces. For a complete list of all properties and data structures, see `src/core/types.ts`

#### TextOptions

```typescript
interface TextOptions {
  text: string; // Text content to render
  font: string | ArrayBuffer; // Font file path or buffer (TTF, OTF, WOFF, or WOFF2)
  size?: number; // Font size in scene units (default: 72)
  depth?: number; // Extrusion depth (default: 0)
  lineHeight?: number; // Line height multiplier (default: 1.0)
  letterSpacing?: number; // Letter spacing as a fraction of em (e.g., 0.05)
  fontVariations?: { [key: string]: number }; // Variable font axis settings
  fontFeatures?: { [tag: string]: boolean | number }; // OpenType feature settings
  removeOverlaps?: boolean; // Override default overlap removal (auto-enabled for VF only)
  perGlyphAttributes?: boolean; // Keep per-glyph identity and add per-glyph shader attributes
  color?: [number, number, number] | ColorOptions; // Text coloring (simple or complex)
  curveSteps?: number; // Fixed segments per curve; overrides curveFidelity when set
  curveFidelity?: CurveFidelityConfig;
  geometryOptimization?: GeometryOptimizationOptions;
  layout?: LayoutOptions;
}

interface ColorOptions {
  default?: [number, number, number]; // Default color for all text
  byText?: { [text: string]: [number, number, number] }; // Color specific text matches
  byCharRange?: {
    start: number;
    end: number;
    color: [number, number, number];
  }[]; // Color character ranges
}
```

#### LayoutOptions

```typescript
interface LayoutOptions {
  width?: number; // Line width in scene units
  align?: 'left' | 'center' | 'right' | 'justify';
  direction?: 'ltr' | 'rtl';
  respectExistingBreaks?: boolean; // Preserve line breaks in input text (default: true)
  hyphenate?: boolean; // Enable hyphenation
  language?: string; // Language code for hyphenation (e.g., 'en-us')
  patternsPath?: string; // Optional base path for dynamic pattern loading (default: '/patterns/')
  hyphenationPatterns?: HyphenationPatternsMap; // Pre-loaded pattern data
  // Knuth-Plass line breaking parameters:
  tolerance?: number; // Maximum badness for second pass (default: 800)
  pretolerance?: number; // Maximum badness for first pass (default: 100)
  emergencyStretch?: number; // Additional stretchability for difficult paragraphs
  autoEmergencyStretch?: number; // Emergency stretch as percentage of line width (defaults to 10% for non-hyphenated)
  lefthyphenmin?: number; // Minimum characters before hyphen (default: 2)
  righthyphenmin?: number; // Minimum characters after hyphen (default: 4)
  linepenalty?: number; // Base penalty per line (default: 10)
  adjdemerits?: number; // Penalty for incompatible fitness classes (default: 10000)
  hyphenpenalty?: number; // Penalty for automatic hyphenation (default: 50)
  exhyphenpenalty?: number; // Penalty for explicit hyphens (default: 50)
  doublehyphendemerits?: number; // Penalty for consecutive hyphenated lines (default: 10000)
}
```

#### CurveFidelityConfig

```typescript
interface CurveFidelityConfig {
  distanceTolerance?: number; // Max deviation from curve in font units (default: 0.5)
  angleTolerance?: number; // Max angle between segments in radians (default: 0.2)
}
```

#### GeometryOptimizationOptions

```typescript
interface GeometryOptimizationOptions {
  enabled?: boolean;      // Enable optimization (default: true)
  areaThreshold?: number; // Min triangle area in font units² (default: 1.0)
}
```

#### TextGeometryInfo (Core)

```typescript
interface TextGeometryInfo {
  vertices: Float32Array;
  normals: Float32Array;
  indices: Uint32Array;
  colors?: Float32Array;
  glyphAttributes?: {
    glyphCenter: Float32Array;
    glyphIndex: Float32Array;
    glyphLineIndex: Float32Array;
    glyphProgress: Float32Array;
    glyphBaselineY: Float32Array;
  };
  glyphs: GlyphGeometryInfo[];
  planeBounds: {
    min: { x: number; y: number; z: number };
    max: { x: number; y: number; z: number };
  };
  stats: {
    trianglesGenerated: number;
    verticesGenerated: number;
    pointsRemovedByVisvalingam: number;
    originalPointCount: number;
  };
  query(options: TextQueryOptions): TextRange[];
  coloredRanges?: ColoredRange[];
}
```

#### ThreeTextGeometryInfo (Three.js Adapter)

```typescript
interface ThreeTextGeometryInfo {
  geometry: BufferGeometry; // Three.js geometry
  // Plus glyphs, planeBounds, stats, query, coloredRanges, utility methods
}
```

The `coloredRanges` property contains resolved color assignments when the `color` option was used. This data includes spatial bounds and glyph references, useful for hit detection or analysis without re-querying

#### TextQueryOptions

```typescript
interface TextQueryOptions {
  byText?: string[]; // Exact text matches
  byCharRange?: { start: number; end: number }[]; // Character index ranges
}
```

#### TextRange

```typescript
interface TextRange {
  start: number;               // Starting character index
  end: number;                 // Ending character index
  originalText: string;        // The matched text content
  bounds: {
    min: { x: number; y: number; z: number };
    max: { x: number; y: number; z: number };
  }[];                         // Array of bounding boxes (splits across lines)
  glyphs: GlyphGeometryInfo[]; // Glyphs within this range
  lineIndices: number[];       // Line numbers this range spans
}
```

## Memory management

Tessellated glyphs are cached in a shared global cache to avoid recomputation when the same characters appear multiple times. Fonts are also cached and persist for the application lifetime

When a text mesh is no longer needed, dispose of its geometry as you would any Three.js `BufferGeometry`:

```javascript
textMesh.geometry.dispose();
```

## Debugging

Enable internal logging by setting a global flag before the library loads:

In a browser environment:

```javascript
window.THREE_TEXT_LOG = true;
```

In a Node.js environment:

```bash
THREE_TEXT_LOG=true node your-script.js
```

The library will output timing information for font loading, geometry generation, line breaking, and text shaping operations. Errors and warnings are always visible regardless of the flag

## Browser compatibility

The library requires WebAssembly support for HarfBuzz text shaping:

- Chrome 57+
- Firefox 52+
- Safari 11+
- Edge 16+

**WOFF font support** requires the DecompressionStream API:

- Chrome 80+
- Firefox 113+
- Safari 16.4+
- Edge 80+

WOFF fonts are automatically decompressed to TTF/OTF using the browser's native `DecompressionStream` API with zero bundle cost. For older browsers without `DecompressionStream`, use TTF or OTF fonts directly

**WOFF2 font support** is opt-in (see [Basic Usage](#basic-usage))

**ES modules** (recommended) are supported in:

- Chrome 61+
- Firefox 60+
- Safari 10.1+
- Edge 16+

**UMD build** is needed for older browsers:

- Chrome < 61
- Firefox < 60
- Safari < 10.1
- Internet Explorer (all versions)

### Performance considerations

While `three-text` runs on all modern browsers, performance varies significantly based on hardware and browser implementation. In testing on an M2 Max with a 120Hz ProMotion display as well as driving an external 5K display:

**Chrome** provides the best experience

**Firefox** also delivers great performance but may exhibit less responsive mouse interactions

**Safari** for macOS shows reduced performance, which is likely due to the platform's conservative resource management; 120FPS is not acheivable

The library was also tested on a Brightsign 223HD, which took a very long time to generate the initial geometry but ran fine after that. We did not push our luck with further testing

## Testing

The library includes a test suite using Vitest that covers core functionality, error handling, layout features, and performance optimizations:

```bash
npm test               # Run all tests
npm test -- --watch    # Watch mode
npm test -- --coverage # Coverage report
```

Tests use mocked HarfBuzz and tessellation libraries for fast execution without requiring WASM files

### Benchmarking

For performance of the real pipeline using HarfBuzz, including shaping, layout, tessellation, extrusion, there is a dedicated benchmark:

```bash
npm run benchmark
```

This runs a Node/Vitest scenario that:

- initializes HarfBuzz from `hb.wasm` via `Text.setHarfBuzzBuffer`
- loads Nimbus Sans and tests the example paragraph from the demos
- performs a small number of cold runs followed by warm runs of `Text.create()` with justification and hyphenation enabled
- prints a per-stage timing table (font load, line breaking, polygonization, tessellation, extrusion, and overall geometry creation)

Use this to compare changes locally; it is meant as a sanity check on real work rather than a reliable micro-benchmark

Synthetic component benchmarks for tessellation, extrusion, and layout are available in `bench/` and can be run directly with node, e.g. `node bench/benchTessellator.mjs --runs 5`

## Build system

### Development

```bash
npm run dev          # Watch mode with rolldown
npm run serve        # Start development server for demos
```

### Production

```bash
npm run build        # Complete build including patterns
```

### Pattern generation

```bash
npm run build:patterns          # Generate hyphenation patterns for all languages
npm run build:patterns:en-us    # Generate only English US patterns (faster for development)
```

The `build:patterns` script uses the `tex-hyphen` git submodule, which must be initialized. The `git clone` command in the quick start handles this for you

However, if you cloned the repository without the `--recurse-submodules` flag, you will need to initialize the submodule manually before this script will work:

```bash
git submodule update --init --recursive
```

The script then processes the TeX hyphenation data into optimized trie structures. The process is slow for the complete set of languages (~1 minute on an M2 Max), so using `--languages` for development is recommended

## Build outputs

The build generates multiple module formats for core and all adapters:

**Core:**
- `dist/index.js` (ESM)
- `dist/index.cjs` (CommonJS)
- `dist/index.umd.js` (UMD)
- `dist/index.d.ts` (TypeScript)

**Adapters:**
- `dist/three/` - Three.js adapter
- `dist/three/react.js` - React component
- `dist/vector/` - Vector rendering (Slug per-fragment curve evaluation)
- `dist/vector/react.js` - React Three Fiber vector component
- `dist/vector/core/` - Framework-agnostic vector core (raw SlugGPUData)
- `dist/vector/webgl/` - Raw WebGL2 vector renderer
- `dist/vector/webgpu/` - Raw WebGPU vector renderer
- `dist/webgl/` - WebGL mesh buffer utility
- `dist/webgpu/` - WebGPU mesh buffer utility
- `dist/p5/` - p5.js adapter

**Patterns:**
- `dist/patterns/` - Hyphenation patterns (ESM and UMD)

## Acknowledgements

`three-text` is built on HarfBuzz and TeX, and started as a Three.js project; this library would not exist without the authors and communities who contribute to, support, and steward these projects. Thanks to Theo Honohan and Yasi Perera for the advice on graphics

## License

`three-text` was written by Jeremy Tribby ([@jpt](https://github.com/jpt)) and is licensed under the MIT License. See the [LICENSE](LICENSE) file for details

This software includes code from third-party libraries under compatible permissive licenses. For full license details, see the [LICENSE_THIRD_PARTY](LICENSE_THIRD_PARTY) file
