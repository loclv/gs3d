import './index.css';
import * as THREE from 'gs3d/three';
import { buildCharacter, JOINT_NAMES } from './character';
import { CLIPS } from './clips';
import { sampleClip, type Clip, type ClipPose, type Vec3 } from './animation';

const root = document.querySelector<HTMLDivElement>('#root');
if (!root) throw new Error('Missing #root app mount');

const clipButtons = CLIPS.map(
  (clip, index) => `<button type="button" class="clip-btn" data-clip="${index}" aria-pressed="${index === 0}">
    <span class="clip-index">${String(index + 1).padStart(2, '0')}</span>
    <span class="clip-name">${clip.name}</span>
    <span class="clip-duration">${clip.duration.toFixed(1)}s</span>
  </button>`,
).join('');

root.innerHTML = `
  <main class="workspace">
    <header class="topbar">
      <a class="brand" href="#"><span class="brand-mark">g</span> Goose 3D <span class="slash">/</span> Animation Lab</a>
      <span class="mode"><i></i> Procedural clips · gs3d/three</span>
    </header>
    <section class="hero">
      <div class="eyebrow">CODE-FIRST · KEYFRAME CLIPS</div>
      <h1>Choreograph it in source.<br><span>Watch it move in 3D.</span></h1>
      <p class="intro">A small animation sample for the Goose 3D TypeScript facade. Clips are plain typed keyframe data — pick one, scrub the timeline, or edit <code>src/clips.ts</code> and see the change live.</p>
    </section>
    <section class="studio" aria-label="3D animation studio">
      <aside class="editor">
        <div class="section-title"><span>01</span> Clips <code>src/clips.ts</code></div>
        <div class="clip-list" role="group" aria-label="Animation clips">${clipButtons}</div>
        <div class="section-title transport-title"><span>02</span> Transport</div>
        <div class="transport">
          <button id="play-pause" class="play" type="button" aria-label="Pause"><span id="play-icon">❚❚</span></button>
          <input id="scrub" type="range" min="0" max="1000" value="0" aria-label="Scrub timeline">
          <output id="time-readout">0.00 / 2.4s</output>
        </div>
        <div class="transport-row">
          <label class="field speed-field">Speed
            <select id="speed">
              <option value="0.25">0.25×</option>
              <option value="0.5">0.5×</option>
              <option value="1" selected>1×</option>
              <option value="1.5">1.5×</option>
              <option value="2">2×</option>
            </select>
          </label>
          <label class="loop-field"><input id="loop" type="checkbox" checked> Loop</label>
        </div>
        <div class="section-title probe-title"><span>03</span> Joint probe</div>
        <div class="probe">
          <select id="joint" aria-label="Joint to inspect"></select>
          <output id="joint-values" class="joint-values">—</output>
        </div>
        <div class="spec-note"><span class="code-dot"></span><code>sampleClip(clip, t)</code><span>· euler ° · pos Δ</span></div>
        <div id="status" class="status" role="status" aria-live="polite"></div>
      </aside>
      <div class="preview-wrap">
        <div class="preview-head"><span><i></i> LIVE PREVIEW</span><span>DRAG TO ORBIT · SCROLL TO ZOOM</span></div>
        <canvas id="preview" aria-label="Interactive 3D animation preview"></canvas>
        <div class="preview-foot"><span id="clip-label">IDLE</span><span id="scene-stats">12 JOINTS · 0 KEYS · 0 TRIANGLES</span></div>
        <div class="grid-glow"></div>
      </div>
    </section>
    <footer><span>Plain TypeScript keyframes → gs3d/three transforms</span><a href="https://github.com/aardappel/goose">Built for Goose 3D <span>↗</span></a></footer>
  </main>`;

const $ = <T extends HTMLElement>(selector: string): T => {
  const element = root!.querySelector<T>(selector);
  if (!element) throw new Error(`Missing UI element: ${selector}`);
  return element;
};

