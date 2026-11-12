import assert from 'node:assert/strict';
import { loadGLTF, loadImage, AssetError } from './assets.js';

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
globalThis.fetch = async url => resources.has(String(url)) ? new Response(resources.get(String(url))) : new Response('', { status: 404 });
globalThis.createImageBitmap = async () => ({ width: 1, height: 1, close() {} });
globalThis.document = { createElement: () => ({ getContext: () => ({ drawImage() {}, getImageData: () => ({ data: new Uint8Array([255, 0, 0, 255]) }) }) }) };

function fakeEngine() {
  const calls = [], engine = { calls, HEAPU8: new Uint8Array(32) };
  for (const name of ['mesh_begin','vertex','triangle','matrix','material','hide']) engine['_g3_asset_' + name] = (...args) => calls.push([name, ...args]);
  let next = 0;
  engine._g3_asset_mesh_end = () => { calls.push(['mesh_end']); return 7; };
  engine._g3_asset_node = (...args) => { calls.push(['node', ...args]); return next++; };
  engine._g3_asset_texture = () => 5;
  engine._g3_host_texture = (...args) => calls.push(['texture', ...args]);
  engine._g3_host_release_mesh = id => calls.push(['release_mesh', id]);
  engine._g3_host_release_texture = id => calls.push(['release_texture', id]);
  engine._malloc = () => 4; engine._free = () => {};
  return engine;
}

for (const path of ['model.gltf', 'model.glb']) {
  const engine = fakeEngine(), model = await loadGLTF(engine, `http://localhost/${path}`);
  assert.deepEqual(model.roots, [0]);
  assert.equal(engine.calls.filter(x => x[0] === 'vertex').length, 3);
  assert.deepEqual(engine.calls.find(x => x[0] === 'triangle'), ['triangle', 0, 1, 2]);
  assert.deepEqual(engine.calls.find(x => x[0] === 'material'), ['material', 1, 0.25, 0.5, 1, 1, -1]);
  assert.deepEqual(engine.calls.find(x => x[0] === 'matrix' && x[2] === 12), ['matrix', 0, 12, 2]);
  model.dispose(); model.dispose();
  assert.equal(engine.calls.filter(x => x[0] === 'hide').length, 2);
  assert.equal(engine.calls.filter(x => x[0] === 'release_mesh').length, 1);
}
const engine = fakeEngine();
const image = await loadImage(engine, 'http://localhost/image.png');
assert.equal(image.id, 5); image.dispose(); image.dispose();
assert.equal(engine.calls.filter(x => x[0] === 'release_texture').length, 1);
const textured = structuredClone(doc);
textured.images = [{ uri: 'image.png' }];
textured.textures = [{ source: 0 }];
textured.accessors.push({ bufferView: 0, componentType: 5126, count: 3, type: 'VEC2' });
textured.meshes[0].primitives[0].attributes.TEXCOORD_0 = 3;
textured.materials[0].pbrMetallicRoughness.baseColorTexture = { index: 0 };
resources.set('http://localhost/textured.gltf', bytes(textured));
const texturedEngine = fakeEngine();
const texturedModel = await loadGLTF(texturedEngine, 'http://localhost/textured.gltf');
assert.equal(texturedEngine.calls.find(x => x[0] === 'material').at(-1), 5);
texturedModel.dispose();
assert.equal(texturedEngine.calls.filter(x => x[0] === 'release_texture').length, 1);
await assert.rejects(loadGLTF(fakeEngine(), 'http://localhost/missing'), e => e instanceof AssetError && e.code === 'FETCH');
const invalid = structuredClone(doc); invalid.meshes[0].primitives[0].mode = 1;
resources.set('http://localhost/bad.gltf', bytes(invalid));
const untouched = fakeEngine();
await assert.rejects(loadGLTF(untouched, 'http://localhost/bad.gltf'), e => e.code === 'UNSUPPORTED');
assert.equal(untouched.calls.length, 0);
console.log('asset loading checks passed');
