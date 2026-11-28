// The renderer: one pass over the scene per frame.
//
// Per frame it multiplies out the node transforms, builds the view and
// projection matrices, derives the six frustum planes, then walks the nodes:
// cull against the planes, pack a `DrawItem` for what survives, sort the list,
// and hand it to the backend in one call.
//
// The sort is the whole batching story. Opaque items are keyed by mesh id, so
// the backends see runs of the same mesh back to back, which is where a driver
// saves state changes; blended items are keyed to draw far to near, after
// everything opaque. A key below 1000000 is opaque, above it is blended.

import vec;
import math;
import std;
import g3.math;
import g3.platform;
import g3.mesh;
import g3.scene;
import g3.texture;

namespace g3;

struct Stats {
    nodes: i64,         // nodes with geometry that the pass looked at
    drawn: i64,         // items that went to the backend
    culled: i64,        // left out by the frustum
    distance_culled: i64, // left out by set_max_view_distance
    lod_swaps: i64,     // nodes drawn through their lod_mesh
    triangles: i64,
    draws: i64,         // draw items submitted to the backend, before backend batching
    feedback_items_suppressed: i64, // submitted items skipped because a material samples the active target
}

var g_draws: DrawItem[>..];
var g_view_state: ViewState;
var g_stats: Stats;
var g_view: Mat4;
var g_view_proj: Mat4;
var g_cached_view_proj: Mat4;
var g_view_proj_version: i64;
var g_view_proj_cache_valid: bool;
var g_frustum: Frustum;
var g_output_srgb: bool;
var g_tone_mapping: i32;
var g_fxaa: bool;
var g_exposure: f32 = 1.0;
var g_max_view_distance: f32 = 0.0;
var g_shadow_center: float3;
var g_shadow_extent: f32;
var g_shadow_bias: f32;
var g_shadow_filter_radius: i32;
var g_post_process_shader_count: i32;
var g_post_process_shader_live: bool[>..];
var g_material_shader_count: i32;
var g_material_shader_live: bool[>..];

let POST_PROCESS_COPY = 0;
let POST_PROCESS_GRAYSCALE = 1;
let POST_PROCESS_INVERT = 2;
let POST_PROCESS_FXAA = 3;
let POST_PROCESS_MAX_PASSES = 8;

struct QueuedPostProcessPass { source: i32, destination: i32, effect: i32, shader: i32 = -1 }
var g_post_process_queue: QueuedPostProcessPass[>..];

// Asset light sets are temporary overlays. The saved chain lets models be
// disposed in any order without resurrecting lights from an already disposed
// model when a newer overlay is later removed.
struct SavedLightSet {
    previous: i32,
    removed: bool,
    children: i32,
    lights: Light[8],
    count: i32,
    point_view_proj: Mat4[6], point_index: i32, point_params: float4,
    spot_view_proj: Mat4, spot_index: i32, spot_params: float4,
}
var g_saved_light_sets: SavedLightSet[>..];
var g_active_light_set: i32 = -1;
// Bumped whenever the extra-light list (or a saved set's restore) changes;
// node light masks key on it so per-fragment light culling stays correct.
var g_lights_version: i64 = 0;

// --- the frame's constants

fn set_light(dir: float3, color: float3) {
    g_view_state.light_dir = normalize(dir);
    g_view_state.light_color = color;
    if g_view_state.shadow_params.x > 0.5 {
        let updated = set_directional_shadows(g_shadow_center, g_shadow_extent, g_shadow_bias);
        if !updated { clear_shadows(); }
    }
}

// The original directional light is independent of these eight extra lights.
fn clear_lights() { g_view_state.light_count = 0; clear_point_light_shadows(); clear_spot_light_shadows(); g_lights_version += 1; }

fn light_set_snapshot(previous: i32) -> SavedLightSet {
    return SavedLightSet { previous: previous, removed: false, children: 0,
        lights: g_view_state.lights, count: g_view_state.light_count,
        point_view_proj: g_view_state.point_shadow_view_proj,
        point_index: g_view_state.point_shadow_light_index, point_params: g_view_state.point_shadow_params,
        spot_view_proj: g_view_state.spot_shadow_view_proj, spot_index: g_view_state.spot_shadow_light_index,
        spot_params: g_view_state.spot_shadow_params };
}

fn asset_light_set_begin() -> i32 {
    var id: i32 = -1;
    for i in 0..g_saved_light_sets.len {
        if g_saved_light_sets[i].removed && g_saved_light_sets[i].children == 0 { id = i as i32; break; }
    }
    let snapshot = light_set_snapshot(g_active_light_set);
    if id < 0 {
        g_saved_light_sets.push(snapshot);
        id = (g_saved_light_sets.len - 1) as i32;
    } else {
        g_saved_light_sets[id] = snapshot;
    }
    if g_active_light_set >= 0 { g_saved_light_sets[g_active_light_set].children += 1; }
    g_active_light_set = id;
    clear_lights();
    return id;
}

fn asset_light_set_active() -> i32 { return g_active_light_set; }
fn asset_light_set_clear() { clear_lights(); }

