// A simple repeated-mesh scene for measuring WebGL draw submission.
import vec;
import g3.engine;
import g3.mesh;
import g3.scene;
import g3.render;
import g3.asset_web;

let GRID_SIDE = 32;
let BENCHMARK_MAX_NODES = GRID_SIDE * GRID_SIDE;
var nodes: i64[BENCHMARK_MAX_NODES];

export fn g3_app_init(width: i32, height: i32) -> bool {
    guard g3::init(width, height, "Goose 3D instancing benchmark") else { return false; }
    g3::set_output_srgb(true);
    g3::set_fog(float3_0, 0.0);
    g3::set_ambient(float3_1, 1.0);
    g3::camera_look_at(float3 { 0.0, 0.0, 54.0 }, float3_0);
    let cube = g3::mesh_cube(0.38);
    for i in BENCHMARK_MAX_NODES {
        nodes[i] = g3::node_add(cube);
        let n .= g3::node(nodes[i]);
        let x = (i % GRID_SIDE) - (GRID_SIDE - 1) * 0.5;
        let y = (i / GRID_SIDE) - (GRID_SIDE - 1) * 0.5;
        n.pos = float3 { x, y, 0.0 };
        n.color = float4 { 0.25, 0.62, 0.95, 1.0 };
        n.unlit = true;
    }
    g3_benchmark_set_count(1024);
    return true;
}

export fn g3_app_frame(dt: f32) { g3::frame(dt); }
export fn g3_app_shutdown() { g3::shutdown(); }

export fn g3_benchmark_set_count(requested: i32) {
    let count = max(1, min(requested, BENCHMARK_MAX_NODES));
    for i in BENCHMARK_MAX_NODES { g3::node(nodes[i]).visible = i < count; }
}
