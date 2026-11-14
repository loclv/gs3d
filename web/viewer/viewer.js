import createGoose3D from './app.js';
import { fitToDisplay } from '../canvas.js';
import { loadGLTF, setEnvironmentLighting, setEnvironmentRotation } from 'goose-3d-browser-assets';
import { createOrbitControls } from 'goose-3d-browser-assets/orbit-controls';

const canvas = document.getElementById('canvas');
const status = document.getElementById('status');
const reload = document.getElementById('reload');
const cameraSelect = document.getElementById('camera');
const shadowSelect = document.getElementById('shadow-light');
const animationControls = document.getElementById('animation-controls');
const animationClip = document.getElementById('animation-clip');
const animationToggle = document.getElementById('animation-toggle');
const animationTime = document.getElementById('animation-time');
const animationTimeValue = document.getElementById('animation-time-value');
const inspection = document.getElementById('inspection');
const previews = document.getElementById('texture-previews');
const variantSelect = document.getElementById('variant');
const environmentInput = document.getElementById('environment-intensity');
const environmentValue = document.getElementById('environment-value');
const rotationInput = document.getElementById('environment-rotation');
const rotationValue = document.getElementById('environment-rotation-value');
const hemisphereInput = document.getElementById('hemisphere-intensity');
const hemisphereValue = document.getElementById('hemisphere-value');
let engine, model, controls, last = 0;
let animationPlaying = false;
let selectedPrimitive = null;
let environmentIntensities = new Map();

function updateInspection() {
  previews.replaceChildren();
  if (!model || !selectedPrimitive) {
    inspection.textContent = 'Click a mesh to inspect its material.';
    environmentInput.disabled = true;
    environmentInput.value = '1';
    environmentValue.value = '1.00';
    return;
  }
  const { owner, primitive } = selectedPrimitive;
  const choice = owner.primitiveMaterials[primitive];
  const selectedVariant = choice.variants.find(variant => variant.index === model.activeVariant);
  const material = selectedVariant?.material ?? choice.default;
  const materialEnvironment = environmentIntensities.get(material.index) ?? 1;
  environmentInput.disabled = false;
  environmentInput.value = String(materialEnvironment);
  environmentValue.value = materialEnvironment.toFixed(2);
  const color = material.baseColorFactor.map(value => value.toFixed(2)).join(', ');
  const emission = material.emissiveFactor.map(value => value.toFixed(2)).join(', ');
  inspection.textContent = [
    `Node: ${owner.name || `glTF node ${owner.index}`}`,
    `Primitive: ${primitive + 1}`,
    `Material: ${material.name || (material.index < 0 ? 'Default material' : `Material ${material.index}`)}${selectedVariant ? ` (${selectedVariant.name})` : ''}`,
    `Base color: ${color}`,
    `Metallic: ${material.metallicFactor.toFixed(2)}   Roughness: ${material.roughnessFactor.toFixed(2)}`,
    `IOR: ${material.ior.toFixed(2)}   Specular: ${material.specularFactor.toFixed(2)} (${material.specularColorFactor.map(value => value.toFixed(2)).join(', ')})`,
    `Normal scale: ${material.normalScale.toFixed(2)}   Occlusion strength: ${material.occlusionStrength.toFixed(2)}`,
    `Clearcoat: ${material.clearcoatFactor.toFixed(2)}   Roughness: ${material.clearcoatRoughnessFactor.toFixed(2)}   Normal scale: ${material.clearcoatNormalScale.toFixed(2)}`,
    `Sheen: ${material.sheenColorFactor.map(value => value.toFixed(2)).join(', ')}   Roughness: ${material.sheenRoughnessFactor.toFixed(2)}`,
    `Alpha: ${material.alphaMode}${material.alphaMode === 'MASK' ? ` at ${material.alphaCutoff.toFixed(2)}` : ''}`,
    `Emission: ${emission}`,
    `Maps: ${material.textureSlots.length ? material.textureSlots.join(', ') : 'none'}`,
    `${material.unlit ? 'Unlit' : 'Lit'}${material.doubleSided ? ', double-sided' : ''}`,
  ].join('\n');
  for (const binding of material.textureBindings) {
    const preview = model.getTexturePreview(binding.index, 112);
    if (!preview) continue;
    const figure = document.createElement('figure');
    const canvas = document.createElement('canvas');
    canvas.width = preview.width;
    canvas.height = preview.height;
    canvas.setAttribute('aria-label', `${binding.slot} texture preview`);
    const context = canvas.getContext('2d');
    if (!context) continue;
    context.putImageData(new ImageData(preview.pixels, preview.width, preview.height), 0, 0);
    const caption = document.createElement('figcaption');
    caption.textContent = binding.slot;
    figure.append(canvas, caption);
    previews.append(figure);
  }
}

