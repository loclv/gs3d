import * as THREE from 'gs3d/three';
import { PhysicsWorld } from 'gs3d/physics';

export type SpawnKind = 'ball' | 'box' | 'capsule';

interface Driver {
  object: THREE.Object3D;
  body: number;
}

// A body whose engine node does not exist yet: facade objects only get an
// engine node index during render(), so creation is deferred one frame.
interface Pending {
  object: THREE.Object3D;
  kind: 'floor' | 'spinner' | SpawnKind;
  vx: number;
  vy: number;
  vz: number;
  age: number;
}

export interface PhysicsSandbox {
  readonly world: PhysicsWorld;
  /** Advance the simulation one fixed step and copy body transforms back. */
  step(): void;
  /** Drop a body at `at` (world units) or at a random spot above the floor. */
  spawn(kind: SpawnKind, at?: [number, number, number]): void;
  /** Raycast into the world and drop a sphere on whatever it hits. */
  pickDrop(origin: [number, number, number], direction: [number, number, number]): boolean;
  setSpinner(on: boolean): void;
  clear(): void;
  readonly bodyCount: number;
  dispose(): void;
}

const KIND_COLOR: Record<SpawnKind, number> = {
  ball: 0x73d3b0,
  box: 0x8ca6ff,
  capsule: 0xffb35f,
};

function kindGeometry(kind: SpawnKind): THREE.BufferGeometry {
  if (kind === 'ball') return new THREE.SphereGeometry(0.3, 20, 14);
  if (kind === 'box') return new THREE.BoxGeometry(0.6, 0.6, 0.6);
  return new THREE.CapsuleGeometry(0.18, 0.5, 6, 14);
}

function kindMaterial(kind: SpawnKind): THREE.MeshStandardMaterial {
  return new THREE.MeshStandardMaterial({ color: KIND_COLOR[kind], roughness: 0.5, metalness: 0.1 });
}

// Collider dimensions mirror the visual geometry: ball r=0.3, box half=0.3,
// capsule radius 0.18 with a 0.5 cylinder section (half-length 0.25).
function addKindCollider(world: PhysicsWorld, kind: SpawnKind, node: number): number {
  if (kind === 'ball') return world.addBall(node, 0.3, 1);
  if (kind === 'box') return world.addCuboid(node, [0.3, 0.3, 0.3], 1.4);
  return world.addCapsule(node, 0.25, 0.18, 1);
}

function randomSpawnPos(): [number, number, number] {
  return [
    (Math.random() - 0.5) * 4.4,
    2.0 + Math.random() * 1.2,
    (Math.random() - 0.5) * 4.4,
  ];
}

function randomVel(): [number, number, number] {
  return [(Math.random() - 0.5) * 1.2, 0, (Math.random() - 0.5) * 1.2];
}

/**
 * A gs3d/physics sandbox layered on the facade scene. Bodies attach to the
 * engine nodes the renderer creates for scene objects, so physics objects
 * must stay direct children of the scene (parent transforms are not part of
 * the solver). Call step() once per frame before renderer.render().
 */
