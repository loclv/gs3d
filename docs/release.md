# Release

## npm package `gs3d`

The `gs3d` package is defined by `web/package.json` and ships the browser
helpers (`assets.js`, `orbit-controls.js`), the Three.js-compatible facade
(`three.js`, `gltf-loader.js`, `gltf-exporter.js`), their TypeScript
declarations, and the facade's WebAssembly engine build. The `files`
allowlist excludes repository tests and sample assets.

### Prerequisites

Same toolchain as any browser build: the Goose compiler on `PATH` and
Emscripten, either on `PATH` or in `.toolchain/emsdk` (see the README). The
facade engine is a build artifact, so a release always starts with a rebuild.

### Steps

1. From the repository root, rebuild the facade engine:

   ```sh
   ./build_web.sh --gs3d
   ```

   This writes `web/gs3d/app.js` and `web/gs3d/app.wasm` (gitignored, but
   packed into the tarball via the `files` allowlist). Rebuild on every
   release — a stale `app.wasm` would ship an old engine under a new
   version number.

2. Bump `"version"` in `web/package.json`.

3. From `web/`, run the package suite:

   ```sh
   npm test
   ```

   This covers asset parsing, orbit controls, the facade, package export
   resolution, and `test_package_tarball.mjs`, which packs the tarball and
   installs it offline in a temporary consumer project.

4. Preview the tarball if desired:

   ```sh
   npm pack
   ```

5. Publish:

   ```sh
   npm publish
   ```

   The `prepublishOnly` script re-runs `npm test` and then
   `check_publish_metadata.mjs`, which blocks publishing unless `license` is
   set and, for open-source licenses, `LICENSE` is in the `files` allowlist
   and `web/LICENSE` exists. The package is unscoped (`gs3d`), so no
   `--access` flag is needed.

### What consumers get

`gs3d` does not replace `build_web.sh` for applications that need their own
entry point — it bundles the helpers and the facade engine used by
`gs3d/three`. Applications embedding the engine directly still compile their
own WebAssembly module and pass the initialized module to the helpers, as
described in `web/README.md`.
