import './index.css';
import * as THREE from 'gs3d/three';
import { createWaterSandbox, KIND_INFO, type SpawnKind, type WaterSandbox } from './water';
import { createRippleNormalMap } from './ripples';

const root = document.querySelector<HTMLDivElement>('#root');
if (!root) throw new Error('Missing #root app mount');

const spawnButtons = (Object.keys(KIND_INFO) as SpawnKind[])
  .map(kind => `<button type="button" data-spawn="${kind}">${KIND_INFO[kind].label}</button>`)
  .join('');

root.innerHTML = `
  <main class="workspace">
    <header class="topbar">
      <a class="brand" href="#"><span class="brand-mark">g</span> Goose 3D <span class="slash">/</span> Water Lab</a>
      <span class="mode"><i></i> Buoyancy + drag · gs3d/physics</span>
    </header>
    <section class="hero">
      <div class="eyebrow">RIGID-BODY FLUIDS · NO NAVIER-STOKES</div>
      <h1>Drop it in.<br><span>Watch displacement do the work.</span></h1>
      <p class="intro">A <code>gs3d/physics</code> sandbox with a water plane: bodies below the surface get buoyancy proportional to displaced volume and linear drag on velocity and spin. Spawn floaters (density 350) and sinkers (density 2600), drag the water level, or click the pool to splash a ball in.</p>
    </section>
    <section class="studio" aria-label="3D water sandbox">
      <aside class="editor">
        <div class="section-title"><span>01</span> Spawn <code>src/water.ts</code></div>
        <div class="sandbox">
          <div class="sandbox-row" role="group" aria-label="Spawn physics bodies">${spawnButtons}</div>
          <div class="sandbox-row">
            <button type="button" id="phys-clear">Clear pool</button>
          </div>
          <div class="sandbox-count"><span id="phys-count">0</span> bodies · click the water to drop</div>
        </div>
        <div class="section-title"><span>02</span> Water level</div>
        <div class="water-control">
          <input id="water-level" type="range" min="-80" max="80" value="0" aria-label="Water level">
          <output id="water-readout">0.00</output>
        </div>
        <div class="spec-note"><span class="code-dot"></span><code>world.setWaterLevel(y)</code><span>· ρ = mass / volume</span></div>
        <div id="status" class="status" role="status" aria-live="polite"></div>
      </aside>
      <div class="preview-wrap">
        <div class="preview-head"><span><i></i> LIVE PREVIEW</span><span>DRAG TO ORBIT · SCROLL TO ZOOM</span></div>
        <canvas id="preview" aria-label="Interactive 3D water simulation"></canvas>
        <div class="preview-foot"><span id="pool-label">POOL · Y = 0</span><span id="scene-stats">—</span></div>
        <div class="grid-glow"></div>
      </div>
    </section>
    <footer><span>Buoyancy = −gravity × ρw/ρb × submerged fraction</span><a href="https://github.com/aardappel/goose">Built for Goose 3D <span>↗</span></a></footer>
  </main>`;

const $ = <T extends HTMLElement>(selector: string): T => {
  const element = root!.querySelector<T>(selector);
  if (!element) throw new Error(`Missing UI element: ${selector}`);
  return element;
};

const canvas = $<HTMLCanvasElement>('#preview');
const status = $<HTMLDivElement>('#status');
const physCount = $<HTMLSpanElement>('#phys-count');
const waterSlider = $<HTMLInputElement>('#water-level');
const waterReadout = $<HTMLOutputElement>('#water-readout');
const poolLabel = $<HTMLSpanElement>('#pool-label');
const sceneStats = $<HTMLSpanElement>('#scene-stats');

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x0c1420);
const camera = new THREE.PerspectiveCamera(42, 1, 0.1, 100);
camera.position.set(4.2, 2.6, 5.4);

scene.add(new THREE.HemisphereLight(0xbdd2ff, 0x1c2b3d, 1.6));
const keyLight = new THREE.DirectionalLight(0xffe2bd, 2.6);
keyLight.position.set(-4, 6, 5);
scene.add(keyLight);
const rimLight = new THREE.DirectionalLight(0x6fb7ff, 1.2);
rimLight.position.set(4, 3, -4);
scene.add(rimLight);

