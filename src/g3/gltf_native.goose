// Native static GLB primitive loading. This first native path deliberately
// supports float POSITION/NORMAL/TEXCOORD_0 data and unsigned triangle indices;
// browser applications should use the broader loader in web/assets.js.
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

fn glb_not_normalized(node: json::Node?) -> bool {
    guard node else { return true; }
    let value, ok = json::as_bool(node);
    return ok && !value;
}

fn glb_accessor(doc: json::Node?, binary_size: i64, index: i64, type_name: const u8[:], component_type: i64, components: i64) -> GlbAccessor, bool {
    let accessors = json::member(doc, "accessors");
    let views = json::member(doc, "bufferViews");
    let accessor = glb_json_element(accessors, index);
    guard accessor && views else { return GlbAccessor { .. }, false; }
    let count, count_ok = glb_json_index(json::member(accessor, "count"));
    let component, component_ok = glb_json_index(json::member(accessor, "componentType"));
    let view_index, view_ok = glb_json_index(json::member(accessor, "bufferView"));
    let actual_type, type_ok = json::as_string(json::member(accessor, "type"));
    guard count_ok && count > 0 && count <= 1048576 && component_ok && component == component_type &&
          view_ok && actual_type == type_name && glb_not_normalized(json::member(accessor, "normalized")) &&
          !json::member(accessor, "sparse") else { return GlbAccessor { .. }, false; }
    let view = glb_json_element(views, view_index);
    guard view else { return GlbAccessor { .. }, false; }
    let buffer_index, buffer_ok = glb_optional_index(json::member(view, "buffer"), 0);
    let view_offset, view_ok = glb_optional_index(json::member(view, "byteOffset"), 0);
    let view_length, length_ok = glb_json_index(json::member(view, "byteLength"));
    let accessor_offset, accessor_offset_ok = glb_optional_index(json::member(accessor, "byteOffset"), 0);
    let stride, stride_ok = glb_optional_index(json::member(view, "byteStride"), components * 4);
    guard buffer_ok && buffer_index == 0 && view_ok && view_offset >= 0 &&
          length_ok && view_length > 0 && accessor_offset_ok && accessor_offset >= 0 &&
          stride_ok && stride >= components * 4 && stride <= 252 && stride % 4 == 0 else { return GlbAccessor { .. }, false; }
    let start = view_offset + accessor_offset;
    let last = accessor_offset + (count - 1) * stride + components * 4;
    guard last <= view_length && view_offset + view_length <= binary_size && start % 4 == 0 else { return GlbAccessor { .. }, false; }
    return GlbAccessor { offset: start, stride: stride, count: count, components: components }, true;
}

