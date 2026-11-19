import { Color, Vector2, Vector3, composeLocal, multiplyMat4, transformPoint, transformDir, normalize3, quatFromEulerOrder, eulerFromQuatXYZ } from './math';
import { BufferGeometry, Float32BufferAttribute, Mesh } from './geometry';
import { WRAP_TO_ENGINE, FILTER_TO_GL, textureImageData, ensureEngineRenderTarget, AdditiveBlending, CustomBlending, OneFactor, OneMinusSrcAlphaFactor, AddEquation, LinearFilter, NearestFilter, FloatType, HalfFloatType } from './textures';
import { FrontSide, BackSide, DoubleSide, MeshBasicMaterial } from './materials';
import { SRGBColorSpace, BasicShadowMap, PCFSoftShadowMap, VSMShadowMap } from './renderer';

const DEG2RAD = Math.PI / 180;
const MAX_EXTRA_LIGHTS = 8;

/* --- engine bridge state ----------------------------------------------------------- */

// One wasm engine per page. Entries are WeakMaps so scenes collect normally.
export let sharedEngine: any = null;
export function setSharedEngine(e: any) { sharedEngine = e; }
export const nodeStates = new WeakMap();   // Object3D -> engine node record
const geometryStates = new WeakMap(); // BufferGeometry -> {flag: {id,generation,version}}
const materialStates = new WeakMap(); // Material -> {id,generation,signature}
// Custom fragment shaders ({header, body} GLSL) are compiled once per object
// and shared by every material that references it.
const customShaderIds = new WeakMap(); // customShader object -> engine shader id
let customShaderSeq = 0;
const cameraStates = new WeakMap();  // Camera -> engine camera id
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

