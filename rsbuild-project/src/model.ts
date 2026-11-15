import { boxGeometry, GlbBuilder, type Vec3 } from '../../web/model-authoring.ts';

export interface ModelPart {
  name: string;
  size: Vec3;
  position: Vec3;
  color: string;
}

export interface ModelPartPreview extends ModelPart {
  geometry: ReturnType<typeof boxGeometry>;
}

export interface AuthoredModel {
  parts: ModelPartPreview[];
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

/** Build a multipart prop and a standard glTF 2.0 binary GLB. */
export function authorModel(name: string, parts: readonly ModelPart[]): AuthoredModel {
  if (!parts.length) throw new Error('A model needs at least one part');
  const builder = new GlbBuilder();
  const previews = parts.map((part, index) => {
    const geometry = boxGeometry(part.size);
    const mesh = builder.addMesh({
      name: part.name,
      primitives: [{ geometry, material: index }],
    });
    return { ...part, geometry, mesh };
  });
  const glb = builder.encode({
    asset: { version: '2.0', generator: 'Rsbuild TypeScript model authoring sample' },
    materials: previews.map(part => ({
      name: `${part.name} paint`,
      pbrMetallicRoughness: {
        baseColorFactor: gltfColor(part.color),
        metallicFactor: 0.12,
        roughnessFactor: 0.38,
      },
    })),
    nodes: [
      { name, children: previews.map((_, index) => index + 1) },
      ...previews.map(part => ({ name: part.name, mesh: part.mesh, translation: part.position })),
    ],
    scenes: [{ nodes: [0] }],
    scene: 0,
  });
  const modelParts = previews.map(({ mesh: _mesh, ...part }) => part);
  return {
    parts: modelParts,
    glb,
    triangleCount: modelParts.reduce((total, part) => total + part.geometry.indices.length / 3, 0),
    vertexCount: modelParts.reduce((total, part) => total + part.geometry.positions.length, 0),
  };
}
