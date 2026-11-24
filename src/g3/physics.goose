// Small 3D rigid-body physics for scene nodes.
//
// This module uses box (oriented), sphere and capsule colliders. A mass of
// zero makes a body static; dynamic bodies use semi-implicit Euler
// integration with linear and angular velocity, and an impulse response
// when their shapes overlap. It is intended for simple game motion, not as
// a general-purpose solver: broadphase is a per-substep sweep-and-prune
// along x, box-box face contacts clip into multi-point manifolds while
// other pairs stay single-point, sleeping is per-body rather than
// island-based, and friction is applied linearly only (it cannot balance
// friction torque). Contacts are solved with sequential impulses —
// warm-started accumulated-impulse iterations per substep plus one
// positional-correction pass.

import std;
import vec;
import math;
import g3.math;
import g3.scene;

namespace g3;

struct PhysicsBody {
    node: NodeHandle,
    position: float3,
    velocity: float3,
    force: float3,
    half_extents: float3 = float3 { 0.5, 0.5, 0.5 },
    // Collider radius; zero means the body is a box.
    radius: f32 = 0.0,
    // Capsule cylinder half-length (center to cap center) along the body's
    // local Y; zero with a positive radius means a sphere.
    half_length: f32 = 0.0,
    mass: f32,
    inverse_mass: f32,
    restitution: f32 = 0.0,
    friction: f32 = 0.5,
    // Kinematic bodies follow their velocity and angular velocity exactly —
    // no gravity, forces, torques or impulses — but still push dynamic
    // bodies out of the way.
    kinematic: bool = false,
    // Removed bodies keep their slot so ids stay stable, like materials
    // and cameras; they no longer integrate or collide.
    removed: bool = false,
    // World-from-body rotation as a pure Mat4, matching the node's euler
    // convention (mat4_rotate_euler). Captured from the node's pose at
    // creation and by physics_body_sync; written back each step — to
    // node.rot for TRS nodes, into local_matrix for matrix-driven nodes.
    orientation: Mat4,
    // World-frame angular velocity in radians per second.
    angular_velocity: float3 = float3_0,
    // Diagonal inverse inertia tensor in body axes; zero for static and
    // kinematic bodies, which are immovable in rotation as in translation.
    inverse_inertia: float3 = float3_0,
    // World-space inverse inertia tensor R * diag(inverse_inertia) * Rᵀ,
    // refreshed every substep after orientation integration. The solver's
    // angular response is a single mat-vec against this instead of two
    // basis transforms per impulse.
    inv_inertia_world: float3[3],
    // Torque accumulated for the next step, cleared with `force`.
    torque: float3 = float3_0,
    // Sleeping bodies skip integration and count as immovable in contacts
    // until a real impact or an explicit wake.
    sleeping: bool = false,
    sleep_timer: f32 = 0.0,
    // Conservative world-space half extents of the collider, refreshed at
    // the top of every substep. The pair loop rejects on these before any
    // contact math runs — the broadphase.
    bounds: float3 = float3_0,
}

var g_physics_bodies: PhysicsBody[>..];
var g_physics_gravity: float3 = float3 { 0.0, -9.81, 0.0 };
// Live body indices sorted by AABB min-x each substep — the sweep-and-prune
// broadphase that keeps the pair loop near O(n log n + candidates).
var g_physics_order: i64[>..];

// A contact recorded during the last physics_step: one entry per substep
// pair overlap. `a` and `b` are body ids, `normal` points from body a
// toward body b, `point` is the world-space contact point (midpoint of the
// two surface points) and `penetration` is the overlap depth at detection.
struct BodyContact {
    a: i64,
    b: i64,
    normal: float3 = float3_0,
    point: float3 = float3_0,
    penetration: f32 = 0.0,
}

var g_physics_contacts: BodyContact[>..];

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
struct WarmSlot {
    key: i64 = 0,
    lambda_n: f32 = 0.0,
    lambda_t: f32 = 0.0,
}

var g_warm_tab: WarmSlot[>..];
var g_warm_mask: i64 = 0;

fn physics_warm_key(a: i64, b: i64, slot: i64) -> i64 {
    return a * 68719476736 + b * 16 + slot + 1;
}

fn physics_warm_slot(a: i64, b: i64, slot: i64, cap: i64) -> i64 {
    var h = (a * 31 + b) * 31 + slot;
    h = (h * 2654435761) % cap;
    return h;
}

fn physics_warm_lookup(a: i64, b: i64, slot: i64) -> f32, f32 {
    if g_warm_mask <= 0 { return 0.0, 0.0; }
    let cap = g_warm_mask + 1;
    let key = physics_warm_key(a, b, slot);
    var idx = physics_warm_slot(a, b, slot, cap);
    for _ in 0..cap {
        let w = g_warm_tab[idx];
        if w.key == 0 { return 0.0, 0.0; }
        if w.key == key { return w.lambda_n, w.lambda_t; }
        idx = (idx + 1) % cap;
    }
    return 0.0, 0.0;
}

// Velocity iterations per substep. Each pass re-solves every contact
// against the velocities the previous pass produced, which is what makes
// stacked bodies share load instead of popping in pair order.
const PHYSICS_SOLVER_ITERATIONS: i32 = 12;

fn physics_body_count() -> i64 { return g_physics_bodies.len; }

fn physics_body(id: i64) -> PhysicsBody& { return g_physics_bodies[id] }

// Live-body check shared by every public accessor: in range and not a
// removal tombstone.
fn physics_body_valid(id: i64) -> bool {
    return id >= 0 && id < g_physics_bodies.len && !g_physics_bodies[id].removed;
}

// inverse_mass and inverse_inertia follow mass and kinematic mode: static
// (mass 0) and kinematic bodies are immovable as far as the solver is
// concerned, in rotation as in translation.
fn physics_refresh_response(body: PhysicsBody&) {
    body.inverse_mass = if body.kinematic || body.mass == 0.0 { 0.0 } else { 1.0 / body.mass };
    body.inverse_inertia = physics_shape_inertia(body.mass, body.half_extents, body.radius, body.half_length);
    if body.kinematic { body.inverse_inertia = float3_0; }
    physics_update_inv_inertia_world(body);
}

// Rebuild the world-space inverse inertia tensor from the body's current
// orientation: Iw = R * diag(ii) * Rᵀ, summed over the three body axes.
fn physics_update_inv_inertia_world(b: PhysicsBody&) {
    let ii = b.inverse_inertia;
    if ii.x == 0.0 && ii.y == 0.0 && ii.z == 0.0 {
        b.inv_inertia_world[0] = float3_0;
        b.inv_inertia_world[1] = float3_0;
        b.inv_inertia_world[2] = float3_0;
        return;
    }
    let m = b.orientation.m;
    let ax = float3 { m[0], m[1], m[2] };
    let ay = float3 { m[4], m[5], m[6] };
    let az = float3 { m[8], m[9], m[10] };
    b.inv_inertia_world[0] = float3 {
        ii.x * ax.x * ax.x + ii.y * ay.x * ay.x + ii.z * az.x * az.x,
        ii.x * ax.x * ax.y + ii.y * ay.x * ay.y + ii.z * az.x * az.y,
        ii.x * ax.x * ax.z + ii.y * ay.x * ay.z + ii.z * az.x * az.z,
    };
    b.inv_inertia_world[1] = float3 {
        ii.x * ax.y * ax.x + ii.y * ay.y * ay.x + ii.z * az.y * az.x,
        ii.x * ax.y * ax.y + ii.y * ay.y * ay.y + ii.z * az.y * az.y,
        ii.x * ax.y * ax.z + ii.y * ay.y * ay.z + ii.z * az.y * az.z,
    };
    b.inv_inertia_world[2] = float3 {
        ii.x * ax.z * ax.x + ii.y * ay.z * ay.x + ii.z * az.z * az.x,
        ii.x * ax.z * ax.y + ii.y * ay.z * ay.y + ii.z * az.z * az.y,
        ii.x * ax.z * ax.z + ii.y * ay.z * ay.z + ii.z * az.z * az.z,
    };
}

