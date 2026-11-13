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

function decodeRadiance(bytes) {
  const data = new Uint8Array(bytes);
  let offset = 0;
  const readLine = () => {
    const start = offset;
    while (offset < data.length && data[offset] !== 10) offset++;
    if (offset >= data.length) throw new AssetError('HDR', 'Truncated Radiance header');
    let end = offset++;
    if (end > start && data[end - 1] === 13) end--;
    return new TextDecoder('ascii').decode(data.subarray(start, end));
  };
  const magic = readLine();
  if (magic !== '#?RADIANCE' && magic !== '#?RGBE') {
    throw new AssetError('HDR', 'Not a Radiance RGBE image');
  }
  let format = false, line;
  while ((line = readLine()) !== '') if (line === 'FORMAT=32-bit_rle_rgbe') format = true;
  if (!format) throw new AssetError('HDR', 'Unsupported Radiance pixel format');
  const resolution = readLine().match(/^-Y (\d+) \+X (\d+)$/);
  if (!resolution) throw new AssetError('HDR', 'Only -Y +X Radiance orientation is supported');
  const height = Number(resolution[1]), width = Number(resolution[2]);
  if (!Number.isSafeInteger(width) || !Number.isSafeInteger(height) || width < 1 || height < 1 ||
      width > 16384 || height > 16384 || width * height > 16777216) {
    throw new AssetError('HDR', 'Radiance dimensions exceed the supported limit');
  }
  const rgbe = new Uint8Array(width * height * 4);
  const scanline = new Uint8Array(width * 4);
  for (let y = 0; y < height; y++) {
    if (offset + 4 > data.length) throw new AssetError('HDR', 'Truncated Radiance pixels');
    const a = data[offset++], b = data[offset++], hi = data[offset++], lo = data[offset++];
    if (width >= 8 && width <= 32767 && a === 2 && b === 2 && !(hi & 128) && ((hi << 8) | lo) === width) {
      for (let channel = 0; channel < 4; channel++) {
        let x = 0;
        while (x < width) {
          if (offset >= data.length) throw new AssetError('HDR', 'Truncated Radiance RLE data');
          const count = data[offset++];
          if (count > 128) {
            const run = count - 128;
            if (run === 0 || x + run > width || offset >= data.length) throw new AssetError('HDR', 'Invalid Radiance RLE run');
            const value = data[offset++];
            scanline.fill(value, channel * width + x, channel * width + x + run);
            x += run;
          } else {
            if (count === 0 || x + count > width || offset + count > data.length) throw new AssetError('HDR', 'Invalid Radiance RLE literal');
            scanline.set(data.subarray(offset, offset + count), channel * width + x);
            offset += count;
            x += count;
          }
        }
      }
      for (let x = 0; x < width; x++) for (let c = 0; c < 4; c++) rgbe[(y * width + x) * 4 + c] = scanline[c * width + x];
    } else {
      const first = ((y * width) * 4);
      rgbe[first] = a; rgbe[first + 1] = b; rgbe[first + 2] = hi; rgbe[first + 3] = lo;
      const remaining = (width * (height - y) - 1) * 4;
      if (offset + remaining > data.length) throw new AssetError('HDR', 'Truncated Radiance pixels');
      rgbe.set(data.subarray(offset, offset + remaining), first + 4);
      offset += remaining;
      break;
    }
  }
  const pixels = new Float32Array(width * height * 4);
  for (let i = 0; i < rgbe.length; i += 4) {
    const e = rgbe[i + 3], scale = e ? 2 ** (e - 136) : 0;
    pixels[i] = (rgbe[i] + 0.5) * scale;
    pixels[i + 1] = (rgbe[i + 1] + 0.5) * scale;
    pixels[i + 2] = (rgbe[i + 2] + 0.5) * scale;
    pixels[i + 3] = 1;
  }
  return { width, height, pixels };
}

// Load a Radiance .hdr image as linear floating-point equirectangular radiance.
// The caller owns the returned texture and must dispose it once unused.
export async function loadHDRImage(engine, url) {
  const image = decodeRadiance(await fetchBytes(url));
  const ptr = engine._malloc(image.pixels.byteLength);
  if (!ptr) throw new AssetError('MEMORY', 'Could not allocate HDR image upload buffer');
  let handle = null;
  try {
    engine.HEAPF32.set(image.pixels, ptr >>> 2);
    const id = engine._g3_asset_texture();
    if (id < 0) throw new AssetError('MEMORY', 'Could not allocate HDR texture');
    handle = makeResourceHandle(engine, id, 'texture');
    engine._g3_host_texture_hdr(id, ptr, image.width, image.height);
    return { id: handle.id, handle, width: image.width, height: image.height, dispose() {
      if (handle) { releaseTexture(engine, handle); handle = null; }
    } };
  } catch (error) {
    if (handle) releaseTexture(engine, handle);
    throw error;
  } finally { engine._free(ptr); }
}

