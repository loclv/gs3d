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
    triangles: i64,
    draws: i64,         // one per item: no instancing yet
}

var g_draws: DrawItem[>..];
var g_view_state: ViewState;
var g_stats: Stats;
var g_view: Mat4;
var g_view_proj: Mat4;
var g_frustum: Frustum;
var g_output_srgb: bool;
var g_tone_mapping: bool;
var g_exposure: f32 = 1.0;
var g_shadow_center: float3;
var g_shadow_extent: f32;
var g_shadow_bias: f32;
var g_shadow_filter_radius: i32;

// --- the frame's constants

fn set_light(dir: float3, color: float3) {
    g_view_state.light_dir = normalize(dir);
    g_view_state.light_color = color;
    if g_view_state.shadow_params.x > 0.5 {
        let updated = set_directional_shadows(g_shadow_center, g_shadow_extent, g_shadow_bias);
        if !updated { clear_shadows(); }
    }
}

// The original directional light is independent of these four extra lights.
fn clear_lights() { g_view_state.light_count = 0; clear_point_light_shadows(); clear_spot_light_shadows(); }

fn add_directional_light(dir: float3, color: float3) -> bool {
    guard length(dir) > 0.0 && g_view_state.light_count < 4 else { return false; }
    let d = normalize(dir);
    let i = g_view_state.light_count;
    g_view_state.lights[i] = Light { position: float4 { 0.0, 0.0, 0.0, 0.0 },
        direction: float4 { d.x, d.y, d.z, 0.0 }, color: float4 { color.x, color.y, color.z, 0.0 }, inner: 0.0 };
    g_view_state.light_count += 1;
    return true;
}

// Point and spot attenuation is (1 - distance / range)^2 inside the range.
fn add_point_light(pos: float3, color: float3, range: f32) -> bool {
    guard range > 0.0 && g_view_state.light_count < 4 else { return false; }
    let i = g_view_state.light_count;
    g_view_state.lights[i] = Light { position: float4 { pos.x, pos.y, pos.z, 1.0 },
        direction: float4 { 0.0, 0.0, 0.0, range }, color: float4 { color.x, color.y, color.z, 0.0 }, inner: 0.0 };
    g_view_state.light_count += 1;
    return true;
}

