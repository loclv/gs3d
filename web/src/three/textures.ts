import { Color } from './color';
import { Vector2, Vector4 } from './math';
import { sharedEngine, releaseTexture } from './bridge';
import { EventDispatcher } from './events';
import { SRGBColorSpace, NoColorSpace } from './renderer';

/* --- textures ------------------------------------------------------------------ */

// Type constants use three.js's own numbering (they are NOT raw GL enums).
export const UnsignedByteType = 1009;
export const ByteType = 1010;
export const ShortType = 1011;
export const UnsignedShortType = 1012;
export const IntType = 1013;
export const UnsignedIntType = 1014;
export const FloatType = 1015;
export const HalfFloatType = 1016;
export const UnsignedShort4444Type = 1017;
export const UnsignedShort5551Type = 1018;
export const UnsignedInt248Type = 1020;
export const UnsignedInt5999Type = 35902;
export const UnsignedInt101111Type = 35899;

export const AlphaFormat = 1021;
export const RGBFormat = 1022;
export const RGBAFormat = 1023;
export const RedFormat = 1028;
export const RedIntegerFormat = 1029;
export const RGFormat = 1030;
export const RGIntegerFormat = 1031;
export const RGBIntegerFormat = 1032;
export const RGBAIntegerFormat = 1033;
export const DepthFormat = 1026;
export const DepthStencilFormat = 1027;

export const NoBlending = 0;
export const NormalBlending = 1;
export const AdditiveBlending = 2;
export const SubtractiveBlending = 3;
export const MultiplyBlending = 4;
export const GLSL1 = '100';
export const GLSL3 = '300 es';

export const CustomBlending = 5;

// Blend factors use three.js numbering (200+), matching upstream exactly.
export const ZeroFactor = 200;
export const OneFactor = 201;
export const SrcColorFactor = 202;
export const OneMinusSrcColorFactor = 203;
export const SrcAlphaFactor = 204;
export const OneMinusSrcAlphaFactor = 205;
export const DstAlphaFactor = 206;
export const OneMinusDstAlphaFactor = 207;
export const DstColorFactor = 208;
export const OneMinusDstColorFactor = 209;
export const SrcAlphaSaturateFactor = 210;

export const AddEquation = 100;
export const SubtractEquation = 101;
export const ReverseSubtractEquation = 102;
export const MinEquation = 103;
export const MaxEquation = 104;

// Stencil and depth-function constants (values match WebGL/three).
export const ZeroStencilOp = 0;
export const KeepStencilOp = 7680;
export const ReplaceStencilOp = 7681;
export const IncrementStencilOp = 7682;
export const DecrementStencilOp = 7683;
export const IncrementWrapStencilOp = 34055;
export const DecrementWrapStencilOp = 34056;
export const InvertStencilOp = 5386;

export const NeverStencilFunc = 512;
export const LessStencilFunc = 513;
export const EqualStencilFunc = 514;
export const LessEqualStencilFunc = 515;
export const GreaterStencilFunc = 516;
export const NotEqualStencilFunc = 517;
export const GreaterEqualStencilFunc = 518;
export const AlwaysStencilFunc = 519;

export const NeverDepth = 0;
export const AlwaysDepth = 1;
export const LessDepth = 2;
export const LessEqualDepth = 3;
export const EqualDepth = 4;
export const GreaterEqualDepth = 5;
export const GreaterDepth = 6;
export const NotEqualDepth = 7;

// Buffer usage hints (GL enum values, same as three).
export const StaticDrawUsage = 35044;
export const DynamicDrawUsage = 35048;
export const StreamDrawUsage = 35040;
export const StaticReadUsage = 35045;
export const DynamicReadUsage = 35049;
export const StreamReadUsage = 35041;
export const StaticCopyUsage = 35046;
export const DynamicCopyUsage = 35050;
export const StreamCopyUsage = 35042;

