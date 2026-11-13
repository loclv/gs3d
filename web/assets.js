// Browser asset loading for the WebAssembly host. All parsing precedes uploads.
export class AssetError extends Error {
  constructor(code, message, cause) {
    super(message, { cause });
    this.name = 'AssetError';
    this.code = code;
  }
}

async function fetchBytes(url) {
  let response;
  try { response = await fetch(url); }
  catch (error) { throw new AssetError('FETCH', `Could not fetch ${url}`, error); }
  if (!response.ok) throw new AssetError('FETCH', `Could not fetch ${url}: HTTP ${response.status}`);
  return response.arrayBuffer();
}

async function decodeImage(bytes, type) {
  let bitmap;
  try {
    bitmap = await createImageBitmap(new Blob([bytes], { type }));
    const canvas = document.createElement('canvas');
    canvas.width = bitmap.width;
    canvas.height = bitmap.height;
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    if (!ctx) throw new Error('Canvas 2D is unavailable');
    ctx.drawImage(bitmap, 0, 0);
    return { width: bitmap.width, height: bitmap.height, pixels: ctx.getImageData(0, 0, bitmap.width, bitmap.height).data };
  } catch (error) { throw new AssetError('IMAGE', 'Could not decode image', error); }
  finally { if (bitmap) bitmap.close(); }
}

function uploadImage(engine, image, wrapU = 0, wrapV = 0, minFilter = 9729, magFilter = 9729, srgb = false) {
  const ptr = engine._malloc(image.pixels.length);
  if (!ptr) throw new AssetError('MEMORY', 'Could not allocate image upload buffer');
  let handle = null;
  try {
    engine.HEAPU8.set(image.pixels, ptr);
    const id = engine._g3_asset_texture();
    if (id < 0) throw new AssetError('MEMORY', 'Could not allocate texture');
    handle = makeResourceHandle(engine, id, 'texture');
    if (srgb) engine._g3_host_texture_srgb(id, ptr, image.width, image.height);
    else engine._g3_host_texture(id, ptr, image.width, image.height);
    engine._g3_host_texture_wrap(id, wrapU, wrapV);
    engine._g3_host_texture_filter(id, minFilter, magFilter);
    return handle;
  } catch (error) {
    if (handle) releaseTexture(engine, handle);
    throw error;
  } finally { engine._free(ptr); }
}

function releaseTexture(engine, handle) {
  if (engine._g3_asset_release_texture(handle.id, handle.generation)) engine._g3_host_release_texture(handle.id);
}

// The caller owns the returned texture and must dispose it once unused.
export async function loadImage(engine, url, { colorSpace = 'linear' } = {}) {
  if (colorSpace !== 'linear' && colorSpace !== 'srgb') throw new AssetError('COLOR_SPACE', `Unsupported texture color space: ${colorSpace}`);
  const bytes = await fetchBytes(url);
  const image = await decodeImage(bytes, '');
  const handle = uploadImage(engine, image, 0, 0, 9729, 9729, colorSpace === 'srgb');
  let disposed = false;
  return { id: handle.id, handle, width: image.width, height: image.height, dispose() {
    if (!disposed) { disposed = true; releaseTexture(engine, handle); }
  } };
}

const invalid = message => { throw new AssetError('INVALID_GLTF', message); };
const unsupported = message => { throw new AssetError('UNSUPPORTED', message); };
const item = (array, index, name) => {
  if (!Array.isArray(array) || !Number.isInteger(index) || index < 0 || index >= array.length) invalid(`Invalid ${name} index ${index}`);
  return array[index];
};

// A handle is bound to its engine and carries a slot generation and scene
// epoch. Checking it after disposal or scene replacement cannot alias a new
// node occupying the same numeric slot.
const nodeHandleOwners = new WeakMap();
const meshHandleOwners = new WeakMap(), textureHandleOwners = new WeakMap(), materialHandleOwners = new WeakMap();
function makeResourceHandle(engine, id, kind) {
  const generation = engine[`_g3_asset_${kind}_generation`](id);
  if (generation <= 0) throw new AssetError('UPLOAD', `Could not create ${kind} handle`);
  const handle = Object.freeze({ id, generation });
  (kind === 'mesh' ? meshHandleOwners : kind === 'texture' ? textureHandleOwners : materialHandleOwners).set(handle, engine);
  return handle;
}
export function isMeshHandleValid(engine, handle) {
  return !!handle && meshHandleOwners.get(handle) === engine && !!engine._g3_asset_mesh_valid(handle.id, handle.generation);
}
export function isTextureHandleValid(engine, handle) {
  return !!handle && textureHandleOwners.get(handle) === engine && !!engine._g3_asset_texture_valid(handle.id, handle.generation);
}
export function isMaterialHandleValid(engine, handle) {
  return !!handle && materialHandleOwners.get(handle) === engine && !!engine._g3_asset_material_valid(handle.id, handle.generation);
}
function makeNodeHandle(engine, index) {
  const generation = engine._g3_asset_node_generation(index);
  if (generation <= 0) return null;
  const handle = Object.freeze({ index, generation, epoch: engine._g3_asset_scene_epoch() });
  nodeHandleOwners.set(handle, engine);
  return handle;
}

