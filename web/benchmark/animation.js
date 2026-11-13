import createGoose3D from './animation/app.js';
import { loadGLTF } from '../assets.js';
import { fitToDisplay } from '../canvas.js';

const canvas = document.getElementById('canvas');
const status = document.getElementById('status');
const results = document.getElementById('results');
let engine, model, previous = 0, sampleStart = 0, frameCount = 0;
const updateTimes = [], engineTimes = [], rafTimes = [];

function percentile(values, p) {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.floor((sorted.length - 1) * p))] ?? 0;
}

function frame(now) {
  const dt = previous ? Math.min((now - previous) / 1000, 0.1) : 1 / 60;
  if (previous) rafTimes.push(now - previous);
  previous = now;
  let start = performance.now();
  model.update(dt);
  updateTimes.push(performance.now() - start);
  start = performance.now();
  engine._g3_app_frame(dt);
  engineTimes.push(performance.now() - start);
  frameCount++;

  if (frameCount > 120 && now - sampleStart >= 1000) {
    const updates = updateTimes.slice(-300), renders = engineTimes.slice(-300), raf = rafTimes.slice(-300);
    const hz = 1000 / (raf.reduce((sum, value) => sum + value, 0) / raf.length);
    results.textContent =
      `32 instances · 2,048 vertices · 64 morph targets · ${engine._g3_host_scene_draw_calls()} scene draw call(s)\n` +
      `${hz.toFixed(1)} browser frames/s\n` +
      `model.update median ${percentile(updates, 0.5).toFixed(2)} ms · p95 ${percentile(updates, 0.95).toFixed(2)} ms\n` +
      `engine frame median ${percentile(renders, 0.5).toFixed(2)} ms · p95 ${percentile(renders, 0.95).toFixed(2)} ms`;
  }
  requestAnimationFrame(frame);
}

async function start() {
  try {
    if (!document.createElement('canvas').getContext('webgl2')) throw new Error('This benchmark needs WebGL2.');
    engine = await createGoose3D();
    const size = fitToDisplay(canvas);
    if (!engine._g3_host_start(size.width, size.height)) throw new Error('The renderer could not start.');
    model = await loadGLTF(engine, './morph-benchmark.glb');
    if (!model.animations.length || !model.playAnimation(0)) throw new Error('The morph animation could not start.');
    status.textContent = '';
    window.addEventListener('resize', () => {
      const next = fitToDisplay(canvas);
      engine._g3_input_resize(next.width, next.height);
    });
    window.addEventListener('pagehide', () => { model?.dispose(); engine?._g3_app_shutdown(); }, { once: true });
    sampleStart = performance.now();
    requestAnimationFrame(frame);
  } catch (error) {
    status.textContent = error.message;
  }
}

start();