fn asset_light_set_release(id: i32) -> bool {
    guard id >= 0 && id < g_saved_light_sets.len && !g_saved_light_sets[id].removed else { return false; }
    g_saved_light_sets[id].removed = true;
    if g_active_light_set != id { return true; }
    var releasing = id;
    var done = false;
    while !done {
        let saved = g_saved_light_sets[releasing];
        g_view_state.light_count = saved.count;
        for i in 0..8 { g_view_state.lights[i] = saved.lights[i]; }
        for i in 0..6 { g_view_state.point_shadow_view_proj[i] = saved.point_view_proj[i]; }
        g_view_state.point_shadow_light_index = saved.point_index;
        g_view_state.point_shadow_params = saved.point_params;
        g_view_state.spot_shadow_view_proj = saved.spot_view_proj;
        g_view_state.spot_shadow_light_index = saved.spot_index;
        g_view_state.spot_shadow_params = saved.spot_params;
        let previous = saved.previous;
        if previous >= 0 { g_saved_light_sets[previous].children -= 1; }
        if previous >= 0 && g_saved_light_sets[previous].removed { releasing = previous; }
        else { g_active_light_set = previous; done = true; }
    }
    g_lights_version += 1;
    return true;
}

fn add_directional_light(dir: float3, color: float3) -> bool {
    guard length(dir) > 0.0 && g_view_state.light_count < 8 else { return false; }
    let d = normalize(dir);
    let i = g_view_state.light_count;
    g_view_state.lights[i] = Light { position: float4 { 0.0, 0.0, 0.0, 0.0 },
        direction: float4 { d.x, d.y, d.z, 0.0 }, color: float4 { color.x, color.y, color.z, 0.0 }, inner: 0.0, attenuation: 0.0 };
    g_view_state.light_count += 1;
    g_lights_version += 1;
    return true;
}

// Point and spot lights use squared linear range falloff by default.
fn add_point_light_mode(pos: float3, color: float3, range: f32, attenuation: f32) -> bool {
    guard range >= 0.0 && (range > 0.0 || attenuation > 0.5) && g_view_state.light_count < 8 else { return false; }
    let i = g_view_state.light_count;
    g_view_state.lights[i] = Light { position: float4 { pos.x, pos.y, pos.z, 1.0 },
        direction: float4 { 0.0, 0.0, 0.0, range }, color: float4 { color.x, color.y, color.z, 0.0 }, inner: 0.0, attenuation: attenuation };
    g_view_state.light_count += 1;
    g_lights_version += 1;
    return true;
}

fn add_point_light(pos: float3, color: float3, range: f32) -> bool {
    return add_point_light_mode(pos, color, range, 0.0);
}

// Physical point lights use inverse-square distance attenuation and a smooth
// squared range fade. A zero range means no lighting cutoff.
fn add_point_light_physical(pos: float3, color: float3, range: f32) -> bool {
    return add_point_light_mode(pos, color, range, 1.0);
}

// One extra point light can cast a six-face hard shadow. The index is its
// position in the extra-light list; changing lights requires calling again.
fn set_point_light_shadows(light_index: i32, bias: f32) -> bool {
    guard light_index >= 0 && light_index < g_view_state.light_count && bias >= 0.0 else { return false; }
    let light = g_view_state.lights[light_index];
    guard light.position.w > 0.5 && light.position.w < 1.5 && light.direction.w >= 0.0 &&
          (light.direction.w > 0.01 || light.attenuation > 0.5) else { return false; }
    let eye = float3 { light.position.x, light.position.y, light.position.z };
    let far = if light.direction.w > 0.01 { light.direction.w } else { 1000.0 };
    let projection = mat4_perspective(PI * 0.5, 1.0, 0.01, far);
    var directions: float3[6];
    directions[0] = float3 { 1.0, 0.0, 0.0 }; directions[1] = float3 { -1.0, 0.0, 0.0 };
    directions[2] = float3 { 0.0, 1.0, 0.0 }; directions[3] = float3 { 0.0, -1.0, 0.0 };
    directions[4] = float3 { 0.0, 0.0, 1.0 }; directions[5] = float3 { 0.0, 0.0, -1.0 };
    var ups: float3[6];
    ups[0] = float3 { 0.0, -1.0, 0.0 }; ups[1] = float3 { 0.0, -1.0, 0.0 };
    ups[2] = float3 { 0.0, 0.0, 1.0 }; ups[3] = float3 { 0.0, 0.0, -1.0 };
    ups[4] = float3 { 0.0, -1.0, 0.0 }; ups[5] = float3 { 0.0, -1.0, 0.0 };
    for i in 0..6 { g_view_state.point_shadow_view_proj[i] = mat4_mul(projection, mat4_look_at(eye, eye + directions[i], ups[i])); }
    g_view_state.point_shadow_light_index = light_index;
    g_view_state.point_shadow_params = float4 { 1.0, bias, g_shadow_filter_radius, 0.0 };
    return true;
}

fn clear_point_light_shadows() {
    g_view_state.point_shadow_light_index = -1;
    g_view_state.point_shadow_params.x = 0.0;
}