export function isNodeHandleValid(engine, handle) {
  return !!handle && nodeHandleOwners.get(handle) === engine &&
    !!engine._g3_asset_node_valid(handle.index, handle.generation, handle.epoch);
}

// Client coordinates work with CSS-scaled and high-DPI canvases. Return a
// checked handle for the nearest visible front-facing node, or null on a miss.
export function pickNode(engine, canvas, clientX, clientY) {
  const rect = canvas.getBoundingClientRect();
  if (!Number.isFinite(clientX) || !Number.isFinite(clientY) || rect.width <= 0 || rect.height <= 0 ||
      clientX < rect.left || clientX >= rect.right || clientY < rect.top || clientY >= rect.bottom) return null;
  const x = (clientX - rect.left) / rect.width * 2 - 1;
  const y = 1 - (clientY - rect.top) / rect.height * 2;
  const node = engine._g3_asset_pick(x, y, rect.width / rect.height);
  return node < 0 ? null : makeNodeHandle(engine, node);
}

// sRGB output performs the transfer after linear lighting and blending.
export function setOutputColorSpace(engine, space) {
  if (space !== 'linear' && space !== 'srgb') throw new AssetError('COLOR_SPACE', `Unsupported output color space: ${space}`);
  engine._g3_asset_output_srgb(space === 'srgb' ? 1 : 0);
}

function unpack(bytes) {
  const view = new DataView(bytes);
  if (bytes.byteLength >= 4 && view.getUint32(0, true) === 0x46546c67) {
    if (bytes.byteLength < 20 || view.getUint32(4, true) !== 2 || view.getUint32(8, true) !== bytes.byteLength) invalid('Invalid GLB header');
    let offset = 12, json, bin;
    while (offset < bytes.byteLength) {
      if (offset + 8 > bytes.byteLength) invalid('Truncated GLB chunk');
      const length = view.getUint32(offset, true), type = view.getUint32(offset + 4, true);
      offset += 8;
      if (length % 4 || offset + length > bytes.byteLength) invalid('Invalid GLB chunk length');
      if (type === 0x4e4f534a && json === undefined && offset === 20) json = bytes.slice(offset, offset + length);
      else if (type === 0x004e4942 && bin === undefined) bin = bytes.slice(offset, offset + length);
      else unsupported('Unsupported or duplicate GLB chunk');
      offset += length;
    }
    if (!json) invalid('GLB has no JSON chunk');
    return { json, bin };
  }
  return { json: bytes };
}

function accessor(doc, buffers, index, expected) {
  const a = item(doc.accessors, index, 'accessor');
  if (a.sparse || a.bufferView === undefined) unsupported('Sparse or unbacked accessors are not supported');
  if (a.type !== expected) invalid(`Expected ${expected} accessor`);
  const widths = { SCALAR: 1, VEC2: 2, VEC3: 3 };
  const formats = { 5121: [1, 'getUint8'], 5123: [2, 'getUint16'], 5125: [4, 'getUint32'], 5126: [4, 'getFloat32'] };
  const format = formats[a.componentType], components = widths[expected];
  if (!format || !Number.isInteger(a.count) || a.count < 1) unsupported('Unsupported accessor component type or count');
  if (a.normalized && a.componentType !== 5121 && a.componentType !== 5123) unsupported('Unsupported normalized accessor');
  const bv = item(doc.bufferViews, a.bufferView, 'bufferView');
  const buffer = item(buffers, bv.buffer, 'buffer');
  const viewStart = bv.byteOffset ?? 0, offset = a.byteOffset ?? 0;
  if (!Number.isSafeInteger(viewStart) || viewStart < 0 || !Number.isSafeInteger(offset) || offset < 0 || !Number.isSafeInteger(bv.byteLength) || bv.byteLength < 0) invalid('Invalid buffer view');
  const start = viewStart + offset, size = format[0] * components;
  const stride = bv.byteStride || size, end = start + (a.count - 1) * stride + size;
  if (!Number.isSafeInteger(start) || !Number.isSafeInteger(stride) || stride < size || end > viewStart + bv.byteLength || end > buffer.byteLength) invalid('Accessor exceeds its buffer view');
  const data = new DataView(buffer), values = [];
  for (let i = 0; i < a.count; i++) for (let c = 0; c < components; c++) {
    let value = data[format[1]](start + i * stride + c * format[0], true);
    if (a.normalized) value /= a.componentType === 5121 ? 255 : 65535;
    if (!Number.isFinite(value)) invalid('Non-finite accessor value');
    values.push(value);
  }
  return { values, count: a.count, componentType: a.componentType };
}

