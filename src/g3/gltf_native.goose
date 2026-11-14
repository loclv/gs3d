// Native static GLB loading for selected primitives, node instances, and mesh
// batches; browser applications should use the broader loader in web/assets.js.
import std;
import os;
import vec;
import math;
import json;
import g3.math;
import g3.mesh;
import g3.scene;
import g3.render;
import g3.platform;
import g3.texture_native;

namespace g3;

struct GlbTextureSet {
    base_color: TextureHandle, metallic_roughness: TextureHandle, normal: TextureHandle, occlusion: TextureHandle, emissive: TextureHandle,
    specular: TextureHandle, specular_color: TextureHandle, clearcoat: TextureHandle, clearcoat_roughness: TextureHandle,
    clearcoat_normal: TextureHandle, sheen_color: TextureHandle, sheen_roughness: TextureHandle, anisotropy: TextureHandle
}
struct NativeGlbModel { mesh: MeshHandle, node: NodeHandle, material: MaterialHandle, texture: TextureHandle, textures: GlbTextureSet, morph_vertex_start: i32, morph_vertex_count: i32, morph_delta_start: i32, morph_target_count: i32, morph_weight_start: i32, skin_influence_start: i32, skin_joint_start: i32, skin_joint_count: i32, skin_node_index: i32 }
struct NativeGlbMeshHandle { id: i32 = -1, generation: i32 }
struct NativeGlbMeshSlot { generation: i32 = 1, primitive_count: i32, root: NodeHandle = NodeHandle { .. }, active: bool }
struct NativeGlbPartSlot { owner_id: i32, owner_generation: i32, primitive_index: i32, model: NativeGlbModel, active: bool }
struct NativeGlbSceneHandle { id: i32 = -1, generation: i32 }
struct NativeGlbSceneSlot { generation: i32 = 1, mesh_count: i32, node_count: i32, camera_count: i32, animation_count: i32, root: NodeHandle = NodeHandle { .. }, light_set_id: i32 = -1, previous_camera_id: i64 = -1, previous_camera: Camera, active: bool }
struct NativeGlbScenePartSlot { scene_id: i32, scene_generation: i32, gltf_node_index: i32, mesh_index: i32, mesh: NativeGlbMeshHandle, active: bool }
struct NativeGlbSceneNodeSlot { scene_id: i32, scene_generation: i32, gltf_index: i32, node: NodeHandle, translation: float3, rotation: float4 = float4 { 0.0, 0.0, 0.0, 1.0 }, scale: float3 = float3_1, base_translation: float3, base_rotation: float4 = float4 { 0.0, 0.0, 0.0, 1.0 }, base_scale: float3 = float3_1, has_trs: bool = true, animated: bool, active: bool }
struct NativeGlbSceneCameraSlot { scene_id: i32, scene_generation: i32, camera_index: i32, camera_id: i64, active: bool }
struct NativeGlbSceneLight { kind: i32, position: float3, direction: float3, color: float3, range: f32, inner: f32, outer: f32 }
struct NativeGlbAnimationTrack { scene_id: i32, scene_generation: i32, animation_index: i32, gltf_node_index: i32, node_slot_index: i32, path: i32, interpolation: i32, key_start: i32, key_count: i32, duration: f32, weight_start: i32, weight_value_count: i32, weight_target_count: i32, active: bool }
struct NativeGlbAnimationKey { time: f32, incoming: float4, value: float4, outgoing: float4, active: bool }
struct NativeGlbBaseVertex { vertex: Vertex, active: bool }
struct NativeGlbMorphDelta { position: float3, normal: float3, tangent: float3, active: bool }
struct NativeGlbMorphWeight { base: f32, value: f32, active: bool }
struct NativeGlbAnimationWeightValue { value: f32, active: bool }
struct NativeGlbSkinInfluence { joint_index: i32, weight: f32, active: bool }
struct NativeGlbSkinJoint { gltf_node_index: i32, inverse_bind: Mat4, active: bool }
struct GlbSparseAccessor { count: i64, indices_offset: i64, indices_type: i64, values_offset: i64 }
struct GlbAccessor { offset: i64, stride: i64, count: i64, components: i64, has_base: bool, sparse: GlbSparseAccessor }
struct GlbAttribute { offset: i64, stride: i64, count: i64, components: i64, component_type: i64, normalized: bool, has_base: bool, sparse: GlbSparseAccessor }

var g_native_glb_meshes: NativeGlbMeshSlot[>..];
var g_native_glb_parts: NativeGlbPartSlot[>..];
var g_native_glb_scenes: NativeGlbSceneSlot[>..];
var g_native_glb_scene_parts: NativeGlbScenePartSlot[>..];
var g_native_glb_scene_nodes: NativeGlbSceneNodeSlot[>..];
var g_native_glb_scene_cameras: NativeGlbSceneCameraSlot[>..];
var g_native_glb_animation_tracks: NativeGlbAnimationTrack[>..];
var g_native_glb_animation_keys: NativeGlbAnimationKey[>..];
var g_native_glb_base_vertices: NativeGlbBaseVertex[>..];
var g_native_glb_morph_deltas: NativeGlbMorphDelta[>..];
var g_native_glb_morph_weights: NativeGlbMorphWeight[>..];
var g_native_glb_animation_weight_values: NativeGlbAnimationWeightValue[>..];
var g_native_glb_skin_influences: NativeGlbSkinInfluence[>..];
var g_native_glb_skin_joints: NativeGlbSkinJoint[>..];

fn glb_u32(bytes: const u8[:], at: i64) -> i64 {
    let b0: i64 = bytes[at]; let b1: i64 = bytes[at + 1];
    let b2: i64 = bytes[at + 2]; let b3: i64 = bytes[at + 3];
    return b0 | b1 << 8 | b2 << 16 | b3 << 24;
}

fn glb_json_element(node: json::Node?, index: i64) -> json::Node? {
    guard node && index >= 0 else { return null; }
    var child = node.first;
    var i = 0;
    while child && i < index { child .= child.next; i++; }
    return child;
}

// Convert IEEE-754 binary32 to a Goose f32 using its sign, exponent and
// significand. Exponent 255 is rejected, so NaN/Inf never reaches transforms.
fn glb_f32(bytes: const u8[:], at: i64) -> f32, bool {
    let bits = glb_u32(bytes, at);
    let sign: f64 = if (bits & 0x80000000) != 0 { -1.0 } else { 1.0 };
    let exponent = (bits >> 23) & 0xFF;
    let fraction = bits & 0x7FFFFF;
    guard exponent != 255 else { return 0.0, false; }
    if exponent == 0 {
        let value = sign * fraction * pow(2.0, -149.0);
        return value as f32, true;
    }
    let value = sign * (1.0 + fraction / 8388608.0) * pow(2.0, exponent - 127.0);
    return value as f32, true;
}

fn glb_json_index(node: json::Node?) -> i64, bool { return json::as_i64(node); }

fn glb_base64_value(c: u8) -> i64, bool {
    if c >= 65 && c <= 90 { return c - 65, true; }
    if c >= 97 && c <= 122 { return c - 97 + 26, true; }
    if c >= 48 && c <= 57 { return c - 48 + 52, true; }
    if c == 43 { return 62, true; }
    if c == 47 { return 63, true; }
    return 0, false;
}

// Decode a base64 data URI into a caller-owned byte array. Only the standard
// alphabet and canonical final padding are accepted.
fn glb_decode_data_uri(uri: const u8[:], output: u8[>..]&) -> bool {
    guard uri.len >= 16 && uri[0] == 100 && uri[1] == 97 && uri[2] == 116 && uri[3] == 97 && uri[4] == 58 else { return false; }
    var comma: i64 = -1;
    for i in 5..uri.len { if uri[i] == 44 { comma = i; break; } }
    guard comma > 12 && uri[comma - 7] == 59 && uri[comma - 6] == 98 && uri[comma - 5] == 97 &&
          uri[comma - 4] == 115 && uri[comma - 3] == 101 && uri[comma - 2] == 54 && uri[comma - 1] == 52 else { return false; }
    let encoded_length = uri.len - comma - 1;
    guard encoded_length > 0 && encoded_length % 4 == 0 else { return false; }
    for i in 0..encoded_length / 4 {
        let at = comma + 1 + i * 4;
        let a, a_ok = glb_base64_value(uri[at]); let b, b_ok = glb_base64_value(uri[at + 1]);
        guard a_ok && b_ok else { return false; }
        let last = i == encoded_length / 4 - 1;
        let c_pad = uri[at + 2] == 61;
        let d_pad = uri[at + 3] == 61;
        if c_pad {
            guard last && d_pad && (b & 15) == 0 else { return false; }
            output.push(((a << 2) | (b >> 4)) as u8);
        } else {
            let c, c_ok = glb_base64_value(uri[at + 2]);
            guard c_ok else { return false; }
            output.push(((a << 2) | (b >> 4)) as u8);
            if d_pad {
                guard last && (c & 3) == 0 else { return false; }
                output.push(((b << 4) | (c >> 2)) as u8);
            } else {
                let d, d_ok = glb_base64_value(uri[at + 3]);
                guard d_ok else { return false; }
                output.push(((b << 4) | (c >> 2)) as u8);
                output.push(((c << 6) | d) as u8);
            }
        }
    }
    return true;
}

fn glb_optional_index(node: json::Node?, fallback: i64) -> i64, bool {
    if !node { return fallback, true; }
    return glb_json_index(node);
}

fn glb_number(node: json::Node?, fallback: f64) -> f64, bool {
    if !node { return fallback, true; }
    return json::as_f64(node);
}

fn glb_factor3(node: json::Node?, fallback: float3, min_value: f64, max_value: f64) -> float3, bool {
    if !node { return fallback, true; }
    guard glb_array_count(node) == 3 else { return float3_0, false; }
    let x, x_ok = json::as_f64(glb_json_element(node, 0));
    let y, y_ok = json::as_f64(glb_json_element(node, 1));
    let z, z_ok = json::as_f64(glb_json_element(node, 2));
    guard x_ok && y_ok && z_ok && x >= min_value && x <= max_value && y >= min_value && y <= max_value && z >= min_value && z <= max_value else { return float3_0, false; }
    return float3 { x as f32, y as f32, z as f32 }, true;
}

fn glb_factor2(node: json::Node?, fallback: float2, min_value: f64, max_value: f64) -> float2, bool {
    if !node { return fallback, true; }
    guard glb_array_count(node) == 2 else { return float2_0, false; }
    let x, x_ok = json::as_f64(glb_json_element(node, 0));
    let y, y_ok = json::as_f64(glb_json_element(node, 1));
    guard x_ok && y_ok && x >= min_value && x <= max_value && y >= min_value && y <= max_value else { return float2_0, false; }
    return float2 { x as f32, y as f32 }, true;
}

fn glb_array_has_string(node: json::Node?, value: const u8[:]) -> bool {
    for i in 0..glb_array_count(node) {
        let candidate, ok = json::as_string(glb_json_element(node, i));
        if ok && candidate == value { return true; }
    }
    return false;
}

fn glb_material_extension(root: json::Node?, source: json::Node?, name: const u8[:]) -> json::Node?, bool {
    let extension = json::member(json::member(source, "extensions"), name);
    if extension {
        guard glb_array_has_string(json::member(root, "extensionsUsed"), name) else { return null, false; }
    }
    return extension, true;
}

fn glb_release_texture_set(textures: GlbTextureSet&) {
    if texture_handle_valid(textures.base_color) { texture_asset_release_handle(textures.base_color); }
    if texture_handle_valid(textures.metallic_roughness) { texture_asset_release_handle(textures.metallic_roughness); }
    if texture_handle_valid(textures.normal) { texture_asset_release_handle(textures.normal); }
    if texture_handle_valid(textures.occlusion) { texture_asset_release_handle(textures.occlusion); }
    if texture_handle_valid(textures.emissive) { texture_asset_release_handle(textures.emissive); }
    if texture_handle_valid(textures.specular) { texture_asset_release_handle(textures.specular); }
    if texture_handle_valid(textures.specular_color) { texture_asset_release_handle(textures.specular_color); }
    if texture_handle_valid(textures.clearcoat) { texture_asset_release_handle(textures.clearcoat); }
    if texture_handle_valid(textures.clearcoat_roughness) { texture_asset_release_handle(textures.clearcoat_roughness); }
    if texture_handle_valid(textures.clearcoat_normal) { texture_asset_release_handle(textures.clearcoat_normal); }
    if texture_handle_valid(textures.sheen_color) { texture_asset_release_handle(textures.sheen_color); }
    if texture_handle_valid(textures.sheen_roughness) { texture_asset_release_handle(textures.sheen_roughness); }
    if texture_handle_valid(textures.anisotropy) { texture_asset_release_handle(textures.anisotropy); }
}

fn glb_native_texture(root: json::Node?, texture_info: json::Node?, path: const u8[:], bytes: const u8[:], buffer_bases: const i64[:], buffer_sizes: const i64[:], srgb: bool) -> TextureHandle, bool {
    let texture_index, texture_index_ok = glb_json_index(json::member(texture_info, "index"));
    let texture = glb_json_element(json::member(root, "textures"), texture_index);
    let image_index, image_index_ok = glb_json_index(json::member(texture, "source"));
    let image = glb_json_element(json::member(root, "images"), image_index);
    guard texture_info && texture_index_ok && texture && image_index_ok && image else { return TextureHandle { .. }, false; }

    var image_handle = TextureHandle { .. };
    let uri_node = json::member(image, "uri");
    guard !uri_node || !json::member(image, "bufferView") else { return TextureHandle { .. }, false; }
    if uri_node {
        let uri, uri_ok = json::as_string(uri_node);
        guard uri_ok && uri.len > 0 else { return TextureHandle { .. }, false; }
        var encoded: u8[>..] = [];
        if uri.len >= 5 && uri[0] == 100 && uri[1] == 97 && uri[2] == 116 && uri[3] == 97 && uri[4] == 58 {
            guard uri.len <= 268435456 && glb_decode_data_uri(uri, encoded) && encoded.len <= 268435456 else { return TextureHandle { .. }, false; }
        } else {
            guard uri.len < 4096 else { return TextureHandle { .. }, false; }
            var segment_start: i64 = 0;
            for i in 0..uri.len {
                let c = uri[i];
                guard c != 0 && c != 92 && c != 58 && c != 63 && c != 35 && c != 37 else { return TextureHandle { .. }, false; }
                if c == 47 {
                    guard i > segment_start && !(i - segment_start == 1 && uri[segment_start] == 46) && !(i - segment_start == 2 && uri[segment_start] == 46 && uri[segment_start + 1] == 46) else { return TextureHandle { .. }, false; }
                    segment_start = i + 1;
                }
            }
            guard segment_start < uri.len && !(uri.len - segment_start == 1 && uri[segment_start] == 46) && !(uri.len - segment_start == 2 && uri[segment_start] == 46 && uri[segment_start + 1] == 46) && uri[0] != 47 else { return TextureHandle { .. }, false; }
            var external_path: u8[>..] = [];
            var directory_end: i64 = 0;
            for i in 0..path.len { if path[i] == 47 { directory_end = i + 1; } }
            guard directory_end + uri.len < 4096 else { return TextureHandle { .. }, false; }
            for i in 0..directory_end { external_path.push(path[i]); }
            for i in 0..uri.len { external_path.push(uri[i]); }
            guard read_file(external_path[..], encoded) && encoded.len > 0 && encoded.len <= 268435456 else { return TextureHandle { .. }, false; }
        }
        image_handle = if srgb { native_texture_load_asset_encoded(encoded[..]) } else { native_texture_load_asset_encoded_linear(encoded[..]) };
    } else {
        let view_index, view_ok = glb_json_index(json::member(image, "bufferView"));
        let view = glb_json_element(json::member(root, "bufferViews"), view_index);
        let buffer_index, buffer_ok = glb_optional_index(json::member(view, "buffer"), 0);
        let offset, offset_ok = glb_optional_index(json::member(view, "byteOffset"), 0);
        let length, length_ok = glb_json_index(json::member(view, "byteLength"));
        let mime, mime_ok = json::as_string(json::member(image, "mimeType"));
        guard view_ok && view && buffer_ok && offset_ok && length_ok && mime_ok &&
              (mime == "image/png" || mime == "image/jpeg") && buffer_index >= 0 && buffer_index < buffer_bases.len &&
              offset >= 0 && length > 0 && offset <= buffer_sizes[buffer_index] && length <= buffer_sizes[buffer_index] - offset else {
            return TextureHandle { .. }, false;
        }
        let start = buffer_bases[buffer_index] + offset;
        image_handle = if srgb { native_texture_load_asset_encoded(bytes[start..start + length]) } else { native_texture_load_asset_encoded_linear(bytes[start..start + length]) };
    }
    guard texture_handle_valid(image_handle) else { return TextureHandle { .. }, false; }

    let sampler_index, sampler_index_ok = glb_optional_index(json::member(texture, "sampler"), -1);
    guard sampler_index_ok else { texture_asset_release_handle(image_handle); return TextureHandle { .. }, false; }
    let sampler = glb_json_element(json::member(root, "samplers"), sampler_index);
    let sampler_ok = sampler_index < 0 || sampler;
    let wrap_u, wrap_u_ok = glb_optional_index(json::member(sampler, "wrapS"), 10497);
    let wrap_v, wrap_v_ok = glb_optional_index(json::member(sampler, "wrapT"), 10497);
    let min_filter, min_ok = glb_optional_index(json::member(sampler, "minFilter"), 9729);
    let mag_filter, mag_ok = glb_optional_index(json::member(sampler, "magFilter"), 9729);
    guard sampler_ok && wrap_u_ok && wrap_v_ok && min_ok && mag_ok else { texture_asset_release_handle(image_handle); return TextureHandle { .. }, false; }
    let engine_wrap_u = if wrap_u == 33071 { WRAP_CLAMP } else if wrap_u == 33648 { WRAP_MIRROR } else if wrap_u == 10497 { WRAP_REPEAT } else { -1 };
    let engine_wrap_v = if wrap_v == 33071 { WRAP_CLAMP } else if wrap_v == 33648 { WRAP_MIRROR } else if wrap_v == 10497 { WRAP_REPEAT } else { -1 };
    guard engine_wrap_u >= 0 && engine_wrap_v >= 0 && texture_set_wrap(image_handle.id, engine_wrap_u as i32, engine_wrap_v as i32) &&
          texture_set_filter(image_handle.id, min_filter as i32, mag_filter as i32) else {
        texture_asset_release_handle(image_handle);
        return TextureHandle { .. }, false;
    }
    return image_handle, true;
}

fn glb_texture_uv(root: json::Node?, texture_info: json::Node?) -> UvTransform, bool {
    let texcoord, texcoord_ok = glb_optional_index(json::member(texture_info, "texCoord"), 0);
    guard texture_info && texcoord_ok && texcoord == 0 else { return UvTransform { .. }, false; }
    var uv = UvTransform { scale: float2_1, texcoord: 0, .. };
    let transform = json::member(json::member(texture_info, "extensions"), "KHR_texture_transform");
    if transform {
        guard glb_array_has_string(json::member(root, "extensionsUsed"), "KHR_texture_transform") else { return UvTransform { .. }, false; }
        let transform_texcoord, transform_texcoord_ok = glb_optional_index(json::member(transform, "texCoord"), texcoord);
        let offset, offset_ok = glb_factor2(json::member(transform, "offset"), float2_0, -3.4e38, 3.4e38);
        let scale, scale_ok = glb_factor2(json::member(transform, "scale"), float2_1, -3.4e38, 3.4e38);
        let rotation, rotation_ok = glb_number(json::member(transform, "rotation"), 0.0);
        guard transform_texcoord_ok && transform_texcoord == 0 && offset_ok && scale_ok && rotation_ok &&
              rotation >= -3.4e38 && rotation <= 3.4e38 else { return UvTransform { .. }, false; }
        uv = UvTransform { offset: offset, scale: scale, rotation: rotation as f32, texcoord: 0 };
    }
    return uv, true;
}

// Factor-only helper retained for focused importer checks and callers that
// construct a material document without texture tables.
fn glb_material(root: json::Node?, primitive: json::Node?) -> MaterialHandle, bool {
    var bytes: u8[>..] = [];
    var bases: i64[>..] = [];
    var sizes: i64[>..] = [];
    var textures = GlbTextureSet { .. };
    let material, texture, ok = glb_material(root, primitive, "", bytes[..], bases[..], sizes[..], textures);
    glb_release_texture_set(textures);
    return material, ok;
}

