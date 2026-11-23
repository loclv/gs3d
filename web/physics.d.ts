// Type declarations for gs3d/physics — Rapier-style world over the engine
// physics solver. See physics.js for the scope notes.

import type { AssetError } from './assets.js';

export { AssetError };

export type Vec3 = [number, number, number];

export declare class PhysicsWorld {
  constructor(engine: any);
  dispose(): void;
  timestep: number;

  setGravity(x: number, y: number, z: number): void;
  clear(): void;
  setTimestep(seconds: number): void;
  step(): void;

  addCuboid(node: number, halfExtents: Vec3, mass?: number): number;
  addBall(node: number, radius: number, mass?: number): number;
  addCapsule(node: number, halfLength: number, radius: number, mass?: number): number;

  isDynamic(body: number): boolean;
  translation(body: number): Vec3;
  setTranslation(body: number, position: Vec3): void;
  linvel(body: number): Vec3;
  setLinvel(body: number, velocity: Vec3): void;
  applyImpulse(body: number, impulse: Vec3): void;
  setRestitution(body: number, value: number): void;
  setFriction(body: number, value: number): void;
}
