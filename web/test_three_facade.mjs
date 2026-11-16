// Node checks for the Three.js-compatible facade (web/three.js) against a
// recording mock of the wasm engine bridge. No WebGL is required: the mock
// implements every _g3_* symbol the facade calls.

import assert from 'node:assert/strict';
import * as THREE from './three.js';
import { GLTFLoader } from './gltf-loader.js';

function createMockEngine() {
  const calls = [];
  const record = name => (...args) => { calls.push([name, ...args]); };
  let nextNode = 1, nextMesh = 1, nextMaterial = 1, nextCamera = 1, nextTexture = 1, meshVertices = 0, meshTriangles = 0;
  const engine = {
    calls,
    HEAPU8: new Uint8Array(1 << 20),
    _malloc: size => { engine._mallocSize = size; return 16; },
    _free: record('_free'),
    _g3_host_set_canvas: record('_g3_host_set_canvas'),
    _g3_host_start: (w, h) => { calls.push(['_g3_host_start', w, h]); return 1; },
    _g3_app_frame: record('_g3_app_frame'),
    _g3_app_shutdown: record('_g3_app_shutdown'),
    _g3_input_resize: record('_g3_input_resize'),
    _g3_asset_lights_begin: () => 7,
    _g3_asset_lights_clear: record('_g3_asset_lights_clear'),
    _g3_asset_lights_release: record('_g3_asset_lights_release'),
    _g3_asset_lights_active: () => 7,
    _g3_asset_light_directional: record('_g3_asset_light_directional'),
    _g3_asset_light_point: record('_g3_asset_light_point'),
    _g3_asset_light_spot: record('_g3_asset_light_spot'),
    _g3_asset_scene_epoch: () => 1,
    _g3_asset_node: (mesh, parent) => { calls.push(['_g3_asset_node', mesh, parent]); return nextNode++; },
    _g3_asset_node_generation: () => 1,
    _g3_asset_node_valid: () => 1,
    _g3_asset_node_release: record('_g3_asset_node_release'),
    _g3_asset_node_material: record('_g3_asset_node_material'),
    _g3_asset_matrix: record('_g3_asset_matrix'),
    _g3_asset_mesh_begin: () => { meshVertices = 0; meshTriangles = 0; calls.push(['_g3_asset_mesh_begin']); },
    _g3_asset_vertex: (...args) => { meshVertices++; calls.push(['_g3_asset_vertex', ...args]); },
    _g3_asset_triangle: () => { meshTriangles++; },
    _g3_asset_mesh_end: () => { calls.push(['_g3_asset_mesh_end', meshVertices, meshTriangles]); return nextMesh++; },
    _g3_asset_mesh_generation: () => 1,
    _g3_asset_mesh_valid: () => 1,
    _g3_asset_release_mesh: record('_g3_asset_release_mesh'),
    _g3_asset_material: (...args) => { calls.push(['_g3_asset_material', ...args]); return nextMaterial++; },
    _g3_asset_material_specular: record('_g3_asset_material_specular'),
    _g3_asset_material_uv_transform: record('_g3_asset_material_uv_transform'),
    _g3_asset_material_generation: () => 1,
    _g3_asset_material_valid: () => 1,
    _g3_asset_release_material: record('_g3_asset_release_material'),
    _g3_asset_texture: () => nextTexture++,
    _g3_asset_texture_generation: () => 1,
    _g3_asset_texture_valid: () => 1,
    _g3_asset_release_texture: record('_g3_asset_release_texture'),
    _g3_host_texture: record('_g3_host_texture'),
    _g3_host_texture_srgb: record('_g3_host_texture_srgb'),
    _g3_host_texture_wrap: record('_g3_host_texture_wrap'),
    _g3_host_texture_filter: record('_g3_host_texture_filter'),
    _g3_asset_environment_map: record('_g3_asset_environment_map'),
    _g3_asset_environment_rotation: record('_g3_asset_environment_rotation'),
    _g3_asset_material_environment: record('_g3_asset_material_environment'),
    _g3_asset_camera_add: (...args) => { calls.push(['_g3_asset_camera_add', ...args]); return nextCamera++; },
    _g3_asset_camera_update: record('_g3_asset_camera_update'),
    _g3_asset_camera_select: record('_g3_asset_camera_select'),
    _g3_asset_camera_remove: record('_g3_asset_camera_remove'),
    _g3_asset_camera_active: () => 1,
    _g3_asset_ambient: record('_g3_asset_ambient'),
    _g3_asset_background: record('_g3_asset_background'),
    _g3_asset_fog: record('_g3_asset_fog'),
    _g3_asset_environment_lighting: record('_g3_asset_environment_lighting'),
    _g3_asset_output_srgb: record('_g3_asset_output_srgb'),
    _g3_asset_tone_mapping: record('_g3_asset_tone_mapping'),
    _g3_asset_exposure: record('_g3_asset_exposure'),
  };
  return engine;
}

function createCanvas() {
  return {
    id: '', width: 0, height: 0, style: {},
    getContext: () => null,
    getBoundingClientRect: () => ({ width: 800, height: 600 }),
  };
}

const named = (engine, name) => engine.calls.filter(call => call[0] === name);

// --- scene graph sync -------------------------------------------------------