fn glb_material(root: json::Node?, primitive: json::Node?, path: const u8[:], bytes: const u8[:], buffer_bases: const i64[:], buffer_sizes: const i64[:], textures: GlbTextureSet&) -> MaterialHandle, TextureHandle, bool {
    let material_node = json::member(primitive, "material");
    if !material_node { return MaterialHandle { .. }, TextureHandle { .. }, true; }
    let material_index, index_ok = glb_json_index(material_node);
    let materials = json::member(root, "materials");
    let source = glb_json_element(materials, material_index);
    guard index_ok && source else { return MaterialHandle { .. }, TextureHandle { .. }, false; }

    var color = float4_1;
    var metallic: f64 = 1.0; var roughness: f64 = 1.0;
    let pbr = json::member(source, "pbrMetallicRoughness");
    let color_node = json::member(pbr, "baseColorFactor");
    if color_node {
        guard glb_array_count(color_node) == 4 else { return MaterialHandle { .. }, TextureHandle { .. }, false; }
        let r, a = json::as_f64(glb_json_element(color_node, 0)); let g, b = json::as_f64(glb_json_element(color_node, 1));
        let blue, c = json::as_f64(glb_json_element(color_node, 2)); let alpha, d = json::as_f64(glb_json_element(color_node, 3));
        guard a && b && c && d && r >= 0.0 && r <= 1.0 && g >= 0.0 && g <= 1.0 && blue >= 0.0 && blue <= 1.0 && alpha >= 0.0 && alpha <= 1.0 else { return MaterialHandle { .. }, TextureHandle { .. }, false; }
        color = float4 { r as f32, g as f32, blue as f32, alpha as f32 };
    }
    let metallic_value, metallic_ok = glb_number(json::member(pbr, "metallicFactor"), 1.0);
    let roughness_value, roughness_ok = glb_number(json::member(pbr, "roughnessFactor"), 1.0);
    guard metallic_ok && roughness_ok && metallic_value >= 0.0 && metallic_value <= 1.0 && roughness_value >= 0.0 && roughness_value <= 1.0 else { return MaterialHandle { .. }, TextureHandle { .. }, false; }
    let emissive_node = json::member(source, "emissiveFactor");
    var emissive = float3_0;
    if emissive_node {
        guard glb_array_count(emissive_node) == 3 else { return MaterialHandle { .. }, TextureHandle { .. }, false; }
        let r, a = json::as_f64(glb_json_element(emissive_node, 0)); let g, b = json::as_f64(glb_json_element(emissive_node, 1)); let blue, c = json::as_f64(glb_json_element(emissive_node, 2));
        guard a && b && c && r >= 0.0 && r <= 3.4e38 && g >= 0.0 && g <= 3.4e38 && blue >= 0.0 && blue <= 3.4e38 else { return MaterialHandle { .. }, TextureHandle { .. }, false; }
        emissive = float3 { r as f32, g as f32, blue as f32 };
    }
    let emissive_extension, emissive_extension_ok = glb_material_extension(root, source, "KHR_materials_emissive_strength");
    guard emissive_extension_ok else { return MaterialHandle { .. }, TextureHandle { .. }, false; }
    let emissive_strength, emissive_strength_ok = glb_number(json::member(emissive_extension, "emissiveStrength"), 1.0);
    guard emissive_strength_ok && emissive_strength >= 0.0 && emissive_strength <= 3.4e38 else { return MaterialHandle { .. }, TextureHandle { .. }, false; }
    emissive = emissive * (emissive_strength as f32);
    let ior_extension, ior_extension_ok = glb_material_extension(root, source, "KHR_materials_ior");
    guard ior_extension_ok else { return MaterialHandle { .. }, TextureHandle { .. }, false; }
    let ior, ior_ok = glb_number(json::member(ior_extension, "ior"), 1.5);
    guard ior_ok && ior >= 1.0 && ior <= 2.333 else { return MaterialHandle { .. }, TextureHandle { .. }, false; }
    let specular_extension, specular_extension_ok = glb_material_extension(root, source, "KHR_materials_specular");
    guard specular_extension_ok else { return MaterialHandle { .. }, TextureHandle { .. }, false; }
    let specular_factor, specular_factor_ok = glb_number(json::member(specular_extension, "specularFactor"), 1.0);
    let specular_color, specular_color_ok = glb_factor3(json::member(specular_extension, "specularColorFactor"), float3_1, 0.0, 3.4e38);
    guard specular_factor_ok && specular_factor >= 0.0 && specular_factor <= 1.0 && specular_color_ok else { return MaterialHandle { .. }, TextureHandle { .. }, false; }
    let clearcoat_extension, clearcoat_extension_ok = glb_material_extension(root, source, "KHR_materials_clearcoat");
    guard clearcoat_extension_ok else { return MaterialHandle { .. }, TextureHandle { .. }, false; }
    let clearcoat_factor, clearcoat_factor_ok = glb_number(json::member(clearcoat_extension, "clearcoatFactor"), 0.0);
    let clearcoat_roughness, clearcoat_roughness_ok = glb_number(json::member(clearcoat_extension, "clearcoatRoughnessFactor"), 0.0);
    guard clearcoat_factor_ok && clearcoat_roughness_ok && clearcoat_factor >= 0.0 && clearcoat_factor <= 1.0 && clearcoat_roughness >= 0.0 && clearcoat_roughness <= 1.0 else { return MaterialHandle { .. }, TextureHandle { .. }, false; }
    let sheen_extension, sheen_extension_ok = glb_material_extension(root, source, "KHR_materials_sheen");
    guard sheen_extension_ok else { return MaterialHandle { .. }, TextureHandle { .. }, false; }
    let sheen_color, sheen_color_ok = glb_factor3(json::member(sheen_extension, "sheenColorFactor"), float3_0, 0.0, 1.0);
    let sheen_roughness, sheen_roughness_ok = glb_number(json::member(sheen_extension, "sheenRoughnessFactor"), 0.0);
    guard sheen_color_ok && sheen_roughness_ok && sheen_roughness >= 0.0 && sheen_roughness <= 1.0 else { return MaterialHandle { .. }, TextureHandle { .. }, false; }
    let anisotropy_extension, anisotropy_extension_ok = glb_material_extension(root, source, "KHR_materials_anisotropy");
    guard anisotropy_extension_ok else { return MaterialHandle { .. }, TextureHandle { .. }, false; }
    let anisotropy_strength, anisotropy_strength_ok = glb_number(json::member(anisotropy_extension, "anisotropyStrength"), 0.0);
    let anisotropy_rotation, anisotropy_rotation_ok = glb_number(json::member(anisotropy_extension, "anisotropyRotation"), 0.0);
    guard anisotropy_strength_ok && anisotropy_rotation_ok && anisotropy_strength >= 0.0 && anisotropy_strength <= 1.0 && anisotropy_rotation >= -3.4e38 && anisotropy_rotation <= 3.4e38 else { return MaterialHandle { .. }, TextureHandle { .. }, false; }
    var alpha_mode: i32 = 0;
    let mode_node = json::member(source, "alphaMode");
    if mode_node {
        let mode, mode_ok = json::as_string(mode_node);
        guard mode_ok else { return MaterialHandle { .. }, TextureHandle { .. }, false; }
        if mode == "MASK" { alpha_mode = 1; }
        else if mode == "BLEND" { alpha_mode = 2; }
        else { guard mode == "OPAQUE" else { return MaterialHandle { .. }, TextureHandle { .. }, false; } }
    }
    let cutoff, cutoff_ok = glb_number(json::member(source, "alphaCutoff"), 0.5);
    guard cutoff_ok && cutoff >= 0.0 && cutoff <= 3.4e38 else { return MaterialHandle { .. }, TextureHandle { .. }, false; }
    let sided_node = json::member(source, "doubleSided");
    var double_sided = false;
    if sided_node { let value, valid = json::as_bool(sided_node); guard valid else { return MaterialHandle { .. }, TextureHandle { .. }, false; } double_sided = value; }
    let unlit_node = json::member(json::member(source, "extensions"), "KHR_materials_unlit");
    var unlit = false;
    if unlit_node {
        guard glb_array_has_string(json::member(root, "extensionsUsed"), "KHR_materials_unlit") else { return MaterialHandle { .. }, TextureHandle { .. }, false; }
        guard !specular_extension && !clearcoat_extension && !sheen_extension && !anisotropy_extension else { return MaterialHandle { .. }, TextureHandle { .. }, false; }
        unlit = true;
    }

    var imported_texture = TextureHandle { .. };
    var imported_textures = GlbTextureSet { .. };
    var base_color_uv = UvTransform { scale: float2_1, texcoord: 0, .. };
    var metallic_roughness_uv = UvTransform { scale: float2_1, texcoord: 0, .. };
    var normal_uv = UvTransform { scale: float2_1, texcoord: 0, .. };
    var occlusion_uv = UvTransform { scale: float2_1, texcoord: 0, .. };
    var emissive_uv = UvTransform { scale: float2_1, texcoord: 0, .. };
    var specular_uv = UvTransform { scale: float2_1, texcoord: 0, .. };
    var specular_color_uv = UvTransform { scale: float2_1, texcoord: 0, .. };
    var clearcoat_uv = UvTransform { scale: float2_1, texcoord: 0, .. };
    var clearcoat_roughness_uv = UvTransform { scale: float2_1, texcoord: 0, .. };
    var clearcoat_normal_uv = UvTransform { scale: float2_1, texcoord: 0, .. };
    var sheen_color_uv = UvTransform { scale: float2_1, texcoord: 0, .. };
    var sheen_roughness_uv = UvTransform { scale: float2_1, texcoord: 0, .. };
    var anisotropy_uv = UvTransform { scale: float2_1, texcoord: 0, .. };
    let base_color_info = json::member(pbr, "baseColorTexture");
    if base_color_info {
        let uv, uv_ok = glb_texture_uv(root, base_color_info);
        guard uv_ok else { return MaterialHandle { .. }, TextureHandle { .. }, false; }
        base_color_uv = uv;
        let texture, texture_ok = glb_native_texture(root, base_color_info, path, bytes, buffer_bases, buffer_sizes, true);
        guard texture_ok else { return MaterialHandle { .. }, TextureHandle { .. }, false; }
        imported_texture = texture;
        imported_textures.base_color = texture;
    }
    let metallic_roughness_info = json::member(pbr, "metallicRoughnessTexture");
    if metallic_roughness_info {
        let uv, uv_ok = glb_texture_uv(root, metallic_roughness_info);
        guard uv_ok else { glb_release_texture_set(imported_textures); return MaterialHandle { .. }, TextureHandle { .. }, false; }
        metallic_roughness_uv = uv;
        let texture, texture_ok = glb_native_texture(root, metallic_roughness_info, path, bytes, buffer_bases, buffer_sizes, false);
        guard texture_ok else { glb_release_texture_set(imported_textures); return MaterialHandle { .. }, TextureHandle { .. }, false; }
        imported_textures.metallic_roughness = texture;
    }
    let normal_info = json::member(source, "normalTexture");
    let normal_scale, normal_scale_ok = glb_number(json::member(normal_info, "scale"), 1.0);
    guard normal_scale_ok && normal_scale >= 0.0 && normal_scale <= 3.4e38 else { glb_release_texture_set(imported_textures); return MaterialHandle { .. }, TextureHandle { .. }, false; }
    if normal_info {
        let uv, uv_ok = glb_texture_uv(root, normal_info);
        guard uv_ok else { glb_release_texture_set(imported_textures); return MaterialHandle { .. }, TextureHandle { .. }, false; }
        normal_uv = uv;
        let texture, texture_ok = glb_native_texture(root, normal_info, path, bytes, buffer_bases, buffer_sizes, false);
        guard texture_ok else { glb_release_texture_set(imported_textures); return MaterialHandle { .. }, TextureHandle { .. }, false; }
        imported_textures.normal = texture;
    }
    let occlusion_info = json::member(source, "occlusionTexture");
    let occlusion_strength, occlusion_strength_ok = glb_number(json::member(occlusion_info, "strength"), 1.0);
    guard occlusion_strength_ok && occlusion_strength >= 0.0 && occlusion_strength <= 1.0 else { glb_release_texture_set(imported_textures); return MaterialHandle { .. }, TextureHandle { .. }, false; }
    if occlusion_info {
        let uv, uv_ok = glb_texture_uv(root, occlusion_info);
        guard uv_ok else { glb_release_texture_set(imported_textures); return MaterialHandle { .. }, TextureHandle { .. }, false; }
        occlusion_uv = uv;
        let texture, texture_ok = glb_native_texture(root, occlusion_info, path, bytes, buffer_bases, buffer_sizes, false);
        guard texture_ok else { glb_release_texture_set(imported_textures); return MaterialHandle { .. }, TextureHandle { .. }, false; }
        imported_textures.occlusion = texture;
    }
    let emissive_info = json::member(source, "emissiveTexture");
    if emissive_info {
        let uv, uv_ok = glb_texture_uv(root, emissive_info);
        guard uv_ok else { glb_release_texture_set(imported_textures); return MaterialHandle { .. }, TextureHandle { .. }, false; }
        emissive_uv = uv;
        let texture, texture_ok = glb_native_texture(root, emissive_info, path, bytes, buffer_bases, buffer_sizes, true);
        guard texture_ok else { glb_release_texture_set(imported_textures); return MaterialHandle { .. }, TextureHandle { .. }, false; }
        imported_textures.emissive = texture;
    }
    let specular_info = json::member(specular_extension, "specularTexture");
    if specular_info {
        let uv, uv_ok = glb_texture_uv(root, specular_info);
        guard uv_ok else { glb_release_texture_set(imported_textures); return MaterialHandle { .. }, TextureHandle { .. }, false; }
        specular_uv = uv;
        let texture, texture_ok = glb_native_texture(root, specular_info, path, bytes, buffer_bases, buffer_sizes, false);
        guard texture_ok else { glb_release_texture_set(imported_textures); return MaterialHandle { .. }, TextureHandle { .. }, false; }
        imported_textures.specular = texture;
    }
    let specular_color_info = json::member(specular_extension, "specularColorTexture");
    if specular_color_info {
        let uv, uv_ok = glb_texture_uv(root, specular_color_info);
        guard uv_ok else { glb_release_texture_set(imported_textures); return MaterialHandle { .. }, TextureHandle { .. }, false; }
        specular_color_uv = uv;
        let texture, texture_ok = glb_native_texture(root, specular_color_info, path, bytes, buffer_bases, buffer_sizes, true);
        guard texture_ok else { glb_release_texture_set(imported_textures); return MaterialHandle { .. }, TextureHandle { .. }, false; }
        imported_textures.specular_color = texture;
    }
    let clearcoat_info = json::member(clearcoat_extension, "clearcoatTexture");
    if clearcoat_info {
        let uv, uv_ok = glb_texture_uv(root, clearcoat_info);
        guard uv_ok else { glb_release_texture_set(imported_textures); return MaterialHandle { .. }, TextureHandle { .. }, false; }
        clearcoat_uv = uv;
        let texture, texture_ok = glb_native_texture(root, clearcoat_info, path, bytes, buffer_bases, buffer_sizes, false);
        guard texture_ok else { glb_release_texture_set(imported_textures); return MaterialHandle { .. }, TextureHandle { .. }, false; }
        imported_textures.clearcoat = texture;
    }
    let clearcoat_roughness_info = json::member(clearcoat_extension, "clearcoatRoughnessTexture");
    if clearcoat_roughness_info {
        let uv, uv_ok = glb_texture_uv(root, clearcoat_roughness_info);
        guard uv_ok else { glb_release_texture_set(imported_textures); return MaterialHandle { .. }, TextureHandle { .. }, false; }
        clearcoat_roughness_uv = uv;
        let texture, texture_ok = glb_native_texture(root, clearcoat_roughness_info, path, bytes, buffer_bases, buffer_sizes, false);
        guard texture_ok else { glb_release_texture_set(imported_textures); return MaterialHandle { .. }, TextureHandle { .. }, false; }
        imported_textures.clearcoat_roughness = texture;
    }
    let clearcoat_normal_info = json::member(clearcoat_extension, "clearcoatNormalTexture");
    let clearcoat_normal_scale, clearcoat_normal_scale_ok = glb_number(json::member(clearcoat_normal_info, "scale"), 1.0);
    guard clearcoat_normal_scale_ok && clearcoat_normal_scale >= 0.0 && clearcoat_normal_scale <= 3.4e38 else { glb_release_texture_set(imported_textures); return MaterialHandle { .. }, TextureHandle { .. }, false; }
    if clearcoat_normal_info {
        let uv, uv_ok = glb_texture_uv(root, clearcoat_normal_info);
        guard uv_ok else { glb_release_texture_set(imported_textures); return MaterialHandle { .. }, TextureHandle { .. }, false; }
        clearcoat_normal_uv = uv;
        let texture, texture_ok = glb_native_texture(root, clearcoat_normal_info, path, bytes, buffer_bases, buffer_sizes, false);
        guard texture_ok else { glb_release_texture_set(imported_textures); return MaterialHandle { .. }, TextureHandle { .. }, false; }
        imported_textures.clearcoat_normal = texture;
    }
    let sheen_color_info = json::member(sheen_extension, "sheenColorTexture");
    if sheen_color_info {
        let uv, uv_ok = glb_texture_uv(root, sheen_color_info);
        guard uv_ok else { glb_release_texture_set(imported_textures); return MaterialHandle { .. }, TextureHandle { .. }, false; }
        sheen_color_uv = uv;
        let texture, texture_ok = glb_native_texture(root, sheen_color_info, path, bytes, buffer_bases, buffer_sizes, true);
        guard texture_ok else { glb_release_texture_set(imported_textures); return MaterialHandle { .. }, TextureHandle { .. }, false; }
        imported_textures.sheen_color = texture;
    }
    let sheen_roughness_info = json::member(sheen_extension, "sheenRoughnessTexture");
    if sheen_roughness_info {
        let uv, uv_ok = glb_texture_uv(root, sheen_roughness_info);
        guard uv_ok else { glb_release_texture_set(imported_textures); return MaterialHandle { .. }, TextureHandle { .. }, false; }
        sheen_roughness_uv = uv;
        let texture, texture_ok = glb_native_texture(root, sheen_roughness_info, path, bytes, buffer_bases, buffer_sizes, false);
        guard texture_ok else { glb_release_texture_set(imported_textures); return MaterialHandle { .. }, TextureHandle { .. }, false; }
        imported_textures.sheen_roughness = texture;
    }
    let anisotropy_info = json::member(anisotropy_extension, "anisotropyTexture");
    if anisotropy_info {
        let uv, uv_ok = glb_texture_uv(root, anisotropy_info);
        guard uv_ok else { glb_release_texture_set(imported_textures); return MaterialHandle { .. }, TextureHandle { .. }, false; }
        anisotropy_uv = uv;
        let texture, texture_ok = glb_native_texture(root, anisotropy_info, path, bytes, buffer_bases, buffer_sizes, false);
        guard texture_ok else { glb_release_texture_set(imported_textures); return MaterialHandle { .. }, TextureHandle { .. }, false; }
        imported_textures.anisotropy = texture;
    }

    let id = material_asset_add();
    let m .= material(id);
    m.color = if alpha_mode == 0 { float4 { color.x, color.y, color.z, 1.0 } } else { color };
    m.alpha_mode = alpha_mode; m.alpha_cutoff = cutoff as f32; m.pbr = true;
    m.metallic = metallic_value as f32; m.roughness = roughness_value as f32; m.ior = ior as f32;
    m.emissive = emissive; m.double_sided = double_sided; m.unlit = unlit;
    m.specular_factor = specular_factor as f32; m.specular_color_factor = specular_color;
    m.clearcoat_factor = clearcoat_factor as f32; m.clearcoat_roughness = clearcoat_roughness as f32;
    m.sheen_color = sheen_color; m.sheen_roughness = sheen_roughness as f32;
    m.anisotropy_strength = anisotropy_strength as f32; m.anisotropy_rotation = anisotropy_rotation as f32;
    m.texture = imported_texture.id;
    m.metallic_roughness_texture = imported_textures.metallic_roughness.id;
    m.normal_texture = imported_textures.normal.id; m.normal_scale = normal_scale as f32;
    m.occlusion_texture = imported_textures.occlusion.id; m.occlusion_strength = occlusion_strength as f32;
    m.emissive_texture = imported_textures.emissive.id;
    m.specular_texture = imported_textures.specular.id; m.specular_color_texture = imported_textures.specular_color.id;
    m.clearcoat_texture = imported_textures.clearcoat.id; m.clearcoat_roughness_texture = imported_textures.clearcoat_roughness.id;
    m.clearcoat_normal_texture = imported_textures.clearcoat_normal.id; m.clearcoat_normal_scale = clearcoat_normal_scale as f32;
    m.sheen_color_texture = imported_textures.sheen_color.id; m.sheen_roughness_texture = imported_textures.sheen_roughness.id;
    m.anisotropy_texture = imported_textures.anisotropy.id;
    m.base_color_uv = base_color_uv;
    m.metallic_roughness_uv = metallic_roughness_uv; m.normal_uv = normal_uv;
    m.occlusion_uv = occlusion_uv; m.emissive_uv = emissive_uv;
    m.specular_uv = specular_uv; m.specular_color_uv = specular_color_uv;
    m.clearcoat_uv = clearcoat_uv; m.clearcoat_roughness_uv = clearcoat_roughness_uv; m.clearcoat_normal_uv = clearcoat_normal_uv;
    m.sheen_color_uv = sheen_color_uv; m.sheen_roughness_uv = sheen_roughness_uv; m.anisotropy_uv = anisotropy_uv;
    textures = imported_textures;
    return material_handle(id), imported_texture, true;
}

fn glb_array_count(node: json::Node?) -> i64 {
    guard node else { return 0; }
    match node.val { Arr a => { return a.count; }, _ => { return 0; } }
}

fn glb_sparse_index(bytes: const u8[:], sparse: GlbSparseAccessor, sparse_index: i64) -> i64 {
    let at = sparse.indices_offset + sparse_index * (if sparse.indices_type == 5121 { 1 } else if sparse.indices_type == 5123 { 2 } else { 4 });
    if sparse.indices_type == 5121 { return bytes[at]; }
    if sparse.indices_type == 5123 { return bytes[at] | bytes[at + 1] << 8; }
    return glb_u32(bytes, at);
}

