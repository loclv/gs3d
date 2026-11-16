import type { Object3D, Camera, Material, BufferGeometry } from './three.js';

export interface GltfResult {
  /** Root of the default scene, ready for scene.add(). */
  scene: Object3D;
  scenes: Object3D[];
  cameras: Camera[];
  animations: unknown[];
  asset: Record<string, unknown>;
  parser: Record<string, unknown>;
}

export class GLTFLoader {
  constructor();
  manager: unknown;
  load(
    url: string,
    onLoad?: (gltf: GltfResult) => void,
    onProgress?: (event: ProgressEvent) => void,
    onError?: (error: unknown) => void,
  ): this;
  /** Synchronous parse of a glTF JSON document (with optional GLB binary chunk). */
  parse(json: Record<string, unknown>, bin?: Uint8Array | null, baseUrl?: string): GltfResult;
}
