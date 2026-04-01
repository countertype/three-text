import { defineConfig } from 'rollup';
import typescript from '@rollup/plugin-typescript';
import terser from '@rollup/plugin-terser';
import dts from 'rollup-plugin-dts';
import { readFileSync } from 'fs';
import nodeResolve from '@rollup/plugin-node-resolve';
import commonjs from '@rollup/plugin-commonjs';
import replace from '@rollup/plugin-replace';

// License banner for all builds
const licenseBanner = `/*!
 * three-text v${JSON.parse(readFileSync('./package.json', 'utf8')).version}
 * Copyright (C) 2025 Countertype LLC
 * 
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU Affero General Public License as published by
 * the Free Software Foundation, either version 3 of the License, or
 * (at your option) any later version.
 * 
 * See LICENSE file for full terms: <https://www.gnu.org/licenses/>
 * 
 * This software includes third-party code - see LICENSE_THIRD_PARTY for details.
 */`;

// Public API properties (protected from mangling)
const reservedProps = [
  'x',
  'y',
  'z',
  'min',
  'max',
  // Three.js compatibility
  'geometry',
  'position',
  'rotation',
  'scale',
  'material',
  // Public methods and properties users access
  'text',
  'font',
  'width',
  'align',
  'direction',
  'depth',
  'tessellator',
  'vertices',
  'normals',
  'indices',
  'colors',
  'glyphAttributes',
  'glyphCenter',
  'glyphIndex',
  'glyphLineIndex',
  'glyphProgress',
  'glyphBaselineY',
  'lines',
  'boundingBox',
  'lineHeight',
  'naturalWidth',
  'update',
  'create',
  'getLoadedFont',
  'getCacheStatistics',
  'getCacheSize',
  'clearCache',
  'measureTextWidth',
  'perGlyphAttributes',
  // HarfBuzz API
  'hb',
  'fontBlob',
  'faceIndex',
  'upem',
  // Common patterns to preserve
  'length',
  'size',
  'name',
  'value',
  'type',
  'data',
  'id',
  // Properties accessed dynamically or via string keys
  'metadata',
  'features',
  'variations',
  // Public API return properties
  'planeBounds',
  'glyphs',
  'buffer',
  'path',
  'query',
  'stats',
  'faces',
  // Curve fidelity / geometry optimization
  'curveSteps',
  'curveFidelity',
  'distanceTolerance',
  'angleTolerance',
  'geometryOptimization',
  'areaThreshold',
  'enabled',
  'pointsRemovedByVisvalingam',
  'originalPointCount',
  'trianglesGenerated',
  'verticesGenerated'
];

const terserOptions = {
  ecma: 2020,
  module: true,
  toplevel: true,
  compress: {
    passes: 3,
    pure_getters: true,
    // Strip debug logging and perf instrumentation from minified builds
    // Keep console.error intact for real failures
    pure_funcs: [
      'console.log',
      'console.warn',
      'logger.log',
      'perfLogger.start',
      'perfLogger.end',
      'perfLogger.printSummary',
      'perfLogger.printBaseline',
      'perfLogger.clear'
    ],
    drop_console: false,
    drop_debugger: true,
    unsafe: true,
    unsafe_proto: true,
    unsafe_arrows: true,
    unsafe_methods: true,
    unsafe_math: true,
    unsafe_comps: true,
    unsafe_undefined: true,
    unsafe_regexp: true,
    conditionals: true,
    dead_code: true,
    evaluate: true,
    booleans: true,
    loops: true,
    unused: true,
    toplevel: true,
    if_return: true,
    inline: 3,
    reduce_vars: true,
    reduce_funcs: true,
    collapse_vars: true,
    hoist_funs: true,
    hoist_vars: false,
    hoist_props: true,
    join_vars: true,
    sequences: true,
    side_effects: true,
    comparisons: true,
    negate_iife: true,
    keep_fargs: false
  },
  mangle: {
    safari10: false,
    properties: {
      regex: /^[a-z_][a-zA-Z0-9_]*$/, // Mangle internal properties (not starting with capitals)
      reserved: reservedProps
    }
  },
  format: {
    comments: /^!/,
    ascii_only: false,
    ecma: 2020,
    semicolons: false,
    wrap_iife: true,
    wrap_func_args: false
  }
};

