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

    await page.send('Page.navigate', { url: `http://127.0.0.1:${port}/viewer/` });
    const waitFor = async (expression, description) => {
      const viewerDeadline = Date.now() + timeoutMs;
      while (Date.now() < viewerDeadline) {
        const value = await page.evaluate(expression);
        if (value) return value;
        await delay(200);
      }
      throw new Error(`Timed out waiting for ${description}`);
    };
    const initialViewer = await waitFor(`(() => {
      const status = document.querySelector('#status')?.textContent ?? '';
      return !document.querySelector('#reload')?.disabled && /^(Playing|Model loaded)/.test(status)
        ? { status, cameras: document.querySelector('#camera')?.options.length,
          lights: document.querySelector('#shadow-light')?.options.length,
          variants: document.querySelector('#variant')?.options.length,
          clips: document.querySelector('#animation-clip')?.options.length }
        : null;
    })()`, 'the bundled viewer model to load');
    assert.match(initialViewer.status, /^Playing Turntable/, 'viewer starts the bundled animation');
    assert.equal(initialViewer.cameras, 3, 'viewer exposes its default and two glTF cameras');
    assert.equal(initialViewer.lights, 3, 'viewer exposes point and spot shadow choices');
    assert.equal(initialViewer.variants, 2, 'viewer exposes the Blue paint material variant');
    assert.equal(initialViewer.clips, 2, 'viewer exposes both animation clips');

    const animationState = await page.evaluate(`(() => {
      const toggle = document.querySelector('#animation-toggle');
      toggle.click();
      const paused = toggle.getAttribute('aria-pressed') === 'false' && toggle.textContent === 'Play';
      toggle.click();
      const resumed = toggle.getAttribute('aria-pressed') === 'true' && toggle.textContent === 'Pause';
      const clip = document.querySelector('#animation-clip');
      clip.value = '1'; clip.dispatchEvent(new Event('change', { bubbles: true }));
      const switched = clip.value === '1';
      const time = document.querySelector('#animation-time');
      time.value = String(Number(time.max) * 0.4);
      time.dispatchEvent(new Event('input', { bubbles: true }));
      const sought = Number(time.value) > 0 && document.querySelector('#animation-time-value').value.includes('/');
      return { paused, resumed, switched, sought };
    })()`);
    assert.deepEqual(animationState, { paused: true, resumed: true, switched: true, sought: true },
      'viewer animation controls pause, resume, switch clips, and seek');

    const viewerControls = await page.evaluate(`(() => {
      const change = (selector, value, eventName = 'change') => {
        const element = document.querySelector(selector);
        element.value = value;
        element.dispatchEvent(new Event(eventName, { bubbles: true }));
        return element.value === value;
      };
      const camera = document.querySelector('#camera').options[1].value;
      const point = [...document.querySelector('#shadow-light').options].find(option => option.value.startsWith('point:'))?.value;
      const spot = [...document.querySelector('#shadow-light').options].find(option => option.value.startsWith('spot:'))?.value;
      return {
        camera: change('#camera', camera), point: point && change('#shadow-light', point),
        spot: spot && change('#shadow-light', spot), noShadow: change('#shadow-light', 'none'),
        variant: change('#variant', '0') && change('#variant', '-1'),
        yaw: change('#environment-rotation', '47', 'input'),
        hemisphere: change('#hemisphere-intensity', '0.8', 'input'),
      };
    })()`);
    assert.deepEqual(viewerControls, {
      camera: true, point: true, spot: true, noShadow: true,
      variant: true, yaw: true, hemisphere: true,
    }, 'viewer camera, shadow, variant, and environment controls respond');

    await page.evaluate("document.querySelector('#animation-toggle').click()");
    const canvasBounds = await page.evaluate(`(() => {
      const rect = document.querySelector('#canvas').getBoundingClientRect();
      const panel = document.querySelector('.panel').getBoundingClientRect();
      const leftWidth = Math.max(0, Math.min(rect.right, panel.left) - rect.left);
      const rightStart = Math.max(rect.left, panel.right);
      const rightWidth = Math.max(0, rect.right - rightStart);
      const segmentWidth = Math.max(leftWidth, rightWidth);
      const segmentStart = rightWidth >= leftWidth ? rightStart : rect.left;
      return {
        x: segmentStart + Math.min(24, segmentWidth * 0.1),
        endX: segmentStart + Math.min(112, segmentWidth * 0.8),
        y: rect.top + rect.height * 0.62,
        clip: { x: rect.left, y: rect.top, width: rect.width, height: rect.height, scale: 1 },
      };
    })()`);
    assert.ok(canvasBounds.endX - canvasBounds.x > 30, 'viewer canvas has a clear orbit-drag area');
    const beforeOrbit = await page.send('Page.captureScreenshot', { format: 'png', clip: canvasBounds.clip });
    await page.send('Input.dispatchMouseEvent', {
      type: 'mousePressed', x: canvasBounds.x, y: canvasBounds.y, button: 'left', clickCount: 1,
    });
    await page.send('Input.dispatchMouseEvent', {
      type: 'mouseMoved', x: canvasBounds.endX, y: canvasBounds.y, button: 'left', buttons: 1,
    });
    await page.send('Input.dispatchMouseEvent', {
      type: 'mouseReleased', x: canvasBounds.endX, y: canvasBounds.y, button: 'left', clickCount: 1,
    });
    await page.evaluate('new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))');
    const afterOrbit = await page.send('Page.captureScreenshot', { format: 'png', clip: canvasBounds.clip });
    assert.notEqual(afterOrbit.data, beforeOrbit.data, 'dragging the viewer changes the rendered camera view');

    const canvasPoint = await page.evaluate(`(() => {
      const rect = document.querySelector('#canvas').getBoundingClientRect();
      return { x: rect.left + rect.width * 0.52, y: rect.top + rect.height * 0.52 };
    })()`);
    const clickOffsets = [
      [0, 0], [35, 0], [-35, 0], [0, 35], [0, -35], [70, 25], [-70, 25],
      [35, 55], [-35, 55], [70, -25], [-70, -25], [0, 70], [0, -70],
    ];
    let selection = null;
    for (const [dx, dy] of clickOffsets) {
      const x = canvasPoint.x + dx;
      const y = canvasPoint.y + dy;
      await page.send('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'left', clickCount: 1 });
      await page.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'left', clickCount: 1 });
      selection = await page.evaluate(`(() => ({ status: document.querySelector('#status').textContent,
        inspection: document.querySelector('#inspection').textContent,
        previews: document.querySelector('#texture-previews').childElementCount }))()`);
      if (selection.status.startsWith('Selected ') && selection.previews > 0) break;
    }
    assert.ok(selection?.status.startsWith('Selected ') && selection.previews > 0,
      'clicking the textured sample selects a mesh with material texture previews');
    assert.notEqual(selection.inspection, 'Click a mesh to inspect its material.', 'mesh selection updates material inspection');
    const materialEnvironment = await page.evaluate(`(() => {
      const slider = document.querySelector('#environment-intensity');
      if (slider.disabled) return null;
      slider.value = '0.5';
      slider.dispatchEvent(new Event('input', { bubbles: true }));
      return { enabled: !slider.disabled, value: slider.value, output: document.querySelector('#environment-value').value };
    })()`);
    assert.deepEqual(materialEnvironment, { enabled: true, value: '0.5', output: '0.50' },
      'selected material environment intensity updates');

    await page.evaluate("document.querySelector('#reload').click()");
    const reloaded = await waitFor(`(() => {
      const status = document.querySelector('#status')?.textContent ?? '';
      return !document.querySelector('#reload')?.disabled && /^Playing Turntable/.test(status) ? status : null;
    })()`, 'the viewer to finish reloading the model');
    assert.match(reloaded, /imported lights active/, 'reload restores the sample and its imported lights');

    const viewerExceptions = page.events
      .filter(event => event.method === 'Runtime.exceptionThrown')
      .map(event => event.params.exceptionDetails?.text ?? event.params.exceptionDetails?.exception?.description ?? 'uncaught page exception');
    if (viewerExceptions.length) throw new Error(`Viewer raised uncaught exceptions: ${viewerExceptions.join('; ')}`);
    console.log(`browser reference checks passed (${result.results.length} rendering checks); viewer integration checks passed with ${version.Browser}`);
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
