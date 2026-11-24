// Rapier-style facade over g3.physics.
//
// This module mirrors the vocabulary of three.js' RapierPhysics addon —
// ColliderDesc.cuboid/ball/capsule, world.timestep + world.step(),
// RigidBodyDesc.dynamic()/fixed() via mass, translation/linvel accessors
// and applyImpulse — so Rapier-flavoured game code maps onto the engine's
// solver with minimal renaming.
//
// Bodies rotate: orientation is stored as a rotation matrix internally and
// exposed as euler angles in the node convention (radians, Z then Y then X,
// matching Node.rot). Capsules run along the body's local Y, so a rotated
// capsule lies on its side. There is no collider list — bodies have exactly
// one collider — and no sleeping control beyond the solver's automatic
// thresholds. Fixed bodies are mass == 0, dynamic bodies mass > 0, as in
// Rapier's RigidBodyDesc.fixed()/dynamic().

import vec;
import g3.math;
import g3.physics;
import g3.scene;

namespace g3;

var g_rapier_timestep: f32 = 1.0 / 60.0;

// world.timestep — seconds per world.step() call. Clamped to physics_step's
// accepted range; values outside (0, 1] are rejected.
fn rapier_set_timestep(seconds: f32) -> bool {
    guard seconds > 0.0 && seconds <= 1.0 else { return false; }
    g_rapier_timestep = seconds;
    return true;
}

fn rapier_timestep() -> f32 { return g_rapier_timestep; }

// world.gravity — the acceleration applied to every dynamic body each step.
fn rapier_set_gravity(gravity: float3) { physics_set_gravity(gravity); }

// Remove every body, like constructing a fresh Rapier world.
fn rapier_world_clear() { physics_clear(); }

// world.step() with no argument, using the stored timestep.
fn rapier_world_step() { physics_step(g_rapier_timestep); }

// ColliderDesc.cuboid(hx, hy, hz) + RigidBodyDesc: `mass == 0` is fixed,
// `mass > 0` is dynamic. Returns the body id or -1 on bad arguments.
fn rapier_body_add_cuboid(node_id: i64, half_extents: float3, mass: f32) -> i64 {
    return physics_body_add(node_id, half_extents, mass);
}

// ColliderDesc.ball(radius).
fn rapier_body_add_ball(node_id: i64, radius: f32, mass: f32) -> i64 {
    return physics_body_add_sphere(node_id, radius, mass);
}

// ColliderDesc.capsule(half_length, radius) — cylinder half-length plus cap
// radius, aligned with world Y.
fn rapier_body_add_capsule(node_id: i64, half_length: f32, radius: f32, mass: f32) -> i64 {
    return physics_body_add_capsule(node_id, radius, half_length, mass);
}

// RigidBodyDesc.dynamic() check: mass > 0 bodies integrate and collide.
fn rapier_body_is_dynamic(id: i64) -> bool {
    guard physics_body_valid(id) else { return false; }
    return physics_body(id).inverse_mass > 0.0;
}

// body.translation()
fn rapier_body_translation(id: i64) -> float3 {
    guard physics_body_valid(id) else { return float3_0; }
    return physics_body(id).position;
}

// body.setTranslation(): teleports the body and zeroes its velocity, like
// RapierPhysics.setMeshPosition. The node's position is updated immediately
// so the next frame renders the new spot even before world.step().
fn rapier_body_set_translation(id: i64, position: float3) -> bool {
    guard physics_body_valid(id) else { return false; }
    let body .= physics_body(id);
    body.position = position;
    body.velocity = float3_0;
    if node_handle_valid(body.node) { node(body.node.index).pos = position; }
    return true;
}

// body.linvel()
fn rapier_body_linvel(id: i64) -> float3 {
    guard physics_body_valid(id) else { return float3_0; }
    return physics_body(id).velocity;
}

// body.setLinvel()
fn rapier_body_set_linvel(id: i64, velocity: float3) -> bool {
    return physics_body_set_velocity(id, velocity);
}

// body.angvel() — world-frame angular velocity in radians per second.
fn rapier_body_angvel(id: i64) -> float3 { return physics_body_angvel(id); }

// body.setAngvel()
fn rapier_body_set_angvel(id: i64, angvel: float3) -> bool {
    return physics_body_set_angvel(id, angvel);
}

// body.rotation() as euler angles in the node convention.
fn rapier_body_rotation(id: i64) -> float3 { return physics_body_euler(id); }

