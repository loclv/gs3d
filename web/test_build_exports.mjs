import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const assetHelpers = await readFile(new URL('./assets.js', import.meta.url), 'utf8');
const webBuildScript = await readFile(new URL('../build_web.sh', import.meta.url), 'utf8');
const engineImports = [...new Set([...assetHelpers.matchAll(/engine\._(g3_(?:asset|host)_[A-Za-z0-9_]+)/g)].map(match => match[1]))];
for (const symbol of engineImports) {
  assert.ok(webBuildScript.includes(`"_${symbol}"`), `build_web.sh exports ${symbol}`);
}
console.log(`browser build export checks passed (${engineImports.length} host functions)`);
