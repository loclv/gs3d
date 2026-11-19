import { Color } from './color';
import { composeLocal, multiplyMat4, quatFromEulerOrder, eulerFromQuatXYZ } from './math';
import { BufferGeometry, Float32BufferAttribute } from './geometry';
import { WRAP_TO_ENGINE, FILTER_TO_GL, textureImageData, ensureEngineRenderTarget, LinearFilter, NearestFilter, FloatType, HalfFloatType } from './textures';
import { BackSide } from './materials';
import { SRGBColorSpace } from './renderer';
import { vertexAttrInfo } from './raw-shader';

/* --- engine bridge state ----------------------------------------------------------- */

// One wasm engine per page. Entries are WeakMaps so scenes collect normally.
export let sharedEngine: any = null;
export function setSharedEngine(e: any) { sharedEngine = e; }
export const nodeStates = new WeakMap();   // Object3D -> engine node record
const geometryStates = new WeakMap(); // BufferGeometry -> {flag: {id,generation,version}}
export const materialStates = new WeakMap(); // Material -> {id,generation,signature}
// Custom fragment shaders ({header, body} GLSL) are compiled once per object
// and shared by every material that references it.
export const customShaderIds = new WeakMap(); // customShader object -> engine shader id
let customShaderSeq = 0;
export const cameraStates = new WeakMap();  // Camera -> engine camera id
const textureStates = new WeakMap(); // Texture -> {id,generation,signature}
const texture3dStates = new WeakMap(); // Data3DTexture -> {id,generation,signature}
let engineCanvasSeq = 0;
// Objects that currently own an engine node. render() releases records for
// objects absent from the scene being drawn, so switching scenes cannot leak
// the previous scene's nodes into the frame.
export const syncedObjects = new Set<any>();

export function releaseNodeRecord(record) {
  if (!record || !sharedEngine) return;
  sharedEngine._g3_asset_node_release(record.index, record.generation, record.epoch);
}
export function releaseEngineTree(object) {
  // Release every engine node in the detached subtree. Engine-side children
  // reparent automatically; the sync pass recreates whatever is reattached.
  const records = [];
  object.traverse(node => {
    const record = nodeStates.get(node);
    if (record) { records.push(record); nodeStates.delete(node); syncedObjects.delete(node); }
  });
  for (const record of records) releaseNodeRecord(record);
}

function releaseGeometryFlag(geometry, flag) {
  const byFlag = geometryStates.get(geometry);
  const state = byFlag?.[flag];
  if (state && sharedEngine) sharedEngine._g3_asset_release_mesh(state.id, state.generation);
  if (byFlag) delete byFlag[flag];
}
export function releaseGeometry(geometry) {
  const byFlag = geometryStates.get(geometry);
  if (byFlag) for (const flag of Object.keys(byFlag)) {
    const state = byFlag[flag];
    if (state && sharedEngine) sharedEngine._g3_asset_release_mesh(state.id, state.generation);
  }
  geometryStates.delete(geometry);
}
export function releaseMaterial(material) {
  const state = materialStates.get(material);
  if (state && sharedEngine) sharedEngine._g3_asset_release_material(state.id, state.generation);
  materialStates.delete(material);
}
export function releaseTexture(texture) {
  const state = textureStates.get(texture);
  if (state && sharedEngine) sharedEngine._g3_asset_release_texture(state.id, state.generation);
  textureStates.delete(texture);
  const state3d = texture3dStates.get(texture);
  if (state3d && sharedEngine) sharedEngine._g3_asset_release_texture(state3d.id, state3d.generation);
  texture3dStates.delete(texture);
}

function textureSignature(texture) {
  // Only upload-affecting fields; UV transform lives on the material.
  const image = textureImageData(texture.image);
  return [
    image ? `${image.width}x${image.height}` : 'pending',
    texture.colorSpace, texture.wrapS, texture.wrapT,
    texture.magFilter, texture.minFilter, texture.version,
  ].join(',');
}

