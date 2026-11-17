const FLOAT = 5126, UINT = 5125, USHORT = 5123, UBYTE = 5121;
const VEC2 = 'VEC2', VEC3 = 'VEC3', VEC4 = 'VEC4', SCALAR = 'SCALAR';

function pad4(n) { return (4 - (n % 4)) % 4; }

function attrData(attribute) {
  if (attribute.isInterleavedBufferAttribute) {
    const { data, itemSize, offset } = attribute;
    const stride = data.stride, count = attribute.count, src = data.array;
    const out = new Float32Array(count * itemSize);
    for (let i = 0; i < count; i++) {
      const base = i * stride + offset;
      for (let c = 0; c < itemSize; c++) out[i * itemSize + c] = src[base + c] ?? 0;
    }
    return { array: out, itemSize, count };
  }
  return { array: attribute.array, itemSize: attribute.itemSize, count: attribute.count };
}

function componentType(array) {
  if (array instanceof Uint32Array) return UINT;
  if (array instanceof Uint16Array) return USHORT;
  if (array instanceof Uint8Array || array instanceof Uint8ClampedArray) return UBYTE;
  return FLOAT;
}

function typeFor(itemSize) {
  return itemSize === 1 ? SCALAR : itemSize === 2 ? VEC2 : itemSize === 3 ? VEC3 : VEC4;
}

// Column-major 4x4 -> glTF matrix (glTF is column-major, same layout).
function matrixElements(m) {
  const e = m.elements || m;
  const out = new Array(16);
  for (let c = 0; c < 4; c++) for (let r = 0; r < 4; r++) out[c * 4 + r] = e[r * 4 + c];
  return out;
}

export class GLTFExporter {
  parseAsync(object, options = {}) {
    const binary = options.binary !== false;
    try {
      const json = this.build(object);
      const jsonText = JSON.stringify(json);
      if (!binary) return Promise.resolve(jsonText);
      return Promise.resolve(this.packGLB(jsonText));
    } catch (error) {
      return Promise.reject(error);
    }
  }
  parse(object, onDone, onError, options = {}) {
    this.parseAsync(object, options).then(onDone, onError || (() => {}));
  }