{
  const engine = createMockEngine();
  const renderer = new THREE.WebGPURenderer({ canvas: createCanvas(), engine });
  await renderer.init();

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x112233);
  scene.add(new THREE.AmbientLight(0xffffff, 0.5));
  const sun = new THREE.DirectionalLight(0xffeebb, 2);
  sun.position.set(1, 2, 3);
  scene.add(sun);
  const camera = new THREE.PerspectiveCamera(40, 4 / 3, 0.1, 50);
  camera.position.set(0, 0, 5);

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute([0, 0, 0, 1, 0, 0, 0, 1, 0], 3));
  geometry.setIndex([0, 1, 2]);
  const material = new THREE.MeshStandardMaterial({ color: '#ff0000', metalness: 0.5, roughness: 0.25 });
  const mesh = new THREE.Mesh(geometry, material);
  mesh.position.set(1, 2, 3);
  scene.add(mesh);

  renderer.render(scene, camera);

  // Two engine nodes: the scene root (mesh -1, parent -1) and the mesh,
  // parented under the scene node and carrying the uploaded mesh id.
  const nodes = named(engine, '_g3_asset_node');
  assert.equal(nodes.length, 2, 'scene and mesh each get an engine node');
  assert.deepEqual(nodes[0].slice(1), [-1, -1]);
  assert.deepEqual(nodes[1].slice(1), [1, 1]); // mesh id 1, parent node 1

  // The mesh node (engine id 2) receives the uploaded material (id 1).
  const nodeMaterialCalls = named(engine, '_g3_asset_node_material');
  assert.equal(nodeMaterialCalls.length, 1);
  assert.deepEqual(nodeMaterialCalls[0].slice(1), [2, 1]);

  // Geometry upload: 3 vertices, 1 triangle.
  assert.ok(named(engine, '_g3_asset_mesh_end').some(call => call[1] === 3 && call[2] === 1),
    'geometry uploads 3 vertices and 1 triangle');

  // Material upload carries linear-space colour and PBR parameters.
  const materialCalls = named(engine, '_g3_asset_material');
  assert.equal(materialCalls.length, 1);
  const args = materialCalls[0].slice(1);
  assert.ok(Math.abs(args[0] - 1) < 1e-6 && args[1] < 0.01 && args[2] < 0.01, 'red stays red in linear space');
  assert.equal(args[7], 0.5);   // metallic
  assert.equal(args[8], 0.25);  // roughness
  assert.equal(args[18], 0);    // single sided
  assert.equal(args[19], 0);    // lit
  assert.ok(named(engine, '_g3_asset_material_specular').length === 1, 'dielectric specular applied');

  // Camera added once and selected.
  assert.equal(named(engine, '_g3_asset_camera_add').length, 1);
  assert.equal(named(engine, '_g3_asset_camera_select').length, 1);
  const camArgs = named(engine, '_g3_asset_camera_add')[0].slice(1);
  assert.equal(camArgs[9], 40 * Math.PI / 180, 'fov converted to radians');
  assert.ok(Math.abs(camArgs[2] - 5) < 1e-6, 'camera sits at z=5');

  // Lights: ambient sum plus one directional.
  assert.equal(named(engine, '_g3_asset_light_directional').length, 1);
  const ambientCalls = named(engine, '_g3_asset_ambient');
  assert.equal(ambientCalls.length, 1);
  assert.ok(Math.abs(ambientCalls[0][1] - 0.5) < 1e-6, 'ambient intensity folded into colour');

  // Background converted from sRGB hex to linear.
  const bg = named(engine, '_g3_asset_background')[0];
  const expected = c => (c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4));
  assert.ok(Math.abs(bg[1] - expected(0x11 / 255)) < 1e-4, 'background r linearized');

  // Frame advanced with a sane dt.
  const frames = named(engine, '_g3_app_frame');
  assert.equal(frames.length, 1);
  assert.ok(frames[0][1] > 0 && frames[0][1] <= 0.1);
}

// --- transform caching -------------------------------------------------------

{
  const engine = createMockEngine();
  const renderer = new THREE.WebGPURenderer({ canvas: createCanvas(), engine });
  await renderer.init();
  const scene = new THREE.Scene();
  const mesh = new THREE.Mesh(new THREE.BufferGeometry(), new THREE.MeshBasicMaterial());
  mesh.geometry.setAttribute('position', new THREE.Float32BufferAttribute([0, 0, 0, 1, 0, 0, 0, 1, 0], 3));
  scene.add(mesh);
  const camera = new THREE.PerspectiveCamera();

  renderer.render(scene, camera);
  const firstMatrixWrites = named(engine, '_g3_asset_matrix').length;
  assert.ok(firstMatrixWrites >= 16, 'initial matrices uploaded');

  renderer.render(scene, camera);
  assert.equal(named(engine, '_g3_asset_matrix').length, firstMatrixWrites,
    'unchanged transforms skip matrix uploads');

  mesh.position.x = 9;
  renderer.render(scene, camera);
  assert.ok(named(engine, '_g3_asset_matrix').length > firstMatrixWrites,
    'changed transform rewrites the matrix');
}

// --- geometry versioning -------------------------------------------------------

{
  const engine = createMockEngine();
  const renderer = new THREE.WebGPURenderer({ canvas: createCanvas(), engine });
  await renderer.init();
  const scene = new THREE.Scene();
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute([0, 0, 0, 1, 0, 0, 0, 1, 0], 3));
  geometry.computeVertexNormals();
  const mesh = new THREE.Mesh(geometry, new THREE.MeshBasicMaterial());
  scene.add(mesh);
  renderer.render(scene, new THREE.PerspectiveCamera());
  const uploads = named(engine, '_g3_asset_mesh_end').length;
  assert.equal(uploads, 1);

  geometry.setAttribute('position', new THREE.Float32BufferAttribute([0, 0, 0, 2, 0, 0, 0, 2, 0], 3));
  renderer.render(scene, new THREE.PerspectiveCamera());
  assert.equal(named(engine, '_g3_asset_mesh_end').length, 2, 'version bump re-uploads geometry');
  assert.equal(named(engine, '_g3_asset_release_mesh').length, 1, 'old mesh released');

  geometry.dispose();
  renderer.render(scene, new THREE.PerspectiveCamera());
  assert.equal(named(engine, '_g3_asset_mesh_end').length, 3, 'dispose re-uploads on next use');
}

// --- visibility and removal -----------------------------------------------------

