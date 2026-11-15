/**
 * Small, dependency-free glTF/GLB authoring helpers for code-first 3D assets.
 * The API deliberately uses plain typed data so an agent can generate and
 * review a model as source instead of operating a desktop modelling app.
 */

export type Vec2 = readonly [number, number];
export type Vec3 = readonly [number, number, number];
export type Quat = readonly [number, number, number, number];
export type AccessorType = 'SCALAR' | 'VEC2' | 'VEC3' | 'VEC4';
export type ComponentType = 5123 | 5125 | 5126; // uint16, uint32, float32

export interface Geometry {
  positions: readonly Vec3[];
  normals?: readonly Vec3[];
  texcoords?: readonly Vec2[];
  indices: readonly number[];
}

export interface PrimitiveSpec {
  geometry: Geometry;
  material: number;
  extensions?: Record<string, unknown>;
}

export interface MeshSpec {
  name: string;
  primitives: readonly PrimitiveSpec[];
}

export interface GltfMaterial {
  name?: string;
  pbrMetallicRoughness?: {
    baseColorFactor?: readonly [number, number, number, number];
    baseColorTexture?: { index: number; texCoord?: number };
    metallicFactor?: number;
    roughnessFactor?: number;
  };
  emissiveFactor?: Vec3;
  alphaMode?: 'OPAQUE' | 'MASK' | 'BLEND';
  alphaCutoff?: number;
  doubleSided?: boolean;
  extensions?: Record<string, unknown>;
}

export interface GltfNode {
  name?: string;
  mesh?: number;
  camera?: number;
  children?: readonly number[];
  translation?: Vec3;
  rotation?: Quat;
  scale?: Vec3;
  extensions?: Record<string, unknown>;
}

export interface GltfAnimation {
  name?: string;
  samplers: readonly { input: number; output: number; interpolation?: 'LINEAR' | 'STEP' | 'CUBICSPLINE' }[];
  channels: readonly { sampler: number; target: { node: number; path: 'translation' | 'rotation' | 'scale' | 'weights' } }[];
}

export interface GltfDocument {
  asset: { version: '2.0'; generator: string };
  materials?: readonly GltfMaterial[];
  nodes?: readonly GltfNode[];
  scenes?: readonly { name?: string; nodes: readonly number[] }[];
  scene?: number;
  animations?: readonly GltfAnimation[];
  cameras?: readonly Record<string, unknown>[];
  images?: readonly { bufferView: number; mimeType: 'image/jpeg' | 'image/png' }[];
  textures?: readonly Record<string, unknown>[];
  extensionsUsed?: readonly string[];
  extensionsRequired?: readonly string[];
  extensions?: Record<string, unknown>;
  [key: string]: unknown;
}

const componentBytes: Record<ComponentType, number> = {
  5123: 2,
  5125: 4,
  5126: 4,
};
const componentCount: Record<AccessorType, number> = {
  SCALAR: 1,
  VEC2: 2,
  VEC3: 3,
  VEC4: 4,
};

export class GlbBuilder {
  readonly meshes: Record<string, unknown>[] = [];
  readonly bufferViews: Record<string, number>[] = [];
  readonly accessors: Record<string, unknown>[] = [];
  private readonly binaryChunks: Uint8Array[] = [];
  private binaryLength = 0;

  addAccessor(
    values: readonly number[],
    type: AccessorType,
    count: number,
    options: {
      componentType?: ComponentType;
      target?: number;
      min?: readonly number[];
      max?: readonly number[];
    } = {},
  ): number {
    const componentType = options.componentType ?? 5126;
    const components = componentCount[type];
    if (!Number.isSafeInteger(count) || count < 1 || values.length !== count * components) {
      throw new Error(`${type} accessor needs ${count * components} values`);
    }
    const bytesPerComponent = componentBytes[componentType];
    const bytes = new Uint8Array(values.length * bytesPerComponent);
    const view = new DataView(bytes.buffer);
    values.forEach((value, index) => {
      if (!Number.isFinite(value)) throw new Error('glTF accessor values must be finite');
      const offset = index * bytesPerComponent;
      if (componentType === 5126) view.setFloat32(offset, value, true);
      else if (componentType === 5123) {
        if (!Number.isInteger(value) || value < 0 || value > 0xffff) throw new Error('uint16 accessor value out of range');
        view.setUint16(offset, value, true);
      } else {
        if (!Number.isInteger(value) || value < 0 || value > 0xffffffff) throw new Error('uint32 accessor value out of range');
        view.setUint32(offset, value, true);
      }
    });
    const bufferView = this.addBufferView(bytes, options.target);
    const accessor: Record<string, unknown> = { bufferView, componentType, count, type };
    if (options.min) accessor.min = [...options.min];
    if (options.max) accessor.max = [...options.max];
    this.accessors.push(accessor);
    return this.accessors.length - 1;
  }

  addBufferView(bytes: Uint8Array, target?: number): number {
    const padding = (4 - this.binaryLength % 4) % 4;
    if (padding) {
      this.binaryChunks.push(new Uint8Array(padding));
      this.binaryLength += padding;
    }
    const byteOffset = this.binaryLength;
    this.binaryChunks.push(bytes);
    this.binaryLength += bytes.byteLength;
    const bufferView: Record<string, number> = {
      buffer: 0,
      byteOffset,
      byteLength: bytes.byteLength,
    };
    if (target !== undefined) bufferView.target = target;
    this.bufferViews.push(bufferView);
    return this.bufferViews.length - 1;
  }

  addImage(bytes: Uint8Array, mimeType: 'image/jpeg' | 'image/png'): { bufferView: number; mimeType: 'image/jpeg' | 'image/png' } {
    return { bufferView: this.addBufferView(bytes), mimeType };
  }

