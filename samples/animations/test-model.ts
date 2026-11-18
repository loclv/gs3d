import assert from 'node:assert/strict';
import { authorModel, type ModelPart } from './src/model.ts';

const parts: ModelPart[] = [
  { name: 'Body', size: [1, 1, 1], position: [0, 0, 0], color: '#4060ff' },
  { name: 'Handle', size: [0.3, 0.5, 0.3], position: [0, 0.7, 0], color: '#ffb850' },
];
const model = authorModel('Lantern', parts);
assert.equal(model.parts.length, 2);
assert.equal(model.vertexCount, 48);
assert.equal(model.triangleCount, 24);

const view = new DataView(model.glb.buffer, model.glb.byteOffset, model.glb.byteLength);
assert.equal(view.getUint32(0, true), 0x46546c67, 'GLB magic');
assert.equal(view.getUint32(4, true), 2, 'GLB version');
assert.equal(view.getUint32(8, true), model.glb.byteLength, 'GLB length');
const jsonLength = view.getUint32(12, true);
const document = JSON.parse(new TextDecoder().decode(model.glb.subarray(20, 20 + jsonLength)));
assert.equal(document.meshes.length, 2);
assert.equal(document.materials.length, 2);
assert.deepEqual(document.scenes[0].nodes, [0]);
assert.deepEqual(document.nodes[0], { name: 'Lantern', children: [1, 2] });
assert.deepEqual(document.nodes[1].translation, [0, 0, 0]);
assert.deepEqual(document.nodes[2].translation, [0, 0.7, 0]);
assert.equal(document.nodes[1].mesh, 0);
assert.equal(document.nodes[2].mesh, 1);
assert.deepEqual(document.accessors[0].min, [-0.5, -0.5, -0.5]);
assert.deepEqual(document.accessors[0].max, [0.5, 0.5, 0.5]);

assert.throws(() => authorModel('Empty', []), /at least one part/);
console.log('composite model checks passed');
