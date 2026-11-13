import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { loadGLTF, loadImage, pickNode, isNodeHandleValid, isMeshHandleValid, isTextureHandleValid, isMaterialHandleValid, setOutputColorSpace, setToneMapping, setFXAA, AssetError } from './assets.js';

const binary = new ArrayBuffer(78);
const view = new DataView(binary);
const positions = [-1,-1,0, 1,-1,0, 0,1,0];
const normals = [0,0,1, 0,0,1, 0,0,1];
positions.forEach((n, i) => view.setFloat32(i * 4, n, true));
normals.forEach((n, i) => view.setFloat32(36 + i * 4, n, true));
[0,1,2].forEach((n, i) => view.setUint16(72 + i * 2, n, true));
const doc = {
  asset: { version: '2.0' }, buffers: [{ byteLength: 78, uri: 'mesh.bin' }],
  bufferViews: [{ buffer: 0, byteLength: 36 }, { buffer: 0, byteOffset: 36, byteLength: 36 }, { buffer: 0, byteOffset: 72, byteLength: 6 }],
  accessors: [{ bufferView: 0, componentType: 5126, count: 3, type: 'VEC3' }, { bufferView: 1, componentType: 5126, count: 3, type: 'VEC3' }, { bufferView: 2, componentType: 5123, count: 3, type: 'SCALAR' }],
  materials: [{ pbrMetallicRoughness: { baseColorFactor: [0.25, 0.5, 1, 0.5] } }],
  meshes: [{ primitives: [{ attributes: { POSITION: 0, NORMAL: 1 }, indices: 2, material: 0 }] }],
  nodes: [{ translation: [2, 3, 4], mesh: 0 }], scenes: [{ nodes: [0] }], scene: 0,
};
const bytes = value => new TextEncoder().encode(JSON.stringify(value));
function glb(document, data) {
  const json = bytes(document), jsonSize = (json.length + 3) & ~3, binSize = (data.byteLength + 3) & ~3;
  const result = new ArrayBuffer(12 + 8 + jsonSize + 8 + binSize), out = new DataView(result), u8 = new Uint8Array(result);
  out.setUint32(0, 0x46546c67, true); out.setUint32(4, 2, true); out.setUint32(8, result.byteLength, true);
  out.setUint32(12, jsonSize, true); out.setUint32(16, 0x4e4f534a, true);
  u8.fill(32, 20, 20 + jsonSize); u8.set(json, 20);
  const at = 20 + jsonSize;
  out.setUint32(at, binSize, true); out.setUint32(at + 4, 0x004e4942, true); u8.set(new Uint8Array(data), at + 8);
  return result;
}
const glbDoc = structuredClone(doc); delete glbDoc.buffers[0].uri;
const resources = new Map([['http://localhost/model.gltf', bytes(doc)], ['http://localhost/mesh.bin', binary], ['http://localhost/model.glb', glb(glbDoc, binary)], ['http://localhost/image.png', new Uint8Array([1])]]);
const multiSceneDoc = structuredClone(doc);
multiSceneDoc.nodes.push({ translation: [9, 8, 7], mesh: 0 });
multiSceneDoc.scenes = [{ nodes: [0] }, { nodes: [1] }];
resources.set('http://localhost/multi-scene.gltf', bytes(multiSceneDoc));
const cameraDoc = structuredClone(doc);
cameraDoc.cameras = [
  { name: 'Perspective', type: 'perspective', perspective: { yfov: 0.75, znear: 0.2, zfar: 90, aspectRatio: 1.5 } },
  { name: 'Ortho', type: 'orthographic', orthographic: { xmag: 8, ymag: 4, znear: 0.1, zfar: 80 } },
];
cameraDoc.nodes = [{ translation: [2, 3, 4], camera: 0, children: [1] }, { translation: [0, 0, 2], camera: 1 }];
cameraDoc.scenes = [{ nodes: [0] }];
resources.set('http://localhost/cameras.gltf', bytes(cameraDoc));
const badCameraDoc = structuredClone(cameraDoc);
badCameraDoc.cameras[0].perspective.yfov = 0;
resources.set('http://localhost/bad-camera.gltf', bytes(badCameraDoc));
const punctualDoc = structuredClone(doc);
punctualDoc.extensionsUsed = ['KHR_lights_punctual'];
punctualDoc.extensions = { KHR_lights_punctual: { lights: [
  { name: 'Sun', type: 'directional', color: [1, 0.5, 0.25], intensity: 2 },
  { name: 'Lamp', type: 'point', color: [0.25, 0.5, 1], intensity: 3 },
  { name: 'Spot', type: 'spot', range: 15, spot: { innerConeAngle: 0.1, outerConeAngle: 0.6 } },
] } };
punctualDoc.nodes = [
  { translation: [0, 1, 0], extensions: { KHR_lights_punctual: { light: 0 } } },
  { translation: [2, 3, 4], extensions: { KHR_lights_punctual: { light: 1 } } },
  { translation: [0, 0, 5], extensions: { KHR_lights_punctual: { light: 2 } } },
];
punctualDoc.scenes = [{ nodes: [0, 1, 2] }];
resources.set('http://localhost/punctual.gltf', bytes(punctualDoc));
const tooManyLightsDoc = structuredClone(punctualDoc);
tooManyLightsDoc.nodes.push({ extensions: { KHR_lights_punctual: { light: 0 } } }, { extensions: { KHR_lights_punctual: { light: 1 } } });
tooManyLightsDoc.scenes[0].nodes.push(3, 4);
resources.set('http://localhost/too-many-lights.gltf', bytes(tooManyLightsDoc));
const variantDoc = structuredClone(doc);
variantDoc.extensionsUsed = ['KHR_materials_variants'];
variantDoc.extensionsRequired = ['KHR_materials_variants'];
variantDoc.extensions = { KHR_materials_variants: { variants: [{ name: 'Blue' }, { name: 'Red' }] } };
variantDoc.materials[0].name = 'Default paint';
variantDoc.materials.push({ name: 'Blue paint', pbrMetallicRoughness: { baseColorFactor: [0, 0, 1, 1], metallicFactor: 0.4, roughnessFactor: 0.2 } });
variantDoc.meshes[0].primitives[0].extensions = { KHR_materials_variants: { mappings: [{ material: 1, variants: [0] }] } };
resources.set('http://localhost/variants.gltf', bytes(variantDoc));
resources.set('http://localhost/oversized-glb-padding.glb', glb(glbDoc, new ArrayBuffer(84)));
const missingGlbBuffer = structuredClone(glbDoc); delete missingGlbBuffer.buffers;
resources.set('http://localhost/unreferenced-glb-bin.glb', glb(missingGlbBuffer, binary));
const glbUriBuffer = structuredClone(glbDoc); glbUriBuffer.buffers[0].uri = 'mesh.bin';
resources.set('http://localhost/glb-bin-with-uri.glb', glb(glbUriBuffer, binary));
const tangentBinary = new ArrayBuffer(48), tangentData = new DataView(tangentBinary);
for (let i = 0; i < 3; i++) [0, 1, 0, -1].forEach((value, component) => tangentData.setFloat32(i * 16 + component * 4, value, true));
const tangentDoc = structuredClone(doc);
tangentDoc.buffers.push({ byteLength: tangentBinary.byteLength, uri: 'tangent.bin' });
const tangentView = tangentDoc.bufferViews.push({ buffer: 1, byteLength: tangentBinary.byteLength }) - 1;
const tangentAccessor = tangentDoc.accessors.push({ bufferView: tangentView, componentType: 5126, count: 3, type: 'VEC4' }) - 1;
tangentDoc.meshes[0].primitives[0].attributes.TANGENT = tangentAccessor;
resources.set('http://localhost/tangent.gltf', bytes(tangentDoc));
resources.set('http://localhost/tangent.bin', tangentBinary);
function sparseFixture(name, { base = false, badIndex = false } = {}) {
  const sparseBinary = new ArrayBuffer(16), sparseData = new DataView(sparseBinary);
  sparseData.setUint8(0, badIndex ? 3 : 1);
  [2, -1, 0].forEach((value, i) => sparseData.setFloat32(4 + i * 4, value, true));
  const document = structuredClone(doc);
  document.buffers.push({ byteLength: sparseBinary.byteLength, uri: `${name}.bin` });
  const indexView = document.bufferViews.push({ buffer: 1, byteLength: 1 }) - 1;
  const valueView = document.bufferViews.push({ buffer: 1, byteOffset: 4, byteLength: 12 }) - 1;
  document.accessors[0].sparse = { count: 1, indices: { bufferView: indexView, componentType: 5121 }, values: { bufferView: valueView } };
  if (!base) delete document.accessors[0].bufferView;
  resources.set(`http://localhost/${name}.bin`, sparseBinary);
  return document;
}
for (const [name, options] of [
  ['sparse-zero-base', {}],
  ['sparse-base-override', { base: true }],
]) {
  resources.set(`http://localhost/${name}.gltf`, bytes(sparseFixture(name, options)));
}
resources.set('http://localhost/bad-sparse.gltf', bytes(sparseFixture('bad-sparse', { badIndex: true })));
resources.set('http://localhost/sample.glb', await readFile(new URL('./viewer/sample.glb', import.meta.url)));
const skinChunks = [], skinViews = [], skinAccessors = [];
let skinByteLength = 0;
function addSkinAccessor(values, componentType, type, write, componentBytes) {
  skinByteLength = (skinByteLength + componentBytes - 1) & ~(componentBytes - 1);
  const offset = skinByteLength, buffer = new ArrayBuffer(values.length * componentBytes), data = new DataView(buffer);
  values.forEach((value, i) => write(data, i * componentBytes, value));
  skinChunks.push({ offset, bytes: new Uint8Array(buffer) });
  skinByteLength += buffer.byteLength;
  const bufferView = skinViews.push({ buffer: 0, byteOffset: offset, byteLength: buffer.byteLength }) - 1;
  const components = { SCALAR: 1, VEC3: 3, VEC4: 4, MAT4: 16 }[type];
  return skinAccessors.push({ bufferView, componentType, count: values.length / components, type }) - 1;
}
const skinPosition = addSkinAccessor(positions, 5126, 'VEC3', (d, o, x) => d.setFloat32(o, x, true), 4);
const skinNormal = addSkinAccessor(normals, 5126, 'VEC3', (d, o, x) => d.setFloat32(o, x, true), 4);
const skinJoints = addSkinAccessor(Array(12).fill(0), 5121, 'VEC4', (d, o, x) => d.setUint8(o, x), 1);
const skinWeights = addSkinAccessor([1,0,0,0, 1,0,0,0, 1,0,0,0], 5126, 'VEC4', (d, o, x) => d.setFloat32(o, x, true), 4);
const skinIndices = addSkinAccessor([0,1,2], 5123, 'SCALAR', (d, o, x) => d.setUint16(o, x, true), 2);
const inverseBind = addSkinAccessor([1,0,0,0, 0,1,0,0, 0,0,1,0, 0,0,0,1], 5126, 'MAT4', (d, o, x) => d.setFloat32(o, x, true), 4);
const skinTimes = addSkinAccessor([0,1], 5126, 'SCALAR', (d, o, x) => d.setFloat32(o, x, true), 4);
const skinTranslation = addSkinAccessor([0,0,0, 1,0,0], 5126, 'VEC3', (d, o, x) => d.setFloat32(o, x, true), 4);
const skinTangent = addSkinAccessor([0,1,0,-1, 0,1,0,-1, 0,1,0,-1], 5126, 'VEC4', (d, o, x) => d.setFloat32(o, x, true), 4);
const skinTangentDelta = addSkinAccessor([1,0,0, 1,0,0, 1,0,0], 5126, 'VEC3', (d, o, x) => d.setFloat32(o, x, true), 4);
const skinRotation = addSkinAccessor([0,0,0,1, 0,0,Math.SQRT1_2,Math.SQRT1_2], 5126, 'VEC4', (d, o, x) => d.setFloat32(o, x, true), 4);
const skinBinary = new ArrayBuffer(skinByteLength), skinBytes = new Uint8Array(skinBinary);
for (const chunk of skinChunks) skinBytes.set(chunk.bytes, chunk.offset);
const skinDoc = {
  asset: { version: '2.0' }, buffers: [{ byteLength: skinByteLength, uri: 'skin.bin' }],
  bufferViews: skinViews, accessors: skinAccessors,
  meshes: [{ primitives: [{ attributes: { POSITION: skinPosition, NORMAL: skinNormal, TANGENT: skinTangent, JOINTS_0: skinJoints, WEIGHTS_0: skinWeights }, indices: skinIndices }] }],
  skins: [{ joints: [1], inverseBindMatrices: inverseBind }],
  nodes: [{ mesh: 0, skin: 0 }, {}], scenes: [{ nodes: [0,1] }], scene: 0,
  animations: [{ samplers: [{ input: skinTimes, output: skinTranslation }, { input: skinTimes, output: skinRotation }], channels: [
    { sampler: 0, target: { node: 1, path: 'translation' } },
    { sampler: 1, target: { node: 1, path: 'rotation' } },
  ] }],
};
resources.set('http://localhost/skinned.gltf', bytes(skinDoc));
resources.set('http://localhost/skin.bin', skinBinary);
const morphDoc = structuredClone(skinDoc);
morphDoc.meshes[0].primitives[0].attributes = { POSITION: skinPosition, NORMAL: skinNormal, TANGENT: skinTangent };
morphDoc.meshes[0].primitives[0].targets = [{ POSITION: skinPosition, NORMAL: skinNormal, TANGENT: skinTangentDelta }];
delete morphDoc.skins;
morphDoc.nodes = [{ mesh: 0 }];
morphDoc.scenes = [{ nodes: [0] }];
morphDoc.animations[0].channels = [morphDoc.animations[0].channels[0]];
morphDoc.animations[0].channels[0].target = { node: 0, path: 'weights' };
morphDoc.animations[0].samplers[0].output = skinTimes;
resources.set('http://localhost/morph.gltf', bytes(morphDoc));
resources.set('http://localhost/morph.bin', skinBinary);
const combinedMorphSkinDoc = structuredClone(skinDoc);
combinedMorphSkinDoc.meshes[0].primitives[0].targets = [{ POSITION: skinPosition, NORMAL: skinNormal }];
combinedMorphSkinDoc.meshes[0].weights = [0];
combinedMorphSkinDoc.nodes[0].weights = [0];
combinedMorphSkinDoc.animations[0].samplers.push({ input: skinTimes, output: skinTimes });
combinedMorphSkinDoc.animations[0].channels.push({ sampler: 2, target: { node: 0, path: 'weights' } });
resources.set('http://localhost/combined-morph-skin.gltf', bytes(combinedMorphSkinDoc));
resources.set('http://localhost/combined-morph-skin.bin', skinBinary);
const cubicMorphDoc = structuredClone(morphDoc), cubicWeights = new ArrayBuffer(24), cubicWeightView = new DataView(cubicWeights);
[0,0,2, 0,1,0].forEach((value, i) => cubicWeightView.setFloat32(i * 4, value, true));
cubicMorphDoc.buffers.push({ byteLength: cubicWeights.byteLength, uri: 'cubic-weights.bin' });
const cubicView = cubicMorphDoc.bufferViews.push({ buffer: 1, byteLength: cubicWeights.byteLength }) - 1;
const cubicAccessor = cubicMorphDoc.accessors.push({ bufferView: cubicView, componentType: 5126, count: 6, type: 'SCALAR' }) - 1;
cubicMorphDoc.animations[0].samplers[0].interpolation = 'CUBICSPLINE';
cubicMorphDoc.animations[0].samplers[0].output = cubicAccessor;
resources.set('http://localhost/cubic-morph.gltf', bytes(cubicMorphDoc));
resources.set('http://localhost/cubic-weights.bin', cubicWeights);
const defaultMorphDoc = structuredClone(morphDoc);
defaultMorphDoc.meshes[0].weights = [0.25];
defaultMorphDoc.nodes[0].weights = [0.5];
defaultMorphDoc.animations = [];
resources.set('http://localhost/default-morph.gltf', bytes(defaultMorphDoc));
resources.set('http://localhost/default-morph.bin', skinBinary);
const largeMorphDoc = structuredClone(morphDoc);
largeMorphDoc.meshes[0].primitives[0].targets = Array.from({ length: 65 }, () => ({ POSITION: skinPosition }));
largeMorphDoc.meshes[0].weights = Array(65).fill(0);
largeMorphDoc.animations = [];
resources.set('http://localhost/large-morph.gltf', bytes(largeMorphDoc));
resources.set('http://localhost/large-morph.bin', skinBinary);
const quantizedMorphDoc = structuredClone(morphDoc), quantizedWeights = new ArrayBuffer(2), quantizedView = new DataView(quantizedWeights);
quantizedView.setInt8(0, 0); quantizedView.setInt8(1, 127);
quantizedMorphDoc.buffers.push({ byteLength: quantizedWeights.byteLength, uri: 'quantized-weights.bin' });
const quantizedBufferView = quantizedMorphDoc.bufferViews.push({ buffer: 1, byteLength: quantizedWeights.byteLength }) - 1;
const quantizedAccessor = quantizedMorphDoc.accessors.push({ bufferView: quantizedBufferView, componentType: 5120, normalized: true, count: 2, type: 'SCALAR' }) - 1;
quantizedMorphDoc.animations[0].samplers[0].output = quantizedAccessor;
resources.set('http://localhost/quantized-morph.gltf', bytes(quantizedMorphDoc));
resources.set('http://localhost/quantized-weights.bin', quantizedWeights);
globalThis.fetch = async url => resources.has(String(url)) ? new Response(resources.get(String(url))) : new Response('', { status: 404 });
let rejectWebpDecode = false;
globalThis.createImageBitmap = async blob => {
  const marker = new Uint8Array(await blob.arrayBuffer())[0] || 1;
  if (rejectWebpDecode && marker === 2) throw new Error('WebP decoding unavailable');
  return { width: marker % 16 + 1, height: 1, marker, close() {} };
};
globalThis.document = { createElement: () => {
  let pixel = 255;
  return { getContext: () => ({ drawImage: bitmap => { pixel = bitmap.marker; },
    getImageData: (_x, _y, width, height) => ({ data: new Uint8Array(width * height * 4).fill(pixel) }) }) };
} };

