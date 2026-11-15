#!/usr/bin/env node
// Compare two bridge versions with the same built benchmark and isolated devices.
import { createServer } from 'node:http';
import { spawn } from 'node:child_process';
import { access, mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { extname, join, resolve, sep } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';

const baselinePath = process.argv[2];
if (!baselinePath) throw new Error('Usage: node web/benchmark/measure-webgpu.mjs BASELINE_WEBGPU_JS [MOTION]');
const motion = Number(process.argv[3] ?? 32);
if (!Number.isInteger(motion) || motion < 0 || motion > 1024) throw new Error('MOTION must be an integer from 0 to 1024');
const root = fileURLToPath(new URL('../', import.meta.url));
const baseline = await readFile(baselinePath);
const chrome = process.env.G3_CHROME ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
await access(chrome);
const server = createServer(async (req, res) => {
  try {
    const url = new URL(req.url, 'http://localhost');
    const [, mode, ...parts] = url.pathname.split('/');
    if (!['before', 'after'].includes(mode)) throw Error('unknown mode');
    const path = resolve(root, ...parts);
    if (!path.startsWith(root.endsWith(sep) ? root : root + sep)) throw Error('outside root');
    const bytes = parts.join('/') === 'webgpu.js' && mode === 'before' ? baseline : await readFile(path);
    res.setHeader('Content-Type', ({ '.js': 'text/javascript', '.html': 'text/html', '.wasm': 'application/wasm' })[extname(path)] ?? 'application/octet-stream');
    res.end(bytes);
  } catch { res.writeHead(404).end(); }
});
await new Promise(resolveListen => server.listen(0, '127.0.0.1', resolveListen));
const port = server.address().port;

async function run(mode) {
  const profile = await mkdtemp(join(tmpdir(), 'g3-webgpu-bench-'));
  // A temporary listener reserves an available loopback port for DevTools.
  const probe = createServer();
  await new Promise(resolveListen => probe.listen(0, '127.0.0.1', resolveListen));
  const devtoolsPort = probe.address().port;
  await new Promise(resolveClose => probe.close(resolveClose));
  const args = ['--headless=new', '--enable-unsafe-webgpu', '--use-webgpu-adapter=swiftshader',
    '--enable-unsafe-swiftshader', '--use-angle=swiftshader', '--no-first-run', '--disable-background-networking',
    `--remote-debugging-port=${devtoolsPort}`, `--user-data-dir=${profile}`, 'about:blank'];
  if (process.getuid?.() === 0) args.push('--no-sandbox');
  const child = spawn(chrome, args, { stdio: 'ignore' });
  let socket;
  try {
    let ready = false;
    for (let i = 0; i < 150; i++) {
      if (child.exitCode !== null) throw Error(`Chrome exited (${child.exitCode})`);
      try { ready = (await fetch(`http://127.0.0.1:${devtoolsPort}/json/version`)).ok; } catch {}
      if (ready) break;
      await delay(100);
    }
    if (!ready) throw Error('Chrome DevTools did not start');
    const target = await (await fetch(`http://127.0.0.1:${devtoolsPort}/json/new?about:blank`, { method: 'PUT' })).json();
    socket = new WebSocket(target.webSocketDebuggerUrl);
    await new Promise((ok, fail) => { socket.onopen = ok; socket.onerror = fail; });
    let id = 0;
    const pending = new Map();
    socket.onmessage = event => {
      const message = JSON.parse(event.data), callbacks = pending.get(message.id);
      if (!callbacks) return;
      pending.delete(message.id);
      if (message.error) callbacks.reject(Error(message.error.message)); else callbacks.resolve(message.result);
    };
    const send = (method, params = {}) => new Promise((resolveResult, reject) => {
      const next = ++id;
      pending.set(next, { resolve: resolveResult, reject });
      socket.send(JSON.stringify({ id: next, method, params }));
    });
    const evaluate = async expression => {
      const response = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
      if (response.exceptionDetails) throw Error(JSON.stringify(response.exceptionDetails));
      return response.result.value;
    };
    await send('Page.enable');
    await send('Runtime.enable');
    await send('Emulation.setDeviceMetricsOverride', { width: 320, height: 180, deviceScaleFactor: 1, mobile: false });
    await send('Page.navigate', { url: `http://127.0.0.1:${port}/${mode}/benchmark/compare.html?backend=goose&count=1024&motion=${motion}&sync=1` });
    let state;
    for (let i = 0; i < 200; i++) {
      state = await evaluate('({ready:!!window.g3BenchmarkSync, renderer:window.g3Renderer, status:document.querySelector("#status")?.textContent})');
      if (state.ready) break;
      await delay(100);
    }
    if (!state?.ready || state.renderer !== 'WebGPU') throw Error(`WebGPU benchmark did not start: ${JSON.stringify(state)}`);
    const result = await evaluate(`(() => {
      const frame = window.g3BenchmarkSync.frame;
      for (let i = 0; i < 100; i++) frame(1/60);
      const start = performance.now();
      for (let i = 0; i < 500; i++) frame(1/60);
      return { ms: (performance.now()-start)/500, calls: window.g3wgpu.drawCalls() };
    })()`);
    console.log(JSON.stringify({ motion, mode, ...result }));
  } finally {
    socket?.close();
    child.kill();
    await new Promise(resolveExit => { if (child.exitCode !== null) resolveExit(); else child.once('exit', resolveExit); });
    await rm(profile, { recursive: true, force: true });
  }
}
try {
  for (const mode of ['before', 'after', 'after', 'before', 'before', 'after']) await run(mode);
} finally { await new Promise(resolveClose => server.close(resolveClose)); }
