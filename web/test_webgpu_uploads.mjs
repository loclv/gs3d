import assert from 'node:assert/strict';

// Exercise the real bridge with a recording WebGPU device; no GPU is needed to
// verify which bytes queue.writeBuffer receives as scene membership changes.
const writes = [];
const draws = [];
const mapResolvers = [];
let nextBuffer = 0;
const pass = { setBindGroup() {}, setPipeline() {}, setVertexBuffer() {}, setIndexBuffer() {}, drawIndexed(indexCount, instanceCount, firstIndex, baseVertex, firstInstance) { draws.push({ indexCount, instanceCount, firstInstance }); }, end() {} };
const device = {
  limits: { minUniformBufferOffsetAlignment: 256 }, features: new Set(['timestamp-query']), lost: new Promise(() => {}),
  createShaderModule: () => ({}), createBindGroupLayout: () => ({}), createPipelineLayout: () => ({}),
  createRenderPipelineAsync: async () => ({}), createBindGroup: () => ({}),
  createBuffer: ({ usage, size }) => ({
    id: ++nextBuffer, usage, bytes: new Uint8Array(size), destroy() {},
    mapAsync: () => new Promise(resolve => mapResolvers.push(resolve)),
    getMappedRange: () => new BigUint64Array([1000000n, 3000000n]).buffer,
    unmap() {},
  }),
  createQuerySet: () => ({ destroy() {} }),
  createTexture: () => ({ createView: () => ({}), destroy() {} }),
  createCommandEncoder: () => ({ beginRenderPass: () => pass, resolveQuerySet() {}, copyBufferToBuffer() {}, finish: () => ({}) }),
  queue: { writeBuffer: (buffer, offset, data, dataOffset = 0, size = data.byteLength) => {
    buffer.bytes.set(new Uint8Array(data, dataOffset, size), offset);
    writes.push({ buffer, offset, size });
  }, submit() {} },
};
globalThis.GPUShaderStage = { VERTEX: 1, FRAGMENT: 2 };
globalThis.GPUBufferUsage = { UNIFORM: 1, COPY_DST: 2, STORAGE: 4, VERTEX: 8, INDEX: 16, QUERY_RESOLVE: 32, COPY_SRC: 64, MAP_READ: 128 };
globalThis.GPUMapMode = { READ: 1 };
globalThis.GPUTextureUsage = { RENDER_ATTACHMENT: 1 };
globalThis.GPUColorWrite = { ALL: 15 };
Object.defineProperty(globalThis, 'navigator', { configurable: true, value: { gpu: { requestAdapter: async () => ({ features: new Set(['timestamp-query']), requestDevice: async () => device }), getPreferredCanvasFormat: () => 'rgba8unorm' } } });
globalThis.location = { search: '?gpu-timing=1' };
const context = { configure() {}, getCurrentTexture: () => ({ createView: () => ({}) }) };
const canvas = { getContext: () => context };
globalThis.document = { getElementById: () => canvas };
globalThis.window = {};
const { prepareWebGPU } = await import('./webgpu.js');
assert.equal(await prepareWebGPU(canvas), true);
const gpu = window.g3wgpu;
const heap = new Uint8Array(200000), view = new DataView(heap.buffer);
gpu.setModule({ HEAPU8: heap });
assert.equal(gpu.init(100, 100), true);
gpu.uploadMesh(1, 100000, 1, 100120, 3);
const items = 0, viewPtr = 80000, stride = 653;
for (let i = 0; i < 80; i++) {
  const p = items + i * stride;
  view.setInt32(p, 1, true);
  for (const n of [0, 5, 10, 15]) view.setFloat32(p + 68 + n * 4, 1, true);
  view.setFloat32(p + 144, 1, true);
}
function storageWrites() { return writes.filter(w => (w.buffer.usage & GPUBufferUsage.STORAGE) !== 0); }
function draw(count) { writes.length = 0; draws.length = 0; gpu.draw(items, count, viewPtr); return storageWrites().map(({ offset, size }) => [offset, size]); }
assert.deepEqual(draw(4), [[0, 4 * 80]], 'first draw initializes all slots');
assert.deepEqual(draw(4), [], 'unchanged frame uploads nothing');
view.setFloat32(2 * stride + 68 + 12 * 4, 2, true);
assert.deepEqual(draw(4), [[2 * 80, 80]], 'one changed instance uploads one record');
const storage = storageWrites()[0].buffer;
assert.equal(new DataView(storage.bytes.buffer).getFloat32(2 * 80 + 12 * 4, true), 2, 'partial write updates the intended GPU slot');
assert.equal(new DataView(storage.bytes.buffer).getFloat32(3 * 80 + 12 * 4, true), 0, 'partial write leaves neighboring slots intact');
view.setFloat32(0 * stride + 68 + 12 * 4, 1, true);
view.setFloat32(3 * stride + 68 + 12 * 4, 3, true);
assert.deepEqual(draw(4), [[0, 4 * 80]], 'separated edits upload their enclosing span');
assert.deepEqual(draw(2), [], 'shrinking does not upload');
assert.deepEqual(draw(4), [], 'restoring unchanged slots does not upload');
assert.deepEqual(draw(6), [[4 * 80, 2 * 80]], 'growing initializes new slots');
assert.deepEqual(draw(70), [[0, 70 * 80]], 'capacity growth initializes the replacement buffer');
const grown = storageWrites()[0].buffer;
assert.notEqual(grown, storage, 'capacity growth replaces the buffer');
assert.equal(new DataView(grown.bytes.buffer).getFloat32(2 * 80 + 12 * 4, true), 2, 'replacement retains earlier instance values');
assert.equal(new DataView(grown.bytes.buffer).getFloat32(69 * 80, true), 1, 'replacement includes newly visible instances');
view.setFloat32(0 * stride + 68 + 12 * 4, 7, true);
view.setFloat32(69 * stride + 68 + 12 * 4, 8, true);
assert.deepEqual(draw(70), [[0, 80], [69 * 80, 80]], 'distant edits upload separate spans');
assert.equal(new DataView(grown.bytes.buffer).getFloat32(12 * 4, true), 7);
assert.equal(new DataView(grown.bytes.buffer).getFloat32(69 * 80 + 12 * 4, true), 8);
for (let i = 0; i < 10; i++) view.setFloat32(i * 7 * stride + 68 + 12 * 4, 20 + i, true);
assert.equal(draw(70).length, 8, 'many distant edits bound the number of writes');
assert.equal(new DataView(grown.bytes.buffer).getFloat32(63 * 80 + 12 * 4, true), 29, 'bounded writes include the final change');
// Adjacent opaque draws can share a call only when the state represented by
// the batch uniform and pipeline matches. Draw order and firstInstance matter.
const batches = () => draws.map(({ instanceCount, firstInstance }) => [instanceCount, firstInstance]);
draw(4);
assert.deepEqual(batches(), [[4, 0]], 'matching opaque items batch in order');
for (const [name, offset, set, value, reset] of [
  ['blend flag', 160, 'setFloat32', 1, 0],
  ['alpha', 144, 'setFloat32', 0.5, 1],
  ['alpha mode', 172, 'setInt32', 1, 0],
  ['alpha cutoff', 176, 'setFloat32', 0.5, 0],
  ['double sided', 236, 'setUint8', 1, 0],
  ['unlit', 148, 'setFloat32', 1, 0],
  ['specular strength', 152, 'setFloat32', 1, 0],
  ['shininess', 156, 'setFloat32', 1, 0],
]) {
  view[set](stride + offset, value, true);
  draw(4);
  assert.deepEqual(batches(), [[1, 0], [1, 1], [2, 2]], `${name} splits the batch without reordering`);
  view[set](stride + offset, reset, true);
}
gpu.uploadMesh(2, 100000, 1, 100120, 3);
view.setInt32(stride, 2, true);
draw(4);
assert.deepEqual(batches(), [[1, 0], [1, 1], [2, 2]], 'mesh changes split the batch');
view.setInt32(stride, -1, true);
draw(4);
assert.deepEqual(batches(), [[1, 0], [2, 2]], 'missing meshes do not collapse instance offsets');
// Completion is asynchronous. Resetting capture must discard pending samples
// from the prior scene while retaining samples from the new measurement.
assert.equal(gpu.gpuTimestampAvailable(), true);
for (const resolve of mapResolvers.splice(0)) resolve();
await Promise.resolve();
gpu.gpuTimestampBegin();
draw(1);
assert.equal(gpu.gpuTimestampPending(), 1);
gpu.gpuTimestampBegin();
draw(1);
assert.equal(gpu.gpuTimestampPending(), 1, 'pending queries from older epochs are excluded');
for (const resolve of mapResolvers.splice(0)) resolve();
await Promise.resolve();
assert.deepEqual(gpu.gpuTimestampMs(), [2], 'only the current capture contributes a sample');
assert.equal(gpu.gpuTimestampPending(), 0);
gpu.gpuTimestampEnd();
draw(1);
assert.equal(mapResolvers.length, 0, 'ending capture stops issuing timestamp queries');
gpu.shutdown();
console.log('WebGPU instance upload checks passed');
