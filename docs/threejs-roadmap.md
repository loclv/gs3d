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
| Assets | Built-in primitives, custom geometry, and a browser loader for static glTF/GLB with reusable asset-owned slots | Complete glTF coverage, native loading, general resource ownership and fragmentation control; see [assets.md](assets.md) |
| Materials | Shared glTF materials with metallic-roughness, tangent-space normal, occlusion and emissive maps, GGX-prefiltered equirectangular reflections, a split-sum BRDF LUT, and ACES tone mapping with exposure | Browser reference validation, native HDR image decoding |
| Lighting | Directional, point and spot lights; primary directional shadows, one selected point shadow, and one selected spot shadow with configurable 256/512/1024 maps and hard, 3×3 or 5×5 PCF; ambient, hemispherical and RGB or HDR equirectangular fill | Native HDR environment decoding |
| Animation | Manual per-frame transforms | Keyframes, skeletal animation, skinning, morph targets |
| Scene management | Parent hierarchy, checked node removal, and selectable perspective or orthographic cameras | General mesh and texture removal, reusable resources, camera lifecycle |
| Interaction | Keyboard and mouse input, triangle raycasting, reusable browser orbit and pinch controls, viewer selection | Additional touch gestures, panning, keyboard camera controls, browser integration tests |
| Rendering | WebGL2, view-volume clipping, one draw call per visible node | Instancing, render targets, post-processing, custom shaders and colour management |
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

### 1. Reliable static model viewer

* **Implemented:** view-volume clipping and inverse-transpose normals for
  non-uniform scale. Continue expanding CPU and browser rendering checks.
* **Partly implemented:** asset-owned slots are reused, adjacent free mesh
  spans are split and coalesced, browser asset handles check generation, and
  node handles also check scene epoch. Ordinary nodes can be removed with checked
  handles. Extend removal to general meshes and textures; handle fragmentation between live meshes so varied
  load/dispose cycles remain bounded.
* **Implemented:** texture alpha, wrapping, filtering, and opt-in sRGB output,
  including glTF base-colour decoding and per-texture sampler settings. Expand
  the glTF loader's material and sampler support.
* **Implemented:** triangle picking and an example viewer with reusable orbit
  and pinch controls, selection, and reload. Expand the browser API for model
  inspection and validate those paths in a real browser.

**Done when:** a documented example loads a static textured GLB, orbits it,
selects a mesh with a click, and repeatedly loads and disposes models without
unbounded memory growth. Tests cover malformed files and a real browser render.

### 2. Materials and lighting

* **Implemented:** shared materials, metallic-roughness, normal, occlusion and
  emissive maps, with per-triangle tangent frames derived from positions and UVs.
  Equirectangular maps add diffuse fill, GGX importance-sampled specular mips,
  and a split-sum BRDF integration LUT. ACES tone mapping, exposure controls,
  and browser Radiance HDR environment loading are implemented; validate
  browser references and add native HDR image decoding.
* **Implemented:** shadows from the primary directional light, one
  selected extra point light, and one selected spot light. Point shadows use a
  six-face cube map; spot shadows use a perspective map. Both backends use
  256, 512, or 1024-pixel maps, opaque and masked casters, and optional 3×3 or
  5×5 PCF. Equirectangular maps provide diffuse fill and GGX-prefiltered
  reflections; browser Radiance RGBE images retain HDR radiance, while native
  image decoding remains unsupported.
* **Implemented:** ACES tone mapping with exposure controls and browser Radiance
  HDR environment image loading. The CPU backend composites in floating point;
  WebGL uses a floating-point render target when supported and has an inline
  fallback. Verify colour output against browser reference images.

**Done when:** representative glTF materials and a shadow-casting scene render
with documented limitations in both backends, with pixel tests for lighting and
shadow behavior and browser reference images for the GPU path.

### 3. Animated assets and richer scenes

* Add keyframe playback, skeletal animation and skinning; follow with morph
  targets. Extend glTF loading to populate those features.
* Expand camera controls and touch input. Selectable perspective and orthographic
  cameras and reusable orbit and pinch controls are available; validate both
  features in a real browser and add camera removal.

**Done when:** an imported animated character plays, pauses, and switches
clips, and a scene can switch between perspective and orthographic cameras.
Tests cover animation interpolation, skinning, and camera projection.

### 4. Larger scenes and integration

* Add instancing and measure scene-update, culling, and draw-call costs on
  representative scenes before selecting further optimisations.
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
