# Asset loading

`web/assets.js` loads a limited glTF 2.0 subset, including node transform
animation, into either browser build after `g3_host_start` has succeeded. It
uses browser fetch and image decoding.

The ES module API has TypeScript declarations in `web/assets.d.ts`. The
`web/package.json` manifest exports this helper module as
`goose-3d-browser-assets`; the package contains only the browser helpers and
their declarations. Applications still build and initialize their own Goose
WebAssembly engine before calling the helpers.

```js
import { loadGLTF, loadImage, loadHDRImage, setEnvironmentMap, setEnvironmentLighting, setEnvironmentRotation, setToneMapping, setFXAA, setExposure, pickNode, isNodeHandleValid, isMeshHandleValid, isTextureHandleValid, isMaterialHandleValid, setOutputColorSpace, AssetError } from './assets.js';

try {
  setOutputColorSpace(engine, 'srgb'); // after engine startup
  setFXAA(engine, true); // optional output edge smoothing
  const model = await loadGLTF(engine, './model.glb');
  // Scale environment fill/reflections for glTF material 0 without changing others.
  model.setMaterialEnvironmentIntensity(0, 0.6);
  // Pass { scene: 1 } to load a different scene by index.
  if (model.animations.length) {
    model.playAnimation(0, { loop: true });
    model.update(1 / 60); // call from the frame loop with elapsed seconds
    // model.pauseAnimation(); model.seekAnimation(0.5); model.stopAnimation();
  }
  // model.sceneIndex identifies the loaded scene; roots contains its checked node handles.
  // model.nodes exposes selected-scene glTF indices, names, parent/child links,
  // mesh/camera/light/skin references, a checked group handle, and primitive handles.
  // If the document contains KHR_lights_punctual, model.applyLights() opts into them;
  // model.applyLights({ pointShadow: 1, spotShadow: 2 }) also selects shadow
  // casters by model.lights index.
  // model.dispose() restores the previous engine light set.
  // model.variants lists KHR_materials_variants names; model.setVariant('Damaged') switches materials.
  // model.setVariant(null) restores each primitive's default material.
  // model.pick(canvas, event.clientX, event.clientY) returns a handle or null.
  // pickNode(engine, canvas, clientX, clientY) can pick any visible mesh.
  // isNodeHandleValid(engine, handle) detects disposal or a scene reset.
  // When no longer needed:
  model.dispose();

  const image = await loadImage(engine, './image.png');
  // image.handle is checked; image.id is the low-level texture ID.
  // image.width and image.height are pixels.
  // Keep it alive while any node uses it, then call image.dispose().

  const environment = await loadHDRImage(engine, './studio.hdr');
  setEnvironmentMap(engine, environment, 0.8);
  setEnvironmentRotation(engine, Math.PI / 2); // rotate the equirectangular map around world up
  setEnvironmentLighting(engine, [0.5, 0.7, 1.0], [0.12, 0.1, 0.08], 0.6);
  setToneMapping(engine, true);
  setExposure(engine, 1.0); // accepted range is 0–32
  // When no longer needed: setEnvironmentMap(engine, null); environment.dispose();
} catch (error) {
  if (error instanceof AssetError) console.error(error.code, error.message);
  else throw error;
}
```

URLs are resolved relative to the document or, for external glTF resources,
relative to the model URL. Resources require normal browser fetch/CORS access.

## Native GLB primitive subset

Native Goose programs can import `g3.gltf_native` and load static geometry from
an embedded-binary glTF 2.0 GLB. Load one primitive by mesh index:

```goose
import g3.gltf_native;

let loaded, ok = g3::native_glb_load_primitive("model.glb", 0, 0);
guard ok else { print("could not load GLB mesh 0, primitive 0"); return; }
var model = loaded;
g3::frame(1.0 / 60.0);
g3::native_glb_dispose(model);
```

`native_glb_load_primitive` uses the first node that instances the mesh. Use
`native_glb_load_node_primitive(path, node_index, primitive_index)` to select a
specific instance when a glTF mesh appears in multiple nodes. To load every
primitive of that node instance, use the mesh owner API:

