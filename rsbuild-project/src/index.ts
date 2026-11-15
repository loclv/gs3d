import './index.css';
import { authorBox, type AuthoredModel } from './model';

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
        <fieldset class="dimensions">
          <legend>Dimensions <span>meters</span></legend>
          <label><span>W</span><input id="width" type="range" min="0.4" max="3.2" step="0.1" value="1.2"><output id="width-value">1.2</output></label>
          <label><span>H</span><input id="height" type="range" min="0.4" max="3.2" step="0.1" value="1.8"><output id="height-value">1.8</output></label>
          <label><span>D</span><input id="depth" type="range" min="0.4" max="3.2" step="0.1" value="0.8"><output id="depth-value">0.8</output></label>
        </fieldset>
        <label class="field color-field">Base color
          <span class="color-control"><input id="color" type="color" value="#6b8cff"><output id="color-value">#6B8CFF</output></span>
        </label>
        <div class="spec-note"><span class="code-dot"></span><code>boxGeometry(size)</code><span>· 24 flat-shaded verts</span></div>
        <button id="export" class="export"><span>Export model</span><span aria-hidden="true">↗</span></button>
        <div id="status" class="status" role="status" aria-live="polite"></div>
      </aside>
      <div class="preview-wrap">
        <div class="preview-head"><span><i></i> LIVE PREVIEW</span><span>DRAG TO ORBIT</span></div>
        <canvas id="preview" aria-label="Interactive 3D model preview"></canvas>
        <div class="preview-foot"><span id="preview-name">SIGNAL BEACON</span><span id="mesh-stats">12 TRIANGLES · GLB 0 KB</span></div>
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
const gl = canvas.getContext('webgl2', { alpha: false, antialias: true });

if (!gl) {
  status.textContent = 'This preview needs WebGL2. You can still use the exported TypeScript model source.';
  throw new Error('WebGL2 is unavailable');
}

const vertexShader = `#version 300 es
in vec3 aPosition;
in vec3 aNormal;
uniform float uYaw;
uniform float uPitch;
uniform float uAspect;
out vec3 vNormal;
void main() {
  float cy = cos(uYaw), sy = sin(uYaw);
  float cx = cos(uPitch), sx = sin(uPitch);
  mat3 rotateY = mat3(cy, 0.0, -sy, 0.0, 1.0, 0.0, sy, 0.0, cy);
  mat3 rotateX = mat3(1.0, 0.0, 0.0, 0.0, cx, sx, 0.0, -sx, cx);
  vec3 viewPosition = rotateX * rotateY * aPosition;
  viewPosition.z -= 4.2;
  float nearPlane = 0.1, farPlane = 100.0;
  float f = 1.65;
  gl_Position = vec4(viewPosition.x * f / uAspect, viewPosition.y * f,
    viewPosition.z * (farPlane + nearPlane) / (nearPlane - farPlane) +
    (2.0 * farPlane * nearPlane) / (nearPlane - farPlane), -viewPosition.z);
  vNormal = normalize(rotateX * rotateY * aNormal);
}`;
const fragmentShader = `#version 300 es
precision highp float;
uniform vec3 uColor;
in vec3 vNormal;
out vec4 outColor;
void main() {
  float diffuse = max(dot(normalize(vNormal), normalize(vec3(-0.45, 0.75, 1.0))), 0.0);
  float light = 0.24 + 0.76 * diffuse;
  outColor = vec4(uColor * light, 1.0);
}`;

function compileShader(type: number, source: string): WebGLShader {
  const shader = gl!.createShader(type);
  if (!shader) throw new Error('Could not create preview shader');
  gl!.shaderSource(shader, source);
  gl!.compileShader(shader);
  if (!gl!.getShaderParameter(shader, gl!.COMPILE_STATUS)) {
    const message = gl!.getShaderInfoLog(shader) ?? 'Unknown shader error';
    gl!.deleteShader(shader);
    throw new Error(message);
  }
  return shader;
}

