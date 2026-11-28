import createGoose3D from './gs3d/app.js';
import { Color } from './color';
import { Vector2, Vector4 } from './math';
import { sharedEngine, setSharedEngine, nodeStates, syncedObjects, releaseNodeRecord, setFrameMaterialCache } from './bridge';
import { collectLights, syncSceneTree, syncBackground, syncFog, syncEnvironment, syncLights, syncCamera } from './sync';
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
  _outputColorSpace: string;
  _coordinateSystem?: number;
  get outputColorSpace() { return this._outputColorSpace; }
  set outputColorSpace(v) { this._outputColorSpace = v; }
  get coordinateSystem() { return this._coordinateSystem ?? 2000; }
  set coordinateSystem(v) { this._coordinateSystem = v; }
  toneMapping: number | string;
  toneMappingExposure: number;
  _engineOverride: any;
  shadowMap: { enabled: boolean; type: number; autoUpdate: boolean; needsUpdate: boolean };
  _captureTarget: number;
  capabilities: { maxTextureSize: number; getMaxAnisotropy: () => number };
  autoClear: boolean;
  info: { autoReset: boolean; reset(): void; render: { calls: number; triangles: number; frame: number }; memory: { geometries: number; textures: number } };
  debug: { checkShaderErrors: boolean; onShaderError: ((gl: any, program: any, vs: any, fs: any) => void) | null };
  properties: { get(obj: any): Record<string, any> };
  _viewport: Vector4;
  _scissor: Vector4;
  _scissorTest: boolean;
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
    this._outputColorSpace = parameters.outputColorSpace ?? SRGBColorSpace;
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
    this.autoClear = true;
    this.info = {
      autoReset: true,
      render: { calls: 0, triangles: 0, frame: 0 },
      memory: { geometries: 0, textures: 0 },
      reset() { this.render.calls = 0; this.render.triangles = 0; },
    };
    this.debug = { checkShaderErrors: true, onShaderError: null };
    const propMap = new WeakMap<any, Record<string, any>>();
    this.properties = {
      get(obj: any) {
        let p = propMap.get(obj);
        if (!p) { p = {}; propMap.set(obj, p); }
        return p;
      },
    };
    this._viewport = new Vector4(0, 0, this._cssWidth, this._cssHeight);
    this._scissor = new Vector4(0, 0, this._cssWidth, this._cssHeight);
    this._scissorTest = false;
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
  getContext() {
    try { return this.domElement.getContext('webgl2') || this.domElement.getContext('experimental-webgl2') || null; }
    catch { return null; }
  }
  setViewport(x: number, y: number, width: number, height: number) {
    this._viewport.set(x, y, width, height);
    return this;
  }
  setScissor(x: number, y: number, width: number, height: number) {
    this._scissor.set(x, y, width, height);
    return this;
  }
  setScissorTest(enable: boolean) {
    this._scissorTest = !!enable;
    return this;
  }
  compile(_scene: any, _camera?: any) { return new Set(); }
  async compileAsync(_scene: any, _camera?: any) { return new Set(); }

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
      const collected = collectLights(scene, camera);
      const seen = new Set<any>();
      setFrameMaterialCache(new Map());
      try {
        syncSceneTree(scene, seen, camera);
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

