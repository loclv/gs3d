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
resources.set('http://localhost/sample.glb', await readFile(new URL('./viewer/sample.glb', import.meta.url)));
globalThis.fetch = async url => resources.has(String(url)) ? new Response(resources.get(String(url))) : new Response('', { status: 404 });
globalThis.createImageBitmap = async () => ({ width: 1, height: 1, close() {} });
globalThis.document = { createElement: () => ({ getContext: () => ({ drawImage() {}, getImageData: () => ({ data: new Uint8Array([255, 0, 0, 255]) }) }) }) };

function fakeEngine() {
  const calls = [], engine = { calls, HEAPU8: new Uint8Array(32) };
  for (const name of ['mesh_begin','vertex','triangle','matrix','node_material']) engine['_g3_asset_' + name] = (...args) => calls.push([name, ...args]);
  let next = 0, nextTexture = 5, nextMesh = 7, nextMaterial = 1;
  const generations = new Map();
  const meshGenerations = new Map(), textureGenerations = new Map(), materialGenerations = new Map();
  engine.generations = generations;
  engine.meshGenerations = meshGenerations; engine.textureGenerations = textureGenerations;
  engine.materialGenerations = materialGenerations;
  engine._g3_asset_material = (...args) => { const id = nextMaterial++; materialGenerations.set(id, 1); calls.push(['material', id, ...args]); return id; };
  engine._g3_asset_mesh_end = () => { calls.push(['mesh_end']); const id = nextMesh++; meshGenerations.set(id, 1); return id; };
  engine._g3_asset_node = (...args) => { calls.push(['node', ...args]); const id = next++; generations.set(id, 1); return id; };
  engine._g3_asset_texture = () => { const id = nextTexture++; textureGenerations.set(id, 1); return id; };
  engine._g3_host_texture = (...args) => calls.push(['texture', ...args]);
  engine._g3_host_texture_srgb = (...args) => calls.push(['texture_srgb', ...args]);
  engine._g3_host_texture_wrap = (...args) => calls.push(['wrap', ...args]);
  engine._g3_host_texture_filter = (...args) => calls.push(['filter', ...args]);
  engine._g3_host_release_mesh = id => calls.push(['release_mesh', id]);
  engine._g3_host_release_texture = id => calls.push(['release_texture', id]);
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
  engine._malloc = () => 4; engine._free = () => {};
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
  assert.deepEqual(engine.calls.find(x => x[0] === 'material'), ['material', 1, 0.25, 0.5, 1, 1, -1, 0, 0.5, 1, 1]);
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
  assert.equal(engine.calls.filter(x => x[0] === 'release_mesh').length, 1);
}
const engine = fakeEngine();
const factorsDoc = structuredClone(doc);
factorsDoc.materials[0].pbrMetallicRoughness.metallicFactor = 0.25;
factorsDoc.materials[0].pbrMetallicRoughness.roughnessFactor = 0.7;
resources.set('http://localhost/factors.gltf', bytes(factorsDoc));
const factorsEngine = fakeEngine();
const factorsModel = await loadGLTF(factorsEngine, 'http://localhost/factors.gltf');
assert.deepEqual(factorsEngine.calls.find(x => x[0] === 'material').slice(-2), [0.25, 0.7]);
factorsModel.dispose();
factorsDoc.materials[0].pbrMetallicRoughness.roughnessFactor = 1.1;
resources.set('http://localhost/bad-factors.gltf', bytes(factorsDoc));
await assert.rejects(loadGLTF(fakeEngine(), 'http://localhost/bad-factors.gltf'), e => e.code === 'INVALID_GLTF');
const image = await loadImage(engine, 'http://localhost/image.png');
setOutputColorSpace(engine, 'srgb');
assert.deepEqual(engine.calls.find(x => x[0] === 'output_srgb'), ['output_srgb', 1]);
assert.throws(() => setOutputColorSpace(engine, 'unknown'), e => e.code === 'COLOR_SPACE');
assert.equal(image.id, 5); assert.equal(isTextureHandleValid(engine, image.handle), true);
assert.equal(isTextureHandleValid(fakeEngine(), image.handle), false);
image.dispose(); image.dispose();
assert.equal(isTextureHandleValid(engine, image.handle), false);
assert.equal(engine.calls.filter(x => x[0] === 'release_texture').length, 1);
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
assert.equal(texturedEngine.calls.filter(x => x[0] === 'release_texture').length, 1);
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
  assert.deepEqual(materialEngine.calls.find(x => x[0] === 'material'), ['material', 1, 0.25, 0.5, 1, 0.5, 5, expected, cutoff, 1, 1]);
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
assert.equal(reusedEngine.calls.filter(x => x[0] === 'release_mesh').length, 0);
assert.equal(reusedEngine.generations.get(oldRoot.index), oldRoot.generation + 1);
assert.equal(reusedEngine.calls.filter(x => x[0] === 'hide').length, 1);
const staleTextureEngine = fakeEngine();
const staleImage = await loadImage(staleTextureEngine, 'http://localhost/image.png');
staleTextureEngine.textureGenerations.set(staleImage.id, staleImage.handle.generation + 1);
staleImage.dispose();
assert.equal(staleTextureEngine.textureGenerations.get(staleImage.id), staleImage.handle.generation + 1);
assert.equal(staleTextureEngine.calls.filter(x => x[0] === 'release_texture').length, 0);
await assert.rejects(loadGLTF(fakeEngine(), 'http://localhost/missing'), e => e instanceof AssetError && e.code === 'FETCH');
const invalid = structuredClone(doc); invalid.meshes[0].primitives[0].mode = 1;
resources.set('http://localhost/bad.gltf', bytes(invalid));
const untouched = fakeEngine();
await assert.rejects(loadGLTF(untouched, 'http://localhost/bad.gltf'), e => e.code === 'UNSUPPORTED');
assert.equal(untouched.calls.length, 0);
console.log('asset loading checks passed');
