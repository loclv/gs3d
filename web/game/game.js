import createGoose3D from './app.js';
import { fitToDisplay } from '../canvas.js';
import { attachInput } from '../input.js';

const canvas = document.getElementById('canvas');
const message = document.getElementById('message');
const score = document.getElementById('score');
let engine;
let previous = 0;
let shownState = 0;

window.gooseError = text => { message.textContent = text; message.classList.remove('hidden'); };
window.gooseSurfaceFailed = () => window.gooseError('WebGL2 could not be started.');

async function start() {
  try {
    if (!document.createElement('canvas').getContext('webgl2')) throw new Error('This game needs WebGL2.');
    engine = await createGoose3D();
    const size = fitToDisplay(canvas);
    if (!engine._g3_host_start(size.width, size.height)) throw new Error('The engine could not start.');
    loadFloorTexture().catch(error => console.warn('Floor texture unavailable:', error));
    attachInput(canvas, engine);
    window.addEventListener('resize', () => {
      const size = fitToDisplay(canvas);
      engine._g3_input_resize(size.width, size.height);
    });
    message.classList.add('hidden');
    requestAnimationFrame(frame);
  } catch (error) { window.gooseError(error.message); }
}

async function loadFloorTexture() {
  const image = new Image();
  image.src = new URL('./ground.jpg', import.meta.url).href;
  await image.decode();
  const surface = document.createElement('canvas');
  surface.width = image.naturalWidth;
  surface.height = image.naturalHeight;
  const context = surface.getContext('2d', { willReadFrequently: true });
  context.drawImage(image, 0, 0);
  const pixels = context.getImageData(0, 0, surface.width, surface.height).data;
  const ptr = engine._malloc(pixels.length);
  if (!ptr) throw new Error('Out of memory uploading the floor texture');
  try {
    engine.HEAPU8.set(pixels, ptr);
    engine._g3_host_texture(engine._game_floor_texture(), ptr, surface.width, surface.height);
  } finally { engine._free(ptr); }
}

function showResult(state) {
  shownState = state;
  const title = document.createElement('h2');
  title.textContent = state === 1 ? 'All lights found!' : 'Caught!';
  const detail = document.createElement('div');
  detail.textContent = state === 1 ? `You finished in ${engine._game_time().toFixed(1)} seconds.` : 'The sentinel caught up with you.';
  const button = document.createElement('button');
  button.textContent = 'Play again';
  button.addEventListener('click', () => {
    engine._game_reset();
    shownState = 0;
    message.classList.add('hidden');
    canvas.focus();
  });
  message.replaceChildren(title, detail, button);
  message.classList.remove('hidden');
  button.focus();
}

function frame(now) {
  const dt = previous ? Math.min((now - previous) / 1000, 0.1) : 1 / 60;
  previous = now;
  engine._g3_app_frame(dt);
  score.textContent = `${engine._game_score()} / 8 beacons`;
  const state = engine._game_state();
  if (state && state !== shownState) showResult(state);
  requestAnimationFrame(frame);
}
start();