fn physics_wake(body: PhysicsBody&) {
    body.sleeping = false;
    body.sleep_timer = 0.0;
}

// Diagonal inverse inertia tensor in body axes for the collider shape.
// mass == 0 gives zero: static bodies never rotate under impulses.
fn physics_shape_inertia(mass: f32, he: float3, radius: f32, half_length: f32) -> float3 {
    if mass == 0.0 { return float3_0; }
    let kind = if radius <= 0.0 { 0 } else { if half_length > 0.0 { 2 } else { 1 } };
    if kind == 1 {
        // Solid sphere: I = (2/5) m r^2 about every axis.
        let inv = 2.5 / (mass * radius * radius);
        return float3 { inv, inv, inv };
    }
    if kind == 0 {
        // Box with full extents 2*he: I_x = m/12 * ((2hy)^2 + (2hz)^2).
        let d = mass / 3.0;
        return float3 {
            1.0 / (d * (he.y * he.y + he.z * he.z)),
            1.0 / (d * (he.x * he.x + he.z * he.z)),
            1.0 / (d * (he.x * he.x + he.y * he.y)),
        };
    }
    // Capsule approximated as a solid cylinder of radius `radius` and
    // height 2*(half_length + radius) along local Y, capped spheres ignored:
    // I_diameter = m(3r^2 + h^2)/12 about X and Z, I_axis = m r^2/2 about Y.
    let h = 2.0 * (half_length + radius);
    let r_sq = radius * radius;
    return float3 {
        12.0 / (mass * (3.0 * r_sq + h * h)),
        2.0 / (mass * r_sq),
        12.0 / (mass * (3.0 * r_sq + h * h)),
    };
}

// A node's position, orientation and scale as the solver sees them. Plain
// nodes carry TRS fields; nodes flagged use_local_matrix (asset imports,
// the gs3d/three facade) keep an affine local_matrix instead, so TRS is
// decomposed from it. Scale is signed: a negative determinant mirrors one
// axis, which the rotation columns absorb so `orientation` stays proper.
struct PhysicsPose {
    position: float3,
    orientation: Mat4,
    scale: float3,
}

fn physics_node_pose(nref: Node&) -> PhysicsPose {
    if !nref.use_local_matrix {
        return PhysicsPose {
            position: nref.pos,
            orientation: mat4_rotate_euler(nref.rot),
            scale: nref.scale,
        };
    }
    let m = nref.local_matrix.m;
    let sx = sqrt(m[0] * m[0] + m[1] * m[1] + m[2] * m[2]);
    let sy = sqrt(m[4] * m[4] + m[5] * m[5] + m[6] * m[6]);
    let sz = sqrt(m[8] * m[8] + m[9] * m[9] + m[10] * m[10]);
    // Signed scale: normalize the columns into a proper rotation, flipping
    // the third axis when the matrix mirrors.
    var rx = if sx > 0.0000001 { m[0] / sx } else { 1.0 };
    var ry = if sx > 0.0000001 { m[1] / sx } else { 0.0 };
    var rz = if sx > 0.0000001 { m[2] / sx } else { 0.0 };
    var ux = if sy > 0.0000001 { m[4] / sy } else { 0.0 };
    var uy = if sy > 0.0000001 { m[5] / sy } else { 1.0 };
    var uz = if sy > 0.0000001 { m[6] / sy } else { 0.0 };
    var vx = if sz > 0.0000001 { m[8] / sz } else { 0.0 };
    var vy = if sz > 0.0000001 { m[9] / sz } else { 0.0 };
    var vz = if sz > 0.0000001 { m[10] / sz } else { 1.0 };
    // det of the normalized columns; negative means a reflection.
    let det = rx * (uy * vz - uz * vy) - ux * (ry * vz - rz * vy) + vx * (ry * uz - rz * uy);
    var scale_z = sz;
    if det < 0.0 {
        vx = -vx; vy = -vy; vz = -vz;
        scale_z = -sz;
    }
    var orientation = mat4_zero();
    orientation.m[0] = rx; orientation.m[1] = ry; orientation.m[2] = rz;
    orientation.m[4] = ux; orientation.m[5] = uy; orientation.m[6] = uz;
    orientation.m[8] = vx; orientation.m[9] = vy; orientation.m[10] = vz;
    orientation.m[15] = 1.0;
    return PhysicsPose {
        position: float3 { m[12], m[13], m[14] },
        orientation: orientation,
        scale: float3 {
            if sx > 0.0000001 { sx } else { 1.0 },
            if sy > 0.0000001 { sy } else { 1.0 },
            if scale_z != 0.0 { scale_z } else { 1.0 },
        },
    };
}

// Rebuild a use_local_matrix node's affine transform from solver state,
// preserving the scale the pose read found.
fn physics_write_local_matrix(nref: Node&, position: float3, orientation: Mat4, scale: float3) {
    var out = mat4_zero();
    out.m[0] = orientation.m[0] * scale.x; out.m[1] = orientation.m[1] * scale.x; out.m[2] = orientation.m[2] * scale.x;
    out.m[4] = orientation.m[4] * scale.y; out.m[5] = orientation.m[5] * scale.y; out.m[6] = orientation.m[6] * scale.y;
    out.m[8] = orientation.m[8] * scale.z; out.m[9] = orientation.m[9] * scale.z; out.m[10] = orientation.m[10] * scale.z;
    out.m[12] = position.x; out.m[13] = position.y; out.m[14] = position.z;
    out.m[15] = 1.0;
    nref.local_matrix = out;
}

// World direction to body axes: R^T v, which is just the orientation's
// columns dotted with v — no transpose allocation in the contact hot path.
fn physics_world_to_body(b: PhysicsBody&, v: float3) -> float3 {
    let m = b.orientation.m;
    return float3 {
        m[0] * v.x + m[1] * v.y + m[2] * v.z,
        m[4] * v.x + m[5] * v.y + m[6] * v.z,
        m[8] * v.x + m[9] * v.y + m[10] * v.z,
    };
}

fn physics_body_to_world(b: PhysicsBody&, v: float3) -> float3 {
    return mat4_apply_dir(b.orientation, v);
}

// The box's local axes in world space: columns 0, 1, 2 of the orientation.
fn physics_box_axis(b: PhysicsBody&, axis: i64) -> float3 {
    if axis == 0 { return float3 { b.orientation.m[0], b.orientation.m[1], b.orientation.m[2] }; }
    if axis == 1 { return float3 { b.orientation.m[4], b.orientation.m[5], b.orientation.m[6] }; }
    return float3 { b.orientation.m[8], b.orientation.m[9], b.orientation.m[10] };
}

// Conservative world-space half extents of the collider along each world
// axis — the broadphase bound. For a rotated box this is |R| * he; a
// capsule extends `radius` past its axis segment.
fn physics_update_bounds(b: PhysicsBody&) {
    let kind = physics_kind(b);
    if kind == 1 {
        b.bounds = float3 { b.radius, b.radius, b.radius };
        return;
    }
    if kind == 2 {
        // Capsule axis is local Y: column 1 of the orientation.
        let ax = abs(b.orientation.m[4]);
        let ay = abs(b.orientation.m[5]);
        let az = abs(b.orientation.m[6]);
        b.bounds = float3 {
            b.radius + ax * b.half_length,
            b.radius + ay * b.half_length,
            b.radius + az * b.half_length,
        };
        return;
    }
    let he = b.half_extents;
    let m = b.orientation.m;
    b.bounds = float3 {
        abs(m[0]) * he.x + abs(m[4]) * he.y + abs(m[8]) * he.z,
        abs(m[1]) * he.x + abs(m[5]) * he.y + abs(m[9]) * he.z,
        abs(m[2]) * he.x + abs(m[6]) * he.y + abs(m[10]) * he.z,
    };
}

