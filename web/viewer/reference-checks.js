import createGoose3D from './reference/app.js';
import { fitToDisplay } from '../canvas.js';
import {
  AssetError, isMeshHandleValid, isNodeHandleValid, isTextureHandleValid, loadGLTF, loadImage,
  loadHDRImage, setEnvironmentLighting, setEnvironmentMap,
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

function runOutputChecks(gl, engine) {
  check(engine._g3_reference_set_output(false, 0, 1), 'linear output settings are accepted');
  engine._g3_reference_clear_color(0.25, 0.5, 0.75);
  checkPixel(readCenterPixel(gl, engine, 'linear display output'), [64, 128, 191, 255],
    'linear output preserves channel values');

  check(engine._g3_reference_set_output(true, 0, 1), 'sRGB output settings are accepted');
  engine._g3_reference_clear_color(0.25, 0.5, 0.75);
  checkPixel(readCenterPixel(gl, engine, 'sRGB display output'), [137, 188, 225, 255],
    'sRGB output encodes linear channel values');

  check(engine._g3_reference_set_output(true, 2, 1), 'ACES tone mapping settings are accepted');
  engine._g3_reference_clear_color(2, 0.5, 0.25);
  checkPixel(readCenterPixel(gl, engine, 'ACES display output'), [245, 206, 165, 255],
    'ACES tone mapping and sRGB encoding match the reference values');
  check(engine._g3_reference_set_output(true, 1, 1), 'Reinhard tone mapping settings are accepted');
  engine._g3_reference_clear_color(2, 0.5, 0.25);
  checkPixel(readCenterPixel(gl, engine, 'Reinhard display output'), [213, 156, 124, 255],
    'Reinhard tone mapping and sRGB encoding match the reference values');
  check(engine._g3_reference_set_output(true, 2, 2), 'exposure changes are accepted');
  engine._g3_reference_clear_color(2, 0.5, 0.25);
  checkPixel(readCenterPixel(gl, engine, 'exposed ACES display output'), [252, 232, 206, 255],
    'exposure scales HDR input before tone mapping');
  check(!engine._g3_reference_set_output(true, 99, 1) &&
    !engine._g3_reference_set_output(true, 2, Infinity), 'invalid tone mapping and exposure are rejected');
  check(engine._g3_reference_set_output(false, 0, 1), 'default linear output settings are restored');
}

function tinyRadianceDataUrl() {
  const header = new TextEncoder().encode('#?RADIANCE\nFORMAT=32-bit_rle_rgbe\n\n-Y 1 +X 1\n');
  const bytes = new Uint8Array(header.length + 4);
  bytes.set(header);
  bytes.set([128, 64, 32, 136], header.length);
  const binary = Array.from(bytes, value => String.fromCharCode(value)).join('');
  return `data:application/octet-stream;base64,${btoa(binary)}`;
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
  checkPixel(readCenterPixel(gl, engine, 'sample render target'), [64, 128, 191, 255],
    'render target preserves linear values without screen tone mapping, sRGB encoding, or FXAA');
  // The feedback test clears its target. Restore the known source afterwards.
  check(engine._g3_reference_target_feedback(target), 'sampling the active render target is suppressed');
  check(engine._g3_reference_target_fill(target, 0.25, 0.5, 0.75),
    'known target colour is restored after the feedback test');


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
  check(engine._g3_reference_post_process_queue_execute(), 'queued custom shader executes');
  check(engine._g3_reference_show_texture(processed), 'queued custom shader output can be sampled');
  checkPixel(readCenterPixel(gl, engine, 'sample queued custom shader'), [26, 204, 51, 255],
    'queue dispatches the custom shader rather than a built-in effect');
  check(engine._g3_reference_post_process_queue_add_shader(shader, target, processed),
    'custom shader can be queued again before release');
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

async function runImageLoaderChecks(gl, engine) {
  const image = await loadImage(engine, '../game/ground.jpg');
  check(image.width === 1024 && image.height === 1024 && isTextureHandleValid(engine, image.handle),
    'standalone image loading decodes and uploads a checked texture');
  check(engine._g3_reference_show_texture(image.id), 'standalone image texture can be rendered');
  const pixel = readCenterPixel(gl, engine, 'render standalone image');
  check(Math.abs(pixel[0] - 255) + Math.abs(pixel[1]) + Math.abs(pixel[2] - 255) > 64,
    'rendered standalone image replaces the clear colour');
  engine._g3_reference_clear_scene();
  image.dispose();
  image.dispose();
  check(!isTextureHandleValid(engine, image.handle), 'standalone image disposal is idempotent');

  let imageError = null;
  try { await loadImage(engine, 'data:image/png;base64,AA=='); }
  catch (error) { imageError = error; }
  check(imageError instanceof AssetError && imageError.code === 'IMAGE',
    'invalid standalone image bytes produce a typed decode error');

  let hdrError = null;
  try { await loadHDRImage(engine, 'data:application/octet-stream;base64,AA=='); }
  catch (error) { hdrError = error; }
  check(hdrError instanceof AssetError && hdrError.code === 'HDR',
    'invalid Radiance bytes produce a typed decode error');

  let gltfError = null;
  try { await loadGLTF(engine, 'data:application/json,%7B'); }
  catch (error) { gltfError = error; }
  check(gltfError instanceof AssetError && gltfError.code === 'INVALID_GLTF',
    'malformed glTF JSON produces a typed asset error');
}

async function run() {
  const gl = canvas.getContext('webgl2');
  check(!!gl, 'WebGL2 context is available');
  const engine = await createGoose3D();
  const size = fitToDisplay(canvas);
  check(engine._g3_host_start(size.width, size.height), 'engine starts');
  runOutputChecks(gl, engine);
  runRenderTargetChecks(gl, engine);
  await runImageLoaderChecks(gl, engine);
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
  check(model.clearLights(), 'imported punctual lights can be cleared');
  const noPunctualLights = renderAndCheck(gl, engine, 'scene without imported punctual lights');
  check(changedPixels(animationStart, noPunctualLights) > 0, 'point and spot lights change rendered pixels');
  check(model.applyLights(), 'imported punctual lights can be restored');
  const restoredLights = renderAndCheck(gl, engine, 'scene with imported punctual lights restored');
  check(changedPixels(animationStart, restoredLights) < changedPixels(animationStart, noPunctualLights),
    'restoring imported punctual lights restores their rendered contribution');
  check(model.selectCamera(null), 'imported camera can be deselected');
  const fallbackCamera = renderAndCheck(gl, engine, 'pre-load camera restored');
  check(changedPixels(animationStart, fallbackCamera) > 0, 'camera deselection changes the rendered view');
  check(model.selectCamera(0), 'imported perspective camera can be restored');
  const restoredCamera = renderAndCheck(gl, engine, 'imported perspective camera restored');
  check(changedPixels(animationStart, restoredCamera) < changedPixels(animationStart, fallbackCamera),
    'reselecting the imported camera restores its rendered view');
  check(model.variants.includes('Blue paint'), 'sample imports its material variant');
  const turntable = model.nodes.find(node => node.name === 'Textured turntable');
  const bluePaint = turntable?.primitiveMaterials[0].variants.find(variant => variant.name === 'Blue paint')?.material;
  check(bluePaint?.clearcoatFactor === 0.8 && bluePaint.specularFactor === 0.9,
    'Blue paint imports clearcoat and specular material factors');
  check(model.setVariant('Blue paint') && model.activeVariant === 0, 'material variant switches on');
  const variantFrame = renderAndCheck(gl, engine, 'sample with Blue paint material variant');
  check(changedPixels(animationStart, variantFrame) > 0, 'material variant changes rendered pixels');
  check(model.setVariant(null) && model.activeVariant === -1, 'default material selection is restored');
  const restoredFrame = renderAndCheck(gl, engine, 'sample with default material restored');
  check(changedPixels(animationStart, restoredFrame) < changedPixels(animationStart, variantFrame),
    'restoring the default material restores its rendered appearance');
  model.update(0.5);
  check(model.animationTime > 0.49, 'animation advances to the requested time');
  check(model.pauseAnimation(), 'animation pauses for repeatable image comparisons');
  const noEnvironment = renderAndCheck(gl, engine, 'perspective camera with no hemisphere fill');
  check(changedPixels(animationStart, noEnvironment) > 0, 'animation changes rendered pixels');
  const hdrEnvironment = await loadHDRImage(engine, tinyRadianceDataUrl());
  check(hdrEnvironment.width === 1 && hdrEnvironment.height === 1 &&
    isTextureHandleValid(engine, hdrEnvironment.handle), 'Radiance HDR image decodes to a checked texture');
  setEnvironmentMap(engine, hdrEnvironment, 0.7);
  const hdrFrame = renderAndCheck(gl, engine, 'scene with Radiance HDR environment map');
  check(changedPixels(noEnvironment, hdrFrame) > 0, 'HDR environment map changes rendered pixels');
  setEnvironmentMap(engine, null);
  hdrEnvironment.dispose();
  check(!isTextureHandleValid(engine, hdrEnvironment.handle), 'HDR environment texture disposes after clearing the map');
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

  const skinnedModel = await loadGLTF(engine, '../testdata/native-skin-animation.glb');
  check(skinnedModel.animations.length === 1 && skinnedModel.playAnimation(0),
    'browser loads and starts the skinned animation fixture');
  const bindPose = renderAndCheck(gl, engine, 'browser skinned bind pose');
  skinnedModel.update(0.5);
  const liftedPose = renderAndCheck(gl, engine, 'browser skinned animated pose');
  check(changedPixels(bindPose, liftedPose) > 0, 'GPU skin palette changes rendered pixels during animation');
  skinnedModel.dispose();
  renderEmptyFrame(gl, engine, 'frame after GPU skin disposal');
}

run().then(() => {
  window.__g3ReferenceChecks = { passed: true, results };
  output.textContent = `PASS (${results.length} checks)\n` + results.map(result => `✓ ${result.name}`).join('\n');
}).catch(error => {
  const failed = results.filter(result => !result.ok);
  window.__g3ReferenceChecks = { passed: false, results, error: error.message };
  output.textContent = `FAIL: ${error.message}\n` + results.map(result => `${result.ok ? '✓' : '✗'} ${result.name}`).join('\n');
});
