# Scene-graph and facade sync performance

How the engine and the Three.js facade keep per-frame cost proportional to
*what changed*, not to scene size. The unifying idea: every layer caches its
inputs behind a version or dirty flag, so a static scene costs a few compares
per object per frame instead of recomputing transforms, matrices and uploads.

`performance.md` measures the CPU rasterizer; this document covers the scene
graph (`src/g3/scene.goose`), the cull/draw path (`src/g3/render.goose`), and
the JavaScript↔wasm boundary (`web/src/three/`).

## The version-chain pattern

Each layer exposes a monotonically increasing version that only bumps when its
output actually changes:

```text
Object3D TRS fields
  -> _lmCache / _lmChanged        (bridge.localMatrixOf)
  -> matrix / matrixWorld          (Object3D.updateMatrixWorld)
  -> _g3_asset_matrix16_bulk       (one wasm call per frame, dirty nodes only)
  -> Node.local_matrix / world     (node_local_cache_changed, world_version)
  -> DrawItem MVP / cull caches    (world_version, view_proj_version, bounds_version)
```

A consumer stores the version it last consumed; equal versions mean the input
is bit-identical and the whole stage is skipped. Versions are cheap (one `i64`
compare) and correct by construction — they bump only on writes, never on
reads.

## Engine side (Goose)

### `node_update_worlds` — O(n·depth) → O(n) compares

Before, every node walked its full ancestor chain multiplying cached locals
every frame: depth × 64-float `mat4_mul` per node, static or not. Now
(`src/g3/scene.goose`):

- `worlds_frame` stamps each node with the pass that last validated its
  `world`. `g_world_frame` increments once per call.
- A node skips entirely when its local transform is unchanged
  (`node_local_cache_changed`), its parent link is stable
  (`cached_world_parent`), the parent was already refreshed this pass
  (`worlds_frame == frame`), and the parent's `world_version` equals
  `cached_parent_world_version` — the version this world was composed from.
- Changed nodes compose in O(1): `world = parent.world * local`, using the
  parent's already-fresh world. Parents precede children in `g_nodes` because
  a parent must exist before its children are added.
- The rare out-of-order node (a recycled low index parented under a high
  index) falls back to the ancestor walk, which multiplies *cached locals* —
  correct regardless of parent-world staleness. `cached_parent_world_version`
  then records the pre-update version, so the node recomputes once more next
  pass and stabilizes.

Product-order note: the O(1) path associates `(parent_world * local)` while
the walk associates `root * (... * (parent * local))`. The results can differ
by float rounding, but each node always takes the same path, so its stored
`world` is stable and `mat4_equals` never sees spurious diffs.

### Local transform cache for *all* nodes

`node_local` is `mat4_trs` (three sin/cos) or a stored `local_matrix`. The old
code cached it only for roots, so every descendant recomputed its ancestors'
TRS per frame. `node_cache_local`/`cached_local` now cover every node; the
cache compares ~10 fields (pos/rot/scale or 16 matrix floats) per node per
pass — orders of magnitude cheaper than trig.

### Cull and draw caches keyed on `world_version`

`render_scene` (`src/g3/render.goose`) caches per node:

- `cached_cull_world_version` + `cached_cull_view_version` +
  `cached_cull_mesh` + `cached_cull_bounds_version` → skip the world-AABB
  transform and frustum test entirely when nothing moved.
- `cached_mvp` / `cached_mvp_view_version` → draw items reuse the model-view
  projection until `world_version` or the view changes.
- `world_dirty` is a sticky flag consumed by draw-item refresh; it is set
  only inside the `world_version += 1` branches.

Distance-dependent work (blended sort key, LOD selection, distance culling)
is computed lazily — only for nodes that are blended, have an LOD mesh, or
when `max_view_distance` is enabled.

### Span allocator

`span_take` allocates from the tail of each free span and spans stay sorted
by `(kind, first)`, so `span_release` merges with immediate neighbours instead
of rescanning until stable — O(1)-ish per release instead of O(spans²) for
churny `mesh_compact` workloads (`src/g3/mesh.goose`).

### glTF parse-once document cache

