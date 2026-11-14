import createGoose3D from './reference/app.js';
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

function renderEmptyFrame(gl, engine, label) {
  engine._g3_app_frame(1 / 60);
  gl.finish();
  check(gl.getError() === gl.NO_ERROR, `${label}: WebGL reports no error`);
}

function changedPixels(a, b) {
  let changed = 0;
  for (let i = 0; i < a.length; i += 4) {
    if (Math.abs(a[i] - b[i]) + Math.abs(a[i + 1] - b[i + 1]) + Math.abs(a[i + 2] - b[i + 2]) > 12) changed++;
  }
  return changed;
}

function readCenterPixel(gl, engine, label) {
  engine._g3_app_frame(1 / 60);
  gl.finish();
  const pixel = new Uint8Array(4);
  gl.readPixels(canvas.width >> 1, canvas.height >> 1, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, pixel);
  check(gl.getError() === gl.NO_ERROR, `${label}: WebGL reports no error`);
  return [...pixel];
}

function checkPixel(actual, expected, label, tolerance = 3) {
  check(expected.every((channel, index) => Math.abs(actual[index] - channel) <= tolerance),
    `${label}: expected ${expected.join(',')}, received ${actual.join(',')}`);
}

function runRenderTargetChecks(gl, engine) {
  const target = engine._g3_reference_target_create(16, 16);
  const processed = engine._g3_reference_target_create(16, 16);
  check(target >= 0 && processed >= 0, 'WebGL render targets allocate');
  check(!engine._g3_reference_target_resize(target, 0, 16), 'render target rejects zero width');
  check(engine._g3_reference_target_resize(target, 8, 16), 'render target resizes');
  engine._g3_reference_set_screen_effects(true);
  check(engine._g3_reference_target_fill(target, 0.25, 0.5, 0.75),
    'render target draws a known linear colour with screen effects enabled');
  check(engine._g3_reference_show_texture(target), 'render target can be bound as a scene texture');
  check(!engine._g3_reference_target_remove(target), 'referenced render target cannot be removed');
  check(engine._g3_reference_target_feedback(target), 'sampling the active render target is suppressed');
  checkPixel(readCenterPixel(gl, engine, 'sample render target'), [64, 128, 191, 255],
    'render target preserves linear values without screen tone mapping, sRGB encoding, or FXAA');

  check(engine._g3_reference_post_process(target, processed, 0), 'copy post-process pass executes');
  check(engine._g3_reference_show_texture(processed), 'copied target can be sampled on a later frame');
  checkPixel(readCenterPixel(gl, engine, 'sample copied target'), [64, 128, 191, 255],
    'copy pass preserves render-target values');
  check(engine._g3_reference_post_process(target, processed, 1), 'grayscale post-process pass executes');
  check(engine._g3_reference_show_texture(processed), 'grayscale target can be sampled');
  checkPixel(readCenterPixel(gl, engine, 'sample grayscale target'), [116, 116, 116, 255],
    'grayscale pass uses linear luma weights');
  check(engine._g3_reference_post_process(target, processed, 2), 'invert post-process pass executes');
  check(engine._g3_reference_show_texture(processed), 'inverted target can be sampled on a later frame');
  checkPixel(readCenterPixel(gl, engine, 'sample inverted target'), [191, 127, 64, 255],
    'invert pass transforms the source pixels');
  check(engine._g3_reference_post_process(target, processed, 3), 'FXAA post-process pass executes');
  check(engine._g3_reference_show_texture(processed), 'FXAA target can be sampled');
  checkPixel(readCenterPixel(gl, engine, 'sample FXAA target'), [64, 128, 191, 255],
    'FXAA preserves a uniform target');
  check(!engine._g3_reference_post_process(target, target, 0) &&
    !engine._g3_reference_post_process(target, processed, 99), 'post-process rejects feedback and unknown effects');

  engine._g3_reference_post_process_queue_clear();
  check(engine._g3_reference_post_process_queue_add(target, processed, 1) &&
    engine._g3_reference_post_process_queue_add(processed, target, 2) &&
    engine._g3_reference_post_process_queue_execute(), 'queued post-process passes execute in order');
  check(engine._g3_reference_show_texture(target), 'queued output can be sampled');
  checkPixel(readCenterPixel(gl, engine, 'sample ordered queue output'), [139, 139, 139, 255],
    'grayscale then invert preserves queue order');

  let shaderDiagnostic = '';
  const previousGooseError = window.gooseError;
  window.gooseError = message => { shaderDiagnostic = String(message); };
  check(engine._g3_reference_shader_create_invalid() < 0 && shaderDiagnostic.length > 0,
    'invalid custom shader fails with a readable diagnostic');
  window.gooseError = previousGooseError;
  check(gl.getError() === gl.NO_ERROR, 'failed shader compilation leaves WebGL usable');

  const shader = engine._g3_reference_shader_create();
  check(shader >= 0, 'custom fragment shader compiles');
  check(engine._g3_reference_shader_run(shader, target, processed), 'custom fragment shader executes');
  check(engine._g3_reference_show_texture(processed), 'custom shader output can be sampled on a later frame');
  checkPixel(readCenterPixel(gl, engine, 'sample custom shader output'), [26, 204, 51, 255],
    'custom fragment shader writes its requested colour');
  engine._g3_reference_post_process_queue_clear();
  check(engine._g3_reference_post_process_queue_add_shader(shader, target, processed),
    'live custom shader can be queued');
  check(engine._g3_reference_shader_remove(shader), 'custom fragment shader releases');
  check(!engine._g3_reference_post_process_queue_execute(), 'queue reports a released shader pass as failed');
  check(engine._g3_reference_show_texture(target), 'default scene rendering recovers after a failed queue');
  checkPixel(readCenterPixel(gl, engine, 'render after failed queue'), [139, 139, 139, 255],
    'failed queue leaves the source target intact');
  engine._g3_reference_clear_scene();
  check(engine._g3_reference_target_remove(target) && engine._g3_reference_target_remove(processed),
    'unreferenced render targets dispose');
  return true;
}

async function run() {
  const gl = canvas.getContext('webgl2');
  check(!!gl, 'WebGL2 context is available');
  const engine = await createGoose3D();
  const size = fitToDisplay(canvas);
  check(engine._g3_host_start(size.width, size.height), 'engine starts');
  runRenderTargetChecks(gl, engine);
  engine._g3_reference_clear_scene();
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
  renderEmptyFrame(gl, engine, 'frame after repeated disposal');
}

run().then(() => {
  window.__g3ReferenceChecks = { passed: true, results };
  output.textContent = `PASS (${results.length} checks)\n` + results.map(result => `✓ ${result.name}`).join('\n');
}).catch(error => {
  const failed = results.filter(result => !result.ok);
  window.__g3ReferenceChecks = { passed: false, results, error: error.message };
  output.textContent = `FAIL: ${error.message}\n` + results.map(result => `${result.ok ? '✓' : '✗'} ${result.name}`).join('\n');
});
