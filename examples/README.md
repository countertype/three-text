# three-text examples

This directory contains interactive examples that demonstrate three-text. It's recommended to start with `hello-world.html` for a minimal, easy-to-understand example

## Example files

- `hello-world.html` - A minimal, "hello world" example. The best place to start
- `index.html` - A full-featured interactive demo with parameter controls (lil-gui)
- `index-umd.html` - The same interactive demo, but for browsers without module support
- `variable-fonts.html` - A focused demonstration of variable font capabilities
- `react-three-fiber/` - A React Three Fiber example with Leva controls

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

Variable fonts automatically expose sliders for each axis (weight, width, etc.)

## Usage patterns

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

        // Configure once
        Text.setHarfBuzzPath('/hb/hb.wasm');

        const text = await Text.create({
          text: 'Your text here',
          font: './fonts/NimbusSanL-Reg.woff', // or .ttf, .otf
          size: 72,
          layout: {
            width: 400,
            align: 'justify',
            language: 'en-us',
          },
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

Patterns loaded via script tags automatically register with `ThreeText`. For dynamic loading, you can set `layout.patternsPath` to specify where pattern files are located (defaults to `/patterns/`)

### ES Modules

**Recommended:** Import and register patterns statically for better tree-shaking:

```html
<script type="module">
  import * as THREE from 'three';
  import { Text } from 'three-text';
  import enUs from 'three-text/patterns/en-us';

  // Configure once
  Text.setHarfBuzzPath('/hb/hb.wasm');
  Text.registerPattern('en-us', enUs);

  const text = await Text.create({
    text: 'Your text here',
    font: '/fonts/YourFont.ttf',
    size: 72,
    layout: {
      width: 12000,
      align: 'justify',
      language: 'en-us',
    },
  });

  const material = new THREE.MeshLambertMaterial({ color: 0xffffff });
  const mesh = new THREE.Mesh(text.geometry, material);
  scene.add(mesh);
</script>
```

### CommonJS

```javascript
const THREE = require('three');
const { Text } = require('three-text');

// Configure once
Text.setHarfBuzzPath('/hb/hb.wasm');

// Note: HarfBuzz requires a browser environment with WASM
async function main() {
  const text = await Text.create({
    text: 'Your text here',
    font: '/fonts/YourFont.ttf',
    size: 72,
    layout: {
      width: 12000,
      align: 'justify',
      language: 'en-us',
    },
  });

  const material = new THREE.MeshLambertMaterial({ color: 0xffffff });
  const mesh = new THREE.Mesh(text.geometry, material);
  scene.add(mesh);
}
```

### React Three Fiber

See the `react-three-fiber/` directory for a complete example. The setup script copies the HarfBuzz WASM file to the public directory

#### Using the ThreeText Component

The `<ThreeText>` component manages font loading, geometry creation, and cleanup automatically

```javascript
import { Canvas } from '@react-three/fiber';
import { ThreeText } from 'three-text/react';

function App() {
  return (
    <Canvas>
      <ThreeText
        font="/fonts/NimbusSanL-Reg.woff"
        size={72}
        depth={10}
        layout={{
          width: 800,
          align: 'justify',
          language: 'en-us',
        }}
        position={[0, 0, 0]}
      >
        Your text here
      </ThreeText>
    </Canvas>
  );
}
```

#### Manual Implementation

Direct use of the Text class provides fine-grained control over the rendering pipeline:

```javascript
import { Text } from 'three-text';

function TextMesh({ text, fontSize, fontBuffer, ...props }) {
  const [geometry, setGeometry] = useState(null);

  useEffect(() => {
    async function createText() {
      const result = await Text.create({
        text,
        font: fontBuffer,
        size: fontSize,
        layout: {
          width: 800,
          align: 'justify',
          language: 'en-us',
        },
      });
      setGeometry(result.geometry);
    }

    createText();

    return () => {
      geometry?.dispose();
    };
  }, [text, fontSize, fontBuffer]);

  return geometry ? <mesh geometry={geometry} {...props} /> : null;
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
