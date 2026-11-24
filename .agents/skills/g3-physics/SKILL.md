---
name: g3-physics
description: Use when working with goose-3d physics — the g3.physics rigid-body solver (oriented box/sphere/capsule bodies, rotation and angular dynamics, kinematic mode, sleeping, contacts, raycasts), the g3.rapier RapierPhysics-style facade, the g3_phys_* wasm exports, or the gs3d/physics JS PhysicsWorld.
---

# Physics in goose-3d

Three layers over one rigid-body solver, with full rotation and angular
dynamics (one collider per body):

| Layer | Where | Audience |
|---|---|---|
| `g3.physics` | `src/g3/physics.goose` | native Goose code |
| `g3.rapier` | `src/g3/rapier.goose` | RapierPhysics-flavoured Goose code |
| `gs3d/physics` | `web/physics.js` + `physics_web.goose` exports | browser JS / `gs3d` package |

## Core model

- Bodies attach to **scene node indices**. The collider center is the node's
  position; `physics_step(dt)` writes body `pos` **and** `rot` back onto
  nodes at the end of the step (static bodies keep their node rotation).
  Step physics *before* `frame(dt)`.
- Nodes flagged `use_local_matrix` (asset/facade/glTF imports) have no
  meaningful `pos`/`rot` — `physics_node_pose` decomposes `local_matrix`
  into position/rotation/scale instead, and the step writes a rebuilt
  affine matrix back with scale preserved. This is what makes
  `gs3d/physics` work on `gs3d/three` objects at all.
- Orientation is a `Mat4` rotation internally, exposed as **euler radians
  in the node convention** (`mat4_rotate_euler`: Z then Y then X — same as
  `Node.rot`). `physics_body_euler(id)` reads it back;
  `physics_body_sync(id)` re-captures it from `node.rot`.