// Closest point on the oriented box to world point `p`.
fn physics_box_closest(b: PhysicsBody&, p: float3) -> float3 {
    let local = physics_world_to_body(b, p - b.position);
    let he = b.half_extents;
    let cl = float3 {
        clamp(local.x, -he.x, he.x),
        clamp(local.y, -he.y, he.y),
        clamp(local.z, -he.z, he.z),
    };
    return b.position + physics_body_to_world(b, cl);
}

// The box's local-space coordinates of a world point relative to center.
fn physics_box_local(b: PhysicsBody&, p: float3) -> float3 {
    return physics_world_to_body(b, p - b.position);
}

// World point of a box-local offset from the center.
fn physics_box_offset(b: PhysicsBody&, local: float3) -> float3 {
    return b.position + physics_body_to_world(b, local);
}

fn physics_clear() {
    g_physics_bodies.clear();
    g_physics_contacts.clear();
    g_physics_order.clear();
    g_physics_solver.clear();
    g_warm_tab.clear();
    g_warm_mask = 0;
}

fn physics_set_gravity(gravity: float3) { g_physics_gravity = gravity; }

fn physics_body_add_shape(node_id: i64, half_extents: float3, radius: f32, half_length: f32, mass: f32) -> i64 {
    guard node_id >= 0 && node_id < node_count() &&
          half_extents.x > 0.0 && half_extents.y > 0.0 && half_extents.z > 0.0 &&
          radius >= 0.0 && half_length >= 0.0 && mass >= 0.0 && mass <= 3.4e38 else { return -1; }
    let handle = node_handle(node_id);
    guard node_handle_valid(handle) else { return -1; }
    let nref .= node(node_id);
    let pose = physics_node_pose(nref);
    g_physics_bodies.push(PhysicsBody {
        node: handle,
        position: pose.position,
        half_extents: half_extents,
        radius: radius,
        half_length: half_length,
        mass: mass,
        inverse_mass: if mass == 0.0 { 0.0 } else { 1.0 / mass },
        orientation: pose.orientation,
        inverse_inertia: physics_shape_inertia(mass, half_extents, radius, half_length),
        ..
    });
    physics_update_inv_inertia_world(g_physics_bodies[g_physics_bodies.len - 1]);
    return g_physics_bodies.len - 1;
}

// Attach a box body to a scene node. The node's position is the collider
// center. `mass == 0` creates an immovable body.
fn physics_body_add(node_id: i64, half_extents: float3, mass: f32) -> i64 {
    return physics_body_add_shape(node_id, half_extents, 0.0, 0.0, mass);
}

// Attach a sphere body to a scene node. `radius` is the collider radius in
// world units; the node's position is the sphere center.
fn physics_body_add_sphere(node_id: i64, radius: f32, mass: f32) -> i64 {
    guard radius > 0.0 && radius <= 3.4e38 else { return -1; }
    return physics_body_add_shape(node_id, float3 { radius, radius, radius }, radius, 0.0, mass);
}

// Attach a capsule body to a scene node: a cylinder of `half_length` capped
// by spheres of `radius`, aligned with world Y through the node's position.
fn physics_body_add_capsule(node_id: i64, radius: f32, half_length: f32, mass: f32) -> i64 {
    guard radius > 0.0 && radius <= 3.4e38 && half_length >= 0.0 && half_length <= 3.4e38 else { return -1; }
    return physics_body_add_shape(node_id,
        float3 { radius, half_length + radius, radius }, radius, half_length, mass);
}

fn physics_body_set_restitution(id: i64, restitution: f32) -> bool {
    guard physics_body_valid(id) && restitution >= 0.0 && restitution <= 1.0 else { return false; }
    g_physics_bodies[id].restitution = restitution;
    return true;
}

fn physics_body_set_friction(id: i64, friction: f32) -> bool {
    guard physics_body_valid(id) && friction >= 0.0 && friction <= 1.0 else { return false; }
    g_physics_bodies[id].friction = friction;
    return true;
}

// Remove a body. The slot stays as a tombstone so every other id remains
// valid, matching material_remove/camera_remove; physics_clear() frees the
// slots. Removed bodies no longer integrate, collide or answer queries.
fn physics_body_remove(id: i64) -> bool {
    guard physics_body_valid(id) else { return false; }
    let body .= g_physics_bodies[id];
    body.removed = true;
    body.velocity = float3_0;
    body.force = float3_0;
    return true;
}

fn physics_body_is_kinematic(id: i64) -> bool {
    guard physics_body_valid(id) else { return false; }
    return g_physics_bodies[id].kinematic;
}

// Change a body's mass after creation; mass == 0 makes it static. A
// kinematic body keeps its mass for when kinematic mode is switched off.
fn physics_body_set_mass(id: i64, mass: f32) -> bool {
    guard physics_body_valid(id) && mass >= 0.0 && mass <= 3.4e38 else { return false; }
    let body .= g_physics_bodies[id];
    body.mass = mass;
    physics_refresh_response(body);
    physics_wake(body);
    return true;
}

// Kinematic bodies follow their velocity exactly — no gravity, forces or
// impulses — but still push dynamic bodies out of the way. This is the
// Rapier RigidBodyType.KinematicPositionBased analogue.
fn physics_body_set_kinematic(id: i64, kinematic: bool) -> bool {
    guard physics_body_valid(id) else { return false; }
    let body .= g_physics_bodies[id];
    body.kinematic = kinematic;
    physics_refresh_response(body);
    if kinematic { body.force = float3_0; body.torque = float3_0; }
    physics_wake(body);
    return true;
}

// Copy the node's current transform into the body — position and euler
// rotation. Gameplay code that moves a node directly — teleports,
// character controllers — needs this, or the body keeps its own transform
// and the next physics_step writes the stale one back onto the node.
fn physics_body_sync(id: i64) -> bool {
    guard physics_body_valid(id) && node_handle_valid(g_physics_bodies[id].node) else { return false; }
    let body .= g_physics_bodies[id];
    let nref .= node(body.node.index);
    let pose = physics_node_pose(nref);
    body.position = pose.position;
    body.orientation = pose.orientation;
    physics_wake(body);
    return true;
}

// Contacts detected during the last physics_step, one entry per substep
// pair overlap, in pair order.
fn physics_contact_count() -> i64 { return g_physics_contacts.len; }

fn physics_contact(id: i64) -> BodyContact& { return g_physics_contacts[id]; }

// Add a force for the next step. Forces are cleared after each step.
fn physics_apply_force(id: i64, force: float3) -> bool {
    guard physics_body_valid(id) && g_physics_bodies[id].inverse_mass > 0.0 else { return false; }
    let body .= g_physics_bodies[id];
    body.force += force;
    physics_wake(body);
    return true;
}

// Add a world-frame torque for the next step, like physics_apply_force.
// Cleared after each step; dynamic bodies only.
fn physics_apply_torque(id: i64, torque: float3) -> bool {
    guard physics_body_valid(id) && g_physics_bodies[id].inverse_mass > 0.0 else { return false; }
    let body .= g_physics_bodies[id];
    body.torque += torque;
    physics_wake(body);
    return true;
}

// Instantaneous impulse at a world point: changes linear velocity by
// impulse * inverse_mass and angular velocity by the torque impulse
// (point - position) x impulse through the inertia tensor. Dynamic bodies
// only; wakes a sleeping body.
fn physics_body_apply_impulse_at(id: i64, impulse: float3, point: float3) -> bool {
    guard physics_body_valid(id) && g_physics_bodies[id].inverse_mass > 0.0 else { return false; }
    let body .= g_physics_bodies[id];
    physics_wake(body);
    body.velocity += impulse * body.inverse_mass;
    physics_apply_ang_impulse(body, impulse, point - body.position);
    return true;
}

fn physics_body_set_velocity(id: i64, velocity: float3) -> bool {
    guard physics_body_valid(id) else { return false; }
    let body .= g_physics_bodies[id];
    body.velocity = velocity;
    physics_wake(body);
    return true;
}