function updateAnimationControls() {
  const info = model?.animations[model.activeAnimation] ?? null;
  animationControls.hidden = !model?.animations.length;
  animationToggle.disabled = !info;
  animationToggle.textContent = animationPlaying ? 'Pause' : 'Play';
  animationToggle.setAttribute('aria-pressed', String(animationPlaying));
  const duration = info?.duration ?? 0;
  animationTime.max = String(duration);
  if (document.activeElement !== animationTime) animationTime.value = String(Math.min(model?.animationTime ?? 0, duration));
  animationTimeValue.value = `${(model?.animationTime ?? 0).toFixed(2)} / ${duration.toFixed(2)} s`;
}

window.gooseError = message => { status.textContent = message; };
window.gooseSurfaceFailed = () => window.gooseError('WebGL2 could not be started.');

async function loadModel() {
  reload.disabled = true;
  status.textContent = 'Loading model…';
  try {
    const next = await loadGLTF(engine, './sample.glb');
    if (model) model.dispose();
    model = next;
    animationPlaying = false;
    environmentIntensities = new Map();
    cameraSelect.replaceChildren(new Option('Viewer camera', 'default'));
    for (const camera of model.cameras) {
      const node = camera.nodes[0];
      const suffix = camera.nodes.length > 1 ? ` (node ${node})` : '';
      cameraSelect.add(new Option(`${camera.name || `${camera.type} camera`}${suffix}`, `${camera.index}:${node ?? ''}`));
    }
    shadowSelect.replaceChildren(new Option('No extra shadow', 'none'));
    for (const [index, light] of model.lights.entries()) {
      if (light.type === 'point' || light.type === 'spot') {
        shadowSelect.add(new Option(`${light.name || light.type} shadow (${light.type})`, `${light.type}:${index}`));
      }
    }
    selectedPrimitive = null;
    updateInspection();
    variantSelect.replaceChildren(new Option('Default materials', '-1'));
    for (const [index, name] of model.variants.entries()) variantSelect.add(new Option(name, String(index)));
    variantSelect.disabled = model.variants.length === 0;
    animationClip.replaceChildren();
    for (const animation of model.animations) animationClip.add(new Option(animation.name, String(animation.index)));
    const lightStatus = model.lights.length === 0 ? '' : model.applyLights()
      ? ` ${model.lights.length} imported lights active.` : ' Could not apply imported lights.';
    if (model.animations.length) {
      animationPlaying = model.playAnimation(0);
      updateAnimationControls();
      status.textContent = `Playing ${model.animations[0].name}.${lightStatus} Click a face to select it.`;
    } else {
      updateAnimationControls();
      status.textContent = `Model loaded.${lightStatus} Click a face to select it.`;
    }
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
    animationClip.addEventListener('change', () => {
      if (!model) return;
      animationPlaying = model.playAnimation(Number(animationClip.value));
      updateAnimationControls();
    });
    cameraSelect.addEventListener('change', () => {
      if (!model) return;
      if (cameraSelect.value === 'default') model.selectCamera(null);
      else {
        const [camera, node] = cameraSelect.value.split(':');
        model.selectCamera(Number(camera), node === '' ? null : Number(node));
      }
    });
    shadowSelect.addEventListener('change', () => {
      if (!model) return;
      const options = {};
      if (shadowSelect.value !== 'none') {
        const [type, index] = shadowSelect.value.split(':');
        options[`${type}Shadow`] = Number(index);
      }
      model.applyLights(options);
    });
    animationToggle.addEventListener('click', () => {
      if (!model) return;
      if (animationPlaying) animationPlaying = !model.pauseAnimation();
      else animationPlaying = model.activeAnimation < 0
        ? model.playAnimation(Number(animationClip.value)) : model.resumeAnimation();
      updateAnimationControls();
    });
    animationTime.addEventListener('input', () => {
      if (model?.seekAnimation(Number(animationTime.value))) updateAnimationControls();
    });
    rotationInput.addEventListener('input', () => {
      const degrees = Number(rotationInput.value);
      setEnvironmentRotation(engine, degrees * Math.PI / 180);
      rotationValue.value = `${degrees}°`;
    });
    hemisphereInput.addEventListener('input', () => {
      const intensity = Number(hemisphereInput.value);
      setEnvironmentLighting(engine, [0.32, 0.48, 0.72], [0.16, 0.12, 0.08], intensity);
      hemisphereValue.value = intensity.toFixed(2);
    });
    variantSelect.addEventListener('change', () => {
      if (!model) return;
      const variant = Number(variantSelect.value);
      if (model.setVariant(variant < 0 ? null : variant)) updateInspection();
    });
    environmentInput.addEventListener('input', () => {
      if (!model || !selectedPrimitive) return;
      const choice = selectedPrimitive.owner.primitiveMaterials[selectedPrimitive.primitive];
      const selectedVariant = choice.variants.find(variant => variant.index === model.activeVariant);
      const materialIndex = (selectedVariant?.material ?? choice.default).index;
      const intensity = Number(environmentInput.value);
      if (model.setMaterialEnvironmentIntensity(materialIndex, intensity)) {
        environmentIntensities.set(materialIndex, intensity);
        environmentValue.value = intensity.toFixed(2);
      }
    });
    controls = createOrbitControls(canvas, {
      onOrbit: (yaw, pitch) => engine._g3_viewer_orbit(yaw, pitch),
      onZoom: factor => engine._g3_viewer_zoom(factor),
      onPan: (dx, dy) => engine._g3_viewer_pan(dx, dy, canvas.clientHeight),
      onSelect: (x, y) => {
        if (!model) return;
        const hit = model.pick(canvas, x, y);
        if (hit === null) {
          selectedPrimitive = null;
          updateInspection();
          status.textContent = 'No mesh selected.';
          return;
        }
        const owner = model.nodes.find(node => node.primitives.some(handle =>
          handle.index === hit.index && handle.generation === hit.generation && handle.epoch === hit.epoch));
        if (!owner) {
          selectedPrimitive = null;
          updateInspection();
          status.textContent = `Selected mesh node ${hit.index}.`;
        }
        else {
          const primitive = owner.primitives.findIndex(handle => handle.index === hit.index && handle.generation === hit.generation);
          status.textContent = `Selected ${owner.name || `glTF node ${owner.index}`}, primitive ${primitive + 1}.`;
          selectedPrimitive = { owner, primitive };
          updateInspection();
        }
      },
    });
    window.addEventListener('pagehide', () => {
      controls?.dispose();
      model?.dispose();
      engine?._g3_app_shutdown();
    }, { once: true });
    requestAnimationFrame(frame);
    await loadModel();
  } catch (error) { status.textContent = error.message; }
}

function frame(now) {
  const dt = last ? Math.min((now - last) / 1000, 0.1) : 1 / 60;
  last = now;
  if (model) {
    model.update(dt);
    updateAnimationControls();
  }
  engine._g3_app_frame(dt);
  requestAnimationFrame(frame);
}
start();
