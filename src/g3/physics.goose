// Small 3D rigid-body physics for scene nodes.
//
// This module uses axis-aligned box, sphere and capsule colliders. A mass of
// zero makes a body static; dynamic bodies use semi-implicit Euler
// integration and an impulse response when their shapes overlap. It is
// intended for simple game motion, not as a general-purpose solver.

import vec;
import math;
import g3.scene;

namespace g3;

struct PhysicsBody {
    node: NodeHandle,
    position: float3,
    velocity: float3,
    force: float3,
    half_extents: float3 = float3 { 0.5, 0.5, 0.5 },
    // Collider radius; zero means the body is an axis-aligned box.
    radius: f32 = 0.0,
    // Capsule cylinder half-length (center to cap center) along world Y;
    // zero with a positive radius means a sphere.
    half_length: f32 = 0.0,
    mass: f32,
    inverse_mass: f32,
    restitution: f32 = 0.0,
    friction: f32 = 0.5,
    // Kinematic bodies follow their velocity exactly — no gravity, forces
    // or impulses — but still push dynamic bodies out of the way.
    kinematic: bool = false,
    // Removed bodies keep their slot so ids stay stable, like materials
    // and cameras; they no longer integrate or collide.
    removed: bool = false,
}

var g_physics_bodies: PhysicsBody[>..];
var g_physics_gravity: float3 = float3 { 0.0, -9.81, 0.0 };

// A contact recorded during the last physics_step: one entry per substep
// pair overlap. `a` and `b` are body ids and `normal` points from body a
// toward body b; `penetration` is the overlap depth at detection.
struct BodyContact {
    a: i64,
    b: i64,
    normal: float3 = float3_0,
    penetration: f32 = 0.0,
}

var g_physics_contacts: BodyContact[>..];

fn physics_body_count() -> i64 { return g_physics_bodies.len; }

fn physics_body(id: i64) -> PhysicsBody& { return g_physics_bodies[id] }

// Live-body check shared by every public accessor: in range and not a
// removal tombstone.
fn physics_body_valid(id: i64) -> bool {
    return id >= 0 && id < g_physics_bodies.len && !g_physics_bodies[id].removed;
}

// inverse_mass follows mass and kinematic mode: static (mass 0) and
// kinematic bodies are immovable as far as the solver is concerned.
fn physics_refresh_inverse_mass(body: PhysicsBody&) {
    body.inverse_mass = if body.kinematic || body.mass == 0.0 { 0.0 } else { 1.0 / body.mass };
}

fn physics_clear() { g_physics_bodies.clear(); g_physics_contacts.clear(); }

fn physics_set_gravity(gravity: float3) { g_physics_gravity = gravity; }

fn physics_body_add_shape(node_id: i64, half_extents: float3, radius: f32, half_length: f32, mass: f32) -> i64 {
    guard node_id >= 0 && node_id < node_count() &&
          half_extents.x > 0.0 && half_extents.y > 0.0 && half_extents.z > 0.0 &&
          radius >= 0.0 && half_length >= 0.0 && mass >= 0.0 && mass <= 3.4e38 else { return -1; }
    let handle = node_handle(node_id);
    guard node_handle_valid(handle) else { return -1; }
    let position = node(node_id).pos;
    g_physics_bodies.push(PhysicsBody {
        node: handle,
        position: position,
        half_extents: half_extents,
        radius: radius,
        half_length: half_length,
        mass: mass,
        inverse_mass: if mass == 0.0 { 0.0 } else { 1.0 / mass },
        ..
    });
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
    physics_refresh_inverse_mass(body);
    return true;
}

// Kinematic bodies follow their velocity exactly — no gravity, forces or
// impulses — but still push dynamic bodies out of the way. This is the
// Rapier RigidBodyType.KinematicPositionBased analogue.
fn physics_body_set_kinematic(id: i64, kinematic: bool) -> bool {
    guard physics_body_valid(id) else { return false; }
    let body .= g_physics_bodies[id];
    body.kinematic = kinematic;
    physics_refresh_inverse_mass(body);
    if kinematic { body.force = float3_0; }
    return true;
}

