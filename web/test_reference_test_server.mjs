import assert from 'node:assert/strict';
import { resolveReferenceRequest } from './reference-test-server.mjs';

const root = await resolveReferenceRequest('/');
assert.equal(root.status, 200, 'root URL serves the browser app');
assert.match(root.headers['content-type'], /^text\/html/);
assert.match(root.body.toString(), /id="canvas"/);

const viewer = await resolveReferenceRequest('/viewer/');
assert.equal(viewer.status, 200, 'directory URLs resolve to their index page');
assert.match(viewer.body.toString(), /id="animation-controls"/);

const image = await resolveReferenceRequest('/game/ground.jpg');
assert.equal(image.status, 200, 'browser reference image fixture is served');
assert.equal(image.headers['content-type'], 'image/jpeg');

const wasm = await resolveReferenceRequest('/viewer/reference/app.wasm');
assert.ok([200, 404].includes(wasm.status), 'optional generated artifacts return a successful or missing-file status');
if (wasm.status === 200) assert.equal(wasm.headers['content-type'], 'application/wasm');

const malformed = await resolveReferenceRequest('/%E0%A4%A');
assert.equal(malformed.status, 400, 'malformed escaped URL paths return a client error');
console.log('browser reference server route checks passed (indexes, MIME types, missing files, and malformed URLs)');
