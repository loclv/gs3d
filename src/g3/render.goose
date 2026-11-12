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
var g_shadow_center: float3;
var g_shadow_extent: f32;
var g_shadow_bias: f32;

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
fn clear_lights() { g_view_state.light_count = 0; }

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

// Equirectangular texture sampled in the surface-normal direction. This is a
// diffuse approximation; it does not prefilter or render specular reflections.
fn set_environment_map(texture: i32, intensity: f32) {
    g_view_state.environment_texture = texture;
    g_view_state.environment_intensity = intensity;
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
    g_view_state.shadow_params = float4 { 1.0, bias, 0.0, 0.0 };
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
    g_view_proj = mat4_mul(mat4_perspective(g_camera.fov, w as f32 / h,
                                            g_camera.near, g_camera.far),
                           g_view);
    g_frustum = frustum_from_view_proj(g_view_proj);
    g_view_state.eye = g_camera.pos;
    g_view_state.params = float4 { time as f32, 0.0, 0.0, 0.0 };
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
    let blended = n.alpha_mode == 2 || (n.alpha_mode == 0 && n.color.w < 0.999);
    return DrawItem {
        mesh: n.mesh,
        mvp: mat4_mul(g_view_proj, n.world),
        model: n.world,
        color: n.color,
        params: float4 { if n.unlit { 1.0 } else { 0.0 }, n.spec, n.shine,
                         if blended { 1.0 } else { 0.0 } },
        key: sort_key(n.mesh, dist, blended),
        texture: n.texture,
        alpha_mode: if n.alpha_mode == 1 { 1 } else if blended { 2 } else { 0 },
        alpha_cutoff: n.alpha_cutoff,
    };
}

fn render_scene() {
    for &n in g_nodes {
        if !n.visible || n.mesh < 0 { continue; }
        g_stats.nodes += 1;
        let m .= mesh(n.mesh);
        let box = aabb_transform(m.bounds, n.world);
        if !frustum_intersects(g_frustum, box) && g_view_state.shadow_params.x < 0.5 {
            g_stats.culled += 1;
            continue;
        }
        let dist = length(aabb_center(box) - g_camera.pos);
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