{
  const engine = createMockEngine();
  const renderer = new THREE.WebGPURenderer({ canvas: createCanvas(), engine });
  await renderer.init();
  const scene = new THREE.Scene();
  const group = new THREE.Group();
  const mesh = new THREE.Mesh(new THREE.BufferGeometry(), new THREE.MeshBasicMaterial());
  mesh.geometry.setAttribute('position', new THREE.Float32BufferAttribute([0, 0, 0, 1, 0, 0, 0, 1, 0], 3));
  group.add(mesh);
  scene.add(group);
  renderer.render(scene, new THREE.PerspectiveCamera());
  const nodesBefore = named(engine, '_g3_asset_node').length;
  assert.equal(nodesBefore, 3, 'scene + group + mesh nodes');

  mesh.visible = false;
  renderer.render(scene, new THREE.PerspectiveCamera());
  assert.ok(named(engine, '_g3_asset_node_release').length >= 1, 'hidden mesh releases its node');

  mesh.visible = true;
  group.visible = false;
  renderer.render(scene, new THREE.PerspectiveCamera());
  const releasesAfterHide = named(engine, '_g3_asset_node_release').length;
  renderer.render(scene, new THREE.PerspectiveCamera());
  assert.equal(named(engine, '_g3_asset_node_release').length, releasesAfterHide,
    'steady-state hidden subtree does not re-release every frame');
}

// --- material updates ------------------------------------------------------------

{
  const engine = createMockEngine();
  const renderer = new THREE.WebGPURenderer({ canvas: createCanvas(), engine });
  await renderer.init();
  const scene = new THREE.Scene();
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute([0, 0, 0, 1, 0, 0, 0, 1, 0], 3));
  const material = new THREE.MeshBasicMaterial({ color: 0x00ff00, transparent: true, opacity: 0.5 });
  const mesh = new THREE.Mesh(geometry, material);
  scene.add(mesh);
  renderer.render(scene, new THREE.PerspectiveCamera());

  const first = named(engine, '_g3_asset_material')[0].slice(1);
  assert.equal(first[3], 0.5, 'opacity reaches material alpha');
  assert.equal(first[5], 2, 'transparent maps to alpha blend');
  assert.equal(first[19], 1, 'basic material is unlit');

  material.opacity = 0.25;
  renderer.render(scene, new THREE.PerspectiveCamera());
  const second = named(engine, '_g3_asset_material')[1].slice(1);
  assert.equal(second[3], 0.25, 'opacity change re-uploads material');
  assert.equal(named(engine, '_g3_asset_release_material').length, 1);
}

// --- fog -------------------------------------------------------------------------

{
  const engine = createMockEngine();
  const renderer = new THREE.WebGPURenderer({ canvas: createCanvas(), engine });
  await renderer.init();
  const scene = new THREE.Scene();
  scene.fog = new THREE.FogExp2(0x334455, 0.02);
  scene.add(new THREE.Mesh(new THREE.BufferGeometry(), new THREE.MeshBasicMaterial()));
  renderer.render(scene, new THREE.PerspectiveCamera());
  const fogCalls = named(engine, '_g3_asset_fog');
  assert.equal(fogCalls.length, 1);
  assert.equal(fogCalls[0][4], 0.02, 'FogExp2 density passes through');

  scene.fog = null;
  renderer.render(scene, new THREE.PerspectiveCamera());
  assert.equal(named(engine, '_g3_asset_fog').at(-1)[4], 0, 'clearing fog zeroes density');
}

// --- size / output settings ---------------------------------------------------------

{
  const engine = createMockEngine();
  const canvas = createCanvas();
  const renderer = new THREE.WebGPURenderer({ canvas, engine, pixelRatio: 2 });
  renderer.setSize(400, 300, false);
  assert.equal(canvas.width, 800);
  assert.equal(canvas.height, 600);
  await renderer.init();
  assert.deepEqual(named(engine, '_g3_host_start')[0].slice(1), [800, 600]);

  renderer.setOutputColorSpace(THREE.LinearSRGBColorSpace);
  renderer.render(new THREE.Scene(), new THREE.PerspectiveCamera());
  assert.equal(named(engine, '_g3_asset_output_srgb').at(-1)[1], 0);

  renderer.setToneMapping(THREE.ACESFilmicToneMapping);
  renderer.render(new THREE.Scene(), new THREE.PerspectiveCamera());
  assert.equal(named(engine, '_g3_asset_tone_mapping').at(-1)[1], 'aces');

  renderer.dispose();
  assert.equal(named(engine, '_g3_asset_lights_release').at(-1)[1], 7);
  assert.equal(named(engine, '_g3_app_shutdown').length, 1);
}

// --- primitive geometries ---------------------------------------------------------

