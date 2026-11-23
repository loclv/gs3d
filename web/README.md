# Goose 3D browser asset helpers

This package publishes the browser helpers in `assets.js` and their TypeScript
declarations. It does not contain the Goose 3D engine build. Build the WebAssembly
module for your application, initialize it with `_g3_host_start(width, height)`,
then pass that initialized module to these helpers. In this repository, use
`./build_web.sh` to build the sample applications.

```js
import { loadGLTF, setOutputColorSpace, setFXAA, AssetError } from 'gs3d';
import { createOrbitControls } from 'gs3d/orbit-controls';

setOutputColorSpace(engine, 'srgb');
setFXAA(engine, true);
try {
  const model = await loadGLTF(engine, './model.glb');
  const controls = createOrbitControls(canvas, {
    onOrbit: (azimuth, elevation) => orbitCamera(azimuth, elevation),
    onZoom: factor => zoomCamera(factor),
    onPan: (x, y) => panCamera(x, y),
    onSelect: (x, y) => selectAt(x, y)
  });
  // In the application's frame loop:
  model.update(deltaSeconds);
  engine._g3_app_frame(deltaSeconds);
  // On unload:
  controls.dispose();
  model.dispose();
} catch (error) {
  if (error instanceof AssetError) console.error(error.code, error.message);
  else throw error;
}
```

In this repository, `docs/assets.md` describes supported glTF features, asset
ownership, errors, texture colour spaces and animation.
The declarations in `assets.d.ts` cover loaders, checked handles, model
lifecycle, animation controls and rendering options.

## Three.js-compatible facade

`gs3d/three` (also re-exported from the package root) provides a deliberate
subset of the three.js API backed by the bundled WebAssembly engine: `Scene`,
`Group`, `Mesh`, `BufferGeometry` with `BufferAttribute`s plus the
`BoxGeometry`, `SphereGeometry`, `PlaneGeometry`, `CircleGeometry`,
`RingGeometry`, `CylinderGeometry` and `TorusGeometry` primitives,
`MeshStandardMaterial` and `MeshBasicMaterial`, the common lights,
`PerspectiveCamera` and `OrthographicCamera`, `Color`/`Vector2`/`Vector3`/`Euler`,
`Fog`/`FogExp2`, an `OrbitControls` class matching the three.js addon API
(`new OrbitControls(camera, domElement)` with `target`, `update()` and
`dispose()`), and a `WebGPURenderer` with `init()`, `setSize()`,
`setAnimationLoop()` and `render()`. An application written against three.js
can switch its import to `gs3d/three` (or `gs3d/webgpu`, matching the
`three/webgpu` specifier) and its dependency to `gs3d` with no other changes
for scenes built from primitives.

```js
import * as THREE from 'gs3d/three';

const renderer = new THREE.WebGPURenderer({ canvas });
await renderer.init();
renderer.setAnimationLoop(() => renderer.render(scene, camera));
```

