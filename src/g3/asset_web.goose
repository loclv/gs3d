// Small browser-host bridge: parsing and decoding happen before these calls.
import vec;
import g3.math;
import g3.mesh;
import g3.scene;
import g3.texture;
import g3.platform;
import g3.picking;

var asset_vertices: g3::Vertex[>..];
var asset_indices: u32[>..];

export fn g3_asset_mesh_begin() {
    asset_vertices.clear();
    asset_indices.clear();
}
export fn g3_asset_vertex(x: f32, y: f32, z: f32, nx: f32, ny: f32, nz: f32, u: f32, v: f32) {
    asset_vertices.push(g3::Vertex { pos: float3 { x, y, z }, normal: float3 { nx, ny, nz }, uv: float2 { u, v } });
}
export fn g3_asset_triangle(a: u32, b: u32, c: u32) { asset_indices.push(a); asset_indices.push(b); asset_indices.push(c); }
export fn g3_asset_mesh_end() -> i32 { return g3::mesh_asset_create(asset_vertices[..], asset_indices[..]); }
export fn g3_asset_release_mesh(id: i32) { g3::mesh_asset_release(id); }
export fn g3_asset_node(mesh: i32, parent: i32) -> i32 {
    let id = g3::node_asset_add(mesh);
    let n .= g3::node(id);
    n.parent = parent;
    n.local_matrix = g3::mat4_identity();
    n.use_local_matrix = true;
    return id as i32;
}
export fn g3_asset_matrix(id: i32, index: i32, value: f32) { g3::node(id).local_matrix.m[index] = value; }
export fn g3_asset_material(id: i32, r: f32, g: f32, b: f32, a: f32, texture: i32, alpha_mode: i32, alpha_cutoff: f32) {
    let n .= g3::node(id);
    n.color = float4 { r, g, b, a };
    n.texture = texture;
    n.alpha_mode = alpha_mode;
    n.alpha_cutoff = alpha_cutoff;
}
export fn g3_asset_hide(id: i32) { g3::node_asset_release(id); }
export fn g3_asset_scene_epoch() -> i32 { return g3::g_scene_epoch; }
export fn g3_asset_texture() -> i32 { return g3::texture_asset_create(); }
export fn g3_asset_release_texture(id: i32) { g3::texture_asset_release(id); }
export fn g3_asset_pick(x: f32, y: f32, aspect: f32) -> i32 {
    return g3::pick_screen(x, y, aspect).node as i32;
}