  addMesh(spec: MeshSpec): number {
    const primitives = spec.primitives.map(primitive => {
      const geometry = primitive.geometry;
      if (!geometry.positions.length || !geometry.indices.length) throw new Error(`${spec.name} needs positions and indices`);
      if (geometry.indices.length % 3 !== 0) throw new Error(`${spec.name} indices must describe complete triangles`);
      if (geometry.normals && geometry.normals.length !== geometry.positions.length) throw new Error(`${spec.name} normal count must match positions`);
      if (geometry.texcoords && geometry.texcoords.length !== geometry.positions.length) throw new Error(`${spec.name} UV count must match positions`);
      for (const index of geometry.indices) {
        if (!Number.isInteger(index) || index < 0 || index >= geometry.positions.length) throw new Error(`${spec.name} index is outside its vertex array`);
      }
      const flatPositions = geometry.positions.flatMap(vertex => [...vertex]);
      const min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity];
      for (const position of geometry.positions) for (let axis = 0; axis < 3; axis++) {
        min[axis] = Math.min(min[axis], position[axis]);
        max[axis] = Math.max(max[axis], position[axis]);
      }
      const attributes: Record<string, number> = {
        POSITION: this.addAccessor(flatPositions, 'VEC3', geometry.positions.length, { target: 34962, min, max }),
      };
      if (geometry.normals) attributes.NORMAL = this.addAccessor(geometry.normals.flatMap(vertex => [...vertex]), 'VEC3', geometry.normals.length, { target: 34962 });
      if (geometry.texcoords) attributes.TEXCOORD_0 = this.addAccessor(geometry.texcoords.flatMap(uv => [...uv]), 'VEC2', geometry.texcoords.length, { target: 34962 });
      const indexType: ComponentType = geometry.positions.length <= 0x10000 ? 5123 : 5125;
      const indices = this.addAccessor(geometry.indices, 'SCALAR', geometry.indices.length, { componentType: indexType, target: 34963 });
      return {
        attributes,
        indices,
        material: primitive.material,
        mode: 4,
        ...(primitive.extensions ? { extensions: primitive.extensions } : {}),
      };
    });
    this.meshes.push({ name: spec.name, primitives });
    return this.meshes.length - 1;
  }

  encode(document: GltfDocument): Uint8Array {
    const padding = (4 - this.binaryLength % 4) % 4;
    const binary = new Uint8Array(this.binaryLength + padding);
    let binaryOffset = 0;
    for (const chunk of this.binaryChunks) {
      binary.set(chunk, binaryOffset);
      binaryOffset += chunk.byteLength;
    }
    const json = new TextEncoder().encode(JSON.stringify({
      ...document,
      buffers: [{ byteLength: binary.byteLength }],
      bufferViews: this.bufferViews,
      accessors: this.accessors,
      meshes: this.meshes,
    }));
    const jsonLength = (json.byteLength + 3) & ~3;
    const totalLength = 12 + 8 + jsonLength + 8 + binary.byteLength;
    const glb = new Uint8Array(totalLength);
    const data = new DataView(glb.buffer);
    data.setUint32(0, 0x46546c67, true); // glTF
    data.setUint32(4, 2, true);
    data.setUint32(8, totalLength, true);
    data.setUint32(12, jsonLength, true);
    data.setUint32(16, 0x4e4f534a, true); // JSON
    glb.fill(0x20, 20, 20 + jsonLength);
    glb.set(json, 20);
    const binaryHeader = 20 + jsonLength;
    data.setUint32(binaryHeader, binary.byteLength, true);
    data.setUint32(binaryHeader + 4, 0x004e4942, true); // BIN
    glb.set(binary, binaryHeader + 8);
    return glb;
  }
}

/** Create a flat-shaded, UV-mapped box from just its dimensions. */
export function boxGeometry(size: Vec3): Geometry {
  const axes: Vec3[] = [[1, 0, 0], [0, 1, 0], [0, 0, 1]];
  const corners: Vec2[] = [[-1, -1], [1, -1], [1, 1], [-1, 1]];
  const positions: Vec3[] = [], normals: Vec3[] = [], texcoords: Vec2[] = [], indices: number[] = [];
  for (let face = 0; face < 6; face++) {
    const sign = face % 2 === 0 ? 1 : -1;
    const axis = axes[Math.floor(face / 2)];
    const normal = axis.map(value => value * sign) as unknown as Vec3;
    const u = axes[(Math.floor(face / 2) + 1) % 3].map(value => value * sign) as unknown as Vec3;
    const v: Vec3 = [
      normal[1] * u[2] - normal[2] * u[1],
      normal[2] * u[0] - normal[0] * u[2],
      normal[0] * u[1] - normal[1] * u[0],
    ];
    const base = positions.length;
    for (const [x, y] of corners) {
      positions.push([0, 1, 2].map(i => (normal[i] + u[i] * x + v[i] * y) * size[i] / 2) as unknown as Vec3);
      normals.push(normal);
      texcoords.push([(x + 1) / 2, (y + 1) / 2]);
    }
    indices.push(base, base + 1, base + 2, base, base + 2, base + 3);
  }
  return { positions, normals, texcoords, indices };
}

/** Create a two-triangle, upward-facing floor plane. */
export function planeGeometry(width: number, depth: number, y: number): Geometry {
  const x = width / 2, z = depth / 2;
  return {
    positions: [[-x, y, -z], [x, y, -z], [x, y, z], [-x, y, z]],
    normals: [[0, 1, 0], [0, 1, 0], [0, 1, 0], [0, 1, 0]],
    texcoords: [[0, 0], [1, 0], [1, 1], [0, 1]],
    indices: [0, 2, 1, 0, 3, 2],
  };
}
