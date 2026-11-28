# Performance of the CPU backend

Measurements, the method that produced them, and what has already been tried and
rejected. Everything here is reproducible on the shipped binaries — no special
build. For the scene-graph and facade sync side — version-keyed caches,
O(n) world updates, bulk wasm uploads — see
[performance-scene-sync.md](performance-scene-sync.md).

Machine used for all numbers below: Apple M-series, 8 logical cores (4
performance + 4 efficiency), clang with `-O2` (Goose's default), Goose v2026.3.
Scene: the demo at 960×600 — 5 meshes, 12 nodes, 11 draw items, 2,731 triangles
rasterized, 675,718 shaded pixels per frame.

## How to measure

```bash
G3_PROFILE=1 ./build/app_native --frames 120 --width 960 --height 600
G3_THREADS=1 G3_PROFILE=1 ./build/app_native --frames 120 --width 960 --height 600
```

* `G3_PROFILE=1` turns the backend's own timers on (they cost ~2 % of wall
  clock when on, two predictable branches per triangle when off).
* `G3_THREADS=n` fixes the worker count, which is how the scaling table below
  was produced.
* Take the minimum of three runs; run-to-run noise is a few percent and the
  minimum is the least noisy estimator here.

Output of one profiling run:

```text
g3_soft profile, 120 frames of 960x600:
  clear      0.07 ms/frame
  setup      0.15 ms/frame  ( 2731 triangles,    55 ns each)
  raster     6.97 ms/frame  (675718 shaded of 692339 pixels, 10.3 ns each)
  frame      7.24 ms/frame  on 8 worker(s), 138 fps
```

`clear` is the memset-like clear of the colour and depth buffers, `setup` is the
serial transform pass, `raster` is the wall time of the parallel raster phase,
and `frame` is the whole `g3p_draw_frame` call.

## The phases

### Before threading (one worker)

| phase | ms/frame | share |
|---|---|---|
| clear | 0.07 | 0.2 % |
| setup (transform + cull per triangle) | 0.15 | 0.5 % |
| raster | 33.4 | 99.3 % |
| total | 33.6 | |

So the story is entirely inside the raster loop: 675,718 shaded pixels at
~46 ns each. Everything else is a rounding error.

### Inside the loop, by ablation

Each row is one measurement with that term replaced by something cheap; the
difference is the cost of the term. This is the only reliable way to attribute
cost inside a loop this tight — reading the code suggests the wrong answer.

| ablated term | frame time | cost | share of the frame |
|---|---|---|---|
| nothing (baseline) | 31.0 ms | — | — |
| `powf(nh, shine)` → a multiply | 24.3 ms | 6.5 ms | 21 % |
| the three `sqrtf` in the normalizations → 1.0 | 30.0 ms | 1.0 ms | 3 % |
| `expf` for fog → nothing | 30.4 ms | 0.4 ms | 1 % |
| the whole `shade()` call → the material colour | 8.7 ms | 22 ms | 71 % |
| two barycentric divisions → one reciprocal per triangle | 30.7 ms | 0.3 ms | 1 % |
| the rest (edge tests, depth test, attribute interpolation, blend, store) | — | 9 ms | 29 % |

(Baselines differ by ~2 ms between the two tables because they were taken before
and after the division change landed; the ablations were all measured against
the 31.0 ms build.)

Consequences:

* Per-pixel shading is the frame, and `powf` alone is a fifth of it. Any
  optimisation that does not reduce shaded pixels or shading work per pixel
  cannot matter.
* The geometry machinery (0.22 ms) is not worth optimising at all.
* Divisions, indexing and clamping — the things that look expensive when you
  read the loop — are each about 1 % or less.

## Threading (shipped)

`platform/g3_soft.c` splits a frame into two phases: a serial transform pass
into a display list (`soft_quad`, ~140 bytes per triangle in the frame), then
rasterization of 8-row blocks that workers claim with `atomic_fetch_add`.

| workers | frame time | speedup | fps at 960×600 |
|---|---|---|---|
| 1 | 33.7 ms | 1.00× | 30 |
| 2 | 17.6 ms | 1.92× | 57 |
| 4 | 9.8 ms | 3.43× | 102 |
| 8 | 7.2 ms | 4.65× | 138 |

