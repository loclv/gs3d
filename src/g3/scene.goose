// The scene: a flat array of nodes and selectable cameras.
//
// Nodes are records in a global arena. `node_add` returns an index and `node`
// provides a writable reference. Use a NodeHandle to detect slot reuse.
//
//   let cube_id = g3::node_add(g3::mesh_cube(1.0));   // a handle: an i64
//   let cube .= g3::node(cube_id);                    // `.` binds the reference
//   cube.pos = float3 { 0.0, 1.0, 0.0 };
//   let arm = g3::node_group();
//   g3::node_parent(cube_id, arm);
//
// Parenting is an index into the same array, `-1` for a root. The world matrix
// is recomputed each frame by walking up the chain, so the order nodes were
// added in does not matter. Removed node slots may be reused; retain checked
// handles rather than raw indices across removal.

import vec;
import math;
import g3.math;
import g3.mesh;

namespace g3;

struct Node {
    mesh: i32 = -1,             // -1: a group, it draws nothing
    material: i32 = -1,         // -1: use this node's inline surface fields
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
    generation: i32 = 1,
}

// A shared surface. Node transforms and visibility remain per-node.
struct Material {
    color: float4 = float4_1,
    texture: i32 = -1,
    alpha_mode: i32,
    alpha_cutoff: f32 = 0.5,
    unlit: bool,
    spec: f32 = 0.25,
    shine: f32 = 24.0,
    pbr: bool,
    metallic: f32 = 1.0,
    roughness: f32 = 1.0,
    metallic_roughness_texture: i32 = -1,
    normal_texture: i32 = -1,
    normal_scale: f32 = 1.0,
    occlusion_texture: i32 = -1,
    occlusion_strength: f32 = 1.0,
    emissive: float3,
    emissive_texture: i32 = -1,
    removed: bool,
    asset_owned: bool,
    generation: i32 = 1,
}

struct MaterialHandle { id: i32 = -1, generation: i32 }

// Raw node indices are retained for existing Goose code. A NodeHandle adds
// slot generation and scene epoch for clients that retain reusable nodes.
struct NodeHandle { index: i64 = -1, generation: i32, epoch: i32 }

struct Camera {
    pos: float3 = float3 { 0.0, 4.0, 10.0 },
    target: float3,
    up: float3 = float3 { 0.0, 1.0, 0.0 },
    fov: f32 = 0.9,             // vertical, radians
    orthographic: bool,         // perspective by default
    ortho_height: f32 = 10.0,  // full vertical extent, world units
    near: f32 = 0.1,
    far: f32 = 400.0,
}

struct CameraState {
    camera: Camera,
    yaw: f32, pitch: f32, distance: f32,
    orbit_target: float3,
    removed: bool,
}

var g_nodes: Node[>..];
var g_materials: Material[>..];
var g_scene_epoch: i32;
var g_camera: Camera;
var g_camera_yaw: f32 = 0.5;
var g_camera_pitch: f32 = 0.35;
var g_camera_distance: f32 = 10.0;
var g_camera_target: float3 = float3 { 0.0, 1.0, 0.0 };
var g_cameras: CameraState[>..];
var g_active_camera: i64 = -1;

fn node_count() -> i64 { g_nodes.len }

// Ordinary material IDs are never reused. Removal detaches every node using
// the material; those nodes then use their existing inline surface fields.
fn material_add() -> i32 {
    g_materials.push(Material { .. });
    return (g_materials.len - 1) as i32;
}

fn material(id: i32) -> Material& { return g_materials[id] }

fn material_valid(id: i32) -> bool {
    return id >= 0 && id < g_materials.len && !g_materials[id].removed;
}

fn material_remove(id: i32) -> bool {
    guard material_valid(id) && !g_materials[id].asset_owned else { return false; }
    material_release_slot(id);
    return true;
}

