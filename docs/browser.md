# Browser examples and benchmarks

## Run it in the browser

The default landing page (`/`) prefers WebGPU. It requests an adapter and
device before creating the engine; if WebGPU is unavailable or setup fails, it
replaces the canvas if needed and starts the existing WebGL2 renderer. The
current WebGPU path covers the built-in demo's indexed meshes, directional
lighting, fog, unlit materials, transparency, depth, and resize. Textures,
render targets, shadows, PBR extensions, and post-processing remain on the
WebGL2 renderer used by the specialized viewer and reference pages.

The WebGPU path batches adjacent compatible opaque instances and reuses its
CPU-side upload arrays. On the 11-item demo this cuts WebGPU draw calls from 11
to 7. In headless Chrome 157, CPU render submission over 133 baseline and 132
updated frames moved from 0.30/0.50 ms median/p95 to 0.20/0.40 ms. This timer
covers CPU-side encoding and queue submission; it does not measure GPU completion.

WebGPU requires a secure context; `web/shell.js` redirects the local wildcard
URL `http://[::]` to trusted `http://localhost` so local development can use it.
The browser capability check is feature-based: an unavailable adapter or a
WebGPU pipeline validation failure takes the fallback path. `./build_web.sh`
builds both renderers for `/`; `./build_web.sh --all` keeps the specialized
tool pages on their existing WebGL2 builds.

### View a textured model

Run `./build_web.sh --viewer --serve` and open <http://localhost:8080/viewer/>.
The viewer imports the asset loader and typed orbit controls through the
`gs3d` package subpaths, mapped to the local package files
for this repository example. Their callback API and cleanup are documented in
[assets.md](assets.md).
Drag to orbit, scroll to zoom, click the model to select a mesh, and use Reload
to load and dispose it again. The selected material shows previews of its
texture maps, updates when you switch variants, and has a slider for its
environment fill and reflection. The animation controls switch between a
turntable and a vertical bob, pause or resume playback, and seek within the
active clip. The bundled GLB uses the CC0 Ground Grey texture credited below;
`web/viewer/generate_sample.ts` regenerates it through the dependency-free
TypeScript model-authoring helpers; see [Code-first model authoring](model-authoring.md).

### Play Beacon Run

