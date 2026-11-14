import assert from 'node:assert/strict';
import { access, readFile } from 'node:fs/promises';

const manifest = JSON.parse(await readFile(new URL('./package.json', import.meta.url), 'utf8'));
for (const [subpath, entry] of Object.entries(manifest.exports)) {
  assert.ok(entry.import && entry.types, `${subpath} declares JavaScript and TypeScript entry points`);
  await access(new URL(entry.import, import.meta.url));
  await access(new URL(entry.types, import.meta.url));
  const specifier = subpath === '.' ? manifest.name : `${manifest.name}${subpath.slice(1)}`;
  const module = await import(specifier);
  assert.ok(Object.keys(module).length > 0, `${specifier} resolves through package exports`);
}

const assets = await import(manifest.name);
const orbit = await import(`${manifest.name}/orbit-controls`);
assert.equal(typeof assets.loadGLTF, 'function');
assert.equal(typeof assets.AssetError, 'function');
assert.equal(typeof orbit.createOrbitControls, 'function');
console.log(`package export checks passed (${Object.keys(manifest.exports).length} subpaths)`);