export function ensureTexture(engine, texture) {
  if (texture.isRenderTargetTexture) {
    const rt = texture._renderTarget;
    return rt ? ensureEngineRenderTarget(engine, rt) : -1;
  }
  const signature = textureSignature(texture);
  const state = textureStates.get(texture);
  if (state && state.signature === signature) return state.id;
  if (state) engine._g3_asset_release_texture(state.id, state.generation);
  const image = textureImageData(texture.image);
  if (!image?.pixels?.length) return -1;

  const f16 = (texture.type === HalfFloatType || image.pixels instanceof Uint16Array) &&
    image.pixels.byteLength === image.width * image.height * 8 &&
    typeof engine._g3_host_texture_f16 === 'function';
  const ptr = engine._malloc(image.pixels.byteLength || image.pixels.length);
  if (!ptr) return -1;
  let id = -1;
  try {
    engine.HEAPU8.set(image.pixels instanceof Uint8Array || image.pixels instanceof Uint8ClampedArray
      ? image.pixels
      : image.pixels instanceof Uint16Array
        ? new Uint8Array(image.pixels.buffer, image.pixels.byteOffset, image.pixels.byteLength)
        : new Uint8ClampedArray(image.pixels), ptr);
    if (f16) {
      id = engine._g3_host_texture_f16(image.width, image.height, ptr, image.pixels.byteLength);
    } else {
      id = engine._g3_asset_texture();
      if (id >= 0) {
        const srgb = texture.colorSpace === SRGBColorSpace;
        if (srgb) engine._g3_host_texture_srgb(id, ptr, image.width, image.height);
        else engine._g3_host_texture(id, ptr, image.width, image.height);
      }
    }
    if (id < 0) return -1;
    const wrapU = WRAP_TO_ENGINE[texture.wrapS] ?? 1;
    const wrapV = WRAP_TO_ENGINE[texture.wrapT] ?? 1;
    engine._g3_host_texture_wrap(id, wrapU, wrapV);
    const minFilter = FILTER_TO_GL[texture.minFilter] ?? 9729;
    const magFilter = FILTER_TO_GL[texture.magFilter] ?? 9729;
    engine._g3_host_texture_filter(id, minFilter, magFilter);
  } finally {
    engine._free(ptr);
  }
  const record = { id, generation: engine._g3_asset_texture_generation(id), signature };
  textureStates.set(texture, record);
  return id;
}

export function ensureTexture3D(engine, texture) {
  if (!texture || !texture.isData3DTexture) return -1;
  if (typeof engine._g3_host_texture_3d !== 'function') return -1;
  const image = texture.image;
  const data = image?.data;
  const f16 = data instanceof Uint16Array &&
    typeof engine._g3_host_texture_3d_f16 === 'function';
  if (!data || !(data instanceof Uint8Array || data instanceof Uint8ClampedArray || f16)) return -1;
  const signature = [image ? `${image.width}x${image.height}x${image.depth}` : 'pending',
    texture.version, f16 ? 'f16' : 'rgba8'].join(',');
  const state = texture3dStates.get(texture);
  if (state && state.signature === signature) return state.id;
  if (state) engine._g3_asset_release_texture(state.id, state.generation);
  const ptr = engine._malloc(data.byteLength || data.length);
  if (!ptr) return -1;
  try {
    engine.HEAPU8.set(data instanceof Uint8Array || data instanceof Uint8ClampedArray
      ? data : new Uint8Array(data.buffer, data.byteOffset, data.byteLength), ptr);
    const id = f16
      ? engine._g3_host_texture_3d_f16(image.width, image.height, image.depth, ptr, data.byteLength)
      : engine._g3_host_texture_3d(image.width, image.height, image.depth, ptr, data.length);
    if (id < 0) return -1;
    const record = { id, generation: engine._g3_asset_texture_generation(id), signature };
    texture3dStates.set(texture, record);
    return id;
  } finally {
    engine._free(ptr);
  }
}