4.65× on 8 logical cores is close to what 4 performance + 4 efficiency cores
can give: the last factor is limited by the efficiency cores' throughput, not by
the split.

Equal contiguous bands were tried first and only reached 3.1×. The reason is
visible in any render of the demo: the horizon sits high, so the top third of the
screen has no geometry and those workers finish immediately while the bottom
workers do everything. Dynamically claimed row blocks fixed it — that change
alone took 10.5 ms → 7.2 ms. (Measured: 8 equal bands 10.46 ms; 8-row blocks
7.24 ms.)

Determinism: the output is byte-identical across worker counts, because row
blocks are disjoint (no two workers write a pixel) and each block walks the
display list in order (blend order inside a pixel is the engine's). Verified by
`cmp` at 1, 3, 5 and 8 workers.

## Attempts that were rejected, with numbers

Recorded so nobody repeats them.

| attempt | measured | verdict |
|---|---|---|
| Defer the two divisions until a pixel is inside the triangle (exact sign test on the edge functions) | 0.1 ms (33.45 → 33.35) | kept — strictly less work, byte-identical. Note `det` is negative (screen y is flipped), so the test needs the `edge_sense` multiply or it silently changes pixels. |
| One reciprocal per triangle instead of two divisions per pixel | 0.3 ms | rejected — 1 % is not worth changing one rounding in the reference backend |
| Hoist the frame's lighting constants into a global struct | 31.9 ms, i.e. slower | rejected — writes through `fb` force clang to reload the aliasing global every pixel; the `const g3_view_state *` reads it replaced were already in registers |
| Skip `powf` where the half-vector faces away, and skip lighting entirely for unlit items | 31.4 ms, i.e. slower | rejected — both are algebraically exact, but this scene has almost no unlit or back-facing pixels, so the branch only disturbed the shading pipeline |
| Advance a pixel index instead of recomputing `y*fb_w + x` | no change | rejected as churn: clang already strength-reduces it |

## What is left

In order of expected size, with what each would cost:

1. SIMD the inner loop lane-wise. 4-wide would attack the 71 % shading share
   directly. Floating-point SIMD is IEEE-exact per lane, so this is the only big
   lever that can keep the output byte-identical — but it is a rewrite of
   `rasterize()` (masked tails, per-lane depth tests), not a tweak.
2. Reduce shaded pixels by drawing opaque geometry front to back. 675 k
   shaded for ~576 k visible pixels, so roughly 16 % of the frame is overdraw
   that a depth test would reject before shading if the list were sorted near
   to far. The engine deliberately sorts by mesh instead, to batch a GPU — this
   would need a per-backend ordering hint, not a change to the sort key.
3. More workers than cores (e.g. 12 blocks in flight on 8 cores) to hide the
   tail when a worker stalls on the atomic claim. Marginal: the claim is already
   contended at 8.
4. Structure-of-arrays display list. `soft_quad` is ~140 bytes per triangle
   and phase 2 touches most of it; splitting it into parallel arrays would cut
   cache traffic. Unmeasured guess: a few percent at 960×600, more at high
   resolutions where the display list exceeds cache.

Anything that changes the fragment maths instead (Gouraud-interpolated
specular, dropping the normalized half-vector, table-based `powf`) is off the
table for the CPU backend: it is the reference that
`src/test_engine.goose` reads pixels from, and `docs/architecture.md` promises
the two backends compute the same fragments term for term.

## WebGL instancing benchmark

Build and serve the repeated-mesh scene with:

```bash
./build_web.sh --benchmark --serve
```

Open <http://localhost:8080/benchmark/>. The scene contains one shared cube
mesh and up to 1,024 visible nodes with identical opaque material state. The
slider changes the visible node count. The page warms up for 120 frames, then
reports recent browser frame rate, synchronous engine-call median and p95, and
WebGL scene-pass draw calls. A correctly batched count of 2 or more should use
one scene draw call while all visible nodes remain in the view frustum.

The frame-call timings measure JavaScript-to-WebAssembly engine work and GPU
command submission, not completion of GPU work. Browser frame rate includes
the browser's refresh limit and GPU execution. Record browser/version, GPU,
canvas pixel dimensions, node count, scene draw calls, median and p95 when
comparing devices or revisions; use the same browser, window size and power
state for before/after comparisons. The current WebGL benchmark has no browser
automation or GPU timer query, so its results are diagnostic rather than a
cross-device performance claim.

### Compare with Three.js

Build the Goose benchmark and serve the repository's `web` directory:

```bash
./build_web.sh --benchmark
python3 -m http.server 8080 --directory web
```

Open <http://localhost:8080/benchmark/compare.html>. The backend tabs reload
the page and run one renderer on one canvas, avoiding simultaneous rendering
work. The 3D backends use 1,024 or fewer cubes on the same 32×32 grid, cube
size, color, camera, and pixel-sized canvas. Goose uses its regular scene
nodes and render path; Three.js uses `InstancedMesh`. The Three.js module is
pinned to 0.187.0 (r187) and the PixiJS module to 8.22.0, both loaded from
jsDelivr, so those modes need network access.

The PixiJS tabs draw the same grid and count as flat 2D sprites: no
perspective, lighting, or depth, and "rotation" is a single in-plane angle
rather than the 3D Euler rotation. PixiJS does not expose a draw-call count,
so its report shows draw calls as n/a, and its WebGPU backend has no GPU
timer query. Treat the PixiJS rows as a sprite-batching baseline, not an
apples-to-apples 3D comparison.

After 120 warmup frames, the page records 300 synchronous frame calls and
reports median/p95, browser frame rate, and scene draw calls. These frame-call
times capture CPU scene processing and renderer command submission; they do not
wait for GPU completion. Browser FPS is capped by display refresh. Compare the
two modes in the same browser session and device state, at the same cube count
and canvas dimensions. The report is a local diagnostic, not a general claim
that one engine is faster across workloads or hardware.

For Goose WebGPU, append `&gpu-timing=1` to the comparison URL to request the
optional `timestamp-query` device feature. If supported, the report includes
render-pass GPU median and p95 and the number of completed samples; missing
samples are reported as skipped. Measurements begin after warmup, and changing
the count or resizing starts a fresh sample. Timestamp queries exclude browser
compositing and display refresh, and instrumenting the renderer can itself add
overhead. The feature may be unavailable on a given browser or adapter.

The WebGPU instance buffer groups changed records into at most eight spans,
merging gaps of four or fewer unchanged records. For example, one changed
instance in a 1,024-instance batch uploads 80 bytes instead of 81,920; changing
a prefix of 32 uploads 2,560 bytes, and changing both endpoints uploads two
80-byte spans. If more than eight spans are needed, the last span includes the
remaining changes. Initial allocation and buffer growth still initialize the
required slots.
`node web/test_webgpu_uploads.mjs` verifies these transfer rules with a recording
device, including shrinking and growing the visible count. These byte counts do
not by themselves demonstrate a frame-time improvement on a GPU.

A follow-up synchronous comparison used Chrome 157 with headless SwiftShader,
a 320×180 viewport, 1,024 cubes, 100 warmup calls and 500 timed calls per
fresh browser. With 32 moving cubes, four interleaved runs averaged 0.375–0.411
ms per frame before and 0.118–0.120 ms after. Two static runs measured
0.113–0.115 ms before and 0.116–0.118 ms after; two fully moving runs measured
0.387–0.395 ms before and 0.395–0.454 ms after. These short software-rendered
bursts include CPU submission and can be affected by queued GPU work; they
show a substantial improvement for this sparse-motion workload, but do not
establish a physical-GPU or GPU-execution-time improvement. The fully moving
result also warrants further measurement for a possible regression. A further
six interleaved runs measured 0.336–0.376 ms before and 0.334–0.365 ms after;
the overlapping ranges do not establish whether a regression exists.

### Sparse changes at opposite ends

With 1,024 visible cubes and two moving instances at indices 0 and 1,023, the
previous single-span upload transferred 81,920 bytes per frame. The grouped
upload transfers 160 bytes in two writes. Three interleaved runs of 500 timed
calls after 100 warmup calls, at 320×180 on Chrome 157.0.8103.52 headless
SwiftShader, produced the following average CPU frame-call times:

| Renderer | Three runs, ms/frame |
|---|---|
| Goose WebGPU, single span | 0.422, 0.377, 1.074 |
| Goose WebGPU, grouped spans | 0.117, 0.134, 0.113 |
| Three.js r187 WebGPU | 0.043, 0.045, 0.043 |

The Goose renderer submitted one scene draw in each run. The Three.js scene
uses the same moving indices and adds an update range for each changed matrix;
its renderer was confirmed to use WebGPU. These are synchronous CPU work and
submission times, not GPU completion times. The 1.074 ms baseline sample shows
substantial noise, and the result is specific to this sparse workload and
software adapter. In a separate all-moving workload, Goose ranges overlapped:
0.347–0.414 ms before and 0.347–0.392 ms after. The 32-instance contiguous
workload also overlapped at 0.116–0.119 ms before and 0.117–0.118 ms after.

To reproduce, build `./build_web.sh --benchmark`, save the previous bridge to
a file, and run `G3_BENCH_SPREAD=1 node web/benchmark/measure-webgpu.mjs
BASELINE_WEBGPU_JS 2`. Add `G3_BENCH_THREE=1` for the Three.js runs (the pinned
r187 module requires network access). The browser page also accepts
`?backend=goose&count=1024&motion=2&spread=1`; use `backend=three-webgpu` for
Three.js. The sampling script leaves the page's animation loop enabled, so its
bursts can include queued GPU work and should be repeated on physical GPUs.

To repeat this comparison, build the benchmark and save the baseline bridge:

```sh
./build_web.sh --benchmark
git show 6f64bc6^:web/webgpu.js > /tmp/g3-webgpu-baseline.js
node web/benchmark/measure-webgpu.mjs /tmp/g3-webgpu-baseline.js 32
```

The second argument selects the number of moving instances (0–1,024). The
script runs three interleaved samples per version in fresh headless Chrome
processes and fails if the renderer falls back to WebGL2. Set `G3_CHROME` to
the Chrome executable on systems where the default macOS path is unavailable.
It requires Node.js with the built-in WebSocket API. Its SwiftShader timings
measure synchronous CPU submission, not completed GPU work.

A batching experiment cached the first item's compatibility fields once per
batch instead of reading them again for each neighboring item. Three 1,024-cube
static bursts measured 0.111–0.112 ms before and 0.109–0.111 ms after; with all
cubes moving, ranges were 0.333–0.365 ms before and 0.332–0.358 ms after. The
small, overlapping differences do not establish a speedup, so the experiment
was discarded. The WebGPU bridge test also verifies that changes to mesh,
blend, alpha, culling and material parameters split batches without reordering.

Another experiment combined batch discovery and instance packing in one loop,
instead of scanning each compatible run and then packing it. With 1,024 cubes
at 320×180 in headless Chrome SwiftShader, three interleaved 500-frame bursts
with 32 moving instances measured 0.1154–0.1164 ms/frame before and
0.1144–0.1146 ms after. With all instances moving the ranges were
0.3504–0.3680 ms before and 0.3510–0.4068 ms after. These synchronous CPU
submission timings overlap in the fully moving workload; the small sparse
workload difference does not establish a general improvement, so the change
was discarded. Both versions submitted one scene draw, and the recording-device
upload and batch-order checks passed for the candidate.

An unrolled instance-packing loop also failed to show a gain: with 32 moving
instances, three interleaved bursts ranged from 0.1164 to 0.1382 ms/frame
before and 0.1172 to 0.1498 ms after. A separate experiment specialized the
WebGPU shader for unlit materials to remove normal and lighting calculations.
Two static SwiftShader runs collected 300 timestamp samples each and reported
render-pass medians of 12.30 and 12.33 ms before, versus 12.58 and 12.16 ms
after. The page's animation loop was also running during these samples, so
these are exploratory measurements rather than isolated paired GPU timings.
Neither experiment demonstrated a repeatable gain and neither was retained.

A separate packing experiment compared and copied the 80-byte instance record
as 32-bit integer words. With 32 moving cubes, three runs measured 0.115–0.116
ms before and 0.133–0.134 ms after in the same synchronous SwiftShader harness.
The slower candidate was discarded.

A vertex shader experiment skipped inverse-transpose normal calculation for
unlit objects. Two interleaved 1,024-cube static runs on headless Chrome
SwiftShader, using 300 WebGPU timestamp samples per run at 320×180, measured
GPU medians of 12.45 and 12.49 ms before, and 12.49 and 12.42 ms with the
branch. There was no demonstrated gain, so the branch was discarded. These
software-GPU timings do not establish how the branch performs on physical GPUs.

An opaque pipeline experiment disabled blending for opaque and masked draws.
Two interleaved static runs measured GPU medians of 12.42 and 12.57 ms before,
and 12.35 and 12.46 ms after (300 timestamps per run). The overlapping results
do not demonstrate a gain, so the candidate was discarded.

A static 1,024-cube headless WebGPU capture at 320×180 was byte-identical
between the renderer before partial instance uploads and the current renderer.
This checks the rendered static workload; the instance upload tests separately
cover changing and growing the packed instance buffer.

### PixiJS sprite comparison

The compare page also offers PixiJS 8.22.0 (pinned, jsDelivr) as
`backend=pixi` (WebGL2) and `backend=pixi-webgpu` (WebGPU, falling back to
WebGL2). PixiJS draws the same 32×32 grid and instance count as flat 2D
sprites — no perspective, lighting, or depth — so its rows measure sprite
batching and command submission, not 3D vertex or fragment cost. PixiJS does
not expose a draw-call count, so its scene calls are reported as n/a.

Two interleaved runs per backend and workload in headless Chrome
157.0.8103.52 with SwiftShader at a 1280×720 viewport, 1,024 visible
instances, 120 warmup frames and 300 sampled frames. Ranges span the two
runs; the frame-call timer's 0.1 ms granularity limits what these medians
resolve:

| Workload | Renderer | Scene calls | Browser FPS | Frame-call median / p95 | GPU median / p95 |
|---|---|---|---|---|---|
| Static | Goose 3D WebGPU | 1 | 56–59 | 0.20 / 0.30 ms | unavailable |
| Static | Three.js r187 WebGPU | 2 | 19–20 | 0.20 / 0.30–0.40 ms | unavailable |
| Static | Three.js r187 WebGL2 | 1 | 46–48 | 0.10 / 0.20 ms | 14.9–15.2 / 17.4–18.6 ms |
| Static | PixiJS 8.22.0 WebGL2 | n/a | 59–60 | 0.10 / 0.20 ms | 4.7–4.9 / 6.3–6.6 ms |
| Static | PixiJS 8.22.0 WebGPU | n/a | 60 | 0.10–0.20 / 0.20–0.30 ms | unavailable |
| All 1,024 moving | Goose 3D WebGPU | 1 | 59–60 | 0.30 / 0.40 ms | unavailable |
| All 1,024 moving | Three.js r187 WebGPU | 2 | 20–21 | 0.30 / 0.40 ms | unavailable |
| All 1,024 moving | Three.js r187 WebGL2 | 1 | 47 | 0.10 / 0.20 ms | 15.0–15.4 / 17.8–18.1 ms |
| All 1,024 moving | PixiJS 8.22.0 WebGL2 | n/a | 60 | 0.30 / 0.40 ms | 4.7 / 6.1–6.7 ms |
| All 1,024 moving | PixiJS 8.22.0 WebGPU | n/a | 60 | 0.30 / 0.50 ms | unavailable |

Read the GPU column carefully: PixiJS's ~4.7 ms is the cost of drawing 1,024
unlit billboards, while Three.js WebGL2's ~15 ms shades lit cube geometry —
the fragment workloads are not equivalent, so the GPU rows compare renderer
overhead per visible object, not engine speed. The CPU frame-call column is
the closer comparison, and at this scale every backend sits within 0.2 ms of
the others, mostly below the timer's resolution. Browser FPS is dominated by
SwiftShader's software rasterization: the Three.js WebGPU path's ~20 FPS
versus ~60 elsewhere reflects its shader cost on the CPU-side adapter, not a
real-hardware ordering. These are single-machine diagnostics; repeat on a
physical GPU before drawing conclusions.

## WebGL morph animation benchmark

Build and serve the 64-target morph benchmark with:

```bash
./build_web.sh --animation-benchmark --serve
```

Regenerate its bundled GLB with `python3 web/benchmark/generate_morph_sample.py`.

Open <http://localhost:8080/benchmark/animation.html>. The bundled GLB has
2,048 vertices, 64 animated morph targets, and a linear weight
animation. The report separates glTF `model.update()` time from the synchronous
engine frame call and shows scene-pass draw calls. The engine call includes
animation weight uploads and command submission; it does not measure GPU
completion. Use browser/GPU-specific measurements for comparison, and check
that the device accepts the GPU morph target textures before interpreting the
frame results.

## Physics solver benchmarks

The rigid-body solver (`g3.physics`) ships three headless benchmarks under
`src/benchmark_physics*.goose`. Build and run them natively:

```bash
goose build --cc tools/native_cc.sh -o build/benchmark_physics src/benchmark_physics.goose && ./build/benchmark_physics
goose build --cc tools/native_cc.sh -o build/benchmark_physics_stack src/benchmark_physics_stack.goose && ./build/benchmark_physics_stack
goose build --cc tools/native_cc.sh -o build/benchmark_physics_rain src/benchmark_physics_rain.goose && ./build/benchmark_physics_rain
```

Scenes, all stepped 600 times at 1/60 s:

* `benchmark_physics` — 20×20 grid of dynamic spheres (r = 0.4) spaced 2
  units apart plus 10 distant static boxes, gravity off: a broadphase
  stress test with almost no contacts.
* `benchmark_physics_stack` — static floor plus 100 unit-density boxes in
  a 10×10 footprint stacked 10 high: hundreds of contact-manifold points
  per substep while the pile is active. The slender towers topple under
  this solver (physical collapse, not energy injection — verified by
  energy audit), which keeps every body awake and the benchmark in the
  expensive regime on purpose.
* `benchmark_physics_rain` — one box spawned per step above a floor,
  removed once landed and slow: ~100 live bodies in the active-contact
  regime without a pile ever settling, so nothing sleeps.

Measured on the same machine as the raster numbers above (Apple M-series,
`-O2`), best of several runs:

| scene | gs3d | Rapier 0.21 (`@dimforge/rapier3d-compat`, wasm) |
|---|---|---|
| 410 separated bodies | **~15 ms** | 32 ms |
| rain, ~100 live bodies | **~12 ms** | 65–73 ms |
| 101-body pile, default settings | ~170–195 ms | **9.6 ms** |
| 101-body pile, Rapier `canSleep=false` | ~170–195 ms | 144 ms |

Rapier numbers come from a Bun script driving the JS-compat build with
identical body layouts, gravity, timestep and step counts; Rapier's own
sleeping was left at its default (enabled) for the first pile row and
disabled via `RigidBodyDesc.setCanSleep(false)` for the second.

Read the pile rows carefully before quoting them:

* Rapier's solver is stable enough that the 10-high towers *stand*, so
  100/101 bodies sleep and the 9.6 ms is mostly per-body sleep
  bookkeeping — not solver throughput. gs3d's pile physically topples,
  so all 101 bodies stay awake at high speed. The workloads are not
  equivalent.
* With Rapier sleeping disabled, its standing-but-awake pile costs
  144 ms against gs3d's toppling pile at ~230 ms — Rapier's solver is
  ~1.6× faster on dense, permanently active contacts. Rapier
  (`rapier3d-compat` is wasm, not native) still has architectural leads:
  island-based sleeping, contact manifolds persisted across frames, and
  more solver iterations with better convergence.
* On broadphase-dominated and moderate-contact scenes gs3d is ~2–3×
  faster: the per-substep sweep-and-prune along x plus immovable-pair
  early-out make separated bodies nearly free, and there is no
  per-body island bookkeeping.

Solver structure for reference: sweep-and-prune broadphase on per-body
world AABBs, box-box contact manifolds (Sutherland–Hodgman clipping, up
to 8 points per face contact), 12 sequential-impulse iterations with
per-substep warm starting of accumulated normal impulses and an early
exit once impulse deltas converge, one shared positional-correction
pass, per-body sleeping after ~0.5 s under speed and spin thresholds, a
cached world-space inverse inertia tensor so angular response is one
mat-vec per impulse, adaptive substeps allowing half a collider feature
of travel each, and a persistent contact store — contact records live
across steps in a pair-keyed hash, so resting and sleeping overlaps are
reported without re-running detection every substep.

Water (`physics_set_water_level`) is off by default and costs nothing
until enabled; when on, each awake dynamic body pays one submerged-
fraction evaluation plus a few flops per substep — O(awake bodies), no
extra pair work. `samples/water` exercises it in the browser.
