import { Color } from './color';
import { Vector2 } from './math';
import { sharedEngine, releaseTexture } from './bridge';
import { SRGBColorSpace, NoColorSpace } from './renderer';

/* --- textures ------------------------------------------------------------------ */

export const UnsignedByteType = 1009;
export const RGBFormat = 1022;
export const RGBAFormat = 1023;
export const DepthFormat = 1026;
export const DepthStencilFormat = 1027;
export const RedFormat = 1028;
export const RGFormat = 1030;
export const RGBIntegerFormat = 1033;
export const RGBAIntegerFormat = 1036;
export const FloatType = 1015;
export const HalfFloatType = 1016;

export const NoBlending = 0;
export const NormalBlending = 1;
export const AdditiveBlending = 2;
export const SubtractiveBlending = 3;
export const MultiplyBlending = 4;
export const GLSL1 = '100';
export const GLSL3 = '300';

export const CustomBlending = 5;

export const ZeroFactor = 0;
export const OneFactor = 1;
export const SrcColorFactor = 2;
export const OneMinusSrcColorFactor = 3;
export const SrcAlphaFactor = 4;
export const OneMinusSrcAlphaFactor = 5;
export const DstAlphaFactor = 6;
export const OneMinusDstAlphaFactor = 7;
export const DstColorFactor = 8;
export const OneMinusDstColorFactor = 9;
export const SrcAlphaSaturateFactor = 10;

export const AddEquation = 100;
export const SubtractEquation = 101;
export const ReverseSubtractEquation = 102;
export const MinEquation = 103;
export const MaxEquation = 104;

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

export class Texture {
  isTexture: boolean;
  image: any;
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
  needsUpdate: boolean;
  flipY?: boolean;
  isRenderTargetTexture?: boolean;
  _renderTarget?: any;
  constructor(image: any = null) {
    this.isTexture = true;
    this.image = image;
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
    this.needsUpdate = false;
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
  images: any[];
  constructor() { super(null); this.isCubeTexture = true; this.images = []; }
}

// Render targets map onto the engine's explicit render-target textures. The
// engine id is created lazily on first use (the wasm module may not be
// loaded yet at construction time); rt.texture carries the binding.
const RT_FORMAT = { [UnsignedByteType]: 0, [HalfFloatType]: 1, [FloatType]: 2 };

export class WebGLRenderTarget {
  isRenderTarget: boolean;
  width: number;
  height: number;
  depthBuffer: boolean;
  stencilBuffer: boolean;
  count: number;
  texture: Texture;
  _rtId: number;
  _rtWidth: number;
  _rtHeight: number;
  _rtGeneration: number;
  constructor(width = 1, height = 1, options: Record<string, any> = {}) {
    this.isRenderTarget = true;
    this.width = Math.max(1, width | 0);
    this.height = Math.max(1, height | 0);
    this.depthBuffer = options.depthBuffer !== false;
    this.stencilBuffer = !!options.stencilBuffer;
    // Multiple render targets are not reachable through the engine ABI.
    this.count = options.count || 1;
    this.texture = new Texture(null);
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
  setSize(width, height) {
    this.width = Math.max(1, width | 0);
    this.height = Math.max(1, height | 0);
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
  constructor() { this.manager = null; }
  load(url: string, onLoad?: (t: Texture) => void, _onProgress?: any, onError?: (e: any) => void) {
    fetch(url)
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
        return texture;
      })
      .catch(error => onError ? onError(error) : console.error(error));
    return this;
  }
}

export class ImageLoader {
  manager: any;
  constructor() { this.manager = null; }
  load(url: string, onLoad?: (img: HTMLImageElement) => void, onProgress?: any, onError?: (e: any) => void) {
    const image = new Image();
    image.onload = () => onLoad && onLoad(image);
    image.onerror = event => onError && onError(event);
    if (onProgress) image.onprogress = onProgress;
    image.src = url;
    return image;
  }
}