// One extra spot light can cast a single-perspective hard shadow. Spot angles
// wider than a hemisphere cannot be represented by this perspective map.
fn set_spot_light_shadows(light_index: i32, bias: f32) -> bool {
    guard light_index >= 0 && light_index < g_view_state.light_count && bias >= 0.0 else { return false; }
    let light = g_view_state.lights[light_index];
    guard light.position.w > 1.5 && light.direction.w >= 0.0 &&
          (light.direction.w > 0.01 || light.attenuation > 0.5) && light.color.w > 0.0 else { return false; }
    let eye = float3 { light.position.x, light.position.y, light.position.z };
    let dir = float3 { light.direction.x, light.direction.y, light.direction.z };
    let up = if abs(dir.y) > 0.95 { float3 { 1.0, 0.0, 0.0 } } else { float3 { 0.0, 1.0, 0.0 } };
    let far = if light.direction.w > 0.01 { light.direction.w } else { 1000.0 };
    let projection = mat4_perspective(2.0 * acos(light.color.w), 1.0, 0.01, far);
    g_view_state.spot_shadow_view_proj = mat4_mul(projection, mat4_look_at(eye, eye + dir, up));
    g_view_state.spot_shadow_light_index = light_index;
    g_view_state.spot_shadow_params = float4 { 1.0, bias, g_shadow_filter_radius, 0.0 };
    return true;
}

fn clear_spot_light_shadows() {
    g_view_state.spot_shadow_light_index = -1;
    g_view_state.spot_shadow_params.x = 0.0;
}

// Set a square PCF radius in map texels: 0 is hard, 1 is 3x3, 2 is 5x5.
// Applies to every enabled and subsequently enabled shadow map.
fn set_shadow_filter_radius(radius: i32) -> bool {
    guard radius >= 0 && radius <= 2 else { return false; }
    g_shadow_filter_radius = radius;
    let r = radius;
    g_view_state.shadow_params.z = r;
    g_view_state.point_shadow_params.z = r;
    g_view_state.spot_shadow_params.z = r;
    return true;
}

// Set every shadow map to one supported square resolution.
fn set_shadow_resolution(resolution: i32) -> bool {
    guard resolution == 256 || resolution == 512 || resolution == 1024 else { return false; }
    g_view_state.shadow_resolution = resolution;
    return true;
}

// Angles are half-angles in radians, with a smooth falloff between them.
fn add_spot_light_mode(pos: float3, dir: float3, color: float3, range: f32, inner: f32, outer: f32, attenuation: f32) -> bool {
    guard range >= 0.0 && (range > 0.0 || attenuation > 0.5) && length(dir) > 0.0 && inner >= 0.0 && inner < outer && outer <= PI && cos(inner) > cos(outer) && g_view_state.light_count < 8 else { return false; }
    let d = normalize(dir);
    let i = g_view_state.light_count;
    g_view_state.lights[i] = Light { position: float4 { pos.x, pos.y, pos.z, 2.0 },
        direction: float4 { d.x, d.y, d.z, range }, color: float4 { color.x, color.y, color.z, cos(outer) }, inner: cos(inner), attenuation: attenuation };
    g_view_state.light_count += 1;
    g_lights_version += 1;
    return true;
}

fn add_spot_light(pos: float3, dir: float3, color: float3, range: f32, inner: f32, outer: f32) -> bool {
    return add_spot_light_mode(pos, dir, color, range, inner, outer, 0.0);
}

fn add_spot_light_physical(pos: float3, dir: float3, color: float3, range: f32, inner: f32, outer: f32) -> bool {
    return add_spot_light_mode(pos, dir, color, range, inner, outer, 1.0);
}

// Diffuse hemispherical environment: sky above, ground below; zero disables it.
fn set_environment(sky: float3, ground: float3, intensity: f32) -> bool {
    guard intensity >= 0.0 && intensity <= 3.4e38 &&
          sky.x >= 0.0 && sky.x <= 3.4e38 && sky.y >= 0.0 && sky.y <= 3.4e38 && sky.z >= 0.0 && sky.z <= 3.4e38 &&
          ground.x >= 0.0 && ground.x <= 3.4e38 && ground.y >= 0.0 && ground.y <= 3.4e38 && ground.z >= 0.0 && ground.z <= 3.4e38 else { return false; }
    g_view_state.env_sky = float4 { sky.x, sky.y, sky.z, intensity };
    g_view_state.env_ground = float4 { ground.x, ground.y, ground.z, 0.0 };
    return true;
}

// Equirectangular linear or HDR environment: diffuse lookup stays on the surface normal;
// metallic-roughness materials sample GGX-prefiltered mips along the reflection
// direction. Longitude wraps and latitude clamps. Specular IBL uses a
// split-sum BRDF integration LUT.
fn set_environment_map(texture: i32, intensity: f32) {
    g_view_state.environment_texture = texture;
    g_view_state.environment_intensity = intensity;
    if texture >= 0 && texture < g_texture_count { g3p_texture_generate_env_mips(texture); }
}

// Rotate the equirectangular environment around world up. The stored pair
// keeps trigonometry out of per-pixel shading in the CPU backend.
fn set_environment_rotation(rotation: f32) -> bool {
    guard rotation >= -3.4e38 && rotation <= 3.4e38 else { return false; }
    g_view_state.env_rotation = float2 { cos(rotation), sin(rotation) };
    return true;
}

// Remove an ordinary texture only when no live scene or environment field uses it.
// Asset textures are released through their owning model.
fn texture_remove(handle: TextureHandle) -> bool {
    guard texture_handle_valid(handle) && !g_texture_slots[handle.id].asset_owned else { return false; }
    let id = handle.id;
    if g_view_state.environment_texture == id { return false; }
    for i in 0..g_nodes.len {
        let n .= g_nodes[i];
        if n.asset_free { continue; }
        if n.texture == id { return false; }
    }
    for i in 0..g_materials.len {
        let m .= g_materials[i];
        if m.removed { continue; }
        if m.texture == id || m.metallic_roughness_texture == id || m.normal_texture == id ||
           m.occlusion_texture == id || m.emissive_texture == id || m.specular_texture == id ||
           m.specular_color_texture == id || m.clearcoat_texture == id ||
           m.clearcoat_roughness_texture == id || m.clearcoat_normal_texture == id ||
           m.sheen_color_texture == id || m.sheen_roughness_texture == id ||
           m.anisotropy_texture == id { return false; }
    }
    return texture_remove_storage(handle);
}