export const RepeatWrapping = 1000;
export const ClampToEdgeWrapping = 1001;
export const MirroredRepeatWrapping = 1002;

export const NearestFilter = 1003;
export const LinearFilter = 1006;
export const NearestMipmapNearestFilter = 1004;
export const NearestMipmapLinearFilter = 1005;
export const LinearMipmapNearestFilter = 1007;
export const LinearMipmapLinearFilter = 1008;

export const WRAP_TO_ENGINE = { [ClampToEdgeWrapping]: 0, [RepeatWrapping]: 1, [MirroredRepeatWrapping]: 2 };
export const FILTER_TO_GL = { [NearestFilter]: 9728, [LinearFilter]: 9729,
  [NearestMipmapNearestFilter]: 9984, [NearestMipmapLinearFilter]: 9985,
  [LinearMipmapNearestFilter]: 9986, [LinearMipmapLinearFilter]: 9987 };

// Normalizes the accepted image sources to {width, height, pixels} where
// pixels is RGBA8. Returns null while the image is not ready.
export function textureImageData(image) {
  if (!image) return null;
  if (image.pixels && image.width && image.height) return image;
  if (image.data && image.width && image.height) {
    return { width: image.width, height: image.height, pixels: image.data };
  }
  if (typeof document !== 'undefined' &&
      (image instanceof HTMLCanvasElement || image instanceof HTMLImageElement ||
       (typeof ImageBitmap !== 'undefined' && image instanceof ImageBitmap))) {
    const canvas = document.createElement('canvas');
    canvas.width = image.width || (image as any).videoWidth || (image as any).naturalWidth;
    canvas.height = image.height || (image as any).videoHeight || (image as any).naturalHeight;
    const ctx = canvas.getContext('2d');
    if (!ctx) return null;
    ctx.drawImage(image, 0, 0);
    return { width: canvas.width, height: canvas.height, pixels: ctx.getImageData(0, 0, canvas.width, canvas.height).data };
  }
  if (image instanceof ImageData) {
    return { width: image.width, height: image.height, pixels: image.data };
  }
  return null;
}