// body.setRotation(euler): teleports the orientation, zeroes angular
// velocity and updates the node's rotation immediately, like
// setTranslation does for position. Linear velocity is kept.
fn rapier_body_set_rotation(id: i64, euler: float3) -> bool {
    guard physics_body_valid(id) else { return false; }
    let body .= physics_body(id);
    body.orientation = mat4_rotate_euler(euler);
    body.angular_velocity = float3_0;
    physics_wake(body);
    if node_handle_valid(body.node) { node(body.node.index).rot = euler; }
    return true;
}

// body.addTorque(): accumulated world-frame torque for the next step.
fn rapier_body_add_torque(id: i64, torque: float3) -> bool {
    return physics_apply_torque(id, torque);
}

// body.applyImpulseAtPoint(): linear plus angular impulse at a world point.
fn rapier_body_apply_impulse_at(id: i64, impulse: float3, point: float3) -> bool {
    return physics_body_apply_impulse_at(id, impulse, point);
}

// body.applyImpulse(): an instantaneous velocity change of impulse *
// inverse_mass. Dynamic bodies only; wakes a sleeping body.
fn rapier_body_apply_impulse(id: i64, impulse: float3) -> bool {
    guard physics_body_valid(id) else { return false; }
    let body .= physics_body(id);
    if body.inverse_mass <= 0.0 { return false; }
    physics_wake(body);
    body.velocity += impulse * body.inverse_mass;
    return true;
}

// Collider.setRestitution / setFriction.
fn rapier_body_set_restitution(id: i64, restitution: f32) -> bool {
    return physics_body_set_restitution(id, restitution);
}

fn rapier_body_set_friction(id: i64, friction: f32) -> bool {
    return physics_body_set_friction(id, friction);
}

// world.removeRigidBody. The slot stays as a tombstone so other ids remain
// valid; rapier_world_clear() frees every slot.
fn rapier_body_remove(id: i64) -> bool { return physics_body_remove(id); }

// RigidBodyDesc.setBodyType: kinematic bodies follow linvel exactly — no
// gravity, forces or impulses — and push dynamic bodies out of the way.
fn rapier_body_set_kinematic(id: i64, kinematic: bool) -> bool {
    return physics_body_set_kinematic(id, kinematic);
}

fn rapier_body_is_kinematic(id: i64) -> bool { return physics_body_is_kinematic(id); }

// RigidBodyDesc.setAdditionalMassProperties-style mass change; mass 0 is
// fixed, positive is dynamic, and the collider shape is unchanged.
fn rapier_body_set_mass(id: i64, mass: f32) -> bool { return physics_body_set_mass(id, mass); }

// Copy the node's position and rotation into the body — for gameplay code
// that moved the node directly instead of through the body accessors.
fn rapier_body_sync(id: i64) -> bool { return physics_body_sync(id); }

// world.castRay: nearest hit along origin + direction * t, `max_dist` in
// world units. `direction` need not be normalized. Misses return a hit
// struct with hit == false and body == -1.
fn rapier_world_raycast(origin: float3, direction: float3, max_dist: f32) -> PhysicsRayHit {
    return physics_raycast(origin, direction, max_dist);
}

// body.mass() — the scalar mass the body was created or last set with.
fn rapier_body_mass(id: i64) -> f32 {
    guard physics_body_valid(id) else { return 0.0; }
    return physics_body(id).mass;
}

// body.addForce(): accumulated world-frame force for the next step,
// cleared when the step finishes — Rapier's addForce.
fn rapier_body_add_force(id: i64, force: float3) -> bool {
    return physics_apply_force(id, force);
}

// body.resetForces() / resetTorques(): drop the accumulated force or
// torque without stepping.
fn rapier_body_reset_force(id: i64) -> bool { return physics_body_reset_force(id); }
fn rapier_body_reset_torque(id: i64) -> bool { return physics_body_reset_torque(id); }

// body.isSleeping() / sleep() / wakeUp().
fn rapier_body_is_sleeping(id: i64) -> bool { return physics_body_is_sleeping(id); }
fn rapier_body_sleep(id: i64) -> bool { return physics_body_sleep(id); }
fn rapier_body_wake(id: i64) -> bool { return physics_body_wake(id); }

// world.castRay with one body excluded — Rapier's QueryFilter
// excludeCollider analogue for self-hits. `exclude` is a body id or -1.
fn rapier_world_raycast_filtered(origin: float3, direction: float3, max_dist: f32, exclude: i64) -> PhysicsRayHit {
    return physics_raycast_filtered(origin, direction, max_dist, exclude);
}
