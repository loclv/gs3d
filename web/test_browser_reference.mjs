#!/usr/bin/env node
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { access, mkdtemp, readFile, rm } from 'node:fs/promises';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { extname, join, normalize, resolve, sep } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';

const webDir = fileURLToPath(new URL('.', import.meta.url));
const defaultChromePaths = [
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/Applications/Chromium.app/Contents/MacOS/Chromium',
  '/usr/bin/google-chrome',
  '/usr/bin/chromium',
  '/usr/bin/chromium-browser',
];
const mimeTypes = new Map([
  ['.css', 'text/css; charset=utf-8'],
  ['.glb', 'model/gltf-binary'],
  ['.html', 'text/html; charset=utf-8'],
  ['.js', 'text/javascript; charset=utf-8'],
  ['.json', 'application/json; charset=utf-8'],
  ['.wasm', 'application/wasm'],
]);

function argument(name) {
  const index = process.argv.indexOf(name);
  return index < 0 ? null : process.argv[index + 1] ?? null;
}

function usage() {
  console.log('Usage: node web/test_browser_reference.mjs [--chrome PATH] [--timeout-ms N]');
  console.log('Build first with ./build_web.sh --reference-checks. Uses headless Chrome and local WebGL checks.');
}

if (process.argv.includes('--help')) {
  usage();
  process.exit(0);
}

async function findChrome() {
  const explicit = argument('--chrome') ?? process.env.G3_CHROME;
  if (explicit) {
    await access(explicit);
    return explicit;
  }
  for (const candidate of defaultChromePaths) {
    try {
      await access(candidate);
      return candidate;
    } catch {}
  }
  throw new Error('Chrome or Chromium not found; set G3_CHROME or pass --chrome PATH');
}

async function serveWeb() {
  const server = createServer(async (request, response) => {
    let pathname;
    try {
      pathname = decodeURIComponent(new URL(request.url, 'http://localhost').pathname);
    } catch {
      response.writeHead(400).end('Bad URL');
      return;
    }
    const relative = normalize(pathname).replace(/^([/\\]|\.\.(?:[/\\]|$))+/, '');
    const file = resolve(webDir, relative || 'index.html');
    if (file !== webDir && !file.startsWith(`${webDir}${sep}`)) {
      response.writeHead(403).end('Forbidden');
      return;
    }
    try {
      const content = await readFile(file);
      response.writeHead(200, {
        'content-type': mimeTypes.get(extname(file)) ?? 'application/octet-stream',
        'cache-control': 'no-store',
      }).end(content);
    } catch {
      response.writeHead(404).end('Not found');
    }
  });
  await new Promise((resolveListen, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolveListen);
  });
  return { server, port: server.address().port };
}

async function waitForDevtools(port, child) {
  const deadline = Date.now() + 15_000;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) throw new Error(`Chrome exited early (${child.exitCode})`);
    try {
      const response = await fetch(`http://127.0.0.1:${port}/json/version`);
      if (response.ok) return response.json();
    } catch {}
    await delay(100);
  }
  throw new Error('Chrome DevTools did not start within 15 seconds');
}

class DevtoolsPage {
  constructor(socket) {
    this.socket = socket;
    this.nextId = 1;
    this.pending = new Map();
    this.events = [];
    socket.addEventListener('message', event => {
      let message;
      try { message = JSON.parse(event.data); } catch { return; }
      if (message.id) {
        const pending = this.pending.get(message.id);
        if (!pending) return;
        this.pending.delete(message.id);
        if (message.error) pending.reject(new Error(message.error.message));
        else pending.resolve(message.result);
      } else if (message.method) {
        this.events.push(message);
      }
    });
    socket.addEventListener('close', () => {
      for (const pending of this.pending.values()) pending.reject(new Error('Chrome DevTools connection closed'));
      this.pending.clear();
    });
  }

  async send(method, params = {}) {
    const id = this.nextId++;
    const result = new Promise((resolveResult, rejectResult) => {
      this.pending.set(id, { resolve: resolveResult, reject: rejectResult });
    });
    this.socket.send(JSON.stringify({ id, method, params }));
    return result;
  }

