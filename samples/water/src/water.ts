import * as THREE from 'gs3d/three';
import { PhysicsWorld } from 'gs3d/physics';
import {
  BALL_RADIUS,
  BOX_HALF,
  CAPSULE_HALF_LENGTH,
  CAPSULE_RADIUS,
  KIND_INFO,
  STONE_RADIUS,
  type SpawnKind,
} from './kinds';

export { KIND_INFO };
export type { SpawnKind };

interface Driver {
  object: THREE.Object3D;
  body: number;
}

// A body whose engine node does not exist yet: facade objects only get an
// engine node index during render(), so creation is deferred one frame.
interface Pending {
  object: THREE.Object3D;
  kind: 'pool' | SpawnKind;
  vx: number;
  vy: number;
  vz: number;
  age: number;
}

export interface WaterSandbox {
  readonly world: PhysicsWorld;
  /** Advance the simulation one fixed step and copy body transforms back. */
  step(): void;
  /** Drop a body at `at` (world units) or at a random spot above the water. */
  spawn(kind: SpawnKind, at?: [number, number, number]): void;
  /** Raycast into the world and drop a float ball on whatever it hits. */
  pickDrop(origin: [number, number, number], direction: [number, number, number]): boolean;
  /** Move the water surface; the visual plane follows on the next step. */
  setWaterLevel(y: number): void;
  clear(): void;
  readonly bodyCount: number;
  dispose(): void;
}

const KIND_COLOR: Record<SpawnKind, number> = {
  ball: 0x73d3b0,
  box: 0x8ca6ff,
  capsule: 0xffb35f,
  stone: 0x9aa3b2,
};

function kindGeometry(kind: SpawnKind): THREE.BufferGeometry {
  if (kind === 'ball') return new THREE.SphereGeometry(BALL_RADIUS, 20, 14);
  if (kind === 'box') return new THREE.BoxGeometry(BOX_HALF * 2, BOX_HALF * 2, BOX_HALF * 2);
  if (kind === 'capsule') return new THREE.CapsuleGeometry(CAPSULE_RADIUS, CAPSULE_HALF_LENGTH * 2, 6, 14);
  return new THREE.SphereGeometry(STONE_RADIUS, 20, 14);
}

function kindMaterial(kind: SpawnKind): THREE.MeshStandardMaterial {
  return new THREE.MeshStandardMaterial({
    color: KIND_COLOR[kind],
    roughness: kind === 'stone' ? 0.85 : 0.45,
    metalness: kind === 'stone' ? 0.05 : 0.1,
  });
}

// Collider dimensions mirror the visual geometry; mass comes from the
// kind's density so the same spawn code works for floaters and sinkers.
function addKindCollider(world: PhysicsWorld, kind: SpawnKind, node: number): number {
  const info = KIND_INFO[kind];
  const mass = info.density * info.volume;
  if (kind === 'ball') return world.addBall(node, BALL_RADIUS, mass);
  if (kind === 'box') return world.addCuboid(node, [BOX_HALF, BOX_HALF, BOX_HALF], mass);
  if (kind === 'capsule') return world.addCapsule(node, CAPSULE_HALF_LENGTH, CAPSULE_RADIUS, mass);
  return world.addBall(node, STONE_RADIUS, mass);
}

function randomSpawnPos(): [number, number, number] {
  return [
    (Math.random() - 0.5) * 7,
    1.5 + Math.random() * 1.5,
    (Math.random() - 0.5) * 7,
  ];
}

function randomVel(): [number, number, number] {
  return [(Math.random() - 0.5) * 1.0, 0, (Math.random() - 0.5) * 1.0];
}

const POOL_FLOOR_Y = -1.4;
const POOL_HALF = 8;

/**
 * A gs3d/physics water sandbox layered on the facade scene. A static pool
 * floor sits below the water plane; `world.setWaterLevel` drives buoyancy
 * and drag. Bodies attach to engine nodes the renderer creates for scene
 * objects — call step() once per frame before renderer.render().
 */
