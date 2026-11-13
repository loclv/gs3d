"""Generate a 32-instance, high-poly 64-target glTF animation benchmark."""
import json
import math
import pathlib
import struct

HERE = pathlib.Path(__file__).resolve().parent
SLICES, STACKS, TARGETS = 63, 31, 64
vertices, normals, uvs, indices = [], [], [], []

for stack in range(STACKS + 1):
    phi = math.pi * stack / STACKS
    ring = math.sin(phi)
    y = math.cos(phi)
    for slice_index in range(SLICES + 1):
        theta = 2 * math.pi * slice_index / SLICES
        x, z = ring * math.cos(theta), ring * math.sin(theta)
        vertices.extend((x, y, z))
        normals.extend((x, y, z))
        uvs.extend((slice_index / SLICES, stack / STACKS))

for stack in range(STACKS):
    for slice_index in range(SLICES):
        a = stack * (SLICES + 1) + slice_index
        b = a + SLICES + 1
        indices.extend((a, b, a + 1, a + 1, b, b + 1))

binary = bytearray()
views = []

def append(data):
    while len(binary) % 4:
        binary.append(0)
    views.append({"buffer": 0, "byteOffset": len(binary), "byteLength": len(data)})
    binary.extend(data)
    return len(views) - 1

def floats(values):
    return struct.pack(f"<{len(values)}f", *values)

accessors = []

def accessor(view, component_type, count, kind, **extra):
    accessors.append({"bufferView": view, "componentType": component_type,
                      "count": count, "type": kind, **extra})
    return len(accessors) - 1

position_view = append(floats(vertices))
position_accessor = accessor(position_view, 5126, len(vertices) // 3, "VEC3",
                             min=[-1, -1, -1], max=[1, 1, 1])
normal_view = append(floats(normals))
normal_accessor = accessor(normal_view, 5126, len(normals) // 3, "VEC3")
uv_view = append(floats(uvs))
uv_accessor = accessor(uv_view, 5126, len(uvs) // 2, "VEC2")
index_view = append(struct.pack(f"<{len(indices)}H", *indices))
index_accessor = accessor(index_view, 5123, len(indices), "SCALAR")
targets = []
for target in range(TARGETS):
    phase = 2 * math.pi * target / TARGETS
    frequency = 1 + target % 12
    delta = []
    for vertex in range(len(vertices) // 3):
        x, y, z = vertices[vertex * 3:vertex * 3 + 3]
        theta = math.atan2(z, x)
        phi = math.acos(max(-1.0, min(1.0, y)))
        amplitude = 0.08 * math.sin(frequency * theta + phase) * math.sin(phi) ** 2
        delta.extend((x * amplitude, y * amplitude, z * amplitude))
    target_view = append(floats(delta))
    target_accessor = accessor(target_view, 5126, len(delta) // 3, "VEC3")
    targets.append({"POSITION": target_accessor})

times = [key / 8 for key in range(TARGETS + 1)]
time_view = append(floats(times))
time_accessor = accessor(time_view, 5126, len(times), "SCALAR",
                         min=[0], max=[times[-1]])
weights = [0.0] * (len(times) * TARGETS)
for key in range(len(times)):
    weights[key * TARGETS + key % TARGETS] = 1.0
weight_view = append(floats(weights))
weight_accessor = accessor(weight_view, 5126, len(weights), "SCALAR")
instance_translations = [
    (column * 1.5 - 5.25, row * 1.5 - 2.25, 0.0)
    for row in range(4) for column in range(8)
]
translation_view = append(floats([value for translation in instance_translations for value in translation]))
translation_accessor = accessor(translation_view, 5126, len(instance_translations), "VEC3")
scale_view = append(floats([0.45] * (len(instance_translations) * 3)))
scale_accessor = accessor(scale_view, 5126, len(instance_translations), "VEC3")

doc = {
    "asset": {"version": "2.0", "generator": "goose-3d morph benchmark generator"},
    "buffers": [{"byteLength": len(binary)}], "bufferViews": views, "accessors": accessors,
    "materials": [{"pbrMetallicRoughness": {"baseColorFactor": [0.28, 0.68, 0.95, 1],
                                               "metallicFactor": 0.15, "roughnessFactor": 0.35}}],
    "meshes": [{"weights": [0.0] * TARGETS, "primitives": [{
        "attributes": {"POSITION": position_accessor, "NORMAL": normal_accessor, "TEXCOORD_0": uv_accessor},
        "indices": index_accessor, "material": 0, "targets": targets,
    }]}],
    "extensionsUsed": ["EXT_mesh_gpu_instancing"],
    "nodes": [{"mesh": 0, "weights": [0.0] * TARGETS,
               "extensions": {"EXT_mesh_gpu_instancing": {"attributes": {
                   "TRANSLATION": translation_accessor, "SCALE": scale_accessor,
               }}}}],
    "scenes": [{"nodes": [0]}], "scene": 0,
    "animations": [{"name": "Morph Sweep", "samplers": [{"input": time_accessor, "output": weight_accessor}],
                    "channels": [{"sampler": 0, "target": {"node": 0, "path": "weights"}}]}],
}

json_data = json.dumps(doc, separators=(",", ":")).encode()
json_data += b" " * (-len(json_data) % 4)
binary.extend(b"\0" * (-len(binary) % 4))
total = 12 + 8 + len(json_data) + 8 + len(binary)
glb = (struct.pack("<III", 0x46546C67, 2, total) +
       struct.pack("<II", len(json_data), 0x4E4F534A) + json_data +
       struct.pack("<II", len(binary), 0x004E4942) + binary)
(HERE / "morph-benchmark.glb").write_bytes(glb)
print(f"wrote morph-benchmark.glb ({len(glb)} bytes, {len(vertices) // 3} vertices, {TARGETS} targets, {len(instance_translations)} instances)")
