# Changelog

## [0.5.0] - 2026-02-02

### Changed

- License changed from AGPL-3.0 to MIT
- WOFF2 decoder accepts async functions (for `woff2-decode` 0.2.0 with native `DecompressionStream` support)

### Breaking changes

- Removed hyphenation patterns for Czech, Indonesian, Macedonian, and Serbian due to incompatible licensing

## [0.4.6] - 2026-02-01

### Added

- Optional WOFF2 font support via `woff2-decode`

## [0.4.5] - 2026-01-26

### Fixed

- HarfBuzz/font loading: complete fetch -> fs fallback for hybrid runtimes and note in README

## [0.4.4] - 2026-01-18

### Fixed

- `Extruder`: Fix side walls when contours are not from the boundary pass (regression in 0.4.3)
- `LineBreak`: Avoid breaking long hyphenated tokens at the hyphen when using break-all behavior

## [0.4.3] - 2026-01-18

### Performance

- `GlyphGeometryBuilder`
  - Faster instanced buffer packing
  - Reuse task and overlap buffers to reduce allocations
  - Tessellate overlap clusters from contours to avoid `Vec2` copies
- `BoundaryClusterer`: Reuse position vectors during clustering

### Added

- Overlap stress benchmark for `Text.create`

## [0.4.2] - 2026-01-17

### Performance

- `LineBreak`: Store cumulative widths in break nodes instead of prefix sum arrays

### Added

- `LineBreak` tests and benchmarks

## [0.4.1] - 2026-01-10

### Fixed

- HarfBuzz init: fixed `ReferenceError: __dirname is not defined` in hybrid runtimes like NW.js when evaluating the ESM build

## [0.4.0] - 2026-01-03

### Breaking changes

- Removed `colinearEnabled`, `colinearThreshold`, `minSegmentLength` from `GeometryOptimizationOptions`
- Geometry optimization is now solely Visvalingam-Whyatt simplification

### Added

- `curveSteps` option for fixed-step De Casteljau curve polygonization; overrides adaptive `curveFidelity` when set

## [0.3.5] - 2025-12-30

### Fixed

- `GlyphGeometryBuilder`:
  - Clustering cache fixes glyph positions; a regression caused incorrect overlap groups when positioning changed between renders
  - Colored glyphs now get proper overlap removal by keeping colored and non-colored glyphs in separate sub-clusters

## [0.3.4] - 2025-12-30

### Fixed

- `LineBreak`:
  - Corrected badness formula and node deactivation logic
  - Fitness class calculation

### Changed

- `scripts/convertPatterns.js`: Extract hyphenmin values from .tex files

### Removed

- `looseness` parameter

## [0.3.3] - 2025-12-27

### Fixed

- `coloredRanges[].bounds` being populated correctly

### Performance

- More `byCharRange` improvements

## [0.3.2] - 2025-12-27

### Performance

- `FontMetadataExtractor`: Faster font loading via shared table directory parsing, name table indexing, and deferred string conversion
- `WoffConverter`: Faster WOFF decompression via parallel table decompression
- `TextShaper`: Char code whitespace check, cached character lookups, cached CJK status between glyph iterations
- `Text`: Lazy-cached `query()` for faster repeated calls; faster `byCharRange` coloring

## [0.3.1] - 2025-12-27

### Breaking changes

- Removed `maxCacheSizeMB` option (was non-functional after 0.3.0 LRU removal)

### Fixed

- Minified builds: public API properties no longer mangled

## [0.3.0] - 2025-12-26

### Breaking changes

- `import 'three-text'` now points to Three.js adapter (was core library). Use `import 'three-text/core'` for core library. (`import 'three-text/three'` still works)
- `getCacheStatistics()` → `getCacheSize()` (returns number instead of stats object)
- `separateGlyphsWithAttributes` renamed to `perGlyphAttributes`

### Added

- `perGlyphAttributes` now includes `glyphProgress` (0..1 along text run) and `glyphBaselineY` for spline effects

### Performance

- Faster geometry generation
- `Extruder`: Integer bit-packing, consolidated edge tracking, optimized flat case
- `GlyphGeometryBuilder`: Merged scaling into vertex write pass, eliminating separate scaling loop
- `Cache`: Replaced LRU with simple Map wrapper

## [0.2.19] - 2025-12-23

### Fixed

- Subpath imports (e.g., `three-text/three/react`) now resolve correctly in CJS
- `package.json` exports mapping for `patterns/*` fixed for Node compatibility
- `TextOptions.font` is now required in types (was already required at runtime)
- `getCacheStatistics()` return type properly typed
- `TextGeometryInfo.stats` shape corrected
- Prettier

### Added

- `@webgpu/types` devDependency

## [0.2.18] - 2025-12-23

### Fixed