fn glb_sparse_accessor(doc: json::Node?, bytes: const u8[:], buffer_bases: const i64[:], buffer_sizes: const i64[:], accessor: json::Node?, accessor_count: i64, component_bytes: i64, packed_size: i64) -> GlbSparseAccessor, bool {
    let sparse_node = json::member(accessor, "sparse");
    if !sparse_node { return GlbSparseAccessor { .. }, true; }
    let sparse_count, count_ok = glb_json_index(json::member(sparse_node, "count"));
    let indices = json::member(sparse_node, "indices");
    let index_view, index_view_ok = glb_json_index(json::member(indices, "bufferView"));
    let index_type, index_type_ok = glb_json_index(json::member(indices, "componentType"));
    let index_view_node = glb_json_element(json::member(doc, "bufferViews"), index_view);
    let index_buffer, index_buffer_ok = glb_optional_index(json::member(index_view_node, "buffer"), 0);
    let index_view_offset, index_offset_ok = glb_optional_index(json::member(index_view_node, "byteOffset"), 0);
    let index_view_length, index_length_ok = glb_json_index(json::member(index_view_node, "byteLength"));
    let index_byte_offset, index_byte_offset_ok = glb_optional_index(json::member(indices, "byteOffset"), 0);
    let index_bytes: i64 = if index_type == 5121 { 1 } else if index_type == 5123 { 2 } else if index_type == 5125 { 4 } else { 0 };
    guard count_ok && sparse_count > 0 && sparse_count <= accessor_count && indices && index_view_ok && index_type_ok && index_bytes > 0 &&
          index_view_node && index_buffer_ok && index_buffer >= 0 && index_buffer < buffer_bases.len && index_buffer < buffer_sizes.len &&
          index_offset_ok && index_view_offset >= 0 && index_length_ok && index_view_length > 0 && index_byte_offset_ok && index_byte_offset >= 0 &&
          !json::member(index_view_node, "byteStride") && (index_view_offset + index_byte_offset) % index_bytes == 0 &&
          index_byte_offset <= index_view_length && sparse_count <= (index_view_length - index_byte_offset) / index_bytes &&
          index_view_offset + index_view_length <= buffer_sizes[index_buffer]
    else { return GlbSparseAccessor { .. }, false; }

    let values = json::member(sparse_node, "values");
    let value_view, value_view_ok = glb_json_index(json::member(values, "bufferView"));
    let value_view_node = glb_json_element(json::member(doc, "bufferViews"), value_view);
    let value_buffer, value_buffer_ok = glb_optional_index(json::member(value_view_node, "buffer"), 0);
    let value_view_offset, value_offset_ok = glb_optional_index(json::member(value_view_node, "byteOffset"), 0);
    let value_view_length, value_length_ok = glb_json_index(json::member(value_view_node, "byteLength"));
    let value_byte_offset, value_byte_offset_ok = glb_optional_index(json::member(values, "byteOffset"), 0);
    guard values && value_view_ok && value_view_node && value_buffer_ok && value_buffer >= 0 && value_buffer < buffer_bases.len && value_buffer < buffer_sizes.len &&
          value_offset_ok && value_view_offset >= 0 && value_length_ok && value_view_length > 0 && value_byte_offset_ok && value_byte_offset >= 0 &&
          !json::member(value_view_node, "byteStride") && (value_view_offset + value_byte_offset) % component_bytes == 0 &&
          value_byte_offset <= value_view_length && sparse_count <= (value_view_length - value_byte_offset) / packed_size &&
          value_view_offset + value_view_length <= buffer_sizes[value_buffer]
    else { return GlbSparseAccessor { .. }, false; }

    let sparse = GlbSparseAccessor { count: sparse_count,
                                     indices_offset: buffer_bases[index_buffer] + index_view_offset + index_byte_offset,
                                     indices_type: index_type,
                                     values_offset: buffer_bases[value_buffer] + value_view_offset + value_byte_offset };
    var previous: i64 = -1;
    for i in 0..sparse_count {
        let sparse_vertex = glb_sparse_index(bytes, sparse, i);
        guard sparse_vertex > previous && sparse_vertex < accessor_count else { return GlbSparseAccessor { .. }, false; }
        previous = sparse_vertex;
    }
    return sparse, true;
}

fn glb_attribute_accessor(doc: json::Node?, bytes: const u8[:], buffer_bases: const i64[:], buffer_sizes: const i64[:], index: i64, semantic: const u8[:], type_name: const u8[:], components: i64) -> GlbAttribute, bool {
    let accessor = glb_json_element(json::member(doc, "accessors"), index);
    let views = json::member(doc, "bufferViews");
    guard accessor && views else { return GlbAttribute { .. }, false; }
    let count, count_ok = glb_json_index(json::member(accessor, "count"));
    let component_type, component_ok = glb_json_index(json::member(accessor, "componentType"));
    let actual_type, type_ok = json::as_string(json::member(accessor, "type"));
    let normalized_node = json::member(accessor, "normalized");
    var normalized = false;
    if normalized_node { let value, valid = json::as_bool(normalized_node); guard valid else { return GlbAttribute { .. }, false; } normalized = value; }
    let component_bytes: i64 = if component_type == 5126 || component_type == 5122 || component_type == 5123 { if component_type == 5126 { 4 } else { 2 } } else if component_type == 5120 || component_type == 5121 { 1 } else { 0 };
    let integer_component = component_type == 5120 || component_type == 5121 || component_type == 5122 || component_type == 5123;
    let is_position = semantic == "POSITION";
    let is_normal = semantic == "NORMAL";
    let is_tangent = semantic == "TANGENT";
    let is_texcoord = semantic == "TEXCOORD_0";
    let is_animation = semantic == "ANIMATION";
    let is_joints = semantic == "JOINTS_0";
    let is_weights = semantic == "WEIGHTS_0";
    let is_inverse_bind = semantic == "INVERSE_BIND";
    let core_float = component_type == 5126 && !normalized;
    let core_texcoord = is_texcoord && (core_float || ((component_type == 5121 || component_type == 5123) && normalized));
    let core_joints = is_joints && !normalized && (component_type == 5121 || component_type == 5123);
    let core_weights = is_weights && (core_float || ((component_type == 5121 || component_type == 5123) && normalized));
    let core_inverse_bind = is_inverse_bind && core_float;
    let quantized = if is_position { integer_component }
                    else if is_normal || is_tangent { (component_type == 5120 || component_type == 5122) && normalized }
                    else if is_texcoord { integer_component && !core_texcoord }
                    else { false };
    guard count_ok && count > 0 && count <= 1048576 && component_ok && type_ok && actual_type == type_name &&
          component_bytes > 0 && (core_float || core_texcoord || core_joints || core_weights || core_inverse_bind || quantized) &&
          (!is_animation || core_float)
    else { return GlbAttribute { .. }, false; }
    if quantized {
        guard glb_array_has_string(json::member(doc, "extensionsUsed"), "KHR_mesh_quantization") &&
              glb_array_has_string(json::member(doc, "extensionsRequired"), "KHR_mesh_quantization")
        else { return GlbAttribute { .. }, false; }
    }
    let packed_size = components * component_bytes;
    var base_offset: i64 = 0;
    var stride = packed_size;
    var has_base = false;
    let view_node = json::member(accessor, "bufferView");
    if view_node {
        let view_index, view_ok = glb_json_index(view_node);
        let view = glb_json_element(views, view_index);
        let buffer_index, buffer_ok = glb_optional_index(json::member(view, "buffer"), 0);
        let view_offset, view_offset_ok = glb_optional_index(json::member(view, "byteOffset"), 0);
        let view_length, length_ok = glb_json_index(json::member(view, "byteLength"));
        let accessor_offset, accessor_offset_ok = glb_optional_index(json::member(accessor, "byteOffset"), 0);
        let stride_value, stride_ok = glb_optional_index(json::member(view, "byteStride"), packed_size);
        guard view_ok && view && buffer_ok && buffer_index >= 0 && buffer_index < buffer_bases.len && buffer_index < buffer_sizes.len &&
              view_offset_ok && view_offset >= 0 && length_ok && view_length > 0 && accessor_offset_ok && accessor_offset >= 0 &&
              stride_ok && stride_value >= packed_size && stride_value <= 252 &&
              (!json::member(view, "byteStride") || (stride_value >= 4 && stride_value % 4 == 0)) &&
              view_offset % component_bytes == 0 && accessor_offset % component_bytes == 0
        else { return GlbAttribute { .. }, false; }
        let start = view_offset + accessor_offset;
        if quantized { guard start % 4 == 0 && (count <= 1 || stride_value % 4 == 0) else { return GlbAttribute { .. }, false; } }
        let last = accessor_offset + (count - 1) * stride_value + packed_size;
        guard last <= view_length && view_offset + view_length <= buffer_sizes[buffer_index] else { return GlbAttribute { .. }, false; }
        base_offset = buffer_bases[buffer_index] + start;
        stride = stride_value;
        has_base = true;
    } else {
        guard !json::member(accessor, "byteOffset") && json::member(accessor, "sparse") else { return GlbAttribute { .. }, false; }
    }
    let sparse, sparse_ok = glb_sparse_accessor(doc, bytes, buffer_bases, buffer_sizes, accessor, count, component_bytes, packed_size);
    guard sparse_ok else { return GlbAttribute { .. }, false; }
    return GlbAttribute { offset: base_offset, stride: stride, count: count, components: components,
                          component_type: component_type, normalized: normalized, has_base: has_base, sparse: sparse }, true;
}

fn glb_attribute_component(bytes: const u8[:], at: i64, component_type: i64, normalized: bool) -> f32, bool {
    if component_type == 5126 { return glb_f32(bytes, at); }
    if component_type == 5120 || component_type == 5121 {
        var value: i64 = bytes[at];
        if component_type == 5120 && value >= 128 { value -= 256; }
        if normalized {
            if component_type == 5120 { return max(value / 127.0, -1.0), true; }
            return value / 255.0, true;
        }
        return value, true;
    }
    let lo: i64 = bytes[at]; let hi: i64 = bytes[at + 1];
    var value = lo | hi << 8;
    if component_type == 5122 && value >= 32768 { value -= 65536; }
    if normalized {
        if component_type == 5122 { return max(value / 32767.0, -1.0), true; }
        return value / 65535.0, true;
    }
    return value, true;
}

fn glb_attribute_value(bytes: const u8[:], binary_start: i64, accessor: GlbAttribute, vertex_index: i64, component_index: i64) -> f32, bool {
    guard vertex_index >= 0 && vertex_index < accessor.count && component_index >= 0 && component_index < accessor.components else { return 0.0, false; }
    let component_bytes: i64 = if accessor.component_type == 5126 { 4 } else if accessor.component_type == 5121 || accessor.component_type == 5120 { 1 } else { 2 };
    if accessor.sparse.count > 0 {
        var low: i64 = 0;
        var high = accessor.sparse.count;
        while low < high {
            let middle = (low + high) / 2;
            let sparse_vertex = glb_sparse_index(bytes, accessor.sparse, middle);
            if sparse_vertex < vertex_index { low = middle + 1; } else { high = middle; }
        }
        if low < accessor.sparse.count && glb_sparse_index(bytes, accessor.sparse, low) == vertex_index {
            let at = accessor.sparse.values_offset + low * accessor.components * component_bytes + component_index * component_bytes;
            return glb_attribute_component(bytes, at, accessor.component_type, accessor.normalized);
        }
    }
    if !accessor.has_base { return 0.0, true; }
    let at = binary_start + accessor.offset + vertex_index * accessor.stride + component_index * component_bytes;
    return glb_attribute_component(bytes, at, accessor.component_type, accessor.normalized);
}

fn glb_color_accessor(doc: json::Node?, bytes: const u8[:], buffer_bases: const i64[:], buffer_sizes: const i64[:], index: i64) -> GlbAccessor, i64, bool {
    let accessor = glb_json_element(json::member(doc, "accessors"), index);
    let views = json::member(doc, "bufferViews");
    guard accessor && views else { return GlbAccessor { .. }, 0, false; }
    let count, count_ok = glb_json_index(json::member(accessor, "count"));
    let component_type, component_ok = glb_json_index(json::member(accessor, "componentType"));
    let type_name, type_ok = json::as_string(json::member(accessor, "type"));
    let components: i64 = if type_name == "VEC3" { 3 } else if type_name == "VEC4" { 4 } else { 0 };
    let normalized_node = json::member(accessor, "normalized");
    var normalized = false;
    if normalized_node { let value, valid = json::as_bool(normalized_node); guard valid else { return GlbAccessor { .. }, 0, false; } normalized = value; }
    let bytes_per_component: i64 = if component_type == 5126 { 4 } else if component_type == 5123 { 2 } else if component_type == 5121 { 1 } else { 0 };
    guard count_ok && count > 0 && count <= 1048576 && component_ok && type_ok && components >= 3 && bytes_per_component > 0 &&
          ((component_type == 5126 && !normalized) || ((component_type == 5121 || component_type == 5123) && normalized))
    else { return GlbAccessor { .. }, 0, false; }
    let packed_size = components * bytes_per_component;
    var base_offset: i64 = 0;
    var stride = packed_size;
    var has_base = false;
    let view_node = json::member(accessor, "bufferView");
    if view_node {
        let view_index, view_ok = glb_json_index(view_node);
        let view = glb_json_element(views, view_index);
        let buffer_index, buffer_ok = glb_optional_index(json::member(view, "buffer"), 0);
        let view_offset, view_offset_ok = glb_optional_index(json::member(view, "byteOffset"), 0);
        let view_length, length_ok = glb_json_index(json::member(view, "byteLength"));
        let accessor_offset, accessor_offset_ok = glb_optional_index(json::member(accessor, "byteOffset"), 0);
        let stride_value, stride_ok = glb_optional_index(json::member(view, "byteStride"), packed_size);
        let last = accessor_offset + (count - 1) * stride_value + packed_size;
        guard view_ok && view && buffer_ok && buffer_index >= 0 && buffer_index < buffer_bases.len && buffer_index < buffer_sizes.len &&
              view_offset_ok && view_offset >= 0 && length_ok && view_length > 0 && accessor_offset_ok && accessor_offset >= 0 &&
              stride_ok && stride_value >= packed_size && stride_value <= 252 &&
              (!json::member(view, "byteStride") || stride_value % 4 == 0) &&
              last <= view_length &&
              view_offset + view_length <= buffer_sizes[buffer_index] && (view_offset + accessor_offset) % bytes_per_component == 0
        else { return GlbAccessor { .. }, 0, false; }
        base_offset = buffer_bases[buffer_index] + view_offset + accessor_offset;
        stride = stride_value;
        has_base = true;
    } else {
        guard !json::member(accessor, "byteOffset") && json::member(accessor, "sparse") else { return GlbAccessor { .. }, 0, false; }
    }
    let sparse, sparse_ok = glb_sparse_accessor(doc, bytes, buffer_bases, buffer_sizes, accessor, count, bytes_per_component, packed_size);
    guard sparse_ok else { return GlbAccessor { .. }, 0, false; }
    return GlbAccessor { offset: base_offset, stride: stride, count: count, components: components,
                         has_base: has_base, sparse: sparse }, component_type, true;
}

fn glb_color_channel(bytes: const u8[:], at: i64, component_type: i64) -> f32, bool {
    if component_type == 5126 { return glb_f32(bytes, at); }
    if component_type == 5121 { return bytes[at] / 255.0, true; }
    let lo: i64 = bytes[at]; let hi: i64 = bytes[at + 1];
    let value = lo | hi << 8;
    return value / 65535.0, true;
}

fn glb_vertex_color(bytes: const u8[:], binary_start: i64, accessor: GlbAccessor, component_type: i64, vertex_index: i64) -> float4, bool {
    let component_bytes: i64 = if component_type == 5126 { 4 } else if component_type == 5123 { 2 } else { 1 };
    var at = binary_start + accessor.offset + vertex_index * accessor.stride;
    if accessor.sparse.count > 0 {
        var low: i64 = 0;
        var high = accessor.sparse.count;
        while low < high {
            let middle = (low + high) / 2;
            let sparse_vertex = glb_sparse_index(bytes, accessor.sparse, middle);
            if sparse_vertex < vertex_index { low = middle + 1; } else { high = middle; }
        }
        if low < accessor.sparse.count && glb_sparse_index(bytes, accessor.sparse, low) == vertex_index {
            at = accessor.sparse.values_offset + low * accessor.components * component_bytes;
        } else if !accessor.has_base { at = -1; }
    }
    if at < 0 { return float4 { 0.0, 0.0, 0.0, if accessor.components == 3 { 1.0 } else { 0.0 } }, true; }
    let r, r_ok = glb_color_channel(bytes, at, component_type);
    let g, g_ok = glb_color_channel(bytes, at + component_bytes, component_type);
    let b, b_ok = glb_color_channel(bytes, at + 2 * component_bytes, component_type);
    guard r_ok && g_ok && b_ok else { return float4_1, false; }
    var alpha: f32 = 1.0;
    if accessor.components == 4 { let value, ok = glb_color_channel(bytes, at + 3 * component_bytes, component_type); guard ok else { return float4_1, false; } alpha = value; }
    return float4 { r, g, b, alpha }, true;
}

fn glb_vertex_tangent(bytes: const u8[:], binary_start: i64, accessor: GlbAccessor, vertex_index: i64) -> float4, bool {
    let at = binary_start + accessor.offset + vertex_index * accessor.stride;
    let x, x_ok = glb_f32(bytes, at); let y, y_ok = glb_f32(bytes, at + 4);
    let z, z_ok = glb_f32(bytes, at + 8); let w, w_ok = glb_f32(bytes, at + 12);
    guard x_ok && y_ok && z_ok && w_ok else { return float4_0, false; }
    return float4 { x, y, z, w }, true;
}

fn glb_index_accessor(doc: json::Node?, bytes: const u8[:], buffer_bases: const i64[:], buffer_sizes: const i64[:], index: i64) -> GlbAccessor, i64, bool {
    let accessors = json::member(doc, "accessors");
    let views = json::member(doc, "bufferViews");
    let accessor = glb_json_element(accessors, index);
    guard accessor && views else { return GlbAccessor { .. }, 0, false; }
    let count, count_ok = glb_json_index(json::member(accessor, "count"));
    let component_type, component_ok = glb_json_index(json::member(accessor, "componentType"));
    let type_name, type_ok = json::as_string(json::member(accessor, "type"));
    let normalized_node = json::member(accessor, "normalized");
    var normalized = false;
    if normalized_node { let value, valid = json::as_bool(normalized_node); guard valid else { return GlbAccessor { .. }, 0, false; } normalized = value; }
    guard count_ok && count > 0 && count <= 3145728 && component_ok &&
          (component_type == 5121 || component_type == 5123 || component_type == 5125) &&
          type_ok && type_name == "SCALAR" && !normalized else { return GlbAccessor { .. }, 0, false; }
    let bytes_per_index = if component_type == 5121 { 1 } else if component_type == 5123 { 2 } else { 4 };
    var base_offset: i64 = 0;
    var has_base = false;
    let view_node = json::member(accessor, "bufferView");
    if view_node {
        let view_index, view_ok = glb_json_index(view_node);
        let view = glb_json_element(views, view_index);
        let buffer_index, buffer_ok = glb_optional_index(json::member(view, "buffer"), 0);
        let view_offset, view_offset_ok = glb_optional_index(json::member(view, "byteOffset"), 0);
        let view_length, length_ok = glb_json_index(json::member(view, "byteLength"));
        let accessor_offset, accessor_offset_ok = glb_optional_index(json::member(accessor, "byteOffset"), 0);
        guard view_ok && view && buffer_ok && buffer_index >= 0 && buffer_index < buffer_bases.len && buffer_index < buffer_sizes.len &&
              view_offset_ok && view_offset >= 0 && length_ok && view_length > 0 && accessor_offset_ok && accessor_offset >= 0 &&
              view_offset + view_length <= buffer_sizes[buffer_index] && accessor_offset <= view_length &&
              count <= (view_length - accessor_offset) / bytes_per_index && (view_offset + accessor_offset) % bytes_per_index == 0 &&
              !json::member(view, "byteStride") else { return GlbAccessor { .. }, 0, false; }
        base_offset = buffer_bases[buffer_index] + view_offset + accessor_offset;
        has_base = true;
    } else {
        guard !json::member(accessor, "byteOffset") && json::member(accessor, "sparse") else { return GlbAccessor { .. }, 0, false; }
    }
    let sparse, sparse_ok = glb_sparse_accessor(doc, bytes, buffer_bases, buffer_sizes, accessor, count, bytes_per_index, bytes_per_index);
    guard sparse_ok else { return GlbAccessor { .. }, 0, false; }
    return GlbAccessor { offset: base_offset, stride: bytes_per_index, count: count, components: 1,
                         has_base: has_base, sparse: sparse }, component_type, true;
}

fn glb_index_value(bytes: const u8[:], accessor: GlbAccessor, component_type: i64, index: i64) -> i64 {
    var at = accessor.offset + index * accessor.stride;
    if accessor.sparse.count > 0 {
        var low: i64 = 0;
        var high = accessor.sparse.count;
        while low < high {
            let middle = (low + high) / 2;
            let sparse_vertex = glb_sparse_index(bytes, accessor.sparse, middle);
            if sparse_vertex < index { low = middle + 1; } else { high = middle; }
        }
        if low < accessor.sparse.count && glb_sparse_index(bytes, accessor.sparse, low) == index {
            let value_bytes = if component_type == 5121 { 1 } else if component_type == 5123 { 2 } else { 4 };
            at = accessor.sparse.values_offset + low * value_bytes;
        } else if !accessor.has_base { return 0; }
    } else if !accessor.has_base { return 0; }
    if component_type == 5121 { return bytes[at]; }
    if component_type == 5123 { return bytes[at] | bytes[at + 1] << 8; }
    return glb_u32(bytes, at);
}

