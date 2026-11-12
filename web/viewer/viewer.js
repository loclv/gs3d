import createGoose3D from './app.js';
import { fitToDisplay } from '../canvas.js';
import { loadGLTF } from '../assets.js';

const canvas = document.getElementById('canvas');
const status = document.getElementById('status');
const reload = document.getElementById('reload');
let engine, model, last = 0, drag;

window.gooseError = message => { status.textContent = message; };
window.gooseSurfaceFailed = () => window.gooseError('WebGL2 could not be started.');

async function loadModel() {
  reload.disabled = true;
  status.textContent = 'Loading model…';
  try {
    const next = await loadGLTF(engine, './sample.glb');
    if (model) model.dispose();
    model = next;
    status.textContent = 'Model loaded. Click a face to select it.';
  } catch (error) { status.textContent = `Could not load model: ${error.message}`; }
  finally { reload.disabled = false; }
}

async function start() {
  try {
    if (!document.createElement('canvas').getContext('webgl2')) throw new Error('This viewer needs WebGL2.');
    engine = await createGoose3D();
    const size = fitToDisplay(canvas);
    if (!engine._g3_host_start(size.width, size.height)) throw new Error('The renderer could not start.');
    window.addEventListener('resize', () => {
      const next = fitToDisplay(canvas);
      engine._g3_input_resize(next.width, next.height);
    });
    reload.addEventListener('click', loadModel);
    canvas.addEventListener('pointerdown', event => {
      drag = { id: event.pointerId, x: event.clientX, y: event.clientY, travel: 0 };
      canvas.setPointerCapture(event.pointerId);
    });
    canvas.addEventListener('pointermove', event => {
      if (!drag || event.pointerId !== drag.id) return;
      const dx = event.clientX - drag.x, dy = event.clientY - drag.y;
      if (dx || dy) engine._g3_viewer_orbit(-dx * 0.006, dy * 0.005);
      drag.travel += Math.abs(dx) + Math.abs(dy);
      drag.x = event.clientX; drag.y = event.clientY;
    });
    canvas.addEventListener('pointerup', event => {
      if (!drag || event.pointerId !== drag.id) return;
      if (drag.travel < 4 && model) {
        const hit = model.pick(canvas, event.clientX, event.clientY);
        status.textContent = hit === null ? 'No mesh selected.' : `Selected mesh node ${hit}.`;
      }
      drag = null;
    });
    canvas.addEventListener('pointercancel', () => { drag = null; });
    canvas.addEventListener('wheel', event => {
      event.preventDefault();
      engine._g3_viewer_zoom(Math.exp(Math.max(-1, Math.min(1, event.deltaY * 0.001))));
    }, { passive: false });
    requestAnimationFrame(frame);
    await loadModel();
  } catch (error) { status.textContent = error.message; }
}

function frame(now) {
  const dt = last ? Math.min((now - last) / 1000, 0.1) : 1 / 60;
  last = now;
  engine._g3_app_frame(dt);
  requestAnimationFrame(frame);
}
start();