{
  const box = new THREE.BoxGeometry(2, 3, 4);
  assert.equal(box.attributes.position.count, 24, 'box has 24 vertices');
  assert.equal(box.index.count, 36, 'box has 36 indices');
  const bp = box.attributes.position.array;
  let minX = 1e9, maxX = -1e9;
  for (let i = 0; i < bp.length; i += 3) { minX = Math.min(minX, bp[i]); maxX = Math.max(maxX, bp[i]); }
  assert.ok(Math.abs(minX + 1) < 1e-6 && Math.abs(maxX - 1) < 1e-6, 'box spans width');

  const sphere = new THREE.SphereGeometry(2, 16, 8);
  const sp = sphere.attributes.position.array;
  const sn = sphere.attributes.normal.array;
  assert.equal(sphere.attributes.position.count, (16 + 1) * (8 + 1));
  let maxR = 0, badNormal = 0;
  for (let i = 0; i < sp.length; i += 3) {
    maxR = Math.max(maxR, Math.hypot(sp[i], sp[i + 1], sp[i + 2]));
  }
  for (let i = 0; i < sn.length; i += 3) {
    const l = Math.hypot(sn[i], sn[i + 1], sn[i + 2]);
    if (Math.abs(l - 1) > 1e-3) badNormal++;
  }
  assert.ok(Math.abs(maxR - 2) < 1e-5, 'sphere radius respected');
  assert.equal(badNormal, 0, 'sphere normals are unit length');

  const plane = new THREE.PlaneGeometry(4, 2, 4, 2);
  assert.equal(plane.attributes.position.count, 15);
  assert.equal(plane.index.count, 48);
  assert.ok(Math.abs(plane.attributes.position.array[0] - -2) < 1e-6, 'plane centred on origin');

  const cyl = new THREE.CylinderGeometry(1, 0.5, 2, 12, 1);
  const cp = cyl.attributes.position.array;
  let topY = -1e9, botY = 1e9;
  for (let i = 0; i < cp.length; i += 3) { topY = Math.max(topY, cp[i + 1]); botY = Math.min(botY, cp[i + 1]); }
  assert.ok(Math.abs(topY - 1) < 1e-6 && Math.abs(botY + 1) < 1e-6, 'cylinder height centred');
  const open = new THREE.CylinderGeometry(1, 1, 1, 8, 1, true);
  assert.ok(open.index.count < cyl.index.count, 'openEnded drops the caps');

  const circle = new THREE.CircleGeometry(1, 8);
  assert.equal(circle.attributes.position.count, 10, 'circle fan has centre + seam-duplicated rim');
  const ring = new THREE.RingGeometry(0.5, 1, 8);
  assert.equal(ring.attributes.position.count, 18);
  const torus = new THREE.TorusGeometry(1, 0.25, 8, 16);
  assert.equal(torus.attributes.position.count, 9 * 17);
  assert.equal(torus.index.count, 8 * 16 * 6);

  // Cone reuses the cylinder generator with a zero top radius.
  const cone = new THREE.ConeGeometry(1, 2, 8, 1);
  assert.ok(cone.isConeGeometry);
  assert.equal(cone.index.count, 72, 'cone side + base cap indices');

  const capsule = new THREE.CapsuleGeometry(0.5, 1, 4, 8);
  const capp = capsule.attributes.position.array;
  let capMinY = 1e9, capMaxY = -1e9;
  for (let i = 0; i < capp.length; i += 3) { capMinY = Math.min(capMinY, capp[i + 1]); capMaxY = Math.max(capMaxY, capp[i + 1]); }
  assert.ok(Math.abs(capMinY + 1) < 1e-6 && Math.abs(capMaxY - 1) < 1e-6, 'capsule spans radius+halfLength');

  // Polyhedra: correct face counts and all normals point outward.
  const outward = g => {
    const p = g.attributes.position.array, idx = g.index.array;
    for (let i = 0; i < idx.length; i += 3) {
      const a = idx[i] * 3, b = idx[i + 1] * 3, c = idx[i + 2] * 3;
      const ux = p[b] - p[a], uy = p[b + 1] - p[a + 1], uz = p[b + 2] - p[a + 2];
      const vx = p[c] - p[a], vy = p[c + 1] - p[a + 1], vz = p[c + 2] - p[a + 2];
      const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
      const cx = (p[a] + p[b] + p[c]) / 3, cy = (p[a + 1] + p[b + 1] + p[c + 1]) / 3, cz = (p[a + 2] + p[b + 2] + p[c + 2]) / 3;
      if (nx * cx + ny * cy + nz * cz < 0) return false;
    }
    return true;
  };
  assert.equal(new THREE.TetrahedronGeometry(1).index.count, 12);
  assert.equal(new THREE.OctahedronGeometry(1).index.count, 24);
  assert.equal(new THREE.IcosahedronGeometry(1).index.count, 60, 'icosahedron has 20 faces');
  assert.equal(new THREE.DodecahedronGeometry(1).index.count, 108, 'dodecahedron has 36 triangles');
  for (const g of [new THREE.TetrahedronGeometry(1), new THREE.OctahedronGeometry(1),
    new THREE.IcosahedronGeometry(1), new THREE.DodecahedronGeometry(1),
    new THREE.IcosahedronGeometry(1, 1), new THREE.DodecahedronGeometry(1, 1)]) {
    assert.ok(outward(g), 'polyhedron faces point outward');
  }

  // Geometries flow through the facade's upload path unchanged.
  const engine = createMockEngine();
  const renderer = new THREE.WebGPURenderer({ canvas: createCanvas(), engine });
  await renderer.init();
  const scene = new THREE.Scene();
  scene.add(new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshStandardMaterial()));
  renderer.render(scene, new THREE.PerspectiveCamera());
  const upload = named(engine, '_g3_asset_mesh_end')[0];
  assert.deepEqual(upload.slice(1), [24, 12], 'box uploads 24 vertices and 12 triangles');
}

// --- colour parsing -------------------------------------------------------------------

{
  assert.equal(new THREE.Color(0xff0000).getHex(), 0xff0000);
  assert.equal(new THREE.Color('#00ff00').getHex(), 0x00ff00);
  assert.equal(new THREE.Color('rgb(0, 0, 255)').getHex(), 0x0000ff);
  const c = new THREE.Color(0.5, 0.25, 0.125);
  assert.ok(Math.abs(c.r - 0.5) < 1e-9, 'numeric triples stay linear');
  const linear = new THREE.Color(0xffffff);
  assert.ok(linear.r > 0.99, 'white hex maps to linear white');
  const half = new THREE.Color(0x808080);
  assert.ok(half.r < 0.25 && half.r > 0.2, 'mid grey linearizes below sRGB value');
}

// --- GLTFLoader ---------------------------------------------------------------------

