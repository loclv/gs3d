import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const source = await readFile(new URL('./viewer/reference-checks.js', import.meta.url), 'utf8');
const glue = await readFile(new URL('./viewer/reference/app.js', import.meta.url), 'utf8');
const wasmBytes = await readFile(new URL('./viewer/reference/app.wasm', import.meta.url));
const wasm = new WebAssembly.Module(wasmBytes);
const wasmNames = new Set(WebAssembly.Module.exports(wasm).map(entry => entry.name));
const symbols = [...new Set([...source.matchAll(/engine\._(g3_reference_[A-Za-z0-9_]+)/g)].map(match => match[1]))];

for (const symbol of symbols) {
  const binding = glue.match(new RegExp(`Module\\["_${symbol}"\\]=wasmExports\\["([^"]+)"\\]`));
  assert.ok(binding, `Emscripten glue exposes ${symbol}`);
  assert.ok(wasmNames.has(binding[1]), `WebAssembly exports ${symbol} as ${binding[1]}`);
}

console.log(`reference WebAssembly export checks passed (${symbols.length} functions)`);