export function createWaterSandbox(
  scene: THREE.Scene,
  engine: unknown,
  waterMesh: THREE.Object3D,
): WaterSandbox {
  const world = new PhysicsWorld(engine);
  world.setGravity(0, -9.81, 0);
  world.setTimestep(1 / 60);
  world.setWaterLevel(0);

  const drivers: Driver[] = [];
  const pending: Pending[] = [];
  const spawned: { object: THREE.Object3D; body: number }[] = [];
  const pendingSpawns = new Set<Pending>();
  let disposed = false;
  let waterY = 0;

  function enqueue(object: THREE.Object3D, kind: Pending['kind'], vel: [number, number, number] = [0, 0, 0]): void {
    scene.add(object);
    const entry: Pending = { object, kind, vx: vel[0], vy: vel[1], vz: vel[2], age: 0 };
    pending.push(entry);
    if (kind !== 'pool') pendingSpawns.add(entry);
  }

  // Static pool floor: its visual box is exactly the collider volume.
  const pool = new THREE.Mesh(
    new THREE.BoxGeometry(POOL_HALF * 2, 0.4, POOL_HALF * 2),
    new THREE.MeshStandardMaterial({ color: 0x1a2433, roughness: 0.9, metalness: 0.05 }),
  );
  pool.position.y = POOL_FLOOR_Y - 0.2;
  pool.receiveShadow = true;
  enqueue(pool, 'pool');

  // A starter trio so the pool is alive before the first click.
  const firstBall = new THREE.Mesh(kindGeometry('ball'), kindMaterial('ball'));
  firstBall.position.set(-1.4, 2.2, 0.4);
  enqueue(firstBall, 'ball', [0.3, 0, -0.2]);
  const firstBox = new THREE.Mesh(kindGeometry('box'), kindMaterial('box'));
  firstBox.position.set(0.8, 2.6, -0.3);
  enqueue(firstBox, 'box', [-0.2, 0, 0.3]);
  const firstStone = new THREE.Mesh(kindGeometry('stone'), kindMaterial('stone'));
  firstStone.position.set(0.2, 3.0, 0.8);
  enqueue(firstStone, 'stone', [0.1, 0, -0.4]);

  function tryCreate(entry: Pending): boolean {
    const node = THREE.engineNodeIndex(entry.object);
    if (node < 0) {
      entry.age += 1;
      return entry.age > 600; // never synced (hidden/culled): give up
    }
    if (entry.kind === 'pool') {
      world.addCuboid(node, [POOL_HALF, 0.2, POOL_HALF], 0);
      drivers.push({ object: entry.object, body: -1 });
    } else {
      const body = addKindCollider(world, entry.kind, node);
      if (body >= 0) {
        world.setRestitution(body, 0.25);
        world.setFriction(body, 0.8);
        world.setLinvel(body, [entry.vx, entry.vy, entry.vz]);
        drivers.push({ object: entry.object, body });
        spawned.push({ object: entry.object, body });
      }
    }
    pendingSpawns.delete(entry);
    return true;
  }

  function spawn(kind: SpawnKind, at?: [number, number, number]): void {
    if (disposed) return;
    const pos = at ?? randomSpawnPos();
    const mesh = new THREE.Mesh(kindGeometry(kind), kindMaterial(kind));
    mesh.position.set(pos[0], pos[1], pos[2]);
    enqueue(mesh, kind, randomVel());
  }

  return {
    world,

    step() {
      if (disposed) return;
      for (let i = pending.length - 1; i >= 0; i--) {
        if (tryCreate(pending[i])) pending.splice(i, 1);
      }
      world.step();
      for (const d of drivers) {
        if (d.body < 0) continue;
        const t = world.translation(d.body);
        d.object.position.set(t[0], t[1], t[2]);
        const r = world.rotation(d.body);
        // Engine euler (Z then Y then X matrix order) == three 'ZYX' order.
        d.object.rotation.set(r[0], r[1], r[2], 'ZYX');
      }
      waterMesh.position.y = waterY;
    },

    spawn,

    pickDrop(origin, direction) {
      const hit = world.raycast(origin, direction, 80);
      if (!hit) return false;
      const [px, py, pz] = hit.point;
      const [nx, ny, nz] = hit.normal;
      spawn('ball', [px + nx * 0.4, py + ny * 0.4 + 0.2, pz + nz * 0.4]);
      return true;
    },

    setWaterLevel(y: number) {
      waterY = y;
      world.setWaterLevel(y);
    },

    clear() {
      for (const s of spawned) {
        world.removeBody(s.body);
        scene.remove(s.object);
      }
      spawned.length = 0;
      for (let i = drivers.length - 1; i >= 0; i--) {
        if (drivers[i].body >= 0) drivers.splice(i, 1);
      }
      for (const entry of pendingSpawns) scene.remove(entry.object);
      pendingSpawns.clear();
      for (let i = pending.length - 1; i >= 0; i--) {
        if (pending[i].kind !== 'pool') pending.splice(i, 1);
      }
    },

    get bodyCount() {
      return spawned.length + pendingSpawns.size;
    },

    dispose() {
      disposed = true;
      world.dispose();
    },
  };
}
