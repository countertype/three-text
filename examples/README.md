# three-text examples

This directory contains examples demonstrating three-text across different rendering frameworks

## Example files

**Three.js:**
- `hello-world.html` - Minimal Three.js example
- `index.html` - Full-featured demo with parameter controls
- `index-umd.html` - UMD build for legacy browsers
- `variable-fonts.html` - Variable font demonstration
- `react-three-fiber/` - React Three Fiber with Leva controls

**p5.js**
- `p5-basic.html` - p5.js integration

**Raw APIs:**
- `webgpu-basic.html` - WebGPU example
- `webgl-basic.html` - WebGL example


## Running the examples

### Static HTML examples

The examples are located in `src/three-text/examples/` and can be run after building the library:

```bash
# From the three-text root directory
npm install
npm run build
npm run serve
```

Then open `http://localhost:8080/examples/hello-world.html` in your browser

### React Three Fiber example

```bash
# From the three-text root directory
npm run build # first build three-text
cd examples/react-three-fiber
npm install
npm run dev
```

Open `http://localhost:3000` in your browser

## Interactive controls

All examples include parameter controls for real-time adjustment:

- **Text settings**: Content, size, depth, spacing
- **Layout**: Line width, alignment, hyphenation
- **Geometry optimization**: V-W simplification, overlap removal
- **Font loading**: Drag-and-drop support for TTF, OTF, and WOFF files

Variable fonts automatically expose sliders for each axis (weight, width, etc)

## Usage patterns

### ES Modules

```html
<script type="module">
  import * as THREE from 'three';
  import { Text } from 'three-text/three';
  import enUs from 'three-text/patterns/en-us';

  Text.setHarfBuzzPath('/hb/hb.wasm');
  Text.registerPattern('en-us', enUs);

  const text = await Text.create({
    text: 'Your text here',
    font: '/fonts/YourFont.ttf',
    size: 72,
    layout: {
      width: 1200,
      align: 'justify',
      language: 'en-us'
    }
  });

  const mesh = new THREE.Mesh(text.geometry, material);
  scene.add(mesh);
</script>
```

### UMD build (script tags)

```html
<!DOCTYPE html>
<html>
  <head>
    <script src="https://cdn.jsdelivr.net/npm/three@0.160.0/build/three.min.js"></script>
    <script src="../dist/index.umd.js"></script>
    
    <!-- Load hyphenation patterns (auto-registers) -->
    <script src="/patterns/en-us.umd.js"></script>
  </head>
  <body>
    <script>
      async function init() {
        const { Text } = window.ThreeText;

        Text.setHarfBuzzPath('/hb/hb.wasm');

        const text = await Text.create({
          text: 'Your text here',
          font: './fonts/NimbusSanL-Reg.woff',
          size: 72,
          layout: {
            width: 400,
            align: 'justify',
            language: 'en-us'
          }
        });

        const material = new THREE.MeshLambertMaterial({ color: 0xffffff });
        const mesh = new THREE.Mesh(text.geometry, material);
        scene.add(mesh);
      }

      init();
    </script>
  </body>
</html>
```

Patterns loaded via script tags automatically register with `ThreeText`. For dynamic loading, set `layout.patternsPath`

### React Three Fiber

See `react-three-fiber/` for a complete example.

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

### WebGL

See `webgl-basic.html` for raw WebGL usage without Three.js

### WebGPU

See `webgpu-basic.html` for WebGPU usage

### p5.js

See `p5-basic.html` for p5.js integration

```javascript
import 'three-text/p5';

let font;
let textResult;

function preload() {
  loadThreeTextShaper('/hb/hb.wasm');
  font = loadThreeTextFont('./fonts/Font.woff');
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
  background(20);
  lights();
  if (textResult) model(textResult.geometry);
}
```

## Local development

When developing locally, ensure you serve files from a web server rather than opening HTML files directly. The browser's CORS policy will block WASM files and font loading from `file://` URLs

### Quick server options

```bash
# Using the built-in serve script
npm run serve
```

## Loading fonts

### Static font loading

Place your WOFF, TTF, or OTF font file in a publicly accessible folder and use it directly:

```javascript
const text = await Text.create({
  text: 'Your text here',
  font: '/fonts/NimbusSanL-Reg.woff', // Can also be .ttf, .otf, remote CDN, or ArrayBuffer
  size: 72,
});
```

### Custom fonts in examples

The interactive examples include custom font functionality for TTF, OTF, and WOFF files. Click "Add custom font" in the font controls panel or drag the font file directly onto the viewport

Font files are processed entirely in the browser and no data is uploaded to any server

### Variable font support

When you load a variable font in any of the interactive examples, the interface will automatically generate sliders for each available variation axis. These controls appear in the "Text" section and allow real-time adjustment of font characteristics like weight, width, and slant