// Copy the node's current position into the body. Gameplay code that moves
// a node directly — teleports, character controllers — needs this, or the
// body keeps its own position and the next physics_step writes the stale
// one back onto the node.
fn physics_body_sync(id: i64) -> bool {
    guard physics_body_valid(id) && node_handle_valid(g_physics_bodies[id].node) else { return false; }
    let body .= g_physics_bodies[id];
    body.position = node(body.node.index).pos;
    return true;
}

// Contacts detected during the last physics_step, one entry per substep
// pair overlap, in pair order.
fn physics_contact_count() -> i64 { return g_physics_contacts.len; }

fn physics_contact(id: i64) -> BodyContact& { return g_physics_contacts[id]; }

// Add a force for the next step. Forces are cleared after each step.
fn physics_apply_force(id: i64, force: float3) -> bool {
    guard physics_body_valid(id) && g_physics_bodies[id].inverse_mass > 0.0 else { return false; }
    g_physics_bodies[id].force += force;
    return true;
}

fn physics_body_set_velocity(id: i64, velocity: float3) -> bool {
    guard physics_body_valid(id) else { return false; }
    g_physics_bodies[id].velocity = velocity;
    return true;
}

// Advance the simulation by seconds. Break the frame into <= 1/60 second
// substeps to reduce tunneling and keep the collision response stable.
// Inputs above one second are rejected to bound work after a long pause.
fn physics_step(dt: f32) {
    guard dt > 0.0 && dt <= 1.0 else { return; }
    g_physics_contacts.clear();
    var remaining = dt;
    while remaining > 0.0 {
        let sub_dt = min(remaining, 1.0 / 60.0);
        physics_substep(sub_dt);
        remaining -= sub_dt;
    }

    for &body in g_physics_bodies { body.force = float3_0; }
    for &body in g_physics_bodies {
        if node_handle_valid(body.node) { node(body.node.index).pos = body.position; }
    }
}

fn physics_substep(dt: f32) {
    for &body in g_physics_bodies {
        if body.removed || !node_handle_valid(body.node) { continue; }
        if body.inverse_mass > 0.0 {
            body.velocity += (g_physics_gravity + body.force * body.inverse_mass) * dt;
            body.position += body.velocity * dt;
        } else if body.kinematic {
            body.position += body.velocity * dt;
        }
    }

    for i in 0..g_physics_bodies.len {
        for j in (i + 1)..g_physics_bodies.len {
            physics_resolve_pair(i, j);
        }
    }

}

// A detected overlap: `normal` points from body a toward body b and
// `penetration` is the depth to resolve along it.
struct Contact {
    normal: float3 = float3_0,
    penetration: f32 = 0.0,
    hit: bool = false,
}

// Box against box: the axis of least overlap is the contact normal.
fn physics_box_contact(a: PhysicsBody&, b: PhysicsBody&) -> Contact {
    let delta = b.position - a.position;
    let overlap_x = a.half_extents.x + b.half_extents.x - abs(delta.x);
    let overlap_y = a.half_extents.y + b.half_extents.y - abs(delta.y);
    let overlap_z = a.half_extents.z + b.half_extents.z - abs(delta.z);
    if overlap_x <= 0.0 || overlap_y <= 0.0 || overlap_z <= 0.0 { return Contact { .. }; }

    var normal = float3 { if delta.x < 0.0 { -1.0 } else { 1.0 }, 0.0, 0.0 };
    var penetration = overlap_x;
    if overlap_y < penetration {
        penetration = overlap_y;
        normal = float3 { 0.0, if delta.y < 0.0 { -1.0 } else { 1.0 }, 0.0 };
    }
    if overlap_z < penetration {
        penetration = overlap_z;
        normal = float3 { 0.0, 0.0, if delta.z < 0.0 { -1.0 } else { 1.0 } };
    }
    return Contact { normal: normal, penetration: penetration, hit: true };
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
    return Contact { normal: normal, penetration: radii - distance, hit: true };
}