```goose
import vec;
import g3.scene;
import g3.gltf_native;

let loaded_mesh, mesh_ok = g3::native_glb_load_node_mesh("model.glb", 0);
guard mesh_ok else { print("could not load GLB node 0"); return; }
var model_mesh = loaded_mesh;
let root = g3::native_glb_mesh_root(model_mesh);
g3::node(root.index).use_local_matrix = false;
g3::node(root.index).pos = float3 { 0.0, 1.0, 0.0 }; // move every primitive together
for i in 0..g3::native_glb_mesh_primitive_count(model_mesh) {
  let node = g3::native_glb_mesh_primitive_node(model_mesh, i);
  // Use each checked primitive handle for per-part scene operations.
}
g3::native_glb_mesh_dispose(model_mesh);
```

The loader supports float32 `POSITION`, `NORMAL`, and optional `TEXCOORD_0`
attributes, triangle primitives, and unsigned 8-, 16-, or 32-bit indices. It
applies the first matching node instance's matrix or TRS transform composed
with its ancestors. It imports
material base colour, metallic and roughness factors, emissive factor, alpha
mode and cutoff, the double-sided flag, and declared `KHR_materials_unlit`.
Declared `KHR_materials_emissive_strength` and `KHR_materials_ior` are applied
to emissive output and dielectric response. The factor portions of
`KHR_materials_specular`, `KHR_materials_clearcoat`, `KHR_materials_sheen`, and
`KHR_materials_anisotropy` are imported too; their texture maps are not.
`NativeGlbModel` owns checked mesh, node, and material handles; dispose the model
to release them. It does not yet
load material textures, images, external `.gltf` buffers, skins, animations,
sparse accessors, or the full node hierarchy as engine parent/child nodes.
Browser applications should use the broader `web/assets.js` loader.

The viewer's input controls can also be used independently of the viewer host:

```js
import { createOrbitControls } from 'goose-3d-browser-assets/orbit-controls';

const controls = createOrbitControls(canvas, {
  onOrbit: (yawDelta, pitchDelta) => engine._g3_viewer_orbit(yawDelta, pitchDelta),
  onZoom: factor => engine._g3_viewer_zoom(factor),
  onPan: (dx, dy) => engine._g3_viewer_pan(dx, dy, canvas.clientHeight),
  onSelect: (clientX, clientY) => model.pick(canvas, clientX, clientY),
});
// When the canvas is no longer in use:
controls.dispose();
```

The callbacks can target any camera implementation; the example's exported
`_g3_viewer_*` functions belong to the viewer build. Left drag and one-finger
touch orbit, right drag or Shift+left drag pans, and two-finger movement pans
while pinch distance zooms. The wheel also zooms, and a click or tap invokes
`onSelect` when movement stays below the threshold. Options `rotateSpeedX`,
`rotateSpeedY`, `panSpeed`, `wheelSpeed`, and `clickTolerance` adjust pointer
sensitivity. Focus the canvas to use arrow keys to orbit, WASD to pan, and `+`/
`-` to zoom; `keyRotateStep`, `keyPanPixels`, and `keyZoomFactor` set those
increments. Disposal removes listeners, restores the canvas's original
`tabIndex`, and restores its previous `touch-action`.

