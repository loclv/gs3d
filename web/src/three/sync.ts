import { Color } from './color';
import { multiplyMat4, transformPoint, transformDir, normalize3 } from './math';
import { Mesh } from './geometry';
import { BasicShadowMap, PCFSoftShadowMap, VSMShadowMap } from './renderer';
import { sharedEngine, nodeStates, cameraStates, releaseNodeRecord, releaseEngineTree, localMatrixOf, worldMatrixOf, ensureGeometry, ensureTexture } from './bridge';
import { ensureMaterial } from './on-before-compile';

const DEG2RAD = Math.PI / 180;
const MAX_EXTRA_LIGHTS = 8;

/* --- sync ---------------------------------------------------------------------- */

function matricesEqual(a, b, off = 0) {
  for (let i = 0; i < 16; i++) if (a[i] !== b[off + i]) return false;
  return true;
}

function syncNode(engine, object, parentEngineIndex, local, draw = true, opts?) {
  const isMesh = draw && object.isMesh === true;
  const material = isMesh ? (Array.isArray(object.material) ? object.material[0] : object.material) : null;
  const meshId = isMesh ? (opts?.meshId ?? ensureGeometry(engine, object.geometry,
    !!(material && material.vertexColors), !!(material && material.flatShading), material)) : -1;
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
    const materialId = opts?.materialId ?? ensureMaterial(engine, material);
    if (record.material !== materialId) {
      engine._g3_asset_node_material(record.index, materialId);
      record.material = materialId;
    }
  }
  const off = opts?.offset ?? 0;
  if (!record.matrix || !matricesEqual(record.matrix, local, off)) {
    if (opts?.skipMatrix) {
      // Bulk path: the caller uploads this matrix via _g3_asset_matrix16_bulk.
      if (!record.matrix) record.matrix = new Float64Array(16);
      for (let i = 0; i < 16; i++) record.matrix[i] = local[off + i];
      if (opts.collect) opts.collect.push(record.index, off);
    } else if (typeof engine._g3_asset_matrix16 === 'function') {
      engine._g3_asset_matrix16(
        record.index,
        local[off], local[off + 1], local[off + 2], local[off + 3],
        local[off + 4], local[off + 5], local[off + 6], local[off + 7],
        local[off + 8], local[off + 9], local[off + 10], local[off + 11],
        local[off + 12], local[off + 13], local[off + 14], local[off + 15],
      );
      if (!record.matrix) record.matrix = new Float64Array(16);
      for (let i = 0; i < 16; i++) record.matrix[i] = local[off + i];
    } else {
      for (let i = 0; i < 16; i++) engine._g3_asset_matrix(record.index, i, local[off + i]);
      if (!record.matrix) record.matrix = new Float64Array(16);
      for (let i = 0; i < 16; i++) record.matrix[i] = local[off + i];
    }
  }
  return record.index;
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

