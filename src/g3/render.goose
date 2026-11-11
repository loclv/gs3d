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

// --- the frame's constants

fn set_light(dir: float3, color: float3) {
    g_view_state.light_dir = normalize(dir);
    g_view_state.light_color = color;
}

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
    let blended = n.color.w < 0.999;
    return DrawItem {
        mesh: n.mesh,
        mvp: mat4_mul(g_view_proj, n.world),
        model: n.world,
        color: n.color,
        params: float4 { if n.unlit { 1.0 } else { 0.0 }, n.spec, n.shine,
                         if blended { 1.0 } else { 0.0 } },
        key: sort_key(n.mesh, dist, blended),
    };
}

fn render_scene() {
    for &n in g_nodes {
        if !n.visible || n.mesh < 0 { continue; }
        g_stats.nodes += 1;
        let m .= mesh(n.mesh);
        let box = aabb_transform(m.bounds, n.world);
        if !frustum_intersects(g_frustum, box) {
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
