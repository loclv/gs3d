// Sequential-impulse solver and stepping for g3.physics.
//
// physics_step splits the frame into substeps (capped at 1/60 s and
// shrunk for fast bodies), integrates linear and angular motion, refreshes
// bounds and world-space inverse inertia, sweeps candidate pairs along x,
// detects their contacts and solves them with warm-started Gauss-Seidel
// iterations plus one positional-correction pass.

import std;
import vec;
import math;
import g3.math;
import g3.scene;
import g3.physics;

namespace g3;

// Live body indices sorted by AABB min-x each substep — the sweep-and-prune
// broadphase that keeps the pair loop near O(n log n + candidates).
var g_physics_order: i64[>..];

// A contact kept for the iterative solve. Detection runs once per substep;
// then a fixed number of Gauss-Seidel passes refine the impulses. lambda_n
// accumulates the normal impulse (clamped >= 0 — the non-penetration
// constraint) and lambda_t accumulates friction along the tangent captured
// at detection, clamped to mu * lambda_n. bias is the restitution target
// separating speed along the normal.
struct SolverContact {
    a: i64,
    b: i64,
    normal: float3,
    tangent: float3,
    point: float3,
    ra: float3,
    rb: float3,
    penetration: f32,
    im_a: f32,
    im_b: f32,
    bias: f32,
    denom_n: f32,
    // Friction denominator: im_a + im_b, since friction impulses apply
    // linearly only. Zero disables friction for this contact.
    denom_t: f32,
    mu: f32,
    lambda_n: f32 = 0.0,
    lambda_t: f32 = 0.0,
    // Manifold point index within the pair's contact set — part of the
    // warm-start key so each point keeps its own accumulated impulse.
    slot: i64 = 0,
}

var g_physics_solver: SolverContact[>..];

// Scratch manifold reused by every detect_pair call — the solver is
// single-threaded and each pair's contacts are consumed before the next
// pair is processed, so one buffer serves the whole sweep.
var g_physics_manifold = ContactManifold { .. };

// Warm-start table: last substep's accumulated impulses per
// (a, b, slot) contact point, in an open-addressed hash so lookups stay
// O(1) as manifold contacts multiply the solver list. Rebuilt from the
// solver list at the end of every substep, so pairs that stop touching
// drop out on their own. key == 0 marks an empty slot.
// WarmSlot.lambda_t is deliberately absent: friction is not seeded —
// its tangent is recomputed each substep and a stale lambda_t would
// apply along the wrong direction whenever the tangential velocity
// reverses.
struct WarmSlot {
    key: i64 = 0,
    lambda_n: f32 = 0.0,
}

var g_warm_tab: WarmSlot[>..];
var g_warm_mask: i64 = 0;

// Keys canonicalize the pair order: the sweep visits pairs in AABB
// order, which can flip between substeps, and a flipped visit must still
// find the same accumulated impulse.
fn physics_warm_key(a: i64, b: i64, slot: i64) -> i64 {
    let lo = min(a, b);
    let hi = max(a, b);
    return lo * 68719476736 + hi * 16 + slot + 1;
}

fn physics_warm_slot(a: i64, b: i64, slot: i64, cap: i64) -> i64 {
    let lo = min(a, b);
    let hi = max(a, b);
    var h = (lo * 31 + hi) * 31 + slot;
    h = (h * 2654435761) % cap;
    return h;
}

fn physics_warm_lookup(a: i64, b: i64, slot: i64) -> f32 {
    if g_warm_mask <= 0 { return 0.0; }
    let cap = g_warm_mask + 1;
    let key = physics_warm_key(a, b, slot);
    var idx = physics_warm_slot(a, b, slot, cap);
    for _ in 0..cap {
        let w = g_warm_tab[idx];
        if w.key == 0 { return 0.0; }
        if w.key == key { return w.lambda_n; }
        idx = (idx + 1) % cap;
    }
    return 0.0;
}

// Velocity iterations per substep. Each pass re-solves every contact
// against the velocities the previous pass produced, which is what makes
// stacked bodies share load instead of popping in pair order.
const PHYSICS_SOLVER_ITERATIONS: i32 = 12;