export function setEnvironmentMap(engine, texture, intensity = 1) {
  let id;
  if (texture === null) id = -1;
  else if (Number.isInteger(texture)) id = texture;
  else if (isTextureHandleValid(engine, texture?.handle ?? texture)) id = (texture?.handle ?? texture).id;
  if (!Number.isInteger(id) || id < -1 || !Number.isFinite(intensity) || intensity < 0) {
    throw new AssetError('ENVIRONMENT', 'Expected a valid texture or null and non-negative finite intensity');
  }
  engine._g3_asset_environment_map(id, intensity);
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

export function setToneMapping(engine, enabled) {
  engine._g3_asset_tone_mapping(enabled ? 1 : 0);
}

export function setExposure(engine, exposure) {
  if (!Number.isFinite(exposure) || !engine._g3_asset_exposure(exposure)) {
    throw new AssetError('EXPOSURE', 'Exposure must be a finite number from 0 to 32');
  }
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
  const widths = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4 };
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
    return { matrix: node.matrix, translation: null, rotation: null, scale: null };
  }
  const translation = node.translation ?? [0, 0, 0];
  const rotation = node.rotation ?? [0, 0, 0, 1];
  const scale = node.scale ?? [1, 1, 1];
  if (!Array.isArray(translation) || translation.length !== 3 || !translation.every(Number.isFinite) ||
      !Array.isArray(rotation) || rotation.length !== 4 || !rotation.every(Number.isFinite) ||
      !Array.isArray(scale) || scale.length !== 3 || !scale.every(Number.isFinite)) invalid('Invalid node transform');
  const qLength = Math.hypot(...rotation);
  if (!(qLength > 0) || !Number.isFinite(qLength)) invalid('Invalid node rotation');
  const normalizedRotation = rotation.map(value => value / qLength);
  const [x, y, z, w] = normalizedRotation;
  const [tx, ty, tz] = translation;
  const [sx, sy, sz] = scale;
  const m = [(1-2*y*y-2*z*z)*sx, (2*x*y+2*z*w)*sx, (2*x*z-2*y*w)*sx, 0,
    (2*x*y-2*z*w)*sy, (1-2*x*x-2*z*z)*sy, (2*y*z+2*x*w)*sy, 0,
    (2*x*z+2*y*w)*sz, (2*y*z-2*x*w)*sz, (1-2*x*x-2*y*y)*sz, 0, tx, ty, tz, 1];
  if (!m.every(Number.isFinite)) invalid('Invalid node transform');
  return { matrix: m, translation: [...translation], rotation: normalizedRotation, scale: [...scale] };
}

function normalizedQuaternion(q) {
  const length = Math.hypot(...q);
  if (!(length > 0) || !Number.isFinite(length)) invalid('Invalid animation rotation');
  return q.map(value => value / length);
}