fn glb_matrix(node: json::Node?) -> Mat4, bool {
    let matrix = json::member(node, "matrix");
    if matrix {
        guard glb_array_count(matrix) == 16 && !json::member(node, "translation") &&
              !json::member(node, "rotation") && !json::member(node, "scale") else { return mat4_identity(), false; }
        var out = mat4_identity();
        for i in 16 {
            let value, ok = json::as_f64(glb_json_element(matrix, i));
            guard ok && value >= -3.4e38 && value <= 3.4e38 else { return mat4_identity(), false; }
            out.m[i] = value as f32;
        }
        return out, true;
    }
    let t = json::member(node, "translation");
    let r = json::member(node, "rotation");
    let s = json::member(node, "scale");
    var tx = 0.0; var ty = 0.0; var tz = 0.0;
    var qx = 0.0; var qy = 0.0; var qz = 0.0; var qw = 1.0;
    var sx = 1.0; var sy = 1.0; var sz = 1.0;
    if t { guard glb_array_count(t) == 3 else { return mat4_identity(), false; } let x, a = json::as_f64(glb_json_element(t, 0)); let y, b = json::as_f64(glb_json_element(t, 1)); let z, c = json::as_f64(glb_json_element(t, 2)); guard a && b && c else { return mat4_identity(), false; } tx=x; ty=y; tz=z; }
    if r { guard glb_array_count(r) == 4 else { return mat4_identity(), false; } let x, a = json::as_f64(glb_json_element(r, 0)); let y, b = json::as_f64(glb_json_element(r, 1)); let z, c = json::as_f64(glb_json_element(r, 2)); let w, d = json::as_f64(glb_json_element(r, 3)); guard a && b && c && d else { return mat4_identity(), false; } qx=x; qy=y; qz=z; qw=w; }
    if s { guard glb_array_count(s) == 3 else { return mat4_identity(), false; } let x, a = json::as_f64(glb_json_element(s, 0)); let y, b = json::as_f64(glb_json_element(s, 1)); let z, c = json::as_f64(glb_json_element(s, 2)); guard a && b && c else { return mat4_identity(), false; } sx=x; sy=y; sz=z; }
    let qlen = sqrt(qx*qx + qy*qy + qz*qz + qw*qw);
    guard qlen > 1e-12 else { return mat4_identity(), false; }
    qx /= qlen; qy /= qlen; qz /= qlen; qw /= qlen;
    guard tx >= -3.4e38 && tx <= 3.4e38 && ty >= -3.4e38 && ty <= 3.4e38 && tz >= -3.4e38 && tz <= 3.4e38 &&
          sx >= -3.4e38 && sx <= 3.4e38 && sy >= -3.4e38 && sy <= 3.4e38 && sz >= -3.4e38 && sz <= 3.4e38 else { return mat4_identity(), false; }
    var out = mat4_identity();
    out.m[0] = (1.0 - 2.0*(qy*qy + qz*qz)) as f32 * sx as f32;
    out.m[1] = (2.0*(qx*qy + qz*qw)) as f32 * sx as f32;
    out.m[2] = (2.0*(qx*qz - qy*qw)) as f32 * sx as f32;
    out.m[4] = (2.0*(qx*qy - qz*qw)) as f32 * sy as f32;
    out.m[5] = (1.0 - 2.0*(qx*qx + qz*qz)) as f32 * sy as f32;
    out.m[6] = (2.0*(qy*qz + qx*qw)) as f32 * sy as f32;
    out.m[8] = (2.0*(qx*qz + qy*qw)) as f32 * sz as f32;
    out.m[9] = (2.0*(qy*qz - qx*qw)) as f32 * sz as f32;
    out.m[10] = (1.0 - 2.0*(qx*qx + qy*qy)) as f32 * sz as f32;
    out.m[12] = tx as f32; out.m[13] = ty as f32; out.m[14] = tz as f32;
    return out, true;
}

fn glb_node_trs(node: json::Node?) -> float3, float4, float3, bool {
    guard node && !json::member(node, "matrix") else { return float3_0, float4 { 0.0, 0.0, 0.0, 1.0 }, float3_1, false; }
    let t = json::member(node, "translation"); let r = json::member(node, "rotation"); let s = json::member(node, "scale");
    var translation = float3_0; var rotation = float4 { 0.0, 0.0, 0.0, 1.0 }; var scale = float3_1;
    if t {
        guard glb_array_count(t) == 3 else { return translation, rotation, scale, false; }
        let x, a = json::as_f64(glb_json_element(t, 0)); let y, b = json::as_f64(glb_json_element(t, 1)); let z, c = json::as_f64(glb_json_element(t, 2));
        guard a && b && c && abs(x) <= 3.4e38 && abs(y) <= 3.4e38 && abs(z) <= 3.4e38 else { return translation, rotation, scale, false; }
        translation = float3 { x as f32, y as f32, z as f32 };
    }
    if r {
        guard glb_array_count(r) == 4 else { return translation, rotation, scale, false; }
        let x, a = json::as_f64(glb_json_element(r, 0)); let y, b = json::as_f64(glb_json_element(r, 1)); let z, c = json::as_f64(glb_json_element(r, 2)); let w, d = json::as_f64(glb_json_element(r, 3));
        guard a && b && c && d && abs(x) <= 3.4e38 && abs(y) <= 3.4e38 && abs(z) <= 3.4e38 && abs(w) <= 3.4e38 else { return translation, rotation, scale, false; }
        let length = sqrt(x*x + y*y + z*z + w*w);
        guard length > 1e-12 else { return translation, rotation, scale, false; }
        rotation = float4 { (x/length) as f32, (y/length) as f32, (z/length) as f32, (w/length) as f32 };
    }
    if s {
        guard glb_array_count(s) == 3 else { return translation, rotation, scale, false; }
        let x, a = json::as_f64(glb_json_element(s, 0)); let y, b = json::as_f64(glb_json_element(s, 1)); let z, c = json::as_f64(glb_json_element(s, 2));
        guard a && b && c && abs(x) <= 3.4e38 && abs(y) <= 3.4e38 && abs(z) <= 3.4e38 else { return translation, rotation, scale, false; }
        scale = float3 { x as f32, y as f32, z as f32 };
    }
    return translation, rotation, scale, true;
}

fn glb_trs_matrix(translation: float3, rotation: float4, scale: float3) -> Mat4 {
    let x = rotation.x; let y = rotation.y; let z = rotation.z; let w = rotation.w;
    var out = mat4_identity();
    out.m[0] = (1.0 - 2.0*(y*y + z*z)) * scale.x;
    out.m[1] = (2.0*(x*y + z*w)) * scale.x;
    out.m[2] = (2.0*(x*z - y*w)) * scale.x;
    out.m[4] = (2.0*(x*y - z*w)) * scale.y;
    out.m[5] = (1.0 - 2.0*(x*x + z*z)) * scale.y;
    out.m[6] = (2.0*(y*z + x*w)) * scale.y;
    out.m[8] = (2.0*(x*z + y*w)) * scale.z;
    out.m[9] = (2.0*(y*z - x*w)) * scale.z;
    out.m[10] = (1.0 - 2.0*(x*x + y*y)) * scale.z;
    out.m[12] = translation.x; out.m[13] = translation.y; out.m[14] = translation.z;
    return out;
}

// Compose the local transform of a node with every parent up to its root.
// The depth bound rejects cycles, and the parent table rejects duplicate links.
fn glb_node_world_matrix(root: json::Node?, node_index: i64) -> Mat4, bool {
    let nodes = json::member(root, "nodes");
    let count = glb_array_count(nodes);
    guard node_index >= 0 && node_index < count else { return mat4_identity(), false; }
    var parents: i64[>..] = [];
    for _ in 0..count { parents.push(-1); }
    for i in 0..count {
        let children = json::member(glb_json_element(nodes, i), "children");
        for j in 0..glb_array_count(children) {
            let child, ok = glb_json_index(glb_json_element(children, j));
            guard ok && child >= 0 && child < count && parents[child] < 0 else { return mat4_identity(), false; }
            parents[child] = i;
        }
    }
    var current = node_index;
    var world = mat4_identity();
    var depth: i64 = 0;
    while current >= 0 && depth < count {
        let local, local_ok = glb_matrix(glb_json_element(nodes, current));
        guard local_ok else { return mat4_identity(), false; }
        world = mat4_mul(local, world);
        current = parents[current];
        depth += 1;
    }
    guard current < 0 else { return mat4_identity(), false; }
    return world, true;
}

fn glb_node_camera(root: json::Node?, node_index: i64) -> Camera, bool {
    let nodes = json::member(root, "nodes");
    let node_source = glb_json_element(nodes, node_index);
    let camera_index, camera_index_ok = glb_json_index(json::member(node_source, "camera"));
    let source = glb_json_element(json::member(root, "cameras"), camera_index);
    guard node_source && camera_index_ok && source else { return Camera { .. }, false; }
    let kind, kind_ok = json::as_string(json::member(source, "type"));
    guard kind_ok else { return Camera { .. }, false; }
    var imported = Camera { .. };
    if kind == "perspective" {
        let perspective = json::member(source, "perspective");
        let yfov, yfov_ok = glb_number(json::member(perspective, "yfov"), 0.0);
        let aspect, aspect_ok = glb_number(json::member(perspective, "aspectRatio"), 0.0);
        let near, near_ok = glb_number(json::member(perspective, "znear"), 0.0);
        let far, far_ok = glb_number(json::member(perspective, "zfar"), 400.0);
        guard perspective && yfov_ok && aspect_ok && near_ok && far_ok && yfov > 0.0 && yfov < 3.141592653589793 &&
              aspect >= 0.0 && aspect <= 3.4e38 && near > 0.0 && far > near && far <= 3.4e38 else { return Camera { .. }, false; }
        imported.fov = yfov as f32;
        imported.aspect = aspect as f32;
        imported.near = near as f32;
        imported.far = far as f32;
    } else if kind == "orthographic" {
        let orthographic = json::member(source, "orthographic");
        let xmag, xmag_ok = glb_number(json::member(orthographic, "xmag"), 0.0);
        let ymag, ymag_ok = glb_number(json::member(orthographic, "ymag"), 0.0);
        let near, near_ok = glb_number(json::member(orthographic, "znear"), 0.0);
        let far, far_ok = glb_number(json::member(orthographic, "zfar"), 0.0);
        guard orthographic && xmag_ok && ymag_ok && near_ok && far_ok && xmag > 0.0 && ymag > 0.0 &&
              xmag <= 3.4e38 && ymag <= 1.7e38 && near >= 0.0 && far > near && far <= 3.4e38 &&
              xmag / ymag <= 3.4e38 else { return Camera { .. }, false; }
        imported.orthographic = true;
        imported.ortho_height = (ymag * 2.0) as f32;
        imported.aspect = (xmag / ymag) as f32;
        imported.near = near as f32;
        imported.far = far as f32;
    } else { return Camera { .. }, false; }
    let world, world_ok = glb_node_world_matrix(root, node_index);
    guard world_ok else { return Camera { .. }, false; }
    let origin = mat4_transform_point(world, float3_0);
    let forward_point = mat4_transform_point(world, float3 { 0.0, 0.0, -1.0 });
    let up_point = mat4_transform_point(world, float3 { 0.0, 1.0, 0.0 });
    let position = float3 { origin.x, origin.y, origin.z };
    let forward_raw = float3 { forward_point.x - origin.x, forward_point.y - origin.y, forward_point.z - origin.z };
    let up_raw = float3 { up_point.x - origin.x, up_point.y - origin.y, up_point.z - origin.z };
    guard origin.w != 0.0 && origin.x >= -3.4e38 && origin.x <= 3.4e38 && origin.y >= -3.4e38 && origin.y <= 3.4e38 && origin.z >= -3.4e38 && origin.z <= 3.4e38 &&
          forward_raw.x >= -3.4e38 && forward_raw.x <= 3.4e38 && forward_raw.y >= -3.4e38 && forward_raw.y <= 3.4e38 && forward_raw.z >= -3.4e38 && forward_raw.z <= 3.4e38 &&
          up_raw.x >= -3.4e38 && up_raw.x <= 3.4e38 && up_raw.y >= -3.4e38 && up_raw.y <= 3.4e38 && up_raw.z >= -3.4e38 && up_raw.z <= 3.4e38 &&
          length(forward_raw) > 1e-6 && length(forward_raw) <= 3.4e38 && length(up_raw) > 1e-6 && length(up_raw) <= 3.4e38 else { return Camera { .. }, false; }
    let forward = normalize(forward_raw);
    let right_raw = cross(forward, up_raw);
    guard length(right_raw) > 1e-6 && length(right_raw) <= 3.4e38 else { return Camera { .. }, false; }
    imported.pos = position;
    imported.target = position + forward;
    imported.up = normalize(cross(normalize(right_raw), forward));
    return imported, true;
}

fn glb_node_light(root: json::Node?, node_index: i64) -> NativeGlbSceneLight, bool {
    let nodes = json::member(root, "nodes");
    let node_source = glb_json_element(nodes, node_index);
    let punctual = json::member(json::member(node_source, "extensions"), "KHR_lights_punctual");
    guard node_source && punctual && glb_array_has_string(json::member(root, "extensionsUsed"), "KHR_lights_punctual") else { return NativeGlbSceneLight { .. }, false; }
    let light_index, light_index_ok = glb_json_index(json::member(punctual, "light"));
    let source = glb_json_element(json::member(json::member(json::member(root, "extensions"), "KHR_lights_punctual"), "lights"), light_index);
    guard light_index_ok && source else { return NativeGlbSceneLight { .. }, false; }
    let kind_name, kind_ok = json::as_string(json::member(source, "type"));
    guard kind_ok else { return NativeGlbSceneLight { .. }, false; }
    let color, color_ok = glb_factor3(json::member(source, "color"), float3_1, 0.0, 1.0);
    let intensity, intensity_ok = glb_number(json::member(source, "intensity"), 1.0);
    let range_node = json::member(source, "range");
    let range, range_ok = glb_number(range_node, 0.0);
    guard color_ok && intensity_ok && range_ok && intensity >= 0.0 && intensity <= 3.4e38 && range >= 0.0 &&
          (!range_node || range > 0.0) && color.x * intensity <= 3.4e38 && color.y * intensity <= 3.4e38 && color.z * intensity <= 3.4e38 else { return NativeGlbSceneLight { .. }, false; }
    var kind: i32 = -1;
    if kind_name == "directional" { kind = 0; }
    else if kind_name == "point" { kind = 1; }
    else if kind_name == "spot" { kind = 2; }
    else { return NativeGlbSceneLight { .. }, false; }
    guard kind != 0 || !range_node else { return NativeGlbSceneLight { .. }, false; }
    var inner: f64 = 0.0;
    var outer: f64 = 0.7853981633974483;
    if kind == 2 {
        let spot = json::member(source, "spot");
        let inner_value, inner_ok = glb_number(json::member(spot, "innerConeAngle"), 0.0);
        let outer_value, outer_ok = glb_number(json::member(spot, "outerConeAngle"), 0.7853981633974483);
        guard spot && inner_ok && outer_ok && inner_value >= 0.0 && inner_value < outer_value && outer_value <= 1.5707963267948966 else { return NativeGlbSceneLight { .. }, false; }
        inner = inner_value; outer = outer_value;
    }
    let world, world_ok = glb_node_world_matrix(root, node_index);
    guard world_ok else { return NativeGlbSceneLight { .. }, false; }
    let origin = mat4_transform_point(world, float3_0);
    let forward_point = mat4_transform_point(world, float3 { 0.0, 0.0, -1.0 });
    let direction_raw = float3 { forward_point.x - origin.x, forward_point.y - origin.y, forward_point.z - origin.z };
    guard origin.w != 0.0 && origin.x >= -3.4e38 && origin.x <= 3.4e38 && origin.y >= -3.4e38 && origin.y <= 3.4e38 && origin.z >= -3.4e38 && origin.z <= 3.4e38 &&
          direction_raw.x >= -3.4e38 && direction_raw.x <= 3.4e38 && direction_raw.y >= -3.4e38 && direction_raw.y <= 3.4e38 && direction_raw.z >= -3.4e38 && direction_raw.z <= 3.4e38 &&
          length(direction_raw) > 1e-6 && length(direction_raw) <= 3.4e38 else { return NativeGlbSceneLight { .. }, false; }
    return NativeGlbSceneLight { kind: kind, position: float3 { origin.x, origin.y, origin.z }, direction: normalize(direction_raw),
        color: color * (intensity as f32), range: range as f32, inner: inner as f32, outer: outer as f32 }, true;
}

