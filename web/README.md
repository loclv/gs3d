# Goose 3D browser asset helpers

This package contains `assets.js` and its TypeScript declarations. It does not
contain an engine build: create the Goose 3D WebAssembly module with
`build_web.sh`, initialize it with `_g3_host_start(width, height)`, then pass
that initialized module to these helpers.

```js
import { loadGLTF, setOutputColorSpace, setFXAA, AssetError } from 'goose-3d-browser-assets';
import { createOrbitControls } from 'goose-3d-browser-assets/orbit-controls';

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

The repository's `docs/assets.md` describes supported glTF features, asset
ownership, errors, texture colour spaces and animation.
The declarations in `assets.d.ts` cover loaders, checked handles, model
lifecycle, animation controls and rendering options.

## Reference viewer

From the repository root, run `./build_web.sh --viewer --serve` and open
`http://localhost:8080/viewer/`. The bundled textured turntable scene includes
perspective and orthographic cameras, point and spot lights, a shadow-receiving
ground plane, and animation clips. Use the Camera and Shadow caster selectors
to switch cameras and opt into one point or spot shadow map; Reload model
repeats loading and disposal. This is a convenient local reference scene, while
actual browser rendering checks are still needed to validate WebGL output.

Regenerate the sample asset with `python3 web/viewer/generate_sample.py`.
For browser-side checks of WebGL frame output, texture decoding, environment
fill, animation, camera selection, point and spot shadows, repeated asset
disposal, render targets, built-in post-processing, and custom fragment
shaders, run the following from the repository root and open
`/viewer/reference-checks.html`:

```sh
./build_web.sh --reference-checks --serve
```

It compares rendered pixels as animation, environment fill, shadows, cameras,
target sampling, and post-processing change. Results are reported in the page
and in `window.__g3ReferenceChecks` for a browser automation runner. After the
build, run `node web/test_reference_wasm_exports.mjs` to confirm the page's
engine calls are exported by the generated WebAssembly module.

The package consumer example is at `/examples/model-loader/`. It defaults to
the remote [RobotExpressive sample](https://github.com/mrdoob/three.js/tree/dev/examples/models/gltf/RobotExpressive),
licensed CC0 1.0, and accepts `?model=<URL>` or an entered URL for another
remote glTF/GLB with CORS enabled. Use **Use bundled sample** for an offline
asset. The page shows asset errors, keeps the current model if a replacement
fails, and disposes model and control resources when replacing or unloading.

`createOrbitControls` handles pointer orbit, right-button or shift-drag pan,
two-finger pinch and pan, wheel zoom, keyboard camera controls, and click
selection. Its callbacks let the application apply camera changes without
coupling the controls to a camera implementation. Call `dispose()` when the
canvas or viewer is removed.

Run `npm test` in this directory to exercise asset parsing and lifecycle
against a fake engine, orbit controls against a fake canvas, and package
subpath/type-declaration resolution. Run
These tests do not compile shaders or verify WebGL output. From the repository
checkout, run `node test_build_exports.mjs` to check the browser build's host
exports and `node test_viewer_import_map.mjs` to check that the local viewer
maps its public package imports to the checked-in helpers.

`model.applyLights()` opts into the selected scene's `KHR_lights_punctual`
lights. Its optional `pointShadow` and `spotShadow` values select one caster of
each type by index in `model.lights`; `bias` applies to both. Lights without a
glTF `range` have no lighting cutoff. If selected for a shadow, they use a
1000-unit shadow projection far plane. `model.clearLights()` or
`model.dispose()` restores the previous light and shadow state.
