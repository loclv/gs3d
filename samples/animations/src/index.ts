import './index.css';
import { authorModel, type AuthoredModel } from './model';
import * as THREE from 'gs3d/three';

const root = document.querySelector<HTMLDivElement>('#root');
if (!root) throw new Error('Missing #root app mount');

root.innerHTML = `
  <main class="workspace">
    <header class="topbar">
      <a class="brand" href="#"><span class="brand-mark">g</span> Goose 3D <span class="slash">/</span> Model Lab</a>
      <span class="mode"><i></i> TypeScript authoring</span>
    </header>
    <section class="hero">
      <div class="eyebrow">CODE-FIRST · GLB EXPORT</div>
      <h1>Shape it in source.<br><span>See it in 3D.</span></h1>
      <p class="intro">A small, AI-friendly model authoring sample. Change a few typed parameters, inspect a live preview, and export a standard glTF binary model.</p>
    </section>
    <section class="studio" aria-label="3D model authoring studio">
      <aside class="editor">
        <div class="section-title"><span>01</span> Model spec <code>src/model.ts</code></div>
        <label class="field">Model name
          <input id="model-name" value="Signal Beacon" maxlength="48" autocomplete="off">
        </label>
        <div class="parts-heading"><span>Parts</span><div><button id="add-part" type="button">+ Add box</button><button id="remove-part" type="button" aria-label="Remove selected part">−</button></div></div>
        <select id="part-list" class="part-list" aria-label="Select model part"></select>
        <label class="field part-name-field">Part name
          <input id="part-name" value="Body" maxlength="40" autocomplete="off">
        </label>
        <fieldset class="dimensions">
          <legend>Size <span>meters</span></legend>
          <label><span>W</span><input id="width" type="range" min="0.4" max="3.2" step="0.1" value="1.2"><output id="width-value">1.2</output></label>
          <label><span>H</span><input id="height" type="range" min="0.4" max="3.2" step="0.1" value="1.8"><output id="height-value">1.8</output></label>
          <label><span>D</span><input id="depth" type="range" min="0.4" max="3.2" step="0.1" value="0.8"><output id="depth-value">0.8</output></label>
        </fieldset>
        <fieldset class="dimensions position-fields">
          <legend>Position <span>meters</span></legend>
          <label><span>X</span><input id="x" type="range" min="-1.5" max="1.5" step="0.1" value="0"><output id="x-value">0.0</output></label>
          <label><span>Y</span><input id="y" type="range" min="-1.5" max="1.5" step="0.1" value="0"><output id="y-value">0.0</output></label>
          <label><span>Z</span><input id="z" type="range" min="-1.5" max="1.5" step="0.1" value="0"><output id="z-value">0.0</output></label>
        </fieldset>
        <label class="field color-field">Base color
          <span class="color-control"><input id="color" type="color" value="#6b8cff"><output id="color-value">#6B8CFF</output></span>
        </label>
        <div class="spec-note"><span class="code-dot"></span><code>parts: ModelPart[]</code><span>· meshes & transforms</span></div>
        <button id="export" class="export"><span>Export model</span><span aria-hidden="true">↗</span></button>
        <div id="status" class="status" role="status" aria-live="polite"></div>
      </aside>
      <div class="preview-wrap">
        <div class="preview-head"><span><i></i> LIVE PREVIEW</span><span>DRAG TO ORBIT</span></div>
        <canvas id="preview" aria-label="Interactive 3D model preview"></canvas>
        <div class="preview-foot"><span id="preview-name">SIGNAL BEACON</span><span id="mesh-stats">3 PARTS · 36 TRIANGLES · GLB 0 KB</span></div>
        <div class="grid-glow"></div>
      </div>
    </section>
    <footer><span>Plain TypeScript source → standard glTF 2.0</span><a href="https://github.com/aardappel/goose">Built for Goose 3D <span>↗</span></a></footer>
  </main>`;

const $ = <T extends HTMLElement>(selector: string): T => {
  const element = root!.querySelector<T>(selector);
  if (!element) throw new Error(`Missing UI element: ${selector}`);
  return element;
};