// rotation (Euler) and quaternion are two views of the same orientation.
// Whichever changed since the last resolve wins; the other is synced so
// reads stay consistent. Both-changed resolves to the quaternion.
function resolvedQuaternion(object) {
  const q = object.quaternion, e = object.rotation;
  const qc = object._qCache, ec = object._eCache;
  const qChanged = q.x !== qc.x || q.y !== qc.y || q.z !== qc.z || q.w !== qc.w;
  const eChanged = e.x !== ec.x || e.y !== ec.y || e.z !== ec.z || e.order !== ec.order;
  if (qChanged) {
    if ((e.order || 'XYZ') === 'XYZ') {
      const [ex, ey, ez] = eulerFromQuatXYZ(q);
      e.set(ex, ey, ez);
    }
  } else if (eChanged) {
    const nq = quatFromEulerOrder(e.x, e.y, e.z, e.order);
    q.set(nq.x, nq.y, nq.z, nq.w);
  }
  qc.x = q.x; qc.y = q.y; qc.z = q.z; qc.w = q.w;
  ec.x = e.x; ec.y = e.y; ec.z = e.z; ec.order = e.order;
  return q;
}

export function localMatrixOf(object) {
  if (object.matrixAutoUpdate === false && object.matrix) return object.matrix.elements;
  const p = object.position, s = object.scale, q = resolvedQuaternion(object);
  // Compose is the expensive part (six trig calls); skip it while the
  // transform inputs are unchanged. The cache lives on the object so it
  // survives across frames and worlds.
  const c = object._lmCache;
  if (c && c.px === p.x && c.py === p.y && c.pz === p.z &&
      c.qx === q.x && c.qy === q.y && c.qz === q.z && c.qw === q.w &&
      c.sx === s.x && c.sy === s.y && c.sz === s.z) return c.elements;
  const elements = composeLocal(p, q, s);
  object._lmCache = { elements, px: p.x, py: p.y, pz: p.z,
    qx: q.x, qy: q.y, qz: q.z, qw: q.w, sx: s.x, sy: s.y, sz: s.z };
  return elements;
}

export function worldMatrixOf(object) {
  let world = localMatrixOf(object);
  let parent = object.parent;
  while (parent) {
    world = multiplyMat4(localMatrixOf(parent), world);
    parent = parent.parent;
  }
  return world;
}

// material.flatShading is emulated by expanding the geometry into
// non-indexed triangles with per-face normals. Cached per source geometry
// and rebuilt whenever its version bumps.
const flatGeometryCache = new WeakMap();
function flatShadedGeometry(geometry) {
  const cached = flatGeometryCache.get(geometry);
  if (cached && cached.version === geometry.version) return cached.geo;
  const src = attrData(geometry.attributes.position);
  const p = src?.array, is = src?.itemSize;
  const index = geometry.index && geometry.index.array;
  const triCount = index ? index.length / 3 : src.count / 3;
  const vertCount = triCount * 3;
  const positions = new Float32Array(vertCount * 3);
  const normals = new Float32Array(vertCount * 3);
  const uvs = [], colors = [];
  const uvData = attrData(geometry.attributes.uv);
  const colorData = attrData(geometry.attributes.color);
  const uvAttr = uvData, colorAttr = colorData;
  const readVert = vi => {
    const i = vi * is;
    return [p[i], p[i + 1] || 0, p[i + 2] || 0];
  };
  let w = 0;
  for (let t = 0; t < triCount; t++) {
    const ia = index ? index[t * 3] : t * 3;
    const ib = index ? index[t * 3 + 1] : t * 3 + 1;
    const ic = index ? index[t * 3 + 2] : t * 3 + 2;
    const a = readVert(ia), b = readVert(ib), c = readVert(ic);
    const ux = b[0] - a[0], uy = b[1] - a[1], uz = b[2] - a[2];
    const vx = c[0] - a[0], vy = c[1] - a[1], vz = c[2] - a[2];
    let nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
    const nl = Math.hypot(nx, ny, nz);
    if (nl > 1e-12) { nx /= nl; ny /= nl; nz /= nl; }
    for (const vi of [ia, ib, ic]) {
      const v = readVert(vi);
      positions[w] = v[0]; positions[w + 1] = v[1]; positions[w + 2] = v[2];
      normals[w] = nx; normals[w + 1] = ny; normals[w + 2] = nz;
      w += 3;
      if (uvAttr) {
        const ui = vi * uvAttr.itemSize;
        uvs.push(uvAttr.array[ui] || 0, uvAttr.array[ui + 1] || 0);
      }
      if (colorAttr) {
        const ci = vi * colorAttr.itemSize;
        colors.push(colorAttr.array[ci] || 1, colorAttr.array[ci + 1] || 1,
          colorAttr.array[ci + 2] || 1, colorAttr.array[ci + 3] ?? 1);
      }
    }
  }
  const geo = new BufferGeometry();
  geo.setAttribute('position', new Float32BufferAttribute(positions, 3));
  geo.setAttribute('normal', new Float32BufferAttribute(normals, 3));
  if (uvAttr) geo.setAttribute('uv', new Float32BufferAttribute(uvs, 2));
  if (colorAttr) geo.setAttribute('color', new Float32BufferAttribute(colors, colorAttr.itemSize));
  flatGeometryCache.set(geometry, { version: geometry.version, geo });
  return geo;
}