`loadImage` decodes images into RGBA8; `loadHDRImage` decodes Radiance RGBE
`.hdr` images into linear floating-point radiance. HDR loading supports the
canonical `-Y +X` orientation and scanline RLE, up to 16,777,216 pixels. The
renderer copies uploaded pixels. `dispose()` is idempotent. A model owns the
nodes, meshes, materials and textures it creates:
disposal releases its GPU buffers and textures and makes its asset-owned slots
available for reuse. Primitives in a model that reference the same glTF material
share one engine material. Browser node handles contain an index,
generation, and scene epoch, and are bound to the engine that created them.
`model.nodes` is a read-only, depth-first view of the selected glTF scene's node
hierarchy. Each entry keeps the original glTF node index, optional name, parent
and child indices, optional mesh and skin indices, the checked engine handle for
that node's transform group, checked handles for its primitive nodes, and
`primitiveMaterials` summaries in matching order. Material summaries include
names, factors, alpha mode, sidedness, shading model, IOR, normal and
occlusion strengths, specular, clearcoat, sheen, and anisotropy factors, and the texture slots in
use. Texture bindings map each slot to its glTF texture index.
`getTexturePreview(index, maxDimension)` returns a
bounded RGBA copy for UI previews (default 256, maximum 1024), or `null` for an invalid or disposed model;
disposal releases the loader's decoded pixel buffers. Each primitive summary includes its default material
and the materials assigned by `KHR_materials_variants`; choosing a variant with
`model.setVariant()` does not mutate the inspection data. Nodes in unselected
scenes are not included.
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
`setMaterialEnvironmentIntensity(engine, handle, value)` changes the
hemispherical and equirectangular environment contribution for that material;
it returns `false` for a stale, foreign, or invalid handle/value. The default
multiplier is 1, and 0 disables environment lighting for that material while
preserving its direct lights.
`setEnvironmentRotation(engine, radians)` rotates the equirectangular
environment around world up. It affects diffuse and reflection lookups, accepts
finite radians, and leaves hemispherical sky/ground fill unchanged.
`setEnvironmentLighting(engine, sky, ground, intensity)` sets additive diffuse
hemisphere fill, with linear RGB triples for the sky and ground. Values above
one preserve HDR lighting; a zero intensity disables this fill without clearing
an equirectangular environment map.
`model.setMaterialEnvironmentIntensity(index, value)` resolves a glTF material
index (or `-1` for the implicit default material) through that model's checked
handles and returns `false` after disposal or for an unknown index.
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

`AssetError.code` includes `FETCH`, `IMAGE`, `HDR`, `ENVIRONMENT`, `EXPOSURE`,
`INVALID_GLTF`, `UNSUPPORTED`, `MEMORY`, and `UPLOAD`. The loader validates and decodes before creating scene objects;
GLB JSON/BIN chunk ordering, buffer references, and up to three BIN padding
bytes are checked before decoding; if an upload fails it releases the resources already created. Browser graphics
driver failures may still be reported separately through the backend's error
mechanism.

The glTF loader supports `KHR_materials_unlit`, `KHR_materials_ior`,
`KHR_materials_specular`, `KHR_materials_clearcoat`,
`KHR_materials_emissive_strength`, `KHR_materials_sheen`, `KHR_materials_anisotropy`, and per-texture
`KHR_texture_transform` on `TEXCOORD_0` through `TEXCOORD_7`. Unlit selects
the engine's unlit material path;
emissive strength multiplies the material's `emissiveFactor` before the
emissive texture is applied. `KHR_materials_specular` scales and tints
dielectric reflections with factors and optional textures. Required extensions outside this supported set are
reported as `UNSUPPORTED`; optional extensions that the loader does not
recognize are also rejected when present on a material or texture.
The WebGL renderer requires at least 23 fragment texture units for its current
material, environment, skinning, and shadow samplers; startup reports this limit
when a device exposes fewer.

Native Goose programs can call `texture_load_hdr(path)` from `g3.texture` to
load a Radiance `.hdr` file into the CPU backend. It accepts the same canonical
`-Y +X` orientation and `32-bit_rle_rgbe` scanline RLE subset, up to
16,777,216 pixels. The returned texture uses the ordinary `texture_handle`,
`texture_remove`, and `set_environment_map` lifecycle. It returns `-1` for an
unreadable file, unsupported header/orientation, malformed pixel data, or an
invalid size. Browser programs should continue to use `loadHDRImage`, which
fetches and decodes assets in JavaScript.

## Supported model subset