export function createPhysicsSandbox(scene: THREE.Scene, engine: unknown): PhysicsSandbox {
  const world = new PhysicsWorld(engine);
  world.setGravity(0, -9.81, 0);
  world.setTimestep(1 / 60);

  const drivers: Driver[] = [];
  const pending: Pending[] = [];
  const spawned: { object: THREE.Object3D; body: number }[] = [];
  const pendingSpawns = new Set<Pending>();
  let spinnerBody = -1;
  let disposed = false;

  function enqueue(object: THREE.Object3D, kind: Pending['kind'], vel: [number, number, number] = [0, 0, 0]): void {
    scene.add(object);
    const entry: Pending = { object, kind, vx: vel[0], vy: vel[1], vz: vel[2], age: 0 };
    pending.push(entry);
    if (kind !== 'floor' && kind !== 'spinner') pendingSpawns.add(entry);
  }

  // Static floor slab: its visual box is exactly the collider volume.
  const floor = new THREE.Mesh(
    new THREE.BoxGeometry(16, 0.2, 16),
    new THREE.MeshStandardMaterial({ color: 0x141a26, roughness: 0.9, metalness: 0.05 }),
  );
  floor.position.y = -0.1;
  floor.receiveShadow = true;
  enqueue(floor, 'floor');

  // Kinematic spinner: an arm that rotates forever and flings loose bodies.
  const spinner = new THREE.Mesh(
    new THREE.BoxGeometry(2.6, 0.18, 0.35),
    new THREE.MeshStandardMaterial({ color: 0x39445c, roughness: 0.5, metalness: 0.4 }),
  );
  spinner.position.set(0, 0.9, 0);
  enqueue(spinner, 'spinner');

  // A starter pile so the scene is alive before the first click.
  const firstBall = new THREE.Mesh(kindGeometry('ball'), kindMaterial('ball'));
  firstBall.position.set(-0.6, 2.4, 0.3);
  enqueue(firstBall, 'ball', [0.4, 0, -0.3]);
  const firstBox = new THREE.Mesh(kindGeometry('box'), kindMaterial('box'));
  firstBox.position.set(0.9, 2.8, 0.4);
  enqueue(firstBox, 'box', [-0.3, 0, 0.2]);
  const firstCapsule = new THREE.Mesh(kindGeometry('capsule'), kindMaterial('capsule'));
  firstCapsule.position.set(-1.2, 3.2, -0.6);
  enqueue(firstCapsule, 'capsule', [0.2, 0, -0.4]);

  function tryCreate(entry: Pending): boolean {
    const node = THREE.engineNodeIndex(entry.object);
    if (node < 0) {
      entry.age += 1;
      return entry.age > 600; // never synced (hidden/culled): give up
    }
    if (entry.kind === 'floor') {
      world.addCuboid(node, [8, 0.1, 8], 0);
    } else if (entry.kind === 'spinner') {
      const body = world.addCuboid(node, [1.3, 0.09, 0.175], 1);
      if (body >= 0) {
        world.setKinematic(body, true);
        world.setAngvel(body, [0, 1.4, 0]);
        spinnerBody = body;
        drivers.push({ object: entry.object, body });
      }
    } else {
      const body = addKindCollider(world, entry.kind, node);
      if (body >= 0) {
        world.setRestitution(body, 0.35);
        world.setFriction(body, 0.7);
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
        const t = world.translation(d.body);
        d.object.position.set(t[0], t[1], t[2]);
        const r = world.rotation(d.body);
        // Engine euler (Z then Y then X matrix order) == three 'ZYX' order.
        d.object.rotation.set(r[0], r[1], r[2], 'ZYX');
      }
    },

    spawn,

    pickDrop(origin, direction) {
      const hit = world.raycast(origin, direction, 80);
      if (!hit) return false;
      const [px, py, pz] = hit.point;
      const [nx, ny, nz] = hit.normal;
      spawn('ball', [px + nx * 0.35, py + ny * 0.35 + 0.15, pz + nz * 0.35]);
      return true;
    },

    setSpinner(on: boolean) {
      if (spinnerBody >= 0) world.setAngvel(spinnerBody, on ? [0, 1.4, 0] : [0, 0, 0]);
    },

    clear() {
      for (const s of spawned) {
        world.removeBody(s.body);
        scene.remove(s.object);
      }
      spawned.length = 0;
      // drivers holds the spinner plus spawned bodies; keep only the spinner.
      for (let i = drivers.length - 1; i >= 0; i--) {
        if (drivers[i].body !== spinnerBody) drivers.splice(i, 1);
      }
      // Pending spawns that never got a body just leave the scene.
      for (const entry of pendingSpawns) scene.remove(entry.object);
      pendingSpawns.clear();
      for (let i = pending.length - 1; i >= 0; i--) {
        if (pending[i].kind !== 'floor' && pending[i].kind !== 'spinner') pending.splice(i, 1);
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
