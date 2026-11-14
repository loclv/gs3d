import createGoose3D from './app.js';
import { fitToDisplay } from '../canvas.js';
import { attachInput } from '../input.js';
const canvas = document.querySelector('canvas');
const overlay = document.querySelector('#overlay');
const title = overlay.querySelector('h2');
const detail = document.querySelector('#detail');
const action = document.querySelector('#action');
const hud = document.querySelector('#hud');
const stats = document.querySelector('#stats');
let engine, running = false, previous = 0, result = 0, startupError = "";
window.gooseError = text => {
  startupError = text; running = false; overlay.hidden = false; title.textContent = 'Unable to start';
  detail.textContent = text; action.hidden = true;
};
window.gooseSurfaceFailed = () => window.gooseError(startupError || 'WebGL2 could not be started.');
action.onclick = () => {
  engine._siege_reset(); result = 0; running = true; previous = 0;
  overlay.hidden = true; canvas.focus();
};
document.addEventListener('visibilitychange', () => { previous = 0; });
window.addEventListener('blur', () => { previous = 0; });
function frame(now) {
  const dt = previous && !document.hidden ? Math.min((now - previous) / 1000, .1) : 0;
  previous = now;
  if (running && !document.hidden) engine._g3_app_frame(dt);
  hud.textContent = 'WAVE ' + engine._siege_wave() + ' / 5   ·   HULL ' + engine._siege_health() + '/5   ·   ' + engine._siege_score() + ' PTS';
  stats.textContent = engine._siege_alive() + ' hostiles · Dash ' + (engine._siege_dash() <= 0 ? 'READY' : engine._siege_dash().toFixed(1) + 's') + ' · ' + engine._siege_drawn() + ' visible';
  const state = engine._siege_state();
  if (state && state !== result) {
    result = state; running = false; overlay.hidden = false;
    title.textContent = state === 1 ? 'Rift sealed.' : 'Hull lost.';
    detail.textContent = engine._siege_score() + ' points. ' + (state === 1 ? 'All five waves cleared.' : 'Use cover against ranged enemies. Dash through danger; one hull point repairs between waves.');
    action.textContent = 'Try again'; action.hidden = false; action.focus();
  }
  requestAnimationFrame(frame);
}
try {
  engine = await createGoose3D();
  const size = fitToDisplay(canvas);
  if (!engine._g3_host_start(size.width, size.height)) throw new Error(startupError || 'WebGL2 could not start.');
  attachInput(canvas, engine);
  window.addEventListener('resize', () => {
    const size = fitToDisplay(canvas); engine._g3_input_resize(size.width, size.height);
  });
  engine._g3_app_frame(0);
  detail.textContent = 'Survive five escalating waves. WASD moves, arrow keys aim and fire. Hold Shift to dash with a brief shield. Cyan pylons block shots. Violet enemies shoot back. Keyboard required.';
  action.hidden = false;
  requestAnimationFrame(frame);
} catch (error) { window.gooseError(error.message); }
