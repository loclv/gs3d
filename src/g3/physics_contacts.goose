// Narrowphase contact detection for g3.physics.
//
// Every shape pair reduces to a Contact { normal, point, penetration }:
// oriented boxes run a 15-axis SAT and clip face contacts into manifolds,
// spheres and capsules use segment/closest-point maths, and the dispatch
// flips normals so `normal` always points from body a toward body b.

import vec;
import math;
import g3.physics;

namespace g3;

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