// Load one selected static primitive from a glTF 2.0 GLB or JSON glTF document.
// Supports dense and sparse float32 or required KHR_mesh_quantization vertex
// attributes, COLOR_0, TRIANGLES, u8/u16/u32 indices, core and supported
// extension material maps. Scene skins use one JOINTS_0/WEIGHTS_0 set.
// JSON glTF supports up to 16 safe relative external buffers. It applies the
// selected node instance transform.
fn native_glb_load_selected(path: const u8[:], requested_mesh_index: i64, primitive_index: i64, node_index: i64) -> NativeGlbModel, bool {
    var bytes: u8[>..] = [];
    guard path.len > 0 && read_file(path, bytes) && bytes.len <= 268435456 else { return NativeGlbModel { .. }, false; }
    let is_glb = bytes.len >= 12 && glb_u32(bytes[..], 0) == 0x46546C67;
    var json_start: i64 = -1; var json_size: i64 = 0; var bin_start: i64 = -1; var bin_size: i64 = 0;
    if is_glb {
        guard bytes.len >= 20 && glb_u32(bytes[..], 4) == 2 && glb_u32(bytes[..], 8) == bytes.len else { return NativeGlbModel { .. }, false; }
        var cursor: i64 = 12;
        while cursor + 8 <= bytes.len {
            let size = glb_u32(bytes[..], cursor);
            let kind = glb_u32(bytes[..], cursor + 4);
            cursor += 8;
            guard size >= 0 && size % 4 == 0 && cursor + size <= bytes.len else { return NativeGlbModel { .. }, false; }
            if kind == 0x4E4F534A { guard json_start < 0 else { return NativeGlbModel { .. }, false; } json_start = cursor; json_size = size; }
            else if kind == 0x004E4942 { guard bin_start < 0 else { return NativeGlbModel { .. }, false; } bin_start = cursor; bin_size = size; }
            cursor += size;
        }
        guard cursor == bytes.len && json_start >= 0 && bin_start >= 0 else { return NativeGlbModel { .. }, false; }
    } else {
        guard bytes.len > 0 else { return NativeGlbModel { .. }, false; }
        json_start = 0; json_size = bytes.len;
    }
    var doc: json::Node[>..] = [];
    var decoded: u8[>..] = [];
    let root, parse_error = json::parse(bytes[json_start..json_start + json_size], doc, decoded);
    guard root && parse_error.len == 0 else { return NativeGlbModel { .. }, false; }
    let asset = json::member(root, "asset");
    let version, version_ok = json::as_string(json::member(asset, "version"));
    let buffers = json::member(root, "buffers");
    let buffer_count = glb_array_count(buffers);
    guard version_ok && version == "2.0" && buffer_count > 0 && buffer_count <= 16 else { return NativeGlbModel { .. }, false; }
    if is_glb { guard buffer_count == 1 && bin_start >= 0 else { return NativeGlbModel { .. }, false; } }
    var buffer_bases: i64[>..] = [];
    var buffer_sizes: i64[>..] = [];
    for buffer_index in 0..buffer_count {
        let buffer = glb_json_element(buffers, buffer_index);
        let declared_bytes, declared_ok = glb_json_index(json::member(buffer, "byteLength"));
        guard buffer && declared_ok && declared_bytes > 0 && declared_bytes <= 268435456 && bytes.len + declared_bytes <= 268435456 else { return NativeGlbModel { .. }, false; }
        if is_glb {
            guard buffer_index == 0 && !json::member(buffer, "uri") && declared_bytes <= bin_size && bin_size - declared_bytes <= 3 else { return NativeGlbModel { .. }, false; }
            buffer_bases.push(bin_start);
            buffer_sizes.push(declared_bytes);
        } else {
            let uri, uri_ok = json::as_string(json::member(buffer, "uri"));
            guard uri_ok && uri.len > 0 else { return NativeGlbModel { .. }, false; }
            var external: u8[>..] = [];
            if uri.len >= 5 && uri[0] == 100 && uri[1] == 97 && uri[2] == 116 && uri[3] == 97 && uri[4] == 58 {
                guard uri.len <= 268435456 && glb_decode_data_uri(uri, external) && external.len == declared_bytes else { return NativeGlbModel { .. }, false; }
            } else {
                guard uri.len < 4096 else { return NativeGlbModel { .. }, false; }
                // Only plain relative paths are accepted; reject URI schemes,
                // encoded separators, queries, fragments, and dot path segments.
                var segment_start: i64 = 0;
                for i in 0..uri.len {
                    let c = uri[i];
                    guard c != 92 && c != 58 && c != 63 && c != 35 && c != 37 else { return NativeGlbModel { .. }, false; }
                    if c == 47 {
                        guard i > segment_start && !(i - segment_start == 1 && uri[segment_start] == 46) && !(i - segment_start == 2 && uri[segment_start] == 46 && uri[segment_start + 1] == 46) else { return NativeGlbModel { .. }, false; }
                        segment_start = i + 1;
                    }
                }
                guard segment_start < uri.len && !(uri.len - segment_start == 1 && uri[segment_start] == 46) && !(uri.len - segment_start == 2 && uri[segment_start] == 46 && uri[segment_start + 1] == 46) && uri[0] != 47 else { return NativeGlbModel { .. }, false; }
                var external_path: u8[>..] = [];
                var directory_end: i64 = 0;
                for i in 0..path.len { if path[i] == 47 { directory_end = i + 1; } }
                guard directory_end + uri.len < 4096 else { return NativeGlbModel { .. }, false; }
                for i in 0..directory_end { external_path.push(path[i]); }
                for i in 0..uri.len { external_path.push(uri[i]); }
                guard read_file(external_path[..], external) && external.len == declared_bytes else { return NativeGlbModel { .. }, false; }
            }
            buffer_bases.push(bytes.len);
            buffer_sizes.push(declared_bytes);
            for i in 0..declared_bytes { bytes.push(external[i]); }
        }
    }
    guard node_index >= -1 else { return NativeGlbModel { .. }, false; }
    var mesh_index = requested_mesh_index;
    let nodes = json::member(root, "nodes");
    if node_index >= 0 {
        let instance = glb_json_element(nodes, node_index);
        let instance_mesh, instance_mesh_ok = glb_json_index(json::member(instance, "mesh"));
        guard instance && instance_mesh_ok && instance_mesh >= 0 else { return NativeGlbModel { .. }, false; }
        mesh_index = instance_mesh;
    } else { guard mesh_index >= 0 else { return NativeGlbModel { .. }, false; } }
    let meshes = json::member(root, "meshes");
    let mesh = glb_json_element(meshes, mesh_index);
    let primitives = json::member(mesh, "primitives");
    let primitive = glb_json_element(primitives, primitive_index);
    guard primitive else { return NativeGlbModel { .. }, false; }
    let mode, mode_ok = glb_optional_index(json::member(primitive, "mode"), 4);
    guard mode_ok && mode == 4 else { return NativeGlbModel { .. }, false; }
    let attributes = json::member(primitive, "attributes");
    let position_index, position_ok = glb_json_index(json::member(attributes, "POSITION"));
    let normal_index, normal_ok = glb_json_index(json::member(attributes, "NORMAL"));
    guard position_ok && normal_ok else { return NativeGlbModel { .. }, false; }
    let positions, positions_ok = glb_attribute_accessor(root, bytes[..], buffer_bases[..], buffer_sizes[..], position_index, "POSITION", "VEC3", 3);
    let normals, normals_ok = glb_attribute_accessor(root, bytes[..], buffer_bases[..], buffer_sizes[..], normal_index, "NORMAL", "VEC3", 3);
    guard positions_ok && normals_ok && positions.count == normals.count else { return NativeGlbModel { .. }, false; }
    let uv_node = json::member(attributes, "TEXCOORD_0");
    var uvs = GlbAttribute { .. };
    if uv_node { let uv_index, uv_ok = glb_json_index(uv_node); guard uv_ok else { return NativeGlbModel { .. }, false; } let uv_result, uv_valid = glb_attribute_accessor(root, bytes[..], buffer_bases[..], buffer_sizes[..], uv_index, "TEXCOORD_0", "VEC2", 2); guard uv_valid && uv_result.count == positions.count else { return NativeGlbModel { .. }, false; } uvs = uv_result; }
    let tangent_node = json::member(attributes, "TANGENT");
    var tangents = GlbAttribute { .. };
    if tangent_node { let tangent_index, tangent_index_ok = glb_json_index(tangent_node); guard tangent_index_ok else { return NativeGlbModel { .. }, false; } let tangent_info, tangent_ok = glb_attribute_accessor(root, bytes[..], buffer_bases[..], buffer_sizes[..], tangent_index, "TANGENT", "VEC4", 4); guard tangent_ok && tangent_info.count == positions.count else { return NativeGlbModel { .. }, false; } tangents = tangent_info; }
    let color_node = json::member(attributes, "COLOR_0");
    var colors = GlbAccessor { .. }; var color_type: i64 = 0;
    if color_node { let color_index, color_index_ok = glb_json_index(color_node); guard color_index_ok else { return NativeGlbModel { .. }, false; } let color_info, color_component_type, color_ok = glb_color_accessor(root, bytes[..], buffer_bases[..], buffer_sizes[..], color_index); guard color_ok && color_info.count == positions.count else { return NativeGlbModel { .. }, false; } colors = color_info; color_type = color_component_type; }
    let indices_node = json::member(primitive, "indices");
    var index_info = GlbAccessor { .. }; var index_type: i64 = 0;
    if indices_node { let index_id, index_ok = glb_json_index(indices_node); guard index_ok else { return NativeGlbModel { .. }, false; } let info, kind, ok = glb_index_accessor(root, bytes[..], buffer_bases[..], buffer_sizes[..], index_id); guard ok && info.count % 3 == 0 else { return NativeGlbModel { .. }, false; } index_info = info; index_type = kind; }
    else { guard positions.count % 3 == 0 else { return NativeGlbModel { .. }, false; } index_info.count = positions.count; }
    var vertices: Vertex[>..] = [];
    var out_indices: u32[>..] = [];
    for i in 0..positions.count {
        let px, a = glb_attribute_value(bytes[..], 0, positions, i, 0); let py, b = glb_attribute_value(bytes[..], 0, positions, i, 1); let pz, c = glb_attribute_value(bytes[..], 0, positions, i, 2);
        let nx, d = glb_attribute_value(bytes[..], 0, normals, i, 0); let ny, e = glb_attribute_value(bytes[..], 0, normals, i, 1); let nz, f = glb_attribute_value(bytes[..], 0, normals, i, 2);
        guard a && b && c && d && e && f else { return NativeGlbModel { .. }, false; }
        var uv = float2_0;
        if uv_node { let u, g = glb_attribute_value(bytes[..], 0, uvs, i, 0); let v, h = glb_attribute_value(bytes[..], 0, uvs, i, 1); guard g && h else { return NativeGlbModel { .. }, false; } uv = float2 { u, v }; }
        var color = float4_1;
        if color_node { let color_value, color_valid = glb_vertex_color(bytes[..], 0, colors, color_type, i); guard color_valid else { return NativeGlbModel { .. }, false; } color = color_value; }
        var tangent = float4_0;
        if tangent_node {
            let tx, g = glb_attribute_value(bytes[..], 0, tangents, i, 0); let ty, h = glb_attribute_value(bytes[..], 0, tangents, i, 1);
            let tz, j = glb_attribute_value(bytes[..], 0, tangents, i, 2); let tw, k = glb_attribute_value(bytes[..], 0, tangents, i, 3);
            guard g && h && j && k && abs(abs(tw) - 1.0) <= 0.0001 else { return NativeGlbModel { .. }, false; }
            tangent = float4 { tx, ty, tz, tw };
        }
        vertices.push(Vertex { pos: float3 { px, py, pz }, normal: float3 { nx, ny, nz }, uv: uv, tangent: tangent, color: color, .. });
    }
    for i in 0..index_info.count {
        var value: i64 = i;
        if indices_node {
            value = glb_index_value(bytes[..], index_info, index_type, i);
        }
        guard value >= 0 && value < positions.count else { return NativeGlbModel { .. }, false; }
        out_indices.push(value as u32);
    }
    guard out_indices.len > 0 else { return NativeGlbModel { .. }, false; }
    var transform = mat4_identity();
    var transform_node = node_index;
    if transform_node < 0 {
        for i in 0..glb_array_count(nodes) {
            let candidate = glb_json_element(nodes, i);
            let node_mesh = json::member(candidate, "mesh");
            if node_mesh { let id, ok = glb_json_index(node_mesh); if ok && id == mesh_index { transform_node = i; break; } }
        }
    }
    if transform_node >= 0 { let matrix, valid = glb_node_world_matrix(root, transform_node); guard valid else { return NativeGlbModel { .. }, false; } transform = matrix; }
    let node_source = glb_json_element(nodes, transform_node);
    let skin_node = json::member(node_source, "skin");
    let joints_node = json::member(attributes, "JOINTS_0");
    let weights_node = json::member(attributes, "WEIGHTS_0");
    var skin_joint_nodes: i32[>..] = [];
    var skin_inverse_binds: Mat4[>..] = [];
    var skin_influences: NativeGlbSkinInfluence[>..] = [];
    var skin_joint_count: i64 = 0;
    if skin_node || joints_node || weights_node {
        guard skin_node && joints_node && weights_node && !json::member(attributes, "JOINTS_1") &&
              !json::member(attributes, "WEIGHTS_1") else { return NativeGlbModel { .. }, false; }
        let skin_index, skin_index_ok = glb_json_index(skin_node);
        let skin = glb_json_element(json::member(root, "skins"), skin_index);
        let skin_joints = json::member(skin, "joints");
        skin_joint_count = glb_array_count(skin_joints);
        guard skin_index_ok && skin && skin_joint_count > 0 && skin_joint_count <= 1024 else { return NativeGlbModel { .. }, false; }
        let joint_attribute_index, joint_attribute_ok = glb_json_index(joints_node);
        let weight_attribute_index, weight_attribute_ok = glb_json_index(weights_node);
        let joint_attributes, joint_attributes_ok = glb_attribute_accessor(root, bytes[..], buffer_bases[..], buffer_sizes[..], joint_attribute_index, "JOINTS_0", "VEC4", 4);
        let weight_attributes, weight_attributes_ok = glb_attribute_accessor(root, bytes[..], buffer_bases[..], buffer_sizes[..], weight_attribute_index, "WEIGHTS_0", "VEC4", 4);
        guard joint_attribute_ok && weight_attribute_ok && joint_attributes_ok && weight_attributes_ok &&
              joint_attributes.count == positions.count && weight_attributes.count == positions.count else { return NativeGlbModel { .. }, false; }
        let inverse_bind_node = json::member(skin, "inverseBindMatrices");
        var inverse_bind_accessor = GlbAttribute { .. };
        if inverse_bind_node {
            let inverse_bind_index, inverse_bind_index_ok = glb_json_index(inverse_bind_node);
            let inverse_bind, inverse_bind_ok = glb_attribute_accessor(root, bytes[..], buffer_bases[..], buffer_sizes[..], inverse_bind_index, "INVERSE_BIND", "MAT4", 16);
            guard inverse_bind_index_ok && inverse_bind_ok && inverse_bind.count == skin_joint_count else { return NativeGlbModel { .. }, false; }
            inverse_bind_accessor = inverse_bind;
        }
        for joint in 0..skin_joint_count {
            let joint_node, joint_ok = glb_json_index(glb_json_element(skin_joints, joint));
            guard joint_ok && joint_node >= 0 && joint_node < glb_array_count(nodes) else { return NativeGlbModel { .. }, false; }
            skin_joint_nodes.push(joint_node as i32);
            var inverse_bind = mat4_identity();
            if inverse_bind_node {
                for component in 16 {
                    let value, value_ok = glb_attribute_value(bytes[..], 0, inverse_bind_accessor, joint, component);
                    guard value_ok && abs(value) <= 3.4e38 else { return NativeGlbModel { .. }, false; }
                    inverse_bind.m[component] = value;
                }
            }
            skin_inverse_binds.push(inverse_bind);
        }
        for vertex in 0..positions.count {
            var weight_sum: f32 = 0.0;
            var vertex_influences: NativeGlbSkinInfluence[4];
            for influence in 4 {
                let joint_value, joint_value_ok = glb_attribute_value(bytes[..], 0, joint_attributes, vertex, influence);
                let weight_value, weight_value_ok = glb_attribute_value(bytes[..], 0, weight_attributes, vertex, influence);
                let joint_index = joint_value as i32;
                guard joint_value_ok && weight_value_ok && joint_value >= 0.0 && joint_value < 1024.0 &&
                      joint_value == floor(joint_value) && joint_index >= 0 && joint_index < skin_joint_count && weight_value >= 0.0 else { return NativeGlbModel { .. }, false; }
                vertex_influences[influence] = NativeGlbSkinInfluence { joint_index: joint_index, weight: weight_value, .. };
                weight_sum += weight_value;
            }
            guard weight_sum <= 3.4e38 else { return NativeGlbModel { .. }, false; }
            for influence in 4 {
                var item = vertex_influences[influence];
                if weight_sum > 1e-8 { item.weight /= weight_sum; }
                skin_influences.push(item);
            }
        }
    }
    let primitive_targets = json::member(primitive, "targets");
    let morph_target_count = glb_array_count(primitive_targets);
    guard morph_target_count <= 65536 && morph_target_count * positions.count <= 4194304 else { return NativeGlbModel { .. }, false; }
    var base_vertices: Vertex[>..] = [];
    for i in 0..vertices.len { base_vertices.push(vertices[i]); }
    var morph_deltas: NativeGlbMorphDelta[>..] = [];
    for target_index in 0..morph_target_count {
        let target = glb_json_element(primitive_targets, target_index);
        guard target else { return NativeGlbModel { .. }, false; }
        let target_position_node = json::member(target, "POSITION");
        let target_normal_node = json::member(target, "NORMAL");
        let target_tangent_node = json::member(target, "TANGENT");
        var target_positions = GlbAttribute { .. }; var target_normals = GlbAttribute { .. }; var target_tangents = GlbAttribute { .. };
        if target_position_node {
            let index, index_ok = glb_json_index(target_position_node);
            let value, value_ok = glb_attribute_accessor(root, bytes[..], buffer_bases[..], buffer_sizes[..], index, "POSITION", "VEC3", 3);
            guard index_ok && value_ok && value.count == positions.count else { return NativeGlbModel { .. }, false; }
            target_positions = value;
        }
        if target_normal_node {
            let index, index_ok = glb_json_index(target_normal_node);
            let value, value_ok = glb_attribute_accessor(root, bytes[..], buffer_bases[..], buffer_sizes[..], index, "NORMAL", "VEC3", 3);
            guard index_ok && value_ok && value.count == positions.count else { return NativeGlbModel { .. }, false; }
            target_normals = value;
        }
        if target_tangent_node {
            let index, index_ok = glb_json_index(target_tangent_node);
            let value, value_ok = glb_attribute_accessor(root, bytes[..], buffer_bases[..], buffer_sizes[..], index, "TANGENT", "VEC3", 3);
            guard index_ok && value_ok && value.count == positions.count else { return NativeGlbModel { .. }, false; }
            target_tangents = value;
        }
        for vertex_index in 0..positions.count {
            var delta_position = float3_0; var delta_normal = float3_0; var delta_tangent = float3_0;
            if target_position_node {
                let x, a = glb_attribute_value(bytes[..], 0, target_positions, vertex_index, 0); let y, b = glb_attribute_value(bytes[..], 0, target_positions, vertex_index, 1); let z, c = glb_attribute_value(bytes[..], 0, target_positions, vertex_index, 2);
                guard a && b && c else { return NativeGlbModel { .. }, false; } delta_position = float3 { x, y, z };
            }
            if target_normal_node {
                let x, a = glb_attribute_value(bytes[..], 0, target_normals, vertex_index, 0); let y, b = glb_attribute_value(bytes[..], 0, target_normals, vertex_index, 1); let z, c = glb_attribute_value(bytes[..], 0, target_normals, vertex_index, 2);
                guard a && b && c else { return NativeGlbModel { .. }, false; } delta_normal = float3 { x, y, z };
            }
            if target_tangent_node {
                let x, a = glb_attribute_value(bytes[..], 0, target_tangents, vertex_index, 0); let y, b = glb_attribute_value(bytes[..], 0, target_tangents, vertex_index, 1); let z, c = glb_attribute_value(bytes[..], 0, target_tangents, vertex_index, 2);
                guard a && b && c else { return NativeGlbModel { .. }, false; } delta_tangent = float3 { x, y, z };
            }
            morph_deltas.push(NativeGlbMorphDelta { position: delta_position, normal: delta_normal, tangent: delta_tangent, .. });
        }
    }
    let node_weights = json::member(node_source, "weights");
    let mesh_weights = json::member(mesh, "weights");
    guard !node_weights || glb_array_count(node_weights) == morph_target_count else { return NativeGlbModel { .. }, false; }
    guard node_weights || !mesh_weights || glb_array_count(mesh_weights) == morph_target_count else { return NativeGlbModel { .. }, false; }
    var morph_weights: f32[>..] = [];
    for target_index in 0..morph_target_count {
        if node_weights || mesh_weights {
            let authored_value = if node_weights { glb_json_element(node_weights, target_index) } else { glb_json_element(mesh_weights, target_index) };
            let value, value_ok = json::as_f64(authored_value);
            guard value_ok && abs(value) <= 3.4e38 else { return NativeGlbModel { .. }, false; }
            morph_weights.push(value as f32);
        } else { morph_weights.push(0.0); }
    }
    for target_index in 0..morph_target_count {
        let weight = morph_weights[target_index];
        for vertex_index in 0..vertices.len {
            let delta = morph_deltas[target_index * vertices.len + vertex_index];
            vertices[vertex_index].pos += delta.position * weight;
            vertices[vertex_index].normal += delta.normal * weight;
            let tangent = vertices[vertex_index].tangent;
            vertices[vertex_index].tangent = float4 { tangent.x + delta.tangent.x*weight, tangent.y + delta.tangent.y*weight, tangent.z + delta.tangent.z*weight, tangent.w };
        }
    }
    for vertex_index in 0..vertices.len {
        let n = vertices[vertex_index].normal;
        if length(n) > 1e-8 { vertices[vertex_index].normal = normalize(n); }
        let t = vertices[vertex_index].tangent;
        let tangent_xyz = float3 { t.x, t.y, t.z };
        if length(tangent_xyz) > 1e-8 { let unit = normalize(tangent_xyz); vertices[vertex_index].tangent = float4 { unit.x, unit.y, unit.z, t.w }; }
    }
    var imported_textures = GlbTextureSet { .. };
    let imported_material, imported_texture, material_ok = glb_material(root, primitive, path, bytes[..], buffer_bases[..], buffer_sizes[..], imported_textures);
    guard material_ok else { return NativeGlbModel { .. }, false; }
    let mesh_id = mesh_asset_create(vertices[..], out_indices[..]);
    if mesh_id < 0 { if material_handle_valid(imported_material) { material_asset_release(imported_material); } glb_release_texture_set(imported_textures); return NativeGlbModel { .. }, false; }
    var morph_vertex_start: i64 = -1; var morph_delta_start: i64 = -1; var morph_weight_start: i64 = -1;
    var skin_influence_start: i64 = -1; var skin_joint_start: i64 = -1;
    if morph_target_count > 0 || skin_joint_count > 0 {
        morph_vertex_start = glb_base_vertex_reserve(base_vertices.len);
        if morph_target_count > 0 {
            morph_delta_start = glb_morph_delta_reserve(morph_deltas.len);
            morph_weight_start = glb_morph_weight_reserve(morph_weights.len);
        }
        if skin_joint_count > 0 {
            skin_influence_start = glb_skin_influence_reserve(skin_influences.len);
            skin_joint_start = glb_skin_joint_reserve(skin_joint_count);
        }
        if morph_vertex_start < 0 || (morph_target_count > 0 && (morph_delta_start < 0 || morph_weight_start < 0)) ||
           (skin_joint_count > 0 && (skin_influence_start < 0 || skin_joint_start < 0)) {
            if morph_vertex_start >= 0 { for i in 0..base_vertices.len { g_native_glb_base_vertices[morph_vertex_start + i].active = false; } }
            if morph_delta_start >= 0 { for i in 0..morph_deltas.len { g_native_glb_morph_deltas[morph_delta_start + i].active = false; } }
            if morph_weight_start >= 0 { for i in 0..morph_weights.len { g_native_glb_morph_weights[morph_weight_start + i].active = false; } }
            if skin_influence_start >= 0 { for i in 0..skin_influences.len { g_native_glb_skin_influences[skin_influence_start + i].active = false; } }
            if skin_joint_start >= 0 { for i in 0..skin_joint_count { g_native_glb_skin_joints[skin_joint_start + i].active = false; } }
            mesh_asset_release(mesh_id); if material_handle_valid(imported_material) { material_asset_release(imported_material); } glb_release_texture_set(imported_textures); return NativeGlbModel { .. }, false;
        }
        for i in 0..base_vertices.len { g_native_glb_base_vertices[morph_vertex_start + i] = NativeGlbBaseVertex { vertex: base_vertices[i], active: true }; }
        if morph_target_count > 0 {
            for i in 0..morph_deltas.len { g_native_glb_morph_deltas[morph_delta_start + i] = NativeGlbMorphDelta { position: morph_deltas[i].position, normal: morph_deltas[i].normal, tangent: morph_deltas[i].tangent, active: true }; }
            for i in 0..morph_weights.len { g_native_glb_morph_weights[morph_weight_start + i] = NativeGlbMorphWeight { base: morph_weights[i], value: morph_weights[i], active: true }; }
        }
        if skin_joint_count > 0 {
            for i in 0..skin_influences.len { g_native_glb_skin_influences[skin_influence_start + i] = NativeGlbSkinInfluence { joint_index: skin_influences[i].joint_index, weight: skin_influences[i].weight, active: true }; }
            for i in 0..skin_joint_count { g_native_glb_skin_joints[skin_joint_start + i] = NativeGlbSkinJoint { gltf_node_index: skin_joint_nodes[i], inverse_bind: skin_inverse_binds[i], active: true }; }
        }
    }
    let node_id = node_asset_add(mesh_id);
    if node_id < 0 {
        mesh_asset_release(mesh_id); if material_handle_valid(imported_material) { material_asset_release(imported_material); } glb_release_texture_set(imported_textures);
        for i in 0..base_vertices.len { if morph_vertex_start >= 0 { g_native_glb_base_vertices[morph_vertex_start + i].active = false; } }
        for i in 0..morph_deltas.len { if morph_delta_start >= 0 { g_native_glb_morph_deltas[morph_delta_start + i].active = false; } }
        for i in 0..morph_weights.len { if morph_weight_start >= 0 { g_native_glb_morph_weights[morph_weight_start + i].active = false; } }
        for i in 0..skin_influences.len { if skin_influence_start >= 0 { g_native_glb_skin_influences[skin_influence_start + i].active = false; } }
        for i in 0..skin_joint_count { if skin_joint_start >= 0 { g_native_glb_skin_joints[skin_joint_start + i].active = false; } }
        return NativeGlbModel { .. }, false;
    }
    if material_handle_valid(imported_material) { node(node_id).material = imported_material.id; }
    node(node_id).local_matrix = transform;
    node(node_id).use_local_matrix = true;
    return NativeGlbModel { mesh: mesh_handle(mesh_id), node: node_handle(node_id), material: imported_material, texture: imported_texture, textures: imported_textures,
        morph_vertex_start: morph_vertex_start as i32, morph_vertex_count: positions.count as i32,
        morph_delta_start: morph_delta_start as i32, morph_target_count: morph_target_count as i32,
        morph_weight_start: morph_weight_start as i32,
        skin_influence_start: skin_influence_start as i32, skin_joint_start: skin_joint_start as i32,
        skin_joint_count: skin_joint_count as i32, skin_node_index: if skin_joint_count > 0 { transform_node as i32 } else { -1 } }, true;
}

// Load a primitive by mesh index, using the first node that instances the mesh.
fn native_glb_load_primitive(path: const u8[:], mesh_index: i64, primitive_index: i64) -> NativeGlbModel, bool {
    return native_glb_load_selected(path, mesh_index, primitive_index, -1);
}

