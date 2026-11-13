import assert from 'node:assert/strict';
import { access, readFile } from 'node:fs/promises';

const html = await readFile(new URL('./viewer/index.html', import.meta.url), 'utf8');
const source = await readFile(new URL('./viewer/viewer.js', import.meta.url), 'utf8');
const importMapBlock = html.match(/<script\s+type="importmap">([\s\S]*?)<\/script>/i)?.[1];
assert.ok(importMapBlock, 'the viewer page provides an import map');
const importMap = JSON.parse(importMapBlock).imports;
const packageImports = [...new Set([...source.matchAll(/from\s+['"](goose-3d-browser-assets(?:\/[^'"]*)?)['"]/g)].map(match => match[1]))];
assert.ok(packageImports.length > 0, 'the viewer imports the browser package');
for (const specifier of packageImports) {
  const target = importMap[specifier];
  assert.ok(target, `the viewer import map resolves ${specifier}`);
  await access(new URL(target, new URL('./viewer/index.html', import.meta.url)));
}
console.log(`viewer package import map checks passed (${packageImports.length} imports)`);
