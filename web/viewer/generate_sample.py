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
    ],
    "images": [{"bufferView": 4, "mimeType": "image/jpeg"}],
    "textures": [{"source": 0}],
    "materials": [{"pbrMetallicRoughness": {"baseColorTexture": {"index": 0}, "metallicFactor": 0.05, "roughnessFactor": 0.35}}],
    "meshes": [{"primitives": [{"attributes": {"POSITION": 0, "NORMAL": 1, "TEXCOORD_0": 2}, "indices": 3, "material": 0}]}],
    "nodes": [{"mesh": 0}], "scenes": [{"nodes": [0]}], "scene": 0,
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