fn glb_index_accessor(doc: json::Node?, binary_size: i64, index: i64) -> GlbAccessor, i64, bool {
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
    guard buffer_ok && buffer_index == 0 && view_ok && view_offset >= 0 &&
          length_ok && view_length > 0 && accessor_offset_ok && accessor_offset >= 0 &&
          view_offset + view_length <= binary_size && accessor_offset + count * bytes_per_index <= view_length &&
          (view_offset + accessor_offset) % bytes_per_index == 0 && !json::member(view, "byteStride") else { return GlbAccessor { .. }, 0, false; }
    return GlbAccessor { offset: view_offset + accessor_offset, stride: bytes_per_index,
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

// Load one selected static primitive from an embedded-binary glTF 2.0 GLB.
// Supports float32 POSITION/NORMAL/TEXCOORD_0, TRIANGLES, and u8/u16/u32
// indices and scalar/factor materials; skins, animation, sparse accessors,
// textures, and external buffers are outside this native subset. It applies
// the first node instance transform.
fn native_glb_load_selected(path: const u8[:], requested_mesh_index: i64, primitive_index: i64, node_index: i64) -> NativeGlbModel, bool {
    var bytes: u8[>..] = [];
    guard path.len > 0 && read_file(path, bytes) && bytes.len <= 268435456 else { return NativeGlbModel { .. }, false; }
    guard bytes.len >= 20 && glb_u32(bytes[..], 0) == 0x46546C67 && glb_u32(bytes[..], 4) == 2 && glb_u32(bytes[..], 8) == bytes.len else { return NativeGlbModel { .. }, false; }
    var json_start: i64 = -1; var json_size: i64 = 0; var bin_start: i64 = -1; var bin_size: i64 = 0;
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
    var doc: json::Node[>..] = [];
    var decoded: u8[>..] = [];
    let root, parse_error = json::parse(bytes[json_start..json_start + json_size], doc, decoded);
    guard root && parse_error.len == 0 else { return NativeGlbModel { .. }, false; }
    let asset = json::member(root, "asset");
    let version, version_ok = json::as_string(json::member(asset, "version"));
    let buffers = json::member(root, "buffers");
    let buffer = glb_json_element(buffers, 0);
    let declared_bytes, declared_ok = glb_json_index(json::member(buffer, "byteLength"));
    guard version_ok && version == "2.0" && declared_ok && declared_bytes > 0 && declared_bytes <= bin_size && bin_size - declared_bytes <= 3 else { return NativeGlbModel { .. }, false; }
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
    let positions, positions_ok = glb_accessor(root, declared_bytes, position_index, "VEC3", 5126, 3);
    let normals, normals_ok = glb_accessor(root, declared_bytes, normal_index, "VEC3", 5126, 3);
    guard positions_ok && normals_ok && positions.count == normals.count else { return NativeGlbModel { .. }, false; }
    let uv_node = json::member(attributes, "TEXCOORD_0");
    var uvs = GlbAccessor { .. };
    if uv_node { let uv_index, uv_ok = glb_json_index(uv_node); guard uv_ok else { return NativeGlbModel { .. }, false; } let uv_result, uv_valid = glb_accessor(root, declared_bytes, uv_index, "VEC2", 5126, 2); guard uv_valid && uv_result.count == positions.count else { return NativeGlbModel { .. }, false; } uvs = uv_result; }
    let indices_node = json::member(primitive, "indices");
    var index_info = GlbAccessor { .. }; var index_type: i64 = 0;
    if indices_node { let index_id, index_ok = glb_json_index(indices_node); guard index_ok else { return NativeGlbModel { .. }, false; } let info, kind, ok = glb_index_accessor(root, declared_bytes, index_id); guard ok && info.count % 3 == 0 else { return NativeGlbModel { .. }, false; } index_info = info; index_type = kind; }
    else { guard positions.count % 3 == 0 else { return NativeGlbModel { .. }, false; } index_info.count = positions.count; }
    var vertices: Vertex[>..] = [];
    var out_indices: u32[>..] = [];
    for i in 0..positions.count {
        let base = bin_start + positions.offset + i * positions.stride;
        let px, a = glb_f32(bytes[..], base); let py, b = glb_f32(bytes[..], base + 4); let pz, c = glb_f32(bytes[..], base + 8);
        let normal_base = bin_start + normals.offset + i * normals.stride;
        let nx, d = glb_f32(bytes[..], normal_base); let ny, e = glb_f32(bytes[..], normal_base + 4); let nz, f = glb_f32(bytes[..], normal_base + 8);
        guard a && b && c && d && e && f else { return NativeGlbModel { .. }, false; }
        var uv = float2_0;
        if uv_node { let uv_base = bin_start + uvs.offset + i * uvs.stride; let u, g = glb_f32(bytes[..], uv_base); let v, h = glb_f32(bytes[..], uv_base + 4); guard g && h else { return NativeGlbModel { .. }, false; } uv = float2 { u, v }; }
        vertices.push(Vertex { pos: float3 { px, py, pz }, normal: float3 { nx, ny, nz }, uv: uv, color: float4_1, .. });
    }
    for i in 0..index_info.count {
        let at = bin_start + index_info.offset + i * index_info.stride;
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
    guard path.len > 0 && read_file(path, bytes) && bytes.len >= 20 && bytes.len <= 268435456 &&
          glb_u32(bytes[..], 0) == 0x46546C67 && glb_u32(bytes[..], 4) == 2 && glb_u32(bytes[..], 8) == bytes.len
    else { return 0, false; }
    var json_start: i64 = -1; var json_size: i64 = 0;
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
