# Getting started

This guide covers the toolchain, headless rendering, and verification. For browser examples and renderer comparisons, see [Browser examples](browser.md).

## Requirements

* Goose 2026.3 or later on `PATH` (the release archive works: it ships the
  standard library and samples).
* A C compiler for the native build — `goose toolchain` reports what it
  found.
* pkg-config, libpng and libjpeg for the native PNG/JPEG image decoder.
  The web build uses browser image decoding and does not require these libraries.
* Emscripten for the web build. Either
  `git clone https://github.com/emscripten-core/emsdk && cd emsdk && ./emsdk install latest && ./emsdk activate latest`
  into `.toolchain/emsdk` (what `build_web.sh` looks for, and `.gitignore`
  ignores), or install the SDK anywhere and export `EMSDK=/path/to/emsdk`.

The web build passes `-DGS_STACK_RESERVE='(64ull<<20)'`. Goose reserves 2 GiB of
address space per data stack by default, which costs nothing natively but is
real memory in a wasm heap; the engine keeps five arenas, so capping each at
64 MiB is the difference between a 2 GiB heap and a few hundred MiB. Raise it if
a scene needs more geometry than that.

## Render a still, headless

The CPU backend also decodes PNG and JPEG images through libpng and libjpeg;
`build_native.sh` obtains their flags from `pkg-config`:

```bash
./build_native.sh
./build/app_native --frames 8 --width 960 --height 600 --out frame.ppm
# Load the first static GLB or JSON glTF primitive through the native CPU backend.
./build/app_native --glb web/viewer/sample.glb --out model.ppm
```

```text
mesh 5, nodes 12: drew 11 of 11 visible (0 culled, 6884 triangles, 11 draw items)
camera at vec3<f32> { 5.36, 3.76, 7.51 } looking at vec3<f32> { 0.0, 1.5, 0.0 }
wrote frame.ppm: true
```

## Run the tests

```bash
./build_native.sh --test
```

Four roots, all exiting non-zero on a failure:

* `test_math` — 99 checks on the math module alone: `I * I`, the order of
  composition, right-handed 90° rotations, the Z-then-Y-then-X Euler order, GL
  clip space (near → −1, far → +1, `d tan(fov/2)` at the edge), `look_at`, the
  full cofactor inverse both ways (clipping back to eye space, and an affine
  TRS * M⁻¹ = I to 1e-6), `transpose`, bounding boxes, and frustum planes for
  a turned camera and for an orthographic projection. No backend is linked and
  no surface is needed — it is pure arithmetic, so a failure names one function.
* `test_engine` — 333 checks on whole frames, read back through the ABI:
  silhouette size, exact blending, depth order, hierarchy, culling, winding,
  arena compaction and mesh reuse.
* `test_game` — 4 checks on the Beacon Run sample rules: scoring, win and
  lose states, reset.
* `test_siege` — 61 checks on Rift Siege: segment/sphere sweeps, movement
  speed, dash cooldown, cover blocking shots, box/sphere/capsule
  physics colliders, kinematic bodies, per-body removal, contact queries
  and raycasts, and the Rapier-style `g3.rapier` facade.

Every expected value is derived by hand in the comment above it rather than
copied out of the engine, so a failure means the thing changed — not that two
halves of the engine agree with each other. Three of those derivations have been
wrong at some point (a rotated cube's box is not the cube; the eye sits behind
the near plane by definition, but inside the far one) and the code was right,
which is the sort of thing a hand-derived suite finds and a self-consistent one
does not.

```text
g3 math self-test
  ok    +90 about y takes +x to -z
  ok    the midpoint of near and far is at z = 0.980
  ok    M * inverse(M) is the identity
  ok    turning a cube widens the box around it to 2.164
99 of 99 checks passed
g3 engine self-test, 400x400
  ok    the right edge falls where 1 / (4 * tan(fov/2)) puts it
333 of 333 checks passed
```
