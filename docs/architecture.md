# Architecture

How a scene becomes pixels, why it is shaped this way, and which properties are
load-bearing. Companion documents: [`abi.md`](abi.md) for the byte-level
contract, [`performance.md`](performance.md) for the measurements, and
[`ideals.md`](ideals.md) for the principles and their checks.

## The one-paragraph version

A Goose program builds a scene by pushing nodes into a global arena and writing
through the references it gets back. Each frame the engine multiplies out the
nodes' world matrices, computes a view-projection matrix, derives six frustum
planes from it, culls nodes, packs surviving nodes into a `DrawItem` each,
sorts that list, and hands it to the backend in a single call. The default
browser page prefers WebGPU and falls back to WebGL2; specialized browser tools
use WebGL2, and headless tests use the CPU rasterizer. Backends draw the list in
order and know nothing about scenes, cameras or culling. The engine knows
nothing about canvases, GPU state or files.

## Data model: arenas, handles, references

Goose has no heap, so the engine's dynamic data is grow-only global arrays.
Growth never relocates the identity of an element, which turns an index into a
stable handle and lets the API hand out references that remain valid for the
life of the program.

| arena | holds | handle | notes |
|---|---|---|---|
| `g_verts` | every `Vertex` of every mesh | — | one array, meshes are runs inside it |
| `g_indices` | every triangle index | — | `u32`, one array |
| `g_meshes` | `Mesh { id, first_vertex, vertex_count, first_index, index_count, bounds }` | `i32` mesh id | the id is the backend's handle; uploaded once |
| `g_nodes` | `Node { mesh, parent, pos, rot, scale, color, unlit, visible, spec, shine, world }` | `i64` index | `mesh = -1` is a group |
| `g_draws` | `DrawItem` per visible node, per frame | — | `.clear()` each frame |

Consequences worth knowing:

* `mesh_close(fv, fi)` measures the mesh's local bounds (the only time vertex
  positions are read on the Goose side after upload) and uploads the run.
* A node's world matrix is recomputed every frame by walking up `parent` (a
  chain longer than 64 is treated as a loop and stops), so node insertion order
  is irrelevant.
* Nothing is ever removed. `visible = false` hides a node; `scene_clear()`
  empties the scene and the compiler rejects it while any node reference is
  still live.
* The engine is f32 throughout, matching what the GPU computes. A `Mat4` is 64
  bytes and crosses to C without packing.

## The frame

`g3::frame(dt)` in `src/g3/engine.goose` is the whole story:

```
frame(dt)
├── g_time += dt; g_frames += 1
├── sample_input()                     g3p_key_down(i) for all 512 codes,
│                                      previous frame's state kept for edges
├── g_width/height = g3p_width/height  the surface may have been resized
├── begin_frame(time, w, h)            render.goose
│   ├── g_draws.clear(); stats reset
│   ├── node_update_worlds()           each node's world = parent-chain product
│   ├── view = look_at(camera)
│   ├── view_proj = perspective(fov, w/h, near, far) * view
│   ├── frustum  = frustum_from_view_proj(view_proj)   Gribb–Hartmann, 6 planes
│   └── view_state.eye = camera.pos; params.x = time
└── render_scene()
    ├── for each node: skip invisible / group
    │     box = aabb_transform(mesh.bounds, node.world)
    │     if !frustum_intersects(frustum, box) -> stats.culled += 1; continue
    │     dist = |aabb_center(box) - camera.pos|
    │     g_draws.push(pack_item(node, mesh, dist))
    ├── sort(g_draws) by key
    └── g3p_draw_frame(g_draws, view_state)          ← the only call out
```

`pack_item()` is the single place a `DrawItem` is built: it multiplies out
`view_proj * world` once (so no backend ever touches a camera matrix), copies
`model` for world-space normals, and computes the sort key.

### The sort is the batching

* **Opaque** (`color.w >= 1`): key = mesh id. Items of one mesh end up adjacent,
  where a GPU driver saves state changes.
* **Blended** (`color.w < 1`): key = `1000000 + (100000 - distance)`, so blended
  items sort far→near *and* after every opaque item. A backend must draw in list
  order; the blended pass then reads the depth of everything behind it and does
  not write depth itself.

`DrawItem.key` is `f32`; the opaque band stops at 1e6 by construction.

## The seam

`src/g3/platform.goose` declares `Vertex`, `DrawItem`, `ViewState` and eleven
`extern fn g3p_*`. `platform/g3_abi.h` mirrors them with `#pragma pack(1)` and
static asserts. See [`abi.md`](abi.md) for offsets and field semantics.

The engine never calls GL, never opens a file, never reads a key from the OS.
Input, presentation and file output all arrive through the seam.

## The renderer backends

Both must agree on three rules — depth `LESS`, back faces culled, CCW front
faces — and on the fragment maths, because the CPU one is the reference that
tests read pixels from.

