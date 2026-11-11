# Performance of the CPU backend

Measurements, the method that produced them, and what has already been tried and
rejected. Everything here is reproducible on the shipped binaries — no special
build.

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
* Take the **minimum of three runs**; run-to-run noise is a few percent and the
  minimum is the least noisy estimator here.

Output of one profiling run:

```
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
| **total** | **33.6** | |

So the story is entirely inside the raster loop: 675,718 shaded pixels at
~46 ns each. Everything else is a rounding error.

### Inside the loop, by ablation

Each row is one measurement with that term replaced by something cheap; the
difference is the cost of the term. This is the only reliable way to attribute
cost inside a loop this tight — reading the code suggests the wrong answer.

| ablated term | frame time | cost | share of the frame |
|---|---|---|---|
| nothing (baseline) | 31.0 ms | — | — |
| `powf(nh, shine)` → a multiply | 24.3 ms | **6.5 ms** | 21 % |
| the three `sqrtf` in the normalizations → 1.0 | 30.0 ms | 1.0 ms | 3 % |
| `expf` for fog → nothing | 30.4 ms | 0.4 ms | 1 % |
| the whole `shade()` call → the material colour | 8.7 ms | **22 ms** | 71 % |
| two barycentric divisions → one reciprocal per triangle | 30.7 ms | 0.3 ms | 1 % |
| the rest (edge tests, depth test, attribute interpolation, blend, store) | — | 9 ms | 29 % |

(Baselines differ by ~2 ms between the two tables because they were taken before
and after the division change landed; the ablations were all measured against
the 31.0 ms build.)

Consequences:

* Per-pixel **shading is the frame**, and `powf` alone is a fifth of it. Any
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
| 8 | 7.2 ms | **4.65×** | **138** |

4.65× on 8 logical cores is close to what 4 performance + 4 efficiency cores
can give: the last factor is limited by the efficiency cores' throughput, not by
the split.

**Equal contiguous bands were tried first and only reached 3.1×.** The reason is
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
| Defer the two divisions until a pixel is inside the triangle (exact sign test on the edge functions) | 0.1 ms (33.45 → 33.35) | **kept** — strictly less work, byte-identical. Note `det` is negative (screen y is flipped), so the test needs the `edge_sense` multiply or it silently changes pixels. |
| One reciprocal per triangle instead of two divisions per pixel | 0.3 ms | rejected — 1 % is not worth changing one rounding in the reference backend |
| Hoist the frame's lighting constants into a global struct | **31.9 ms, i.e. slower** | rejected — writes through `fb` force clang to reload the aliasing global every pixel; the `const g3_view_state *` reads it replaced were already in registers |
| Skip `powf` where the half-vector faces away, and skip lighting entirely for unlit items | **31.4 ms, i.e. slower** | rejected — both are algebraically exact, but this scene has almost no unlit or back-facing pixels, so the branch only disturbed the shading pipeline |
| Advance a pixel index instead of recomputing `y*fb_w + x` | no change | rejected as churn: clang already strength-reduces it |

## What is left

In order of expected size, with what each would cost:

1. **SIMD the inner loop lane-wise.** 4-wide would attack the 71 % shading share
   directly. Floating-point SIMD is IEEE-exact per lane, so this is the only big
   lever that can keep the output byte-identical — but it is a rewrite of
   `rasterize()` (masked tails, per-lane depth tests), not a tweak.
2. **Reduce shaded pixels by drawing opaque geometry front to back.** 675 k
   shaded for ~576 k visible pixels, so roughly 16 % of the frame is overdraw
   that a depth test would reject *before* shading if the list were sorted near
   to far. The engine deliberately sorts by mesh instead, to batch a GPU — this
   would need a per-backend ordering hint, not a change to the sort key.
3. **More workers than cores** (e.g. 12 blocks in flight on 8 cores) to hide the
   tail when a worker stalls on the atomic claim. Marginal: the claim is already
   contended at 8.
4. **Structure-of-arrays display list.** `soft_quad` is ~140 bytes per triangle
   and phase 2 touches most of it; splitting it into parallel arrays would cut
   cache traffic. Unmeasured guess: a few percent at 960×600, more at high
   resolutions where the display list exceeds cache.

Anything that changes the *fragment maths* instead (Gouraud-interpolated
specular, dropping the normalized half-vector, table-based `powf`) is off the
table for the CPU backend: it is the reference that
`src/test_engine.goose` reads pixels from, and `docs/architecture.md` promises
the two backends compute the same fragments term for term.
