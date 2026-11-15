# Code-first model authoring

Create and review models as TypeScript source. The built-in authoring helpers
write glTF 2.0 GLB files directly, so this workflow does not need Blender,
desktop automation, third-party npm packages, or hand-calculated buffer offsets.
The output loads through the existing `gs3d` asset API and reference viewer.

## Build the reference model

Use Node.js 24 or newer. From the repository root:

```sh
npm --prefix web run build:sample
npm --prefix web run test:model-authoring
```

The source for the viewer sample is [`web/viewer/generate_sample.ts`](../web/viewer/generate_sample.ts).
The reusable helpers are [`web/model-authoring.ts`](../web/model-authoring.ts).
The sample demonstrates a textured box and ground plane, materials, a material
variant, cameras, punctual lights, and two animation clips. The generator accepts
an optional output path, which makes it easy to build isolated previews:

```sh
node --experimental-strip-types web/viewer/generate_sample.ts /tmp/preview.glb
```

## Detailed robot example

Run `npm --prefix web run build:robot` to generate `web/viewer/robot.glb` from
[`generate_robot.ts`](../web/viewer/generate_robot.ts). Start the web server with
`./build_web.sh --serve`, then open `/viewer/?model=robot`. Orbit and zoom to
inspect its separate armor plates, joints, eyes, vents, and small hardware. The
source uses shared meshes and named nodes, so each part can be edited independently.
An optional output path can be passed directly to the generator as with the sample.

## Add a model in source

```ts
import { writeFile } from 'node:fs/promises';
import { boxGeometry, GlbBuilder, type GltfDocument } from './model-authoring.ts';

const model = new GlbBuilder();
const body = model.addMesh({
  name: 'Robot body',
  primitives: [{
    geometry: boxGeometry([1.2, 1.8, 0.7]),
    material: 0,
  }],
});

const document: GltfDocument = {
  asset: { version: '2.0', generator: 'my TypeScript model' },
  materials: [{
    name: 'Ceramic',
    pbrMetallicRoughness: { baseColorFactor: [0.12, 0.45, 0.9, 1], metallicFactor: 0.1, roughnessFactor: 0.28 },
  }],
  nodes: [{ name: 'Body', mesh: body, translation: [0, 1, 0] }],
  scenes: [{ nodes: [0] }],
  scene: 0,
};

await writeFile('robot.glb', model.encode(document));
```

For custom shapes, pass vertex positions, optional normals and UVs, and triangle
indices as ordinary arrays to `addMesh`. The helper creates aligned glTF
accessors and checks that indices, counts, and float values are valid. Use
`addAccessor` for animation input/output data and `addImage` for embedded PNG or
JPEG bytes. The scene document remains plain glTF data, so standard nodes,
materials, cameras, animation channels, and extensions are easy to inspect or
extend. The builder owns binary packing and GLB chunk alignment.

An AI coding agent can edit the scene description and geometry in the `.ts`
source, run the two commands above, then load the generated GLB in the local
viewer. Source diffs are the review surface; the generated GLB can be regenerated
deterministically from the checked-in source and image asset.

## Give an agent a bounded task

For example:

> Create a small low-poly robot in TypeScript. Use `GlbBuilder` and the geometry
> helpers in `web/model-authoring.ts`; define named meshes, materials, and nodes
> in a `.ts` source file. Keep it around 2 world units tall, add a camera-facing
> key light, and use a limited color palette. Generate a GLB, run
> `npm --prefix web run test:model-authoring`, and open the asset in
> `/viewer/`. Do not hand-edit GLB bytes.

This keeps an agent's work in a reviewable text diff. Geometry is expressed as
vertices, normals, UVs, and indices, while the standard glTF document describes
materials, hierarchy, cameras, lights, and animations. The builder validates
mesh indices and accessor values and takes care of binary layout and alignment.
