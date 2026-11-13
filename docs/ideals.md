# Ideals

The principles this project is built on, and the mechanisms that keep them
true. Each ideal is stated as a claim, then the way it is enforced and the
check that would fail if it were violated. They are not aspirations written
after the fact: every one of them exists because something went wrong without
it.

Companion documents: [`architecture.md`](architecture.md) for how the pieces fit,
[`abi.md`](abi.md) for the byte-level contract, [`performance.md`](performance.md)
for the measurements.

## 1. The seam is the contract

**Claim.** The engine knows nothing about canvases, GL state or files. The
backends know nothing about scenes, cameras or culling. They meet at one call
per frame, `g3p_draw_frame`, over packed flat structs.

**Why.** A wasm boundary crossing per item would dominate the frame; a backend
that re-derives a camera matrix would silently diverge from the engine.

**Enforced by.** `src/g3/platform.goose` declares only `Vertex`, `DrawItem`,
`ViewState` and eleven `extern fn g3p_*`. `src/g3/render.goose`'s `pack_item()`
is the single place a `DrawItem` is built, and it multiplies out
`view_proj * world` there so no backend ever touches a camera matrix.

**Check.** Both backends render the same demo to the same pixels; the CPU one
is the reference tests read from.

## 2. Both backends are the same machine

**Claim.** Depth `LESS`, back faces culled, CCW front faces, and the fragment
maths term for term — identical in `platform/g3_web.c` and `platform/g3_soft.c`.

**Why.** The CPU rasterizer is the test oracle. If its `shade()` differs from
the GLSL, a "passing" pixel test passes the wrong thing.

**Enforced by.** `docs/architecture.md` lists the drawing rules; `docs/abi.md`
lists them again as the contract; `src/test_engine.goose` reads pixels.

**Check.** A PPM `cmp` between the two backends on the same frame. A change
to fragment maths in one and not the other fails it.

## 3. Arenas, not heaps

**Claim.** Arena backing arrays grow without relocating live elements. Checked
handles validate resources that can be removed or reused; ordinary mesh and
texture IDs remain append-only, and removed mesh spans can be reused by asset
loads without moving live geometry.

**Why.** Goose has no heap. Stable slots preserve caller references across
frames, while explicit release frees backend allocations and prevents stale
handles from silently referring to a different resource.

**Enforced by.** `g_verts`, `g_indices`, `g_meshes`, `g_nodes`, `g_draws` in
`src/g3/*.goose`. `visible = false` hides a node; `scene_clear()` empties the
scene and the compiler rejects it while any node reference is still live.

**Check.** `goose check` on every root; a stale reference is a compile error,
not a runtime surprise.

## 4. Hand-derived truth

**Claim.** Every expected value in a test is derived from the definition, in
the comment above the check. It is never copied from a debug print of the
engine.

**Why.** A self-consistent suite — engine output compared to engine output —
cannot catch a bug that is consistent across both halves. Three derivations in
`src/test_math.goose` were wrong on the first run and the engine was right:
a rotated cube's AABB is not the cube (radius √3 → 2.164); the eye sits behind
the near plane by definition but *inside* the far one (so the far plane
evaluates to +100 at the eye); and the inverse of a projection loses ~0.005 at
a 2000:1 near/far ratio to f32 cancellation in its own w row.

**Enforced by.** The discipline is written in
`.agents/skills/g3-testing-and-profiling/SKILL.md` §2 and practised in
`src/test_math.goose`.

**Check.** A failure means the thing changed — or the derivation was wrong.
Re-derive before blaming the code: two of three times the test was the bug.

## 5. The CPU backend is the reference, not a mock

**Claim.** Tests read real pixels through `g3p_read_pixel`. No mock backend,
no skipped shading, no "good enough" tolerance where an exact answer exists.

**Why.** A mock backend proves nothing about the maths. The CPU backend exercises
the same clip transform, rasterization and shading as the GPU path.

**Enforced by.** `src/test_engine.goose` renders whole frames and reads pixels;
`src/test_math.goose` needs no backend at all.

**Check.** `./build_native.sh --test` exits non-zero on any failure.

