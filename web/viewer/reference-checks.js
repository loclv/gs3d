import createGoose3D from './app.js';
import { fitToDisplay } from '../canvas.js';
import {
  isMeshHandleValid, isNodeHandleValid, isTextureHandleValid, loadGLTF,
  setEnvironmentLighting,
} from '../assets.js';

const canvas = document.getElementById('canvas');
const output = document.getElementById('results');
const results = [];
const check = (ok, name) => {
  results.push({ name, ok: !!ok });
  if (!ok) throw new Error(name);
};

function renderAndCheck(gl, engine, label) {
  engine._g3_app_frame(1 / 60);
  gl.finish();
  const { width, height } = canvas;
  const pixels = new Uint8Array(width * height * 4);
  gl.readPixels(0, 0, width, height, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
  const background = pixels.slice(0, 4);
  let changed = 0;
  for (let i = 0; i < pixels.length; i += 4) {
    const distance = Math.abs(pixels[i] - background[0]) +
      Math.abs(pixels[i + 1] - background[1]) + Math.abs(pixels[i + 2] - background[2]);
    if (distance > 24) changed++;
  }
  check(changed > 100, `${label}: WebGL frame contains rendered scene pixels`);
  check(gl.getError() === gl.NO_ERROR, `${label}: WebGL reports no error`);
  return pixels;
}

function changedPixels(a, b) {
  let changed = 0;
  for (let i = 0; i < a.length; i += 4) {
    if (Math.abs(a[i] - b[i]) + Math.abs(a[i + 1] - b[i + 1]) + Math.abs(a[i + 2] - b[i + 2]) > 12) changed++;
  }
  return changed;
}

async function run() {
  const gl = canvas.getContext('webgl2');
  check(!!gl, 'WebGL2 context is available');
  const engine = await createGoose3D();
  const size = fitToDisplay(canvas);
  check(engine._g3_host_start(size.width, size.height), 'engine starts');
  setEnvironmentLighting(engine, [0.32, 0.48, 0.72], [0.16, 0.12, 0.08], 0.7);

  const model = await loadGLTF(engine, './sample.glb');
  check(model.cameras.length === 2, 'sample imports perspective and orthographic cameras');
  check(model.lights.some(light => light.type === 'point') && model.lights.some(light => light.type === 'spot'),
    'sample imports point and spot lights');
  check(model.animations.length > 0 && model.playAnimation(0), 'sample animation starts');
  const preview = model.getTexturePreview(0, 8);
  check(!!preview && preview.pixels.length === preview.width * preview.height * 4,
    'sample texture decodes and provides preview pixels');
  check(model.selectCamera(0), 'perspective camera switches on');
  check(model.applyLights(), 'unshadowed imported lights activate');
  setEnvironmentLighting(engine, [0.32, 0.48, 0.72], [0.16, 0.12, 0.08], 0);
  const animationStart = renderAndCheck(gl, engine, 'animation at its first key');
  model.update(0.5);
  check(model.animationTime > 0.49, 'animation advances to the requested time');
  check(model.pauseAnimation(), 'animation pauses for repeatable image comparisons');
  const noEnvironment = renderAndCheck(gl, engine, 'perspective camera with no hemisphere fill');
  check(changedPixels(animationStart, noEnvironment) > 0, 'animation changes rendered pixels');
  setEnvironmentLighting(engine, [0.32, 0.48, 0.72], [0.16, 0.12, 0.08], 0.7);
  const environment = renderAndCheck(gl, engine, 'perspective camera with hemisphere fill');
  check(changedPixels(noEnvironment, environment) > 0, 'environment fill changes rendered pixels');
  check(model.applyLights({ pointShadow: 0 }), 'point shadow map activates');
  const pointShadow = renderAndCheck(gl, engine, 'point shadow');
  check(changedPixels(environment, pointShadow) > 0, 'point shadow changes rendered pixels');
  check(model.applyLights({ spotShadow: 1 }), 'spot shadow map activates');
  const spotShadow = renderAndCheck(gl, engine, 'spot shadow');
  check(changedPixels(environment, spotShadow) > 0, 'spot shadow changes rendered pixels');
  check(model.selectCamera(1), 'orthographic camera switches on');
  const orthographic = renderAndCheck(gl, engine, 'orthographic camera');
  check(model.activeCamera === 1 && changedPixels(spotShadow, orthographic) > 0,
    'camera selection changes rendered pixels');

  const node = model.roots[0];
  const mesh = model.meshes[0];
  const texture = model.textures[0];
  model.dispose();
  check(!isNodeHandleValid(engine, node), 'model disposal invalidates node handles');
  check(!isMeshHandleValid(engine, mesh), 'model disposal invalidates mesh handles');
  check(!isTextureHandleValid(engine, texture), 'model disposal invalidates texture handles');
  for (let i = 0; i < 3; i++) {
    const repeated = await loadGLTF(engine, './sample.glb');
    const repeatedNode = repeated.roots[0];
    repeated.dispose();
    check(!isNodeHandleValid(engine, repeatedNode), `reload/dispose cycle ${i + 1} releases its scene`);
  }
  renderAndCheck(gl, engine, 'frame after repeated disposal');
}

run().then(() => {
  window.__g3ReferenceChecks = { passed: true, results };
  output.textContent = `PASS (${results.length} checks)\n` + results.map(result => `✓ ${result.name}`).join('\n');
}).catch(error => {
  const failed = results.filter(result => !result.ok);
  window.__g3ReferenceChecks = { passed: false, results, error: error.message };
  output.textContent = `FAIL: ${error.message}\n` + results.map(result => `${result.ok ? '✓' : '✗'} ${result.name}`).join('\n');
});
