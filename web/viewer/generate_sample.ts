/**
 * Code-first source for the viewer's sample GLB. This is ordinary TypeScript:
 * change the scene data and geometry helpers, then run `npm run build:sample`
 * from web/. No Blender install, addon, or binary-offset editing is needed.
 */
import { readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { boxGeometry, GlbBuilder, planeGeometry, type GltfDocument } from '../model-authoring.ts';

const here = dirname(fileURLToPath(import.meta.url));
const outputPath = resolve(process.argv[2] ?? `${here}/sample.glb`);
const builder = new GlbBuilder();
const texture = builder.addImage(new Uint8Array(await readFile(`${here}/../game/ground.jpg`)), 'image/jpeg');

const turntableMesh = builder.addMesh({
  name: 'Textured turntable',
  primitives: [{
    geometry: boxGeometry([2, 2, 2]),
    material: 0,
    extensions: { KHR_materials_variants: { mappings: [{ material: 2, variants: [0] }] } },
  }],
});
const groundMesh = builder.addMesh({
  name: 'Ground',
  primitives: [{ geometry: planeGeometry(16, 16, -1.1), material: 1 }],
});

// Animation data uses the same typed accessor helper as mesh geometry.
const keyTimes = builder.addAccessor([0, 2, 4], 'SCALAR', 3, { min: [0], max: [4] });
const turntableRotation = builder.addAccessor([
  0, 0, 0, 1,
  0, 1, 0, 0,
  0, 0, 0, -1,
], 'VEC4', 3);
const bobTranslation = builder.addAccessor([0, 0, 0, 0, 0.6, 0, 0, 0, 0], 'VEC3', 3);

const document: GltfDocument = {
  asset: { version: '2.0', generator: 'goose-3d TypeScript model authoring' },
  images: [texture],
  textures: [{ source: 0 }],
  materials: [
    { pbrMetallicRoughness: { baseColorTexture: { index: 0 }, metallicFactor: 0.05, roughnessFactor: 0.35 } },
    { name: 'Shadow receiver', pbrMetallicRoughness: { baseColorFactor: [0.24, 0.29, 0.34, 1], metallicFactor: 0, roughnessFactor: 1 }, doubleSided: true },
    {
      name: 'Blue paint',
      pbrMetallicRoughness: { baseColorFactor: [0.12, 0.34, 0.92, 1], metallicFactor: 0.35, roughnessFactor: 0.24 },
      extensions: {
        KHR_materials_clearcoat: { clearcoatFactor: 0.8, clearcoatRoughnessFactor: 0.12 },
        KHR_materials_specular: { specularFactor: 0.9, specularColorFactor: [0.9, 0.95, 1] },
      },
    },
  ],
  cameras: [
    { name: 'Perspective', type: 'perspective', perspective: { yfov: 0.75, znear: 0.1, zfar: 100, aspectRatio: 1.6 } },
    { name: 'Orthographic', type: 'orthographic', orthographic: { xmag: 5.5, ymag: 3.5, znear: 0.1, zfar: 100 } },
  ],
  nodes: [
    { name: 'Textured turntable', mesh: turntableMesh },
    { name: 'Ground', mesh: groundMesh },
    { name: 'Perspective camera', camera: 0, translation: [0, 3.8, 8], rotation: [-0.21644, 0, 0, 0.97630] },
    { name: 'Orthographic camera', camera: 1, translation: [0, 3.8, 8], rotation: [-0.21644, 0, 0, 0.97630] },
    { name: 'Point key', translation: [2.5, 4, 3], extensions: { KHR_lights_punctual: { light: 0 } } },
    { name: 'Spot fill', translation: [-2.5, 5, 2], rotation: [-0.382683, 0, 0, 0.92388], extensions: { KHR_lights_punctual: { light: 1 } } },
  ],
  scenes: [{ nodes: [0, 1, 2, 3, 4, 5] }],
  scene: 0,
  extensionsUsed: ['KHR_lights_punctual', 'KHR_materials_variants', 'KHR_materials_clearcoat', 'KHR_materials_specular'],
  extensions: {
    KHR_lights_punctual: { lights: [
      { name: 'Point key', type: 'point', color: [1, 0.78, 0.58], intensity: 45, range: 18 },
      { name: 'Spot fill', type: 'spot', color: [0.56, 0.72, 1], intensity: 85, range: 20, spot: { innerConeAngle: 0.12, outerConeAngle: 0.7 } },
    ] },
    KHR_materials_variants: { variants: [{ name: 'Blue paint' }] },
  },
  animations: [
    { name: 'Turntable', samplers: [{ input: keyTimes, output: turntableRotation }], channels: [{ sampler: 0, target: { node: 0, path: 'rotation' } }] },
    { name: 'Bob', samplers: [{ input: keyTimes, output: bobTranslation }], channels: [{ sampler: 0, target: { node: 0, path: 'translation' } }] },
  ],
};

await writeFile(outputPath, builder.encode(document));
console.log(`Wrote ${outputPath}`);