// Advance the simulation by seconds. Substeps are capped at 1/60 second
// and shrink further when a fast body would move more than a quarter of
// the smallest collider feature per substep, which is what actually
// prevents tunneling. At most 12 substeps run per call. Inputs above one
// second are rejected to bound work after a long pause.
fn physics_step(dt: f32) {
    guard dt > 0.0 && dt <= 1.0 else { return; }
    let sub_dt = physics_substep_dt(dt);
    var remaining = dt;
    var steps = 0;
    while remaining > 0.0000001 && steps < 12 {
        let h = min(remaining, sub_dt);
        physics_substep(h);
        remaining -= h;
        steps += 1;
    }

    // Drop contact records whose pair no longer overlaps. Pairs that
    // separated during the step were skipped by the broadphase before
    // any detection ran, so their records would otherwise linger —
    // contacts() must only report pairs touching at the end of the step.
    // O(#contacts) once per step, versus a hash probe per rejected pair
    // per substep.
    var pi: i64 = 0;
    while pi < g_physics_contacts.len {
        let c = g_physics_contacts[pi];
        let ba .= g_physics_bodies[c.a];
        let bb .= g_physics_bodies[c.b];
        var stale = ba.removed || bb.removed ||
            !node_handle_valid(ba.node) || !node_handle_valid(bb.node);
        if !stale {
            let dd = bb.position - ba.position;
            stale = abs(dd.x) > ba.bounds.x + bb.bounds.x ||
                    abs(dd.y) > ba.bounds.y + bb.bounds.y ||
                    abs(dd.z) > ba.bounds.z + bb.bounds.z;
        }
        if stale { physics_contact_forget(c.pkey); }
        else { pi += 1; }
    }

    for &body in g_physics_bodies { body.force = float3_0; body.torque = float3_0; }
    for &body in g_physics_bodies {
        if !node_handle_valid(body.node) { continue; }
        let nref .= node(body.node.index);
        if nref.use_local_matrix {
            // Matrix-driven nodes (asset/facade imports) get a rebuilt
            // affine transform; scale is preserved from the current matrix.
            let pose = physics_node_pose(nref);
            physics_write_local_matrix(nref, body.position, body.orientation, pose.scale);
            continue;
        }
        nref.pos = body.position;
        // Static bodies keep whatever rotation their node was given; the
        // collider's orientation was captured at creation and only moves
        // for bodies the solver drives.
        if body.inverse_mass > 0.0 || body.kinematic {
            nref.rot = physics_mat_to_euler(body.orientation);
        }
    }
}

// The substep size for this frame: 1/60 s normally, smaller while any
// dynamic body would cross a meaningful fraction of the smallest collider
// in one substep. Angular tip speed counts toward the sweep.
fn physics_substep_dt(dt: f32) -> f32 {
    var max_speed: f32 = 0.0;
    var min_size: f32 = 3.0e38;
    for &body in g_physics_bodies {
        if body.removed || body.sleeping || body.inverse_mass <= 0.0 { continue; }
        let size = if body.radius > 0.0 { body.radius } else {
            min(body.half_extents.x, min(body.half_extents.y, body.half_extents.z))
        };
        min_size = min(min_size, size);
        let tip = length(body.angular_velocity) * size * 0.5;
        max_speed = max(max_speed, length(body.velocity) + tip);
    }
    if max_speed <= 0.0 || min_size >= 3.0e38 { return min(dt, 1.0 / 60.0); }
    // Allow at most half a feature of travel per substep — still under
    // the smallest collider's full width, so nothing can tunnel —
    // clamped to a sane range so a tiny collider cannot force unbounded
    // substeps.
    let needed = min_size / (2.0 * max_speed);
    return min(dt, clamp(needed, 1.0 / 480.0, 1.0 / 60.0));
}