The facade currently covers meshes with `Texture`/`DataTexture`/
`CanvasTexture` maps — base color (`material.map`), packed
metallic-roughness (`metalnessMap`/`roughnessMap`, glTF G=roughness/B=metallic
convention), `normalMap`/`normalScale`, `aoMap`/`aoMapIntensity` and
`emissiveMap` — with sRGB/linear colour spaces, wrap and filter modes,
repeat/offset/rotation UV transforms and `texture.channel` UV-set selection
(`uv`…`uv7` geometry attributes). `TextureLoader` and `GLTFLoader` handle
PNG/JPEG images embedded in GLBs, `data:` URIs and (for `.gltf`) relative or
absolute URLs, including `KHR_texture_transform`. Primitive geometries cover
box, sphere, plane, circle, ring, cylinder, cone, torus, capsule and the
platonic solids (tetrahedron, octahedron, icosahedron, dodecahedron, with
`detail` subdivision), plus `material.vertexColors` for vertex-coloured
meshes and `material.flatShading` (expanded to per-face normals at upload).
`Object3D` exposes `matrix`/`matrixWorld` (`Matrix4`, refreshed each render)
and honors `matrixAutoUpdate = false`.
`Object3D.quaternion` and `rotation` stay in sync (XYZ Euler order).
`Layers` filters rendered objects and lights against `camera.layers`, and
raycast intersections against `raycaster.layers`; children are tested independently.
Pure-JS helpers cover `Ray`/`Raycaster` (Möller–Trumbore against geometry,
`setFromCamera` for perspective cameras) and `Box3` (`setFromObject` walks
the scene graph). `scene.environment` accepts an equirectangular texture
with `environmentIntensity`/`environmentRotation`, and materials support
`envMapIntensity`. `PMREMGenerator.fromScene` renders the scene into a
cubemap and stitches an equirectangular `DataTexture` (the engine generates
its own filtered mips, approximating PMREM roughness filtering);
`RoomEnvironment` provides a softbox env scene, and
`PMREMGenerator.fromEquirectangular` passes equirect textures through.
`WebGLRenderer` aliases `WebGPURenderer`. `camera.setViewOffset`/`clearViewOffset` render
a sub-rectangle of a larger virtual image through an off-axis frustum,
enabling tiled high-resolution stills. `Path`/`Shape` with quadratic and cubic curves feed
`ShapeGeometry` (ear-clipping triangulation; holes are bridged when the
merged loop triangulates cleanly, otherwise filled) and `ExtrudeGeometry`
(bevel parameters accepted but ignored). `TubeGeometry` sweeps a radius
along any `getPoint(t)` path, and `CatmullRomCurve3` provides splines.
Skinning, morph targets, line/points primitives and post-processing are
not implemented. Materials accept a `customShader` extension —
`material.customShader = { header, body, tail }` splices GLSL into a
copy of the lit fragment shader (WebGL only): `header` lands at global
scope before `main()` where it can declare helpers and extra uniforms,
`body` statements run inside `main()` after the material inputs
(`base`, `n`, `ao`, `mr`, `metal`, `f0`, `specular_*`, `coat_*`,
`sheen_*`, `aniso_*`, `v`, `l`, all `u_*` uniforms and `v_uv`–`v_uv7`
varyings) are resolved but before lighting accumulates, so they can be
reassigned, and `tail` statements run after tone mapping and sRGB
encoding, just before output, where they may modify `col` and `alpha`
(display-referred grading such as a LUT belongs here). Adding to
`g3_emissive_extra` (declared just before `body`) contributes emission.
Every custom program also declares `uniform sampler3D u_lut` and
`uniform float u_lut_enabled`; `material.lutTexture` accepts a
`Data3DTexture` (RGBA8 `Uint8Array`, linear/clamp fixed) bound per
material, and `material.customUniforms` is a 32-float array exposed as
`uniform vec4 u_user[8]`. The CPU backend ignores custom shaders and
renders the standard program. Custom shaders always run the lit path and
participate in the same texture-mask program cache (64 variants).
`THREE.ShaderMaterial` runs complete user vertex+fragment programs
(GLSL ES 1.00, three.js style, WebGL only): the engine supplies the
`modelMatrix`/`modelViewMatrix`/`projectionMatrix`/`viewMatrix`/
`normalMatrix` (mat3, like three)/`cameraPosition` builtins and the
`position`/`normal`/`uv`/`color`/`tangent` attributes automatically, and
per-material `uniforms` (numbers, vectors, matrices, arrays and 2D/3D
textures). `#include <tonemapping_fragment>` and `#include
<colorspace_fragment>` resolve to the engine's output chain; `side`,
`transparent` and `opacity` map to culling/blending, while
`depthWrite`, instancing, projective texturing and non-normal blending
are ignored. Custom vertex attributes — including
`InterleavedBufferAttribute` data, which is deinterleaved on upload — are
packed into the eight vec2 UV channels not claimed by explicit
`uv`/`uv1`–`uv7` attributes, one attribute per contiguous slot pair in
registration order; `uv1`–`uv7` and custom names decode automatically in
ShaderMaterial vertex shaders, and lit `customShader` code can read the
same data through the `v_uv`–`v_uv7` fragment varyings. Attributes a
material references but the geometry lacks are filled from
`defaultAttributeValues` (or zero). `DataTexture`/`Data3DTexture` with
`type = HalfFloatType` and `Uint16Array` data upload as RGBA16F. Shadows are limited to one directional light: the first
`castShadow` directional light owns the engine's single shadow map
(256/512/1024 px, PCF radius derived from `shadowMap.type`), its
`shadow.camera` ortho bounds and `shadow.bias`/`normalBias` fold into one
world-space shadow box and depth bias, and `shadow.mapSize` above 1024
clamps. `shadow.mapSize.set`, `autoUpdate`/`needsUpdate` and
`renderer.shadowMap.autoUpdate` are accepted for compatibility; the map
re-renders every frame while enabled;
`WebGPURenderer` renders through the engine's WebGL2 backend and reports
`backend.isWebGPUBackend === false`.

