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

This example demonstrates how to use the `<ThreeText>` component with React Three Fiber. The example includes:

- Real-time parameter adjustment with Leva controls
- Text layout options (alignment, line breaking, hyphenation)
- Geometry optimization settings (V-W simplification, overlap removal)
- Loading custom fonts (WOFF, TTF, OTF) via drag-and-drop

### Using the Text Component

```jsx
import { Canvas } from '@react-three/fiber';
import { Text } from 'three-text/three/react';

Text.setHarfBuzzPath('/hb/hb.wasm');

function App() {
  return (
    <Canvas>
      <Text
        font="/fonts/Font.woff"
        size={72}
        layout={{ width: 800, align: 'justify' }}
      >
        Your text here
      </Text>
    </Canvas>
  );
}
```

The component handles font loading, geometry creation, and cleanup automatically