// Load a primitive from a specific glTF node instance, preserving that
// instance's full ancestor-composed world transform.
fn native_glb_load_node_primitive(path: const u8[:], node_index: i64, primitive_index: i64) -> NativeGlbModel, bool {
    return native_glb_load_selected(path, -1, primitive_index, node_index);
}

fn glb_node_primitive_count(path: const u8[:], node_index: i64) -> i64, bool {
    var bytes: u8[>..] = [];
    guard path.len > 0 && read_file(path, bytes) && bytes.len > 0 && bytes.len <= 268435456 else { return 0, false; }
    var json_start: i64 = 0; var json_size: i64 = bytes.len;
    if bytes.len >= 12 && glb_u32(bytes[..], 0) == 0x46546C67 {
        guard bytes.len >= 20 && glb_u32(bytes[..], 4) == 2 && glb_u32(bytes[..], 8) == bytes.len else { return 0, false; }
        json_start = -1; json_size = 0;
        var cursor: i64 = 12;
        while cursor + 8 <= bytes.len {
            let size = glb_u32(bytes[..], cursor);
            let kind = glb_u32(bytes[..], cursor + 4);
            cursor += 8;
            guard size >= 0 && size % 4 == 0 && cursor + size <= bytes.len else { return 0, false; }
            if kind == 0x4E4F534A { guard json_start < 0 else { return 0, false; } json_start = cursor; json_size = size; }
            cursor += size;
        }
        guard cursor == bytes.len && json_start >= 0 else { return 0, false; }
    }
    var doc: json::Node[>..] = [];
    var decoded: u8[>..] = [];
    let root, parse_error = json::parse(bytes[json_start..json_start + json_size], doc, decoded);
    guard root && parse_error.len == 0 else { return 0, false; }
    let nodes = json::member(root, "nodes");
    let instance = glb_json_element(nodes, node_index);
    let mesh_index, mesh_ok = glb_json_index(json::member(instance, "mesh"));
    guard instance && mesh_ok && mesh_index >= 0 else { return 0, false; }
    let mesh = glb_json_element(json::member(root, "meshes"), mesh_index);
    let count = glb_array_count(json::member(mesh, "primitives"));
    guard count > 0 && count <= 4096 else { return 0, false; }
    return count, true;
}

fn native_glb_mesh_slot_add(primitive_count: i64) -> NativeGlbMeshHandle {
    for i in 0..g_native_glb_meshes.len {
        if !g_native_glb_meshes[i].active && g_native_glb_meshes[i].generation < 2147483647 {
            let generation = g_native_glb_meshes[i].generation + 1;
            g_native_glb_meshes[i] = NativeGlbMeshSlot { generation: generation, primitive_count: primitive_count as i32, active: true };
            return NativeGlbMeshHandle { id: i as i32, generation: generation };
        }
    }
    g_native_glb_meshes.push(NativeGlbMeshSlot { primitive_count: primitive_count as i32, active: true, .. });
    return NativeGlbMeshHandle { id: (g_native_glb_meshes.len - 1) as i32, generation: 1 };
}

fn native_glb_mesh_valid(handle: NativeGlbMeshHandle) -> bool {
    return handle.id >= 0 && handle.id < g_native_glb_meshes.len && g_native_glb_meshes[handle.id].active &&
           g_native_glb_meshes[handle.id].generation == handle.generation;
}

// Load every static primitive of the selected node instance beneath one group
// node. The source's composed world matrix is placed on that checked root.
fn native_glb_load_node_mesh(path: const u8[:], node_index: i64) -> NativeGlbMeshHandle, bool {
    let count, count_ok = glb_node_primitive_count(path, node_index);
    guard count_ok else { return NativeGlbMeshHandle { .. }, false; }
    let handle = native_glb_mesh_slot_add(count);
    let root_id = node_asset_add(-1);
    if root_id < 0 {
        g_native_glb_meshes[handle.id].active = false;
        g_native_glb_meshes[handle.id].primitive_count = 0;
        return NativeGlbMeshHandle { .. }, false;
    }
    let root_handle = node_handle(root_id);
    g_native_glb_meshes[handle.id].root = root_handle;
    for primitive_index in 0..count {
        let model, loaded = native_glb_load_node_primitive(path, node_index, primitive_index);
        if !loaded { native_glb_mesh_dispose(handle); return NativeGlbMeshHandle { .. }, false; }
        if primitive_index == 0 {
            node(root_id).local_matrix = node(model.node.index).local_matrix;
            node(root_id).use_local_matrix = true;
        }
        node(model.node.index).parent = root_id as i32;
        node(model.node.index).local_matrix = mat4_identity();
        node(model.node.index).use_local_matrix = true;
        var slot: i64 = -1;
        for i in 0..g_native_glb_parts.len { if !g_native_glb_parts[i].active { slot = i; break; } }
        if slot < 0 {
            g_native_glb_parts.push(NativeGlbPartSlot { owner_id: handle.id, owner_generation: handle.generation, primitive_index: primitive_index as i32, model: model, active: true, .. });
        } else {
            g_native_glb_parts[slot] = NativeGlbPartSlot { owner_id: handle.id, owner_generation: handle.generation, primitive_index: primitive_index as i32, model: model, active: true, .. };
        }
    }
    return handle, true;
}

fn native_glb_mesh_primitive_count(handle: NativeGlbMeshHandle) -> i32 {
    guard native_glb_mesh_valid(handle) else { return 0; }
    return g_native_glb_meshes[handle.id].primitive_count;
}

fn native_glb_mesh_root(handle: NativeGlbMeshHandle) -> NodeHandle {
    guard native_glb_mesh_valid(handle) && node_handle_valid(g_native_glb_meshes[handle.id].root) else { return NodeHandle { .. }; }
    return g_native_glb_meshes[handle.id].root;
}

fn native_glb_mesh_primitive_node(handle: NativeGlbMeshHandle, primitive_index: i32) -> NodeHandle {
    guard native_glb_mesh_valid(handle) && primitive_index >= 0 && primitive_index < g_native_glb_meshes[handle.id].primitive_count else { return NodeHandle { .. }; }
    for i in 0..g_native_glb_parts.len {
        let part = g_native_glb_parts[i];
        if part.active && part.owner_id == handle.id && part.owner_generation == handle.generation && part.primitive_index == primitive_index {
            if node_handle_valid(part.model.node) { return part.model.node; }
            return NodeHandle { .. };
        }
    }
    return NodeHandle { .. };
}

// Return the checked imported material for one primitive. This lets native
// callers add or replace texture handles after decoding images themselves.
fn native_glb_mesh_primitive_material(handle: NativeGlbMeshHandle, primitive_index: i32) -> MaterialHandle {
    guard native_glb_mesh_valid(handle) && primitive_index >= 0 && primitive_index < g_native_glb_meshes[handle.id].primitive_count else { return MaterialHandle { .. }; }
    for i in 0..g_native_glb_parts.len {
        let part = g_native_glb_parts[i];
        if part.active && part.owner_id == handle.id && part.owner_generation == handle.generation && part.primitive_index == primitive_index {
            if material_handle_valid(part.model.material) { return part.model.material; }
            return MaterialHandle { .. };
        }
    }
    return MaterialHandle { .. };
}

// Release the one imported node, material, and mesh. Mesh and material storage
// is released even if a scene reset has already invalidated the node handle.
fn native_glb_dispose(model: NativeGlbModel&) -> bool {
    if node_handle_valid(model.node) { node_asset_release_handle(model.node); }
    if material_handle_valid(model.material) { material_asset_release(model.material); }
    glb_release_texture_set(model.textures);
    let released = mesh_asset_release_handle(model.mesh);
    if model.morph_target_count > 0 || model.skin_joint_count > 0 {
        for i in 0..model.morph_vertex_count { g_native_glb_base_vertices[model.morph_vertex_start + i].active = false; }
    }
    if model.morph_target_count > 0 {
        for i in 0..model.morph_vertex_count * model.morph_target_count { g_native_glb_morph_deltas[model.morph_delta_start + i].active = false; }
        for i in 0..model.morph_target_count { g_native_glb_morph_weights[model.morph_weight_start + i].active = false; }
    }
    if model.skin_joint_count > 0 {
        for i in 0..model.morph_vertex_count * 4 { g_native_glb_skin_influences[model.skin_influence_start + i].active = false; }
        for i in 0..model.skin_joint_count { g_native_glb_skin_joints[model.skin_joint_start + i].active = false; }
    }
    model.node = NodeHandle { .. };
    model.mesh = MeshHandle { .. };
    model.material = MaterialHandle { .. };
    model.texture = TextureHandle { .. };
    model.textures = GlbTextureSet { .. };
    model.morph_vertex_start = -1; model.morph_vertex_count = 0;
    model.morph_delta_start = -1; model.morph_target_count = 0; model.morph_weight_start = -1;
    model.skin_influence_start = -1; model.skin_joint_start = -1; model.skin_joint_count = 0; model.skin_node_index = -1;
    return released;
}

// Release every primitive created by native_glb_load_node_mesh. The registry
// reuses released slots so repeated model loads do not grow without bound.
fn native_glb_mesh_dispose(handle: NativeGlbMeshHandle) -> bool {
    guard native_glb_mesh_valid(handle) else { return false; }
    for i in 0..g_native_glb_parts.len {
        if g_native_glb_parts[i].active && g_native_glb_parts[i].owner_id == handle.id &&
           g_native_glb_parts[i].owner_generation == handle.generation {
            native_glb_dispose(g_native_glb_parts[i].model);
            g_native_glb_parts[i].active = false;
        }
    }
    if node_handle_valid(g_native_glb_meshes[handle.id].root) {
        node_asset_release_handle(g_native_glb_meshes[handle.id].root);
    }
    g_native_glb_meshes[handle.id].active = false;
    g_native_glb_meshes[handle.id].primitive_count = 0;
    g_native_glb_meshes[handle.id].root = NodeHandle { .. };
    return true;
}

fn native_glb_scene_slot_add() -> NativeGlbSceneHandle {
    for i in 0..g_native_glb_scenes.len {
        if !g_native_glb_scenes[i].active && g_native_glb_scenes[i].generation < 2147483647 {
            let generation = g_native_glb_scenes[i].generation + 1;
            g_native_glb_scenes[i] = NativeGlbSceneSlot { generation: generation, active: true, .. };
            return NativeGlbSceneHandle { id: i as i32, generation: generation };
        }
    }
    g_native_glb_scenes.push(NativeGlbSceneSlot { active: true, .. });
    return NativeGlbSceneHandle { id: (g_native_glb_scenes.len - 1) as i32, generation: 1 };
}

fn native_glb_scene_valid(handle: NativeGlbSceneHandle) -> bool {
    return handle.id >= 0 && handle.id < g_native_glb_scenes.len && g_native_glb_scenes[handle.id].active &&
           g_native_glb_scenes[handle.id].generation == handle.generation;
}

// Resolve the data buffers needed to validate and copy native animation keys.
fn glb_scene_prepare_buffers(path: const u8[:], is_glb: bool, root: json::Node?, bytes: u8[>..]&, bin_start: i64, bin_size: i64, bases: i64[>..]&, sizes: i64[>..]&) -> bool {
    let buffers = json::member(root, "buffers");
    let count = glb_array_count(buffers);
    guard count <= 16 else { return false; }
    if is_glb { guard count == 1 && bin_start >= 0 else { return false; } }
    for buffer_index in 0..count {
        let buffer = glb_json_element(buffers, buffer_index);
        let length, length_ok = glb_json_index(json::member(buffer, "byteLength"));
        guard buffer && length_ok && length > 0 && length <= 268435456 &&
              (is_glb || bytes.len + length <= 268435456) else { return false; }
        if is_glb {
            guard buffer_index == 0 && !json::member(buffer, "uri") && length <= bin_size && bin_size - length <= 3 else { return false; }
            bases.push(bin_start); sizes.push(length);
        } else {
            let uri, uri_ok = json::as_string(json::member(buffer, "uri"));
            guard uri_ok && uri.len > 0 else { return false; }
            var external: u8[>..] = [];
            if uri.len >= 5 && uri[0] == 100 && uri[1] == 97 && uri[2] == 116 && uri[3] == 97 && uri[4] == 58 {
                guard uri.len <= 268435456 && glb_decode_data_uri(uri, external) && external.len == length else { return false; }
            } else {
                guard uri.len < 4096 else { return false; }
                var segment_start: i64 = 0;
                for i in 0..uri.len {
                    let c = uri[i];
                    guard c != 0 && c != 92 && c != 58 && c != 63 && c != 35 && c != 37 else { return false; }
                    if c == 47 {
                        guard i > segment_start && !(i - segment_start == 1 && uri[segment_start] == 46) && !(i - segment_start == 2 && uri[segment_start] == 46 && uri[segment_start + 1] == 46) else { return false; }
                        segment_start = i + 1;
                    }
                }
                guard segment_start < uri.len && !(uri.len - segment_start == 1 && uri[segment_start] == 46) && !(uri.len - segment_start == 2 && uri[segment_start] == 46 && uri[segment_start + 1] == 46) && uri[0] != 47 else { return false; }
                var external_path: u8[>..] = [];
                var directory_end: i64 = 0;
                for i in 0..path.len { if path[i] == 47 { directory_end = i + 1; } }
                guard directory_end + uri.len < 4096 else { return false; }
                for i in 0..directory_end { external_path.push(path[i]); }
                for i in 0..uri.len { external_path.push(uri[i]); }
                guard read_file(external_path[..], external) && external.len == length else { return false; }
            }
            bases.push(bytes.len); sizes.push(length);
            for i in 0..length { bytes.push(external[i]); }
        }
    }
    return true;
}

fn glb_animation_key_reserve(count: i64) -> i64 {
    guard count > 0 && count <= 1048576 && g_native_glb_animation_keys.len + count <= 2147483647 else { return -1; }
    if count <= g_native_glb_animation_keys.len {
        for start in 0..g_native_glb_animation_keys.len - count + 1 {
            var free = true;
            for offset in 0..count { if g_native_glb_animation_keys[start + offset].active { free = false; break; } }
            if free { return start; }
        }
    }
    let start = g_native_glb_animation_keys.len;
    for _ in 0..count { g_native_glb_animation_keys.push(NativeGlbAnimationKey { .. }); }
    return start;
}

fn glb_base_vertex_reserve(count: i64) -> i64 {
    guard count > 0 && g_native_glb_base_vertices.len + count <= 2147483647 else { return -1; }
    if count <= g_native_glb_base_vertices.len {
        for start in 0..g_native_glb_base_vertices.len - count + 1 {
            var free = true;
            for offset in 0..count { if g_native_glb_base_vertices[start + offset].active { free = false; break; } }
            if free { return start; }
        }
    }
    let start = g_native_glb_base_vertices.len;
    for _ in 0..count { g_native_glb_base_vertices.push(NativeGlbBaseVertex { .. }); }
    return start;
}

fn glb_morph_delta_reserve(count: i64) -> i64 {
    guard count > 0 && count <= 4194304 && g_native_glb_morph_deltas.len + count <= 2147483647 else { return -1; }
    if count <= g_native_glb_morph_deltas.len {
        for start in 0..g_native_glb_morph_deltas.len - count + 1 {
            var free = true;
            for offset in 0..count { if g_native_glb_morph_deltas[start + offset].active { free = false; break; } }
            if free { return start; }
        }
    }
    let start = g_native_glb_morph_deltas.len;
    for _ in 0..count { g_native_glb_morph_deltas.push(NativeGlbMorphDelta { .. }); }
    return start;
}

fn glb_morph_weight_reserve(count: i64) -> i64 {
    guard count > 0 && g_native_glb_morph_weights.len + count <= 2147483647 else { return -1; }
    if count <= g_native_glb_morph_weights.len {
        for start in 0..g_native_glb_morph_weights.len - count + 1 {
            var free = true;
            for offset in 0..count { if g_native_glb_morph_weights[start + offset].active { free = false; break; } }
            if free { return start; }
        }
    }
    let start = g_native_glb_morph_weights.len;
    for _ in 0..count { g_native_glb_morph_weights.push(NativeGlbMorphWeight { .. }); }
    return start;
}

fn glb_animation_weight_reserve(count: i64) -> i64 {
    guard count > 0 && count <= 16777216 && g_native_glb_animation_weight_values.len + count <= 2147483647 else { return -1; }
    if count <= g_native_glb_animation_weight_values.len {
        for start in 0..g_native_glb_animation_weight_values.len - count + 1 {
            var free = true;
            for offset in 0..count { if g_native_glb_animation_weight_values[start + offset].active { free = false; break; } }
            if free { return start; }
        }
    }
    let start = g_native_glb_animation_weight_values.len;
    for _ in 0..count { g_native_glb_animation_weight_values.push(NativeGlbAnimationWeightValue { .. }); }
    return start;
}

fn glb_skin_influence_reserve(count: i64) -> i64 {
    guard count > 0 && count <= 4194304 && g_native_glb_skin_influences.len + count <= 2147483647 else { return -1; }
    if count <= g_native_glb_skin_influences.len {
        for start in 0..g_native_glb_skin_influences.len - count + 1 {
            var free = true;
            for offset in 0..count { if g_native_glb_skin_influences[start + offset].active { free = false; break; } }
            if free { return start; }
        }
    }
    let start = g_native_glb_skin_influences.len;
    for _ in 0..count { g_native_glb_skin_influences.push(NativeGlbSkinInfluence { .. }); }
    return start;
}

fn glb_skin_joint_reserve(count: i64) -> i64 {
    guard count > 0 && count <= 65536 && g_native_glb_skin_joints.len + count <= 2147483647 else { return -1; }
    if count <= g_native_glb_skin_joints.len {
        for start in 0..g_native_glb_skin_joints.len - count + 1 {
            var free = true;
            for offset in 0..count { if g_native_glb_skin_joints[start + offset].active { free = false; break; } }
            if free { return start; }
        }
    }
    let start = g_native_glb_skin_joints.len;
    for _ in 0..count { g_native_glb_skin_joints.push(NativeGlbSkinJoint { .. }); }
    return start;
}

fn glb_animation_track_add(track: NativeGlbAnimationTrack) -> i64 {
    for i in 0..g_native_glb_animation_tracks.len {
        if !g_native_glb_animation_tracks[i].active { g_native_glb_animation_tracks[i] = track; return i; }
    }
    g_native_glb_animation_tracks.push(track);
    return g_native_glb_animation_tracks.len - 1;
}

fn glb_animation_values(bytes: const u8[:], accessor: GlbAttribute, index: i64, components: i64) -> float4, bool {
    var out = float4_0;
    for component in 0..components {
        let value, ok = glb_attribute_value(bytes, 0, accessor, index, component);
        guard ok && abs(value) <= 3.4e38 else { return float4_0, false; }
        if component == 0 { out.x = value; }
        else if component == 1 { out.y = value; }
        else if component == 2 { out.z = value; }
        else { out.w = value; }
    }
    return out, true;
}