// Sphere against box. The returned normal pushes the sphere out of the box:
// from the box toward the sphere for a surface contact, or along the axis of
// least penetration when the sphere center is inside the box.
fn physics_sphere_box_contact(s: PhysicsBody&, b: PhysicsBody&) -> Contact {
    let he = b.half_extents;
    let c = b.position;
    let p = s.position;
    let closest = float3 {
        clamp(p.x, c.x - he.x, c.x + he.x),
        clamp(p.y, c.y - he.y, c.y + he.y),
        clamp(p.z, c.z - he.z, c.z + he.z),
    };
    let d = p - closest;
    let dist_sq = dot(d, d);
    let radius_sq = s.radius * s.radius;
    if dist_sq > radius_sq { return Contact { .. }; }
    if dist_sq > 0.0000001 {
        let distance = sqrt(dist_sq);
        return Contact { normal: d / distance, penetration: s.radius - distance, hit: true };
    }

    // Center inside the box: exit along the axis where the sphere pokes out
    // least far past the face plus its own radius.
    let delta = p - c;
    var best = he.x + s.radius - abs(delta.x);
    var axis = 0;
    let overlap_y = he.y + s.radius - abs(delta.y);
    if overlap_y < best { best = overlap_y; axis = 1; }
    let overlap_z = he.z + s.radius - abs(delta.z);
    if overlap_z < best { best = overlap_z; axis = 2; }
    var normal = float3 { if delta.x < 0.0 { -1.0 } else { 1.0 }, 0.0, 0.0 };
    if axis == 1 { normal = float3 { 0.0, if delta.y < 0.0 { -1.0 } else { 1.0 }, 0.0 }; }
    if axis == 2 { normal = float3 { 0.0, 0.0, if delta.z < 0.0 { -1.0 } else { 1.0 } }; }
    return Contact { normal: normal, penetration: best, hit: true };
}

// Collider kinds for the contact dispatch: 0 box, 1 sphere, 2 capsule.
fn physics_kind(b: PhysicsBody&) -> i32 {
    if b.radius <= 0.0 { return 0; }
    if b.half_length > 0.0 { return 2; }
    return 1;
}

struct Segment { start: float3, end: float3 }

struct SegmentPoints { on_first: float3, on_second: float3 }

