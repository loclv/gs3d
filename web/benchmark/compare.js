import { fitToDisplay } from '../canvas.js';

const MAX_INSTANCES = 1024;
const WARMUP_FRAMES = 120;
const SAMPLE_FRAMES = 300;
const requestedBackend = new URLSearchParams(location.search).get('backend');
const BACKEND = ['three', 'three-webgpu'].includes(requestedBackend) ? requestedBackend : 'goose';
const canvas = document.getElementById('canvas');
const status = document.getElementById('status');
const slider = document.getElementById('nodes');
const countLabel = document.getElementById('count');
const results = document.getElementById('results');
const params = new URLSearchParams(location.search);
const rotating = params.get('rotate') === '1';
const spread = params.get('spread') === '1';
document.getElementById('rotate').checked = rotating;
document.getElementById('rotate').addEventListener('change', event => {
  const target = new URL(location.href);
  target.searchParams.set('rotate', event.target.checked ? '1' : '0');
  target.searchParams.set('count', slider.value);
  location.href = target.href;
});
const requestedMotion = Number(params.get('motion'));
const movingCount = Number.isInteger(requestedMotion) && requestedMotion >= 0
  ? Math.min(requestedMotion, MAX_INSTANCES) : 0;
const motionSelect = document.getElementById('motion');
if (![...motionSelect.options].some(option => Number(option.value) === movingCount)) {
  motionSelect.add(new Option(String(movingCount), String(movingCount)));
}
motionSelect.value = String(movingCount);
motionSelect.addEventListener('change', () => {
  const target = new URL(location.href);
  target.searchParams.set('motion', motionSelect.value);
  target.searchParams.set('count', slider.value);
  location.href = target.href;
});
const requestedCount = Number(params.get('count'));
if (Number.isInteger(requestedCount) && requestedCount >= 1 && requestedCount <= MAX_INSTANCES) {
  slider.value = String(requestedCount);
  countLabel.value = String(requestedCount);
}
for (const link of document.querySelectorAll('nav a')) {
  const target = new URL(link.href);
  target.searchParams.set('count', slider.value);
  target.searchParams.set('motion', String(movingCount));
  target.searchParams.set('rotate', rotating ? '1' : '0');
  target.searchParams.set('spread', spread ? '1' : '0');
  link.href = target;
}
document.getElementById(`${BACKEND}-link`).setAttribute('aria-current', 'page');

let frameCall;
let getDrawCalls;
let getBackendFrameMs;
let resizeRenderer;
let previous = 0;
let warmup = 0;
let cpuTimes = [];
let rafTimes = [];
let backendTimes = [];
let gpuGl;
let gpuTimerExt;
let webgpuTimer;
let gpuPending = [];
let gpuTimes = [];
let gpuDisjointCount = 0;
let gpuSkippedCount = 0;
let gpuWaitFrames = 0;
let sampleReported = false;

function resetSample() {
  webgpuTimer?.gpuTimestampEnd();
  if (gpuGl) for (const item of gpuPending) gpuGl.deleteQuery(item.query);
  gpuPending = [];
  warmup = 0;
  cpuTimes = [];
  rafTimes = [];
  backendTimes = [];
  gpuTimes = [];
  gpuDisjointCount = 0;
  gpuSkippedCount = 0;
  gpuWaitFrames = 0;
  sampleReported = false;
  results.textContent = 'warming up…';
}

function percentile(values, p) {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.floor((sorted.length - 1) * p))] ?? 0;
}