In this repository the facade's engine is built with `./build_web.sh --gs3d`,
which writes `web/gs3d/app.js` and `web/gs3d/app.wasm` (gitignored build
output, packed into the published tarball).

## Loading glTF assets into the facade

`gs3d/gltf-loader` (also exported from the package root) provides a
`GLTFLoader` matching the three.js examples API. It parses glTF 2.0 JSON and
GLB files — including node hierarchies, TRS and matrix transforms, and
untextured PBR materials — into the facade's scene graph:

```js
import * as THREE from 'gs3d/three';
import { GLTFLoader } from 'gs3d/gltf-loader';

new GLTFLoader().load('./model.glb', gltf => {
  scene.add(gltf.scene);
});
```

Textures, images, skins, morph targets, animations and compressed buffers
(Draco/meshopt) are not supported; files requiring those extensions throw.

## Exporting glTF assets

`gs3d/gltf-exporter` provides a `GLTFExporter` matching the three.js examples
API. It writes GLB (binary) or glTF JSON for the facade's scene-graph subset —
node hierarchies with TRS/matrix transforms, `POSITION`/`NORMAL`/`COLOR_0`/
`TEXCOORD_0`/`TEXCOORD_1` attributes (interleaved attributes are deinterleaved),
indices, and PBR materials with vertex colors:

```js
import { GLTFExporter } from 'gs3d/gltf-exporter';

const buffer = await new GLTFExporter().parseAsync(group, { binary: true });
```

Material texture maps, custom shader attributes, skins, morph targets and
animations are not exported; those attributes are skipped.

## Physics

`gs3d/physics` provides a `PhysicsWorld` in the style of three.js'
RapierPhysics addon, backed by the engine's own solver (`g3.rapier`):

```js
import { PhysicsWorld } from 'gs3d/physics';

const world = new PhysicsWorld(engine); // the gs3d host module
world.setGravity(0, -9.81, 0);
world.setTimestep(1 / 60);

const body = world.addBall(nodeIndex, 0.5, 1); // mass 0 is fixed
world.step();
const [x, y, z] = world.translation(body);    // copy back to your scene
```

Bodies are created from cuboid, ball and capsule descriptors and expose
`translation`/`setTranslation`, `linvel`/`setLinvel`, `applyImpulse`,
restitution and friction, matching Rapier's RigidBody/Collider vocabulary.
The world is translation-only — there is no rotation, angular velocity or
torque, one collider per body, and no per-body removal (`clear()` resets).
Bodies attach to engine node indices, not facade `Object3D`s; read
`translation()` after `step()` and write it back to your objects yourself.
This module needs the gs3d host build (`./build_web.sh --gs3d`); other
browser builds do not export the physics entry points.

## Reference viewer

From the repository root, run `./build_web.sh --viewer --serve` and open
`http://localhost:8080/viewer/`. The bundled textured turntable scene includes
perspective and orthographic cameras, point and spot lights, a shadow-receiving
ground plane, animation clips, and a Blue paint variant with clearcoat and
specular extensions. Use the
Camera and Shadow caster selectors to switch cameras and opt into one point or
spot shadow map; Reload model repeats loading and disposal. This is a convenient
local reference scene, while actual browser rendering checks are still needed
to validate WebGL output. Closing the page disposes controls and models, then
shuts down the engine after any in-flight load finishes.