- `Extruder`: Side walls now derive from cap boundary edges rather than contour traversal, fixing missing walls in TTF fonts with inconsistent winding (this came up with a Latin/CJK font, I think I got lucky that it wasn't already a problem)

## [0.2.17] - 2025-12-22

### Fixed

- `Text`: `maxCacheSizeMB` now correctly configures the per-instance glyph cache size (was previously being dropped before geometry creation)
- `Tessellator`: Fixed extrusion side walls on complex TTF glyphs (e.g., Chinese characters) by normalizing contour winding before extrusion
- `Extruder`: Merge front and back cap vertex generation into single loop

### Performance

- `TextMeasurer`: Added batched width measurement for CJK text to reduce HarfBuzz shaping calls from N to 1 per segment
- `GlyphGeometryBuilder`: Two-pass approach (plan then allocate/fill) replaces dynamic array resizing
- `TextShaper`: Replaced `Vec3` allocations with direct number variables in per-glyph hot loop
- `GlyphGeometryBuilder`: Removed `Vec3` allocations in `createGlyphInfo` calls
- `fontFeatures`: Memoized feature string conversion to avoid repeated object-to-string transformations
- `PathOptimizer` and `GlyphContourCollector`: Removed unnecessary array copies in path processing
- `LineBreak`: Lazy computation of CJK glue parameters to avoid unnecessary measurement calls for non-CJK text

### Added

- Individual benchmark scripts for tessellator, extruder, and text layout components in `bench/` directory

## [0.2.16] - 2025-12-22

### Fixed

- `Extruder`: Corrected cap normals and triangle winding. Extruded geometry now has outward-facing normals that match triangle orientation
- `WebGPU` adapter: Return `indexFormat` from `createWebGPUBuffers` (was causing runtime error)
- Examples and demos: Updated material configuration to use `DoubleSide` for flat text (`depth: 0`) and `FrontSide` for extruded text
- Examples: Updated lighting directions to match corrected normals

### Notes

- Geometry now follows standard conventions: front-facing triangles are counter-clockwise with outward normals
- If you wrote custom shaders that manually flip normals, you may want to remove those workarounds
- p5.js adapter flips Y axis (p5 uses +Y up) but preserves Z. The `directionalLight(r,g,b,x,y,z)` parameters specify light source location, which p5 negates internally to get light ray direction

## [0.2.15] - 2025-12-21

### Fixed

Normal direction fixed for depth=0

## [0.2.14] - 2025-12-21

### Fixed

- Cache keys now include `curveFidelity` and `geometryOptimization` config to prevent incorrect geometry reuse when options change
- HarfBuzz draw callbacks now shared per module to eliminate WASM function pointer leaks
- React Three Fiber component lifecycle: material disposal now only on unmount, geometry disposal on cancellation
- React Three Fiber `vertexColors` prop now correctly applied to default material
- Extruder depth consistency: side walls now use the same back-face Z clamp for very small depths
- Letter spacing: removed trailing spacing accumulation at line ends to match placement with measurement
- Empty line index bookkeeping when width is undefined
- TrueType Collection (TTC) fonts now properly rejected (only TTF/OTF/WOFF supported)
- Hyphenation pattern loading now validates language codes against safe allowlist
- `LRUCache`: Fixed linked-list invariant where head node's `prev` reference was not cleared, preventing potential corruption during eviction
- `PerformanceLogger`: Fixed nested timing support by using unique timer keys per start operation
- `WebGPU` adapter: Fixed interface to use `indexCount` instead of incorrect `vertexCount` property

### Performance

- `GlyphGeometryBuilder`: Use pre-allocated typed arrays instead of `number[].push()`
- `Extruder`: Pre-compute buffer sizes and write directly to typed arrays
- `Polygonizer` and `PathOptimizer`: Calculate angles using `atan2(cross, dot)` instead of two `atan2()` calls
- `TextRangeQuery`: Bounds calculation uses scalar min/max instead of allocating `Box3` per glyph
- Contour, word, and clustering caches now shared across `Text.create()` calls
- Font ID generation now stable across calls
- `updatePlaneBounds()` uses direct min/max comparisons

### Changed

- `Text.create()` return type simplified to named `TextHandle` interface
- Terser configuration: enabled property mangling (with reserved public API list), 3 compression passes, unsafe optimizations, toplevel mangling
- Cache implementation unified on `utils/LRUCache`
- `GlyphCache.ts` removed, functionality consolidated to `sharedCaches.ts` and `types.ts`
- Cache statistics shape changed to `CacheStats`
- Font table directory parsing extracted to shared `parseTableDirectory()` helper
- Depth clamping now applied consistently in layout preparation and extrusion
- Font cache memory-based eviction policy can now be configured via `Text.setMaxFontCacheMemoryMB()`)

### Added

- Internal benchmark tooling in `bench/` directory
- Text and background color pickers in all examples (ESM, UMD, React Three Fiber)
- `Text.setMaxFontCacheMemoryMB()` to configure font cache memory limit

