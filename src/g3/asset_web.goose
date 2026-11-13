// Small browser-host bridge: parsing and decoding happen before these calls.
import vec;
import g3.math;
import g3.mesh;
import g3.scene;
import g3.texture;
import g3.platform;
import g3.picking;
import g3.render;

var asset_vertices: g3::Vertex[>..];
var asset_indices: u32[>..];

export fn g3_asset_mesh_begin() {
    asset_vertices.clear();
    asset_indices.clear();
}
export fn g3_asset_vertex(x: f32, y: f32, z: f32, nx: f32, ny: f32, nz: f32, u: f32, v: f32, u1: f32, v1: f32, tx: f32, ty: f32, tz: f32, tw: f32) {
    asset_vertices.push(g3::Vertex { pos: float3 { x, y, z }, normal: float3 { nx, ny, nz }, uv: float2 { u, v }, uv1: float2 { u1, v1 }, tangent: float4 { tx, ty, tz, tw } });
}
export fn g3_asset_triangle(a: u32, b: u32, c: u32) { asset_indices.push(a); asset_indices.push(b); asset_indices.push(c); }
export fn g3_asset_mesh_end() -> i32 { return g3::mesh_asset_create(asset_vertices[..], asset_indices[..]); }
export fn g3_asset_mesh_update(id: i32, positions: const f32[:], normals: const f32[:]) -> bool {
    return g3::mesh_asset_update(id, positions, normals);
}
export fn g3_asset_mesh_update_cpu(id: i32, positions: const f32[:], normals: const f32[:]) -> bool {
    return g3::mesh_asset_update_cpu(id, positions, normals);
}
export fn g3_asset_mesh_generation(id: i32) -> i32 { return g3::mesh_handle(id).generation; }
export fn g3_asset_mesh_valid(id: i32, generation: i32) -> bool { return g3::mesh_handle_valid(g3::MeshHandle { id: id, generation: generation }); }
export fn g3_asset_release_mesh(id: i32, generation: i32) -> bool { return g3::mesh_asset_release_handle(g3::MeshHandle { id: id, generation: generation }); }
export fn g3_asset_node(mesh: i32, parent: i32) -> i32 {
    let id = g3::node_asset_add(mesh);
    let n .= g3::node(id);
    n.parent = parent;
    n.local_matrix = g3::mat4_identity();
    n.use_local_matrix = true;
    return id as i32;
}
export fn g3_asset_matrix(id: i32, index: i32, value: f32) { g3::node(id).local_matrix.m[index] = value; }
export fn g3_asset_material(r: f32, g: f32, b: f32, a: f32, texture: i32, alpha_mode: i32, alpha_cutoff: f32, metallic: f32, roughness: f32, metallic_roughness_texture: i32, normal_texture: i32, normal_scale: f32, occlusion_texture: i32, occlusion_strength: f32, emissive_r: f32, emissive_g: f32, emissive_b: f32, emissive_texture: i32, double_sided: bool, unlit: bool, ior: f32) -> i32 {
    let id = g3::material_asset_add();
    let m .= g3::material(id);
    m.color = float4 { r, g, b, a };
    m.texture = texture;
    m.alpha_mode = alpha_mode;
    m.alpha_cutoff = alpha_cutoff;
    m.pbr = true;
    m.metallic = metallic;
    m.roughness = roughness;
    m.ior = ior;
    m.metallic_roughness_texture = metallic_roughness_texture;
    m.normal_texture = normal_texture;
    m.normal_scale = normal_scale;
    m.occlusion_texture = occlusion_texture;
    m.occlusion_strength = occlusion_strength;
    m.emissive = float3 { emissive_r, emissive_g, emissive_b };
    m.emissive_texture = emissive_texture;
    m.double_sided = double_sided;
    m.unlit = unlit;
    return id;
}
export fn g3_asset_material_specular(id: i32, factor: f32, color_r: f32, color_g: f32, color_b: f32, texture: i32, color_texture: i32) -> bool {
    guard g3::material_valid(id) && factor >= 0.0 && factor <= 1.0 &&
          color_r >= 0.0 && color_r <= 3.4e38 && color_g >= 0.0 && color_g <= 3.4e38 && color_b >= 0.0 && color_b <= 3.4e38
    else { return false; }
    let m .= g3::material(id);
    m.specular_factor = factor;
    m.specular_color_factor = float3 { color_r, color_g, color_b };
    m.specular_texture = texture;
    m.specular_color_texture = color_texture;
    return true;
}
export fn g3_asset_material_uv_transform(id: i32, slot: i32, offset_x: f32, offset_y: f32, scale_x: f32, scale_y: f32, rotation: f32, texcoord: i32) -> bool {
    guard g3::material_valid(id) && (texcoord == 0 || texcoord == 1) else { return false; }
    let transform = g3::UvTransform { offset: float2 { offset_x, offset_y }, scale: float2 { scale_x, scale_y }, rotation: rotation, texcoord: texcoord };
    if slot == 0 { g3::material(id).base_color_uv = transform; }
    else if slot == 1 { g3::material(id).metallic_roughness_uv = transform; }
    else if slot == 2 { g3::material(id).normal_uv = transform; }
    else if slot == 3 { g3::material(id).occlusion_uv = transform; }
    else if slot == 4 { g3::material(id).emissive_uv = transform; }
    else if slot == 5 { g3::material(id).specular_uv = transform; }
    else if slot == 6 { g3::material(id).specular_color_uv = transform; }
    else { return false; }
    return true;
}
export fn g3_asset_node_material(node: i32, material: i32) { g3::node(node).material = material; }
export fn g3_asset_material_generation(id: i32) -> i32 { return g3::material_handle(id).generation; }
export fn g3_asset_material_valid(id: i32, generation: i32) -> bool { return g3::material_handle_valid(g3::MaterialHandle { id: id, generation: generation }); }
export fn g3_asset_release_material(id: i32, generation: i32) -> bool { return g3::material_asset_release(g3::MaterialHandle { id: id, generation: generation }); }
export fn g3_asset_node_generation(id: i32) -> i32 { return g3::node_handle(id).generation; }
export fn g3_asset_node_valid(id: i32, generation: i32, epoch: i32) -> bool {
    return g3::node_handle_valid(g3::NodeHandle { index: id, generation: generation, epoch: epoch });
}
export fn g3_asset_node_release(id: i32, generation: i32, epoch: i32) -> bool {
    return g3::node_asset_release_handle(g3::NodeHandle { index: id, generation: generation, epoch: epoch });
}
export fn g3_asset_scene_epoch() -> i32 { return g3::g_scene_epoch; }
export fn g3_asset_texture() -> i32 { return g3::texture_asset_create(); }
export fn g3_asset_texture_generation(id: i32) -> i32 { return g3::texture_handle(id).generation; }
export fn g3_asset_texture_valid(id: i32, generation: i32) -> bool { return g3::texture_handle_valid(g3::TextureHandle { id: id, generation: generation }); }
export fn g3_asset_release_texture(id: i32, generation: i32) -> bool {
    let handle = g3::TextureHandle { id: id, generation: generation };
    guard g3::texture_handle_valid(handle) else { return false; }
    guard g3::g_texture_slots[id].asset_owned else { return false; }
    if g3::g_view_state.environment_texture == id { g3::set_environment_map(-1, 0.0); }
    return g3::texture_asset_release_handle(handle);
}
export fn g3_asset_pick(x: f32, y: f32, aspect: f32) -> i32 {
    return g3::pick_screen(x, y, aspect).node as i32;
}
export fn g3_asset_output_srgb(enabled: i32) { g3::set_output_srgb(enabled != 0); }
export fn g3_asset_tone_mapping(mode: i32) -> bool { return g3::set_tone_mapping_mode(mode); }
export fn g3_asset_exposure(value: f32) -> bool { return g3::set_exposure(value); }
export fn g3_asset_environment_map(texture: i32, intensity: f32) { g3::set_environment_map(texture, intensity); }
