// Swept sphere overlap; expand the target by the projectile radius.
import vec;
import math;
namespace g3;
fn segment_sphere_intersects(start: float3, end: float3, center: float3, radius: f32) -> bool {
    guard radius >= 0.0 else { return false; }
    let delta = end - start;
    let squared = dot(delta, delta);
    let t = if squared > 0.0 { max(0.0, min(1.0, dot(center - start, delta) / squared)) } else { 0.0 };
    let offset = start + delta * t - center;
    return dot(offset, offset) <= radius * radius;
}
