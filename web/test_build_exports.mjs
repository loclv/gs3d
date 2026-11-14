import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const assetHelpers = await readFile(new URL('./assets.js', import.meta.url), 'utf8');
const webBuildScript = await readFile(new URL('../build_web.sh', import.meta.url), 'utf8');
const referenceChecks = await readFile(new URL('./viewer/reference-checks.js', import.meta.url), 'utf8');
const referenceRoot = await readFile(new URL('../src/reference_web.goose', import.meta.url), 'utf8');
const engineImports = [...new Set([...assetHelpers.matchAll(/engine\._(g3_(?:asset|host)_[A-Za-z0-9_]+)/g)].map(match => match[1]))];
for (const symbol of engineImports) {
  assert.ok(webBuildScript.includes(`"_${symbol}"`), `build_web.sh exports ${symbol}`);
}
const referenceImports = [...new Set([...referenceChecks.matchAll(/engine\._(g3_reference_[A-Za-z0-9_]+)/g)].map(match => match[1]))];
for (const symbol of referenceImports) {
  assert.ok(webBuildScript.includes(`"_${symbol}"`), `build_web.sh exports ${symbol}`);
  assert.ok(referenceRoot.includes(`export fn ${symbol}(`), `reference_web.goose exports ${symbol}`);
}
console.log(`browser build export checks passed (${engineImports.length} asset host functions, ${referenceImports.length} reference functions)`);