fn physics_substep(dt: f32) {
    for &body in g_physics_bodies {
        if body.removed || body.sleeping || !node_handle_valid(body.node) { continue; }
        if body.inverse_mass > 0.0 {
            body.velocity += (g_physics_gravity + body.force * body.inverse_mass) * dt;
            body.angular_velocity += physics_torque_to_angacc(body) * dt;
            if g_physics_water_y > -1.0e29 { physics_apply_water(body, dt); }
            body.position += body.velocity * dt;
            physics_integrate_orientation(body, dt);
        } else if body.kinematic {
            body.position += body.velocity * dt;
            physics_integrate_orientation(body, dt);
        }
    }

    // Refresh world-space inverse inertia and broadphase bounds in one
    // pass — orientation and position changed during integration, and
    // both are only consumed by the sweep below. Sleeping bodies are
    // frozen, so theirs cannot have changed since they slept; static and
    // kinematic bodies keep a zero inertia tensor already.
    for &body in g_physics_bodies {
        if body.removed || body.sleeping { continue; }
        physics_update_bounds(body);
        if body.inverse_mass > 0.0 { physics_update_inv_inertia_world(body); }
    }

    // Sweep and prune along x: sort live bodies by AABB min-x once per
    // substep, then only pairs whose x intervals overlap reach
    // physics_resolve_pair (which still AABB-rejects on y and z).
    g_physics_order.clear();
    for i in 0..g_physics_bodies.len {
        if !g_physics_bodies[i].removed { g_physics_order.push(i); }
    }
    sort(g_physics_order) { a, b =>
        (g_physics_bodies[a].position.x - g_physics_bodies[a].bounds.x) <
        (g_physics_bodies[b].position.x - g_physics_bodies[b].bounds.x)
    };
    for ii in 0..g_physics_order.len {
        let i = g_physics_order[ii];
        let a .= g_physics_bodies[i];
        let xmax = a.position.x + a.bounds.x;
        var jj = ii + 1;
        while jj < g_physics_order.len {
            let j = g_physics_order[jj];
            if g_physics_bodies[j].position.x - g_physics_bodies[j].bounds.x > xmax { break; }
            physics_detect_pair(i, j);
            jj += 1;
        }
    }
    physics_solve_contacts();

    // Sleep evaluation runs after the solve, on post-impulse velocities —
    // checking before contacts would always see the gravity added this
    // substep and nothing would ever fall asleep.
    for &body in g_physics_bodies {
        if body.removed || body.sleeping || body.inverse_mass <= 0.0 { continue; }
        if length(body.velocity) < 0.1 && length(body.angular_velocity) < 0.2 {
            body.sleep_timer += dt;
            if body.sleep_timer > 0.5 {
                body.sleeping = true;
                body.velocity = float3_0;
                body.angular_velocity = float3_0;
            }
        } else {
            body.sleep_timer = 0.0;
        }
    }
}

// Angular acceleration from the accumulated world-frame torque through
// the world-space inverse inertia tensor.
fn physics_torque_to_angacc(b: PhysicsBody&) -> float3 {
    let t = b.torque;
    let w = b.inv_inertia_world;
    return float3 {
        w[0].x * t.x + w[0].y * t.y + w[0].z * t.z,
        w[1].x * t.x + w[1].y * t.y + w[1].z * t.z,
        w[2].x * t.x + w[2].y * t.y + w[2].z * t.z,
    };
}

// Angular velocity change from an impulse applied at world offset `r`
// from the center: torque impulse r x impulse through the world-space
// inverse inertia tensor.
fn physics_apply_ang_impulse(b: PhysicsBody&, impulse: float3, r: float3) {
    let ii = b.inverse_inertia;
    if b.sleeping || (ii.x == 0.0 && ii.y == 0.0 && ii.z == 0.0) { return; }
    let t = cross(r, impulse);
    let w = b.inv_inertia_world;
    b.angular_velocity += float3 {
        w[0].x * t.x + w[0].y * t.y + w[0].z * t.z,
        w[1].x * t.x + w[1].y * t.y + w[1].z * t.z,
        w[2].x * t.x + w[2].y * t.y + w[2].z * t.z,
    };
}

// Advance the orientation by angular_velocity * dt. The increment is a
// world-frame rotation exp([w]dt) applied to each basis column via
// Rodrigues' formula, which keeps the basis exactly orthonormal.
fn physics_integrate_orientation(b: PhysicsBody&, dt: f32) {
    let w = b.angular_velocity * dt;
    let angle = length(w);
    if angle < 0.000001 { return; }
    let axis = w / angle;
    let c = cos(angle);
    let s = sin(angle);
    let C = 1.0 - c;
    for col in 0..3 {
        var v: float3;
        if col == 0 { v = float3 { b.orientation.m[0], b.orientation.m[1], b.orientation.m[2] }; }
        else if col == 1 { v = float3 { b.orientation.m[4], b.orientation.m[5], b.orientation.m[6] }; }
        else { v = float3 { b.orientation.m[8], b.orientation.m[9], b.orientation.m[10] }; }
        let rv = v * c + cross(axis, v) * s + axis * (dot(axis, v) * C);
        if col == 0 { b.orientation.m[0] = rv.x; b.orientation.m[1] = rv.y; b.orientation.m[2] = rv.z; }
        else if col == 1 { b.orientation.m[4] = rv.x; b.orientation.m[5] = rv.y; b.orientation.m[6] = rv.z; }
        else { b.orientation.m[8] = rv.x; b.orientation.m[9] = rv.y; b.orientation.m[10] = rv.z; }
    }
}

