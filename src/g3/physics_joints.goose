// Persistent constraints for g3.physics: fixed, distance and hinge joints.
//
// Joints are created between two bodies with body-local anchor points and
// solved every substep after contacts, with the same sequential-impulse
// scheme: warm-started accumulated impulses refined over a fixed number of
// Gauss-Seidel passes, then one positional-correction pass. Accumulated
// impulses live on the joint itself, so no warm-start table is needed.
//
//   fixed    — anchors coincide and relative rotation is locked on all
//              three of body a's basis axes.
//   distance — anchor separation is held at rest_length along the line
//              between the anchors; the constraint pulls as well as pushes.
//   hinge    — anchors coincide (a ball joint) while rotation is free only
//              about axis_a (body-a local); the two perpendicular relative
//              angular velocity components are driven to zero.
//
// Sleeping bodies count as immovable, matching contacts; a joint whose
// constraint velocity is large enough wakes a sleeping partner, the same
// threshold contacts use for impacts.

import vec;
import math;
import g3.math;
import g3.scene;
import g3.physics;
import g3.physics_solver;

namespace g3;

const PHYSICS_JOINT_FIXED: i32 = 0;
const PHYSICS_JOINT_DISTANCE: i32 = 1;
const PHYSICS_JOINT_HINGE: i32 = 2;

struct PhysicsJoint {
    kind: i32,
    a: i64,
    b: i64,
    // Anchor points in each body's local space.
    anchor_a: float3 = float3_0,
    anchor_b: float3 = float3_0,
    // Hinge axis in body-a local space, normalized at creation.
    axis_a: float3 = float3 { 0.0, 1.0, 0.0 },
    // Distance joint rest length; non-positive values take the anchor
    // separation at creation.
    rest_length: f32 = 0.0,
    removed: bool = false,
    // Warm-start accumulators. lambda_lin is the world-space linear impulse
    // vector applied to b (coincidence joints), lambda_ang the world-space
    // angular impulse vector, lambda_dist the scalar impulse along the
    // current anchor line (distance joints).
    lambda_lin: float3 = float3_0,
    lambda_ang: float3 = float3_0,
    lambda_dist: f32 = 0.0,
}

var g_physics_joints: PhysicsJoint[>..];

fn physics_joint_count() -> i64 { return g_physics_joints.len; }

fn physics_joint(id: i64) -> PhysicsJoint& { return g_physics_joints[id] }

fn physics_joint_valid(id: i64) -> bool {
    return id >= 0 && id < g_physics_joints.len && !g_physics_joints[id].removed;
}

fn physics_joint_add(kind: i32, a: i64, b: i64, anchor_a: float3, anchor_b: float3,
                     axis_a: float3, rest_length: f32) -> i64 {
    guard a != b && physics_body_valid(a) && physics_body_valid(b) else { return -1; }
    let ba .= g_physics_bodies[a];
    let bb .= g_physics_bodies[b];
    guard !ba.removed && !bb.removed &&
          node_handle_valid(ba.node) && node_handle_valid(bb.node) else { return -1; }
    var axis = axis_a;
    if kind == PHYSICS_JOINT_HINGE {
        let l = length(axis);
        guard l > 0.0001 else { return -1; }
        axis = axis / l;
    }
    var rest = rest_length;
    if kind == PHYSICS_JOINT_DISTANCE && rest <= 0.0 {
        rest = length((bb.position + physics_body_to_world(bb, anchor_b)) -
                      (ba.position + physics_body_to_world(ba, anchor_a)));
        guard rest > 0.0001 else { return -1; }
    }
    g_physics_joints.push(PhysicsJoint {
        kind: kind, a: a, b: b,
        anchor_a: anchor_a, anchor_b: anchor_b,
        axis_a: axis, rest_length: rest,
    });
    return g_physics_joints.len - 1;
}