function report() {
  const meanRaf = rafTimes.reduce((sum, value) => sum + value, 0) / rafTimes.length;
  const label = BACKEND === 'three' ? 'Three.js WebGL2' : BACKEND === 'three-webgpu' ? `Three.js ${window.threeRenderer ?? 'WebGPU/WebGL2'}` : `Goose 3D ${window.g3Renderer ?? 'renderer'}`;
  const backendLine = backendTimes.length
    ? `\n${window.g3Renderer === 'WebGPU' ? 'WebGPU CPU submit' : 'WebGL backend'} median ${percentile(backendTimes, 0.5).toFixed(2)} ms · ` +
      `p95 ${percentile(backendTimes, 0.95).toFixed(2)} ms`
    : '';
  const gpuLine = !(gpuTimerExt || webgpuTimer)
    ? '\nGPU timer query unavailable'
    : gpuTimes.length
      ? `\nGPU median ${percentile(gpuTimes, 0.5).toFixed(2)} ms · ` +
        `p95 ${percentile(gpuTimes, 0.95).toFixed(2)} ms (${gpuTimes.length}/${SAMPLE_FRAMES} samples)` +
        (gpuDisjointCount ? ` · ${gpuDisjointCount} disjoint samples` : '') +
        (gpuSkippedCount ? ` · ${gpuSkippedCount} skipped` : '')
      : `\nGPU timing unavailable (${gpuDisjointCount} disjoint, ${gpuSkippedCount} skipped)`;
  results.textContent =
    `${label} · ${slider.value} visible cubes · ${getDrawCalls()} scene draw call(s)\n` +
    `${Math.min(movingCount, Number(slider.value))} moving instances/frame${rotating ? ' · rotating' : ''}\n` +
    `${(1000 / meanRaf).toFixed(1)} browser frames/s\n` +
    `frame call median ${percentile(cpuTimes, 0.5).toFixed(2)} ms · ` +
    `p95 ${percentile(cpuTimes, 0.95).toFixed(2)} ms${backendLine}${gpuLine}\n` +
    `sample: ${SAMPLE_FRAMES} frames after ${WARMUP_FRAMES} warmup frames`;
}

function pollGpuQueries() {
  if (!gpuTimerExt) return false;
  if (gpuGl.getParameter(gpuTimerExt.GPU_DISJOINT_EXT)) {
    const invalidated = gpuPending.length + gpuTimes.length;
    for (const item of gpuPending) gpuGl.deleteQuery(item.query);
    gpuDisjointCount += invalidated;
    gpuPending = [];
    gpuTimes = [];
    return false;
  }
  const waiting = [];
  for (const item of gpuPending) {
    if (!gpuGl.getQueryParameter(item.query, gpuGl.QUERY_RESULT_AVAILABLE)) {
      waiting.push(item);
      continue;
    }
    const elapsedNs = Number(gpuGl.getQueryParameter(item.query, gpuGl.QUERY_RESULT));
    if (Number.isFinite(elapsedNs) && elapsedNs >= 0) gpuTimes.push(elapsedNs / 1e6);
    else gpuSkippedCount++;
    gpuGl.deleteQuery(item.query);
  }
  gpuPending = waiting;
  return true;
}

function beginGpuQuery() {
  if (!gpuTimerExt || cpuTimes.length >= SAMPLE_FRAMES) return null;
  if (gpuPending.length >= 64) {
    gpuSkippedCount++;
    return null;
  }
  const query = gpuGl.createQuery();
  if (!query) {
    gpuSkippedCount++;
    return null;
  }
  gpuGl.beginQuery(gpuTimerExt.TIME_ELAPSED_EXT, query);
  return query;
}

function frame(now) {
  const gpuCanMeasure = pollGpuQueries();
  const dt = previous ? Math.min((now - previous) / 1000, 0.1) : 1 / 60;
  if (previous && warmup >= WARMUP_FRAMES && cpuTimes.length < SAMPLE_FRAMES) rafTimes.push(now - previous);
  previous = now;
  const start = performance.now();
  const gpuQuery = gpuCanMeasure && warmup >= WARMUP_FRAMES ? beginGpuQuery() : null;
  frameCall(dt);
  if (gpuQuery) {
    gpuGl.endQuery(gpuTimerExt.TIME_ELAPSED_EXT);
    gpuPending.push({ query: gpuQuery });
  }
  const elapsed = performance.now() - start;

  if (warmup < WARMUP_FRAMES) {
    warmup++;
    if (warmup === WARMUP_FRAMES) webgpuTimer?.gpuTimestampBegin();
  } else if (cpuTimes.length < SAMPLE_FRAMES) {
    cpuTimes.push(elapsed);
    if (getBackendFrameMs) backendTimes.push(getBackendFrameMs());
    if (cpuTimes.length === SAMPLE_FRAMES) webgpuTimer?.gpuTimestampEnd();
  }
  if (cpuTimes.length >= SAMPLE_FRAMES && !sampleReported) {
    gpuWaitFrames++;
    if ((gpuPending.length === 0 && (!webgpuTimer || webgpuTimer.gpuTimestampPending() === 0)) || gpuWaitFrames >= 180) {
      if (webgpuTimer) { gpuTimes = webgpuTimer.gpuTimestampMs(); gpuSkippedCount = SAMPLE_FRAMES - gpuTimes.length; }
      gpuSkippedCount += gpuPending.length;
      for (const item of gpuPending) gpuGl.deleteQuery(item.query);
      gpuPending = [];
      report();
      sampleReported = true;
    }
  }
  requestAnimationFrame(frame);
}

