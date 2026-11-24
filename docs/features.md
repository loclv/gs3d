# Features

What goose-3d can do today. Each bullet names the capability; the linked docs
carry the details and the exact API. For what is deliberately *not* here, see
[Using the engine — limits](using-the-engine.md#limits-and-what-come-next)
and the [Three.js roadmap](threejs-roadmap.md).

## Core Features

### Rendering

* WebGL2 is the full-featured backend (Emscripten). The default landing page
  prefers a reduced WebGPU renderer — demo meshes, depth, directional
  lighting, fog, unlit materials, transparency — and falls back to WebGL2
  automatically when WebGPU is missing or fails. The CPU rasterizer is the
  headless renderer and the test oracle.
* Per-frame pipeline: transforms, frustum cull, draw-list pack, sort, one
  `g3p_draw_frame` call. Opaque items sort by mesh id so a GPU driver can
  batch adjacent instances; blended items sort far→near after all opaque
  work, reading but not writing depth.
* Perspective and orthographic cameras, orbit/zoom controls, multiple
  saved cameras with stable removable IDs.
* Deterministic output: the CPU backend is byte-identical across worker
  counts (verified at 1/3/5/8 threads) and writes PPM frames; `read_pixel`
  exposes any pixel to tests.

### Materials and lighting

* Shared materials with metallic-roughness PBR (GGX direct lighting,
  dielectric Fresnel via `ior`), plus normal, occlusion, emissive,
  specular, clearcoat, sheen and anisotropy maps — up to eleven texture
  slots per material on a 16-unit GPU.
* glTF material extensions: `KHR_materials_unlit`, `_ior`, `_specular`,
  `_clearcoat`, `_sheen`, `_anisotropy`, `_emissive_strength`,
  `_variants`, and per-slot `KHR_texture_transform` on eight UV sets.
* Custom shaders on WebGL: material-shader variants with a header/body/
  tail split, raw vertex+fragment programs, named uniforms, per-item
  `u_user` floats, and a 3D LUT texture (`u_lut`).
* Lights: one primary directional plus up to eight extra directional,
  point or spot lights (`Light[8]` in `ViewState`), physical
  inverse-square variants, ambient + hemispherical fill, fog and
  background colour.
* Shadows: the primary directional light, one selected point light and
  one selected spot light cast shadows; 256/512/1024 maps, hard or
  3×3/5×5 PCF filtering.
* Image-based lighting: equirectangular environment maps (linear or
  Radiance RGBE HDR) with GGX-prefiltered reflections and a split-sum BRDF
  LUT, per-material environment intensity and rotation.

### Post-processing and output

* Render targets (sampleable textures, up to 4,194,304 pixels each),
  generation-checked handles, and feedback protection — sampling the
  active target skips that item and counts it in
  `stats().feedback_items_suppressed`.
* A fixed eight-pass post-process queue with built-in
  copy/grayscale/invert/FXAA passes and custom GLSL ES 3.00 fragment
  bodies on WebGL (16 KiB, 64 shader IDs per engine lifetime).
* Tone mapping (none/Reinhard/ACES), exposure (0–32), opt-in sRGB output
  encoding, FXAA.

### Geometry, textures and deformation

* Mesh arena with primitives (`mesh_cube`, `mesh_sphere`, `mesh_plane`,
  `push_grid`), custom vertex pushes with up to eight UV sets, tangents
  and vertex colours, checked handles, removal and `mesh_compact()`.
  Asset-owned meshes support CPU position/normal/tangent updates for
  CPU-side deformation.
* Textures: RGBA8, sRGB, linear RGBA32F HDR, RGBA16F, and 3D textures;
  nearest/linear/mipmap filtering, clamp/repeat/mirror wrap per axis;
  native Radiance RGBE (`.hdr`) loading.
* Morph targets and skeletal skinning — GPU joint palettes and morph
  delta textures on WebGL (up to 64 targets, 64 MiB delta budget), CPU
  deformation on the reference backend, CPU geometry retained for picking.

### Scene, assets and interaction

* Node arena with parent hierarchy, TRS + matrix transforms, visibility,
  per-node colour/specular/unlit/alpha-mode, checked handles, node
  removal with child reparenting, `scene_clear()`.
* glTF 2.0 loading in the browser (`.gltf`/`.glb`): scene selection,
  node transforms, cameras, `KHR_lights_punctual`,
  `EXT_mesh_gpu_instancing`, `KHR_mesh_quantization`, sparse accessors,
  vertex colours, material variants, morph and skeletal animation
  (LINEAR/STEP/CUBICSPLINE). A native loader covers the static subset
  plus PPM/PNG/JPEG decode with queryable `AssetError`-style failures.
* Raycast picking (`pick_screen`, `raycast`), swept segment/sphere
  collision (`segment_sphere_intersects`), and oriented box/sphere/capsule
  physics bodies — gravity, one-step forces and torques, linear and angular
  velocity, restitution, friction, adaptive substeps, automatic sleeping,
  kinematic bodies, per-body removal, box-box contact manifolds, per-step
  contact queries (with world contact points) and collider raycasts. A RapierPhysics-style facade
  (`g3.rapier`) exposes the same solver with Rapier vocabulary:
  cuboid/ball/capsule bodies, world timestep + step,
  translation/linvel/angvel/rotation accessors, applyImpulse,
  applyImpulseAtPoint, addTorque, body-type/mass changes and
  `world.castRay`-style raycasts.
* Input: 512-key state with edge detection (`key_down`/`key_pressed`/
  `key_released`), mouse deltas; a typed orbit/pan/pinch/keyboard
  controls package with click selection.

### Platform and developer experience

* Written entirely in Goose (no heap, no GC); C only behind the ABI, with
  `_Static_assert`s pinning every packed struct's size and offsets, f32
  end to end.
* `gs3d` npm package (Apache-2.0): asset helpers, orbit controls, glTF
  loader and exporter, a Rapier-style `gs3d/physics` world over the
  engine solver, and a Three.js-compatible facade (`gs3d/three`,
  `gs3d/webgpu`) covering scene graphs, cameras, common geometries and
  materials, lights, textures, raycasting and controls — a documented
  subset, not full Three.js compatibility.
* Runnable examples: landing demo, Beacon Run and Rift Siege games, model
  viewer, instancing benchmark with a Three.js/PixiJS comparison page,
  WebGL reference-check suite, and `samples/` scenes and apps
  (animations, caustic-volume, loverocks, physics).
* Headless verification: `./build_native.sh --test` runs 99 math + 333
  engine-pixel + game and siege checks, gates zero warnings on every
  `src/*.goose`, and compares PPMs byte-for-byte at 1/3/5/8 workers;
  `G3_PROFILE=1` times the CPU backend's phases.

## Other Features

* Browser asset pipeline: fetch/CORS loading, browser image decoding
  (PNG/JPEG/WebP with `EXT_texture_webp` fallback), Radiance `.hdr`
  environments, typed `AssetError` codes, generation-checked handles that
  detect disposal and scene resets.
* glTF cameras become engine cameras (`selectCamera`); glTF punctual
  lights can replace the engine light set (`applyLights`, with optional
  shadow-caster selection).
* Loaded-model animation controls: play/pause/seek/stop, plus turntable
  and bob playback modes in the viewer.
* Environment controls independent of the map: intensity, equirect
  rotation, and hemispherical sky/ground ambient fill.
* `app_native` renders stills and frame sequences from the CLI
  (`--frames/--width/--height/--out`, `--glb` model input) — the same
  scene the browser runs.
* Fail-loud boot: the first frame checks `glGetError()` once and reports
  it to the page; the HUD shows a visible failure rather than a blank
  canvas.
* Benchmark tooling: instancing draw-call page, animation benchmark,
  transform microbenchmark, WebGPU timestamp queries where the browser
  exposes them, and documented measurement methods in
  [performance.md](performance.md).