const canvas = $<HTMLCanvasElement>('#preview');
const status = $<HTMLDivElement>('#status');
const scrub = $<HTMLInputElement>('#scrub');
const timeReadout = $<HTMLOutputElement>('#time-readout');
const playButton = $<HTMLButtonElement>('#play-pause');
const playIcon = $<HTMLSpanElement>('#play-icon');
const speedSelect = $<HTMLSelectElement>('#speed');
const loopToggle = $<HTMLInputElement>('#loop');
const jointSelect = $<HTMLSelectElement>('#joint');
const jointValues = $<HTMLOutputElement>('#joint-values');
const clipLabel = $<HTMLSpanElement>('#clip-label');
const sceneStats = $<HTMLSpanElement>('#scene-stats');

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x0c0f15);
const camera = new THREE.PerspectiveCamera(38, 1, 0.1, 100);
camera.position.set(2.6, 1.5, 3.1);

scene.add(new THREE.HemisphereLight(0xcbd8ff, 0x263247, 2.0));
const keyLight = new THREE.DirectionalLight(0xffe2bd, 3.0);
keyLight.position.set(-3, 5, 6);
scene.add(keyLight);
const rimLight = new THREE.DirectionalLight(0x8ca6ff, 1.4);
rimLight.position.set(3, 2, -4);
scene.add(rimLight);

const groundMat = new THREE.MeshStandardMaterial({ color: 0x141a26, roughness: 0.9, metalness: 0.05 });
const ground = new THREE.Mesh(new THREE.CircleGeometry(6, 48), groundMat);
ground.rotation.x = -Math.PI / 2;
scene.add(ground);
const ringMat = new THREE.MeshStandardMaterial({ color: 0x1b2740, roughness: 0.6, metalness: 0.3, emissive: 0x2a3d66, emissiveIntensity: 0.5 });
const ring = new THREE.Mesh(new THREE.TorusGeometry(1.6, 0.012, 8, 96), ringMat);
ring.rotation.x = Math.PI / 2;
scene.add(ring);

const rig = buildCharacter();
scene.add(rig.root);
const DEG = Math.PI / 180;

let clip: Clip = CLIPS[0];
let time = 0;
let playing = true;
let speed = 1;
let loop = true;
let lastNow = 0;
let pose: ClipPose = {};

const jointSelectOptions = JOINT_NAMES.map(name => `<option value="${name}">${name}</option>`).join('');
jointSelect.innerHTML = jointSelectOptions;

function applyPose(poseNow: ClipPose): void {
  for (const name of JOINT_NAMES) {
    const joint = rig.joints[name];
    if (!joint) continue;
    const channel = poseNow[name];
    const base = rig.bases[name];
    const p = channel?.position;
    joint.position.set(base[0] + (p?.[0] ?? 0), base[1] + (p?.[1] ?? 0), base[2] + (p?.[2] ?? 0));
    const r = channel?.rotation;
    joint.rotation.set((r?.[0] ?? 0) * DEG, (r?.[1] ?? 0) * DEG, (r?.[2] ?? 0) * DEG);
    const s = channel?.scale;
    joint.scale.set(s?.[0] ?? 1, s?.[1] ?? 1, s?.[2] ?? 1);
  }
}

function keyCount(c: Clip): number {
  let n = 0;
  for (const track of Object.values(c.tracks)) {
    n += (track.position?.length ?? 0) + (track.rotation?.length ?? 0) + (track.scale?.length ?? 0);
  }
  return n;
}

let triangleCount = 0;
rig.root.traverse(object => {
  const mesh = object as THREE.Mesh;
  if (mesh.isMesh && mesh.geometry?.index) triangleCount += mesh.geometry.index.count / 3;
});

function selectClip(index: number, resetTime = true): void {
  clip = CLIPS[index];
  if (resetTime) time = 0;
  for (const button of root!.querySelectorAll<HTMLButtonElement>('.clip-btn')) {
    button.setAttribute('aria-pressed', String(Number(button.dataset.clip) === index));
  }
  clipLabel.textContent = clip.name.toUpperCase();
  sceneStats.textContent = `${JOINT_NAMES.length} JOINTS · ${keyCount(clip)} KEYS · ${Math.round(triangleCount)} TRIANGLES`;
}