const quantizedBinary = new ArrayBuffer(114), quantizedData = new DataView(quantizedBinary);
[-1,-1,0, 1,-1,0, 0,1,0].forEach((value, index) => quantizedData.setInt16(Math.floor(index / 3) * 8 + (index % 3) * 2, value, true));
for (let vertex = 0; vertex < 3; vertex++) {
  quantizedData.setInt8(24 + vertex * 4 + 2, 127);
  [-32768,0, 32767,0, 0,32767].slice(vertex * 2, vertex * 2 + 2).forEach((value, axis) => quantizedData.setInt16(36 + vertex * 4 + axis * 2, value, true));
  quantizedData.setInt8(48 + vertex * 4, 127);
  quantizedData.setInt8(48 + vertex * 4 + 3, 127);
  quantizedData.setInt16(60 + vertex * 8 + 2, 1, true);
  [0,1,2,3].forEach(component => {
    quantizedData.setInt8(84 + vertex * 4 + component, 0);
    quantizedData.setInt8(96 + vertex * 4 + component, 0);
  });
}
[0,1,2].forEach((value, index) => quantizedData.setUint16(108 + index * 2, value, true));
const quantizedDoc = {
  asset: { version: '2.0' }, extensionsUsed: ['KHR_mesh_quantization'], extensionsRequired: ['KHR_mesh_quantization'],
  buffers: [{ byteLength: quantizedBinary.byteLength, uri: 'quantized.bin' }],
  bufferViews: [
    { buffer: 0, byteLength: 24, byteStride: 8 }, { buffer: 0, byteOffset: 24, byteLength: 12, byteStride: 4 },
    { buffer: 0, byteOffset: 36, byteLength: 12, byteStride: 4 }, { buffer: 0, byteOffset: 48, byteLength: 12, byteStride: 4 },
    { buffer: 0, byteOffset: 60, byteLength: 24, byteStride: 8 }, { buffer: 0, byteOffset: 84, byteLength: 12, byteStride: 4 },
    { buffer: 0, byteOffset: 96, byteLength: 12, byteStride: 4 }, { buffer: 0, byteOffset: 108, byteLength: 6 },
  ],
  accessors: [
    { bufferView: 0, componentType: 5122, count: 3, type: 'VEC3', min: [-1,-1,0], max: [1,1,0] },
    { bufferView: 1, componentType: 5120, normalized: true, count: 3, type: 'VEC3' },
    { bufferView: 2, componentType: 5122, count: 3, type: 'VEC2' },
    { bufferView: 3, componentType: 5120, normalized: true, count: 3, type: 'VEC4' },
    { bufferView: 4, componentType: 5122, count: 3, type: 'VEC3' },
    { bufferView: 5, componentType: 5120, normalized: true, count: 3, type: 'VEC3' },
    { bufferView: 6, componentType: 5120, normalized: true, count: 3, type: 'VEC3' },
    { bufferView: 7, componentType: 5123, count: 3, type: 'SCALAR' },
  ],
  meshes: [{ weights: [1], primitives: [{ attributes: { POSITION: 0, NORMAL: 1, TEXCOORD_0: 2, TANGENT: 3 }, indices: 7,
    targets: [{ POSITION: 4, NORMAL: 5, TANGENT: 6 }] }] }],
  nodes: [{ name: 'Quantized root', mesh: 0, children: [1] }, { name: 'Marker' }, { name: 'Outside scene' }],
  scenes: [{ nodes: [0] }, { nodes: [2] }], scene: 0,
};
resources.set('http://localhost/quantized.gltf', bytes(quantizedDoc));
resources.set('http://localhost/quantized.bin', quantizedBinary);

for (const [name, expected] of [
  ['sparse-zero-base', [0, 0, 0, 2, -1, 0, 0, 0, 0]],
  ['sparse-base-override', [-1, -1, 0, 2, -1, 0, 0, 1, 0]],
]) {
  const sparseEngine = fakeEngine(), sparseModel = await loadGLTF(sparseEngine, `http://localhost/${name}.gltf`);
  assert.deepEqual(sparseEngine.calls.filter(call => call[0] === 'vertex').flatMap(call => call.slice(1, 4)), expected);
  sparseModel.dispose();
}
const quantizedEngine = fakeEngine(), quantizedModel = await loadGLTF(quantizedEngine, 'http://localhost/quantized.gltf');
assert.deepEqual(quantizedModel.nodes.map(({ index, name, parent, children, mesh, camera, light, skin }) => ({ index, name, parent, children, mesh, camera, light, skin })), [
  { index: 0, name: 'Quantized root', parent: null, children: [1], mesh: 0, camera: null, light: null, skin: null },
  { index: 1, name: 'Marker', parent: 0, children: [], mesh: null, camera: null, light: null, skin: null },
], 'model inspection lists the selected scene hierarchy with mesh and skin references');
assert.ok(isNodeHandleValid(quantizedEngine, quantizedModel.nodes[0].handle), 'inspected node metadata carries a checked node handle');
assert.equal(quantizedModel.nodes[0].primitives.length, 1, 'node inspection exposes handles for each mesh primitive');
assert.ok(isNodeHandleValid(quantizedEngine, quantizedModel.nodes[0].primitives[0]), 'primitive handles are checked node handles');
const quantizedVertex = quantizedEngine.calls.find(call => call[0] === 'vertex');
assert.deepEqual(quantizedVertex.slice(1, 4), [-1, -1, 0], 'quantized integer positions retain their specified values');
assert.deepEqual(quantizedVertex.slice(4, 7), [0, 0, 1], 'normalized quantized normals decode to floats');
assert.deepEqual(quantizedVertex.slice(7, 9), [-32768, 0], 'unnormalized quantized texture coordinates preserve their values');
assert.deepEqual(quantizedVertex.slice(23, 27), [1, 0, 0, 1], 'normalized quantized tangents retain handedness');
const quantizedUpdate = quantizedEngine.calls.find(call => call[0] === 'mesh_update');
assert.deepEqual(quantizedUpdate[2], [-1,0,0, 1,0,0, 0,2,0],
  'quantized morph position deltas apply through the CPU deformation path');