  build(root) {
    const bufferViews = [], accessors = [], meshes = [], materials = [], nodes = [];
    const materialIds = new Map();
    const binParts = [];
    let binLength = 0;
    this._binParts = binParts;
    this._binLength = 0;

    const pushView = (data, target) => {
      const bytes = data.byteLength ?? data.length;
      const view = { buffer: 0, byteOffset: binLength, byteLength: bytes };
      if (target) view.target = target;
      binParts.push(data);
      binLength += bytes + pad4(bytes);
      this._binLength = binLength;
      bufferViews.push(view);
      return bufferViews.length - 1;
    };

    const pushAccessor = (data, itemSize, { minmax = false } = {}) => {
      const view = pushView(data, 34962);
      const accessor = {
        bufferView: view,
        componentType: componentType(data),
        count: Math.floor(data.length / itemSize),
        type: typeFor(itemSize),
      };
      if (minmax) {
        const n = accessor.count, arr = data;
        const mins = [Infinity, Infinity, Infinity], maxs = [-Infinity, -Infinity, -Infinity];
        for (let i = 0; i < n; i++) for (let c = 0; c < itemSize && c < 3; c++) {
          const v = arr[i * itemSize + c];
          if (v < mins[c]) mins[c] = v;
          if (v > maxs[c]) maxs[c] = v;
        }
        accessor.min = mins.slice(0, itemSize);
        accessor.max = maxs.slice(0, itemSize);
      }
      accessors.push(accessor);
      return accessors.length - 1;
    };

    const materialIndex = (material) => {
      if (!material || material.isMeshBasicMaterial) return 0;
      const key = material.uuid || material;
      if (materialIds.has(key)) return materialIds.get(key);
      const color = material.color;
      const pbr = {
        baseColorFactor: color ? [color.r ?? 1, color.g ?? 1, color.b ?? 1, 1] : [1, 1, 1, 1],
        metallicFactor: material.metalness ?? 0,
        roughnessFactor: material.roughness ?? 1,
      };
      const entry = { pbrMetallicRoughness: pbr, doubleSided: material.side === 2 };
      materials.push(entry);
      const id = materials.length - 1;
      materialIds.set(key, id);
      return id;
    };

    const ATTRS = { position: 'POSITION', normal: 'NORMAL', color: 'COLOR_0', uv: 'TEXCOORD_0', uv1: 'TEXCOORD_1' };

    const exportGeometry = (geometry) => {
      const attributes = {}, primitives = [];
      for (const [name, semantic] of Object.entries(ATTRS)) {
        const attr = geometry.attributes[name];
        if (!attr) continue;
        const data = attrData(attr);
        let array = data.array;
        let itemSize = data.itemSize;
        if (name === 'color' && itemSize === 4) {
          const rgb = new Float32Array(data.count * 3);
          for (let i = 0; i < data.count; i++) {
            rgb[i * 3] = array[i * 4]; rgb[i * 3 + 1] = array[i * 4 + 1]; rgb[i * 3 + 2] = array[i * 4 + 2];
          }
          array = rgb; itemSize = 3;
        }
        attributes[semantic] = pushAccessor(array, itemSize, { minmax: name === 'position' });
      }
      const primitive = { attributes, mode: 4 };
      const index = geometry.index;
      if (index) {
        const data = index.isInterleavedBufferAttribute ? attrData(index) : { array: index.array };
        const count = index.count ?? Math.floor(data.array.length / index.itemSize);
        let idx = data.array;
        if (count > 65535 && !(idx instanceof Uint32Array)) idx = Uint32Array.from(idx);
        else if (count <= 65535 && !(idx instanceof Uint16Array)) idx = Uint16Array.from(idx);
        primitive.indices = pushAccessor(idx, 1);
      }
      const mid = materialIndex(null);
      primitive.material = mid;
      primitives.push(primitive);
      return { primitives };
    };

    const exportNode = (object) => {
      const node = { name: object.name || '' };
      const children = [];
      if (object.matrixAutoUpdate === false && object.matrix) {
        node.matrix = matrixElements(object.matrix);
      } else {
        node.translation = [object.position.x, object.position.y, object.position.z];
        const q = object.quaternion;
        node.rotation = [q.x, q.y, q.z, q.w];
        node.scale = [object.scale.x, object.scale.y, object.scale.z];
      }
      if (object.isMesh && object.geometry) {
        const meshIndex = meshes.length;
        const mesh = exportGeometry(object.geometry);
        // Assign the object's material to the primitive.
        for (const prim of mesh.primitives) prim.material = materialIndex(object.material);
        meshes.push(mesh);
        node.mesh = meshIndex;
      }
      nodes.push(node);
      const nodeIndex = nodes.length - 1;
      for (const child of object.children) {
        if (!child.visible) continue;
        children.push(exportNode(child));
      }
      if (children.length) node.children = children;
      return nodeIndex;
    };

    // Default material 0 keeps primitive.material valid even before assignment.
    materials.push({ pbrMetallicRoughness: { baseColorFactor: [1, 1, 1, 1], metallicFactor: 0, roughnessFactor: 1 }, doubleSided: true });
    const sceneNodes = [];
    for (const child of root.isScene ? root.children : [root]) {
      if (child.visible) sceneNodes.push(exportNode(child));
    }
    if (!sceneNodes.length && root.isMesh) sceneNodes.push(exportNode(root));

    return {
      asset: { version: '2.0', generator: 'gs3d GLTFExporter' },
      scene: 0,
      scenes: [{ nodes: sceneNodes }],
      nodes,
      meshes,
      materials,
      accessors,
      bufferViews,
      buffers: [{ byteLength: binLength }],
    };
  }

  packGLB(jsonText) {
    const jsonBytes = new TextEncoder().encode(jsonText);
    const jsonPad = pad4(jsonBytes.length);
    const jsonChunk = new Uint8Array(jsonBytes.length + jsonPad);
    jsonChunk.set(jsonBytes);
    for (let i = jsonBytes.length; i < jsonChunk.length; i++) jsonChunk[i] = 0x20;

    const binLength = this._binLength;
    const binPad = pad4(binLength);
    const total = 12 + 8 + jsonChunk.length + 8 + binLength + binPad;
    const glb = new ArrayBuffer(total);
    const view = new DataView(glb);
    view.setUint32(0, 0x46546c67, true); // 'glTF'
    view.setUint32(4, 2, true);
    view.setUint32(8, total, true);
    view.setUint32(12, jsonChunk.length, true);
    view.setUint32(16, 0x4e4f534a, true); // 'JSON'
    new Uint8Array(glb, 20, jsonChunk.length).set(jsonChunk);

    const offset = 20 + jsonChunk.length;
    view.setUint32(offset, binLength + binPad, true);
    view.setUint32(offset + 4, 0x004e4942, true); // 'BIN'
    const binStart = offset + 8;
    // Buffer contents were accumulated in build(); re-emit through a stored list.
    let pos = binStart;
    for (const part of this._binParts) {
      const src = part instanceof ArrayBuffer ? new Uint8Array(part) : part;
      const bytes = src.byteLength ?? src.length;
      new Uint8Array(glb, pos).set(src instanceof Uint8Array ? src : new Uint8Array(src.buffer, src.byteOffset, bytes));
      pos += bytes + pad4(bytes);
    }
    return glb;
  }
}