* `.gltf` JSON and `.glb` version 2, with external, data-URI, or GLB binary
  buffers; images use one external/data-URI source or a buffer view with a
  supported `mimeType`, and the full byte range must lie inside the source
  buffer.
  `EXT_texture_webp` selects its WebP image and falls back to the core image
  source if WebP fetching or decoding fails; WebP-only textures must declare
  the extension as required.
* The selected scene's hierarchy (the glTF default scene, an optional
  `loadGLTF` `{ scene: index }` choice, or an implicit scene from unparented
  nodes when `scenes` is omitted), matrix or TRS transforms, indexed or
  non-indexed triangle primitives, float or `KHR_mesh_quantization` positions,
  and unnormalized unsigned integer triangle indices,
  optional float or quantized normals and tangents,
  optional `TEXCOORD_0` through `TEXCOORD_7`, and optional `COLOR_0` as float
  `VEC3`/`VEC4` or normalized unsigned-byte/unsigned-short `VEC3`/`VEC4`.
  Node transforms, texture transforms, camera projection values, material
  scalars, and default morph weights must remain finite when converted to the
  engine's float32 representation; out-of-range values are reported as
  `INVALID_GLTF` before scene resources are created. Animation samples are
  checked for float32 overflow when evaluated.
  Vertex colours are linear and multiply the base-colour factor and texture;
  `VEC3` supplies alpha 1. Missing normals are generated as area-weighted
  vertex normals from triangle faces. Interleaved byte strides are accepted for
  vertex attributes only; strided indices, animation data, and inverse-bind
  matrices are rejected.
  Repeated nodes referencing the same static primitive share one uploaded mesh.
  Instances of one morphing node also share geometry and its morph upload;
  separate nodes retain independent deformation state. Skinned primitives keep
  per-node geometry.
* `EXT_mesh_gpu_instancing` translation, rotation and scale attributes on
  unskinned mesh nodes, up to 65,536 instances per node. Instance transforms
  become engine nodes that share the static primitive geometry, allowing the
  WebGL backend to batch compatible opaque copies. Custom instance attributes
  and instanced skins are not supported.
* Perspective and orthographic glTF cameras attached to nodes in the selected
  scene. `model.cameras` exposes definitions and their node instances;
  `selectCamera(index, nodeIndex?)` switches the active engine camera (choosing
  the first instance when `nodeIndex` is omitted). `selectCamera(null)` restores
  the view that was active before selection. Camera node transforms include their
  parent transforms and update when an animated transform changes. Projection
  honors perspective `aspectRatio` when provided; otherwise it follows the
  canvas. Orthographic `xmag` and `ymag` both set the authored view extent.
* `KHR_lights_punctual` directional, point and spot light instances in the
  selected scene. Loading only exposes metadata; call `model.applyLights()` to
  replace the engine's eight extra lights, and `model.clearLights()` or
  `model.dispose()` to restore the previous set. Active imported lights follow
  animated node transforms when `model.update()` advances an animation. The
  engine applies inverse-square distance attenuation and a smooth squared
  range fade to imported point and spot lights. A source light without `range`
  has no lighting cutoff. If a user enables a point or spot shadow for such a
  light, its shadow projection uses a 1000-unit far plane. The primary engine
  directional light and environment lighting are unchanged. Imported lights
  do not automatically cast shadows; pass `pointShadow` or `spotShadow` and an
  optional `bias` to `model.applyLights()` to select a caster by its index in
  `model.lights`.
* `KHR_mesh_quantization` supports signed and unsigned 8-bit or 16-bit positions
  and texture coordinates, plus normalized signed 8-bit or 16-bit normals and
  tangents. Morph position deltas also accept signed quantized values; morph
  normal and tangent deltas use normalized signed values. Quantized attributes
  require this extension in both `extensionsUsed` and `extensionsRequired`.
* Optional float `VEC4` `TANGENT` attributes with handedness `w` of `-1` or `1`.
  Authored tangents are used on static, skinned and morphed meshes. Skinning
  transforms tangent directions alongside positions and normals; tangent morph
  deltas update tangent xyz while preserving the base handedness.