// The water surface: a large translucent plane the sandbox moves with
// world.setWaterLevel. Slight emissive so it reads against the dark pool.
// Scrolling ripple normals: the procedural map wraps seamlessly, so
// drifting texture.offset reads as moving surface waves that catch the
// key light and the environment map as traveling specular glints.
const rippleMap = createRippleNormalMap();
const waterMaterial = new THREE.MeshStandardMaterial({
  color: 0x1d4e6e,
  roughness: 0.08,
  metalness: 0.0,
  transparent: true,
  opacity: 0.55,
  side: THREE.DoubleSide,
  envMapIntensity: 1.4,
  normalMap: rippleMap,
  normalScale: new THREE.Vector2(0.55, 0.55),
});
const waterMesh = new THREE.Mesh(new THREE.PlaneGeometry(40, 40), waterMaterial);
waterMesh.rotation.x = -Math.PI / 2;
waterMesh.position.y = 0;
scene.add(waterMesh);

// A darker "deep" plane just under the surface for depth cueing.
const deepMesh = new THREE.Mesh(
  new THREE.PlaneGeometry(40, 40),
  new THREE.MeshStandardMaterial({ color: 0x0a1622, roughness: 1, metalness: 0 }),
);
deepMesh.rotation.x = -Math.PI / 2;
deepMesh.position.y = -0.35;
scene.add(deepMesh);

let sandbox: WaterSandbox | null = null;

function updatePhysCount(): void {
  physCount.textContent = String(sandbox?.bodyCount ?? 0);
}

for (const button of root!.querySelectorAll<HTMLButtonElement>('[data-spawn]')) {
  button.addEventListener('click', () => {
    sandbox?.spawn(button.dataset.spawn as SpawnKind);
    updatePhysCount();
  });
}
$<HTMLButtonElement>('#phys-clear').addEventListener('click', () => {
  sandbox?.clear();
  updatePhysCount();
});

waterSlider.addEventListener('input', () => {
  const y = Number(waterSlider.value) / 100;
  sandbox?.setWaterLevel(y);
  waterReadout.textContent = y.toFixed(2);
  poolLabel.textContent = `POOL · Y = ${y.toFixed(2)}`;
});

function render(now: number): void {
  sandbox?.step();
  updatePhysCount();
  // Scroll the ripple normals and breathe the surface opacity.
  rippleMap.offset.set((now * 0.000012) % 1, (now * 0.000008) % 1);
  waterMaterial.opacity = 0.5 + Math.sin(now * 0.0012) * 0.04;
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
controls.target.set(0, -0.2, 0);
controls.enableDamping = true;
controls.dampingFactor = 0.08;
controls.minDistance = 2;
controls.maxDistance = 14;
controls.minPolarAngle = 0.1;
controls.maxPolarAngle = Math.PI * 0.55;

// Click (not drag) raycasts into the physics world and drops a float ball.
const pickRaycaster = new THREE.Raycaster();
let downX = 0;
let downY = 0;
let downId = -1;
canvas.addEventListener('pointerdown', event => {
  downX = event.clientX;
  downY = event.clientY;
  downId = event.pointerId;
});
canvas.addEventListener('pointerup', event => {
  if (!sandbox || event.pointerId !== downId) return;
  if (Math.hypot(event.clientX - downX, event.clientY - downY) > 6) return;
  const rect = canvas.getBoundingClientRect();
  const ndc = new THREE.Vector2(
    ((event.clientX - rect.left) / rect.width) * 2 - 1,
    -((event.clientY - rect.top) / rect.height) * 2 + 1,
  );
  pickRaycaster.setFromCamera(ndc, camera);
  const o = pickRaycaster.ray.origin;
  const d = pickRaycaster.ray.direction;
  if (sandbox.pickDrop([o.x, o.y, o.z], [d.x, d.y, d.z])) updatePhysCount();
});

async function startRenderer(): Promise<void> {
  try {
    const engine = await renderer.init();
    // Image-based lighting: a room env gives every glossy surface —
    // above all the water — real specular reflections to play against.
    const pmrem = new THREE.PMREMGenerator(renderer);
    scene.environment = pmrem.fromScene(new THREE.RoomEnvironment()).texture;
    scene.environmentIntensity = 0.55;
    sandbox = createWaterSandbox(scene, engine, waterMesh);
    // Debug hook for agents/devtools: live sandbox + scene handles.
    (window as unknown as { __gs3dWater?: unknown }).__gs3dWater = { sandbox, scene };
    resizeCanvas();
    new ResizeObserver(resizeCanvas).observe(canvas);
    const backend = (renderer.backend as { isWebGPUBackend?: boolean }).isWebGPUBackend ? 'WebGPU' : 'WebGL2';
    sceneStats.textContent = `${Object.keys(KIND_INFO).length} KINDS · ${backend.toUpperCase()}`;
    status.textContent = 'Ready · spawn a floater or a stone, then drag the water level';
    renderer.setAnimationLoop(render);
  } catch (error) {
    console.error('Could not start the Goose 3D renderer:', error);
    status.textContent = 'Could not initialize the renderer. Check browser WebGL2 support.';
  }
}

void startRenderer();