fn physics_joint_add_fixed(a: i64, b: i64, anchor_a: float3, anchor_b: float3) -> i64 {
    return physics_joint_add(PHYSICS_JOINT_FIXED, a, b, anchor_a, anchor_b, float3_0, 0.0);
}

fn physics_joint_add_distance(a: i64, b: i64, anchor_a: float3, anchor_b: float3,
                              rest_length: f32) -> i64 {
    return physics_joint_add(PHYSICS_JOINT_DISTANCE, a, b, anchor_a, anchor_b, float3_0, rest_length);
}

fn physics_joint_add_hinge(a: i64, b: i64, anchor_a: float3, anchor_b: float3,
                           axis_a: float3) -> i64 {
    return physics_joint_add(PHYSICS_JOINT_HINGE, a, b, anchor_a, anchor_b, axis_a, 0.0);
}

fn physics_joint_remove(id: i64) -> bool {
    guard physics_joint_valid(id) else { return false; }
    g_physics_joints[id].removed = true;
    return true;
}

// World-space anchor point and its offset from the body center.
fn physics_joint_anchor(b: PhysicsBody&, local: float3) -> float3 {
    return b.position + physics_body_to_world(b, local);
}

fn physics_joint_im(b: PhysicsBody&) -> f32 {
    if b.sleeping { return 0.0; }
    return b.inverse_mass;
}

// World-space inverse inertia tensor times `axis`, or zero for bodies that
// cannot move rotationally this substep (sleeping, static, kinematic).
fn physics_joint_inv_inertia(b: PhysicsBody&, axis: float3) -> float3 {
    if b.sleeping || b.inverse_mass <= 0.0 { return float3_0; }
    let w = b.inv_inertia_world;
    return float3 {
        w[0].x * axis.x + w[0].y * axis.y + w[0].z * axis.z,
        w[1].x * axis.x + w[1].y * axis.y + w[1].z * axis.z,
        w[2].x * axis.x + w[2].y * axis.y + w[2].z * axis.z,
    };
}

// Apply a world-space angular impulse vector: delta-omega is the
// world-space inverse inertia tensor times the impulse.
fn physics_joint_ang_apply(b: PhysicsBody&, jvec: float3) {
    if b.sleeping || b.inverse_mass <= 0.0 { return; }
    let w = b.inv_inertia_world;
    b.angular_velocity += float3 {
        w[0].x * jvec.x + w[0].y * jvec.y + w[0].z * jvec.z,
        w[1].x * jvec.x + w[1].y * jvec.y + w[1].z * jvec.z,
        w[2].x * jvec.x + w[2].y * jvec.y + w[2].z * jvec.z,
    };
}