* Morph targets with `POSITION`, `NORMAL` and `TANGENT` deltas, default
  mesh/node weights, and animated `weights` channels. Deltas apply before
  skinning. A tangent delta requires a base `TANGENT` attribute.
* Skeletal glTF skins with `JOINTS_0`/`WEIGHTS_0` and optional second influence
  sets, unsigned-byte or unsigned-short joint indices, float or normalized
  unsigned weights, and optional float inverse-bind matrices. Skin joints must
  belong to the selected scene. The loader normalizes skin weights and keeps
  retained CPU vertices current for picking. WebGL skin meshes upload static
  joint/weight attributes and a per-mesh joint palette texture, avoiding a full
  mesh-buffer upload for each pose; the same palette deforms shadow casters.
  WebGL morph meshes upload POSITION/NORMAL/TANGENT delta textures and update a weight
  texture per pose. Up to 64 targets are supported when the vertex and target
  texture dimensions fit the device and the three delta textures together use
  no more than 64 MiB; unsupported sizes or failed GPU uploads fall back to CPU
  deformation. GPU skinning and morphing combine when both paths upload
  successfully. The CPU backend always deforms both features on the CPU.
* Dense and sparse accessors for the supported scalar and vector data types.
  Sparse indices may use unsigned byte, unsigned short, or unsigned int values;
  accessors without a base buffer view start with zero values before sparse
  replacements are applied. Decoded accessor data is capped at 8,388,608 scalar
  components per accessor.
* Opaque, masked and blended base-colour factors and base-colour textures.
  `COLOR_0` is multiplied into base colour; its alpha also participates in mask
  and blend alpha, while opaque materials ignore alpha.
  `KHR_materials_unlit` selects unlit shading for a material.
  `KHR_materials_ior` sets the dielectric Fresnel reflectance used by direct
  and environment lighting; its supported range is 1.0 to 2.333, with a
  default index of refraction of 1.5.
  `KHR_materials_specular` applies `specularFactor` and its linear alpha map to
  dielectric specular strength, and applies `specularColorFactor` and its sRGB
  RGB map to dielectric F0. The colour factor may exceed 1; resulting F0 is
  clamped to 1. Metallic specular response remains driven by base colour. Both
  texture slots support independent `KHR_texture_transform` settings.
  Clearcoat factors add a dielectric top layer to direct and environment
  specular lighting and attenuate the base layer by view-angle Fresnel. Its
  strength map uses R, its roughness map uses G, and both support independent
  `KHR_texture_transform` settings. The clearcoat normal map uses its own
  tangent frame and supports its independent texture transform.
  `KHR_materials_sheen` adds a Charlie-style coloured grazing response under
  direct directional, point, and spot lights. Its sRGB colour map uses RGB;
  its linear roughness map uses alpha. Both maps accept independent texture
  transforms. Prefiltered environment maps also contribute a roughness-blurred
  grazing sheen reflection.
  `KHR_materials_anisotropy` uses anisotropic GGX for direct lights on both
  backends. `anisotropyStrength` is in [0, 1]; rotation is counter-clockwise in
  tangent space. Its optional linear map decodes RG from [0, 1] to a direction
  in [-1, 1] and multiplies strength by B. The map accepts
  `KHR_texture_transform`. Environment reflections use the spec's bent-normal
  single-sample approximation; authored tangents are preferred, with a
  UV-derived tangent fallback.
  `KHR_materials_emissive_strength` scales `emissiveFactor`, including values
  above 1 for HDR emission.
  `KHR_materials_variants` exposes its names on the loaded model. Call
  `setVariant(indexOrName)` to switch mapped primitives, or `setVariant(null)`
  to restore their default materials.
  `KHR_texture_transform` applies an independent offset, rotation and scale to
  each texture slot. `TEXCOORD_0` through `TEXCOORD_7` are supported.
  Double-sided materials disable back-face culling in colour and shadow passes;
  back-face normals are flipped before colour-pass lighting.
  Metallic and roughness factors drive GGX direct lighting; both default to 1.
  Emission adds the linear `emissiveFactor`, multiplied by an sRGB-decoded
  `emissiveTexture` when present.
  Occlusion textures use the glTF red channel and attenuate indirect ambient
  and environment fill according to the material's `occlusionTexture.strength`;
  direct lights remain unaffected.
  Metallic-roughness textures use the glTF B channel for metallic and G for
  roughness, uploaded as linear data. If one glTF texture is used for both
  base colour and metallic-roughness, the loader keeps separate sRGB and linear
  uploads.
  Equirectangular environment maps add diffuse fill and a roughness-selected
  specular reflection from a GGX importance-sampled mip chain and the
  split-sum BRDF integration LUT.
  Sampling wraps longitude and clamps latitude; selecting the environment map
  generates the prefiltered chain for roughness filtering.
  Nearest, linear and mipmapped filters are supported,
  as are clamp, repeat and mirrored repeat separately for each axis. An omitted
  glTF wrapping mode defaults to repeat; omitted filters use linear. The CPU
  rasterizer estimates mip level from neighboring perspective-correct UVs;
  exact mip generation and derivatives can differ from a GPU. glTF base-colour
  images are decoded from sRGB before filtering; factors and alpha are linear.

