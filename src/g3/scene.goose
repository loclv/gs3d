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
import g3.platform;

namespace g3;

struct Node {
    mesh: i32 = -1,             // -1: a group, it draws nothing
    // Optional label for node_find; the slice must outlive the node —
    // string literals and other static data are the safe sources.
    name: const u8[:] = "",
    // Two-level LOD: when the view distance exceeds lod_distance and
    // lod_mesh names a live mesh, that mesh is drawn instead. 0 distance
    // disables the swap; -1 mesh disables it too.
    lod_mesh: i32 = -1,
    lod_distance: f32 = 0.0,
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
    world_dirty: bool = true,   // sticky until a draw item refreshes its cached MVP
    cached_world_parent: i32 = -2,
    world_version: i64,        // increments when the world matrix changes
    cached_mvp: Mat4,
    cached_mvp_view_version: i64 = -1,
    mvp_cache_valid: bool,
    cached_cull_world_version: i64 = -1, // cache key: transform
    cached_cull_view_version: i64 = -1,  // cache key: camera frustum
    cached_cull_mesh: i32 = -2,          // cache key: mesh bounds owner
    cached_cull_bounds_version: i64 = -1,
    cached_cull_intersects: bool,
    cull_cache_valid: bool,
    local_matrix: Mat4,         // optional imported affine transform
    use_local_matrix: bool,
    cached_local: Mat4,          // local transform cache for unparented nodes
    cached_pos: float3,
    cached_rot: float3,
    cached_scale: float3,
    cached_local_matrix: Mat4,
    cached_use_local_matrix: bool,
    local_cache_valid: bool,
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
    ior: f32 = 1.5,
    metallic_roughness_texture: i32 = -1,
    normal_texture: i32 = -1,
    normal_scale: f32 = 1.0,
    occlusion_texture: i32 = -1,
    occlusion_strength: f32 = 1.0,
    emissive: float3,
    emissive_texture: i32 = -1,
    double_sided: bool,   // render back faces and flip their normals
    base_color_uv: g3::UvTransform = g3::UvTransform { scale: float2 { 1.0, 1.0 }, .. },
    metallic_roughness_uv: g3::UvTransform = g3::UvTransform { scale: float2 { 1.0, 1.0 }, .. },
    normal_uv: g3::UvTransform = g3::UvTransform { scale: float2 { 1.0, 1.0 }, .. },
    occlusion_uv: g3::UvTransform = g3::UvTransform { scale: float2 { 1.0, 1.0 }, .. },
    emissive_uv: g3::UvTransform = g3::UvTransform { scale: float2 { 1.0, 1.0 }, .. },
    specular_factor: f32 = 1.0,
    specular_color_factor: float3 = float3_1,
    specular_texture: i32 = -1,
    specular_color_texture: i32 = -1,
    specular_uv: g3::UvTransform = g3::UvTransform { scale: float2 { 1.0, 1.0 }, .. },
    specular_color_uv: g3::UvTransform = g3::UvTransform { scale: float2 { 1.0, 1.0 }, .. },
    clearcoat_factor: f32,
    clearcoat_roughness: f32,
    clearcoat_texture: i32 = -1,
    clearcoat_roughness_texture: i32 = -1,
    clearcoat_normal_texture: i32 = -1,
    clearcoat_normal_scale: f32 = 1.0,
    clearcoat_uv: g3::UvTransform = g3::UvTransform { scale: float2 { 1.0, 1.0 }, .. },
    clearcoat_roughness_uv: g3::UvTransform = g3::UvTransform { scale: float2 { 1.0, 1.0 }, .. },
    clearcoat_normal_uv: g3::UvTransform = g3::UvTransform { scale: float2 { 1.0, 1.0 }, .. },
    sheen_color: float3,
    sheen_roughness: f32,
    sheen_color_texture: i32 = -1,
    sheen_roughness_texture: i32 = -1,
    sheen_color_uv: g3::UvTransform = g3::UvTransform { scale: float2 { 1.0, 1.0 }, .. },
    sheen_roughness_uv: g3::UvTransform = g3::UvTransform { scale: float2 { 1.0, 1.0 }, .. },
    anisotropy_strength: f32,
    anisotropy_rotation: f32,
    anisotropy_texture: i32 = -1,
    anisotropy_uv: g3::UvTransform = g3::UvTransform { scale: float2 { 1.0, 1.0 }, .. },
    environment_intensity: f32 = 1.0,
    // Custom fragment program (WebGL-only): -1 standard, else a shader id
    // registered through g3::material_shader_create.
    shader: i32 = -1,
    // Thirty-two floats exposed to the custom shader as `uniform vec4 u_user[8]`.
    user0: float4 = float4_0,
    user1: float4 = float4_0,
    user2: float4 = float4_0,
    user3: float4 = float4_0,
    user4: float4 = float4_0,
    user5: float4 = float4_0,
    user6: float4 = float4_0,
    user7: float4 = float4_0,
    // 3D texture sampled by the custom shader as `u_lut` (WebGL-only).
    lut_texture: i32 = -1,
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
    aspect: f32,                // zero follows the viewport; positive locks horizontal framing
    orthographic: bool,         // perspective by default
    ortho_height: f32 = 10.0,  // full vertical extent, world units
    near: f32 = 0.1,
    far: f32 = 400.0,
    // Tiled rendering (three.js camera.setViewOffset): the camera renders
    // only the sub-rectangle (x, y, w, h) of a virtual full_w x full_h image,
    // through an off-axis frustum. All values are in pixels; zero disables.
    view_offset: float4 = float4 { 0.0, 0.0, 0.0, 0.0 },   // full_w, full_h, x, y
    view_size: float2 = float2 { 0.0, 0.0 },               // w, h
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

fn material_set_environment_intensity(id: i32, intensity: f32) -> bool {
    guard material_valid(id) && intensity >= 0.0 && intensity <= 3.4e38 else { return false; }
    g_materials[id].environment_intensity = intensity;
    return true;
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

// Children of a node in scene order. Goose has no iterators, so callers
// walk `for i in 0..node_child_count(p)` and `node_child_at(p, i)`.
fn node_child_count(parent: i64) -> i64 {
    let p = parent as i32;
    var count: i64 = 0;
    for i in 0..g_nodes.len {
        if !g_nodes[i].asset_free && g_nodes[i].parent == p { count += 1; }
    }
    return count;
}

fn node_child_at(parent: i64, index: i64) -> i64 {
    let p = parent as i32;
    var seen: i64 = 0;
    for i in 0..g_nodes.len {
        if !g_nodes[i].asset_free && g_nodes[i].parent == p {
            if seen == index { return i; }
            seen += 1;
        }
    }
    return -1;
}

fn node_set_name(id: i64, name: const u8[:]) -> bool {
    guard id >= 0 && id < g_nodes.len && !g_nodes[id].asset_free else { return false; }
    g_nodes[id].name = name;
    return true;
}

fn node_name(id: i64) -> const u8[:] {
    guard id >= 0 && id < g_nodes.len else { return ""; }
    return g_nodes[id].name;
}

// First live node carrying `name`, or -1. Comparison is bytewise.
fn node_find(name: const u8[:]) -> i64 {
    for i in 0..g_nodes.len {
        if g_nodes[i].asset_free || g_nodes[i].name.len != name.len { continue; }
        var same = true;
        for j in 0..name.len {
            if g_nodes[i].name[j] != name[j] { same = false; break; }
        }
        if same { return i; }
    }
    return -1;
}

fn node_local(n: Node&) -> Mat4 {
    if n.use_local_matrix { return n.local_matrix; }
    return mat4_trs(n.pos, n.rot, n.scale);
}

fn node_local_cache_changed(n: Node&) -> bool {
    if !n.local_cache_valid || n.cached_use_local_matrix != n.use_local_matrix { return true; }
    if n.use_local_matrix {
        for i in 16 { if n.cached_local_matrix.m[i] != n.local_matrix.m[i] { return true; } }
        return false;
    }
    return n.cached_pos.x != n.pos.x || n.cached_pos.y != n.pos.y || n.cached_pos.z != n.pos.z ||
           n.cached_rot.x != n.rot.x || n.cached_rot.y != n.rot.y || n.cached_rot.z != n.rot.z ||
           n.cached_scale.x != n.scale.x || n.cached_scale.y != n.scale.y || n.cached_scale.z != n.scale.z;
}

fn node_cache_local(n: Node&) {
    n.cached_local = node_local(n);
    n.cached_pos = n.pos;
    n.cached_rot = n.rot;
    n.cached_scale = n.scale;
    n.cached_local_matrix = n.local_matrix;
    n.cached_use_local_matrix = n.use_local_matrix;
    n.local_cache_valid = true;
}

// Multiplied out from the root down, into every node's `world`. A chain
// longer than 64 is treated as a loop and stops there rather than hanging.
fn node_update_worlds() {
    for &n in g_nodes {
        if n.parent < 0 {
            let local_changed = node_local_cache_changed(n);
            if local_changed { node_cache_local(n); }
            if local_changed || n.cached_world_parent != n.parent {
                n.world = n.cached_local;
                n.world_dirty = true;
                n.world_version += 1;
            }
            n.cached_world_parent = n.parent;
            continue;
        }
        var w = node_local(n);
        var p = n.parent;
        var up = 0;
        while p >= 0 && up < 64 {
            let pn .= g_nodes[p];
            w = mat4_mul(node_local(pn), w);
            p = pn.parent;
            up++;
        }
        if !mat4_equals(n.world, w) || n.cached_world_parent != n.parent {
            n.world = w;
            n.world_dirty = true;
            n.world_version += 1;
        }
        n.cached_world_parent = n.parent;
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

// Add a camera without changing the current view. Asset loaders use this for
// cameras that are selected explicitly by the application.
fn camera_add_detached(cam: Camera) -> i64 {
    let offset = cam.pos - cam.target;
    let distance = length(offset);
    let yaw = atan2(offset.x, offset.z);
    let pitch = asin(offset.y / (if distance > 0.000001 { distance } else { 1.0 }));
    g_cameras.push(CameraState { camera: cam, yaw: yaw, pitch: pitch, distance: distance,
        orbit_target: cam.target, removed: false });
    return g_cameras.len - 1;
}

fn camera_active() -> i64 { return g_active_camera }
fn camera_update(id: i64, cam: Camera) -> bool {
    guard id >= 0 && id < g_cameras.len && !g_cameras[id].removed else { return false; }
    // View offset is a separate concern from the view parameters callers
    // update every frame; keep it across camera_update.
    var c = cam;
    c.view_offset = g_cameras[id].camera.view_offset;
    c.view_size = g_cameras[id].camera.view_size;
    g_cameras[id].camera = c;
    if g_active_camera == id { g_camera = c; }
    return true;
}

// Set or clear a camera's tiled view offset (see Camera.view_offset). A
// non-positive width or height disables tiling. camera_update preserves the
// fields, so this only needs calling when the offset itself changes.
fn camera_set_view_offset(id: i64, full_w: f32, full_h: f32, x: f32, y: f32, w: f32, h: f32) -> bool {
    guard id >= 0 && id < g_cameras.len && !g_cameras[id].removed else { return false; }
    if w <= 0.0 || h <= 0.0 || full_w <= 0.0 || full_h <= 0.0 {
        g_cameras[id].camera.view_offset = float4 { 0.0, 0.0, 0.0, 0.0 };
        g_cameras[id].camera.view_size = float2 { 0.0, 0.0 };
    } else {
        g_cameras[id].camera.view_offset = float4 { full_w, full_h, x, y };
        g_cameras[id].camera.view_size = float2 { w, h };
    }
    if g_active_camera == id { g_camera = g_cameras[id].camera; }
    return true;
}
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
    let projection_aspect = if cam.aspect > 0.0 { cam.aspect } else { aspect };
    let vo = cam.view_offset;
    let vs = cam.view_size;
    let tiled = vs.x > 0.0 && vs.y > 0.0 && vo.x > 0.0 && vo.y > 0.0;
    if cam.orthographic {
        let half = cam.ortho_height * 0.5;
        var left = -half * projection_aspect;
        var right = half * projection_aspect;
        var bottom = -half;
        var top = half;
        if tiled {
            // Same fractions of the full image three.js applies to ortho bounds.
            let fw = right - left;
            let fh = top - bottom;
            let x0 = left + vo.z * fw / vo.x;
            left = x0;
            right = x0 + vs.x * fw / vo.x;
            let y0 = top - vo.w * fh / vo.y;
            top = y0;
            bottom = y0 - vs.y * fh / vo.y;
        }
        return mat4_ortho(left, right, bottom, top, cam.near, cam.far);
    }
    let half_h = cam.near * tan(cam.fov * 0.5);
    let height = 2.0 * half_h;
    let width = projection_aspect * height;
    if tiled {
        // three.js PerspectiveCamera.updateProjectionMatrix with view offset.
        var left = -0.5 * width + vo.z * width / vo.x;
        var right = left + vs.x * width / vo.x;
        var top = half_h - vo.w * height / vo.y;
        var bottom = top - vs.y * height / vo.y;
        return mat4_perspective_frustum(left, right, bottom, top, cam.near, cam.far);
    }
    return mat4_perspective(cam.fov, projection_aspect, cam.near, cam.far);
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

// Pan the active view in screen space. Positive drag moves the view with the
// pointer; perspective scale follows orbit distance, while orthographic scale
// follows its visible vertical extent.
fn camera_pan(dx: f32, dy: f32, viewport_height: i32) -> bool {
    guard viewport_height > 0 && abs(dx) <= 3.4e38 && abs(dy) <= 3.4e38 else { return false; }
    let offset = g_camera.target - g_camera.pos;
    let distance = length(offset);
    guard distance > 1.0e-6 else { return false; }
    let forward = offset / distance;
    let right_raw = cross(forward, g_camera.up);
    let right_length = length(right_raw);
    guard right_length > 1.0e-6 else { return false; }
    let right = right_raw / right_length;
    let up = cross(right, forward);
    let world_height = if g_camera.orthographic { g_camera.ortho_height } else { 2.0 * distance * tan(g_camera.fov * 0.5) };
    guard world_height > 0.0 && abs(world_height) <= 3.4e38 else { return false; }
    let delta = right * (-dx * world_height / viewport_height) + up * (dy * world_height / viewport_height);
    g_camera.pos += delta;
    g_camera.target += delta;
    g_camera_target = g_camera.target;
    return true;
}