export function collectLights(scene, camera) {
  const result = { ambient: [0, 0, 0], hemisphere: null, lights: [] };
  const walk = (object, visible) => {
    const effective = visible && object.visible !== false;
    if (!effective) return;
    if (object.isLight && object.layers.test(camera.layers)) {
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

function tintedInstanceMaterial(instanced, proxy, colArr, index) {
  const o = index * 3;
  const r = colArr[o], g = colArr[o + 1], b = colArr[o + 2];
  if (proxy._tintedMat && proxy._cr === r && proxy._cg === g && proxy._cb === b) {
    return proxy._tintedMat;
  }
  const key = `${r.toFixed(4)},${g.toFixed(4)},${b.toFixed(4)}`;
  let tinted = instanced._colorMaterials.get(key);
  if (!tinted) {
    const baseMat = instanced.material;
    tinted = Object.assign(Object.create(Object.getPrototypeOf(baseMat)), baseMat);
    const base = baseMat.color || new Color(1, 1, 1);
    tinted.color = new Color(base.r * r, base.g * g, base.b * b);
    instanced._colorMaterials.set(key, tinted);
  }
  proxy._cr = r; proxy._cg = g; proxy._cb = b;
  proxy._tintedMat = tinted;
  return tinted;
}

// Per-InstancedMesh sync bookkeeping: the engine only needs work when the
// instance matrix version, instance count, instance color version, parent,
// geometry or material actually changed. Static instanced meshes — the
// common case — cost one version compare per frame instead of a full
// per-instance pass. BufferAttribute.updateRanges narrow a version bump to
// the instances the user actually touched (three.js semantics: element
// offsets into instanceMatrix.array, consumed on upload).
function syncInstancedMesh(instanced, engineParent, seen) {
  const engine = sharedEngine;
  const im = instanced.instanceMatrix;
  const icol = instanced.instanceColor;
  const count = Math.min(instanced.count, instanced._maxCount);
  const arr = im.array;
  const colArr = icol ? icol.array : null;
  const matVer = im.version;
  const colVer = icol ? icol.version : -1;
  const retint = colVer !== instanced._syncColVer ||
    instanced._tintedSourceMaterial !== instanced.material;
  if (instanced._tintedSourceMaterial !== instanced.material) {
    instanced._colorMaterials.clear();
    instanced._tintedSourceMaterial = instanced.material;
    for (const p of instanced._instances) {
      if (p) (p as any)._tintedMat = null;
    }
  }
  const structureChanged = instanced._syncParent !== engineParent ||
    instanced._syncGeometry !== instanced.geometry ||
    instanced._syncCount !== count;
  const matrixChanged = matVer !== instanced._syncMatVer;

  // Fast path: identical inputs — every proxy already owns an engine node;
  // re-add them to the release sweep and return.
  if (!retint && !structureChanged && !matrixChanged && instanced._instances.length >= count) {
    for (let i = 0; i < count; i++) {
      const p = instanced._instances[i];
      if (p) seen.add(p);
    }
    return;
  }

  const baseMat = instanced.material;
  const uniformMat = !colArr && baseMat && !Array.isArray(baseMat) ? baseMat : null;
  const geoMat = uniformMat ?? (Array.isArray(baseMat) ? baseMat[0] : baseMat);
  const meshId = count > 0 ? ensureGeometry(engine, instanced.geometry,
    !!(geoMat && geoMat.vertexColors), !!(geoMat && geoMat.flatShading), geoMat) : -1;
  // Untinted instances share one material; tinted ones resolve per instance.
  const preMaterialId = uniformMat ? ensureMaterial(engine, uniformMat) : undefined;

  const useBulk = typeof engine._g3_asset_matrix16_bulk === 'function' &&
    typeof engine._malloc === 'function' && engine.HEAPF32;
  const collect: number[] = [];
  const syncOne = i => {
    let proxy = instanced._instances[i];
    if (!proxy) {
      proxy = new Mesh(instanced.geometry, instanced.material);
      instanced._instances[i] = proxy;
    }
    proxy.geometry = instanced.geometry;
    proxy.castShadow = instanced.castShadow;
    proxy.receiveShadow = instanced.receiveShadow;
    proxy.material = colArr && instanced.material
      ? tintedInstanceMaterial(instanced, proxy, colArr, i)
      : instanced.material;
    syncNode(engine, proxy, engineParent, arr, true,
      { offset: i * 16, meshId, materialId: uniformMat ? preMaterialId : undefined,
        skipMatrix: useBulk, collect });
  };

  if (structureChanged || retint || !matrixChanged || !(im.updateRanges && im.updateRanges.length)) {
    // Full pass: structure/color changes can touch every instance, and a
    // version bump without update ranges means "something changed" — three
    // treats that as a full buffer re-upload.
    for (let i = 0; i < count; i++) syncOne(i);
  } else {
    // Ranged update: only instances covered by the recorded element ranges.
    for (const r of im.updateRanges!) {
      const start = Math.max(0, Math.floor(r.start / 16));
      const end = Math.min(count, Math.ceil((r.start + r.count) / 16));
      for (let i = start; i < end; i++) syncOne(i);
    }
    im.clearUpdateRanges();
  }

  // Every live proxy must stay visible to the release sweep, synced or not.
  for (let i = 0; i < count; i++) {
    const p = instanced._instances[i];
    if (p) seen.add(p);
  }

  // One wasm call replaces N _g3_asset_matrix16 boundary crossings. Node
  // indices and matrices are packed into wasm memory once each.
  if (collect.length && useBulk) {
    const n = collect.length / 2;
    const nPtr = engine._malloc(n * 4);
    const mPtr = engine._malloc(n * 64);
    if (nPtr && mPtr) {
      try {
        const ni = new Int32Array(engine.HEAPU8.buffer, nPtr, n);
        const mf = new Float32Array(engine.HEAPU8.buffer, mPtr, n * 16);
        for (let i = 0; i < n; i++) {
          const off = collect[i * 2 + 1];
          ni[i] = collect[i * 2];
          for (let k = 0; k < 16; k++) mf[i * 16 + k] = arr[off + k];
        }
        engine._g3_asset_matrix16_bulk(nPtr, n, mPtr, n * 16);
      } finally {
        engine._free(nPtr);
        engine._free(mPtr);
      }
    } else {
      // Allocation failure: fall back to per-node uploads.
      for (let i = 0; i < collect.length; i += 2) {
        const idx = collect[i], off = collect[i + 1];
        engine._g3_asset_matrix16(idx,
          arr[off], arr[off + 1], arr[off + 2], arr[off + 3],
          arr[off + 4], arr[off + 5], arr[off + 6], arr[off + 7],
          arr[off + 8], arr[off + 9], arr[off + 10], arr[off + 11],
          arr[off + 12], arr[off + 13], arr[off + 14], arr[off + 15]);
      }
    }
  }

  instanced._syncMatVer = matVer;
  instanced._syncColVer = colVer;
  instanced._syncCount = count;
  instanced._syncParent = engineParent;
  instanced._syncGeometry = instanced.geometry;
}

export function syncSceneTree(scene, seen, camera) {
  scene.updateMatrixWorld();
  const walk = (object, parentEngineIndex) => {
    // An invisible object hides its whole subtree, like three.js.
    if (object.visible === false) { releaseEngineTree(object); return; }
    let engineParent = parentEngineIndex;
    if (!object.isLight && !object.isCamera) {
      const matchesLayer = object.layers.test(camera.layers);
      engineParent = syncNode(sharedEngine, object, parentEngineIndex, localMatrixOf(object), matchesLayer);
      seen.add(object);
      if (object.isInstancedMesh && matchesLayer) {
        syncInstancedMesh(object, engineParent, seen);
      }
    }
    for (const child of object.children) walk(child, engineParent);
  };
  walk(scene, -1);
}

