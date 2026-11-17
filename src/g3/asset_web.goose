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
export fn g3_asset_vertex(x: f32, y: f32, z: f32, nx: f32, ny: f32, nz: f32, u: f32, v: f32, u1: f32, v1: f32, u2: f32, v2: f32, u3: f32, v3: f32, u4: f32, v4: f32, u5: f32, v5: f32, u6: f32, v6: f32, u7: f32, v7: f32, tx: f32, ty: f32, tz: f32, tw: f32, cr: f32, cg: f32, cb: f32, ca: f32) {
    asset_vertices.push(g3::Vertex { pos: float3 { x, y, z }, normal: float3 { nx, ny, nz }, uv: float2 { u, v }, uv1: float2 { u1, v1 }, uv2: float2 { u2, v2 }, uv3: float2 { u3, v3 }, uv4: float2 { u4, v4 }, uv5: float2 { u5, v5 }, uv6: float2 { u6, v6 }, uv7: float2 { u7, v7 }, tangent: float4 { tx, ty, tz, tw }, color: float4 { cr, cg, cb, ca } });
}
export fn g3_asset_triangle(a: u32, b: u32, c: u32) { asset_indices.push(a); asset_indices.push(b); asset_indices.push(c); }
export fn g3_asset_mesh_end() -> i32 { return g3::mesh_asset_create(asset_vertices[..], asset_indices[..]); }
export fn g3_asset_mesh_update(id: i32, positions: const f32[:], normals: const f32[:], tangents: const f32[:]) -> bool {
    return g3::mesh_asset_update(id, positions, normals, tangents);
}
export fn g3_asset_mesh_update_cpu(id: i32, positions: const f32[:], normals: const f32[:], tangents: const f32[:]) -> bool {
    return g3::mesh_asset_update_cpu(id, positions, normals, tangents);
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
export fn g3_asset_material_clearcoat(id: i32, factor: f32, roughness: f32, texture: i32, roughness_texture: i32, normal_texture: i32, normal_scale: f32) -> bool {
    guard g3::material_valid(id) && factor >= 0.0 && factor <= 1.0 && roughness >= 0.0 && roughness <= 1.0
    else { return false; }
    guard normal_scale >= -3.4e38 && normal_scale <= 3.4e38 else { return false; }
    let m .= g3::material(id);
    m.clearcoat_factor = factor;
    m.clearcoat_roughness = roughness;
    m.clearcoat_texture = texture;
    m.clearcoat_roughness_texture = roughness_texture;
    m.clearcoat_normal_texture = normal_texture;
    m.clearcoat_normal_scale = normal_scale;
    return true;
}
export fn g3_asset_material_sheen(id: i32, color_r: f32, color_g: f32, color_b: f32, roughness: f32, color_texture: i32, roughness_texture: i32) -> bool {
    guard g3::material_valid(id) && color_r >= 0.0 && color_r <= 1.0 && color_g >= 0.0 && color_g <= 1.0 &&
          color_b >= 0.0 && color_b <= 1.0 && roughness >= 0.0 && roughness <= 1.0 else { return false; }
    let m .= g3::material(id);
    m.sheen_color = float3 { color_r, color_g, color_b };
    m.sheen_roughness = roughness;
    m.sheen_color_texture = color_texture;
    m.sheen_roughness_texture = roughness_texture;
    return true;
}
export fn g3_asset_material_anisotropy(id: i32, strength: f32, rotation: f32, texture: i32) -> bool {
    guard g3::material_valid(id) && strength >= 0.0 && strength <= 1.0 &&
          rotation >= -3.4e38 && rotation <= 3.4e38 else { return false; }
    let m .= g3::material(id);
    m.anisotropy_strength = strength;
    m.anisotropy_rotation = rotation;
    m.anisotropy_texture = texture;
    return true;
}
export fn g3_asset_material_environment(id: i32, intensity: f32) -> bool {
    return g3::material_set_environment_intensity(id, intensity);
}
export fn g3_asset_material_uv_transform(id: i32, slot: i32, offset_x: f32, offset_y: f32, scale_x: f32, scale_y: f32, rotation: f32, texcoord: i32) -> bool {
    guard g3::material_valid(id) && texcoord >= 0 && texcoord <= 7 else { return false; }
    let transform = g3::UvTransform { offset: float2 { offset_x, offset_y }, scale: float2 { scale_x, scale_y }, rotation: rotation, texcoord: texcoord };
    if slot == 0 { g3::material(id).base_color_uv = transform; }
    else if slot == 1 { g3::material(id).metallic_roughness_uv = transform; }
    else if slot == 2 { g3::material(id).normal_uv = transform; }
    else if slot == 3 { g3::material(id).occlusion_uv = transform; }
    else if slot == 4 { g3::material(id).emissive_uv = transform; }
    else if slot == 5 { g3::material(id).specular_uv = transform; }
    else if slot == 6 { g3::material(id).specular_color_uv = transform; }
    else if slot == 7 { g3::material(id).clearcoat_uv = transform; }
    else if slot == 8 { g3::material(id).clearcoat_roughness_uv = transform; }
    else if slot == 9 { g3::material(id).clearcoat_normal_uv = transform; }
    else if slot == 10 { g3::material(id).sheen_color_uv = transform; }
    else if slot == 11 { g3::material(id).sheen_roughness_uv = transform; }
    else if slot == 12 { g3::material(id).anisotropy_uv = transform; }
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
export fn g3_asset_fxaa(enabled: i32) { g3::set_fxaa(enabled != 0); }
export fn g3_asset_exposure(value: f32) -> bool { return g3::set_exposure(value); }
export fn g3_asset_environment_map(texture: i32, intensity: f32) { g3::set_environment_map(texture, intensity); }
export fn g3_asset_environment_lighting(sky_r: f32, sky_g: f32, sky_b: f32, ground_r: f32, ground_g: f32, ground_b: f32, intensity: f32) -> bool {
    return g3::set_environment(float3 { sky_r, sky_g, sky_b }, float3 { ground_r, ground_g, ground_b }, intensity);
}
export fn g3_asset_environment_rotation(rotation: f32) -> bool { return g3::set_environment_rotation(rotation); }
export fn g3_asset_background(r: f32, g: f32, b: f32, a: f32) { g3::set_background(float4 { r, g, b, a }); }
export fn g3_asset_ambient(r: f32, g: f32, b: f32, intensity: f32) { g3::set_ambient(float3 { r, g, b }, intensity); }
export fn g3_asset_fog(r: f32, g: f32, b: f32, density: f32) { g3::set_fog(float3 { r, g, b }, density); }
export fn g3_asset_camera_add(px: f32, py: f32, pz: f32, tx: f32, ty: f32, tz: f32, ux: f32, uy: f32, uz: f32,
                              fov: f32, aspect: f32, orthographic: bool, ortho_height: f32, near: f32, far: f32) -> i32 {
    let cam = g3::Camera { pos: float3 { px, py, pz }, target: float3 { tx, ty, tz }, up: float3 { ux, uy, uz },
        fov: fov, aspect: aspect, orthographic: orthographic, ortho_height: ortho_height, near: near, far: far };
    return g3::camera_add_detached(cam) as i32;
}
export fn g3_asset_camera_active() -> i32 { return g3::camera_active() as i32; }
export fn g3_asset_camera_add_current() -> i32 { return g3::camera_add() as i32; }
export fn g3_asset_camera_update(id: i32, px: f32, py: f32, pz: f32, tx: f32, ty: f32, tz: f32, ux: f32, uy: f32, uz: f32,
                                 fov: f32, aspect: f32, orthographic: bool, ortho_height: f32, near: f32, far: f32) -> bool {
    let cam = g3::Camera { pos: float3 { px, py, pz }, target: float3 { tx, ty, tz }, up: float3 { ux, uy, uz },
        fov: fov, aspect: aspect, orthographic: orthographic, ortho_height: ortho_height, near: near, far: far };
    return g3::camera_update(id, cam);
}
export fn g3_asset_camera_select(id: i32) -> bool { return g3::camera_select(id); }
export fn g3_asset_camera_remove(id: i32) -> bool { return g3::camera_remove(id); }
export fn g3_asset_lights_begin() -> i32 { return g3::asset_light_set_begin(); }
export fn g3_asset_lights_active() -> i32 { return g3::asset_light_set_active(); }
export fn g3_asset_lights_clear() { g3::asset_light_set_clear(); }
export fn g3_asset_lights_release(id: i32) -> bool { return g3::asset_light_set_release(id); }
export fn g3_asset_light_directional(dx: f32, dy: f32, dz: f32, r: f32, g: f32, b: f32) -> bool {
    return g3::add_directional_light(float3 { dx, dy, dz }, float3 { r, g, b });
}
export fn g3_asset_light_point(px: f32, py: f32, pz: f32, r: f32, g: f32, b: f32, range: f32) -> bool {
    return g3::add_point_light_physical(float3 { px, py, pz }, float3 { r, g, b }, range);
}
export fn g3_asset_light_spot(px: f32, py: f32, pz: f32, dx: f32, dy: f32, dz: f32,
                              r: f32, g: f32, b: f32, range: f32, inner: f32, outer: f32) -> bool {
    return g3::add_spot_light_physical(float3 { px, py, pz }, float3 { dx, dy, dz }, float3 { r, g, b }, range, inner, outer);
}
export fn g3_asset_light_point_shadow(index: i32, bias: f32) -> bool { return g3::set_point_light_shadows(index, bias); }
export fn g3_asset_light_spot_shadow(index: i32, bias: f32) -> bool { return g3::set_spot_light_shadows(index, bias); }
// The primary directional light, independent of the eight-light asset set: the
// facade routes the shadow-casting directional light here so it owns the one
// shadow map. dir is the direction the light travels; colour is linear.
export fn g3_asset_light_key(dx: f32, dy: f32, dz: f32, r: f32, g: f32, b: f32) {
    g3::set_light(float3 { dx, dy, dz }, float3 { r, g, b });
}
// The key light's shadow box: world-space centre, half extent, depth bias.
export fn g3_asset_light_key_shadow(cx: f32, cy: f32, cz: f32, extent: f32, bias: f32) -> bool {
    return g3::set_directional_shadows(float3 { cx, cy, cz }, extent, bias);
}
export fn g3_asset_light_key_shadow_clear() { g3::clear_shadows(); }
// Shadow maps are square: 256, 512 or 1024.
export fn g3_asset_shadow_resolution(resolution: i32) -> bool { return g3::set_shadow_resolution(resolution); }
// PCF radius in texels: 0 hard, 1 is 3x3, 2 is 5x5.
export fn g3_asset_shadow_filter_radius(radius: i32) -> bool { return g3::set_shadow_filter_radius(radius); }
// Custom material fragment shaders: `header` GLSL is inserted before main()
// (helpers, extra uniforms/samplers); `body` statements run inside main()
// where the material's lighting inputs are still writable; `tail` statements
// run after tone mapping and sRGB encoding, just before output, and may
// modify `col` and `alpha`. `uniform sampler3D u_lut` and
// `uniform float u_lut_enabled` are available when the material has a 3D
// texture bound through g3_asset_material_lut. Assign to
// `g3_emissive_extra` in `body` to add emission. WebGL-only; returns -1
// elsewhere.
export fn g3_asset_material_shader_create(header: const u8[:], body: const u8[:], tail: const u8[:]) -> i32 {
    return g3::material_shader_create(header, body, tail);
}
export fn g3_asset_material_shader_release(id: i32) -> bool { return g3::material_shader_remove(id); }
export fn g3_asset_material_set_shader(id: i32, shader: i32) -> bool {
    guard g3::material_valid(id) && (shader < 0 || g3::material_shader_valid(shader)) else { return false; }
    g3::material(id).shader = shader;
    return true;
}
export fn g3_asset_material_lut(id: i32, texture: i32) -> bool {
    guard g3::material_valid(id) && (texture < 0 || g3::texture_slot_live(texture)) else { return false; }
    g3::material(id).lut_texture = texture;
    return true;
}
// RGBA8 3D texture (width*height*depth*4 bytes), sampled as u_lut by custom
// material shaders. WebGL-only; the CPU backend accepts and ignores it.
export fn g3_asset_texture_3d(width: i32, height: i32, depth: i32, pixels: const u8[:]) -> i32 {
    return g3::texture_asset_create_3d(width, height, depth, pixels);
}
export fn g3_asset_material_user(id: i32, index: i32, x: f32, y: f32, z: f32, w: f32) -> bool {
    guard g3::material_valid(id) && index >= 0 && index < 4 else { return false; }
    let m .= g3::material(id);
    if index == 0 { m.user0 = float4 { x, y, z, w }; }
    else if index == 1 { m.user1 = float4 { x, y, z, w }; }
    else if index == 2 { m.user2 = float4 { x, y, z, w }; }
    else { m.user3 = float4 { x, y, z, w }; }
    return true;
}
