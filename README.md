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
| `src/g3/physics.goose` | gravity, forces, static and dynamic AABB bodies, collision response |
| `src/g3/render.goose` | per frame: transforms, frustum cull, draw-list pack, sort, submit |
| `src/g3/engine.goose` | `init` / `frame` / `shutdown`, input state, stats |
| `src/g3/gltf_native.goose` | native static GLB and JSON glTF scene and primitive loading into checked handles |
| `src/g3/texture_native.goose` | native PPM P6, PNG and JPEG decoding into checked sRGB textures with queryable load errors |
| `src/g3/platform.goose` | the backend contract: `DrawItem`, `ViewState`, the `g3p_*` calls |
| `src/demo/scene.goose` | the demo scene, written against the public API only |
| `src/app_web.goose` | the browser entry point (no `main`; exported `g3_app_*`) |
| `src/app_native.goose` | the headless entry point: builds, renders N frames, writes a PPM |
| `src/test_math.goose` | known-answer transforms, matrices and frustum planes, no backend |
| `src/test_engine.goose` | known-answer frames, checked by reading pixels back |
| `src/testing.goose` | the `check`/`finish` harness both test roots report through |
| `platform/g3_abi.h` | the C side of the contract, with static asserts on the layout |
| `platform/g3_input.{h,c}` | the key and mouse queue both backends share; each supplies only `g3_backend_resize` |
| `platform/g3_web.c` | the WebGL2 backend (Emscripten), scene and shadow shaders, opaque instancing, GPU skin and morph deformation |
| `platform/g3_soft.c` | the CPU backend: a z-buffered reference rasterizer, threaded over row blocks |
| `docs/` | `architecture.md`, `abi.md`, `performance.md` — the reference detail |
| `.agents/skills/` | five `SKILL.md` guides for working in this repo (map, language, ABI, features, testing) |
| `web/index.html` | the page: a canvas, the stats line, and a status overlay |
| `web/shell.js` | boot and the frame loop — the order things happen in |
| `web/canvas.js`, `web/input.js`, `web/hud.js` | sizing in device pixels, events, and the two lines of text |

## Run it in the browser

### View a textured model

Run `./build_web.sh --viewer --serve` and open <http://localhost:8080/viewer/>.
The viewer imports the asset loader and typed orbit controls through the
`gs3d` package subpaths, mapped to the local package files
for this repository example. Their callback API and cleanup are documented in
[assets.md](docs/assets.md).
Drag to orbit, scroll to zoom, click the model to select a mesh, and use Reload
to load and dispose it again. The selected material shows previews of its
texture maps, updates when you switch variants, and has a slider for its
environment fill and reflection. The animation controls switch between a
turntable and a vertical bob, pause or resume playback, and seek within the
active clip. The bundled GLB uses the CC0 Ground Grey texture credited below;
`web/viewer/generate_sample.py` regenerates it.

### Play Beacon Run