function localMatrix(node) {
  if (node.matrix) {
    if (node.translation || node.rotation || node.scale || node.matrix.length !== 16 || !node.matrix.every(Number.isFinite)) invalid('Invalid node matrix');
    return node.matrix;
  }
  const [x, y, z, w] = node.rotation || [0, 0, 0, 1];
  const [sx, sy, sz] = node.scale || [1, 1, 1];
  const [tx, ty, tz] = node.translation || [0, 0, 0];
  const m = [(1-2*y*y-2*z*z)*sx, (2*x*y+2*z*w)*sx, (2*x*z-2*y*w)*sx, 0,
    (2*x*y-2*z*w)*sy, (1-2*x*x-2*z*z)*sy, (2*y*z+2*x*w)*sy, 0,
    (2*x*z+2*y*w)*sz, (2*y*z-2*x*w)*sz, (1-2*x*x-2*y*y)*sz, 0, tx, ty, tz, 1];
  if (!m.every(Number.isFinite)) invalid('Invalid node transform');
  return m;
}

async function prepare(url) {
  const absolute = new URL(url, globalThis.location?.href || 'http://localhost/');
  const { json, bin } = unpack(await fetchBytes(absolute));
  let doc;
  try { doc = JSON.parse(new TextDecoder().decode(json)); }
  catch (error) { throw new AssetError('INVALID_GLTF', 'Invalid glTF JSON', error); }
  if (doc.asset?.version !== '2.0') unsupported('Only glTF 2.0 is supported');
  if (doc.extensionsRequired?.length || doc.skins?.length || doc.animations?.length) unsupported('Required extensions, skins and animations are not supported');
  const buffers = await Promise.all((doc.buffers || []).map(async (buffer, i) => {
    const data = buffer.uri !== undefined ? await fetchBytes(new URL(buffer.uri, absolute)) : i === 0 ? bin : undefined;
    if (!data || !Number.isInteger(buffer.byteLength) || buffer.byteLength < 0 || data.byteLength < buffer.byteLength) invalid('Missing or truncated buffer');
    return data;
  }));
  const images = await Promise.all((doc.images || []).map(async image => {
    if (image.uri !== undefined) return decodeImage(await fetchBytes(new URL(image.uri, absolute)), image.mimeType || '');
    const bv = item(doc.bufferViews, image.bufferView, 'image bufferView');
    const data = item(buffers, bv.buffer, 'image buffer');
    const start = bv.byteOffset || 0, end = start + bv.byteLength;
    if (!Number.isInteger(start) || start < 0 || !Number.isInteger(end) || end > data.byteLength) invalid('Image exceeds its buffer');
    return decodeImage(data.slice(start, end), image.mimeType || '');
  }));
  const wrapModes = { 33071: 0, 10497: 1, 33648: 2 };
  const textureSpecs = (doc.textures || []).map(texture => {
    item(images, texture.source, 'image');
    const sampler = texture.sampler === undefined ? {} : item(doc.samplers, texture.sampler, 'sampler');
    if (sampler.extensions || texture.extensions) unsupported('Texture or sampler extensions are not supported');
    if (sampler.magFilter !== undefined && ![9728, 9729].includes(sampler.magFilter)) invalid('Invalid magnification filter');
    if (sampler.minFilter !== undefined && ![9728, 9729, 9984, 9985, 9986, 9987].includes(sampler.minFilter)) invalid('Invalid minification filter');
    const s = sampler.wrapS ?? 10497, t = sampler.wrapT ?? 10497;
    if (!Object.hasOwn(wrapModes, s) || !Object.hasOwn(wrapModes, t)) invalid('Invalid texture wrapping mode');
    return { image: texture.source, wrapU: wrapModes[s], wrapV: wrapModes[t],
      minFilter: sampler.minFilter ?? 9729, magFilter: sampler.magFilter ?? 9729 };
  });
  const meshes = (doc.meshes || []).map(mesh => (mesh.primitives || []).map(p => {
    if ((p.mode ?? 4) !== 4 || p.targets?.length) unsupported('Only triangle meshes without morph targets are supported');
    const pos = accessor(doc, buffers, p.attributes?.POSITION, 'VEC3');
    const normal = accessor(doc, buffers, p.attributes?.NORMAL, 'VEC3');
    const uv = p.attributes?.TEXCOORD_0 === undefined ? null : accessor(doc, buffers, p.attributes.TEXCOORD_0, 'VEC2');
    if (pos.componentType !== 5126 || normal.componentType !== 5126 || pos.count !== normal.count || (uv && uv.count !== pos.count)) invalid('Invalid vertex attributes');
    const indexAccessor = p.indices === undefined ? null : accessor(doc, buffers, p.indices, 'SCALAR');
    if (indexAccessor && ![5121, 5123, 5125].includes(indexAccessor.componentType)) invalid('Indices must be unsigned integers');
    const indices = indexAccessor ? indexAccessor.values : Array.from({ length: pos.count }, (_, i) => i);
    if (indices.length % 3 || indices.some(i => !Number.isInteger(i) || i < 0 || i >= pos.count)) invalid('Invalid triangle indices');
    const material = p.material === undefined ? {} : item(doc.materials, p.material, 'material');
    if (material.doubleSided || material.occlusionTexture || material.emissiveTexture || material.extensions) unsupported('Unsupported material feature');
    const alphaModes = { OPAQUE: 0, MASK: 1, BLEND: 2 };
    const mode = material.alphaMode ?? 'OPAQUE';
    if (!Object.hasOwn(alphaModes, mode)) invalid('Invalid alpha mode');
    const cutoff = material.alphaCutoff ?? 0.5;
    if (!Number.isFinite(cutoff) || cutoff < 0) invalid('Invalid alpha cutoff');
    const pbr = material.pbrMetallicRoughness || {};
    let normalTextureIndex = -1;
    const normalScale = material.normalTexture?.scale ?? 1;
    if (material.normalTexture) {
      if (!uv || (material.normalTexture.texCoord || 0) !== 0 || material.normalTexture.extensions) unsupported('Unsupported normal texture coordinates');
      item(textureSpecs, material.normalTexture.index, 'normal texture');
      if (!Number.isFinite(normalScale)) invalid('Invalid normal scale');
      normalTextureIndex = material.normalTexture.index;
    }
    let metallicRoughnessTextureIndex = -1;
    if (pbr.metallicRoughnessTexture) {
      if (!uv || (pbr.metallicRoughnessTexture.texCoord || 0) !== 0 || pbr.metallicRoughnessTexture.extensions) unsupported('Unsupported metallic-roughness texture coordinates');
      item(textureSpecs, pbr.metallicRoughnessTexture.index, 'metallic-roughness texture');
      metallicRoughnessTextureIndex = pbr.metallicRoughnessTexture.index;
    }
    const metallic = pbr.metallicFactor ?? 1, roughness = pbr.roughnessFactor ?? 1;
    if (![metallic, roughness].every(value => Number.isFinite(value) && value >= 0 && value <= 1)) invalid('Invalid metallic or roughness factor');
    const color = pbr.baseColorFactor || [1, 1, 1, 1];
    if (color.length !== 4 || !color.every(value => Number.isFinite(value) && value >= 0 && value <= 1)) invalid('Invalid base color');
    let textureIndex = -1;
    if (pbr.baseColorTexture) {
      if (!uv || (pbr.baseColorTexture.texCoord || 0) !== 0 || pbr.baseColorTexture.extensions) unsupported('Unsupported texture coordinates');
      item(textureSpecs, pbr.baseColorTexture.index, 'texture');
      textureIndex = pbr.baseColorTexture.index;
    }
    // OPAQUE materials ignore baseColorFactor alpha, as required by glTF.
    return { pos: pos.values, normal: normal.values, uv: uv?.values, indices,
      color: [color[0], color[1], color[2], mode === 'OPAQUE' ? 1 : color[3]], textureIndex,
      alphaMode: alphaModes[mode], alphaCutoff: cutoff, metallic, roughness, metallicRoughnessTextureIndex,
      normalTextureIndex, normalScale, materialIndex: p.material ?? -1 };
  }));
  const nodes = doc.nodes || [], roots = item(doc.scenes, doc.scene ?? 0, 'scene').nodes || [];
  const seen = new Set();
  function visit(index, depth) {
    if (depth > 63 || seen.has(index)) invalid('Invalid or overly deep node hierarchy');
    seen.add(index);
    const n = item(nodes, index, 'node');
    if (n.skin !== undefined || n.weights || n.extensions) unsupported('Unsupported node feature');
    const primitives = n.mesh === undefined ? [] : item(meshes, n.mesh, 'mesh');
    return { matrix: localMatrix(n), primitives, children: (n.children || []).map(child => visit(child, depth + 1)) };
  }
  return { images, textureSpecs, roots: roots.map(root => visit(root, 0)) };
}