fn render_target_remove(id: i32) -> bool {
    guard id >= 0 && id < g_texture_count && g_texture_slots[id].render_target && texture_slot_live(id) else { return false; }
    if !texture_remove(texture_handle(id)) { return false; }
    if id == g_render_target { g_render_target = -1; g_render_target_width = 0; g_render_target_height = 0; }
    return true;
}

fn render_target_remove_handle(handle: RenderTargetHandle) -> bool {
    guard render_target_handle_valid(handle) else { return false; }
    return render_target_remove(handle.texture.id);
}

// The primary directional light casts into an explicitly bounded box. Objects
// outside this box do not cast or receive shadows. Bias is in depth-map units.
fn set_directional_shadows(center: float3, extent: f32, bias: f32) -> bool {
    guard extent > 0.0 && bias >= 0.0 && length(g_view_state.light_dir) > 0.0 else { return false; }
    let dir = g_view_state.light_dir;
    let up = if abs(dir.y) > 0.95 { float3 { 1.0, 0.0, 0.0 } } else { float3 { 0.0, 1.0, 0.0 } };
    let view = mat4_look_at(center - dir * (extent * 2.0), center, up);
    let proj = mat4_ortho(-extent, extent, -extent, extent, 0.01, extent * 4.0);
    g_view_state.shadow_view_proj = mat4_mul(proj, view);
    g_view_state.shadow_params = float4 { 1.0, bias, g_shadow_filter_radius, 0.0 };
    g_shadow_center = center;
    g_shadow_extent = extent;
    g_shadow_bias = bias;
    return true;
}

fn clear_shadows() { g_view_state.shadow_params.x = 0.0; }

fn set_ambient(color: float3, intensity: f32) {
    g_view_state.ambient = float4 { color.x, color.y, color.z, intensity };
}

// Density is per world unit and exponential: 0 turns fog off, and 0.002
// already fades a horizon a few hundred units away.
fn set_fog(color: float3, density: f32) {
    g_view_state.fog = float4 { color.x, color.y, color.z, density };
}

fn set_background(color: float4) { g_view_state.clear = color; }

// When enabled, lighting and blending occur in linear space and the final
// framebuffer is encoded to sRGB. Disabled by default for existing scenes.
fn set_output_srgb(enabled: bool) { g_output_srgb = enabled; }

let TONE_MAPPING_NONE = 0;
let TONE_MAPPING_REINHARD = 1;
let TONE_MAPPING_ACES = 2;

// Select how linear HDR output is mapped to the display range. WebGL uses
// inline mapping when floating-point color blending is unavailable.
fn set_tone_mapping_mode(mode: i32) -> bool {
    guard mode >= TONE_MAPPING_NONE && mode <= TONE_MAPPING_ACES else { return false; }
    g_tone_mapping = mode;
    return true;
}

// Kept for existing callers: true selects ACES and false disables mapping.
fn set_tone_mapping(enabled: bool) { g_tone_mapping = if enabled { TONE_MAPPING_ACES } else { TONE_MAPPING_NONE }; }

// Apply a fast edge-aware antialiasing pass after scene rendering.
fn set_fxaa(enabled: bool) { g_fxaa = enabled; }

// World-space distance beyond which nodes are culled, measured to the
// nearest point of the node's bounds sphere. 0 disables. Perspective
// cameras only — orthographic depth is not a distance.
fn set_max_view_distance(distance: f32) -> bool {
    guard distance >= 0.0 && distance <= 3.4e38 else { return false; }
    g_max_view_distance = distance;
    return true;
}

// Apply one built-in pass from any texture to a render target. Calls can be
// chained in order; source and destination must be different textures.
fn post_process_run(source: i32, destination: i32, effect: i32) -> bool {
    guard post_process_pass_ok(source, destination) && effect >= POST_PROCESS_COPY && effect <= POST_PROCESS_FXAA else { return false; }
    return g3p_post_process(source, destination, effect);
}

// Compile a fragment-body-only WebGL2 pass. The body receives `vec2 uv`,
// `vec4 color`, and `sampler2D g3_source`; assign the transformed value to
// `color`. The CPU backend reports unsupported by returning -1.
fn post_process_shader_create(body: const u8[:]) -> i32 {
    guard body.len > 0 && body.len <= 16384 && g_post_process_shader_count < 64 else { return -1; }
    let id = g_post_process_shader_count;
    g_post_process_shader_count += 1;
    g_post_process_shader_live.push(false);
    if !g3p_post_process_shader_create(id, body) { return -1; }
    g_post_process_shader_live[id] = true;
    return id;
}

fn post_process_shader_run(shader: i32, source: i32, destination: i32) -> bool {
    guard shader >= 0 && shader < g_post_process_shader_live.len && g_post_process_shader_live[shader] &&
          post_process_pass_ok(source, destination) else { return false; }
    return g3p_post_process_shader_run(shader, source, destination);
}