function buildTestGLB() {
  // One triangle, one material, one node with TRS and a child with a matrix.
  const positions = new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]);
  const normals = new Float32Array([0, 0, 1, 0, 0, 1, 0, 0, 1]);
  const indices = new Uint16Array([0, 1, 2]);
  const binLength = positions.byteLength + normals.byteLength + indices.byteLength;
  const bin = new Uint8Array(binLength);
  bin.set(new Uint8Array(positions.buffer), 0);
  bin.set(new Uint8Array(normals.buffer), positions.byteLength);
  bin.set(new Uint8Array(indices.buffer), positions.byteLength + normals.byteLength);

  const json = {
    asset: { version: '2.0' },
    scene: 0,
    scenes: [{ nodes: [0] }],
    nodes: [
      { name: 'tri', mesh: 0, translation: [1, 2, 3], rotation: [0, 0, Math.SQRT1_2, Math.SQRT1_2], children: [1] },
      { name: 'child', mesh: 0, matrix: [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 4, 5, 6, 1] },
    ],
    meshes: [{ primitives: [{ attributes: { POSITION: 0, NORMAL: 1 }, indices: 2, material: 0 }] }],
    materials: [{ pbrMetallicRoughness: { baseColorFactor: [1, 0, 0, 1], metallicFactor: 0.5, roughnessFactor: 0.25 }, doubleSided: true }],
    accessors: [
      { bufferView: 0, componentType: 5126, count: 3, type: 'VEC3' },
      { bufferView: 1, componentType: 5126, count: 3, type: 'VEC3' },
      { bufferView: 2, componentType: 5123, count: 3, type: 'SCALAR' },
    ],
    bufferViews: [
      { buffer: 0, byteOffset: 0, byteLength: positions.byteLength },
      { buffer: 0, byteOffset: positions.byteLength, byteLength: normals.byteLength },
      { buffer: 0, byteOffset: positions.byteLength + normals.byteLength, byteLength: indices.byteLength },
    ],
    buffers: [{ byteLength: binLength }],
  };

  const jsonBytes = new TextEncoder().encode(JSON.stringify(json));
  const jsonPad = (4 - (jsonBytes.length % 4)) % 4;
  const binPad = (4 - (bin.length % 4)) % 4;
  const total = 12 + 8 + jsonBytes.length + jsonPad + 8 + bin.length + binPad;
  const glb = new ArrayBuffer(total);
  const view = new DataView(glb);
  view.setUint32(0, 0x46546c67, true);
  view.setUint32(4, 2, true);
  view.setUint32(8, total, true);
  view.setUint32(12, jsonBytes.length + jsonPad, true);
  view.setUint32(16, 0x4e4f534a, true);
  new Uint8Array(glb, 20, jsonBytes.length).set(jsonBytes);
  let offset = 20 + jsonBytes.length + jsonPad;
  view.setUint32(offset, bin.length + binPad, true);
  view.setUint32(offset + 4, 0x004e4942, true);
  new Uint8Array(glb, offset + 8, bin.length).set(bin);
  return glb;
}

{
  const glb = buildTestGLB();
  const loader = new GLTFLoader();
  const { json, bin } = (() => {
    // parseGLB is internal; exercise the public path via a .glb sniff in load()
    // is async, so use parse() on the JSON chunk extracted here.
    const view = new DataView(glb);
    const jsonLen = view.getUint32(12, true);
    const jsonText = new TextDecoder().decode(new Uint8Array(glb, 20, jsonLen));
    const binStart = 20 + jsonLen;
    const binLen = view.getUint32(binStart, true);
    return { json: JSON.parse(jsonText), bin: new Uint8Array(glb, binStart + 8, binLen) };
  })();
  const gltf = loader.parse(json, bin);
  assert.ok(gltf.scene, 'gltf.scene exists');
  assert.equal(gltf.animations.length, 0, 'animations unsupported -> empty');

  const root = gltf.scene.children[0];
  assert.equal(root.name, 'tri');
  assert.ok(Math.abs(root.position.x - 1) < 1e-6 && Math.abs(root.position.z - 3) < 1e-6,
    'node translation applied');
  assert.ok(Math.abs(root.rotation.z - Math.PI / 2) < 1e-3, 'quaternion converted to euler z');

  const mesh = root.children[0];
  assert.ok(mesh.isMesh, 'matrix-transformed child became a Mesh');
  assert.ok(Math.abs(mesh.position.x - 4) < 1e-6 && Math.abs(mesh.position.z - 6) < 1e-6,
    'node matrix decomposed to translation');
  assert.equal(mesh.geometry.attributes.position.count, 3);
  assert.equal(mesh.geometry.index.count, 3);
  assert.ok(mesh.material.isMeshStandardMaterial);
  assert.ok(Math.abs(mesh.material.metalness - 0.5) < 1e-6, 'metallic factor mapped');
  assert.ok(Math.abs(mesh.material.roughness - 0.25) < 1e-6, 'roughness factor mapped');
  assert.equal(mesh.material.side, THREE.DoubleSide, 'doubleSided mapped');

  // The parsed scene renders through the facade.
  const engine = createMockEngine();
  const renderer = new THREE.WebGPURenderer({ canvas: createCanvas(), engine });
  await renderer.init();
  const scene = new THREE.Scene();
  scene.add(gltf.scene);
  renderer.render(scene, new THREE.PerspectiveCamera());
  assert.ok(named(engine, '_g3_asset_mesh_end').length >= 1, 'glTF geometry uploads');
}