Regenerate the sample asset with `npm run build:sample` from this directory.
The reusable typed GLB builder and the sample source are documented in
[`../docs/model-authoring.md`](../docs/model-authoring.md).
For browser-side checks of WebGL frame output, glTF, standalone raster, and
Radiance HDR decoding, texture disposal and sampling, HDR environment maps,
environment fill, animation, camera selection, imported point and spot lights
and shadows, repeated asset disposal, render targets, built-in post-processing,
and custom fragment shaders, run the following from the repository root and open
`/viewer/reference-checks.html`:

```sh
./build_web.sh --reference-checks --serve
```

To run the same checks automatically in headless Chrome or Chromium, use
`npm run test:browser` from this directory. It builds the reference app and the
64-target morph benchmark, serves the checkout on a temporary local port, and
waits for machine-readable results from the reference page and benchmark. The
runner uses SwiftShader and needs no npm dependencies. Set
`G3_CHROME=/path/to/chrome` when the browser is not in a standard location.
Pass `--timeout-ms N` to `node test_browser_reference.mjs` to change the default
two-minute limit. This command launches a local browser; it does not contact
external sites. The repository's GitHub Actions workflow runs this suite on
pushes and pull requests after installing a checksum-verified Goose compiler,
Emscripten 7.0.0, and headless Chrome. The same workflow runs native CPU renderer
tests. It also opens the bundled model viewer
and exercises its camera, animation, shadow, variant, environment, orbit, pan,
pinch, wheel zoom, keyboard, selection, preview, and reload controls. It also
opens the package consumer
with the bundled sample and checks malformed replacement and reload behavior
without contacting the remote default model.

It compares rendered pixels for linear and sRGB output, Reinhard and ACES tone
mapping, exposure, animation, hemisphere fill, HDR environment maps, shadows,
camera selection and restoration, target sampling, individual post-process effects,
an ordered pass queue, and an animated skin pose. The 64-target morph benchmark
also compares WebGL output across animation frames. It checks typed image, HDR,
and glTF errors, invalid-shader diagnostics, and recovery after a queued shader
pass fails.
Results are reported in the page and in `window.__g3ReferenceChecks` for a browser
automation runner. After the
build, run `node web/test_reference_wasm_exports.mjs` to confirm the page's
engine calls are exported by the generated WebAssembly module.

The repository's package consumer example is at `/examples/model-loader/`. It
defaults to the remote [RobotExpressive sample](https://github.com/mrdoob/three.js/tree/dev/examples/models/gltf/RobotExpressive),
licensed CC0 1.0, and accepts `?model=<URL>` or an entered URL for another
remote glTF/GLB with CORS enabled. Use **Use bundled sample** for an offline
asset. The page shows asset errors, keeps the current model if a replacement
fails, disposes results from superseded loads, and releases model and control
resources when replacing or unloading.

`createOrbitControls` handles pointer orbit, right-button or shift-drag pan,
two-finger pinch and pan, wheel zoom, keyboard camera controls, and click
selection. Its callbacks let the application apply camera changes without
coupling the controls to a camera implementation. Call `dispose()` when the
canvas or viewer is removed.

Run `npm test` in this directory to exercise asset parsing and lifecycle
against a fake engine, orbit controls against a fake canvas, local reference
server routes and MIME types, and package subpath/type-declaration resolution.
These tests do not compile shaders or verify WebGL output. From the repository checkout, run
`node test_build_exports.mjs` to check the browser build's host exports and
`node test_viewer_import_map.mjs` to check that the local viewer maps its public
package imports to the checked-in helpers. The package suite also packs and
installs the generated archive offline in a temporary consumer project, then
checks its JavaScript and TypeScript export paths.

Publishing runs the package tests and a metadata check through the
`prepublishOnly` script. The package uses Apache-2.0; its license file ships in
the package. The published file allowlist otherwise contains only the asset and
orbit-control modules and their declarations; repository tests and sample GLBs
stay in the checkout.

`model.applyLights()` opts into the selected scene's `KHR_lights_punctual`
lights. Its optional `pointShadow` and `spotShadow` values select one caster of
each type by index in `model.lights`; `bias` applies to both. Lights without a
glTF `range` have no lighting cutoff. If selected for a shadow, they use a
1000-unit shadow projection far plane. `model.clearLights()` or
`model.dispose()` restores the previous light and shadow state.