fn physics_body_set_angvel(id: i64, angvel: float3) -> bool {
    guard physics_body_valid(id) else { return false; }
    let body .= g_physics_bodies[id];
    body.angular_velocity = angvel;
    physics_wake(body);
    return true;
}

fn physics_body_angvel(id: i64) -> float3 {
    guard physics_body_valid(id) else { return float3_0; }
    return g_physics_bodies[id].angular_velocity;
}

// The body's euler rotation in the node convention, for read-back without
// touching the node.
fn physics_body_euler(id: i64) -> float3 {
    guard physics_body_valid(id) else { return float3_0; }
    return physics_mat_to_euler(g_physics_bodies[id].orientation);
}

// Wake a sleeping body without changing its state.
fn physics_body_wake(id: i64) -> bool {
    guard physics_body_valid(id) else { return false; }
    physics_wake(g_physics_bodies[id]);
    return true;
}

// True while the body is asleep: integration and contact response skip
// it until a wake, an impact, or an explicit physics_body_wake.
fn physics_body_is_sleeping(id: i64) -> bool {
    guard physics_body_valid(id) else { return false; }
    return g_physics_bodies[id].sleeping;
}

// Force a dynamic body to sleep immediately, like cannon-es Body.sleep().
// Velocities are zeroed the same way the automatic sleep path does them;
// contacts with approach speed and explicit wakes revive the body.
fn physics_body_sleep(id: i64) -> bool {
    guard physics_body_valid(id) && g_physics_bodies[id].inverse_mass > 0.0 else { return false; }
    let body .= g_physics_bodies[id];
    body.sleeping = true;
    body.sleep_timer = 0.0;
    body.velocity = float3_0;
    body.angular_velocity = float3_0;
    return true;
}

// Clear the force accumulated for the next step without touching
// anything else — Rapier's resetForces analogue.
fn physics_body_reset_force(id: i64) -> bool {
    guard physics_body_valid(id) else { return false; }
    g_physics_bodies[id].force = float3_0;
    return true;
}

// Clear the accumulated torque, like physics_body_reset_force.
fn physics_body_reset_torque(id: i64) -> bool {
    guard physics_body_valid(id) else { return false; }
    g_physics_bodies[id].torque = float3_0;
    return true;
}