fn material_release_slot(id: i32) {
    for &n in g_nodes { if n.material == id { n.material = -1; } }
    g_materials[id].removed = true;
}

fn material_asset_add() -> i32 {
    for i in 0..g_materials.len {
        if g_materials[i].asset_owned && g_materials[i].removed && g_materials[i].generation < 2147483647 {
            let generation = g_materials[i].generation + 1;
            g_materials[i] = Material { asset_owned: true, generation: generation, .. };
            return i as i32;
        }
    }
    g_materials.push(Material { asset_owned: true, .. });
    return (g_materials.len - 1) as i32;
}

fn material_handle(id: i32) -> MaterialHandle {
    if !material_valid(id) { return MaterialHandle { .. }; }
    return MaterialHandle { id: id, generation: g_materials[id].generation };
}

fn material_handle_valid(handle: MaterialHandle) -> bool {
    return material_valid(handle.id) && g_materials[handle.id].generation == handle.generation;
}

fn material_asset_release(handle: MaterialHandle) -> bool {
    guard material_handle_valid(handle) && g_materials[handle.id].asset_owned else { return false; }
    material_release_slot(handle.id);
    return true;
}

// Empty the scene, for a program that builds more than one. The compiler
// refuses this while any reference into a node is still live, which is what
// keeps a stale handle from surviving it.
fn scene_clear() { g_nodes.clear(); g_scene_epoch += 1; }

// References must not be retained across removal or scene_clear().
fn node(id: i64) -> Node& { return g_nodes[id] }

fn node_handle(id: i64) -> NodeHandle {
    guard id >= 0 && id < g_nodes.len && !g_nodes[id].asset_free else { return NodeHandle { .. }; }
    return NodeHandle { index: id, generation: g_nodes[id].generation, epoch: g_scene_epoch };
}

fn node_handle_valid(handle: NodeHandle) -> bool {
    return handle.epoch == g_scene_epoch && handle.index >= 0 && handle.index < g_nodes.len &&
           !g_nodes[handle.index].asset_free && g_nodes[handle.index].generation == handle.generation;
}

// Add a node and get its handle back; `node` turns the handle into a
// reference once, and the reference is what the rest of the code uses.
fn node_add(mesh_id: i32) -> i64 {
    guard mesh_id == -1 || mesh_handle_valid(mesh_handle(mesh_id)) else { return -1; }
    for i in 0..g_nodes.len {
        if !g_nodes[i].asset_owned && g_nodes[i].asset_free && g_nodes[i].generation < 2147483647 {
            let generation = g_nodes[i].generation + 1;
            g_nodes[i] = Node { mesh: mesh_id, generation: generation, .. };
            return i;
        }
    }
    g_nodes.push(Node { mesh: mesh_id, .. });
    return g_nodes.len - 1;
}

// Asset nodes may be recycled only after their owner has been disposed.
fn node_asset_add(mesh_id: i32) -> i64 {
    guard mesh_id == -1 || mesh_handle_valid(mesh_handle(mesh_id)) else { return -1; }
    for i in 0..g_nodes.len {
        if g_nodes[i].asset_owned && g_nodes[i].asset_free && g_nodes[i].generation < 2147483647 {
            let generation = g_nodes[i].generation + 1;
            g_nodes[i] = Node { mesh: mesh_id, asset_owned: true, generation: generation, .. };
            return i;
        }
    }
    g_nodes.push(Node { mesh: mesh_id, asset_owned: true, .. });
    return g_nodes.len - 1;
}

// Remove an ordinary mesh only after all live nodes have stopped referencing it.
// Mesh IDs stay stable and are never reused; retain a MeshHandle to detect removal.
fn mesh_remove(handle: MeshHandle) -> bool {
    guard mesh_handle_valid(handle) && !g_meshes[handle.id].asset_owned else { return false; }
    for i in 0..g_nodes.len {
        if !g_nodes[i].asset_free && g_nodes[i].mesh == handle.id { return false; }
    }
    mesh_remove_storage(handle.id);
    return true;
}

