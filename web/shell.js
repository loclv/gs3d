// The page's side of the engine: load the module, size the canvas, hand over
// input, and call one exported Goose function per frame.
//
// Everything the engine knows about the browser arrives through three C
// functions the backend exports (`g3_input_key`, `g3_input_mouse`,
// `g3_input_resize`); everything the page needs from the engine is the
// exported `g3_app_*` functions. No engine state crosses this file.
//
// Sizing lives in canvas.js, events in input.js, and the two lines of text in
// hud.js; what is left here is the order things happen in.

import createGoose3D from './app.js';
import { prepareWebGPU } from './webgpu.js';
import { fitToDisplay } from './canvas.js';
import { attachInput } from './input.js';
import { createStatusLine, createStatsLine } from './hud.js';

// A tab that was hidden, or a pause in a debugger, must not jump the animation.
const MAX_FRAME_SECONDS = 0.1;

let canvas = document.getElementById('canvas');
const status = createStatusLine(document.getElementById('status'));

let engine = null;      // the wasm module, once it is running frames
let stats = null;       // the statistics line, once there is an engine to ask

// The backend's startup hooks. A failure before the engine is up is the reason
// it will not start, so it goes on screen; after that it is a driver complaint
// for the console, because the page is already showing frames.
window.gooseError = (message) => {
  if (engine === null) status.fail(message);
  else console.error('g3:', message);
};
window.gooseSurfaceFailed = () =>
  status.failIfSilent('Neither WebGPU nor WebGL2 could be started on this device.');

// WebGPU is restricted to secure contexts. The local wildcard address often
// used by development servers (http://[::]) is not trusted by browsers, while
// localhost is. Keep the same port/path and move local development onto the
// trusted loopback origin before feature detection.
const localHost = location.hostname.replace(/^\[|\]$/g, '');
if (location.protocol === 'http:' && localHost === '::') {
  location.replace(`http://localhost:${location.port}${location.pathname}${location.search}${location.hash}`);
} else {
  boot();
}

function hasWebGL2() {
  return document.createElement('canvas').getContext('webgl2') !== null;
}

async function boot() {
  let module;
  const webgpuAvailable = await prepareWebGPU(canvas);
  if (!webgpuAvailable && !hasWebGL2()) {
    status.fail('This browser supports neither WebGPU nor WebGL2. Try a recent browser with graphics acceleration enabled.');
    return;
  }
  try {
    module = await createGoose3D();
  } catch (error) {
    console.error(error);
    status.fail('Could not load the engine: ' + error.message);
    return;
  }

  // The canvas gets its real size before the engine starts, so the first frame
  // is already right.
  const size = fitToDisplay(canvas);
  if (!module._g3_host_start(size.width, size.height)) {
    status.failIfSilent('The engine did not start. See the console for the reason.');
    return;
  }

  // The renderer may replace a canvas if WebGPU setup fails after obtaining
  // its context, so attach browser input to the backend's surviving canvas.
  canvas = document.getElementById('canvas');
  const actualSize = fitToDisplay(canvas);
  if (actualSize.width !== size.width || actualSize.height !== size.height)
    module._g3_input_resize(actualSize.width, actualSize.height);
  engine = module;
  stats = createStatsLine(document.getElementById('hud'), engine);
  status.hide();
  attachInput(canvas, engine);
  window.addEventListener('resize', onResize);
  requestAnimationFrame(frame);
}

function onResize() {
  const size = fitToDisplay(canvas);
  engine._g3_input_resize(size.width, size.height);
}

let last = 0;

function frame(now) {
  const dt = last ? Math.min((now - last) / 1000, MAX_FRAME_SECONDS) : 1 / 60;
  last = now;

  engine._g3_app_frame(dt);
  stats.frame(dt);

  requestAnimationFrame(frame);
}
