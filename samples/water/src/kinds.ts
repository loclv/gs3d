// Spawn-kind table shared by the sandbox and the Node test. Kept free of
// gs3d imports so `test-water.ts` can run it under plain Node.

export type SpawnKind = 'ball' | 'box' | 'capsule' | 'stone';

// Collider dimensions and densities. Buoyancy scales with volume / mass,
// so mass = density * volume gives the intended float/sink behaviour
// (water density is 1000 in the solver).
export const BALL_RADIUS = 0.3;
export const BOX_HALF = 0.3;
export const CAPSULE_HALF_LENGTH = 0.25;
export const CAPSULE_RADIUS = 0.18;
export const STONE_RADIUS = 0.35;

export const BALL_VOLUME = (4 / 3) * Math.PI * BALL_RADIUS ** 3;
export const BOX_VOLUME = (2 * BOX_HALF) ** 3;
export const CAPSULE_VOLUME =
  Math.PI * CAPSULE_RADIUS ** 2 * 2 * CAPSULE_HALF_LENGTH +
  (4 / 3) * Math.PI * CAPSULE_RADIUS ** 3;
export const STONE_VOLUME = (4 / 3) * Math.PI * STONE_RADIUS ** 3;

// Anything under ~950 floats, over ~1050 sinks; 350 bobs nicely.
export const FLOAT_DENSITY = 350;
export const STONE_DENSITY = 2600;

export const KIND_INFO: Record<SpawnKind, { label: string; density: number; volume: number }> = {
  ball: { label: 'Float ball', density: FLOAT_DENSITY, volume: BALL_VOLUME },
  box: { label: 'Float box', density: FLOAT_DENSITY, volume: BOX_VOLUME },
  capsule: { label: 'Float capsule', density: FLOAT_DENSITY, volume: CAPSULE_VOLUME },
  stone: { label: 'Stone', density: STONE_DENSITY, volume: STONE_VOLUME },
};