{
  // glTF textures: samplers, texture slots, TEXCOORD_n and KHR_texture_transform.
  const positions = new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]);
  const uvs0 = new Float32Array([0, 0, 1, 0, 0, 1]);
  const uvs1 = new Float32Array([0.5, 0.5, 1, 0.5, 0.5, 1]);
  const indices = new Uint16Array([0, 1, 2]);
  const bin = new Uint8Array(positions.byteLength + uvs0.byteLength + uvs1.byteLength + indices.byteLength + 16);
  bin.set(new Uint8Array(positions.buffer), 0);
  bin.set(new Uint8Array(uvs0.buffer), positions.byteLength);
  bin.set(new Uint8Array(uvs1.buffer), positions.byteLength + uvs0.byteLength);
  bin.set(new Uint8Array(indices.buffer), positions.byteLength + uvs0.byteLength + uvs1.byteLength);
  // Dummy image bytes (never decoded under node; the loader tolerates that).
  bin.set([137, 80, 78, 71], positions.byteLength + uvs0.byteLength + uvs1.byteLength + indices.byteLength);

  const json = {
    asset: { version: '2.0' },
    scene: 0,
    scenes: [{ nodes: [0] }],
    nodes: [{ name: 'quad', mesh: 0 }],
    meshes: [{ primitives: [{ attributes: { POSITION: 0, TEXCOORD_0: 1, TEXCOORD_1: 2 }, indices: 3, material: 0 }] }],
    materials: [{
      pbrMetallicRoughness: {
        baseColorTexture: { index: 0, texCoord: 0 },
        metallicRoughnessTexture: { index: 1 },
      },
      normalTexture: { index: 2, texCoord: 1, scale: 0.8 },
      occlusionTexture: { index: 3, strength: 0.5 },
      emissiveTexture: { index: 4 },
      emissiveFactor: [1, 1, 1],
    }],
    textures: [
      { source: 0, sampler: 0, extensions: { KHR_texture_transform: { offset: [0.25, 0.75], scale: [2, 3], rotation: 0.5, texCoord: 1 } } },
      { source: 1, sampler: 1 },
      { source: 2, sampler: 1 },
      { source: 3, sampler: 1 },
      { source: 3, sampler: 1 },
    ],
    samplers: [
      { wrapS: 33071, wrapT: 10497, minFilter: 9987, magFilter: 9729 },
      { wrapS: 10497, wrapT: 33648 },
    ],
    images: [0, 1, 2, 3].map(() => ({ bufferView: 4, mimeType: 'image/png' })),
    accessors: [
      { bufferView: 0, componentType: 5126, count: 3, type: 'VEC3' },
      { bufferView: 1, componentType: 5126, count: 3, type: 'VEC2' },
      { bufferView: 2, componentType: 5126, count: 3, type: 'VEC2' },
      { bufferView: 3, componentType: 5123, count: 3, type: 'SCALAR' },
    ],
    bufferViews: [
      { buffer: 0, byteOffset: 0, byteLength: positions.byteLength },
      { buffer: 0, byteOffset: positions.byteLength, byteLength: uvs0.byteLength },
      { buffer: 0, byteOffset: positions.byteLength + uvs0.byteLength, byteLength: uvs1.byteLength },
      { buffer: 0, byteOffset: positions.byteLength + uvs0.byteLength + uvs1.byteLength, byteLength: indices.byteLength },
      { buffer: 0, byteOffset: positions.byteLength + uvs0.byteLength + uvs1.byteLength + indices.byteLength, byteLength: 4 },
    ],
    buffers: [{ byteLength: bin.byteLength }],
  };

  const gltf = new GLTFLoader().parse(json, bin);
  const mesh = gltf.scene.children[0];
  const material = mesh.material;

  assert.ok(material.map?.isTexture, 'baseColorTexture -> material.map');
  assert.equal(material.map.colorSpace, 'srgb', 'base color is sRGB');
  assert.equal(material.map.channel, 1, 'KHR_texture_transform texCoord override');
  assert.ok(Math.abs(material.map.offset.x - 0.25) < 1e-6 && Math.abs(material.map.offset.y - 0.75) < 1e-6, 'transform offset');
  assert.ok(Math.abs(material.map.repeat.x - 2) < 1e-6 && Math.abs(material.map.repeat.y - 3) < 1e-6, 'transform scale');
  assert.ok(Math.abs(material.map.rotation + 0.5) < 1e-6, 'transform rotation negated for UV space');
  assert.equal(material.map.wrapS, THREE.ClampToEdgeWrapping, 'sampler wrapS 33071 -> clamp');
  assert.equal(material.map.wrapT, THREE.RepeatWrapping, 'sampler wrapT 10497 -> repeat');
  assert.equal(material.map.minFilter, THREE.LinearMipmapLinearFilter, 'sampler minFilter 9987');

  assert.ok(material.metalnessMap?.isTexture, 'metallicRoughnessTexture -> metalnessMap');
  assert.equal(material.metalnessMap, material.roughnessMap, 'MR texture shared by both maps');
  assert.equal(material.metalnessMap.colorSpace, 'none', 'MR texture is linear');
  assert.ok(material.normalMap?.isTexture, 'normal map assigned');
  assert.equal(material.normalMap.channel, 1, 'normalTexture texCoord');
  assert.ok(Math.abs(material.normalScale.x - 0.8) < 1e-6, 'normalTexture scale');
  assert.ok(material.aoMap?.isTexture, 'occlusionTexture -> aoMap');
  assert.ok(Math.abs(material.aoMapIntensity - 0.5) < 1e-6, 'occlusion strength');
  assert.ok(material.emissiveMap?.isTexture, 'emissiveTexture -> emissiveMap');

  assert.ok(mesh.geometry.attributes.uv, 'TEXCOORD_0 -> uv');
  assert.ok(mesh.geometry.attributes.uv1, 'TEXCOORD_1 -> uv1');
  assert.ok(Math.abs(mesh.geometry.attributes.uv1.array[0] - 0.5) < 1e-6, 'uv1 data uploaded');
}

// --- textures -------------------------------------------------------------------------

{
  const engine = createMockEngine();
  const renderer = new THREE.WebGPURenderer({ canvas: createCanvas(), engine });
  await renderer.init();
  const scene = new THREE.Scene();
  const geometry = new THREE.BoxGeometry(1, 1, 1);

  // 2x2 RGBA checker.
  const pixels = new Uint8Array(2 * 2 * 4);
  for (let i = 0; i < 4; i++) { pixels[i * 4] = 255; pixels[i * 4 + 3] = 255; }
  const texture = new THREE.Texture({ width: 2, height: 2, pixels });
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.ClampToEdgeWrapping;
  texture.repeat.set(2, 2);
  texture.offset.set(0.1, 0.2);
  texture.rotation = 0.5;

  const material = new THREE.MeshStandardMaterial({ map: texture });
  const mesh = new THREE.Mesh(geometry, material);
  scene.add(mesh);
  renderer.render(scene, new THREE.PerspectiveCamera());

  // sRGB upload path chosen by colorSpace.
  assert.equal(named(engine, '_g3_host_texture_srgb').length, 1, 'srgb texture upload');
  assert.equal(named(engine, '_g3_host_texture').length, 0);
  const wrapCall = named(engine, '_g3_host_texture_wrap')[0];
  assert.deepEqual(wrapCall.slice(2), [1, 0], 'wrap modes map repeat->1 clamp->0');

  // Material carries the texture id and UV transform.
  const matArgs = named(engine, '_g3_asset_material')[0].slice(1);
  assert.equal(matArgs[4], 1, 'baseColor texture slot gets texture id');
  const uvCall = named(engine, '_g3_asset_material_uv_transform')[0];
  assert.equal(uvCall[2], 0);            // slot 0 = base color
  assert.ok(Math.abs(uvCall[3] - 0.1) < 1e-6 && Math.abs(uvCall[4] - 0.2) < 1e-6, 'uv offset');
  assert.ok(Math.abs(uvCall[5] - 2) < 1e-6 && Math.abs(uvCall[6] - 2) < 1e-6, 'uv repeat');
  assert.ok(Math.abs(uvCall[7] - 0.5) < 1e-6, 'uv rotation');
  assert.equal(uvCall[8], 0, 'uv texcoord 0');

  // Steady state: no re-upload.
  renderer.render(scene, new THREE.PerspectiveCamera());
  assert.equal(named(engine, '_g3_asset_material').length, 1, 'material cached');
  assert.equal(named(engine, '_g3_host_texture_srgb').length, 1, 'texture cached');

  // needsUpdate bumps version -> texture and material re-upload.
  texture.needsUpdate = true;
  texture.version++;
  renderer.render(scene, new THREE.PerspectiveCamera());
  assert.equal(named(engine, '_g3_host_texture_srgb').length, 2, 'texture re-uploaded');
  assert.equal(named(engine, '_g3_asset_release_texture').length, 1, 'old texture released');
  assert.equal(named(engine, '_g3_asset_material').length, 2, 'material re-uploaded with new texture');

  // Removing the map drops the texture slot.
  material.map = null;
  renderer.render(scene, new THREE.PerspectiveCamera());
  const lastMat = named(engine, '_g3_asset_material').at(-1).slice(1);
  assert.equal(lastMat[4], -1, 'map removal clears texture slot');
}

