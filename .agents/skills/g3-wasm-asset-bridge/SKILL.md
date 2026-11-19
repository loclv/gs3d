---
name: g3-wasm-asset-bridge
description: Use when adding or optimizing JS-to-Goose/Wasm bridge calls (src/g3/asset_web.goose, platform/g3_web.c, build_web.sh, web/assets.js, web/src/three/bridge.ts, web/src/three/sync.ts) — slice ABI shims, bulk uploads, and mock-engine fallbacks.
---

# The JS ↔ Goose/Wasm asset bridge

Browser asset loaders (`web/assets.js`) and the Three.js facade
(`web/src/three/`) drive the engine through `g3_asset_*` (Goose exports in
`src/g3/asset_web.goose`) and `g3_host_*` (C shims in `platform/g3_web.c`).

## Why bulk calls matter

Crossing the JS→Wasm boundary per vertex, per triangle, or per matrix element
dominates load and sync time. Conversely, moving small pure math (`Vector3`,
`Matrix4`) to Wasm is slower than V8-inlined JS. Put **bulk data transfers** and
**batched state updates** across the seam.

## The slice ABI trap (`const f32[:]` / `const u32[:]`)

Goose compiles slices (`const f32[:]`, `const u32[:]`) to C value structs
(`sl_f32`, `sl_u32` in `build/web/g3.h`: `{ T *data; int64_t len; }`). JS cannot
pass a Wasm heap pointer directly to a Goose slice parameter.

Use the two-layer pattern (`g3_host_mesh_update`, `g3_host_mesh_upload`):

1. **Goose (`src/g3/asset_web.goose`)**: `export fn g3_asset_*(..., verts: const f32[:], ...)`
2. **C shim (`platform/g3_web.c`)**: `EMSCRIPTEN_KEEPALIVE ... g3_host_*(uint32_t ptr, int32_t count, ...)`
   * Validate non-null pointer, 4-byte alignment (`ptr % 4 == 0`), positive
     counts, stride divisibility (e.g. `float_count % 30 == 0`), and bounds
     against `emscripten_get_heap_size()`.
   * Construct `sl_f32` / `sl_u32` and forward to `g3_asset_*`.
3. **Exports (`build_web.sh`)**:
   * Add `"_g3_asset_*"` and `"_g3_host_*"` to `asset_exports`.
   * Ensure required runtime views (`HEAPU8,HEAPU32,HEAPF32`) are in
     `-sEXPORTED_RUNTIME_METHODS`.

## Current bulk paths & mock fallbacks

* **Matrices**: `g3_asset_matrix16(id, m0..m15)` writes all 16 `local_matrix.m`
  floats in 1 Wasm call. Both `web/src/three/sync.ts` (`syncNode`) and
  `web/assets.js` (`writeNodeMatrix`) use `_g3_asset_matrix16` when present and
  fall back to `_g3_asset_matrix` for mock engines.
* **Geometry**: `g3_host_mesh_upload` → `g3_asset_mesh_upload` uploads a
  contiguous `count * 30` `f32` vertex buffer (`pos[3], normal[3], uv0..7[16],
  tangent[4], color[4]`) and `u32` index buffer in 1 call. Both
  `web/src/three/bridge.ts` (`uploadGeometryBulk`) and `web/assets.js`
  (`uploadPrimitiveMeshBulk`) allocate with `_malloc`, always `_free` in
  `finally`, and fall back to `_g3_asset_mesh_begin`/`_g3_asset_vertex`/
  `_g3_asset_triangle`/`_g3_asset_mesh_end` when `_g3_host_mesh_upload` or
  `HEAPF32` is absent on a mock.

## Build & verify loop

```bash
goose check src/gs3d_web.goose
./build_web.sh --gs3d
npm --prefix web test
./build_native.sh --test
```