## 6. Measurement, not opinion

**Claim.** A performance claim ships with a number, a method and a machine.
Rejected attempts are recorded with their measured deltas so nobody repeats them.

**Why.** Reading the loop suggested the wrong cost: divisions looked expensive
(1 %) and shading was 71 %. Only ablation told the truth.

**Enforced by.** `docs/performance.md` — before/after tables, ablation table,
scaling table, and a "rejected attempts" table.

**Check.** A new optimisation lands with a before/after pair, or it does not
land. `G3_PROFILE=1` makes the measurement reproducible on the shipped binary.

## 7. Determinism

**Claim.** Output is byte-identical across worker counts, and across runs on
the same inputs.

**Why.** Row blocks are disjoint (no two workers write a pixel) and each block
walks the display list in draw-list order, so blend order inside a pixel is the
engine's regardless of scheduling.

**Enforced by.** 8-row block claim via `atomic_fetch_add` in `platform/g3_soft.c`.

**Check.** `cmp` of PPMs at 1, 3, 5 and 8 workers.

## 8. f32 end to end

**Claim.** The engine is f32 throughout, matching what the GPU computes. A
`Mat4` is 64 bytes and crosses to C without packing or conversion.

**Why.** A hidden f64 would make the CPU reference disagree with GL by ULPs,
and every tolerance in the test suite would become meaningless.

**Enforced by.** Goose types; `platform/g3_abi.h` static-asserts sizes and
offsets.

**Check.** `_Static_assert(sizeof(g3_mat4) == 64)` and friends at build time.

## 9. Sort is the batching

**Claim.** Opaque items sort by mesh id (adjacent items of one mesh, so a GPU
driver saves state changes); blended items sort far→near and after every opaque
item. A backend must draw in list order; the list *is* the instruction.

**Why.** Front-to-back would cut CPU overdraw ~16 % but break GPU batching;
the GPU wins. The blended pass reads the depth of everything behind it and does
not write depth.

**Enforced by.** `sort_key()` and `pack_item()` in `src/g3/render.goose`;
`DrawItem.key` is f32 and the opaque band stops at 1e6 by construction.

**Check.** `src/test_engine.goose` checks depth order and blending exactly.

## 10. Pure arithmetic where possible

**Claim.** A module that has no backend dependency is tested without one. The
math module is checked directly on matrix values, not through rendered pixels.

**Why.** A pixel test names a function only after you have already guessed
which function broke. A direct test names it immediately.

**Enforced by.** `src/test_math.goose` links no backend and needs no surface;
it runs in milliseconds.

**Check.** `goose check src/test_math.goose` reports 0 warnings and the root
contains no `g3p_*` symbol.

## 11. Zero warnings

**Claim.** `goose check` on all four roots reports zero warnings. The `typechecked
ok` and `bce` lines are the only output.

**Why.** A warning that is tolerated becomes a bug that is tolerated; the roots
are the gate.

**Enforced by.** `./build_native.sh --test` builds all roots.

**Check.** `for f in src/*.goose; do goose check $f; done` — zero warnings.

## 12. Profiling is opt-in and free when off

**Claim.** Timers cost ~2 % of wall clock when on and two predictable branches
per triangle when off. No rebuild is needed to profile.

**Why.** A profiler that changes the number it measures is useless; one that
requires a rebuild is never used.

**Enforced by.** `G3_PROFILE=1` env var in `platform/g3_soft.c`.

**Check.** `G3_PROFILE=1` output matches the table in `docs/performance.md`.

## 13. Headless verifiable

**Claim.** The CPU backend plus `read_pixel` lets the whole engine be tested
without a GPU, in CI, on a machine with no display.

**Why.** A test that needs a browser is a test that does not run.

**Enforced by.** `platform/g3_soft.c` implements every `g3p_*` including
`g3p_read_pixel` and `g3p_save_frame` (PPM).

**Check.** `./build_native.sh --test` runs both roots with no display server.

## 14. Fail loud, not silent

**Claim.** A problem is reported, not swallowed. The first frame checks
`glGetError()` once and reports it to the page; `testing::check()` prints
`FAIL`; `build_native.sh` exits non-zero on a test failure.

