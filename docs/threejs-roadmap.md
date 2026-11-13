# Toward a Three.js alternative

Goose 3D has the foundation of a small 3D renderer, but it does not yet cover
the range of applications and assets supported by [Three.js](https://threejs.org/).
The immediate goal is a useful subset: load a real model, render its supported
materials correctly, and let a user interact with it. This roadmap describes
capabilities to build, not a promise of API or visual compatibility with Three.js.

The engine already provides a scene hierarchy, transforms, perspective and
orthographic cameras, primitive and custom meshes, multiple light types,
shadows, RGB and HDR textures, transparency, frustum culling, WebGL2 rendering,
and a headless CPU renderer. The CPU backend and pixel tests provide a useful
reference for rendering changes.

## Gaps

| Area | Goose 3D today | Missing capabilities |
|---|---|---|
| Assets | Built-in primitives, custom geometry, a browser glTF/GLB loader, and a native static GLB primitive loader; the browser path supports shared static primitive uploads, `EXT_mesh_gpu_instancing`, selectable scenes and cameras, opt-in `KHR_lights_punctual`, WebP fallback, quantized geometry, vertex colours, materials, animations, dense and sparse accessors, and reusable asset-owned slots | Native full-scene, material, and image loading; broader glTF extension coverage, general resource ownership and fragmentation control; see [assets.md](assets.md) |
| Materials | Shared glTF materials with `COLOR_0`, metallic-roughness, tangent-space normal, occlusion, emissive, specular, clearcoat, sheen and anisotropy maps, authored and morphed tangents, eight texture-coordinate sets, double-sided rendering, selectable `KHR_materials_variants`, per-material environment intensity, rotatable equirectangular environment maps, `KHR_materials_unlit`, `KHR_materials_ior`, `KHR_materials_clearcoat`, `KHR_materials_specular`, `KHR_materials_sheen`, `KHR_materials_anisotropy`, `KHR_materials_emissive_strength`, per-texture `KHR_texture_transform` on `TEXCOORD_0` through `_7`, GGX-prefiltered equirectangular reflections, a split-sum BRDF LUT, and Reinhard/ACES tone mapping with exposure | Browser shader validation and reference images |
| Lighting | Directional, point and spot lights; primary directional shadows, one selected point shadow, and one selected spot shadow with configurable 256/512/1024 maps and hard, 3×3 or 5×5 PCF; ambient, browser-controllable hemispherical fill, and rotatable RGB or HDR equirectangular fill | Browser reference validation |
| Animation | glTF transform, morph-weight and skeletal clips with LINEAR/STEP/CUBICSPLINE sampling; WebGL joint-palette skinning and POSITION/NORMAL/TANGENT morph textures, including combined skin+morph meshes; CPU geometry retained for picking | Browser rendering validation and representative deformation measurements; GPU morph targets fall back to CPU above 64 targets or device texture limits |
| Scene management | Parent hierarchy, checked node, ordinary mesh and ordinary texture removal with reusable geometry spans; asset-owned mesh descriptor reuse; explicit live-geometry compaction; selectable perspective or orthographic cameras with stable removable IDs | Shrinking grow-only backing arrays; ordinary mesh IDs remain permanent for compatibility |
| Interaction | Keyboard and mouse input, triangle raycasting, reusable browser orbit, pan, pinch and keyboard camera controls, viewer selection; package subpath with TypeScript declarations and fake-canvas interaction tests | Browser integration tests |
| Rendering | WebGL2, view-volume clipping, adjacent compatible opaque items batched with GPU instancing, instanced shadow casters, FXAA-style full-screen post-processing, basic user render targets, built-in post-processing, bounded fragment shader extension | Browser shader validation; CPU reference renderer still processes draw items individually |
| Developer experience | Goose API, custom browser host, typed browser asset and orbit-control helpers with package subpaths, and a package manifest | Publish the package, examples, and automated browser rendering tests |

Three.js's [fundamentals](https://threejs.org/manual/pages/fundamentals.html),
[glTF loader](https://threejs.org/docs/pages/GLTFLoader.html), and
[post-processing guide](https://threejs.org/manual/pages/how-to-use-post-processing.html)
illustrate the range of capabilities its users can draw on.

## Milestones

The order reflects dependencies: resource ownership and rendering correctness
make model loading reliable; materials and light transport build on those
foundations. Each milestone should include automated checks on the CPU backend
and a browser integration check for behavior exposed through WebGL.

### 1. Reliable model viewer

* **Implemented:** view-volume clipping and inverse-transpose normals for
  non-uniform scale. Continue expanding CPU and browser rendering checks.
* **Partly implemented:** asset-owned slots are reused, adjacent free mesh
  spans are split and coalesced, ordinary mesh creation reuses released spans,
  checked ordinary mesh removal releases backend geometry, ordinary textures
  can be removed when no live node, material or environment references them,
  and browser asset handles check generation. Node handles also check scene
  epoch, and ordinary nodes can be removed with checked handles. Explicit
  compaction packs and reuploads live geometry. Repeated asset load/dispose
  cycles reuse mesh descriptors and keep geometry arena lengths bounded. Ordinary
  mesh IDs stay permanent, and Goose growable arrays cannot shrink, so explicit
  compaction reuses the packed tail without returning backing storage. Revisit
  physical reclamation only with an API and runtime design that preserves handle
  safety and stable ordinary IDs.
* **Implemented:** texture alpha, wrapping, filtering, and opt-in sRGB output,
  including glTF base-colour decoding and per-texture sampler settings. The
  supported material maps and extensions are listed below; broader glTF
  extension support remains future work.
* **Implemented:** dense and sparse accessors, including zero-initialized
  sparse-only data and validated sparse indices, ranges, component alignment,
  vertex-only byte strides and normalized flags. Continue expanding validation
  for the rest of the glTF specification.
* **Implemented:** node matrices and TRS transforms, texture transforms, camera
  projection values, default morph weights, and unbounded material scalars are
  checked against the engine's finite float32 range before they cross the
  JavaScript-to-Wasm boundary. Derived camera planes and orthographic view height
  are checked too; animation results are checked when sampled.
* **Implemented:** `KHR_mesh_quantization` decodes quantized base and morph
  position, normal, tangent and texture-coordinate accessors into engine floats.
  Quantized assets must declare the extension as required.
* **Implemented:** the browser loader selects the glTF default scene or an
  explicit scene index. When `scenes` is omitted, it builds an implicit scene
  from unparented nodes and reports scene index `-1`; invalid selections and
  cyclic implicit hierarchies fail before engine resource creation.
* **Implemented:** `EXT_texture_webp` loads its WebP source when decodable and
  falls back to the core source when fetching or decoding WebP fails.
* **Partly implemented:** native Goose programs can load and dispose one static
  primitive from a GLB, including float vertex attributes, triangle indices,
  the first matching node's world transform composed through its ancestors,
  scalar material factors and flags, plus declared `KHR_materials_unlit`,
  `KHR_materials_emissive_strength`, and `KHR_materials_ior`.
  Material textures, images, full node hierarchy, animations, sparse data, and
  external `.gltf` buffers remain browser-only.
* **Implemented:** glTF `doubleSided` materials disable face culling in colour
  and shadow passes and reverse back-face normals before colour lighting.
  Validate these paths against browser reference images.
* **Implemented:** `KHR_materials_unlit` maps to the engine's unlit material
  path; unsupported required extensions are rejected with an asset error.
* **Implemented:** `KHR_materials_emissive_strength` scales emissive factors,
  including values above 1 for HDR emission.
* **Implemented:** `KHR_materials_ior` sets dielectric Fresnel reflectance for
  direct and environment lighting; glTF's default IOR of 1.5 preserves the
  existing dielectric response.
* **Implemented:** `KHR_materials_specular` scales and tints dielectric
  reflections with factors and optional strength/colour maps in both backends;
  metallic specular response remains driven by base colour.
* **Implemented:** `KHR_materials_clearcoat` factors, R/G strength and
  roughness maps, and a tangent-space normal map layer direct and environment
  specular highlights and Fresnel-attenuate the base layer in both backends.
* **Implemented:** `KHR_materials_sheen` colour and roughness factors/maps use
  independent texture transforms and add a Charlie-style grazing response to
  direct lighting and a roughness-blurred reflection from environment maps in
  both backends.
* **Implemented:** `KHR_materials_anisotropy` validates and loads the strength,
  rotation, and optional linear RG direction/B strength map with its UV
  transform. Both backends apply anisotropic GGX to direct lights; environment
  reflections use the bent-normal single-sample approximation. Browser reference
  validation remains outstanding.
* **Implemented:** `KHR_materials_variants` loads each referenced material,
  switches mapped primitives by variant name or index, and restores the
  original materials when passed `null`.
* **Implemented:** glTF `COLOR_0` multiplies material base colour on both
  backends; `VEC3` and `VEC4` float or normalized unsigned-byte/unsigned-short
  attributes are supported, and vertex alpha participates in mask and blend
  alpha.
* **Implemented:** `KHR_texture_transform` applies independent offset,
  rotation, scale and coordinate-set selection to each texture slot on
  `TEXCOORD_0` through `_7` in the browser loader and both rendering backends.
* **Implemented:** glTF meshes use authored `TANGENT` frames for normal maps;
  skinning and tangent morph deltas deform tangent directions alongside
  positions and normals. Meshes without authored tangents use the derivative
  frame. Validate browser references.
* **Partly implemented:** triangle picking and an example viewer with reusable
  orbit, pan and pinch controls, selection, and reload. The browser model API
  exposes the selected glTF node hierarchy, mesh/skin references, and checked
  primitive handles plus default and variant material summaries; material
  summaries expose texture bindings and a bounded preview API, and the viewer
  displays maps for the selected material and variant. Its material selector
  controls per-material environment intensity, hemisphere fill intensity, and
  HDR equirectangular environment yaw. Validate those paths in a real browser.

**Done when:** a documented example loads a static textured GLB, orbits it,
selects a mesh with a click, and repeatedly loads and disposes models without
unbounded memory growth. Tests cover malformed files and a real browser render.

### 2. Materials and lighting

* **Implemented:** shared materials, metallic-roughness, normal, occlusion,
  emissive, specular, clearcoat, and sheen maps. Static and skinned non-morphed
  meshes use authored glTF
  tangents when provided; morphed geometry without tangents uses a UV-derived
  frame.
  Equirectangular maps add diffuse fill, GGX importance-sampled specular mips,
  a split-sum BRDF integration LUT, and a radians-based world-up yaw control
  shared by CPU and WebGL sampling. Reinhard and ACES tone mapping, exposure
  controls, and browser/native Radiance HDR environment loading are implemented.
* **Implemented:** shadows from the primary directional light, one
  selected extra point light, and one selected spot light. Point shadows use a
  six-face cube map; spot shadows use a perspective map. Both backends use
  256, 512, or 1024-pixel maps, opaque and masked casters, and optional 3×3 or
  5×5 PCF. Equirectangular maps provide diffuse fill and GGX-prefiltered
  reflections; browser and native Radiance RGBE loading retain HDR radiance.
  CPU pixel regressions now verify that point and spot casters darken their
  projected ground footprints while nearby illuminated samples remain lit.
* **Implemented:** browser Radiance HDR environment image loading. The CPU
  backend composites in floating point; WebGL uses a floating-point render
  target when supported and has an inline fallback. Verify colour output
  against browser reference images.
* **Implemented:** browser applications can set linear sky and ground RGB
  hemisphere colours and intensity independently from the equirectangular map.
  Inputs are checked for finite non-negative float32 values; verify the visual
  result against browser reference images.

**Done when:** representative glTF materials and a shadow-casting scene render
with documented limitations in both backends, with pixel tests for lighting and
shadow behavior and browser reference images for the GPU path.

### 3. Animated assets and richer scenes

* **Partly implemented:** glTF translation, rotation, scale, morph-weight and
  skeletal clips support LINEAR, STEP and CUBICSPLINE sampling with play, pause,
  seek, stop and loop controls. WebGL skin palettes and POSITION/NORMAL/TANGENT morph
  textures avoid pose-driven vertex-buffer uploads, including combined
  skin+morph meshes when both GPU uploads succeed. Retained CPU geometry stays
  synchronized for picking; unsupported target counts or failed uploads use
  CPU deformation. A local browser benchmark now measures `model.update()` and
  engine frame times separately on 32 instances of a 64-target, 2,048-vertex
  GLB, sharing one mesh and morph upload. Validate
  animated WebGL output and record measurements on
  representative characters and devices.
* **Partly implemented:** selectable perspective and orthographic cameras have
  stable IDs, active-camera fallback, and removal. The browser glTF loader
  imports perspective and orthographic cameras, applies node and animated
  parent transforms and authored aspect framing, and restores the previous view
  when a model camera is deselected or disposed. Reusable orbit, pinch, pan and
  keyboard controls are available; validate camera switching and input in a
  real browser.
* **Partly implemented:** the browser loader reads `KHR_lights_punctual` and
  can apply eight scene lights with nested, out-of-order-safe restoration and
  animated node transforms. Imported point and spot lights use inverse-square
  attenuation and omit the lighting cutoff when `range` is absent. Shadows
  remain opt-in through `model.applyLights({ pointShadow, spotShadow, bias })`;
  unbounded lights use a 1000-unit shadow projection far plane when selected.

**Done when:** an imported animated character plays, pauses, and switches
clips, and a scene can switch between perspective and orthographic cameras.
Tests cover animation interpolation, skinning, and camera projection.

### 4. Larger scenes and integration

* **Partly implemented:** the WebGL backend batches adjacent opaque items when
  mesh and complete material state match, and uses the same instance matrices
  for directional, point and spot shadow passes. Blended items retain their
  sorted order and draw individually. The CPU backend remains the reference
  path and does not instance. The viewer reports actual WebGL scene-pass draw
  calls. `EXT_mesh_gpu_instancing` creates transformed engine nodes over shared
  static mesh geometry, and ordinary repeated glTF nodes reuse that geometry.
  Instances of one morphing node also share one CPU/GPU mesh upload because
  they use the same morph weights; separate nodes retain separate deformed
  meshes for independent animation. The current loader supports up to 65,536
  unskinned instances per node. A
  repeated-mesh benchmark page reports draw calls, browser frame rate,
  and engine-call median and p95; capture results across representative browser
  and GPU configurations before selecting further optimisations.
* **Implemented:** optional FXAA-style luma edge smoothing runs as a full-screen
  WebGL output pass and in the CPU reference renderer.
* **Partly implemented:** user render targets have explicit creation, selection, resizing, checked handles, and disposal; the texture can be sampled by later frames. Both backends render linear RGBA8 clamped to 0..1 with opaque alpha, use target dimensions for camera projection, and bypass screen tone mapping, sRGB encoding, and FXAA. Resizing clears target contents. Sampling the active target is suppressed to avoid framebuffer feedback, and `Stats.feedback_items_suppressed` plus the browser HUD report how many draw items were skipped. Validate target rendering in a browser.
* **Partly implemented:** `post_process_run(source, destination, effect)` provides copy, grayscale, invert, and FXAA passes over explicit texture inputs and render-target outputs; the fixed eight-entry queue executes built-in or custom passes in order. Add browser shader validation before expanding the shader interface. Keep the existing FXAA convenience switch as a built-in pass.
* **Partly implemented:** WebGL2 supports a bounded fragment-body post-process with one source texture, UVs, and a colour value; shader creation, execution, and disposal are explicit, with fixed input/output resources and no custom vertex stage or uniforms. The CPU backend returns unsupported. Validate shader compile diagnostics in a browser and define a pass-list integration before expanding uniforms or stages.
* **Partly implemented:** the browser asset package documents loading, ownership,
  and errors. `npm test` runs parser and lifecycle checks against a fake engine,
  plus orbit-control input checks against a fake canvas through the published
  package subpath; the repository-only `test_build_exports.mjs` check verifies
  that the WebAssembly build exports the host functions the helpers call.
  Publish the package, add more runnable examples, and add continuous browser
  rendering tests. Add native asset loading when native interactive
  applications are a target.

**Done when:** a documented benchmark demonstrates instancing and resource
reuse, and published examples build and run through the supported API.

## Validation principles

* Preserve existing behavior unless a change is intentional and documented.
* Test new math and asset validation with known inputs, and rendering with
  hand-derived pixel checks. Run browser tests for actual shader compilation,
  texture uploads, and interaction; a successful WebAssembly build alone does
  not verify them.
* For render targets, test target dimensions and resize, rendering a known colour
  into a target, sampling that target on a later draw, target disposal, and
  rejection of invalid or feedback-loop use. Compare linear/display conversion
  and alpha behavior between the CPU reference and WebGL. A target must not
  inherit screen-only tone mapping or FXAA unless the caller explicitly runs
  those as passes.
* For post-processing, test pass order and input/output selection with small
  hand-derived images. A failed or unsupported pass should produce a readable
  error and leave the default render path usable.
* State backend differences, supported glTF features, and limits explicitly;
  update [assets.md](assets.md), the ABI documentation, and examples as APIs
  evolve.

Physics, audio, and a full game editor can follow if needed. They are useful
for games, but are not prerequisites for a 3D rendering library.