assert.deepEqual(quantizedUpdate[3], [0,0,1, 0,0,1, 0,0,1], 'quantized morph normals decode and normalize');
assert.deepEqual(quantizedUpdate[4], [1,0,0,1, 1,0,0,1, 1,0,0,1], 'quantized morph tangents preserve their base handedness');
quantizedModel.dispose();
assert.ok(!isNodeHandleValid(quantizedEngine, quantizedModel.nodes[0].primitives[0]), 'disposing the model invalidates inspected primitive handles');
const undeclaredQuantizedDoc = structuredClone(quantizedDoc);
undeclaredQuantizedDoc.extensionsRequired = [];
resources.set('http://localhost/undeclared-quantized.gltf', bytes(undeclaredQuantizedDoc));
const undeclaredQuantizedEngine = fakeEngine();
await assert.rejects(loadGLTF(undeclaredQuantizedEngine, 'http://localhost/undeclared-quantized.gltf'), error => error.code === 'INVALID_GLTF');
assert.equal(undeclaredQuantizedEngine.calls.length, 0, 'quantized attributes require the extension before allocating resources');
const invalidQuantizedDoc = structuredClone(quantizedDoc);
invalidQuantizedDoc.accessors[1].componentType = 5121;
resources.set('http://localhost/invalid-quantized.gltf', bytes(invalidQuantizedDoc));
const invalidQuantizedEngine = fakeEngine();
await assert.rejects(loadGLTF(invalidQuantizedEngine, 'http://localhost/invalid-quantized.gltf'), error => error.code === 'INVALID_GLTF');
assert.equal(invalidQuantizedEngine.calls.length, 0, 'unsupported quantized normal encodings are rejected before allocation');
const tangentEngine = fakeEngine(), tangentModel = await loadGLTF(tangentEngine, 'http://localhost/tangent.gltf');
assert.deepEqual(tangentEngine.calls.find(call => call[0] === 'vertex').slice(-8, -4), [0, 1, 0, -1], 'authored tangent and handedness reach the vertex upload');
const colorBinary = new ArrayBuffer(36), colorView = new DataView(colorBinary);
[[1,0,0],[0,1,0],[0,0,1]].flat().forEach((value, i) => colorView.setFloat32(i * 4, value, true));
const colorDoc = structuredClone(doc);
colorDoc.buffers.push({ byteLength: colorBinary.byteLength, uri: 'colors.bin' });
const colorBufferView = colorDoc.bufferViews.push({ buffer: 1, byteLength: colorBinary.byteLength }) - 1;
const colorAccessor = colorDoc.accessors.push({ bufferView: colorBufferView, componentType: 5126, count: 3, type: 'VEC3' }) - 1;
colorDoc.meshes[0].primitives[0].attributes.COLOR_0 = colorAccessor;
resources.set('http://localhost/vertex-colors.gltf', bytes(colorDoc));
resources.set('http://localhost/colors.bin', colorBinary);
const colorEngine = fakeEngine(), colorModel = await loadGLTF(colorEngine, 'http://localhost/vertex-colors.gltf');
assert.deepEqual(colorEngine.calls.filter(call => call[0] === 'vertex').map(call => call.slice(-4)),
  [[1,0,0,1],[0,1,0,1],[0,0,1,1]], 'COLOR_0 VEC3 is uploaded with opaque alpha');
colorModel.dispose();
const normalizedColors = new Uint8Array([255,0,0,255, 0,255,0,255, 0,0,255,255]);
const normalizedColorDoc = structuredClone(doc);
normalizedColorDoc.buffers.push({ byteLength: normalizedColors.byteLength, uri: 'normalized-colors.bin' });
const normalizedColorView = normalizedColorDoc.bufferViews.push({ buffer: 1, byteLength: normalizedColors.byteLength }) - 1;
const normalizedColorAccessor = normalizedColorDoc.accessors.push({ bufferView: normalizedColorView, componentType: 5121,
  normalized: true, count: 3, type: 'VEC4' }) - 1;
normalizedColorDoc.meshes[0].primitives[0].attributes.COLOR_0 = normalizedColorAccessor;
resources.set('http://localhost/normalized-vertex-colors.gltf', bytes(normalizedColorDoc));
resources.set('http://localhost/normalized-colors.bin', normalizedColors.buffer);
const normalizedColorEngine = fakeEngine(), normalizedColorModel = await loadGLTF(normalizedColorEngine, 'http://localhost/normalized-vertex-colors.gltf');
assert.deepEqual(normalizedColorEngine.calls.filter(call => call[0] === 'vertex').map(call => call.slice(-4)),
  [[1,0,0,1],[0,1,0,1],[0,0,1,1]], 'normalized unsigned-byte COLOR_0 values decode to linear floats');
normalizedColorModel.dispose();
const invalidColorDoc = structuredClone(normalizedColorDoc);
delete invalidColorDoc.accessors[normalizedColorAccessor].normalized;
resources.set('http://localhost/invalid-vertex-colors.gltf', bytes(invalidColorDoc));
const invalidColorEngine = fakeEngine();
await assert.rejects(loadGLTF(invalidColorEngine, 'http://localhost/invalid-vertex-colors.gltf'), error => error.code === 'INVALID_GLTF');
assert.equal(invalidColorEngine.calls.length, 0, 'invalid COLOR_0 format fails before creating engine resources');
tangentModel.dispose();
const badTangentDoc = structuredClone(tangentDoc);
badTangentDoc.accessors[tangentAccessor].type = 'VEC3';
resources.set('http://localhost/bad-tangent.gltf', bytes(badTangentDoc));
await assert.rejects(loadGLTF(fakeEngine(), 'http://localhost/bad-tangent.gltf'), error => error.code === 'INVALID_GLTF');
const badTangentHandedness = structuredClone(tangentDoc), badTangentBytes = tangentBinary.slice(0);
new DataView(badTangentBytes).setFloat32(12, 0, true);
badTangentHandedness.buffers[1].uri = 'bad-tangent.bin';
resources.set('http://localhost/bad-tangent-handedness.gltf', bytes(badTangentHandedness));
resources.set('http://localhost/bad-tangent.bin', badTangentBytes);
await assert.rejects(loadGLTF(fakeEngine(), 'http://localhost/bad-tangent-handedness.gltf'), error => error.code === 'INVALID_GLTF');
const rejectedSparseEngine = fakeEngine();
await assert.rejects(loadGLTF(rejectedSparseEngine, 'http://localhost/bad-sparse.gltf'), error => error.code === 'INVALID_GLTF');
assert.equal(rejectedSparseEngine.calls.length, 0, 'invalid sparse accessors fail before creating engine resources');

function fakeEngine() {
  const calls = [], memory = new ArrayBuffer(1 << 20), engine = { calls, HEAPU8: new Uint8Array(memory), HEAPF32: new Float32Array(memory) };
  for (const name of ['mesh_begin','vertex','triangle','matrix','node_material']) engine['_g3_asset_' + name] = (...args) => calls.push([name, ...args]);
  let next = 0, nextTexture = 5, nextMesh = 7, nextMaterial = 1;
  const generations = new Map();
  const meshGenerations = new Map(), textureGenerations = new Map(), materialGenerations = new Map();
  engine.generations = generations;
  engine.meshGenerations = meshGenerations; engine.textureGenerations = textureGenerations;
  engine.materialGenerations = materialGenerations;
  engine._g3_asset_material = (...args) => { const id = nextMaterial++; materialGenerations.set(id, 1); calls.push(['material', id, ...args]); return id; };
  engine._g3_asset_material_specular = (...args) => { calls.push(['material_specular', ...args]); return true; };
  engine._g3_asset_material_clearcoat = (...args) => { calls.push(['material_clearcoat', ...args]); return true; };
  engine._g3_asset_material_uv_transform = (...args) => { calls.push(['material_uv_transform', ...args]); return true; };
  engine._g3_asset_mesh_end = () => { calls.push(['mesh_end']); const id = nextMesh++; meshGenerations.set(id, 1); return id; };
  engine._g3_host_mesh_update = (id, positions, normals, tangents, count) => {
    calls.push(['mesh_update', id, [...engine.HEAPF32.slice(positions >>> 2, (positions >>> 2) + count)],
      [...engine.HEAPF32.slice(normals >>> 2, (normals >>> 2) + count)],
      [...engine.HEAPF32.slice(tangents >>> 2, (tangents >>> 2) + count / 3 * 4)]]);
    return 1;
  };
  engine._g3_host_mesh_update_cpu = (id, positions, normals, tangents, count) => {
    calls.push(['mesh_update_cpu', id, [...engine.HEAPF32.slice(positions >>> 2, (positions >>> 2) + count)],
      [...engine.HEAPF32.slice(normals >>> 2, (normals >>> 2) + count)],
      [...engine.HEAPF32.slice(tangents >>> 2, (tangents >>> 2) + count / 3 * 4)]]);
    return 1;
  };
  engine._g3_host_mesh_skin = (id, ptr, count, joints) => {
    calls.push(['mesh_skin', id, [...engine.HEAPF32.slice(ptr >>> 2, (ptr >>> 2) + count)], joints]);
    return 1;
  };
  engine._g3_host_joint_palette = (id, ptr, joints) => {
    calls.push(['joint_palette', id, [...engine.HEAPF32.slice(ptr >>> 2, (ptr >>> 2) + joints * 16)], joints]);
    return 1;
  };
  engine._g3_asset_node = (...args) => { calls.push(['node', ...args]); const id = next++; generations.set(id, 1); return id; };
  engine._g3_asset_texture = () => { const id = nextTexture++; textureGenerations.set(id, 1); return id; };
  engine._g3_host_texture = (...args) => calls.push(['texture', ...args]);
  engine._g3_host_texture_srgb = (...args) => calls.push(['texture_srgb', ...args]);
  engine._g3_host_texture_wrap = (...args) => calls.push(['wrap', ...args]);
  engine._g3_host_texture_filter = (...args) => calls.push(['filter', ...args]);
  for (const [kind, slots] of [['mesh', meshGenerations], ['texture', textureGenerations], ['material', materialGenerations]]) {
    engine[`_g3_asset_${kind}_generation`] = id => slots.get(id) || 0;
    engine[`_g3_asset_${kind}_valid`] = (id, generation) => slots.get(id) === generation;
    engine[`_g3_asset_release_${kind}`] = (id, generation) => {
      if (slots.get(id) !== generation) return 0;
      slots.delete(id); calls.push([`recycle_${kind}`, id]); return 1;
    };
  }
  engine._g3_asset_scene_epoch = () => engine.epoch || 0;
  let nextCamera = 10;
  engine.activeCamera = -1;
  engine._g3_asset_camera_add = (...args) => { const id = nextCamera++; calls.push(['camera_add', id, ...args]); return id; };
  engine._g3_asset_camera_add_current = () => { const id = nextCamera++; calls.push(['camera_add_current', id]); if (engine.activeCamera < 0) engine.activeCamera = id; return id; };
  engine._g3_asset_camera_update = (...args) => { calls.push(['camera_update', ...args]); return true; };
  engine._g3_asset_camera_active = () => engine.activeCamera;
  engine._g3_asset_camera_select = id => { calls.push(['camera_select', id]); engine.activeCamera = id; return true; };
  engine._g3_asset_camera_remove = id => { calls.push(['camera_remove', id]); if (engine.activeCamera === id) engine.activeCamera = -1; return true; };
  let nextLightLease = 0;
  const lightSets = new Map();
  engine.activeLightSet = -1;
  engine.activeLights = [];
  engine._g3_asset_lights_begin = () => {
    const id = nextLightLease++;
    lightSets.set(id, { previous: engine.activeLightSet, removed: false, previousLights: [...engine.activeLights] });
    engine.activeLightSet = id; engine.activeLights = []; calls.push(['lights_begin', id]); return id;
  };
  engine._g3_asset_lights_active = () => engine.activeLightSet;
  engine._g3_asset_lights_clear = () => { engine.activeLights = []; calls.push(['lights_clear']); };
  engine._g3_asset_lights_release = id => {
    const state = lightSets.get(id); if (!state || state.removed) return false;
    state.removed = true; calls.push(['lights_release', id]);
    if (engine.activeLightSet === id) {
      let restore = id, previous = state.previous;
      while (previous >= 0 && lightSets.get(previous)?.removed) { restore = previous; previous = lightSets.get(previous).previous; }
      engine.activeLightSet = previous; engine.activeLights = [...lightSets.get(restore).previousLights];
    }
    return true;
  };
  for (const [name, args] of [['directional', 6], ['point', 7], ['spot', 12]]) engine[`_g3_asset_light_${name}`] = (...values) => {
    calls.push([`light_${name}`, ...values]); engine.activeLights.push([name, ...values]); return values.length === args;
  };
  engine._g3_asset_node_generation = id => generations.get(id) || 0;
  engine._g3_asset_node_valid = (id, generation, epoch) => epoch === (engine.epoch || 0) && generations.get(id) === generation;
  engine._g3_asset_node_release = (id, generation, epoch) => {
    if (!engine._g3_asset_node_valid(id, generation, epoch)) return 0;
    calls.push(['hide', id]); generations.delete(id); return 1;
  };
  engine._g3_asset_pick = (...args) => { calls.push(['pick', ...args]); return engine.picked ?? -1; };
  engine._g3_asset_output_srgb = value => calls.push(['output_srgb', value]);
  engine._g3_asset_tone_mapping = value => { calls.push(['tone_mapping', value]); return value >= 0 && value <= 2; };
  engine._g3_asset_fxaa = value => calls.push(['fxaa', value]);
  let heapCursor = 16;
  engine._malloc = size => { const ptr = heapCursor; heapCursor = (heapCursor + size + 7) & ~7; return ptr; };
  engine._free = () => {};
  return engine;
}

const cameraEngine = fakeEngine(), cameraModel = await loadGLTF(cameraEngine, 'http://localhost/cameras.gltf');
assert.deepEqual(cameraModel.cameras, [
  { index: 0, name: 'Perspective', type: 'perspective', node: 0 },
  { index: 1, name: 'Ortho', type: 'orthographic', node: 1 },
]);
assert.equal(cameraModel.selectCamera(0), true);
assert.deepEqual(cameraEngine.calls.find(call => call[0] === 'camera_update').slice(0, 11),
  ['camera_update', 10, 2, 3, 4, 2, 3, 3, 0, 1, 0]);
