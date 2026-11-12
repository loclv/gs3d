# Toward a Three.js alternative

Goose 3D has the foundation of a small 3D renderer, but it does not yet cover
the range of applications and assets supported by [Three.js](https://threejs.org/).
The immediate goal should be a useful subset: load a real model, render it
correctly, and let a user interact with it.

The engine already provides a scene hierarchy, transforms, a perspective
camera, primitive and custom meshes, basic lighting, RGB textures, transparency,
frustum culling, WebGL2 rendering, and a headless CPU renderer. The CPU backend
and pixel tests provide a useful reference for rendering changes.

## Gaps

| Area | Goose 3D today | Missing capabilities |
|---|---|---|
| Assets | Built-in primitives, custom geometry, and a browser loader for static glTF/GLB | Complete glTF coverage, native loading, reusable asset ownership and arena reclamation; see [assets.md](assets.md) |
| Materials | Colour, one RGB texture, specular controls | Reusable materials, physically based rendering (PBR), normal, roughness and metallic maps, texture alpha, mipmaps and wrapping |
| Lighting | Directional, point and spot lights, ambient and hemispherical environment fill | Shadows and image-based environment lighting |
| Animation | Manual per-frame transforms | Keyframes, skeletal animation, skinning, morph targets |
| Scene management | Parent hierarchy and one camera | Object and resource removal, reusable resources, multiple cameras, orthographic camera rendering |
| Interaction | Keyboard and mouse input | Raycasting and picking, touch controls, reusable camera controls |
| Rendering | WebGL2, one draw call per visible node | Instancing, render targets, post-processing, custom shaders, robust clipping and colour management |
| Developer experience | Goose API and a custom browser host | JavaScript/TypeScript integration, package distribution, examples, documentation and automated browser rendering tests |

Three.js's [fundamentals](https://threejs.org/manual/pages/fundamentals.html),
[glTF loader](https://threejs.org/docs/pages/GLTFLoader.html), and
[post-processing guide](https://threejs.org/manual/pages/how-to-use-post-processing.html)
illustrate the range of capabilities its users can draw on.

## Proposed order

1. **Rendering and resource foundations.** Fix clipping and normals under
   non-uniform scale. Support removing nodes and releasing meshes and textures.
   Add texture alpha, mipmaps, and configurable wrapping.
2. **Expand glTF/GLB loading.** The browser loader supports a static subset;
   add missing material and sampler features, broader asset compatibility, and
   native loading to make more assets from Blender and other tools usable.
3. **Materials and lighting.** Add reusable materials, PBR, multiple lights,
   and shadows.
4. **Interaction and animation.** Add raycasting and camera controls, then
   keyframes and skeletal animation.
5. **Scale and usability.** Add instancing, render targets, packaging, and
   automated browser rendering tests. Provide a documented JavaScript API if
   browser developers are a target audience.

A practical first milestone is to **load a static GLB, display its textured
materials, orbit the camera, and click a mesh to select it**. This exercises a
common Three.js workflow without requiring complete feature parity.

Physics, audio, and a full game editor can follow if needed. They are useful
for games, but are not prerequisites for a 3D rendering library.