// Plugin to exclude WASM files from bundling
const excludeWasmPlugin = () => ({
  name: 'exclude-wasm',
  resolveId(id) {
    if (id.endsWith('.wasm') || id.includes('hb.wasm')) {
      return false; // Don't bundle WASM files
    }
    return null;
  }
});

// Plugin to handle HarfBuzz module imports and replace Node.js dependencies
const harfbuzzPlugin = () => ({
  name: 'harfbuzz-plugin',
  resolveId(id, importer) {
    // Replace Node.js built-ins with browser alternatives or stubs
    if (id === 'fs') {
      return { id: 'fs', external: false, moduleSideEffects: false };
    }
    if (id === 'path') {
      return { id: 'path', external: false, moduleSideEffects: false };
    }
    if (id === 'harfbuzzjs/hb.js') {
      return this.resolve('./node_modules/harfbuzzjs/hb.js', importer);
    }
    if (id === 'harfbuzzjs/hbjs.js') {
      return this.resolve('./node_modules/harfbuzzjs/hbjs.js', importer);
    }
    return null;
  },
  load(id) {
    // Provide browser-compatible stubs for Node.js modules
    if (id === 'fs') {
      // Delegate to real Node fs when available (NW.js), otherwise throw
      return `
export default {};
export const readFileSync = (...args) => {
  const req = typeof globalThis !== 'undefined' ? globalThis.require : undefined;
  if (typeof req === 'function') {
    return req('fs').readFileSync(...args);
  }
  throw new Error('fs not available in this environment');
};
`;
    }
    if (id === 'path') {
      return `export default {}; export const join = (...args) => args.join('/');`;
    }
    return null;
  },
  transform(code, id) {
    // Fix __dirname crash in ESM environments (NW.js, Electron, etc.)
    if (id.includes('harfbuzzjs') && id.endsWith('hb.js')) {
      return code.replace(
        /scriptDirectory=__dirname\+"\/"/, 
        'scriptDirectory=(typeof __dirname!=="undefined"?__dirname+"/":"")'
      );
    }
    return null;
  }
});

// Suppress circular dependency warnings from brotli package
const onwarn = (warning, warn) => {
  if (warning.code === 'CIRCULAR_DEPENDENCY' && warning.ids?.some(id => id.includes('brotli'))) {
    return;
  }
  warn(warning);
};

const mainLibraryConfig = {
  input: 'src/index.ts',
  onwarn,
  output: [
    // ESM
    {
      file: 'dist/index.js',
      format: 'esm',
      sourcemap: false,
      banner: licenseBanner
    },
    {
      file: 'dist/index.min.js',
      format: 'esm',
      plugins: [terser(terserOptions)],
      sourcemap: false,
      banner: licenseBanner
    },
    // CJS
    {
      file: 'dist/index.cjs',
      format: 'cjs',
      sourcemap: false,
      banner: licenseBanner
    },
    {
      file: 'dist/index.min.cjs',
      format: 'cjs',
      plugins: [terser(terserOptions)],
      sourcemap: false,
      banner: licenseBanner
    }
  ],
  external: ['three'],
  plugins: [
    harfbuzzPlugin(),
    excludeWasmPlugin(),
    replace({
      preventAssignment: true,
      values: {
        'process.env.NODE_ENV': JSON.stringify('production'),
        'process.env.DEBUG': JSON.stringify(''),
        'process.env': JSON.stringify({}),
        'process.browser': 'true',
        __UMD__: 'false'
      }
    }),
    nodeResolve({
      browser: true,
      preferBuiltins: false
    }),
    commonjs(),
    typescript({
      tsconfig: './tsconfig.json',
      sourceMap: false,
      declaration: true,
      declarationMap: false,
      declarationDir: './dist/types',
      rootDir: './src'
    })
  ]
};

