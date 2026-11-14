import createGoose3D from '../../viewer/app.js';
import { fitToDisplay } from '../../canvas.js';
import { AssetError, loadGLTF, setEnvironmentLighting } from 'goose-3d-browser-assets';
import { createOrbitControls } from 'goose-3d-browser-assets/orbit-controls';

const canvas = document.getElementById('canvas');
const form = document.getElementById('loader-form');
const urlInput = document.getElementById('model-url');
const loadButton = document.getElementById('load');
const localSampleButton = document.getElementById('local-sample');
const cameraSelect = document.getElementById('camera');
const status = document.getElementById('status');
let engine = null;
let model = null;
let controls = null;
let lastFrame = 0;
let pageClosed = false;

const initialUrl = new URL(location.href).searchParams.get('model');
const localSampleUrl = new URL('../../viewer/sample.glb', location.href).href;
const remoteSampleUrl = 'https://raw.githubusercontent.com/mrdoob/three.js/dev/examples/models/gltf/RobotExpressive/RobotExpressive.glb';
try { urlInput.value = initialUrl ? new URL(initialUrl, location.href).href : remoteSampleUrl; }
catch { urlInput.value = remoteSampleUrl; }

function updateCameras() {
  cameraSelect.replaceChildren(new Option('Viewer camera', 'default'));
  for (const camera of model?.cameras ?? []) {
    const node = camera.nodes[0];
    const label = camera.name || `${camera.type} camera`;
    cameraSelect.add(new Option(label, `${camera.index}:${node ?? ''}`));
  }
}

async function loadModel(url) {
  loadButton.disabled = true;
  status.textContent = `Loading ${url}…`;
  try {
    const next = await loadGLTF(engine, url);
    if (pageClosed) { next.dispose(); return; }
    if (model) model.dispose();
    model = next;
    updateCameras();
    if (model.lights.length) model.applyLights();
    if (model.animations.length) model.playAnimation(0);
    status.textContent = `Loaded ${model.nodes.length} nodes, ${model.meshes.length} meshes, ` +
      `${model.textures.length} textures, and ${model.animations.length} animations.`;
  } catch (error) {
    if (pageClosed) return;
    const detail = error instanceof AssetError ? `${error.code}: ${error.message}` : error.message;
    status.textContent = `Could not load model. ${detail}`;
  } finally {
    loadButton.disabled = false;
  }
}

async function start() {
  try {
    if (!canvas.getContext('webgl2')) throw new Error('This example requires WebGL2.');
    engine = await createGoose3D();
    const size = fitToDisplay(canvas);
    if (!engine._g3_host_start(size.width, size.height)) throw new Error('The renderer could not start.');
    setEnvironmentLighting(engine, [0.32, 0.48, 0.72], [0.16, 0.12, 0.08], 0.55);
    controls = createOrbitControls(canvas, {
      onOrbit: (yaw, pitch) => engine._g3_viewer_orbit(yaw, pitch),
      onZoom: factor => engine._g3_viewer_zoom(factor),
      onPan: (dx, dy) => engine._g3_viewer_pan(dx, dy, canvas.clientHeight),
    });
    window.addEventListener('resize', () => {
      const next = fitToDisplay(canvas);
      engine._g3_input_resize(next.width, next.height);
    });
    form.addEventListener('submit', event => {
      event.preventDefault();
      loadModel(urlInput.value.trim());
    });
    localSampleButton.addEventListener('click', () => {
      urlInput.value = localSampleUrl;
      loadModel(localSampleUrl);
    });
    cameraSelect.addEventListener('change', () => {
      if (!model) return;
      if (cameraSelect.value === 'default') model.selectCamera(null);
      else {
        const [camera, node] = cameraSelect.value.split(':');
        model.selectCamera(Number(camera), node === '' ? null : Number(node));
      }
    });
    window.addEventListener('pagehide', () => {
      pageClosed = true;
      controls?.dispose();
      model?.dispose();
      engine?._g3_app_shutdown();
    }, { once: true });
    requestAnimationFrame(frame);
    await loadModel(urlInput.value.trim());
  } catch (error) {
    status.textContent = error.message;
  }
}

function frame(now) {
  const dt = lastFrame ? Math.min((now - lastFrame) / 1000, 0.1) : 1 / 60;
  lastFrame = now;
  model?.update(dt);
  engine._g3_app_frame(dt);
  requestAnimationFrame(frame);
}

start();
