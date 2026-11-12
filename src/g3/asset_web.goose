// Small browser-host bridge: parsing and decoding happen before these calls.
import vec;
import g3.math;
import g3.mesh;
import g3.scene;
import g3.texture;

var asset_first_vertex: i64;
var asset_first_index: i64;

export fn g3_asset_mesh_begin() {
    asset_first_vertex = g3::g_verts.len;
    asset_first_index = g3::g_indices.len;
}
export fn g3_asset_vertex(x: f32, y: f32, z: f32, nx: f32, ny: f32, nz: f32, u: f32, v: f32) {
    g3::push_vertex_uv(float3 { x, y, z }, float3 { nx, ny, nz }, float2 { u, v });
}
export fn g3_asset_triangle(a: u32, b: u32, c: u32) { g3::push_triangle(a, b, c); }
export fn g3_asset_mesh_end() -> i32 { return g3::mesh_close(asset_first_vertex, asset_first_index); }
export fn g3_asset_node(mesh: i32, parent: i32) -> i32 {
    let id = g3::node_add(mesh);
    let n .= g3::node(id);
    n.parent = parent;
    n.local_matrix = g3::mat4_identity();
    n.use_local_matrix = true;
    return id as i32;
}
export fn g3_asset_matrix(id: i32, index: i32, value: f32) { g3::node(id).local_matrix.m[index] = value; }
export fn g3_asset_material(id: i32, r: f32, g: f32, b: f32, a: f32, texture: i32) {
    let n .= g3::node(id);
    n.color = float4 { r, g, b, a };
    n.texture = texture;
}
export fn g3_asset_hide(id: i32) { g3::node(id).visible = false; }
export fn g3_asset_texture() -> i32 {
    let pixel: u8[4] = [255, 255, 255, 255];
    return g3::texture_create(1, 1, pixel[..]);
}
