# three-text React Three Fiber example

This example demonstrates how to use `three-text` with React Three Fiber and graphic controls from Leva

## Prerequisites

Before running this example, make sure you've built the three-text library:

```bash
# From the three-text root directory
cd ../..
npm install
npm run build
```

## Running the example

1. Install dependencies:

```bash
npm install
```

2. Start the development server (this will automatically copy required files):

```bash
npm run dev
```

3. Open http://localhost:3000 in your browser

Note: The first run will copy the HarfBuzz WASM file to the public directory. If you encounter any issues, you can run the setup manually:

```bash
node scripts/setup-harfbuzz.js
```

## Usage

This example demonstrates how to use the `<Text>` component with React Three Fiber in both mesh and vector modes. The example includes:

- Toggle between mesh and vector rendering modes
- TSL animations (wave, flip, explode, orbit, twister) for both modes
- Real-time parameter adjustment with Leva controls
- Text layout options (alignment, line breaking, hyphenation)
- Geometry optimization settings (V-W simplification, overlap removal)
- Loading custom fonts (WOFF2, WOFF, TTF, OTF) via drag-and-drop
- Variable font axis sliders

### Mesh mode

```jsx
import { Text } from 'three-text/mesh/react';

Text.setHarfBuzzPath('/hb/hb.wasm');

function App() {
  return (
    <Canvas>
      <Text font="/fonts/Font.woff" size={72} depth={10}>
        Hello React
      </Text>
    </Canvas>
  );
}
```

### Vector mode

```jsx
import { Text } from 'three-text/vector/react';

Text.setHarfBuzzPath('/hb/hb.wasm');

function App() {
  return (
    <Canvas gl={async (props) => new WebGPURenderer({ ...props, antialias: true })}>
      <Text font="/fonts/Font.woff" size={72} fillColor="#ffffff">
        Hello Vector
      </Text>
    </Canvas>
  );
}
```

Vector mode requires `WebGPURenderer` (Three.js r170+) for TSL node material support

The component handles font loading, geometry creation, and cleanup automatically
