import createGoose3D from './gs3d/app.js';
import { Color, Vector2, Vector3 } from './math';
import { Scene, PerspectiveCamera } from './scene';
import { PlaneGeometry, Mesh } from './geometry';
import { DataTexture } from './textures';
import { MeshBasicMaterial } from './materials';
import { sharedEngine, setSharedEngine, nodeStates, syncedObjects, releaseNodeRecord, releaseTexture, collectLights, syncSceneTree, syncBackground, syncFog, syncEnvironment, syncLights, syncCamera, setFrameMaterialCache } from './bridge';
import { ensureEngineRenderTarget } from './textures';

let engineCanvasSeq = 0;

const wasmUrl = new URL('./gs3d/app.wasm', import.meta.url);
const DEG2RAD = Math.PI / 180;
const MAX_EXTRA_LIGHTS = 8;

function requestFrame(callback) {
  if (typeof requestAnimationFrame === 'function') return requestAnimationFrame(callback);
  return setTimeout(() => callback(performance.now()), 16);
}
function cancelFrame(handle) {
  if (typeof cancelAnimationFrame === 'function') cancelAnimationFrame(handle);
  else clearTimeout(handle);
}


/* --- output settings ------------------------------------------------------------- */

export const NoColorSpace = 'none';
export const SRGBColorSpace = 'srgb';
export const LinearSRGBColorSpace = 'linear';
export const DisplayP3ColorSpace = 'display-p3';

export const NoToneMapping = 0;
export const LinearToneMapping = 1;
export const ReinhardToneMapping = 2;
export const CineonToneMapping = 3;
export const ACESFilmicToneMapping = 4;
export const CustomToneMapping = 5;
export const AgXToneMapping = 6;
export const NeutralToneMapping = 7;

export const BasicShadowMap = 0;
export const PCFShadowMap = 1;
export const PCFSoftShadowMap = 2;
export const VSMShadowMap = 3;

// Three.js tone-mapping constants mapped onto the engine's three modes.
const TONE_MODES = {
  0: 0, // NoToneMapping
  1: 0, // LinearToneMapping
  2: 1, // ReinhardToneMapping
  3: 1, // CineonToneMapping
  4: 2, // ACESFilmicToneMapping
};

/* --- the renderer ------------------------------------------------------------------ */

export class WebGPURenderer {
  domElement: any;
  isWebGPURenderer: boolean;
  _enginePromise: Promise<any> | null;
  _engine: any;
  _lightLease: number;
  _pixelRatio: number;
  _cssWidth: number;
  _cssHeight: number;
  _lastFrame: number;
  _animationLoop: ((time: number) => void) | null;
  _raf: number;
  _disposed: boolean;
  backend: { isWebGPUBackend: boolean; isWebGLBackend: boolean };
  outputColorSpace: string;
  toneMapping: number | string;
  toneMappingExposure: number;
  _engineOverride: any;
  shadowMap: { enabled: boolean; type: number; autoUpdate: boolean; needsUpdate: boolean };
  _captureTarget: number;
  capabilities: { maxTextureSize: number; getMaxAnisotropy: () => number };
  _currentRenderTarget: any;
  _extensions: any;
  _floatSupport?: boolean;
  _clearColor?: Color;
  _clearAlpha?: number;
  _selectedCameraId?: number;
  constructor(parameters: Record<string, any> = {}) {
    const canvas = parameters.canvas;
    if (!canvas || typeof canvas.getContext !== 'function') {
      throw new Error('gs3d: WebGPURenderer requires a canvas element');
    }
    this.domElement = canvas;
    this.isWebGPURenderer = true;
    this._enginePromise = null;
    this._engine = null;
    this._lightLease = -1;
    this._pixelRatio = 1;
    this._cssWidth = 0;
    this._cssHeight = 0;
    this._lastFrame = 0;
    this._animationLoop = null;
    this._raf = 0;
    this._disposed = false;
    this.backend = { isWebGPUBackend: false, isWebGLBackend: true };
    this.outputColorSpace = parameters.outputColorSpace ?? SRGBColorSpace;
    this.toneMapping = parameters.toneMapping ?? NoToneMapping;
    this.toneMappingExposure = parameters.toneMappingExposure ?? 1;
    // Advanced/testing hook: a prebuilt engine module (or promise of one)
    // replaces the bundled wasm loader. The browser path never sets this.
    this._engineOverride = parameters.engine ?? null;
    // autoUpdate/needsUpdate are accepted for API compatibility: the engine
    // re-renders the shadow map on every frame while it is enabled.
    this.shadowMap = { enabled: false, type: PCFShadowMap, autoUpdate: true, needsUpdate: true };
    this._captureTarget = -1;
    // Conservative stand-ins for the GL caps apps probe; the engine owns the
    // context, so these cannot be queried without a second getContext call.
    this.capabilities = { maxTextureSize: 8192, getMaxAnisotropy: () => 16 };
    this.setPixelRatio(parameters.pixelRatio ?? (typeof devicePixelRatio !== 'undefined' ? devicePixelRatio : 1));
    this._measure();
  }