**Why.** A blank canvas with no message costs an afternoon. A silent test
failure costs a release.

**Enforced by.** `web/hud.js` `failIfSilent`; `src/testing.goose`; build
script exit codes.

**Check.** Introduce a failing check and confirm the build exits non-zero and
prints `FAIL`.

## 15. Docs, skills and counts stay in sync

**Claim.** Byte sizes, check counts and file tables are updated in the same
change that moves them. `README.md`, `docs/*.md` and `.agents/skills/*/SKILL.md`
agree with the code.

**Why.** A stale count is a lie that looks like documentation.

**Enforced by.** Manual discipline; the testing skill records the current count.

**Check.** `grep -rn "72\|172 bytes"` returns nothing stale.

## 16. Smallest change that fully addresses the request

**Claim.** Do everything asked, completely, and nothing not asked for: no
unrequested features, refactors, new files, dependencies or polish.

**Why.** Scope creep is how a focused fix becomes a risky one.

**Enforced by.** Code review; this document.

**Check.** A diff touches only files the request implies.

## 17. Extract only when shared

**Claim.** Code is duplicated until a second caller appears; then it is
extracted once. `platform/g3_input.{h,c}` is the model: the key table, mouse
deltas and resize wrapper existed twice before they existed once.

**Why.** Premature abstraction guesses at the interface; the second caller
reveals it.

**Enforced by.** Review.

**Check.** An extraction PR names the two (or more) call sites.

## 18. The page owns the clock

**Claim.** The browser calls `g3_app_frame(dt)` from `requestAnimationFrame`
with the real delta. There is no `main` loop in C, no `emscripten_set_main_loop`.

**Why.** A hidden tab then costs nothing, and the engine gets the true elapsed
time instead of a fixed step.

**Enforced by.** `web/shell.js`; `platform/g3_web.c`'s `g3_host_start` does
`goose_init` + `g3_app_init` and returns.

**Check.** Backgrounding the tab stops frames (visible in the HUD fps counter).

## 19. No commits without authorization

**Claim.** The repository has no commits yet and none are created, staged,
pushed or deployed unless the user asks. Destructive or hard-to-undo actions
are not taken on a coding request alone.

**Why.** A coding request is not a release request.

**Enforced by.** Git discipline; this document.

**Check.** `git log` is empty until the user says otherwise.

## Automated gates

Two of the ideals above are now enforced by `./build_native.sh --test`, so a
regression fails the build instead of a review:

- **Ideal 11 (zero warnings).** `goose check` runs on all four roots; any line
  containing `warning` fails the gate.
- **Ideal 7 (determinism).** The demo is rendered at 320×240 for 2 frames at
  1, 3, 5 and 8 workers; the four PPMs must be byte-identical.

The remaining ideals are checked by the tests they name (`test_math`,
`test_engine`) or by review; see each ideal's *Check* line.

## How these ideals are used

- When a change is proposed, ask which ideal it serves and which check would
  catch a regression. If neither, the change is probably scope creep.
- When a check fails, re-derive before blaming: the test has been wrong more
  often than the code (ideal 4).
- When performance is on the table, measure first (ideal 6) and keep the
  reference exact (ideal 5).
- When in doubt about scope, choose the smallest version that meets the goal
  (ideal 16) and name the choices made.

## Violations caught so far

- **Ideal 4 (×3).** Three hand-derived expectations were wrong on first run;
  the engine was right each time. Recorded in `README.md` and the testing skill.
- **Ideal 6.** Front-to-back sort, reciprocal-multiply and SIMD were all
  considered and either rejected with numbers or deferred. Recorded in
  `docs/performance.md`.
- **Ideal 7.** Equal contiguous thread bands reached only 3.1× vs 4.65× for
  8-row blocks; recorded as the reason threading uses dynamic claim.
- **Ideal 9.** `DrawItem.depth` was removed (172 → 168 bytes) once nothing
  read it; the sort key already encoded the order.
- **Ideal 17.** `platform/g3_input.{h,c}` was extracted only after both
  backends had grown identical copies.