export class Texture extends EventDispatcher {
  isTexture: boolean;
  updateRanges: Array<{ start: number; count: number }>;
  matrix: any;
  _image: any;
  _depth: number;
  _needsPMREMUpdate: boolean;
  get image() { return this._image; }
  set image(v) { this._image = v; }
  get depth() { return this._depth; }
  set depth(v) { this._depth = v; }
  get needsPMREMUpdate() { return this._needsPMREMUpdate; }
  set needsPMREMUpdate(v) { this._needsPMREMUpdate = v; }
  colorSpace: string;
  wrapS: number;
  wrapT: number;
  magFilter: number;
  minFilter: number;
  offset: Vector2;
  repeat: Vector2;
  rotation: number;
  center: Vector2;
  channel: number;
  type: number;
  matrixAutoUpdate: boolean;
  generateMipmaps: boolean;
  version: number;
  flipY?: boolean;
  isRenderTargetTexture?: boolean;
  _renderTarget?: any;
  constructor(image: any = null) {
    super();
    this.isTexture = true;
    this._image = image;
    this.colorSpace = NoColorSpace;
    this.wrapS = RepeatWrapping;
    this.wrapT = RepeatWrapping;
    this.magFilter = LinearFilter;
    this.minFilter = LinearMipmapLinearFilter;
    this.offset = new Vector2();
    this.repeat = new Vector2(1, 1);
    this.rotation = 0;
    this.center = new Vector2(0.5, 0.5);
    this.channel = 0;
    this.type = UnsignedByteType;
    this.matrixAutoUpdate = true;
    this.generateMipmaps = true;
    this.version = 0;
    this._depth = 1;
    this.updateRanges = [];
    this._needsPMREMUpdate = false;
    this.matrix = null;
  }
  get width() { const i = this.image; return i ? (i.width ?? i.naturalWidth ?? i.videoWidth ?? 0) : 0; }
  get height() { const i = this.image; return i ? (i.height ?? i.naturalHeight ?? i.videoHeight ?? 0) : 0; }
  // three r180: needsUpdate is a prototype setter that bumps version.
  set needsUpdate(v: boolean) { if (v) this.version++; }
  get needsUpdate() { return false; }
  addUpdateRange(start: number, count: number) { this.updateRanges.push({ start, count }); }
  clearUpdateRanges() { this.updateRanges.length = 0; }
  transformUv(uv: any) { return uv; }
  setValues(values: any) {
    for (const [k, v] of Object.entries(values)) {
      if (k === 'offset' || k === 'repeat' || k === 'center') (this as any)[k].set((v as any).x ?? (v as any)[0], (v as any).y ?? (v as any)[1]);
      else (this as any)[k] = v;
    }
    return this;
  }
  copy(source: Texture) {
    this._image = source.image;
    this.colorSpace = source.colorSpace;
    this.wrapS = source.wrapS; this.wrapT = source.wrapT;
    this.magFilter = source.magFilter; this.minFilter = source.minFilter;
    this.offset.copy(source.offset); this.repeat.copy(source.repeat);
    this.rotation = source.rotation; this.center.copy(source.center);
    this.channel = source.channel; this.type = source.type;
    this.flipY = source.flipY;
    this.generateMipmaps = source.generateMipmaps;
    this.matrixAutoUpdate = source.matrixAutoUpdate;
    return this;
  }
  clone() { return new (this as any).constructor(this.image).copy(this); }
  toJSON(meta: any = {}) {
    const image = this.image;
    return {
      metadata: { version: 4.7, type: 'Texture', generator: 'gs3d' },
      uuid: (this as any).uuid,
      type: (this as any).isTexture ? 'Texture' : 'Texture',
      name: (this as any).name || '',
      image: image && image.src ? image.src : undefined,
      mapping: 300, wrapS: this.wrapS, wrapT: this.wrapT,
      magFilter: this.magFilter, minFilter: this.minFilter,
      anisotropy: (this as any).anisotropy ?? 1,
      colorSpace: this.colorSpace,
      offset: [this.offset.x, this.offset.y], repeat: [this.repeat.x, this.repeat.y],
      center: [this.center.x, this.center.y], rotation: this.rotation,
      channel: this.channel,
    };
  }
  updateMatrix() { return this; }
  dispose() {
    this.version++;
    releaseTexture(this);
  }
}

export class DataTexture extends Texture {
  isDataTexture: boolean;
  flipY: boolean;
  unpackAlignment: number;
  constructor(data: any = null, width = 1, height = 1) {
    super(data ? { data, width, height } : null);
    this.isDataTexture = true;
    this.flipY = false;
    this.unpackAlignment = 4;
  }
}

export function checkerTexture(a = 0xd0d0d0, b = 0x303030, cells = 8, size = 512) {
  const ca = new Color(a), cb = new Color(b);
  const ar = Math.round(ca.r * 255), ag = Math.round(ca.g * 255), ab = Math.round(ca.b * 255);
  const br = Math.round(cb.r * 255), bg = Math.round(cb.g * 255), bb = Math.round(cb.b * 255);
  const data = new Uint8Array(size * size * 4);
  const step = Math.max(1, size / cells);
  for (let y = 0; y < size; y++) {
    const cy = Math.floor(y / step);
    for (let x = 0; x < size; x++) {
      const cx = Math.floor(x / step);
      const useA = ((cx + cy) & 1) === 0;
      const o = (y * size + x) * 4;
      data[o] = useA ? ar : br;
      data[o + 1] = useA ? ag : bg;
      data[o + 2] = useA ? ab : bb;
      data[o + 3] = 255;
    }
  }
  const tex = new DataTexture(data, size, size);
  tex.wrapS = RepeatWrapping;
  tex.wrapT = RepeatWrapping;
  tex.colorSpace = SRGBColorSpace;
  tex.needsUpdate = true;
  return tex;
}