  _measure() {
    const canvas = this.domElement;
    const rect = canvas.getBoundingClientRect ? canvas.getBoundingClientRect() : null;
    this._cssWidth = rect && rect.width > 0 ? rect.width : (canvas.clientWidth || canvas.width || 300);
    this._cssHeight = rect && rect.height > 0 ? rect.height : (canvas.clientHeight || canvas.height || 150);
  }

  setPixelRatio(value) {
    this._pixelRatio = Number.isFinite(value) && value > 0 ? value : 1;
    return this;
  }
  getPixelRatio() { return this._pixelRatio; }

  setSize(width, height, updateStyle = true) {
    this._cssWidth = width;
    this._cssHeight = height;
    const pw = Math.max(1, Math.round(width * this._pixelRatio));
    const ph = Math.max(1, Math.round(height * this._pixelRatio));
    this.domElement.width = pw;
    this.domElement.height = ph;
    if (updateStyle) {
      this.domElement.style.width = `${width}px`;
      this.domElement.style.height = `${height}px`;
    }
    if (this._engine) this._engine._g3_input_resize(pw, ph);
    return this;
  }
  getSize(target = new Vector2()) { target.set(this._cssWidth, this._cssHeight); return target; }

  setOutputColorSpace(space) { this.outputColorSpace = space; this._applyOutputSettings(); return this; }
  setToneMapping(mode) { this.toneMapping = mode; this._applyOutputSettings(); return this; }
  setClearColor(color, alpha = 1) {
    this._clearColor = color instanceof Color ? color : new Color(color);
    this._clearAlpha = alpha;
    return this;
  }

  // The engine clears the bound target at the start of every frame with the
  // clear colour, so clear() only needs to be API-compatible here.
  clear(_color = true, _depth = true, _stencil = true) { return this; }

  _ensureRenderTarget(rt) {
    const engine = this._engine;
    if (!engine) throw new Error('gs3d: call init() before using render targets');
    ensureEngineRenderTarget(engine, rt);
    return rt;
  }
  setRenderTarget(rt) {
    this._currentRenderTarget = rt || null;
    if (rt) this._ensureRenderTarget(rt);
    this._captureTarget = rt ? rt._rtId : -1;
    return this;
  }
  getRenderTarget() { return this._currentRenderTarget || null; }

  get extensions() {
    if (!this._extensions) {
      const renderer = this;
      this._extensions = {
        has(name) {
          if (name !== 'EXT_color_buffer_float' && name !== 'EXT_color_buffer_half_float' &&
              name !== 'EXT_color_buffer_half_float' && name !== 'OES_texture_float_linear' &&
              name !== 'OES_texture_half_float_linear') return false;
          return renderer._floatTargetsSupported();
        },
      };
    }
    return this._extensions;
  }
  _floatTargetsSupported() {
    if (this._floatSupport !== undefined) return this._floatSupport;
    // The engine owns the context; asking the canvas for the same context
    // type returns it without creating a second one.
    let gl = null;
    try { gl = this.domElement.getContext('webgl2') || this.domElement.getContext('experimental-webgl2'); } catch {}
    if (gl && typeof gl.getExtension === 'function') {
      this._floatSupport = !!(gl.getExtension('EXT_color_buffer_float') || gl.getExtension('EXT_color_buffer_half_float'));
    } else {
      // No reachable GL context (e.g. before init on a WebGPU build): assume
      // support and let render-target creation report the real failure.
      this._floatSupport = true;
    }
    return this._floatSupport;
  }

