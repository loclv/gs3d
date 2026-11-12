# Browser assets

`web/assets.js` loads a limited static glTF 2.0 subset into either browser
build after `g3_host_start` has succeeded. It uses browser fetch and image
decoding; it is not a native Goose or CPU-backend loader.

```js
import { loadGLTF, loadImage, pickNode, AssetError } from './assets.js';

try {
  const model = await loadGLTF(engine, './model.glb');
  // model.roots contains the engine node handles for the loaded scene.
  // model.pick(canvas, event.clientX, event.clientY) returns a node or null.
  // pickNode(engine, canvas, clientX, clientY) can pick any visible mesh.
  // When no longer needed:
  model.dispose();

  const image = await loadImage(engine, './image.png');
  // image.id is a texture handle; image.width and image.height are pixels.
  // Keep it alive while any node uses it, then call image.dispose().
} catch (error) {
  if (error instanceof AssetError) console.error(error.code, error.message);
  else throw error;
}
```

URLs are resolved relative to the document or, for external glTF resources,
relative to the model URL. Resources require normal browser fetch/CORS access.
The API decodes images into RGBA8 and copies them to the renderer. `dispose()`
is idempotent. A model owns the nodes, meshes, and textures it creates: disposal
releases its GPU buffers and textures and makes its asset-owned node, mesh,
and texture slots available for reuse. Handles and references from the model
are invalid after disposal and must not be shared past that point; a reused
integer can refer to a different object. Disposal after `scene_clear()` will
still release the model's GPU resources without touching nodes in the new scene.

CPU geometry remains available for future picking while a model is live. Freed
mesh spans are reused when both the new vertex and index data fit; repeated
loads of the same model therefore do not keep growing the arenas. Spans are not
split, compacted, or returned to the operating system, however, so changing
asset sizes and allocation order can cause fragmentation and memory grows to a
high-water mark. This is not yet general-purpose resource reclamation.

Picking uses the active perspective camera, the canvas's CSS dimensions,
and retained geometry. It returns the nearest front-facing visible triangle;
an object from another model can occlude the selected model. It is currently
a linear scan of all triangles and does not inspect texture alpha. Model picking
returns null after disposal or a scene reset.

`AssetError.code` is `FETCH`, `IMAGE`, `INVALID_GLTF`, `UNSUPPORTED`, `MEMORY`,
or `UPLOAD`. The loader validates and decodes before creating scene objects;
if an upload fails it releases the resources already created. Browser graphics
driver failures may still be reported separately through the backend's error
mechanism.

## Supported model subset

* `.gltf` JSON and `.glb` version 2, with external, data-URI, or GLB binary
  buffers; images may be external, data-URI, or stored in buffer views.
* The selected scene's hierarchy, matrix or TRS transforms, indexed or
  non-indexed triangle primitives, float positions and normals, and optional
  `TEXCOORD_0`. Positions and normals are required.
* Opaque base-colour factors and base-colour textures. The engine's existing
  lighting approximates these materials; metallic/roughness values are not
  physically rendered. Texture filtering is bilinear and clamp-to-edge, and
  the engine does not yet implement glTF sampler settings or sRGB conversion.

This is **not a complete glTF implementation**. It rejects required extensions,
skins, animations, morph targets, sparse accessors, non-triangle modes, alpha
blending/masking, double-sided materials, and normal, occlusion, emissive, or
metallic-roughness textures. It does not implement material PBR, texture sampler
settings, or advanced extension features. Unsupported optional data may be
ignored. Files needing these features require a fuller loader and renderer.

Run the browser-loader logic tests with `node web/test_assets.mjs`. These use a
mock engine and image decoder; they do not replace a browser/WebGL integration
test.
