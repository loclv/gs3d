# Physics solver performance

How `g3.physics` keeps per-substep cost proportional to *motion*, not body
count. The solver already had the expensive machinery right — sequential
impulse, warm starting, sweep-and-prune, sleeping — so the wins here are all
about skipping work that cannot change anything.

## The settled-scene fast path

`physics_substep` (`src/g3/physics_solver.goose`) returns `bool`: whether at
least one body could have moved. A body counts as active only if it is
non-sleeping, has a valid node, and is dynamic (`inverse_mass > 0`) or
kinematic — the two branches that integrate position/orientation.

When `any_active` is false — every dynamic body asleep, no live kinematics —
the substep returns before:

- rebuilding `g_physics_order` and sorting it,
- the x-sweep pair loop,
- `physics_solve_contacts` (12 Gauss-Seidel iterations),
- `physics_solve_joints`,
- the sleep-evaluation pass.

All of those are provable no-ops in that state: nothing moved, so no contact
can appear or separate, joint constraints see zero relative motion, and no
awake body exists for sleep evaluation to transition. A fully settled pile
therefore costs **one fused O(n) scan per substep** — the integration/refresh
loop — instead of a sort plus a full solve. This is the common case in games:
a pile at rest, a crowd standing still, a level with only static colliders.

`physics_step` ORs the per-substep results into `step_active` and skips the
node writeback pass when every substep was inactive — body poses (and hence
node transforms) are bit-identical to what the last writeback left. Forces
and torques still reset unconditionally, preserving the existing
"force applied to a sleeper is dropped after one step" semantics.

## Fused integration + refresh pass

Integration, bounds refresh and world-space inverse inertia used to be two
O(n) sweeps per substep. They are now one: every refreshed quantity is a pure
function of the body's *own* post-integration state, so bodies need no
ordering between them. The pass still covers bodies that did not integrate
(static, invalid node) exactly as the old refresh pass did.

## `bounds_dirty` — refresh only what moved

`PhysicsBody.bounds_dirty` (default `true`, so first-step bounds are computed
exactly as before) gates `physics_update_bounds`, the `|R|·he` conservative
AABB math. In the fused pass:

```text
if integrated || body.bounds_dirty {
    physics_update_bounds(body);
    body.bounds_dirty = false;
}
if integrated && body.inverse_mass > 0.0 {
    physics_update_inv_inertia_world(body);
}
```

- **Static colliders** (`inverse_mass == 0`, not kinematic) never integrate,
  so after their first refresh they skip the bounds math entirely — a level
  with hundreds of static boxes pays it once, not per substep.
- **`inv_inertia_world`** only depends on orientation, which only
  `physics_integrate_orientation` changes — so it recomputes only for
  integrated dynamics. Mass/inertia API changes still refresh it directly
  via `physics_refresh_response`.
- **Dirtied by**: `rapier_body_set_translation` (teleport) and
  `physics_body_sync` (node→body pose pull, which can hit static bodies).
  Both set `bounds_dirty = true`; creation defaults it `true`.

## Sort keys

The sweep-and-prune comparator used to evaluate
`bodies[a].position.x - bodies[a].bounds.x` — two struct dereferences and a
subtract — twice per comparison, O(n log n) times per substep. A flat
`g_physics_minx: f32[>]` array is filled in the same pass that builds
`g_physics_order`; the comparator is now a single array load per side.

## Latent bug fixed

`rapier_body_set_translation` teleported `body.position` and the node but
never woke the body. A sleeping body stayed asleep — and sleeping bodies
skip the bounds refresh — so its broadphase AABB stayed at the old location
forever: the teleport was invisible to collision. It now calls
`physics_wake`, matching `physics_body_set_velocity`/`set_angvel`, which
already woke.

## What is deliberately *not* skipped

- **The fused O(n) scan itself** runs every substep even when settled —
  detecting "nothing moved" requires looking at every body once. The
  alternative (a global dirty counter bumped on every mutation path) would
  need write-side hooks on TRS setters, teleports, syncs, joint anchors and
  water level — exactly the kind of invalidation surface where misses cause
  stale-state bugs.
- **Force/torque reset** stays unconditional (semantics, see above).
- **The contact-record purge** at the end of `physics_step` stays
  unconditional — it is O(#contacts), once per step, and keeps `contacts()`
  honest for pairs that separated.

## Measuring

- `src/benchmark_physics.goose` (separated bodies — broadphase-dominated)
  and `src/benchmark_physics_stack.goose` (active contact pile) measure the
  solver headlessly; `docs/performance.md` has the Rapier comparison.
- `./build_native.sh --test` — `test_siege` holds the hand-derived physics
  checks; the PPM byte-identity check catches any stale-state regression.
- The settled-scene win is most visible on the stack benchmark *after* the
  pile sleeps, and on any scene that is mostly static colliders.