fn post_process_shader_remove(shader: i32) -> bool {
    guard shader >= 0 && shader < g_post_process_shader_live.len && g_post_process_shader_live[shader] else { return false; }
    g3p_post_process_shader_release(shader);
    g_post_process_shader_live[shader] = false;
    return true;
}

// Register a custom material fragment shader (WebGL-only). `header` is GLSL
// inserted before main() (helper functions, globals, extra uniforms such as
// samplers); `body` is statements inside main() where the material's lighting
// inputs are still writable; `tail` is statements after tone mapping and sRGB
// encoding, just before output, operating on `col` and `alpha`. The backend
// owns the source copies; the CPU backend reports unsupported by returning -1.
fn material_shader_create(header: const u8[:], body: const u8[:], tail: const u8[:]) -> i32 {
    guard header.len + body.len + tail.len > 0 && header.len + body.len + tail.len <= 131072 && g_material_shader_count < 64 else { return -1; }
    let id = g_material_shader_count;
    g_material_shader_count += 1;
    g_material_shader_live.push(false);
    if !g3p_material_shader_create(id, header, body, tail) { return -1; }
    g_material_shader_live[id] = true;
    return id;
}

fn material_shader_valid(shader: i32) -> bool {
    return shader >= 0 && shader < g_material_shader_live.len && g_material_shader_live[shader];
}

fn material_shader_remove(shader: i32) -> bool {
    guard material_shader_valid(shader) else { return false; }
    g3p_material_shader_release(shader);
    g_material_shader_live[shader] = false;
    return true;
}

// Raw shader programs (ShaderMaterial-style, WebGL-only): complete GLSL ES
// 1.00 vertex and fragment sources plus named uniforms. Ids handed to
// materials are offset by g_raw_shader_base so they cannot collide with
// lit custom shader ids in DrawItem.shader.
const g_raw_shader_base: i32 = 64;
var g_raw_shader_count: i32;
var g_raw_shader_live: bool[>..];

fn material_raw_shader_create(vertex: const u8[:], fragment: const u8[:], glsl3: i32) -> i32 {
    guard vertex.len + fragment.len > 0 && vertex.len + fragment.len <= 262144 && g_raw_shader_count < 64 else { return -1; }
    let id = g_raw_shader_count;
    g_raw_shader_count += 1;
    g_raw_shader_live.push(false);
    if !g3p_raw_shader_create(id, vertex, fragment, glsl3) { return -1; }
    g_raw_shader_live[id] = true;
    return g_raw_shader_base + id;
}

fn material_raw_shader_valid(shader: i32) -> bool {
    let id = shader - g_raw_shader_base;
    return id >= 0 && id < g_raw_shader_live.len && g_raw_shader_live[id];
}

fn material_raw_shader_remove(shader: i32) -> bool {
    guard material_raw_shader_valid(shader) else { return false; }
    let id = shader - g_raw_shader_base;
    g3p_raw_shader_release(id);
    g_raw_shader_live[id] = false;
    return true;
}

// Uniform kinds match the backend's raw_uniform types.
const raw_uniform_float: i32 = 0;
const raw_uniform_vec2: i32 = 1;
const raw_uniform_vec3: i32 = 2;
const raw_uniform_vec4: i32 = 3;
const raw_uniform_mat4: i32 = 4;
const raw_uniform_int: i32 = 5;

fn raw_uniform_components(kind: i32) -> i32 {
    if kind == raw_uniform_float || kind == raw_uniform_int { return 1; }
    if kind == raw_uniform_vec2 { return 2; }
    if kind == raw_uniform_vec3 { return 3; }
    if kind == raw_uniform_vec4 { return 4; }
    if kind == raw_uniform_mat4 { return 16; }
    return 0;
}

fn material_raw_shader_uniform(shader: i32, name: const u8[:], kind: i32, values: const f32[:]) -> bool {
    guard material_raw_shader_valid(shader) && name.len > 0 && name.len < 64 else { return false; }
    let components = raw_uniform_components(kind);
    guard components > 0 && values.len > 0 && values.len <= 1024 && values.len % components == 0 else { return false; }
    return g3p_raw_shader_uniform(shader - g_raw_shader_base, name, kind, (values.len / components) as i32, values);
}

fn material_raw_shader_uniform_texture(shader: i32, name: const u8[:], texture: i32) -> bool {
    guard material_raw_shader_valid(shader) && name.len > 0 && name.len < 64 &&
          (texture < 0 || texture_slot_live(texture)) else { return false; }
    return g3p_raw_shader_uniform_texture(shader - g_raw_shader_base, name, texture);
}

// A pass needs two live, different textures and a render-target destination.
fn post_process_pass_ok(source: i32, destination: i32) -> bool {
    return source != destination && texture_slot_live(source) && texture_slot_live(destination) &&
           g_texture_slots[destination].render_target;
}

fn post_process_queue_clear() { g_post_process_queue.clear(); }

fn post_process_queue_add(source: i32, destination: i32, effect: i32) -> bool {
    guard g_post_process_queue.len < POST_PROCESS_MAX_PASSES && post_process_pass_ok(source, destination) &&
          effect >= POST_PROCESS_COPY && effect <= POST_PROCESS_FXAA else { return false; }
    g_post_process_queue.push(QueuedPostProcessPass { source, destination, effect, .. });
    return true;
}

