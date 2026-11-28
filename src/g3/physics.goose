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
//
// The module is split by concern across sibling files in this namespace:
// this file owns bodies, their lifecycle and the node pose bridge;
// g3.physics_solver owns stepping, integration, broadphase and the
// sequential-impulse solve; g3.physics_contacts owns narrowphase contact
// detection; g3.physics_query owns the contact and raycast read API.
// All symbols stay in namespace g3, so `import g3.physics` is unchanged.

import std;
import vec;
import math;
import g3.math;
import g3.scene;
import g3.physics_solver;
import g3.physics_contacts;
import g3.physics_query;
import g3.physics_joints;

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
    // Collider volume in cubic units — drives buoyancy when a water
    // level is set. Mass stays user-chosen, so the effective density is
    // mass / volume.
    volume: f32 = 0.0,
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
    // Conservative world-space half extents of the collider. Refreshed in
    // the substep only for bodies that integrated or had bounds_dirty set
    // (teleports, node syncs) — static bodies at rest keep theirs. The
    // pair loop rejects on these before any contact math runs — the
    // broadphase.
    bounds: float3 = float3_0,
    bounds_dirty: bool = true,
}

var g_physics_bodies: PhysicsBody[>..];
var g_physics_gravity: float3 = float3 { 0.0, -9.81, 0.0 };
// Water surface height on world Y; bodies below it get buoyancy and
// drag. The -1e30 sentinel disables water entirely.
var g_physics_water_y: f32 = -1.0e30;
// Density of the water in kg/m^3-equivalent units, and linear drag
// rates (per second at full submersion) applied to velocity and spin.
const PHYSICS_WATER_DENSITY: f32 = 1000.0;
const PHYSICS_WATER_DRAG: f32 = 6.0;
const PHYSICS_WATER_ANG_DRAG: f32 = 8.0;
// Righting moment strength (rad/s^2 at full submersion and 90 degrees of
// tilt): real floaters level out because buoyancy acts across the
// submerged volume, not at the center of mass. Approximated here as an
// angular acceleration rotating the body's local +Y toward the buoyancy
// direction (-gravity).
const PHYSICS_WATER_RIGHTING: f32 = 3.0;

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
    g_contact_tab.clear();
    g_contact_mask = 0;
    g_contact_used = 0;
    g_contact_dead = 0;
    g_physics_order.clear();
    g_physics_solver.clear();
    g_warm_tab.clear();
    g_warm_mask = 0;
    g_physics_joints.clear();
    g_physics_steps = 0;
}

// Collider volume for buoyancy: box 8·hx·hy·hz, sphere 4/3·π·r³, capsule
// cylinder plus two caps — same decomposition physics_shape_inertia uses.
fn physics_shape_volume(he: float3, radius: f32, half_length: f32) -> f32 {
    let kind = if radius <= 0.0 { 0 } else { if half_length > 0.0 { 2 } else { 1 } };
    if kind == 0 { return 8.0 * he.x * he.y * he.z; }
    if kind == 1 { return 4.188790205 * radius * radius * radius; }
    return 6.283185307 * radius * radius * half_length +
           4.188790205 * radius * radius * radius;
}

// World-space half-height of the collider along Y, from the orientation —
// same column-of-|R| math physics_update_bounds uses, computed on demand
// so it is valid before the first bounds refresh.
fn physics_world_half_height(b: PhysicsBody&) -> f32 {
    let kind = physics_kind(b);
    if kind == 1 { return b.radius; }
    let m = b.orientation.m;
    if kind == 2 { return b.radius + abs(m[5]) * b.half_length; }
    let he = b.half_extents;
    return he.x * abs(m[1]) + he.y * abs(m[5]) + he.z * abs(m[9]);
}

// Fraction of the collider's volume below the water surface. Spheres get
// the exact submerged-cap fraction; boxes and capsules use a linear
// approximation across their world-Y extent (uniform density assumed).
fn physics_submerged_fraction(b: PhysicsBody&) -> f32 {
    let wy = g_physics_water_y;
    if physics_kind(b) == 1 {
        // h = submerged cap height measured up from the sphere's bottom.
        let h = clamp(wy - (b.position.y - b.radius), 0.0, 2.0 * b.radius);
        let r = b.radius;
        return h * h * (3.0 * r - h) / (4.0 * r * r * r);
    }
    let hh = physics_world_half_height(b);
    if hh <= 0.0001 { return 0.0; }
    let t = clamp(wy - (b.position.y - hh), 0.0, 2.0 * hh);
    return t / (2.0 * hh);
}

// Buoyancy and hydrodynamic drag for one dynamic body this substep.
// Buoyancy is the weight of displaced water as an acceleration —
// -gravity * (rho_water / rho_body) * submerged_fraction — applied at the
// center of mass, plus a righting moment that levels the body's local +Y
// toward the buoyancy direction. Drag is linear in velocity and spin,
// scaled by submersion.
fn physics_apply_water(b: PhysicsBody&, dt: f32) {
    let frac = physics_submerged_fraction(b);
    if frac <= 0.0 { return; }
    let gmag = length(g_physics_gravity);
    if gmag > 0.0001 {
        if b.mass > 0.0 {
            // rho_body = mass / volume, so rho_w / rho_body = rho_w * volume / mass.
            let buoy = PHYSICS_WATER_DENSITY * b.volume / b.mass * frac * gmag;
            b.velocity += (-g_physics_gravity / gmag) * buoy * dt;
        }
        // Righting: spin about cross(up, buoyancy-up) — the axis that
        // rotates the body's local +Y (orientation column 1) toward
        // -gravity. Saturates for large tilts so near-inverted bodies do
        // not get an impulsive snap.
        let buoy_up = -g_physics_gravity / gmag;
        let m = b.orientation.m;
        let axis = cross(float3 { m[4], m[5], m[6] }, buoy_up);
        let s = length(axis);
        if s > 0.001 {
            let alpha = PHYSICS_WATER_RIGHTING * frac * min(s * 4.0, 1.0);
            b.angular_velocity += (axis / s) * alpha * dt;
        }
    }
    let kd = PHYSICS_WATER_DRAG * frac * dt;
    let ka = PHYSICS_WATER_ANG_DRAG * frac * dt;
    if kd > 0.0 { b.velocity *= max(1.0 - kd, 0.0); }
    if ka > 0.0 { b.angular_velocity *= max(1.0 - ka, 0.0); }
}

// Water surface height on world Y; -1e30 disables. Physics_apply_water
// runs per substep for awake dynamic bodies.
fn physics_set_water_level(y: f32) { g_physics_water_y = y; }

fn physics_water_level() -> f32 { return g_physics_water_y; }

fn physics_clear_water() { g_physics_water_y = -1.0e30; }

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
        volume: physics_shape_volume(half_extents, radius, half_length),
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
    physics_contacts_forget_body(id);
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
    body.bounds_dirty = true;
    physics_wake(body);
    return true;
}

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