Build and serve the sample game with `./build_web.sh --game --serve`, then open
<http://localhost:8080/game/>. Move with WASD or the arrow keys, collect all
eight gold beacons, and avoid the red sentinel. Play again after winning or
being caught. The game logic is in `src/game/arena.goose` and uses the engine's
scene, input, camera, and rendering APIs.
The arena floor uses [Ground Grey](https://polyhaven.com/a/ground_grey), by
Rob Tuytel / Poly Haven (CC0); a local copy is included.

### Measure WebGL instancing

Run `./build_web.sh --benchmark --serve` and open
<http://localhost:8080/benchmark/>. The page varies the number of visible
instances of one cube mesh and reports scene draw calls, browser frame rate,
and engine-call median and p95. See [performance.md](docs/performance.md) for
the measurement limits and comparison method.

Compare Goose 3D with Three.js using the same scene and browser:

```bash
./build_web.sh --benchmark
python3 -m http.server 8080 --directory web
```

Open <http://localhost:8080/benchmark/compare.html>. Choose a backend with the
tabs; only that renderer runs at a time. The Three.js mode downloads pinned
version 0.180.0 from jsDelivr. Match browser, window size, and cube count when
comparing the reported frame-call median and p95.

#### Headless Playwright result

Headless Playwright runs with Chrome for Testing 159.0.8154.6, a 1280×720
canvas, and 1,024 cubes produced these before and after results:

| Backend / revision | Scene draw calls | Browser FPS | Frame-call median / p95 | WebGL backend median / p95 | GPU median / p95 |
|---|---:|---:|---:|---:|---:|
| Goose 3D before | 1 | 21.4 | 45.60 / 54.00 ms | — | — |
| Goose 3D optimized, run 1 | 1 | 40.2 | 0.20 / 0.30 ms | 0.10 / 0.20 ms | 15.86 / 20.32 ms |
| Three.js 0.180.0, run 1 | 1 | 35.0 | 0.10 / 0.20 ms | — | 16.79 / 39.02 ms |
| Goose 3D optimized, run 2 | 1 | 34.9 | 0.20 / 0.30 ms | 0.10 / 0.20 ms | 16.44 / 32.72 ms |
| Three.js 0.180.0, run 2 | 1 | 30.0 | 0.10 / 0.20 ms | — | 19.08 / 43.35 ms |

Each row uses 120 warmup frames followed by 300 sampled frames. GPU time uses
the asynchronous `EXT_disjoint_timer_query_webgl2` extension; unavailable and
disjoint results are omitted. Goose's opaque unlit path skips the full-screen
color-encoding pass, uses a no-fog shader variant when fog is disabled, and
does not compute fog distance for every fragment. The renderer uses affine
center/extents bounds for culling and skips distance calculations for opaque
nodes. It also reuses unchanged root transforms and static instance uploads,
retains instanced vertex bindings, skips per-frame GL error polling, and avoids
sorting an already ordered draw list. Goose's GPU median was lower in both
paired runs (15.86 vs 16.79 ms, then 16.44 vs 19.08 ms); CPU frame-call median
was 0.20 ms for Goose and 0.10 ms for Three.js. Frame cadence and p95 values
varied substantially between runs. These measurements use headless SwiftShader
software WebGL rather than a physical GPU; treat them as environment-specific
diagnostics. Frame-call timings measure CPU work and GPU command submission;
GPU-query timings measure rendering commands and exclude browser compositing
and display refresh. Playwright reported no browser errors.

A subsequent texture-specialization experiment compiles absent base-color and
emissive texture paths out of unlit shaders, allowing unused UV inputs to be
removed by the shader compiler. At the same 1,024 cubes and 1280×720, two
optimized runs measured GPU medians of 15.34 and 15.30 ms (p95 16.44 and
16.48 ms), compared with 15.87 ms (p95 17.86 ms) for the previous committed
shader. CPU median remained 0.20 ms. The paired Three.js sample measured
15.27 ms GPU median and 16.37 ms p95. These sequential SwiftShader samples
suggest a small gain; they do not establish a physical-GPU speedup.
All web targets passed compilation and the texture-budget checks. Browser
reference checks passed texture and output-color assertions, then failed at
`point shadow changes rendered pixels`; the previous committed renderer
failed the same assertion in this environment.

Instance-buffer updates now retain GPU storage until capacity grows and use
`bufferSubData` for the span containing changed matrices. A Playwright WebGL
call trace verified that reducing the visible count from 1,024 to 512 uploads
zero bytes; growing it to 768 uploads 12,288 bytes instead of the previous
36,864-byte full upload. Editing one matrix in a two-instance batch uploads
48 bytes at offset 48. These checks reported no WebGL errors, and all web
targets passed the 16-unit texture-budget checks. This reduces transfer volume
for changing batches; it does not change the static-scene FPS measurement.

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

The CPU backend also decodes PNG and JPEG images through libpng and libjpeg;
`build_native.sh` obtains their flags from `pkg-config`:

```bash
./build_native.sh
./build/app_native --frames 8 --width 960 --height 600 --out frame.ppm
# Load the first static GLB or JSON glTF primitive through the native CPU backend.
./build/app_native --glb web/viewer/sample.glb --out model.ppm
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
import g3.physics;

fn main() {
    guard g3::init(1280, 720, "hello") else { return; }

    // Ordinary meshes live in two arenas and keep their numeric IDs.
    let cube = g3::mesh_cube(1.0);
    let ball = g3::mesh_sphere(0.5, 16, 24);

    // Attach a dynamic box and a static floor to scene nodes. Step physics
    // before rendering each frame; body positions are copied to their nodes.
    let player = g3::node_add(cube);
    let player_body = g3::physics_body_add(player, float3 { 0.5, 0.5, 0.5 }, 1.0);
    let floor = g3::node_add(g3::mesh_plane(10.0, 10.0));
    let floor_body = g3::physics_body_add(floor, float3 { 5.0, 0.1, 5.0 }, 0.0);
    g3::physics_body_set_restitution(player_body, 0.1);
    g3::physics_body_set_friction(player_body, 0.7);
    g3::physics_body_set_restitution(floor_body, 0.0);
    g3::physics_body_set_friction(floor_body, 0.8);

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
        g3::physics_step(1.0 / 60.0);
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

* **Physics** — `import g3.physics`, attach an axis-aligned box to a node with
  `physics_body_add(node, half_extents, mass)`, and call `physics_step(dt)`
  before `frame(dt)`. Mass zero makes a static collider. Gravity defaults to
  `(0, -9.81, 0)` and can be changed with `physics_set_gravity`; apply forces
  for one step with `physics_apply_force`, set velocity directly, and tune
  restitution and friction from 0 to 1. Pairwise AABB overlap uses substeps,
  positional correction, and normal and friction impulses. Bodies have no
  angular motion or capsule/sphere colliders; `physics_clear()` removes all
  bodies.
* **Meshes** — `mesh_cube(half)`, `mesh_sphere(radius, rings, segments)`,
  `mesh_plane(size, tiles)`, plus `push_vertex`/`push_triangle`/`mesh_close`
  for your own geometry. Pushes stage one mesh and `mesh_close(fv, fi)` closes
  that batch; the two offset arguments remain accepted for source compatibility.
  `mesh_compact()` packs live geometry and reuploads it without changing mesh IDs.
  `mesh_handle` and `mesh_handle_valid` check ordinary
  and asset mesh IDs; call `mesh_remove(handle)` after removing all nodes that
  use an ordinary mesh. Removal releases backend geometry and makes its arena
  spans available to ordinary meshes and asset loads. Numeric mesh IDs are
  never reused.
* **Textures** — import `g3.texture`, call `texture_create(width, height, rgba)`
  with row-major RGBA8 pixels or `texture_create_hdr(width, height, rgba)` with
  linear RGBA32F pixels for HDR radiance, then select an environment with
  `set_environment_map`.
  `render_target_create(width, height)` creates a sampleable linear RGBA8
  texture with RGB clamped to 0..1 and opaque alpha. Select it with
  `render_target_set(id)` before `frame(dt)` and resize it with
  `render_target_resize(id, width, height)`; resizing clears its contents. Pass
  `-1` to return to the window. Targets keep their own size and can be removed
  with `render_target_remove(id)` after scene and material references are
  cleared. Render targets bypass screen tone mapping, sRGB output encoding, and
  FXAA; apply display effects after sampling the target. Sampling the active
  target in the same frame skips that item to avoid framebuffer feedback.
  `stats().feedback_items_suppressed` reports the skipped draw-item count for
  the current frame; the browser sample HUD shows it when nonzero.
  Texture coordinate v=0 addresses the bottom row of a render target.
  Targets are limited to 4,194,304 pixels each.
  `render_target_handle(id)` returns a generation-checked handle with matching
  `render_target_set_handle`, `render_target_resize_handle`, and
  `render_target_remove_handle` operations. `render_target_texture_id(handle)`
  returns the texture ID to assign to a node or material.
  `post_process_run(source, destination, effect)` applies a built-in
  `POST_PROCESS_COPY`, `POST_PROCESS_GRAYSCALE`, `POST_PROCESS_INVERT`, or
  `POST_PROCESS_FXAA` pass to a distinct render target. Chain calls to control
  pass order. These passes keep linear RGBA8 values and do not tone map or
  encode sRGB; use `set_fxaa` for the existing screen-output convenience pass.
  For deferred execution, `post_process_queue_add` (or
  `post_process_queue_add_shader`) appends a pass to a fixed eight-pass queue;
  `post_process_queue_execute` runs them in order and clears the queue.
  WebGL projects can create a fragment-body pass with
  `post_process_shader_create(body)`, run it with
  `post_process_shader_run(shader, source, destination)`, and release it with
  `post_process_shader_remove(shader)`. The GLSL ES 3.00 body can read `vec2 uv`,
  `vec4 color`, and `sampler2D g3_source`, then assign the output to `color`.
  Bodies are limited to 16 KiB and 64 shader IDs per engine lifetime; custom
  passes do not run on the CPU backend, which returns -1 at creation.
  `texture_handle` and `texture_handle_valid` check ordinary and asset textures;
  `texture_remove(handle)` releases an ordinary texture only when no live node,
  material or environment uses it. Asset textures are released by their owner.
  Built-in meshes have UVs and white vertex colours; custom `Vertex` values can
  set linear RGBA vertex colours. glTF `COLOR_0` multiplies the material base
  colour, and custom meshes can use `push_vertex_uv`,
  `push_vertex_uv_sets` for two UV sets, `push_vertex_uv_3sets` for three,
  `push_vertex_uv_8sets` for custom geometry with all eight,
  `push_vertex_uv_6sets` for six, or
  `push_vertex_uv_tangent` to provide a tangent and handedness for normal maps.
  Both backends support nearest, linear, and mipmapped filtering via
  `texture_set_filter`, and clamp, repeat, and mirrored repeat per axis via
  `texture_set_wrap`. Uploading pixels resets those settings. Raster image
  decoding belongs to the host; Radiance HDR is supported by the native API and
  browser asset loader. The game demonstrates browser-side decoding. Texture RGB
  multiplies the node colour. `node.alpha_mode` chooses colour-driven blending
  (0), an alpha cutoff (1), or blending (2). Masking and blending multiply
  texture alpha, vertex colour alpha and node colour alpha; opaque items ignore
  resulting alpha.
  Use `texture_create_srgb` for sRGB colour images; RGB is decoded before
  filtering and alpha stays linear. `set_output_srgb(true)` renders and blends
  in linear space before encoding the finished frame. Output encoding is opt-in
  for compatibility with existing scenes. `set_tone_mapping_mode(mode)` selects
  none, Reinhard, or ACES; `set_tone_mapping(true)` remains an ACES alias.
  `set_fxaa(true)` adds an optional full-screen edge-smoothing pass.
  `set_exposure(value)` sets the linear exposure multiplier (0–32). The CPU backend composites into a floating-point buffer;
  WebGL uses an RGBA16F target when floating-point color rendering and blending
  are available, and otherwise maps each fragment before blending. Tone mapping
  works with HDR lighting values. Browser projects can use `loadHDRImage`;
  native projects can load the supported Radiance RGBE subset with
  `texture_load_hdr(path)`.
* **Nodes** — `node_add(mesh)`, `node_group()`, `node(id) -> Node&`,
  `node_parent(child, parent)`, `scene_clear()`, and `node_count()`. A node has
  position, euler rotation, scale, colour, `unlit`, `visible`, specular
  strength and shininess. `node_handle(id)` and `node_handle_valid(handle)`
  add generation and scene-epoch checks for retained handles. Call
  `node_remove(handle)` to remove an ordinary node without releasing its mesh
  or texture. Its children are reparented to its former parent with their
  transforms preserved; their local transforms become baked matrices. Raw
  indices and references must not be used after removal or scene reset.
* **Materials** — `material_add()` creates a shared surface, and
  `material(id)` exposes its colour, texture, alpha, unlit and specular fields.
  Set `pbr = true` to use metallic-roughness direct lighting with `metallic`
  and `roughness` factors in [0, 1]; set `ior` (default 1.5) to adjust
  dielectric Fresnel reflectance. Assign a linear data texture to
  `metallic_roughness_texture` to modulate metallic and roughness from its B
  and G channels.
  Otherwise the legacy specular model applies.
  Assign the ID to `node.material` to use it on any number of nodes; edits
  affect each of them on the next frame. With `node.material = -1`, the node's
  own surface fields apply. `material_remove(id)` detaches the material from
  its nodes, which revert to their inline fields. Ordinary material IDs are not reused;
  materials and their textures are separate resources, and `scene_clear()`
  does not remove them. glTF materials are shared within each loaded model and
  their asset-owned slots are reused after disposal.
* **Camera** — `camera() -> Camera&` (fov, near, far, up), `camera_look_at`,
  `camera_orbit(yaw, pitch, distance, target)`, `camera_orbit_nudge`,
  `camera_zoom`. Set `camera().orthographic = true` and a positive
  `camera().ortho_height` (the full vertical extent in world units) for an
  orthographic view; set it to false to restore perspective. Width follows
  the viewport aspect ratio. Picking uses the selected projection.
  `camera_add()` saves a copy of the current camera and returns its ID;
  `camera_select(id)` saves the active camera's edits and restores that copy,
  including orbit state. `camera_remove(id)` invalidates the saved camera
  without changing other IDs; removing the active camera selects the first
  remaining camera, and removing the last leaves no active saved camera.
  `camera_count()` counts live cameras. IDs are append-only. The first added
  camera becomes active. Configure an inactive camera by selecting it first.
  Cameras persist across `scene_clear()`;
  `camera_active()` returns `-1` until the first is added. A reference returned
  by `camera()` refers to the active camera storage and should not be retained
  across a switch.
* **Lighting** — a primary directional light (`set_light`), up to eight extra
  directional, point or spot lights (`add_directional_light`, `add_point_light`,
  `add_spot_light`, `clear_lights`), ambient light and a hemispherical sky/ground
  fill (`set_ambient`, `set_environment`) or an equirectangular map uploaded
  with `texture_create` or `texture_create_hdr` and selected by
  `set_environment_map`, plus fog and background colour. The map is sampled
  along the surface normal for diffuse fill. Metallic-roughness
  materials reflect it using a GGX importance-sampled mip chain and a
  split-sum BRDF integration LUT. HDR input uses Radiance RGBE in browser
  builds; a skybox is not implemented.
  Add functions return false when parameters are invalid or the limit is reached.
  Point and spot lights use squared linear range falloff by default; their
  spot angles are inner and outer half-angles in radians.
  `add_point_light_physical` and `add_spot_light_physical` use inverse-square
  distance attenuation with the same smooth finite-range fade; passing range
  zero disables the cutoff for those physical lights.
  `set_directional_shadows(center,
  extent, bias)` enables a 512×512 shadow map for the primary directional
  light; `clear_shadows()` disables it. Call `set_point_light_shadows(index,
  bias)` after adding a point light to enable its six-face 512×512 shadow map;
  call `set_spot_light_shadows(index, bias)` after adding a spot light for its
  512×512 perspective map. Each API selects one extra light of its type, and
  both can be active at once. Spot outer half-angles must be under 90 degrees.
  `clear_point_light_shadows()` and `clear_spot_light_shadows()` disable those
  maps; `clear_lights()` clears both. All shadow maps use normalized depth
  bias and opaque or masked casters; blended objects do not cast shadows.
  `set_shadow_filter_radius(0..2)` chooses hard shadows, 3×3 PCF, or 5×5 PCF
  for all three shadow types; hard shadows are the default. Use
  `set_shadow_resolution(256|512|1024)` to choose map dimensions; 512 is the
  default.
* **Frame** — `init`, `frame(dt)`, `shutdown`, `width`/`height`/`aspect`/`time`,
  `stats()` (nodes, drawn, culled, triangles, draws), `read_pixel`,
  `save_frame` where the backend can write one.
* **Input** — `key_down`, `key_pressed`, `key_released` with `KEY_*` codes, and
  `mouse_dx`/`mouse_dy` deltas.

## How it works

**Everything is an arena.** There is no heap in Goose, so geometry lives in two
  global arrays — all vertices, all indices — and each mesh is a small record
saying where its run lies inside them. Released spans can be reused by ordinary
and asset meshes; array capacity is retained. The scene is a third array of
nodes. `node_add` returns an index and `node` gives access to the record;
checked node handles also record the generation and scene epoch so reuse can be
detected. References and raw indices must not outlive the node they identify.

**One pass per frame.** `frame(dt)` samples input, multiplies out each node's
world matrix by walking its parent chain, builds the view-projection matrix,
derives the six frustum planes from it (Gribb–Hartmann), then walks the nodes:
cull against the planes (one p-vertex dot product per plane), pack a `DrawItem`
for what survives, sort the list, and hand it to the backend in a single call.

**The sort is the batching.** Opaque items are keyed by mesh id, so a backend
sees runs of the same mesh back to back, where a driver saves state changes.
Blended items get keys above 1000000 and are ordered far to
near, so they are drawn after everything opaque and read the depth they should.

**One seam, two backends.** A `DrawItem` is packed data: an `i32` mesh id, two
`Mat4`s, colour, shading parameters, the sort key, texture IDs, alpha settings,
a double-sided flag, twelve texture-coordinate transforms, clearcoat and sheen factors and maps, and per-material environment intensity, 653 bytes. A
`Vertex` is 120 bytes, including eight UV sets, tangent and colour. Its
`ViewState` is 1268 bytes and includes eight extra lights, render-target selection, dimensions and
the shared camera view-projection matrix.
`g3p_draw_frame` hands the backend a slice
of them plus the frame's `ViewState`, and `platform/g3_abi.h`
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
| [`docs/assets.md`](docs/assets.md) | browser image, glTF/GLB loading, transform, skeletal and morph-weight animation, ownership and supported subset |
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

* **Partial PBR.** Shared materials support metallic-roughness factors and
  maps, tangent-space normal maps for surface shading, and occlusion maps for
  indirect fill, plus emissive factors and textures. Static, skinned, and
  morphed glTF meshes use authored tangent attributes and tangent morph deltas
  for normal maps; meshes without authored tangents use a UV-derived frame.
  GGX-prefiltered environment lighting, Reinhard and ACES tone
  mapping, FXAA-style edge smoothing, exposure controls, and Radiance RGBE
  environment image loading are available. Full colour
  management remains incomplete.
* **Limited shadows, environment lighting, and normals.** The primary
  directional light, one selected extra point light, and one selected spot
  light cast shadows; PCF filtering has hard, 3×3, and 5×5 settings, and
  blended objects do not cast them. Map resolution is selectable from 256 to
  1024 pixels per face or spot map, directional shadows have explicit bounds,
  and shadow-enabled frames submit off-camera nodes so they can cast shadows.
  Environment textures provide diffuse fill and GGX-prefiltered reflections.
  Browser and native Radiance RGBE loaders preserve HDR radiance; a skybox is
  not available.
* **WebGL deformation limits.** WebGL morph targets support up to 64 targets
  per primitive and a 64 MiB delta-texture budget; larger or unsupported meshes
  fall back to CPU deformation. GPU skin palettes and GPU morph weights can
  combine, and CPU geometry remains synchronized for picking. The CPU reference
  backend always deforms on the CPU. Native glTF loading remains future work.
* **Limited removal.** Ordinary nodes can be removed and reused. Unreferenced
  ordinary meshes and textures can be removed; mesh backend allocations are
  freed and their arena spans can be reused by ordinary meshes and asset loads.
  Browser-loaded assets recycle their owned nodes, mesh spans, and texture IDs
  on disposal. `mesh_compact()` packs live geometry but retains arena capacity;
  mesh descriptor records remain append-only. `scene_clear()`
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
* **pkg-config, libpng and libjpeg** for the native PNG/JPEG image decoder.
  The web build uses browser image decoding and does not require these libraries.
* **Emscripten** for the web build. Either
  `git clone https://github.com/emscripten-core/emsdk && cd emsdk && ./emsdk install latest && ./emsdk activate latest`
  into `.toolchain/emsdk` (what `build_web.sh` looks for, and `.gitignore`
  ignores), or install the SDK anywhere and export `EMSDK=/path/to/emsdk`.

The web build passes `-DGS_STACK_RESERVE='(64ull<<20)'`. Goose reserves 2 GiB of
address space per data stack by default, which costs nothing natively but is
real memory in a wasm heap; the engine keeps five arenas, so capping each at
64 MiB is the difference between a 2 GiB heap and a few hundred MiB. Raise it if
a scene needs more geometry than that.

### Rift Siege — combat framework trial

Run `./build_web.sh --siege --serve`, then open
[localhost:8080/siege/](http://localhost:8080/siege/).
WASD moves, arrows aim and fire, Space fires along the last aim, and Shift
dashes with a brief shield (1.8 second cooldown). Keyboard required.

Five waves increase enemy count from 8 to 24, introduce ranged enemies in
wave two and armored enemies in wave four. Clear the arena to advance, repair
one hull point between waves, and survive wave five to win. Cyan pylons block
movement and shots. The game uses a 120 Hz simulation, bounded catch-up, and
128 reusable projectile nodes; restarts allocate no scene objects.
`g3::segment_sphere_intersects` supplies swept projectile collision, including
stationary and tangent contact. It accepts the combined projectile/target radius.

`./build_native.sh --test` includes combat/state regression checks and writes
`build/siege.ppm` through the CPU backend.

The browser renderer starts on WebGL2 devices with 16 fragment texture units.
Material shaders are compiled on demand and kept in a bounded 64-program cache.
Five fragment units are reserved for lighting maps; material maps occupy only
the remaining units they actually use. On a 16-unit device a single material
can use up to 11 maps; an over-budget material is skipped with a visible error.
Vertex skin/morph textures use separate combined units 24–28.

Run `./build_web.sh --reference-checks` followed by
`node web/test_browser_reference.mjs --render-only` for browser pixel checks
covering textures, render targets, lighting, shadows, and skinning.

The focused game regression page is `/siege/checks.html`; it checks WebGL
startup, scene pixels, combat input, dash, restart, and GL errors.
The broader renderer reference suite currently reaches and fails the
`point shadow changes rendered pixels` assertion on headless SwiftShader;
this is separate from the fixed 16-unit startup failure.

After changing the WebGL backend, run `./build_web.sh --all` to relink every
page's independent `app.wasm`. Use `./build_web.sh --all --serve` to rebuild
all pages and serve them together. The full build checks that no bundle still
contains the old 23-unit startup requirement. Hard-refresh any already open
page after rebuilding to clear its cached JavaScript and WebAssembly.

For the homepage's temporal rendering regression, build the default web app
and run `node web/test_browser_reference.mjs --demo-only`. It checks all matrix
uploads, identical paused frames, and bounded changes over 600 animation frames.