const program = gl.createProgram();
if (!program) throw new Error('Could not create preview program');
gl.attachShader(program, compileShader(gl.VERTEX_SHADER, vertexShader));
gl.attachShader(program, compileShader(gl.FRAGMENT_SHADER, fragmentShader));
gl.linkProgram(program);
if (!gl.getProgramParameter(program, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(program) ?? 'Could not link preview shaders');
gl.useProgram(program);
gl.enable(gl.DEPTH_TEST);
gl.enable(gl.CULL_FACE);
gl.clearColor(0.047, 0.059, 0.082, 1);

const positionBuffer = gl.createBuffer();
const normalBuffer = gl.createBuffer();
const indexBuffer = gl.createBuffer();
if (!positionBuffer || !normalBuffer || !indexBuffer) throw new Error('Could not create preview buffers');
const positionLocation = gl.getAttribLocation(program, 'aPosition');
const normalLocation = gl.getAttribLocation(program, 'aNormal');
const yawLocation = gl.getUniformLocation(program, 'uYaw');
const pitchLocation = gl.getUniformLocation(program, 'uPitch');
const aspectLocation = gl.getUniformLocation(program, 'uAspect');
const colorLocation = gl.getUniformLocation(program, 'uColor');
let model: AuthoredModel;
let yaw = -0.5;
let pitch = 0.25;
let pointer: { id: number; x: number; y: number } | undefined;

function resizeCanvas(): void {
  const rect = canvas.getBoundingClientRect();
  const pixelRatio = Math.min(window.devicePixelRatio || 1, 2);
  const width = Math.max(1, Math.round(rect.width * pixelRatio));
  const height = Math.max(1, Math.round(rect.height * pixelRatio));
  if (canvas.width !== width || canvas.height !== height) {
    canvas.width = width;
    canvas.height = height;
  }
  gl!.viewport(0, 0, width, height);
}

function setGeometry(): void {
  const width = Number(widthInput.value);
  const height = Number(heightInput.value);
  const depth = Number(depthInput.value);
  model = authorBox({ name: nameInput.value.trim() || 'Untitled prop', size: [width, height, depth], color: colorInput.value });
  gl!.bindBuffer(gl!.ARRAY_BUFFER, positionBuffer);
  gl!.bufferData(gl!.ARRAY_BUFFER, new Float32Array(model.geometry.positions.flatMap(point => [...point])), gl!.STATIC_DRAW);
  gl!.enableVertexAttribArray(positionLocation);
  gl!.vertexAttribPointer(positionLocation, 3, gl!.FLOAT, false, 0, 0);
  gl!.bindBuffer(gl!.ARRAY_BUFFER, normalBuffer);
  gl!.bufferData(gl!.ARRAY_BUFFER, new Float32Array(model.geometry.normals!.flatMap(normal => [...normal])), gl!.STATIC_DRAW);
  gl!.enableVertexAttribArray(normalLocation);
  gl!.vertexAttribPointer(normalLocation, 3, gl!.FLOAT, false, 0, 0);
  gl!.bindBuffer(gl!.ELEMENT_ARRAY_BUFFER, indexBuffer);
  gl!.bufferData(gl!.ELEMENT_ARRAY_BUFFER, new Uint16Array(model.geometry.indices), gl!.STATIC_DRAW);
  const color = [1, 3, 5].map(offset => Number.parseInt(colorInput.value.slice(offset, offset + 2), 16) / 255);
  gl!.uniform3fv(colorLocation, color);
  $('#width-value').textContent = width.toFixed(1);
  $('#height-value').textContent = height.toFixed(1);
  $('#depth-value').textContent = depth.toFixed(1);
  $('#color-value').textContent = colorInput.value.toUpperCase();
  $('#preview-name').textContent = (nameInput.value.trim() || 'UNTITLED PROP').toUpperCase();
  $('#mesh-stats').textContent = `${model.triangleCount} TRIANGLES · GLB ${(model.glb.byteLength / 1024).toFixed(1)} KB`;
  status.textContent = `Ready · ${model.vertexCount} vertices · ${model.triangleCount} triangles · ${model.glb.byteLength.toLocaleString()} byte GLB`;
}

function render(): void {
  resizeCanvas();
  gl!.clear(gl!.COLOR_BUFFER_BIT | gl!.DEPTH_BUFFER_BIT);
  gl!.uniform1f(yawLocation, yaw);
  gl!.uniform1f(pitchLocation, pitch);
  gl!.uniform1f(aspectLocation, canvas.width / canvas.height);
  gl!.drawElements(gl!.TRIANGLES, model.geometry.indices.length, gl!.UNSIGNED_SHORT, 0);
  requestAnimationFrame(render);
}

for (const input of [nameInput, widthInput, heightInput, depthInput, colorInput]) {
  input.addEventListener('input', setGeometry);
}
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
new ResizeObserver(resizeCanvas).observe(canvas);

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

setGeometry();
requestAnimationFrame(render);