// A capsule's axis is world Y through its center; half_length runs from the
// center to each cap center.
fn physics_capsule_segment(b: PhysicsBody&) -> Segment {
    return Segment {
        start: b.position - float3 { 0.0, b.half_length, 0.0 },
        end: b.position + float3 { 0.0, b.half_length, 0.0 },
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

fn clamp_to_box(p: float3, c: float3, he: float3) -> float3 {
    return float3 {
        clamp(p.x, c.x - he.x, c.x + he.x),
        clamp(p.y, c.y - he.y, c.y + he.y),
        clamp(p.z, c.z - he.z, c.z + he.z),
    };
}

// Capsule against capsule: distance between the two axis segments.
fn physics_capsules_contact(a: PhysicsBody&, b: PhysicsBody&) -> Contact {
    let points = segment_segment_closest(physics_capsule_segment(a), physics_capsule_segment(b));
    let d = points.on_second - points.on_first;
    let dist = length(d);
    let radii = a.radius + b.radius;
    if dist >= radii { return Contact { .. }; }
    var normal = float3 { 0.0, 1.0, 0.0 };
    if dist > 0.0001 { normal = d / dist; }
    return Contact { normal: normal, penetration: radii - dist, hit: true };
}

// Capsule against sphere. The normal points from the capsule toward the
// sphere: from the closest point on the capsule's axis to the sphere center.
fn physics_capsule_sphere_contact(c: PhysicsBody&, s: PhysicsBody&) -> Contact {
    let q = closest_on_segment(s.position, physics_capsule_segment(c));
    let d = s.position - q;
    let dist = length(d);
    let radii = c.radius + s.radius;
    if dist >= radii { return Contact { .. }; }
    var normal = float3 { 0.0, 1.0, 0.0 };
    if dist > 0.0001 { normal = d / dist; }
    return Contact { normal: normal, penetration: radii - dist, hit: true };
}

// Capsule against box. The segment and the box are both convex, so
// alternating projections converge on the closest point pair; sixteen
// rounds is ample for the axis-aligned contacts this solver sees. The
// returned normal pushes the capsule out of the box.
fn physics_capsule_box_contact(c: PhysicsBody&, b: PhysicsBody&) -> Contact {
    let seg = physics_capsule_segment(c);
    var p_seg = closest_on_segment(b.position, seg);
    for i in 0..16 {
        let p_box = clamp_to_box(p_seg, b.position, b.half_extents);
        p_seg = closest_on_segment(p_box, seg);
    }
    let p_box = clamp_to_box(p_seg, b.position, b.half_extents);
    let d = p_seg - p_box;
    let dist = length(d);
    if dist >= c.radius { return Contact { .. }; }
    var normal = float3 { 0.0, 1.0, 0.0 };
    var penetration = c.radius - dist;
    if dist > 0.0001 {
        normal = d / dist;
    } else {
        // Deep overlap with no surface direction: exit along the axis of
        // least penetration, like the sphere-inside-box case.
        let delta = c.position - b.position;
        var best = b.half_extents.x + c.radius - abs(delta.x);
        var axis = 0;
        let overlap_y = b.half_extents.y + c.radius - abs(delta.y);
        if overlap_y < best { best = overlap_y; axis = 1; }
        let overlap_z = b.half_extents.z + c.radius - abs(delta.z);
        if overlap_z < best { best = overlap_z; axis = 2; }
        normal = float3 { if delta.x < 0.0 { -1.0 } else { 1.0 }, 0.0, 0.0 };
        if axis == 1 { normal = float3 { 0.0, if delta.y < 0.0 { -1.0 } else { 1.0 }, 0.0 }; }
        if axis == 2 { normal = float3 { 0.0, 0.0, if delta.z < 0.0 { -1.0 } else { 1.0 } }; }
        penetration = best;
    }
    return Contact { normal: normal, penetration: penetration, hit: true };
}

fn physics_contact(a: PhysicsBody&, b: PhysicsBody&) -> Contact {
    let ka = physics_kind(a);
    let kb = physics_kind(b);
    if ka == kb {
        if ka == 0 { return physics_box_contact(a, b); }
        if ka == 1 { return physics_spheres_contact(a, b); }
        return physics_capsules_contact(a, b);
    }
    // The sphere/capsule helpers return the push direction — from the other
    // shape toward the sphere or capsule — so it is the a→b normal only when
    // the shaped body is b; flip it when the shaped body is a.
    if ka == 1 && kb == 0 {
        let c = physics_sphere_box_contact(a, b);
        if !c.hit { return c; }
        return Contact { normal: float3 { -c.normal.x, -c.normal.y, -c.normal.z },
                         penetration: c.penetration, hit: true };
    }
    if ka == 0 && kb == 1 {
        let c = physics_sphere_box_contact(b, a);
        if !c.hit { return c; }
        return Contact { normal: c.normal, penetration: c.penetration, hit: true };
    }
    if ka == 2 && kb == 1 { return physics_capsule_sphere_contact(a, b); }
    if ka == 1 && kb == 2 {
        let c = physics_capsule_sphere_contact(b, a);
        if !c.hit { return c; }
        return Contact { normal: float3 { -c.normal.x, -c.normal.y, -c.normal.z },
                         penetration: c.penetration, hit: true };
    }
    if ka == 2 && kb == 0 {
        let c = physics_capsule_box_contact(a, b);
        if !c.hit { return c; }
        return Contact { normal: float3 { -c.normal.x, -c.normal.y, -c.normal.z },
                         penetration: c.penetration, hit: true };
    }
    // ka == 0 && kb == 2
    let c = physics_capsule_box_contact(b, a);
    if !c.hit { return c; }
    return Contact { normal: c.normal, penetration: c.penetration, hit: true };
}

fn physics_resolve_pair(a_id: i64, b_id: i64) {
    let a .= g_physics_bodies[a_id];
    let b .= g_physics_bodies[b_id];
    let inverse_mass_sum = a.inverse_mass + b.inverse_mass;
    if inverse_mass_sum <= 0.0 || a.removed || b.removed ||
       !node_handle_valid(a.node) || !node_handle_valid(b.node) { return; }

    let contact = physics_contact(a, b);
    if !contact.hit { return; }
    let normal = contact.normal;
    let penetration = contact.penetration;
    g_physics_contacts.push(BodyContact { a: a_id, b: b_id, normal: normal, penetration: penetration });

    // Move bodies apart, weighted by inverse mass, with a small slop to avoid
    // repeatedly correcting floating-point contact jitter.
    let correction = normal * (max(penetration - 0.001, 0.0) * 0.8 / inverse_mass_sum);
    a.position -= correction * a.inverse_mass;
    b.position += correction * b.inverse_mass;

    let relative_velocity = b.velocity - a.velocity;
    let velocity_along_normal = dot(relative_velocity, normal);
    if velocity_along_normal >= 0.0 { return; }
    let restitution = min(a.restitution, b.restitution);
    let impulse_magnitude = -(1.0 + restitution) * velocity_along_normal / inverse_mass_sum;
    let impulse = normal * impulse_magnitude;
    a.velocity -= impulse * a.inverse_mass;
    b.velocity += impulse * b.inverse_mass;

    let relative_after_normal = b.velocity - a.velocity;
    let tangent_velocity = relative_after_normal - normal * dot(relative_after_normal, normal);
    let tangent_speed = length(tangent_velocity);
    if tangent_speed <= 0.000001 { return; }
    let tangent = tangent_velocity / tangent_speed;
    let friction_magnitude = -dot(relative_after_normal, tangent) / inverse_mass_sum;
    let max_friction = impulse_magnitude * sqrt(a.friction * b.friction);
    let friction_scalar = clamp(friction_magnitude, -max_friction, max_friction);
    let friction_impulse = tangent * friction_scalar;
    a.velocity -= friction_impulse * a.inverse_mass;
    b.velocity += friction_impulse * b.inverse_mass;
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

// Ray against an axis-aligned box: slab test. The entry face supplies the
// normal; a ray starting inside reports distance 0 with -dir as normal.
fn physics_ray_box(origin: float3, dir: float3, b: PhysicsBody&, max_dist: f32) -> PhysicsRayHit {
    let c = b.position;
    let he = b.half_extents;
    var t_enter: f32 = -max_dist;
    var t_exit: f32 = max_dist;
    var enter_axis = -1;

    if abs(dir.x) < 0.0000001 {
        if origin.x < c.x - he.x || origin.x > c.x + he.x { return PhysicsRayHit { .. }; }
    } else {
        var t1 = (c.x - he.x - origin.x) / dir.x;
        var t2 = (c.x + he.x - origin.x) / dir.x;
        if t1 > t2 { let tmp = t1; t1 = t2; t2 = tmp; }
        if t1 > t_enter { t_enter = t1; enter_axis = 0; }
        if t2 < t_exit { t_exit = t2; }
    }
    if abs(dir.y) < 0.0000001 {
        if origin.y < c.y - he.y || origin.y > c.y + he.y { return PhysicsRayHit { .. }; }
    } else {
        var t1 = (c.y - he.y - origin.y) / dir.y;
        var t2 = (c.y + he.y - origin.y) / dir.y;
        if t1 > t2 { let tmp = t1; t1 = t2; t2 = tmp; }
        if t1 > t_enter { t_enter = t1; enter_axis = 1; }
        if t2 < t_exit { t_exit = t2; }
    }
    if abs(dir.z) < 0.0000001 {
        if origin.z < c.z - he.z || origin.z > c.z + he.z { return PhysicsRayHit { .. }; }
    } else {
        var t1 = (c.z - he.z - origin.z) / dir.z;
        var t2 = (c.z + he.z - origin.z) / dir.z;
        if t1 > t2 { let tmp = t1; t1 = t2; t2 = tmp; }
        if t1 > t_enter { t_enter = t1; enter_axis = 2; }
        if t2 < t_exit { t_exit = t2; }
    }

    if t_exit < t_enter || t_exit < 0.0 { return PhysicsRayHit { .. }; }
    let distance = max(t_enter, 0.0);
    var normal: float3;
    if t_enter < 0.0 {
        // Inside the box: face the ray back the way it came.
        normal = -dir;
    } else if enter_axis == 0 {
        normal = float3 { if dir.x > 0.0 { -1.0 } else { 1.0 }, 0.0, 0.0 };
    } else if enter_axis == 1 {
        normal = float3 { 0.0, if dir.y > 0.0 { -1.0 } else { 1.0 }, 0.0 };
    } else if enter_axis == 2 {
        normal = float3 { 0.0, 0.0, if dir.z > 0.0 { -1.0 } else { 1.0 } };
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
    let dir_len = length(direction);
    guard dir_len > 0.0001 && max_dist > 0.0 else { return PhysicsRayHit { .. }; }
    let dir = direction / dir_len;
    var best = PhysicsRayHit { .. };
    for i in 0..g_physics_bodies.len {
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