This is **not a complete glTF implementation**. It rejects required extensions,
more than eight skin influences, non-triangle modes and
advanced texture/sampler extensions. Authored glTF `TANGENT` attributes are
used for static and skinned meshes. Morphed meshes without authored tangents
derive tangent frames for normal maps from positions and the selected
texture-coordinate set, so mirrored UV seams can differ from MikkTSpace
results. Direct PBR
lighting uses GGX; environment reflections use the documented prefiltered
mip/Fresnel approximation. Roughness is clamped to at least 0.045.
Unsupported optional data may be
ignored. Files needing these features require a fuller loader and renderer.

`setOutputColorSpace(engine, 'srgb')` enables output encoding after linear
lighting and blending; `'linear'` restores the default. Background, light,
fog, and material RGB values must be supplied in linear space in sRGB output
  mode. The viewer enables this mode. `loadImage` creates a linear texture by
  default; pass `{ colorSpace: 'srgb' }` for an sRGB image. glTF base-colour
  textures are sRGB. `setToneMapping(engine, 'reinhard')` or
  `setToneMapping(engine, 'aces')` selects a tone-mapping curve;
  `'none'` disables it. The legacy boolean `true` still selects ACES.
  `setExposure(engine, value)` sets exposure. The CPU composites HDR
  radiance in floating point. WebGL uploads environment radiance as RGBA16F
  and uses a floating point environment prefilter when `EXT_color_buffer_float`
  is available; otherwise rough reflections use
  the unfiltered HDR source map. The display intermediate is not multisampled,
  so antialiasing differs from the default path. `setFXAA(engine, true)` runs an
  optional edge-smoothing post-process after tone mapping and output encoding.

glTF animation clips expose `name` and `duration` in `model.animations`.
`playAnimation(index, { loop })`, `pauseAnimation()`, `resumeAnimation()`,
`seekAnimation(seconds)`, and `stopAnimation()` control translation, rotation,
and scale channels. Call
`model.update(dt)` from the frame loop. LINEAR, STEP and CUBICSPLINE
interpolation are supported. LINEAR rotations use quaternion spherical
interpolation. CUBICSPLINE uses glTF's in-tangent, value, out-tangent key layout
and normalizes interpolated rotation quaternions. Clips can target only nodes in
the selected glTF scene and animate ordinary transforms, morph weights, and skin
joints. The CPU keeps deformed vertices current for picking. WebGL uses GPU
joint palettes and morph textures when the target count and device limits allow
it; the CPU reference backend and WebGL fallbacks upload deformed vertices.
Matrix-form TRS animation is unsupported.

Run the browser-loader logic tests with `node web/test_assets.mjs`. These use a
mock engine and image decoder; they do not replace a browser/WebGL integration
test.
