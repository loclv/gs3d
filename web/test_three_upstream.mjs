// Run selected, unmodified Three.js QUnit cases against the supported facade.
// Upstream: mrdoob/three.js fad374c211d3fd8759cebe41f09e40975a6de04b
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import * as THREE from './three.js';

const selected = {
  Vector2: ['Instancing', 'isVector2', 'set', 'copy', 'negate', 'dot', 'cross', 'equals'],
  Vector3: ['Instancing', 'isVector3', 'set', 'copy', 'addScaledVector', 'negate', 'dot', 'applyEuler', 'applyAxisAngle', 'applyQuaternion'],
};
let passed = 0, skipped = 0;
for (const [name, names] of Object.entries(selected)) {
  const pending = new Set(names);
  const QUnit = {
    module(_name, callback) { callback(); },
    test(testName, callback) {
      if (!pending.has(testName)) { skipped++; return; }
      pending.delete(testName);
      try { callback({ ok: assert.ok, strictEqual: assert.strictEqual, deepEqual: assert.deepEqual }); }
      catch (error) { throw new Error(`${name}: ${testName}`, { cause: error }); }
      passed++;
    },
  };
  const source = await readFile(new URL(`./testdata/three-upstream/${name}.tests.js`, import.meta.url), 'utf8');
  const body = source.replace(/import\s+[\s\S]*?\s+from\s+['"][^'"]+['"];\s*/g, '')
    .replace('export default QUnit.module', 'QUnit.module');
  // Unsupported imports are only used by cases outside the explicit selection.
  new Function('QUnit', 'Vector2', 'Vector3', 'Euler', 'Quaternion', 'x', 'y', 'z', 'eps', body)(
    QUnit, THREE.Vector2, THREE.Vector3, THREE.Euler, THREE.Quaternion, 2, 3, 4, 0.0001);
  assert.equal(pending.size, 0, `${name}: missing upstream cases: ${[...pending].join(', ')}`);
}
console.log(`Three.js upstream: ${passed} cases passed, ${skipped} cases not selected`);