// Advance the simulation by seconds. Substeps are capped at 1/60 second
// and shrink further when a fast body would move more than a quarter of
// the smallest collider feature per substep, which is what actually
// prevents tunneling. At most 12 substeps run per call. Inputs above one
// second are rejected to bound work after a long pause.
fn physics_step(dt: f32) {
    guard dt > 0.0 && dt <= 1.0 else { return; }
    g_physics_contacts.clear();
    let sub_dt = physics_substep_dt(dt);
    var remaining = dt;
    var steps = 0;
    while remaining > 0.0000001 && steps < 12 {
        let h = min(remaining, sub_dt);
        physics_substep(h);
        remaining -= h;
        steps += 1;
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
    // Allow at most a quarter-feature of travel per substep, clamped to a
    // sane range so a tiny collider cannot force unbounded substeps.
    let needed = min_size / (4.0 * max_speed);
    return min(dt, clamp(needed, 1.0 / 480.0, 1.0 / 60.0));
}

fn physics_substep(dt: f32) {
    for &body in g_physics_bodies {
        if body.removed || body.sleeping || !node_handle_valid(body.node) { continue; }
        if body.inverse_mass > 0.0 {
            body.velocity += (g_physics_gravity + body.force * body.inverse_mass) * dt;
            body.angular_velocity += physics_torque_to_angacc(body) * dt;
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

// Extract euler angles (radians, node convention: mat4_rotate_euler's
// Rz*Ry*Rx) from a pure rotation matrix.
fn physics_mat_to_euler(m: Mat4) -> float3 {
    let sy = clamp(-m.m[2], -1.0, 1.0);
    let cy = sqrt(max(1.0 - sy * sy, 0.0));
    if cy > 0.0001 {
        return float3 {
            atan2(m.m[6], m.m[10]),
            asin(sy),
            atan2(m.m[1], m.m[0]),
        };
    }
    // Gimbal lock: pitch is ±90 degrees and yaw/roll merge into one
    // observable angle. Zeroing yaw and folding the rest into rot.x
    // reproduces the same matrix: at +pitch the combination is rx - rz,
    // read off M[0][1]/M[0][2]; at -pitch it is rx + rz, negated.
    let pitch = asin(sy);
    if sy > 0.0 { return float3 { atan2(m.m[4], m.m[8]), pitch, 0.0 }; }
    return float3 { atan2(-m.m[4], -m.m[8]), pitch, 0.0 };
}

// A detected overlap: `normal` points from body a toward body b,
// `point` is the world-space contact point (midpoint of the two surface
// points) and `penetration` is the depth to resolve along it.
struct Contact {
    normal: float3 = float3_0,
    point: float3 = float3_0,
    penetration: f32 = 0.0,
    hit: bool = false,
}

// Projection radius of the oriented box along unit direction `l`: the
// support distance from center to surface.
fn physics_box_radius(b: PhysicsBody&, l: float3) -> f32 {
    return b.half_extents.x * abs(dot(physics_box_axis(b, 0), l)) +
           b.half_extents.y * abs(dot(physics_box_axis(b, 1), l)) +
           b.half_extents.z * abs(dot(physics_box_axis(b, 2), l));
}

// The three world-space axes of an oriented box, extracted once per contact
// test — the SAT loop below reuses them for all 15 candidate axes instead
// of re-reading the orientation columns on every projection.
struct BoxAxes { x: float3, y: float3, z: float3 }

fn physics_box_axes(b: PhysicsBody&) -> BoxAxes {
    return BoxAxes {
        x: physics_box_axis(b, 0),
        y: physics_box_axis(b, 1),
        z: physics_box_axis(b, 2),
    };
}

// Projected radius of a box on `l` from precomputed axes.
fn physics_box_radius_axes(he: float3, axes: BoxAxes, l: float3) -> f32 {
    return he.x * abs(dot(axes.x, l)) +
           he.y * abs(dot(axes.y, l)) +
           he.z * abs(dot(axes.z, l));
}

// Projected overlap of two oriented boxes on `axis` (any nonzero vector;
// normalized inside) using caller-cached axes — the hot path inside
// physics_box_contact, which evaluates 15 axes per pair. Returns the
// overlap depth, or 3.0e38 for a degenerate axis that should be skipped.
fn physics_sat_overlap_axes(a: PhysicsBody&, b: PhysicsBody&, axis: float3,
                            aa: BoxAxes, ba: BoxAxes) -> f32 {
    let al = length(axis);
    if al < 0.0001 { return 3.0e38; }
    let l = axis / al;
    let dist = abs(dot(b.position - a.position, l));
    return physics_box_radius_axes(a.half_extents, aa, l) +
           physics_box_radius_axes(b.half_extents, ba, l) - dist;
}

// Result of the 15-axis SAT for an oriented box pair. `kind` says which
// candidate produced the least overlap: 0 = one of a's face axes, 1 = one
// of b's, 2 = an edge cross product. `axis_index` is the winning box axis
// for face kinds, -1 for edge kinds. `overlap <= 0` means separated.
struct BoxSat {
    axis: float3 = float3_0,
    overlap: f32 = 0.0,
    kind: i64 = 2,
    axis_index: i64 = -1,
}

fn physics_box_axis_at(axes: BoxAxes, i: i64) -> float3 {
    return if i == 0 { axes.x } else { if i == 1 { axes.y } else { axes.z } };
}

fn physics_box_he_at(he: float3, i: i64) -> f32 {
    return if i == 0 { he.x } else { if i == 1 { he.y } else { he.z } };
}

// 15-axis SAT (3 + 3 face axes, 9 edge cross products) over caller-cached
// axes. The axis of least overlap becomes the contact normal direction.
fn physics_box_sat(a: PhysicsBody&, b: PhysicsBody&, aa: BoxAxes, ba: BoxAxes) -> BoxSat {
    var best = BoxSat { overlap: 3.0e38 };
    for i in 0..3 {
        let ai = physics_box_axis_at(aa, i);
        let bi = physics_box_axis_at(ba, i);
        let ov = physics_sat_overlap_axes(a, b, ai, aa, ba);
        if ov <= 0.0 { return BoxSat { overlap: ov }; }
        if ov < best.overlap {
            best.overlap = ov; best.axis = ai; best.kind = 0; best.axis_index = i;
        }
        let ov_b = physics_sat_overlap_axes(a, b, bi, aa, ba);
        if ov_b <= 0.0 { return BoxSat { overlap: ov_b }; }
        if ov_b < best.overlap {
            best.overlap = ov_b; best.axis = bi; best.kind = 1; best.axis_index = i;
        }
        for j in 0..3 {
            let bj = physics_box_axis_at(ba, j);
            let cross_axis = cross(ai, bj);
            let ov_c = physics_sat_overlap_axes(a, b, cross_axis, aa, ba);
            if ov_c <= 0.0 { return BoxSat { overlap: ov_c }; }
            if ov_c < best.overlap {
                best.overlap = ov_c; best.axis = cross_axis;
                best.kind = 2; best.axis_index = -1;
            }
        }
    }
    return best;
}

// Single-point fallback for box contacts that are not clean face contacts
// (edge/vertex hits): the surface point of whichever body has the smaller
// extent along the normal — its face center is the most likely spot inside
// the overlap region.
fn physics_box_single_point(a: PhysicsBody&, b: PhysicsBody&, n: float3,
                            aa: BoxAxes, ba: BoxAxes) -> float3 {
    let ra = physics_box_radius_axes(a.half_extents, aa, n);
    let rb = physics_box_radius_axes(b.half_extents, ba, n);
    if ra <= rb { return a.position + n * ra; }
    return b.position - n * rb;
}

// Up to 8 world-space contact points for one box-box overlap, plus the
// shared contact normal (a toward b) and per-point penetration depths.
// Face contacts clip the incident face against the reference face's side
// planes (Sutherland–Hodgman) so a resting box is held by a small manifold
// instead of one point — single points cannot resist tipping torque.
struct ContactManifold {
    count: i32 = 0,
    normal: float3 = float3_0,
    points: float3[8],
    penetrations: f32[8],
}

// Convex polygon clip: keep the part of `poly` with
// dot(p - plane_point, plane_normal) <= 0. `poly` is mutated in place.
struct ClipPoly { v: float3[8], count: i32 }

fn physics_clip_plane(poly: ClipPoly, pp: float3, pn: float3) {
    var out_v: float3[8];
    var out_count: i32 = 0;
    if poly.count <= 0 { return; }
    var prev = poly.v[poly.count - 1];
    var prev_d = dot(prev - pp, pn);
    var prev_in = prev_d <= 0.0;
    for i in 0..poly.count {
        let cur = poly.v[i];
        let cur_d = dot(cur - pp, pn);
        let cur_in = cur_d <= 0.0;
        if cur_in != prev_in {
            let t = prev_d / (prev_d - cur_d);
            if out_count < 8 {
                out_v[out_count] = prev + (cur - prev) * t;
                out_count += 1;
            }
        }
        if cur_in && out_count < 8 {
            out_v[out_count] = cur;
            out_count += 1;
        }
        prev = cur; prev_d = cur_d; prev_in = cur_in;
    }
    for i in 0..8 { poly.v[i] = out_v[i]; }
    poly.count = out_count;
}

// Box-box manifold: run the SAT, and when the least-penetration axis is a
// face axis, clip the incident box's contact face by the reference box's
// face rectangle. Edge/vertex winners fall back to one point.
fn physics_box_manifold(a: PhysicsBody&, b: PhysicsBody&, m: ContactManifold&) {
    m.count = 0;
    m.normal = float3_0;
    let aa = physics_box_axes(a);
    let ba = physics_box_axes(b);
    let sat = physics_box_sat(a, b, aa, ba);
    if sat.overlap <= 0.0 { return; }
    var axis = sat.axis;
    let t = b.position - a.position;
    if dot(t, axis) < 0.0 { axis = -axis; }
    let al = length(axis);
    if al < 0.0001 { return; }
    let n = axis / al;
    m.normal = n;

    if sat.kind == 2 {
        m.points[0] = physics_box_single_point(a, b, n, aa, ba);
        m.penetrations[0] = sat.overlap;
        m.count = 1;
        return;
    }

    // Reference box owns the SAT face axis; its outward normal toward the
    // incident box is +n when a is the reference, -n when b is.
    let ref_is_a = sat.kind == 0;
    let rpos = if ref_is_a { a.position } else { b.position };
    let raxes = if ref_is_a { aa } else { ba };
    let rhe = if ref_is_a { a.half_extents } else { b.half_extents };
    let ipos = if ref_is_a { b.position } else { a.position };
    let iaxes = if ref_is_a { ba } else { aa };
    let ihe = if ref_is_a { b.half_extents } else { a.half_extents };
    let m_face = if ref_is_a { n } else { float3 { -n.x, -n.y, -n.z } };

    let ri = sat.axis_index;
    let ru = (ri + 1) % 3;
    let rv = (ri + 2) % 3;
    let u = physics_box_axis_at(raxes, ru);
    let v = physics_box_axis_at(raxes, rv);
    let hu = physics_box_he_at(rhe, ru);
    let hv = physics_box_he_at(rhe, rv);
    let fc = rpos + m_face * physics_box_he_at(rhe, ri);

    // Incident face: the incident axis most aligned with m_face — box
    // axes are unsigned, so take max |dot| and pick the sign that puts
    // the face on the -m_face side, facing the reference box.
    var best_abs: f32 = -1.0;
    var ii: i64 = 0;
    var face_sign: f32 = 1.0;
    for k in 0..3 {
        let ax = physics_box_axis_at(iaxes, k);
        let d = dot(ax, m_face);
        if abs(d) > best_abs {
            best_abs = abs(d); ii = k;
            face_sign = if d < 0.0 { 1.0 } else { -1.0 };
        }
    }
    if best_abs < 0.5 {
        // Not a clean face-on-face hit after all; single point.
        m.points[0] = physics_box_single_point(a, b, n, aa, ba);
        m.penetrations[0] = sat.overlap;
        m.count = 1;
        return;
    }
    let iu = (ii + 1) % 3;
    let iv = (ii + 2) % 3;
    let iu_axis = physics_box_axis_at(iaxes, iu);
    let iv_axis = physics_box_axis_at(iaxes, iv);
    let ic = ipos + physics_box_axis_at(iaxes, ii) * face_sign * physics_box_he_at(ihe, ii);
    let hu_i = physics_box_he_at(ihe, iu);
    let hv_i = physics_box_he_at(ihe, iv);

    // Incident face quad.
    var poly = ClipPoly { v: [float3_0; 8], count: 4 };
    poly.v[0] = ic + iu_axis * hu_i + iv_axis * hv_i;
    poly.v[1] = ic - iu_axis * hu_i + iv_axis * hv_i;
    poly.v[2] = ic - iu_axis * hu_i - iv_axis * hv_i;
    poly.v[3] = ic + iu_axis * hu_i - iv_axis * hv_i;

    // Fast path: when every incident vertex already sits inside the
    // reference face rectangle and below its plane — the common
    // aligned-stack case — the clips cannot remove anything, so skip
    // them entirely.
    var needs_clip = false;
    for i in 0..4 {
        let p = poly.v[i];
        let du = dot(p - fc, u);
        let dv = dot(p - fc, v);
        let dn = dot(p - fc, m_face);
        if abs(du) > hu + 0.001 || abs(dv) > hv + 0.001 || dn > 0.05 {
            needs_clip = true;
        }
    }

    // Clip by the reference face rectangle (4 side planes, small margin
    // for float error) then by the face plane itself with a small
    // speculative margin so near-contacts still constrain approach.
    if needs_clip {
        physics_clip_plane(poly, fc + u * (hu + 0.001), u);
        physics_clip_plane(poly, fc - u * (hu + 0.001), float3 { -u.x, -u.y, -u.z });
        physics_clip_plane(poly, fc + v * (hv + 0.001), v);
        physics_clip_plane(poly, fc - v * (hv + 0.001), float3 { -v.x, -v.y, -v.z });
        physics_clip_plane(poly, fc + m_face * 0.05, m_face);
    }

    for i in 0..poly.count {
        if m.count >= 8 { break; }
        m.points[m.count] = poly.v[i];
        m.penetrations[m.count] = -dot(poly.v[i] - fc, m_face);
        m.count += 1;
    }
    if m.count == 0 {
        // Clipping ate the whole face (deep edge case); keep one point.
        m.points[0] = physics_box_single_point(a, b, n, aa, ba);
        m.penetrations[0] = sat.overlap;
        m.count = 1;
        return;
    }

    // Stable ordering: sort by the points' coordinates on the reference
    // face so the same physical corner keeps the same manifold slot —
    // and therefore the same warm-start impulse — across substeps.
    for i in 1..m.count {
        let p = m.points[i];
        let d = m.penetrations[i];
        let pu = dot(p - fc, u);
        let pv = dot(p - fc, v);
        var j = i;
        while j > 0 {
            let q = m.points[j - 1];
            let qu = dot(q - fc, u);
            let qv = dot(q - fc, v);
            if qu < pu || (qu == pu && qv <= pv) { break; }
            m.points[j] = q;
            m.penetrations[j] = m.penetrations[j - 1];
            j -= 1;
        }
        m.points[j] = p;
        m.penetrations[j] = d;
    }
}

// Contact points for any body pair: box-box pairs produce a manifold,
// everything else wraps the single-point Contact.
fn physics_contact_manifold(a: PhysicsBody&, b: PhysicsBody&, m: ContactManifold&) {
    m.count = 0;
    if physics_kind(a) == 0 && physics_kind(b) == 0 {
        physics_box_manifold(a, b, m);
        return;
    }
    let c = physics_contact(a, b);
    if !c.hit { return; }
    m.normal = c.normal;
    m.points[0] = c.point;
    m.penetrations[0] = c.penetration;
    m.count = 1;
}

// Oriented box against oriented box: delegates to the manifold path; kept
// for the single-point Contact API used by non-solver callers.
fn physics_box_contact(a: PhysicsBody&, b: PhysicsBody&) -> Contact {
    var m = ContactManifold { .. };
    physics_box_manifold(a, b, m);
    if m.count == 0 { return Contact { .. }; }
    // Report the deepest point.
    var best = 0;
    for i in 1..m.count {
        if m.penetrations[i] > m.penetrations[best] { best = i; }
    }
    return Contact { normal: m.normal, point: m.points[best],
                     penetration: m.penetrations[best], hit: true };
}

// Sphere against sphere.
fn physics_spheres_contact(a: PhysicsBody&, b: PhysicsBody&) -> Contact {
    let delta = b.position - a.position;
    let distance = length(delta);
    let radii = a.radius + b.radius;
    if distance >= radii { return Contact { .. }; }
    // Coincident centers have no direction; pick any axis.
    var normal = float3 { 0.0, 1.0, 0.0 };
    if distance > 0.0001 { normal = delta / distance; }
    let point = (a.position + normal * a.radius + b.position - normal * b.radius) * 0.5;
    return Contact { normal: normal, point: point, penetration: radii - distance, hit: true };
}

// Sphere against oriented box. The closest point is found in the box's
// local frame; the returned normal pushes the sphere out of the box —
// from the box toward the sphere for a surface contact, or along the
// local axis of least penetration when the center is inside.
fn physics_sphere_box_contact(s: PhysicsBody&, b: PhysicsBody&) -> Contact {
    let p = s.position;
    let closest = physics_box_closest(b, p);
    let d = p - closest;
    let dist_sq = dot(d, d);
    let radius_sq = s.radius * s.radius;
    if dist_sq > radius_sq { return Contact { .. }; }
    if dist_sq > 0.0000001 {
        let distance = sqrt(dist_sq);
        let normal = d / distance;
        // Midpoint between the sphere's surface point and the box's.
        let point = (closest + (p - normal * s.radius)) * 0.5;
        return Contact { normal: normal, point: point, penetration: s.radius - distance, hit: true };
    }

    // Center inside the box: exit along the local axis of least
    // penetration, rotated back to world.
    let local = physics_box_local(b, p);
    let escaped, depth = physics_escape_axis(local, b.half_extents, s.radius);
    let normal = physics_body_to_world(b, escaped);
    let point = p - normal * s.radius;
    return Contact { normal: normal, point: point, penetration: depth, hit: true };
}

// Axis of least penetration for a shape center `delta` away from a box
// center, in the box's LOCAL frame, with `extra` added to every half
// extent (a radius for rounded shapes). Returns the local push-out
// normal and the overlap along it; callers rotate it back to world.
fn physics_escape_axis(delta: float3, he: float3, extra: f32) -> float3, f32 {
    var best = he.x + extra - abs(delta.x);
    var axis = 0;
    let overlap_y = he.y + extra - abs(delta.y);
    if overlap_y < best { best = overlap_y; axis = 1; }
    let overlap_z = he.z + extra - abs(delta.z);
    if overlap_z < best { best = overlap_z; axis = 2; }
    var normal = float3 { if delta.x < 0.0 { -1.0 } else { 1.0 }, 0.0, 0.0 };
    if axis == 1 { normal = float3 { 0.0, if delta.y < 0.0 { -1.0 } else { 1.0 }, 0.0 }; }
    if axis == 2 { normal = float3 { 0.0, 0.0, if delta.z < 0.0 { -1.0 } else { 1.0 } }; }
    return normal, best;
}

// Collider kinds for the contact dispatch: 0 box, 1 sphere, 2 capsule.
fn physics_kind(b: PhysicsBody&) -> i32 {
    if b.radius <= 0.0 { return 0; }
    if b.half_length > 0.0 { return 2; }
    return 1;
}

struct Segment { start: float3, end: float3 }

struct SegmentPoints { on_first: float3, on_second: float3 }

// A capsule's axis runs along the body's local Y through its center;
// half_length runs from the center to each cap center.
fn physics_capsule_segment(b: PhysicsBody&) -> Segment {
    let axis = physics_body_to_world(b, float3 { 0.0, 1.0, 0.0 });
    return Segment {
        start: b.position - axis * b.half_length,
        end: b.position + axis * b.half_length,
    };
}

fn closest_on_segment(p: float3, s: Segment) -> float3 {
    let d = s.end - s.start;
    let len_sq = dot(d, d);
    var t: f32 = 0.0;
    if len_sq > 0.0000001 { t = clamp(dot(p - s.start, d) / len_sq, 0.0, 1.0); }
    return s.start + d * t;
}

// Closest points between two segments (Ericson, Real-Time Collision
// Detection). Degenerate segments are handled as points.
fn segment_segment_closest(s1: Segment, s2: Segment) -> SegmentPoints {
    let d1 = s1.end - s1.start;
    let d2 = s2.end - s2.start;
    let r = s1.start - s2.start;
    let a = dot(d1, d1);
    let e = dot(d2, d2);
    let f = dot(d2, r);
    let c = dot(d1, r);
    let b = dot(d1, d2);
    var s: f32 = 0.0;
    var t: f32 = 0.0;
    if a <= 0.0000001 && e <= 0.0000001 {
        // Both degenerate: the points themselves.
    } else if a <= 0.0000001 {
        t = clamp(f / e, 0.0, 1.0);
    } else if e <= 0.0000001 {
        s = clamp(-c / a, 0.0, 1.0);
    } else {
        let denom = a * e - b * b;
        if denom > 0.0000001 { s = clamp((b * f - c * e) / denom, 0.0, 1.0); }
        t = clamp((b * s + f) / e, 0.0, 1.0);
        s = clamp((b * t - c) / a, 0.0, 1.0);
    }
    return SegmentPoints {
        on_first: s1.start + d1 * s,
        on_second: s2.start + d2 * t,
    };
}

// Capsule against capsule: distance between the two axis segments. Parallel
// segments have a degenerate closest-point pair — the generic solver picks
// an endpoint, which would put the contact at a cap and spin the bodies on
// every touch — so overlapping parallel axes report the middle of their
// shared axial range instead. The contact point is the midpoint of the two
// radius-offset surface points.
fn physics_capsules_contact(a: PhysicsBody&, b: PhysicsBody&) -> Contact {
    let sa = physics_capsule_segment(a);
    let sb = physics_capsule_segment(b);
    var points = segment_segment_closest(sa, sb);
    let d1 = sa.end - sa.start;
    let d2 = sb.end - sb.start;
    let l1 = length(d1);
    let l2 = length(d2);
    if l1 > 0.0001 && l2 > 0.0001 {
        let axis = d1 / l1;
        if abs(dot(axis, d2 / l2)) > 0.999 {
            // Axial coordinates of each segment's ends along `axis`.
            let a0 = dot(sa.start, axis);
            let a1 = dot(sa.end, axis);
            let b0 = dot(sb.start, axis);
            let b1 = dot(sb.end, axis);
            let lo = max(min(a0, a1), min(b0, b1));
            let hi = min(max(a0, a1), max(b0, b1));
            if lo < hi {
                // Middle of the shared axial range, projected back onto
                // each segment's own axis direction.
                let mid = (lo + hi) * 0.5;
                let da = d1 / l1;
                let db = d2 / l2;
                points = SegmentPoints {
                    on_first: sa.start + da * ((mid - a0) / dot(da, axis)),
                    on_second: sb.start + db * ((mid - b0) / dot(db, axis)),
                };
            }
        }
    }
    let d = points.on_second - points.on_first;
    let dist = length(d);
    let radii = a.radius + b.radius;
    if dist >= radii { return Contact { .. }; }
    var normal = float3 { 0.0, 1.0, 0.0 };
    if dist > 0.0001 { normal = d / dist; }
    let point = (points.on_first + normal * a.radius + points.on_second - normal * b.radius) * 0.5;
    return Contact { normal: normal, point: point, penetration: radii - dist, hit: true };
}

// Capsule against sphere. The normal points from the capsule toward the
// sphere: from the closest point on the capsule's axis to the sphere
// center. The contact point is the midpoint of the surface points.
fn physics_capsule_sphere_contact(c: PhysicsBody&, s: PhysicsBody&) -> Contact {
    let q = closest_on_segment(s.position, physics_capsule_segment(c));
    let d = s.position - q;
    let dist = length(d);
    let radii = c.radius + s.radius;
    if dist >= radii { return Contact { .. }; }
    var normal = float3 { 0.0, 1.0, 0.0 };
    if dist > 0.0001 { normal = d / dist; }
    let point = (q + normal * c.radius + s.position - normal * s.radius) * 0.5;
    return Contact { normal: normal, point: point, penetration: radii - dist, hit: true };
}

// Closest point on the oriented box to world point `p`: the box clamp is
// done in its local frame.
fn physics_box_surface(b: PhysicsBody&, p: float3) -> float3 {
    let local = physics_box_local(b, p);
    let he = b.half_extents;
    return physics_box_offset(b, float3 {
        clamp(local.x, -he.x, he.x),
        clamp(local.y, -he.y, he.y),
        clamp(local.z, -he.z, he.z),
    });
}

// Capsule against oriented box. The segment and the box are both convex,
// so alternating projections converge on the closest point pair; sixteen
// rounds is ample for the contacts this solver sees. The returned normal
// pushes the capsule out of the box, and the contact point is the
// midpoint of the surface points.
fn physics_capsule_box_contact(c: PhysicsBody&, b: PhysicsBody&) -> Contact {
    let seg = physics_capsule_segment(c);
    var p_seg = closest_on_segment(b.position, seg);
    for i in 0..16 {
        let p_box = physics_box_surface(b, p_seg);
        p_seg = closest_on_segment(p_box, seg);
    }
    let p_box = physics_box_surface(b, p_seg);
    let d = p_seg - p_box;
    let dist = length(d);
    if dist >= c.radius { return Contact { .. }; }
    var normal = float3 { 0.0, 1.0, 0.0 };
    var penetration = c.radius - dist;
    if dist > 0.0001 {
        normal = d / dist;
    } else {
        // Deep overlap with no surface direction: exit along the local
        // axis of least penetration, like the sphere-inside-box case.
        let local = physics_box_local(b, c.position);
        let escaped, depth = physics_escape_axis(local, b.half_extents, c.radius);
        normal = physics_body_to_world(b, escaped);
        penetration = depth;
    }
    let point = (p_box + p_seg - normal * c.radius) * 0.5;
    return Contact { normal: normal, point: point, penetration: penetration, hit: true };
}

// The sphere/capsule helpers return the push direction — from the other
// shape toward the rounded one — so the a→b normal needs flipping when
// the rounded body is a. Misses pass through untouched.
fn physics_contact_flipped(c: Contact) -> Contact {
    if !c.hit { return c; }
    return Contact { normal: float3 { -c.normal.x, -c.normal.y, -c.normal.z },
                     point: c.point, penetration: c.penetration, hit: true };
}

fn physics_contact(a: PhysicsBody&, b: PhysicsBody&) -> Contact {
    let ka = physics_kind(a);
    let kb = physics_kind(b);
    if ka == kb {
        if ka == 0 { return physics_box_contact(a, b); }
        if ka == 1 { return physics_spheres_contact(a, b); }
        return physics_capsules_contact(a, b);
    }
    if ka == 1 && kb == 0 { return physics_contact_flipped(physics_sphere_box_contact(a, b)); }
    if ka == 0 && kb == 1 { return physics_sphere_box_contact(b, a); }
    if ka == 2 && kb == 1 { return physics_capsule_sphere_contact(a, b); }
    if ka == 1 && kb == 2 { return physics_contact_flipped(physics_capsule_sphere_contact(b, a)); }
    if ka == 2 && kb == 0 { return physics_contact_flipped(physics_capsule_box_contact(a, b)); }
    // ka == 0 && kb == 2
    return physics_capsule_box_contact(b, a);
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
    if a.removed || b.removed ||
       !node_handle_valid(a.node) || !node_handle_valid(b.node) { return; }

    // Broadphase: world-AABB reject before any contact math.
    let d = b.position - a.position;
    if abs(d.x) > a.bounds.x + b.bounds.x ||
       abs(d.y) > a.bounds.y + b.bounds.y ||
       abs(d.z) > a.bounds.z + b.bounds.z { return; }

    // Pairs where neither side can move — static, kinematic and sleeping
    // bodies all contribute zero effective inverse mass — can never need
    // resolution, and never produced a contact record anyway. The one
    // exception is a moving kinematic body: it must still reach a sleeping
    // partner so the impact can wake it.
    let im_a0 = if a.sleeping { 0.0 } else { a.inverse_mass };
    let im_b0 = if b.sleeping { 0.0 } else { b.inverse_mass };
    if im_a0 + im_b0 <= 0.0 &&
       !(a.kinematic && length(a.velocity) > 0.0001) &&
       !(b.kinematic && length(b.velocity) > 0.0001) { return; }

    physics_contact_manifold(a, b, g_physics_manifold);
    if g_physics_manifold.count == 0 { return; }
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
    if im_a + im_b <= 0.0 { return; }

    // Contact query reports the deepest manifold point.
    var deepest = 0;
    for k in 1..g_physics_manifold.count {
        if g_physics_manifold.penetrations[k] > g_physics_manifold.penetrations[deepest] {
            deepest = k;
        }
    }
    g_physics_contacts.push(BodyContact { a: a_id, b: b_id, normal: normal,
        point: g_physics_manifold.points[deepest],
        penetration: g_physics_manifold.penetrations[deepest] });

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
        let seed_n, _ = physics_warm_lookup(a_id, b_id, k);

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
        if max_delta < 0.001 { break; }
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
        g_warm_tab[idx].lambda_t = c.lambda_t;
    }
    g_physics_solver.clear();
}

// Result of physics_raycast: the nearest body hit along the ray.
// `normal` is the surface normal facing the ray origin.
struct PhysicsRayHit {
    hit: bool = false,
    body: i64 = -1,
    point: float3 = float3_0,
    normal: float3 = float3_0,
    distance: f32 = 0.0,
}

// Ray against a sphere: exact quadratic. A ray starting inside reports a
// hit at distance 0 with the normal pointing from the center to the origin.
fn physics_ray_sphere(origin: float3, dir: float3, b: PhysicsBody&, max_dist: f32) -> PhysicsRayHit {
    let oc = origin - b.position;
    let half_b = dot(dir, oc);
    let c = dot(oc, oc) - b.radius * b.radius;
    let disc = half_b * half_b - c;
    if disc < 0.0 { return PhysicsRayHit { .. }; }
    var t = -half_b - sqrt(disc);
    let inside = t < 0.0;
    if inside { t = 0.0; }
    if t > max_dist { return PhysicsRayHit { .. }; }
    let point = origin + dir * t;
    var normal: float3;
    if inside {
        let off = point - b.position;
        let off_len = length(off);
        normal = if off_len > 0.0001 { off / off_len } else { -dir };
    } else {
        normal = (point - b.position) / b.radius;
    }
    return PhysicsRayHit { hit: true, point: point, normal: normal, distance: t, .. };
}

// One axis of the box slab test: tightens the entry/exit distances and
// reports whether this axis set the entry (for the face normal) or the
// ray misses outright because it starts outside a parallel slab.
struct RaySlabClip {
    t_enter: f32,
    t_exit: f32,
    entered: bool = false,
    miss: bool = false,
}

fn physics_ray_clip_axis(o: f32, d: f32, c: f32, he: f32, t_enter: f32, t_exit: f32) -> RaySlabClip {
    if abs(d) < 0.0000001 {
        if o < c - he || o > c + he {
            return RaySlabClip { t_enter: t_enter, t_exit: t_exit, miss: true, .. };
        }
        return RaySlabClip { t_enter: t_enter, t_exit: t_exit, .. };
    }
    var t1 = (c - he - o) / d;
    var t2 = (c + he - o) / d;
    if t1 > t2 { let tmp = t1; t1 = t2; t2 = tmp; }
    var clip = RaySlabClip { t_enter: t_enter, t_exit: t_exit, .. };
    if t1 > clip.t_enter { clip.t_enter = t1; clip.entered = true; }
    if t2 < clip.t_exit { clip.t_exit = t2; }
    return clip;
}

// Ray against an oriented box: the slab test runs in the box's local
// frame, where the box is axis-aligned again. Rotation preserves
// distances, so `t` values carry over unchanged; the entry face normal is
// rotated back to world. A ray starting inside reports distance 0 with
// -dir as normal.
fn physics_ray_box(origin: float3, dir: float3, b: PhysicsBody&, max_dist: f32) -> PhysicsRayHit {
    let local_origin = physics_world_to_body(b, origin - b.position);
    let local_dir = physics_world_to_body(b, dir);
    let he = b.half_extents;
    let oo: f32[3] = [local_origin.x, local_origin.y, local_origin.z];
    let dd: f32[3] = [local_dir.x, local_dir.y, local_dir.z];
    let cc: f32[3] = [0.0, 0.0, 0.0];
    let hh: f32[3] = [he.x, he.y, he.z];
    var t_enter: f32 = -max_dist;
    var t_exit: f32 = max_dist;
    var enter_axis: i64 = -1;
    for axis in 0..3 {
        let clip = physics_ray_clip_axis(oo[axis], dd[axis], cc[axis], hh[axis], t_enter, t_exit);
        if clip.miss { return PhysicsRayHit { .. }; }
        t_enter = clip.t_enter;
        t_exit = clip.t_exit;
        if clip.entered { enter_axis = axis; }
    }

    if t_exit < t_enter || t_exit < 0.0 { return PhysicsRayHit { .. }; }
    let distance = max(t_enter, 0.0);
    var normal: float3;
    if t_enter < 0.0 {
        // Inside the box: face the ray back the way it came.
        normal = -dir;
    } else if enter_axis >= 0 {
        // Local entry axis, sign by travel direction along it, to world.
        var local_n = float3 { 0.0, 0.0, 0.0 };
        if enter_axis == 0 { local_n.x = if dd[0] > 0.0 { -1.0 } else { 1.0 }; }
        if enter_axis == 1 { local_n.y = if dd[1] > 0.0 { -1.0 } else { 1.0 }; }
        if enter_axis == 2 { local_n.z = if dd[2] > 0.0 { -1.0 } else { 1.0 }; }
        normal = physics_body_to_world(b, local_n);
    } else {
        normal = -dir;
    }
    return PhysicsRayHit { hit: true, point: origin + dir * distance, normal: normal, distance: distance, .. };
}

// Ray against a capsule: a ray hits the capsule exactly when its distance
// to the axis segment is under the radius, so reuse the segment-segment
// closest-point routine with the ray as one segment. The reported distance
// backs off from the closest approach by the surface clearance along the
// ray; for grazing angles this is a good approximation, not exact.
fn physics_ray_capsule(origin: float3, dir: float3, b: PhysicsBody&, max_dist: f32) -> PhysicsRayHit {
    let ray_seg = Segment { start: origin, end: origin + dir * max_dist };
    let points = segment_segment_closest(ray_seg, physics_capsule_segment(b));
    let d = points.on_first - points.on_second;
    let dist = length(d);
    if dist >= b.radius { return PhysicsRayHit { .. }; }
    let along = dot(points.on_first - origin, dir);
    if along < 0.0 || along > max_dist { return PhysicsRayHit { .. }; }
    var normal: float3;
    if dist > 0.0001 {
        normal = d / dist;
    } else {
        // The ray passes through the axis: any perpendicular works, so
        // face back along the ray.
        normal = -dir;
    }
    let clearance = sqrt(max(b.radius * b.radius - dist * dist, 0.0));
    let distance = max(along - clearance, 0.0);
    return PhysicsRayHit { hit: true, point: origin + dir * distance, normal: normal, distance: distance, .. };
}

// Cast a ray against every live body and return the nearest hit. `dir`
// need not be normalized; `max_dist` is measured in world units along it.
// Removed bodies and bodies whose node is gone are skipped.
fn physics_raycast(origin: float3, direction: float3, max_dist: f32) -> PhysicsRayHit {
    return physics_raycast_filtered(origin, direction, max_dist, -1);
}

// physics_raycast with one body excluded — `exclude` is a body id, or -1
// to test every live body. Used for self-hits (a character's own
// collider, a projectile's shooter).
fn physics_raycast_filtered(origin: float3, direction: float3, max_dist: f32, exclude: i64) -> PhysicsRayHit {
    let dir_len = length(direction);
    guard dir_len > 0.0001 && max_dist > 0.0 else { return PhysicsRayHit { .. }; }
    let dir = direction / dir_len;
    var best = PhysicsRayHit { .. };
    for i in 0..g_physics_bodies.len {
        if i == exclude { continue; }
        let body .= g_physics_bodies[i];
        if body.removed || !node_handle_valid(body.node) { continue; }
        var hit = PhysicsRayHit { .. };
        let kind = physics_kind(body);
        if kind == 0 { hit = physics_ray_box(origin, dir, body, max_dist); }
        else if kind == 1 { hit = physics_ray_sphere(origin, dir, body, max_dist); }
        else { hit = physics_ray_capsule(origin, dir, body, max_dist); }
        if hit.hit && (!best.hit || hit.distance < best.distance) {
            best = hit;
            best.body = i;
        }
    }
    return best;
}