function makeThreeScene(THREE, width, height, renderer) {
  renderer ??= new THREE.WebGLRenderer({ canvas, antialias: true, alpha: false, powerPreference: 'high-performance' });
  renderer.setSize(width, height, false);
  renderer.setPixelRatio(1);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.info.autoReset = false;
  window.threeRenderer = renderer.backend?.isWebGPUBackend ? 'WebGPU' : renderer.backend?.isWebGLBackend ? 'WebGL2' : 'Three.js backend';

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0.09, 0.1, 0.14);
  const camera = new THREE.PerspectiveCamera(0.9 * 180 / Math.PI, width / height, 0.1, 1000);
  camera.position.set(0, 0, 54);
  camera.lookAt(0, 0, 0);

  const geometry = new THREE.BoxGeometry(0.76, 0.76, 0.76);
  const material = new THREE.MeshBasicMaterial({ color: 0xffffff });
  const cubes = new THREE.InstancedMesh(geometry, material, MAX_INSTANCES);
  const matrix = new THREE.Matrix4();
  const color = new THREE.Color(0.25, 0.62, 0.95);
  for (let i = 0; i < MAX_INSTANCES; i++) {
    const x = (i % 32) - 15.5;
    const y = Math.floor(i / 32) - 15.5;
    matrix.makeTranslation(x, y, 0);
    cubes.setMatrixAt(i, matrix);
    cubes.setColorAt(i, color);
  }
  cubes.instanceMatrix.needsUpdate = true;
  if (movingCount) cubes.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  if (cubes.instanceColor) cubes.instanceColor.needsUpdate = true;
  cubes.count = Number(slider.value);
  scene.add(cubes);
  let motionFrame = 0;
  let lastDrawCalls = 0;
  let previousDrawCalls = 0;
  const rotation = new THREE.Euler(0, 0, 0, 'ZYX');

  return {
    frame: () => {
      if (movingCount) {
        motionFrame++;
        const count = Math.min(movingCount, cubes.count);
        for (let j = 0; j < count; j++) {
          const i = spread && count > 1 ? Math.floor(j * (cubes.count - 1) / (count - 1)) : j;
          matrix.makeTranslation((i % 32) - 15.5 + Math.sin(motionFrame * 0.03 + i * 0.1) * 0.2,
            Math.floor(i / 32) - 15.5, 0);
          if (rotating) {
            const x = matrix.elements[12], y = matrix.elements[13];
            const angle = Math.fround(motionFrame * 0.01 + i * 0.001);
            rotation.set(angle, Math.fround(angle * 0.7), Math.fround(angle * 0.3), 'ZYX');
            matrix.makeRotationFromEuler(rotation);
            matrix.setPosition(x, y, 0);
          }
          cubes.setMatrixAt(i, matrix);
        }
        cubes.instanceMatrix.clearUpdateRanges();
        if (spread && count > 1) {
          for (let j = 0; j < count; j++) cubes.instanceMatrix.addUpdateRange(Math.floor(j * (cubes.count - 1) / (count - 1)) * 16, 16);
        } else cubes.instanceMatrix.addUpdateRange(0, count * 16);
        cubes.instanceMatrix.needsUpdate = true;
      }
      renderer.info.reset();
      renderer.render(scene, camera);
      const calls = renderer.info.render.calls;
      lastDrawCalls = renderer.backend?.isWebGPUBackend ? calls - previousDrawCalls : calls;
      previousDrawCalls = calls;
    },
    setCount: count => { cubes.count = count; },
    drawCalls: () => lastDrawCalls,
    resize: (w, h) => {
      renderer.setSize(w, h, false);
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
    },
  };
}