fn post_process_queue_add_shader(shader: i32, source: i32, destination: i32) -> bool {
    guard g_post_process_queue.len < POST_PROCESS_MAX_PASSES && shader >= 0 &&
          shader < g_post_process_shader_live.len && g_post_process_shader_live[shader] &&
          post_process_pass_ok(source, destination) else { return false; }
    g_post_process_queue.push(QueuedPostProcessPass { source: source, destination: destination, shader: shader, .. });
    return true;
}

// Execute queued passes in order, then clear the queue even if a backend pass fails.
fn post_process_queue_execute() -> bool {
    var ok = true;
    for i in 0..g_post_process_queue.len {
        let pass = g_post_process_queue[i];
        ok = if pass.shader >= 0 { post_process_shader_run(pass.shader, pass.source, pass.destination) }
             else { post_process_run(pass.source, pass.destination, pass.effect) };
        if !ok { break; }
    }
    g_post_process_queue.clear();
    return ok;
}

// Linear exposure multiplier applied before tone mapping.
fn set_exposure(exposure: f32) -> bool {
    guard exposure >= 0.0 && exposure <= 32.0 else { return false; }
    g_exposure = exposure;
    return true;
}

fn view_state() -> ViewState& { return g_view_state }
fn stats() -> Stats { return g_stats }
fn draw_list() -> DrawItem[:] { return g_draws[..] }

fn view_matrix() -> Mat4 { return g_view }
fn view_proj_matrix() -> Mat4 { return g_view_proj }

// --- the pass

fn begin_frame(time: f64, width: i32, height: i32) {
    g_draws.clear();
    g_stats = Stats { .. };
    node_update_worlds();
    let rw = if g_render_target >= 0 { g_render_target_width } else { width };
    let rh = if g_render_target >= 0 { g_render_target_height } else { height };
    let w = if rw < 1 { 1 } else { rw };
    let h = if rh < 1 { 1 } else { rh };
    g_view = mat4_look_at(g_camera.pos, g_camera.target, g_camera.up);
    let projection = camera_projection(g_camera, w as f32 / h);
    g_view_proj = mat4_mul(projection, g_view);
    g_view_state.view = g_view;
    g_view_state.projection = projection;
    if !g_view_proj_cache_valid || !mat4_equals(g_view_proj, g_cached_view_proj) {
        g_cached_view_proj = g_view_proj;
        g_view_proj_version += 1;
        g_view_proj_cache_valid = true;
    }
    g_view_state.view_proj = g_view_proj;
    g_frustum = frustum_from_view_proj(g_view_proj);
    g_view_state.eye = g_camera.pos;
    // The third row of look-at points from the scene toward the camera.
    g_view_state.view_direction = float4 { g_view.m[2], g_view.m[6], g_view.m[10], if g_camera.orthographic { 1.0 } else { 0.0 } };
    g_view_state.params = float4 { time as f32, if g_output_srgb { 1.0 } else { 0.0 }, g_tone_mapping, g_exposure };
    g_view_state.post_process = if g_fxaa { 1 } else { 0 };
    g_view_state.render_target = g_render_target;
    g_view_state.target_width = g_render_target_width;
    g_view_state.target_height = g_render_target_height;
}

// Where an item sorts. Opaque items sort by mesh id, so the backend sees runs
// of one mesh; blended ones sort far to near, above every opaque key, so they
// are drawn last and can read the depth of everything behind them.
fn sort_key(mesh_id: i32, dist: f32, blended: bool) -> f32 {
    if !blended { return mesh_id; }   /* the mesh id is the key, as a float */
    let key = 1000000.0 + (100000.0 - dist);
    if key < 1000000.0 { return 1000000.0; }
    return key;
}

// Conservative per-node mask of the eight extra lights: bit i is set when
// light i can contribute to any fragment of the drawn mesh. Directional
// extras reach everything; point and spot lights are bounded by their range
// (the shader's range fade is exactly zero past it) and spots additionally
// by a bounding-sphere cone test. Cached on the node against transform,
// light-list and drawn-mesh bounds versions.
fn node_light_mask(n: Node&, mesh_id: i32) -> i32 {
    let count = g_view_state.light_count;
    if count <= 0 { return 0; }
    let m2 .= mesh(mesh_id);
    if n.light_mask_valid &&
        n.cached_light_mask_world == n.world_version &&
        n.cached_light_mask_lights == g_lights_version &&
        n.cached_light_mask_mesh == mesh_id &&
        n.cached_light_mask_bounds == m2.bounds_version {
        return n.cached_light_mask;
    }
    var mask: i32 = 0;
    if !aabb_is_empty(m2.bounds) {
        let box = aabb_transform_affine(m2.bounds, n.world);
        let center = aabb_center(box);
        let radius = aabb_radius(box);
        for i in 0..count {
            let l = g_view_state.lights[i];
            var keep = true;
            if l.position.w > 0.5 {
                let to_center = center - float3 { l.position.x, l.position.y, l.position.z };
                let dc = length(to_center);
                // The box's bounding sphere is larger than the box, so
                // dc - radius <= true closest distance: a safe range test.
                if l.direction.w > 0.0 && dc - radius > l.direction.w { keep = false; }
                if keep && l.position.w > 1.5 && dc > radius && dc > 0.000001 {
                    // Spot cone: the box subtends at most asin(radius/dc)
                    // around its centre direction, so the best-case surface
                    // dot product is cos(theta - alpha); keep only when it
                    // still beats the outer cone cosine.
                    let dir = normalize(float3 { l.direction.x, l.direction.y, l.direction.z });
                    let cos_center = dot(dir, to_center / dc);
                    let sin_extent = radius / dc;
                    let cos_extent = sqrt(max(0.0, 1.0 - sin_extent * sin_extent));
                    let sin_center = sqrt(max(0.0, 1.0 - cos_center * cos_center));
                    // When the centre direction lies inside the box's
                    // subtense (theta < alpha) some surface faces the light
                    // dead-on: the best dot is 1, not cos(theta - alpha).
                    let max_dot = if sin_center <= sin_extent && cos_center >= 0.0 { 1.0 }
                                  else { cos_center * cos_extent + sin_center * sin_extent };
                    if max_dot <= l.color.w { keep = false; }
                }
            }
            if keep { mask = mask | (1 << i); }
        }
    } else {
        mask = (1 << count) - 1;
    }
    n.cached_light_mask = mask;
    n.cached_light_mask_world = n.world_version;
    n.cached_light_mask_lights = g_lights_version;
    n.cached_light_mask_mesh = mesh_id;
    n.cached_light_mask_bounds = m2.bounds_version;
    n.light_mask_valid = true;
    return mask;
}

