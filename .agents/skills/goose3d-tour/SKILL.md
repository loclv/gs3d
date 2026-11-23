---
name: goose3d-tour
description: Use when starting work in the goose-3d repository — a map of the engine, its entry points, the build and verify loop, and the invariants a change must not break.
---

# A tour of the goose-3d engine

A small real-time 3D engine written entirely in [Goose](https://github.com/aardappel/goose)
(memory-safe, no heap, no GC), rendering through WebGL2 in a browser and through
a CPU rasterizer headless. Roughly 2,500 lines of Goose + 1,200 lines of C.

Read this before touching anything. It tells you where each concern lives, how
to build and verify, and which properties the codebase treats as contractual.

## The shape of it

```text
your scene (Goose: nodes, camera, materials)
        │
        ▼
src/g3/*.goose — math, mesh arena, scene, renderer, engine facade
        │   one call per frame: g3p_draw_frame(sorted DrawItems, ViewState)
        ▼
platform/g3_abi.h — the packed structs that cross the boundary
        │
   ┌────┴─────────────────────┐
   ▼                          ▼
platform/g3_web.c        platform/g3_soft.c
WebGL2 / Emscripten      CPU rasterizer, PPM out, N threads
   │                          │
canvas in a browser      frame.ppm / read_pixel for tests
```

The engine owns everything except presentation. It computes matrices, culls
nodes, packs and sorts a draw list, and hands the backends one call per frame.
No GL call, no window, no file I/O appears anywhere in `src/g3/`.

## The files

### Engine (pure Goose, no backend knowledge)

| file | what it owns |
|---|---|
| `src/g3/math.goose` | `Mat4` (column-major `m[col*4+row]`), `mat4_mul/trs/translate/scale/rotate_*/perspective/ortho/look_at/invert/transpose`, `mat4_transform_point`/`apply`/`apply_dir`, `Aabb` + `aabb_*`, `Plane`/`Frustum` + Gribb–Hartmann extraction + p-vertex `frustum_intersects` |
| `src/g3/mesh.goose` | two grow-only arenas (`g_verts`, `g_indices`), a `Mesh` record arena, `push_vertex`/`push_triangle`/`push_grid`/`mesh_close`, and the primitives `mesh_cube`/`mesh_sphere`/`mesh_plane` |
| `src/g3/scene.goose` | `Node` arena (handles are `i64` indices), `Camera`, parent hierarchy + `node_update_worlds`, orbit camera |
| `src/g3/physics.goose` | gravity, forces, box/sphere/capsule bodies, impulse collision response |
| `src/g3/rapier.goose` | RapierPhysics-style facade over `g3.physics` (translation only) |
| `src/g3/collision.goose`, `src/g3/picking.goose` | swept segment/sphere tests, raycast picking |
| `src/g3/render.goose` | per frame: view/proj, frustum, cull loop, `pack_item`/`sort_key`, sort, submit; `Stats`; lighting setters |
| `src/g3/engine.goose` | `init`/`frame(dt)`/`shutdown`, 512-key input state with edge detection, `read_pixel`, `save_frame`, `KEY_*` codes |
| `src/g3/platform.goose` | the seam: `Vertex`, `DrawItem`, `ViewState`, and every `extern fn g3p_*` |

### Entry points (each compiles to its own program)

| root | backend | purpose |
|---|---|---|
| `src/app_web.goose` | `platform/g3_web.c` + `g3_webgpu.c` | default browser build; no `main` — exports `g3_app_init/g3_app_frame/...`, page drives frames; WebGPU preferred, WebGL2 fallback |
| `src/app_native.goose` | `platform/g3_soft.c` | headless; renders N frames, prints stats, writes a PPM; `--frames/--width/--height/--out` |
| `src/test_math.goose` | none | 99 hand-derived checks on `math.goose`; needs no surface |
| `src/test_engine.goose` | `platform/g3_soft.c` | 333 checks on whole frames, read back with `g3::read_pixel` |
| `src/test_game.goose` | `platform/g3_soft.c` | 4 checks on the Beacon Run rules |
| `src/test_siege.goose` | `platform/g3_soft.c` | 33 checks on Rift Siege rules, sweeps, physics colliders and the `g3.rapier` facade |
| `src/benchmark_transforms.goose` | none | native transform benchmark |
| `src/game_web.goose` | `platform/g3_web.c` | Beacon Run browser build (`--game`) |
| `src/siege_web.goose` | `platform/g3_web.c` | Rift Siege browser build (`--siege`) |
| `src/viewer_web.goose` | `platform/g3_web.c` | model viewer (`--viewer`) and animation benchmark (`--animation-benchmark`) |
| `src/gs3d_web.goose` | `platform/g3_web.c` | `gs3d` package facade build (`--gs3d`) |
| `src/benchmark_web.goose` | `platform/g3_web.c` + `g3_webgpu.c` | draw-call benchmark (`--benchmark`) |
| `src/reference_web.goose` | `platform/g3_web.c` | WebGL API reference checks (`--reference-checks`) |

`src/demo/scene.goose` is the shared scene the two `app_*` roots build.
`src/testing.goose` is the `check`/`finish` harness the test roots use.

### Platform (C, behind the ABI)

| file | what it owns |
|---|---|
| `platform/g3_abi.h` | the packed structs + `_Static_assert`s pinning every offset |
| `platform/g3_input.{h,c}` | key table + mouse deltas shared by both backends; each backend supplies only `g3_backend_resize` |
| `platform/g3_web.c` | WebGL2 backend: one program, one VAO per mesh, one draw call per item; `g3_host_start` is the page's entry point |
| `platform/g3_soft.c` | CPU rasterizer: serial transform pass into a display list, then row-block-parallel rasterization on N threads; z-buffered, perspective-correct, PPM out, optional profiler (`G3_PROFILE=1`) |

### Web shell

`web/index.html` (canvas + stats line + status overlay), `web/shell.js` (boot +
rAF loop), `web/canvas.js` (device-pixel sizing), `web/input.js` (key map,
pointer capture), `web/hud.js` (status line + stats line).

## Build and verify

```bash
./build_native.sh --test # builds app_native + the test roots, runs them all
./build/app_native --frames 8 --width 960 --height 600 --out f.ppm
./build_web.sh # web/app.js + app.wasm
./build_web.sh --serve # ... and serve on :8080
goose check src/app_native.goose # typecheck one root, expect 0 warnings
```

Verification ladder, cheapest first — use the lowest rung that proves the change:

1. `goose check <root>` — must print zero warnings. The repo has none; a new
   warning is a defect, not noise.
2. `./build_native.sh --test` — 99 math + 333 frame + game and siege checks, exit non-zero on failure.
3. Byte-identical frames. Any change that is meant to be behaviour-preserving
   must render the same bytes as before: keep a PPM from the old build and `cmp`
   it. Pitfall: the demo scene animates, so compare renders with the **same
   `--frames` and same size** — `--frames 5` and `--frames 120` are different
   pictures.
4. `./build_web.sh` then a headless-Chrome DOM dump to confirm the browser path
   still boots and reports the same scene stats (see `g3-testing-and-profiling`).

## Invariants

* No `g3p_` call from `src/g3/` outside `platform.goose`. The engine stays
  backend-agnostic; that is what lets two very different backends serve it.
* Draw list order is the contract. Backends draw items in the order given;
  `key` only explains the order. Opaque keys are mesh ids (batching), blended
  keys are far→near above 1000000.
* The ABI is packed and static-asserted. Adding or moving a field means
  updating `platform/g3_abi.h`, its asserts, and the README table together.
* The two backends share their fragment math term for term. `g3_soft.c`'s
  `shade()` is the GLSL in `g3_web.c` written out in C; changing one without the
  other is a bug even if nothing fails.
* The CPU backend's output is deterministic. Same inputs → same bytes,
  regardless of thread count (verified: 1/3/5/8 workers `cmp` clean).
* Nothing is heap-allocated in Goose. Geometry, nodes and the draw list are
  grow-only globals; handles are indices into them.
* Records are never shrunk. `node_add` hands out references that stay valid
  for the life of the program; `scene_clear()` is the only reset and the
  compiler enforces that no live reference survives it.

## Where to go next

* Language mechanics and traps → skill `goose-language-notes`
* The ABI, offsets and adding a backend → skill `g3-abi-and-backends`
* Adding a rendering feature → skill `g3-adding-a-render-feature`
* Tests, byte comparisons, profiling → skill `g3-testing-and-profiling`
* Reference material: `docs/architecture.md`, `docs/abi.md`, `docs/performance.md`
