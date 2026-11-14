import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const assetHelpers = await readFile(new URL('./assets.js', import.meta.url), 'utf8');
const webBuildScript = await readFile(new URL('../build_web.sh', import.meta.url), 'utf8');
const viewerSource = await readFile(new URL('./viewer/viewer.js', import.meta.url), 'utf8');
const viewerRoot = await readFile(new URL('../src/viewer_web.goose', import.meta.url), 'utf8');
const referenceChecks = await readFile(new URL('./viewer/reference-checks.js', import.meta.url), 'utf8');
const referenceRoot = await readFile(new URL('../src/reference_web.goose', import.meta.url), 'utf8');
const engineImports = [...new Set([...assetHelpers.matchAll(/engine\._(g3_(?:asset|host)_[A-Za-z0-9_]+)/g)].map(match => match[1]))];
for (const symbol of engineImports) {
  assert.ok(webBuildScript.includes(`"_${symbol}"`), `build_web.sh exports ${symbol}`);
}
const viewerModeStart = webBuildScript.indexOf('elif [ "${1:-}" = "--viewer" ]; then');
assert.notEqual(viewerModeStart, -1, 'build_web.sh defines the viewer build mode');
const nextMode = webBuildScript.indexOf('\nelif ', viewerModeStart);
const viewerMode = webBuildScript.slice(viewerModeStart, nextMode < 0 ? undefined : nextMode);
const viewerExportJson = viewerMode.match(/exports='([^']+)'/)?.[1];
assert.ok(viewerExportJson, 'the viewer build mode defines its WebAssembly exports');
const viewerExports = new Set(JSON.parse(viewerExportJson));
const platformViewerExports = new Set(['g3_host_start', 'g3_input_resize']);
const viewerImports = [...new Set([...viewerSource.matchAll(/engine\??\._(g3_[A-Za-z0-9_]+)/g)].map(match => match[1]))];
for (const symbol of viewerImports) {
  assert.ok(viewerExports.has(`_${symbol}`), `the viewer build mode exports ${symbol}`);
  if (!platformViewerExports.has(symbol)) {
    assert.ok(viewerRoot.includes(`export fn ${symbol}(`), `viewer_web.goose exports ${symbol}`);
  }
}
const referenceImports = [...new Set([...referenceChecks.matchAll(/engine\._(g3_reference_[A-Za-z0-9_]+)/g)].map(match => match[1]))];
for (const symbol of referenceImports) {
  assert.ok(webBuildScript.includes(`"_${symbol}"`), `build_web.sh exports ${symbol}`);
  assert.ok(referenceRoot.includes(`export fn ${symbol}(`), `reference_web.goose exports ${symbol}`);
}
console.log(`browser build export checks passed (${engineImports.length} asset host functions, ${viewerImports.length} viewer functions, ${referenceImports.length} reference functions)`);
