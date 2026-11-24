// Type declarations for gs3d/physics — Rapier-style world over the engine
// physics solver. See physics.js for the scope notes.

import type { AssetError } from './assets.js';

export { AssetError };

export type Vec3 = [number, number, number];
export type Vec3Like = Vec3 | { x: number; y: number; z: number };

// Rapier RigidBodyType ordering.
export declare const BodyType: {
  readonly DYNAMIC: 0;
  readonly FIXED: 1;
  readonly KINEMATIC_POSITION: 2;
  readonly KINEMATIC_VELOCITY: 3;
};
export type BodyTypeValue = 0 | 1 | 2 | 3;

export interface PhysicsContact {
  a: number;
  b: number;
  normal: Vec3;
  point: Vec3;
  penetration: number;
}

export interface PhysicsRayHit {
  body: number;
  distance: number;
  point: Vec3;
  normal: Vec3;
}

export interface RaycastOptions {
  maxDist?: number;
  /** Body id or PhysicsBody to skip — Rapier's QueryFilter exclude. */
  exclude?: number | PhysicsBody;
}

export declare class ColliderDesc {
  private constructor();
  static cuboid(hx: number, hy: number, hz: number): ColliderDesc;
  static cuboid(halfExtents: Vec3): ColliderDesc;
  static ball(radius: number): ColliderDesc;
  static capsule(halfLength: number, radius: number): ColliderDesc;
  setMass(mass: number): this;
  setDensity(density: number): this;
  setFriction(friction: number): this;
  setRestitution(restitution: number): this;
}

export declare class RigidBodyDesc {
  readonly type: BodyTypeValue;
  private constructor(type: BodyTypeValue);
  static dynamic(): RigidBodyDesc;
  static fixed(): RigidBodyDesc;
  static kinematicVelocityBased(): RigidBodyDesc;
  static kinematicPositionBased(): RigidBodyDesc;
  setTranslation(x: number, y: number, z: number): this;
  setTranslation(v: Vec3Like): this;
  setRotation(euler: Vec3Like): this;
  setLinvel(v: Vec3Like): this;
  setAngvel(v: Vec3Like): this;
}

export declare class CollisionEventQueue {
  constructor();
  /** handler(bodyA, bodyB, started) for each pair that began/ended contact. */
  drainCollisionEvents(handler: (a: number, b: number, started: boolean) => void): void;
}

export interface AddBodyOptions {
  /** Engine node index the collider centers on (required). */
  node: number;
  /** ColliderDesc (required). */
  collider: ColliderDesc;
  /** RigidBodyDesc or plain {type, position, rotation, linvel, angvel}. */
  body?: RigidBodyDesc | {
    type?: BodyTypeValue;
    position?: Vec3Like;
    rotation?: Vec3Like;
    linvel?: Vec3Like;
    angvel?: Vec3Like;
  };
  type?: BodyTypeValue;
  position?: Vec3Like;
  rotation?: Vec3Like;
  /** Overrides collider mass/density. */
  mass?: number;
}

export declare class PhysicsBody {
  readonly world: PhysicsWorld;
  readonly id: number;

  translation(): Vec3;
  setTranslation(position: Vec3Like): void;
  rotation(): Vec3;
  setRotation(euler: Vec3Like): void;
  linvel(): Vec3;
  setLinvel(v: Vec3Like): void;
  angvel(): Vec3;
  setAngvel(v: Vec3Like): void;

  mass(): number;
  setMass(mass: number): void;
  isDynamic(): boolean;
  isKinematic(): boolean;
  setKinematic(kinematic: boolean): void;
  isFixed(): boolean;
  isSleeping(): boolean;
  sleep(): void;
  wakeUp(): void;
  setBodyType(type: BodyTypeValue): void;
  setNextKinematicTranslation(position: Vec3Like): void;

  applyImpulse(impulse: Vec3Like): void;
  applyImpulseAtPoint(impulse: Vec3Like, point: Vec3Like): void;
  addForce(force: Vec3Like): void;
  addTorque(torque: Vec3Like): void;
  resetForces(): void;
  resetTorques(): void;

  setFriction(friction: number): void;
  setRestitution(restitution: number): void;
  remove(): void;
}

export declare class PhysicsWorld {
  constructor(engine: any);
  dispose(): void;
  timestep: number;
  gravity: Vec3;
  /** Water surface height on world Y, or null when disabled. */
  waterLevel: number | null;

  setGravity(x: number, y: number, z: number): void;
  /** Set the water surface height on world Y; null disables water. */
  setWaterLevel(y: number | null): void;
  clearWater(): void;
  clear(): void;
  setTimestep(seconds: number): void;
  step(eventQueue?: CollisionEventQueue): void;

  addCuboid(node: number, halfExtents: Vec3Like, mass?: number): number;
  addBall(node: number, radius: number, mass?: number): number;
  addCapsule(node: number, halfLength: number, radius: number, mass?: number): number;
  addBody(options: AddBodyOptions): PhysicsBody;
  getBody(id: number): PhysicsBody;

  removeBody(body: number | PhysicsBody): void;
  removeRigidBody(body: number | PhysicsBody, wakeUp?: boolean): void;

  isDynamic(body: number): boolean;
  mass(body: number): number;
  isSleeping(body: number): boolean;
  sleep(body: number): void;
  wakeUp(body: number): void;
  addForce(body: number, force: Vec3Like): void;
  resetForce(body: number): void;
  resetTorque(body: number): void;

  translation(body: number): Vec3;
  setTranslation(body: number, position: Vec3Like): void;
  linvel(body: number): Vec3;
  setLinvel(body: number, velocity: Vec3Like): void;
  angvel(body: number): Vec3;
  setAngvel(body: number, angvel: Vec3Like): void;
  rotation(body: number): Vec3;
  setRotation(body: number, euler: Vec3Like): void;
  applyImpulse(body: number, impulse: Vec3Like): void;
  applyImpulseAtPoint(body: number, impulse: Vec3Like, point: Vec3Like): void;
  addTorque(body: number, torque: Vec3Like): void;
  setRestitution(body: number, value: number): void;
  setFriction(body: number, value: number): void;

  setKinematic(body: number, kinematic: boolean): void;
  isKinematic(body: number): boolean;
  setMass(body: number, mass: number): void;
  syncFromNode(body: number): void;
  contacts(): PhysicsContact[];
  raycast(origin: Vec3Like, direction: Vec3Like, options?: number | RaycastOptions): PhysicsRayHit | null;
  castRay(origin: Vec3Like, direction: Vec3Like, options?: number | RaycastOptions): PhysicsRayHit | null;
}