// One extra point light can cast a six-face hard shadow. The index is its
// position in the extra-light list; changing lights requires calling again.
fn set_point_light_shadows(light_index: i32, bias: f32) -> bool {
    guard light_index >= 0 && light_index < g_view_state.light_count && bias >= 0.0 else { return false; }
    let light = g_view_state.lights[light_index];
    guard light.position.w > 0.5 && light.position.w < 1.5 && light.direction.w > 0.01 else { return false; }
    let eye = float3 { light.position.x, light.position.y, light.position.z };
    let projection = mat4_perspective(PI * 0.5, 1.0, 0.01, light.direction.w);
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
    guard light.position.w > 1.5 && light.direction.w > 0.01 && light.color.w > 0.0 else { return false; }
    let eye = float3 { light.position.x, light.position.y, light.position.z };
    let dir = float3 { light.direction.x, light.direction.y, light.direction.z };
    let up = if abs(dir.y) > 0.95 { float3 { 1.0, 0.0, 0.0 } } else { float3 { 0.0, 1.0, 0.0 } };
    let projection = mat4_perspective(2.0 * acos(light.color.w), 1.0, 0.01, light.direction.w);
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
fn add_spot_light(pos: float3, dir: float3, color: float3, range: f32, inner: f32, outer: f32) -> bool {
    guard range > 0.0 && length(dir) > 0.0 && inner >= 0.0 && inner < outer && outer <= PI && cos(inner) > cos(outer) && g_view_state.light_count < 4 else { return false; }
    let d = normalize(dir);
    let i = g_view_state.light_count;
    g_view_state.lights[i] = Light { position: float4 { pos.x, pos.y, pos.z, 2.0 },
        direction: float4 { d.x, d.y, d.z, range }, color: float4 { color.x, color.y, color.z, cos(outer) }, inner: cos(inner) };
    g_view_state.light_count += 1;
    return true;
}

// Diffuse hemispherical environment: sky above, ground below; zero disables it.
fn set_environment(sky: float3, ground: float3, intensity: f32) {
    g_view_state.env_sky = float4 { sky.x, sky.y, sky.z, intensity };
    g_view_state.env_ground = float4 { ground.x, ground.y, ground.z, 0.0 };
}

// Equirectangular environment: diffuse lookup stays on the surface normal;
// metallic-roughness materials sample GGX-prefiltered mips along the reflection
// direction. Longitude wraps and latitude clamps. Specular IBL uses a
// split-sum BRDF integration LUT.
fn set_environment_map(texture: i32, intensity: f32) {
    g_view_state.environment_texture = texture;
    g_view_state.environment_intensity = intensity;
    if texture >= 0 && texture < g_texture_count { g3p_texture_generate_env_mips(texture); }
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

// Apply the ACES fitted curve to HDR output. WebGL uses inline mapping when
// floating-point color blending is unavailable.
fn set_tone_mapping(enabled: bool) { g_tone_mapping = enabled; }

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
    let w = if width < 1 { 1 } else { width };
    let h = if height < 1 { 1 } else { height };
    g_view = mat4_look_at(g_camera.pos, g_camera.target, g_camera.up);
    g_view_proj = mat4_mul(camera_projection(g_camera, w as f32 / h), g_view);
    g_frustum = frustum_from_view_proj(g_view_proj);
    g_view_state.eye = g_camera.pos;
    // The third row of look-at points from the scene toward the camera.
    g_view_state.view_direction = float4 { g_view.m[2], g_view.m[6], g_view.m[10], if g_camera.orthographic { 1.0 } else { 0.0 } };
    g_view_state.params = float4 { time as f32, if g_output_srgb { 1.0 } else { 0.0 }, if g_tone_mapping { 1.0 } else { 0.0 }, g_exposure };
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

// One node's worth of a frame: its matrices multiplied out, its colour and
// shading parameters, and the key that decides where it sorts.
fn pack_item(n: Node&, m: Mesh&, dist: f32) -> DrawItem {
    var surface = Material { color: n.color, texture: n.texture, alpha_mode: n.alpha_mode,
        alpha_cutoff: n.alpha_cutoff, unlit: n.unlit, spec: n.spec, shine: n.shine, .. };
    if material_valid(n.material) { surface = g_materials[n.material]; }
    let blended = surface.alpha_mode == 2 || (surface.alpha_mode == 0 && surface.color.w < 0.999);
    return DrawItem {
        mesh: n.mesh,
        mvp: mat4_mul(g_view_proj, n.world),
        model: n.world,
        color: surface.color,
        params: float4 { if surface.unlit { 1.0 } else { 0.0 }, surface.spec, surface.shine,
                         if blended { 1.0 } else { 0.0 } },
        key: sort_key(n.mesh, dist, blended),
        texture: surface.texture,
        alpha_mode: if surface.alpha_mode == 1 { 1 } else if blended { 2 } else { 0 },
        alpha_cutoff: surface.alpha_cutoff,
        pbr: float4 { if surface.pbr { 1.0 } else { 0.0 }, surface.metallic, surface.roughness, 0.0 },
        metallic_roughness_texture: surface.metallic_roughness_texture,
        normal_texture: surface.normal_texture,
        normal_scale: surface.normal_scale,
        occlusion_texture: surface.occlusion_texture,
        occlusion_strength: surface.occlusion_strength,
        emissive: float4 { surface.emissive.x, surface.emissive.y, surface.emissive.z, 0.0 },
        emissive_texture: surface.emissive_texture,
    };
}

fn render_scene() {
    for &n in g_nodes {
        if !n.visible || n.mesh < 0 { continue; }
        g_stats.nodes += 1;
        let m .= mesh(n.mesh);
        let box = aabb_transform(m.bounds, n.world);
        if !frustum_intersects(g_frustum, box) && g_view_state.shadow_params.x < 0.5 && g_view_state.point_shadow_params.x < 0.5 && g_view_state.spot_shadow_params.x < 0.5 {
            g_stats.culled += 1;
            continue;
        }
        let center = aabb_center(box);
        let dist = if g_camera.orthographic { -mat4_apply(g_view, center).z } else { length(center - g_camera.pos) };
        g_draws.push(pack_item(n, m, dist));
        g_stats.drawn += 1;
        g_stats.triangles += m.index_count / 3;
    }
    sort(g_draws) { a, b => a.key < b.key };
    g3p_draw_frame(g_draws, g_view_state);
    g_stats.draws = g_draws.len;
}

// Is a world-space box inside the camera's view? For an app that wants to
// know before it draws something that costs more than a mesh.
fn visible(box: Aabb) -> bool { return frustum_intersects(g_frustum, box) }
