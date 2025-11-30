# three-text

[![npm version](https://img.shields.io/npm/v/three-text.svg)](https://www.npmjs.com/package/three-text)
[![TypeScript](https://img.shields.io/badge/built%20with-TypeScript-007acc.svg)](https://www.typescriptlang.org/)
[![License: AGPL v3](https://img.shields.io/badge/License-AGPL_v3_or_later-blue.svg)](https://www.gnu.org/licenses/agpl-3.0)

A high fidelity 3D font renderer and text layout engine for the web

![Screenshot of three-text example file](https://countertype.com/assets/three-text/3D.png)

[Live demo](https://countertype.com/tools/three-text/demo)

## Overview

> [!CAUTION]
> three-text is an alpha release and the API may break rapidly. This warning will last at least through the end of 2025. If API stability is important to you, consider pinning your version. Community feedback is encouraged; please open an issue if you have any suggestions or feedback, thank you

**three-text** renders and formats text from TTF, OTF, and WOFF font files as 3D geometry. It uses [TeX](https://en.wikipedia.org/wiki/TeX)-based parameters for breaking text into paragraphs across multiple lines, and turns font outlines into 3D shapes on the fly, caching their geometries for low CPU overhead in languages with lots of repeating glyphs. Variable fonts are supported as static instances at a given axis coordinate

The library has a framework-agnostic core that returns raw vertex data, with lightweight adapters for [Three.js](https://threejs.org), [React Three Fiber](https://docs.pmnd.rs/react-three-fiber), [p5.js](https://p5js.org), [WebGL](https://developer.mozilla.org/en-US/docs/Web/API/WebGL_API), and [WebGPU](https://developer.mozilla.org/en-US/docs/Web/API/WebGPU_API)

Under the hood, three-text relies on [HarfBuzz](https://github.com/harfbuzz/harfbuzzjs) for text shaping, [Knuth-Plass](http://www.eprg.org/G53DOC/pdfs/knuth-plass-breaking.pdf) line breaking, [Liang](https://tug.org/docs/liang/liang-thesis.pdf) hyphenation, [libtess](https://github.com/brendankenny/libtess.js) (based on the [GLU tessellator](https://www.songho.ca/opengl/gl_tessellation.html) by Eric Veach) for removing overlaps and triangulation, curve polygonization from Maxim Shemanarev's [Anti-Grain Geometry](https://web.archive.org/web/20060128212843/http://www.antigrain.com/research/adaptive_bezier/index.html), and [Visvalingam-Whyatt](https://hull-repository.worktribe.com/preview/376364/000870493786962263.pdf) [line simplification](https://bost.ocks.org/mike/simplify/)

## Table of contents

- [Overview](#overview)
- [Getting started](#getting-started)
  - [Three.js](#threejs)
  - [React Three Fiber](#react-three-fiber)
  - [p5.js](#p5js)
- [Development and examples](#development-and-examples)
- [Architecture](#architecture)
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

- **`three-text`** - Core (returns raw arrays)
- **`three-text/three`** - Three.js (returns BufferGeometry)
- **`three-text/three/react`** - React Three Fiber component
- **`three-text/webgl`** - WebGL buffer utility
- **`three-text/webgpu`** - WebGPU buffer utility
- **`three-text/p5`** - p5.js adapter

Choose the import that matches your stack. Most users will use `three-text/three` or `three-text/p5`

### Basic Usage

#### Three.js

```javascript
import { Text } from 'three-text/three';
import * as THREE from 'three';

Text.setHarfBuzzPath('/hb/hb.wasm');

const result = await Text.create({
  text: 'Hello World',
  font: '/fonts/Font.woff',
  size: 72
});

const mesh = new THREE.Mesh(result.geometry, material);
scene.add(mesh);
```

#### React Three Fiber

```jsx
import { Canvas } from '@react-three/fiber';
import { Text } from 'three-text/three/react';

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

#### p5.js

```javascript
import 'three-text/p5';

let font;
let textResult;

function preload() {
  loadThreeTextShaper('/hb/hb.wasm');
  font = loadThreeTextFont('/fonts/Font.woff');
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
import { Text } from 'three-text/three';
Text.setHarfBuzzPath('/hb/hb.wasm');
```

The path configuration is shared across all adapters

#### Option 2: Buffer-based loading

This method is essential for applications that use Web Workers, as it is the only way to share a single fetched resource across multiple threads. It gives you full control over loading and prevents each worker from re-downloading the WASM binary


```javascript
import { Text } from 'three-text/three';

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

### Hyphenation patterns

**For ES Modules (recommended):** Import and register only the languages you need:

```javascript
import enUs from 'three-text/patterns/en-us';
import { Text } from 'three-text/three';

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

three-text generates high-fidelity 3D mesh geometry from font files. Unlike texture-based approaches, it produces true geometry that can be lit, shaded, and manipulated like any 3D model.

Existing solutions take different approaches:

- **Three.js native TextGeometry** uses fonts converted by facetype.js to JSON format. It creates 3D text by extruding flat 2D character outlines. While this produces true 3D geometry with depth, there is no support for real fonts or OpenType features needed for many of the world's scripts
- **three-bmfont-text** is a 2D approach for Three.js, using pre-rendered bitmap fonts with SDF support. Texture atlases are generated at specific sizes, and artifacts are apparent up close
- **troika-three-text** uses MSDF, which improves quality, and like three-text, it is built on HarfBuzz, which provides substantial language coverage, but is ultimately a 2D technique in image space. For flat text that does not need formatting or extrusion, and where artifacts are acceptable up close, troika works well

three-text generates true 3D geometry from font files via HarfBuzz. It is sharper at close distances than bitmap approaches when flat, and produces real mesh data that can be used with any rendering system. The library caches tessellated glyphs, so a paragraph of 1000 words might only require 50 tessellations depending on the language. This makes it well-suited to longer texts. In addition to performance considerations, three-text provides control over typesetting and paragraph justification via TeX-based parameters

## Library structure

```
three-text/
├── src/
│   ├── core/                   # Framework-agnostic text engine
│   │   ├── Text.ts             # Core API (returns raw arrays)
│   │   ├── vectors.ts          # Vec2, Vec3, Box3Core
│   │   ├── types.ts            # TypeScript interfaces
│   │   ├── cache/              # Glyph caching system
│   │   ├── font/               # Font loading and metrics
│   │   ├── shaping/            # HarfBuzz text shaping
│   │   ├── layout/             # Line breaking and text layout
│   │   └── geometry/           # Tessellation and geometry processing
│   ├── three/                  # Three.js adapter
│   │   ├── index.ts            # BufferGeometry wrapper
│   │   ├── react.tsx           # React component export
│   │   └── ThreeText.tsx       # React Three Fiber component
│   ├── webgl/                  # WebGL buffer utility
│   ├── webgpu/                 # WebGPU buffer utility
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

#### Hyphenation

Hyphenation uses patterns derived from the Tex hyphenation project, converted into optimized trie structures for efficient lookup. The library supports over 70 languages with patterns that follow Liang's algorithm for finding valid hyphenation points while avoiding false positives

### Geometry generation and optimization

To optimize performance, three-text generates the geometry for each unique glyph or glyph cluster only once. The result is stored in a cache for reuse. This initial geometry creation is a multi-stage pipeline:

1. **Path collection**: HarfBuzz callbacks provide low level drawing operations
2. **Curve polygonization**: Uses Anti-Grain Geometry's recursive subdivision to convert bezier curves into polygons, concentrating points where curvature is high
3. **Geometry optimization**:
   - **Visvalingam-Whyatt simplification**: removes vertices that contribute the least to the overall shape, preserving sharp corners and subtle curves
   - **Colinear point removal**: eliminates redundant points that lie on straight lines within angle tolerances
4. **Overlap removal**: removes self-intersections and resolves overlapping paths between glyphs, preserving correct winding rules for triangulation.
5. **Triangulation**: converts cleaned 2D shapes into triangles using libtess2 with non-zero winding rule
6. **Mesh construction**: generates 2D or 3D geometry with front faces and optional depth/extrusion (back faces and side walls)

The multi-stage geometry approach (curve polygonization followed by cleanup, then triangulation) can reduce triangle counts while maintaining high visual fidelity and removing overlaps in variable fonts

#### Glyph caching

The library uses a hybrid caching strategy to maximize performance while ensuring visual correctness

By default, it operates with glyph-level cache. The geometry for each unique character (`a`, `b`, `c`...) is generated only once and stored for reuse to avoiding redundant computation

For text with tight tracking, connected scripts, or complex kerning pairs, individual glyphs can overlap. When an overlap within a word is found, the entire word is treated as a single unit and escalated to a word-level cache. All of its glyphs are tessellated together to correctly resolve the overlaps, and the resulting geometry for the word is cached


#### Flat geometry mode

When `depth` is 0, the library generates single-sided geometry and relies on `THREE.DoubleSide` materials for back face rendering, reducing triangles by approximately 50%. Custom shaders may need to handle normal flipping for consistent lighting on both sides


## Configuration

### Curve fidelity

The library converts bezier curves into line segments by recursively subdividing curves until they meet specified quality thresholds. This is based on the AGG library, attempting to place vertices only where they are needed to maintain the integrity of the curve. You can control curve fidelity with `distanceTolerance` and `angleTolerance`

- `distanceTolerance`: The maximum allowed deviation of the curve from a straight line segment, measured in font units. Lower values produce higher fidelity and more vertices. Default is `0.5`, which is nearly imperceptable without extrusion
- `angleTolerance`: The maximum angle in radians between segments at a join. This helps preserve sharp corners. Default is `0.2`

In general, this step helps more with time to first render than ongoing interactions in the scene.

```javascript
// Using the default configuration
const text = await Text.create({
  text: 'Sample text',
  font: '/fonts/Font.ttf',
  size: 72,
});

const text = await Text.create({
  text: 'Sample text',
  font: '/fonts/Font.ttf',
  curveFidelity: {
    distanceTolerance: 0.2, // Tighter tolerance for smoother curves
    angleTolerance: 0.1,    // Sharper angle preservation
  },
});
```

### Geometry optimization

`three-text` uses a line simplification algorithm after creating lines to reduce the complexity of the shapes as well, which can be combined with `curveFidelity` for different types of control. It is enabled by default:


```javascript
// Default optimization (automatic)
const text = await Text.create({
  text: 'Sample text',
  font: '/fonts/Font.ttf',
});

// Custom optimization settings
```javascript
const text = await Text.create({
  text: 'Sample text',
  font: '/fonts/Font.ttf',
  geometryOptimization: {
    areaThreshold: 1.0,         // Default: 1.0 (remove triangles < 1 font unit²)
    colinearThreshold: 0.0087,  // Default: ~0.5° in radians
    minSegmentLength: 10,       // Default: 10 font units
  },
});
```

**The Visvalingam-Whyatt simplification** removes vertices whose removal creates triangles with area below the threshold

**Colinear point removal** eliminates redundant vertices that lie on straight lines within the specified angle tolerance

The default settings provide a significant reduction while maintaining high visual quality, but won't be perfect for every font. Adjust thresholds based on your quality requirements, performance constraints, and testing

### Line breaking parameters

The Knuth-Plass algorithm provides extensive control over line breaking quality:

#### Basic parameters

- **pretolerance** (100): Maximum badness for the first pass without hyphenation
- **tolerance** (800): Maximum badness for the second pass with hyphenation
- **emergencyStretch** (0): Additional stretchability for difficult paragraphs
- **autoEmergencyStretch** (0.1): Emergency stretch as percentage of line width (e.g., 0.1 = 10%). Defaults to 10% for non-hyphenated text
- **disableSingleWordDetection** (false): Disable automatic prevention of short single-word lines

#### Advanced parameters

- **linepenalty** (10): Base penalty added to each line's badness before squaring
- **looseness** (0): Try to make the paragraph this many lines longer (positive) or shorter (negative)

#### Hyphenation control

- **lefthyphenmin** (2): Minimum characters before a hyphen
- **righthyphenmin** (4): Minimum characters after a hyphen
- **hyphenpenalty** (50): Penalty for breaking at automatic hyphenation points
- **exhyphenpenalty** (50): Penalty for breaking at explicit hyphens
- **doublehyphendemerits** (10000): Additional demerits for consecutive hyphenated lines

#### Line quality

- **adjdemerits** (10000): Demerits when adjacent lines have incompatible fitness classes (very tight next to very loose)

Lower penalty/tolerance values produce tighter spacing but may fail to find acceptable breaks for challenging text

#### Single-word line detection

By default, the library detects and prevents short single-word lines (words occupying less than 50% of the line width on non-final lines) by iteratively applying emergency stretch. This can be disabled if needed:

```javascript
const text = await Text.create({
  text: 'Your text content',
  font: '/fonts/Font.ttf',
  layout: {
    width: 1000,
    disableSingleWordDetection: true,
  },
});
```

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

### Per-glyph animation attributes

For shader-based animations and interactive effects, the library can generate per-vertex attributes that identify which glyph each vertex belongs to:

```javascript
const text = await Text.create({
  text: 'Sample text',
  font: '/fonts/Font.ttf',
  separateGlyphsWithAttributes: true,
});

// Geometry includes these vertex attributes:
// - glyphCenter (vec3): center point of each glyph
// - glyphIndex (float): sequential glyph index
// - glyphLineIndex (float): line number
```

This option bypasses overlap-based clustering and adds vertex attributes suitable for per-character manipulation in vertex shaders. Each unique glyph is still tessellated only once and cached for reuse. The tradeoff is potential visual artifacts where glyphs actually overlap (tight kerning, cursive scripts)

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

## API reference

The library's full TypeScript definitions are the most complete source of truth for the API. The core data structures and configuration options can be found in `src/core/types.ts`

### Core API

#### `Text.create(options: TextOptions): Promise<TextGeometryInfo>`

Creates text geometry with automatic font loading and HarfBuzz initialization.

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

**Three.js adapter (`three-text/three`) returns:**
- `geometry: BufferGeometry` - Three.js geometry
- Plus all the above except vertices/normals/indices/colors/glyphAttributes

##### `Text.setHarfBuzzPath(path: string): void`

**Required.** Sets the path for the HarfBuzz WASM binary. Must be called before `Text.create()`

##### `Text.registerPattern(language: string, pattern: HyphenationTrieNode): void`

Registers a hyphenation pattern for a language. Use with static imports for tree-shaking

##### `Text.init(): Promise<HarfBuzzInstance>`

Initializes HarfBuzz WebAssembly. Called automatically by `create()`, but can be called explicitly for early initialization

##### `Text.preloadPatterns(languages: string[]): Promise<void>`

Preloads hyphenation patterns for specified languages. Useful for avoiding async pattern loading during text rendering

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
  font?: string | ArrayBuffer; // Font file path or buffer (TTF, OTF, or WOFF)
  size?: number; // Font size in scene units (default: 72)
  depth?: number; // Extrusion depth (default: 0)
  lineHeight?: number; // Line height multiplier (default: 1.0)
  letterSpacing?: number; // Letter spacing as a fraction of em (e.g., 0.05)
  fontVariations?: { [key: string]: number }; // Variable font axis settings
  removeOverlaps?: boolean; // Override default overlap removal (auto-enabled for VF only)
  separateGlyphsWithAttributes?: boolean; // Force individual glyph tessellation and add shader attributes
  color?: [number, number, number] | ColorOptions; // Text coloring (simple or complex)
  // Configuration for geometry generation and layout
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
  disableSingleWordDetection?: boolean; // Disable automatic single-word line prevention (default: false)
  lefthyphenmin?: number; // Minimum character
  // s before hyphen (default: 2)
  righthyphenmin?: number; // Minimum characters after hyphen (default: 4)
  linepenalty?: number; // Base penalty per line (default: 10)
  adjdemerits?: number; // Penalty for incompatible fitness classes (default: 10000)
  hyphenpenalty?: number; // Penalty for automatic hyphenation (default: 50)
  exhyphenpenalty?: number; // Penalty for explicit hyphens (default: 50)
  doublehyphendemerits?: number; // Penalty for consecutive hyphenated lines (default: 10000)
  looseness?: number; // Try to make paragraph longer/shorter by this many lines
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
  enabled?: boolean; // Enable geometry optimization (default: true)
  areaThreshold?: number; // Min triangle area for Visvalingam-Whyatt (default: 1.0)
  colinearThreshold?: number; // Max angle for colinear removal in radians (default: 0.0087)
  minSegmentLength?: number; // Min segment length in font units (default: 10)
}
````

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
    pointsRemovedByColinear: number;
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

`three-text` manages memory in two ways: a shared glyph cache for all text, and instance-specific resources for each piece of text you create

The shared cache is handled automatically through an LRU (Least Recently Used) policy. The default cache size is 250MB, but you can configure it per text instance. Tessellated glyphs are cached to avoid expensive recomputation when the same characters (or clusters of overlapping characters) appear multiple times

```javascript
const text = await Text.create({
  text: 'Hello world',
  font: '/fonts/font.ttf',
  size: 72,
  maxCacheSizeMB: 1024, // Custom cache size in MB
});

// Check cache performance
const stats = text.getCacheStatistics();
console.log('Cache Statistics:', {
  hitRate: stats.hitRate,                // Cache hit percentage
  memoryUsageMB: stats.memoryUsageMB,    // Memory used in MB
  uniqueGlyphs: stats.uniqueGlyphs,      // Distinct cached glyphs
  totalGlyphs: stats.totalGlyphs,        // Total glyphs processed
  saved: stats.saved                     // Tessellations avoided
});
```

Fonts are cached internally and persist for the application lifetime. The glyph geometry cache uses an LRU eviction policy, so memory usage is bounded by `maxCacheSizeMB`. When a text mesh is no longer needed, dispose of its geometry as you would any Three.js `BufferGeometry`:

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

WOFF fonts are automatically decompressed to TTF/OTF using the browser's native decompression with zero bundle cost. For older browsers, use TTF or OTF fonts directly

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

**Firefox** also delivers great performance but may exhibit less responsive mouse interactions in WebGL contexts due to the way it handles events

**Safari** for macOS shows reduced performance, which is likely due to the platform's conservative resource management, particularly around battery life; 120FPS is not acheivable

The library was also tested on a Brightsign 223HD, which took a long time to generate the initial geometry but seemed fine after that

## Testing

The library includes a test suite using Vitest that covers core functionality, error handling, layout features, and performance optimizations:

```bash
npm test               # Run all tests
npm test -- --watch    # Watch mode
npm test -- --coverage # Coverage report
```

Tests use mocked HarfBuzz and tessellation libraries for fast execution without requiring WASM files

## Build system

### Development

```bash
npm run dev          # Watch mode with rollup
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
- `dist/webgl/` - WebGL utility
- `dist/webgpu/` - WebGPU utility
- `dist/p5/` - p5.js adapter

**Patterns:**
- `dist/patterns/` - Hyphenation patterns (ESM and UMD)

## Acknowledgements

`three-text` is built on HarfBuzz and TeX, and started as a Three.js project; this library would not exist without the authors and communities who contribute to, support, and steward these projects. Thanks to Theo Honohan and Yasi Perera for the advice on graphics

## License

`three-text` was written by Jeremy Tribby ([@jpt](https://github.com/jpt)) and is licensed under the GNU Affero General Public License v3.0 or later (AGPL-3.0-or-later). See the [LICENSE](LICENSE) file for details

This software includes code from third-party libraries under compatible permissive licenses. For full license details, see the [LICENSE_THIRD_PARTY](LICENSE_THIRD_PARTY) file