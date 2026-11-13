// Browser asset loading for the WebAssembly host. All parsing precedes uploads.
const MAX_GPU_MORPH_BYTES = 64 * 1024 * 1024;
const MAX_ACCESSOR_VALUES = 8 * 1024 * 1024;

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
  engine._g3_asset_release_texture(handle.id, handle.generation);
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

export function setToneMapping(engine, mode) {
  const modes = { none: 0, reinhard: 1, aces: 2 };
  const value = typeof mode === 'boolean' ? (mode ? modes.aces : modes.none) : modes[mode];
  if (!Number.isInteger(value) || !engine._g3_asset_tone_mapping(value)) {
    throw new AssetError('TONE_MAPPING', `Unsupported tone mapping mode: ${mode}`);
  }
}

export function setFXAA(engine, enabled) {
  if (typeof enabled !== 'boolean') throw new AssetError('POST_PROCESS', 'FXAA must be enabled or disabled with a boolean');
  engine._g3_asset_fxaa(enabled ? 1 : 0);
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
    return { json, bin, glb: true };
  }
  return { json: bytes, bin: undefined, glb: false };
}

function accessor(doc, buffers, index, expected) {
  const a = item(doc.accessors, index, 'accessor');
  if (a.type !== expected) invalid(`Expected ${expected} accessor`);
  if (a.normalized !== undefined && typeof a.normalized !== 'boolean') invalid('Invalid accessor normalized flag');
  const widths = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4, MAT4: 16 };
  const formats = { 5120: [1, 'getInt8'], 5121: [1, 'getUint8'], 5122: [2, 'getInt16'],
    5123: [2, 'getUint16'], 5125: [4, 'getUint32'], 5126: [4, 'getFloat32'] };
  const format = formats[a.componentType], components = widths[expected];
  if (!format || !components || !Number.isInteger(a.count) || a.count < 1) unsupported('Unsupported accessor component type or count');
  if (a.normalized && ![5120, 5121, 5122, 5123].includes(a.componentType)) unsupported('Unsupported normalized accessor');
  const valueCount = a.count * components;
  if (!Number.isSafeInteger(valueCount) || valueCount > MAX_ACCESSOR_VALUES) invalid('Accessor is too large');
  const size = format[0] * components, values = new Array(valueCount).fill(0);
  let effectiveStride = size, effectiveOffset = 0;
  const readView = (viewIndex, label) => {
    const bv = item(doc.bufferViews, viewIndex, `${label} bufferView`);
    const buffer = item(buffers, bv.buffer, `${label} buffer`);
    const start = bv.byteOffset ?? 0;
    if (!Number.isSafeInteger(start) || start < 0 || !Number.isSafeInteger(bv.byteLength) || bv.byteLength < 0 ||
        !Number.isSafeInteger(start + bv.byteLength) || start + bv.byteLength > buffer.byteLength) invalid(`Invalid ${label} bufferView`);
    return { view: new DataView(buffer), start, end: start + bv.byteLength, byteStride: bv.byteStride };
  };
  const readValue = (data, offset) => {
    let value = data[format[1]](offset, true);
    if (a.normalized) value = a.componentType === 5120 ? Math.max(value / 127, -1) :
      a.componentType === 5122 ? Math.max(value / 32767, -1) : value / (a.componentType === 5121 ? 255 : 65535);
    if (!Number.isFinite(value)) invalid('Non-finite accessor value');
    return value;
  };
  if (a.bufferView !== undefined) {
    const base = readView(a.bufferView, 'accessor'), offset = a.byteOffset ?? 0;
    const stride = base.byteStride ?? size;
    if (!Number.isSafeInteger(offset) || offset < 0 || !Number.isSafeInteger(stride) || stride < size ||
        stride % format[0] !== 0 || base.start % format[0] !== 0 || offset % format[0] !== 0 ||
        (base.byteStride !== undefined && (stride < 4 || stride > 252 || stride % 4 !== 0))) invalid('Invalid accessor alignment or stride');
    const start = base.start + offset, end = start + (a.count - 1) * stride + size;
    if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || end > base.end) invalid('Accessor exceeds its buffer view');
    effectiveStride = stride; effectiveOffset = start;
    for (let i = 0; i < a.count; i++) for (let c = 0; c < components; c++) {
      values[i * components + c] = readValue(base.view, start + i * stride + c * format[0]);
    }
  } else if (a.byteOffset !== undefined && a.byteOffset !== 0) {
    invalid('An accessor without a bufferView cannot have a byteOffset');
  }
  if (a.sparse !== undefined) {
    const sparse = a.sparse;
    if (!sparse || typeof sparse !== 'object' || !Number.isSafeInteger(sparse.count) ||
        sparse.count < 1 || sparse.count > a.count || !sparse.indices || !sparse.values) invalid('Invalid sparse accessor');
    const indexFormats = { 5121: [1, 'getUint8'], 5123: [2, 'getUint16'], 5125: [4, 'getUint32'] };
    const indexFormat = indexFormats[sparse.indices.componentType];
    if (!indexFormat) invalid('Invalid sparse index component type');
    const indices = readView(sparse.indices.bufferView, 'sparse indices');
    const indexOffset = sparse.indices.byteOffset ?? 0, indexSize = indexFormat[0];
    if (indices.byteStride !== undefined || !Number.isSafeInteger(indexOffset) || indexOffset < 0 ||
        indices.start % indexSize !== 0 || indexOffset % indexSize !== 0 ||
        indexOffset + sparse.count * indexSize > indices.end - indices.start) {
      invalid('Invalid sparse index buffer range');
    }
    const sparseValues = readView(sparse.values.bufferView, 'sparse values');
    const valuesOffset = sparse.values.byteOffset ?? 0;
    if (sparseValues.byteStride !== undefined || !Number.isSafeInteger(valuesOffset) || valuesOffset < 0 ||
        sparseValues.start % format[0] !== 0 || valuesOffset % format[0] !== 0 ||
        valuesOffset + sparse.count * size > sparseValues.end - sparseValues.start) {
      invalid('Invalid sparse value buffer range');
    }
    let previous = -1;
    for (let i = 0; i < sparse.count; i++) {
      const target = indices.view[indexFormat[1]](indices.start + indexOffset + i * indexSize, true);
      if (target <= previous || target >= a.count) invalid('Sparse indices must be increasing and within the accessor');
      previous = target;
      for (let c = 0; c < components; c++) {
        values[target * components + c] = readValue(sparseValues.view, sparseValues.start + valuesOffset + i * size + c * format[0]);
      }
    }
  } else if (a.bufferView === undefined) {
    invalid('An accessor without a bufferView must be sparse');
  }
  return { values, count: a.count, componentType: a.componentType, normalized: !!a.normalized,
    byteStride: effectiveStride, byteOffset: effectiveOffset };
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

function multiply4(a, b) {
  const out = new Array(16).fill(0);
  for (let column = 0; column < 4; column++) for (let row = 0; row < 4; row++) {
    for (let k = 0; k < 4; k++) out[column * 4 + row] += a[k * 4 + row] * b[column * 4 + k];
  }
  return out;
}

function invert4(matrix) {
  const rows = Array.from({ length: 4 }, (_, row) => [
    matrix[row], matrix[4 + row], matrix[8 + row], matrix[12 + row],
    +(row === 0), +(row === 1), +(row === 2), +(row === 3),
  ]);
  for (let column = 0; column < 4; column++) {
    let pivot = column;
    for (let row = column + 1; row < 4; row++) if (Math.abs(rows[row][column]) > Math.abs(rows[pivot][column])) pivot = row;
    if (!(Math.abs(rows[pivot][column]) > 0)) invalid('Singular skinned mesh transform');
    [rows[column], rows[pivot]] = [rows[pivot], rows[column]];
    const scale = rows[column][column];
    for (let c = 0; c < 8; c++) rows[column][c] /= scale;
    for (let row = 0; row < 4; row++) if (row !== column) {
      const factor = rows[row][column];
      for (let c = 0; c < 8; c++) rows[row][c] -= factor * rows[column][c];
    }
  }
  const out = new Array(16);
  for (let row = 0; row < 4; row++) for (let column = 0; column < 4; column++) out[column * 4 + row] = rows[row][column + 4];
  if (!out.every(Number.isFinite)) invalid('Invalid skinned mesh transform');
  return out;
}

function transformPoint4(matrix, point) {
  const x = point[0], y = point[1], z = point[2];
  const w = matrix[3] * x + matrix[7] * y + matrix[11] * z + matrix[15];
  if (!(Math.abs(w) > 0) || !Number.isFinite(w)) invalid('Invalid skinned position');
  return [(matrix[0] * x + matrix[4] * y + matrix[8] * z + matrix[12]) / w,
    (matrix[1] * x + matrix[5] * y + matrix[9] * z + matrix[13]) / w,
    (matrix[2] * x + matrix[6] * y + matrix[10] * z + matrix[14]) / w];
}

function transformDirection4(matrix, direction) {
  const x = direction[0], y = direction[1], z = direction[2];
  return [matrix[0] * x + matrix[4] * y + matrix[8] * z,
    matrix[1] * x + matrix[5] * y + matrix[9] * z,
    matrix[2] * x + matrix[6] * y + matrix[10] * z];
}

function normalize3(vector) {
  const length = Math.hypot(...vector);
  if (!(length > 0) || !Number.isFinite(length)) invalid('Invalid skinned normal');
  return vector.map(value => value / length);
}

