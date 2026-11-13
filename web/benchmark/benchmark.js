import createGoose3D from './app.js';
import { fitToDisplay } from '../canvas.js';

const canvas = document.getElementById('canvas');
const status = document.getElementById('status');
const slider = document.getElementById('nodes');
const countLabel = document.getElementById('count');
const results = document.getElementById('results');
let engine;
let previous = 0;
let sampleStart = 0;
let elapsed = 0;
let cpuTimes = [];
let rafTimes = [];
let frameCount = 0;

function resetSample() {
  sampleStart = 0;
  elapsed = 0;
  cpuTimes = [];
  rafTimes = [];
  frameCount = 0;
  results.textContent = 'warming up…';
}

slider.addEventListener('input', () => {
  const count = Number(slider.value);
  countLabel.value = String(count);
  if (engine) engine._g3_benchmark_set_count(count);
  resetSample();
});

function percentile(values, p) {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.floor((sorted.length - 1) * p))] ?? 0;
}

function frame(now) {
  const dt = previous ? Math.min((now - previous) / 1000, 0.1) : 1 / 60;
  if (previous) rafTimes.push(now - previous);
  previous = now;
  const start = performance.now();
  engine._g3_app_frame(dt);
  cpuTimes.push(performance.now() - start);
  frameCount++;
  if (!sampleStart) sampleStart = now;
  elapsed = now - sampleStart;

  // Warm the renderer and caches before showing measurements. Keep recent
  // samples only so the report follows the current slider setting.
  if (frameCount > 120 && elapsed >= 1000) {
    const recentCpu = cpuTimes.slice(-300);
    const recentRaf = rafTimes.slice(-300);
    const hz = 1000 / (recentRaf.reduce((a, b) => a + b, 0) / recentRaf.length);
    results.textContent =
      `${slider.value} visible nodes · ${engine._g3_host_scene_draw_calls()} scene draw call(s)\n` +
      `${hz.toFixed(1)} browser frames/s\n` +
      `engine call median ${percentile(recentCpu, 0.5).toFixed(2)} ms · ` +
      `p95 ${percentile(recentCpu, 0.95).toFixed(2)} ms`;
  }
  requestAnimationFrame(frame);
}

async function start() {
  try {
    if (!document.createElement('canvas').getContext('webgl2')) throw new Error('This benchmark needs WebGL2.');
    engine = await createGoose3D();
    const size = fitToDisplay(canvas);
    if (!engine._g3_host_start(size.width, size.height)) throw new Error('The renderer could not start.');
    engine._g3_benchmark_set_count(Number(slider.value));
    status.textContent = '';
    window.addEventListener('resize', () => {
      const next = fitToDisplay(canvas);
      engine._g3_input_resize(next.width, next.height);
      resetSample();
    });
    requestAnimationFrame(frame);
  } catch (error) {
    status.textContent = error.message;
  }
}

start();