  async evaluate(expression) {
    const response = await this.send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
    if (response.exceptionDetails) throw new Error(response.exceptionDetails.text ?? 'Page evaluation failed');
    return response.result?.value;
  }
}

async function run() {
  for (const path of ['viewer/reference-checks.html', 'viewer/reference-checks.js', 'viewer/reference/app.js', 'viewer/reference/app.wasm', 'viewer/reference/sample.glb']) {
    try {
      await access(join(webDir, path));
    } catch {
      throw new Error(`Missing ${path}; build first with ./build_web.sh --reference-checks`);
    }
  }

  const chrome = await findChrome();
  const timeoutMs = Number(argument('--timeout-ms') ?? 120_000);
  assert.ok(Number.isFinite(timeoutMs) && timeoutMs > 0, '--timeout-ms must be a positive number');
  const { server, port } = await serveWeb();
  const tempProfile = await mkdtemp(join(tmpdir(), 'g3-reference-chrome-'));
  const remotePortServer = createServer();
  await new Promise((resolveListen, reject) => {
    remotePortServer.once('error', reject);
    remotePortServer.listen(0, '127.0.0.1', resolveListen);
  });
  const remotePort = remotePortServer.address().port;
  await new Promise(resolveClose => remotePortServer.close(resolveClose));
  const chromeArgs = [
    '--headless=new', '--enable-unsafe-swiftshader', '--use-angle=swiftshader',
    '--no-first-run', '--no-default-browser-check', '--disable-dev-shm-usage',
    '--disable-background-networking',
    `--remote-debugging-port=${remotePort}`, `--user-data-dir=${tempProfile}`, 'about:blank',
  ];
  if (process.getuid?.() === 0) chromeArgs.push('--no-sandbox');
  const child = spawn(chrome, chromeArgs, { stdio: 'ignore' });
  let socket;
  try {
    const version = await waitForDevtools(remotePort, child);
    const targetResponse = await fetch(`http://127.0.0.1:${remotePort}/json/new?about:blank`, { method: 'PUT' });
    if (!targetResponse.ok) throw new Error(`Could not create Chrome tab (${targetResponse.status})`);
    const target = await targetResponse.json();
    socket = new WebSocket(target.webSocketDebuggerUrl);
    await new Promise((resolveOpen, reject) => {
      socket.addEventListener('open', resolveOpen, { once: true });
      socket.addEventListener('error', reject, { once: true });
    });
    const page = new DevtoolsPage(socket);
    await page.send('Runtime.enable');
    await page.send('Page.enable');
    await page.send('Page.navigate', { url: `http://127.0.0.1:${port}/viewer/reference-checks.html` });

    const deadline = Date.now() + timeoutMs;
    let result;
    while (Date.now() < deadline) {
      result = await page.evaluate('window.__g3ReferenceChecks ?? null');
      if (result) break;
      await delay(200);
    }
    if (!result) throw new Error(`Browser checks did not finish within ${timeoutMs} ms`);
    if (!result.passed) {
      const failed = (result.results ?? []).filter(check => !check.ok).map(check => check.name);
      throw new Error(`Browser checks failed: ${result.error ?? 'unknown error'}${failed.length ? `; failed checks: ${failed.join('; ')}` : ''}`);
    }
    const runtimeErrors = page.events
      .filter(event => event.method === 'Runtime.exceptionThrown')
      .map(event => event.params.exceptionDetails?.text ?? event.params.exceptionDetails?.exception?.description ?? 'uncaught page exception');
    if (runtimeErrors.length) throw new Error(`Browser raised uncaught exceptions: ${runtimeErrors.join('; ')}`);
    console.log(`browser reference checks passed (${result.results.length} checks) with ${version.Browser}`);
  } finally {
    socket?.close();
    child.kill('SIGTERM');
    await new Promise(resolveExit => {
      if (child.exitCode !== null) resolveExit();
      else {
        child.once('exit', resolveExit);
        setTimeout(() => { child.kill('SIGKILL'); resolveExit(); }, 3000).unref();
      }
    });
    await Promise.all([
      new Promise(resolveClose => server.close(resolveClose)),
      rm(tempProfile, { recursive: true, force: true }),
    ]);
  }
}

run().catch(error => {
  console.error(error.message);
  process.exitCode = 1;
});
