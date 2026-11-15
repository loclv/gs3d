import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { boxGeometry, GlbBuilder, planeGeometry } from './model-authoring.ts';

const box = boxGeometry([2, 2, 2]);
assert.equal(box.positions.length, 24, 'flat box duplicates vertices for face normals');
assert.equal(box.normals?.length, 24);
assert.equal(box.texcoords?.length, 24);
assert.equal(box.indices.length, 36);
assert.deepEqual(box.positions[0], [1, -1, -1]);

const plane = planeGeometry(16, 16, -1.1);
assert.equal(plane.positions.length, 4);
assert.deepEqual(plane.indices, [0, 2, 1, 0, 3, 2]);
assert.throws(() => new GlbBuilder().addMesh({
  name: 'incomplete',
  primitives: [{ geometry: { positions: [[0, 0, 0]], indices: [0] }, material: 0 }],
}), /complete triangles/);
assert.throws(() => new GlbBuilder().addMesh({
  name: 'invalid',
  primitives: [{ geometry: { positions: [[0, 0, 0]], indices: [1, 0, 0] }, material: 0 }],
}), /index is outside/);
assert.throws(() => new GlbBuilder().addAccessor([Number.NaN], 'SCALAR', 1), /finite/);

const temp = await mkdtemp(join(tmpdir(), 'g3-model-authoring-'));
try {
  const result = join(temp, 'sample.glb');
  const generator = fileURLToPath(new URL('./viewer/generate_sample.ts', import.meta.url));
  execFileSync(process.execPath, ['--experimental-strip-types', generator, result], { stdio: 'pipe' });
  const bytes = await readFile(result);
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  assert.equal(view.getUint32(0, true), 0x46546c67, 'GLB magic');
  assert.equal(view.getUint32(4, true), 2, 'GLB version');
  assert.equal(view.getUint32(8, true), bytes.byteLength, 'GLB declared file size');
  const jsonLength = view.getUint32(12, true);
  const document = JSON.parse(new TextDecoder().decode(bytes.subarray(20, 20 + jsonLength)));
  assert.equal(document.meshes.length, 2);
  assert.equal(document.materials.length, 3);
  assert.equal(document.nodes.length, 6);
  assert.equal(document.animations.length, 2);
  assert.equal(document.extensions.KHR_lights_punctual.lights.length, 2);
  assert.equal(document.images[0].mimeType, 'image/jpeg');
  assert.equal(document.buffers[0].byteLength, document.bufferViews.at(-1).byteOffset + document.bufferViews.at(-1).byteLength);
} finally {
  await rm(temp, { recursive: true, force: true });
}

console.log('model authoring checks passed');
