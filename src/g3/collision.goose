// Swept-shape overlap queries shared by picking, physics and gameplay code.
import vec;
import math;
import g3.math;

namespace g3;

// Does the segment start→end come within `radius` of `center`?
// Expand the target by the projectile radius.
fn segment_sphere_intersects(start: float3, end: float3, center: float3, radius: f32) -> bool {
    guard radius >= 0.0 else { return false; }
    let delta = end - start;
    let squared = dot(delta, delta);
    let t = if squared > 0.0 { max(0.0, min(1.0, dot(center - start, delta) / squared)) } else { 0.0 };
    let offset = start + delta * t - center;
    return dot(offset, offset) <= radius * radius;
}

// One axis of the slab test: clip [tmin, tmax] to where the segment crosses
// [lo, hi] on this axis. Returns false once the interval is empty.
fn segment_slab_axis(s: f32, d: f32, lo: f32, hi: f32, tmin: f32&, tmax: f32&) -> bool {
    if d == 0.0 { return s >= lo && s <= hi; }
    var t1 = (lo - s) / d;
    var t2 = (hi - s) / d;
    if t1 > t2 { let tmp = t1; t1 = t2; t2 = tmp; }
    if t1 > tmin { tmin = t1; }
    if t2 < tmax { tmax = t2; }
    return tmin <= tmax;
}

// Does the segment start→end touch the box? Slab method: the segment is
// clipped against each axis's slab and survives if any t in [0, 1] remains.
// Unlike a ray test there is no direction to normalize — d is the full
// segment delta, so t is already in segment-parameter space.
fn segment_aabb_intersects(start: float3, end: float3, b: Aabb) -> bool {
    if aabb_is_empty(b) { return false; }
    let d = end - start;
    var tmin: f32 = 0.0;
    var tmax: f32 = 1.0;
    if !segment_slab_axis(start.x, d.x, b.lo.x, b.hi.x, tmin, tmax) { return false; }
    if !segment_slab_axis(start.y, d.y, b.lo.y, b.hi.y, tmin, tmax) { return false; }
    if !segment_slab_axis(start.z, d.z, b.lo.z, b.hi.z, tmin, tmax) { return false; }
    return true;
}