const umdConfig = {
  input: 'src/three/index.ts',
  onwarn,
  output: [
    {
      file: 'dist/index.umd.js',
      format: 'umd',
      name: 'ThreeText',
      sourcemap: false,
      banner: licenseBanner,
      globals: {
        three: 'THREE'
      },
      interop: 'auto',
      esModule: false,
      freeze: false,
      strict: false
    },
    {
      file: 'dist/index.umd.min.js',
      format: 'umd',
      name: 'ThreeText',
      plugins: [terser(terserOptions)],
      sourcemap: false,
      banner: licenseBanner,
      globals: {
        three: 'THREE'
      },
      interop: 'auto',
      esModule: false,
      freeze: false,
      strict: false
    }
  ],
  // Mark three as external so it isn't bundled
  external: ['three'],
  plugins: [
    harfbuzzPlugin(),
    excludeWasmPlugin(),
    replace({
      preventAssignment: true,
      values: {
        'process.env.NODE_ENV': JSON.stringify('production'),
        'process.env.DEBUG': JSON.stringify(''),
        'process.env': JSON.stringify({}),
        'process.browser': 'true',
        __UMD__: 'true'
      }
    }),
    nodeResolve({
      browser: true,
      preferBuiltins: false
    }),
    commonjs(),
    typescript({
      tsconfig: './tsconfig.json',
      sourceMap: false,
      declaration: true,
      declarationMap: false,
      declarationDir: './dist/types',
      rootDir: './src'
    })
  ]
};

const dtsConfig = {
  input: 'dist/types/index.d.ts',
  output: [{ file: 'dist/index.d.ts', format: 'es' }],
  plugins: [dts()],
  external: ['three']
};