/* Custom vertex attributes — anything that is not position, normal, color,
   tangent or an explicit uv/uvN slot — are packed into the eight vec2 UV
   channels the engine vertex format carries, after the explicit uv
   attributes claim theirs. Each attribute owns ceil(itemSize/2) whole
   slots, filled in component order. Slot ownership is global and
   append-only (customAttrRegistry) so a ShaderMaterial's vertex decode is
   consistent across geometries; an attribute whose slots collide with a
   geometry's explicit uvN attributes is dropped there (its channels read
   as zeros or the material's defaultAttributeValues). Attributes a
   material needs but the geometry lacks are filled from
   material.defaultAttributeValues, or declared ShaderMaterial attributes. */

export const UV_SLOT_ATTRS = ['uv', 'uv1', 'uv2', 'uv3', 'uv4', 'uv5', 'uv6', 'uv7'];
const STANDARD_ATTRS = new Set(['position', 'normal', 'color', 'tangent', ...UV_SLOT_ATTRS]);
export const customAttrRegistry = new Map(); // name -> {slots:[...], itemSize}
export let customAttrRegistryVersion = 0;
const attrDataCache = new WeakMap();

export function attrData(attribute) {
  if (!attribute) return null;
  if (attribute.isInterleavedBufferAttribute) {
    let cached = attrDataCache.get(attribute);
    if (!cached) {
      const { data, itemSize, offset } = attribute;
      const stride = data.stride, count = attribute.count, src = data.array;
      const out = new Float32Array(count * itemSize);
      for (let i = 0; i < count; i++) {
        const base = i * stride + offset;
        for (let c = 0; c < itemSize; c++) out[i * itemSize + c] = src[base + c] ?? 0;
      }
      cached = { array: out, itemSize, count };
      attrDataCache.set(attribute, cached);
    }
    return cached;
  }
  return { array: attribute.array, itemSize: attribute.itemSize, count: attribute.count };
}

function allocateCustomSlots(need, blocked) {
  const used = new Set();
  for (const reg of customAttrRegistry.values()) for (const s of reg.slots) used.add(s);
  for (let s = 0; s < 8; s++) if (blocked[s]) used.add(s);
  for (let start = 0; start + need <= 8; start++) {
    let ok = true;
    for (let k = 0; k < need; k++) if (used.has(start + k)) { ok = false; break; }
    if (ok) return Array.from({ length: need }, (_, k) => start + k);
  }
  return null;
}

// The attribute layout resolution (uv slots, custom attributes, fills) only
// depends on the geometry's attributes, the vertex-color/flat-shading flags
// and the material's defaultAttributeValues/ShaderMaterial declarations —
// none of which change between frames in practice. Cache the resolved layout
// per (geometry, material, flags) and revalidate cheaply each call instead of
// rebuilding attribute tables and signature strings every render().
const preparedGeometryCache = new WeakMap(); // geometry -> WeakMap<material, Map<flags, entry>>
const NO_MATERIAL = {};

