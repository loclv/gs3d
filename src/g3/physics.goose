// Small 3D rigid-body physics for scene nodes.
//
// This module uses axis-aligned box colliders. A mass of zero makes a body
// static; dynamic bodies use semi-implicit Euler integration and an impulse
// response when their boxes overlap. It is intended for simple game motion,
// not as a general-purpose simulation solver.

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
    inverse_mass: f32,
    restitution: f32 = 0.0,
    friction: f32 = 0.5,
}

var g_physics_bodies: PhysicsBody[>..];
var g_physics_gravity: float3 = float3 { 0.0, -9.81, 0.0 };

fn physics_body_count() -> i64 { return g_physics_bodies.len; }

fn physics_body(id: i64) -> PhysicsBody& { return g_physics_bodies[id] }

fn physics_clear() { g_physics_bodies.clear(); }

fn physics_set_gravity(gravity: float3) { g_physics_gravity = gravity; }

// Attach a box body to a scene node. The node's position is the collider
// center. `mass == 0` creates an immovable body.
fn physics_body_add(node_id: i64, half_extents: float3, mass: f32) -> i64 {
    guard node_id >= 0 && node_id < node_count() &&
          half_extents.x > 0.0 && half_extents.y > 0.0 && half_extents.z > 0.0 &&
          mass >= 0.0 && mass <= 3.4e38 else { return -1; }
    let handle = node_handle(node_id);
    guard node_handle_valid(handle) else { return -1; }
    let position = node(node_id).pos;
    let inverse_mass = if mass == 0.0 { 0.0 } else { 1.0 / mass };
    g_physics_bodies.push(PhysicsBody {
        node: handle,
        position: position,
        half_extents: half_extents,
        inverse_mass: inverse_mass,
        ..
    });
    return g_physics_bodies.len - 1;
}

fn physics_body_set_restitution(id: i64, restitution: f32) -> bool {
    guard id >= 0 && id < g_physics_bodies.len && restitution >= 0.0 && restitution <= 1.0 else { return false; }
    g_physics_bodies[id].restitution = restitution;
    return true;
}

fn physics_body_set_friction(id: i64, friction: f32) -> bool {
    guard id >= 0 && id < g_physics_bodies.len && friction >= 0.0 && friction <= 1.0 else { return false; }
    g_physics_bodies[id].friction = friction;
    return true;
}

// Add a force for the next step. Forces are cleared after each step.
fn physics_apply_force(id: i64, force: float3) -> bool {
    guard id >= 0 && id < g_physics_bodies.len && g_physics_bodies[id].inverse_mass > 0.0 else { return false; }
    g_physics_bodies[id].force += force;
    return true;
}

fn physics_body_set_velocity(id: i64, velocity: float3) -> bool {
    guard id >= 0 && id < g_physics_bodies.len else { return false; }
    g_physics_bodies[id].velocity = velocity;
    return true;
}

// Advance the simulation by seconds. Break the frame into <= 1/60 second
// substeps to reduce tunneling and keep the collision response stable.
// Inputs above one second are rejected to bound work after a long pause.
fn physics_step(dt: f32) {
    guard dt > 0.0 && dt <= 1.0 else { return; }
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
        if !node_handle_valid(body.node) { continue; }
        if body.inverse_mass > 0.0 {
            body.velocity += (g_physics_gravity + body.force * body.inverse_mass) * dt;
            body.position += body.velocity * dt;
        }
    }

    for i in 0..g_physics_bodies.len {
        for j in (i + 1)..g_physics_bodies.len {
            physics_resolve_pair(i, j);
        }
    }

}

fn physics_resolve_pair(a_id: i64, b_id: i64) {
    let a .= g_physics_bodies[a_id];
    let b .= g_physics_bodies[b_id];
    let inverse_mass_sum = a.inverse_mass + b.inverse_mass;
    if inverse_mass_sum <= 0.0 || !node_handle_valid(a.node) || !node_handle_valid(b.node) { return; }

    let delta = b.position - a.position;
    let overlap_x = a.half_extents.x + b.half_extents.x - abs(delta.x);
    let overlap_y = a.half_extents.y + b.half_extents.y - abs(delta.y);
    let overlap_z = a.half_extents.z + b.half_extents.z - abs(delta.z);
    if overlap_x <= 0.0 || overlap_y <= 0.0 || overlap_z <= 0.0 { return; }

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
    let friction_scalar = if abs(friction_magnitude) < max_friction {
        friction_magnitude
    } else {
        -max_friction
    };
    let friction_impulse = tangent * friction_scalar;
    a.velocity -= friction_impulse * a.inverse_mass;
    b.velocity += friction_impulse * b.inverse_mass;
}
