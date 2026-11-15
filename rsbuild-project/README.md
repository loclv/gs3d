# Goose 3D Model Lab

A small TypeScript-first model authoring sample for humans and coding agents.
Change the typed model parameters, inspect the WebGL2 preview, and export a
standard `.glb` file. The shared [`web/model-authoring.ts`](../web/model-authoring.ts)
helper writes the GLB directly; there is no desktop modeling app, browser
service, or extra runtime dependency in this sample.

## Run it

From this directory:

```sh
bun install
bun run dev
```

Open the local URL printed by Rsbuild. Drag the preview to orbit it, adjust the
name, dimensions, or base colour, then choose **Export model** to download a
`.glb`. The exported file is glTF 2.0 and can be loaded by the Goose 3D asset
loader.

```sh
bun run check
bun run build
```

## Source workflow

[`src/model.ts`](src/model.ts) contains the authored model function and returns
both typed geometry for the live preview and GLB bytes for download. The UI in
[`src/index.ts`](src/index.ts) binds the controls to that function. For a new
model type, edit `src/model.ts` to use `GlbBuilder`, `boxGeometry`,
`planeGeometry`, and custom typed vertex arrays. The shared authoring guide has
a full source example and a prompt template for assigning model work to an AI
coding agent: [`../docs/model-authoring.md`](../docs/model-authoring.md).

The sample keeps the scene definition in reviewable TypeScript while the builder
owns accessor validation, binary packing, and GLB alignment. No manual byte
offsets or binary file edits are part of the authoring loop.