fn node_asset_release_handle(handle: NodeHandle) -> bool {
    guard node_handle_valid(handle) && g_nodes[handle.index].asset_owned else { return false; }
    node_asset_release(handle.index);
    return true;
}

fn node_asset_release(id: i64) {
    guard id >= 0 && id < g_nodes.len else { return; }
    guard g_nodes[id].asset_owned && !g_nodes[id].asset_free else { return; }
    node_release_slot(id);
}

// Remove an ordinary node, retaining its children under its former parent.
// The baked local matrix preserves their world transforms, including shear.
fn node_remove(handle: NodeHandle) -> bool {
    guard node_handle_valid(handle) && !g_nodes[handle.index].asset_owned else { return false; }
    node_release_slot(handle.index);
    return true;
}

fn node_release_slot(id: i64) {
    let local = node_local(g_nodes[id]);
    let parent = g_nodes[id].parent;
    for i in 0..g_nodes.len {
        if i != id && !g_nodes[i].asset_free && g_nodes[i].parent == id {
            g_nodes[i].local_matrix = mat4_mul(local, node_local(g_nodes[i]));
            g_nodes[i].use_local_matrix = true;
            g_nodes[i].parent = parent;
        }
    }
    g_nodes[id].visible = false;
    g_nodes[id].asset_free = true;
    g_nodes[id].mesh = -1;
    g_nodes[id].parent = -1;
}

// A node with children and no geometry of its own: the pivot of a hierarchy.
fn node_group() -> i64 {
    return node_add(-1);
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

fn camera_state() -> CameraState {
    return CameraState { camera: g_camera, yaw: g_camera_yaw, pitch: g_camera_pitch,
                         distance: g_camera_distance, orbit_target: g_camera_target,
                         removed: false };
}

// Save a copy of the current view. The first saved camera becomes active.
fn camera_add() -> i64 {
    g_cameras.push(camera_state());
    let id = g_cameras.len - 1;
    if g_active_camera < 0 { g_active_camera = id; }
    return id;
}

fn camera_active() -> i64 { return g_active_camera }
fn camera_count() -> i64 {
    var count: i64 = 0;
    for i in 0..g_cameras.len { if !g_cameras[i].removed { count += 1; } }
    return count;
}

// Camera IDs are stable append-only slots. Removal invalidates the ID without
// shifting later cameras, so callers can safely retain IDs for other cameras.
fn camera_remove(id: i64) -> bool {
    guard id >= 0 && id < g_cameras.len && !g_cameras[id].removed else { return false; }
    g_cameras[id].removed = true;
    if g_active_camera == id {
        g_active_camera = -1;
        for i in 0..g_cameras.len {
            if !g_cameras[i].removed { camera_select(i); break; }
        }
    }
    return true;
}

// Switching saves direct camera() edits as well as orbit state. Cameras persist
// across scene_clear(); invalid IDs leave the current view untouched.
fn camera_select(id: i64) -> bool {
    guard id >= 0 && id < g_cameras.len && !g_cameras[id].removed else { return false; }
    if g_active_camera >= 0 { g_cameras[g_active_camera] = camera_state(); }
    let state = g_cameras[id];
    g_camera = state.camera;
    g_camera_yaw = state.yaw;
    g_camera_pitch = state.pitch;
    g_camera_distance = state.distance;
    g_camera_target = state.orbit_target;
    g_active_camera = id;
    return true;
}

// Both renderers consume this projection through the common view-projection matrix.
fn camera_projection(cam: Camera, aspect: f32) -> Mat4 {
    if cam.orthographic {
        let half = cam.ortho_height * 0.5;
        return mat4_ortho(-half * aspect, half * aspect, -half, half, cam.near, cam.far);
    }
    return mat4_perspective(cam.fov, aspect, cam.near, cam.far);
}

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
