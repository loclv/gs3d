import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { loadGLTF, loadImage, pickNode, isNodeHandleValid, isMeshHandleValid, isTextureHandleValid, isMaterialHandleValid, setOutputColorSpace, AssetError } from './assets.js';

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
const skinBinary = new ArrayBuffer(skinByteLength), skinBytes = new Uint8Array(skinBinary);
for (const chunk of skinChunks) skinBytes.set(chunk.bytes, chunk.offset);
const skinDoc = {
  asset: { version: '2.0' }, buffers: [{ byteLength: skinByteLength, uri: 'skin.bin' }],
  bufferViews: skinViews, accessors: skinAccessors,
  meshes: [{ primitives: [{ attributes: { POSITION: skinPosition, NORMAL: skinNormal, JOINTS_0: skinJoints, WEIGHTS_0: skinWeights }, indices: skinIndices }] }],
  skins: [{ joints: [1], inverseBindMatrices: inverseBind }],
  nodes: [{ mesh: 0, skin: 0 }, {}], scenes: [{ nodes: [0,1] }], scene: 0,
  animations: [{ samplers: [{ input: skinTimes, output: skinTranslation }], channels: [{ sampler: 0, target: { node: 1, path: 'translation' } }] }],
};
resources.set('http://localhost/skinned.gltf', bytes(skinDoc));
resources.set('http://localhost/skin.bin', skinBinary);
const morphDoc = structuredClone(skinDoc);
morphDoc.meshes[0].primitives[0].attributes = { POSITION: skinPosition, NORMAL: skinNormal };
morphDoc.meshes[0].primitives[0].targets = [{ POSITION: skinPosition, NORMAL: skinNormal }];
delete morphDoc.skins;
morphDoc.nodes = [{ mesh: 0 }];
morphDoc.scenes = [{ nodes: [0] }];
morphDoc.animations[0].channels[0].target = { node: 0, path: 'weights' };
morphDoc.animations[0].samplers[0].output = skinTimes;
resources.set('http://localhost/morph.gltf', bytes(morphDoc));
resources.set('http://localhost/morph.bin', skinBinary);
const combinedMorphSkinDoc = structuredClone(skinDoc);
combinedMorphSkinDoc.meshes[0].primitives[0].targets = [{ POSITION: skinPosition, NORMAL: skinNormal }];
combinedMorphSkinDoc.meshes[0].weights = [0];
combinedMorphSkinDoc.nodes[0].weights = [0];
combinedMorphSkinDoc.animations[0].samplers.push({ input: skinTimes, output: skinTimes });
combinedMorphSkinDoc.animations[0].channels.push({ sampler: 1, target: { node: 0, path: 'weights' } });
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
globalThis.createImageBitmap = async () => ({ width: 1, height: 1, close() {} });
globalThis.document = { createElement: () => ({ getContext: () => ({ drawImage() {}, getImageData: () => ({ data: new Uint8Array([255, 0, 0, 255]) }) }) }) };

for (const [name, expected] of [
  ['sparse-zero-base', [0, 0, 0, 2, -1, 0, 0, 0, 0]],
  ['sparse-base-override', [-1, -1, 0, 2, -1, 0, 0, 1, 0]],
]) {
  const sparseEngine = fakeEngine(), sparseModel = await loadGLTF(sparseEngine, `http://localhost/${name}.gltf`);
  assert.deepEqual(sparseEngine.calls.filter(call => call[0] === 'vertex').flatMap(call => call.slice(1, 4)), expected);
  sparseModel.dispose();
}
const tangentEngine = fakeEngine(), tangentModel = await loadGLTF(tangentEngine, 'http://localhost/tangent.gltf');
assert.deepEqual(tangentEngine.calls.find(call => call[0] === 'vertex').slice(-4), [0, 1, 0, -1], 'authored tangent and handedness reach the vertex upload');
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
  engine._g3_asset_material_uv_transform = (...args) => { calls.push(['material_uv_transform', ...args]); return true; };
  engine._g3_asset_mesh_end = () => { calls.push(['mesh_end']); const id = nextMesh++; meshGenerations.set(id, 1); return id; };
  engine._g3_host_mesh_update = (id, positions, normals, count) => {
    calls.push(['mesh_update', id, [...engine.HEAPF32.slice(positions >>> 2, (positions >>> 2) + count)],
      [...engine.HEAPF32.slice(normals >>> 2, (normals >>> 2) + count)]]);
    return 1;
  };
  engine._g3_host_mesh_update_cpu = (id, positions, normals, count) => {
    calls.push(['mesh_update_cpu', id, [...engine.HEAPF32.slice(positions >>> 2, (positions >>> 2) + count)],
      [...engine.HEAPF32.slice(normals >>> 2, (normals >>> 2) + count)]]);
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
  engine._g3_asset_node_generation = id => generations.get(id) || 0;
  engine._g3_asset_node_valid = (id, generation, epoch) => epoch === (engine.epoch || 0) && generations.get(id) === generation;
  engine._g3_asset_node_release = (id, generation, epoch) => {
    if (!engine._g3_asset_node_valid(id, generation, epoch)) return 0;
    calls.push(['hide', id]); generations.delete(id); return 1;
  };
  engine._g3_asset_pick = (...args) => { calls.push(['pick', ...args]); return engine.picked ?? -1; };
  engine._g3_asset_output_srgb = value => calls.push(['output_srgb', value]);
  let heapCursor = 16;
  engine._malloc = size => { const ptr = heapCursor; heapCursor = (heapCursor + size + 7) & ~7; return ptr; };
  engine._free = () => {};
  return engine;
}

