import assert from 'node:assert/strict';
import { access, readFile } from 'node:fs/promises';

const html = await readFile(new URL('./viewer/index.html', import.meta.url), 'utf8');
const source = await readFile(new URL('./viewer/viewer.js', import.meta.url), 'utf8');
const exampleHtml = await readFile(new URL('./examples/model-loader/index.html', import.meta.url), 'utf8');
const exampleSource = await readFile(new URL('./examples/model-loader/model-loader.js', import.meta.url), 'utf8');
const sampleGlb = await readFile(new URL('./viewer/sample.glb', import.meta.url));
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
const exampleImportMapBlock = exampleHtml.match(/<script\s+type="importmap">([\s\S]*?)<\/script>/i)?.[1];
assert.ok(exampleImportMapBlock, 'the package consumer example provides an import map');
const exampleImportMap = JSON.parse(exampleImportMapBlock).imports;
const exampleImports = [...new Set([...exampleSource.matchAll(/from\s+['"](goose-3d-browser-assets(?:\/[^'"]*)?)['"]/g)].map(match => match[1]))];
assert.ok(exampleImports.includes('goose-3d-browser-assets') && exampleImports.includes('goose-3d-browser-assets/orbit-controls'),
  'the package consumer example imports both public package subpaths');
for (const specifier of exampleImports) {
  assert.ok(exampleImportMap[specifier], `the package consumer import map resolves ${specifier}`);
  await access(new URL(exampleImportMap[specifier], new URL('./examples/model-loader/index.html', import.meta.url)));
}
assert.ok(exampleSource.includes('loadGLTF(engine, url)'), 'the consumer example loads the entered model URL');
assert.ok(exampleSource.includes('model.dispose()'), 'the consumer example disposes replaced models');
assert.ok(exampleSource.includes('error.code'), 'the consumer example reports structured asset errors');
assert.ok(exampleSource.includes('raw.githubusercontent.com/mrdoob/three.js') &&
  exampleHtml.includes('licensed CC0 1.0'), 'the consumer example identifies its remote sample and license');
for (const control of ['animation-controls', 'animation-clip', 'animation-toggle', 'animation-time']) {
  assert.ok(html.includes(`id="${control}"`), `the viewer has a ${control} control`);
}
for (const method of ['playAnimation', 'pauseAnimation', 'resumeAnimation', 'seekAnimation']) {
  assert.ok(source.includes(`.${method}(`), `the viewer wires ${method} to its animation controls`);
}
assert.ok(source.includes('model?.animationTime'), 'the time control follows the active clip');
assert.equal(sampleGlb.readUInt32LE(0), 0x46546c67, 'the viewer sample is a GLB');
const jsonChunkLength = sampleGlb.readUInt32LE(12);
const sample = JSON.parse(sampleGlb.subarray(20, 20 + jsonChunkLength).toString('utf8'));
assert.deepEqual(sample.animations.map(animation => animation.name), ['Turntable', 'Bob'], 'the sample provides switchable clips');
console.log(`viewer package import map checks passed (${packageImports.length} imports)`);
