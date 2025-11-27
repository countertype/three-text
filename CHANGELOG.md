# Changelog

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