function preparedGeometry(geometry, useVertexColors, flatShading, material) {
  const src = flatShading ? flatShadedGeometry(geometry) : geometry;
  const position = attrData(src.attributes.position);
  if (!position) return null;
  if (!src.attributes.normal) src.computeVertexNormals();
  const normal = attrData(src.attributes.normal);
  const count = position.count;

  // Explicit uv/uvN attributes claim their named slots first.
  const slotData = new Array(8).fill(null);
  const claimed = new Array(8).fill(false);
  for (let set = 0; set < 8; set++) {
    const attr = attrData(src.attributes[set === 0 ? 'uv' : `uv${set}`]);
    if (attr) { slotData[set] = attr; claimed[set] = true; }
  }
  const color = useVertexColors ? attrData(src.attributes.color) : null;
  const ns = normal ? normal.itemSize : 3, cs = color ? color.itemSize : 4;

  // Collect custom attribute names: everything on the geometry outside the
  // standard set, plus names the material references through
  // defaultAttributeValues or ShaderMaterial vertex declarations.
  const customNames = [];
  const pushName = name => {
    if (!STANDARD_ATTRS.has(name) && !customNames.includes(name)) customNames.push(name);
  };
  for (const name of Object.keys(src.attributes)) pushName(name);
  const defaults = material && material.defaultAttributeValues;
  if (defaults) for (const name of Object.keys(defaults)) {
    if (Array.isArray(defaults[name])) pushName(name);
  }
  if (material && (material.isShaderMaterial || material.isRawShaderMaterial)) {
    for (const a of vertexAttrInfo(material)) pushName(a.name);
  }

  const customs = [], fills = [];
  for (const name of customNames) {
    const data = attrData(src.attributes[name]);
    const itemSize = Math.min(4, Math.max(1,
      data ? data.itemSize : (defaults && Array.isArray(defaults[name]) ? defaults[name].length : 2)));
    let reg = customAttrRegistry.get(name);
    if (!reg) {
      const slots = allocateCustomSlots(Math.ceil(itemSize / 2), claimed);
      if (!slots) continue; // channel budget exhausted; attribute reads as zero
      reg = { slots, itemSize };
      customAttrRegistry.set(name, reg);
      customAttrRegistryVersion++;
    }
    const capacity = reg.slots.length * 2;
    if (reg.slots.some(s => claimed[s])) {
      // Explicit uvN attributes win this geometry's slots; the custom
      // attribute is dropped here and its channels stay at defaults.
      if (defaults && Array.isArray(defaults[name])) {
        fills.push({ slots: reg.slots, values: defaults[name], count: Math.min(defaults[name].length, capacity) });
      }
      continue;
    }
    if (data) {
      customs.push({ name, data, slots: reg.slots, count: Math.min(data.itemSize, capacity) });
    } else if (defaults && Array.isArray(defaults[name])) {
      fills.push({ slots: reg.slots, values: defaults[name], count: Math.min(defaults[name].length, capacity) });
    }
  }

  const customSig = customs.map(c => `${c.name}:${c.slots}`).join(',') +
    '|' + fills.map(f => `${f.name}=${f.values}`).join(',');
  return {
    src, position, normal, color, count, ns, cs, slotData, customs, fills,
    flag: `${useVertexColors ? 1 : 0}${flatShading ? 1 : 0}|${customSig}`,
    indexIds: src.index ? src.index.array : null,
    // Revalidation inputs: anything the layout depends on that can change
    // without bumping geometry.version.
    gVersion: geometry.version,
    regVersion: customAttrRegistryVersion,
    vs: material ? material.vertexShader : undefined,
    defaults,
    isShader: !!(material && (material.isShaderMaterial || material.isRawShaderMaterial)),
  };
}

function cachedPreparedGeometry(geometry, useVertexColors, flatShading, material) {
  const flags = `${useVertexColors ? 1 : 0}${flatShading ? 1 : 0}`;
  let byMaterial = preparedGeometryCache.get(geometry);
  if (!byMaterial) preparedGeometryCache.set(geometry, byMaterial = new WeakMap());
  const key = material || NO_MATERIAL;
  let byFlags = byMaterial.get(key);
  if (!byFlags) byMaterial.set(key, byFlags = new Map());
  let entry = byFlags.get(flags);
  const defaults = material && material.defaultAttributeValues;
  const isShader = !!(material && (material.isShaderMaterial || material.isRawShaderMaterial));
  if (entry && entry.gVersion === geometry.version &&
      entry.regVersion === customAttrRegistryVersion &&
      entry.vs === (material ? material.vertexShader : undefined) &&
      entry.defaults === defaults && entry.isShader === isShader) {
    return entry;
  }
  entry = preparedGeometry(geometry, useVertexColors, flatShading, material);
  if (entry) byFlags.set(flags, entry);
  return entry;
}