assert.equal(cameraModel.activeCamera, 0);
assert.equal(cameraModel.selectCamera(null), true);
assert.equal(cameraModel.activeCamera, -1);
cameraModel.dispose();
assert.equal(cameraEngine.calls.some(call => call[0] === 'camera_remove' && call[1] === 10), true);
await assert.rejects(loadGLTF(fakeEngine(), 'http://localhost/bad-camera.gltf'), error => error.code === 'INVALID_GLTF');
const punctualEngine = fakeEngine(), punctualModel = await loadGLTF(punctualEngine, 'http://localhost/punctual.gltf');
assert.equal(punctualEngine.activeLightSet, -1, 'loading light metadata does not change the scene light set');
assert.deepEqual(punctualModel.lights.map(({ index, name, type, node, intensity, range, effectiveRange }) => ({ index, name, type, node, intensity, range, effectiveRange })), [
  { index: 0, name: 'Sun', type: 'directional', node: 0, intensity: 2, range: null, effectiveRange: null },
  { index: 1, name: 'Lamp', type: 'point', node: 1, intensity: 3, range: null, effectiveRange: 1000 },
  { index: 2, name: 'Spot', type: 'spot', node: 2, intensity: 1, range: 15, effectiveRange: 15 },
]);
assert.equal(punctualModel.applyLights(), true);
assert.deepEqual(punctualEngine.calls.find(call => call[0] === 'light_directional'), ['light_directional', 0, 0, -1, 2, 1, 0.5]);
assert.deepEqual(punctualEngine.calls.find(call => call[0] === 'light_point'), ['light_point', 2, 3, 4, 0.75, 1.5, 3, 1000]);
assert.deepEqual(punctualEngine.calls.find(call => call[0] === 'light_spot'), ['light_spot', 0, 0, 5, 0, 0, -1, 1, 1, 1, 15, 0.1, 0.6]);
assert.equal(punctualModel.lightsApplied, true);
punctualModel.dispose();
assert.equal(punctualEngine.activeLightSet, -1, 'disposing an applied light set restores the previous engine state');
const laterLightEngine = fakeEngine();
const earlierLightModel = await loadGLTF(laterLightEngine, 'http://localhost/punctual.gltf');
const laterLightModel = await loadGLTF(laterLightEngine, 'http://localhost/punctual.gltf');
assert.equal(earlierLightModel.applyLights(), true);
assert.equal(laterLightModel.applyLights(), true);
earlierLightModel.dispose();
laterLightModel.dispose();
assert.equal(laterLightEngine.activeLightSet, -1, 'disposing nested models restores the original light set without reviving a disposed model');
assert.equal(laterLightEngine.activeLights.length, 0);
await assert.rejects(loadGLTF(fakeEngine(), 'http://localhost/too-many-lights.gltf'), error => error.code === 'UNSUPPORTED');

function enableFakeGpuMorph(engine, { upload = true, skin = true } = {}) {
  engine._g3_host_mesh_morph = (id, positionsPtr, normalsPtr, tangentsPtr, vertexCount, targetCount) => {
    const length = vertexCount * targetCount * 3;
    engine.calls.push(['mesh_morph', id, vertexCount, targetCount,
      [...engine.HEAPF32.slice(positionsPtr >>> 2, (positionsPtr >>> 2) + length)],
      [...engine.HEAPF32.slice(normalsPtr >>> 2, (normalsPtr >>> 2) + length)],
      [...engine.HEAPF32.slice(tangentsPtr >>> 2, (tangentsPtr >>> 2) + length)]]);
    return upload ? 1 : 0;
  };
  engine._g3_host_morph_weights = (id, ptr, targetCount) => {
    engine.calls.push(['morph_weights', id, [...engine.HEAPF32.slice(ptr >>> 2, (ptr >>> 2) + targetCount)]]);
    return 1;
  };
  engine._g3_host_mesh_morph_release = id => engine.calls.push(['morph_release', id]);
  if (!skin) engine._g3_host_mesh_skin = () => 0;
  return engine;
}

for (const path of ['model.gltf', 'model.glb']) {
  const engine = fakeEngine(), model = await loadGLTF(engine, `http://localhost/${path}`);
  assert.equal(model.sceneIndex, 0);
  assert.deepEqual(model.roots, [{ index: 0, generation: 1, epoch: 0 }]);
  assert.equal(isNodeHandleValid(engine, model.roots[0]), true);
  assert.equal(isNodeHandleValid(fakeEngine(), model.roots[0]), false);
  assert.equal(isMeshHandleValid(engine, model.meshes[0]), true);
  assert.equal(isMeshHandleValid(fakeEngine(), model.meshes[0]), false);
  assert.equal(isMaterialHandleValid(engine, model.materials[0]), true);
  assert.equal(isMaterialHandleValid(fakeEngine(), model.materials[0]), false);
  assert.equal(engine.calls.filter(x => x[0] === 'vertex').length, 3);
  assert.deepEqual(engine.calls.find(x => x[0] === 'triangle'), ['triangle', 0, 1, 2]);
  assert.deepEqual(engine.calls.find(x => x[0] === 'material'), ['material', 1, 0.25, 0.5, 1, 1, -1, 0, 0.5, 1, 1, -1, -1, 1, -1, 1, 0, 0, 0, -1, 0, 0, 1.5]);
  assert.deepEqual(engine.calls.find(x => x[0] === 'matrix' && x[2] === 12), ['matrix', 0, 12, 2]);
  const canvas = { getBoundingClientRect: () => ({ left: 20, top: 10, right: 220, bottom: 110, width: 200, height: 100 }) };
  engine.picked = 1;
  const selected = model.pick(canvas, 120, 60);
  assert.equal(selected.index, 1);
  assert.equal(isNodeHandleValid(engine, selected), true);
  assert.deepEqual(engine.calls.find(x => x[0] === 'pick'), ['pick', 0, 0, 2]);
  engine.picked = 99;
  assert.equal(model.pick(canvas, 120, 60), null);
  assert.equal(pickNode(engine, canvas, 220, 60), null);
  model.dispose(); model.dispose();
  assert.equal(isMaterialHandleValid(engine, model.materials[0]), false);
  assert.equal(isMeshHandleValid(engine, model.meshes[0]), false);
  assert.equal(isNodeHandleValid(engine, selected), false);
  engine.generations.set(selected.index, 2);
  assert.equal(isNodeHandleValid(engine, selected), false);
  assert.equal(model.pick(canvas, 120, 60), null);
  assert.equal(engine.calls.filter(x => x[0] === 'hide').length, 2);
  assert.equal(engine.calls.filter(x => x[0] === 'recycle_mesh').length, 1);
}
const selectedSceneEngine = fakeEngine();
const selectedSceneModel = await loadGLTF(selectedSceneEngine, 'http://localhost/multi-scene.gltf', { scene: 1 });
assert.equal(selectedSceneModel.sceneIndex, 1);
assert.deepEqual(selectedSceneModel.roots, [{ index: 0, generation: 1, epoch: 0 }]);
assert.equal(selectedSceneEngine.calls.some(call => call[0] === 'matrix' && call[2] === 12 && call[3] === 9), true,
  'the requested scene supplies the loaded node hierarchy');
selectedSceneModel.dispose();
const invalidSceneEngine = fakeEngine();
await assert.rejects(loadGLTF(invalidSceneEngine, 'http://localhost/multi-scene.gltf', { scene: 2 }), error => error.code === 'INVALID_GLTF');
assert.equal(invalidSceneEngine.calls.length, 0, 'invalid scene indices fail before creating engine resources');
const variantEngine = fakeEngine();
const variantModel = await loadGLTF(variantEngine, 'http://localhost/variants.gltf');
assert.deepEqual(variantModel.variants, ['Blue', 'Red']);
const inspectedPrimitive = variantModel.nodes[0].primitiveMaterials[0];
assert.equal(inspectedPrimitive.default.name, 'Default paint');
assert.deepEqual(inspectedPrimitive.default.baseColorFactor, [0.25, 0.5, 1, 0.5]);
assert.equal(inspectedPrimitive.default.alphaMode, 'OPAQUE');
assert.deepEqual(inspectedPrimitive.variants, [{
  index: 0, name: 'Blue', material: {
    index: 1, name: 'Blue paint', baseColorFactor: [0, 0, 1, 1], metallicFactor: 0.4,
    roughnessFactor: 0.2, normalScale: 1, occlusionStrength: 1,
    alphaMode: 'OPAQUE', alphaCutoff: 0.5, emissiveFactor: [0, 0, 0],
    doubleSided: false, unlit: false, ior: 1.5, specularFactor: 1, specularColorFactor: [1, 1, 1],
    clearcoatFactor: 0, clearcoatRoughnessFactor: 0, clearcoatNormalScale: 1,
    textureSlots: [], textureBindings: [],
  },
}], 'primitive inspection includes default factors and mapped variant material metadata');
assert.equal(variantModel.activeVariant, -1);
assert.equal(variantModel.materials.length, 2);
assert.equal(variantModel.setVariant('Blue'), true);
assert.equal(variantModel.activeVariant, 0);
assert.deepEqual(variantEngine.calls.filter(call => call[0] === 'node_material').map(call => call.slice(1)), [[1, 1], [1, 2]]);
assert.equal(variantModel.setVariant(1), true, 'unmapped variants restore the glTF default material');
assert.equal(variantEngine.calls.filter(call => call[0] === 'node_material').at(-1)[2], 1);
assert.equal(variantModel.setVariant('Blue'), true);
assert.equal(variantModel.setVariant(null), true, 'null restores all default materials');
assert.equal(variantModel.activeVariant, -1);
assert.equal(variantModel.setVariant('missing'), false);
variantModel.dispose();
const invalidVariantDoc = structuredClone(variantDoc);
invalidVariantDoc.meshes[0].primitives[0].extensions.KHR_materials_variants.mappings[0].variants = [2];
resources.set('http://localhost/invalid-variant.gltf', bytes(invalidVariantDoc));
const invalidVariantEngine = fakeEngine();
await assert.rejects(loadGLTF(invalidVariantEngine, 'http://localhost/invalid-variant.gltf'), error => error.code === 'INVALID_GLTF');
assert.equal(invalidVariantEngine.calls.length, 0, 'invalid material variants fail before creating engine resources');
for (const path of ['oversized-glb-padding.glb', 'unreferenced-glb-bin.glb', 'glb-bin-with-uri.glb']) {
  const engine = fakeEngine();
  await assert.rejects(loadGLTF(engine, `http://localhost/${path}`), error => error.code === 'INVALID_GLTF');
  assert.equal(engine.calls.length, 0, `${path} is rejected before resource creation`);
}
const generatedNormalDoc = structuredClone(doc);
delete generatedNormalDoc.meshes[0].primitives[0].attributes.NORMAL;
resources.set('http://localhost/generated-normals.gltf', bytes(generatedNormalDoc));
const generatedNormalEngine = fakeEngine(), generatedNormalModel = await loadGLTF(generatedNormalEngine, 'http://localhost/generated-normals.gltf');
assert.deepEqual(generatedNormalEngine.calls.filter(call => call[0] === 'vertex').map(call => call.slice(4, 7)),
  [[0,0,1],[0,0,1],[0,0,1]], 'missing normals are generated from indexed triangle winding');
generatedNormalModel.dispose();
const nonindexedNormalDoc = structuredClone(generatedNormalDoc);
delete nonindexedNormalDoc.meshes[0].primitives[0].indices;
resources.set('http://localhost/generated-nonindexed-normals.gltf', bytes(nonindexedNormalDoc));
const nonindexedNormalEngine = fakeEngine(), nonindexedNormalModel = await loadGLTF(nonindexedNormalEngine, 'http://localhost/generated-nonindexed-normals.gltf');
assert.deepEqual(nonindexedNormalEngine.calls.find(call => call[0] === 'triangle'), ['triangle', 0, 1, 2]);
assert.deepEqual(nonindexedNormalEngine.calls.filter(call => call[0] === 'vertex').map(call => call.slice(4, 7)),
  [[0,0,1],[0,0,1],[0,0,1]], 'missing normals are also generated for non-indexed triangles');
