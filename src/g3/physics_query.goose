// Read-side queries for g3.physics.
//
// physics_contact_count/physics_contact expose the contacts detected
// during the last step; physics_raycast/physics_raycast_filtered cast a
// ray against every live body and return the nearest hit.

import vec;
import math;
import g3.scene;
import g3.physics;

namespace g3;

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

// Contacts detected during the last physics_step, one entry per substep
// pair overlap, in pair order.
fn physics_contact_count() -> i64 { return g_physics_contacts.len; }

fn physics_contact(id: i64) -> BodyContact& { return g_physics_contacts[id]; }

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