// Angular velocity change per unit impulse along `dir` applied at world
// offset `r` from the body's center, through its world-space inverse
// inertia tensor (zero for static, kinematic and sleeping bodies, which
// are immovable in rotation).
fn physics_ang_response(b: PhysicsBody&, r: float3, dir: float3) -> float3 {
    if b.sleeping { return float3_0; }
    let t = cross(r, dir);
    let w = b.inv_inertia_world;
    return float3 {
        w[0].x * t.x + w[0].y * t.y + w[0].z * t.z,
        w[1].x * t.x + w[1].y * t.y + w[1].z * t.z,
        w[2].x * t.x + w[2].y * t.y + w[2].z * t.z,
    };
}

// Effective inverse mass for an impulse along `dir` at contact offsets
// ra/rb: linear plus the angular leverage term n·((I⁻¹(r×dir))×r).
fn physics_contact_denominator(a: PhysicsBody&, b: PhysicsBody&, dir: float3,
                               ra: float3, rb: float3,
                               im_a: f32, im_b: f32) -> f32 {
    var denom = im_a + im_b;
    denom += dot(cross(physics_ang_response(a, ra, dir), ra), dir);
    denom += dot(cross(physics_ang_response(b, rb, dir), rb), dir);
    return denom;
}

// Linear part of a contact impulse: -j on a, +j on b through inverse mass.
fn physics_apply_linear_impulse(a: PhysicsBody&, b: PhysicsBody&, j: float3,
                                im_a: f32, im_b: f32) {
    a.velocity -= j * im_a;
    b.velocity += j * im_b;
}

// Normal contact impulse: linear through inverse mass plus angular through
// the inertia tensor via r x j. Sleeping and immovable bodies are skipped
// inside physics_apply_ang_impulse, matching their zero inverse mass.
fn physics_apply_normal_impulse(a: PhysicsBody&, b: PhysicsBody&, j: float3,
                                ra: float3, rb: float3, im_a: f32, im_b: f32) {
    physics_apply_linear_impulse(a, b, j, im_a, im_b);
    physics_apply_ang_impulse(a, float3 { -j.x, -j.y, -j.z }, ra);
    physics_apply_ang_impulse(b, j, rb);
}

// Velocity of a point fixed to the body at world offset `r` from its
// center: linear plus omega x r.
fn physics_point_velocity(b: PhysicsBody&, r: float3) -> float3 {
    return b.velocity + cross(b.angular_velocity, r);
}

