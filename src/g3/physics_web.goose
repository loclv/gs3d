// WebAssembly exports for the Rapier-style physics facade.
//
// Thin wrappers over g3.rapier so the gs3d package (web/physics.js) can
// drive the same solver the native test roots exercise. Node arguments are
// engine node indices, matching g3_asset_node's return value. Read-back
// writes xyz into a caller-provided float slice (a HEAPF32 pointer plus
// length on the JS side).

import vec;
import g3.rapier;

// World controls.
export fn g3_phys_set_gravity(x: f32, y: f32, z: f32) { g3::rapier_set_gravity(float3 { x, y, z }); }
export fn g3_phys_clear() { g3::rapier_world_clear(); }
export fn g3_phys_set_timestep(seconds: f32) -> bool { return g3::rapier_set_timestep(seconds); }
export fn g3_phys_world_step() { g3::rapier_world_step(); }

// ColliderDesc shapes + RigidBodyDesc mass: 0 is fixed, positive is dynamic.
// Returns the body id, or -1 on bad arguments.
export fn g3_phys_body_cuboid(node: i32, hx: f32, hy: f32, hz: f32, mass: f32) -> i32 {
    return g3::rapier_body_add_cuboid(node, float3 { hx, hy, hz }, mass) as i32;
}
export fn g3_phys_body_ball(node: i32, radius: f32, mass: f32) -> i32 {
    return g3::rapier_body_add_ball(node, radius, mass) as i32;
}
export fn g3_phys_body_capsule(node: i32, half_length: f32, radius: f32, mass: f32) -> i32 {
    return g3::rapier_body_add_capsule(node, half_length, radius, mass) as i32;
}

// Body state. `out` must hold at least 3 floats; functions return false on
// a bad id or short slice and leave it untouched.
export fn g3_phys_body_pos(id: i32, out: f32[:]) -> bool {
    guard out.len >= 3 && id >= 0 && id < g3::physics_body_count() else { return false; }
    let p = g3::rapier_body_translation(id);
    out[0] = p.x; out[1] = p.y; out[2] = p.z;
    return true;
}
export fn g3_phys_body_vel(id: i32, out: f32[:]) -> bool {
    guard out.len >= 3 && id >= 0 && id < g3::physics_body_count() else { return false; }
    let v = g3::rapier_body_linvel(id);
    out[0] = v.x; out[1] = v.y; out[2] = v.z;
    return true;
}
export fn g3_phys_body_set_pos(id: i32, x: f32, y: f32, z: f32) -> bool {
    return g3::rapier_body_set_translation(id, float3 { x, y, z });
}
export fn g3_phys_body_set_vel(id: i32, x: f32, y: f32, z: f32) -> bool {
    return g3::rapier_body_set_linvel(id, float3 { x, y, z });
}
export fn g3_phys_body_apply_impulse(id: i32, x: f32, y: f32, z: f32) -> bool {
    return g3::rapier_body_apply_impulse(id, float3 { x, y, z });
}
export fn g3_phys_body_dynamic(id: i32) -> bool { return g3::rapier_body_is_dynamic(id); }
export fn g3_phys_body_set_restitution(id: i32, restitution: f32) -> bool {
    return g3::rapier_body_set_restitution(id, restitution);
}
export fn g3_phys_body_set_friction(id: i32, friction: f32) -> bool {
    return g3::rapier_body_set_friction(id, friction);
}
