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
| `web/src/three/math.ts` | `Vector2/3/4`, `Euler`, `Quaternion`, `Matrix4`, `Clock`, `MathUtils`, matrix/vector helpers |
| `web/src/three/bounds.ts` | `Plane`, `Ray`, `Sphere`, `Box2`, `Box3`, `Line3`, `Triangle`, `Frustum`, intersection helpers |
| `web/src/three/events.ts` | `EventDispatcher` base (`addEventListener`/`dispatchEvent`/`removeEventListener`) |
| `web/src/three/scene.ts` | `Object3D`, `Group`, `Scene`, lights, cameras, `Fog`, `FogExp2`, `CubeCamera` |
| `web/src/three/geometry.ts` | `BufferAttribute`, `InterleavedBuffer*`, `BufferGeometry`, `Mesh`, `InstancedMesh`, `Line`/`LineSegments`/`LineLoop`, `Points`, `Sprite` |
| `web/src/three/primitives.ts` | `BoxGeometry`, `SphereGeometry`, `PlaneGeometry`, `CylinderGeometry`, `TorusGeometry`, `PolyhedronGeometry`, `TubeGeometry`, `LatheGeometry`, `WireframeGeometry`, `EdgesGeometry`, etc. |
| `web/src/three/shapes.ts` | `Curve`, `CatmullRomCurve3`, `Path`, `Shape`, `ShapeGeometry`, `ExtrudeGeometry` |
| `web/src/three/textures.ts` | Texture/blending/wrap/filter constants, `Texture`, `DataTexture`, `Data3DTexture`, `CubeTexture`, `CompressedTexture`, `checkerTexture`, `WebGLRenderTarget`, `TextureLoader`/`ImageLoader`/`ImageBitmapLoader` |
| `web/src/three/materials.ts` | `FrontSide`/`BackSide`/`DoubleSide`, `Material`, `MeshBasicMaterial`, `MeshStandardMaterial` (+ `MeshPhysicalMaterial` alias and PBR accessors), all light/material subclasses, `ShaderMaterial`, `RawShaderMaterial` |
| `web/src/three/animation.ts` | `KeyframeTrack` family, `Interpolant`s, `PropertyBinding`, `AnimationClip`, `AnimationMixer`, `AnimationAction`, loop/fade modes |
| `web/src/three/loaders.ts` | `LoadingManager` (assignable `onLoad`/`onProgress`/`onError`/`onLoadAll` fields), `FileLoader`, `Cache`, `Loader` base |
| `web/src/three/helpers.ts` | `AxesHelper`, `GridHelper`, `ArrowHelper`, `Bone`, `Skeleton`, `SkinnedMesh`, `CameraHelper`, light/box/plane/polar helpers |
| `web/src/three/compat.ts` | r180 parity surface with no engine backing: remaining constants, curve/coordinate/matrix classes, typed attrs, texture/RT variants, `ArrayCamera`/`StereoCamera`/`LOD`/`BatchedMesh`, audio stubs, loader stubs, uniforms/shader objects, `Timer`, `SphericalHarmonics3` |
| `web/src/three/raycaster.ts` | `Raycaster` (AABB early-out, exact world-space distance/point, `InstancedMesh`, `OrthographicCamera`, UVs, `side` culling) |
| `web/src/three/controls.ts` | `OrbitControls` |
| `web/src/three/bridge.ts` | Engine state WeakMaps, resource release, `ensureTexture`, `ensureGeometry`, `materialSignature` |
| `web/src/three/raw-shader.ts` | `ShaderMaterial`/`RawShaderMaterial` GLSL defines, attribute rewriting, uniform upload |
| `web/src/three/on-before-compile.ts` | `onBeforeCompile` GLSL translation and `ensureMaterial` |
| `web/src/three/sync.ts` | Scene tree, `InstancedMesh`, camera, lights, environment, fog, and background sync |
| `web/src/three/renderer.ts` | `WebGPURenderer` (`WebGLRenderer` alias), `outputColorSpace`/`coordinateSystem` accessors, tone-mapping/shadow constants |
| `web/src/three/pmrem.ts` | `PMREMGenerator` and `RoomEnvironment` |
| `web/src/three/index.ts` | Public barrel exports (re-exports `./compat`) |
| `web/src/three/gs3d-env.d.ts` | Ambient declaration for `./gs3d/app.js` |
| `web/check_three_compat.mjs` | Diff script: three r180 exports + prototype members vs built `web/three.js` |

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
* **API parity conventions** (enforced by `web/check_three_compat.mjs`,
  which diffs three r180 exports and prototype members against built
  `web/three.js`; currently 0 missing exports / 0 missing methods):
  * Prototype **accessors**, not instance fields, where three uses them
    (`needsUpdate`, `alphaTest`, `onBeforeRender`/`onAfterRender`/
    `onBeforeShadow`/`onAfterShadow`, `outputColorSpace`, `coordinateSystem`,
    Quaternion `x`/`y`/`z`/`w`). `useDefineForClassFields: false` keeps these
    safe.
  * `Object3D` has no `up` field (unlike three); Euler↔quaternion sync is lazy
    via `bridge.ts` `resolvedQuaternion` — don't hand-sync in methods.
  * Matrix layout is column-major 16-element `elements[]`, same as three.
  * `Material.onBeforeCompile` exists on the base class (three parity) but is
    marked `_gs3dDefault`; `on-before-compile.ts` skips it so only
    user-defined hooks run the OBC path (which resets `customUniforms`).
  * `compat.ts` classes without engine backing are functional stubs — keep
    them honest (store state, return `this`, no fake GPU work).
* **Package allowlist**: `web/test_package_exports.mjs` and
  `web/test_package_tarball.mjs` enforce that `web/package.json`'s `"files"`
  matches `"exports"` + `LICENSE` + `gs3d/app.js` + `gs3d/app.wasm`. Keep
  `src/three/` out of `"files"`.

## Verify loop

```bash
npm --prefix web test
npm --prefix web run build:three && node web/check_three_compat.mjs --methods --verbose
npm --prefix rsbuild-project run check && npm --prefix rsbuild-project run build
```

`npm --prefix web test` runs `tsc --noEmit` (`check:three`), `tsdown`
(`build:three`), and all facade/package/upstream test suites. The compat
script needs `three` installed (`npm i --no-save three@0.180.0` in `web/`)
and reports missing exports plus per-class missing methods; keep both at 0
when touching the public surface.