function enableFakeGpuMorph(engine, { upload = true, skin = true } = {}) {
  engine._g3_host_mesh_morph = (id, positionsPtr, normalsPtr, vertexCount, targetCount) => {
    const length = vertexCount * targetCount * 3;
    engine.calls.push(['mesh_morph', id, vertexCount, targetCount,
      [...engine.HEAPF32.slice(positionsPtr >>> 2, (positionsPtr >>> 2) + length)],
      [...engine.HEAPF32.slice(normalsPtr >>> 2, (normalsPtr >>> 2) + length)]]);
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
  assert.deepEqual(model.roots, [{ index: 0, generation: 1, epoch: 0 }]);
  assert.equal(isNodeHandleValid(engine, model.roots[0]), true);
  assert.equal(isNodeHandleValid(fakeEngine(), model.roots[0]), false);
  assert.equal(isMeshHandleValid(engine, model.meshes[0]), true);
  assert.equal(isMeshHandleValid(fakeEngine(), model.meshes[0]), false);
  assert.equal(isMaterialHandleValid(engine, model.materials[0]), true);
  assert.equal(isMaterialHandleValid(fakeEngine(), model.materials[0]), false);
  assert.equal(engine.calls.filter(x => x[0] === 'vertex').length, 3);
  assert.deepEqual(engine.calls.find(x => x[0] === 'triangle'), ['triangle', 0, 1, 2]);
  assert.deepEqual(engine.calls.find(x => x[0] === 'material'), ['material', 1, 0.25, 0.5, 1, 1, -1, 0, 0.5, 1, 1, -1, -1, 1, -1, 1, 0, 0, 0, -1, 0, 0]);
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
const engine = fakeEngine();
const factorsDoc = structuredClone(doc);
factorsDoc.materials[0].pbrMetallicRoughness.metallicFactor = 0.25;
factorsDoc.materials[0].pbrMetallicRoughness.roughnessFactor = 0.7;
resources.set('http://localhost/factors.gltf', bytes(factorsDoc));
const factorsEngine = fakeEngine();
const factorsModel = await loadGLTF(factorsEngine, 'http://localhost/factors.gltf');
assert.deepEqual(factorsEngine.calls.find(x => x[0] === 'material').slice(-13), [0.25, 0.7, -1, -1, 1, -1, 1, 0, 0, 0, -1, 0, 0]);
factorsModel.dispose();
factorsDoc.materials[0].pbrMetallicRoughness.roughnessFactor = 1.1;
resources.set('http://localhost/bad-factors.gltf', bytes(factorsDoc));
await assert.rejects(loadGLTF(fakeEngine(), 'http://localhost/bad-factors.gltf'), e => e.code === 'INVALID_GLTF');
const twoSidedDoc = structuredClone(doc);
twoSidedDoc.materials[0].doubleSided = true;
resources.set('http://localhost/double-sided.gltf', bytes(twoSidedDoc));
const twoSidedEngine = fakeEngine(), twoSidedModel = await loadGLTF(twoSidedEngine, 'http://localhost/double-sided.gltf');
assert.equal(twoSidedEngine.calls.find(call => call[0] === 'material').at(-2), 1, 'glTF doubleSided reaches the engine material');
assert.equal(twoSidedEngine.calls.find(call => call[0] === 'material').at(-1), 0, 'ordinary glTF materials remain lit');
twoSidedModel.dispose();
twoSidedDoc.materials[0].doubleSided = 'yes';
resources.set('http://localhost/bad-double-sided.gltf', bytes(twoSidedDoc));
await assert.rejects(loadGLTF(fakeEngine(), 'http://localhost/bad-double-sided.gltf'), e => e.code === 'INVALID_GLTF');
const unlitDoc = structuredClone(doc);
unlitDoc.extensionsUsed = ['KHR_materials_unlit'];
unlitDoc.extensionsRequired = ['KHR_materials_unlit'];
unlitDoc.materials[0].extensions = { KHR_materials_unlit: {} };
resources.set('http://localhost/unlit.gltf', bytes(unlitDoc));
const unlitEngine = fakeEngine(), unlitModel = await loadGLTF(unlitEngine, 'http://localhost/unlit.gltf');
assert.equal(unlitEngine.calls.find(call => call[0] === 'material').at(-1), 1, 'KHR_materials_unlit reaches the engine material');
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
const texturedEngine = fakeEngine();
const texturedModel = await loadGLTF(texturedEngine, 'http://localhost/textured.gltf');
assert.equal(texturedEngine.calls.filter(x => x[0] === 'texture_srgb').length, 1);
assert.equal(texturedEngine.calls.find(x => x[0] === 'material')[6], 5);
assert.deepEqual(texturedEngine.calls.find(x => x[0] === 'wrap'), ['wrap', 5, 1, 1]);
texturedModel.dispose();
assert.equal(texturedEngine.calls.filter(x => x[0] === 'recycle_texture').length, 1);
const transformedTexture = structuredClone(textured);
transformedTexture.extensionsUsed = ['KHR_texture_transform'];
transformedTexture.extensionsRequired = ['KHR_texture_transform'];
transformedTexture.materials[0].pbrMetallicRoughness.baseColorTexture.extensions = {
  KHR_texture_transform: { offset: [0.25, 0.5], rotation: Math.PI / 2, scale: [2, 3] },
};
resources.set('http://localhost/transformed-texture.gltf', bytes(transformedTexture));
const transformedEngine = fakeEngine(), transformedModel = await loadGLTF(transformedEngine, 'http://localhost/transformed-texture.gltf');
assert.deepEqual(transformedEngine.calls.find(call => call[0] === 'vertex').slice(-6, -4), [-1, -1], 'mesh UVs remain shared and unmodified');
assert.deepEqual(transformedEngine.calls.find(call => call[0] === 'material_uv_transform' && call[2] === 0), ['material_uv_transform', 1, 0, 0.25, 0.5, 2, 3, Math.PI / 2], 'base-colour texture transform reaches its material slot');
transformedModel.dispose();
const perTextureTransforms = structuredClone(transformedTexture);
perTextureTransforms.materials[0].pbrMetallicRoughness.metallicRoughnessTexture = { index: 0, extensions: {
  KHR_texture_transform: { offset: [0, 0], scale: [4, 4] },
} };
resources.set('http://localhost/per-texture-transforms.gltf', bytes(perTextureTransforms));
const perTextureEngine = fakeEngine(), perTextureModel = await loadGLTF(perTextureEngine, 'http://localhost/per-texture-transforms.gltf');
assert.deepEqual(perTextureEngine.calls.find(call => call[0] === 'material_uv_transform' && call[2] === 0).slice(3), [0.25, 0.5, 2, 3, Math.PI / 2]);
assert.deepEqual(perTextureEngine.calls.find(call => call[0] === 'material_uv_transform' && call[2] === 1).slice(3), [0, 0, 4, 4, 0], 'different texture slots retain independent transforms');
perTextureModel.dispose();
const unsupportedUvSet = structuredClone(transformedTexture);
unsupportedUvSet.materials[0].pbrMetallicRoughness.baseColorTexture.extensions.KHR_texture_transform.texCoord = 1;
resources.set('http://localhost/unsupported-transform-uv.gltf', bytes(unsupportedUvSet));
await assert.rejects(loadGLTF(fakeEngine(), 'http://localhost/unsupported-transform-uv.gltf'), e => e.code === 'UNSUPPORTED');
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
assert.equal(packedMaterial.at(-11), 6, 'metallic-roughness uses the linear texture');
packedMrModel.dispose();
assert.equal(packedMrEngine.calls.filter(x => x[0] === 'recycle_texture').length, 2);
const normalMapped = structuredClone(textured);
normalMapped.materials[0].normalTexture = { index: 0, scale: 0.4 };
resources.set('http://localhost/normal-map.gltf', bytes(normalMapped));
const normalEngine = fakeEngine();
const normalModel = await loadGLTF(normalEngine, 'http://localhost/normal-map.gltf');
assert.equal(normalEngine.calls.filter(x => x[0] === 'texture').length, 1, 'normal maps upload in linear color space');
const normalMaterial = normalEngine.calls.find(x => x[0] === 'material');
assert.equal(normalMaterial.at(-10), 6, 'normal map uses its own linear texture handle');
assert.equal(normalMaterial.at(-9), 0.4, 'normal scale reaches the material bridge');
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
assert.equal(occlusionMaterial.at(-8), 6, 'occlusion map receives the linear texture handle');
assert.equal(occlusionMaterial.at(-7), 0.3, 'occlusion strength reaches the shared material');
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
assert.deepEqual(emissiveMaterial.slice(-6), [0.2, 0.4, 0.6, 5, 0, 0]);
emissiveModel.dispose();
const emissiveStrength = structuredClone(emissive);
emissiveStrength.extensionsUsed = ['KHR_materials_emissive_strength'];
emissiveStrength.extensionsRequired = ['KHR_materials_emissive_strength'];
emissiveStrength.materials[0].extensions = { KHR_materials_emissive_strength: { emissiveStrength: 3 } };
resources.set('http://localhost/emissive-strength.gltf', bytes(emissiveStrength));
const emissiveStrengthEngine = fakeEngine(), emissiveStrengthModel = await loadGLTF(emissiveStrengthEngine, 'http://localhost/emissive-strength.gltf');
const amplifiedEmission = emissiveStrengthEngine.calls.find(x => x[0] === 'material').slice(-6);
assert.ok(amplifiedEmission.slice(0, 3).every((value, i) => Math.abs(value - [0.6, 1.2, 1.8][i]) < 1e-6), 'emissive strength multiplies the material factor before emission');
assert.deepEqual(amplifiedEmission.slice(3), [5, 0, 0]);
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
  assert.deepEqual(materialEngine.calls.find(x => x[0] === 'material'), ['material', 1, 0.25, 0.5, 1, 0.5, 5, expected, cutoff, 1, 1, -1, -1, 1, -1, 1, 0, 0, 0, -1, 0, 0]);
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
const skinEngine = fakeEngine(), skinnedModel = await loadGLTF(skinEngine, 'http://localhost/skinned.gltf');
assert.equal(skinnedModel.animations.length, 1);
assert.equal(skinnedModel.playAnimation(0, { loop: false }), true);
assert.equal(skinnedModel.seekAnimation(1), true);
const skinnedVertices = skinEngine.calls.filter(x => x[0] === 'mesh_update_cpu').at(-1)[2];
assert.deepEqual(skinnedVertices, [0,-1,0, 2,-1,0, 1,1,0]);
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
morphModel.dispose();
const gpuMorphEngine = enableFakeGpuMorph(fakeEngine());
const gpuMorphModel = await loadGLTF(gpuMorphEngine, 'http://localhost/morph.gltf');
assert.equal(gpuMorphModel.playAnimation(0, { loop: false }), true);
assert.equal(gpuMorphModel.seekAnimation(1), true);
assert.deepEqual(gpuMorphEngine.calls.find(x => x[0] === 'mesh_morph').slice(1, 4), [7, 3, 1]);
assert.deepEqual(gpuMorphEngine.calls.find(x => x[0] === 'mesh_morph')[4], positions);
assert.deepEqual(gpuMorphEngine.calls.find(x => x[0] === 'mesh_morph')[5], normals);
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
assert.deepEqual(combinedMorphSkin.calls.filter(x => x[0] === 'mesh_update_cpu').at(-1)[2], [-1,-2,0, 3,-2,0, 1,2,0]);
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
console.log('asset loading checks passed');