function sampleChannel(channel, time) {
  const times = channel.times;
  let low = 0, high = times.length;
  while (low < high) {
    const middle = (low + high) >>> 1;
    if (times[middle] <= time) low = middle + 1;
    else high = middle;
  }
  const a = Math.max(0, low - 1), b = Math.min(times.length - 1, low);
  const cubic = channel.interpolation === 'CUBICSPLINE';
  const valueAt = index => {
    const valueIndex = cubic ? index * 3 + 1 : index;
    return channel.values.slice(valueIndex * channel.components, (valueIndex + 1) * channel.components);
  };
  const from = valueAt(a);
  if (a === b || channel.interpolation === 'STEP') return channel.path === 'rotation' ? normalizedQuaternion(from) : from;
  const duration = times[b] - times[a];
  const t = Math.max(0, Math.min(1, (time - times[a]) / duration));
  const to = valueAt(b);
  if (cubic) {
    const tangentAt = (index, tangent) => {
      const valueIndex = index * 3 + tangent;
      return channel.values.slice(valueIndex * channel.components, (valueIndex + 1) * channel.components);
    };
    const outTangent = tangentAt(a, 2), inTangent = tangentAt(b, 0);
    const t2 = t * t, t3 = t2 * t;
    const h00 = 2 * t3 - 3 * t2 + 1, h10 = t3 - 2 * t2 + t;
    const h01 = -2 * t3 + 3 * t2, h11 = t3 - t2;
    const result = from.map((value, i) => h00 * value + h10 * duration * outTangent[i] +
      h01 * to[i] + h11 * duration * inTangent[i]);
    if (!result.every(Number.isFinite)) invalid('Invalid cubic animation value');
    return channel.path === 'rotation' ? normalizedQuaternion(result) : result;
  }
  if (channel.path !== 'rotation') return from.map((value, i) => value + (to[i] - value) * t);
  const q1 = normalizedQuaternion(from), q2 = normalizedQuaternion(to);
  let cosine = q1.reduce((sum, value, i) => sum + value * q2[i], 0);
  if (cosine < 0) { cosine = -cosine; for (let i = 0; i < 4; i++) q2[i] = -q2[i]; }
  if (cosine > 0.9995) return normalizedQuaternion(q1.map((value, i) => value + (q2[i] - value) * t));
  const angle = Math.acos(Math.max(-1, Math.min(1, cosine))), sine = Math.sin(angle);
  const weightA = Math.sin((1 - t) * angle) / sine, weightB = Math.sin(t * angle) / sine;
  return normalizedQuaternion(q1.map((value, i) => value * weightA + q2[i] * weightB));
}