fn glb_scene_load_animations(root: json::Node?, bytes: const u8[:], buffer_bases: const i64[:], buffer_sizes: const i64[:], handle: NativeGlbSceneHandle) -> bool {
    let animations = json::member(root, "animations");
    let count = glb_array_count(animations);
    guard count <= 1024 else { return false; }
    g_native_glb_scenes[handle.id].animation_count = count as i32;
    for animation_index in 0..count {
        let animation = glb_json_element(animations, animation_index);
        let samplers = json::member(animation, "samplers");
        let channels = json::member(animation, "channels");
        guard animation && glb_array_count(channels) <= 16384 else { return false; }
        for channel_index in 0..glb_array_count(channels) {
            let channel = glb_json_element(channels, channel_index);
            let target = json::member(channel, "target");
            let node_index, node_ok = glb_json_index(json::member(target, "node"));
            let path, path_ok = json::as_string(json::member(target, "path"));
            guard channel && target && node_ok && path_ok && node_index >= 0 && node_index < glb_array_count(json::member(root, "nodes")) else { return false; }
            var path_id: i32 = -1; var component_count: i64 = 0; var type_name: const u8[:] = "";
            if path == "translation" { path_id = 0; component_count = 3; type_name = "VEC3"; }
            else if path == "rotation" { path_id = 1; component_count = 4; type_name = "VEC4"; }
            else if path == "scale" { path_id = 2; component_count = 3; type_name = "VEC3"; }
            else if path == "weights" { path_id = 3; }
            else { return false; }
            var target_node_slot: i64 = -1;
            for i in 0..g_native_glb_scene_nodes.len {
                let slot = g_native_glb_scene_nodes[i];
                if slot.active && slot.scene_id == handle.id && slot.scene_generation == handle.generation && slot.gltf_index == node_index {
                    target_node_slot = i; break;
                }
            }
            if target_node_slot < 0 { continue; }
            if path_id != 3 { guard g_native_glb_scene_nodes[target_node_slot].has_trs else { return false; } }
            let sampler_index, sampler_ok = glb_json_index(json::member(channel, "sampler"));
            let sampler = glb_json_element(samplers, sampler_index);
            let input_index, input_ok = glb_json_index(json::member(sampler, "input"));
            let output_index, output_ok = glb_json_index(json::member(sampler, "output"));
            let interpolation_node = json::member(sampler, "interpolation");
            var interpolation: i32 = 0;
            if interpolation_node {
                let mode, mode_ok = json::as_string(interpolation_node);
                guard mode_ok else { return false; }
                if mode == "STEP" { interpolation = 1; }
                else if mode == "CUBICSPLINE" { interpolation = 2; }
                else { guard mode == "LINEAR" else { return false; } }
            }
            guard sampler_ok && sampler && input_ok && output_ok else { return false; }
            let input, input_valid = glb_attribute_accessor(root, bytes, buffer_bases, buffer_sizes, input_index, "ANIMATION", "SCALAR", 1);
            guard input_valid && input.count <= 1048576 else { return false; }
            if path_id == 3 {
                for i in 0..g_native_glb_animation_tracks.len {
                    let prior = g_native_glb_animation_tracks[i];
                    guard !prior.active || prior.scene_id != handle.id || prior.scene_generation != handle.generation ||
                          prior.animation_index != animation_index || prior.gltf_node_index != node_index || prior.path != path_id else { return false; }
                }
                var previous_time: f32 = -1.0;
                for key_index in 0..input.count {
                    let time, time_ok = glb_attribute_value(bytes, 0, input, key_index, 0);
                    guard time_ok && time >= 0.0 && time <= 3.4e38 && time > previous_time else { return false; }
                    previous_time = time;
                }
                var target_count: i64 = -1;
                for scene_part_index in 0..g_native_glb_scene_parts.len {
                    let scene_part = g_native_glb_scene_parts[scene_part_index];
                    if scene_part.active && scene_part.scene_id == handle.id && scene_part.scene_generation == handle.generation && scene_part.gltf_node_index == node_index {
                        for part_index in 0..g_native_glb_parts.len {
                            let part = g_native_glb_parts[part_index];
                            if part.active && part.owner_id == scene_part.mesh.id && part.owner_generation == scene_part.mesh.generation {
                                let part_targets = part.model.morph_target_count;
                                guard part_targets > 0 && (target_count < 0 || target_count == part_targets) else { return false; }
                                target_count = part_targets;
                            }
                        }
                    }
                }
                guard target_count > 0 && target_count <= 65536 else { return false; }
                let output, output_valid = glb_attribute_accessor(root, bytes, buffer_bases, buffer_sizes, output_index, "ANIMATION", "SCALAR", 1);
                let multiplier: i64 = if interpolation == 2 { 3 } else { 1 };
                let value_count = input.count * target_count * multiplier;
                guard output_valid && output.count == value_count && value_count <= 16777216 else { return false; }
                let key_start = glb_animation_key_reserve(input.count);
                let weight_start = glb_animation_weight_reserve(value_count);
                if key_start < 0 || weight_start < 0 {
                    if key_start >= 0 { for key_index in 0..input.count { g_native_glb_animation_keys[key_start + key_index].active = false; } }
                    if weight_start >= 0 { for value_index in 0..value_count { g_native_glb_animation_weight_values[weight_start + value_index].active = false; } }
                    return false;
                }
                let track = NativeGlbAnimationTrack { scene_id: handle.id, scene_generation: handle.generation,
                    animation_index: animation_index as i32, gltf_node_index: node_index as i32,
                    node_slot_index: target_node_slot as i32, path: path_id, interpolation: interpolation, key_start: key_start as i32,
                    key_count: input.count as i32, duration: previous_time,
                    weight_start: weight_start as i32, weight_value_count: value_count as i32, weight_target_count: target_count as i32, active: true };
                glb_animation_track_add(track);
                g_native_glb_scene_nodes[target_node_slot].animated = true;
                for key_index in 0..input.count {
                    let time, time_ok = glb_attribute_value(bytes, 0, input, key_index, 0);
                    guard time_ok else { return false; }
                    g_native_glb_animation_keys[key_start + key_index] = NativeGlbAnimationKey { time: time, active: true, .. };
                }
                for value_index in 0..value_count {
                    let value, value_ok = glb_attribute_value(bytes, 0, output, value_index, 0);
                    guard value_ok && abs(value) <= 3.4e38 else { return false; }
                    g_native_glb_animation_weight_values[weight_start + value_index] = NativeGlbAnimationWeightValue { value: value, active: true };
                }
                continue;
            }
            let output, output_valid = glb_attribute_accessor(root, bytes, buffer_bases, buffer_sizes, output_index, "ANIMATION", type_name, component_count);
            guard output_valid && output.count == input.count * (if interpolation == 2 { 3 } else { 1 }) else { return false; }
            for i in 0..g_native_glb_animation_tracks.len {
                let prior = g_native_glb_animation_tracks[i];
                guard !prior.active || prior.scene_id != handle.id || prior.scene_generation != handle.generation ||
                      prior.animation_index != animation_index || prior.gltf_node_index != node_index || prior.path != path_id else { return false; }
            }
            let key_start = glb_animation_key_reserve(input.count);
            guard key_start >= 0 else { return false; }
            let track = NativeGlbAnimationTrack { scene_id: handle.id, scene_generation: handle.generation,
                animation_index: animation_index as i32, gltf_node_index: node_index as i32, node_slot_index: target_node_slot as i32, path: path_id,
                interpolation: interpolation, key_start: key_start as i32, key_count: input.count as i32, duration: 0.0,
                weight_start: -1, weight_value_count: 0, weight_target_count: 0, active: true };
            let track_slot = glb_animation_track_add(track);
            g_native_glb_scene_nodes[target_node_slot].animated = true;
            var previous_time: f32 = -1.0;
            for key_index in 0..input.count {
                let time, time_ok = glb_attribute_value(bytes, 0, input, key_index, 0);
                guard time_ok && time >= 0.0 && time <= 3.4e38 && time > previous_time else { return false; }
                previous_time = time;
                var incoming = float4_0; var outgoing = float4_0;
                var value_index = key_index;
                if interpolation == 2 {
                    value_index = key_index * 3 + 1;
                    let incoming_value, incoming_ok = glb_animation_values(bytes, output, key_index * 3, component_count);
                    let outgoing_value, outgoing_ok = glb_animation_values(bytes, output, key_index * 3 + 2, component_count);
                    guard incoming_ok && outgoing_ok else { return false; }
                    incoming = incoming_value; outgoing = outgoing_value;
                }
                var value, value_ok = glb_animation_values(bytes, output, value_index, component_count);
                guard value_ok else { return false; }
                if path_id == 1 { let normalized_value, normalized_ok = glb_quaternion_normalize(value); guard normalized_ok else { return false; } value = normalized_value; }
                g_native_glb_animation_keys[key_start + key_index] = NativeGlbAnimationKey { time: time, incoming: incoming, value: value, outgoing: outgoing, active: true };
            }
            g_native_glb_animation_tracks[track_slot].duration = previous_time;
        }
    }
    return true;
}

// Load the selected hierarchy, mesh instances, cameras, punctual lights, and
// core TRS and morph-weight animation tracks. Skinning is not imported.
fn native_glb_load_scene(path: const u8[:], requested_scene_index: i64) -> NativeGlbSceneHandle, bool {
    var bytes: u8[>..] = [];
    guard path.len > 0 && read_file(path, bytes) && bytes.len > 0 && bytes.len <= 268435456 else { return NativeGlbSceneHandle { .. }, false; }
    var json_start: i64 = 0; var json_size: i64 = bytes.len;
    var bin_start: i64 = -1; var bin_size: i64 = 0;
    let is_glb = bytes.len >= 12 && glb_u32(bytes[..], 0) == 0x46546C67;
    if is_glb {
        guard bytes.len >= 20 && glb_u32(bytes[..], 4) == 2 && glb_u32(bytes[..], 8) == bytes.len else { return NativeGlbSceneHandle { .. }, false; }
        json_start = -1; json_size = 0;
        var cursor: i64 = 12;
        while cursor + 8 <= bytes.len {
            let size = glb_u32(bytes[..], cursor);
            let kind = glb_u32(bytes[..], cursor + 4);
            cursor += 8;
            guard size >= 0 && size % 4 == 0 && cursor + size <= bytes.len else { return NativeGlbSceneHandle { .. }, false; }
            if kind == 0x4E4F534A { guard json_start < 0 else { return NativeGlbSceneHandle { .. }, false; } json_start = cursor; json_size = size; }
            else if kind == 0x004E4942 { guard bin_start < 0 else { return NativeGlbSceneHandle { .. }, false; } bin_start = cursor; bin_size = size; }
            cursor += size;
        }
        guard cursor == bytes.len && json_start >= 0 else { return NativeGlbSceneHandle { .. }, false; }
    }
    var doc: json::Node[>..] = [];
    var decoded: u8[>..] = [];
    let root, parse_error = json::parse(bytes[json_start..json_start + json_size], doc, decoded);
    guard root && parse_error.len == 0 else { return NativeGlbSceneHandle { .. }, false; }
    var animation_buffer_bases: i64[>..] = [];
    var animation_buffer_sizes: i64[>..] = [];
    if glb_array_count(json::member(root, "animations")) > 0 {
        guard glb_scene_prepare_buffers(path, is_glb, root, bytes, bin_start, bin_size, animation_buffer_bases, animation_buffer_sizes) else { return NativeGlbSceneHandle { .. }, false; }
    }
    let version, version_ok = json::as_string(json::member(json::member(root, "asset"), "version"));
    let nodes = json::member(root, "nodes");
    let node_count = glb_array_count(nodes);
    guard version_ok && version == "2.0" && node_count <= 4096 else { return NativeGlbSceneHandle { .. }, false; }
    var parent_counts: i64[>..] = [];
    var parent_indices: i64[>..] = [];
    var selected: bool[>..] = [];
    for _ in 0..node_count { parent_counts.push(0); parent_indices.push(-1); selected.push(false); }
    for i in 0..node_count {
        let children = json::member(glb_json_element(nodes, i), "children");
        for j in 0..glb_array_count(children) {
            let child, child_ok = glb_json_index(glb_json_element(children, j));
            guard child_ok && child >= 0 && child < node_count else { return NativeGlbSceneHandle { .. }, false; }
            parent_counts[child] += 1;
            guard parent_counts[child] == 1 else { return NativeGlbSceneHandle { .. }, false; }
            parent_indices[child] = i;
        }
    }
    let scenes = json::member(root, "scenes");
    let scene_count = glb_array_count(scenes);
    var pending: i64[>..] = [];
    if scene_count > 0 {
        var scene_index = requested_scene_index;
        if scene_index < 0 { let default_index, default_ok = glb_optional_index(json::member(root, "scene"), 0); guard default_ok else { return NativeGlbSceneHandle { .. }, false; } scene_index = default_index; }
        let scene = glb_json_element(scenes, scene_index);
        guard scene && scene_index >= 0 && scene_index < scene_count else { return NativeGlbSceneHandle { .. }, false; }
        let roots = json::member(scene, "nodes");
        for i in 0..glb_array_count(roots) {
            let node_index, node_ok = glb_json_index(glb_json_element(roots, i));
            guard node_ok && node_index >= 0 && node_index < node_count && !selected[node_index] else { return NativeGlbSceneHandle { .. }, false; }
            selected[node_index] = true;
            pending.push(node_index);
        }
    } else {
        guard requested_scene_index < 0 else { return NativeGlbSceneHandle { .. }, false; }
        for i in 0..node_count {
            if parent_counts[i] == 0 { selected[i] = true; pending.push(i); }
        }
    }
    var cursor: i64 = 0;
    while cursor < pending.len {
        let node_index = pending[cursor];
        cursor += 1;
        let children = json::member(glb_json_element(nodes, node_index), "children");
        for j in 0..glb_array_count(children) {
            let child, child_ok = glb_json_index(glb_json_element(children, j));
            guard child_ok && child >= 0 && child < node_count && !selected[child] else { return NativeGlbSceneHandle { .. }, false; }
            selected[child] = true;
            pending.push(child);
        }
    }
    let handle = native_glb_scene_slot_add();
    let root_id = node_asset_add(-1);
    if root_id < 0 {
        g_native_glb_scenes[handle.id].active = false;
        return NativeGlbSceneHandle { .. }, false;
    }
    g_native_glb_scenes[handle.id].root = node_handle(root_id);
    g_native_glb_scenes[handle.id].previous_camera_id = camera_active();
    g_native_glb_scenes[handle.id].previous_camera = camera();
    var node_ids: i64[>..] = [];
    for _ in 0..node_count { node_ids.push(-1); }
    for i in 0..node_count {
        if selected[i] {
            let source_node = glb_json_element(nodes, i);
            let local, local_ok = glb_matrix(source_node);
            if !local_ok { native_glb_scene_dispose(handle); return NativeGlbSceneHandle { .. }, false; }
            var base_translation = float3_0; var base_rotation = float4 { 0.0, 0.0, 0.0, 1.0 }; var base_scale = float3_1;
            let has_trs = !json::member(source_node, "matrix");
            if has_trs {
                let translation, rotation, scale, trs_ok = glb_node_trs(source_node);
                if !trs_ok { native_glb_scene_dispose(handle); return NativeGlbSceneHandle { .. }, false; }
                base_translation = translation; base_rotation = rotation; base_scale = scale;
            }
            let output_id = node_asset_add(-1);
            if output_id < 0 { native_glb_scene_dispose(handle); return NativeGlbSceneHandle { .. }, false; }
            node_ids[i] = output_id;
            node(output_id).local_matrix = local;
            node(output_id).use_local_matrix = true;
            let node_handle_value = node_handle(output_id);
            var node_slot: i64 = -1;
            for part_index in 0..g_native_glb_scene_nodes.len {
                if !g_native_glb_scene_nodes[part_index].active { node_slot = part_index; break; }
            }
            let node_part = NativeGlbSceneNodeSlot { scene_id: handle.id, scene_generation: handle.generation, gltf_index: i as i32,
                node: node_handle_value, translation: base_translation, rotation: base_rotation, scale: base_scale,
                base_translation: base_translation, base_rotation: base_rotation, base_scale: base_scale, has_trs: has_trs, animated: false, active: true };
            if node_slot < 0 { g_native_glb_scene_nodes.push(node_part); } else { g_native_glb_scene_nodes[node_slot] = node_part; }
            g_native_glb_scenes[handle.id].node_count += 1;
        }
    }
    for i in 0..node_count {
        if selected[i] {
            let parent_index = parent_indices[i];
            node(node_ids[i]).parent = if parent_index < 0 { root_id as i32 } else { node_ids[parent_index] as i32 };
        }
    }
    for i in 0..node_count {
        if selected[i] && json::member(glb_json_element(nodes, i), "mesh") {
            let mesh, loaded = native_glb_load_node_mesh(path, i);
            if !loaded { native_glb_scene_dispose(handle); return NativeGlbSceneHandle { .. }, false; }
            let mesh_root = native_glb_mesh_root(mesh);
            if !node_handle_valid(mesh_root) { native_glb_mesh_dispose(mesh); native_glb_scene_dispose(handle); return NativeGlbSceneHandle { .. }, false; }
            node(mesh_root.index).parent = node_ids[i] as i32;
            node(mesh_root.index).local_matrix = mat4_identity();
            node(mesh_root.index).use_local_matrix = true;
            let mesh_index = g_native_glb_scenes[handle.id].mesh_count;
            var slot: i64 = -1;
            for part_index in 0..g_native_glb_scene_parts.len {
                if !g_native_glb_scene_parts[part_index].active { slot = part_index; break; }
            }
            let part = NativeGlbScenePartSlot { scene_id: handle.id, scene_generation: handle.generation, gltf_node_index: i as i32, mesh_index: mesh_index, mesh: mesh, active: true };
            if slot < 0 { g_native_glb_scene_parts.push(part); } else { g_native_glb_scene_parts[slot] = part; }
            g_native_glb_scenes[handle.id].mesh_count += 1;
        }
    }
    for i in 0..node_count {
        if selected[i] && json::member(glb_json_element(nodes, i), "camera") {
            let camera, camera_ok = glb_node_camera(root, i);
            if !camera_ok { native_glb_scene_dispose(handle); return NativeGlbSceneHandle { .. }, false; }
            let camera_id = camera_add_detached(camera);
            let camera_index = g_native_glb_scenes[handle.id].camera_count;
            var slot: i64 = -1;
            for camera_slot in 0..g_native_glb_scene_cameras.len {
                if !g_native_glb_scene_cameras[camera_slot].active { slot = camera_slot; break; }
            }
            let camera_part = NativeGlbSceneCameraSlot { scene_id: handle.id, scene_generation: handle.generation, camera_index: camera_index, camera_id: camera_id, active: true };
            if slot < 0 { g_native_glb_scene_cameras.push(camera_part); } else { g_native_glb_scene_cameras[slot] = camera_part; }
            g_native_glb_scenes[handle.id].camera_count += 1;
        }
    }
    for i in 0..node_count {
        if selected[i] && json::member(json::member(glb_json_element(nodes, i), "extensions"), "KHR_lights_punctual") {
            let light, light_ok = glb_node_light(root, i);
            if !light_ok { native_glb_scene_dispose(handle); return NativeGlbSceneHandle { .. }, false; }
            if g_native_glb_scenes[handle.id].light_set_id < 0 {
                g_native_glb_scenes[handle.id].light_set_id = asset_light_set_begin();
            }
            var added = false;
            if light.kind == 0 { added = add_directional_light(light.direction, light.color); }
            else if light.kind == 1 { added = add_point_light_physical(light.position, light.color, light.range); }
            else if light.kind == 2 { added = add_spot_light_physical(light.position, light.direction, light.color, light.range, light.inner, light.outer); }
            if !added { native_glb_scene_dispose(handle); return NativeGlbSceneHandle { .. }, false; }
        }
    }
    if glb_array_count(json::member(root, "animations")) > 0 &&
       !glb_scene_load_animations(root, bytes[..], animation_buffer_bases[..], animation_buffer_sizes[..], handle) {
        native_glb_scene_dispose(handle);
        return NativeGlbSceneHandle { .. }, false;
    }
    node_update_worlds();
    if !glb_scene_rebuild_skins(handle) {
        native_glb_scene_dispose(handle);
        return NativeGlbSceneHandle { .. }, false;
    }
    return handle, true;
}

fn glb_quaternion_normalize(value: float4) -> float4, bool {
    let length = sqrt(value.x*value.x + value.y*value.y + value.z*value.z + value.w*value.w);
    guard length > 1e-12 && length <= 3.4e38 else { return float4 { 0.0, 0.0, 0.0, 1.0 }, false; }
    return float4 { value.x/length, value.y/length, value.z/length, value.w/length }, true;
}

fn glb_quaternion_slerp(a: float4, b_value: float4, amount: f32) -> float4, bool {
    var b = b_value;
    var dot = a.x*b.x + a.y*b.y + a.z*b.z + a.w*b.w;
    if dot < 0.0 { b = float4 { -b.x, -b.y, -b.z, -b.w }; dot = -dot; }
    if dot > 0.9995 {
        return glb_quaternion_normalize(float4 { a.x + (b.x-a.x)*amount, a.y + (b.y-a.y)*amount,
            a.z + (b.z-a.z)*amount, a.w + (b.w-a.w)*amount });
    }
    let theta = acos(clamp(dot, -1.0, 1.0));
    let sin_theta = sin(theta);
    guard abs(sin_theta) > 1e-12 else { return a, true; }
    let wa = sin((1.0-amount)*theta) / sin_theta;
    let wb = sin(amount*theta) / sin_theta;
    return glb_quaternion_normalize(float4 { a.x*wa+b.x*wb, a.y*wa+b.y*wb, a.z*wa+b.z*wb, a.w*wa+b.w*wb });
}

fn glb_animation_sample(track: NativeGlbAnimationTrack, time: f32) -> float4, bool {
    guard track.key_count > 0 && track.key_start >= 0 && track.key_start + track.key_count <= g_native_glb_animation_keys.len else { return float4_0, false; }
    let first = g_native_glb_animation_keys[track.key_start];
    let last = g_native_glb_animation_keys[track.key_start + track.key_count - 1];
    if time <= first.time { if track.path == 1 { return glb_quaternion_normalize(first.value); } return first.value, true; }
    if time >= last.time { if track.path == 1 { return glb_quaternion_normalize(last.value); } return last.value, true; }
    var left: i64 = 0;
    while left + 1 < track.key_count && g_native_glb_animation_keys[track.key_start + left + 1].time <= time { left++; }
    let a = g_native_glb_animation_keys[track.key_start + left];
    let b = g_native_glb_animation_keys[track.key_start + left + 1];
    if track.interpolation == 1 { if track.path == 1 { return glb_quaternion_normalize(a.value); } return a.value, true; }
    let duration = b.time - a.time;
    guard duration > 0.0 else { return float4_0, false; }
    let amount = (time - a.time) / duration;
    if track.interpolation == 0 {
        if track.path == 1 { return glb_quaternion_slerp(a.value, b.value, amount); }
        return float4 { a.value.x + (b.value.x-a.value.x)*amount, a.value.y + (b.value.y-a.value.y)*amount,
            a.value.z + (b.value.z-a.value.z)*amount, a.value.w + (b.value.w-a.value.w)*amount }, true;
    }
    let t2 = amount * amount; let t3 = t2 * amount;
    let h00 = 2.0*t3 - 3.0*t2 + 1.0; let h10 = t3 - 2.0*t2 + amount;
    let h01 = -2.0*t3 + 3.0*t2; let h11 = t3 - t2;
    let result = float4 {
        h00*a.value.x + h10*duration*a.outgoing.x + h01*b.value.x + h11*duration*b.incoming.x,
        h00*a.value.y + h10*duration*a.outgoing.y + h01*b.value.y + h11*duration*b.incoming.y,
        h00*a.value.z + h10*duration*a.outgoing.z + h01*b.value.z + h11*duration*b.incoming.z,
        h00*a.value.w + h10*duration*a.outgoing.w + h01*b.value.w + h11*duration*b.incoming.w
    };
    if track.path == 1 { return glb_quaternion_normalize(result); }
    return result, true;
}

fn glb_animation_weight_value(track: NativeGlbAnimationTrack, key: i64, part: i64, target: i64, multiplier: i64) -> f32, bool {
    let index = track.weight_start + key * track.weight_target_count * multiplier + part * track.weight_target_count + target;
    guard index >= track.weight_start && index < track.weight_start + track.weight_value_count && index < g_native_glb_animation_weight_values.len else { return 0.0, false; }
    return g_native_glb_animation_weight_values[index].value, true;
}

