# Goose 3D browser asset helpers

This package publishes the browser helpers in `assets.js` and their TypeScript
declarations. It does not contain the Goose 3D engine build. Build the WebAssembly
module for your application, initialize it with `_g3_host_start(width, height)`,
then pass that initialized module to these helpers. In this repository, use
`./build_web.sh` to build the sample applications.

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

In this repository, `docs/assets.md` describes supported glTF features, asset
ownership, errors, texture colour spaces and animation.
The declarations in `assets.d.ts` cover loaders, checked handles, model
lifecycle, animation controls and rendering options.

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

Regenerate the sample asset with `python3 web/viewer/generate_sample.py`.
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
`prepublishOnly` script. Set the package `license` before publishing; an
open-source license also needs a `web/LICENSE` file, which the package allowlist
ships. The published file allowlist otherwise contains only the asset and
orbit-control modules and their declarations; repository tests and sample GLBs
stay in the checkout.

`model.applyLights()` opts into the selected scene's `KHR_lights_punctual`
lights. Its optional `pointShadow` and `spotShadow` values select one caster of
each type by index in `model.lights`; `bias` applies to both. Lights without a
glTF `range` have no lighting cutoff. If selected for a shadow, they use a
1000-unit shadow projection far plane. `model.clearLights()` or
`model.dispose()` restores the previous light and shadow state.
