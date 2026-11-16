// Node checks for the Three.js-compatible facade (web/three.js) against a
// recording mock of the wasm engine bridge. No WebGL is required: the mock
// implements every _g3_* symbol the facade calls.

import assert from 'node:assert/strict';
import * as THREE from './three.js';

function createMockEngine() {
  const calls = [];
  const record = name => (...args) => { calls.push([name, ...args]); };
  let nextNode = 1, nextMesh = 1, nextMaterial = 1, nextCamera = 1, meshVertices = 0, meshTriangles = 0;
  const engine = {
    calls,
    HEAPU8: new Uint8Array(16),
    _malloc: size => { engine._mallocSize = size; return 0; },
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
    _g3_asset_vertex: () => { meshVertices++; },
    _g3_asset_triangle: () => { meshTriangles++; },
    _g3_asset_mesh_end: () => { calls.push(['_g3_asset_mesh_end', meshVertices, meshTriangles]); return nextMesh++; },
    _g3_asset_mesh_generation: () => 1,
    _g3_asset_mesh_valid: () => 1,
    _g3_asset_release_mesh: record('_g3_asset_release_mesh'),
    _g3_asset_material: (...args) => { calls.push(['_g3_asset_material', ...args]); return nextMaterial++; },
    _g3_asset_material_specular: record('_g3_asset_material_specular'),
    _g3_asset_material_generation: () => 1,
    _g3_asset_material_valid: () => 1,
    _g3_asset_release_material: record('_g3_asset_release_material'),
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

console.log('three.js facade checks passed');
