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
import g3.platform;

namespace g3;

struct NativeGlbModel { mesh: MeshHandle, node: NodeHandle, material: MaterialHandle }
struct NativeGlbMeshHandle { id: i32 = -1, generation: i32 }
struct NativeGlbMeshSlot { generation: i32 = 1, primitive_count: i32, root: NodeHandle = NodeHandle { .. }, active: bool }
struct NativeGlbPartSlot { owner_id: i32, owner_generation: i32, primitive_index: i32, model: NativeGlbModel, active: bool }
struct GlbAccessor { offset: i64, stride: i64, count: i64, components: i64 }
struct GlbAttribute { offset: i64, stride: i64, count: i64, components: i64, component_type: i64, normalized: bool }

var g_native_glb_meshes: NativeGlbMeshSlot[>..];
var g_native_glb_parts: NativeGlbPartSlot[>..];

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

fn glb_material(root: json::Node?, primitive: json::Node?) -> MaterialHandle, bool {
    let material_node = json::member(primitive, "material");
    if !material_node { return MaterialHandle { .. }, true; }
    let material_index, index_ok = glb_json_index(material_node);
    let materials = json::member(root, "materials");
    let source = glb_json_element(materials, material_index);
    guard index_ok && source else { return MaterialHandle { .. }, false; }

    var color = float4_1;
    var metallic: f64 = 1.0; var roughness: f64 = 1.0;
    let pbr = json::member(source, "pbrMetallicRoughness");
    let color_node = json::member(pbr, "baseColorFactor");
    if color_node {
        guard glb_array_count(color_node) == 4 else { return MaterialHandle { .. }, false; }
        let r, a = json::as_f64(glb_json_element(color_node, 0)); let g, b = json::as_f64(glb_json_element(color_node, 1));
        let blue, c = json::as_f64(glb_json_element(color_node, 2)); let alpha, d = json::as_f64(glb_json_element(color_node, 3));
        guard a && b && c && d && r >= 0.0 && r <= 1.0 && g >= 0.0 && g <= 1.0 && blue >= 0.0 && blue <= 1.0 && alpha >= 0.0 && alpha <= 1.0 else { return MaterialHandle { .. }, false; }
        color = float4 { r as f32, g as f32, blue as f32, alpha as f32 };
    }
    let metallic_value, metallic_ok = glb_number(json::member(pbr, "metallicFactor"), 1.0);
    let roughness_value, roughness_ok = glb_number(json::member(pbr, "roughnessFactor"), 1.0);
    guard metallic_ok && roughness_ok && metallic_value >= 0.0 && metallic_value <= 1.0 && roughness_value >= 0.0 && roughness_value <= 1.0 else { return MaterialHandle { .. }, false; }
    let emissive_node = json::member(source, "emissiveFactor");
    var emissive = float3_0;
    if emissive_node {
        guard glb_array_count(emissive_node) == 3 else { return MaterialHandle { .. }, false; }
        let r, a = json::as_f64(glb_json_element(emissive_node, 0)); let g, b = json::as_f64(glb_json_element(emissive_node, 1)); let blue, c = json::as_f64(glb_json_element(emissive_node, 2));
        guard a && b && c && r >= 0.0 && r <= 3.4e38 && g >= 0.0 && g <= 3.4e38 && blue >= 0.0 && blue <= 3.4e38 else { return MaterialHandle { .. }, false; }
        emissive = float3 { r as f32, g as f32, blue as f32 };
    }
    let emissive_extension, emissive_extension_ok = glb_material_extension(root, source, "KHR_materials_emissive_strength");
    guard emissive_extension_ok else { return MaterialHandle { .. }, false; }
    let emissive_strength, emissive_strength_ok = glb_number(json::member(emissive_extension, "emissiveStrength"), 1.0);
    guard emissive_strength_ok && emissive_strength >= 0.0 && emissive_strength <= 3.4e38 else { return MaterialHandle { .. }, false; }
    emissive = emissive * (emissive_strength as f32);
    let ior_extension, ior_extension_ok = glb_material_extension(root, source, "KHR_materials_ior");
    guard ior_extension_ok else { return MaterialHandle { .. }, false; }
    let ior, ior_ok = glb_number(json::member(ior_extension, "ior"), 1.5);
    guard ior_ok && ior >= 1.0 && ior <= 2.333 else { return MaterialHandle { .. }, false; }
    let specular_extension, specular_extension_ok = glb_material_extension(root, source, "KHR_materials_specular");
    guard specular_extension_ok else { return MaterialHandle { .. }, false; }
    let specular_factor, specular_factor_ok = glb_number(json::member(specular_extension, "specularFactor"), 1.0);
    let specular_color, specular_color_ok = glb_factor3(json::member(specular_extension, "specularColorFactor"), float3_1, 0.0, 3.4e38);
    guard specular_factor_ok && specular_factor >= 0.0 && specular_factor <= 1.0 && specular_color_ok else { return MaterialHandle { .. }, false; }
    let clearcoat_extension, clearcoat_extension_ok = glb_material_extension(root, source, "KHR_materials_clearcoat");
    guard clearcoat_extension_ok else { return MaterialHandle { .. }, false; }
    let clearcoat_factor, clearcoat_factor_ok = glb_number(json::member(clearcoat_extension, "clearcoatFactor"), 0.0);
    let clearcoat_roughness, clearcoat_roughness_ok = glb_number(json::member(clearcoat_extension, "clearcoatRoughnessFactor"), 0.0);
    guard clearcoat_factor_ok && clearcoat_roughness_ok && clearcoat_factor >= 0.0 && clearcoat_factor <= 1.0 && clearcoat_roughness >= 0.0 && clearcoat_roughness <= 1.0 else { return MaterialHandle { .. }, false; }
    let sheen_extension, sheen_extension_ok = glb_material_extension(root, source, "KHR_materials_sheen");
    guard sheen_extension_ok else { return MaterialHandle { .. }, false; }
    let sheen_color, sheen_color_ok = glb_factor3(json::member(sheen_extension, "sheenColorFactor"), float3_0, 0.0, 1.0);
    let sheen_roughness, sheen_roughness_ok = glb_number(json::member(sheen_extension, "sheenRoughnessFactor"), 0.0);
    guard sheen_color_ok && sheen_roughness_ok && sheen_roughness >= 0.0 && sheen_roughness <= 1.0 else { return MaterialHandle { .. }, false; }
    let anisotropy_extension, anisotropy_extension_ok = glb_material_extension(root, source, "KHR_materials_anisotropy");
    guard anisotropy_extension_ok else { return MaterialHandle { .. }, false; }
    let anisotropy_strength, anisotropy_strength_ok = glb_number(json::member(anisotropy_extension, "anisotropyStrength"), 0.0);
    let anisotropy_rotation, anisotropy_rotation_ok = glb_number(json::member(anisotropy_extension, "anisotropyRotation"), 0.0);
    guard anisotropy_strength_ok && anisotropy_rotation_ok && anisotropy_strength >= 0.0 && anisotropy_strength <= 1.0 && anisotropy_rotation >= -3.4e38 && anisotropy_rotation <= 3.4e38 else { return MaterialHandle { .. }, false; }
    var alpha_mode: i32 = 0;
    let mode_node = json::member(source, "alphaMode");
    if mode_node {
        let mode, mode_ok = json::as_string(mode_node);
        guard mode_ok else { return MaterialHandle { .. }, false; }
        if mode == "MASK" { alpha_mode = 1; }
        else if mode == "BLEND" { alpha_mode = 2; }
        else { guard mode == "OPAQUE" else { return MaterialHandle { .. }, false; } }
    }
    let cutoff, cutoff_ok = glb_number(json::member(source, "alphaCutoff"), 0.5);
    guard cutoff_ok && cutoff >= 0.0 && cutoff <= 3.4e38 else { return MaterialHandle { .. }, false; }
    let sided_node = json::member(source, "doubleSided");
    var double_sided = false;
    if sided_node { let value, valid = json::as_bool(sided_node); guard valid else { return MaterialHandle { .. }, false; } double_sided = value; }
    let unlit_node = json::member(json::member(source, "extensions"), "KHR_materials_unlit");
    var unlit = false;
    if unlit_node {
        guard glb_array_has_string(json::member(root, "extensionsUsed"), "KHR_materials_unlit") else { return MaterialHandle { .. }, false; }
        guard !specular_extension && !clearcoat_extension && !sheen_extension && !anisotropy_extension else { return MaterialHandle { .. }, false; }
        unlit = true;
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
    return material_handle(id), true;
}

fn glb_array_count(node: json::Node?) -> i64 {
    guard node else { return 0; }
    match node.val { Arr a => { return a.count; }, _ => { return 0; } }
}

fn glb_attribute_accessor(doc: json::Node?, buffer_bases: const i64[:], buffer_sizes: const i64[:], index: i64, semantic: const u8[:], type_name: const u8[:], components: i64) -> GlbAttribute, bool {
    let accessor = glb_json_element(json::member(doc, "accessors"), index);
    let views = json::member(doc, "bufferViews");
    guard accessor && views else { return GlbAttribute { .. }, false; }
    let count, count_ok = glb_json_index(json::member(accessor, "count"));
    let component_type, component_ok = glb_json_index(json::member(accessor, "componentType"));
    let view_index, view_ok = glb_json_index(json::member(accessor, "bufferView"));
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
    let core_float = component_type == 5126 && !normalized;
    let core_texcoord = is_texcoord && (core_float || ((component_type == 5121 || component_type == 5123) && normalized));
    let quantized = if is_position { integer_component }
                    else if is_normal || is_tangent { (component_type == 5120 || component_type == 5122) && normalized }
                    else if is_texcoord { integer_component && !core_texcoord }
                    else { false };
    guard count_ok && count > 0 && count <= 1048576 && component_ok && view_ok && type_ok && actual_type == type_name &&
          component_bytes > 0 && (core_float || core_texcoord || quantized) && !json::member(accessor, "sparse")
    else { return GlbAttribute { .. }, false; }
    if quantized {
        guard glb_array_has_string(json::member(doc, "extensionsUsed"), "KHR_mesh_quantization") &&
              glb_array_has_string(json::member(doc, "extensionsRequired"), "KHR_mesh_quantization")
        else { return GlbAttribute { .. }, false; }
    }
    let view = glb_json_element(views, view_index);
    guard view else { return GlbAttribute { .. }, false; }
    let buffer_index, buffer_ok = glb_optional_index(json::member(view, "buffer"), 0);
    let view_offset, view_offset_ok = glb_optional_index(json::member(view, "byteOffset"), 0);
    let view_length, length_ok = glb_json_index(json::member(view, "byteLength"));
    let accessor_offset, accessor_offset_ok = glb_optional_index(json::member(accessor, "byteOffset"), 0);
    let packed_size = components * component_bytes;
    let stride, stride_ok = glb_optional_index(json::member(view, "byteStride"), packed_size);
    guard buffer_ok && buffer_index >= 0 && buffer_index < buffer_bases.len && buffer_index < buffer_sizes.len && view_offset_ok && view_offset >= 0 && length_ok && view_length > 0 &&
          accessor_offset_ok && accessor_offset >= 0 && stride_ok && stride >= packed_size && stride <= 252 &&
          (!json::member(view, "byteStride") || (stride >= 4 && stride % 4 == 0)) &&
          view_offset % component_bytes == 0 && accessor_offset % component_bytes == 0
    else { return GlbAttribute { .. }, false; }
    let start = view_offset + accessor_offset;
    if quantized { guard start % 4 == 0 && (count <= 1 || stride % 4 == 0) else { return GlbAttribute { .. }, false; } }
    let last = accessor_offset + (count - 1) * stride + packed_size;
    guard last <= view_length && view_offset + view_length <= buffer_sizes[buffer_index] else { return GlbAttribute { .. }, false; }
    return GlbAttribute { offset: buffer_bases[buffer_index] + start, stride: stride, count: count, components: components,
                          component_type: component_type, normalized: normalized }, true;
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
    let at = binary_start + accessor.offset + vertex_index * accessor.stride + component_index * component_bytes;
    return glb_attribute_component(bytes, at, accessor.component_type, accessor.normalized);
}

fn glb_color_accessor(doc: json::Node?, buffer_bases: const i64[:], buffer_sizes: const i64[:], index: i64) -> GlbAccessor, i64, bool {
    let accessor = glb_json_element(json::member(doc, "accessors"), index);
    let views = json::member(doc, "bufferViews");
    guard accessor && views else { return GlbAccessor { .. }, 0, false; }
    let count, count_ok = glb_json_index(json::member(accessor, "count"));
    let component_type, component_ok = glb_json_index(json::member(accessor, "componentType"));
    let view_index, view_ok = glb_json_index(json::member(accessor, "bufferView"));
    let type_name, type_ok = json::as_string(json::member(accessor, "type"));
    let components: i64 = if type_name == "VEC3" { 3 } else if type_name == "VEC4" { 4 } else { 0 };
    let normalized_node = json::member(accessor, "normalized");
    var normalized = false;
    if normalized_node { let value, valid = json::as_bool(normalized_node); guard valid else { return GlbAccessor { .. }, 0, false; } normalized = value; }
    let bytes_per_component: i64 = if component_type == 5126 { 4 } else if component_type == 5123 { 2 } else if component_type == 5121 { 1 } else { 0 };
    guard count_ok && count > 0 && count <= 1048576 && component_ok && view_ok && type_ok && components >= 3 && bytes_per_component > 0 &&
          ((component_type == 5126 && !normalized) || ((component_type == 5121 || component_type == 5123) && normalized)) && !json::member(accessor, "sparse")
    else { return GlbAccessor { .. }, 0, false; }
    let view = glb_json_element(views, view_index);
    guard view else { return GlbAccessor { .. }, 0, false; }
    let buffer_index, buffer_ok = glb_optional_index(json::member(view, "buffer"), 0);
    let view_offset, view_offset_ok = glb_optional_index(json::member(view, "byteOffset"), 0);
    let view_length, length_ok = glb_json_index(json::member(view, "byteLength"));
    let accessor_offset, accessor_offset_ok = glb_optional_index(json::member(accessor, "byteOffset"), 0);
    let packed_size = components * bytes_per_component;
    let stride, stride_ok = glb_optional_index(json::member(view, "byteStride"), packed_size);
    guard buffer_ok && buffer_index >= 0 && buffer_index < buffer_bases.len && buffer_index < buffer_sizes.len && view_offset_ok && view_offset >= 0 && length_ok && view_length > 0 &&
          accessor_offset_ok && accessor_offset >= 0 && stride_ok && stride >= packed_size && stride <= 252 &&
          (!json::member(view, "byteStride") || (stride % 4 == 0)) else { return GlbAccessor { .. }, 0, false; }
    let start = view_offset + accessor_offset;
    let last = accessor_offset + (count - 1) * stride + packed_size;
    guard last <= view_length && view_offset + view_length <= buffer_sizes[buffer_index] && start % bytes_per_component == 0 else { return GlbAccessor { .. }, 0, false; }
    return GlbAccessor { offset: buffer_bases[buffer_index] + start, stride: stride, count: count, components: components }, component_type, true;
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
    let at = binary_start + accessor.offset + vertex_index * accessor.stride;
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

fn glb_index_accessor(doc: json::Node?, buffer_bases: const i64[:], buffer_sizes: const i64[:], index: i64) -> GlbAccessor, i64, bool {
    let accessors = json::member(doc, "accessors");
    let views = json::member(doc, "bufferViews");
    let accessor = glb_json_element(accessors, index);
    guard accessor && views else { return GlbAccessor { .. }, 0, false; }
    let count, count_ok = glb_json_index(json::member(accessor, "count"));
    let component_type, component_ok = glb_json_index(json::member(accessor, "componentType"));
    let view_index, view_ok = glb_json_index(json::member(accessor, "bufferView"));
    let type_name, type_ok = json::as_string(json::member(accessor, "type"));
    guard count_ok && count > 0 && count <= 3145728 && component_ok &&
          (component_type == 5121 || component_type == 5123 || component_type == 5125) &&
          view_ok && type_ok && type_name == "SCALAR" && !json::member(accessor, "sparse") else { return GlbAccessor { .. }, 0, false; }
    let view = glb_json_element(views, view_index);
    guard view else { return GlbAccessor { .. }, 0, false; }
    let buffer_index, buffer_ok = glb_optional_index(json::member(view, "buffer"), 0);
    let view_offset, view_ok = glb_optional_index(json::member(view, "byteOffset"), 0);
    let view_length, length_ok = glb_json_index(json::member(view, "byteLength"));
    let accessor_offset, accessor_offset_ok = glb_optional_index(json::member(accessor, "byteOffset"), 0);
    let bytes_per_index = if component_type == 5121 { 1 } else if component_type == 5123 { 2 } else { 4 };
    guard buffer_ok && buffer_index >= 0 && buffer_index < buffer_bases.len && buffer_index < buffer_sizes.len && view_ok && view_offset >= 0 &&
          length_ok && view_length > 0 && accessor_offset_ok && accessor_offset >= 0 &&
          view_offset + view_length <= buffer_sizes[buffer_index] && accessor_offset + count * bytes_per_index <= view_length &&
          (view_offset + accessor_offset) % bytes_per_index == 0 && !json::member(view, "byteStride") else { return GlbAccessor { .. }, 0, false; }
    return GlbAccessor { offset: buffer_bases[buffer_index] + view_offset + accessor_offset, stride: bytes_per_index,
                         count: count, components: 1 }, component_type, true;
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

// Load one selected static primitive from a glTF 2.0 GLB or JSON glTF document.
// Supports float32 or required KHR_mesh_quantization vertex attributes,
// COLOR_0, TRIANGLES, u8/u16/u32 indices, and factor-only materials. Skins,
// animation, sparse accessors, and textures remain outside this native subset.
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
    let positions, positions_ok = glb_attribute_accessor(root, buffer_bases[..], buffer_sizes[..], position_index, "POSITION", "VEC3", 3);
    let normals, normals_ok = glb_attribute_accessor(root, buffer_bases[..], buffer_sizes[..], normal_index, "NORMAL", "VEC3", 3);
    guard positions_ok && normals_ok && positions.count == normals.count else { return NativeGlbModel { .. }, false; }
    let uv_node = json::member(attributes, "TEXCOORD_0");
    var uvs = GlbAttribute { .. };
    if uv_node { let uv_index, uv_ok = glb_json_index(uv_node); guard uv_ok else { return NativeGlbModel { .. }, false; } let uv_result, uv_valid = glb_attribute_accessor(root, buffer_bases[..], buffer_sizes[..], uv_index, "TEXCOORD_0", "VEC2", 2); guard uv_valid && uv_result.count == positions.count else { return NativeGlbModel { .. }, false; } uvs = uv_result; }
    let tangent_node = json::member(attributes, "TANGENT");
    var tangents = GlbAttribute { .. };
    if tangent_node { let tangent_index, tangent_index_ok = glb_json_index(tangent_node); guard tangent_index_ok else { return NativeGlbModel { .. }, false; } let tangent_info, tangent_ok = glb_attribute_accessor(root, buffer_bases[..], buffer_sizes[..], tangent_index, "TANGENT", "VEC4", 4); guard tangent_ok && tangent_info.count == positions.count else { return NativeGlbModel { .. }, false; } tangents = tangent_info; }
    let color_node = json::member(attributes, "COLOR_0");
    var colors = GlbAccessor { .. }; var color_type: i64 = 0;
    if color_node { let color_index, color_index_ok = glb_json_index(color_node); guard color_index_ok else { return NativeGlbModel { .. }, false; } let color_info, color_component_type, color_ok = glb_color_accessor(root, buffer_bases[..], buffer_sizes[..], color_index); guard color_ok && color_info.count == positions.count else { return NativeGlbModel { .. }, false; } colors = color_info; color_type = color_component_type; }
    let indices_node = json::member(primitive, "indices");
    var index_info = GlbAccessor { .. }; var index_type: i64 = 0;
    if indices_node { let index_id, index_ok = glb_json_index(indices_node); guard index_ok else { return NativeGlbModel { .. }, false; } let info, kind, ok = glb_index_accessor(root, buffer_bases[..], buffer_sizes[..], index_id); guard ok && info.count % 3 == 0 else { return NativeGlbModel { .. }, false; } index_info = info; index_type = kind; }
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
        let at = index_info.offset + i * index_info.stride;
        var value: i64 = i;
        if indices_node {
            value = if index_type == 5121 { bytes[at] }
                    else if index_type == 5123 { bytes[at] | bytes[at + 1] << 8 }
                    else { glb_u32(bytes[..], at) };
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
    let imported_material, material_ok = glb_material(root, primitive);
    guard material_ok else { return NativeGlbModel { .. }, false; }
    let mesh_id = mesh_asset_create(vertices[..], out_indices[..]);
    if mesh_id < 0 { if material_handle_valid(imported_material) { material_asset_release(imported_material); } return NativeGlbModel { .. }, false; }
    let node_id = node_asset_add(mesh_id);
    if node_id < 0 { mesh_asset_release(mesh_id); if material_handle_valid(imported_material) { material_asset_release(imported_material); } return NativeGlbModel { .. }, false; }
    if material_handle_valid(imported_material) { node(node_id).material = imported_material.id; }
    node(node_id).local_matrix = transform;
    node(node_id).use_local_matrix = true;
    return NativeGlbModel { mesh: mesh_handle(mesh_id), node: node_handle(node_id), material: imported_material }, true;
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

// Release the one imported node, material, and mesh. Mesh and material storage
// is released even if a scene reset has already invalidated the node handle.
fn native_glb_dispose(model: NativeGlbModel&) -> bool {
    if node_handle_valid(model.node) { node_asset_release_handle(model.node); }
    if material_handle_valid(model.material) { material_asset_release(model.material); }
    let released = mesh_asset_release_handle(model.mesh);
    model.node = NodeHandle { .. };
    model.mesh = MeshHandle { .. };
    model.material = MaterialHandle { .. };
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
