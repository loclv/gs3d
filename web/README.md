# Goose 3D browser asset helpers

This package contains `assets.js` and its TypeScript declarations. It does not
contain an engine build: create the Goose 3D WebAssembly module with
`build_web.sh`, initialize it with `_g3_host_start(width, height)`, then pass
that initialized module to these helpers.

```js
import { loadGLTF, setOutputColorSpace, setFXAA, AssetError } from 'goose-3d-browser-assets';

setOutputColorSpace(engine, 'srgb');
setFXAA(engine, true);
try {
  const model = await loadGLTF(engine, './model.glb');
  // In the application's frame loop:
  model.update(deltaSeconds);
  engine._g3_app_frame(deltaSeconds);
  // On unload:
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

Run `npm test` in this directory to exercise the asset parser and lifecycle
against a fake engine. These tests do not compile shaders or verify WebGL output.

`model.applyLights()` opts into the selected scene's `KHR_lights_punctual`
lights. Its optional `pointShadow` and `spotShadow` values select one caster of
each type by index in `model.lights`; `bias` applies to both. Lights without a
glTF `range` have no lighting cutoff. If selected for a shadow, they use a
1000-unit shadow projection far plane. `model.clearLights()` or
`model.dispose()` restores the previous light and shadow state.
