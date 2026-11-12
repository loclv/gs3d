// The scene: a flat array of nodes and one camera.
//
// Nodes are records in a global grow-only array, and a node's handle is its
// index. `node_add` returns a reference to the new record, which stays valid
// for the program's life: the array only grows, so a scene is built by
// pushing and then edited in place through the references it hands out.
//
//   let cube_id = g3::node_add(g3::mesh_cube(1.0));   // a handle: an i64
//   let cube .= g3::node(cube_id);                    // `.` binds the reference
//   cube.pos = float3 { 0.0, 1.0, 0.0 };
//   let arm = g3::node_group();
//   g3::node_parent(cube_id, arm);
//
// Parenting is an index into the same array, `-1` for a root. The world matrix
// is recomputed each frame by walking up the chain, so the order nodes were
// added in does not matter. Ordinary nodes remain permanent until scene_clear;
// asset-owned nodes can be released and their slots reused by the asset loader.

import vec;
import math;
import g3.math;

namespace g3;

struct Node {
    mesh: i32 = -1,             // -1: a group, it draws nothing
    texture: i32 = -1,          // texture_create handle, or -1 for solid colour
    parent: i32 = -1,           // -1: a root
    pos: float3,
    rot: float3,                // euler radians, applied Z then Y then X
    scale: float3 = float3_1,
    color: float4 = float4_1,
    alpha_mode: i32,            // 0: colour-driven, 1: mask, 2: blend
    alpha_cutoff: f32 = 0.5,
    unlit: bool,                // skip lighting: a debug shape, a light source
    visible: bool = true,
    spec: f32 = 0.25,           // specular strength
    shine: f32 = 24.0,          // specular exponent
    world: Mat4,                // filled by `node_update_worlds`, do not set
    local_matrix: Mat4,         // optional imported affine transform
    use_local_matrix: bool,
    asset_owned: bool,
    asset_free: bool,
}

struct Camera {
    pos: float3 = float3 { 0.0, 4.0, 10.0 },
    target: float3,
    up: float3 = float3 { 0.0, 1.0, 0.0 },
    fov: f32 = 0.9,             // vertical, radians
    near: f32 = 0.1,
    far: f32 = 400.0,
}

var g_nodes: Node[>..];
var g_scene_epoch: i32;
var g_camera: Camera;
var g_camera_yaw: f32 = 0.5;
var g_camera_pitch: f32 = 0.35;
var g_camera_distance: f32 = 10.0;
var g_camera_target: float3 = float3 { 0.0, 1.0, 0.0 };

fn node_count() -> i64 { g_nodes.len }

// Empty the scene, for a program that builds more than one. The compiler
// refuses this while any reference into a node is still live, which is what
// keeps a stale handle from surviving it.
fn scene_clear() { g_nodes.clear(); g_scene_epoch += 1; }

// The node with this handle, as a reference: writable, and valid as long as
// the program runs.
fn node(id: i64) -> Node& { return g_nodes[id] }

// Add a node and get its handle back; `node` turns the handle into a
// reference once, and the reference is what the rest of the code uses.
fn node_add(mesh_id: i32) -> i64 {
    g_nodes.push(Node { mesh: mesh_id, .. });
    return g_nodes.len - 1;
}

// Asset nodes may be recycled only after their owner has been disposed.
fn node_asset_add(mesh_id: i32) -> i64 {
    for i in 0..g_nodes.len {
        if g_nodes[i].asset_owned && g_nodes[i].asset_free {
            g_nodes[i] = Node { mesh: mesh_id, asset_owned: true, .. };
            return i;
        }
    }
    g_nodes.push(Node { mesh: mesh_id, asset_owned: true, .. });
    return g_nodes.len - 1;
}

fn node_asset_release(id: i64) {
    guard id >= 0 && id < g_nodes.len else { return; }
    let n .= g_nodes[id];
    if n.asset_owned && !n.asset_free {
        n.visible = false;
        n.asset_free = true;
        n.mesh = -1;
        n.parent = -1;
    }
}

// A node with children and no geometry of its own: the pivot of a hierarchy.
fn node_group() -> i64 {
    g_nodes.push(Node { .. });
    return g_nodes.len - 1;
}

fn node_parent(child: i64, parent: i64) {
    g_nodes[child].parent = parent as i32;
}

fn node_local(n: Node&) -> Mat4 {
    if n.use_local_matrix { return n.local_matrix; }
    return mat4_trs(n.pos, n.rot, n.scale);
}

// Multiplied out from the root down, into every node's `world`. A chain
// longer than 64 is treated as a loop and stops there rather than hanging.
fn node_update_worlds() {
    for &n in g_nodes {
        var w = node_local(n);
        var p = n.parent;
        var up = 0;
        while p >= 0 && up < 64 {
            let pn .= g_nodes[p];
            w = mat4_mul(node_local(pn), w);
            p = pn.parent;
            up++;
        }
        n.world = w;
    }
}

fn camera() -> Camera& { return g_camera }

// Point the camera at a place from a place.
fn camera_look_at(eye: float3, target: float3) {
    g_camera.pos = eye;
    g_camera.target = target;
}

// Put the eye on a sphere around `target`: the orbit camera a demo wants.
// Yaw turns around the vertical axis, pitch raises the eye, and both are the
// angles the state keeps, so `orbit_nudge` can spin it a little each frame.
fn camera_orbit(yaw: f32, pitch: f32, distance: f32, target: float3) {
    let cp = cos(pitch);
    g_camera_target = target;
    g_camera_yaw = yaw;
    g_camera_pitch = pitch;
    g_camera_distance = distance;
    g_camera.pos = target + float3 { cp * sin(yaw), sin(pitch), cp * cos(yaw) } * distance;
    g_camera.target = target;
}

// Turn and tilt the current orbit, keeping its distance and target: what a
// mouse drag or an arrow key does.
fn camera_orbit_nudge(dyaw: f32, dpitch: f32) {
    var pitch = g_camera_pitch + dpitch;
    if pitch > 1.5 { pitch = 1.5; }
    if pitch < -1.5 { pitch = -1.5; }
    camera_orbit(g_camera_yaw + dyaw, pitch, g_camera_distance, g_camera_target);
}

fn camera_zoom(factor: f32) {
    var d = g_camera_distance * factor;
    if d < 1.0 { d = 1.0; }
    if d > 300.0 { d = 300.0; }
    camera_orbit(g_camera_yaw, g_camera_pitch, d, g_camera_target);
}
