# Goose 3D Model Lab

A small TypeScript-first model authoring sample for humans and coding agents.
Change the typed model parameters, inspect the WebGL2 preview, and export a
standard `.glb` file. The shared [`web/model-authoring.ts`](../web/model-authoring.ts)
helper writes the GLB directly; there is no desktop modeling app, browser
service, or extra runtime dependency in this sample.

## Run it

Use Bun and Node.js 24 or newer. From this directory:

```sh
bun install
bun run dev
```

Open the local URL printed by Rsbuild. The starter scene is a three-part signal
beacon. Select a part to edit its name, size, position, and colour; add or remove
boxes; drag the preview to orbit it; then choose **Export model** to download a
`.glb`. The exported file is glTF 2.0 and can be loaded by the Goose 3D asset
loader.

```sh
bun run check
bun run test
bun run lint
bun run build
```

## Source workflow

[`src/model.ts`](src/model.ts) contains the authored part list and returns typed
geometry for the live preview plus GLB bytes for download. Each part becomes a
named glTF mesh, material, and translated node. The UI in [`src/index.ts`](src/index.ts)
binds controls to the selected part. For a new model type, edit `src/model.ts` to use `GlbBuilder`, `boxGeometry`,
`planeGeometry`, and custom typed vertex arrays. The shared authoring guide has
a full source example and a prompt template for assigning model work to an AI
coding agent: [`../docs/model-authoring.md`](../docs/model-authoring.md).

The sample keeps the scene definition in reviewable TypeScript while the builder
owns accessor validation, binary packing, and GLB alignment. No manual byte
offsets or binary file edits are part of the authoring loop.