async function prepare(url) {
  const absolute = new URL(url, globalThis.location?.href || 'http://localhost/');
  const { json, bin } = unpack(await fetchBytes(absolute));
  let doc;
  try { doc = JSON.parse(new TextDecoder().decode(json)); }
  catch (error) { throw new AssetError('INVALID_GLTF', 'Invalid glTF JSON', error); }
  if (doc.asset?.version !== '2.0') unsupported('Only glTF 2.0 is supported');
  if (doc.extensionsRequired?.length || doc.skins?.length) unsupported('Required extensions and skins are not supported');
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
    if (material.doubleSided || material.extensions) unsupported('Unsupported material feature');
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
    let occlusionTextureIndex = -1;
    const occlusionStrength = material.occlusionTexture?.strength ?? 1;
    if (material.occlusionTexture) {
      if (!uv || (material.occlusionTexture.texCoord || 0) !== 0 || material.occlusionTexture.extensions) unsupported('Unsupported occlusion texture coordinates');
      item(textureSpecs, material.occlusionTexture.index, 'occlusion texture');
      if (!Number.isFinite(occlusionStrength) || occlusionStrength < 0 || occlusionStrength > 1) invalid('Invalid occlusion strength');
      occlusionTextureIndex = material.occlusionTexture.index;
    }
    const emissive = material.emissiveFactor ?? [0, 0, 0];
    if (!Array.isArray(emissive) || emissive.length !== 3 || !emissive.every(value => Number.isFinite(value) && value >= 0 && value <= 1)) invalid('Invalid emissive factor');
    let emissiveTextureIndex = -1;
    if (material.emissiveTexture) {
      if (!uv || (material.emissiveTexture.texCoord || 0) !== 0 || material.emissiveTexture.extensions) unsupported('Unsupported emissive texture coordinates');
      item(textureSpecs, material.emissiveTexture.index, 'emissive texture');
      emissiveTextureIndex = material.emissiveTexture.index;
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
      normalTextureIndex, normalScale, occlusionTextureIndex, occlusionStrength,
      emissive, emissiveTextureIndex, materialIndex: p.material ?? -1 };
  }));
  const nodes = doc.nodes || [], roots = item(doc.scenes, doc.scene ?? 0, 'scene').nodes || [];
  const seen = new Set();
  function visit(index, depth) {
    if (depth > 63 || seen.has(index)) invalid('Invalid or overly deep node hierarchy');
    seen.add(index);
    const n = item(nodes, index, 'node');
    if (n.skin !== undefined || n.weights || n.extensions) unsupported('Unsupported node feature');
    const primitives = n.mesh === undefined ? [] : item(meshes, n.mesh, 'mesh');
    const transform = localMatrix(n);
    return { index, ...transform, primitives, children: (n.children || []).map(child => visit(child, depth + 1)) };
  }
  const sceneRoots = roots.map(root => visit(root, 0));
  const sceneNodeIndices = new Set(seen);
  const animations = (doc.animations || []).map((animation, animationIndex) => {
    if (!Array.isArray(animation.channels) || !animation.channels.length || !Array.isArray(animation.samplers)) invalid(`Invalid animation ${animationIndex}`);
    if (animation.extensions) unsupported('Animation extensions are not supported');
    const usedTargets = new Set();
    let duration = 0;
    const channels = animation.channels.map(channel => {
      const sampler = item(animation.samplers, channel.sampler, 'animation sampler');
      const target = channel.target;
      if (!target || !Number.isInteger(target.node) || target.node < 0 || target.node >= nodes.length) invalid('Invalid animation target');
      if (channel.extensions || target.extensions || sampler.extensions) unsupported('Animation extensions are not supported');
      const path = target.path;
      if (!['translation', 'rotation', 'scale'].includes(path)) unsupported(`Animation target path ${path} is unsupported`);
      const sourceNode = item(nodes, target.node, 'animation node');
      if (sourceNode.matrix) unsupported('Animation channels cannot target nodes using matrix transforms');
      const targetKey = `${target.node}:${path}`;
      if (usedTargets.has(targetKey)) invalid('Animation targets the same node property more than once');
      usedTargets.add(targetKey);
      const interpolation = sampler.interpolation ?? 'LINEAR';
      if (interpolation !== 'LINEAR' && interpolation !== 'STEP' && interpolation !== 'CUBICSPLINE') unsupported(`Animation interpolation ${interpolation} is unsupported`);
      const input = accessor(doc, buffers, sampler.input, 'SCALAR');
      const output = accessor(doc, buffers, sampler.output, path === 'rotation' ? 'VEC4' : 'VEC3');
      const expectedOutputCount = interpolation === 'CUBICSPLINE' ? input.count * 3 : input.count;
      if (input.componentType !== 5126 || output.componentType !== 5126 || input.count < 1 || output.count !== expectedOutputCount ||
          (interpolation === 'CUBICSPLINE' && input.count < 2)) invalid('Invalid animation accessor types or counts');
      for (let i = 0; i < input.values.length; i++) {
        const time = input.values[i];
        if (time < 0 || (i > 0 && time <= input.values[i - 1])) invalid('Animation input times must be non-negative and strictly increasing');
      }
      if (path === 'rotation') for (let i = interpolation === 'CUBICSPLINE' ? 4 : 0; i < output.values.length; i += interpolation === 'CUBICSPLINE' ? 12 : 4) {
        if (!(Math.hypot(output.values[i], output.values[i + 1], output.values[i + 2], output.values[i + 3]) > 0)) invalid('Animation rotations must be non-zero quaternions');
      }
      duration = Math.max(duration, input.values[input.values.length - 1]);
      return { node: target.node, path, interpolation, times: input.values, values: output.values, components: path === 'rotation' ? 4 : 3,
        enabled: sceneNodeIndices.has(target.node) };
    });
    return { name: typeof animation.name === 'string' ? animation.name : `Animation ${animationIndex}`, duration, channels };
  });
  return { images, textureSpecs, roots: sceneRoots, animations };
}