// One Gauss-Seidel pass over a single joint's constraints. Returns the
// largest impulse delta for the early-out check.
fn physics_joint_iteration(jid: i64) -> f32 {
    let j .= g_physics_joints[jid];
    let ba .= g_physics_bodies[j.a];
    let bb .= g_physics_bodies[j.b];
    if j.removed || ba.removed || bb.removed ||
       !node_handle_valid(ba.node) || !node_handle_valid(bb.node) { return 0.0; }
    let im_a = physics_joint_im(ba);
    let im_b = physics_joint_im(bb);
    let pa = physics_joint_anchor(ba, j.anchor_a);
    let pb = physics_joint_anchor(bb, j.anchor_b);
    let ra = pa - ba.position;
    let rb = pb - bb.position;
    var max_delta: f32 = 0.0;

    if j.kind == PHYSICS_JOINT_DISTANCE {
        let dvec = pb - pa;
        let dist = length(dvec);
        if dist < 0.000001 { return 0.0; }
        let dir = dvec / dist;
        let vrel = physics_point_velocity(bb, rb) - physics_point_velocity(ba, ra);
        let vn = dot(vrel, dir);
        let denom = physics_contact_denominator(ba, bb, dir, ra, rb, im_a, im_b);
        if denom <= 0.0 { return 0.0; }
        // Free sign: the constraint pulls as well as pushes.
        let dl = -vn / denom;
        if dl != 0.0 {
            let imp = dir * dl;
            physics_apply_normal_impulse(ba, bb, imp, ra, rb, im_a, im_b);
            j.lambda_dist += dl;
            max_delta = max(max_delta, abs(dl));
        }
        return max_delta;
    }

    // Coincidence: drive the relative anchor velocity to zero along each
    // world axis, one scalar constraint per axis. Impulses apply linearly
    // only — the effective mass is im_a + im_b like friction — because the
    // angular constraints below own rotation. Routing anchor forces
    // through the inertia tensor instead would leak energy out of a
    // hinge's free axis: the torque an offset anchor impulse creates has
    // a component along that axis.
    var axis_i = 0;
    while axis_i < 3 {
        var e: float3;
        if axis_i == 0 { e = float3 { 1.0, 0.0, 0.0 }; }
        else if axis_i == 1 { e = float3 { 0.0, 1.0, 0.0 }; }
        else { e = float3 { 0.0, 0.0, 1.0 }; }
        let vrel = physics_point_velocity(bb, rb) - physics_point_velocity(ba, ra);
        let vn = dot(vrel, e);
        let denom = im_a + im_b;
        if denom > 0.0 {
            let dl = -vn / denom;
            if dl != 0.0 {
                let imp = e * dl;
                physics_apply_linear_impulse(ba, bb, imp, im_a, im_b);
                j.lambda_lin += imp;
                max_delta = max(max_delta, abs(dl));
            }
        }
        axis_i += 1;
    }

    if j.kind == PHYSICS_JOINT_FIXED {
        // Lock relative rotation about each of body a's world basis axes.
        var ax = 0;
        while ax < 3 {
            let e = physics_box_axis(ba, ax);
            let wrel = bb.angular_velocity - ba.angular_velocity;
            let wn = dot(wrel, e);
            let ia = physics_joint_inv_inertia(ba, e);
            let ib = physics_joint_inv_inertia(bb, e);
            let denom = dot(e, ia) + dot(e, ib);
            if denom > 0.0 {
                let dq = -wn / denom;
                if dq != 0.0 {
                    let jimp = e * dq;
                    physics_joint_ang_apply(bb, jimp);
                    physics_joint_ang_apply(ba, float3 { -jimp.x, -jimp.y, -jimp.z });
                    j.lambda_ang += jimp;
                    max_delta = max(max_delta, abs(dq));
                }
            }
            ax += 1;
        }
    } else if j.kind == PHYSICS_JOINT_HINGE {
        // Free rotation about the hinge axis; lock the two perpendicular
        // relative angular velocity components.
        let wa = physics_body_to_world(ba, j.axis_a);
        let wl = length(wa);
        if wl > 0.000001 {
            let axis_w = wa / wl;
            var up = float3 { 1.0, 0.0, 0.0 };
            if abs(axis_w.x) > 0.9 { up = float3 { 0.0, 1.0, 0.0 }; }
            let u = normalize(cross(axis_w, up));
            let v = cross(axis_w, u);
            var c = 0;
            while c < 2 {
                let e = if c == 0 { u } else { v };
                let wrel = bb.angular_velocity - ba.angular_velocity;
                let wn = dot(wrel, e);
                let ia = physics_joint_inv_inertia(ba, e);
                let ib = physics_joint_inv_inertia(bb, e);
                let denom = dot(e, ia) + dot(e, ib);
                if denom > 0.0 {
                    let dq = -wn / denom;
                    if dq != 0.0 {
                        let jimp = e * dq;
                        physics_joint_ang_apply(bb, jimp);
                        physics_joint_ang_apply(ba, float3 { -jimp.x, -jimp.y, -jimp.z });
                        j.lambda_ang += jimp;
                        max_delta = max(max_delta, abs(dq));
                    }
                }
                c += 1;
            }
        }
    }
    return max_delta;
}

