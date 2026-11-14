import { readFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { extname, join, normalize, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const webDir = resolve(fileURLToPath(new URL('.', import.meta.url)));
const mimeTypes = new Map([
  ['.css', 'text/css; charset=utf-8'],
  ['.glb', 'model/gltf-binary'],
  ['.hdr', 'image/vnd.radiance'],
  ['.html', 'text/html; charset=utf-8'],
  ['.jpeg', 'image/jpeg'],
  ['.jpg', 'image/jpeg'],
  ['.js', 'text/javascript; charset=utf-8'],
  ['.json', 'application/json; charset=utf-8'],
  ['.png', 'image/png'],
  ['.wasm', 'application/wasm'],
  ['.webp', 'image/webp'],
]);

export async function resolveReferenceRequest(requestUrl) {
  let pathname;
  try {
    pathname = decodeURIComponent(new URL(requestUrl, 'http://localhost').pathname);
  } catch {
    return { status: 400, headers: {}, body: 'Bad URL' };
  }
  const requestedPath = pathname.endsWith('/') ? `${pathname}index.html` : pathname;
  const normalizedPath = normalize(requestedPath);
  const fixtureRequest = normalizedPath.startsWith('/testdata/');
  const root = fixtureRequest ? resolve(webDir, '..') : webDir;
  const relative = normalizedPath.replace(/^([/\\]|\.\.(?:[/\\]|$))+/, '');
  const file = resolve(root, relative || 'index.html');
  if (file !== root && !file.startsWith(`${root}${sep}`)) {
    return { status: 403, headers: {}, body: 'Forbidden' };
  }
  try {
    const body = await readFile(file);
    return {
      status: 200,
      headers: {
        'content-type': mimeTypes.get(extname(file)) ?? 'application/octet-stream',
        'cache-control': 'no-store',
      },
      body,
    };
  } catch {
    return { status: 404, headers: {}, body: 'Not found' };
  }
}

export async function startReferenceTestServer() {
  const server = createServer(async (request, response) => {
    const result = await resolveReferenceRequest(request.url);
    response.writeHead(result.status, result.headers).end(result.body);
  });
  await new Promise((resolveListen, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolveListen);
  });
  return { server, port: server.address().port };
}