function fillVertexSlots(slotVals, slotData, customs, fills, i) {
  slotVals.fill(0);
  for (let set = 0; set < 8; set++) {
    const attr = slotData[set];
    if (attr) {
      const ui = i * attr.itemSize;
      slotVals[set * 2] = attr.array[ui] || 0;
      slotVals[set * 2 + 1] = attr.array[ui + 1] || 0;
    }
  }
  for (const cu of customs) {
    const base = i * cu.data.itemSize;
    for (let f = 0; f < cu.count; f++) {
      slotVals[cu.slots[f >> 1] * 2 + (f & 1)] = cu.data.array[base + f] || 0;
    }
  }
  for (const f of fills) {
    for (let k = 0; k < f.count; k++) {
      slotVals[f.slots[k >> 1] * 2 + (k & 1)] = f.values[k] || 0;
    }
  }
}

const _slotVals = new Float64Array(16);

function uploadGeometryBulk(engine, prepared) {
  const { position, normal, color, count, ns, cs, slotData, customs, fills, indexIds } = prepared;
  const indexCount = indexIds ? indexIds.length - (indexIds.length % 3) : count - (count % 3);
  if (count <= 0 || indexCount <= 0) return -1;
  const p = position.array, n = normal ? normal.array : null, c = color ? color.array : null;
  const floatCount = count * 30;
  const vPtr = engine._malloc(floatCount * 4);
  const iPtr = engine._malloc(indexCount * 4);
  try {
    const vf = engine.HEAPF32;
    const vBase = vPtr >> 2;
    for (let i = 0; i < count; i++) {
      const pi = i * position.itemSize, ni = i * ns, ci = i * cs;
      fillVertexSlots(_slotVals, slotData, customs, fills, i);
      const o = vBase + i * 30;
      vf[o] = p[pi]; vf[o + 1] = p[pi + 1]; vf[o + 2] = p[pi + 2];
      vf[o + 3] = n && ns > 0 ? n[ni] : 0;
      vf[o + 4] = n && ns > 1 ? n[ni + 1] : 0;
      vf[o + 5] = n && ns > 2 ? n[ni + 2] : 1;
      for (let s = 0; s < 16; s++) vf[o + 6 + s] = _slotVals[s];
      vf[o + 22] = 0; vf[o + 23] = 0; vf[o + 24] = 0; vf[o + 25] = 0;
      vf[o + 26] = c && cs > 0 ? c[ci] : 1;
      vf[o + 27] = c && cs > 1 ? c[ci + 1] : 1;
      vf[o + 28] = c && cs > 2 ? c[ci + 2] : 1;
      vf[o + 29] = c && cs > 3 ? c[ci + 3] : 1;
    }
    const iu = engine.HEAPU32 || new Uint32Array(engine.HEAPU8.buffer);
    const iBase = iPtr >> 2;
    if (indexIds) {
      for (let i = 0; i < indexCount; i++) iu[iBase + i] = indexIds[i];
    } else {
      for (let i = 0; i < indexCount; i++) iu[iBase + i] = i;
    }
    return engine._g3_host_mesh_upload(vPtr, floatCount, iPtr, indexCount);
  } finally {
    engine._free(vPtr);
    engine._free(iPtr);
  }
}