{
  // PBR map slots: normal, occlusion, emissive and packed metallic-roughness.
  const engine = createMockEngine();
  const renderer = new THREE.WebGPURenderer({ canvas: createCanvas(), engine });
  await renderer.init();
  const scene = new THREE.Scene();
  const geometry = new THREE.BoxGeometry(1, 1, 1);

  const makeTex = () => {
    const pixels = new Uint8Array(4 * 4);
    for (let i = 0; i < 16; i++) { pixels[i * 4] = 128; pixels[i * 4 + 1] = 128; pixels[i * 4 + 2] = 128; pixels[i * 4 + 3] = 255; }
    const t = new THREE.Texture({ width: 2, height: 2, pixels });
    t.needsUpdate = true;
    return t;
  };
  const normalMap = makeTex(); normalMap.channel = 1;
  const aoMap = makeTex();
  const emissiveMap = makeTex();
  const mrMap = makeTex();

  const material = new THREE.MeshStandardMaterial({
    normalMap, normalScale: new THREE.Vector2(0.5, 0.5),
    aoMap, aoMapIntensity: 0.7,
    emissiveMap, metalnessMap: mrMap, roughnessMap: mrMap,
  });
  scene.add(new THREE.Mesh(geometry, material));
  renderer.render(scene, new THREE.PerspectiveCamera());

  const args = named(engine, '_g3_asset_material')[0].slice(1);
  assert.equal(args[9], 1, 'mr texture slot');
  assert.equal(args[10], 2, 'normal texture slot');
  assert.ok(Math.abs(args[11] - 0.5) < 1e-6, 'normal scale');
  assert.equal(args[12], 3, 'occlusion texture slot');
  assert.ok(Math.abs(args[13] - 0.7) < 1e-6, 'occlusion strength');
  assert.equal(args[17], 4, 'emissive texture slot');

  const uvCalls = named(engine, '_g3_asset_material_uv_transform');
  const slots = uvCalls.map(c => c[2]);
  assert.deepEqual(slots.sort((a, b) => a - b), [1, 2, 3, 4], 'uv transforms for slots 1-4');
  const normalUv = uvCalls.find(c => c[2] === 2);
  assert.equal(normalUv[8], 1, 'normal map texcoord channel 1');
}

// --- vertexColors ---------------------------------------------------------------------

{
  const engine = createMockEngine();
  const renderer = new THREE.WebGPURenderer({ canvas: createCanvas(), engine });
  await renderer.init();
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute([0, 0, 0, 1, 0, 0, 0, 1, 0], 3));
  geometry.setAttribute('color', new THREE.Float32BufferAttribute([1, 0, 0, 0, 1, 0, 0, 0, 1], 3));
  geometry.setIndex([0, 1, 2]);
  const scene = new THREE.Scene();
  const mesh = new THREE.Mesh(geometry, new THREE.MeshBasicMaterial());
  scene.add(mesh);

  // Default: vertex colors ignored (uploaded as white).
  renderer.render(scene, new THREE.PerspectiveCamera());
  let verts = named(engine, '_g3_asset_vertex').slice(-3);
  assert.deepEqual(verts[0].slice(-4), [1, 1, 1, 1], 'vertexColors off -> white vertex color');

  // Opt-in: color attribute flows through.
  mesh.material.vertexColors = true;
  renderer.render(scene, new THREE.PerspectiveCamera());
  verts = named(engine, '_g3_asset_vertex').slice(-3);
  assert.deepEqual(verts[0].slice(-4), [1, 0, 0, 1], 'vertexColors on -> red channel');
  assert.deepEqual(verts[1].slice(-4), [0, 1, 0, 1], 'vertexColors on -> green channel');
  // A second engine mesh was created for the flagged geometry.
  assert.equal(named(engine, '_g3_asset_mesh_end').length, 2, 'per-flag geometry cache');
}

// --- quaternion -------------------------------------------------------------------------

{
  const o = new THREE.Object3D();
  // Euler writes sync into quaternion on resolve.
  o.rotation.set(0, 0, Math.PI / 2);
  o.getWorldDirection(new THREE.Vector3());
  assert.ok(Math.abs(o.quaternion.z - Math.SQRT1_2) < 1e-6 && Math.abs(o.quaternion.w - Math.SQRT1_2) < 1e-6,
    'euler z-rotation produces quaternion z=w=sqrt(1/2)');

  // Quaternion writes take over and sync the euler back.
  o.quaternion.setFromAxisAngle(new THREE.Vector3(0, 1, 0), Math.PI / 2);
  const dir = o.getWorldDirection(new THREE.Vector3());
  assert.ok(Math.abs(dir.x + 1) < 1e-6, 'quaternion y-rotation drives world direction');
  assert.ok(Math.abs(o.rotation.y - Math.PI / 2) < 1e-3, 'euler synced from quaternion');

  // slerp halfway between identity and a half-turn about Z.
  const a = new THREE.Quaternion();
  const b = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), Math.PI);
  a.slerp(b, 0.5).normalize();
  assert.ok(Math.abs(a.z - Math.SQRT1_2) < 1e-3 && Math.abs(a.w - Math.SQRT1_2) < 1e-3, 'slerp midpoint');
}