// Broadphase and contact detection for one candidate pair. Records the
// contact for queries and, when the pair can actually move, appends a
// SolverContact for the iterative pass that runs after the sweep.
fn physics_detect_pair(a_id: i64, b_id: i64) {
    let a .= g_physics_bodies[a_id];
    let b .= g_physics_bodies[b_id];
    // Canonical unordered-pair key for the persistent contact store.
    let lo = min(a_id, b_id);
    let hi = max(a_id, b_id);
    let pkey = lo * 68719476736 + hi + 1;
    if a.removed || b.removed { return; }
    if !node_handle_valid(a.node) || !node_handle_valid(b.node) {
        physics_contact_forget(pkey);
        return;
    }

    // Broadphase: world-AABB reject before any contact math. No forget
    // here — separated pairs are cheap to skip, and any stale record is
    // dropped by the once-per-step purge at the end of physics_step.
    let d = b.position - a.position;
    if abs(d.x) > a.bounds.x + b.bounds.x ||
       abs(d.y) > a.bounds.y + b.bounds.y ||
       abs(d.z) > a.bounds.z + b.bounds.z { return; }

    // Cheap reject: a pair where neither side is a dynamic body — awake
    // or asleep; sleeping keeps inverse_mass — and no kinematic body is
    // moving can never produce an observable contact, and can never have
    // produced a record.
    let kin_a = a.kinematic && length(a.velocity) > 0.0001;
    let kin_b = b.kinematic && length(b.velocity) > 0.0001;
    if a.inverse_mass <= 0.0 && b.inverse_mass <= 0.0 && !kin_a && !kin_b { return; }

    // Both asleep: their poses are frozen, so an existing contact record
    // is still exact — skip detection entirely. This is what keeps fully
    // settled scenes at sleep-fast-path speed while contacts() still
    // reports their resting overlaps.
    if a.sleeping && b.sleeping && physics_contact_slot_find(pkey) >= 0 { return; }

    physics_contact_manifold(a, b, g_physics_manifold);
    if g_physics_manifold.count == 0 {
        physics_contact_forget(pkey);
        return;
    }
    let normal = g_physics_manifold.normal;

    // A real impact at any manifold point wakes sleepers; resting contacts
    // below the threshold leave them asleep and immovable.
    for k in 0..g_physics_manifold.count {
        let p = g_physics_manifold.points[k];
        let ra = p - a.position;
        let rb = p - b.position;
        let vrel = physics_point_velocity(b, rb) - physics_point_velocity(a, ra);
        if dot(vrel, normal) < -0.1 {
            physics_wake(a);
            physics_wake(b);
        }
    }

    let im_a = if a.sleeping { 0.0 } else { a.inverse_mass };
    let im_b = if b.sleeping { 0.0 } else { b.inverse_mass };

    // Contact query reports the deepest manifold point. The record is
    // kept even when neither side can move this substep — asleep pairs
    // and bodies at rest on static or kinematic geometry still touch —
    // so contacts() does not flicker and collision events do not report
    // spurious stops for pairs that are still overlapping.
    var deepest = 0;
    for k in 1..g_physics_manifold.count {
        if g_physics_manifold.penetrations[k] > g_physics_manifold.penetrations[deepest] {
            deepest = k;
        }
    }
    physics_contact_record(pkey, BodyContact { a: a_id, b: b_id, normal: normal,
        point: g_physics_manifold.points[deepest],
        penetration: g_physics_manifold.penetrations[deepest],
        pkey: pkey });

    if im_a + im_b <= 0.0 { return; }

    let e = min(a.restitution, b.restitution);
    for k in 0..g_physics_manifold.count {
        let point = g_physics_manifold.points[k];
        let ra = point - a.position;
        let rb = point - b.position;
        let vrel = physics_point_velocity(b, rb) - physics_point_velocity(a, ra);
        let vn = dot(vrel, normal);

        let denom_n = physics_contact_denominator(a, b, normal, ra, rb,
                                                  im_a, im_b);
        if denom_n <= 0.0 { continue; }

        // Restitution bias: the target separating speed along the normal,
        // applied only to impacts fast enough to bounce — resting and slow
        // contacts solve toward zero approach instead.
        let bias = if vn < -1.0 { -e * vn } else { 0.0 };

        // Friction direction is the tangential part of the relative surface
        // velocity at this point, fixed for the whole solve. Its
        // denominator is the linear effective mass only — friction impulses
        // apply without angular response.
        let vt = vrel - normal * vn;
        var tangent = float3_0;
        var denom_t: f32 = 0.0;
        let vt_len = length(vt);
        if vt_len > 0.001 {
            tangent = vt / vt_len;
            denom_t = im_a + im_b;
        }

        // Warm start: seed the accumulated normal impulse from the
        // previous substep's solve for the same contact point. Friction
        // is not seeded — its tangent is recomputed each substep and a
        // stale lambda_t would apply along the wrong direction whenever
        // the tangential velocity reverses.
        let seed_n = physics_warm_lookup(a_id, b_id, k);

        g_physics_solver.push(SolverContact {
            a: a_id, b: b_id,
            normal: normal, tangent: tangent, point: point,
            ra: ra, rb: rb,
            // Each manifold point carries an equal share of the positional
            // correction — summing full-depth pushes per point would
            // over-separate the pair every substep.
            penetration: g_physics_manifold.penetrations[k] / g_physics_manifold.count,
            im_a: im_a, im_b: im_b,
            bias: bias, denom_n: denom_n, denom_t: denom_t,
            mu: sqrt(a.friction * b.friction),
            lambda_n: seed_n, lambda_t: 0.0, slot: k,
        });
    }
}

