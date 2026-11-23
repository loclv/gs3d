---
name: g3-physics
description: Use when working with goose-3d physics — the g3.physics solver (box/sphere/capsule bodies, kinematic mode, contacts, raycasts), the g3.rapier RapierPhysics-style facade, the g3_phys_* wasm exports, or the gs3d/physics JS PhysicsWorld.
---

# Physics in goose-3d

Three layers over one solver, all translation-only (no rotation, angular
velocity or torque; one collider per body):

| Layer | Where | Audience |
|---|---|---|
| `g3.physics` | `src/g3/physics.goose` | native Goose code |
| `g3.rapier` | `src/g3/rapier.goose` | RapierPhysics-flavoured Goose code |
| `gs3d/physics` | `web/physics.js` + `physics_web.goose` exports | browser JS / `gs3d` package |

## Core model

- Bodies attach to **scene node indices**. The collider center is the node's
  `pos`; `physics_step(dt)` writes body positions back onto nodes at the end
  of the step. Step physics *before* `frame(dt)`.
- Shapes: axis-aligned **box** (`physics_body_add`), **sphere**
  (`physics_body_add_sphere`), **capsule** (`physics_body_add_capsule`,
  Y-axis, `radius` + `half_length`).
- `mass == 0` → static (immovable). `mass > 0` → dynamic: semi-implicit
  Euler, gravity `(0,-9.81,0)` default (`physics_set_gravity`), one-step
  forces (`physics_apply_force`, cleared each step), restitution and
  friction in `[0,1]` (pair values combine as min / geometric mean).
- `physics_step(dt)` accepts `(0, 1]` seconds and internally substeps at
  ≤ 1/60 s. `dt <= 0` or `> 1` is silently ignored.

## Body lifecycle

- `physics_body_add*` returns a body **id** (an index into
  `g_physics_bodies`), or `-1` on bad arguments.
- `physics_body_remove(id)` **tombstones** the slot — the id stays valid for
  lookups but the body no longer integrates, collides or answers queries.
  Ids are never renumbered; `physics_clear()` frees every slot. Same
  convention as `material_remove`/`camera_remove`.
- `physics_body_count()` counts slots **including** tombstones.
- `physics_body_set_mass(id, mass)` re-derives inverse mass; `0` makes the
  body static again.
- `physics_body_sync(id)` copies the node's current `pos` into the body.
  **Call it after moving a node directly** — otherwise the body keeps its
  own position and the next `physics_step` writes the stale one back over
  the node.

## Kinematic bodies

`physics_body_set_kinematic(id, true)` (Rapier: `rapier_body_set_kinematic`)
makes a body follow `velocity` exactly — no gravity, forces or impulses —
but it still pushes dynamic bodies through contacts and friction. Use for
moving platforms, elevators, character controllers. Its `mass` is kept for
when kinematic mode is switched off. `physics_apply_force` and
`rapier_body_apply_impulse` reject kinematic bodies.

## Queries

- **Contacts**: `physics_contact_count()` / `physics_contact(i)` →
  `BodyContact { a, b, normal, penetration }`, one entry per substep pair
  overlap during the last `physics_step`, cleared at the start of each
  step. `normal` points from body `a` toward body `b`.
- **Raycast**: `physics_raycast(origin, dir, max_dist)` → `PhysicsRayHit
  { hit, body, point, normal, distance }`, nearest hit across all live
  bodies. `dir` need not be normalized. Exact for spheres and boxes; the
  capsule path uses closest-approach and is approximate for grazing rays.
  Rays starting inside a collider report `distance == 0`.

## Rapier facade (`g3.rapier`)

Same solver, RapierPhysics vocabulary: `rapier_set_timestep` +
`rapier_world_step`, `rapier_body_add_cuboid/ball/capsule`,
`rapier_body_translation/linvel/set_linvel/set_translation` (teleports and
zeroes velocity), `rapier_body_apply_impulse`, `rapier_body_is_dynamic`,
`rapier_body_set_kinematic/is_kinematic`, `rapier_body_set_mass`,
`rapier_body_remove`, `rapier_body_sync`, `rapier_world_raycast`,
`rapier_body_set_restitution/set_friction`, `rapier_set_gravity`,
`rapier_world_clear`.

## JS side (`gs3d/physics`)

`PhysicsWorld` wraps the `g3_phys_*` wasm exports (gs3d host build only —
`./build_web.sh --gs3d`): `addCuboid/addBall/addCapsule`, `step()`,
`translation/setTranslation`, `linvel/setLinvel`, `applyImpulse`,
`setRestitution/setFriction`, `setKinematic/isKinematic`, `setMass`,
`removeBody`, `syncFromNode`, `contacts()`, `raycast(origin, dir,
maxDist?)` → `{body, distance, point, normal} | null`. Bodies are engine
node indices, not `Object3D`s — copy `translation()` back yourself.

## Gotchas

- The `let c = g3::camera()` copy trap applies here too: `physics_body(id)`
  returns `PhysicsBody&`; bind with `.=` before writing, `=` copies.
- `PhysicsBody` fields `mass`/`inverse_mass` have no defaults — literals
  must set them (only `physics_body_add_shape` constructs bodies).
- `pad` is a reserved word in Goose — don't use it as an identifier.
- The solver is intentionally simple: no sleeping, no broadphase (O(n²)
  pairs per substep), no angular motion. Fine for dozens of bodies.

## Verify

- `goose check src/test_siege.goose` — typechecks the module graph.
- `./build_native.sh --test` — builds and runs all roots; `test_siege`
  holds the hand-derived physics checks (currently 61).
- `./build_web.sh --gs3d` — rebuilds `web/gs3d/app.js`/`app.wasm`; new
  `g3_phys_*` exports must also be added to the `phys_exports` list in
  `build_web.sh` or they won't be callable from JS.
- `cd web && node ./test_physics.mjs` — JS-side package checks.
