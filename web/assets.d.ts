/** Browser-side image and glTF/GLB helpers for a Goose 3D Emscripten module. */

export type TextureColorSpace = 'linear' | 'srgb';
export type ToneMappingMode = 'none' | 'reinhard' | 'aces';
export type AssetErrorCode =
  | 'FETCH' | 'IMAGE' | 'HDR' | 'ENVIRONMENT' | 'EXPOSURE' | 'COLOR_SPACE'
  | 'TONE_MAPPING' | 'INVALID_GLTF' | 'UNSUPPORTED' | 'MEMORY' | 'UPLOAD';

/** The memory and allocator surface shared by the generated WebAssembly module. */
export interface Goose3DEngine {
  HEAPU8: Uint8Array;
  HEAPF32: Float32Array;
  _malloc(size: number): number;
  _free(pointer: number): void;
}

export interface ResourceHandle {
  readonly id: number;
  readonly generation: number;
}

export interface NodeHandle {
  readonly index: number;
  readonly generation: number;
  readonly epoch: number;
}

export interface LoadedTexture {
  readonly id: number;
  readonly handle: ResourceHandle;
  readonly width: number;
  readonly height: number;
  /** Release the engine texture. Repeated calls are safe. */
  dispose(): void;
}

export interface LoadImageOptions {
  /** Colour textures should use sRGB; data textures should remain linear. */
  colorSpace?: TextureColorSpace;
}

export interface AnimationInfo {
  readonly index: number;
  readonly name: string;
  readonly duration: number;
}

export interface LoadedModel {
  readonly roots: readonly NodeHandle[];
  readonly animations: readonly AnimationInfo[];
  readonly meshes: readonly ResourceHandle[];
  readonly materials: readonly ResourceHandle[];
  readonly textures: readonly ResourceHandle[];
  readonly activeAnimation: number;
  readonly animationTime: number;
  /** Start an animation by index. Returns false for an invalid or disposed model. */
  playAnimation(index?: number, options?: { loop?: boolean }): boolean;
  pauseAnimation(): boolean;
  resumeAnimation(): boolean;
  stopAnimation(): boolean;
  seekAnimation(seconds: number): boolean;
  /** Advance an active animation by seconds. Call once from the app frame loop. */
  update(deltaSeconds: number): boolean;
  /** Pick a node only when it belongs to this model. */
  pick(canvas: HTMLCanvasElement, clientX: number, clientY: number): NodeHandle | null;
  /** Release all model-owned nodes, meshes, materials, and textures. Idempotent. */
  dispose(): void;
}

export class AssetError extends Error {
  constructor(code: AssetErrorCode, message: string, cause?: unknown);
  readonly code: AssetErrorCode;
}

/** Load and upload a raster image. The caller owns and must dispose the result. */
export function loadImage(
  engine: Goose3DEngine,
  url: string | URL,
  options?: LoadImageOptions,
): Promise<LoadedTexture>;

/** Load a Radiance RGBE .hdr environment image as a linear texture. */
export function loadHDRImage(
  engine: Goose3DEngine,
  url: string | URL,
): Promise<LoadedTexture>;

/** Use a texture as the scene environment, or pass null to clear it. */
export function setEnvironmentMap(
  engine: Goose3DEngine,
  texture: number | ResourceHandle | LoadedTexture | null,
  intensity?: number,
): void;

export function isMeshHandleValid(engine: Goose3DEngine, handle: ResourceHandle | null | undefined): boolean;
export function isTextureHandleValid(engine: Goose3DEngine, handle: ResourceHandle | null | undefined): boolean;
export function isMaterialHandleValid(engine: Goose3DEngine, handle: ResourceHandle | null | undefined): boolean;
export function isNodeHandleValid(engine: Goose3DEngine, handle: NodeHandle | null | undefined): boolean;

/** Pick the frontmost visible node at CSS client coordinates, or return null. */
export function pickNode(
  engine: Goose3DEngine,
  canvas: HTMLCanvasElement,
  clientX: number,
  clientY: number,
): NodeHandle | null;

export function setOutputColorSpace(engine: Goose3DEngine, space: TextureColorSpace): void;
/** Booleans are retained for compatibility: true selects ACES, false disables mapping. */
export function setToneMapping(engine: Goose3DEngine, mode: ToneMappingMode | boolean): void;
export function setExposure(engine: Goose3DEngine, exposure: number): void;

/** Load a glTF 2.0 JSON or GLB model. The caller owns and must dispose the result. */
export function loadGLTF(
  engine: Goose3DEngine,
  url: string | URL,
): Promise<LoadedModel>;