// RGBA8 3D texture for custom material shaders (material.lutTexture, sampled
// as u_lut). Only Uint8Array/Uint8ClampedArray data uploads; the engine
// fixes linear filtering and clamp-to-edge wrapping.
export class Data3DTexture extends Texture {
  isData3DTexture: boolean;
  flipY: boolean;
  unpackAlignment: number;
  constructor(data: any = null, width = 1, height = 1, depth = 1) {
    super(data ? { data, width, height, depth } : null);
    this.isData3DTexture = true;
    this.flipY = false;
    this.unpackAlignment = 4;
  }
}

export class CanvasTexture extends Texture {
  isCanvasTexture: boolean;
  constructor(canvas = document.createElement('canvas')) {
    super(canvas);
    this.isCanvasTexture = true;
  }
}

export class CompressedTexture extends Texture {
  isCompressedTexture: boolean;
  constructor() { super(null); this.isCompressedTexture = true; }
}
export class CubeTexture extends Texture {
  isCubeTexture: boolean;
  _images: any[];
  get images() { return this._images; }
  set images(v) { this._images = v; }
  constructor(images: any[] = []) { super(images); this.isCubeTexture = true; this._images = images; }
}

export class VideoTexture extends Texture {
  isVideoTexture: boolean;
  constructor(video: any = null) {
    super(video);
    this.isVideoTexture = true;
  }
  update() { this.needsUpdate = true; return this; }
}

// Render targets map onto the engine's explicit render-target textures. The
// engine id is created lazily on first use (the wasm module may not be
// loaded yet at construction time); rt.texture carries the binding.
const RT_FORMAT = { [UnsignedByteType]: 0, [HalfFloatType]: 1, [FloatType]: 2 };

export class WebGLRenderTarget extends EventDispatcher {
  isRenderTarget: boolean;
  _depthTexture: any = null;
  get depthTexture() { return this._depthTexture; }
  set depthTexture(v) { this._depthTexture = v; }
  width: number;
  height: number;
  depthBuffer: boolean;
  stencilBuffer: boolean;
  count: number;
  _texture: Texture;
  get texture() { return this._texture; }
  set texture(v) { this._texture = v; }
  textures: Texture[];
  viewport: Vector4;
  scissor: Vector4;
  scissorTest: boolean;
  _rtId: number;
  _rtWidth: number;
  _rtHeight: number;
  _rtGeneration: number;
  constructor(width = 1, height = 1, options: Record<string, any> = {}) {
    super();
    this.isRenderTarget = true;
    this.width = Math.max(1, width | 0);
    this.height = Math.max(1, height | 0);
    this.depthBuffer = options.depthBuffer !== false;
    this.stencilBuffer = !!options.stencilBuffer;
    // Multiple render targets are not reachable through the engine ABI.
    this.count = options.count || 1;
    this._texture = new Texture(null);
    this.textures = [this._texture];
    this.viewport = new Vector4(0, 0, this.width, this.height);
    this.scissor = new Vector4(0, 0, this.width, this.height);
    this.scissorTest = false;
    this.texture.isRenderTargetTexture = true;
    this.texture._renderTarget = this;
    this.texture.generateMipmaps = false;
    this.texture.flipY = false;
    this.texture.minFilter = options.minFilter ?? LinearFilter;
    this.texture.magFilter = options.magFilter ?? LinearFilter;
    this.texture.wrapS = options.wrapS ?? options.wrap ?? ClampToEdgeWrapping;
    this.texture.wrapT = options.wrapT ?? options.wrap ?? ClampToEdgeWrapping;
    this.texture.type = options.type ?? UnsignedByteType;
    this._rtId = -1;
    this._rtWidth = 0;
    this._rtHeight = 0;
    this._rtGeneration = -1;
  }
  copy(source: WebGLRenderTarget) {
    this.width = source.width; this.height = source.height;
    this.depthBuffer = source.depthBuffer; this.stencilBuffer = source.stencilBuffer;
    return this;
  }
  clone() { return new WebGLRenderTarget(this.width, this.height).copy(this); }
  setSize(width, height) {
    this.width = Math.max(1, width | 0);
    this.height = Math.max(1, height | 0);
    this.viewport.set(0, 0, this.width, this.height);
    return this;
  }
  dispose() {
    const engine = sharedEngine;
    if (engine && this._rtId >= 0 && typeof engine._g3_asset_render_target_release === 'function') {
      try { engine._g3_asset_render_target_release(this._rtId); } catch {}
    }
    this._rtId = -1; this._rtWidth = 0; this._rtHeight = 0;
  }
}