nonindexedNormalModel.dispose();
const engine = fakeEngine();
const factorsDoc = structuredClone(doc);
factorsDoc.materials[0].pbrMetallicRoughness.metallicFactor = 0.25;
factorsDoc.materials[0].pbrMetallicRoughness.roughnessFactor = 0.7;
resources.set('http://localhost/factors.gltf', bytes(factorsDoc));
const factorsEngine = fakeEngine();
const factorsModel = await loadGLTF(factorsEngine, 'http://localhost/factors.gltf');
assert.deepEqual(factorsEngine.calls.find(x => x[0] === 'material').slice(-14), [0.25, 0.7, -1, -1, 1, -1, 1, 0, 0, 0, -1, 0, 0, 1.5]);
factorsModel.dispose();
factorsDoc.materials[0].pbrMetallicRoughness.roughnessFactor = 1.1;
resources.set('http://localhost/bad-factors.gltf', bytes(factorsDoc));
await assert.rejects(loadGLTF(fakeEngine(), 'http://localhost/bad-factors.gltf'), e => e.code === 'INVALID_GLTF');
const twoSidedDoc = structuredClone(doc);
twoSidedDoc.materials[0].doubleSided = true;
resources.set('http://localhost/double-sided.gltf', bytes(twoSidedDoc));
const twoSidedEngine = fakeEngine(), twoSidedModel = await loadGLTF(twoSidedEngine, 'http://localhost/double-sided.gltf');
assert.equal(twoSidedEngine.calls.find(call => call[0] === 'material').at(-3), 1, 'glTF doubleSided reaches the engine material');
assert.equal(twoSidedEngine.calls.find(call => call[0] === 'material').at(-2), 0, 'ordinary glTF materials remain lit');
assert.equal(twoSidedEngine.calls.find(call => call[0] === 'material').at(-1), 1.5, 'glTF materials default to IOR 1.5');
twoSidedModel.dispose();
twoSidedDoc.materials[0].doubleSided = 'yes';
resources.set('http://localhost/bad-double-sided.gltf', bytes(twoSidedDoc));
await assert.rejects(loadGLTF(fakeEngine(), 'http://localhost/bad-double-sided.gltf'), e => e.code === 'INVALID_GLTF');
const iorDoc = structuredClone(doc);
iorDoc.extensionsUsed = ['KHR_materials_ior'];
iorDoc.extensionsRequired = ['KHR_materials_ior'];
iorDoc.materials[0].extensions = { KHR_materials_ior: { ior: 2 } };
resources.set('http://localhost/ior.gltf', bytes(iorDoc));
const iorEngine = fakeEngine(), iorModel = await loadGLTF(iorEngine, 'http://localhost/ior.gltf');
assert.equal(iorEngine.calls.find(call => call[0] === 'material').at(-1), 2, 'KHR_materials_ior reaches the PBR material');
iorModel.dispose();
iorDoc.materials[0].extensions.KHR_materials_ior.ior = 2.5;
resources.set('http://localhost/invalid-ior.gltf', bytes(iorDoc));
await assert.rejects(loadGLTF(fakeEngine(), 'http://localhost/invalid-ior.gltf'), e => e.code === 'INVALID_GLTF');
const missingIorDeclaration = structuredClone(iorDoc);
missingIorDeclaration.materials[0].extensions.KHR_materials_ior.ior = 1.6;
delete missingIorDeclaration.extensionsUsed;
resources.set('http://localhost/missing-ior-declaration.gltf', bytes(missingIorDeclaration));
await assert.rejects(loadGLTF(fakeEngine(), 'http://localhost/missing-ior-declaration.gltf'), e => e.code === 'INVALID_GLTF');
const specularDoc = structuredClone(doc);
specularDoc.images = [{ uri: 'image.png' }];
specularDoc.textures = [{ source: 0 }];
specularDoc.accessors.push({ bufferView: 0, componentType: 5126, count: 3, type: 'VEC2' });
specularDoc.meshes[0].primitives[0].attributes.TEXCOORD_0 = 3;
specularDoc.materials[0].pbrMetallicRoughness.baseColorTexture = { index: 0 };
specularDoc.extensionsUsed = ['KHR_materials_specular', 'KHR_texture_transform'];
specularDoc.extensionsRequired = ['KHR_materials_specular'];
specularDoc.materials[0].extensions = { KHR_materials_specular: {
  specularFactor: 0.35, specularColorFactor: [0.7, 0.5, 1.2],
  specularTexture: { index: 0, extensions: { KHR_texture_transform: { offset: [0.25, 0.5] } } },
  specularColorTexture: { index: 0, extensions: { KHR_texture_transform: { texCoord: 0, scale: [2, 3] } } },
} };
resources.set('http://localhost/specular.gltf', bytes(specularDoc));
const specularEngine = fakeEngine(), specularModel = await loadGLTF(specularEngine, 'http://localhost/specular.gltf');
assert.deepEqual(specularEngine.calls.find(call => call[0] === 'material_specular'), ['material_specular', 1, 0.35, 0.7, 0.5, 1.2, 6, 5]);
assert.equal(specularEngine.calls.find(call => call[0] === 'material_uv_transform' && call[2] === 5).at(-1), 0);
assert.equal(specularEngine.calls.find(call => call[0] === 'material_uv_transform' && call[2] === 6).at(-1), 0);
assert.equal(specularEngine.calls.filter(call => call[0] === 'texture').length, 1, 'specular strength texture uploads as linear data');
assert.equal(specularEngine.calls.filter(call => call[0] === 'texture_srgb').length, 1, 'specular color shares its sRGB upload with base color');
specularModel.dispose();
const clearcoatDoc = structuredClone(doc);
clearcoatDoc.buffers.push({ byteLength: 24, uri: 'clearcoat-uv.bin' });
clearcoatDoc.bufferViews.push({ buffer: 1, byteLength: 24 });
clearcoatDoc.accessors.push({ bufferView: 3, componentType: 5126, count: 3, type: 'VEC2' });
clearcoatDoc.meshes[0].primitives[0].attributes.TEXCOORD_0 = 3;
clearcoatDoc.images = [{ uri: 'image.png' }];
clearcoatDoc.textures = [{ source: 0 }];
clearcoatDoc.extensionsUsed = ['KHR_materials_clearcoat', 'KHR_texture_transform'];
clearcoatDoc.extensionsRequired = ['KHR_materials_clearcoat'];
clearcoatDoc.materials[0].extensions = { KHR_materials_clearcoat: {
  clearcoatFactor: 0.7, clearcoatRoughnessFactor: 0.25,
  clearcoatTexture: { index: 0, extensions: { KHR_texture_transform: { offset: [0.25, 0.5] } } },
  clearcoatRoughnessTexture: { index: 0, extensions: { KHR_texture_transform: { scale: [2, 3] } } },
  clearcoatNormalTexture: { index: 0, scale: 0.5, extensions: { KHR_texture_transform: { rotation: 0.25 } } },
} };
resources.set('http://localhost/clearcoat.gltf', bytes(clearcoatDoc));
resources.set('http://localhost/clearcoat-uv.bin', new ArrayBuffer(24));
const clearcoatEngine = fakeEngine(), clearcoatModel = await loadGLTF(clearcoatEngine, 'http://localhost/clearcoat.gltf');
assert.deepEqual(clearcoatEngine.calls.find(call => call[0] === 'material_clearcoat'), ['material_clearcoat', 1, 0.7, 0.25, 5, 5, 5, 0.5]);
assert.equal(clearcoatModel.nodes[0].primitiveMaterials[0].default.clearcoatFactor, 0.7);
assert.equal(clearcoatModel.nodes[0].primitiveMaterials[0].default.clearcoatRoughnessFactor, 0.25);
assert.equal(clearcoatModel.nodes[0].primitiveMaterials[0].default.clearcoatNormalScale, 0.5);
assert.equal(clearcoatModel.nodes[0].primitiveMaterials[0].default.normalScale, 1);
assert.equal(clearcoatModel.nodes[0].primitiveMaterials[0].default.occlusionStrength, 1);
assert.deepEqual(clearcoatModel.nodes[0].primitiveMaterials[0].default.textureSlots.slice(-3), ['clearcoat', 'clearcoatRoughness', 'clearcoatNormal']);
assert.deepEqual(clearcoatModel.nodes[0].primitiveMaterials[0].default.textureBindings.slice(-3), [
  { slot: 'clearcoat', index: 0 }, { slot: 'clearcoatRoughness', index: 0 }, { slot: 'clearcoatNormal', index: 0 },
]);
const preview = clearcoatModel.getTexturePreview(0, 1);
assert.deepEqual([preview.width, preview.height, preview.sourceWidth, preview.sourceHeight], [1, 1, 2, 1]);
assert.deepEqual([...preview.pixels], [1, 1, 1, 1]);
preview.pixels[0] = 99;
assert.deepEqual([...clearcoatModel.getTexturePreview(0).pixels.slice(0, 4)], [1, 1, 1, 1], 'texture previews return independent pixel copies');
assert.equal(clearcoatModel.getTexturePreview(1), null);
assert.equal(clearcoatModel.getTexturePreview(0, 1025), null);
assert.equal(clearcoatEngine.calls.find(call => call[0] === 'material_uv_transform' && call[2] === 7)[3], 0.25);
assert.equal(clearcoatEngine.calls.find(call => call[0] === 'material_uv_transform' && call[2] === 8)[5], 2);
assert.equal(clearcoatEngine.calls.find(call => call[0] === 'material_uv_transform' && call[2] === 9)[7], 0.25);
clearcoatModel.dispose();
assert.equal(clearcoatModel.getTexturePreview(0), null, 'disposed models release and hide preview pixels');
clearcoatDoc.materials[0].extensions.KHR_materials_clearcoat.clearcoatNormalTexture.scale = 'bad';
resources.set('http://localhost/clearcoat-invalid-normal-scale.gltf', bytes(clearcoatDoc));
await assert.rejects(loadGLTF(fakeEngine(), 'http://localhost/clearcoat-invalid-normal-scale.gltf'), e => e.code === 'INVALID_GLTF');
specularDoc.materials[0].extensions.KHR_materials_specular.specularFactor = 1.1;
resources.set('http://localhost/invalid-specular-factor.gltf', bytes(specularDoc));
await assert.rejects(loadGLTF(fakeEngine(), 'http://localhost/invalid-specular-factor.gltf'), e => e.code === 'INVALID_GLTF');
const missingSpecularDeclaration = structuredClone(specularDoc);
missingSpecularDeclaration.materials[0].extensions.KHR_materials_specular.specularFactor = 0.5;
missingSpecularDeclaration.extensionsUsed = ['KHR_texture_transform'];
delete missingSpecularDeclaration.extensionsRequired;
resources.set('http://localhost/missing-specular-declaration.gltf', bytes(missingSpecularDeclaration));
await assert.rejects(loadGLTF(fakeEngine(), 'http://localhost/missing-specular-declaration.gltf'), e => e.code === 'INVALID_GLTF');
const unlitDoc = structuredClone(doc);
unlitDoc.extensionsUsed = ['KHR_materials_unlit'];
unlitDoc.extensionsRequired = ['KHR_materials_unlit'];
unlitDoc.materials[0].extensions = { KHR_materials_unlit: {} };
resources.set('http://localhost/unlit.gltf', bytes(unlitDoc));
const unlitEngine = fakeEngine(), unlitModel = await loadGLTF(unlitEngine, 'http://localhost/unlit.gltf');
assert.equal(unlitEngine.calls.find(call => call[0] === 'material').at(-2), 1, 'KHR_materials_unlit reaches the engine material');
unlitModel.dispose();
const missingUnlitDeclaration = structuredClone(unlitDoc);
delete missingUnlitDeclaration.extensionsUsed;
resources.set('http://localhost/missing-unlit-declaration.gltf', bytes(missingUnlitDeclaration));
await assert.rejects(loadGLTF(fakeEngine(), 'http://localhost/missing-unlit-declaration.gltf'), e => e.code === 'INVALID_GLTF');
const unsupportedRequiredExtension = structuredClone(doc);
unsupportedRequiredExtension.extensionsUsed = ['KHR_draco_mesh_compression'];
unsupportedRequiredExtension.extensionsRequired = ['KHR_draco_mesh_compression'];
resources.set('http://localhost/unsupported-required-extension.gltf', bytes(unsupportedRequiredExtension));
await assert.rejects(loadGLTF(fakeEngine(), 'http://localhost/unsupported-required-extension.gltf'), e => e.code === 'UNSUPPORTED');
const image = await loadImage(engine, 'http://localhost/image.png');
setOutputColorSpace(engine, 'srgb');
assert.deepEqual(engine.calls.find(x => x[0] === 'output_srgb'), ['output_srgb', 1]);
assert.throws(() => setOutputColorSpace(engine, 'unknown'), e => e.code === 'COLOR_SPACE');
assert.equal(image.id, 5); assert.equal(isTextureHandleValid(engine, image.handle), true);
assert.equal(isTextureHandleValid(fakeEngine(), image.handle), false);
image.dispose(); image.dispose();
assert.equal(isTextureHandleValid(engine, image.handle), false);
  assert.equal(engine.calls.filter(x => x[0] === 'recycle_texture').length, 1);