// One node's worth of a frame: its matrices multiplied out, its colour and
// shading parameters, and the key that decides where it sorts.
fn pack_item(n: Node&, mesh_id: i32, dist: f32, light_mask: i32) -> DrawItem {
    if !n.mvp_cache_valid || n.world_dirty || n.cached_mvp_view_version != g_view_proj_version {
        n.cached_mvp = mat4_mul(g_view_proj, n.world);
        n.cached_mvp_view_version = g_view_proj_version;
        n.mvp_cache_valid = true;
        n.world_dirty = false;
    }
    var surface = Material { color: n.color, texture: n.texture, alpha_mode: n.alpha_mode,
        alpha_cutoff: n.alpha_cutoff, unlit: n.unlit, spec: n.spec, shine: n.shine, .. };
    if material_valid(n.material) { surface = g_materials[n.material]; }
    let blended = surface_is_blended(surface.alpha_mode, surface.color.w);
    return DrawItem {
        mesh: mesh_id,
        mvp: n.cached_mvp,
        model: n.world,
        color: surface.color,
        params: float4 { if surface.unlit { 1.0 } else { 0.0 }, surface.spec, surface.shine,
                         if blended { 1.0 } else { 0.0 } },
        key: sort_key(n.mesh, dist, blended),
        texture: surface.texture,
        alpha_mode: if surface.alpha_mode == 1 { 1 } else if blended {
            if surface.alpha_mode >= 2 { surface.alpha_mode } else { 2 }
        } else { 0 },
        alpha_cutoff: surface.alpha_cutoff,
        pbr: float4 { if surface.pbr { 1.0 } else { 0.0 }, surface.metallic, surface.roughness, surface.ior },
        metallic_roughness_texture: surface.metallic_roughness_texture,
        normal_texture: surface.normal_texture,
        normal_scale: surface.normal_scale,
        occlusion_texture: surface.occlusion_texture,
        occlusion_strength: surface.occlusion_strength,
        emissive: float4 { surface.emissive.x, surface.emissive.y, surface.emissive.z, 0.0 },
        emissive_texture: surface.emissive_texture,
        double_sided: surface.double_sided,
        base_color_uv: surface.base_color_uv,
        metallic_roughness_uv: surface.metallic_roughness_uv,
        normal_uv: surface.normal_uv,
        occlusion_uv: surface.occlusion_uv,
        emissive_uv: surface.emissive_uv,
        specular: float4 { surface.specular_color_factor.x, surface.specular_color_factor.y,
                           surface.specular_color_factor.z, surface.specular_factor },
        specular_texture: surface.specular_texture,
        specular_color_texture: surface.specular_color_texture,
        specular_uv: surface.specular_uv,
        specular_color_uv: surface.specular_color_uv,
        clearcoat: float4 { surface.clearcoat_factor, surface.clearcoat_roughness, 0.0, 0.0 },
        clearcoat_texture: surface.clearcoat_texture,
        clearcoat_roughness_texture: surface.clearcoat_roughness_texture,
        clearcoat_normal_texture: surface.clearcoat_normal_texture,
        clearcoat_normal_scale: surface.clearcoat_normal_scale,
        clearcoat_uv: surface.clearcoat_uv,
        clearcoat_roughness_uv: surface.clearcoat_roughness_uv,
        clearcoat_normal_uv: surface.clearcoat_normal_uv,
        sheen: float4 { surface.sheen_color.x, surface.sheen_color.y, surface.sheen_color.z, surface.sheen_roughness },
        sheen_color_texture: surface.sheen_color_texture,
        sheen_roughness_texture: surface.sheen_roughness_texture,
        sheen_color_uv: surface.sheen_color_uv,
        sheen_roughness_uv: surface.sheen_roughness_uv,
        anisotropy: float4 { surface.anisotropy_strength, surface.anisotropy_rotation, 0.0, 0.0 },
        anisotropy_texture: surface.anisotropy_texture,
        anisotropy_uv: surface.anisotropy_uv,
        environment_intensity: surface.environment_intensity,
        shader: surface.shader,
        user0: surface.user0,
        user1: surface.user1,
        user2: surface.user2,
        user3: surface.user3,
        user4: surface.user4,
        user5: surface.user5,
        user6: surface.user6,
        user7: surface.user7,
        lut_texture: surface.lut_texture,
        light_mask: light_mask,
    };
}