  _applyOutputSettings() {
    const engine = this._engine;
    if (!engine) return;
    const srgb = this.outputColorSpace === SRGBColorSpace ? 'srgb' : 'linear';
    try { engine._g3_asset_output_srgb(srgb === 'srgb' ? 1 : 0); } catch {}
    const mode = typeof this.toneMapping === 'number' ? (TONE_MODES[this.toneMapping] ?? 0) :
      ({ none: 0, reinhard: 1, aces: 2 }[this.toneMapping] ?? 0);
    try { engine._g3_asset_tone_mapping(mode); engine._g3_asset_exposure(this.toneMappingExposure ?? 1); } catch {}
  }

  async init() {
    if (this._engine) return this._engine;
    this._enginePromise = this._enginePromise || (async () => {
      const engine = this._engineOverride
        ? await this._engineOverride
        : await createGoose3D({ locateFile: () => wasmUrl.href });
      setSharedEngine(engine);
      const canvas = this.domElement;
      if (!canvas.id) canvas.id = `gs3d-${++engineCanvasSeq}`;
      if (typeof engine._g3_host_set_canvas === 'function') {
        const selector = `[id="${String(canvas.id).replace(/["\\]/g, '\\$&')}"]`;
        const bytes = new TextEncoder().encode(selector);
        const ptr = engine._malloc(bytes.length);
        engine.HEAPU8.set(bytes, ptr);
        engine._g3_host_set_canvas(ptr, bytes.length);
        engine._free(ptr);
      }
      if (!this._cssWidth || !this._cssHeight) this._measure();
      const pw = Math.max(1, Math.round(this._cssWidth * this._pixelRatio));
      const ph = Math.max(1, Math.round(this._cssHeight * this._pixelRatio));
      canvas.width = pw;
      canvas.height = ph;
      if (typeof engine._g3_host_start === 'function' && !engine._g3_host_start(pw, ph)) {
        throw new Error('gs3d: the engine could not start a WebGL2 context on this canvas');
      }
      this._lightLease = typeof engine._g3_asset_lights_begin === 'function' ? engine._g3_asset_lights_begin() : -1;
      this._applyOutputSettings();
      return engine;
    })();
    this._engine = await this._enginePromise;
    return this._engine;
  }

  render(scene, camera) {
    const engine = this._engine;
    if (!engine) throw new Error('gs3d: call init() before render()');
    const now = typeof performance !== 'undefined' ? performance.now() : Date.now();
    const dt = this._lastFrame ? Math.min((now - this._lastFrame) / 1000, 0.1) : 1 / 60;
    this._lastFrame = now;
    if (scene) {
      const collected = collectLights(scene);
      const seen = new Set<any>();
      setFrameMaterialCache(new Map());
      try {
        syncSceneTree(scene, seen);
      } finally {
        setFrameMaterialCache(null);
      }
      // Release engine nodes owned by objects outside this scene.
      for (const object of syncedObjects) {
        if (!seen.has(object)) {
          const record = nodeStates.get(object);
          if (record) releaseNodeRecord(record);
          nodeStates.delete(object);
          syncedObjects.delete(object);
        }
      }
      for (const object of seen) syncedObjects.add(object);
      this._applyOutputSettings();
      syncBackground(engine, scene, this);
      syncFog(engine, scene);
      syncEnvironment(engine, scene);
      syncLights(engine, collected, this);
      camera.updateMatrixWorld();
      syncCamera(engine, this, camera);
    }
    const rt = this._captureTarget;
    if (rt >= 0 && engine._g3_asset_render_target_select) engine._g3_asset_render_target_select(rt);
    try {
      engine._g3_app_frame(dt);
    } finally {
      if (rt >= 0 && engine._g3_asset_render_target_select) engine._g3_asset_render_target_select(-1);
    }
  }

  setAnimationLoop(callback) {
    this._animationLoop = callback;
    if (this._raf) { cancelFrame(this._raf); this._raf = 0; }
    if (callback) {
      const tick = time => {
        if (this._animationLoop !== callback) return;
        callback(time);
        this._raf = requestFrame(tick);
      };
      this._raf = requestFrame(tick);
    }
    return this;
  }

  dispose() {
    if (this._disposed) return;
    this._disposed = true;
    this.setAnimationLoop(null);
    const engine = this._engine;
    if (engine) {
      if (this._lightLease >= 0) { try { engine._g3_asset_lights_release(this._lightLease); } catch {} }
      try { engine._g3_app_shutdown(); } catch {}
    }
    this._engine = null;
    this._enginePromise = null;
  }
}



// three.js names the class WebGLRenderer; gs3d renders through WebGL2 behind
// the same API, so alias it for drop-in ports.
export const WebGLRenderer = WebGPURenderer;

