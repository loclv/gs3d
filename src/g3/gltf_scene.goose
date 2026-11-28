// GLB scene and animation loading: scene slots, buffer staging,
// animation tracks/keys, skin and morph rebuild, scene API.
// Split from gltf_native.goose; shares all state through namespace g3.
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
import g3.gltf_native;

namespace g3;

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
                if !read_file(external_path[..], external) { g_native_glb_error = NATIVE_GLB_ERROR_IO; return false; }
                guard external.len == length else { return false; }
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
    g_native_glb_error = NATIVE_GLB_ERROR_NONE;
    var bytes: u8[>..] = [];
    if path.len == 0 || !read_file(path, bytes) { g_native_glb_error = NATIVE_GLB_ERROR_IO; return NativeGlbSceneHandle { .. }, false; }
    if bytes.len == 0 || bytes.len > 268435456 { g_native_glb_error = NATIVE_GLB_ERROR_INVALID_DATA; return NativeGlbSceneHandle { .. }, false; }
    g_native_glb_error = NATIVE_GLB_ERROR_INVALID_DATA;
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
    if !glb_required_extensions_supported(root) {
        g_native_glb_error = NATIVE_GLB_ERROR_UNSUPPORTED_EXTENSION;
        return NativeGlbSceneHandle { .. }, false;
    }
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
            g_native_glb_error = NATIVE_GLB_ERROR_INVALID_DATA;
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
    g_native_glb_error = NATIVE_GLB_ERROR_NONE;
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