function ensureTexture(engine, texture) {
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

function ensureTexture3D(engine, texture) {
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

const UV_SLOT_ATTRS = ['uv', 'uv1', 'uv2', 'uv3', 'uv4', 'uv5', 'uv6', 'uv7'];
const STANDARD_ATTRS = new Set(['position', 'normal', 'color', 'tangent', ...UV_SLOT_ATTRS]);
const customAttrRegistry = new Map(); // name -> {slots:[...], itemSize}
let customAttrRegistryVersion = 0;
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

function ensureGeometry(engine, geometry, useVertexColors = false, flatShading = false, material = null) {
  if (!geometry || !geometry.attributes || !geometry.attributes.position) return -1;
  const prepared = cachedPreparedGeometry(geometry, useVertexColors, flatShading, material);
  if (!prepared) return -1;
  const { position, normal, color, count, ns, cs, slotData, customs, fills, flag, indexIds } = prepared;
  const p = position.array, n = normal ? normal.array : null, c = color ? color.array : null;
  const byFlag = geometryStates.get(geometry) || {};
  const state = byFlag[flag];
  if (state && state.version === geometry.version) return state.id;
  if (state) engine._g3_asset_release_mesh(state.id, state.generation);

  const slotVals = new Float64Array(16);
  engine._g3_asset_mesh_begin();
  for (let i = 0; i < count; i++) {
    const pi = i * position.itemSize, ni = i * ns, ci = i * cs;
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
  const id = engine._g3_asset_mesh_end();
  const record = { id, generation: engine._g3_asset_mesh_generation(id), version: geometry.version };
  byFlag[flag] = record;
  geometryStates.set(geometry, byFlag);
  return id;
}

const ALPHA_OPAQUE = 0, ALPHA_MASK = 1, ALPHA_BLEND = 2, ALPHA_ADDITIVE = 3, ALPHA_PREMULTIPLIED = 4;

function materialSignature(material) {
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

function materialMaps(material) {
  const maps = [null, null, null, null, null];
  for (const [key, slot] of MATERIAL_MAPS) {
    const texture = material[key];
    if (texture && texture.isTexture && !maps[slot]) maps[slot] = texture;
  }
  return maps;
}

function textureUvSignature(texture) {
  return `${texture.offset.x},${texture.offset.y},${texture.repeat.x},${texture.repeat.y},${texture.rotation},${texture.channel || 0}`;
}

// Material -> engine material id, deduplicated for the duration of one
// render() pass so shared materials pay the signature cost once per frame.
export let frameMaterialCache: Map<any, any> | null = null;
export function setFrameMaterialCache(c: Map<any, any> | null) { frameMaterialCache = c; } // replaced null;
let fallbackMaterial = null;

/* --- raw shader materials ----------------------------------------------------- */

// ShaderMaterial -> {id, sourceKey, uniformSig}: one engine program per
// material instance; uniform values update in place through the program's
// generation counter, so they never force a material re-creation.
const rawShaderStates = new WeakMap();

const RAW_SHADER_CHUNKS = {
  tonemapping_fragment: 'gl_FragColor.rgb = g3_tone_map(gl_FragColor.rgb);',
  colorspace_fragment: 'if (u_g3_output_srgb > 0.5) { gl_FragColor.rgb = g3_encode_srgb(gl_FragColor.rgb); }',
};

function resolveRawChunks(source) {
  return String(source || '').replace(/#include\s*<([^>\s]+)>/g, (_match, name) => {
    const chunk = RAW_SHADER_CHUNKS[name];
    if (chunk === undefined) console.warn(`gs3d: unsupported shader chunk #include <${name}> dropped`);
    return chunk ?? '';
  });
}

function rawUploadText(engine, text) {
  const bytes = new TextEncoder().encode(text || '');
  const ptr = engine._malloc(bytes.length);
  engine.HEAPU8.set(bytes, ptr);
  return [ptr, bytes.length];
}

// three.js WebGL2 shaders are GLSL ES 3.00 when they use `texture()`,
// textureLod/Grad, `in`/`out` globals or #version 300; the engine compiles
// those through its translation path instead of plain GLSL ES 1.00.
function rawNeedsGlsl3(vs, fs) {
  const re = /(?:^|[^\w.])(texture|textureLod|textureGrad|textureProj|textureSize)\s*\(|#version\s+300|\b(?:in|out)\s+(?:lowp\s+|mediump\s+|highp\s+)?(?:vec[234]|mat[234]|float|int|bool|sampler\w*)\b|gl_FragDepth/;
  return re.test(vs || '') || re.test(fs || '');
}

function shaderDefinesPrefix(defines) {
  if (!defines) return '';
  let out = '';
  for (const key of Object.keys(defines)) {
    const val = defines[key];
    if (val === false || val === undefined || val === null) continue;
    out += val === true ? `#define ${key}\n` : `#define ${key} ${val}\n`;
  }
  return out;
}

function injectShaderDefines(source, defPrefix) {
  if (!defPrefix) return source;
  const match = /^\s*#version[^\n]*\n/.exec(source);
  if (match) return match[0] + defPrefix + source.slice(match[0].length);
  return defPrefix + source;
}

function ensureRawShader(engine, material) {
  const defPrefix = shaderDefinesPrefix(material.defines);
  const vertex = injectShaderDefines(rewriteRawVertex(material), defPrefix);
  const fragment = injectShaderDefines(resolveRawChunks(material.fragmentShader), defPrefix);
  const sourceKey = vertex + '\n' + fragment;
  let state = rawShaderStates.get(material);
  if (state && state.sourceKey === sourceKey) return state;
  if (state && typeof engine._g3_asset_raw_shader_release === 'function') {
    engine._g3_asset_raw_shader_release(state.id);
  }
  if (typeof engine._g3_host_raw_shader_create !== 'function') return { id: -1, sourceKey };
  const v = rawUploadText(engine, vertex);
  const f = rawUploadText(engine, fragment);
  const glsl3 = rawNeedsGlsl3(material.vertexShader, material.fragmentShader) ? 1 : 0;
  let id = -1;
  try {
    id = engine._g3_host_raw_shader_create(v[0], v[1], f[0], f[1], glsl3);
  } finally {
    engine._free(v[0]);
    engine._free(f[0]);
  }
  state = { id, sourceKey, uniformSig: null };
  rawShaderStates.set(material, state);
  return state;
}

const RAW_UNIFORM_KIND = { float: 0, vec2: 1, vec3: 2, vec4: 3, mat4: 4, int: 5 };

/* Raw vertex attributes: the engine's vertex format exposes position,
   normal, uv (slot 0), color and tangent directly, plus the packed UV
   channels as four vec4 attributes named _g3_uv01/_g3_uv23/_g3_uv45/_g3_uv67
   (uv/uv1, uv2/uv3, uv4/uv5, uv6/uv7). ShaderMaterial vertex shaders keep
   three.js syntax: every `attribute` declaration is stripped (the prefix
   supplies the standard ones) and uv1+ plus custom attributes become local
   variables decoded from the packed channels at the top of main(). Slot
   assignments come from customAttrRegistry, so the rewrite is recomputed
   whenever the registry grows (tracked by customAttrRegistryVersion). */

const RAW_VEC4_ATTRS = ['_g3_uv01', '_g3_uv01', '_g3_uv23', '_g3_uv23',
  '_g3_uv45', '_g3_uv45', '_g3_uv67', '_g3_uv67'];
const RAW_GLSL_SIZE = { float: 1, int: 1, vec2: 2, vec3: 3, vec4: 4 };
const rawRewriteCache = new WeakMap();
const vertexAttrCache = new WeakMap();

function vertexAttrInfo(material) {
  const source = material.vertexShader;
  const hit = vertexAttrCache.get(material);
  if (hit && hit.source === source) return hit.info;
  const info = [];
  const re = /attribute\s+(float|int|vec2|vec3|vec4)\s+(\w+)\s*;/g;
  for (const m of resolveRawChunks(source).matchAll(re)) info.push({ type: m[1], name: m[2] });
  vertexAttrCache.set(material, { source, info });
  return info;
}

function rawAttrDecode(name, type, material) {
  const n = RAW_GLSL_SIZE[type] || 2;
  const uvIndex = UV_SLOT_ATTRS.indexOf(name);
  const reg = uvIndex >= 0 ? null : customAttrRegistry.get(name);
  const slots = uvIndex >= 0 ? [uvIndex] : (reg?.slots.length ? reg.slots : null);
  const defaults = material.defaultAttributeValues;
  const def = defaults && Array.isArray(defaults[name]) ? defaults[name] : null;
  const capacity = slots ? slots.length * 2 : 0;
  const comps = [];
  for (let f = 0; f < n; f++) {
    let expr = '0.0';
    if (slots && f < capacity) {
      const slot = slots[f >> 1];
      expr = `${RAW_VEC4_ATTRS[slot >> 1]}.${'xyzw'[(slot & 1) * 2 + (f & 1)]}`;
    } else if (!slots && def && f < def.length) {
      expr = String(def[f]);
    }
    comps.push(expr);
  }
  if (type === 'float' || type === 'int') return `${type}(${comps[0]})`;
  return `${type}(${comps.join(',')})`;
}

function rewriteRawVertex(material) {
  const resolved = resolveRawChunks(material.vertexShader);
  const hit = rawRewriteCache.get(material);
  if (hit && hit.source === material.vertexShader && hit.version === customAttrRegistryVersion) return hit.result;
  const info = vertexAttrInfo(material);
  const byName = new Map(info.map(a => [a.name, a]));
  const decodes = [];
  const stripped = resolved.replace(/attribute\s+(float|int|vec2|vec3|vec4)\s+(\w+)\s*;/g,
    (match, type, name) => {
      if (name === 'position' || name === 'normal' || name === 'uv' || name === 'color' || name === 'tangent') return '';
      const decl: any = byName.get(name) || { type };
      decodes.push(`${decl.type} ${name} = ${rawAttrDecode(name, decl.type, material)};`);
      return '';
    });
  // Attributes the shader uses without declaring (three auto-declares the
  // standard set) still resolve through the prefix; uv1+ and custom names
  // only exist when declared, matching three.js.
  let result = stripped;
  if (decodes.length) {
    const mainAt = result.search(/void\s+main\s*\(/);
    if (mainAt >= 0) {
      const brace = result.indexOf('{', mainAt);
      if (brace >= 0) result = result.slice(0, brace + 1) + '\n' + decodes.join('\n') + result.slice(brace + 1);
    }
  }
  rawRewriteCache.set(material, { source: material.vertexShader, version: customAttrRegistryVersion, result });
  return result;
}

// Classify a uniform value into {kind, floats} or {texture}. Returns null
// for unsupported shapes (the uniform is skipped with a warning).
// Uniform declarations parsed from the shader sources, so flat float arrays
// bind as the declared vector/scalar arrays three.js would infer
// (e.g. `uniform vec4 uW[24]` <- Float32Array(96)).
const RAW_UNIFORM_DECL_KIND = { float: 0, int: 5, bool: 5, ivec2: 5, ivec3: 5, ivec4: 5,
  vec2: 1, vec3: 2, vec4: 3, bvec2: 5, bvec3: 5, bvec4: 5, mat4: 4, mat3: 4 };
const RAW_UNIFORM_COMPONENTS = { 0: 1, 1: 2, 2: 3, 3: 4, 4: 16, 5: 1 };

function shaderUniformDecls(vs, fs) {
  const decls = new Map();
  const re = /uniform\s+(\w+)\s+([^;]+);/g;
  for (const src of [vs, fs]) {
    if (!src) continue;
    let m;
    while ((m = re.exec(src))) {
      const type = m[1];
      if (type.startsWith('sampler')) continue;
      const kind = RAW_UNIFORM_DECL_KIND[type];
      if (kind === undefined) continue;
      for (const part of m[2].split(',')) {
        const dm = part.trim().match(/^(\w+)\s*(?:\[\s*(\d+)\s*\])?$/);
        if (!dm) continue;
        if (!decls.has(dm[1])) decls.set(dm[1], { kind, count: dm[2] ? +dm[2] : 1 });
      }
    }
  }
  return decls;
}

function rawUniformPayload(value) {
  const v = value && value.value !== undefined ? value.value : value;
  if (v === undefined || v === null) return null;
  if (typeof v === 'number') return { kind: RAW_UNIFORM_KIND.float, floats: [v] };
  if (typeof v === 'boolean') return { kind: RAW_UNIFORM_KIND.int, floats: [v ? 1 : 0] };
  if (v.isTexture || v.isDataTexture || v.isData3DTexture) return { texture: v };
  if (v.isMatrix4 || (v.elements && v.elements.length === 16)) {
    return { kind: RAW_UNIFORM_KIND.mat4, floats: Array.from(v.elements || v) };
  }
  if (v.isColor) return { kind: RAW_UNIFORM_KIND.vec3, floats: [v.r, v.g, v.b] };
  if (v.isVector3) return { kind: RAW_UNIFORM_KIND.vec3, floats: [v.x, v.y, v.z] };
  if (v.isVector2) return { kind: RAW_UNIFORM_KIND.vec2, floats: [v.x, v.y] };
  if (typeof v.x === 'number' && typeof v.y === 'number' && typeof v.z === 'number' && typeof v.w === 'number') {
    return { kind: RAW_UNIFORM_KIND.vec4, floats: [v.x, v.y, v.z, v.w] };
  }
  if (typeof v.x === 'number' && typeof v.y === 'number' && typeof v.z === 'number') {
    return { kind: RAW_UNIFORM_KIND.vec3, floats: [v.x, v.y, v.z] };
  }
  if (typeof v.x === 'number' && typeof v.y === 'number' && v.z === undefined) {
    return { kind: RAW_UNIFORM_KIND.vec2, floats: [v.x, v.y] };
  }
  if (Array.isArray(v) || ArrayBuffer.isView(v)) {
    const floats = Array.from(v as ArrayLike<number>);
    if (floats.every(x => typeof x === 'number')) {
      return { kind: RAW_UNIFORM_KIND.float, floats };
    }
    // Homogeneous vector arrays become vecN arrays.
    const dims = floats.map(e => {
      const p = rawUniformPayload(e);
      return p && !p.texture ? p : null;
    });
    if (dims.length && dims.every(p => p && p.kind === dims[0].kind && p.floats.length === dims[0].floats.length)) {
      return { kind: dims[0].kind, floats: dims.flatMap(p => p.floats) };
    }
    return null;
  }
  return null;
}

function rawUniformEntries(engine, material, decls) {
  const entries = [];
  for (const name of Object.keys(material.uniforms || {})) {
    const entry = material.uniforms[name];
    const payload = rawUniformPayload(entry);
    if (!payload) continue;
    if (payload.texture) {
      const tex = payload.texture;
      const texId = tex.isData3DTexture
        ? ensureTexture3D(engine, tex)
        : ensureTexture(engine, tex);
      entries.push({ name, texture: texId });
    } else {
      // The shader's own declaration wins over value sniffing, so flat
      // arrays land as the declared vecN/float arrays.
      const decl = decls && decls.get(name);
      const kind = decl ? decl.kind : payload.kind;
      entries.push({ name, kind, floats: payload.floats });
    }
  }
  return entries;
}

function rawUniformSignature(entries) {
  return entries.map(e => e.texture !== undefined
    ? `${e.name}=t${e.texture}`
    : `${e.name}=${e.kind}:${e.floats.join(',')}`).join('|');
}

function uploadRawUniforms(engine, shaderId, entries) {
  for (const e of entries) {
    const nameBytes = new TextEncoder().encode(e.name);
    const namePtr = engine._malloc(nameBytes.length);
    engine.HEAPU8.set(nameBytes, namePtr);
    try {
      if (e.texture !== undefined) {
        engine._g3_host_raw_shader_uniform_texture(shaderId, namePtr, nameBytes.length, e.texture);
        continue;
      }
      const f32 = new Float32Array(e.floats);
      const dataPtr = engine._malloc(f32.byteLength);
      engine.HEAPU8.set(new Uint8Array(f32.buffer, f32.byteOffset, f32.byteLength), dataPtr);
      try {
        engine._g3_host_raw_shader_uniform(shaderId, namePtr, nameBytes.length,
          e.kind, dataPtr, f32.length);
      } finally {
        engine._free(dataPtr);
      }
    } finally {
      engine._free(namePtr);
    }
  }
}

function materialAlphaMode(material, opacity) {
  const blendEquation = material.blendEquation ?? AddEquation;
  if (blendEquation === AddEquation && material.blendSrc === OneFactor) {
    if (material.blending === AdditiveBlending ||
        (material.blending === CustomBlending && material.blendDst === OneFactor)) {
      return ALPHA_ADDITIVE;
    }
    if (material.blending === CustomBlending && material.blendDst === OneMinusSrcAlphaFactor) {
      return ALPHA_PREMULTIPLIED;
    }
  }
  if (material.transparent || opacity < 1) return ALPHA_BLEND;
  if (material.alphaTest > 0) return ALPHA_MASK;
  return ALPHA_OPAQUE;
}

function ensureRawMaterial(engine, material) {
  const src = ensureRawShader(engine, material);
  if (src.id < 0) return -1;
  if (!material._rawDecls) material._rawDecls = shaderUniformDecls(material.vertexShader, material.fragmentShader);
  const entries = rawUniformEntries(engine, material, material._rawDecls);
  const uniformSig = rawUniformSignature(entries);
  if (src.uniformSig !== uniformSig) {
    uploadRawUniforms(engine, src.id, entries);
    src.uniformSig = uniformSig;
  }
  // The engine material only carries render state for raw programs:
  // double-sidedness, blending and the shader id itself.
  const opacity = material.opacity ?? 1;
  const alphaMode = materialAlphaMode(material, opacity);
  const signature = `raw|${material.side}|${alphaMode}|${opacity}|${src.id}`;
  const state = materialStates.get(material);
  if (state && state.signature === signature) return state.id;
  if (state) engine._g3_asset_release_material(state.id, state.generation);
  const alpha = material.transparent ? opacity : 1;
  const id = engine._g3_asset_material(1, 1, 1, alpha,
    -1, alphaMode, 0, 0, 0,
    -1, -1, 0, -1, 0,
    0, 0, 0, -1,
    material.side !== FrontSide, true, 1.5);
  if (id < 0) return -1;
  engine._g3_asset_material_set_shader(id, src.id);
  const record = { id, generation: engine._g3_asset_material_generation(id), signature };
  materialStates.set(material, record);
  return id;
}


/* --- onBeforeCompile compatibility ----------------------------------------
   three.js materials may define onBeforeCompile(shader) to splice GLSL into
   the lit program. The engine's customShader contract splices user code into
   a fixed point of its own fragment shader, so the facade translates:

   - sentinel-marked chunk templates let us recover which #include <...>
     bodies the callback injected, in pipeline order;
   - uniforms become u_user[] slots (packed floats), u_lut (sampler3D) or
     the emissive-map sampler slot (one sampler2D);
   - three's built-ins become locals with a write-back epilogue: normal is
     view-space like three (written back through the view matrix), and
     diffuseColor, roughnessFactor, the material struct and
   totalEmissiveRadiance sync back to base/mr/coat/sheen/f0/emissive;
   - custom varyings become #defines over the packed v_uvN inputs or the
     v_obj_pos/v_obj_normal/v_view_normal_matrix ins, so helper functions in
     the injected header can read them too. */

const G3CHK = '//__G3CHK_';
const G3_VERT_CHUNKS = ['begin_vertex', 'beginnormal_vertex', 'project_vertex', 'worldpos_vertex'];
const G3_FRAG_CHUNKS = [
  'map_fragment', 'color_fragment', 'alphamap_fragment', 'alphatest_fragment',
  'roughnessmap_fragment', 'metalnessmap_fragment', 'normal_fragment_begin',
  'normal_fragment_maps', 'lights_fragment_begin', 'lights_physical_fragment',
  'aomap_fragment', 'emissivemap_fragment',
  // Output-stage chunks route to the shader tail instead of the body.
  'opaque_fragment', 'tonemapping_fragment', 'colorspace_fragment',
  'fog_fragment', 'output_fragment', 'dithering_fragment',
];
const G3_TAIL_CHUNKS = new Set(['opaque_fragment', 'tonemapping_fragment',
  'colorspace_fragment', 'fog_fragment', 'output_fragment', 'dithering_fragment']);
const G3_SWZ = 'xyzw';

function g3ChunkTemplate(names) {
  return names.map(n => `${G3CHK}${n}\n#include <${n}>`).join('\n') + '\n';
}

// Split a shader string at the sentinel comments into {prelude, chunks:[{name,body}]}.
function g3SplitChunks(src) {
  const first = src.indexOf(G3CHK);
  if (first < 0) return { prelude: src, chunks: [] };
  const prelude = src.slice(0, first);
  const rest = src.slice(first);
  const parts = rest.split(G3CHK).slice(1);
  const chunks = [];
  for (const part of parts) {
    const nl = part.indexOf('\n');
    const name = nl < 0 ? part.trim() : part.slice(0, nl).trim();
    let body = nl < 0 ? '' : part.slice(nl + 1);
    body = body.split('\n').filter(l => !/^\s*#include\b/.test(l)).join('\n');
    chunks.push({ name, body });
  }
  return { prelude, chunks };
}

function g3UniformSize(type) {
  return { float: 1, int: 1, bool: 1, vec2: 2, vec3: 3, vec4: 4 }[type] || 0;
}

// Read a three uniform value ({value}) into up-to-four floats.
function g3UniformFloats(value) {
  if (value === undefined || value === null) return [0, 0, 0, 0];
  if (typeof value === 'number') return [value, 0, 0, 0];
  if (typeof value === 'boolean') return [value ? 1 : 0, 0, 0, 0];
  if (value.isVector2 || value.isVector3 || value.isVector4) {
    const n = value.isVector2 ? 2 : value.isVector3 ? 3 : 4;
    return [value.x, value.y, value.z ?? 0, value.w ?? 0].slice(0, n).concat(
      Array(Math.max(0, 4 - n)).fill(0));
  }
  if (value.isColor) return [value.r, value.g, value.b, 1];
  if (value.isMatrix3 || value.isMatrix4) return [0, 0, 0, 0];
  return [0, 0, 0, 0];
}

// u_user packing cursor: vec4 slots, components packed without crossing.
function g3UniformSlot(slot, comp, n) {
  const sw = c => G3_SWZ[c];
  if (n === 4) return `u_user[${slot}]`;
  if (n === 1) return `u_user[${slot}].${sw(comp)}`;
  let out = `u_user[${slot}].`;
  for (let i = 0; i < n; i++) out += sw(comp + i);
  return out;
}

// Decode a packed custom attribute into a GLSL expression of `type`.
function g3DecodeAttr(name, type) {
  const n = { float: 1, int: 1, bool: 1, vec2: 2, vec3: 3, vec4: 4 }[type] || 4;
  const reg = customAttrRegistry.get(name);
  if (!reg) return `${type}(0.0)`;
  const count = Math.min(n, reg.itemSize, reg.slots.length * 2);
  const comps = [];
  for (let i = 0; i < count; i++) {
    const slot = reg.slots[i >> 1];
    const v = slot === 0 ? 'v_uv' : `v_uv${slot}`;
    comps.push(`${v}.${i & 1 ? 'y' : 'x'}`);
  }
  while (comps.length < n) comps.push('0.0');
  if (n === 1) return comps[0];
  return `${type}(${comps.join(',')})`;
}

// Map a vertex-side assignment RHS (position/normal/attribute name) to a
// fragment-side expression for a varying of `type`.
function g3VaryingExpr(rhs, type, assignSwizzle) {
  let base;
  if (rhs === 'position') base = 'v_obj_pos';
  else if (rhs === 'normal') base = 'v_obj_normal';
  else if (rhs === 'normalMatrix') base = 'v_view_normal_matrix';
  else if (rhs === 'uv') base = 'v_uv';
  else if (/^uv[1-7]$/.test(rhs)) base = `v_uv${rhs.slice(2)}`;
  else if (rhs && customAttrRegistry.has(rhs)) base = g3DecodeAttr(rhs, type);
  else if (rhs === 'color') base = type === 'float' ? 'v_color.r' : type === 'vec2' ? 'v_color.rg' : type === 'vec3' ? 'v_color.rgb' : 'v_color';
  else base = `${type}(0.0)`;
  // Swizzle carried over from the vertex assignment (e.g. attr.xy).
  if (assignSwizzle && /^[xyzwrgba]{2,4}$/.test(assignSwizzle)) {
    const clean = assignSwizzle.replace(/[^xyzw]/g, '');
    if (clean.length >= 2 && (type === 'vec2' || type === 'vec3' || type === 'vec4')) {
      return `(${base}).${clean.slice(0, { vec2: 2, vec3: 3, vec4: 4 }[type])}`;
    }
  }
  return base;
}

// Identifier rewrites inside injected chunk bodies. Locals declared in the
// body prelude shadow three's globals, so only names without locals need
// textual substitution.
const G3_BODY_SUBS = [
  [/\breflectedLight\.indirectSpecular\b/g, 'g3_indirect_specular'],
  [/\breflectedLight\.directSpecular\b/g, 'g3_direct_specular'],
  [/\breflectedLight\.indirectDiffuse\b/g, 'ao'],
  [/\breflectedLight\.directDiffuse\b/g, 'g3_direct_diffuse'],
  [/\breflectedLight\.total\b/g, 'g3_reflected_total'],
  [/\bclearcoatSpecularIndirect\b/g, 'g3_clearcoat_spec_indirect'],
  [/\bgl_FragColor\.rgb\b/g, 'col'],
  [/\bgl_FragColor\.a\b/g, 'alpha'],
  [/\bgl_FragColor\b/g, 'vec4(col,alpha)'],
];

function g3TranslateBody(src) {
  let out = src;
  for (const [re, rep] of G3_BODY_SUBS) out = out.replace(re, rep);
  return out;
}

// The G3Material struct mirrors the engine's resolved material inputs.
const G3_MATERIAL_STRUCT = `
struct G3Material {
  float clearcoat; float clearcoatRoughness;
  vec3 specularColor; vec3 specularF90;
  vec3 sheenColor; float sheenRoughness;
  float roughness; float metalness;
  vec3 color; vec3 specular; vec3 emissive;
  float ior; float opacity; float alpha; vec3 diffuse;
  float reflectivity; float sheen; float envMapIntensity;
};
struct G3ReflectedLight {
  vec3 indirectDiffuse; vec3 indirectSpecular;
  vec3 directDiffuse; vec3 directSpecular; vec3 total;
};`;

function ensureObcMaterial(engine, material) {
  if (!material || typeof material.onBeforeCompile !== 'function') return;
  if (typeof engine._g3_host_material_shader_create !== 'function') return;
  // The callback is cheap enough to run per material per frame; the parsed
  // plan is cached and only rebuilt when the uniform set or the custom
  // attribute registry changes.
  const fake = {
    uniforms: {},
    vertexShader: g3ChunkTemplate(G3_VERT_CHUNKS),
    fragmentShader: g3ChunkTemplate(G3_FRAG_CHUNKS),
  };
  material.onBeforeCompile(fake);
  const uniformKey = Object.keys(fake.uniforms).sort().join('|') + '#' + customAttrRegistryVersion;
  let plan = material._obcPlan;
  if (!plan || plan.uniformKey !== uniformKey) {
    plan = g3BuildObcPlan(material, fake, uniformKey);
    material._obcPlan = plan;
    // Texture side effects: sampler2D uniforms ride the emissive-map slot
    // (emissive colour is black for these materials, so the engine's own
    // emissive term stays zero); sampler3D uniforms ride u_lut.
    for (const t of plan.textureAssigns) {
      if (t.kind === 'sampler2D') {
        if (material.emissiveMap && material.emissiveMap !== t.texture) {
          console.warn('gs3d: onBeforeCompile sampler2D uniform', t.name,
            'shares the emissiveMap slot; additional samplers are unsupported');
        } else material.emissiveMap = t.texture;
      }
      if (t.kind === 'sampler3D') material.lutTexture = t.texture;
    }
  }
  material.customShader = plan.shader;
  material.customUniforms = undefined;
}

function g3BuildObcPlan(material, fake, uniformKey) {
  const vsrc = g3SplitChunks(String(fake.vertexShader || ''));
  const fsrc = g3SplitChunks(String(fake.fragmentShader || ''));

  // Vertex varying declarations and begin_vertex assignments.
  const vDecls = new Map(); // name -> type
  for (const m of vsrc.prelude.matchAll(/varying\s+(?:lowp\s+|mediump\s+|highp\s+)?(\w+)\s+(\w+)\s*;/g)) {
    vDecls.set(m[2], m[1]);
  }
  const assignMap = new Map(); // varying name -> {rhs, swizzle}
  for (const ch of vsrc.chunks) {
    if (ch.name !== 'begin_vertex') continue;
    for (const m of ch.body.matchAll(/([A-Za-z_]\w*)\s*=\s*([A-Za-z_]\w*)((?:\.[xyzwrgba]+)?)\s*;/g)) {
      assignMap.set(m[1], { rhs: m[2], swizzle: m[3] ? m[3].slice(1) : '' });
    }
  }

  // Fragment prelude: strip varying/uniform declarations, keep the rest
  // (structs and helper functions) as global-scope header code.
  const fVaryings = new Map(); // name -> type
  const uniforms = []; // {name,type,decl}
  let headerCode = '';
  {
    let rest = fsrc.prelude;
    rest = rest.replace(/varying\s+(?:lowp\s+|mediump\s+|highp\s+)?(\w+)\s+(\w+)\s*;/g,
      (_m, type, name) => { fVaryings.set(name, type); return ''; });
    rest = rest.replace(/uniform\s+(?:lowp\s+|mediump\s+|highp\s+)?(\w+)\s+(\w+)\s*;/g,
      (_m, type, name) => { uniforms.push({ name, type }); return ''; });
    headerCode = rest;
  }

  // Classify uniforms: samplers bind textures, scalars pack into u_user.
  const defines = ['#define texture2D texture', '#define saturate(x) clamp((x), 0.0, 1.0)', '#define USE_SHEEN 1',
    '#define USE_CLEARCOAT 1', '#define USE_ENVMAP 1',
    '#define viewMatrix u_view', '#define cameraPosition u_eye'];
  const uniformPlan = [];
  const textureAssigns = [];
  const uniformKeyParts = [];
  let slot = 0, comp = 0;
  let sampler2DUsed = false;
  for (const u of uniforms) {
    const value = fake.uniforms[u.name];
    uniformKeyParts.push(u.name + ':' + u.type);
    if (u.type === 'sampler2D' || u.type === 'sampler3D' || u.type === 'samplerCube' || u.type === 'sampler2DShadow') {
      const tex = value && value.value;
      if (u.type === 'sampler3D' && tex && tex.isData3DTexture) {
        defines.push(`#define ${u.name} u_lut`);
        textureAssigns.push({ kind: 'sampler3D', name: u.name, texture: tex });
      } else if (u.type === 'sampler2D' && tex && !sampler2DUsed) {
        sampler2DUsed = true;
        defines.push(`#define ${u.name} u_emissive_tex`);
        textureAssigns.push({ kind: 'sampler2D', name: u.name, texture: tex });
      } else {
        defines.push(`#define ${u.name} u_emissive_tex`);
      }
      continue;
    }
    const n = g3UniformSize(u.type);
    if (!n) continue;
    if (comp + n > 4) { slot++; comp = 0; }
    if (slot >= 8) continue; // u_user exhausted; uniform reads as undefined
    const expr = g3UniformSlot(slot, comp, n);
    defines.push(`#define ${u.name} ${u.type === 'int' || u.type === 'bool' ? `${u.type}(${expr})` : expr}`);
    uniformPlan.push({ name: u.name, type: u.type, slot, comp, n, src: value });
    comp += n;
    if (comp === 4) { slot++; comp = 0; }
  }

  // Varying defines: fragment-declared varyings map to engine ins.
  for (const [name, type] of fVaryings) {
    const vtype = vDecls.get(name) || type;
    const assign = assignMap.get(name);
    let expr;
    if (name === 'vColor') expr = type === 'vec4' ? 'v_color' : type === 'vec3' ? 'v_color.rgb' : type === 'vec2' ? 'v_color.rg' : 'v_color.r';
    else if (name === 'vUv' || name === 'vUV') expr = type === 'vec3' ? 'vec3(v_uv,0.0)' : 'v_uv';
    else expr = g3VaryingExpr(assign ? assign.rhs : null, vtype || type, assign && assign.swizzle);
    defines.push(`#define ${name} ${expr}`);
  }

  // Route chunk bodies: output-stage chunks go to the tail.
  const bodyParts = [], tailParts = [];
  for (const ch of fsrc.chunks) {
    // Three initializes PhysicalMaterial from the map factors at this chunk.
    // Preserve that pipeline step before user edits to the material struct.
    if (ch.name === 'lights_physical_fragment') {
      bodyParts.push('material.roughness = roughnessFactor; material.metalness = metalnessFactor;');
    }
    if (!ch.body.trim()) continue;
    (G3_TAIL_CHUNKS.has(ch.name) ? tailParts : bodyParts).push(g3TranslateBody(ch.body));
  }

  // Body prelude: three-compatible locals, then the write-back epilogue.
  const prelude = `
    vec3 vViewPosition = -(u_view * vec4(v_world, 1.0)).xyz;
    vec3 geometryViewDir = normalize(vViewPosition);
    vec3 geometryPosition = vViewPosition;
    vec3 geometryNormal = mat3(u_view) * n;
    vec3 normal = mat3(u_view) * n;
    vec4 diffuseColor = vec4(base, 1.0);
    float roughnessFactor = mr.y;
    float metalnessFactor = mr.x;
    vec3 totalEmissiveRadiance = g3_emissive_extra;
    G3Material material = G3Material(
      coat_factor, coat_roughness, specular_color, f0, sheen_color, sheen_roughness,
      mr.y, mr.x, vec3(base), specular_color, u_emissive.rgb, u_pbr.w, alpha, alpha, base, 0.0, 0.0, 1.0);
    float g3_indirect_specular = 1.0;
    float g3_direct_specular = 1.0;
    float g3_direct_diffuse = 1.0;
    float g3_reflected_total = 1.0;
    float g3_clearcoat_spec_indirect = 1.0;
`;
  const epilogue = `
    n = transpose(mat3(u_view)) * normal;
    base = diffuseColor.rgb;
    coat_factor = material.clearcoat; coat_roughness = material.clearcoatRoughness;
    specular_color = material.specularColor; f0 = material.specularF90;
    sheen_color = material.sheenColor; sheen_roughness = material.sheenRoughness;
    mr.y = material.roughness; mr.x = material.metalness;
    g3_emissive_extra = totalEmissiveRadiance;
`;

  const header = defines.join('\n') + '\n' + G3_MATERIAL_STRUCT + '\n' +
    'float computeSpecularOcclusion(float dotNV, float occlusion, float roughness) { return occlusion; }\n' +
    headerCode;
  const body = prelude + bodyParts.join('\n') + epilogue;
  const tail = tailParts.join('\n');
  return {
    shader: { header, body, tail },
    uniformPlan,
    textureAssigns,
    uniformKey,
  };
}

// Live-sync u_user slots from the shared three uniform objects. Called once
// per material per frame through ensureMaterial; unchanged vec4 slots skip
// the engine call.
function syncObcUniforms(engine, material, id) {
  const plan = material && material._obcPlan;
  if (!plan || !plan.uniformPlan.length) return;
  if (!plan.last) plan.last = new Float32Array(32).fill(NaN);
  const next = plan.next || (plan.next = new Float32Array(32));
  next.fill(0);
  for (const u of plan.uniformPlan) {
    const f = g3UniformFloats(u.src && u.src.value);
    const base = u.slot * 4 + u.comp;
    for (let i = 0; i < u.n; i++) next[base + i] = f[i];
  }
  for (let i = 0; i < 8; i++) {
    const o = i * 4;
    if (next[o] === plan.last[o] && next[o + 1] === plan.last[o + 1] &&
        next[o + 2] === plan.last[o + 2] && next[o + 3] === plan.last[o + 3]) continue;
    engine._g3_asset_material_user(id, i, next[o], next[o + 1], next[o + 2], next[o + 3]);
    plan.last[o] = next[o]; plan.last[o + 1] = next[o + 1];
    plan.last[o + 2] = next[o + 2]; plan.last[o + 3] = next[o + 3];
  }
}

function ensureMaterial(engine, material) {
  if (material && (material.isShaderMaterial || material.isRawShaderMaterial)) {
    const id = ensureRawMaterial(engine, material);
    if (frameMaterialCache) frameMaterialCache.set(material, id);
    return id;
  }
  if (!material) {
    // A shared fallback keeps material-less meshes from allocating a new
    // engine material (and leaking the old one) on every frame.
    fallbackMaterial ??= new MeshBasicMaterial();
    material = fallbackMaterial;
  }
  if (frameMaterialCache) {
    const hit = frameMaterialCache.get(material);
    if (hit !== undefined) { syncObcUniforms(engine, material, hit); return hit; }
  }
  // onBeforeCompile runs once per material per frame (the frame cache above
  // dedupes meshes sharing it); the parsed plan itself is cached on the
  // material and only rebuilt when uniforms or attribute slots change.
  if (material && typeof material.onBeforeCompile === 'function') {
    ensureObcMaterial(engine, material);
  }
  const maps = materialMaps(material);
  const textureIds = maps.map(t => t ? ensureTexture(engine, t) : -1);
  const lutTextureId = material.lutTexture ? ensureTexture3D(engine, material.lutTexture) : -1;
  const signature = materialSignature(material) + '|tex:' + textureIds.join(',') +
    '|lut:' + lutTextureId +
    '|' + maps.map(t => t ? textureUvSignature(t) : '-').join(';');
  const state = materialStates.get(material);
  if (state && state.signature === signature) {
    syncObcUniforms(engine, material, state.id);
    if (frameMaterialCache) frameMaterialCache.set(material, state.id);
    return state.id;
  }
  if (state) engine._g3_asset_release_material(state.id, state.generation);

  const color = material.color || new Color(0xffffff);
  const opacity = material.opacity ?? 1;
  const alphaMode = materialAlphaMode(material, opacity);
  const alphaCutoff = material.alphaTest > 0 ? material.alphaTest : 0.5;
  const unlit = material.isMeshBasicMaterial || material.isMeshNormalMaterial ? 1 : 0;
  const metallic = material.metalness ?? (unlit ? 0 : 0);
  const roughness = material.roughness ?? 1;
  const emissive = material.emissive || new Color(0);
  const emissiveStrength = material.emissiveIntensity ?? 1;
  const normalScale = material.normalScale;
  const normalScaleValue = normalScale instanceof Vector2 ? normalScale.x : (normalScale ?? 1);
  const id = engine._g3_asset_material(
    color.r, color.g, color.b, opacity, textureIds[0], alphaMode, alphaCutoff,
    metallic, roughness, textureIds[1], textureIds[2], normalScaleValue, textureIds[3],
    material.aoMapIntensity ?? 1,
    emissive.r * emissiveStrength, emissive.g * emissiveStrength, emissive.b * emissiveStrength, textureIds[4],
    material.side === DoubleSide ? 1 : 0, unlit, material.ior ?? 1.5,
  );
  for (let slot = 0; slot < maps.length; slot++) {
    const texture = maps[slot];
    if (texture && textureIds[slot] >= 0) {
      engine._g3_asset_material_uv_transform(id, slot,
        texture.offset.x, texture.offset.y,
        texture.repeat.x, texture.repeat.y, texture.rotation, texture.channel || 0);
    }
  }
  if (!unlit && typeof engine._g3_asset_material_environment === 'function') {
    engine._g3_asset_material_environment(id, material.envMapIntensity ?? 1);
  }
  if (!unlit) {
    // Dielectric F0 of about 0.04 matches three.js's standard-material sheen.
    engine._g3_asset_material_specular(id, 0.04, 1, 1, 1, -1, -1);
  }
  const customShader = material.customShader;
  if (customShader && typeof engine._g3_host_material_shader_create === 'function') {
    let shaderId = customShaderIds.get(customShader);
    if (shaderId === undefined) {
      const upload = text => {
        const bytes = new TextEncoder().encode(text || '');
        const ptr = engine._malloc(bytes.length);
        engine.HEAPU8.set(bytes, ptr);
        return [ptr, bytes.length];
      };
      const header = upload(customShader.header);
      const body = upload(customShader.body);
      const tail = upload(customShader.tail);
      try {
        shaderId = engine._g3_host_material_shader_create(header[0], header[1], body[0], body[1], tail[0], tail[1]);
      } finally {
        engine._free(header[0]);
        engine._free(body[0]);
        engine._free(tail[0]);
      }
      customShaderIds.set(customShader, shaderId);
    }
    if (shaderId >= 0) engine._g3_asset_material_set_shader(id, shaderId);
  }
  if (lutTextureId >= 0 && typeof engine._g3_asset_material_lut === 'function') {
    engine._g3_asset_material_lut(id, lutTextureId);
  }
  const customUniforms = material.customUniforms;
  if (customUniforms && typeof engine._g3_asset_material_user === 'function') {
    for (let i = 0; i < 8; i++) {
      engine._g3_asset_material_user(id, i,
        customUniforms[i * 4] ?? 0, customUniforms[i * 4 + 1] ?? 0,
        customUniforms[i * 4 + 2] ?? 0, customUniforms[i * 4 + 3] ?? 0);
    }
  }
  syncObcUniforms(engine, material, id);
  const record = { id, generation: engine._g3_asset_material_generation(id), signature };
  materialStates.set(material, record);
  if (frameMaterialCache) frameMaterialCache.set(material, id);
  return id;
}

/* --- sync ---------------------------------------------------------------------- */

function syncNode(engine, object, parentEngineIndex, local) {
  const isMesh = object.isMesh === true;
  const material = isMesh ? (Array.isArray(object.material) ? object.material[0] : object.material) : null;
  const meshId = isMesh ? ensureGeometry(engine, object.geometry,
    !!(material && material.vertexColors), !!(material && material.flatShading), material) : -1;
  let record = nodeStates.get(object);
  if (record && (record.parent !== parentEngineIndex || record.mesh !== meshId)) {
    releaseNodeRecord(record);
    nodeStates.delete(object);
    record = undefined;
  }
  if (!record) {
    const index = engine._g3_asset_node(meshId, parentEngineIndex);
    record = { index, generation: engine._g3_asset_node_generation(index),
      epoch: engine._g3_asset_scene_epoch(), parent: parentEngineIndex, mesh: meshId,
      material: -1, matrix: null };
    nodeStates.set(object, record);
  }
  if (isMesh) {
    const materialId = ensureMaterial(engine, material);
    if (record.material !== materialId) {
      engine._g3_asset_node_material(record.index, materialId);
      record.material = materialId;
    }
  }
  if (!record.matrix || !matricesEqual(record.matrix, local)) {
    for (let i = 0; i < 16; i++) engine._g3_asset_matrix(record.index, i, local[i]);
    record.matrix = Float64Array.from(local);
  }
  return record.index;
}

function matricesEqual(a, b) {
  for (let i = 0; i < 16; i++) if (a[i] !== b[i]) return false;
  return true;
}

function lightWorldPose(object) {
  const world = worldMatrixOf(object);
  const position = transformPoint(world, 0, 0, 0);
  return { world, position };
}

function targetWorldPosition(light) {
  const target = light.target;
  if (!target) return [0, 0, 0];
  return transformPoint(worldMatrixOf(target), 0, 0, 0);
}

export function collectLights(scene) {
  const result = { ambient: [0, 0, 0], hemisphere: null, lights: [] };
  const walk = (object, visible) => {
    const effective = visible && object.visible !== false;
    if (!effective) return;
    if (object.isLight) {
      const intensity = object.intensity ?? 1;
      const color = object.color || new Color(0xffffff);
      const scaled = [color.r * intensity, color.g * intensity, color.b * intensity];
      if (object.isAmbientLight) {
        result.ambient[0] += scaled[0]; result.ambient[1] += scaled[1]; result.ambient[2] += scaled[2];
      } else if (object.isHemisphereLight) {
        result.hemisphere = { sky: [color.r, color.g, color.b],
          ground: [object.groundColor.r, object.groundColor.g, object.groundColor.b], intensity };
      } else if (result.lights.length < MAX_EXTRA_LIGHTS) {
        const { position } = lightWorldPose(object);
        if (object.isDirectionalLight) {
          const target = targetWorldPosition(object);
          const delta = [target[0] - position[0], target[1] - position[1], target[2] - position[2]];
          result.lights.push({ kind: 'directional', direction: normalize3(delta), color: scaled,
            source: object, position, target });
        } else if (object.isPointLight) {
          result.lights.push({ kind: 'point', position, color: scaled, range: object.distance || 0 });
        } else if (object.isSpotLight) {
          const target = targetWorldPosition(object);
          const delta = [target[0] - position[0], target[1] - position[1], target[2] - position[2]];
          result.lights.push({ kind: 'spot', position, direction: normalize3(delta), color: scaled,
            range: object.distance || 0,
            inner: Math.max(0.0001, object.angle * (1 - (object.penumbra ?? 0))), outer: object.angle });
        }
      }
    }
    for (const child of object.children) walk(child, effective);
  };
  walk(scene, true);
  return result;
}

function shadowMapResolution(size) {
  const s = Math.max(size || 0, 0);
  return s >= 1024 ? 1024 : s >= 512 ? 512 : 256;
}

function shadowFilterRadius(type) {
  if (type === BasicShadowMap) return 0;
  if (type === PCFSoftShadowMap || type === VSMShadowMap) return 2;
  return 1;
}

// The engine has a single directional shadow map, so the shadow-casting
// directional light is routed to the primary light slot and its ortho
// camera collapses into one world-space box. The box's half extent must
// cover the frustum horizontally and reach upstream to the light itself
// (the shadow camera sits 2*extent behind the target and sees extent*4
// deep), so light distance and ortho bounds share one number. Every mesh
// inside the box casts and receives; per-object flags are accepted for
// API compatibility but only light.castShadow selects the caster.
function syncKeyLight(engine, light, renderer) {
  if (typeof engine._g3_asset_light_key !== 'function') return;
  if (!light) {
    // No facade key light: restore the engine's default key and drop shadows.
    engine._g3_asset_light_key(-0.45, -0.8, -0.4, 1.0, 0.96, 0.88);
    engine._g3_asset_light_key_shadow_clear();
    return;
  }
  engine._g3_asset_light_key(light.direction[0], light.direction[1], light.direction[2],
    light.color[0], light.color[1], light.color[2]);
  const shadow = light.source.shadow || {};
  const camera = shadow.camera || {};
  const halfWidth = Math.max(0, ((camera.right ?? 5) - (camera.left ?? -5)) / 2);
  const halfHeight = Math.max(0, ((camera.top ?? 5) - (camera.bottom ?? -5)) / 2);
  const distance = Math.hypot(
    light.position[0] - light.target[0],
    light.position[1] - light.target[1],
    light.position[2] - light.target[2]);
  const extent = Math.max(halfWidth, halfHeight, distance / 2 + 1);
  // normalBias is a world-space offset; the shadow camera's depth range is
  // extent*4, so the same offset is that much smaller in depth units.
  const bias = Math.max(0, shadow.bias ?? 0) + Math.max(0, shadow.normalBias ?? 0) / (extent * 4);
  engine._g3_asset_light_key_shadow(light.target[0], light.target[1], light.target[2], extent, bias);
  if (typeof engine._g3_asset_shadow_resolution === 'function') {
    const size = Math.max(shadow.mapSize?.x ?? 512, shadow.mapSize?.y ?? 512);
    engine._g3_asset_shadow_resolution(shadowMapResolution(size));
  }
  if (typeof engine._g3_asset_shadow_filter_radius === 'function') {
    engine._g3_asset_shadow_filter_radius(shadowFilterRadius(renderer?.shadowMap?.type));
  }
}

export function syncLights(engine, collected, renderer) {
  engine._g3_asset_lights_clear();
  const shadowsOn = !!(renderer && renderer.shadowMap && renderer.shadowMap.enabled);
  let keyLight = null;
  for (const light of collected.lights) {
    if (light.kind === 'directional' && shadowsOn && !keyLight && light.source && light.source.castShadow) {
      keyLight = light;
      continue;
    }
    if (light.kind === 'directional') engine._g3_asset_light_directional(...light.direction, ...light.color);
    else if (light.kind === 'point') engine._g3_asset_light_point(...light.position, ...light.color, light.range);
    else engine._g3_asset_light_spot(...light.position, ...light.direction, ...light.color,
      light.range, light.inner, light.outer);
  }
  engine._g3_asset_ambient(collected.ambient[0], collected.ambient[1], collected.ambient[2], 1);
  if (collected.hemisphere) {
    const h = collected.hemisphere;
    engine._g3_asset_environment_lighting(h.sky[0], h.sky[1], h.sky[2],
      h.ground[0], h.ground[1], h.ground[2], h.intensity);
  } else {
    engine._g3_asset_environment_lighting(0, 0, 0, 0, 0, 0, 0);
  }
  syncKeyLight(engine, keyLight, renderer);
}

export function syncBackground(engine, scene, renderer) {
  const background = scene.background;
  if (background && background.isColor) {
    engine._g3_asset_background(background.r, background.g, background.b, 1);
  } else if (renderer._clearColor) {
    engine._g3_asset_background(renderer._clearColor.r, renderer._clearColor.g, renderer._clearColor.b, renderer._clearAlpha ?? 1);
  } else {
    engine._g3_asset_background(0, 0, 0, 1);
  }
}

export function syncFog(engine, scene) {
  const fog = scene.fog;
  if (fog && fog.isFogExp2) {
    engine._g3_asset_fog(fog.color.r, fog.color.g, fog.color.b, fog.density);
  } else if (fog && fog.isFog) {
    // The engine fog is exponential; a linear Fog maps approximately with a
    // density derived from its range.
    const density = fog.far > fog.near ? 2.5 / (fog.far - fog.near) : 0;
    engine._g3_asset_fog(fog.color.r, fog.color.g, fog.color.b, density);
  } else {
    engine._g3_asset_fog(0, 0, 0, 0);
  }
}

// scene.environment is an equirectangular texture in the engine; three.js
// also accepts it directly for PMREM-processed environments, which we pass
// through unchanged.
export function syncEnvironment(engine, scene) {
  const env = scene.environment;
  if (env && env.isTexture) {
    const id = ensureTexture(engine, env);
    if (id >= 0) engine._g3_asset_environment_map(id, scene.environmentIntensity ?? 1);
  } else {
    engine._g3_asset_environment_map(-1, 0);
  }
  if (typeof engine._g3_asset_environment_rotation === 'function') {
    engine._g3_asset_environment_rotation(scene.environmentRotation ?? 0);
  }
}

export function syncCamera(engine, renderer, camera) {
  if (!camera || !camera.isCamera) return;
  const world = worldMatrixOf(camera);
  const position = transformPoint(world, 0, 0, 0);
  const forward = normalize3(transformDir(world, 0, 0, -1));
  const up = normalize3(transformDir(world, 0, 1, 0));
  const target = [position[0] + forward[0], position[1] + forward[1], position[2] + forward[2]];
  const aspect = camera.aspect > 0 ? camera.aspect : renderer._cssWidth / Math.max(1, renderer._cssHeight);
  const isPlainCam = !camera.isPerspectiveCamera && !camera.isOrthographicCamera;
  const orthographic = camera.isOrthographicCamera || isPlainCam ? 1 : 0;
  const fov = camera.isPerspectiveCamera ? camera.fov * DEG2RAD : 0.9;
  const orthoHeight = camera.isOrthographicCamera ? camera.top - camera.bottom : (isPlainCam ? 2000 : 0);
  const near = isPlainCam ? -1000 : (Number.isFinite(camera.near) ? camera.near : 0.1);
  const far = isPlainCam ? 1000 : (Number.isFinite(camera.far) ? camera.far : 2000);
  let state = cameraStates.get(camera);
  if (!state) {
    const id = engine._g3_asset_camera_add(position[0], position[1], position[2],
      target[0], target[1], target[2], up[0], up[1], up[2],
      fov, aspect, orthographic, orthoHeight, near, far);
    if (id < 0) return;
    state = { id, viewKey: '' };
    cameraStates.set(camera, state);
  }
  engine._g3_asset_camera_update(state.id,
    position[0], position[1], position[2], target[0], target[1], target[2],
    up[0], up[1], up[2], fov, aspect, orthographic, orthoHeight, near, far);
  if (renderer._selectedCameraId !== state.id) {
    engine._g3_asset_camera_select(state.id);
    renderer._selectedCameraId = state.id;
  }
  const vo = camera.view;
  const voKey = vo && vo.enabled
    ? [vo.fullWidth, vo.fullHeight, vo.offsetX, vo.offsetY, vo.width, vo.height].join(',')
    : '';
  if (state.viewKey !== voKey && typeof engine._g3_asset_camera_view_offset === 'function') {
    if (voKey) {
      engine._g3_asset_camera_view_offset(state.id,
        vo.fullWidth, vo.fullHeight, vo.offsetX, vo.offsetY, vo.width, vo.height);
    } else {
      engine._g3_asset_camera_view_offset(state.id, 0, 0, 0, 0, 0, 0);
    }
    state.viewKey = voKey;
  }
}

function tintedInstanceMaterial(instanced, colArr, index) {
  const o = index * 3;
  const r = colArr[o], g = colArr[o + 1], b = colArr[o + 2];
  const key = `${r.toFixed(4)},${g.toFixed(4)},${b.toFixed(4)}`;
  let tinted = instanced._colorMaterials.get(key);
  if (!tinted) {
    const baseMat = instanced.material;
    tinted = Object.assign(Object.create(Object.getPrototypeOf(baseMat)), baseMat);
    const base = baseMat.color || new Color(1, 1, 1);
    tinted.color = new Color(base.r * r, base.g * g, base.b * b);
    instanced._colorMaterials.set(key, tinted);
  }
  return tinted;
}

function syncInstancedMesh(instanced, engineParent, seen) {
  const count = Math.min(instanced.count, instanced._maxCount);
  const arr = instanced.instanceMatrix.array;
  const colArr = instanced.instanceColor ? instanced.instanceColor.array : null;
  if (instanced._tintedSourceMaterial !== instanced.material) {
    instanced._colorMaterials.clear();
    instanced._tintedSourceMaterial = instanced.material;
  }
  for (let i = 0; i < count; i++) {
    let proxy = instanced._instances[i];
    if (!proxy) {
      proxy = new Mesh(instanced.geometry, instanced.material);
      instanced._instances[i] = proxy;
    }
    proxy.geometry = instanced.geometry;
    proxy.castShadow = instanced.castShadow;
    proxy.receiveShadow = instanced.receiveShadow;
    proxy.material = colArr && instanced.material
      ? tintedInstanceMaterial(instanced, colArr, i)
      : instanced.material;
    syncNode(sharedEngine, proxy, engineParent, arr.subarray(i * 16, i * 16 + 16));
    seen.add(proxy);
  }
}

export function syncSceneTree(scene, seen) {
  scene.updateMatrixWorld();
  const walk = (object, parentEngineIndex) => {
    // An invisible object hides its whole subtree, like three.js.
    if (object.visible === false) { releaseEngineTree(object); return; }
    let engineParent = parentEngineIndex;
    if (!object.isLight && !object.isCamera) {
      engineParent = syncNode(sharedEngine, object, parentEngineIndex, localMatrixOf(object));
      seen.add(object);
      if (object.isInstancedMesh) {
        syncInstancedMesh(object, engineParent, seen);
      }
    }
    for (const child of object.children) walk(child, engineParent);
  };
  walk(scene, -1);
}