export function ensureGeometry(engine, geometry, useVertexColors = false, flatShading = false, material = null) {
  if (!geometry || !geometry.attributes || !geometry.attributes.position) return -1;
  const prepared = cachedPreparedGeometry(geometry, useVertexColors, flatShading, material);
  if (!prepared) return -1;
  const { position, normal, color, count, ns, cs, slotData, customs, fills, flag, indexIds } = prepared;
  const p = position.array, n = normal ? normal.array : null, c = color ? color.array : null;
  const byFlag = geometryStates.get(geometry) || {};
  const state = byFlag[flag];
  if (state && state.version === geometry.version) return state.id;
  if (state) engine._g3_asset_release_mesh(state.id, state.generation);

  let id = -1;
  if (typeof engine._g3_host_mesh_upload === 'function' && engine.HEAPF32 && (engine.HEAPU32 || engine.HEAPU8)) {
    id = uploadGeometryBulk(engine, prepared);
  }
  if (id < 0) {
    const slotVals = new Float64Array(16);
    engine._g3_asset_mesh_begin();
    for (let i = 0; i < count; i++) {
      const pi = i * position.itemSize, ni = i * ns, ci = i * cs;
      fillVertexSlots(slotVals, slotData, customs, fills, i);
      engine._g3_asset_vertex(
        p[pi], p[pi + 1], p[pi + 2],
        n && ns > 0 ? n[ni] : 0, n && ns > 1 ? n[ni + 1] : 0, n && ns > 2 ? n[ni + 2] : 1,
        ...slotVals,
        0, 0, 0, 0, // tangent
        c && cs > 0 ? c[ci] : 1, c && cs > 1 ? c[ci + 1] : 1, c && cs > 2 ? c[ci + 2] : 1,
        c && cs > 3 ? c[ci + 3] : 1,
      );
    }
    if (indexIds) {
      const ids = indexIds;
      for (let i = 0; i + 2 < ids.length; i += 3) engine._g3_asset_triangle(ids[i], ids[i + 1], ids[i + 2]);
    } else {
      for (let i = 0; i + 2 < count; i += 3) engine._g3_asset_triangle(i, i + 1, i + 2);
    }
    id = engine._g3_asset_mesh_end();
  }
  const record = { id, generation: engine._g3_asset_mesh_generation(id), version: geometry.version };
  byFlag[flag] = record;
  geometryStates.set(geometry, byFlag);
  return id;
}

export const ALPHA_OPAQUE = 0, ALPHA_MASK = 1, ALPHA_BLEND = 2, ALPHA_ADDITIVE = 3, ALPHA_PREMULTIPLIED = 4;

export function materialSignature(material) {
  const parts = [material.color.r, material.color.g, material.color.b, material.opacity,
    material.transparent, material.alphaTest, material.side, material.visible];
  if (material.isMeshStandardMaterial || material.isMeshPhysicalMaterial) {
    parts.push(material.metalness, material.roughness, material.emissive.r, material.emissive.g,
      material.emissive.b, material.emissiveIntensity, material.ior, material.envMapIntensity);
  }
  const cs = material.customShader;
  if (cs) {
    if (!cs._gs3dKey) cs._gs3dKey = ++customShaderSeq;
    parts.push('cs' + cs._gs3dKey);
    const u = material.customUniforms;
    if (u) for (let i = 0; i < 32; i++) parts.push(u[i] ?? 0);
  }
  return parts.join(',');
}

// Engine texture slots mirror the g3_asset_material argument order:
// 0 base color, 1 metallic-roughness (packed G=roughness, B=metallic),
// 2 normal, 3 occlusion (R channel), 4 emissive.
const MATERIAL_MAPS = [
  ['map', 0],
  ['metalnessMap', 1], ['roughnessMap', 1],
  ['normalMap', 2],
  ['aoMap', 3],
  ['emissiveMap', 4],
];

export function materialMaps(material) {
  const maps = [null, null, null, null, null];
  for (const [key, slot] of MATERIAL_MAPS) {
    const texture = material[key];
    if (texture && texture.isTexture && !maps[slot]) maps[slot] = texture;
  }
  return maps;
}

export function textureUvSignature(texture) {
  return `${texture.offset.x},${texture.offset.y},${texture.repeat.x},${texture.repeat.y},${texture.rotation},${texture.channel || 0}`;
}

// Material -> engine material id, deduplicated for the duration of one
// render() pass so shared materials pay the signature cost once per frame.
export let frameMaterialCache: Map<any, any> | null = null;
export function setFrameMaterialCache(c: Map<any, any> | null) { frameMaterialCache = c; } // replaced null;
export let fallbackMaterial: any = null;
export function setFallbackMaterial(m: any) { fallbackMaterial = m; }

