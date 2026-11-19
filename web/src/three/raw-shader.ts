import { Color } from './color';
import { AdditiveBlending, CustomBlending, OneFactor, OneMinusSrcAlphaFactor, AddEquation } from './textures';
import { FrontSide } from './materials';
import { materialStates, ALPHA_OPAQUE, ALPHA_MASK, ALPHA_BLEND, ALPHA_ADDITIVE, ALPHA_PREMULTIPLIED, ensureTexture, ensureTexture3D, UV_SLOT_ATTRS, customAttrRegistry, customAttrRegistryVersion } from './bridge';

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

export function vertexAttrInfo(material) {
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

export function shaderUniformDecls(vs, fs) {
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

export function materialAlphaMode(material, opacity) {
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

export function ensureRawMaterial(engine, material) {
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


