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
export fn g3_phys_body_kinematic(id: i32) -> bool { return g3::rapier_body_is_kinematic(id); }
export fn g3_phys_body_set_kinematic(id: i32, kinematic: bool) -> bool {
    return g3::rapier_body_set_kinematic(id, kinematic);
}
export fn g3_phys_body_set_mass(id: i32, mass: f32) -> bool {
    return g3::rapier_body_set_mass(id, mass);
}
export fn g3_phys_body_remove(id: i32) -> bool { return g3::rapier_body_remove(id); }
export fn g3_phys_body_sync(id: i32) -> bool { return g3::rapier_body_sync(id); }
export fn g3_phys_body_set_restitution(id: i32, restitution: f32) -> bool {
    return g3::rapier_body_set_restitution(id, restitution);
}
export fn g3_phys_body_set_friction(id: i32, friction: f32) -> bool {
    return g3::rapier_body_set_friction(id, friction);
}

// Contacts recorded during the last world.step(). Each contact writes 6
// floats into out: [a, b, nx, ny, nz, penetration].
export fn g3_phys_contact_count() -> i32 { return g3::physics_contact_count() as i32; }
export fn g3_phys_contact(id: i32, out: f32[:]) -> bool {
    guard out.len >= 6 && id >= 0 && id < g3::physics_contact_count() else { return false; }
    let c .= g3::physics_contact(id);
    out[0] = c.a;
    out[1] = c.b;
    out[2] = c.normal.x; out[3] = c.normal.y; out[4] = c.normal.z;
    out[5] = c.penetration;
    return true;
}

// world.castRay. `out` must hold at least 8 floats and receives
// [body, distance, px, py, pz, nx, ny, nz]. Returns false on a miss or bad
// arguments and leaves out untouched.
export fn g3_phys_raycast(ox: f32, oy: f32, oz: f32, dx: f32, dy: f32, dz: f32, max_dist: f32, out: f32[:]) -> bool {
    guard out.len >= 8 else { return false; }
    let hit = g3::rapier_world_raycast(float3 { ox, oy, oz }, float3 { dx, dy, dz }, max_dist);
    guard hit.hit else { return false; }
    out[0] = hit.body;
    out[1] = hit.distance;
    out[2] = hit.point.x; out[3] = hit.point.y; out[4] = hit.point.z;
    out[5] = hit.normal.x; out[6] = hit.normal.y; out[7] = hit.normal.z;
    return true;
}
