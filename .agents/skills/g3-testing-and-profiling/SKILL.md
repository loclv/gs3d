---
name: g3-testing-and-profiling
description: Use when testing or measuring goose-3d — writing hand-derived checks, asserting pixels, proving a change is byte-identical, and profiling the CPU rasterizer's phases, threads and inner loop.
---

# Testing and profiling this engine

Three kinds of evidence, in increasing cost: arithmetic checks, pixel checks,
and the profiler. Use the cheapest one that can fail for the reason you are
worried about.

## 1. The harness

`src/testing.goose` is shared by the test roots:

```goose
testing::check(ok: bool, what: const u8[:]);   // prints "  ok    ..." or "  FAIL  ..."
if !testing::finish() { exit(1); }             // prints "N of M checks passed", false on failure
```

A root prints a heading per group, then the tally. Exit code 1 on any failure —
that is what `build_native.sh --test` relies on.

## 2. Hand-derived checks (`src/test_math.goose`, 99 checks)

**The discipline: the expected value is derived from the definition, in the
comment above the check, never copied from a debug print of the engine.** Three
derivations in this file have been wrong on the first run and the engine was
right — a rotated cube's AABB is not the cube (radius √3 → 2.164), the eye sits
behind the near plane by definition but inside the far one (so the far plane
evaluates to +100 at the eye, not −100), and the inverse of a projection loses
~0.005 at a 2000:1 near/far ratio to f32 cancellation in its own w row. Those
are the failures a self-consistent test suite cannot produce. When a check fails,
first re-derive it: two of three times the test was the bug.

Structure to copy:

```goose
fn case_trs() {
    print("translate * rotate * scale");
    // (1,0,0) scaled by 2 is (2,0,0), a quarter turn about y is (0,0,-2),
    // the move adds 10 to x.
    let m = g3::mat4_trs(float3 { 10.0, 0.0, 0.0 }, float3 { 0.0, PI * 0.5, 0.0 },
                         float3 { 2.0, 2.0, 2.0 });
    testing::check(close3(g3::mat4_apply(m, float3 { 1.0, 0.0, 0.0 }),
                          float3 { 10.0, 0.0, -2.0 }, 1e-6),
                  "scale, then rotate, then translate");
}
```

* Helpers: `close_to`, `close3`, `close_mat`, `box(lo, hi)`, `point_box(p, half)`.
* Tolerances are chosen per case and justified: 0.0 where f32 is exact
  (identity products, ±1, powers of two), `1e-6` for one matrix chain, `1e-3`
  for `M · M⁻¹` with a projective row.
* No backend is linked, so this root needs no surface and runs in milliseconds.
* Cover the conventions, not just the happy path: right-handed rotations
  (which sign each 90° turn gives), the Z-then-Y-then-X Euler order, GL clip
  space (near → −1, far → +1), aspect scaling, `look_at` for a turned camera,
  the singular-matrix fallback, and frustum planes with a rotated camera.
* For `trs`, pin the order with facts that survive a rewrite: the local origin
  lands on the position (translation last), a local axis is scaled before it is
  turned, and a negative scale mirrors instead of collapsing. Comparing
  `trs(t,r,s)` against `translate(t) · rotate_euler(r) · scale(s)` proves nothing
  — that is the definition.
* For the inverse, test both regimes: an affine `trs` (no projective row,
  `M · M⁻¹ = I` to 1e-6), the bare projection mapping NDC z back to eye space
  (near exactly, far to 0.01 — see above), and a view matrix whose inverse puts
  the origin back at the eye.
* For frustums, reject a box outside each of the six planes individually, and
  add an orthographic frustum: it is the same six-row extraction, but the sides
  come out parallel, so a per-plane sign error in the two x and two y rows
  cannot hide behind a cone.

## 3. Pixel checks (`src/test_engine.goose`, 333 checks)

Renders whole frames through the CPU backend and reads pixels back with
`g3::read_pixel(x, y)`, which returns `0xRRGGBB`.

```goose
fn flat_camera() {                    // lighting that makes a surface its own colour
    let c .= g3::camera();            // `.` binds the reference; `=` would copy
    c.pos = float3 { 0.0, 0.0, 5.0 }; c.target = float3_0; c.fov = 0.9;
    g3::set_light(float3 { 0.0, -1.0, 0.0 }, float3_0);
    g3::set_ambient(float3_1, 1.0); g3::set_fog(float3_0, 0.0);
    g3::set_background(float4 { 1.0, 0.0, 1.0, 1.0 });   // magenta: nothing hides in it
}
```

Rules that make these checks meaningful:

* Use a background colour nothing else can produce (magenta), so "nothing was
  drawn here" is an assertion, not an absence.
* Work out where a point lands by hand: for a camera at `+5z`, fov 0.9 and a
  400×400 surface, `ndc = x / (depth * tan(fov/2))`, `pixel = (ndc*0.5+0.5)*W`.
  `pixel_of()` in the test does exactly that; it must never call engine matrices.
