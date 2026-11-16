import assert from 'node:assert/strict';
import { access, readFile } from 'node:fs/promises';

const manifest = JSON.parse(await readFile(new URL('./package.json', import.meta.url), 'utf8'));
const exportedFiles = new Set();
for (const [subpath, entry] of Object.entries(manifest.exports)) {
  assert.ok(entry.import && entry.types, `${subpath} declares JavaScript and TypeScript entry points`);
  exportedFiles.add(entry.import.replace(/^\.\//, ''));
  exportedFiles.add(entry.types.replace(/^\.\//, ''));
  await access(new URL(entry.import, import.meta.url));
  await access(new URL(entry.types, import.meta.url));
  const specifier = subpath === '.' ? manifest.name : `${manifest.name}${subpath.slice(1)}`;
  const module = await import(specifier);
  assert.ok(Object.keys(module).length > 0, `${specifier} resolves through package exports`);
}
exportedFiles.add('LICENSE');
// ./three needs the compiled engine at runtime; it is shipped data, not an
// export entry point, so the allowlist check names it explicitly.
for (const runtimeFile of ['gs3d/app.js', 'gs3d/app.wasm']) {
  exportedFiles.add(runtimeFile);
  await access(new URL(runtimeFile, import.meta.url));
}
assert.deepEqual([...manifest.files].sort(), [...exportedFiles].sort(),
  'the published allowlist contains the exported modules, runtime assets, and the optional license file');

const assets = await import(manifest.name);
const orbit = await import(`${manifest.name}/orbit-controls`);
assert.equal(typeof assets.loadGLTF, 'function');
assert.equal(typeof assets.AssetError, 'function');
assert.equal(typeof orbit.createOrbitControls, 'function');
console.log(`package export checks passed (${Object.keys(manifest.exports).length} subpaths)`);