Build and serve the sample game with `./build_web.sh --game --serve`, then open
<http://localhost:8080/game/>. Move with WASD or the arrow keys, collect all
eight gold beacons, and avoid the red sentinel. Play again after winning or
being caught. The game logic is in `src/game/arena.goose` and uses the engine's
scene, input, camera, and rendering APIs.
The arena floor uses [Ground Grey](https://polyhaven.com/a/ground_grey), by
Rob Tuytel / Poly Haven (CC0); a local copy is included.

### Measure renderer instancing

Run `./build_web.sh --benchmark --serve` and open
<http://localhost:8080/benchmark/>. The page varies the number of visible
instances of one cube mesh and reports scene draw calls, browser frame rate,
and engine-call median and p95. See [performance.md](performance.md) for
the measurement limits and comparison method.

Compare Goose 3D with Three.js using the same scene and browser:

```bash
./build_web.sh --benchmark
python3 -m http.server 8080 --directory web
```

Open <http://localhost:8080/benchmark/compare.html>. Choose Goose WebGPU,
Three.js WebGPU, or Three.js WebGL2 with the tabs; only that renderer runs at a
time. Goose WebGPU falls back automatically to WebGL2. Three.js WebGPURenderer
also falls back automatically when WebGPU is unavailable. Three.js downloads
pinned version 0.187.0 (r187) from jsDelivr. Match browser, window size, cube
count, and moving-instance count when comparing frame-call median and p95.

#### Headless Playwright result

Headless Playwright runs with Chrome for Testing 159.0.8154.6, a 1280×720
canvas, and 1,024 cubes produced these before and after results:

| Backend / revision | Scene draw calls | Browser FPS | Frame-call median / p95 | WebGL backend median / p95 | GPU median / p95 |
|---|---|---|---|---|---|
| Goose 3D before | 1 | 21.4 | 45.60 / 54.00 ms | — | — |
| Goose 3D optimized, run 1 | 1 | 40.2 | 0.20 / 0.30 ms | 0.10 / 0.20 ms | 15.86 / 20.32 ms |
| Three.js r180 WebGL2, run 1 (historical) | 1 | 35.0 | 0.10 / 0.20 ms | — | 16.79 / 39.02 ms |
| Goose 3D optimized, run 2 | 1 | 34.9 | 0.20 / 0.30 ms | 0.10 / 0.20 ms | 16.44 / 32.72 ms |
| Three.js r180 WebGL2, run 2 (historical) | 1 | 30.0 | 0.10 / 0.20 ms | — | 19.08 / 43.35 ms |

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

#### Three.js r187 headless comparison

The benchmark now pins Three.js r187 (npm 0.187.0). Matched headless Chrome
157.0.8103.52 runs at a 1280×720 viewport used 1,024 cubes, 120 warmup frames,
and 300 sampled frames per renderer and workload:

| Renderer | Workload | Scene calls | Browser FPS | CPU frame-call median / p95 | CPU submit median / p95 | GPU median / p95 |
|---|---|---|---|---|---|---|
| Goose WebGPU | Static | 1 | 60.0 | 1.20 / 1.30 ms | 0.50 / 0.60 ms | unavailable |
| Three.js r187 WebGPU | Static | 2 | 60.0 | 0.50 / 0.80 ms | — | unavailable |
| Three.js r187 WebGL2 | Static | 1 | 60.0 | 0.20 / 0.30 ms | — | 0.37 / 0.41 ms |
| Goose WebGPU | All 1,024 moving | 1 | 60.0 | 1.50 / 1.60 ms | 0.70 / 0.80 ms | unavailable |
| Three.js r187 WebGPU | All 1,024 moving | 2 | 60.0 | 0.50 / 0.90 ms | — | unavailable |
| Three.js r187 WebGL2 | All 1,024 moving | 1 | 60.0 | 0.30 / 0.40 ms | — | 0.38 / 0.46 ms |

In this run, Three.js r187 had lower CPU frame-call times than Goose in both
backends. WebGPU median was 0.50 ms for Three.js and 1.20 ms static / 1.50 ms
with all instances moving for Goose. WebGL2 median was 0.20 / 0.30 ms. Browser
cadence stayed at 60 FPS for every run. WebGPU GPU timestamp queries were
unavailable, so GPU execution time cannot be compared here. WebGL2 GPU query
values are reported for that backend only. These are single-run headless
SwiftShader diagnostics; repeat on physical GPUs for hardware conclusions.

#### Static-scene culling-cache follow-up

The WebGPU path reuses each node's frustum result while its world transform,
camera view-projection, mesh, and mesh bounds remain unchanged. A warmed
synchronous Playwright microbenchmark (Chrome 157, 1280×720, 1,024 cubes; 120
warmup calls followed by 1,000 measured calls, repeated three times) compared
commit `106552e` with the culling cache. Static frame-call medians across the
three runs were 0.2 ms before and 0.1 ms after; backend-submit medians were
0.1 ms for both. With all instances moving, both versions measured 0.2 ms
frame-call median and 0.1 ms submit median. Values are quantized at 0.1 ms in
this environment, so the culling cache gives a small static-scene CPU
improvement with no measured gain for moving scenes. The same synchronous
workload against Three.js r187 WebGPU measured:

| Renderer | Static frame-call median / p95 | All moving median / p95 |
|---|---|---|
| Goose 3D before cache (`106552e`) | 0.2 / 0.2 ms | 0.2 / 0.3 ms |
| Goose 3D with culling cache | 0.1 / 0.2 ms | 0.2 / 0.3 ms |
| Three.js r187 WebGPU | 0.0 / 0.1 ms | 0.1 / 0.5 ms |

Rows report the median of three run medians and p95 values; the timer's 0.1 ms
granularity limits interpretation at this scale. Goose remains slower by about
0.1 ms in these synchronous medians. Native rendering tests passed, including
the mesh-deformation checks that invalidate cached bounds. Add `sync=1` to the
comparison URL to expose `window.g3BenchmarkSync.frame` and `backendMs` for a
Playwright burst that excludes RAF scheduling.

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

The comparison page's Moving instances per frame selector also supports
matching animation workloads. Use `?backend=goose&count=1024&motion=32` (or
`backend=three`); `motion=1024` animates every visible instance. Both renderers
use the same frame-indexed horizontal motion, and Three.js uses dynamic buffers
with update ranges for the changed prefix. Animation work is included in the
frame-call measurement.

With all 1,024 instances moving, a zero-rotation TRS fast path reduced Goose's
frame-call median/p95 from 0.30/0.40 ms to 0.20/0.30 ms in sequential headless
Playwright samples; Three.js measured 0.20/0.20 ms. GPU medians were 15.24 ms
for the original Goose path, 15.34 ms for the fast path, and 15.22 ms for
Three.js. These samples establish a CPU-side improvement in this environment,
with no demonstrated GPU-time improvement. With 32 moving instances, the
partial-upload and old full-upload paths both measured 0.20 ms CPU median and
approximately 15.2 ms GPU median: fewer uploaded bytes did not produce a
measurable frame-time improvement at that workload. Native tests and worker
determinism checks pass with the transform fast path.

#### WebGPU instance packing comparison

The first WebGPU packing optimization reduced the instance record from 208 to
144 bytes. It computes the inverse-transpose normal transform in WGSL and
reuses packed CPU-side instance data, which avoids rebuilding normal matrices
and scanning a second full cache array each frame. A headless Chrome 157 run with 1,024 cubes,
120 warmup frames, and 300 samples measured:

| Workload | Goose before: frame / submit | Goose after: frame / submit | Three.js WebGPU frame |
|---|---|---|---|
| Static instances, median / p95 | 1.50 / 1.70 ms · 0.80 / 0.90 ms | 1.20 / 1.30 ms · 0.50 / 0.60 ms | 0.60 / 0.80 ms |
| All instances moving, median / p95 | 1.80 / 1.90 ms · 1.00 / 1.10 ms | 1.50 / 1.70 ms · 0.70 / 0.80 ms | 0.70 / 0.90 ms |

The Goose CPU frame-call median fell 20% for the static workload and 17% with
all instances moving; its WebGPU CPU submission median fell 38% and 30%,
respectively. Both renderers were capped at 60 FPS in these runs. The benchmark
does not expose WebGPU GPU timestamp queries, so these numbers describe CPU
frame work and command submission; they do not measure GPU execution time. That
version reduced per-frame storage uploads by about 31%.

#### 80-byte WebGPU instance follow-up

The instance record now carries only the model matrix and color (80 bytes); the
vertex shader combines the model with the shared view-projection matrix. This
reduces per-frame instance uploads from 144 to 80 bytes (44%). In synchronous
Playwright bursts on headless Chrome 157 (1280×720, 1,024 cubes, 500 warmup
frames, 5,000 measured frames, three runs), average CPU frame-call times were:

| Workload | Goose before (`3eadc7d`) | Goose 80-byte records | Three.js r187 WebGPU |
|---|---|---|---|
| Static | 0.135 ms | 0.117 ms | 0.172 ms |
| All 1,024 moving | 0.240 ms | 0.205 ms | 0.203 ms |

The compact record reduced Goose CPU frame time by about 13% static and 15%
with all instances moving. It is faster than Three.js in the static burst and
within 1% on the moving burst. The same static canvas capture was pixel-identical
to the baseline. Separate WebGPU timestamp-query runs measured GPU medians of
0.218 ms before / 0.215 ms after for static, and 0.220 / 0.219 ms with all
instances moving; p95 stayed within 2%. These are headless SwiftShader
measurements, not physical-GPU results. The 0.1 ms per-call timer quantization
is avoided by reporting aggregate burst averages. Add `sync=1` to the benchmark
URL to expose the Playwright burst hook.

Rotated TRS construction now computes `T * Rz * Ry * Rx * S` directly,
avoiding four general 4×4 matrix products. The zero-rotation fast path remains.
Run the native microbenchmark with:

```bash
goose build -o build/benchmark_transforms src/benchmark_transforms.goose
./build/benchmark_transforms
```

Five sequential 200,000-transform trials measured 9.06–16.81 ms for the old
matrix chain and 3.54–7.82 ms for direct construction (2.1–2.8× per-trial
speedup). The benchmark varies all three Euler angles and checks 1,000
transforms with mixed translations, negative scales, and collapsed axes;
maximum component error was zero in this native build. The 480×300 demo frame
after five frames was byte-identical to the committed baseline. Native tests,
all web builds, and a Playwright animated-homepage smoke check passed. This
isolated CPU microbenchmark does not establish a whole-frame FPS gain.

For a browser rotation workload, enable Rotate moving instances or add
`&rotate=1&motion=1024&count=1024` to the comparison URL. Both backends use
the same three Euler angles and `Rz * Ry * Rx` order. At 1280×720 in headless
Playwright, the original TRS chain measured CPU median/p95 0.40/0.40 ms and
GPU median/p95 15.52/17.71 ms. Direct TRS measured CPU 0.30/0.40 ms and GPU
15.51/16.30 ms. Three.js measured CPU 0.20/0.30 ms and GPU 15.24/16.66 ms.
Each used 120 warmup frames and 300 samples; the paired optimized renderer
runs reported no browser errors. This confirms lower CPU median in the rotating
workload, while overall cadence remains dominated by software GPU execution
(43.3 FPS before, 43.7 FPS after, 47.2 FPS for Three.js). It does not establish
a general advantage over Three.js or a physical-GPU speedup.

### Engine demo

```bash
./build_web.sh --serve # builds web/app.js + app.wasm, serves on :8080
```

Then open <http://localhost:8080/>. Arrows orbit, `W`/`S` zoom, `Q`/`E` spin the
glass sphere, and dragging turns the camera.

Emscripten is expected in `.toolchain/emsdk` (gitignored) or on `PATH` via
`EMSDK`; see [Requirements](getting-started.md#requirements). `python3 -m http.server` is only
there because an ES module will not load from `file://` — any static server
works.

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

The WebGL2 material renderer starts on devices with 16 fragment texture units.
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

### WebGPU comparison and upload optimization

The WebGPU comparison uses Chrome 157.0.8103.52 in headless mode at 1280×720,
with 1,024 visible cubes and 120 warmup plus 300 sampled frames. The static and
fully animated workloads use the same instance grid for Goose and Three.js:

| Workload | Renderer | Frame-call median / p95 | Backend CPU submit median / p95 | Browser FPS |
|---|---|---|---|---|
| Static | Goose WebGPU | 1.00 / 1.80 ms | 0.60 / 1.00 ms | 60.0 |
| Static | Three.js WebGPU | 0.60 / 1.00 ms | — | 60.0 |
| 1,024 moving | Goose WebGPU | 1.40 / 2.00 ms | 0.80 / 1.10 ms | 60.0 |
| 1,024 moving | Three.js WebGPU | 0.80 / 1.20 ms | — | 60.0 |

The browser cadence is capped at 60 FPS, so it does not distinguish these CPU
times. Goose reports one instanced scene draw; Three.js reports two WebGPU
draw calls. Timestamp queries were unavailable for both WebGPU paths, so these
results compare CPU frame work and command submission, not GPU execution time.
The separate Three.js WebGL2 mode provides WebGL timer-query GPU timings.

The WebGPU backend now packs frame/material uniforms once per compatible draw
batch instead of once per instance. It also caches packed uniforms and instance
records, skipping unchanged GPU buffer writes for static frames. The prior
static sample measured 1.50 ms median / 2.50 ms p95 frame-call and 1.10 / 1.70
ms CPU submit; the updated sample measured 1.00 / 1.80 ms and 0.60 / 1.00 ms.
This is one sequential run per version in headless Chrome, so treat the change
as an observed CPU-side improvement rather than a general GPU performance claim.
