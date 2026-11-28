---
name: g3-performance
description: Use when optimizing goose-3d hot paths — scene-graph updates, culling, draw-list packing, the JS↔wasm boundary, or InstancedMesh sync — with the version/dirty-flag pattern this repo uses to keep per-frame cost proportional to change.
---

# Performance work in goose-3d

The engine's performance story is one pattern applied at every layer: **cache
the inputs, version the outputs, skip unchanged work**. Before adding a new
fast path, find the version/dirty flag that already guards the stage you are
about to optimize — duplicating a cache is how this codebase grew its two
worst bugs (see Pitfalls).

Read `docs/performance-scene-sync.md` for the full map of the version chain;
`docs/performance.md` for CPU-raster measurements and methodology.

## The version chain

```text
Object3D TRS ─ _lmCache/_lmChanged ─ matrix/matrixWorld (_worldVer)
  ─ _g3_asset_matrix16_bulk ─ Node.local_cache/world_version
  ─ DrawItem MVP + cull caches (world_version, view_proj_version, bounds_version)
```

Rules that keep it correct:

- A version bumps **only on writes that change the output**, never on reads.
  Compare-then-bump (`mat4_equals`, field compares) is the norm.
- Consumers store the version they last consumed; equal means bit-identical,
  skip the stage entirely.
- `world_dirty`-style sticky flags are *consumed* by the next refresh — set
  them only where the version actually bumped.

## Where the hot paths live

| Stage | File | Guard |
|---|---|---|
| local transform compose | `web/src/three/bridge.ts` `localMatrixOf` | `_lmCache` field compares, `_lmChanged` on miss |
| world matrix compose | `web/src/three/scene.ts` `updateMatrixWorld` | `_worldVer`/`_worldParentVer` vs module `worldMatrixVersion` |
| node → engine sync | `web/src/three/sync.ts` `syncNode`/`syncSceneTree` | `record.matrix` compare; `opts.defer` bulk list |
| InstancedMesh sync | `web/src/three/sync.ts` `syncInstancedMesh` | `_syncMatVer`/`_syncColVer`/`_syncCount`/`_syncParent`/`_syncGeometry` + `updateRanges` |
| node worlds | `src/g3/scene.goose` `node_update_worlds` | `worlds_frame` stamp + `cached_parent_world_version` |
| node local TRS | `src/g3/scene.goose` `node_local_cache_changed` | `cached_pos/rot/scale/local_matrix` compares |
| frustum cull | `src/g3/render.goose` `render_scene` | `cached_cull_*` version tuple |
| draw-item MVP | `src/g3/render.goose` | `cached_mvp_view_version` |
| mesh span alloc | `src/g3/mesh.goose` | spans sorted by `(kind, first)`, tail-take |
| glTF JSON | `src/g3/gltf_native.goose` `glb_ensure_document` | parse-once per path, append-only globals |

## Adding a new cached stage — checklist

1. **Name the invalidation inputs precisely.** A cache keyed on "the object"
   is wrong; key on every field that feeds the output (transform *and* parent
   version *and* geometry version *and* material identity).
2. **Bump only on real change.** If two different computations can produce the
   same bits, compare outputs (`mat4_equals`) rather than trusting the write.
3. **Mind product order.** `mat4_mul` is not associative in f32; two correct
   association orders differ in the last ulp. Pick one path per node and keep
   it — alternating paths makes `mat4_equals` see phantom changes every frame.
4. **Goose borrow checker.** You cannot clear globals whose pool nodes alias
   other globals (the glTF document cache is append-only for this reason).
   `let x .= g_nodes[i]` binds a reference — use it instead of copying the
   ~400-byte `Node`.
5. **Recycled slots reset caches.** `node_asset_add`/`mesh_asset_add` reuse
   freed indices; any per-slot cache fields must be re-initialized in the
   `Node { .. }` literal or they inherit the dead node's versions.

## The bulk-upload pattern (JS → wasm)

One `_g3_asset_*` export call per element is a boundary crossing each. When a
stage produces N small writes per frame:

1. Add a Goose export taking slices, e.g.
   `export fn g3_asset_matrix16_bulk(nodes: i32[:], mats: f32[:])` in
   `src/g3/asset_web.goose`.
2. Add the `_g3_asset_*` name to the `exports=` list in `build_web.sh`
   (the `--gs3d` variant uses `asset_exports`) — **the build silently drops
   unlisted exports**.
3. In TS, collect `(index, src, offset)` during the walk, then pack into
   `_malloc`'d wasm memory (`HEAPU8.buffer` views) and make one call; `_free`
   in `finally`. Fall back to per-element calls when malloc fails or the
   export is absent (older wasm).
4. Keep a threshold: below ~3 dirty items the malloc+pack costs more than the
   crossings saved.

## Measuring and verifying

- **Correctness net first**: `CC=/usr/bin/cc ./build_native.sh --test` asserts
  byte-identical PPMs across worker counts — a stale cache changes pixels, so
  this catches wrong-version bugs that unit tests miss.
- `goose check` must run on the **entry file** (`src/gs3d_web.goose`,
  `src/test_engine.goose`), not on `asset_web.goose`/`scene.goose` directly.
- Facade: `cd web && npx tsc --noEmit && npm run build:three && npm test`.
- Browser timings: `npm run test:browser` (reference checks + morph benchmark
  medians/p95). Note: `test_browser_reference.mjs` currently has a
  pre-existing `point shadow changes rendered pixels` failure under
  SwiftShader — verified unrelated to perf work.
- wasm rebuild after Goose changes: `./build_web.sh --gs3d` (or the variant
  you need). `web/gs3d/app.{js,wasm}` are gitignored build artifacts.

## Pitfalls that already happened here

- **Dropping an invalidation block during a rewrite.** `syncInstancedMesh`'s
  `_tintedSourceMaterial` check must run *before* the field is overwritten,
  and `retint` must be computed first — the test caught a stale tinted
  material that survived a `material` swap.
- **Skip-path holes.** `dispose()` clearing `_instances` left length 0, which
  a version fast-path treated as "unchanged" — always compare counts *and*
  guard empty states.
- **Deferred-upload ordering.** `record.matrix` must be updated when the
  upload is *deferred*, not when it flushes, or the next frame re-uploads.
- **`onBeforeCompile` parity trap**: adding a hook to base `Material` for API
  parity made every material take the custom-shader path; mark facade defaults
  with `_gs3dDefault` so only user overrides trigger it.