// Model disposal is idempotent. GPU objects are released; arena records remain.
export async function loadGLTF(engine, url) {
  let data;
  try { data = await prepare(url); }
  catch (error) {
    if (error instanceof AssetError) throw error;
    throw new AssetError('INVALID_GLTF', 'Invalid glTF structure or URL', error);
  }
  const nodes = [], meshes = [], materials = new Map(), textures = new Map(), transformNodes = new Map();
  const sceneEpoch = engine._g3_asset_scene_epoch();
  let disposed = false;
  let activeAnimation = -1, animationTime = 0, animationPlaying = false, animationLoop = true;
  let touchedTransforms = new Set();
  const writeTransform = state => {
    if (!isNodeHandleValid(engine, state.handle)) return;
    const matrix = localMatrix({ translation: state.translation, rotation: state.rotation, scale: state.scale }).matrix;
    matrix.forEach((value, index) => engine._g3_asset_matrix(state.handle.index, index, value));
  };
  const restoreBase = state => {
    state.translation = [...state.baseTranslation];
    state.rotation = [...state.baseRotation];
    state.scale = [...state.baseScale];
  };
  const applyAnimation = (index, time) => {
    if (sceneEpoch !== engine._g3_asset_scene_epoch()) return false;
    const animation = index < 0 ? null : data.animations[index];
    const nextTouched = new Set();
    for (const channel of animation?.channels ?? []) if (channel.enabled && transformNodes.has(channel.node)) nextTouched.add(channel.node);
    for (const nodeIndex of touchedTransforms) if (!nextTouched.has(nodeIndex)) {
      const state = transformNodes.get(nodeIndex);
      restoreBase(state);
      writeTransform(state);
    }
    for (const nodeIndex of nextTouched) restoreBase(transformNodes.get(nodeIndex));
    for (const channel of animation?.channels ?? []) {
      const state = transformNodes.get(channel.node);
      if (!channel.enabled || !state || !isNodeHandleValid(engine, state.handle)) continue;
      state[channel.path] = sampleChannel(channel, time);
    }
    for (const nodeIndex of nextTouched) writeTransform(transformNodes.get(nodeIndex));
    touchedTransforms = nextTouched;
    return true;
  };
  const dispose = () => {
    if (disposed) return;
    disposed = true;
    animationPlaying = false;
    for (const node of nodes) engine._g3_asset_node_release(node.index, node.generation, node.epoch);
    for (const handle of materials.values()) engine._g3_asset_release_material(handle.id, handle.generation);
    for (const handle of meshes) {
      if (engine._g3_asset_release_mesh(handle.id, handle.generation)) engine._g3_host_release_mesh(handle.id);
    }
    for (const handle of textures.values()) releaseTexture(engine, handle);
    for (const animation of data.animations) for (const channel of animation.channels) {
      channel.times.length = 0;
      channel.values.length = 0;
    }
    transformNodes.clear();
    touchedTransforms.clear();
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
      if (node.translation) transformNodes.set(node.index, {
        handle: groupHandle,
        baseTranslation: [...node.translation], translation: [...node.translation],
        baseRotation: [...node.rotation], rotation: [...node.rotation],
        baseScale: [...node.scale], scale: [...node.scale],
      });
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
            p.metallic, p.roughness, getTexture(p.metallicRoughnessTextureIndex, false), getTexture(p.normalTextureIndex, false), p.normalScale,
            getTexture(p.occlusionTextureIndex, false), p.occlusionStrength, ...p.emissive,
            getTexture(p.emissiveTextureIndex, true));
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
      animations: Object.freeze(data.animations.map(({ name, duration }, index) => Object.freeze({ index, name, duration }))),
      meshes: Object.freeze([...meshes]),
      materials: Object.freeze([...materials.values()]),
      textures: Object.freeze([...textures.values()]),
      playAnimation(index = 0, { loop = true } = {}) {
        if (disposed || sceneEpoch !== engine._g3_asset_scene_epoch() || !Number.isInteger(index) || index < 0 || index >= data.animations.length) return false;
        activeAnimation = index; animationTime = 0; animationLoop = !!loop; animationPlaying = data.animations[index].duration > 0;
        return applyAnimation(activeAnimation, animationTime);
      },
      pauseAnimation() {
        if (disposed || activeAnimation < 0) return false;
        animationPlaying = false;
        return true;
      },
      resumeAnimation() {
        if (disposed || activeAnimation < 0) return false;
        const duration = data.animations[activeAnimation].duration;
        if (duration <= 0 || (!animationLoop && animationTime >= duration)) return false;
        animationPlaying = true;
        return true;
      },
      stopAnimation() {
        if (disposed) return false;
        animationPlaying = false; activeAnimation = -1; animationTime = 0;
        return applyAnimation(-1, 0);
      },
      seekAnimation(time) {
        if (disposed || activeAnimation < 0 || !Number.isFinite(time) || time < 0) return false;
        const duration = data.animations[activeAnimation].duration;
        animationTime = Math.min(time, duration);
        if (!animationLoop && animationTime >= duration) animationPlaying = false;
        return applyAnimation(activeAnimation, animationTime);
      },
      update(dt) {
        if (disposed || sceneEpoch !== engine._g3_asset_scene_epoch() || !Number.isFinite(dt) || dt < 0) return false;
        if (!animationPlaying || activeAnimation < 0) return true;
        const duration = data.animations[activeAnimation].duration;
        animationTime += dt;
        if (animationLoop && duration > 0) animationTime %= duration;
        else if (animationTime >= duration) { animationTime = duration; animationPlaying = false; }
        return applyAnimation(activeAnimation, animationTime);
      },
      get activeAnimation() { return activeAnimation; },
      get animationTime() { return animationTime; },
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