const srgbImage = await loadImage(engine, 'http://localhost/image.png', { colorSpace: 'srgb' });
assert.equal(engine.calls.filter(x => x[0] === 'texture_srgb').length, 1);
srgbImage.dispose();
await assert.rejects(loadImage(engine, 'http://localhost/image.png', { colorSpace: 'bad' }), e => e.code === 'COLOR_SPACE');
const textured = structuredClone(doc);
textured.images = [{ uri: 'image.png' }];
textured.textures = [{ source: 0 }];
textured.accessors.push({ bufferView: 0, componentType: 5126, count: 3, type: 'VEC2' });
textured.meshes[0].primitives[0].attributes.TEXCOORD_0 = 3;
textured.materials[0].pbrMetallicRoughness.baseColorTexture = { index: 0 };
resources.set('http://localhost/textured.gltf', bytes(textured));
resources.set('http://localhost/image.webp', new Uint8Array([2]));
const webpTexture = structuredClone(textured);
webpTexture.images.push({ uri: 'image.webp' });
webpTexture.textures[0].extensions = { EXT_texture_webp: { source: 1 } };
webpTexture.extensionsUsed = ['EXT_texture_webp'];
resources.set('http://localhost/webp-texture.gltf', bytes(webpTexture));
const webpOnlyTexture = structuredClone(webpTexture);
delete webpOnlyTexture.textures[0].source;
webpOnlyTexture.extensionsRequired = ['EXT_texture_webp'];
resources.set('http://localhost/webp-only.gltf', bytes(webpOnlyTexture));
const invalidWebpOnlyTexture = structuredClone(webpOnlyTexture);
delete invalidWebpOnlyTexture.extensionsRequired;
resources.set('http://localhost/invalid-webp-only.gltf', bytes(invalidWebpOnlyTexture));
const texturedEngine = fakeEngine();
const texturedModel = await loadGLTF(texturedEngine, 'http://localhost/textured.gltf');
assert.equal(texturedEngine.calls.filter(x => x[0] === 'texture_srgb').length, 1);
assert.equal(texturedEngine.calls.find(x => x[0] === 'material')[6], 5);
assert.equal(texturedEngine.calls.find(x => x[0] === 'texture_srgb')[3], 2, 'core texture source is used without an image extension');
assert.deepEqual(texturedEngine.calls.find(x => x[0] === 'wrap'), ['wrap', 5, 1, 1]);
texturedModel.dispose();
assert.equal(texturedEngine.calls.filter(x => x[0] === 'recycle_texture').length, 1);
const webpEngine = fakeEngine(), webpModel = await loadGLTF(webpEngine, 'http://localhost/webp-texture.gltf');
assert.equal(webpEngine.calls.find(x => x[0] === 'texture_srgb')[3], 3, 'EXT_texture_webp source takes precedence over the fallback image');
webpModel.dispose();
const webpOnlyEngine = fakeEngine(), webpOnlyModel = await loadGLTF(webpOnlyEngine, 'http://localhost/webp-only.gltf');
assert.equal(webpOnlyEngine.calls.find(x => x[0] === 'texture_srgb')[3], 3, 'required WebP-only textures load without a core source');
webpOnlyModel.dispose();
const invalidWebpOnlyEngine = fakeEngine();
await assert.rejects(loadGLTF(invalidWebpOnlyEngine, 'http://localhost/invalid-webp-only.gltf'), error => error.code === 'INVALID_GLTF');
assert.equal(invalidWebpOnlyEngine.calls.length, 0, 'WebP-only textures require the extension before engine allocation');
rejectWebpDecode = true;
const fallbackWebpEngine = fakeEngine(), fallbackWebpModel = await loadGLTF(fallbackWebpEngine, 'http://localhost/webp-texture.gltf');
assert.equal(fallbackWebpEngine.calls.find(x => x[0] === 'texture_srgb')[3], 2, 'undecodable WebP uses the core texture source');
fallbackWebpModel.dispose();
rejectWebpDecode = false;
const transformedTexture = structuredClone(textured);
transformedTexture.extensionsUsed = ['KHR_texture_transform'];
transformedTexture.extensionsRequired = ['KHR_texture_transform'];
transformedTexture.materials[0].pbrMetallicRoughness.baseColorTexture.extensions = {
  KHR_texture_transform: { offset: [0.25, 0.5], rotation: Math.PI / 2, scale: [2, 3] },
};
resources.set('http://localhost/transformed-texture.gltf', bytes(transformedTexture));
const transformedEngine = fakeEngine(), transformedModel = await loadGLTF(transformedEngine, 'http://localhost/transformed-texture.gltf');
assert.deepEqual(transformedEngine.calls.find(call => call[0] === 'vertex').slice(-24, -22), [-1, -1], 'mesh UVs remain shared and unmodified');
assert.deepEqual(transformedEngine.calls.find(call => call[0] === 'material_uv_transform' && call[2] === 0), ['material_uv_transform', 1, 0, 0.25, 0.5, 2, 3, Math.PI / 2, 0], 'base-colour texture transform reaches its material slot');
transformedModel.dispose();
const perTextureTransforms = structuredClone(transformedTexture);
perTextureTransforms.materials[0].pbrMetallicRoughness.metallicRoughnessTexture = { index: 0, extensions: {
  KHR_texture_transform: { offset: [0, 0], scale: [4, 4] },
} };
resources.set('http://localhost/per-texture-transforms.gltf', bytes(perTextureTransforms));
const perTextureEngine = fakeEngine(), perTextureModel = await loadGLTF(perTextureEngine, 'http://localhost/per-texture-transforms.gltf');
assert.deepEqual(perTextureEngine.calls.find(call => call[0] === 'material_uv_transform' && call[2] === 0).slice(3), [0.25, 0.5, 2, 3, Math.PI / 2, 0]);
assert.deepEqual(perTextureEngine.calls.find(call => call[0] === 'material_uv_transform' && call[2] === 1).slice(3), [0, 0, 4, 4, 0, 0], 'different texture slots retain independent transforms');
perTextureModel.dispose();
const unsupportedUvSet = structuredClone(transformedTexture);
unsupportedUvSet.materials[0].pbrMetallicRoughness.baseColorTexture.extensions.KHR_texture_transform.texCoord = 2;
resources.set('http://localhost/unsupported-transform-uv.gltf', bytes(unsupportedUvSet));
await assert.rejects(loadGLTF(fakeEngine(), 'http://localhost/unsupported-transform-uv.gltf'), e => e.code === 'UNSUPPORTED');
const uvSet1 = structuredClone(transformedTexture);
const uvSet1Accessor = uvSet1.accessors.push({ bufferView: 1, componentType: 5126, count: 3, type: 'VEC2' }) - 1;
uvSet1.meshes[0].primitives[0].attributes.TEXCOORD_1 = uvSet1Accessor;
uvSet1.materials[0].pbrMetallicRoughness.baseColorTexture.extensions.KHR_texture_transform.texCoord = 1;
resources.set('http://localhost/uv-set-1.gltf', bytes(uvSet1));
const uvSet1Engine = fakeEngine(), uvSet1Model = await loadGLTF(uvSet1Engine, 'http://localhost/uv-set-1.gltf');
const uvSet1Vertex = uvSet1Engine.calls.find(call => call[0] === 'vertex');
assert.deepEqual(uvSet1Vertex.slice(-24, -22), [-1, -1], 'TEXCOORD_0 remains available independently');
assert.deepEqual(uvSet1Vertex.slice(-22, -20), [0, 0], 'TEXCOORD_1 reaches the mesh vertex');
assert.equal(uvSet1Engine.calls.find(call => call[0] === 'material_uv_transform' && call[2] === 0).at(-1), 1, 'texture transform selects TEXCOORD_1');
uvSet1Model.dispose();
const uvSet2 = structuredClone(transformedTexture);
const uvSet2Accessor = uvSet2.accessors.push({ bufferView: 0, componentType: 5126, count: 3, type: 'VEC2' }) - 1;
uvSet2.meshes[0].primitives[0].attributes.TEXCOORD_2 = uvSet2Accessor;
uvSet2.materials[0].pbrMetallicRoughness.baseColorTexture.extensions.KHR_texture_transform.texCoord = 2;
resources.set('http://localhost/uv-set-2.gltf', bytes(uvSet2));
const uvSet2Engine = fakeEngine(), uvSet2Model = await loadGLTF(uvSet2Engine, 'http://localhost/uv-set-2.gltf');
const uvSet2Vertex = uvSet2Engine.calls.find(call => call[0] === 'vertex');
assert.deepEqual(uvSet2Vertex.slice(-24, -22), [-1, -1], 'TEXCOORD_0 remains independent with TEXCOORD_2');
assert.deepEqual(uvSet2Vertex.slice(-22, -20), [0, 0], 'missing TEXCOORD_1 is zero-filled');
assert.deepEqual(uvSet2Vertex.slice(-20, -18), [-1, -1], 'TEXCOORD_2 reaches the mesh vertex');
assert.equal(uvSet2Engine.calls.find(call => call[0] === 'material_uv_transform' && call[2] === 0).at(-1), 2, 'texture transform selects TEXCOORD_2');
uvSet2Model.dispose();
const uvSets = structuredClone(transformedTexture), uvSetsBinary = new ArrayBuffer(120), uvSetsData = new DataView(uvSetsBinary);
const uvValues = [[0,1],[1,1],[1,0],[0,1],[1,1]];
for (let set = 3; set <= 7; set++) {
  const viewIndex = uvSets.bufferViews.push({ buffer: 1, byteOffset: (set - 3) * 24, byteLength: 24 }) - 1;
  const accessorIndex = uvSets.accessors.push({ bufferView: viewIndex, componentType: 5126, count: 3, type: 'VEC2' }) - 1;
  uvSets.meshes[0].primitives[0].attributes[`TEXCOORD_${set}`] = accessorIndex;
  for (let vertex = 0; vertex < 3; vertex++) for (let component = 0; component < 2; component++)
    uvSetsData.setFloat32((set - 3) * 24 + vertex * 8 + component * 4, uvValues[set - 3][component], true);
}
uvSets.buffers.push({ byteLength: uvSetsBinary.byteLength, uri: 'uv-set-3-7.bin' });
uvSets.materials[0].pbrMetallicRoughness.baseColorTexture.extensions.KHR_texture_transform.texCoord = 7;
resources.set('http://localhost/uv-set-7.gltf', bytes(uvSets));
resources.set('http://localhost/uv-set-3-7.bin', uvSetsBinary);
const uvSetsEngine = fakeEngine(), uvSetsModel = await loadGLTF(uvSetsEngine, 'http://localhost/uv-set-7.gltf');
const uvSetsVertex = uvSetsEngine.calls.find(call => call[0] === 'vertex');
assert.deepEqual(uvSetsVertex.slice(-18, -16), [0,1], 'TEXCOORD_3 reaches the mesh vertex');
assert.deepEqual(uvSetsVertex.slice(-16, -14), [1,1], 'TEXCOORD_4 reaches the mesh vertex');
assert.deepEqual(uvSetsVertex.slice(-14, -12), [1,0], 'TEXCOORD_5 reaches the mesh vertex');
assert.deepEqual(uvSetsVertex.slice(-12, -10), [0,1], 'TEXCOORD_6 reaches the mesh vertex');
assert.deepEqual(uvSetsVertex.slice(-10, -8), [1,1], 'TEXCOORD_7 reaches the mesh vertex');
assert.equal(uvSetsEngine.calls.find(call => call[0] === 'material_uv_transform' && call[2] === 0).at(-1), 7,
  'KHR_texture_transform can select TEXCOORD_7');
uvSetsModel.dispose();
const uvSet6 = structuredClone(uvSets);
uvSet6.materials[0].pbrMetallicRoughness.baseColorTexture.extensions.KHR_texture_transform.texCoord = 6;
resources.set('http://localhost/uv-set-6.gltf', bytes(uvSet6));
const uvSet6Engine = fakeEngine(), uvSet6Model = await loadGLTF(uvSet6Engine, 'http://localhost/uv-set-6.gltf');
assert.equal(uvSet6Engine.calls.find(call => call[0] === 'material_uv_transform' && call[2] === 0).at(-1), 6,
  'KHR_texture_transform can select TEXCOORD_6');
