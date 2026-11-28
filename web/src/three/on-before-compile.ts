import { Color } from './color';
import { Vector2 } from './math';
import { DoubleSide, FrontSide, MeshBasicMaterial } from './materials';
import { ensureRawMaterial, materialAlphaMode, shaderUniformDecls } from './raw-shader';
import { sharedEngine, materialStates, customShaderIds, frameMaterialCache, fallbackMaterial, setFallbackMaterial, materialSignature, materialMaps, textureUvSignature, ensureTexture, ensureTexture3D, customAttrRegistry, customAttrRegistryVersion } from './bridge';

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
  if (material.onBeforeCompile._gs3dDefault) return;
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

export function ensureMaterial(engine, material) {
  if (material && (material.isShaderMaterial || material.isRawShaderMaterial)) {
    const id = ensureRawMaterial(engine, material);
    if (frameMaterialCache) frameMaterialCache.set(material, id);
    return id;
  }
  if (!material) {
    // A shared fallback keeps material-less meshes from allocating a new
    // engine material (and leaking the old one) on every frame.
    if (!fallbackMaterial) setFallbackMaterial(new MeshBasicMaterial());
    material = fallbackMaterial;
  }
  if (frameMaterialCache) {
    const hit = frameMaterialCache.get(material);
    if (hit !== undefined) { syncObcUniforms(engine, material, hit); return hit; }
  }
  // onBeforeCompile runs once per material per frame (the frame cache above
  // dedupes meshes sharing it); the parsed plan itself is cached on the
  // material and only rebuilt when uniforms or attribute slots change.
  if (material && typeof material.onBeforeCompile === 'function' && !material.onBeforeCompile._gs3dDefault) {
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

