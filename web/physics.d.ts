// Type declarations for gs3d/physics — Rapier-style world over the engine
// physics solver. See physics.js for the scope notes.

import type { AssetError } from './assets.js';

export { AssetError };

export type Vec3 = [number, number, number];

export interface PhysicsContact {
  a: number;
  b: number;
  normal: Vec3;
  penetration: number;
}

export interface PhysicsRayHit {
  body: number;
  distance: number;
  point: Vec3;
  normal: Vec3;
}

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

  removeBody(body: number): void;
  setKinematic(body: number, kinematic: boolean): void;
  isKinematic(body: number): boolean;
  setMass(body: number, mass: number): void;
  syncFromNode(body: number): void;
  contacts(): PhysicsContact[];
  raycast(origin: Vec3, direction: Vec3, maxDist?: number): PhysicsRayHit | null;
}
