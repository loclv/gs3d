/** Browser-side image and glTF/GLB helpers for a Goose 3D Emscripten module. */

export type TextureColorSpace = 'linear' | 'srgb';
export type ToneMappingMode = 'none' | 'reinhard' | 'aces';
export type AssetErrorCode =
  | 'FETCH' | 'IMAGE' | 'HDR' | 'ENVIRONMENT' | 'EXPOSURE' | 'COLOR_SPACE'
  | 'TONE_MAPPING' | 'POST_PROCESS' | 'INVALID_GLTF' | 'UNSUPPORTED' | 'MEMORY' | 'UPLOAD';

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

export interface MaterialInspection {
  readonly index: number;
  readonly name: string | null;
  readonly baseColorFactor: readonly [number, number, number, number];
  readonly metallicFactor: number;
  readonly roughnessFactor: number;
  readonly alphaMode: 'OPAQUE' | 'MASK' | 'BLEND';
  readonly alphaCutoff: number;
  readonly emissiveFactor: readonly [number, number, number];
  readonly doubleSided: boolean;
  readonly unlit: boolean;
  readonly ior: number;
  readonly specularFactor: number;
  readonly specularColorFactor: readonly [number, number, number];
  readonly clearcoatFactor: number;
  readonly clearcoatRoughnessFactor: number;
  readonly clearcoatNormalScale: number;
  readonly textureSlots: readonly string[];
  readonly textureBindings: readonly { readonly slot: string; readonly index: number }[];
}

export interface TexturePreview {
  /** Preview dimensions, limited by the requested maximum dimension. */
  readonly width: number;
  readonly height: number;
  readonly sourceWidth: number;
  readonly sourceHeight: number;
  /** Copy of the decoded RGBA pixels; mutating it cannot change the loaded model. */
  readonly pixels: Uint8ClampedArray;
}

export interface PrimitiveMaterialInspection {
  readonly default: MaterialInspection;
  readonly variants: readonly { readonly index: number; readonly name: string; readonly material: MaterialInspection }[];
}

/** Read-only glTF node metadata for a node in the selected scene. */
export interface ModelNodeInfo {
  /** Original node index in the glTF document. */
  readonly index: number;
  readonly name: string | null;
  /** Parent glTF node index, or null for a scene root. */
  readonly parent: number | null;
  readonly children: readonly number[];
  /** Referenced glTF mesh and skin indices, or null when absent. */
  readonly mesh: number | null;
  readonly skin: number | null;
  /** Checked engine node handle for the glTF node's transform group. */
  readonly handle: NodeHandle;
  /** Checked handles for the engine nodes created from this glTF mesh's primitives. */
  readonly primitives: readonly NodeHandle[];
  /** Material factors and variant choices for each primitive, in primitive order. */
  readonly primitiveMaterials: readonly PrimitiveMaterialInspection[];
}

export interface LoadedModel {
  /** Index of the glTF scene loaded into this model. */
  readonly sceneIndex: number;
  readonly roots: readonly NodeHandle[];
  /** glTF node hierarchy and references for the selected scene, in depth-first order. */
  readonly nodes: readonly ModelNodeInfo[];
  readonly animations: readonly AnimationInfo[];
  /** Material variant names declared by KHR_materials_variants. */
  readonly variants: readonly string[];
  /** Index of the selected material variant, or -1 for the glTF default materials. */
  readonly activeVariant: number;
  readonly meshes: readonly ResourceHandle[];
  readonly materials: readonly ResourceHandle[];
  readonly textures: readonly ResourceHandle[];
  /** Copy a glTF texture into a bounded RGBA preview (default 256, range 1..1024); null for invalid, stale, or disposed models. */
  getTexturePreview(textureIndex: number, maxDimension?: number): TexturePreview | null;
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
  /** Select a material variant by index or name; pass null to restore default materials. */
  setVariant(variant: number | string | null): boolean;
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
/** Enable the built-in FXAA-style edge smoothing output pass. */
export function setFXAA(engine: Goose3DEngine, enabled: boolean): void;
export function setExposure(engine: Goose3DEngine, exposure: number): void;

/** Options for selecting which glTF scene to load. */
export interface LoadGLTFOptions {
  /** Defaults to the document's `scene`, or scene 0 when no default is declared. */
  scene?: number;
}

/** Load a glTF 2.0 JSON or GLB model. The caller owns and must dispose the result. */
export function loadGLTF(
  engine: Goose3DEngine,
  url: string | URL,
  options?: LoadGLTFOptions,
): Promise<LoadedModel>;
