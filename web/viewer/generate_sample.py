"""Regenerate the textured turntable GLB using the bundled CC0 texture."""
import json
import pathlib
import struct

HERE = pathlib.Path(__file__).resolve().parent
image = (HERE.parent / "game" / "ground.jpg").read_bytes()
axes = ((1, 0, 0), (0, 1, 0), (0, 0, 1))
corners = ((-1, -1), (1, -1), (1, 1), (-1, 1))
positions, normals, uvs, indices = [], [], [], []
for face in range(6):
    sign = 1 if face % 2 == 0 else -1
    n = tuple(x * sign for x in axes[face // 2])
    u = tuple(x * sign for x in axes[(face // 2 + 1) % 3])
    v = (n[1]*u[2]-n[2]*u[1], n[2]*u[0]-n[0]*u[2], n[0]*u[1]-n[1]*u[0])
    base = len(positions) // 3
    for x, y in corners:
        positions.extend(n[i] + u[i]*x + v[i]*y for i in range(3))
        normals.extend(n)
        uvs.extend(((x + 1) / 2, (y + 1) / 2))
    indices.extend((base, base+1, base+2, base, base+2, base+3))

binary = bytearray()
views = []
def append(data):
    while len(binary) % 4:
        binary.append(0)
    views.append({"buffer": 0, "byteOffset": len(binary), "byteLength": len(data)})
    binary.extend(data)

append(struct.pack(f"<{len(positions)}f", *positions))
append(struct.pack(f"<{len(normals)}f", *normals))
append(struct.pack(f"<{len(uvs)}f", *uvs))
append(struct.pack(f"<{len(indices)}H", *indices))
append(image)
append(struct.pack("<3f", 0, 2, 4))
append(struct.pack("<12f", 0, 0, 0, 1, 0, 1, 0, 0, 0, 0, 0, -1))
append(struct.pack("<9f", 0, 0, 0, 0, 0.6, 0, 0, 0, 0))
append(struct.pack("<12f", -8, -1.1, -8, 8, -1.1, -8, 8, -1.1, 8, -8, -1.1, 8))
append(struct.pack("<12f", 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0))
append(struct.pack("<8f", 0, 0, 1, 0, 1, 1, 0, 1))
append(struct.pack("<6H", 0, 2, 1, 0, 3, 2))
doc = {
    "asset": {"version": "2.0", "generator": "goose-3d sample generator"},
    "buffers": [{"byteLength": len(binary)}], "bufferViews": views,
    "accessors": [
        {"bufferView": 0, "componentType": 5126, "count": 24, "type": "VEC3", "min": [-1, -1, -1], "max": [1, 1, 1]},
        {"bufferView": 1, "componentType": 5126, "count": 24, "type": "VEC3"},
        {"bufferView": 2, "componentType": 5126, "count": 24, "type": "VEC2"},
        {"bufferView": 3, "componentType": 5123, "count": 36, "type": "SCALAR"},
        {"bufferView": 5, "componentType": 5126, "count": 3, "type": "SCALAR", "min": [0], "max": [4]},
        {"bufferView": 6, "componentType": 5126, "count": 3, "type": "VEC4"},
        {"bufferView": 7, "componentType": 5126, "count": 3, "type": "VEC3"},
        {"bufferView": 8, "componentType": 5126, "count": 4, "type": "VEC3", "min": [-8, -1.1, -8], "max": [8, -1.1, 8]},
        {"bufferView": 9, "componentType": 5126, "count": 4, "type": "VEC3"},
        {"bufferView": 10, "componentType": 5126, "count": 4, "type": "VEC2"},
        {"bufferView": 11, "componentType": 5123, "count": 6, "type": "SCALAR"},
    ],
    "images": [{"bufferView": 4, "mimeType": "image/jpeg"}],
    "textures": [{"source": 0}],
    "materials": [
        {"pbrMetallicRoughness": {"baseColorTexture": {"index": 0}, "metallicFactor": 0.05, "roughnessFactor": 0.35}},
        {"name": "Shadow receiver", "pbrMetallicRoughness": {"baseColorFactor": [0.24, 0.29, 0.34, 1], "metallicFactor": 0, "roughnessFactor": 1}, "doubleSided": True},
        {"name": "Blue paint", "pbrMetallicRoughness": {"baseColorFactor": [0.12, 0.34, 0.92, 1], "metallicFactor": 0.35, "roughnessFactor": 0.24},
         "extensions": {
             "KHR_materials_clearcoat": {"clearcoatFactor": 0.8, "clearcoatRoughnessFactor": 0.12},
             "KHR_materials_specular": {"specularFactor": 0.9, "specularColorFactor": [0.9, 0.95, 1]},
         }},
    ],
    "meshes": [
        {"primitives": [{"attributes": {"POSITION": 0, "NORMAL": 1, "TEXCOORD_0": 2}, "indices": 3, "material": 0,
                          "extensions": {"KHR_materials_variants": {"mappings": [{"material": 2, "variants": [0]}]}}}]},
        {"primitives": [{"attributes": {"POSITION": 7, "NORMAL": 8, "TEXCOORD_0": 9}, "indices": 10, "material": 1}]},
    ],
    "cameras": [
        {"name": "Perspective", "type": "perspective", "perspective": {"yfov": 0.75, "znear": 0.1, "zfar": 100, "aspectRatio": 1.6}},
        {"name": "Orthographic", "type": "orthographic", "orthographic": {"xmag": 5.5, "ymag": 3.5, "znear": 0.1, "zfar": 100}},
    ],
    "extensionsUsed": ["KHR_lights_punctual", "KHR_materials_variants", "KHR_materials_clearcoat", "KHR_materials_specular"],
    "extensions": {
        "KHR_lights_punctual": {"lights": [
            {"name": "Point key", "type": "point", "color": [1, 0.78, 0.58], "intensity": 45, "range": 18},
            {"name": "Spot fill", "type": "spot", "color": [0.56, 0.72, 1], "intensity": 85, "range": 20, "spot": {"innerConeAngle": 0.12, "outerConeAngle": 0.7}},
        ]},
        "KHR_materials_variants": {"variants": [{"name": "Blue paint"}]},
    },
    "nodes": [
        {"name": "Textured turntable", "mesh": 0},
        {"name": "Ground", "mesh": 1},
        {"name": "Perspective camera", "camera": 0, "translation": [0, 3.8, 8], "rotation": [-0.21644, 0, 0, 0.97630]},
        {"name": "Orthographic camera", "camera": 1, "translation": [0, 3.8, 8], "rotation": [-0.21644, 0, 0, 0.97630]},
        {"name": "Point key", "translation": [2.5, 4, 3], "extensions": {"KHR_lights_punctual": {"light": 0}}},
        {"name": "Spot fill", "translation": [-2.5, 5, 2], "rotation": [-0.382683, 0, 0, 0.92388], "extensions": {"KHR_lights_punctual": {"light": 1}}},
    ], "scenes": [{"nodes": [0, 1, 2, 3, 4, 5]}], "scene": 0,
    "animations": [
        {"name": "Turntable", "samplers": [{"input": 4, "output": 5}],
         "channels": [{"sampler": 0, "target": {"node": 0, "path": "rotation"}}]},
        {"name": "Bob", "samplers": [{"input": 4, "output": 6}],
         "channels": [{"sampler": 0, "target": {"node": 0, "path": "translation"}}]},
    ],
}
json_data = json.dumps(doc, separators=(",", ":")).encode()
json_data += b" " * (-len(json_data) % 4)
binary.extend(b"\0" * (-len(binary) % 4))
total = 12 + 8 + len(json_data) + 8 + len(binary)
glb = (struct.pack("<III", 0x46546C67, 2, total) +
       struct.pack("<II", len(json_data), 0x4E4F534A) + json_data +
       struct.pack("<II", len(binary), 0x004E4942) + binary)
(HERE / "sample.glb").write_bytes(glb)
