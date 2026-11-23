// Rapier-style facade over g3.physics.
//
// This module mirrors the vocabulary of three.js' RapierPhysics addon —
// ColliderDesc.cuboid/ball/capsule, world.timestep + world.step(),
// RigidBodyDesc.dynamic()/fixed() via mass, translation/linvel accessors
// and applyImpulse — so Rapier-flavoured game code maps onto the engine's
// solver with minimal renaming.
//
// Scope: translation only. Bodies do not rotate, so there is no angular
// velocity, no rotation accessor and no torque; a body's node keeps whatever
// rotation it was given. Bodies have exactly one collider, so there is no
// collider list and no per-body removal — physics_clear() resets the world.
// Fixed bodies are mass == 0, dynamic bodies mass > 0, as in Rapier's
// RigidBodyDesc.fixed()/dynamic().

import vec;
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
    guard id >= 0 && id < physics_body_count() else { return false; }
    return physics_body(id).inverse_mass > 0.0;
}

// body.translation()
fn rapier_body_translation(id: i64) -> float3 {
    guard id >= 0 && id < physics_body_count() else { return float3_0; }
    return physics_body(id).position;
}

// body.setTranslation(): teleports the body and zeroes its velocity, like
// RapierPhysics.setMeshPosition. The node's position is updated immediately
// so the next frame renders the new spot even before world.step().
fn rapier_body_set_translation(id: i64, position: float3) -> bool {
    guard id >= 0 && id < physics_body_count() else { return false; }
    let body .= physics_body(id);
    body.position = position;
    body.velocity = float3_0;
    if node_handle_valid(body.node) { node(body.node.index).pos = position; }
    return true;
}

// body.linvel()
fn rapier_body_linvel(id: i64) -> float3 {
    guard id >= 0 && id < physics_body_count() else { return float3_0; }
    return physics_body(id).velocity;
}

// body.setLinvel()
fn rapier_body_set_linvel(id: i64, velocity: float3) -> bool {
    return physics_body_set_velocity(id, velocity);
}

// body.applyImpulse(): an instantaneous velocity change of impulse *
// inverse_mass. Dynamic bodies only.
fn rapier_body_apply_impulse(id: i64, impulse: float3) -> bool {
    guard id >= 0 && id < physics_body_count() else { return false; }
    let body .= physics_body(id);
    if body.inverse_mass <= 0.0 { return false; }
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
