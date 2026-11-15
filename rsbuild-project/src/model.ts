import { boxGeometry, GlbBuilder, type Vec3 } from '../../web/model-authoring.ts';

export interface BoxModelOptions {
  name: string;
  size: Vec3;
  color: string;
}

export interface AuthoredModel {
  geometry: ReturnType<typeof boxGeometry>;
  glb: Uint8Array;
  triangleCount: number;
  vertexCount: number;
}

function srgbChannelToLinear(value: number): number {
  const channel = value / 255;
  return channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
}

function gltfColor(hex: string): [number, number, number, number] {
  const match = /^#([\da-f]{6})$/i.exec(hex);
  if (!match) throw new Error(`Expected a six-digit hex color, got ${hex}`);
  const value = Number.parseInt(match[1], 16);
  return [
    srgbChannelToLinear((value >> 16) & 255),
    srgbChannelToLinear((value >> 8) & 255),
    srgbChannelToLinear(value & 255),
    1,
  ];
}

/** Build an editable box prop and a standard glTF 2.0 binary GLB. */
export function authorBox(options: BoxModelOptions): AuthoredModel {
  const geometry = boxGeometry(options.size);
  const builder = new GlbBuilder();
  const mesh = builder.addMesh({
    name: options.name,
    primitives: [{ geometry, material: 0 }],
  });
  const glb = builder.encode({
    asset: { version: '2.0', generator: 'Rsbuild TypeScript model authoring sample' },
    materials: [{
      name: `${options.name} paint`,
      pbrMetallicRoughness: {
        baseColorFactor: gltfColor(options.color),
        metallicFactor: 0.12,
        roughnessFactor: 0.38,
      },
    }],
    nodes: [{ name: options.name, mesh }],
    scenes: [{ nodes: [0] }],
    scene: 0,
  });
  return {
    geometry,
    glb,
    triangleCount: geometry.indices.length / 3,
    vertexCount: geometry.positions.length,
  };
}
