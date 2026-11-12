# goose-3d — a 3D engine for Goose, on the web

A small but complete 3D engine written entirely in
[Goose](https://github.com/aardappel/goose), the memory-safe systems language
with no heap, no garbage collector and no lifetime annotations. It runs in a
browser — Goose compiles to C, C compiles to WebAssembly, and the engine's
triangles go out through WebGL2 — and it runs headless on the CPU, which is how
its frames are tested.

```
      your scene (Goose)                      GoS 3D engine (Goose)
  nodes, camera, materials  ──────▶  math · meshes · culling · sorting · draw list
                                                          │  one call per frame
                                    ┌─────────────────────┴─────────────────────┐
                                    ▼                                           ▼
                     platform/g3_web.c  (WebGL2)              platform/g3_soft.c  (CPU)
                     Emscripten → app.wasm                    reference rasterizer
                                    │                                           │
                              canvas in a browser                        frame.ppm / pixel checks
```

The engine knows nothing about a window, a canvas or a GPU: it hands a backend
a sorted list of draw items and the frame's constants. That seam (`src/g3/platform.goose`)
is a dozen `extern fn`s, and both backends here implement the same ones, so the
same scene renders identically in a tab and on disk.

## What's here

| Path | |
|---|---|
| `src/g3/math.goose` | column-major `Mat4`, transforms, perspective, AABB, frustum planes |
| `src/g3/mesh.goose` | the geometry arena and its primitives: cube, sphere, plane |
| `src/g3/scene.goose` | nodes, the parent hierarchy, the camera and its orbit controls |
| `src/g3/render.goose` | per frame: transforms, frustum cull, draw-list pack, sort, submit |
| `src/g3/engine.goose` | `init` / `frame` / `shutdown`, input state, stats |
| `src/g3/platform.goose` | the backend contract: `DrawItem`, `ViewState`, the `g3p_*` calls |
| `src/demo/scene.goose` | the demo scene, written against the public API only |
| `src/app_web.goose` | the browser entry point (no `main`; exported `g3_app_*`) |
| `src/app_native.goose` | the headless entry point: builds, renders N frames, writes a PPM |
| `src/test_math.goose` | known-answer transforms, matrices and frustum planes, no backend |
| `src/test_engine.goose` | known-answer frames, checked by reading pixels back |
| `src/testing.goose` | the `check`/`finish` harness both test roots report through |
| `platform/g3_abi.h` | the C side of the contract, with static asserts on the layout |
| `platform/g3_input.{h,c}` | the key and mouse queue both backends share; each supplies only `g3_backend_resize` |
| `platform/g3_web.c` | the WebGL2 backend (Emscripten), one shader, one draw call per item |
| `platform/g3_soft.c` | the CPU backend: a z-buffered reference rasterizer, threaded over row blocks |
| `docs/` | `architecture.md`, `abi.md`, `performance.md` — the reference detail |
| `.agents/skills/` | five `SKILL.md` guides for working in this repo (map, language, ABI, features, testing) |
| `web/index.html` | the page: a canvas, the stats line, and a status overlay |
| `web/shell.js` | boot and the frame loop — the order things happen in |
| `web/canvas.js`, `web/input.js`, `web/hud.js` | sizing in device pixels, events, and the two lines of text |

## Run it in the browser

### View a textured model

Run `./build_web.sh --viewer --serve` and open <http://localhost:8080/viewer/>.
Drag to orbit, scroll to zoom, click the model to select a mesh, and use Reload
to load and dispose it again. The bundled GLB uses the CC0 Ground Grey texture
credited below; `web/viewer/generate_sample.py` regenerates it.

### Play Beacon Run

Build and serve the sample game with `./build_web.sh --game --serve`, then open
<http://localhost:8080/game/>. Move with WASD or the arrow keys, collect all
eight gold beacons, and avoid the red sentinel. Play again after winning or
being caught. The game logic is in `src/game/arena.goose` and uses the engine's
scene, input, camera, and rendering APIs.
The arena floor uses [Ground Grey](https://polyhaven.com/a/ground_grey), by
Rob Tuytel / Poly Haven (CC0); a local copy is included.

### Engine demo

```bash
./build_web.sh --serve        # builds web/app.js + app.wasm, serves on :8080
```

Then open <http://localhost:8080/>. Arrows orbit, `W`/`S` zoom, `Q`/`E` spin the
glass sphere, and dragging turns the camera.

Emscripten is expected in `.toolchain/emsdk` (gitignored) or on `PATH` via
`EMSDK`; see [Requirements](#requirements). `python3 -m http.server` is only
there because an ES module will not load from `file://` — any static server
works.

## Render a still, headless

The CPU backend needs nothing but the Goose compiler and a C compiler:

```bash
./build_native.sh
./build/app_native --frames 8 --width 960 --height 600 --out frame.ppm
```

```
mesh 5, nodes 12: drew 11 of 11 visible (0 culled, 6884 triangles, 11 draw items)
camera at vec3<f32> { 5.36, 3.76, 7.51 } looking at vec3<f32> { 0.0, 1.5, 0.0 }
wrote frame.ppm: true
```

## Run the tests

```bash
./build_native.sh --test
```

Two roots, both exiting non-zero on a failure:

* **`test_math`** — 98 checks on the math module alone: `I * I`, the order of
  composition, right-handed 90° rotations, the Z-then-Y-then-X Euler order, GL
  clip space (near → −1, far → +1, `d tan(fov/2)` at the edge), `look_at`, the
  full cofactor inverse both ways (clipping back to eye space, and an affine
  TRS * M⁻¹ = I to 1e-6), `transpose`, bounding boxes, and frustum planes for
  a turned camera and for an orthographic projection. No backend is linked and
  no surface is needed — it is pure arithmetic, so a failure names one function.
* **`test_engine`** — 19 checks on whole frames, read back through the ABI:
  silhouette size, exact blending, depth order, hierarchy, culling, winding.

Every expected value is derived by hand in the comment above it rather than
copied out of the engine, so a failure means the thing changed — not that two
halves of the engine agree with each other. Three of those derivations have been
wrong at some point (a rotated cube's box is *not* the cube; the eye sits behind
the near plane by definition, but *inside* the far one) and the code was right,
which is the sort of thing a hand-derived suite finds and a self-consistent one
does not.

```
g3 math self-test
  ok    +90 about y takes +x to -z
  ok    the midpoint of near and far is at z = 0.980
  ok    M * inverse(M) is the identity
  ok    turning a cube widens the box around it to 2.164
98 of 98 checks passed
g3 engine self-test, 400x400
  ok    the right edge falls where 1 / (4 * tan(fov/2)) puts it
19 of 19 checks passed
```

## Profiling the CPU backend

The reference rasterizer times itself when `G3_PROFILE` is set — no rebuild, no
separate binary, so the numbers are the shipped code's:

```bash
G3_PROFILE=1 ./build/app_native --frames 120 --width 960 --height 600
G3_THREADS=1 G3_PROFILE=1 ./build/app_native --frames 120 --width 960 --height 600
```

```
g3_soft profile, 120 frames of 960x600:
  clear      0.07 ms/frame
  setup      0.15 ms/frame  ( 2731 triangles,    55 ns each)
  raster     6.97 ms/frame  (675718 shaded of 692339 pixels, 10.3 ns each)
  frame      7.24 ms/frame  on 8 worker(s), 138 fps
```

The rasterizer runs one worker per logical core, capped at 8. The frame is
split into a serial transform pass and 8-row blocks that workers claim
dynamically, which scales like this:

| workers | frame time | speedup |
|---|---|---|
| 1 | 33.7 ms | 1.00× |
| 2 | 17.6 ms | 1.92× |
| 4 | 9.8 ms | 3.43× |
| 8 | **7.2 ms** | **4.65×** |

Output is byte-identical at every worker count: row blocks are disjoint, so no
two workers write a pixel, and each block walks the draw list in order, so the
blend sequence inside a pixel is still the engine's.

Ablating the inner loop term by term (960×600, one worker) puts 71 % of the frame
in per-pixel shading — `powf` alone is 21 %, the three `sqrtf` 3 %, `expf` 1 % —
and 29 % in the loop around it. Four optimisations were tried and measured; two
were kept, two measured *slower* than the code they replaced. The full tables,
the method, and what is left (lane-wise SIMD, front-to-back ordering for the
~16 % overdraw) are in [`docs/performance.md`](docs/performance.md).

## Using the engine

```goose
import std;
import vec;
import math;
import g3.math;
import g3.platform;
import g3.mesh;
import g3.scene;
import g3.render;
import g3.engine;

fn main() {
    guard g3::init(1280, 720, "hello") else { return; }

    // Meshes live in two arenas; a handle is an i32 that stays valid forever.
    let cube = g3::mesh_cube(1.0);
    let ball = g3::mesh_sphere(0.5, 16, 24);

    // `node` returns a reference into the scene's arena: keep it and write
    // through it. `.=` binds the reference; `=` would copy the node.
    let n .= g3::node(g3::node_add(cube));
    n.pos = float3 { 0.0, 1.0, 0.0 };
    n.color = float4 { 0.9, 0.55, 0.25, 1.0 };
    n.spec = 0.3;
    n.shine = 32.0;

    // Parenting is an index, so hierarchies turn as one.
    let pivot = g3::node_group();
    let child = g3::node_add(ball);
    g3::node_parent(child, pivot);

    g3::set_light(float3 { -0.4, -0.8, -0.4 }, float3 { 1.0, 0.96, 0.88 });
    g3::set_ambient(float3 { 0.34, 0.38, 0.5 }, 0.7);
    g3::set_fog(float3 { 0.09, 0.1, 0.14 }, 0.002);
    g3::camera_orbit(0.6, 0.3, 8.0, float3 { 0.0, 1.0, 0.0 });

    loop {
        n.rot.y += 0.01;
        g3::frame(1.0 / 60.0);        // input, transforms, cull, sort, draw
        if g3::key_pressed(g3::KEY_ESCAPE) { break; }
    }
    g3::shutdown();
}
```

In the browser, the page owns the clock, so the root file has no loop: it
exports `g3_app_init(width, height)` and `g3_app_frame(dt)`, and `web/shell.js`
calls them (`src/app_web.goose` is 30 lines long).

What the API gives you:

* **Meshes** — `mesh_cube(half)`, `mesh_sphere(radius, rings, segments)`,
  `mesh_plane(size, tiles)`, plus `push_vertex`/`push_triangle`/`mesh_close`
  for your own geometry. A handle is uploaded to the backend once.
* **Textures** — import `g3.texture`, call `texture_create(width, height, rgba)`
  with row-major RGBA8 pixels, and assign the returned handle to `node.texture`.
  Built-in meshes have UVs; custom meshes can use `push_vertex_uv`. Both
  backends use bilinear filtering and clamp to the image edges. Image decoding
  belongs to the host; the game demonstrates browser-side decoding. Texture RGB
  multiplies the node colour. Texture alpha is ignored; node colour alpha
  controls blending.
* **Nodes** — `node_add(mesh)`, `node_group()`, `node(id) -> Node&`,
  `node_parent(child, parent)`, `scene_clear()`, and `node_count()`. A node has
  position, euler rotation, scale, colour, `unlit`, `visible`, specular
  strength and shininess.
* **Camera** — `camera() -> Camera&` (fov, near, far, up), `camera_look_at`,
  `camera_orbit(yaw, pitch, distance, target)`, `camera_orbit_nudge`,
  `camera_zoom`.
* **Lighting** — a primary directional light (`set_light`), up to four extra
  directional, point or spot lights (`add_directional_light`, `add_point_light`,
  `add_spot_light`, `clear_lights`), ambient light and a hemispherical sky/ground
  fill (`set_ambient`, `set_environment`) or an equirectangular RGB texture
  (`set_environment_map`), plus fog and background colour. The texture is
  sampled along the surface normal as a diffuse approximation; it is not a
  prefiltered image-based lighting solution or a skybox.
  Add functions return false when parameters are invalid or the limit is reached.
  Point and spot lights use squared linear range falloff; spot angles are
  inner and outer half-angles in radians. `set_directional_shadows(center,
  extent, bias)` enables a 512×512 shadow map for the primary directional
  light; `clear_shadows()` disables it. Extent bounds the map around the
  center, and bias is in normalized depth units.
* **Frame** — `init`, `frame(dt)`, `shutdown`, `width`/`height`/`aspect`/`time`,
  `stats()` (nodes, drawn, culled, triangles, draws), `read_pixel`,
  `save_frame` where the backend can write one.
* **Input** — `key_down`, `key_pressed`, `key_released` with `KEY_*` codes, and
  `mouse_dx`/`mouse_dy` deltas.

## How it works

**Everything is an arena.** There is no heap in Goose, so geometry lives in two
grow-only global arrays — all vertices, all indices — and each mesh is a small
record saying where its run lies inside them. The scene is a third array of
nodes, and a node's handle is its index. Because a grow-only array never moves
its elements, `node_add` can hand out a reference that stays valid for the life
of the program, and a scene is built by pushing and then edited in place.

**One pass per frame.** `frame(dt)` samples input, multiplies out each node's
world matrix by walking its parent chain, builds the view-projection matrix,
derives the six frustum planes from it (Gribb–Hartmann), then walks the nodes:
cull against the planes (one p-vertex dot product per plane), pack a `DrawItem`
for what survives, sort the list, and hand it to the backend in a single call.

**The sort is the batching.** Opaque items are keyed by mesh id, so a backend
sees runs of the same mesh back to back, where a driver saves state changes.
Blended items (`colour.a < 1`) get keys above 1000000 and are ordered far to
near, so they are drawn after everything opaque and read the depth they should.

**One seam, two backends.** A `DrawItem` is packed data: an `i32` mesh id, two
`Mat4`s, two `float4`s, the sort key and a texture id, 172 bytes. `g3p_draw_frame` hands the
backend a slice of them plus the frame's `ViewState`, and `platform/g3_abi.h`
static-asserts every offset, so the Goose and C sides cannot drift apart
silently.

The CPU backend is not a toy: its `shade()` is the same shader as
`platform/g3_web.c`'s GLSL, term for term, driven by the same matrices. That is
what makes the headless path a real test of the engine rather than a second
implementation that agrees with itself. It is also why the two backends'
frame statistics match exactly (11 draws, 6884 triangles above). It is threaded,
too: triangles are transformed once into a display list, then 8-row blocks are
rasterized in parallel by workers that claim them atomically — 4.65× on eight
logical cores, with byte-identical output.

## Documentation

`README.md` is the front door. Behind it:

| file | for |
|---|---|
| [`docs/architecture.md`](docs/architecture.md) | the data model, the frame pipeline, the threading model, and the decisions with their rejected alternatives |
| [`docs/abi.md`](docs/abi.md) | every byte that crosses to a backend, field by field, plus how to evolve it |
| [`docs/performance.md`](docs/performance.md) | how the numbers were measured, the ablation tables, and what is left |
| [`docs/threejs-roadmap.md`](docs/threejs-roadmap.md) | gaps and milestones toward a practical Three.js alternative |
| [`docs/assets.md`](docs/assets.md) | browser image and static glTF/GLB loading, ownership and supported subset |
| [`docs/ideals.md`](docs/ideals.md) | the principles the project is built on, and the check that would fail if each were violated |
| [`.agents/skills/goose3d-tour`](.agents/skills/goose3d-tour/SKILL.md) | a map of the repo and the cheapest verification for a change |
| [`.agents/skills/goose-language-notes`](.agents/skills/goose-language-notes/SKILL.md) | Goose itself as this codebase uses it: arenas, references vs copies, casts, sidecars, and the compiler warnings that catch these mistakes |
| [`.agents/skills/g3-abi-and-backends`](.agents/skills/g3-abi-and-backends/SKILL.md) | changing the seam, keeping the two shaders in step, adding a backend |
| [`.agents/skills/g3-adding-a-render-feature`](.agents/skills/g3-adding-a-render-feature/SKILL.md) | step-by-step recipes: textures, instancing, shadows, more lights, near-plane clipping |
| [`.agents/skills/g3-testing-and-profiling`](.agents/skills/g3-testing-and-profiling/SKILL.md) | hand-derived checks, pixel assertions, byte-identical proof, profiling method |

The skills are instructions for coding agents (and useful to humans); each is
self-contained and states when to load it.

## A Goose trap worth knowing

`let c = g3::camera()` **copies** the camera, because a reference to a
fixed-size value decays to a copy when the variable's type is inferred. Writing
`c.pos = ...` then edits the copy and nothing moves. Use one of:

```goose
let c .= g3::camera();     // . binds the reference
g3::camera_look_at(p, q);  // or a function that writes the global itself
```

The engine's own code uses `.=` everywhere it means a reference, and the demo
and tests show both forms.

## Limits, and what would come next

Deliberately out of scope for now, in rough order of how much they would add:

* **No material system or texture alpha.** Each node has a colour and an
  optional RGB texture; blending is controlled by the node's colour alpha.
* **Limited shadows, environment lighting, and normals.** Only the primary
  directional light casts hard shadows; blended objects do not cast them.
  The map has fixed resolution and explicit bounds, and shadow-enabled frames
  submit off-camera nodes so they can cast shadows. Environment textures
  provide a diffuse approximation rather than prefiltered reflections.
* **One draw call per node.** The draw list is batched by mesh but not
  instanced; instancing wants a per-instance buffer on the seam.
* **Limited removal.** Browser-loaded assets recycle their owned nodes, mesh
  spans, and texture IDs on disposal. Ordinary scene nodes and meshes remain
  grow-only, and freed asset spans can become fragmented. `scene_clear()`
  clears the scene; asset handles are invalid after their owner is disposed.
* **Singular transforms.** A zero-scale transform has no inverse normal matrix;
  its surface normals become zero rather than receiving directional lighting.
* **f32 only**, and no frustum-cone/AABB hierarchy — culling is per node, which
  is fine to a few thousand nodes and would want a BVH beyond that.

## Requirements

* **Goose** 2026.3 or later on `PATH` (the release archive works: it ships the
  standard library and samples).
* **A C compiler** for the native build — `goose toolchain` reports what it
  found.
* **Emscripten** for the web build. Either
  `git clone https://github.com/emscripten-core/emsdk && cd emsdk && ./emsdk install latest && ./emsdk activate latest`
  into `.toolchain/emsdk` (what `build_web.sh` looks for, and `.gitignore`
  ignores), or install the SDK anywhere and export `EMSDK=/path/to/emsdk`.

The web build passes `-DGS_STACK_RESERVE='(64ull<<20)'`. Goose reserves 2 GiB of
address space per data stack by default, which costs nothing natively but is
real memory in a wasm heap; the engine keeps five arenas, so capping each at
64 MiB is the difference between a 2 GiB heap and a few hundred MiB. Raise it if
a scene needs more geometry than that.