// Sequential-impulse solve over the contacts detected this substep.
// lambda_n accumulates the normal impulse clamped at zero — contacts can
// push bodies apart but never pull them together — and lambda_t accumulates
// friction bounded by mu * lambda_n, so the tangential force a contact can
// apply scales with the load pressing it together.
fn physics_solve_contacts() {
    // Warm start: lambda_n/lambda_t were seeded from last substep's solve;
    // apply them once up front so the iterations refine a consistent
    // velocity field instead of rebuilding contact load from zero.
    for i in 0..g_physics_solver.len {
        let c = g_physics_solver[i];
        if c.lambda_n == 0.0 && c.lambda_t == 0.0 { continue; }
        let a .= g_physics_bodies[c.a];
        let b .= g_physics_bodies[c.b];
        if c.lambda_n != 0.0 {
            physics_apply_normal_impulse(a, b, c.normal * c.lambda_n,
                                         c.ra, c.rb, c.im_a, c.im_b);
        }

    }

    for _ in 0..PHYSICS_SOLVER_ITERATIONS {
        // Converged scenes — resting stacks, settled piles — stop early
        // once no impulse changes by a meaningful amount.
        var max_delta: f32 = 0.0;
        for i in 0..g_physics_solver.len {
            let c .= g_physics_solver[i];
            let a .= g_physics_bodies[c.a];
            let b .= g_physics_bodies[c.b];

            // Normal: drive the approach speed toward the restitution bias.
            let vrel = physics_point_velocity(b, c.rb) - physics_point_velocity(a, c.ra);
            let vn = dot(vrel, c.normal);
            let dl = (c.bias - vn) / c.denom_n;
            let new_n = max(c.lambda_n + dl, 0.0);
            let delta_n = new_n - c.lambda_n;
            if delta_n != 0.0 {
                physics_apply_normal_impulse(a, b, c.normal * delta_n, c.ra, c.rb,
                                             c.im_a, c.im_b);
                c.lambda_n = new_n;
                max_delta = max(max_delta, abs(delta_n));
            }

            // Friction along the stored tangent, bounded by the accumulated
            // normal impulse — unloaded contacts cannot grip. Applied
            // linearly only: a single contact point cannot balance the
            // torque friction below the center of mass would create, and
            // lets resting bodies tip or roll without bound. Normal
            // impulses keep the full angular response, so edge hits still
            // rotate bodies.
            if c.denom_t > 0.0 {
                // Reuse vrel when the normal solve changed nothing; only a
                // real normal impulse alters the point velocities.
                let vrel2 = if delta_n != 0.0 {
                    physics_point_velocity(b, c.rb) - physics_point_velocity(a, c.ra)
                } else { vrel };
                let dl_t = -dot(vrel2, c.tangent) / c.denom_t;
                let max_t = c.mu * c.lambda_n;
                let new_t = clamp(c.lambda_t + dl_t, -max_t, max_t);
                let delta_t = new_t - c.lambda_t;
                if delta_t != 0.0 {
                    physics_apply_linear_impulse(a, b, c.tangent * delta_t,
                                                 c.im_a, c.im_b);
                    c.lambda_t = new_t;
                    max_delta = max(max_delta, abs(delta_t));
                }
            }
        }
        if max_delta < 0.01 { break; }
    }

    // Positional correction once, after the velocity solve: move bodies
    // apart along the normal weighted by inverse mass, with a small slop
    // to avoid repeatedly correcting floating-point contact jitter.
    for i in 0..g_physics_solver.len {
        let c .= g_physics_solver[i];
        let denom = c.im_a + c.im_b;
        if denom <= 0.0 { continue; }
        let push = c.normal * (max(c.penetration - 0.001, 0.0) * 0.8 / denom);
        if c.im_a > 0.0 { g_physics_bodies[c.a].position -= push * c.im_a; }
        if c.im_b > 0.0 { g_physics_bodies[c.b].position += push * c.im_b; }
    }

    // Carry the converged impulses into the next substep's warm start, in
    // an open-addressed table keyed by (a, b, slot) for O(1) lookups.
    g_warm_tab.clear();
    var cap: i64 = 16;
    while cap < g_physics_solver.len * 2 { cap *= 2; }
    for _ in 0..cap { g_warm_tab.push(WarmSlot { .. }); }
    g_warm_mask = cap - 1;
    for i in 0..g_physics_solver.len {
        let c = g_physics_solver[i];
        let key = physics_warm_key(c.a, c.b, c.slot);
        var idx = physics_warm_slot(c.a, c.b, c.slot, cap);
        while g_warm_tab[idx].key != 0 { idx = (idx + 1) % cap; }
        g_warm_tab[idx].key = key;
        g_warm_tab[idx].lambda_n = c.lambda_n;
    }
    g_physics_solver.clear();
}
