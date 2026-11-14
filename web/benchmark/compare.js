import { fitToDisplay } from '../canvas.js';

const MAX_INSTANCES = 1024;
const WARMUP_FRAMES = 120;
const SAMPLE_FRAMES = 300;
const BACKEND = new URLSearchParams(location.search).get('backend') === 'three' ? 'three' : 'goose';
const canvas = document.getElementById('canvas');
const status = document.getElementById('status');
const slider = document.getElementById('nodes');
const countLabel = document.getElementById('count');
const results = document.getElementById('results');
const params = new URLSearchParams(location.search);
const requestedCount = Number(params.get('count'));
if (Number.isInteger(requestedCount) && requestedCount >= 1 && requestedCount <= MAX_INSTANCES) {
  slider.value = String(requestedCount);
  countLabel.value = String(requestedCount);
}
for (const link of document.querySelectorAll('nav a')) {
  const target = new URL(link.href);
  target.searchParams.set('count', slider.value);
  link.href = target;
}
document.getElementById(`${BACKEND}-link`).setAttribute('aria-current', 'page');

let frameCall;
let getDrawCalls;
let resizeRenderer;
let previous = 0;
let warmup = 0;
let cpuTimes = [];
let rafTimes = [];

function resetSample() {
  warmup = 0;
  cpuTimes = [];
  rafTimes = [];
  results.textContent = 'warming up…';
}

function percentile(values, p) {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.floor((sorted.length - 1) * p))] ?? 0;
}

function report() {
  const meanRaf = rafTimes.reduce((sum, value) => sum + value, 0) / rafTimes.length;
  const label = BACKEND === 'three' ? 'Three.js' : 'Goose 3D';
  results.textContent =
    `${label} · ${slider.value} visible cubes · ${getDrawCalls()} scene draw call(s)\n` +
    `${(1000 / meanRaf).toFixed(1)} browser frames/s\n` +
    `frame call median ${percentile(cpuTimes, 0.5).toFixed(2)} ms · ` +
    `p95 ${percentile(cpuTimes, 0.95).toFixed(2)} ms\n` +
    `sample: ${SAMPLE_FRAMES} frames after ${WARMUP_FRAMES} warmup frames`;
}

function frame(now) {
  const dt = previous ? Math.min((now - previous) / 1000, 0.1) : 1 / 60;
  if (previous && warmup >= WARMUP_FRAMES) rafTimes.push(now - previous);
  previous = now;
  const start = performance.now();
  frameCall(dt);
  const elapsed = performance.now() - start;

  if (warmup < WARMUP_FRAMES) {
    warmup++;
  } else {
    cpuTimes.push(elapsed);
    if (cpuTimes.length === SAMPLE_FRAMES) report();
  }
  requestAnimationFrame(frame);
}

function makeThreeScene(THREE, width, height) {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: false, powerPreference: 'high-performance' });
  renderer.setSize(width, height, false);
  renderer.setPixelRatio(1);
  renderer.outputColorSpace = THREE.SRGBColorSpace;

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
  if (cubes.instanceColor) cubes.instanceColor.needsUpdate = true;
  cubes.count = Number(slider.value);
  scene.add(cubes);

  return {
    frame: () => renderer.render(scene, camera),
    setCount: count => { cubes.count = count; },
    drawCalls: () => renderer.info.render.calls,
    resize: (w, h) => {
      renderer.setSize(w, h, false);
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
    },
  };
}

async function start() {
  try {
    if (!document.createElement('canvas').getContext('webgl2')) throw new Error('This benchmark needs WebGL2.');
    const size = fitToDisplay(canvas);

    if (BACKEND === 'three') {
      // Pinned release keeps the comparison reproducible across visits.
      const THREE = await import('https://cdn.jsdelivr.net/npm/three@0.180.0/build/three.module.js');
      const benchmark = makeThreeScene(THREE, size.width, size.height);
      frameCall = benchmark.frame;
      getDrawCalls = benchmark.drawCalls;
      resizeRenderer = benchmark.resize;
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
      const { default: createGoose3D } = await import('./app.js');
      const engine = await createGoose3D();
      if (!engine._g3_host_start(size.width, size.height)) throw new Error('The Goose WebGL2 renderer could not start.');
      engine._g3_benchmark_set_count(Number(slider.value));
      frameCall = dt => engine._g3_app_frame(dt);
      getDrawCalls = () => engine._g3_host_scene_draw_calls();
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
  } catch (error) {
    status.textContent = `${error.message}${BACKEND === 'three' ? ' (Three.js mode needs access to jsDelivr.)' : ''}`;
  }
}

start();
