import { defineConfig } from 'rollup';
import typescript from '@rollup/plugin-typescript';
import terser from '@rollup/plugin-terser';
import dts from 'rollup-plugin-dts';
import { readFileSync } from 'fs';
import nodeResolve from '@rollup/plugin-node-resolve';
import commonjs from '@rollup/plugin-commonjs';
import replace from '@rollup/plugin-replace';
import { createFilter } from '@rollup/pluginutils';

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

const terserOptions = {
  format: {
    comments: /^!/
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
      return `export default {}; export const readFileSync = () => { throw new Error('fs not available in browser'); };`;
    }
    if (id === 'path') {
      return `export default {}; export const join = (...args) => args.join('/');`;
    }
    return null;
  }
});

const mainLibraryConfig = {
  input: 'src/index.ts',
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
  input: 'src/index.ts',
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
      plugins: [
        terser({
          ...terserOptions,
          // Preserve variable names to avoid scoping issues
          mangle: {
            keep_fnames: true,
            keep_classnames: true
          },
          compress: {
            keep_fargs: true
          }
        })
      ],
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
        .replace(/from ['"]\.\.\/core\/Text['"]/g, "from '../index.js'")
        .replace(/from ['"]\.\.\/core\/types['"]/g, "from '../index.js'");
      return { code: newCode, map: null };
    } else if (options.format === 'cjs') {
      const newCode = code
        .replace(
          /require\(['"]\.\.\/core\/Text['"]\)/g,
          "require('../index.cjs')"
        )
        .replace(
          /require\(['"]\.\.\/core\/types['"]\)/g,
          "require('../index.cjs')"
        );
      return { code: newCode, map: null };
    }
    return null;
  }
});

const reactConfig = {
  input: 'src/react/index.ts',
  output: [
    {
      file: 'dist/react/index.js',
      format: 'esm',
      sourcemap: false
    },
    {
      file: 'dist/react/index.cjs',
      format: 'cjs',
      sourcemap: false
    }
  ],
  external: ['react', 'three', 'react/jsx-runtime', /^\.\.\/core\//],
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

const reactDtsConfig = {
  input: 'dist/types/react/index.d.ts',
  output: [{ file: 'dist/react/index.d.ts', format: 'es' }],
  plugins: [dts()],
  external: ['react', 'three', 'react/jsx-runtime', /^\.\.\/core\//]
};

export default defineConfig([
  mainLibraryConfig,
  umdConfig,
  dtsConfig,
  reactConfig,
  reactDtsConfig
]);