// alpha_mode 2 and above (2 blend, 3 additive, 4 premultiplied) is always
// blended; mode 0 blends when the colour's alpha is below opaque. Shared by
// pack_item and the distance-sort path.
fn surface_is_blended(alpha_mode: i32, alpha: f32) -> bool {
    return alpha_mode >= 2 || (alpha_mode == 0 && alpha < 0.999);
}

fn node_is_blended(n: Node&) -> bool {
    if material_valid(n.material) {
        let surface .= material(n.material);
        return surface_is_blended(surface.alpha_mode, surface.color.w);
    }
    return surface_is_blended(n.alpha_mode, n.color.w);
}

fn item_samples_texture(item: DrawItem, texture: i32) -> bool {
    return item.texture == texture || item.metallic_roughness_texture == texture ||
           item.normal_texture == texture || item.occlusion_texture == texture ||
           item.emissive_texture == texture || item.specular_texture == texture ||
           item.specular_color_texture == texture || item.clearcoat_texture == texture ||
           item.clearcoat_roughness_texture == texture || item.clearcoat_normal_texture == texture ||
           item.sheen_color_texture == texture || item.sheen_roughness_texture == texture;
}

fn render_scene() {
    for &n in g_nodes {
        if !n.visible || n.mesh < 0 || n.mesh >= g_meshes.len || !mesh_handle_valid(mesh_handle(n.mesh)) { continue; }
        g_stats.nodes += 1;
        let m .= mesh(n.mesh);
        let cull_enabled = g_view_state.shadow_params.x < 0.5 && g_view_state.point_shadow_params.x < 0.5 && g_view_state.spot_shadow_params.x < 0.5;
        var box = m.bounds;
        var intersects = true;
        var box_ready = false;
        if cull_enabled {
            let cache_matches = n.cull_cache_valid &&
                n.cached_cull_world_version == n.world_version &&
                n.cached_cull_view_version == g_view_proj_version &&
                n.cached_cull_mesh == n.mesh &&
                n.cached_cull_bounds_version == m.bounds_version;
            if cache_matches {
                intersects = n.cached_cull_intersects;
            } else {
                box = aabb_transform_affine(m.bounds, n.world);
                box_ready = true;
                intersects = frustum_intersects(g_frustum, box);
                n.cached_cull_world_version = n.world_version;
                n.cached_cull_view_version = g_view_proj_version;
                n.cached_cull_mesh = n.mesh;
                n.cached_cull_bounds_version = m.bounds_version;
                n.cached_cull_intersects = intersects;
                n.cull_cache_valid = true;
            }
        }
        if cull_enabled && !intersects {
            g_stats.culled += 1;
            continue;
        }
        let blended = node_is_blended(n);
        // View distance feeds the blended sort key, LOD selection and
        // distance culling; compute it once, lazily, off the world box.
        let want_dist = blended || g_max_view_distance > 0.0 ||
            (n.lod_mesh >= 0 && n.lod_mesh < g_meshes.len && n.lod_distance > 0.0);
        var dist: f32 = 0.0;
        if want_dist {
            if !box_ready { box = aabb_transform_affine(m.bounds, n.world); box_ready = true; }
            let center = aabb_center(box);
            dist = if g_camera.orthographic { -mat4_apply(g_view, center).z }
                   else { length(center - g_camera.pos) };
        }
        // Distance culling uses the bounds sphere: centre distance minus
        // radius is a lower bound on the true distance, so it can only
        // reject boxes entirely beyond the limit.
        if g_max_view_distance > 0.0 && !g_camera.orthographic && box_ready &&
           dist - aabb_radius(box) > g_max_view_distance {
            g_stats.distance_culled += 1;
            continue;
        }
        // Two-level LOD: swap in the node's lod_mesh beyond lod_distance.
        // Culling still uses the primary mesh's bounds, which is the
        // conservative choice when the LOD mesh is smaller.
        var mesh_id = n.mesh;
        if n.lod_mesh >= 0 && n.lod_mesh < g_meshes.len && n.lod_distance > 0.0 &&
           dist > n.lod_distance && mesh_handle_valid(mesh_handle(n.lod_mesh)) {
            mesh_id = n.lod_mesh;
            g_stats.lod_swaps += 1;
        }
        g_draws.push(pack_item(n, mesh_id, dist, node_light_mask(n, mesh_id)));
        g_stats.drawn += 1;
        g_stats.triangles += g_meshes[mesh_id].index_count / 3;
    }
    var needs_sort = false;
    for i in 1..g_draws.len {
        if g_draws[i].key < g_draws[i - 1].key { needs_sort = true; break; }
    }
    if needs_sort { sort(g_draws) { a, b => a.key < b.key }; }
    if g_render_target >= 0 {
        for item in g_draws {
            if item_samples_texture(item, g_render_target) { g_stats.feedback_items_suppressed += 1; }
        }
    }
    g3p_draw_frame(g_draws, g_view_state);
    g_stats.draws = g_draws.len;
}

// Is a world-space box inside the camera's view? For an app that wants to
// know before it draws something that costs more than a mesh.
fn visible(box: Aabb) -> bool { return frustum_intersects(g_frustum, box) }
