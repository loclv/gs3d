// A GLTFLoader-compatible loader for the gs3d facade.
//
// `import { GLTFLoader } from 'gs3d/gltf-loader'` mirrors the three.js
// examples path: loader.load(url, gltf => scene.add(gltf.scene)). It parses
// glTF 2.0 JSON and GLB containers and builds the facade's Object3D/Mesh/
// BufferGeometry scene graph, including node hierarchies, TRS and matrix
// transforms, and untextured PBR materials.
//
// Scope: no textures, images, skins, morph targets, animations, or
// Draco/meshopt compression — files that require extensions throw. Cameras
// defined by the asset are exposed on gltf.cameras but are not added to the
// scene graph (add them yourself like three.js examples do).

import {
  BufferGeometry, BufferAttribute, Float32BufferAttribute, Uint16BufferAttribute, Uint32BufferAttribute,
  Object3D, Group, Mesh, Scene,
  MeshStandardMaterial, MeshBasicMaterial,
  PerspectiveCamera, OrthographicCamera,
  Color, DoubleSide,
} from './three.js';

const COMPONENTS = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4, MAT4: 16 };
const COMPONENT_TYPE = {
  5120: Int8Array, 5121: Uint8Array, 5122: Int16Array,
  5123: Uint16Array, 5125: Uint32Array, 5126: Float32Array,
};
const BYTE_STRIDE = {
  5120: 1, 5121: 1, 5122: 2, 5123: 2, 5125: 4, 5126: 4,
};

function parseGLB(buffer) {
  const view = new DataView(buffer);
  if (buffer.byteLength < 20 || view.getUint32(0, true) !== 0x46546c67) {
    throw new Error('gs3d: not a GLB file (bad magic)');
  }
  const version = view.getUint32(4, true);
  if (version !== 2) throw new Error(`gs3d: unsupported GLB version ${version}`);
  let offset = 12, json = null, bin = null;
  while (offset + 8 <= buffer.byteLength) {
    const length = view.getUint32(offset, true);
    const type = view.getUint32(offset + 4, true);
    const start = offset + 8;
    if (type === 0x4e4f534a) json = JSON.parse(new TextDecoder().decode(new Uint8Array(buffer, start, length)));
    else if (type === 0x004e4942) bin = new Uint8Array(buffer, start, length);
    offset = start + length;
  }
  if (!json) throw new Error('gs3d: GLB has no JSON chunk');
  return { json, bin };
}

function resolveBuffer(json, bin, bufferIndex) {
  const buffer = json.buffers[bufferIndex];
  if (buffer.uri === undefined) {
    if (!bin) throw new Error('gs3d: GLB is missing its BIN chunk');
    return bin.buffer.slice(bin.byteOffset, bin.byteOffset + bin.byteLength);
  }
  if (buffer.uri.startsWith('data:')) {
    const comma = buffer.uri.indexOf(',');
    const meta = buffer.uri.slice(0, comma);
    const data = buffer.uri.slice(comma + 1);
    if (meta.includes('base64')) {
      const binary = atob(data);
      const bytes = new Uint8Array(binary.length);
      for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
      return bytes.buffer;
    }
    return new TextEncoder().encode(decodeURIComponent(data)).buffer;
  }
  throw new Error('gs3d: external .bin buffers are not supported; embed them or use GLB');
}

class GltfAccessor {
  constructor(json, buffers, index) {
    const accessor = json.accessors[index];
    const view = json.bufferViews[accessor.bufferView];
    const buffer = buffers[view.buffer];
    const componentType = accessor.componentType;
    const ArrayType = COMPONENT_TYPE[componentType];
    if (!ArrayType) throw new Error(`gs3d: unsupported accessor componentType ${componentType}`);
    const comps = COMPONENTS[accessor.type];
    if (!comps) throw new Error(`gs3d: unsupported accessor type ${accessor.type}`);
    this.count = accessor.count;
    this.itemSize = comps;
    this.normalized = !!accessor.normalized;
    const elementBytes = BYTE_STRIDE[componentType] * comps;
    const byteOffset = (view.byteOffset || 0) + (accessor.byteOffset || 0);
    if (!view.byteStride || view.byteStride === elementBytes) {
      const raw = new ArrayType(buffer, byteOffset, accessor.count * comps);
      this.array = accessor.normalized ? normalizeIntegers(raw, componentType) : raw;
    } else {
      // Interleaved data: gather each element.
      const raw = new ArrayType(accessor.count * comps);
      for (let i = 0; i < accessor.count; i++) {
        const base = byteOffset + i * view.byteStride;
        for (let c = 0; c < comps; c++) {
          const Type = COMPONENT_TYPE[componentType];
          raw[i * comps + c] = new Type(buffer, base + c * BYTE_STRIDE[componentType], 1)[0];
        }
      }
      this.array = accessor.normalized ? normalizeIntegers(raw, componentType) : raw;
    }
    this.sparse = accessor.sparse;
    if (accessor.sparse) throw new Error('gs3d: sparse accessors are not supported');
  }
}

