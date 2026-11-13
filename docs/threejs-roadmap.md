# Toward a Three.js alternative

Goose 3D has the foundation of a small 3D renderer, but it does not yet cover
the range of applications and assets supported by [Three.js](https://threejs.org/).
The immediate goal is a useful subset: load a real model, render its supported
materials correctly, and let a user interact with it. This roadmap describes
capabilities to build, not a promise of API or visual compatibility with Three.js.

The engine already provides a scene hierarchy, transforms, a perspective
cameras, primitive and custom meshes, basic lighting, RGB textures, transparency,
frustum culling, WebGL2 rendering, and a headless CPU renderer. The CPU backend
and pixel tests provide a useful reference for rendering changes.

## Gaps

| Area | Goose 3D today | Missing capabilities |
|---|---|---|
| Assets | Built-in primitives, custom geometry, and a browser loader for glTF/GLB meshes, materials, transform animations, dense and sparse accessors, with reusable asset-owned slots | Remaining glTF coverage, native loading, general resource ownership and fragmentation control; see [assets.md](assets.md) |
| Materials | Shared glTF materials with metallic-roughness, tangent-space normal, occlusion and emissive maps, static authored tangents, double-sided rendering, `KHR_materials_unlit`, `KHR_materials_ior`, `KHR_materials_emissive_strength`, per-texture `KHR_texture_transform` on `TEXCOORD_0` and `_1`, GGX-prefiltered equirectangular reflections, a split-sum BRDF LUT, and ACES tone mapping with exposure | Browser reference validation |
| Lighting | Directional, point and spot lights; primary directional shadows, one selected point shadow, and one selected spot shadow with configurable 256/512/1024 maps and hard, 3×3 or 5×5 PCF; ambient, hemispherical and RGB or HDR equirectangular fill | Browser reference validation |
| Animation | glTF transform, morph-weight and skeletal clips with LINEAR/STEP/CUBICSPLINE sampling; WebGL joint-palette skinning and POSITION/NORMAL morph textures, including combined skin+morph meshes; CPU geometry retained for picking | Browser rendering validation and deformation benchmarks; GPU morph targets fall back to CPU above 64 targets or device texture limits |
| Scene management | Parent hierarchy, checked node, ordinary mesh and ordinary texture removal with reusable geometry spans; explicit live-geometry compaction; selectable perspective or orthographic cameras with stable removable IDs | Mesh descriptor reclamation and shrinking arena backing arrays |
| Interaction | Keyboard and mouse input, triangle raycasting, reusable browser orbit, pan, pinch and keyboard camera controls, viewer selection | Browser integration tests |
| Rendering | WebGL2, view-volume clipping, adjacent compatible opaque items batched with GPU instancing, instanced shadow casters | Render targets, post-processing, custom shaders and colour management; CPU reference renderer still processes draw items individually |
| Developer experience | Goose API and a custom browser host | JavaScript/TypeScript integration, package distribution, examples, documentation and automated browser rendering tests |

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
  compaction packs and reuploads live geometry. Reclaim mesh descriptor records
  and shrink backing arrays so varied load/dispose cycles remain bounded in memory.
* **Implemented:** texture alpha, wrapping, filtering, and opt-in sRGB output,
  including glTF base-colour decoding and per-texture sampler settings. Expand
  the glTF loader's material and sampler support.
* **Implemented:** dense and sparse accessors, including zero-initialized
  sparse-only data and validated sparse indices and ranges. Continue expanding
  validation for the rest of the glTF specification.
* **Implemented:** glTF `doubleSided` materials disable face culling in colour
  and shadow passes and reverse back-face normals before colour lighting.
  Continue filling the remaining supported-material gaps.
* **Implemented:** `KHR_materials_unlit` maps to the engine's unlit material
  path; unsupported required extensions are rejected with an asset error.
* **Implemented:** `KHR_materials_emissive_strength` scales emissive factors,
  including values above 1 for HDR emission.
* **Implemented:** `KHR_materials_ior` sets dielectric Fresnel reflectance for
  direct and environment lighting; glTF's default IOR of 1.5 preserves the
  existing dielectric response.
* **Partly implemented:** `KHR_texture_transform` applies independent offset,
  rotation, scale and coordinate-set selection to each texture slot on
  `TEXCOORD_0` or `_1`; higher sets remain unsupported.
* **Implemented:** static, non-skinned, non-morphed glTF meshes use authored
  `TANGENT` frames for normal maps; other meshes keep the derivative fallback.
  Add tangent deformation for animated assets and validate browser references.
* **Implemented:** triangle picking and an example viewer with reusable orbit,
  pan and pinch controls, selection, and reload. Expand the browser API for model
  inspection and validate those paths in a real browser.

**Done when:** a documented example loads a static textured GLB, orbits it,
selects a mesh with a click, and repeatedly loads and disposes models without
unbounded memory growth. Tests cover malformed files and a real browser render.

### 2. Materials and lighting

* **Implemented:** shared materials, metallic-roughness, normal, occlusion and
  emissive maps. Static meshes use authored glTF tangents when provided;
  skinned or morphed geometry and missing tangents use a UV-derived frame.
  Equirectangular maps add diffuse fill, GGX importance-sampled specular mips,
  and a split-sum BRDF integration LUT. ACES tone mapping, exposure controls,
  and browser/native Radiance HDR environment loading are implemented; validate
  browser references.
* **Implemented:** shadows from the primary directional light, one
  selected extra point light, and one selected spot light. Point shadows use a
  six-face cube map; spot shadows use a perspective map. Both backends use
  256, 512, or 1024-pixel maps, opaque and masked casters, and optional 3×3 or
  5×5 PCF. Equirectangular maps provide diffuse fill and GGX-prefiltered
  reflections; browser and native Radiance RGBE loading retain HDR radiance.
* **Implemented:** ACES tone mapping with exposure controls and browser Radiance
  HDR environment image loading. The CPU backend composites in floating point;
  WebGL uses a floating-point render target when supported and has an inline
  fallback. Verify colour output against browser reference images.

**Done when:** representative glTF materials and a shadow-casting scene render
with documented limitations in both backends, with pixel tests for lighting and
shadow behavior and browser reference images for the GPU path.

### 3. Animated assets and richer scenes

* **Partly implemented:** glTF translation, rotation, scale, morph-weight and
  skeletal clips support LINEAR, STEP and CUBICSPLINE sampling with play, pause,
  seek, stop and loop controls. WebGL skin palettes and POSITION/NORMAL morph
  textures avoid pose-driven vertex-buffer uploads, including combined
  skin+morph meshes when both GPU uploads succeed. Retained CPU geometry stays
  synchronized for picking; unsupported target counts or failed uploads use
  CPU deformation. Validate animated WebGL output and benchmark pose updates on
  representative characters.
* **Partly implemented:** selectable perspective and orthographic cameras have
  stable IDs, active-camera fallback, and removal. Reusable orbit, pinch, pan
  and keyboard controls are available; validate camera switching and input in
  a real browser.

**Done when:** an imported animated character plays, pauses, and switches
clips, and a scene can switch between perspective and orthographic cameras.
Tests cover animation interpolation, skinning, and camera projection.

### 4. Larger scenes and integration

* **Partly implemented:** the WebGL backend batches adjacent opaque items when
  mesh and complete material state match, and uses the same instance matrices
  for directional, point and spot shadow passes. Blended items retain their
  sorted order and draw individually. The CPU backend remains the reference
  path and does not instance. The viewer reports actual WebGL scene-pass draw
  calls. A repeated-mesh benchmark page reports draw calls, browser frame rate,
  and engine-call median and p95; capture results across representative browser
  and GPU configurations before selecting further optimisations.
* Add render targets, post-processing, and a supported custom-shader interface.
* Package and document the browser API, including lifecycle and errors; add
  examples and continuous browser tests. Add native asset loading when native
  interactive applications are a target.

**Done when:** a documented benchmark demonstrates instancing and resource
reuse, and published examples build and run through the supported API.

## Validation principles

* Preserve existing behavior unless a change is intentional and documented.
* Test new math and asset validation with known inputs, and rendering with
  hand-derived pixel checks. Run browser tests for actual shader compilation,
  texture uploads, and interaction; a successful WebAssembly build alone does
  not verify them.
* State backend differences, supported glTF features, and limits explicitly;
  update [assets.md](assets.md), the ABI documentation, and examples as APIs
  evolve.

Physics, audio, and a full game editor can follow if needed. They are useful
for games, but are not prerequisites for a 3D rendering library.