for (const button of root!.querySelectorAll<HTMLButtonElement>('.clip-btn')) {
  button.addEventListener('click', () => selectClip(Number(button.dataset.clip)));
}

playButton.addEventListener('click', () => {
  playing = !playing;
  playIcon.textContent = playing ? '❚❚' : '▶';
  playButton.setAttribute('aria-label', playing ? 'Pause' : 'Play');
});
scrub.addEventListener('input', () => {
  time = (Number(scrub.value) / 1000) * clip.duration;
});
speedSelect.addEventListener('change', () => { speed = Number(speedSelect.value); });
loopToggle.addEventListener('change', () => { loop = loopToggle.checked; });

function updateProbe(): void {
  const name = jointSelect.value as (typeof JOINT_NAMES)[number];
  const joint = rig.joints[name];
  const base = rig.bases[name];
  const p: Vec3 = [joint.position.x - base[0], joint.position.y - base[1], joint.position.z - base[2]];
  const r: Vec3 = [joint.rotation.x / DEG, joint.rotation.y / DEG, joint.rotation.z / DEG];
  const f = (v: number) => v.toFixed(1).padStart(6);
  jointValues.textContent = `pos Δ (${f(p[0])}, ${f(p[1])}, ${f(p[2])})  rot° (${f(r[0])}, ${f(r[1])}, ${f(r[2])})`;
}

function render(now: number): void {
  const dt = lastNow ? Math.min(0.1, (now - lastNow) / 1000) : 0;
  lastNow = now;
  if (playing) {
    time += dt * speed;
    if (loop) {
      time %= clip.duration;
    } else if (time >= clip.duration) {
      time = clip.duration;
      playing = false;
      playIcon.textContent = '▶';
      playButton.setAttribute('aria-label', 'Play');
    }
  }
  pose = sampleClip(clip, time, loop);
  applyPose(pose);
  scrub.value = String(Math.round((time / clip.duration) * 1000));
  timeReadout.textContent = `${time.toFixed(2)} / ${clip.duration.toFixed(1)}s`;
  updateProbe();
  ring.rotation.z = now * 0.0002;
  controls.update();
  renderer.render(scene, camera);
}

function resizeCanvas(): void {
  const rect = canvas.getBoundingClientRect();
  const width = Math.max(1, rect.width);
  const height = Math.max(1, rect.height);
  camera.aspect = width / height;
  camera.updateProjectionMatrix();
  renderer.setSize(width, height, false);
}

const renderer = new THREE.WebGPURenderer({ canvas, alpha: false, antialias: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
renderer.outputColorSpace = THREE.SRGBColorSpace;
const controls = new THREE.OrbitControls(camera, canvas);
controls.target.set(0, 1.0, 0);
controls.enableDamping = true;
controls.dampingFactor = 0.08;
controls.minDistance = 1.2;
controls.maxDistance = 9;
controls.maxPolarAngle = Math.PI * 0.55;

selectClip(0);

async function startRenderer(): Promise<void> {
  try {
    await renderer.init();
    resizeCanvas();
    new ResizeObserver(resizeCanvas).observe(canvas);
    const backend = (renderer.backend as { isWebGPUBackend?: boolean }).isWebGPUBackend ? 'WebGPU' : 'WebGL2';
    status.textContent = `Ready · ${JOINT_NAMES.length} joints · ${CLIPS.length} clips · ${keyCount(CLIPS[0])}–${Math.max(...CLIPS.map(keyCount))} keys · ${Math.round(triangleCount)} triangles · ${backend}`;
    renderer.setAnimationLoop(render);
  } catch (error) {
    console.error('Could not start the Goose 3D renderer:', error);
    status.textContent = 'Could not initialize the renderer. Check browser WebGL2 support.';
  }
}

void startRenderer();
