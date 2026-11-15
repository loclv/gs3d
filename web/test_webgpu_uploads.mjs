import assert from 'node:assert/strict';

// Exercise the real bridge with a recording WebGPU device; no GPU is needed to
// verify which bytes queue.writeBuffer receives as scene membership changes.
const writes = [];
let nextBuffer = 0;
const pass = { setBindGroup() {}, setPipeline() {}, setVertexBuffer() {}, setIndexBuffer() {}, drawIndexed() {}, end() {} };
const device = {
  limits: { minUniformBufferOffsetAlignment: 256 }, features: new Set(), lost: new Promise(() => {}),
  createShaderModule: () => ({}), createBindGroupLayout: () => ({}), createPipelineLayout: () => ({}),
  createRenderPipelineAsync: async () => ({}), createBindGroup: () => ({}),
  createBuffer: ({ usage, size }) => ({ id: ++nextBuffer, usage, bytes: new Uint8Array(size), destroy() {} }),
  createTexture: () => ({ createView: () => ({}), destroy() {} }),
  createCommandEncoder: () => ({ beginRenderPass: () => pass, finish: () => ({}) }),
  queue: { writeBuffer: (buffer, offset, data, dataOffset = 0, size = data.byteLength) => {
    buffer.bytes.set(new Uint8Array(data, dataOffset, size), offset);
    writes.push({ buffer, offset, size });
  }, submit() {} },
};
globalThis.GPUShaderStage = { VERTEX: 1, FRAGMENT: 2 };
globalThis.GPUBufferUsage = { UNIFORM: 1, COPY_DST: 2, STORAGE: 4, VERTEX: 8, INDEX: 16 };
globalThis.GPUTextureUsage = { RENDER_ATTACHMENT: 1 };
globalThis.GPUColorWrite = { ALL: 15 };
Object.defineProperty(globalThis, 'navigator', { configurable: true, value: { gpu: { requestAdapter: async () => ({ features: new Set(), requestDevice: async () => device }), getPreferredCanvasFormat: () => 'rgba8unorm' } } });
globalThis.location = { search: '' };
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
function draw(count) { writes.length = 0; gpu.draw(items, count, viewPtr); return storageWrites().map(({ offset, size }) => [offset, size]); }
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
gpu.shutdown();
console.log('WebGPU instance upload checks passed');