function generateVertexNormals(positions, indices) {
  const normals = new Array(positions.length).fill(0);
  for (let i = 0; i < indices.length; i += 3) {
    const a = indices[i] * 3, b = indices[i + 1] * 3, c = indices[i + 2] * 3;
    const abx = positions[b] - positions[a], aby = positions[b + 1] - positions[a + 1], abz = positions[b + 2] - positions[a + 2];
    const acx = positions[c] - positions[a], acy = positions[c + 1] - positions[a + 1], acz = positions[c + 2] - positions[a + 2];
    const nx = aby * acz - abz * acy, ny = abz * acx - abx * acz, nz = abx * acy - aby * acx;
    if (![nx, ny, nz].every(Number.isFinite)) invalid('Cannot generate finite vertex normals');
    for (const vertex of [a, b, c]) {
      normals[vertex] += nx;
      normals[vertex + 1] += ny;
      normals[vertex + 2] += nz;
    }
  }
  for (let i = 0; i < normals.length; i += 3) {
    const length = Math.hypot(normals[i], normals[i + 1], normals[i + 2]);
    if (length > 0 && Number.isFinite(length)) {
      normals[i] /= length; normals[i + 1] /= length; normals[i + 2] /= length;
    } else {
      normals[i] = 0; normals[i + 1] = 0; normals[i + 2] = 1;
    }
  }
  return normals;
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

function identityUvTransform() { return { offset: [0, 0], scale: [1, 1], rotation: 0, texcoord: 0 }; }
function parseTextureTransform(info, extensionsUsed) {
  const outerTexCoord = info.texCoord === undefined ? 0 : info.texCoord;
  if (!Number.isInteger(outerTexCoord) || outerTexCoord < 0) invalid('Invalid texture coordinate set');
  if (outerTexCoord > 7) unsupported('Only TEXCOORD_0 through TEXCOORD_7 are supported');
  if (info.extensions === undefined) {
    return { ...identityUvTransform(), texcoord: outerTexCoord };
  }
  if (!info.extensions || typeof info.extensions !== 'object' || Array.isArray(info.extensions)) invalid('Invalid texture extensions');
  const keys = Object.keys(info.extensions);
  if (keys.some(extension => extension !== 'KHR_texture_transform')) unsupported('Unsupported texture feature');
  if (!keys.length) return { ...identityUvTransform(), texcoord: outerTexCoord };
  if (!extensionsUsed.includes('KHR_texture_transform')) invalid('KHR_texture_transform must be listed in extensionsUsed');
  const extension = info.extensions.KHR_texture_transform;
  if (!extension || typeof extension !== 'object' || Array.isArray(extension)) invalid('Invalid KHR_texture_transform extension');
  const texCoord = extension.texCoord === undefined ? outerTexCoord : extension.texCoord;
  if (!Number.isInteger(texCoord) || texCoord < 0) invalid('Invalid texture coordinate set');
  if (texCoord > 7) unsupported('Only TEXCOORD_0 through TEXCOORD_7 are supported');
  const offset = extension.offset === undefined ? [0, 0] : extension.offset;
  const scale = extension.scale === undefined ? [1, 1] : extension.scale;
  const rotation = extension.rotation === undefined ? 0 : extension.rotation;
  if (!Array.isArray(offset) || offset.length !== 2 || !offset.every(Number.isFinite) ||
      !Array.isArray(scale) || scale.length !== 2 || !scale.every(Number.isFinite) || !Number.isFinite(rotation)) invalid('Invalid texture transform');
  return { offset, scale, rotation, texcoord: texCoord };
}

function parseMaterial(doc, textureSpecs, materialIndex, availableUvSets, extensionsUsed) {
  const material = materialIndex === undefined ? {} : item(doc.materials, materialIndex, 'material');
  if (material.name !== undefined && typeof material.name !== 'string') invalid('Invalid material name');
  let unlit = false, emissiveStrength = 1, ior = 1.5;
  let clearcoatFactor = 0, clearcoatRoughness = 0, clearcoatExtension = null;
  let specularFactor = 1, specularColorFactor = [1, 1, 1], specularExtension = null;
  if (material.extensions !== undefined) {
    if (!material.extensions || typeof material.extensions !== 'object' || Array.isArray(material.extensions)) invalid('Invalid material extensions');
    const materialExtensions = Object.keys(material.extensions);
    if (materialExtensions.some(extension => !['KHR_materials_unlit', 'KHR_materials_emissive_strength', 'KHR_materials_ior', 'KHR_materials_specular', 'KHR_materials_clearcoat'].includes(extension))) unsupported('Unsupported material feature');
    if (materialExtensions.includes('KHR_materials_unlit')) {
      if (!extensionsUsed.includes('KHR_materials_unlit')) invalid('KHR_materials_unlit must be listed in extensionsUsed');
      const extension = material.extensions.KHR_materials_unlit;
      if (!extension || typeof extension !== 'object' || Array.isArray(extension)) invalid('Invalid KHR_materials_unlit extension');
      unlit = true;
    }
    if (materialExtensions.includes('KHR_materials_emissive_strength')) {
      if (!extensionsUsed.includes('KHR_materials_emissive_strength')) invalid('KHR_materials_emissive_strength must be listed in extensionsUsed');
      const extension = material.extensions.KHR_materials_emissive_strength;
      if (!extension || typeof extension !== 'object' || Array.isArray(extension)) invalid('Invalid KHR_materials_emissive_strength extension');
      emissiveStrength = extension.emissiveStrength ?? 1;
      if (!Number.isFinite(emissiveStrength) || emissiveStrength < 0) invalid('Invalid emissive strength');
    }
    if (materialExtensions.includes('KHR_materials_ior')) {
      if (!extensionsUsed.includes('KHR_materials_ior')) invalid('KHR_materials_ior must be listed in extensionsUsed');
      const extension = material.extensions.KHR_materials_ior;
      if (!extension || typeof extension !== 'object' || Array.isArray(extension)) invalid('Invalid KHR_materials_ior extension');
      ior = extension.ior ?? 1.5;
      if (!Number.isFinite(ior) || ior < 1 || ior > 2.333) invalid('Invalid index of refraction');
    }
    if (materialExtensions.includes('KHR_materials_specular')) {
      if (!extensionsUsed.includes('KHR_materials_specular')) invalid('KHR_materials_specular must be listed in extensionsUsed');
      specularExtension = material.extensions.KHR_materials_specular;
      if (!specularExtension || typeof specularExtension !== 'object' || Array.isArray(specularExtension)) invalid('Invalid KHR_materials_specular extension');
      specularFactor = specularExtension.specularFactor ?? 1;
      specularColorFactor = specularExtension.specularColorFactor ?? [1, 1, 1];
      if (!Number.isFinite(specularFactor) || specularFactor < 0 || specularFactor > 1) invalid('Invalid specular factor');
      if (!Array.isArray(specularColorFactor) || specularColorFactor.length !== 3 ||
          !specularColorFactor.every(value => Number.isFinite(value) && value >= 0)) invalid('Invalid specular color factor');
      if (unlit) invalid('KHR_materials_specular cannot be combined with KHR_materials_unlit');
    }
    if (materialExtensions.includes('KHR_materials_clearcoat')) {
      if (!extensionsUsed.includes('KHR_materials_clearcoat')) invalid('KHR_materials_clearcoat must be listed in extensionsUsed');
      clearcoatExtension = material.extensions.KHR_materials_clearcoat;
      if (!clearcoatExtension || typeof clearcoatExtension !== 'object' || Array.isArray(clearcoatExtension)) invalid('Invalid KHR_materials_clearcoat extension');
      clearcoatFactor = clearcoatExtension.clearcoatFactor ?? 0;
      clearcoatRoughness = clearcoatExtension.clearcoatRoughnessFactor ?? 0;
      if (![clearcoatFactor, clearcoatRoughness].every(value => Number.isFinite(value) && value >= 0 && value <= 1)) invalid('Invalid clearcoat factor');
      if (unlit) invalid('KHR_materials_clearcoat cannot be combined with KHR_materials_unlit');
    }
  }
  if (material.doubleSided !== undefined && typeof material.doubleSided !== 'boolean') invalid('Invalid doubleSided material flag');
  const alphaModes = { OPAQUE: 0, MASK: 1, BLEND: 2 };
  const mode = material.alphaMode ?? 'OPAQUE';
  if (!Object.hasOwn(alphaModes, mode)) invalid('Invalid alpha mode');
  const cutoff = material.alphaCutoff ?? 0.5;
  if (!Number.isFinite(cutoff) || cutoff < 0) invalid('Invalid alpha cutoff');
  const pbr = material.pbrMetallicRoughness || {};
  const baseUvTransform = pbr.baseColorTexture ? parseTextureTransform(pbr.baseColorTexture, extensionsUsed) : identityUvTransform();
  const normalUvTransform = material.normalTexture ? parseTextureTransform(material.normalTexture, extensionsUsed) : identityUvTransform();
  const occlusionUvTransform = material.occlusionTexture ? parseTextureTransform(material.occlusionTexture, extensionsUsed) : identityUvTransform();
  const emissiveUvTransform = material.emissiveTexture ? parseTextureTransform(material.emissiveTexture, extensionsUsed) : identityUvTransform();
  const metallicRoughnessUvTransform = pbr.metallicRoughnessTexture ? parseTextureTransform(pbr.metallicRoughnessTexture, extensionsUsed) : identityUvTransform();
  const specularUvTransform = specularExtension?.specularTexture ? parseTextureTransform(specularExtension.specularTexture, extensionsUsed) : identityUvTransform();
  const specularColorUvTransform = specularExtension?.specularColorTexture ? parseTextureTransform(specularExtension.specularColorTexture, extensionsUsed) : identityUvTransform();
  const clearcoatUvTransform = clearcoatExtension?.clearcoatTexture ? parseTextureTransform(clearcoatExtension.clearcoatTexture, extensionsUsed) : identityUvTransform();
  const clearcoatRoughnessUvTransform = clearcoatExtension?.clearcoatRoughnessTexture ? parseTextureTransform(clearcoatExtension.clearcoatRoughnessTexture, extensionsUsed) : identityUvTransform();
  const clearcoatNormalUvTransform = clearcoatExtension?.clearcoatNormalTexture ? parseTextureTransform(clearcoatExtension.clearcoatNormalTexture, extensionsUsed) : identityUvTransform();
  const clearcoatNormalScale = clearcoatExtension?.clearcoatNormalTexture?.scale ?? 1;
  if (!Number.isFinite(clearcoatNormalScale)) invalid('Invalid clearcoat normal scale');
  let normalTextureIndex = -1;
  const normalScale = material.normalTexture?.scale ?? 1;
  if (material.normalTexture) {
    if (!availableUvSets[normalUvTransform.texcoord]) unsupported('Unsupported normal texture coordinates');
    item(textureSpecs, material.normalTexture.index, 'normal texture');
    if (!Number.isFinite(normalScale)) invalid('Invalid normal scale');
    normalTextureIndex = material.normalTexture.index;
  }
  let occlusionTextureIndex = -1;
  const occlusionStrength = material.occlusionTexture?.strength ?? 1;
  if (material.occlusionTexture) {
    if (!availableUvSets[occlusionUvTransform.texcoord]) unsupported('Unsupported occlusion texture coordinates');
    item(textureSpecs, material.occlusionTexture.index, 'occlusion texture');
    if (!Number.isFinite(occlusionStrength) || occlusionStrength < 0 || occlusionStrength > 1) invalid('Invalid occlusion strength');
    occlusionTextureIndex = material.occlusionTexture.index;
  }
  const emissive = material.emissiveFactor ?? [0, 0, 0];
  if (!Array.isArray(emissive) || emissive.length !== 3 || !emissive.every(value => Number.isFinite(value) && value >= 0 && value <= 1)) invalid('Invalid emissive factor');
  let emissiveTextureIndex = -1;
  if (material.emissiveTexture) {
    if (!availableUvSets[emissiveUvTransform.texcoord]) unsupported('Unsupported emissive texture coordinates');
    item(textureSpecs, material.emissiveTexture.index, 'emissive texture');
    emissiveTextureIndex = material.emissiveTexture.index;
  }
  let metallicRoughnessTextureIndex = -1;
  if (pbr.metallicRoughnessTexture) {
    if (!availableUvSets[metallicRoughnessUvTransform.texcoord]) unsupported('Unsupported metallic-roughness texture coordinates');
    item(textureSpecs, pbr.metallicRoughnessTexture.index, 'metallic-roughness texture');
    metallicRoughnessTextureIndex = pbr.metallicRoughnessTexture.index;
  }
  let specularTextureIndex = -1, specularColorTextureIndex = -1;
  if (specularExtension?.specularTexture) {
    if (!availableUvSets[specularUvTransform.texcoord]) unsupported('Unsupported specular texture coordinates');
    item(textureSpecs, specularExtension.specularTexture.index, 'specular texture');
    specularTextureIndex = specularExtension.specularTexture.index;
  }
  if (specularExtension?.specularColorTexture) {
    if (!availableUvSets[specularColorUvTransform.texcoord]) unsupported('Unsupported specular color texture coordinates');
    item(textureSpecs, specularExtension.specularColorTexture.index, 'specular color texture');
    specularColorTextureIndex = specularExtension.specularColorTexture.index;
  }
  let clearcoatTextureIndex = -1, clearcoatRoughnessTextureIndex = -1;
  if (clearcoatExtension?.clearcoatTexture) {
    if (!availableUvSets[clearcoatUvTransform.texcoord]) unsupported('Unsupported clearcoat texture coordinates');
    item(textureSpecs, clearcoatExtension.clearcoatTexture.index, 'clearcoat texture');
    clearcoatTextureIndex = clearcoatExtension.clearcoatTexture.index;
  }
  if (clearcoatExtension?.clearcoatRoughnessTexture) {
    if (!availableUvSets[clearcoatRoughnessUvTransform.texcoord]) unsupported('Unsupported clearcoat roughness texture coordinates');
    item(textureSpecs, clearcoatExtension.clearcoatRoughnessTexture.index, 'clearcoat roughness texture');
    clearcoatRoughnessTextureIndex = clearcoatExtension.clearcoatRoughnessTexture.index;
  }
  let clearcoatNormalTextureIndex = -1;
  if (clearcoatExtension?.clearcoatNormalTexture) {
    if (!availableUvSets[clearcoatNormalUvTransform.texcoord]) unsupported('Unsupported clearcoat normal texture coordinates');
    item(textureSpecs, clearcoatExtension.clearcoatNormalTexture.index, 'clearcoat normal texture');
    clearcoatNormalTextureIndex = clearcoatExtension.clearcoatNormalTexture.index;
  }
  const metallic = pbr.metallicFactor ?? 1, roughness = pbr.roughnessFactor ?? 1;
  if (![metallic, roughness].every(value => Number.isFinite(value) && value >= 0 && value <= 1)) invalid('Invalid metallic or roughness factor');
  const color = pbr.baseColorFactor || [1, 1, 1, 1];
  if (!Array.isArray(color) || color.length !== 4 || !color.every(value => Number.isFinite(value) && value >= 0 && value <= 1)) invalid('Invalid base color');
  let textureIndex = -1;
  if (pbr.baseColorTexture) {
    if (!availableUvSets[baseUvTransform.texcoord]) unsupported('Unsupported texture coordinates');
    item(textureSpecs, pbr.baseColorTexture.index, 'texture');
    textureIndex = pbr.baseColorTexture.index;
  }
  return { name: material.name ?? null, baseColorFactor: [...color],
    color: [color[0], color[1], color[2], mode === 'OPAQUE' ? 1 : color[3]], textureIndex,
    alphaMode: alphaModes[mode], alphaCutoff: cutoff, metallic, roughness, metallicRoughnessTextureIndex,
    normalTextureIndex, normalScale, occlusionTextureIndex, occlusionStrength,
    emissive: emissive.map(value => value * emissiveStrength), emissiveTextureIndex,
    doubleSided: material.doubleSided ?? false, unlit, ior, specularFactor, specularColorFactor,
    specularTextureIndex, specularColorTextureIndex, clearcoatFactor, clearcoatRoughness,
    clearcoatTextureIndex, clearcoatRoughnessTextureIndex,
    clearcoatNormalTextureIndex, clearcoatNormalScale,
    uvTransforms: [baseUvTransform, metallicRoughnessUvTransform, normalUvTransform, occlusionUvTransform,
      emissiveUvTransform, specularUvTransform, specularColorUvTransform, clearcoatUvTransform,
      clearcoatRoughnessUvTransform, clearcoatNormalUvTransform], materialIndex: materialIndex ?? -1 };
}

function inspectMaterial(spec) {
  const alphaModes = ['OPAQUE', 'MASK', 'BLEND'];
  const textureSlots = [
    ['baseColor', spec.textureIndex], ['metallicRoughness', spec.metallicRoughnessTextureIndex],
    ['normal', spec.normalTextureIndex], ['occlusion', spec.occlusionTextureIndex],
    ['emissive', spec.emissiveTextureIndex], ['specular', spec.specularTextureIndex],
    ['specularColor', spec.specularColorTextureIndex],
    ['clearcoat', spec.clearcoatTextureIndex], ['clearcoatRoughness', spec.clearcoatRoughnessTextureIndex],
    ['clearcoatNormal', spec.clearcoatNormalTextureIndex],
  ].filter(([, index]) => index >= 0).map(([name]) => name);
  return Object.freeze({
    index: spec.materialIndex, name: spec.name,
    baseColorFactor: Object.freeze([...spec.baseColorFactor]),
    metallicFactor: spec.metallic, roughnessFactor: spec.roughness,
    alphaMode: alphaModes[spec.alphaMode], alphaCutoff: spec.alphaCutoff,
    emissiveFactor: Object.freeze([...spec.emissive]), doubleSided: spec.doubleSided,
    unlit: spec.unlit, ior: spec.ior, specularFactor: spec.specularFactor,
    specularColorFactor: Object.freeze([...spec.specularColorFactor]),
    clearcoatFactor: spec.clearcoatFactor, clearcoatRoughnessFactor: spec.clearcoatRoughness,
    clearcoatNormalScale: spec.clearcoatNormalScale,
    textureSlots: Object.freeze(textureSlots),
  });
}

function validateMeshAttributeEncoding(attribute, semantic, morph, extensionsUsed, extensionsRequired) {
  if (!attribute) return;
  const type = attribute.componentType, normalized = attribute.normalized;
  const core = morph
    ? semantic === 'POSITION' || semantic === 'NORMAL' || semantic === 'TANGENT'
    : semantic === 'POSITION' || semantic === 'NORMAL' || semantic === 'TANGENT' || semantic.startsWith('TEXCOORD_');
  if (core && type === 5126 && !normalized) return;
  if (!morph && semantic.startsWith('TEXCOORD_') && [5121, 5123].includes(type) && normalized) return;
  const quantized = morph
    ? semantic === 'POSITION' ? [5120, 5122].includes(type)
      : ['NORMAL', 'TANGENT'].includes(semantic) && [5120, 5122].includes(type) && normalized
    : semantic === 'POSITION' ? [5120, 5121, 5122, 5123].includes(type)
      : ['NORMAL', 'TANGENT'].includes(semantic) && [5120, 5122].includes(type) && normalized
        || semantic.startsWith('TEXCOORD_') && [5120, 5121, 5122, 5123].includes(type);
  if (!quantized) invalid(`Invalid ${semantic} accessor encoding`);
  if (!extensionsUsed.includes('KHR_mesh_quantization') || !extensionsRequired.includes('KHR_mesh_quantization')) {
    invalid('Quantized mesh attributes require KHR_mesh_quantization in extensionsUsed and extensionsRequired');
  }
  if (attribute.byteOffset % 4 !== 0 || (attribute.count > 1 && attribute.byteStride % 4 !== 0)) {
    invalid(`Quantized ${semantic} elements must align to four-byte boundaries`);
  }
}

async function prepare(url, requestedScene) {
  const absolute = new URL(url, globalThis.location?.href || 'http://localhost/');
  const { json, bin, glb } = unpack(await fetchBytes(absolute));
  let doc;
  try { doc = JSON.parse(new TextDecoder().decode(json)); }
  catch (error) { throw new AssetError('INVALID_GLTF', 'Invalid glTF JSON', error); }
  if (doc.asset?.version !== '2.0') unsupported('Only glTF 2.0 is supported');
  const extensionsUsed = doc.extensionsUsed ?? [], extensionsRequired = doc.extensionsRequired ?? [];
  if (!Array.isArray(extensionsUsed) || !extensionsUsed.every(extension => typeof extension === 'string') ||
      !Array.isArray(extensionsRequired) || !extensionsRequired.every(extension => typeof extension === 'string')) invalid('Invalid glTF extension declarations');
  if (extensionsRequired.some(extension => !extensionsUsed.includes(extension))) invalid('Required glTF extensions must also be listed as used');
  const supportedRequiredExtensions = ['KHR_materials_unlit', 'KHR_materials_emissive_strength', 'KHR_materials_ior', 'KHR_materials_specular', 'KHR_materials_clearcoat', 'KHR_texture_transform', 'KHR_materials_variants', 'EXT_texture_webp', 'KHR_mesh_quantization'];
  if (extensionsRequired.some(extension => !supportedRequiredExtensions.includes(extension))) unsupported('Required glTF extensions are not supported');
  if (doc.extensions !== undefined && (!doc.extensions || typeof doc.extensions !== 'object' || Array.isArray(doc.extensions))) invalid('Invalid glTF extensions');
  const variantExtension = doc.extensions?.KHR_materials_variants;
  if (extensionsUsed.includes('KHR_materials_variants') !== (variantExtension !== undefined)) invalid('KHR_materials_variants declaration does not match its extension data');
  if (variantExtension !== undefined && (!variantExtension || typeof variantExtension !== 'object' || Array.isArray(variantExtension) || !Array.isArray(variantExtension.variants))) invalid('Invalid KHR_materials_variants extension');
  const variantNames = (variantExtension?.variants ?? []).map((variant, index) => {
    if (!variant || typeof variant !== 'object' || Array.isArray(variant) || (variant.name !== undefined && typeof variant.name !== 'string')) invalid('Invalid material variant');
    return variant.name ?? `Variant ${index}`;
  });
  const bufferDefinitions = doc.buffers ?? [];
  if (!Array.isArray(bufferDefinitions)) invalid('Invalid glTF buffers');
  if (glb && bin !== undefined) {
    const first = bufferDefinitions[0];
    if (!first || first.uri !== undefined || !Number.isSafeInteger(first.byteLength) || first.byteLength < 0 ||
        bin.byteLength < first.byteLength || bin.byteLength - first.byteLength > 3) invalid('Invalid GLB BIN chunk padding or buffer reference');
  }
  const buffers = await Promise.all(bufferDefinitions.map(async (buffer, i) => {
    const data = buffer.uri !== undefined ? await fetchBytes(new URL(buffer.uri, absolute)) : i === 0 ? bin : undefined;
    if (!data || !Number.isInteger(buffer.byteLength) || buffer.byteLength < 0 || data.byteLength < buffer.byteLength) invalid('Missing or truncated buffer');
    return data;
  }));
  const imageDefinitions = doc.images || [];
  if (!Array.isArray(imageDefinitions)) invalid('Invalid glTF images');
  const webpFallbacks = new Map();
  for (const texture of doc.textures || []) {
    const webpSource = texture?.extensions?.EXT_texture_webp?.source;
    if (webpSource !== undefined) {
      const fallbackSource = texture.source ?? null;
      if (webpFallbacks.has(webpSource) && webpFallbacks.get(webpSource) !== fallbackSource) invalid('WebP image has conflicting fallback sources');
      webpFallbacks.set(webpSource, fallbackSource);
    }
  }
  const decodeImageDefinition = async image => {
    if (image.uri !== undefined) return decodeImage(await fetchBytes(new URL(image.uri, absolute)), image.mimeType || '');
    const bv = item(doc.bufferViews, image.bufferView, 'image bufferView');
    const data = item(buffers, bv.buffer, 'image buffer');
    const start = bv.byteOffset || 0, end = start + bv.byteLength;
    if (!Number.isInteger(start) || start < 0 || !Number.isInteger(end) || end > data.byteLength) invalid('Image exceeds its buffer');
    return decodeImage(data.slice(start, end), image.mimeType || '');
  };
  const images = await Promise.all(imageDefinitions.map(async (image, index) => {
    try { return await decodeImageDefinition(image); }
    catch (error) {
      const fallback = webpFallbacks.get(index);
      if (fallback === undefined || fallback === null) throw error;
      return decodeImageDefinition(item(imageDefinitions, fallback, 'fallback image'));
    }
  }));
  const skins = (doc.skins || []).map((skin, index) => {
    if (skin.extensions || !Array.isArray(skin.joints) || skin.joints.length < 1 ||
        skin.joints.length > 65536 || new Set(skin.joints).size !== skin.joints.length ||
        skin.joints.some(joint => !Number.isInteger(joint) || joint < 0)) invalid(`Invalid skin ${index}`);
    if (skin.skeleton !== undefined && (!Number.isInteger(skin.skeleton) || skin.skeleton < 0)) invalid(`Invalid skeleton root for skin ${index}`);
    const inverse = skin.inverseBindMatrices === undefined ? null : accessor(doc, buffers, skin.inverseBindMatrices, 'MAT4');
    if (inverse && (inverse.componentType !== 5126 || inverse.count !== skin.joints.length)) invalid(`Invalid inverse bind matrices for skin ${index}`);
    const inverseBindMatrices = inverse ? inverse.values : Array.from({ length: skin.joints.length }, (_, joint) => {
      const identity = new Array(16).fill(0);
      identity[0] = identity[5] = identity[10] = identity[15] = 1;
      return identity;
    }).flat();
    return { joints: [...skin.joints], inverseBindMatrices };
  });
  const wrapModes = { 33071: 0, 10497: 1, 33648: 2 };
  const textureSpecs = (doc.textures || []).map(texture => {
    if (!texture || typeof texture !== 'object' || Array.isArray(texture)) invalid('Invalid texture');
    let source = texture.source;
    if (texture.extensions !== undefined) {
      if (!texture.extensions || typeof texture.extensions !== 'object' || Array.isArray(texture.extensions)) invalid('Invalid texture extensions');
      const extensions = Object.keys(texture.extensions);
      if (extensions.some(name => name !== 'EXT_texture_webp')) unsupported('Unsupported texture extension');
      if (extensions.includes('EXT_texture_webp')) {
        if (!extensionsUsed.includes('EXT_texture_webp')) invalid('EXT_texture_webp must be listed in extensionsUsed');
        const webp = texture.extensions.EXT_texture_webp;
        if (!webp || typeof webp !== 'object' || Array.isArray(webp)) invalid('Invalid EXT_texture_webp extension');
        source = webp.source;
        if (texture.source === undefined && !extensionsRequired.includes('EXT_texture_webp')) invalid('EXT_texture_webp without a core fallback must be required');
      }
    }
    item(images, source, 'image');
    const sampler = texture.sampler === undefined ? {} : item(doc.samplers, texture.sampler, 'sampler');
    if (sampler.extensions) unsupported('Sampler extensions are not supported');
    if (sampler.magFilter !== undefined && ![9728, 9729].includes(sampler.magFilter)) invalid('Invalid magnification filter');
    if (sampler.minFilter !== undefined && ![9728, 9729, 9984, 9985, 9986, 9987].includes(sampler.minFilter)) invalid('Invalid minification filter');
    const s = sampler.wrapS ?? 10497, t = sampler.wrapT ?? 10497;
    if (!Object.hasOwn(wrapModes, s) || !Object.hasOwn(wrapModes, t)) invalid('Invalid texture wrapping mode');
    return { image: source, wrapU: wrapModes[s], wrapV: wrapModes[t],
      minFilter: sampler.minFilter ?? 9729, magFilter: sampler.magFilter ?? 9729 };
  });
  const meshes = (doc.meshes || []).map((mesh, meshIndex) => {
    const primitives = (mesh.primitives || []).map(p => {
    if ((p.mode ?? 4) !== 4) unsupported('Only triangle mesh primitives are supported');
    if (Object.keys(p.attributes || {}).some(name => /^(JOINTS|WEIGHTS)_\d+$/.test(name) && Number(name.slice(name.indexOf('_') + 1)) > 1)) unsupported('At most eight skin influences are supported');
    if (Object.keys(p.attributes || {}).some(name => /^TEXCOORD_\d+$/.test(name) && Number(name.slice(9)) > 7)) unsupported('Only TEXCOORD_0 through TEXCOORD_7 are supported');
    const pos = accessor(doc, buffers, p.attributes?.POSITION, 'VEC3');
    const normal = p.attributes?.NORMAL === undefined ? null : accessor(doc, buffers, p.attributes.NORMAL, 'VEC3');
    const uv = p.attributes?.TEXCOORD_0 === undefined ? null : accessor(doc, buffers, p.attributes.TEXCOORD_0, 'VEC2');
    const uv1 = p.attributes?.TEXCOORD_1 === undefined ? null : accessor(doc, buffers, p.attributes.TEXCOORD_1, 'VEC2');
    const uv2 = p.attributes?.TEXCOORD_2 === undefined ? null : accessor(doc, buffers, p.attributes.TEXCOORD_2, 'VEC2');
    const uv3 = p.attributes?.TEXCOORD_3 === undefined ? null : accessor(doc, buffers, p.attributes.TEXCOORD_3, 'VEC2');
    const uv4 = p.attributes?.TEXCOORD_4 === undefined ? null : accessor(doc, buffers, p.attributes.TEXCOORD_4, 'VEC2');
    const uv5 = p.attributes?.TEXCOORD_5 === undefined ? null : accessor(doc, buffers, p.attributes.TEXCOORD_5, 'VEC2');
    const uv6 = p.attributes?.TEXCOORD_6 === undefined ? null : accessor(doc, buffers, p.attributes.TEXCOORD_6, 'VEC2');
    const uv7 = p.attributes?.TEXCOORD_7 === undefined ? null : accessor(doc, buffers, p.attributes.TEXCOORD_7, 'VEC2');
    const tangent = p.attributes?.TANGENT === undefined ? null : accessor(doc, buffers, p.attributes.TANGENT, 'VEC4');
    const colorIndex = p.attributes?.COLOR_0;
    const colorType = colorIndex === undefined ? null : item(doc.accessors, colorIndex, 'COLOR_0 accessor').type;
    if (colorType !== null && colorType !== 'VEC3' && colorType !== 'VEC4') invalid('Invalid COLOR_0 accessor type');
    const vertexColor = colorType === null ? null : accessor(doc, buffers, colorIndex, colorType);
    validateMeshAttributeEncoding(pos, 'POSITION', false, extensionsUsed, extensionsRequired);
    validateMeshAttributeEncoding(normal, 'NORMAL', false, extensionsUsed, extensionsRequired);
    validateMeshAttributeEncoding(tangent, 'TANGENT', false, extensionsUsed, extensionsRequired);
    for (const [set, coord] of [uv, uv1, uv2, uv3, uv4, uv5, uv6, uv7].entries()) {
      validateMeshAttributeEncoding(coord, `TEXCOORD_${set}`, false, extensionsUsed, extensionsRequired);
    }
    if ((normal && normal.count !== pos.count) ||
        [uv, uv1, uv2, uv3, uv4, uv5, uv6, uv7].some(coord => coord && coord.count !== pos.count) ||
        (vertexColor && (vertexColor.count !== pos.count ||
          !((vertexColor.componentType === 5126 && !vertexColor.normalized) ||
            ([5121, 5123].includes(vertexColor.componentType) && vertexColor.normalized)) ||
          vertexColor.values.some(value => value < 0 || value > 1))) ||
        (tangent && (tangent.count !== pos.count ||
          tangent.values.some((value, index) => index % 4 === 3 && Math.abs(Math.abs(value) - 1) > 1e-4)))) invalid('Invalid vertex attributes');
    const joints = [], weights = [];
    for (let set = 0; set < 2; set++) {
      const jointIndex = p.attributes?.[`JOINTS_${set}`], weightIndex = p.attributes?.[`WEIGHTS_${set}`];
      if ((jointIndex === undefined) !== (weightIndex === undefined)) invalid(`Incomplete skin attributes in set ${set}`);
      if (jointIndex === undefined) continue;
      if (set === 1 && joints.length === 0) invalid('Skin influence set 1 requires set 0');
      const jointAccessor = accessor(doc, buffers, jointIndex, 'VEC4');
      const weightAccessor = accessor(doc, buffers, weightIndex, 'VEC4');
      if (![5121, 5123].includes(jointAccessor.componentType) || jointAccessor.normalized ||
          (weightAccessor.componentType !== 5126 && !([5121, 5123].includes(weightAccessor.componentType) && weightAccessor.normalized)) ||
          jointAccessor.count !== pos.count || weightAccessor.count !== pos.count) invalid(`Invalid skin attributes in set ${set}`);
      joints.push(jointAccessor.values);
      weights.push(weightAccessor.values);
    }
    if (p.targets !== undefined && !Array.isArray(p.targets)) invalid(`Invalid morph targets in mesh ${meshIndex}`);
    const targets = (p.targets || []).map(target => {
      if (!target || typeof target !== 'object') invalid('Invalid morph target');
      if (Object.keys(target).some(name => !['POSITION', 'NORMAL', 'TANGENT'].includes(name))) unsupported('Unsupported morph target attribute');
      const position = target.POSITION === undefined ? null : accessor(doc, buffers, target.POSITION, 'VEC3');
      const normalDelta = target.NORMAL === undefined ? null : accessor(doc, buffers, target.NORMAL, 'VEC3');
      const tangentDelta = target.TANGENT === undefined ? null : accessor(doc, buffers, target.TANGENT, 'VEC3');
      if (!position && !normalDelta && !tangentDelta) invalid('Morph targets need a POSITION, NORMAL or TANGENT delta');
      for (const [semantic, delta] of [['POSITION', position], ['NORMAL', normalDelta], ['TANGENT', tangentDelta]]) {
        validateMeshAttributeEncoding(delta, semantic, true, extensionsUsed, extensionsRequired);
        if (delta && delta.count !== pos.count) invalid('Invalid morph target accessor');
      }
      if (tangentDelta && !tangent) invalid('Tangent morph targets require a base TANGENT attribute');
      return { position: position?.values, normal: normalDelta?.values, tangent: tangentDelta?.values };
    });
    const indexAccessor = p.indices === undefined ? null : accessor(doc, buffers, p.indices, 'SCALAR');
    if (indexAccessor && ![5121, 5123, 5125].includes(indexAccessor.componentType)) invalid('Indices must be unsigned integers');
    const indices = indexAccessor ? indexAccessor.values : Array.from({ length: pos.count }, (_, i) => i);
    if (indices.length % 3 || indices.some(i => !Number.isInteger(i) || i < 0 || i >= pos.count)) invalid('Invalid triangle indices');
    const normalValues = normal ? normal.values : generateVertexNormals(pos.values, indices);
    const availableUvSets = [uv, uv1, uv2, uv3, uv4, uv5, uv6, uv7];
    const variantMaterials = new Map();
    if (p.extensions !== undefined) {
      if (!p.extensions || typeof p.extensions !== 'object' || Array.isArray(p.extensions)) invalid('Invalid primitive extensions');
      const primitiveExtensions = Object.keys(p.extensions);
      if (primitiveExtensions.some(name => name !== 'KHR_materials_variants')) unsupported('Unsupported primitive extension');
      if (primitiveExtensions.includes('KHR_materials_variants')) {
        if (!variantExtension || !extensionsUsed.includes('KHR_materials_variants')) invalid('KHR_materials_variants must be declared and defined');
        const variantMappings = p.extensions.KHR_materials_variants;
        if (!variantMappings || typeof variantMappings !== 'object' || Array.isArray(variantMappings)) invalid('Invalid material variant mappings');
        const mappings = variantMappings.mappings;
        if (!Array.isArray(mappings)) invalid('Invalid material variant mappings');
        for (const mapping of mappings) {
          if (!mapping || typeof mapping !== 'object' || Array.isArray(mapping) || !Array.isArray(mapping.variants) ||
              !mapping.variants.length || !Number.isInteger(mapping.material) || mapping.material < 0) invalid('Invalid material variant mapping');
          item(doc.materials, mapping.material, 'variant material');
          const uniqueVariants = new Set();
          for (const variantIndex of mapping.variants) {
            if (!Number.isInteger(variantIndex) || variantIndex < 0 || variantIndex >= variantNames.length || uniqueVariants.has(variantIndex) || variantMaterials.has(variantIndex)) invalid('Invalid or duplicate material variant index');
            uniqueVariants.add(variantIndex);
            variantMaterials.set(variantIndex, parseMaterial(doc, textureSpecs, mapping.material, availableUvSets, extensionsUsed));
          }
        }
      }
    }
    const materialSpec = parseMaterial(doc, textureSpecs, p.material, availableUvSets, extensionsUsed);
    return { pos: pos.values, normal: normalValues, uv: uv?.values, uv1: uv1?.values, uv2: uv2?.values,
      uv3: uv3?.values, uv4: uv4?.values, uv5: uv5?.values, uv6: uv6?.values, uv7: uv7?.values,
      vertexColor: vertexColor?.values, colorComponents: colorType === 'VEC3' ? 3 : vertexColor ? 4 : 0,
      tangent: tangent?.values, joints, weights, targets, indices, ...materialSpec, variantMaterials };
    });
    if (!primitives.length) invalid(`Mesh ${meshIndex} has no primitives`);
    const targetCount = primitives[0].targets.length;
    if (primitives.some(primitive => primitive.targets.length !== targetCount)) invalid(`Morph target counts differ in mesh ${meshIndex}`);
    const weights = mesh.weights ?? Array(targetCount).fill(0);
    if (!Array.isArray(weights) || weights.length !== targetCount || !weights.every(Number.isFinite)) invalid(`Invalid default morph weights in mesh ${meshIndex}`);
    return { primitives, targetCount, weights: [...weights] };
  });
  const nodes = doc.nodes || [];
  const sceneIndex = requestedScene ?? doc.scene ?? 0;
  if (!Number.isInteger(sceneIndex) || sceneIndex < 0) invalid('Invalid scene index');
  const scene = item(doc.scenes, sceneIndex, 'scene');
  if (scene.nodes !== undefined && !Array.isArray(scene.nodes)) invalid('Invalid scene roots');
  const roots = scene.nodes || [];
  const seen = new Set(), usedSkinIndices = new Set();
  function visit(index, depth) {
    if (depth > 63 || seen.has(index)) invalid('Invalid or overly deep node hierarchy');
    seen.add(index);
    const n = item(nodes, index, 'node');
    if (n.extensions) unsupported('Unsupported node feature');
    if (n.name !== undefined && typeof n.name !== 'string') invalid('Invalid node name');
    const meshData = n.mesh === undefined ? null : item(meshes, n.mesh, 'mesh');
    const primitives = meshData?.primitives ?? [];
    const targetCount = meshData?.targetCount ?? 0;
    const morphWeights = n.weights ?? meshData?.weights ?? [];
    if (!Array.isArray(morphWeights) || morphWeights.length !== targetCount || !morphWeights.every(Number.isFinite)) invalid('Invalid node morph weights');
    if (n.skin !== undefined && (!Number.isInteger(n.skin) || n.skin < 0)) invalid('Invalid node skin index');
    const skinIndex = n.skin === undefined ? -1 : n.skin;
    if (skinIndex >= 0) {
      const skin = item(skins, skinIndex, 'skin');
      usedSkinIndices.add(skinIndex);
      if (!primitives.length || primitives.some(primitive => !primitive.joints.length)) invalid('Skinned mesh primitives require JOINTS_0 and WEIGHTS_0');
      for (const primitive of primitives) for (let vertex = 0; vertex < primitive.pos.length / 3; vertex++) {
        let totalWeight = 0;
        for (let set = 0; set < primitive.joints.length; set++) for (let component = 0; component < 4; component++) {
          const joint = primitive.joints[set][vertex * 4 + component];
          const weight = primitive.weights[set][vertex * 4 + component];
          if (!Number.isInteger(joint) || joint < 0 || joint >= skin.joints.length || weight < 0) invalid('Invalid joint index or weight');
          totalWeight += weight;
        }
        if (!(totalWeight > 0) || !Number.isFinite(totalWeight)) invalid('Skinned vertices need positive finite weights');
      }
    } else if (primitives.some(primitive => primitive.joints.length)) invalid('Skin attributes require a node skin');
    const transform = localMatrix(n);
    return { index, name: n.name ?? null, meshIndex: n.mesh ?? null, skinIndex, weights: [...morphWeights], ...transform, primitives,
      children: (n.children || []).map(child => visit(child, depth + 1)) };
  }
  const sceneRoots = roots.map(root => visit(root, 0));
  const sceneNodeIndices = new Set(seen);
  for (const skinIndex of usedSkinIndices) {
    const skin = skins[skinIndex];
    if (skin.skeleton !== undefined) {
      item(nodes, skin.skeleton, 'skin skeleton');
      if (!sceneNodeIndices.has(skin.skeleton)) unsupported('Skin skeleton must belong to the selected scene');
    }
    for (const joint of skin.joints) {
      item(nodes, joint, 'skin joint');
      if (!sceneNodeIndices.has(joint)) unsupported('Skin joints must belong to the selected scene');
    }
  }
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
      if (!['translation', 'rotation', 'scale', 'weights'].includes(path)) unsupported(`Animation target path ${path} is unsupported`);
      const sourceNode = item(nodes, target.node, 'animation node');
      if (sourceNode.matrix && path !== 'weights') unsupported('Animation channels cannot target nodes using matrix transforms');
      const targetMesh = sourceNode.mesh === undefined ? null : item(meshes, sourceNode.mesh, 'animation mesh');
      const components = path === 'rotation' ? 4 : path === 'weights' ? targetMesh?.targetCount ?? 0 : 3;
      if (path === 'weights' && components < 1) invalid('Morph weight animation target has no morph targets');
      const targetKey = `${target.node}:${path}`;
      if (usedTargets.has(targetKey)) invalid('Animation targets the same node property more than once');
      usedTargets.add(targetKey);
      const interpolation = sampler.interpolation ?? 'LINEAR';
      if (interpolation !== 'LINEAR' && interpolation !== 'STEP' && interpolation !== 'CUBICSPLINE') unsupported(`Animation interpolation ${interpolation} is unsupported`);
      const input = accessor(doc, buffers, sampler.input, 'SCALAR');
      const output = accessor(doc, buffers, sampler.output, path === 'rotation' ? 'VEC4' : path === 'weights' ? 'SCALAR' : 'VEC3');
      const expectedOutputCount = input.count * (path === 'weights' ? components : 1) * (interpolation === 'CUBICSPLINE' ? 3 : 1);
      const validOutputType = path === 'weights' ? output.componentType === 5126 ||
        ([5120, 5121, 5122, 5123].includes(output.componentType) && output.normalized) : output.componentType === 5126;
      if (input.componentType !== 5126 || !validOutputType || input.count < 1 || output.count !== expectedOutputCount ||
          (interpolation === 'CUBICSPLINE' && input.count < 2)) invalid('Invalid animation accessor types or counts');
      for (let i = 0; i < input.values.length; i++) {
        const time = input.values[i];
        if (time < 0 || (i > 0 && time <= input.values[i - 1])) invalid('Animation input times must be non-negative and strictly increasing');
      }
      if (path === 'rotation') for (let i = interpolation === 'CUBICSPLINE' ? 4 : 0; i < output.values.length; i += interpolation === 'CUBICSPLINE' ? 12 : 4) {
        if (!(Math.hypot(output.values[i], output.values[i + 1], output.values[i + 2], output.values[i + 3]) > 0)) invalid('Animation rotations must be non-zero quaternions');
      }
      duration = Math.max(duration, input.values[input.values.length - 1]);
      return { node: target.node, path, interpolation, times: input.values, values: output.values, components,
        enabled: sceneNodeIndices.has(target.node) };
    });
    return { name: typeof animation.name === 'string' ? animation.name : `Animation ${animationIndex}`, duration, channels };
  });
  return { images, textureSpecs, roots: sceneRoots, skins, animations, sceneIndex, variantNames };
}