`native_glb_load_node_mesh` used to re-read **and re-parse the entire file per
mesh node and per primitive** — M mesh nodes cost M×(P+1) full JSON parses.
`glb_ensure_document` (`src/g3/gltf_native.goose`) parses once per path into
append-only globals; documents accumulate because the borrow checker forbids
clearing pools whose nodes alias the byte store — matching the engine's
grow-only model. Buffer bases are absolute offsets into the accumulated
bytes, so earlier documents stay valid.

## Facade side (TypeScript → wasm)

### Dirty-skip world matrices in JS

`bridge.localMatrixOf` caches the composed local matrix on the object
(`_lmCache`, ~12 field compares per call) and sets `_lmChanged` only when the
cache misses. `Object3D.updateMatrixWorld`/`updateWorldMatrix` recompute
`matrixWorld` only when the local changed, `matrixAutoUpdate` is off, or the
parent's `_worldVer` advanced (`worldMatrixVersion` is a module counter bumped
on every recompose). A static subtree now costs compares, not 4×4 multiplies.

### Allocation-free matrix math

`worldMatrixOf` used to allocate one `Float64Array` per ancestor per call.
It now walks parents into shared `_wmAcc`/`_wmTmp` scratch via
`multiplyMat4Into` (added to `math.ts`; `multiplyMatrices` uses the same
scratch for the aliasing case) and copies out once.

### Bulk wasm uploads

`_g3_asset_matrix16` is one wasm boundary crossing per node. Two bulk paths
now exist on top of `_g3_asset_matrix16_bulk(nodes, mats)`
(`src/g3/asset_web.goose`, exported via `build_web.sh`):

- **InstancedMesh** (`syncInstancedMesh`): version bookkeeping
  (`_syncMatVer`, `_syncColVer`, `_syncCount`, `_syncParent`, `_syncGeometry`)
  skips the whole sync when inputs are unchanged; `instanceMatrix.updateRanges`
  narrow the update to touched instances with three's consume-on-upload
  semantics; `ensureGeometry`/`ensureMaterial` are hoisted out of the
  per-instance loop; dirty matrices pack once into wasm memory for a single
  bulk call (per-node fallback on alloc failure or older wasm).
- **All scene nodes** (`syncSceneTree`): `syncNode` accepts `opts.defer`; the
  walk collects `[index, src, off]` triples and `flushDeferredMatrices` issues
  one bulk call when ≥3 nodes moved (fewer takes the direct path — malloc +
  pack wouldn't pay off).

### Per-frame container reuse

`WebGPURenderer.render` allocates a `seen` Set and a frame material cache Map
per frame; both are now renderer-owned and `clear()`ed — `WeakMap`/`Map`
capacity survives across frames.

## What is *not* cached (deliberately)

- `node_local_cache_changed` still compares every node's TRS fields every
  pass — O(n) cheap compares are the floor; skipping them would need a
  write-side dirty flag on every mutation path (TRS setters, physics writes,
  `local_matrix` uploads), which is where bugs hide.
- `collectLights` still walks the scene separately from `syncSceneTree` —
  merging the traversals saves pointer-chasing, not math, and the ordering
  (lights need world matrices) makes it awkward.
- `syncedObjects` cleanup iterates the synced set each frame; it is O(synced)
  Set deletes, unavoidable without a scene-generation counter.

## Measuring

- Native: `CC=/usr/bin/cc ./build_native.sh --test` — the suite asserts
  byte-identical PPMs across worker counts, which is the regression net for
  every cache above (a stale world matrix changes pixels).
- Browser: `npm run test:browser` runs the reference render checks and the
  morph/instancing benchmark (`benchmark/animation.html` reports model-update
  and engine-frame medians/p95).
- Facade unit tests: `cd web && npm test` — covers sync version bookkeeping,
  update ranges, tinted-material invalidation and the bulk paths via a mock
  engine.

## Known limitation

`test_browser_reference.mjs` currently fails one check —
`point shadow changes rendered pixels` — under headless Chrome + SwiftShader.
Verified pre-existing (fails identically at `a965f65`, before this work, and
with `scene.goose` reverted); spot shadows pass, so it is cube-map specific
and likely a SwiftShader/ANGLE issue rather than engine code. The wasm build
was broken from `63d8ad7` until the `glGetTexImage` declaration fix, so this
path had not run against recent source.