uvSet6Model.dispose();
const unsupportedUvSet8 = structuredClone(transformedTexture);
unsupportedUvSet8.materials[0].pbrMetallicRoughness.baseColorTexture.extensions.KHR_texture_transform.texCoord = 8;
resources.set('http://localhost/unsupported-transform-uv-8.gltf', bytes(unsupportedUvSet8));
await assert.rejects(loadGLTF(fakeEngine(), 'http://localhost/unsupported-transform-uv-8.gltf'), error => error.code === 'UNSUPPORTED');
const unsupportedAttributeUv8 = structuredClone(uvSets);
unsupportedAttributeUv8.meshes[0].primitives[0].attributes.TEXCOORD_8 = 0;
resources.set('http://localhost/unsupported-attribute-uv-8.gltf', bytes(unsupportedAttributeUv8));
const unsupportedAttributeUv8Engine = fakeEngine();
await assert.rejects(loadGLTF(unsupportedAttributeUv8Engine, 'http://localhost/unsupported-attribute-uv-8.gltf'), error => error.code === 'UNSUPPORTED');
assert.equal(unsupportedAttributeUv8Engine.calls.length, 0, 'unsupported ninth coordinate sets fail before allocating resources');
const invalidTextureTransform = structuredClone(transformedTexture);
invalidTextureTransform.materials[0].pbrMetallicRoughness.baseColorTexture.extensions.KHR_texture_transform.offset = null;
resources.set('http://localhost/invalid-texture-transform.gltf', bytes(invalidTextureTransform));
await assert.rejects(loadGLTF(fakeEngine(), 'http://localhost/invalid-texture-transform.gltf'), e => e.code === 'INVALID_GLTF');
const unlistedTextureTransform = structuredClone(transformedTexture);
delete unlistedTextureTransform.extensionsUsed;
delete unlistedTextureTransform.extensionsRequired;
resources.set('http://localhost/unlisted-texture-transform.gltf', bytes(unlistedTextureTransform));
await assert.rejects(loadGLTF(fakeEngine(), 'http://localhost/unlisted-texture-transform.gltf'), e => e.code === 'INVALID_GLTF');
const packedMr = structuredClone(textured);
packedMr.materials[0].pbrMetallicRoughness.metallicRoughnessTexture = { index: 0 };
resources.set('http://localhost/packed-mr.gltf', bytes(packedMr));
const packedMrEngine = fakeEngine();
const packedMrModel = await loadGLTF(packedMrEngine, 'http://localhost/packed-mr.gltf');
assert.equal(packedMrEngine.calls.filter(x => x[0] === 'texture_srgb').length, 1);
assert.equal(packedMrEngine.calls.filter(x => x[0] === 'texture').length, 1);
assert.equal(packedMrModel.textures.length, 2, 'one image used for colour and data gets two colour-space uploads');
const packedMaterial = packedMrEngine.calls.find(x => x[0] === 'material');
assert.equal(packedMaterial[6], 5, 'base colour uses the sRGB texture');
assert.equal(packedMaterial.at(-12), 6, 'metallic-roughness uses the linear texture');
packedMrModel.dispose();
assert.equal(packedMrEngine.calls.filter(x => x[0] === 'recycle_texture').length, 2);
const normalMapped = structuredClone(textured);
normalMapped.materials[0].normalTexture = { index: 0, scale: 0.4 };
resources.set('http://localhost/normal-map.gltf', bytes(normalMapped));
const normalEngine = fakeEngine();
const normalModel = await loadGLTF(normalEngine, 'http://localhost/normal-map.gltf');
assert.equal(normalEngine.calls.filter(x => x[0] === 'texture').length, 1, 'normal maps upload in linear color space');
const normalMaterial = normalEngine.calls.find(x => x[0] === 'material');
assert.equal(normalMaterial.at(-11), 6, 'normal map uses its own linear texture handle');
assert.equal(normalMaterial.at(-10), 0.4, 'normal scale reaches the material bridge');
normalModel.dispose();
assert.equal(normalEngine.calls.filter(x => x[0] === 'recycle_texture').length, 2);
const occluded = structuredClone(textured);
occluded.materials[0].occlusionTexture = { index: 0, strength: 0.3 };
resources.set('http://localhost/occlusion.gltf', bytes(occluded));
const occlusionEngine = fakeEngine();
const occlusionModel = await loadGLTF(occlusionEngine, 'http://localhost/occlusion.gltf');
assert.equal(occlusionEngine.calls.filter(x => x[0] === 'texture_srgb').length, 1);
assert.equal(occlusionEngine.calls.filter(x => x[0] === 'texture').length, 1, 'occlusion data is uploaded in linear color space');
const occlusionMaterial = occlusionEngine.calls.find(x => x[0] === 'material');
assert.equal(occlusionMaterial.at(-9), 6, 'occlusion map receives the linear texture handle');
assert.equal(occlusionMaterial.at(-8), 0.3, 'occlusion strength reaches the shared material');
occlusionModel.dispose();
assert.equal(occlusionEngine.calls.filter(x => x[0] === 'recycle_texture').length, 2);
occluded.materials[0].occlusionTexture.strength = 1.1;
resources.set('http://localhost/invalid-occlusion-strength.gltf', bytes(occluded));
await assert.rejects(loadGLTF(fakeEngine(), 'http://localhost/invalid-occlusion-strength.gltf'), e => e.code === 'INVALID_GLTF');
occluded.materials[0].occlusionTexture.strength = 1;
occluded.materials[0].occlusionTexture.texCoord = 1;
resources.set('http://localhost/unsupported-occlusion-uv.gltf', bytes(occluded));
await assert.rejects(loadGLTF(fakeEngine(), 'http://localhost/unsupported-occlusion-uv.gltf'), e => e.code === 'UNSUPPORTED');
const emissive = structuredClone(textured);
emissive.materials[0].emissiveFactor = [0.2, 0.4, 0.6];
emissive.materials[0].emissiveTexture = { index: 0 };
resources.set('http://localhost/emissive.gltf', bytes(emissive));
const emissiveEngine = fakeEngine();
const emissiveModel = await loadGLTF(emissiveEngine, 'http://localhost/emissive.gltf');
assert.equal(emissiveEngine.calls.filter(x => x[0] === 'texture_srgb').length, 1, 'emissive image shares the base-colour sRGB upload');
const emissiveMaterial = emissiveEngine.calls.find(x => x[0] === 'material');
assert.deepEqual(emissiveMaterial.slice(-7), [0.2, 0.4, 0.6, 5, 0, 0, 1.5]);
emissiveModel.dispose();
const emissiveStrength = structuredClone(emissive);
emissiveStrength.extensionsUsed = ['KHR_materials_emissive_strength'];
emissiveStrength.extensionsRequired = ['KHR_materials_emissive_strength'];
emissiveStrength.materials[0].extensions = { KHR_materials_emissive_strength: { emissiveStrength: 3 } };
resources.set('http://localhost/emissive-strength.gltf', bytes(emissiveStrength));
const emissiveStrengthEngine = fakeEngine(), emissiveStrengthModel = await loadGLTF(emissiveStrengthEngine, 'http://localhost/emissive-strength.gltf');
const amplifiedEmission = emissiveStrengthEngine.calls.find(x => x[0] === 'material').slice(-7);
assert.ok(amplifiedEmission.slice(0, 3).every((value, i) => Math.abs(value - [0.6, 1.2, 1.8][i]) < 1e-6), 'emissive strength multiplies the material factor before emission');
assert.deepEqual(amplifiedEmission.slice(3), [5, 0, 0, 1.5]);
emissiveStrengthModel.dispose();
emissiveStrength.materials[0].extensions.KHR_materials_emissive_strength.emissiveStrength = -1;
resources.set('http://localhost/invalid-emissive-strength.gltf', bytes(emissiveStrength));
await assert.rejects(loadGLTF(fakeEngine(), 'http://localhost/invalid-emissive-strength.gltf'), e => e.code === 'INVALID_GLTF');
emissive.materials[0].emissiveFactor = [0, 0, 1.1];
resources.set('http://localhost/invalid-emissive-factor.gltf', bytes(emissive));
await assert.rejects(loadGLTF(fakeEngine(), 'http://localhost/invalid-emissive-factor.gltf'), e => e.code === 'INVALID_GLTF');
emissive.materials[0].emissiveFactor = [0, 0, 0];
emissive.materials[0].emissiveTexture.texCoord = 1;
resources.set('http://localhost/unsupported-emissive-uv.gltf', bytes(emissive));
await assert.rejects(loadGLTF(fakeEngine(), 'http://localhost/unsupported-emissive-uv.gltf'), e => e.code === 'UNSUPPORTED');
normalMapped.materials[0].normalTexture.texCoord = 1;
resources.set('http://localhost/unsupported-normal-uv.gltf', bytes(normalMapped));
await assert.rejects(loadGLTF(fakeEngine(), 'http://localhost/unsupported-normal-uv.gltf'), e => e.code === 'UNSUPPORTED');
packedMr.materials[0].pbrMetallicRoughness.metallicRoughnessTexture.texCoord = 1;
resources.set('http://localhost/unsupported-mr-uv.gltf', bytes(packedMr));
await assert.rejects(loadGLTF(fakeEngine(), 'http://localhost/unsupported-mr-uv.gltf'), e => e.code === 'UNSUPPORTED');
const sampleEngine = fakeEngine();
const sample = await loadGLTF(sampleEngine, 'http://localhost/sample.glb');
assert.equal(sampleEngine.calls.filter(x => x[0] === 'vertex').length, 24);
assert.equal(sampleEngine.calls.filter(x => x[0] === 'triangle').length, 12);
assert.equal(sampleEngine.calls.find(x => x[0] === 'material')[6], 5);
sample.dispose();
const sharedImage = structuredClone(textured);
sharedImage.samplers = [{ wrapS: 33071, wrapT: 33648 }];
sharedImage.textures.push({ source: 0, sampler: 0 });
sharedImage.materials.push(structuredClone(sharedImage.materials[0]));
sharedImage.materials[1].pbrMetallicRoughness.baseColorTexture.index = 1;
sharedImage.meshes[0].primitives.push({ ...sharedImage.meshes[0].primitives[0], material: 1 });
resources.set('http://localhost/shared.gltf', bytes(sharedImage));
const sharedEngine = fakeEngine();
const sharedModel = await loadGLTF(sharedEngine, 'http://localhost/shared.gltf');
assert.deepEqual(sharedEngine.calls.filter(x => x[0] === 'wrap'), [['wrap', 5, 1, 1], ['wrap', 6, 0, 2]]);
assert.deepEqual(sharedEngine.calls.filter(x => x[0] === 'material').map(x => x[6]), [5, 6]);
sharedModel.dispose();
const sameMaterial = structuredClone(textured);
sameMaterial.meshes[0].primitives.push(structuredClone(sameMaterial.meshes[0].primitives[0]));
resources.set('http://localhost/same-material.gltf', bytes(sameMaterial));
const materialEngine = fakeEngine();
const materialModel = await loadGLTF(materialEngine, 'http://localhost/same-material.gltf');
assert.equal(materialModel.materials.length, 1);
assert.equal(materialEngine.calls.filter(x => x[0] === 'material').length, 1);
assert.deepEqual(materialEngine.calls.filter(x => x[0] === 'node_material').map(x => x[2]), [1, 1]);
const staleMaterial = materialModel.materials[0];
materialEngine.materialGenerations.set(staleMaterial.id, staleMaterial.generation + 1);
materialModel.dispose();
assert.equal(materialEngine.materialGenerations.get(staleMaterial.id), staleMaterial.generation + 1);
assert.equal(materialEngine.calls.filter(x => x[0] === 'recycle_material').length, 0);
const mipmap = structuredClone(textured);
mipmap.samplers = [{ minFilter: 9987 }];
mipmap.textures[0].sampler = 0;
resources.set('http://localhost/mipmap.gltf', bytes(mipmap));
const mipmapEngine = fakeEngine();
const mipmapModel = await loadGLTF(mipmapEngine, 'http://localhost/mipmap.gltf');
assert.deepEqual(mipmapEngine.calls.find(x => x[0] === 'filter'), ['filter', 5, 9987, 9729]);
mipmapModel.dispose();
for (const minFilter of [9728, 9729, 9984, 9985, 9986, 9987]) {
  const filtered = structuredClone(textured);
  filtered.samplers = [{ minFilter, magFilter: 9728 }];
  filtered.textures[0].sampler = 0;
  resources.set(`http://localhost/filter-${minFilter}.gltf`, bytes(filtered));
  const filteredEngine = fakeEngine();
  const asset = await loadGLTF(filteredEngine, `http://localhost/filter-${minFilter}.gltf`);
  assert.deepEqual(filteredEngine.calls.find(x => x[0] === 'filter'), ['filter', 5, minFilter, 9728]);
  asset.dispose();
}
for (const [mode, expected, cutoff] of [['MASK', 1, 0.3], ['BLEND', 2, 0.5]]) {
  const materialDoc = structuredClone(textured);
  materialDoc.materials[0].alphaMode = mode;
  if (mode === 'MASK') materialDoc.materials[0].alphaCutoff = cutoff;
  resources.set(`http://localhost/${mode}.gltf`, bytes(materialDoc));
  const materialEngine = fakeEngine();
  const asset = await loadGLTF(materialEngine, `http://localhost/${mode}.gltf`);
  assert.deepEqual(materialEngine.calls.find(x => x[0] === 'material'), ['material', 1, 0.25, 0.5, 1, 0.5, 5, expected, cutoff, 1, 1, -1, -1, 1, -1, 1, 0, 0, 0, -1, 0, 0, 1.5]);
  asset.dispose();
}
const clearedEngine = fakeEngine();
const clearedModel = await loadGLTF(clearedEngine, 'http://localhost/model.gltf');
clearedEngine.epoch = 1;
clearedModel.dispose();
assert.equal(clearedEngine.calls.filter(x => x[0] === 'hide').length, 0);
assert.equal(clearedEngine.calls.filter(x => x[0] === 'recycle_mesh').length, 1);
const reusedEngine = fakeEngine();
const oldModel = await loadGLTF(reusedEngine, 'http://localhost/model.gltf');
const oldMesh = oldModel.meshes[0];
reusedEngine.meshGenerations.set(oldMesh.id, oldMesh.generation + 1);
assert.equal(isMeshHandleValid(reusedEngine, oldMesh), false);
const oldRoot = oldModel.roots[0];
reusedEngine.generations.set(oldRoot.index, oldRoot.generation + 1);
assert.equal(isNodeHandleValid(reusedEngine, oldRoot), false);
oldModel.dispose();
assert.equal(reusedEngine.meshGenerations.get(oldMesh.id), oldMesh.generation + 1);
assert.equal(reusedEngine.calls.filter(x => x[0] === 'recycle_mesh').length, 0);
assert.equal(reusedEngine.generations.get(oldRoot.index), oldRoot.generation + 1);
assert.equal(reusedEngine.calls.filter(x => x[0] === 'hide').length, 1);
const staleTextureEngine = fakeEngine();
const staleImage = await loadImage(staleTextureEngine, 'http://localhost/image.png');
staleTextureEngine.textureGenerations.set(staleImage.id, staleImage.handle.generation + 1);
staleImage.dispose();
assert.equal(staleTextureEngine.textureGenerations.get(staleImage.id), staleImage.handle.generation + 1);
assert.equal(staleTextureEngine.calls.filter(x => x[0] === 'recycle_texture').length, 0);
await assert.rejects(loadGLTF(fakeEngine(), 'http://localhost/missing'), e => e instanceof AssetError && e.code === 'FETCH');
const invalid = structuredClone(doc); invalid.meshes[0].primitives[0].mode = 1;
resources.set('http://localhost/bad.gltf', bytes(invalid));
const untouched = fakeEngine();
await assert.rejects(loadGLTF(untouched, 'http://localhost/bad.gltf'), e => e.code === 'UNSUPPORTED');
assert.equal(untouched.calls.length, 0);
for (const [name, mutate] of [
  ['bad-stride-alignment', document => { document.bufferViews[0].byteStride = 13; }],
  ['bad-stride-limit', document => { document.bufferViews[0].byteStride = 256; }],
  ['bad-normalized-flag', document => { document.accessors[0].normalized = 'false'; }],
]) {
  const malformed = structuredClone(doc);
  mutate(malformed);
  resources.set(`http://localhost/${name}.gltf`, bytes(malformed));
  const untouchedEngine = fakeEngine();
  await assert.rejects(loadGLTF(untouchedEngine, `http://localhost/${name}.gltf`), error => error.code === 'INVALID_GLTF');
  assert.equal(untouchedEngine.calls.length, 0, `${name} is rejected before engine resource creation`);
}
const skinEngine = fakeEngine(), skinnedModel = await loadGLTF(skinEngine, 'http://localhost/skinned.gltf');
assert.equal(skinnedModel.animations.length, 1);
assert.equal(skinnedModel.playAnimation(0, { loop: false }), true);
assert.equal(skinnedModel.seekAnimation(1), true);
const skinnedVertices = skinEngine.calls.filter(x => x[0] === 'mesh_update_cpu').at(-1)[2];
assert.ok(skinnedVertices.every((value, index) => Math.abs(value - [2,-1,0, 2,1,0, 0,0,0][index]) < 1e-6),
  'joint translation and rotation deform positions');
