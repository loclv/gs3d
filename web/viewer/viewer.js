import createGoose3D from './app.js';
import { fitToDisplay } from '../canvas.js';
import { loadGLTF } from 'goose-3d-browser-assets';
import { createOrbitControls } from 'goose-3d-browser-assets/orbit-controls';

const canvas = document.getElementById('canvas');
const status = document.getElementById('status');
const reload = document.getElementById('reload');
const inspection = document.getElementById('inspection');
const previews = document.getElementById('texture-previews');
const variantSelect = document.getElementById('variant');
let engine, model, last = 0;
let selectedPrimitive = null;

function updateInspection() {
  previews.replaceChildren();
  if (!model || !selectedPrimitive) {
    inspection.textContent = 'Click a mesh to inspect its material.';
    return;
  }
  const { owner, primitive } = selectedPrimitive;
  const choice = owner.primitiveMaterials[primitive];
  const selectedVariant = choice.variants.find(variant => variant.index === model.activeVariant);
  const material = selectedVariant?.material ?? choice.default;
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

window.gooseError = message => { status.textContent = message; };
window.gooseSurfaceFailed = () => window.gooseError('WebGL2 could not be started.');

async function loadModel() {
  reload.disabled = true;
  status.textContent = 'Loading model…';
  try {
    const next = await loadGLTF(engine, './sample.glb');
    if (model) model.dispose();
    model = next;
    selectedPrimitive = null;
    updateInspection();
    variantSelect.replaceChildren(new Option('Default materials', '-1'));
    for (const [index, name] of model.variants.entries()) variantSelect.add(new Option(name, String(index)));
    variantSelect.disabled = model.variants.length === 0;
    const lightStatus = model.lights.length === 0 ? '' : model.applyLights()
      ? ` ${model.lights.length} imported lights active.` : ' Could not apply imported lights.';
    if (model.animations.length) {
      model.playAnimation(0);
      status.textContent = `Playing ${model.animations[0].name}.${lightStatus} Click a face to select it.`;
    } else status.textContent = `Model loaded.${lightStatus} Click a face to select it.`;
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
    variantSelect.addEventListener('change', () => {
      if (!model) return;
      const variant = Number(variantSelect.value);
      if (model.setVariant(variant < 0 ? null : variant)) updateInspection();
    });
    createOrbitControls(canvas, {
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
    requestAnimationFrame(frame);
    await loadModel();
  } catch (error) { status.textContent = error.message; }
}

function frame(now) {
  const dt = last ? Math.min((now - last) / 1000, 0.1) : 1 / 60;
  last = now;
  if (model) model.update(dt);
  engine._g3_app_frame(dt);
  requestAnimationFrame(frame);
}
start();