// Model disposal is idempotent. GPU objects are released; arena records remain.
export async function loadGLTF(engine, url) {
  let data;
  try { data = await prepare(url); }
  catch (error) {
    if (error instanceof AssetError) throw error;
    throw new AssetError('INVALID_GLTF', 'Invalid glTF structure or URL', error);
  }
  const nodes = [], meshes = [], materials = new Map(), textures = new Map();
  const sceneEpoch = engine._g3_asset_scene_epoch();
  let disposed = false;
  const dispose = () => {
    if (disposed) return;
    disposed = true;
    for (const node of nodes) engine._g3_asset_node_release(node.index, node.generation, node.epoch);
    for (const handle of materials.values()) engine._g3_asset_release_material(handle.id, handle.generation);
    for (const handle of meshes) {
      if (engine._g3_asset_release_mesh(handle.id, handle.generation)) engine._g3_host_release_mesh(handle.id);
    }
    for (const handle of textures.values()) releaseTexture(engine, handle);
  };
  try {
    function getTexture(index, srgb) {
      if (index < 0) return -1;
      const key = `${index}:${srgb ? 'srgb' : 'linear'}`;
      let handle = textures.get(key);
      if (!handle) {
        const spec = data.textureSpecs[index];
        handle = uploadImage(engine, data.images[spec.image], spec.wrapU, spec.wrapV, spec.minFilter, spec.magFilter, srgb);
        textures.set(key, handle);
      }
      return handle.id;
    }
    function createNode(node, parent) {
      const group = engine._g3_asset_node(-1, parent);
      const groupHandle = makeNodeHandle(engine, group);
      if (!groupHandle) throw new AssetError('UPLOAD', 'Could not create node');
      nodes.push(groupHandle);
      node.matrix.forEach((value, index) => engine._g3_asset_matrix(group, index, value));
      for (const p of node.primitives) {
        engine._g3_asset_mesh_begin();
        for (let i = 0; i < p.pos.length / 3; i++) engine._g3_asset_vertex(...p.pos.slice(i*3, i*3+3), ...p.normal.slice(i*3, i*3+3), ...(p.uv ? p.uv.slice(i*2, i*2+2) : [0, 0]));
        for (let i = 0; i < p.indices.length; i += 3) engine._g3_asset_triangle(...p.indices.slice(i, i+3));
        const mesh = engine._g3_asset_mesh_end();
        meshes.push(makeResourceHandle(engine, mesh, 'mesh'));
        const id = engine._g3_asset_node(mesh, group);
        const nodeHandle = makeNodeHandle(engine, id);
        if (!nodeHandle) throw new AssetError('UPLOAD', 'Could not create node');
        nodes.push(nodeHandle);
        let material = materials.get(p.materialIndex);
        if (!material) {
          const materialId = engine._g3_asset_material(...p.color, getTexture(p.textureIndex, true), p.alphaMode, p.alphaCutoff,
            p.metallic, p.roughness, getTexture(p.metallicRoughnessTextureIndex, false), getTexture(p.normalTextureIndex, false), p.normalScale);
          material = makeResourceHandle(engine, materialId, 'material');
          materials.set(p.materialIndex, material);
        }
        engine._g3_asset_node_material(id, material.id);
      }
      for (const child of node.children) createNode(child, group);
      return groupHandle;
    }
    const roots = data.roots.map(root => createNode(root, -1));
    return {
      roots: Object.freeze(roots),
      meshes: Object.freeze([...meshes]),
      materials: Object.freeze([...materials.values()]),
      textures: Object.freeze([...textures.values()]),
      // A nearer object belonging to another model occludes this model.
      pick(canvas, clientX, clientY) {
        if (disposed || sceneEpoch !== engine._g3_asset_scene_epoch()) return null;
        const node = pickNode(engine, canvas, clientX, clientY);
        return node && nodes.some(owned => owned.index === node.index && owned.generation === node.generation && owned.epoch === node.epoch) ? node : null;
      },
      dispose,
    };
  } catch (error) {
    dispose();
    if (error instanceof AssetError) throw error;
    throw new AssetError('UPLOAD', 'Could not upload glTF asset', error);
  }
}