const nameInput = $<HTMLInputElement>('#model-name');
const widthInput = $<HTMLInputElement>('#width');
const heightInput = $<HTMLInputElement>('#height');
const depthInput = $<HTMLInputElement>('#depth');
const colorInput = $<HTMLInputElement>('#color');
const canvas = $<HTMLCanvasElement>('#preview');
const status = $<HTMLDivElement>('#status');
const scene = new THREE.Scene();
scene.background = new THREE.Color(0x0c0f15);
const camera = new THREE.PerspectiveCamera(35, 1, 0.1, 100);
camera.position.set(0, 0, 5.3);
scene.add(new THREE.HemisphereLight(0xcbd8ff, 0x263247, 2.1));
const keyLight = new THREE.DirectionalLight(0xffe2bd, 3.2);
keyLight.position.set(-3, 5, 6);
scene.add(keyLight);
const modelGroup = new THREE.Group();
scene.add(modelGroup);
const renderer = new THREE.WebGPURenderer({ canvas, alpha: false, antialias: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
renderer.outputColorSpace = THREE.SRGBColorSpace;

let model: AuthoredModel;
let yaw = -0.5;
let pitch = 0.25;
let pointer: { id: number; x: number; y: number } | undefined;
interface PartDraft { name: string; size: [number, number, number]; position: [number, number, number]; color: string }
const parts: PartDraft[] = [
  { name: 'Body', size: [1.25, 0.72, 0.78], position: [0, 0, 0], color: '#6b8cff' },
  { name: 'Housing', size: [0.76, 0.58, 0.66], position: [0, 0.62, 0], color: '#aabaff' },
  { name: 'Beacon lens', size: [0.28, 0.34, 0.3], position: [0, 1.08, 0], color: '#ffc16f' },
];
let selectedPart = 0;

const partList = document.querySelector<HTMLSelectElement>('#part-list')!;
const partName = document.querySelector<HTMLInputElement>('#part-name')!;
const dimensionInputs = [widthInput, heightInput, depthInput];
const positionInputs = [$<HTMLInputElement>('#x'), $<HTMLInputElement>('#y'), $<HTMLInputElement>('#z')];

function currentPart(): PartDraft { return parts[selectedPart]; }

function syncInputsToPart(): void {
  const part = currentPart();
  part.name = partName.value.trim() || 'Untitled part';
  part.size = dimensionInputs.map(input => Number(input.value)) as PartDraft['size'];
  part.position = positionInputs.map(input => Number(input.value)) as PartDraft['position'];
  part.color = colorInput.value;
}

function loadPartInputs(): void {
  const part = currentPart();
  partName.value = part.name;
  dimensionInputs.forEach((input, axis) => { input.value = String(part.size[axis]); });
  positionInputs.forEach((input, axis) => { input.value = String(part.position[axis]); });
  colorInput.value = part.color;
}

function refreshPartOptions(): void {
  partList.replaceChildren(...parts.map((part, index) => new Option(`${String(index + 1).padStart(2, '0')}  ${part.name}`, String(index))));
  partList.value = String(selectedPart);
  $('#remove-part').toggleAttribute('disabled', parts.length <= 1);
}

function resizeCanvas(): void {
  const rect = canvas.getBoundingClientRect();
  const width = Math.max(1, rect.width);
  const height = Math.max(1, rect.height);
  camera.aspect = width / height;
  camera.updateProjectionMatrix();
  renderer.setSize(width, height, false);
}

function clearPreview(): void {
  for (const child of [...modelGroup.children]) {
    if (child instanceof THREE.Mesh) {
      child.geometry.dispose();
      const materials = Array.isArray(child.material) ? child.material : [child.material];
      for (const material of materials) material.dispose();
    }
  }
  modelGroup.clear();
}

function setGeometry(): void {
  syncInputsToPart();
  refreshPartOptions();
  model = authorModel(nameInput.value.trim() || 'Untitled model', parts);
  clearPreview();
  for (const part of model.parts) {
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(part.geometry.positions.flat(), 3));
    if (part.geometry.normals) geometry.setAttribute('normal', new THREE.Float32BufferAttribute(part.geometry.normals.flat(), 3));
    else geometry.computeVertexNormals();
    geometry.setIndex([...part.geometry.indices]);
    const material = new THREE.MeshStandardMaterial({ color: part.color, metalness: 0.12, roughness: 0.38 });
    const mesh = new THREE.Mesh(geometry, material);
    mesh.position.set(...part.position);
    modelGroup.add(mesh);
  }
  const selected = currentPart();
  const axes = ['width', 'height', 'depth'];
  axes.forEach((axis, index) => { $(`#${axis}-value`).textContent = selected.size[index].toFixed(1); });
  ['x', 'y', 'z'].forEach((axis, index) => { $(`#${axis}-value`).textContent = selected.position[index].toFixed(1); });
  $('#color-value').textContent = colorInput.value.toUpperCase();
  $('#preview-name').textContent = (nameInput.value.trim() || 'UNTITLED PROP').toUpperCase();
  $('#mesh-stats').textContent = `${model.parts.length} PARTS · ${model.triangleCount} TRIANGLES · GLB ${(model.glb.byteLength / 1024).toFixed(1)} KB`;
  status.textContent = `Ready · ${model.parts.length} parts · ${model.vertexCount} vertices · ${model.glb.byteLength.toLocaleString()} byte GLB · Goose 3D · WebGL2`;
}

function render(): void {
  modelGroup.rotation.set(pitch, yaw, 0);
  renderer.render(scene, camera);
}

for (const input of [nameInput, partName, widthInput, heightInput, depthInput, colorInput, ...positionInputs]) {
  input.addEventListener('input', setGeometry);
}
partList.addEventListener('change', () => {
  syncInputsToPart();
  selectedPart = Number(partList.value);
  loadPartInputs();
  setGeometry();
});
$('#add-part').addEventListener('click', () => {
  syncInputsToPart();
  const number = parts.length + 1;
  const palette = ['#73d3b0', '#ffa66f', '#d691f2', '#f1d36b'];
  parts.push({ name: `Part ${number}`, size: [0.5, 0.5, 0.5], position: [0, 0, 0], color: palette[(number - 1) % palette.length] });
  selectedPart = parts.length - 1;
  loadPartInputs();
  setGeometry();
});
$('#remove-part').addEventListener('click', () => {
  if (parts.length <= 1) return;
  syncInputsToPart();
  parts.splice(selectedPart, 1);
  selectedPart = Math.min(selectedPart, parts.length - 1);
  loadPartInputs();
  setGeometry();
});
canvas.addEventListener('pointerdown', event => {
  pointer = { id: event.pointerId, x: event.clientX, y: event.clientY };
  canvas.setPointerCapture(event.pointerId);
});
canvas.addEventListener('pointermove', event => {
  if (!pointer || pointer.id !== event.pointerId) return;
  yaw += (event.clientX - pointer.x) * 0.009;
  pitch = Math.max(-1.35, Math.min(1.35, pitch + (event.clientY - pointer.y) * 0.009));
  pointer.x = event.clientX;
  pointer.y = event.clientY;
});
canvas.addEventListener('pointerup', () => { pointer = undefined; });
canvas.addEventListener('pointercancel', () => { pointer = undefined; });

$('#export').addEventListener('click', () => {
  setGeometry();
  const fileBase = (nameInput.value.trim() || 'untitled-model').toLowerCase().replace(/[^a-z\d]+/g, '-').replace(/^-|-$/g, '');
  const blob = new Blob([model.glb.slice().buffer as ArrayBuffer], { type: 'model/gltf-binary' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = `${fileBase || 'untitled-model'}.glb`;
  link.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  status.textContent = `Downloaded ${link.download} · ${model.glb.byteLength.toLocaleString()} bytes`;
});

refreshPartOptions();
loadPartInputs();
setGeometry();

async function startRenderer(): Promise<void> {
  try {
    await renderer.init();
    resizeCanvas();
    new ResizeObserver(resizeCanvas).observe(canvas);
    const backend = (renderer.backend as { isWebGPUBackend?: boolean }).isWebGPUBackend ? 'WebGPU' : 'WebGL2';
    status.textContent = `Ready · ${model.parts.length} parts · ${model.vertexCount} vertices · ${model.glb.byteLength.toLocaleString()} byte GLB · ${backend}`;
    renderer.setAnimationLoop(render);
  } catch (error) {
    console.error('Could not start the Goose 3D renderer:', error);
    status.textContent = 'Could not initialize the renderer. Check browser WebGL2 support.';
  }
}

void startRenderer();
