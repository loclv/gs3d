---
name: g3-three-facade
description: Use when editing or extending the Three.js-compatible browser facade in web/src/three/ — module layout, tsdown build into web/three.js, keeping web/three.d.ts and package exports in sync, and the test/typecheck loop.
---

# The Three.js facade (`web/src/three/` → `web/three.js`)

The `gs3d` npm package exposes a Three.js-compatible API (`gs3d/three` and
`gs3d/webgpu`) compiled from modular TypeScript sources under `web/src/three/`
into the published ESM entry point `web/three.js`.

## Module map

| file | responsibility |
|---|---|
| `web/src/three/color.ts` | `Color`, sRGB/linear conversions, CSS colour parsing |
| `web/src/three/math.ts` | `Vector2/3/4`, `Euler`, `Quaternion`, `Matrix4`, `MathUtils`, matrix/vector helpers |
| `web/src/three/bounds.ts` | `Plane`, `Ray`, `Sphere`, `Box3`, `rayBoxT`, `raySphereT`, `rayTriangle` |
| `web/src/three/scene.ts` | `Object3D`, `Group`, `Scene`, lights, cameras, `Fog`, `FogExp2` |
| `web/src/three/geometry.ts` | `BufferAttribute`, `InterleavedBuffer*`, `BufferGeometry`, `Mesh`, `InstancedMesh`, `Line`, `Points`, `Sprite` |
| `web/src/three/primitives.ts` | `BoxGeometry`, `SphereGeometry`, `PlaneGeometry`, `CylinderGeometry`, `TorusGeometry`, `PolyhedronGeometry`, `TubeGeometry`, `LatheGeometry`, etc. |
| `web/src/three/shapes.ts` | `Curve`, `CatmullRomCurve3`, `Path`, `Shape`, `ShapeGeometry`, `ExtrudeGeometry` |
| `web/src/three/textures.ts` | Texture/blending/wrap/filter constants, `Texture`, `DataTexture`, `checkerTexture`, `Data3DTexture`, `WebGLRenderTarget`, loaders |
| `web/src/three/materials.ts` | `FrontSide`/`BackSide`/`DoubleSide`, `Material`, `MeshBasicMaterial`, `MeshStandardMaterial` (+ aliases), `ShaderMaterial`, `RawShaderMaterial` |
| `web/src/three/raycaster.ts` | `Raycaster` (AABB early-out, exact world-space distance/point, `InstancedMesh`, `OrthographicCamera`, UVs, `side` culling) |
| `web/src/three/controls.ts` | `OrbitControls` |
| `web/src/three/bridge.ts` | Engine state WeakMaps, resource release, `ensureTexture`, `ensureGeometry`, `materialSignature` |
| `web/src/three/raw-shader.ts` | `ShaderMaterial`/`RawShaderMaterial` GLSL defines, attribute rewriting, uniform upload |
| `web/src/three/on-before-compile.ts` | `onBeforeCompile` GLSL translation and `ensureMaterial` |
| `web/src/three/sync.ts` | Scene tree, `InstancedMesh`, camera, lights, environment, fog, and background sync |
| `web/src/three/renderer.ts` | `WebGPURenderer`, `WebGLRenderer`, output/tone-mapping/shadow constants |
| `web/src/three/pmrem.ts` | `PMREMGenerator` and `RoomEnvironment` |
| `web/src/three/index.ts` | Public barrel exports |
| `web/src/three/gs3d-env.d.ts` | Ambient declaration for `./gs3d/app.js` |

## Build & TypeScript invariants

* **`useDefineForClassFields: false`** in `web/tsconfig.json`: required so
  TypeScript class field declarations do not clobber subclass or `Object.assign`
  initializations from `super()`.
* **`web/tsdown.config.ts`**:
  * `fixedExtension: false` so `"type": "module"` still emits `web/three.js`
    (not `.mjs`).
  * `deps.neverBundle: ['./gs3d/app.js']` so the Emscripten loader and
    `new URL('./gs3d/app.wasm', import.meta.url)` stay external runtime imports.
  * `dts: false` so the hand-tuned public declarations in `web/three.d.ts` are
    preserved; update `web/three.d.ts` whenever public signatures change.
* **Package allowlist**: `web/test_package_exports.mjs` and
  `web/test_package_tarball.mjs` enforce that `web/package.json`'s `"files"`
  matches `"exports"` + `LICENSE` + `gs3d/app.js` + `gs3d/app.wasm`. Keep
  `src/three/` out of `"files"`.

## Verify loop

```bash
npm --prefix web test
npm --prefix rsbuild-project run check && npm --prefix rsbuild-project run build
```

`npm --prefix web test` runs `tsc --noEmit` (`check:three`), `tsdown`
(`build:three`), and all 10 facade/package/upstream test suites.