// Model disposal is idempotent. GPU objects are released; arena records remain.
export async function loadGLTF(engine, url, options = {}) {
  if (!options || typeof options !== 'object' || Array.isArray(options)) invalid('Invalid glTF load options');
  if (options.scene !== undefined && (!Number.isInteger(options.scene) || options.scene < 0)) invalid('Invalid scene index');
  let data;
  try { data = await prepare(url, options.scene); }
  catch (error) {
    if (error instanceof AssetError) throw error;
    throw new AssetError('INVALID_GLTF', 'Invalid glTF structure or URL', error);
  }
  const nodes = [], modelNodes = [], meshes = [], deformedMeshes = [], materials = new Map(), textures = new Map(), transformNodes = new Map();
  const variantBindings = [];
  const sceneEpoch = engine._g3_asset_scene_epoch();
  let disposed = false;
  let activeAnimation = -1, animationTime = 0, animationPlaying = false, animationLoop = true;
  let activeVariant = -1;
  let touchedTransforms = new Set();
  const writeTransform = state => {
    if (!state.translation || !isNodeHandleValid(engine, state.handle)) return;
    const matrix = localMatrix({ translation: state.translation, rotation: state.rotation, scale: state.scale }).matrix;
    matrix.forEach((value, index) => engine._g3_asset_matrix(state.handle.index, index, value));
  };
  const restoreBase = state => {
    if (state.baseTranslation) {
      state.translation = [...state.baseTranslation];
      state.rotation = [...state.baseRotation];
      state.scale = [...state.baseScale];
    }
    state.weights = [...state.baseWeights];
  };
  const updateDeformedMeshes = () => {
    if (!deformedMeshes.length) return true;
    const worlds = new Map();
    const visitWorld = (node, parent) => {
      const state = transformNodes.get(node.index);
      const local = state?.translation ? localMatrix(state).matrix : node.matrix;
      const world = parent ? multiply4(parent, local) : local;
      worlds.set(node.index, world);
      for (const child of node.children) visitWorld(child, world);
    };
    for (const root of data.roots) visitWorld(root, null);
    for (const deformed of deformedMeshes) {
      if (!isMeshHandleValid(engine, deformed.handle)) continue;
      let jointMatrices = [];
      if (deformed.skinIndex >= 0) {
        const meshWorld = worlds.get(deformed.node);
        if (!meshWorld) invalid('Skinned mesh node is outside the selected scene');
        const inverseMeshWorld = invert4(meshWorld);
        const skin = data.skins[deformed.skinIndex];
        jointMatrices = skin.joints.map((joint, index) => {
          const jointWorld = worlds.get(joint);
          if (!jointWorld) invalid('Skin joint is outside the selected scene');
          const inverseBind = skin.inverseBindMatrices.slice(index * 16, index * 16 + 16);
          return multiply4(multiply4(inverseMeshWorld, jointWorld), inverseBind);
        });
      }
      const { primitive } = deformed;
      if (deformed.gpuSkin) {
        const matrices = new Float32Array(jointMatrices.flat());
        engine.HEAPF32.set(matrices, deformed.palettePtr >>> 2);
        if (!engine._g3_host_joint_palette(deformed.handle.id, deformed.palettePtr, jointMatrices.length)) {
          throw new AssetError('UPLOAD', 'Could not update GPU skin palette');
        }
      }
      const morphWeights = transformNodes.get(deformed.node)?.weights ?? deformed.weights;
      if (deformed.gpuMorph) {
        engine.HEAPF32.set(morphWeights, deformed.morphWeightsPtr >>> 2);
        if (!engine._g3_host_morph_weights(deformed.handle.id, deformed.morphWeightsPtr, morphWeights.length)) {
          throw new AssetError('UPLOAD', 'Could not update GPU morph weights');
        }
      }
      const vertexCount = primitive.pos.length / 3;
      const positions = new Float32Array(primitive.pos.length), normals = new Float32Array(primitive.normal.length);
      const tangents = new Float32Array(vertexCount * 4);
      for (let vertex = 0; vertex < vertexCount; vertex++) {
        const sourcePosition = primitive.pos.slice(vertex * 3, vertex * 3 + 3);
        const sourceNormal = primitive.normal.slice(vertex * 3, vertex * 3 + 3);
        const sourceTangent = primitive.tangent?.slice(vertex * 4, vertex * 4 + 4) ?? [0, 0, 0, 0];
        for (let targetIndex = 0; targetIndex < primitive.targets.length; targetIndex++) {
          const weight = morphWeights[targetIndex];
          if (weight === 0) continue;
          const target = primitive.targets[targetIndex];
          for (let axis = 0; axis < 3; axis++) {
            const offset = vertex * 3 + axis;
            if (target.position) sourcePosition[axis] += target.position[offset] * weight;
            if (target.normal) sourceNormal[axis] += target.normal[offset] * weight;
            if (target.tangent) sourceTangent[axis] += target.tangent[offset] * weight;
          }
        }
        let outPosition, outNormal, outTangent = [0, 0, 0];
        if (deformed.skinIndex >= 0) {
          outPosition = [0, 0, 0]; outNormal = [0, 0, 0];
          let totalWeight = 0;
          for (let set = 0; set < primitive.joints.length; set++) for (let component = 0; component < 4; component++) {
            const offset = vertex * 4 + component, weight = primitive.weights[set][offset];
            if (weight === 0) continue;
            const matrix = jointMatrices[primitive.joints[set][offset]];
            const position = transformPoint4(matrix, sourcePosition), normal = transformDirection4(matrix, sourceNormal);
            const tangent = primitive.tangent ? transformDirection4(matrix, sourceTangent) : null;
            for (let axis = 0; axis < 3; axis++) {
              outPosition[axis] += position[axis] * weight;
              outNormal[axis] += normal[axis] * weight;
              if (tangent) outTangent[axis] += tangent[axis] * weight;
            }
            totalWeight += weight;
          }
          if (!(totalWeight > 0) || !Number.isFinite(totalWeight)) invalid('Invalid skin weights');
          for (let axis = 0; axis < 3; axis++) {
            outPosition[axis] /= totalWeight;
            outTangent[axis] /= totalWeight;
          }
          const tangentLength = Math.hypot(...outTangent);
          if (tangentLength > 0 && Number.isFinite(tangentLength)) outTangent = outTangent.map(value => value / tangentLength);
          else outTangent = [0, 0, 0];
        } else {
          outPosition = sourcePosition;
          outNormal = sourceNormal;
          if (primitive.tangent) outTangent = sourceTangent.slice(0, 3);
        }
        outNormal = normalize3(outNormal);
        if (primitive.tangent && primitive.targets.length) {
          const tangentLength = Math.hypot(...outTangent);
          outTangent = tangentLength > 0 && Number.isFinite(tangentLength) ? outTangent.map(value => value / tangentLength) : [0, 0, 0];
        }
        for (let axis = 0; axis < 3; axis++) {
          positions[vertex * 3 + axis] = outPosition[axis];
          normals[vertex * 3 + axis] = outNormal[axis];
          tangents[vertex * 4 + axis] = outTangent[axis];
        }
        tangents[vertex * 4 + 3] = primitive.tangent ? sourceTangent[3] : 0;
      }
      const floatOffset = deformed.ptr >>> 2;
      engine.HEAPF32.set(positions, floatOffset);
      engine.HEAPF32.set(normals, floatOffset + positions.length);
      const tangentPtr = deformed.ptr + positions.byteLength + normals.byteLength;
      engine.HEAPF32.set(tangents, tangentPtr >>> 2);
      const updateMesh = deformed.gpuDeform ? engine._g3_host_mesh_update_cpu : engine._g3_host_mesh_update;
      if (!updateMesh || !updateMesh(deformed.handle.id, deformed.ptr, deformed.ptr + positions.byteLength, tangentPtr, positions.length)) {
        throw new AssetError('UPLOAD', 'Could not update deformed mesh');
      }
    }
    return true;
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
    return updateDeformedMeshes();
  };
  const dispose = () => {
    if (disposed) return;
    disposed = true;
    animationPlaying = false;
    for (const node of nodes) engine._g3_asset_node_release(node.index, node.generation, node.epoch);
    for (const handle of materials.values()) engine._g3_asset_release_material(handle.id, handle.generation);
    for (const handle of meshes) {
      engine._g3_asset_release_mesh(handle.id, handle.generation);
    }
    for (const deformed of deformedMeshes) {
      if (deformed.ptr) engine._free(deformed.ptr);
      if (deformed.palettePtr) engine._free(deformed.palettePtr);
      if (deformed.morphWeightsPtr) engine._free(deformed.morphWeightsPtr);
    }
    deformedMeshes.length = 0;
    for (const handle of textures.values()) releaseTexture(engine, handle);
    for (const animation of data.animations) for (const channel of animation.channels) {
      channel.times.length = 0;
      channel.values.length = 0;
    }
    const discardNodeData = node => {
      node.matrix.length = 0;
      node.weights.length = 0;
      for (const primitive of node.primitives) {
        primitive.pos.length = 0; primitive.normal.length = 0; if (primitive.uv) primitive.uv.length = 0; if (primitive.tangent) primitive.tangent.length = 0; primitive.indices.length = 0;
        for (const set of [...primitive.joints, ...primitive.weights]) set.length = 0;
        for (const target of primitive.targets) { target.position && (target.position.length = 0); target.normal && (target.normal.length = 0); target.tangent && (target.tangent.length = 0); }
      }
      for (const child of node.children) discardNodeData(child);
    };
    for (const root of data.roots) discardNodeData(root);
    for (const skin of data.skins) { skin.joints.length = 0; skin.inverseBindMatrices.length = 0; }
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
    function getMaterial(spec) {
      let handle = materials.get(spec.materialIndex);
      if (handle) return handle;
      const id = engine._g3_asset_material(...spec.color, getTexture(spec.textureIndex, true), spec.alphaMode, spec.alphaCutoff,
        spec.metallic, spec.roughness, getTexture(spec.metallicRoughnessTextureIndex, false), getTexture(spec.normalTextureIndex, false), spec.normalScale,
        getTexture(spec.occlusionTextureIndex, false), spec.occlusionStrength, ...spec.emissive,
        getTexture(spec.emissiveTextureIndex, true), spec.doubleSided ? 1 : 0, spec.unlit ? 1 : 0, spec.ior);
      if (!engine._g3_asset_material_specular(id, spec.specularFactor, ...spec.specularColorFactor,
        getTexture(spec.specularTextureIndex, false), getTexture(spec.specularColorTextureIndex, true))) {
        throw new AssetError('UPLOAD', 'Could not set material specular properties');
      }
      if (!engine._g3_asset_material_clearcoat(id, spec.clearcoatFactor, spec.clearcoatRoughness,
        getTexture(spec.clearcoatTextureIndex, false), getTexture(spec.clearcoatRoughnessTextureIndex, false),
        getTexture(spec.clearcoatNormalTextureIndex, false), spec.clearcoatNormalScale)) {
        throw new AssetError('UPLOAD', 'Could not set material clearcoat properties');
      }
      for (let slot = 0; slot < spec.uvTransforms.length; slot++) {
        const transform = spec.uvTransforms[slot];
        if (!engine._g3_asset_material_uv_transform(id, slot, ...transform.offset, ...transform.scale, transform.rotation, transform.texcoord)) {
          throw new AssetError('UPLOAD', 'Could not set material texture transform');
        }
      }
      handle = makeResourceHandle(engine, id, 'material');
      materials.set(spec.materialIndex, handle);
      return handle;
    }
    function uploadMorphTargets(meshId, primitive, weights) {
      const targetCount = primitive.targets.length, vertexCount = primitive.pos.length / 3;
      if (!targetCount || targetCount > 64 ||
          primitive.pos.length * targetCount * 3 * Float32Array.BYTES_PER_ELEMENT > MAX_GPU_MORPH_BYTES ||
          typeof engine._g3_host_mesh_morph !== 'function' ||
          typeof engine._g3_host_morph_weights !== 'function' ||
          typeof engine._g3_host_mesh_morph_release !== 'function' ||
          typeof engine._g3_host_mesh_update_cpu !== 'function') return { enabled: false, weightsPtr: 0 };
      let positionsPtr = 0, normalsPtr = 0, tangentsPtr = 0, weightsPtr = 0, uploaded = false;
      try {
        const length = primitive.pos.length * targetCount;
        const positions = new Float32Array(length), normals = new Float32Array(length), tangents = new Float32Array(length);
        for (let targetIndex = 0; targetIndex < targetCount; targetIndex++) {
          const target = primitive.targets[targetIndex], offset = targetIndex * primitive.pos.length;
          if (target.position) positions.set(target.position, offset);
          if (target.normal) normals.set(target.normal, offset);
          if (target.tangent) tangents.set(target.tangent, offset);
        }
        positionsPtr = engine._malloc(positions.byteLength);
        normalsPtr = engine._malloc(normals.byteLength);
        tangentsPtr = engine._malloc(tangents.byteLength);
        weightsPtr = engine._malloc(targetCount * Float32Array.BYTES_PER_ELEMENT);
        if (!positionsPtr || !normalsPtr || !tangentsPtr || !weightsPtr) return { enabled: false, weightsPtr: 0 };
        engine.HEAPF32.set(positions, positionsPtr >>> 2);
        engine.HEAPF32.set(normals, normalsPtr >>> 2);
        engine.HEAPF32.set(tangents, tangentsPtr >>> 2);
        engine.HEAPF32.set(weights, weightsPtr >>> 2);
        uploaded = !!engine._g3_host_mesh_morph(meshId, positionsPtr, normalsPtr, tangentsPtr, vertexCount, targetCount);
        return { enabled: uploaded, weightsPtr: uploaded ? weightsPtr : 0 };
      } catch {
        return { enabled: false, weightsPtr: 0 };
      } finally {
        if (positionsPtr) engine._free(positionsPtr);
        if (normalsPtr) engine._free(normalsPtr);
        if (tangentsPtr) engine._free(tangentsPtr);
        if (!uploaded && weightsPtr) engine._free(weightsPtr);
        if (!uploaded && engine._g3_host_mesh_morph_release) engine._g3_host_mesh_morph_release(meshId);
      }
    }
    function uploadSkin(meshId, node, primitive) {
      const jointCount = data.skins[node.skinIndex].joints.length;
      if (!primitive.joints.length || typeof engine._g3_host_mesh_skin !== 'function' ||
          typeof engine._g3_host_joint_palette !== 'function' ||
          typeof engine._g3_host_mesh_update_cpu !== 'function') return { enabled: false, palettePtr: 0 };
      const vertexCount = primitive.pos.length / 3, attributes = new Float32Array(vertexCount * 16);
      for (let vertex = 0; vertex < vertexCount; vertex++) for (let set = 0; set < 2; set++) {
        for (let component = 0; component < 4; component++) {
          const offset = vertex * 4 + component, base = vertex * 16 + set * 8;
          if (primitive.joints[set]) attributes[base + component] = primitive.joints[set][offset];
          if (primitive.weights[set]) attributes[base + 4 + component] = primitive.weights[set][offset];
        }
      }
      let skinPtr = 0, palettePtr = 0, enabled = false;
      try {
        skinPtr = engine._malloc(attributes.byteLength);
        palettePtr = engine._malloc(jointCount * 16 * Float32Array.BYTES_PER_ELEMENT);
        if (!skinPtr || !palettePtr) return { enabled: false, palettePtr: 0 };
        engine.HEAPF32.set(attributes, skinPtr >>> 2);
        enabled = !!engine._g3_host_mesh_skin(meshId, skinPtr, attributes.length, jointCount);
        return { enabled, palettePtr: enabled ? palettePtr : 0 };
      } finally {
        if (skinPtr) engine._free(skinPtr);
        if (!enabled && palettePtr) engine._free(palettePtr);
      }
    }
    function createNode(node, parent, parentIndex = null) {
      const group = engine._g3_asset_node(-1, parent);
      const groupHandle = makeNodeHandle(engine, group);
      if (!groupHandle) throw new AssetError('UPLOAD', 'Could not create node');
      nodes.push(groupHandle);
      const primitiveHandles = [];
      const primitiveMaterials = [];
      node.matrix.forEach((value, index) => engine._g3_asset_matrix(group, index, value));
      if (node.translation || node.weights.length) transformNodes.set(node.index, {
        handle: groupHandle,
        baseTranslation: node.translation ? [...node.translation] : null, translation: node.translation ? [...node.translation] : null,
        baseRotation: node.rotation ? [...node.rotation] : null, rotation: node.rotation ? [...node.rotation] : null,
        baseScale: node.scale ? [...node.scale] : null, scale: node.scale ? [...node.scale] : null,
        baseWeights: [...node.weights], weights: [...node.weights],
      });
      for (const p of node.primitives) {
        engine._g3_asset_mesh_begin();
        const useAuthoredTangents = !!p.tangent;
        for (let i = 0; i < p.pos.length / 3; i++) engine._g3_asset_vertex(
          ...p.pos.slice(i*3, i*3+3), ...p.normal.slice(i*3, i*3+3), ...(p.uv ? p.uv.slice(i*2, i*2+2) : [0, 0]),
          ...(p.uv1 ? p.uv1.slice(i*2, i*2+2) : [0, 0]),
          ...(p.uv2 ? p.uv2.slice(i*2, i*2+2) : [0, 0]),
          ...(p.uv3 ? p.uv3.slice(i*2, i*2+2) : [0, 0]),
          ...(p.uv4 ? p.uv4.slice(i*2, i*2+2) : [0, 0]),
          ...(p.uv5 ? p.uv5.slice(i*2, i*2+2) : [0, 0]),
          ...(p.uv6 ? p.uv6.slice(i*2, i*2+2) : [0, 0]),
          ...(p.uv7 ? p.uv7.slice(i*2, i*2+2) : [0, 0]),
          ...(useAuthoredTangents ? p.tangent.slice(i*4, i*4+4) : [0, 0, 0, 0]),
          ...(p.vertexColor ? p.vertexColor.slice(i*p.colorComponents, i*p.colorComponents+p.colorComponents) : [1, 1, 1, 1]),
          ...(p.vertexColor && p.colorComponents === 3 ? [1] : []));
        for (let i = 0; i < p.indices.length; i += 3) engine._g3_asset_triangle(...p.indices.slice(i, i+3));
        const mesh = engine._g3_asset_mesh_end();
        const meshHandle = makeResourceHandle(engine, mesh, 'mesh');
        meshes.push(meshHandle);
        if (node.skinIndex >= 0 || p.targets.length) {
          const byteLength = p.pos.length * Float32Array.BYTES_PER_ELEMENT;
          const tangentByteLength = (p.pos.length / 3) * 4 * Float32Array.BYTES_PER_ELEMENT;
          const ptr = engine._malloc(byteLength * 2 + tangentByteLength);
          if (!ptr) throw new AssetError('MEMORY', 'Could not allocate animated mesh deformation buffers');
          const deformation = { handle: meshHandle, node: node.index, skinIndex: node.skinIndex,
            weights: [...node.weights], primitive: p, ptr, gpuSkin: false, gpuMorph: false,
            gpuDeform: false, palettePtr: 0, morphWeightsPtr: 0 };
          deformedMeshes.push(deformation);
          if (p.targets.length) {
            const morph = uploadMorphTargets(mesh, p, node.weights);
            deformation.gpuMorph = morph.enabled;
            deformation.morphWeightsPtr = morph.weightsPtr;
          }
          if (node.skinIndex >= 0 && (!p.targets.length || deformation.gpuMorph)) {
            const skin = uploadSkin(mesh, node, p);
            deformation.gpuSkin = skin.enabled;
            deformation.palettePtr = skin.palettePtr;
          }
          if (p.targets.length && node.skinIndex >= 0 && !deformation.gpuSkin && deformation.gpuMorph) {
            engine._g3_host_mesh_morph_release(mesh);
            deformation.gpuMorph = false;
            engine._free(deformation.morphWeightsPtr);
            deformation.morphWeightsPtr = 0;
          }
          deformation.gpuDeform = deformation.gpuMorph || deformation.gpuSkin;
        }
        const id = engine._g3_asset_node(mesh, group);
        const nodeHandle = makeNodeHandle(engine, id);
        if (!nodeHandle) throw new AssetError('UPLOAD', 'Could not create node');
        nodes.push(nodeHandle);
        primitiveHandles.push(nodeHandle);
        const material = getMaterial(p);
        engine._g3_asset_node_material(id, material.id);
        primitiveMaterials.push(Object.freeze({
          default: inspectMaterial(p),
          variants: Object.freeze([...p.variantMaterials].map(([index, spec]) => Object.freeze({
            index, name: data.variantNames[index], material: inspectMaterial(spec),
          }))),
        }));
        if (p.variantMaterials.size) variantBindings.push({ handle: nodeHandle, defaultMaterial: material.id,
          materials: new Map([...p.variantMaterials].map(([variantIndex, spec]) => [variantIndex, getMaterial(spec).id])) });
      }
      modelNodes.push(Object.freeze({
        index: node.index, name: node.name, parent: parentIndex,
        children: Object.freeze(node.children.map(child => child.index)),
        mesh: node.meshIndex, skin: node.skinIndex < 0 ? null : node.skinIndex,
        handle: groupHandle, primitives: Object.freeze(primitiveHandles),
        primitiveMaterials: Object.freeze(primitiveMaterials),
      }));
      for (const child of node.children) createNode(child, group, node.index);
      return groupHandle;
    }
    const roots = data.roots.map(root => createNode(root, -1));
    if (!applyAnimation(-1, 0)) throw new AssetError('UPLOAD', 'Could not initialize skinned model');
    return {
      sceneIndex: data.sceneIndex,
      roots: Object.freeze(roots),
      nodes: Object.freeze(modelNodes),
      animations: Object.freeze(data.animations.map(({ name, duration }, index) => Object.freeze({ index, name, duration }))),
      variants: Object.freeze([...data.variantNames]),
      meshes: Object.freeze([...meshes]),
      materials: Object.freeze([...materials.values()]),
      textures: Object.freeze([...textures.values()]),
      setVariant(variant) {
        if (disposed || sceneEpoch !== engine._g3_asset_scene_epoch()) return false;
        const index = variant === null ? -1 : typeof variant === 'string' ? data.variantNames.indexOf(variant) : variant;
        if (variant !== null && (!Number.isInteger(index) || index < 0 || index >= data.variantNames.length)) return false;
        for (const binding of variantBindings) {
          if (!isNodeHandleValid(engine, binding.handle)) return false;
          engine._g3_asset_node_material(binding.handle.index, index < 0 ? binding.defaultMaterial : binding.materials.get(index) ?? binding.defaultMaterial);
        }
        activeVariant = index;
        return true;
      },
      get activeVariant() { return activeVariant; },
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
