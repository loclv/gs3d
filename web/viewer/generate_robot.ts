/** Detailed, deterministic robot example. Run npm run build:robot from web/. */
import { writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { boxGeometry, GlbBuilder, type GltfDocument, type GltfNode, type Vec3 } from '../model-authoring.ts';

const here = dirname(fileURLToPath(import.meta.url));
const builder = new GlbBuilder();
const colors = [
  ['Ivory enamel', [0.78, 0.84, 0.82, 1], 0.35, 0.32],
  ['Midnight steel', [0.045, 0.075, 0.095, 1], 0.65, 0.34],
  ['Warm brass', [0.75, 0.38, 0.09, 1], 0.8, 0.25],
  ['Ocean blue', [0.035, 0.28, 0.38, 1], 0.45, 0.25],
  ['Luminous cyan', [0.1, 0.8, 0.9, 1], 0.15, 0.22],
] as const;
const materials = colors.map(([name, baseColorFactor, metallicFactor, roughnessFactor], i) => ({
  name, pbrMetallicRoughness: { baseColorFactor, metallicFactor, roughnessFactor },
  ...(i === 4 ? { emissiveFactor: [0.04, 0.38, 0.45] as Vec3 } : {}),
}));
const boxes = materials.map((_, material) => builder.addMesh({
  name: `Box: ${colors[material][0]}`, primitives: [{ geometry: boxGeometry([1, 1, 1]), material }],
}));
const nodes: GltfNode[] = [];
function part(name: string, material: number, translation: Vec3, scale: Vec3) {
  nodes.push({ name, mesh: boxes[material], translation, scale });
}
// The model faces +Z; every plate, joint and rivet remains independently inspectable.
part('Torso chassis', 1, [0, 1.65, 0], [1.05, 1.05, 0.52]);
part('Breastplate', 0, [0, 1.7, 0.29], [0.96, 0.91, 0.13]);
part('Chest inset', 3, [0, 1.76, 0.37], [0.56, 0.48, 0.05]);
part('Reactor rim', 2, [0, 1.8, 0.41], [0.27, 0.27, 0.05]);
part('Reactor core', 4, [0, 1.8, 0.445], [0.17, 0.17, 0.03]);
for (let i = 0; i < 5; i++) part(`Chest grille ${i + 1}`, 1, [(i - 2) * 0.105, 1.43, 0.375], [0.055, 0.08, 0.04]);
part('Waist', 2, [0, 1.02, 0], [0.63, 0.2, 0.42]);
part('Hip shell', 1, [0, 0.86, 0], [0.86, 0.24, 0.48]);
part('Neck', 2, [0, 2.27, 0], [0.26, 0.2, 0.26]);
part('Head chassis', 1, [0, 2.62, 0], [0.76, 0.58, 0.55]);
part('Helmet crown', 0, [0, 2.89, 0], [0.83, 0.14, 0.62]);
part('Face plate', 3, [0, 2.61, 0.295], [0.65, 0.38, 0.08]);
part('Visor surround', 1, [0, 2.68, 0.345], [0.58, 0.16, 0.04]);
for (const side of [-1, 1]) {
  const label = side < 0 ? 'Left' : 'Right';
  part(`${label} eye`, 4, [side * 0.15, 2.68, 0.373], [0.19, 0.075, 0.025]);
  part(`${label} ear`, 2, [side * 0.42, 2.62, 0], [0.12, 0.24, 0.29]);
  part(`${label} shoulder joint`, 2, [side * 0.63, 2.01, 0], [0.26, 0.28, 0.35]);
  part(`${label} shoulder armor`, 0, [side * 0.79, 2.02, 0], [0.35, 0.38, 0.57]);
  part(`${label} upper arm`, 3, [side * 0.81, 1.68, 0], [0.24, 0.38, 0.3]);
  part(`${label} elbow`, 2, [side * 0.81, 1.42, 0], [0.25, 0.16, 0.3]);
  part(`${label} forearm`, 0, [side * 0.81, 1.16, 0], [0.3, 0.39, 0.38]);
  part(`${label} wrist`, 2, [side * 0.81, 0.91, 0], [0.21, 0.12, 0.25]);
  part(`${label} hand`, 1, [side * 0.81, 0.76, 0.02], [0.29, 0.22, 0.29]);
  for (let j = 0; j < 3; j++) part(`${label} knuckle ${j + 1}`, 2, [side * 0.81 + (j - 1) * 0.085, 0.76, 0.18], [0.06, 0.1, 0.05]);
  part(`${label} thigh`, 0, [side * 0.27, 0.63, 0], [0.34, 0.39, 0.39]);
  part(`${label} knee`, 2, [side * 0.27, 0.39, 0.08], [0.3, 0.15, 0.4]);
  part(`${label} shin`, 3, [side * 0.27, 0.17, 0], [0.31, 0.32, 0.35]);
  part(`${label} shin plate`, 0, [side * 0.27, 0.18, 0.2], [0.26, 0.25, 0.08]);
  part(`${label} foot`, 1, [side * 0.27, -0.05, 0.1], [0.38, 0.16, 0.64]);
  part(`${label} toe cap`, 2, [side * 0.27, -0.02, 0.4], [0.34, 0.1, 0.08]);
  for (let j = 0; j < 3; j++) part(`${label} shoulder rivet ${j + 1}`, 2, [side * (0.7 + j * 0.09), 2.1, 0.3], [0.035, 0.035, 0.035]);
}
part('Antenna stem', 2, [0.25, 3.08, 0], [0.045, 0.3, 0.045]);
part('Antenna beacon', 4, [0.25, 3.25, 0], [0.1, 0.1, 0.1]);
part('Backpack', 3, [0, 1.72, -0.4], [0.65, 0.7, 0.3]);
for (let i = 0; i < 5; i++) part(`Backpack vent ${i + 1}`, 2, [(i - 2) * 0.11, 1.72, -0.56], [0.055, 0.43, 0.04]);
const document: GltfDocument = {
  asset: { version: '2.0', generator: 'goose-3d detailed robot example' },
  materials, nodes, scenes: [{ name: 'Robot', nodes: nodes.map((_, i) => i) }], scene: 0,
};
const output = resolve(process.argv[2] ?? `${here}/robot.glb`);
await writeFile(output, builder.encode(document));
console.log(`Wrote ${output} (${nodes.length} parts)`);