- Shapes: oriented **box** (15-axis SAT), **sphere**, **capsule** — the
  capsule axis is the body's **local Y** (`physics_body_add_capsule(node,
  radius, half_length, mass)`).
- `mass == 0` → static. `mass > 0` → dynamic: semi-implicit Euler with
  gravity `(0,-9.81,0)` default, per-step `force`/`torque` (cleared each
  step), restitution and friction in `[0,1]` (min / geometric mean).
- Angular state: `angular_velocity` (world frame, rad/s), diagonal
  inverse inertia in body axes (`physics_shape_inertia`), torque →
  angular acceleration through `R * diag(ii) * Rᵀ`, orientation integrated
  by Rodrigues rotation of the basis columns.
- `physics_step(dt)` accepts `(0, 1]` s; substeps are ≤ 1/60 s and shrink
  when a fast body would cross a quarter of the smallest collider feature
  per substep (max 12 substeps). `dt <= 0` or `> 1` is ignored.
- **Sleeping**: dynamic bodies sleep after ~0.5 s under
  `|v| < 0.1`, `|ω| < 0.2` — evaluated **after** the contact solve on
  post-impulse velocities (checking earlier always sees the gravity added
  that substep and nothing ever sleeps). Contacts with approach speed
  > 0.1 wake them, as do `set_velocity`/`set_angvel`/impulses/torque/forces.
  Sleeping bodies are immovable in contacts.

## Body lifecycle

- `physics_body_add*` returns a body **id** (arena index) or `-1`.
- `physics_body_remove(id)` **tombstones** the slot — ids stay valid for
  lookups but the body stops integrating/colliding. `physics_clear()`
  frees every slot.
- `physics_body_count()` counts slots **including** tombstones.
- `physics_body_set_mass(id, mass)` re-derives inverse mass **and**
  inverse inertia; `0` makes the body static again.
- `physics_body_sync(id)` copies the node's `pos` **and** `rot` into the
  body. **Call it after moving/rotating a node directly** — otherwise the
  next `physics_step` writes the stale transform back.

## Kinematic bodies

`physics_body_set_kinematic(id, true)` makes a body follow `velocity`
and `angular_velocity` exactly — no gravity, forces, torques or impulses —
but it still pushes dynamic bodies. Use for moving platforms, spinning
obstacles, character controllers.

## Angular API

- `physics_apply_torque(id, torque)` — world-frame, one step.
- `physics_body_apply_impulse_at(id, impulse, point)` — linear + angular
  impulse (`r × J` through the inertia tensor).
- `physics_body_set_angvel(id, w)` / `physics_body_angvel(id)`.
- `physics_body_set_kinematic` also gates `inverse_inertia` — kinematic
  and static bodies never rotate under impulses.

## Queries

- **Contacts**: `physics_contact_count()` / `physics_contact(i)` →
  `BodyContact { a, b, normal, point, penetration }` — one entry per
  substep pair overlap, cleared each step. Manifold pairs report their
  deepest point; `point` is the world-space contact point used for
  angular response.
- **Raycast**: `physics_raycast(origin, dir, max_dist)` → `PhysicsRayHit
  { hit, body, point, normal, distance }`, nearest hit, `dir` need not be
  normalized. Box rays run in the box's local frame; capsule rays reuse
  segment closest-point and are approximate for grazing angles. Rays
  starting inside report `distance == 0`.

## Solver notes / limitations

- Contacts solve with **sequential impulses**: detection runs once per
  substep into `g_physics_solver`, warm-started impulses from the previous
  substep are applied once up front (normal impulse only, keyed by
  `(a, b, slot)` in an open-addressed hash — friction seeds are skipped
  because the tangent is recomputed each substep), then
  `PHYSICS_SOLVER_ITERATIONS` (12) Gauss-Seidel passes accumulate the
  normal impulse (clamped ≥ 0, biased toward the restitution target only
  for impacts faster than 1 m/s) and a friction impulse clamped to
  `mu * lambda_n`, with an early-out once deltas converge. One
  positional-correction pass runs afterward; each manifold point carries
  an equal share (`penetration / count`) so multi-point contacts don't
  over-separate.
- **Box-box contacts are manifolds**: when the least-penetration SAT axis
  is a face axis, the incident box's contact face is clipped against the
  reference face rectangle (Sutherland–Hodgman, up to 8 points) and every
  clipped point becomes its own solver contact — this is what lets stacks
  resist tipping. Edge/vertex SAT winners and all non-box pairs keep a
  single point. Manifold points are sorted by reference-face coordinates
  so the same physical corner keeps the same warm-start slot.
- **Friction is applied linearly only** —
  a lone contact point cannot balance the torque friction below the center
  of mass would create, so friction-induced tipping/rolling is suppressed
  on purpose. Normal impulses keep full angular response, so edge hits
  still rotate bodies.
- Capsule inertia approximates the shape as a solid cylinder (caps
  ignored); box/sphere inertia is exact for the collider shape.
- Euler write-back can hit gimbal lock at pitch ≈ ±90° — extraction
  returns an equivalent rotation (yaw zeroed), so the *matrix* is
  preserved even when the angles differ.
- Angular response runs against a cached **world-space inverse inertia
  tensor** (`inv_inertia_world` = R·diag(ii)·Rᵀ), refreshed once per substep
  after integration — one mat-vec per impulse instead of two basis
  transforms. Bounds refresh and the tensor refresh share one fused
  O(n) pass after integration; sleeping bodies are skipped in both.
- Broadphase is a per-substep **sweep-and-prune along x**: live bodies are
  sorted by AABB min-x (`bounds` is refreshed every substep) and only
  x-overlapping pairs reach `physics_detect_pair`, which still rejects on
  y/z bounds and skips pairs where neither side can move. Pairs are no
  longer visited in id order — contact resolution order follows the
  sorted sweep, which is deterministic but not id-ordered.
- Still no sleeping islands, no joints/constraints, no collider lists,
  and only one friction direction per contact. Very slender stacks can
  still topple — treat tall perfect towers as beyond the stable envelope.
  `src/benchmark_physics.goose` (separated bodies, broadphase) and
  `src/benchmark_physics_stack.goose` (active contact pile) measure the
  solver headlessly.

## Rapier facade (`g3.rapier`)

RapierPhysics vocabulary: `rapier_set_timestep` + `rapier_world_step`,
`rapier_body_add_cuboid/ball/capsule`, `rapier_body_translation/linvel/
angvel/rotation` accessors, `rapier_body_set_translation` (teleports,
zeroes velocity), `rapier_body_set_rotation` (euler teleport, zeroes
angvel), `rapier_body_apply_impulse`, `rapier_body_apply_impulse_at`,
`rapier_body_add_torque`, `rapier_body_set_linvel/set_angvel`,
`rapier_body_is_dynamic`, `rapier_body_set_kinematic/is_kinematic`,
`rapier_body_set_mass`, `rapier_body_remove`, `rapier_body_sync`,
`rapier_world_raycast`, `rapier_body_set_restitution/set_friction`,
`rapier_set_gravity`, `rapier_world_clear`.

## JS side (`gs3d/physics`)

`PhysicsWorld` wraps the `g3_phys_*` wasm exports (gs3d host build only —
`./build_web.sh --gs3d`): `addCuboid/addBall/addCapsule`, `step()`,
`translation/setTranslation`, `linvel/setLinvel`, `angvel/setAngvel`,
`rotation/setRotation`, `applyImpulse`, `applyImpulseAtPoint`,
`addTorque`, `setRestitution/setFriction`, `setKinematic/isKinematic`,
`setMass`, `removeBody`, `syncFromNode`, `contacts()` →
`{a, b, normal, point, penetration}`, `raycast(origin, dir, maxDist?)` →
`{body, distance, point, normal} | null`. Bodies are engine node indices —
copy `translation()`/`rotation()` back to your objects yourself.

With the `gs3d/three` facade, `engineNodeIndex(object)` (exported from
`gs3d/three`) returns the node index an object synced to during `render()`
(-1 until the first render, and -1 for lights/cameras). Nodes exist only
after render, so defer `addBall`/`addCuboid`/`addCapsule` by a frame, keep
physics objects as direct scene children (parent transforms are not part of
the solver), and write rotation back as `object.rotation.set(x, y, z,
'ZYX')` — engine euler (Z then Y then X) matches three's 'ZYX' order.
`samples/physics/src/physics.ts` is the reference wiring.

## Gotchas

- The `let c = g3::camera()` copy trap applies here too: `physics_body(id)`
  returns `PhysicsBody&`; bind with `.=` before writing, `=` copies.
- `PhysicsBody` fields `mass`/`inverse_mass` have no defaults — literals
  must set them (only `physics_body_add_shape` constructs bodies).
- `pad` is a reserved word in Goose — don't use it as an identifier.
- `if` expressions need parens inside arithmetic: `he.x * (if c {..} else
  {..})`.
- `physics_contact` writes **9** floats on the wasm side
  (`[a, b, nx, ny, nz, px, py, pz, penetration]`) — keep `SCRATCH_FLOATS`
  ≥ 9 in JS.
- **Slice ABI**: a Goose `f32[:]` parameter lowers to a pointer to a
  16-byte `sl_f32` header in wasm memory — `{ float* data @0, i64 len @8 }`
  — passed as ONE i32 argument, not `(ptr, len)`. `PhysicsWorld._sliceArg()`
  writes that header before every read-back call (`pos`, `vel`, `angvel`,
  `rot`, `contact`, `raycast`). Passing the data pointer and length as
  separate JS args reads `data`/`len` out of the scratch buffer itself and
  crashes with `memory access out of bounds`. Same trap applies to every
  other slice export (`g3_asset_*`, `g3_host_*` shader/texture uploads) if
  you ever call them from JS.

## Verify

- `goose check src/test_siege.goose` — typechecks the module graph.
- `./build_native.sh --test` — builds and runs all roots; `test_siege`
  holds the hand-derived physics checks (currently 77).
- `./build_web.sh --gs3d` — rebuilds `web/gs3d/app.js`/`app.wasm`; new
  `g3_phys_*` exports must also be added to the `phys_exports` list in
  `build_web.sh` or they won't be callable from JS.
- `cd web && node ./test_physics.mjs` — JS-side package checks.