// Warm-start pass plus the iterative solve and positional correction for
// every live joint. Runs once per substep after contacts.
fn physics_solve_joints() {
    // Warm start: re-apply last substep's accumulated impulses, and wake a
    // sleeping partner when the constraint is being violated fast enough —
    // the joint equivalent of a contact impact.
    for jid in 0..g_physics_joints.len {
        let j = g_physics_joints[jid];
        if j.removed { continue; }
        let ba .= g_physics_bodies[j.a];
        let bb .= g_physics_bodies[j.b];
        if ba.removed || bb.removed ||
           !node_handle_valid(ba.node) || !node_handle_valid(bb.node) { continue; }
        let im_a = physics_joint_im(ba);
        let im_b = physics_joint_im(bb);
        let pa = physics_joint_anchor(ba, j.anchor_a);
        let pb = physics_joint_anchor(bb, j.anchor_b);
        let ra = pa - ba.position;
        let rb = pb - bb.position;
        let vrel = physics_point_velocity(bb, rb) - physics_point_velocity(ba, ra);
        if (ba.sleeping || bb.sleeping) && length(vrel) > 0.3 {
            physics_wake(ba);
            physics_wake(bb);
        }
        if j.lambda_lin != float3_0 {
            physics_apply_linear_impulse(ba, bb, j.lambda_lin, im_a, im_b);
        }
        if j.lambda_ang != float3_0 {
            physics_joint_ang_apply(bb, j.lambda_ang);
            physics_joint_ang_apply(ba, float3 { -j.lambda_ang.x, -j.lambda_ang.y, -j.lambda_ang.z });
        }
        if j.kind == PHYSICS_JOINT_DISTANCE && j.lambda_dist != 0.0 {
            let dvec = pb - pa;
            let dist = length(dvec);
            if dist > 0.000001 {
                physics_apply_normal_impulse(ba, bb, (dvec / dist) * j.lambda_dist,
                                             ra, rb, im_a, im_b);
            }
        }
    }

    for _ in 0..PHYSICS_SOLVER_ITERATIONS {
        var max_delta: f32 = 0.0;
        for jid in 0..g_physics_joints.len {
            max_delta = max(max_delta, physics_joint_iteration(jid));
        }
        if max_delta < 0.01 { break; }
    }

    // Positional correction, once: nudge anchors together (fixed, hinge)
    // or to the rest length (distance), weighted by inverse mass with the
    // same slop the contact pass uses.
    for jid in 0..g_physics_joints.len {
        let j = g_physics_joints[jid];
        if j.removed { continue; }
        let ba .= g_physics_bodies[j.a];
        let bb .= g_physics_bodies[j.b];
        if ba.removed || bb.removed ||
           !node_handle_valid(ba.node) || !node_handle_valid(bb.node) { continue; }
        let im_a = physics_joint_im(ba);
        let im_b = physics_joint_im(bb);
        let denom = im_a + im_b;
        if denom <= 0.0 { continue; }
        let pa = physics_joint_anchor(ba, j.anchor_a);
        let pb = physics_joint_anchor(bb, j.anchor_b);
        if j.kind == PHYSICS_JOINT_DISTANCE {
            let dvec = pb - pa;
            let dist = length(dvec);
            if dist < 0.000001 { continue; }
            let err = dist - j.rest_length;
            if abs(err) <= 0.001 { continue; }
            let corr = (dvec / dist) * (err * 0.8 / denom);
            if im_a > 0.0 { ba.position += corr * im_a; }
            if im_b > 0.0 { bb.position -= corr * im_b; }
        } else {
            let d = pb - pa;
            let l = length(d);
            if l <= 0.001 { continue; }
            let s = (l - 0.001) / l * 0.8;
            let wa = im_a / denom;
            let wb = im_b / denom;
            if im_a > 0.0 { ba.position += d * (s * wa); }
            if im_b > 0.0 { bb.position -= d * (s * wb); }
        }
    }
}