// --- Raycaster and Box3 -----------------------------------------------------------------

{
  const scene = new THREE.Scene();
  const box = new THREE.Mesh(new THREE.BoxGeometry(2, 2, 2), new THREE.MeshBasicMaterial());
  box.position.set(0, 0, -5);
  scene.add(box);

  const bounds = new THREE.Box3().setFromObject(box);
  const center = bounds.getCenter(new THREE.Vector3());
  const size = bounds.getSize(new THREE.Vector3());
  assert.ok(Math.abs(center.x) < 1e-6 && Math.abs(center.z + 5) < 1e-6, 'Box3 center follows object');
  assert.ok(Math.abs(size.x - 2) < 1e-6, 'Box3 size from geometry');
  assert.ok(bounds.containsPoint(new THREE.Vector3(0, 0, -5)), 'Box3 contains center');

  // Ray from origin toward the box.
  const rc = new THREE.Raycaster(new THREE.Vector3(0, 0, 0), new THREE.Vector3(0, 0, -1));
  const hits = rc.intersectObject(scene, true);
  assert.equal(hits.length, 1, 'ray hits the box once');
  assert.ok(Math.abs(hits[0].distance - 4) < 0.5, `hit distance ~4 (got ${hits[0].distance.toFixed(2)})`);
  assert.equal(hits[0].object, box, 'hit reports the mesh');
  assert.ok(hits[0].face.normal.z > 0, 'face normal is the outward geometric normal');

  // Miss: ray along +X.
  const miss = new THREE.Raycaster(new THREE.Vector3(0, 0, 0), new THREE.Vector3(1, 0, 0));
  assert.equal(miss.intersectObject(scene, true).length, 0, 'ray misses');

  // setFromCamera: NDC center of a perspective camera looking down -Z.
  const cam = new THREE.PerspectiveCamera(60, 1, 0.1, 100);
  cam.position.set(0, 0, 10);
  const rc2 = new THREE.Raycaster().setFromCamera(new THREE.Vector2(0, 0), cam);
  const hits2 = rc2.intersectObject(scene, true);
  assert.ok(hits2.length >= 1, 'setFromCamera ray hits');
}

// --- scene.environment -------------------------------------------------------------------

{
  const engine = createMockEngine();
  const renderer = new THREE.WebGPURenderer({ canvas: createCanvas(), engine });
  await renderer.init();
  const scene = new THREE.Scene();
  const pixels = new Uint8Array(4 * 4);
  for (let i = 0; i < 16; i++) { pixels[i * 4] = 200; pixels[i * 4 + 3] = 255; }
  const env = new THREE.Texture({ width: 2, height: 2, pixels });
  scene.environment = env;
  scene.environmentIntensity = 0.8;
  scene.environmentRotation = 0.25;
  scene.add(new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshStandardMaterial({ envMapIntensity: 0.5 })));
  renderer.render(scene, new THREE.PerspectiveCamera());

  const envCall = named(engine, '_g3_asset_environment_map').at(-1);
  assert.equal(envCall[1], 1, 'environment texture uploaded and bound');
  assert.ok(Math.abs(envCall[2] - 0.8) < 1e-6, 'environmentIntensity passed');
  const rotCall = named(engine, '_g3_asset_environment_rotation').at(-1);
  assert.ok(Math.abs(rotCall[1] - 0.25) < 1e-6, 'environmentRotation passed');
  const matEnv = named(engine, '_g3_asset_material_environment').at(-1);
  assert.ok(Math.abs(matEnv[2] - 0.5) < 1e-6, 'material envMapIntensity passed');

  // Clearing the environment unbinds it.
  scene.environment = null;
  renderer.render(scene, new THREE.PerspectiveCamera());
  assert.equal(named(engine, '_g3_asset_environment_map').at(-1)[1], -1, 'environment cleared');
}

// --- OrbitControls ---------------------------------------------------------------------

{
  const listeners = {};
  const fakeEl = {
    clientHeight: 600, style: {},
    addEventListener: (name, fn) => { (listeners[name] ??= []).push(fn); },
    removeEventListener: () => {},
    setPointerCapture: () => {}, releasePointerCapture: () => {},
  };
  const camera = new THREE.PerspectiveCamera(50, 1, 0.1, 100);
  camera.position.set(0, 0, 5);
  const controls = new THREE.OrbitControls(camera, fakeEl);
  controls.target.set(0, 0, 0);
  controls.update();
  assert.ok(Math.abs(camera.position.z - 5) < 1e-6, 'controls keep initial radius');

  const fire = (name, event) => (listeners[name] || []).forEach(fn => fn(event));
  fire('pointerdown', { pointerId: 1, clientX: 100, clientY: 100, button: 0, shiftKey: false });
  fire('pointermove', { pointerId: 1, clientX: 200, clientY: 100 });
  assert.ok(camera.position.x !== 0 || camera.position.z !== 5, 'drag orbits the camera');
  const dist = camera.position.length();
  assert.ok(Math.abs(dist - 5) < 1e-3, 'orbit preserves distance to target');

  const before = camera.position.length();
  fire('wheel', { deltaY: 100, deltaMode: 0, preventDefault: () => {} });
  assert.ok(camera.position.length() > before, 'scroll down dollies out');
  fire('wheel', { deltaY: -300, deltaMode: 0, preventDefault: () => {} });
  assert.ok(camera.position.length() < before, 'scroll up dollies in');
  controls.dispose();
}

console.log('three.js facade checks passed');