const skinnedTangents = skinEngine.calls.filter(x => x[0] === 'mesh_update_cpu').at(-1)[4];
assert.ok(skinnedTangents.every((value, index) => Math.abs(value - [-1,0,0,-1, -1,0,0,-1, -1,0,0,-1][index]) < 1e-6),
  'authored tangent directions rotate with the skin while handedness is retained');
assert.equal(skinEngine.calls.filter(x => x[0] === 'mesh_update').length, 0);
const skinAttributes = skinEngine.calls.find(x => x[0] === 'mesh_skin');
assert.equal(skinAttributes[3], 1);
assert.deepEqual(skinAttributes[2].slice(0, 16), [0,0,0,0, 1,0,0,0, 0,0,0,0, 0,0,0,0]);
const jointPalette = skinEngine.calls.filter(x => x[0] === 'joint_palette').at(-1);
assert.equal(jointPalette[3], 1);
assert.equal(jointPalette[2][12], 1);
skinnedModel.dispose();
const fallbackSkinEngine = fakeEngine();
fallbackSkinEngine._g3_host_mesh_skin = () => 0;
const fallbackSkinModel = await loadGLTF(fallbackSkinEngine, 'http://localhost/skinned.gltf');
assert.equal(fallbackSkinModel.playAnimation(0, { loop: false }), true);
assert.equal(fallbackSkinModel.seekAnimation(1), true);
assert.ok(fallbackSkinEngine.calls.some(x => x[0] === 'mesh_update'));
assert.equal(fallbackSkinEngine.calls.some(x => x[0] === 'mesh_update_cpu'), false);
fallbackSkinModel.dispose();
const morphEngine = fakeEngine(), morphModel = await loadGLTF(morphEngine, 'http://localhost/morph.gltf');
assert.equal(morphModel.playAnimation(0, { loop: false }), true);
assert.equal(morphModel.seekAnimation(1), true);
const morphedVertices = morphEngine.calls.filter(x => x[0] === 'mesh_update').at(-1)[2];
assert.deepEqual(morphedVertices, [-2,-2,0, 2,-2,0, 0,2,0]);
const morphedTangents = morphEngine.calls.filter(x => x[0] === 'mesh_update').at(-1)[4];
assert.deepEqual(morphedTangents.map(value => Math.round(value * 1e6) / 1e6),
  [0.707107,0.707107,0,-1, 0.707107,0.707107,0,-1, 0.707107,0.707107,0,-1]);
morphModel.dispose();
const gpuMorphEngine = enableFakeGpuMorph(fakeEngine());
const gpuMorphModel = await loadGLTF(gpuMorphEngine, 'http://localhost/morph.gltf');
assert.equal(gpuMorphModel.playAnimation(0, { loop: false }), true);
assert.equal(gpuMorphModel.seekAnimation(1), true);
assert.deepEqual(gpuMorphEngine.calls.find(x => x[0] === 'mesh_morph').slice(1, 4), [7, 3, 1]);
assert.deepEqual(gpuMorphEngine.calls.find(x => x[0] === 'mesh_morph')[4], positions);
assert.deepEqual(gpuMorphEngine.calls.find(x => x[0] === 'mesh_morph')[5], normals);
assert.deepEqual(gpuMorphEngine.calls.find(x => x[0] === 'mesh_morph')[6], [1,0,0, 1,0,0, 1,0,0]);
assert.deepEqual(gpuMorphEngine.calls.filter(x => x[0] === 'morph_weights').at(-1)[2], [1]);
assert.equal(gpuMorphEngine.calls.filter(x => x[0] === 'mesh_update').length, 0);
assert.deepEqual(gpuMorphEngine.calls.filter(x => x[0] === 'mesh_update_cpu').at(-1)[2], [-2,-2,0, 2,-2,0, 0,2,0]);
gpuMorphModel.dispose();
const rejectedGpuMorph = enableFakeGpuMorph(fakeEngine(), { upload: false });
const rejectedGpuMorphModel = await loadGLTF(rejectedGpuMorph, 'http://localhost/morph.gltf');
assert.equal(rejectedGpuMorph.calls.some(x => x[0] === 'morph_release'), true);
assert.equal(rejectedGpuMorph.calls.some(x => x[0] === 'mesh_update'), true);
rejectedGpuMorphModel.dispose();
const largeGpuMorph = enableFakeGpuMorph(fakeEngine());
const largeGpuMorphModel = await loadGLTF(largeGpuMorph, 'http://localhost/large-morph.gltf');
assert.equal(largeGpuMorph.calls.some(x => x[0] === 'mesh_morph'), false);
assert.equal(largeGpuMorph.calls.some(x => x[0] === 'mesh_update'), true);
largeGpuMorphModel.dispose();
const combinedMorphSkin = enableFakeGpuMorph(fakeEngine());
const combinedMorphSkinModel = await loadGLTF(combinedMorphSkin, 'http://localhost/combined-morph-skin.gltf');
assert.equal(combinedMorphSkinModel.playAnimation(0, { loop: false }), true);
assert.equal(combinedMorphSkinModel.seekAnimation(1), true);
assert.equal(combinedMorphSkin.calls.some(x => x[0] === 'mesh_skin'), true);
assert.deepEqual(combinedMorphSkin.calls.filter(x => x[0] === 'morph_weights').at(-1)[2], [1]);
const combinedVertices = combinedMorphSkin.calls.filter(x => x[0] === 'mesh_update_cpu').at(-1)[2];
assert.ok(combinedVertices.every((value, index) => Math.abs(value - [3,-2,0, 3,2,0, -1,0,0][index]) < 1e-6));
assert.equal(combinedMorphSkin.calls.filter(x => x[0] === 'mesh_update').length, 0);
combinedMorphSkinModel.dispose();
const fallbackCombined = enableFakeGpuMorph(fakeEngine(), { skin: false });
const fallbackCombinedModel = await loadGLTF(fallbackCombined, 'http://localhost/combined-morph-skin.gltf');
assert.equal(fallbackCombined.calls.some(x => x[0] === 'morph_release'), true);
assert.equal(fallbackCombined.calls.some(x => x[0] === 'mesh_update'), true);
fallbackCombinedModel.dispose();
const cubicMorphEngine = fakeEngine(), cubicMorphModel = await loadGLTF(cubicMorphEngine, 'http://localhost/cubic-morph.gltf');
assert.equal(cubicMorphModel.playAnimation(0, { loop: false }), true);
assert.equal(cubicMorphModel.seekAnimation(0.5), true);
const cubicMorphedVertices = cubicMorphEngine.calls.filter(x => x[0] === 'mesh_update').at(-1)[2];
assert.deepEqual(cubicMorphedVertices, [-1.75,-1.75,0, 1.75,-1.75,0, 0,1.75,0]);
cubicMorphModel.dispose();
const defaultMorphEngine = fakeEngine(), defaultMorphModel = await loadGLTF(defaultMorphEngine, 'http://localhost/default-morph.gltf');
const defaultMorphedVertices = defaultMorphEngine.calls.filter(x => x[0] === 'mesh_update').at(-1)[2];
assert.deepEqual(defaultMorphedVertices, [-1.5,-1.5,0, 1.5,-1.5,0, 0,1.5,0]);
defaultMorphModel.dispose();
const quantizedMorphEngine = fakeEngine(), quantizedMorphModel = await loadGLTF(quantizedMorphEngine, 'http://localhost/quantized-morph.gltf');
assert.equal(quantizedMorphModel.playAnimation(0, { loop: false }), true);
assert.equal(quantizedMorphModel.seekAnimation(1), true);
const quantizedMorphedVertices = quantizedMorphEngine.calls.filter(x => x[0] === 'mesh_update').at(-1)[2];
assert.deepEqual(quantizedMorphedVertices, [-2,-2,0, 2,-2,0, 0,2,0]);
quantizedMorphModel.dispose();
const malformedSkin = structuredClone(skinDoc);
delete malformedSkin.meshes[0].primitives[0].attributes.WEIGHTS_0;
resources.set('http://localhost/bad-skin.gltf', bytes(malformedSkin));
const untouchedSkin = fakeEngine();
await assert.rejects(loadGLTF(untouchedSkin, 'http://localhost/bad-skin.gltf'), e => e.code === 'INVALID_GLTF');
assert.equal(untouchedSkin.calls.length, 0);
const toneMappingEngine = fakeEngine();
setToneMapping(toneMappingEngine, false);
setToneMapping(toneMappingEngine, 'reinhard');
setToneMapping(toneMappingEngine, 'aces');
assert.deepEqual(toneMappingEngine.calls.filter(x => x[0] === 'tone_mapping').map(x => x[1]), [0, 1, 2]);
assert.throws(() => setToneMapping(toneMappingEngine, 'filmic'), error => error.code === 'TONE_MAPPING');
setFXAA(toneMappingEngine, true);
setFXAA(toneMappingEngine, false);
assert.deepEqual(toneMappingEngine.calls.filter(x => x[0] === 'fxaa').map(x => x[1]), [1, 0]);
assert.throws(() => setFXAA(toneMappingEngine, 1), error => error.code === 'POST_PROCESS');
console.log('asset loading checks passed');
