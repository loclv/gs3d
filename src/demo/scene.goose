// The demo scene: a hall of shapes over a ground plane, with an orbit camera.
//
// It is written against the engine's public API only, and both entry points
// (`app_web.goose` and `app_native.goose`) build the same scene, so what runs
// in the browser is what the headless renderer draws.
//
// The scene exercises what the renderer has: a parented hierarchy turning as
// one (the pivot and its satellites), flat-shaded cubes, smooth spheres, a
// blended sphere drawn in the transparent pass, an unlit marker, and enough
// ground to need the frustum cull.

import vec;
import math;
import g3.math;
import g3.mesh;
import g3.scene;
import g3.render;
import g3.engine;

namespace demo;

var g_pivot: i64 = -1;
var g_glass: i64 = -1;
var g_bob: i64 = -1;

fn build() {
    let ground_mesh = g3::mesh_plane(200.0, 32);
    let cube_mesh = g3::mesh_cube(0.75);
    let ball_mesh = g3::mesh_sphere(0.5, 16, 24);
    let slab_mesh = g3::mesh_cube(1.0);

    // The ground, pulled down and widened by the node's scale.
    let ground .= g3::node(g3::node_add(ground_mesh));
    ground.color = float4 { 0.17, 0.2, 0.26, 1.0 };
    ground.spec = 0.03;

    // A slab under the display, so the shapes have something to sit on.
    let slab .= g3::node(g3::node_add(slab_mesh));
    slab.pos = float3 { 0.0, 0.25, 0.0 };
    slab.scale = float3 { 5.0, 0.25, 5.0 };
    slab.color = float4 { 0.24, 0.28, 0.35, 1.0 };
    slab.spec = 0.12;

    // The pivot everything on the display turns around.
    g_pivot = g3::node_group();
    let pivot .= g3::node(g_pivot);
    pivot.pos = float3 { 0.0, 1.6, 0.0 };

    // A cube out on the pivot's arm, drawn with flat per-face normals.
    let cube_id = g3::node_add(cube_mesh);
    g3::node_parent(cube_id, g_pivot);
    let cube .= g3::node(cube_id);
    cube.pos = float3 { 2.4, 0.0, 0.0 };
    cube.color = float4 { 0.95, 0.55, 0.24, 1.0 };
    cube.spec = 0.3;
    cube.shine = 32.0;

    // Satellites: small smooth spheres at five angles around the pivot.
    for i in 5 {
        let id = g3::node_add(ball_mesh);
        g3::node_parent(id, g_pivot);
        let b .= g3::node(id);
        let a = (i as f32 / 5.0) * TAU;
        b.pos = float3 { cos(a) * 2.4, sin(a * 2.0) * 0.35, sin(a) * 2.4 };
        b.color = float4 { 0.35 + i * 0.12, 0.7, 0.85 - i * 0.1, 1.0 };
        b.spec = 0.45;
        b.shine = 48.0;
        b.scale = float3 { 0.7, 0.7, 0.7 };
    }

    // A blended sphere around the cube: the transparent pass, sorted far to
    // near and drawn without writing depth.
    g_glass = g3::node_add(ball_mesh);
    g3::node_parent(g_glass, g_pivot);
    let glass .= g3::node(g_glass);
    glass.pos = float3 { 2.4, 0.0, 0.0 };
    glass.scale = float3 { 2.9, 2.9, 2.9 };
    glass.color = float4 { 0.35, 0.6, 0.85, 0.22 };
    glass.spec = 0.45;
    glass.shine = 64.0;

    // An unlit marker: the engine's "emissive" case, for gizmos and lights.
    let marker_mesh = g3::mesh_sphere(0.18, 8, 12);
    let marker .= g3::node(g3::node_add(marker_mesh));
    marker.pos = float3 { -3.4, 2.6, -1.2 };
    marker.color = float4 { 1.0, 0.9, 0.45, 1.0 };
    marker.unlit = true;

    // A bob node: a small cube going up and down, to show per-frame animation
    // through the same references the scene was built with.
    g_bob = g3::node_add(cube_mesh);
    let bob .= g3::node(g_bob);
    bob.pos = float3 { -3.2, 1.0, 2.2 };
    bob.scale = float3 { 0.6, 0.6, 0.6 };
    bob.color = float4 { 0.5, 0.85, 0.6, 1.0 };
    bob.spec = 0.3;

    g3::camera_orbit(0.62, 0.24, 9.5, float3 { 0.0, 1.5, 0.0 });
}

// One step of the scene's animation and the camera's controls.
fn update(dt: f64) {
    let d = dt as f32;
    g3::node(g_pivot).rot.y += d * 0.7;

    let bob .= g3::node(g_bob);
    bob.pos.y = 1.0 + sin(g3::time() as f32 * 1.6) * 0.35;
    bob.rot.x += d * 0.9;
    bob.rot.z += d * 0.5;

    // Keyboard: arrows orbit, W and S zoom, Q and E roll the glass.
    var dyaw: f32 = 0.0;
    var dpitch: f32 = 0.0;
    if g3::key_down(g3::KEY_LEFT) { dyaw += 1.6 * d; }
    if g3::key_down(g3::KEY_RIGHT) { dyaw -= 1.6 * d; }
    if g3::key_down(g3::KEY_UP) { dpitch += 1.0 * d; }
    if g3::key_down(g3::KEY_DOWN) { dpitch -= 1.0 * d; }

    // Mouse drag: the shell hands the deltas over, the engine consumes them.
    dyaw -= g3::mouse_dx() * 0.006;
    dpitch += g3::mouse_dy() * 0.005;

    if dyaw != 0.0 || dpitch != 0.0 { g3::camera_orbit_nudge(dyaw, dpitch); }
    if g3::key_down(g3::KEY_W) { g3::camera_zoom(1.0 - 1.4 * d); }
    if g3::key_down(g3::KEY_S) { g3::camera_zoom(1.0 + 1.4 * d); }

    if g3::key_down(g3::KEY_Q) { g3::node(g_glass).rot.y += d * 1.5; }
    if g3::key_down(g3::KEY_E) { g3::node(g_glass).rot.y -= d * 1.5; }
}
