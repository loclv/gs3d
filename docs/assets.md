# Browser assets

`web/assets.js` loads a limited static glTF 2.0 subset into either browser
build after `g3_host_start` has succeeded. It uses browser fetch and image
decoding; it is not a native Goose or CPU-backend loader.

```js
import { loadGLTF, loadImage, pickNode, isNodeHandleValid, isMeshHandleValid, isTextureHandleValid, isMaterialHandleValid, setOutputColorSpace, AssetError } from './assets.js';

try {
  setOutputColorSpace(engine, 'srgb'); // after engine startup
  const model = await loadGLTF(engine, './model.glb');
  // model.roots contains checked node handles for the loaded scene.
  // model.pick(canvas, event.clientX, event.clientY) returns a handle or null.
  // pickNode(engine, canvas, clientX, clientY) can pick any visible mesh.
  // isNodeHandleValid(engine, handle) detects disposal or a scene reset.
  // When no longer needed:
  model.dispose();

  const image = await loadImage(engine, './image.png');
  // image.handle is checked; image.id is the low-level texture ID.
  // image.width and image.height are pixels.
  // Keep it alive while any node uses it, then call image.dispose().
} catch (error) {
  if (error instanceof AssetError) console.error(error.code, error.message);
  else throw error;
}
```

URLs are resolved relative to the document or, for external glTF resources,
relative to the model URL. Resources require normal browser fetch/CORS access.

The viewer's input controls can also be used independently of the viewer host:

```js
import { createOrbitControls } from './orbit-controls.js';

const controls = createOrbitControls(canvas, {
  onOrbit: (yawDelta, pitchDelta) => engine._g3_viewer_orbit(yawDelta, pitchDelta),
  onZoom: factor => engine._g3_viewer_zoom(factor),
  onSelect: (clientX, clientY) => model.pick(canvas, clientX, clientY),
});
// When the canvas is no longer in use:
controls.dispose();
```

The callbacks can target any camera implementation; the example's exported
`_g3_viewer_*` functions belong to the viewer build. Mouse drag and one-finger
touch orbit, the wheel and a two-finger pinch zoom, and a click or tap invokes
`onSelect` when movement stays below the threshold. Options `rotateSpeedX`,
`rotateSpeedY`, `wheelSpeed`, and `clickTolerance` adjust input sensitivity.
Disposal removes listeners and restores the canvas's previous `touch-action`.
The controls do not provide panning or keyboard navigation.

The API decodes images into RGBA8 and copies them to the renderer. `dispose()`
is idempotent. A model owns the nodes, meshes, materials and textures it creates:
disposal releases its GPU buffers and textures and makes its asset-owned slots
available for reuse. Primitives in a model that reference the same glTF material
share one engine material. Browser node handles contain an index,
generation, and scene epoch, and are bound to the engine that created them.
Use `isNodeHandleValid` before retaining or using a handle: it becomes invalid
after disposal or `scene_clear()`, even if the same index is reused. Disposal
after `scene_clear()` still releases the model's GPU resources without touching
nodes in the new scene. The `index` is for inspection; passing it directly to
low-level engine functions bypasses the safety check. `model.meshes`,
`model.materials` and `model.textures` contain engine-bound handles with an ID and generation;
`image.handle` has the same form. Use `isMeshHandleValid` and
`isTextureHandleValid` and `isMaterialHandleValid` to check them. Disposal invalidates these handles and
cannot release a different resource that later reuses the ID. Raw IDs and
legacy Goose node indices bypass these checks. Goose callers can also use
`mesh_handle`/`mesh_handle_valid` and `texture_handle`/`texture_handle_valid`.
When an asset node is released, surviving children are reparented to its former
parent and their local transforms are baked into matrices to preserve their
world transforms. Changing a baked child's TRS fields has no effect until its
`use_local_matrix` flag is cleared or its matrix is updated.

CPU geometry remains available for picking while a model is live. Freed vertex
and index spans are tracked independently, split on allocation, and coalesced
with adjacent free spans; a free span at an arena's end can grow for a larger
asset. Existing live mesh geometry never moves. The arenas do not compact live
allocations or return storage to the operating system, so fragmented free
space between live meshes can still raise the high-water mark. This is not yet
general-purpose resource reclamation.

Picking uses the active perspective or orthographic camera, the canvas's CSS dimensions,
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
* Opaque, masked and blended base-colour factors and base-colour textures. The engine's existing
  lighting approximates these materials; metallic/roughness values are not
  physically rendered. Nearest, linear and mipmapped filters are supported,
  as are clamp, repeat and mirrored repeat separately for each axis. An omitted
  glTF wrapping mode defaults to repeat; omitted filters use linear. The CPU
  rasterizer estimates mip level from neighboring perspective-correct UVs;
  exact mip generation and derivatives can differ from a GPU. glTF base-colour
  images are decoded from sRGB before filtering; factors and alpha are linear.

This is **not a complete glTF implementation**. It rejects required extensions,
skins, animations, morph targets, sparse accessors, non-triangle modes,
double-sided materials, and normal, occlusion, emissive, or
metallic-roughness textures, and advanced texture/sampler extensions. It does not implement material PBR.
Unsupported optional data may be
ignored. Files needing these features require a fuller loader and renderer.

`setOutputColorSpace(engine, 'srgb')` enables output encoding after linear
lighting and blending; `'linear'` restores the default. Background, light,
fog, and material RGB values must be supplied in linear space in sRGB output
mode. The viewer enables this mode. `loadImage` creates a linear texture by
default; pass `{ colorSpace: 'srgb' }` for an sRGB image.
glTF base-colour textures are sRGB. The current output path uses an 8-bit
linear intermediate and clamps rather than tone mapping HDR values. The WebGL
intermediate is not multisampled, so antialiasing differs from the default path.

Run the browser-loader logic tests with `node web/test_assets.mjs`. These use a
mock engine and image decoder; they do not replace a browser/WebGL integration
test.