### `platform/g3_web.c` — WebGL2 through Emscripten

* One program: vertex shader passes world position and `mat3(model) * normal`;
  fragment shader is the lighting/fog/unlit computation.
* One VAO/VBO/EBO per mesh, uploaded once.
* Per item: set blend state (`params.w`), four uniforms, one
  `glDrawElements`.
* `g3_host_start(width, height)` is the page's entry point: `goose_init` +
  `g3_app_init`. There is deliberately no loop here — `web/shell.js` calls
  `g3_app_frame(dt)` from `requestAnimationFrame`, so a backgrounded tab costs
  nothing and the engine is handed the real delta.
* The first frame checks `glGetError()` once and reports it to the page, so a
  driver problem is a message rather than a blank canvas.

### `platform/g3_webgpu.c` and `web/webgpu.js` — default page

* The WebGPU path handles the built-in demo's meshes, depth, directional
  lighting, fog, unlit materials and transparency. JavaScript owns adapter and
  device setup and copies the packed Goose draw list from WebAssembly memory.
* `web/shell.js` awaits adapter/device and pipeline creation before starting
  Goose. The dispatcher uses WebGL2 when WebGPU is missing or setup fails; a
  failed WebGPU canvas is replaced before WebGL2 takes ownership.
* Textures, render targets, shadows, PBR material extensions, skinning,
  morphing and post-processing are not implemented in this WebGPU path. The
  specialized viewer and reference pages continue to use the complete WebGL2
  backend.

### `platform/g3_soft.c` — CPU reference rasterizer

A z-buffered scanline rasterizer with perspective-correct attributes, plus a PPM
writer, `read_pixel` for tests, and (on native builds) threads.

Its frame has two phases, which is the interesting part:

1. **Transform, serially.** For every item and triangle, `setup_triangle()` does
   the clip-space transform, the back-face test (`det` is *negative* because the
   screen y axis is flipped against NDC), the depth-range test and the screen
   bbox, then the triangle is appended to a display list (`soft_quad`, ~140 bytes
   per triangle in the frame). Transforming once per frame is what makes phase 2
   cheap: the alternative redoes it for every band a triangle touches.
2. **Rasterize, in parallel.** Rows are handed out as 8-row blocks that workers
   claim with `atomic_fetch_add`. Each worker walks the display list in order
   and rasterizes the triangles that reach its rows: edge functions first (a
   sign test, no division), then two divisions for inside pixels, depth test,
   perspective-correct interpolation of world position and normal, `shade()`, and
   an alpha or replace write.

Correctness of the parallel part rests on two facts: row blocks are disjoint, so
no two workers write the same pixel; and each block sees the triangles in
draw-list order, so the blend sequence inside a pixel is exactly the engine's.
Output is therefore independent of the worker count — verified by comparing PPMs
at 1, 3, 5 and 8 workers.

## The web host

```
web/index.html   canvas, #hud (stats), #help (keys), #status (boot/failure)
web/shell.js     boot: redirect local [::] to localhost -> prepare WebGPU ->
                 createGoose3D() -> _g3_host_start(w,h) -> input -> rAF(frame)
web/canvas.js    device-pixel sizing (DPR capped at 2)
web/input.js     KEY_CODES map -> g3_input_key(); pointer drag -> g3_input_mouse()
web/hud.js       status line (with failIfSilent) and the live stats line
```

The engine's state never crosses into JavaScript: the page calls three exported
C functions to push input and resize, and five exported Goose functions to run
frames and read statistics.

## Decisions and the alternatives rejected

| decision | why | what was rejected |
|---|---|---|
| Arenas + index handles | Goose has no heap; growth keeps identity stable | allocating per node (no heap), a linked list (cache, and no stable handle) |
| One call per frame (`g3p_draw_frame`) | the seam stays tiny across the renderers | per-item extern calls (a wasm boundary crossing per item) |
| Sort by mesh for opaque | batching on the GPU is worth more than fewer shaded pixels on the CPU | front-to-back order (would cut CPU overdraw shading ~16 % but break GPU batching) |
| CPU backend as the reference | tests can read pixels without a GPU, and a wrong frame is the engine's fault | a mock backend (proves nothing about the maths) |
| Two roots sharing a demo scene | the browser and the headless render obviously run the same thing | one root with `#ifdef`, which Goose does not do |
| Page owns the clock | real dt, no work in a hidden tab | a `main` loop in C (needs `emscripten_set_main_loop`, fights the page) |
| Row-block threading, not equal bands | the scene's geometry is all below the horizon; equal bands measured 3.1× vs 4.65× | work stealing without atomics, tiles (more bookkeeping for the same balance) |

## Limits, deliberately

No instancing, no node removal, and no BVH — culling is per node,
which is fine to a few thousand nodes.

`docs/` and `.agents/skills/g3-adding-a-render-feature/SKILL.md` contain the
step-by-step recipes for the first four of those.
