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

function uploadImage(engine, image, wrapU = 0, wrapV = 0, minFilter = 9729, magFilter = 9729) {
  const ptr = engine._malloc(image.pixels.length);
  if (!ptr) throw new AssetError('MEMORY', 'Could not allocate image upload buffer');
  let id = -1;
  try {
    engine.HEAPU8.set(image.pixels, ptr);
    id = engine._g3_asset_texture();
    if (id < 0) throw new AssetError('MEMORY', 'Could not allocate texture');
    engine._g3_host_texture(id, ptr, image.width, image.height);
    engine._g3_host_texture_wrap(id, wrapU, wrapV);
    engine._g3_host_texture_filter(id, minFilter, magFilter);
    return id;
  } catch (error) {
    if (id >= 0) releaseTexture(engine, id);
    throw error;
  } finally { engine._free(ptr); }
}

function releaseTexture(engine, id) {
  engine._g3_host_release_texture(id);
  engine._g3_asset_release_texture(id);
}

// The caller owns the returned texture and must dispose it once unused.
export async function loadImage(engine, url) {
  const bytes = await fetchBytes(url);
  const image = await decodeImage(bytes, '');
  const id = uploadImage(engine, image);
  let disposed = false;
  return { id, width: image.width, height: image.height, dispose() {
    if (!disposed) { disposed = true; releaseTexture(engine, id); }
  } };
}

const invalid = message => { throw new AssetError('INVALID_GLTF', message); };
const unsupported = message => { throw new AssetError('UNSUPPORTED', message); };
const item = (array, index, name) => {
  if (!Array.isArray(array) || !Number.isInteger(index) || index < 0 || index >= array.length) invalid(`Invalid ${name} index ${index}`);
  return array[index];
};

// Client coordinates work with CSS-scaled and high-DPI canvases. Return the
// nearest visible front-facing mesh node, or null when there is no hit.
export function pickNode(engine, canvas, clientX, clientY) {
  const rect = canvas.getBoundingClientRect();
  if (!Number.isFinite(clientX) || !Number.isFinite(clientY) || rect.width <= 0 || rect.height <= 0 ||
      clientX < rect.left || clientX >= rect.right || clientY < rect.top || clientY >= rect.bottom) return null;
  const x = (clientX - rect.left) / rect.width * 2 - 1;
  const y = 1 - (clientY - rect.top) / rect.height * 2;
  const node = engine._g3_asset_pick(x, y, rect.width / rect.height);
  return node < 0 ? null : node;
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
    if (material.doubleSided || material.normalTexture || material.occlusionTexture || material.emissiveTexture || material.extensions) unsupported('Unsupported material feature');
    const alphaModes = { OPAQUE: 0, MASK: 1, BLEND: 2 };
    const mode = material.alphaMode ?? 'OPAQUE';
    if (!Object.hasOwn(alphaModes, mode)) invalid('Invalid alpha mode');
    const cutoff = material.alphaCutoff ?? 0.5;
    if (!Number.isFinite(cutoff) || cutoff < 0) invalid('Invalid alpha cutoff');
    const pbr = material.pbrMetallicRoughness || {};
    if (pbr.metallicRoughnessTexture) unsupported('Metallic-roughness textures are not supported');
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
      alphaMode: alphaModes[mode], alphaCutoff: cutoff };
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
  const nodes = [], meshes = [], textures = [];
  const sceneEpoch = engine._g3_asset_scene_epoch();
  let disposed = false;
  const dispose = () => {
    if (disposed) return;
    disposed = true;
    if (sceneEpoch === engine._g3_asset_scene_epoch()) {
      for (const id of nodes) engine._g3_asset_hide(id);
    }
    for (const id of meshes) {
      engine._g3_host_release_mesh(id);
      engine._g3_asset_release_mesh(id);
    }
    for (const id of textures) releaseTexture(engine, id);
  };
  try {
    for (const spec of data.textureSpecs) textures.push(uploadImage(engine, data.images[spec.image], spec.wrapU, spec.wrapV, spec.minFilter, spec.magFilter));
    function createNode(node, parent) {
      const group = engine._g3_asset_node(-1, parent);
      nodes.push(group);
      node.matrix.forEach((value, index) => engine._g3_asset_matrix(group, index, value));
      for (const p of node.primitives) {
        engine._g3_asset_mesh_begin();
        for (let i = 0; i < p.pos.length / 3; i++) engine._g3_asset_vertex(...p.pos.slice(i*3, i*3+3), ...p.normal.slice(i*3, i*3+3), ...(p.uv ? p.uv.slice(i*2, i*2+2) : [0, 0]));
        for (let i = 0; i < p.indices.length; i += 3) engine._g3_asset_triangle(...p.indices.slice(i, i+3));
        const mesh = engine._g3_asset_mesh_end();
        meshes.push(mesh);
        const id = engine._g3_asset_node(mesh, group);
        nodes.push(id);
        engine._g3_asset_material(id, ...p.color, p.textureIndex < 0 ? -1 : textures[p.textureIndex], p.alphaMode, p.alphaCutoff);
      }
      for (const child of node.children) createNode(child, group);
      return group;
    }
    const roots = data.roots.map(root => createNode(root, -1));
    return {
      roots,
      // A nearer object belonging to another model occludes this model.
      pick(canvas, clientX, clientY) {
        if (disposed || sceneEpoch !== engine._g3_asset_scene_epoch()) return null;
        const node = pickNode(engine, canvas, clientX, clientY);
        return nodes.includes(node) ? node : null;
      },
      dispose,
    };
  } catch (error) {
    dispose();
    if (error instanceof AssetError) throw error;
    throw new AssetError('UPLOAD', 'Could not upload glTF asset', error);
  }
}