/* --- environment capture --------------------------------------------------------
 * PMREMGenerator renders the scene into a cubemap and stitches it into the
 * equirectangular layout the engine's environment-map path expects. There is
 * no roughness-dependent prefiltering: the engine generates its own filtered
 * mips from the base equirect, which approximates PMREM for typical env scenes.
 * `sigma`/`near`/`far` follow three.js signatures; `options.size` sets the
 * equirect width (height = size/2), default 256. */

const ENV_FACES = [
  { f: [1, 0, 0], u: [0, 1, 0] },
  { f: [-1, 0, 0], u: [0, 1, 0] },
  { f: [0, 1, 0], u: [0, 0, -1] },
  { f: [0, -1, 0], u: [0, 0, 1] },
  { f: [0, 0, 1], u: [0, 1, 0] },
  { f: [0, 0, -1], u: [0, 1, 0] },
];

function envFaceBasis(face) {
  const f = face.f, up = face.u;
  // Camera looks down -Z toward f, so camera +Z (backward) is -f.
  const zx = -f[0], zy = -f[1], zz = -f[2];
  // xaxis = normalize(cross(up, zaxis))
  let xx = up[1] * zz - up[2] * zy, xy = up[2] * zx - up[0] * zz, xz = up[0] * zy - up[1] * zx;
  const xl = Math.hypot(xx, xy, xz) || 1;
  xx /= xl; xy /= xl; xz /= xl;
  // yaxis = cross(zaxis, xaxis)
  const yx = zy * xz - zz * xy, yy = zz * xx - zx * xz, yz = zx * xy - zy * xx;
  return { f, x: [xx, xy, xz], y: [yx, yy, yz] };
}

export class PMREMGenerator {
  renderer: any;
  _rt: number;
  constructor(renderer: any) { this.renderer = renderer; this._rt = -1; }

  fromEquirectangular(texture) {
    // Already equirectangular — pass through; the engine generates env mips.
    return { texture, dispose() {} };
  }

  fromScene(scene: any, sigma = 0, near = 0.1, far = 100, options: Record<string, any> = {}) {
    const renderer = this.renderer;
    const engine = renderer && renderer._engine;
    const size = options && options.size ? options.size : 256;
    const eqW = size, eqH = size >> 1;
    const face = Math.max(32, size >> 1);
    if (!engine || typeof engine._g3_asset_render_target_create !== 'function') {
      return { texture: new DataTexture(new Uint8Array(eqW * eqH * 4), eqW, eqH), dispose() {} };
    }
    const rt = engine._g3_asset_render_target_create(face, face);
    if (rt < 0) return { texture: new DataTexture(new Uint8Array(eqW * eqH * 4), eqW, eqH), dispose() {} };
    this._rt = rt;

    const bases = ENV_FACES.map(envFaceBasis);
    const faces = [];
    const prevTarget = renderer._captureTarget;
    try {
      for (const b of bases) {
        const cam = new PerspectiveCamera(90, 1, near, far);
        cam.position.set(0, 0, 0);
        cam.lookAt(new Vector3(b.f[0], b.f[1], b.f[2]));
        cam.updateMatrixWorld();
        renderer._captureTarget = rt;
        renderer.render(scene, cam);
        faces.push(readTargetPixels(engine, rt, face));
      }
    } finally {
      renderer._captureTarget = prevTarget;
    }

    const out = new Uint8Array(eqW * eqH * 4);
    // Trig tables keep the inner loop allocation-free: lambda per column,
    // phi per row, matching envTexelDir's equirect parameterization.
    const cosL = new Float64Array(eqW), sinL = new Float64Array(eqW);
    for (let i = 0; i < eqW; i++) {
      const l = ((i + 0.5) / eqW - 0.5) * 2 * Math.PI;
      cosL[i] = Math.cos(l); sinL[i] = Math.sin(l);
    }
    const sinP = new Float64Array(eqH), cosP = new Float64Array(eqH);
    for (let j = 0; j < eqH; j++) {
      const phi = (j + 0.5) / eqH * Math.PI;
      sinP[j] = Math.sin(phi); cosP[j] = Math.cos(phi);
    }
    for (let j = 0; j < eqH; j++) {
      const sp = sinP[j], cp = cosP[j];
      for (let i = 0; i < eqW; i++) {
        const dx = sp * cosL[i], dy = cp, dz = sp * sinL[i];
        // Nearest face; its forward dot is also the projection denominator.
        let k = 0, denom = -Infinity;
        for (let f = 0; f < 6; f++) {
          const dot = dx * bases[f].f[0] + dy * bases[f].f[1] + dz * bases[f].f[2];
          if (dot > denom) { denom = dot; k = f; }
        }
        const b = bases[k];
        const cx = (dx * b.x[0] + dy * b.x[1] + dz * b.x[2]) / denom;
        const cy = (dx * b.y[0] + dy * b.y[1] + dz * b.y[2]) / denom;
        const fx = Math.min(face - 1, Math.max(0, Math.floor((cx * 0.5 + 0.5) * face)));
        const fy = Math.min(face - 1, Math.max(0, Math.floor((0.5 - cy * 0.5) * face)));
        sampleFaceBilinear(faces[k], face, fx, fy, out, (j * eqW + i) * 4);
      }
    }
    const texture = new DataTexture(out, eqW, eqH);
    return { texture, dispose() { releaseTexture(texture); } };
  }

