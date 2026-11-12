# Toward a Three.js alternative

Goose 3D has the foundation of a small 3D renderer, but it does not yet cover
the range of applications and assets supported by [Three.js](https://threejs.org/).
The immediate goal is a useful subset: load a real model, render its supported
materials correctly, and let a user interact with it. This roadmap describes
capabilities to build, not a promise of API or visual compatibility with Three.js.

The engine already provides a scene hierarchy, transforms, a perspective
camera, primitive and custom meshes, basic lighting, RGB textures, transparency,
frustum culling, WebGL2 rendering, and a headless CPU renderer. The CPU backend
and pixel tests provide a useful reference for rendering changes.

## Gaps

| Area | Goose 3D today | Missing capabilities |
|---|---|---|
| Assets | Built-in primitives, custom geometry, and a browser loader for static glTF/GLB | Complete glTF coverage, native loading, reusable asset ownership and arena reclamation; see [assets.md](assets.md) |
| Materials | Colour, one RGB texture, specular controls | Reusable materials, physically based rendering (PBR), normal, roughness and metallic maps, texture alpha, mipmaps and wrapping |
| Lighting | Directional, point and spot lights; a primary directional shadow map; ambient, hemispherical and equirectangular diffuse fill | More shadow types and prefiltered image-based environment lighting |
| Animation | Manual per-frame transforms | Keyframes, skeletal animation, skinning, morph targets |
| Scene management | Parent hierarchy and one camera | Object and resource removal, reusable resources, multiple cameras, orthographic camera rendering |
| Interaction | Keyboard and mouse input | Raycasting and picking, touch controls, reusable camera controls |
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
* Add object and resource removal with well-defined ownership and reusable
  handles, so repeated model load/dispose cycles do not grow memory indefinitely.
* Implement texture alpha, mipmaps, wrapping, and colour-space handling; expand
  the glTF loader's material and sampler support.
* Add orbit controls and raycasting against loaded meshes, and expose a minimal
  browser API for loading, inspecting, selecting, and disposing a model.

**Done when:** a documented example loads a static textured GLB, orbits it,
selects a mesh with a click, and repeatedly loads and disposes models without
unbounded memory growth. Tests cover malformed files and a real browser render.

### 2. Materials and lighting

* Introduce reusable materials and a metallic-roughness PBR shading model,
  including the corresponding glTF factors and texture maps.
* Improve shadow quality and coverage, add point/spot shadows and prefiltered
  image-based environment lighting. The existing primary directional shadow
  map and hemispherical fill remain available; specify light and map limits.
* Define texture colour spaces, tone mapping, and output encoding so model
  colours are reproducible across the CPU and WebGL paths.

**Done when:** representative glTF materials and a shadow-casting scene render
with documented limitations in both backends, with pixel tests for lighting and
shadow behavior and browser reference images for the GPU path.

### 3. Animated assets and richer scenes

* Add keyframe playback, skeletal animation and skinning; follow with morph
  targets. Extend glTF loading to populate those features.
* Support multiple and orthographic cameras, reusable camera controls, and
  touch input.

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
