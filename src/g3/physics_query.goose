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

// A contact recorded by the solver: one entry per body pair, kept across
// steps so resting and sleeping overlaps persist instead of being
// re-detected every substep. `a` and `b` are body ids in detection
// order, `normal` points from body a toward body b, `point` is the
// world-space contact point (midpoint of the two surface points) and
// `penetration` is the overlap depth at detection. `pkey` is the
// canonical unordered-pair key used by the contact hash.
struct BodyContact {
    a: i64,
    b: i64,
    normal: float3 = float3_0,
    point: float3 = float3_0,
    penetration: f32 = 0.0,
    pkey: i64 = 0,
}

var g_physics_contacts: BodyContact[>..];

// Contacts detected by the solver, one entry per body pair whose
// colliders overlap — including pairs where both bodies sleep, whose
// frozen poses keep the record valid without re-detection.
fn physics_contact_count() -> i64 { return g_physics_contacts.len; }

fn physics_contact(id: i64) -> BodyContact& { return g_physics_contacts[id]; }

// Open-addressed pair-key -> contact-index table backing the persistent
// contact store. key == 0 is empty, key == -1 a tombstone left by
// physics_contact_forget; entries are rehashed (dropping tombstones)
// when the table passes ~70% load.
struct ContactSlot {
    key: i64 = 0,
    index: i64 = -1,
}

var g_contact_tab: ContactSlot[>..];
var g_contact_mask: i64 = 0;
var g_contact_used: i64 = 0;
var g_contact_dead: i64 = 0;

fn physics_contact_hash(key: i64, cap: i64) -> i64 {
    // Fold the 2^36-spaced key into a machine-word mix before taking the
    // low bits — key % cap alone would only see `hi`.
    var h = (key / 68719476736) * 31 + key % 68719476736;
    h = (h * 31 + key / 1099511627776) % cap;
    return h;
}

fn physics_contact_slot_find(key: i64) -> i64 {
    if g_contact_mask <= 0 { return -1; }
    let cap = g_contact_mask + 1;
    var idx = physics_contact_hash(key, cap);
    for _ in 0..cap {
        let s = g_contact_tab[idx];
        if s.key == 0 { return -1; }
        if s.key == key { return idx; }
        idx = (idx + 1) % cap;
    }
    return -1;
}

fn physics_contact_tab_insert(key: i64, index: i64) {
    let cap = g_contact_mask + 1;
    var idx = physics_contact_hash(key, cap);
    for _ in 0..cap {
        if g_contact_tab[idx].key == 0 {
            g_contact_tab[idx].key = key;
            g_contact_tab[idx].index = index;
            g_contact_used += 1;
            return;
        }
        idx = (idx + 1) % cap;
    }
}

// Double the table and reinsert every live contact — also the only way
// tombstones are reclaimed.
fn physics_contact_tab_grow() {
    let cap = if g_contact_mask <= 0 { 64 } else { (g_contact_mask + 1) * 2 };
    g_contact_tab.clear();
    for _ in 0..cap { g_contact_tab.push(ContactSlot { .. }); }
    g_contact_mask = cap - 1;
    g_contact_used = 0;
    g_contact_dead = 0;
    for i in 0..g_physics_contacts.len {
        physics_contact_tab_insert(g_physics_contacts[i].pkey, i);
    }
}

fn physics_contact_tab_maybe_grow() {
    if g_contact_mask <= 0 ||
       (g_contact_used + g_contact_dead + 1) * 10 > (g_contact_mask + 1) * 7 {
        physics_contact_tab_grow();
    }
}

// Drop the contact record for a pair whose colliders no longer overlap
// (or can no longer be observed). Swap-with-last keeps the array dense;
// the moved record's hash slot is repointed at its new index.
fn physics_contact_forget(key: i64) {
    let slot = physics_contact_slot_find(key);
    if slot < 0 { return; }
    let ci = g_contact_tab[slot].index;
    let last = g_physics_contacts.len - 1;
    if ci != last {
        g_physics_contacts[ci] = g_physics_contacts[last];
        let midx = physics_contact_slot_find(g_physics_contacts[ci].pkey);
        if midx >= 0 { g_contact_tab[midx].index = ci; }
    }
    g_physics_contacts.pop();
    g_contact_tab[slot].key = -1;
    g_contact_tab[slot].index = -1;
    g_contact_used -= 1;
    g_contact_dead += 1;
}

// Record (or refresh) the contact for a pair. Called once per detected
// overlap per substep; sleeping pairs skip detection entirely while
// their record exists, so this runs for awake and newly-sleeping pairs.
fn physics_contact_record(key: i64, c: BodyContact) {
    let slot = physics_contact_slot_find(key);
    if slot >= 0 {
        g_physics_contacts[g_contact_tab[slot].index] = c;
        return;
    }
    physics_contact_tab_maybe_grow();
    g_physics_contacts.push(c);
    physics_contact_tab_insert(key, g_physics_contacts.len - 1);
}

// Remove every contact involving a body — called when the body is
// tombstoned, since removed bodies leave the broadphase sweep and their
// pairs would never be re-detected to trigger physics_contact_forget.
fn physics_contacts_forget_body(id: i64) {
    var i: i64 = 0;
    while i < g_physics_contacts.len {
        let c = g_physics_contacts[i];
        if c.a == id || c.b == id { physics_contact_forget(c.pkey); }
        else { i += 1; }
    }
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