export function ensureEngineRenderTarget(engine, rt) {
  if (!rt || !rt.isRenderTarget) return -1;
  if (rt.count !== 1) throw new Error('gs3d: multiple render targets are not supported');
  if (rt._rtId >= 0 && rt._rtWidth === rt.width && rt._rtHeight === rt.height) return rt._rtId;
  if (typeof engine._g3_asset_render_target_create !== 'function')
    throw new Error('gs3d: this engine build has no render-target support');
  const format = RT_FORMAT[rt.texture.type] ?? 0;
  const id = engine._g3_asset_render_target_create(rt.width, rt.height, format);
  if (id < 0) throw new Error('gs3d: render target creation failed (float targets need EXT_color_buffer_float)');
  if (rt._rtId >= 0 && typeof engine._g3_asset_render_target_release === 'function') {
    try { engine._g3_asset_render_target_release(rt._rtId); } catch {}
  }
  rt._rtId = id; rt._rtWidth = rt.width; rt._rtHeight = rt.height;
  rt._rtGeneration = typeof engine._g3_asset_texture_generation === 'function'
    ? engine._g3_asset_texture_generation(id) : 0;
  const wrapU = WRAP_TO_ENGINE[rt.texture.wrapS] ?? 1;
  const wrapV = WRAP_TO_ENGINE[rt.texture.wrapT] ?? 1;
  engine._g3_host_texture_wrap(id, wrapU, wrapV);
  const minFilter = FILTER_TO_GL[rt.texture.minFilter] ?? 9729;
  const magFilter = FILTER_TO_GL[rt.texture.magFilter] ?? 9729;
  engine._g3_host_texture_filter(id, minFilter, magFilter);
  return id;
}

export class TextureLoader {
  manager: any;
  crossOrigin = 'anonymous';
  constructor(manager: any = null) { this.manager = manager; }
  load(url: string, onLoad?: (t: Texture) => void, _onProgress?: any, onError?: (e: any) => void) {
    const resolved = this.manager ? this.manager.resolveURL(url) : url;
    this.manager && this.manager.itemStart(resolved);
    fetch(resolved)
      .then(response => {
        if (!response.ok) throw new Error(`gs3d: failed to fetch texture ${url} (${response.status})`);
        return response.blob();
      })
      .then(blob => createImageBitmap(blob))
      .then(bitmap => {
        const image = textureImageData(bitmap);
        bitmap.close();
        const texture = new Texture(image);
        texture.needsUpdate = true;
        texture.version++;
        if (onLoad) onLoad(texture);
        this.manager && this.manager.itemEnd(resolved);
        return texture;
      })
      .catch(error => {
        this.manager && this.manager.itemError(resolved);
        this.manager && this.manager.itemEnd(resolved);
        if (onError) onError(error); else console.error(error);
      });
    return this;
  }

