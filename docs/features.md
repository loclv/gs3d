# Features

What goose-3d can do today. Each bullet names the capability; the linked docs
carry the details and the exact API. For what is deliberately *not* here, see
[Using the engine — limits](using-the-engine.md#limits-and-what-would-come-next)
and the [Three.js roadmap](threejs-roadmap.md).

## Core Features

### Rendering

* Three backends behind one ABI: WebGL2 (full feature set, Emscripten),
  WebGPU (the built-in demo's meshes, lighting, fog, transparency — the
  default landing page, with automatic WebGL2 fallback), and a threaded CPU
  rasterizer that is the test oracle and the headless renderer.
* Per-frame pipeline: transforms, frustum cull, draw-list pack, sort, one
  `g3p_draw_frame` call. Opaque items batch by mesh id; blended items sort
  far→near after all opaque work.
* Perspective and orthographic cameras, orbit/zoom controls, multiple
  saved cameras with stable IDs.
* Deterministic output: the CPU backend is byte-identical across worker
  counts (verified at 1/3/5/8 threads) and writes PPM frames.

### Materials and lighting

* Shared materials with metallic-roughness PBR (GGX direct lighting,
  dielectric Fresnel via `ior`), plus normal, occlusion, emissive,
  specular, clearcoat, sheen and anisotropy maps.
* glTF material extensions: `KHR_materials_unlit`, `_ior`, `_specular`,
  `_clearcoat`, `_sheen`, `_anisotropy`, `_emissive_strength`,
  `_variants`, and per-slot `KHR_texture_transform` on eight UV sets.
* Lights: one primary directional, up to eight extra directional/point/spot
  lights, physical inverse-square variants, ambient + hemispherical fill,
  fog and background colour.
* Shadows: directional, one point and one spot light, 256/512/1024 maps,
  hard or 3×3/5×5 PCF.
* Image-based lighting: equirectangular environment maps (linear or
  Radiance RGBE HDR) with GGX-prefiltered reflections and a split-sum BRDF
  LUT, per-material environment intensity, environment rotation.

### Post-processing and output

* Render targets (sampleable textures, up to 4 Mpx), a fixed eight-pass
  post-process queue, built-in copy/grayscale/invert/FXAA passes, and
  custom GLSL ES 3.00 fragment passes on WebGL.
* Tone mapping (none/Reinhard/ACES), exposure (0–32), opt-in sRGB output
  encoding, FXAA.

### Geometry, textures and deformation

* Mesh arena with primitives (`mesh_cube`, `mesh_sphere`, `mesh_plane`),
  custom vertex pushes with up to eight UV sets and tangents, checked
  handles, removal and `mesh_compact()`.
* Textures: RGBA8, sRGB, linear RGBA32F HDR, RGBA16F, 3D textures;
  nearest/linear/mipmap filtering, clamp/repeat/mirror wrap; native
  Radiance RGBE loading.
* Morph targets and skeletal skinning — GPU joint palettes and morph
  textures on WebGL, CPU deformation on the reference backend, CPU geometry
  retained for picking.

### Scene, assets and interaction

* Node arena with parent hierarchy, TRS + matrix transforms, visibility,
  per-node colour/specular/unlit, checked handles, node removal with
  child reparenting, `scene_clear()`.
* glTF 2.0 loading in the browser (`.gltf`/`.glb`): scenes, cameras,
  `KHR_lights_punctual`, quantization, GPU instancing, sparse accessors,
  morph and skeletal animation (LINEAR/STEP/CUBICSPLINE), material
  variants. A native loader covers the static subset plus PPM/PNG/JPEG
  decode with queryable errors.
* Raycast picking (`pick_screen`, `raycast`), swept segment/sphere
  collision tests, AABB physics bodies (gravity, forces, restitution,
  friction, substeps).
* Input: 512-key state with edge detection, mouse deltas; typed orbit,
  pan and pinch controls as a package subpath.

### Platform and developer experience

* Written entirely in Goose (no heap, no GC); C only behind the ABI, with
  `_Static_assert`s pinning every packed struct's size and offsets.
* `gs3d` npm package: browser asset helpers, orbit controls, glTF
  loader/exporter, and a Three.js-compatible facade (`gs3d/three`,
  `gs3d/webgpu`) covering scene graphs, cameras, common geometries and
  materials, lights, textures, raycasting and controls — a documented
  subset, not full Three.js compatibility.
* Runnable examples: landing demo, Beacon Run and Rift Siege games, model
  viewer, instancing benchmark with a Three.js/PixiJS comparison page,
  WebGL reference-check suite.
* Headless verification: 99 math + 333 engine-pixel + game and siege checks
  in `./build_native.sh --test`, zero-warning gate on every root,
  byte-identical determinism check, `G3_PROFILE=1` CPU-backend profiler.

## Other Features

* Browser asset pipeline: fetch/CORS loading, browser image decoding
  (PNG/JPEG/WebP with `EXT_texture_webp` fallback), Radiance `.hdr`
  environments, `AssetError` codes, generation-checked handles.
* glTF cameras become engine cameras (`selectCamera`), glTF punctual lights
  can replace the engine light set (`applyLights`, optional shadow casters).
* Animation playback controls on loaded models: play/pause/seek/stop,
  turntable and bob modes in the viewer.
* Environment lighting controls: intensity, rotation, sky/ground ambient
  fill independent of the equirect map.
* Feedback-safety: sampling the active render target skips that item and
  reports `stats().feedback_items_suppressed` instead of corrupting output.
* Fail-loud boot: first-frame `glGetError` is reported to the page; the HUD
  shows a visible failure rather than a blank canvas.
* Benchmark tooling: `--benchmark` instancing page, `--animation-benchmark`,
  transform microbenchmark, WebGPU timestamp queries where available.