function normalizeIntegers(array, componentType) {
  const out = new Float32Array(array.length);
  const max = { 5120: 127, 5121: 255, 5122: 32767, 5123: 65535 }[componentType];
  for (let i = 0; i < array.length; i++) out[i] = array[i] / max;
  return out;
}

function eulerFromQuaternion(x, y, z, w) {
  // Inverse of the XYZ Euler->quaternion used by composeLocal.
  const x2 = x + x, y2 = y + y, z2 = z + z;
  const xx = x * x2, xy = x * y2, xz = x * z2;
  const yy = y * y2, yz = y * z2, zz = z * z2;
  const wx = w * x2, wy = w * y2, wz = w * z2;
  // xx..wz are doubled products, matching the composeLocal convention.
  const m01 = xy - wz, m00 = 1 - (yy + zz);
  const m02 = xz + wy;
  const m10 = xy + wz, m11 = 1 - (xx + zz);
  const m12 = yz - wx, m22 = 1 - (xx + yy);
  const sy = Math.max(-1, Math.min(1, m02));
  const ey = Math.asin(sy);
  const cy = Math.cos(ey);
  let ex, ez;
  if (Math.abs(cy) > 1e-6) {
    ex = Math.atan2(-m12, m22);
    ez = Math.atan2(-m01, m00);
  } else {
    // Gimbal lock: y = ±90° leaves one combined x/z degree of freedom.
    ex = sy > 0 ? Math.atan2(m10, m11) : Math.atan2(-m10, m11);
    ez = 0;
  }
  return [ex, ey, ez];
}

function decomposeMatrix(elements) {
  // Column-major mat4 -> {position, rotationEuler, scale}
  const sx = Math.hypot(elements[0], elements[1], elements[2]);
  const sy = Math.hypot(elements[4], elements[5], elements[6]);
  const sz = Math.hypot(elements[8], elements[9], elements[10]);
  const m = elements.slice();
  for (let i = 0; i < 3; i++) {
    const len = [sx, sy, sz][i] || 1;
    m[i * 4] /= len; m[i * 4 + 1] /= len; m[i * 4 + 2] /= len;
  }
  // Rotation matrix -> quaternion (standard Shepperd's method).
  const m00 = m[0], m10 = m[1], m20 = m[2];
  const m01 = m[4], m11 = m[5], m21 = m[6];
  const m02 = m[8], m12 = m[9], m22 = m[10];
  const tr = m00 + m11 + m22;
  let qx, qy, qz, qw;
  if (tr > 0) {
    const s = Math.sqrt(tr + 1) * 2;
    qw = s / 4; qx = (m21 - m12) / s; qy = (m02 - m20) / s; qz = (m10 - m01) / s;
  } else if (m00 > m11 && m00 > m22) {
    const s = Math.sqrt(1 + m00 - m11 - m22) * 2;
    qw = (m21 - m12) / s; qx = s / 4; qy = (m01 + m10) / s; qz = (m02 + m20) / s;
  } else if (m11 > m22) {
    const s = Math.sqrt(1 + m11 - m00 - m22) * 2;
    qw = (m02 - m20) / s; qx = (m01 + m10) / s; qy = s / 4; qz = (m12 + m21) / s;
  } else {
    const s = Math.sqrt(1 + m22 - m00 - m11) * 2;
    qw = (m10 - m01) / s; qx = (m02 + m20) / s; qy = (m12 + m21) / s; qz = s / 4;
  }
  const [ex, ey, ez] = eulerFromQuaternion(qx, qy, qz, qw);
  return {
    position: [elements[12], elements[13], elements[14]],
    rotation: [ex, ey, ez],
    scale: [sx || 1, sy || 1, sz || 1],
  };
}

function materialFromGltf(def) {
  if (!def) return new MeshStandardMaterial();
  const pbr = def.pbrMetallicRoughness || {};
  const base = pbr.baseColorFactor || [1, 1, 1, 1];
  const params = {
    color: new Color().setRGB(base[0], base[1], base[2]),
    metalness: pbr.metallicFactor ?? 1,
    roughness: pbr.roughnessFactor ?? 1,
    opacity: base[3],
    transparent: def.alphaMode === 'BLEND',
    alphaTest: def.alphaMode === 'MASK' ? (def.alphaCutoff ?? 0.5) : 0,
    side: def.doubleSided ? DoubleSide : 0,
  };
  if (def.emissiveFactor) {
    const strength = def.extensions?.KHR_materials_emissive_strength?.emissiveStrength ?? 1;
    params.emissive = new Color().setRGB(
      def.emissiveFactor[0] * strength, def.emissiveFactor[1] * strength, def.emissiveFactor[2] * strength);
  }
  if (def.extensions?.KHR_materials_unlit) return new MeshBasicMaterial(params);
  return new MeshStandardMaterial(params);
}

export class GLTFLoader {
  constructor() { this.manager = null; }