  // three.Loader parity stubs/fields.
  path = '';
  resourcePath = '';
  requestHeader: Record<string, string> = {};
  withCredentials = false;
  setPath(value: string) { this.path = value; return this; }
  setResourcePath(value: string) { this.resourcePath = value; return this; }
  setRequestHeader(key: string, value: string) { this.requestHeader[key] = value; return this; }
  setWithCredentials(value: boolean) { this.withCredentials = value; return this; }
  setCrossOrigin(value: string) { this.crossOrigin = value; return this; }
  abort() { return this; }
  parse(data: any) { return data; }
  loadAsync(url: string, onProgress?: any) {
    return new Promise<Texture>((resolve, reject) => {
      this.load(url, resolve, onProgress, reject);
    });
  }
}

// Loads images via createImageBitmap (faster path, no DOM Image element).
export class ImageBitmapLoader {
  manager: any;
  crossOrigin = 'anonymous';
  constructor(manager: any = null) { this.manager = manager; }
  load(url: string, onLoad?: (bmp: ImageBitmap) => void, onProgress?: any, onError?: (e: any) => void) {
    const resolved = this.manager ? this.manager.resolveURL(this.path + url) : this.path + url;
    this.manager && this.manager.itemStart(resolved);
    fetch(resolved)
      .then(response => {
        if (!response.ok) throw new Error(`gs3d: failed to fetch image ${url} (${response.status})`);
        return response.blob();
      })
      .then(blob => createImageBitmap(blob))
      .then(bitmap => {
        if (onLoad) onLoad(bitmap);
        this.manager && this.manager.itemEnd(resolved);
      })
      .catch(error => {
        this.manager && this.manager.itemError(resolved);
        this.manager && this.manager.itemEnd(resolved);
        if (onError) onError(error);
      });
    return this;
  }
  // three.Loader parity fields/methods.
  path = '';
  resourcePath = '';
  requestHeader: Record<string, string> = {};
  withCredentials = false;
  setPath(value: string) { this.path = value; return this; }
  setResourcePath(value: string) { this.resourcePath = value; return this; }
  setRequestHeader(key: string, value: string) { this.requestHeader[key] = value; return this; }
  setWithCredentials(value: boolean) { this.withCredentials = value; return this; }
  setCrossOrigin(value: string) { this.crossOrigin = value; return this; }
  setOptions(options: any) { Object.assign(this, options); return this; }
  abort() { return this; }
  parse(data: any) { return data; }
  loadAsync(url: string, onProgress?: any) {
    return new Promise<ImageBitmap>((resolve, reject) => {
      this.load(url, resolve, onProgress, reject);
    });
  }
}

export class ImageLoader {
  manager: any;
  crossOrigin = 'anonymous';
  constructor(manager: any = null) { this.manager = manager; }
  load(url: string, onLoad?: (img: HTMLImageElement) => void, onProgress?: any, onError?: (e: any) => void) {
    const resolved = this.manager ? this.manager.resolveURL(this.path + url) : this.path + url;
    this.manager && this.manager.itemStart(resolved);
    const image = new Image();
    image.onload = () => { if (onLoad) onLoad(image); this.manager && this.manager.itemEnd(resolved); };
    image.onerror = event => {
      this.manager && this.manager.itemError(resolved);
      this.manager && this.manager.itemEnd(resolved);
      if (onError) onError(event);
    };
    if (onProgress) image.onprogress = onProgress;
    image.src = resolved;
    return image;
  }
  // three.Loader parity fields/methods.
  path = '';
  resourcePath = '';
  requestHeader: Record<string, string> = {};
  withCredentials = false;
  setPath(value: string) { this.path = value; return this; }
  setResourcePath(value: string) { this.resourcePath = value; return this; }
  setRequestHeader(key: string, value: string) { this.requestHeader[key] = value; return this; }
  setWithCredentials(value: boolean) { this.withCredentials = value; return this; }
  setCrossOrigin(value: string) { this.crossOrigin = value; return this; }
  abort() { return this; }
  parse(data: any) { return data; }
  loadAsync(url: string, onProgress?: any) {
    return new Promise<HTMLImageElement>((resolve, reject) => {
      this.load(url, resolve, onProgress, reject);
    });
  }
}