async function start() {
  try {
    const size = fitToDisplay(canvas);

    if (BACKEND === 'three' || BACKEND === 'three-webgpu') {
      // Pinned release keeps the comparison reproducible across visits.
      const THREE = BACKEND === 'three-webgpu'
        ? await import('https://cdn.jsdelivr.net/npm/three@0.187.0/build/three.webgpu.js')
        : await import('https://cdn.jsdelivr.net/npm/three@0.187.0/build/three.module.js');
      const renderer = BACKEND === 'three-webgpu'
        ? new THREE.WebGPURenderer({ canvas, antialias: true, alpha: false, powerPreference: 'high-performance' })
        : null;
      if (renderer) await renderer.init();
      const benchmark = makeThreeScene(THREE, size.width, size.height, renderer);
      frameCall = benchmark.frame;
      getDrawCalls = benchmark.drawCalls;
      getBackendFrameMs = null;
      resizeRenderer = benchmark.resize;
      gpuGl = BACKEND === 'three' ? canvas.getContext('webgl2') : null;
      gpuTimerExt = gpuGl?.getExtension('EXT_disjoint_timer_query_webgl2') ?? null;
      slider.addEventListener('input', () => {
        const count = Number(slider.value);
        countLabel.value = String(count);
      for (const link of document.querySelectorAll('nav a')) {
        const target = new URL(link.href);
        target.searchParams.set('count', String(count));
        link.href = target;
      }
        benchmark.setCount(count);
        resetSample();
      });
    } else {
      const { prepareWebGPU } = await import('../webgpu.js');
      await prepareWebGPU(canvas);
      const { default: createGoose3D } = await import('./app.js');
      const engine = await createGoose3D();
      if (!engine._g3_host_start(size.width, size.height)) throw new Error('The Goose WebGPU/WebGL2 renderer could not start.');
      gpuGl = canvas.getContext('webgl2');
      gpuTimerExt = gpuGl?.getExtension('EXT_disjoint_timer_query_webgl2') ?? null;
      engine._g3_benchmark_set_count(Number(slider.value));
      engine._g3_benchmark_set_motion(movingCount);
      engine._g3_benchmark_set_rotation(rotating);
      engine._g3_benchmark_set_spread(spread);
      frameCall = dt => engine._g3_app_frame(dt);
      getDrawCalls = () => engine._g3_host_scene_draw_calls();
      getBackendFrameMs = () => engine._g3_host_scene_draw_ms();
      if (window.g3Renderer === 'WebGPU' && window.g3wgpu.gpuTimestampAvailable?.()) {
        webgpuTimer = window.g3wgpu;
        webgpuTimer.gpuTimestampEnd();
      }
      resizeRenderer = (width, height) => engine._g3_input_resize(width, height);
      slider.addEventListener('input', () => {
        const count = Number(slider.value);
        countLabel.value = String(count);
        for (const link of document.querySelectorAll('nav a')) {
          const target = new URL(link.href);
          target.searchParams.set('count', String(count));
          link.href = target;
        }
        engine._g3_benchmark_set_count(count);
        resetSample();
      });
    }

    status.textContent = '';
    window.addEventListener('resize', () => {
      const next = fitToDisplay(canvas);
      resizeRenderer(next.width, next.height);
      resetSample();
      previous = 0;
    });
    requestAnimationFrame(frame);
    if (params.get('sync') === '1') {
      window.g3BenchmarkSync = { frame: frameCall, backendMs: getBackendFrameMs };
    }
  } catch (error) {
    status.textContent = `${error.message}${BACKEND !== 'goose' ? ' (Three.js mode needs access to jsDelivr.)' : ''}`;
  }
}

start();