## [0.2.13]

### Changed

- Improved glyph caching strategy for clusters

## [0.2.12] - 2025-12-14

### Fixed

- Fixed selective text coloring (`byText`, `byCharRange`) potentially coloring adjacent punctuation when letters overlap

### Changed

- Migrated to `@types/libtess` package from DefinitelyTyped after contributing type definitions upstream

## [0.2.11] - 2025-12-08

### Fixed

- `LineBreak.ts`: Default short line detection threshold increased from 50% to 70% for better balance

## [0.2.10] - 2025-12-08

### Fixed

- `LineBreak.ts`: Fixed demerit logic that was causing poor breakpoint selection

## [0.2.9] - 2025-12-07

### Added

- `Text.create()` now returns an object with an `.update()` method for regenerating text geometry with different options

### Changed

- Example demos now use `.update()`
- Improved demo rendering
- Word cache now uses LRU eviction to prevent unbounded memory growth with dynamic text

### Fixed

- Fixed typo in vectors.ts comment
- Removed unnecessary defensive check in update method
- `LineBreak.ts`: improvements to emergency stretch, threshold handling, and minimum demerits tracking

## [0.2.8] - 2025-12-04

### Added

- Chinese, Japanese, Korean (CJK) now have character-level line breaking / inter-character glue. No breaks before closing punctuation or after opening punctuation
- Mixed script support (automatic switching between CJK and word-based scripts)
- Added `shortLineThreshold` parameter to customize short line detection (default: 0.5)

### Changed

- Hyphenation now on-demand (second pass only if first pass fails)
- Short line detection now checks all lines (not just those with 3 or fewer words)
- Short line detection threshold reduced from 75% to 50% for better balance
- Renamed `disableSingleWordDetection` option to `disableShortLineDetection`

## [0.2.7] - 2025-12-01

### Added

- Polygonized contour cache
- Generic LRU cache in `src/utils/LRUCache.ts`
- Integration tests with real HarfBuzz and fonts
- `npm run benchmark` command for performance measurement

## [0.2.6] - 2025-12-01

### Added

- Added support for OpenType features via `fontFeatures` option in `TextOptions`
- Added `fontFeatures` helper to validate and format feature tags for HarfBuzz

### Changed

- `DebugLogger.ts` has become `Logger.ts` and `debugLogger` is now `logger`
- Optimized font metadata parsing (2x faster) by using integer tag comparisons instead of string decoding

## [0.2.5] - 2025-11-30

### Fixed

- Letter spacing now correctly accounts for trailing spacing in width measurements

## [0.2.4] - 2025-11-26

### Changed

- Switched from `tess2-ts` to `libtess` - submitting type defitinitions to `@types` is a TODO

## [0.2.3] - 2025-11-26

### Fixed

- Three.js adapter now uses `Uint32BufferAttribute` for indices

### Changed

- Examples display render timing showing total time for `Text.create()` call
- Vertex colors are now optional - only added when explicitly provided

## [0.2.2] - 2025-11-24

### Changed

- p5.js adapter now hooks into p5's preload system with `loadThreeTextShaper()` and `loadThreeTextFont()`
- `createThreeTextGeometry()` returns object with `geometry`, `planeBounds`, and `glyphs`
- p5 example tries to stay closer to p5 patterns

## [0.2.1] - 2025-11-24

### Fixed

- Normal vectors are no longer scaled
- Front face normals now point towards viewer

## [0.2.0] - 2025-11-24

### Breaking Changes

**Import paths have changed.** The library is now framework-agnostic with separate adapters:

```javascript
// OLD (v0.1.x)
import { Text } from 'three-text';
import { ThreeText } from 'three-text/react';

// NEW (v0.2.x)
import { Text } from 'three-text/three';
import { Text } from 'three-text/three/react';
```

**Core API changes:**
- Core (`three-text`) now returns raw arrays (`vertices`, `normals`, `indices`)
- Three.js adapter (`three-text/three`) returns `BufferGeometry` (same as before)

### Added

- Framework-agnostic core (zero Three.js dependencies)
- WebGL adapter (`three-text/webgl`)
- WebGPU adapter (`three-text/webgpu`)
- p5.js adapter (`three-text/p5`)
- Custom Vec2, Vec3, Box3Core classes
- Examples for WebGL, WebGPU, and p5.js

### Changed

- React component moved to `three-text/three/react`
- Core returns raw typed arrays instead of BufferGeometry
- All core files use custom vector classes instead of Three.js types

### Fixed

- Build system supports multiple entry points
- TypeScript definitions for all adapters

## [0.1.1] - 2025-11-23

### Fixed

- Numeric map keys
- Removed double curve length calculation

## [0.1.0] - 2025-11-23

Initial alpha release