const rewriteImports = () => ({
  name: 'rewrite-imports',
  renderChunk(code, chunk, options) {
    if (options.format === 'es' || options.format === 'esm') {
      const newCode = code
        .replace(
          /from ['"]\.\.\/(?:core|mesh)\/[^'"]*['"]/g,
          "from '../index.js'"
        )
        .replace(/from ['"]\.\/index['"]/g, "from './index.js'")
        .replace(
          /from ['"]\.\/loopBlinnTSL['"]/g,
          "from './loopBlinnTSL.js'"
        );
      return { code: newCode, map: null };
    } else if (options.format === 'cjs') {
      const newCode = code
        .replace(
          /require\(['"]\.\.\/(?:core|mesh)\/[^'"]*['"]\)/g,
          "require('../index.cjs')"
        )
        .replace(/require\(['"]\.\/index['"]\)/g, "require('./index.cjs')")
        .replace(
          /require\(['"]\.\/loopBlinnTSL['"]\)/g,
          "require('./loopBlinnTSL.cjs')"
        );
      return { code: newCode, map: null };
    }
    return null;
  }
});

const threeConfig = {
  input: 'src/three/index.ts',
  output: [
    {
      file: 'dist/three/index.js',
      format: 'esm',
      sourcemap: false
    },
    {
      file: 'dist/three/index.cjs',
      format: 'cjs',
      sourcemap: false
    }
  ],
  external: ['three', /^\.\.\/core\//, /^\.\.\/mesh\//],
  plugins: [
    replace({
      preventAssignment: true,
      values: {
        'process.env.NODE_ENV': JSON.stringify('production'),
        'process.env.DEBUG': JSON.stringify(''),
        'process.env': JSON.stringify({}),
        'process.browser': 'true'
      }
    }),
    nodeResolve({
      browser: true,
      preferBuiltins: false
    }),
    commonjs(),
    typescript({
      tsconfig: './tsconfig.json',
      sourceMap: false,
      declaration: false
    }),
    rewriteImports()
  ]
};

const reactConfig = {
  input: 'src/three/react.tsx',
  output: [
    {
      file: 'dist/three/react.js',
      format: 'esm',
      sourcemap: false
    },
    {
      file: 'dist/three/react.cjs',
      format: 'cjs',
      sourcemap: false
    }
  ],
  external: ['react', 'three', 'react/jsx-runtime', /^\.\/index/],
  plugins: [
    replace({
      preventAssignment: true,
      values: {
        'process.env.NODE_ENV': JSON.stringify('production'),
        'process.env.DEBUG': JSON.stringify(''),
        'process.env': JSON.stringify({}),
        'process.browser': 'true'
      }
    }),
    nodeResolve({
      browser: true,
      preferBuiltins: false
    }),
    commonjs(),
    typescript({
      tsconfig: './tsconfig.json',
      sourceMap: false,
      declaration: false
    }),
    rewriteImports()
  ]
};

const threeDtsConfig = {
  input: 'dist/types/three/index.d.ts',
  output: [{ file: 'dist/three/index.d.ts', format: 'es' }],
  plugins: [dts()],
  external: ['three', /^\.\.\/core\//]
};

const reactDtsConfig = {
  input: 'dist/types/three/react.d.ts',
  output: [{ file: 'dist/three/react.d.ts', format: 'es' }],
  plugins: [dts()],
  external: ['react', 'three', 'react/jsx-runtime', /^\.\/index/]
};

const vectorReactConfig = {
  input: 'src/vector/react.tsx',
  output: [
    {
      file: 'dist/vector/react.js',
      format: 'esm',
      sourcemap: false
    },
    {
      file: 'dist/vector/react.cjs',
      format: 'cjs',
      sourcemap: false
    }
  ],
  external: [
    'react',
    'three',
    'three/tsl',
    'react/jsx-runtime',
    /^\.\/index/,
    /^\.\/loopBlinnTSL/
  ],
  plugins: [
    replace({
      preventAssignment: true,
      values: {
        'process.env.NODE_ENV': JSON.stringify('production'),
        'process.env.DEBUG': JSON.stringify(''),
        'process.env': JSON.stringify({}),
        'process.browser': 'true'
      }
    }),
    nodeResolve({
      browser: true,
      preferBuiltins: false
    }),
    commonjs(),
    typescript({
      tsconfig: './tsconfig.json',
      sourceMap: false,
      declaration: false
    }),
    rewriteImports()
  ]
};

const vectorReactDtsConfig = {
  input: 'dist/types/vector/react.d.ts',
  output: [{ file: 'dist/vector/react.d.ts', format: 'es' }],
  plugins: [dts()],
  external: [
    'react',
    'three',
    'three/tsl',
    'react/jsx-runtime',
    /^\.\/index/,
    /^\.\/loopBlinnTSL/
  ]
};

const webgpuConfig = {
  input: 'src/webgpu/index.ts',
  output: [
    {
      file: 'dist/webgpu/index.js',
      format: 'esm',
      sourcemap: false
    },
    {
      file: 'dist/webgpu/index.cjs',
      format: 'cjs',
      sourcemap: false
    }
  ],
  external: [/^\.\.\/core\//, /^\.\.\/mesh\//],
  plugins: [
    replace({
      preventAssignment: true,
      values: {
        'process.env.NODE_ENV': JSON.stringify('production'),
        'process.env.DEBUG': JSON.stringify(''),
        'process.env': JSON.stringify({}),
        'process.browser': 'true'
      }
    }),
    nodeResolve({
      browser: true,
      preferBuiltins: false
    }),
    commonjs(),
    typescript({
      tsconfig: './tsconfig.json',
      sourceMap: false,
      declaration: false
    }),
    rewriteImports()
  ]
};

const webgpuDtsConfig = {
  input: 'dist/types/webgpu/index.d.ts',
  output: [{ file: 'dist/webgpu/index.d.ts', format: 'es' }],
  plugins: [dts()],
  external: [/^\.\.\/core\//]
};

const webglConfig = {
  input: 'src/webgl/index.ts',
  output: [
    {
      file: 'dist/webgl/index.js',
      format: 'esm',
      sourcemap: false
    },
    {
      file: 'dist/webgl/index.cjs',
      format: 'cjs',
      sourcemap: false
    }
  ],
  external: [/^\.\.\/core\//],
  plugins: [
    replace({
      preventAssignment: true,
      values: {
        'process.env.NODE_ENV': JSON.stringify('production'),
        'process.env.DEBUG': JSON.stringify(''),
        'process.env': JSON.stringify({}),
        'process.browser': 'true'
      }
    }),
    nodeResolve({
      browser: true,
      preferBuiltins: false
    }),
    commonjs(),
    typescript({
      tsconfig: './tsconfig.json',
      sourceMap: false,
      declaration: false
    }),
    rewriteImports()
  ]
};

const webglDtsConfig = {
  input: 'dist/types/webgl/index.d.ts',
  output: [{ file: 'dist/webgl/index.d.ts', format: 'es' }],
  plugins: [dts()],
  external: [/^\.\.\/core\//]
};

const webglVectorConfig = {
  input: 'src/vector/webgl/index.ts',
  output: [
    {
      file: 'dist/vector/webgl/index.js',
      format: 'esm',
      sourcemap: false
    },
    {
      file: 'dist/vector/webgl/index.cjs',
      format: 'cjs',
      sourcemap: false
    }
  ],
  plugins: [
    replace({
      preventAssignment: true,
      values: {
        'process.env.NODE_ENV': JSON.stringify('production'),
        'process.env.DEBUG': JSON.stringify(''),
        'process.env': JSON.stringify({}),
        'process.browser': 'true'
      }
    }),
    nodeResolve({
      browser: true,
      preferBuiltins: false
    }),
    commonjs(),
    typescript({
      tsconfig: './tsconfig.json',
      sourceMap: false,
      declaration: false
    }),
    rewriteImports()
  ]
};

const webglVectorDtsConfig = {
  input: 'dist/types/vector/webgl/index.d.ts',
  output: [{ file: 'dist/vector/webgl/index.d.ts', format: 'es' }],
  plugins: [dts()]
};

const webgpuVectorConfig = {
  input: 'src/vector/webgpu/index.ts',
  output: [
    {
      file: 'dist/vector/webgpu/index.js',
      format: 'esm',
      sourcemap: false
    },
    {
      file: 'dist/vector/webgpu/index.cjs',
      format: 'cjs',
      sourcemap: false
    }
  ],
  plugins: [
    replace({
      preventAssignment: true,
      values: {
        'process.env.NODE_ENV': JSON.stringify('production'),
        'process.env.DEBUG': JSON.stringify(''),
        'process.env': JSON.stringify({}),
        'process.browser': 'true'
      }
    }),
    nodeResolve({
      browser: true,
      preferBuiltins: false
    }),
    commonjs(),
    typescript({
      tsconfig: './tsconfig.json',
      sourceMap: false,
      declaration: false
    }),
    rewriteImports()
  ]
};

const webgpuVectorDtsConfig = {
  input: 'dist/types/vector/webgpu/index.d.ts',
  output: [{ file: 'dist/vector/webgpu/index.d.ts', format: 'es' }],
  plugins: [dts()]
};

const p5Config = {
  input: 'src/p5/index.ts',
  output: [
    {
      file: 'dist/p5/index.js',
      format: 'esm',
      sourcemap: false
    },
    {
      file: 'dist/p5/index.cjs',
      format: 'cjs',
      sourcemap: false
    }
  ],
  external: [/^\.\.\/core\//],
  plugins: [
    replace({
      preventAssignment: true,
      values: {
        'process.env.NODE_ENV': JSON.stringify('production'),
        'process.env.DEBUG': JSON.stringify(''),
        'process.env': JSON.stringify({}),
        'process.browser': 'true'
      }
    }),
    nodeResolve({
      browser: true,
      preferBuiltins: false
    }),
    commonjs(),
    typescript({
      tsconfig: './tsconfig.json',
      sourceMap: false,
      declaration: false
    }),
    rewriteImports()
  ]
};

const p5DtsConfig = {
  input: 'dist/types/p5/index.d.ts',
  output: [{ file: 'dist/p5/index.d.ts', format: 'es' }],
  plugins: [dts()],
  external: [/^\.\.\/core\//]
};

const vectorConfig = {
  input: 'src/vector/index.ts',
  output: [
    {
      file: 'dist/vector/index.js',
      format: 'esm',
      sourcemap: false
    },
    {
      file: 'dist/vector/index.cjs',
      format: 'cjs',
      sourcemap: false
    }
  ],
  external: [/^\.\.\/core\//, 'three', /^three\//],
  plugins: [
    replace({
      preventAssignment: true,
      values: {
        'process.env.NODE_ENV': JSON.stringify('production'),
        'process.env.DEBUG': JSON.stringify(''),
        'process.env': JSON.stringify({}),
        'process.browser': 'true'
      }
    }),
    nodeResolve({
      browser: true,
      preferBuiltins: false
    }),
    commonjs(),
    typescript({
      tsconfig: './tsconfig.json',
      sourceMap: false,
      declaration: false
    }),
    rewriteImports()
  ]
};

const vectorDtsConfig = {
  input: 'dist/types/vector/index.d.ts',
  output: [{ file: 'dist/vector/index.d.ts', format: 'es' }],
  plugins: [dts()],
  external: [/^\.\.\/core\//]
};

export default defineConfig([
  mainLibraryConfig,
  umdConfig,
  dtsConfig,
  threeConfig,
  threeDtsConfig,
  reactConfig,
  reactDtsConfig,
  webglConfig,
  webglDtsConfig,
  webglVectorConfig,
  webglVectorDtsConfig,
  webgpuConfig,
  webgpuDtsConfig,
  webgpuVectorConfig,
  webgpuVectorDtsConfig,
  p5Config,
  p5DtsConfig,
  vectorConfig,
  vectorDtsConfig,
  vectorReactConfig,
  vectorReactDtsConfig
]);