  dispose() {}
}

function readTargetPixels(engine, rt, size) {
  const bytes = size * size * 4;
  const ptr = engine._malloc(bytes);
  const buf = new Uint8Array(engine.HEAPU8.buffer, ptr, bytes);
  if (!engine._g3_host_render_target_read(rt, 0, 0, size, size, ptr, bytes)) {
    engine._free(ptr);
    throw new Error('gs3d: environment render target readback failed');
  }
  // Readback arrives bottom-up; flip to top-down for sampling.
  const out = new Uint8Array(bytes);
  for (let y = 0; y < size; y++) {
    out.set(buf.subarray((size - 1 - y) * size * 4, (size - y) * size * 4), y * size * 4);
  }
  engine._free(ptr);
  return out;
}

function sampleFaceBilinear(face, size, fx, fy, out, outOff) {
  const x0 = Math.max(0, fx - 0.5 | 0), y0 = Math.max(0, fy - 0.5 | 0);
  const x1 = Math.min(size - 1, x0 + 1), y1 = Math.min(size - 1, y0 + 1);
  const tx = Math.min(1, Math.max(0, fx - 0.5 - x0)), ty = Math.min(1, Math.max(0, fy - 0.5 - y0));
  const i00 = (y0 * size + x0) * 4, i10 = (y0 * size + x1) * 4;
  const i01 = (y1 * size + x0) * 4, i11 = (y1 * size + x1) * 4;
  for (let c = 0; c < 4; c++) {
    const top = face[i00 + c] * (1 - tx) + face[i10 + c] * tx;
    const bot = face[i01 + c] * (1 - tx) + face[i11 + c] * tx;
    out[outOff + c] = top * (1 - ty) + bot * ty;
  }
}

// Minimal stand-in for three's RoomEnvironment: a softbox-style env scene
// built from emissive planes, matching the look of the addon closely enough
// for image-based lighting.
export class RoomEnvironment extends Scene {
  isRoomEnvironment: boolean;
  constructor() {
    super();
    this.isRoomEnvironment = true;
    const box = (w, h, color, intensity, pos, look) => {
      const c = new Color(color);
      c.r *= intensity; c.g *= intensity; c.b *= intensity;
      const m = new Mesh(
        new PlaneGeometry(w, h),
        new MeshBasicMaterial({ color: c })
      );
      m.position.set(pos[0], pos[1], pos[2]);
      m.lookAt(new Vector3(look[0], look[1], look[2]));
      m.updateMatrixWorld();
      this.add(m);
    };
    // Ceiling light panel + a few wall/floor softboxes, roughly matching
    // three's RoomEnvironment layout.
    box(10, 10, 0xffffff, 5, [0, 4, 0], [0, 0, -1]);
    box(6, 3, 0xfff4e0, 3, [-4, 1, -3], [0, 1, 0]);
    box(4, 6, 0xe8f0ff, 2, [4, 0.5, -2], [0, 1, 0]);
    box(8, 4, 0xffffff, 1.5, [0, -3, 2], [0, 1, 0]);
    box(3, 3, 0xd0e8ff, 2, [-3, 2, 3], [0, 0, -1]);
    box(3, 3, 0xffe8d0, 1.5, [3, 2, 3], [0, 0, -1]);
    this.updateMatrixWorld();
  }
  dispose() {
    this.traverse(node => {
      node.geometry?.dispose?.();
      for (const material of Array.isArray(node.material) ? node.material : [node.material]) material?.dispose?.();
    });
  }
}