fn glb_animation_sample_weight(track: NativeGlbAnimationTrack, time: f32, target: i64) -> f32, bool {
    guard track.path == 3 && track.key_count > 0 && target >= 0 && target < track.weight_target_count &&
          track.key_start >= 0 && track.key_start + track.key_count <= g_native_glb_animation_keys.len &&
          track.weight_start >= 0 && track.weight_start + track.weight_value_count <= g_native_glb_animation_weight_values.len else { return 0.0, false; }
    let first = g_native_glb_animation_keys[track.key_start];
    let last = g_native_glb_animation_keys[track.key_start + track.key_count - 1];
    var left: i64 = 0;
    var amount: f32 = 0.0;
    if time <= first.time { left = 0; }
    else if time >= last.time { left = track.key_count - 1; }
    else {
        while left + 1 < track.key_count && g_native_glb_animation_keys[track.key_start + left + 1].time <= time { left++; }
        let a = g_native_glb_animation_keys[track.key_start + left];
        let b = g_native_glb_animation_keys[track.key_start + left + 1];
        guard b.time > a.time else { return 0.0, false; }
        amount = (time - a.time) / (b.time - a.time);
    }
    let multiplier: i64 = if track.interpolation == 2 { 3 } else { 1 };
    if time <= first.time || time >= last.time || track.interpolation == 1 {
        let selected = if time >= last.time { track.key_count - 1 } else { left };
        let part = if track.interpolation == 2 { 1 } else { 0 };
        return glb_animation_weight_value(track, selected, part, target, multiplier);
    }
    let a, a_ok = glb_animation_weight_value(track, left, if track.interpolation == 2 { 1 } else { 0 }, target, multiplier);
    let b, b_ok = glb_animation_weight_value(track, left + 1, if track.interpolation == 2 { 1 } else { 0 }, target, multiplier);
    guard a_ok && b_ok else { return 0.0, false; }
    if track.interpolation == 0 { return a + (b - a) * amount, true; }
    let incoming, incoming_ok = glb_animation_weight_value(track, left + 1, 0, target, multiplier);
    let outgoing, outgoing_ok = glb_animation_weight_value(track, left, 2, target, multiplier);
    guard incoming_ok && outgoing_ok else { return 0.0, false; }
    let duration = g_native_glb_animation_keys[track.key_start + left + 1].time - g_native_glb_animation_keys[track.key_start + left].time;
    let t2 = amount * amount; let t3 = t2 * amount;
    return (2.0*t3 - 3.0*t2 + 1.0)*a + (t3 - 2.0*t2 + amount)*duration*outgoing +
           (-2.0*t3 + 3.0*t2)*b + (t3 - t2)*duration*incoming, true;
}

fn glb_morph_model_rebuild(model: NativeGlbModel&) -> bool {
    guard model.morph_target_count > 0 && model.morph_vertex_count > 0 && model.morph_vertex_start >= 0 &&
          model.morph_delta_start >= 0 && model.morph_weight_start >= 0 && mesh_handle_valid(model.mesh) else { return false; }
    var positions: f32[>..] = []; var normals: f32[>..] = []; var tangents: f32[>..] = [];
    for i in 0..model.morph_vertex_count {
        let base = g_native_glb_base_vertices[model.morph_vertex_start + i].vertex;
        var position = base.pos; var normal = base.normal; var tangent = float3 { base.tangent.x, base.tangent.y, base.tangent.z };
        for target in 0..model.morph_target_count {
            let weight = g_native_glb_morph_weights[model.morph_weight_start + target].value;
            let delta = g_native_glb_morph_deltas[model.morph_delta_start + target * model.morph_vertex_count + i];
            position += delta.position * weight; normal += delta.normal * weight; tangent += delta.tangent * weight;
        }
        if length(normal) > 1e-8 { normal = normalize(normal); }
        if length(tangent) > 1e-8 { tangent = normalize(tangent); }
        positions.push(position.x); positions.push(position.y); positions.push(position.z);
        normals.push(normal.x); normals.push(normal.y); normals.push(normal.z);
        tangents.push(tangent.x); tangents.push(tangent.y); tangents.push(tangent.z); tangents.push(base.tangent.w);
    }
    return mesh_asset_update(model.mesh.id, positions[..], normals[..], tangents[..]);
}

fn glb_scene_node_world(handle: NativeGlbSceneHandle, gltf_node_index: i32) -> Mat4, bool {
    for i in 0..g_native_glb_scene_nodes.len {
        let slot = g_native_glb_scene_nodes[i];
        if slot.active && slot.scene_id == handle.id && slot.scene_generation == handle.generation &&
           slot.gltf_index == gltf_node_index && node_handle_valid(slot.node) {
            return node(slot.node.index).world, true;
        }
    }
    return mat4_identity(), false;
}

fn glb_skin_model_rebuild(handle: NativeGlbSceneHandle, model: NativeGlbModel&) -> bool {
    guard model.skin_joint_count > 0 && model.skin_node_index >= 0 && model.skin_influence_start >= 0 &&
          model.skin_joint_start >= 0 && model.morph_vertex_start >= 0 && mesh_handle_valid(model.mesh) else { return false; }
    let mesh_world, mesh_found = glb_scene_node_world(handle, model.skin_node_index);
    guard mesh_found else { return false; }
    let inverse_mesh_world = mat4_invert(mesh_world);
    var joint_matrices: Mat4[>..] = []; var normal_matrices: Mat4[>..] = [];
    for joint_index in 0..model.skin_joint_count {
        let joint = g_native_glb_skin_joints[model.skin_joint_start + joint_index];
        let joint_world, joint_found = glb_scene_node_world(handle, joint.gltf_node_index);
        guard joint.active && joint_found else { return false; }
        let matrix = mat4_mul(mat4_mul(inverse_mesh_world, joint_world), joint.inverse_bind);
        joint_matrices.push(matrix);
        normal_matrices.push(mat4_transpose(mat4_invert(matrix)));
    }
    var positions: f32[>..] = []; var normals: f32[>..] = []; var tangents: f32[>..] = [];
    for vertex_index in 0..model.morph_vertex_count {
        let base = g_native_glb_base_vertices[model.morph_vertex_start + vertex_index].vertex;
        var source_position = base.pos; var source_normal = base.normal; var source_tangent = float3 { base.tangent.x, base.tangent.y, base.tangent.z };
        for target_index in 0..model.morph_target_count {
            let weight = g_native_glb_morph_weights[model.morph_weight_start + target_index].value;
            let delta = g_native_glb_morph_deltas[model.morph_delta_start + target_index * model.morph_vertex_count + vertex_index];
            source_position += delta.position * weight; source_normal += delta.normal * weight; source_tangent += delta.tangent * weight;
        }
        var out_position = float3_0; var out_normal = float3_0; var out_tangent = float3_0;
        var sum: f32 = 0.0;
        for influence_index in 0..4 {
            let influence = g_native_glb_skin_influences[model.skin_influence_start + vertex_index * 4 + influence_index];
            if influence.weight > 0.0 {
                guard influence.active && influence.joint_index >= 0 && influence.joint_index < model.skin_joint_count else { return false; }
                let joint_matrix = joint_matrices[influence.joint_index];
                let normal_matrix = normal_matrices[influence.joint_index];
                out_position += mat4_apply(joint_matrix, source_position) * influence.weight;
                out_normal += mat4_apply_dir(normal_matrix, source_normal) * influence.weight;
                out_tangent += mat4_apply_dir(joint_matrix, source_tangent) * influence.weight;
                sum += influence.weight;
            }
        }
        if sum <= 1e-8 { out_position = source_position; out_normal = source_normal; out_tangent = source_tangent; }
        else { out_position = out_position / sum; out_normal = out_normal / sum; out_tangent = out_tangent / sum; }
        if length(out_normal) > 1e-8 { out_normal = normalize(out_normal); }
        if length(out_tangent) > 1e-8 { out_tangent = normalize(out_tangent); }
        positions.push(out_position.x); positions.push(out_position.y); positions.push(out_position.z);
        normals.push(out_normal.x); normals.push(out_normal.y); normals.push(out_normal.z);
        tangents.push(out_tangent.x); tangents.push(out_tangent.y); tangents.push(out_tangent.z); tangents.push(base.tangent.w);
    }
    return mesh_asset_update(model.mesh.id, positions[..], normals[..], tangents[..]);
}

fn glb_scene_rebuild_skins(handle: NativeGlbSceneHandle) -> bool {
    for scene_part_index in 0..g_native_glb_scene_parts.len {
        let scene_part = g_native_glb_scene_parts[scene_part_index];
        if scene_part.active && scene_part.scene_id == handle.id && scene_part.scene_generation == handle.generation {
            for part_index in 0..g_native_glb_parts.len {
                if g_native_glb_parts[part_index].active && g_native_glb_parts[part_index].owner_id == scene_part.mesh.id && g_native_glb_parts[part_index].owner_generation == scene_part.mesh.generation {
                    let model .= g_native_glb_parts[part_index].model;
                    if model.skin_joint_count > 0 && !glb_skin_model_rebuild(handle, model) { return false; }
                }
            }
        }
    }
    return true;
}

fn glb_scene_apply_morph_weights(handle: NativeGlbSceneHandle, gltf_node_index: i32, track: NativeGlbAnimationTrack, time: f32) -> bool {
    var found = false;
    for scene_part_index in 0..g_native_glb_scene_parts.len {
        let scene_part = g_native_glb_scene_parts[scene_part_index];
        if scene_part.active && scene_part.scene_id == handle.id && scene_part.scene_generation == handle.generation && scene_part.gltf_node_index == gltf_node_index {
            for part_index in 0..g_native_glb_parts.len {
                if g_native_glb_parts[part_index].active && g_native_glb_parts[part_index].owner_id == scene_part.mesh.id && g_native_glb_parts[part_index].owner_generation == scene_part.mesh.generation {
                    let model .= g_native_glb_parts[part_index].model;
                    guard model.morph_target_count == track.weight_target_count else { return false; }
                    for target in 0..track.weight_target_count {
                        let value, valid = glb_animation_sample_weight(track, time, target);
                        guard valid else { return false; }
                        g_native_glb_morph_weights[model.morph_weight_start + target].value = value;
                    }
                    guard glb_morph_model_rebuild(model) else { return false; }
                    found = true;
                }
            }
        }
    }
    return found;
}

fn native_glb_scene_animation_count(handle: NativeGlbSceneHandle) -> i32 {
    guard native_glb_scene_valid(handle) else { return 0; }
    return g_native_glb_scenes[handle.id].animation_count;
}

fn native_glb_scene_animation_duration(handle: NativeGlbSceneHandle, animation_index: i32) -> f32 {
    guard native_glb_scene_valid(handle) && animation_index >= 0 && animation_index < g_native_glb_scenes[handle.id].animation_count else { return 0.0; }
    var duration: f32 = 0.0;
    for i in 0..g_native_glb_animation_tracks.len {
        let track = g_native_glb_animation_tracks[i];
        if track.active && track.scene_id == handle.id && track.scene_generation == handle.generation && track.animation_index == animation_index {
            duration = max(duration, track.duration);
        }
    }
    return duration;
}

fn native_glb_scene_reset_animation(handle: NativeGlbSceneHandle) -> bool {
    guard native_glb_scene_valid(handle) else { return false; }
    for i in 0..g_native_glb_scene_nodes.len {
        if g_native_glb_scene_nodes[i].active && g_native_glb_scene_nodes[i].scene_id == handle.id && g_native_glb_scene_nodes[i].scene_generation == handle.generation {
            if g_native_glb_scene_nodes[i].animated && g_native_glb_scene_nodes[i].has_trs && node_handle_valid(g_native_glb_scene_nodes[i].node) {
                g_native_glb_scene_nodes[i].translation = g_native_glb_scene_nodes[i].base_translation;
                g_native_glb_scene_nodes[i].rotation = g_native_glb_scene_nodes[i].base_rotation;
                g_native_glb_scene_nodes[i].scale = g_native_glb_scene_nodes[i].base_scale;
                node(g_native_glb_scene_nodes[i].node.index).local_matrix = glb_trs_matrix(g_native_glb_scene_nodes[i].translation, g_native_glb_scene_nodes[i].rotation, g_native_glb_scene_nodes[i].scale);
                node(g_native_glb_scene_nodes[i].node.index).use_local_matrix = true;
            }
        }
    }
    for scene_part_index in 0..g_native_glb_scene_parts.len {
        let scene_part = g_native_glb_scene_parts[scene_part_index];
        if scene_part.active && scene_part.scene_id == handle.id && scene_part.scene_generation == handle.generation {
            for part_index in 0..g_native_glb_parts.len {
                if g_native_glb_parts[part_index].active && g_native_glb_parts[part_index].owner_id == scene_part.mesh.id && g_native_glb_parts[part_index].owner_generation == scene_part.mesh.generation {
                    let model .= g_native_glb_parts[part_index].model;
                    if model.morph_target_count > 0 {
                        for target in 0..model.morph_target_count {
                            g_native_glb_morph_weights[model.morph_weight_start + target].value = g_native_glb_morph_weights[model.morph_weight_start + target].base;
                        }
                        if !glb_morph_model_rebuild(model) { return false; }
                    }
                }
            }
        }
    }
    node_update_worlds();
    if !glb_scene_rebuild_skins(handle) { return false; }
    return true;
}

fn native_glb_scene_apply_animation(handle: NativeGlbSceneHandle, animation_index: i32, time: f32) -> bool {
    guard native_glb_scene_valid(handle) && animation_index >= 0 && animation_index < g_native_glb_scenes[handle.id].animation_count &&
          time >= 0.0 && time <= 3.4e38 else { return false; }
    native_glb_scene_reset_animation(handle);
    for i in 0..g_native_glb_animation_tracks.len {
        let track = g_native_glb_animation_tracks[i];
        if track.active && track.scene_id == handle.id && track.scene_generation == handle.generation && track.animation_index == animation_index {
            if track.path == 3 {
                guard glb_scene_apply_morph_weights(handle, track.gltf_node_index, track, time) else { return false; }
                continue;
            }
            let value, value_ok = glb_animation_sample(track, time);
            guard value_ok else { return false; }
            guard track.node_slot_index >= 0 && track.node_slot_index < g_native_glb_scene_nodes.len &&
                  g_native_glb_scene_nodes[track.node_slot_index].active && g_native_glb_scene_nodes[track.node_slot_index].scene_id == handle.id &&
                  g_native_glb_scene_nodes[track.node_slot_index].scene_generation == handle.generation else { return false; }
            if track.path == 0 { g_native_glb_scene_nodes[track.node_slot_index].translation = float3 { value.x, value.y, value.z }; }
            else if track.path == 1 { g_native_glb_scene_nodes[track.node_slot_index].rotation = value; }
            else if track.path == 2 { g_native_glb_scene_nodes[track.node_slot_index].scale = float3 { value.x, value.y, value.z }; }
        }
    }
    for i in 0..g_native_glb_scene_nodes.len {
        let part = g_native_glb_scene_nodes[i];
        if part.active && part.scene_id == handle.id && part.scene_generation == handle.generation && part.animated && part.has_trs && node_handle_valid(part.node) {
                let transform = glb_trs_matrix(part.translation, part.rotation, part.scale);
                for component in 16 { guard abs(transform.m[component]) <= 3.4e38 else { return false; } }
        }
    }
    for i in 0..g_native_glb_scene_nodes.len {
        let part = g_native_glb_scene_nodes[i];
        if part.active && part.scene_id == handle.id && part.scene_generation == handle.generation && part.animated && part.has_trs && node_handle_valid(part.node) {
            node(part.node.index).local_matrix = glb_trs_matrix(part.translation, part.rotation, part.scale); node(part.node.index).use_local_matrix = true;
        }
    }
    node_update_worlds();
    if !glb_scene_rebuild_skins(handle) { return false; }
    return true;
}

fn native_glb_scene_root(handle: NativeGlbSceneHandle) -> NodeHandle {
    guard native_glb_scene_valid(handle) && node_handle_valid(g_native_glb_scenes[handle.id].root) else { return NodeHandle { .. }; }
    return g_native_glb_scenes[handle.id].root;
}

fn native_glb_scene_mesh_count(handle: NativeGlbSceneHandle) -> i32 {
    guard native_glb_scene_valid(handle) else { return 0; }
    return g_native_glb_scenes[handle.id].mesh_count;
}

fn native_glb_scene_node_count(handle: NativeGlbSceneHandle) -> i32 {
    guard native_glb_scene_valid(handle) else { return 0; }
    return g_native_glb_scenes[handle.id].node_count;
}

fn native_glb_scene_node(handle: NativeGlbSceneHandle, gltf_node_index: i32) -> NodeHandle {
    guard native_glb_scene_valid(handle) && gltf_node_index >= 0 else { return NodeHandle { .. }; }
    for i in 0..g_native_glb_scene_nodes.len {
        let part = g_native_glb_scene_nodes[i];
        if part.active && part.scene_id == handle.id && part.scene_generation == handle.generation && part.gltf_index == gltf_node_index {
            if node_handle_valid(part.node) { return part.node; }
            return NodeHandle { .. };
        }
    }
    return NodeHandle { .. };
}

fn native_glb_scene_camera_count(handle: NativeGlbSceneHandle) -> i32 {
    guard native_glb_scene_valid(handle) else { return 0; }
    return g_native_glb_scenes[handle.id].camera_count;
}

fn native_glb_scene_camera_id(handle: NativeGlbSceneHandle, index: i32) -> i64 {
    guard native_glb_scene_valid(handle) && index >= 0 && index < g_native_glb_scenes[handle.id].camera_count else { return -1; }
    for i in 0..g_native_glb_scene_cameras.len {
        let part = g_native_glb_scene_cameras[i];
        if part.active && part.scene_id == handle.id && part.scene_generation == handle.generation && part.camera_index == index {
            return part.camera_id;
        }
    }
    return -1;
}

fn native_glb_scene_select_camera(handle: NativeGlbSceneHandle, index: i32) -> bool {
    let camera_id = native_glb_scene_camera_id(handle, index);
    guard camera_id >= 0 else { return false; }
    return camera_select(camera_id);
}

fn native_glb_scene_mesh(handle: NativeGlbSceneHandle, index: i32) -> NativeGlbMeshHandle {
    guard native_glb_scene_valid(handle) && index >= 0 && index < g_native_glb_scenes[handle.id].mesh_count else { return NativeGlbMeshHandle { .. }; }
    for i in 0..g_native_glb_scene_parts.len {
        let part = g_native_glb_scene_parts[i];
        if part.active && part.scene_id == handle.id && part.scene_generation == handle.generation && part.mesh_index == index {
            if native_glb_mesh_valid(part.mesh) { return part.mesh; }
            return NativeGlbMeshHandle { .. };
        }
    }
    return NativeGlbMeshHandle { .. };
}

fn native_glb_scene_dispose(handle: NativeGlbSceneHandle) -> bool {
    guard native_glb_scene_valid(handle) else { return false; }
    for i in 0..g_native_glb_animation_tracks.len {
        if g_native_glb_animation_tracks[i].active && g_native_glb_animation_tracks[i].scene_id == handle.id &&
           g_native_glb_animation_tracks[i].scene_generation == handle.generation {
            let start = g_native_glb_animation_tracks[i].key_start;
            let count = g_native_glb_animation_tracks[i].key_count;
            if start >= 0 { for key_index in 0..count { g_native_glb_animation_keys[start + key_index].active = false; } }
            let weight_start = g_native_glb_animation_tracks[i].weight_start;
            let weight_count = g_native_glb_animation_tracks[i].weight_value_count;
            if weight_start >= 0 { for value_index in 0..weight_count { g_native_glb_animation_weight_values[weight_start + value_index].active = false; } }
            g_native_glb_animation_tracks[i].active = false;
        }
    }
    for i in 0..g_native_glb_scene_parts.len {
        if g_native_glb_scene_parts[i].active && g_native_glb_scene_parts[i].scene_id == handle.id &&
           g_native_glb_scene_parts[i].scene_generation == handle.generation {
            native_glb_mesh_dispose(g_native_glb_scene_parts[i].mesh);
            g_native_glb_scene_parts[i].active = false;
        }
    }
    for i in 0..g_native_glb_scene_nodes.len {
        if g_native_glb_scene_nodes[i].active && g_native_glb_scene_nodes[i].scene_id == handle.id &&
           g_native_glb_scene_nodes[i].scene_generation == handle.generation {
            if node_handle_valid(g_native_glb_scene_nodes[i].node) { node_asset_release_handle(g_native_glb_scene_nodes[i].node); }
            g_native_glb_scene_nodes[i].active = false;
        }
    }
    for i in 0..g_native_glb_scene_cameras.len {
        if g_native_glb_scene_cameras[i].active && g_native_glb_scene_cameras[i].scene_id == handle.id &&
           g_native_glb_scene_cameras[i].scene_generation == handle.generation {
            camera_remove(g_native_glb_scene_cameras[i].camera_id);
            g_native_glb_scene_cameras[i].active = false;
        }
    }
    if g_native_glb_scenes[handle.id].light_set_id >= 0 {
        asset_light_set_release(g_native_glb_scenes[handle.id].light_set_id);
    }
    let previous_camera_id = g_native_glb_scenes[handle.id].previous_camera_id;
    let previous_camera = g_native_glb_scenes[handle.id].previous_camera;
    if previous_camera_id >= 0 {
        if !camera_select(previous_camera_id) { let restored .= camera(); restored = previous_camera; }
    } else { let restored .= camera(); restored = previous_camera; }
    if node_handle_valid(g_native_glb_scenes[handle.id].root) { node_asset_release_handle(g_native_glb_scenes[handle.id].root); }
    g_native_glb_scenes[handle.id].active = false;
    g_native_glb_scenes[handle.id].mesh_count = 0;
    g_native_glb_scenes[handle.id].node_count = 0;
    g_native_glb_scenes[handle.id].camera_count = 0;
    g_native_glb_scenes[handle.id].animation_count = 0;
    g_native_glb_scenes[handle.id].light_set_id = -1;
    g_native_glb_scenes[handle.id].previous_camera_id = -1;
    g_native_glb_scenes[handle.id].root = NodeHandle { .. };
    return true;
}