  load(url, onLoad, onProgress, onError) {
    fetch(url)
      .then(response => {
        if (!response.ok) throw new Error(`gs3d: failed to fetch ${url} (${response.status})`);
        return response.arrayBuffer();
      })
      .then(buffer => {
        const contentType = url.toLowerCase();
        if (contentType.endsWith('.glb') || buffer.byteLength >= 4 && new DataView(buffer).getUint32(0, true) === 0x46546c67) {
          const { json, bin } = parseGLB(buffer);
          return this.parse(json, bin);
        }
        const json = JSON.parse(new TextDecoder().decode(buffer));
        return this.parse(json, null, url);
      })
      .then(gltf => onLoad && onLoad(gltf))
      .catch(error => onError ? onError(error) : console.error(error));
    return this;
  }

  // Build the scene graph from a parsed glTF JSON document. `bin` is the GLB
  // binary chunk (or null); `baseUrl` resolves relative resources for .gltf.
  parse(json, bin = null, baseUrl = '') {
    if (json.extensionsRequired?.length) {
      throw new Error(`gs3d: glTF requires unsupported extensions: ${json.extensionsRequired.join(', ')}`);
    }
    const buffers = (json.buffers || []).map((_, i) => resolveBuffer(json, bin, i));
    const accessors = (json.accessors || []).map((_, i) => new GltfAccessor(json, buffers, i));

    const geometries = (json.meshes || []).map(mesh => {
      // Multi-primitive meshes are merged into one geometry only when they
      // share a material; otherwise the first primitive wins per node slot.
      return mesh.primitives.map(primitive => {
        const geometry = new BufferGeometry();
        const attrs = primitive.attributes || {};
        if (attrs.POSITION === undefined) throw new Error('gs3d: primitive has no POSITION');
        const position = accessors[attrs.POSITION];
        geometry.setAttribute('position', new Float32BufferAttribute(position.array, 3));
        if (attrs.NORMAL !== undefined) {
          const normal = accessors[attrs.NORMAL];
          geometry.setAttribute('normal', new Float32BufferAttribute(normal.array, 3));
        }
        if (attrs.TEXCOORD_0 !== undefined) {
          const uv = accessors[attrs.TEXCOORD_0];
          geometry.setAttribute('uv', new Float32BufferAttribute(uv.array, uv.itemSize));
        }
        if (attrs.COLOR_0 !== undefined) {
          const color = accessors[attrs.COLOR_0];
          geometry.setAttribute('color', new Float32BufferAttribute(color.array, color.itemSize));
        }
        if (!geometry.attributes.normal) geometry.computeVertexNormals();
        if (primitive.indices !== undefined) {
          const index = accessors[primitive.indices];
          const IndexType = index.array instanceof Uint16Array ? Uint16BufferAttribute : Uint32BufferAttribute;
          geometry.setIndex(new IndexType(index.array, 1));
        }
        return { geometry, material: materialFromGltf(json.materials?.[primitive.material]) };
      });
    });

    const cameras = (json.cameras || []).map(def => {
      if (def.type === 'orthographic') {
        const cam = new OrthographicCamera(def.orthographic.xmag * -1, def.orthographic.xmag,
          def.orthographic.ymag, def.orthographic.ymag * -1, def.orthographic.znear, def.orthographic.zfar);
        return cam;
      }
      const p = def.perspective || {};
      return new PerspectiveCamera((p.yfov ?? 0.8) * 180 / Math.PI,
        (p.aspectRatio ?? 1), p.znear ?? 0.1, p.zfar ?? 1000);
    });

    const nodeDefs = json.nodes || [];
    const buildNode = index => {
      const def = nodeDefs[index];
      let object;
      if (def.mesh !== undefined) {
        const primitives = geometries[def.mesh];
        if (primitives.length === 1) {
          object = new Mesh(primitives[0].geometry, primitives[0].material);
        } else {
          // Multiple primitives become child meshes sharing the transform.
          object = new Group();
          for (const prim of primitives) object.add(new Mesh(prim.geometry, prim.material));
        }
      } else if (def.camera !== undefined) {
        object = cameras[def.camera];
      } else {
        object = def.children ? new Group() : new Object3D();
      }
      object.name = def.name || '';
      if (def.matrix) {
        const trs = decomposeMatrix(def.matrix);
        object.position.set(...trs.position);
        object.rotation.set(...trs.rotation);
        object.scale.set(...trs.scale);
      } else {
        if (def.translation) object.position.set(...def.translation);
        if (def.rotation) {
          const [ex, ey, ez] = eulerFromQuaternion(...def.rotation);
          object.rotation.set(ex, ey, ez);
        }
        if (def.scale) object.scale.set(...def.scale);
      }
      for (const childIndex of def.children || []) object.add(buildNode(childIndex));
      return object;
    };

    const scenes = (json.scenes || [{ nodes: [] }]).map(sceneDef => {
      const group = new Group();
      group.name = sceneDef.name || '';
      for (const nodeIndex of sceneDef.nodes || []) group.add(buildNode(nodeIndex));
      return group;
    });
    const sceneIndex = json.scene ?? 0;
    const defaultScene = scenes[sceneIndex] || scenes[0] || new Group();
    return {
      scene: defaultScene,
      scenes,
      cameras,
      animations: [],
      asset: json.asset || {},
      parser: json,
    };
  }
}
