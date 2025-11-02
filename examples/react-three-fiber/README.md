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

If using hyphenation, import and register patterns at app startup:

```javascript
import { Text } from 'three-text';
import enUs from 'three-text/patterns/en-us';

// Configure once at app initialization
Text.setHarfBuzzPath('/hb/hb.wasm');
Text.registerPattern('en-us', enUs);
```

### Using the ThreeText Component

The `<ThreeText>` component handles font loading and geometry lifecycle automatically:

```jsx
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

function TextMesh({ text, fontSize, font, ...props }) {
  const [geometry, setGeometry] = useState(null);

  useEffect(() => {
    async function createText() {
      const result = await Text.create({
        text,
        font,
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
  }, [text, fontSize, font]);

  return geometry ? <mesh geometry={geometry} {...props} /> : null;
}
```