* Assert with a tolerance of ±2/255 — but also assert exactness where the
  arithmetic is exact: the 50 % red-over-magenta blend is `(255,0,128)` to the
  byte, precisely because `0.5*255 + 0.5*128` rounds there.
* Always pair a negative check with its positive: "a plane seen from below is
  culled" plus "the same plane from above is drawn" proves the mesh exists and
  only the winding rule changed.
* `Stats` makes some checks cheaper and sharper than pixels: `culled == 1` and
  `drawn == 0` state the intent, the centre pixel confirms it.

## 4. Proving a change is neutral

The strongest evidence available for a refactor or an optimisation:

```bash
./build/app_native --frames 5 --width 480 --height 300 --out before.ppm # old build
# ... change, rebuild ...
./build/app_native --frames 5 --width 480 --height 300 --out after.ppm
cmp before.ppm after.ppm && echo identical
```

Pitfall that cost real time: the demo scene animates, so `--frames 5` and
`--frames 120` are different pictures. Compare with the same frame count and
the same size, or the diff is meaningless.

For the multithreaded rasterizer, also compare across worker counts — the output
must not depend on the schedule:

```bash
for t in 1 3 5 8; do G3_THREADS=$t ./build/app_native --frames 9 --width 640 --height 400 --out w$t.ppm; done
cmp w1.ppm w3.ppm && cmp w1.ppm w5.ppm && cmp w1.ppm w8.ppm
```

## 5. Profiling the CPU backend

```bash
G3_PROFILE=1 ./build/app_native --frames 120 --width 960 --height 600
```

No rebuild, so the numbers are the shipped code's. It prints per-frame:

```text
  clear      0.07 ms/frame
  setup      0.15 ms/frame  ( 2731 triangles,    55 ns each)
  raster     6.97 ms/frame  (675718 shaded of 692339 pixels, 10.3 ns each)
  frame      7.24 ms/frame  on 8 worker(s), 138 fps
```

* `G3_THREADS=1` forces one worker: always measure both, or you cannot tell what
  the threads bought.
* Take the min of three runs; single-run numbers move by a few percent.
* Overhead when on is ~2 % of wall clock; when off it is two predictable
  branches per triangle.

### The measured budget (Apple M-series, clang -O2, 960×600, 8 workers off)

| phase / term | cost | share |
|---|---|---|
| whole frame, 1 worker | 33.5 ms | 100 % |
| `shade()` per pixel | 22 ms | 71 % |
| `powf` alone | 6.5 ms | 21 % |
| three `sqrtf` | 1.0 ms | 3 % |
| `expf` (fog) | 0.4 ms | 1 % |
| two barycentric divisions | 0.3 ms | 1 % |
| clear + triangle setup | 0.22 ms | 0.7 % |
| whole frame, 8 workers | 7.2 ms | 4.65× |

### What was tried, and what it measured

* Defer the divisions behind an exact sign test — kept, byte-identical,
  0.1 ms (only 2 % of tested pixels are outside their triangle). Beware:
  `det` is negative because the screen y axis is flipped against NDC; the sign
  test must fold in `edge_sense` or it silently changes pixels.
* One reciprocal per triangle — rejected: 0.3 ms is not worth changing one
  rounding in the reference backend.
* Hoist frame constants into a global — rejected and slower (31.9 vs
  31.0 ms): writes through `fb` force clang to reload the global every pixel.
  Keeping them as `const g3_view_state *` reads was already optimal.
* Skip `powf` when the half-vector faces away; skip lighting for unlit items
  — rejected, slower (31.4 ms) on this scene: it has almost no unlit or
  back-facing pixels, so the branch only disturbed the pipeline.
* Row-block threading — kept: 4.65×, pixel-identical. Equal contiguous bands
  only reached 3.1× because the scene's geometry all sits below the horizon; a
  dynamically claimed block (`atomic_fetch_add(&next_block, 1)`, 8 rows) balances
  it.

### Method, generalised

1. Get a stable baseline (min of three, same command).
2. Ablate to attribute: replace one term with a cheap equivalent, measure,
   restore. That is how `powf` was found to be 21 % — reading the code would not
   have shown it.
3. Only then optimise, one change at a time, rebuilding and re-measuring.
4. Reject anything that measures within noise or slower, even if it "should" be
   faster; record it so the next person does not retry it.
5. Keep the exactness bar: if a change alters output, either prove the test
   suite still expresses the intent (and say which pixels changed) or do not
   ship it.

## 6. Browser-side checks

```bash
./build_web.sh --serve
"/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" --headless=new \
  --enable-unsafe-swiftshader --use-angle=swiftshader --window-size=800,500 \
  --virtual-time-budget=6000 --dump-dom http://localhost:8080/
```

Look for the HUD line (`— fps · 12 nodes · 11 drawn · 0 culled · 6884 tris · 5
meshes` — the counts must match the native backend's`) and
`id="status" class="hidden"`, which only happens when the engine booted. Add
`--enable-logging=stderr --log-level=0 2>&1 | grep CONSOLE` to catch JS errors.
