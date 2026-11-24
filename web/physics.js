// Rapier-style physics for the gs3d engine host.
//
// `import { PhysicsWorld, RigidBodyDesc, ColliderDesc } from 'gs3d/physics'`
// mirrors @dimforge/rapier3d-compat and three.js' RapierPhysics addon:
// descriptor objects describe bodies and colliders, world.step() advances
// the simulation, and bodies are handles with Rapier-style methods.
//
// Bodies attach to engine node indices (the values g3_asset_node returns or
// isNodeHandleValid accepts), not to Three.js Object3Ds — read translation()
// after step() and write it back to your scene objects yourself, the same
// way RapierPhysics copies body.translation() onto mesh.position.
//
// The solver has exactly one collider per body, so Rapier's two-step
// createRigidBody + createCollider is combined into world.addBody(desc).
// ColliderDesc covers cuboid/ball/capsule with mass, density, friction and
// restitution; collider-local offsets are not supported — the collider is
// centered on the body. Capsules run along the body's local Y.
//
// Body types follow Rapier: DYNAMIC integrates under gravity and forces,
// FIXED is immovable (mass 0), KINEMATIC_POSITION/VELOCITY follow velocity
// exactly — no gravity, forces or impulses — but still push dynamic bodies.
// setNextKinematicTranslation() is the position-based kinematic analogue.
//
// Contacts detected during the last step() are available through contacts()
// (with world-space contact points). Pass a CollisionEventQueue to step()
// for Rapier-style collisionStarted/collisionStopped callbacks. raycast()
// (alias castRay) supports { maxDist, exclude } like Rapier's QueryFilter
// for self-hits. Bodies sleep automatically after ~0.5 s under the velocity
// thresholds; isSleeping()/sleep()/wakeUp() give explicit control, and
// impulses, forces and impacts wake them.

import { AssetError } from './assets.js';

const SCRATCH_FLOATS = 12;

// Goose slice parameters lower to a pointer to a 16-byte header in wasm
// memory: { float* data @0, i64 len @8 } (sl_f32 in the generated C). The
// wasm export takes the header address as a single i32 — passing
// (ptr, len) as separate arguments reads garbage and crashes.
const SLICE_HEADER_BYTES = 16;

// Rapier RigidBodyType ordering.
export const BodyType = Object.freeze({
  DYNAMIC: 0,
  FIXED: 1,
  KINEMATIC_POSITION: 2,
  KINEMATIC_VELOCITY: 3,
});

function isKinematicType(type) {
  return type === BodyType.KINEMATIC_POSITION || type === BodyType.KINEMATIC_VELOCITY;
}

function requirePhysics(engine) {
  if (!engine || typeof engine._g3_phys_world_step !== 'function') {
    throw new AssetError('UNSUPPORTED', 'This engine build does not export physics; use the gs3d package host (gs3d/app.js).');
  }
}

function requireExport(engine, name) {
  if (typeof engine[name] !== 'function') {
    throw new AssetError('UNSUPPORTED', `This engine build does not export ${name}; rebuild the gs3d wasm.`);
  }
}

// Accept [x, y, z] arrays and Rapier-style {x, y, z} objects.
function vec3(v, name = 'vector') {
  if (Array.isArray(v)) return v;
  if (v && typeof v === 'object' && typeof v.x === 'number') return [v.x, v.y, v.z];
  throw new AssetError('INVALID', `${name} must be [x, y, z] or {x, y, z}`);
}

// ColliderDesc.cuboid(hx, hy, hz) / .ball(radius) / .capsule(halfLength,
// radius) with Rapier's chainable setters. `mass` wins over `density`;
// with neither, density defaults to 1.0 like Rapier.
export class ColliderDesc {
  constructor(kind, dims) {
    this.kind = kind;
    this.dims = dims;
    this.mass = undefined;
    this.density = undefined;
    this.friction = undefined;
    this.restitution = undefined;
  }

  static cuboid(hx, hy, hz) {
    if (Array.isArray(hx)) [hx, hy, hz] = hx;
    return new ColliderDesc('cuboid', [hx, hy, hz]);
  }

  static ball(radius) { return new ColliderDesc('ball', [radius]); }

  // Rapier's capsule(halfHeight, radius): halfHeight is the cylinder
  // half-length, caps add `radius` on each end. Axis is local Y.
  static capsule(halfLength, radius) { return new ColliderDesc('capsule', [halfLength, radius]); }

  setMass(mass) { this.mass = mass; return this; }
  setDensity(density) { this.density = density; return this; }
  setFriction(friction) { this.friction = friction; return this; }
  setRestitution(restitution) { this.restitution = restitution; return this; }

  // World-space collider volume, for density -> mass.
  volume() {
    if (this.kind === 'cuboid') {
      const [hx, hy, hz] = this.dims;
      return 8 * hx * hy * hz;
    }
    if (this.kind === 'ball') {
      const r = this.dims[0];
      return (4 / 3) * Math.PI * r * r * r;
    }
    const [halfLength, radius] = this.dims;
    return Math.PI * radius * radius * 2 * halfLength + (4 / 3) * Math.PI * radius * radius * radius;
  }
}

// RigidBodyDesc.dynamic() / .fixed() / .kinematicVelocityBased() /
// .kinematicPositionBased() with Rapier's chainable initial-state setters.
// The node a body attaches to is an engine concept, so it is passed to
// world.addBody separately rather than on the descriptor.
export class RigidBodyDesc {
  constructor(type) {
    this.type = type;
    this.position = undefined;
    this.rotation = undefined;
    this.linvel = undefined;
    this.angvel = undefined;
  }

  static dynamic() { return new RigidBodyDesc(BodyType.DYNAMIC); }
  static fixed() { return new RigidBodyDesc(BodyType.FIXED); }
  static kinematicVelocityBased() { return new RigidBodyDesc(BodyType.KINEMATIC_VELOCITY); }
  static kinematicPositionBased() { return new RigidBodyDesc(BodyType.KINEMATIC_POSITION); }

  setTranslation(x, y, z) {
    if (y === undefined) this.position = vec3(x, 'position');
    else this.position = [x, y, z];
    return this;
  }

  setRotation(euler) { this.rotation = vec3(euler, 'rotation'); return this; }
  setLinvel(v) { this.linvel = vec3(v, 'linvel'); return this; }
  setAngvel(v) { this.angvel = vec3(v, 'angvel'); return this; }
}

// Rapier-style collision events. Pass an instance to world.step();
// drainCollisionEvents(handler) calls handler(bodyA, bodyB, started)
// for every pair that began or ended contact during that step.
export class CollisionEventQueue {
  constructor() { this._events = []; }

  drainCollisionEvents(handler) {
    const events = this._events;
    this._events = [];
    for (const e of events) handler(e.a, e.b, e.started);
  }

  _push(started, stopped) {
    for (const p of started) this._events.push({ a: p[0], b: p[1], started: true });
    for (const p of stopped) this._events.push({ a: p[0], b: p[1], started: false });
  }
}

// A live physics body — the Rapier RigidBody analogue. Obtained from
// world.addBody() or world.getBody(); methods throw AssetError on stale
// or removed ids.
export class PhysicsBody {
  constructor(world, id) {
    this.world = world;
    this.id = id;
    // Last non-fixed mass seen, so setBodyType can restore it.
    this._restorableMass = undefined;
  }

  _check() {
    if (!this.world._bodyExists(this.id)) {
      throw new AssetError('INVALID', `Unknown physics body ${this.id}`);
    }
  }

  translation() { this._check(); return this.world.translation(this.id); }
  setTranslation(position) { this._check(); this.world.setTranslation(this.id, vec3(position, 'position')); }
  rotation() { this._check(); return this.world.rotation(this.id); }
  setRotation(euler) { this._check(); this.world.setRotation(this.id, vec3(euler, 'rotation')); }
  linvel() { this._check(); return this.world.linvel(this.id); }
  setLinvel(v) { this._check(); this.world.setLinvel(this.id, vec3(v, 'linvel')); }
  angvel() { this._check(); return this.world.angvel(this.id); }
  setAngvel(v) { this._check(); this.world.setAngvel(this.id, vec3(v, 'angvel')); }

  mass() { this._check(); return this.world.mass(this.id); }
  setMass(mass) { this._check(); this.world.setMass(this.id, mass); if (mass > 0) this._restorableMass = mass; }

  isDynamic() { return this.world.isDynamic(this.id); }
  isKinematic() { return this.world.isKinematic(this.id); }
  setKinematic(kinematic) { this._check(); this.world.setKinematic(this.id, kinematic); }
  isFixed() { return !this.isDynamic() && !this.isKinematic(); }
  isSleeping() { this._check(); requireExport(this.world.engine, '_g3_phys_body_is_sleeping'); return this.world.isSleeping(this.id); }
  sleep() { this._check(); requireExport(this.world.engine, '_g3_phys_body_sleep'); this.world.sleep(this.id); }
  wakeUp() { this._check(); requireExport(this.world.engine, '_g3_phys_body_wake'); this.world.wakeUp(this.id); }

  // RigidBodyDesc.setBodyType. FIXED stores the current mass so a later
  // switch back to DYNAMIC restores it, like Rapier's mass properties.
  setBodyType(type) {
    this._check();
    if (type === BodyType.FIXED) {
      const m = this.mass();
      if (m > 0) this._restorableMass = m;
      this.world.setMass(this.id, 0);
      this.world.setKinematic(this.id, false);
    } else if (isKinematicType(type)) {
      this.world.setKinematic(this.id, true);
    } else if (type === BodyType.DYNAMIC) {
      this.world.setKinematic(this.id, false);
      const m = this.mass();
      if (m === 0 && this._restorableMass) this.world.setMass(this.id, this._restorableMass);
    } else {
      throw new AssetError('INVALID', `Unknown body type ${type}`);
    }
  }

  // Kinematic position-based bodies: the next step moves the body to
  // `position`. Implemented as the velocity that covers the distance in
  // one timestep — equivalent end pose when unobstructed.
  setNextKinematicTranslation(position) {
    this._check();
    const target = vec3(position, 'position');
    const cur = this.translation();
    const dt = this.world.timestep;
    this.setLinvel([(target[0] - cur[0]) / dt, (target[1] - cur[1]) / dt, (target[2] - cur[2]) / dt]);
  }

  applyImpulse(impulse) { this._check(); this.world.applyImpulse(this.id, vec3(impulse, 'impulse')); }
  applyImpulseAtPoint(impulse, point) { this._check(); this.world.applyImpulseAtPoint(this.id, vec3(impulse, 'impulse'), vec3(point, 'point')); }
  addForce(force) { this._check(); requireExport(this.world.engine, '_g3_phys_body_add_force'); this.world.addForce(this.id, vec3(force, 'force')); }
  addTorque(torque) { this._check(); this.world.addTorque(this.id, vec3(torque, 'torque')); }
  resetForces() { this._check(); requireExport(this.world.engine, '_g3_phys_body_reset_force'); this.world.resetForce(this.id); }
  resetTorques() { this._check(); requireExport(this.world.engine, '_g3_phys_body_reset_torque'); this.world.resetTorque(this.id); }

  // Collider friction/restitution live on the body (one collider each).
  setFriction(friction) { this._check(); this.world.setFriction(this.id, friction); }
  setRestitution(restitution) { this._check(); this.world.setRestitution(this.id, restitution); }

  // world.removeRigidBody.
  remove() { this.world.removeBody(this.id); }
}

export class PhysicsWorld {
  constructor(engine) {
    requirePhysics(engine);
    this.engine = engine;
    this._scratch = engine._malloc(SCRATCH_FLOATS * 4);
    if (!this._scratch) throw new AssetError('MEMORY', 'Could not allocate physics scratch buffer');
    this._sliceHeader = engine._malloc(SLICE_HEADER_BYTES);
    if (!this._sliceHeader) throw new AssetError('MEMORY', 'Could not allocate physics slice header');
    this._timestep = 1 / 60;
    this._gravity = [0, -9.81, 0];
    // body-id pair keys -> [a, b] seen during the previous step, for
    // collision started/stopped events.
    this._contactPairs = new Map();
    // Tombstoned body ids — the wasm side keeps slots valid, so track
    // removals here to make stale PhysicsBody handles fail fast.
    this._removed = new Set();
    engine._g3_phys_set_timestep(this._timestep);
  }

  // world.timestep — seconds simulated per step() call.
  get timestep() { return this._timestep; }
  set timestep(seconds) { this.setTimestep(seconds); }

  // world.gravity — acceleration applied to dynamic bodies each step.
  get gravity() { return this._gravity.slice(); }
  set gravity(g) { this.setGravity(...vec3(g, 'gravity')); }

  dispose() {
    if (this._sliceHeader) { this.engine._free(this._sliceHeader); this._sliceHeader = 0; }
    if (this._scratch) { this.engine._free(this._scratch); this._scratch = 0; }
  }

  // Pass `out` slices to wasm exports: writes the {data, len} header fresh
  // each call so memory growth (which detaches HEAP views) cannot stale it.
  _sliceArg() {
    const header = new DataView(this.engine.HEAPU8.buffer, this._sliceHeader, SLICE_HEADER_BYTES);
    header.setUint32(0, this._scratch, true);
    header.setBigUint64(8, BigInt(SCRATCH_FLOATS), true);
    return this._sliceHeader;
  }

  _vec3(offset = 0) {
    return new Float32Array(this.engine.HEAPF32.buffer, this._scratch + offset * 4, 3);
  }

  setGravity(x, y, z) {
    this.engine._g3_phys_set_gravity(x, y, z);
    this._gravity = [x, y, z];
  }

  clear() {
    this.engine._g3_phys_clear();
    this._contactPairs = new Map();
    this._removed = new Set();
  }

  setTimestep(seconds) {
    if (!(seconds > 0) || seconds > 1) throw new AssetError('INVALID', 'timestep must be in (0, 1] seconds');
    this._timestep = seconds;
    this.engine._g3_phys_set_timestep(seconds);
  }

  // world.step() — optionally pass a CollisionEventQueue for
  // collisionStarted/collisionStopped events.
  step(eventQueue) {
    this.engine._g3_phys_world_step();
    if (eventQueue) this._diffContacts(eventQueue);
  }

  // ColliderDesc.cuboid(hx, hy, hz) + RigidBodyDesc mass: 0 is fixed,
  // mass > 0 is dynamic. Returns a body id.
  addCuboid(node, halfExtents, mass = 0) {
    const [hx, hy, hz] = vec3(halfExtents, 'halfExtents');
    const id = this.engine._g3_phys_body_cuboid(node, hx, hy, hz, mass);
    if (id < 0) throw new AssetError('INVALID', 'Could not create cuboid body');
    return id;
  }

  // ColliderDesc.ball(radius).
  addBall(node, radius, mass = 0) {
    const id = this.engine._g3_phys_body_ball(node, radius, mass);
    if (id < 0) throw new AssetError('INVALID', 'Could not create ball body');
    return id;
  }

  // ColliderDesc.capsule(halfLength, radius) — along the body's local Y.
  addCapsule(node, halfLength, radius, mass = 0) {
    const id = this.engine._g3_phys_body_capsule(node, halfLength, radius, mass);
    if (id < 0) throw new AssetError('INVALID', 'Could not create capsule body');
    return id;
  }

  // world.addBody — Rapier's createRigidBody + createCollider combined
  // (the solver has one collider per body). Options:
  //   node      engine node index the collider centers on (required)
  //   collider  ColliderDesc (required)
  //   body / desc  RigidBodyDesc or plain {type, position, rotation,
  //             linvel, angvel} initial state
  //   type      BodyType (default DYNAMIC; FIXED forces mass 0)
  //   mass      overrides collider mass/density
  // Returns a PhysicsBody handle.
  addBody(options = {}) {
    const collider = options.collider;
    if (!collider || !(collider instanceof ColliderDesc)) {
      throw new AssetError('INVALID', 'addBody requires options.collider (a ColliderDesc)');
    }
    const node = options.node;
    const desc = options.body ?? options.desc ?? new RigidBodyDesc(BodyType.DYNAMIC);
    const type = options.type ?? desc.type ?? BodyType.DYNAMIC;

    let colliderMass = options.mass ?? collider.mass;
    if (colliderMass === undefined) {
      const density = collider.density ?? 1.0;
      colliderMass = density * collider.volume();
    }
    const mass = type === BodyType.FIXED ? 0 : colliderMass;

    let id;
    if (collider.kind === 'cuboid') {
      const [hx, hy, hz] = collider.dims;
      id = this.engine._g3_phys_body_cuboid(node, hx, hy, hz, mass);
    } else if (collider.kind === 'ball') {
      id = this.engine._g3_phys_body_ball(node, collider.dims[0], mass);
    } else {
      id = this.engine._g3_phys_body_capsule(node, collider.dims[0], collider.dims[1], mass);
    }
    if (id < 0) throw new AssetError('INVALID', 'Could not create physics body');

    const body = new PhysicsBody(this, id);
    if (colliderMass > 0) body._restorableMass = colliderMass;
    if (collider.friction !== undefined) body.setFriction(collider.friction);
    if (collider.restitution !== undefined) body.setRestitution(collider.restitution);
    if (type !== BodyType.DYNAMIC) body.setKinematic(isKinematicType(type));

    if (desc.position !== undefined) body.setTranslation(desc.position);
    if (desc.rotation !== undefined) body.setRotation(desc.rotation);
    if (desc.linvel !== undefined) body.setLinvel(desc.linvel);
    if (desc.angvel !== undefined) body.setAngvel(desc.angvel);
    if (options.position !== undefined) body.setTranslation(options.position);
    if (options.rotation !== undefined) body.setRotation(options.rotation);
    return body;
  }

  // Look up a PhysicsBody handle for an id from addBody/add* or contacts.
  getBody(id) { return new PhysicsBody(this, id); }

  _bodyExists(id) {
    return Number.isInteger(id) && id >= 0 && !this._removed.has(id) &&
      !!this.engine._g3_phys_body_pos(id, this._sliceArg());
  }

  // world.removeRigidBody — tombstones the body; other ids stay valid.
  // Accepts a body id or a PhysicsBody handle.
  removeBody(body) {
    requireExport(this.engine, '_g3_phys_body_remove');
    const id = body instanceof PhysicsBody ? body.id : body;
    if (!this.engine._g3_phys_body_remove(id)) {
      throw new AssetError('INVALID', `Unknown physics body ${id}`);
    }
    this._removed.add(id);
  }

  removeRigidBody(body, _wakeUp = true) { this.removeBody(body); }

  _diffContacts(queue) {
    const curr = new Map();
    for (const c of this.contacts()) {
      const key = c.a < c.b ? `${c.a}:${c.b}` : `${c.b}:${c.a}`;
      if (!curr.has(key)) curr.set(key, [Math.min(c.a, c.b), Math.max(c.a, c.b)]);
    }
    const started = [];
    const stopped = [];
    for (const [key, pair] of curr) {
      if (!this._contactPairs.has(key)) started.push(pair);
    }
    for (const [key, pair] of this._contactPairs) {
      if (!curr.has(key)) stopped.push(pair);
    }
    this._contactPairs = curr;
    queue._push(started, stopped);
  }

  isDynamic(body) { return !!this.engine._g3_phys_body_dynamic(body); }
  mass(body) {
    requireExport(this.engine, '_g3_phys_body_mass');
    return this.engine._g3_phys_body_mass(body);
  }
  isSleeping(body) {
    requireExport(this.engine, '_g3_phys_body_is_sleeping');
    return !!this.engine._g3_phys_body_is_sleeping(body);
  }
  sleep(body) {
    requireExport(this.engine, '_g3_phys_body_sleep');
    if (!this.engine._g3_phys_body_sleep(body)) {
      throw new AssetError('INVALID', `Cannot sleep body ${body} (unknown, fixed or kinematic)`);
    }
  }
  wakeUp(body) {
    requireExport(this.engine, '_g3_phys_body_wake');
    if (!this.engine._g3_phys_body_wake(body)) {
      throw new AssetError('INVALID', `Unknown physics body ${body}`);
    }
  }
  addForce(body, force) {
    requireExport(this.engine, '_g3_phys_body_add_force');
    const [x, y, z] = vec3(force, 'force');
    if (!this.engine._g3_phys_body_add_force(body, x, y, z)) {
      throw new AssetError('INVALID', `Cannot force body ${body} (unknown or fixed)`);
    }
  }
  resetForce(body) {
    requireExport(this.engine, '_g3_phys_body_reset_force');
    if (!this.engine._g3_phys_body_reset_force(body)) {
      throw new AssetError('INVALID', `Unknown physics body ${body}`);
    }
  }
  resetTorque(body) {
    requireExport(this.engine, '_g3_phys_body_reset_torque');
    if (!this.engine._g3_phys_body_reset_torque(body)) {
      throw new AssetError('INVALID', `Unknown physics body ${body}`);
    }
  }

  // body.translation() -> [x, y, z]
  translation(body) {
    if (!this.engine._g3_phys_body_pos(body, this._sliceArg())) {
      throw new AssetError('INVALID', `Unknown physics body ${body}`);
    }
    const v = this._vec3();
    return [v[0], v[1], v[2]];
  }

  // body.setTranslation() — teleports and zeroes velocity.
  setTranslation(body, position) {
    const [x, y, z] = vec3(position, 'position');
    if (!this.engine._g3_phys_body_set_pos(body, x, y, z)) {
      throw new AssetError('INVALID', `Unknown physics body ${body}`);
    }
  }

  // body.linvel() -> [x, y, z]
  linvel(body) {
    if (!this.engine._g3_phys_body_vel(body, this._sliceArg())) {
      throw new AssetError('INVALID', `Unknown physics body ${body}`);
    }
    const v = this._vec3();
    return [v[0], v[1], v[2]];
  }

  // body.setLinvel()
  setLinvel(body, velocity) {
    const [x, y, z] = vec3(velocity, 'velocity');
    if (!this.engine._g3_phys_body_set_vel(body, x, y, z)) {
      throw new AssetError('INVALID', `Unknown physics body ${body}`);
    }
  }

  // body.applyImpulse() — instantaneous velocity change; dynamic bodies only.
  applyImpulse(body, impulse) {
    const [x, y, z] = vec3(impulse, 'impulse');
    if (!this.engine._g3_phys_body_apply_impulse(body, x, y, z)) {
      throw new AssetError('INVALID', `Cannot impulse body ${body} (unknown or fixed)`);
    }
  }

  // body.applyImpulseAtPoint(impulse, point) — linear plus angular impulse.
  applyImpulseAtPoint(body, impulse, point) {
    requireExport(this.engine, '_g3_phys_body_apply_impulse_at');
    const [jx, jy, jz] = vec3(impulse, 'impulse');
    const [px, py, pz] = vec3(point, 'point');
    if (!this.engine._g3_phys_body_apply_impulse_at(body, jx, jy, jz, px, py, pz)) {
      throw new AssetError('INVALID', `Cannot impulse body ${body} (unknown or fixed)`);
    }
  }

  // body.addForce() — accumulated world-frame force for the next step,
  // cleared when the step finishes. Dynamic bodies only.
  // body.addTorque() — same for world-frame torque.
  addTorque(body, torque) {
    requireExport(this.engine, '_g3_phys_body_apply_torque');
    const [x, y, z] = vec3(torque, 'torque');
    if (!this.engine._g3_phys_body_apply_torque(body, x, y, z)) {
      throw new AssetError('INVALID', `Cannot torque body ${body} (unknown or fixed)`);
    }
  }

  // body.angvel() -> [x, y, z] world-frame rad/s.
  angvel(body) {
    requireExport(this.engine, '_g3_phys_body_angvel');
    if (!this.engine._g3_phys_body_angvel(body, this._sliceArg())) {
      throw new AssetError('INVALID', `Unknown physics body ${body}`);
    }
    const v = this._vec3();
    return [v[0], v[1], v[2]];
  }

  setAngvel(body, angvel) {
    requireExport(this.engine, '_g3_phys_body_set_angvel');
    const [x, y, z] = vec3(angvel, 'angvel');
    if (!this.engine._g3_phys_body_set_angvel(body, x, y, z)) {
      throw new AssetError('INVALID', `Unknown physics body ${body}`);
    }
  }

  // body.rotation() -> [x, y, z] euler radians, node convention.
  rotation(body) {
    requireExport(this.engine, '_g3_phys_body_rot');
    if (!this.engine._g3_phys_body_rot(body, this._sliceArg())) {
      throw new AssetError('INVALID', `Unknown physics body ${body}`);
    }
    const v = this._vec3();
    return [v[0], v[1], v[2]];
  }

  // body.setRotation(euler) — teleports orientation, zeroes angvel,
  // keeps linvel, and updates the node immediately.
  setRotation(body, euler) {
    requireExport(this.engine, '_g3_phys_body_set_rot');
    const [x, y, z] = vec3(euler, 'euler');
    if (!this.engine._g3_phys_body_set_rot(body, x, y, z)) {
      throw new AssetError('INVALID', `Unknown physics body ${body}`);
    }
  }

  setRestitution(body, value) {
    if (!this.engine._g3_phys_body_set_restitution(body, value)) {
      throw new AssetError('INVALID', `Unknown physics body ${body} or restitution outside [0, 1]`);
    }
  }

  setFriction(body, value) {
    if (!this.engine._g3_phys_body_set_friction(body, value)) {
      throw new AssetError('INVALID', `Unknown physics body ${body} or friction outside [0, 1]`);
    }
  }

  // RigidBodyDesc.setBodyType — kinematic bodies follow linvel exactly and
  // push dynamic bodies without being pushed back.
  setKinematic(body, kinematic) {
    requireExport(this.engine, '_g3_phys_body_set_kinematic');
    if (!this.engine._g3_phys_body_set_kinematic(body, !!kinematic)) {
      throw new AssetError('INVALID', `Unknown physics body ${body}`);
    }
  }

  isKinematic(body) {
    requireExport(this.engine, '_g3_phys_body_kinematic');
    return !!this.engine._g3_phys_body_kinematic(body);
  }

  // Change mass after creation; 0 makes the body fixed.
  setMass(body, mass) {
    requireExport(this.engine, '_g3_phys_body_set_mass');
    if (!this.engine._g3_phys_body_set_mass(body, mass)) {
      throw new AssetError('INVALID', `Unknown physics body ${body} or mass out of range`);
    }
  }

  // Copy the node's current position and rotation into the body — call
  // after moving the node directly, or the next step() writes the body's
  // stale transform back.
  syncFromNode(body) {
    requireExport(this.engine, '_g3_phys_body_sync');
    if (!this.engine._g3_phys_body_sync(body)) {
      throw new AssetError('INVALID', `Unknown physics body ${body}`);
    }
  }

  // Contacts detected during the last step():
  // [{a, b, normal, point, penetration}] — point is world-space.
  contacts() {
    requireExport(this.engine, '_g3_phys_contact_count');
    const count = this.engine._g3_phys_contact_count();
    const out = [];
    for (let i = 0; i < count; i++) {
      if (!this.engine._g3_phys_contact(i, this._sliceArg())) break;
      const v = new Float32Array(this.engine.HEAPF32.buffer, this._scratch, 9);
      out.push({
        a: v[0],
        b: v[1],
        normal: [v[2], v[3], v[4]],
        point: [v[5], v[6], v[7]],
        penetration: v[8],
      });
    }
    return out;
  }

  // world.castRay — nearest hit along origin + direction * t.
  // `options` is a max distance (number) or { maxDist, exclude } where
  // exclude is a body id or PhysicsBody to skip (self-hits).
  // `direction` need not be normalized.
  // Returns {body, distance, point, normal} or null.
  raycast(origin, direction, options = {}) {
    requireExport(this.engine, '_g3_phys_raycast');
    const [ox, oy, oz] = vec3(origin, 'origin');
    const [dx, dy, dz] = vec3(direction, 'direction');
    const opts = typeof options === 'number' ? { maxDist: options } : options;
    const maxDist = opts.maxDist ?? opts.maxToi ?? 1000;
    const exclude = opts.exclude instanceof PhysicsBody ? opts.exclude.id : (opts.exclude ?? -1);
    let ok;
    if (exclude >= 0) {
      requireExport(this.engine, '_g3_phys_raycast_filtered');
      ok = this.engine._g3_phys_raycast_filtered(ox, oy, oz, dx, dy, dz, maxDist, exclude, this._sliceArg());
    } else {
      ok = this.engine._g3_phys_raycast(ox, oy, oz, dx, dy, dz, maxDist, this._sliceArg());
    }
    if (!ok) return null;
    const v = new Float32Array(this.engine.HEAPF32.buffer, this._scratch, 8);
    return {
      body: v[0],
      distance: v[1],
      point: [v[2], v[3], v[4]],
      normal: [v[5], v[6], v[7]],
    };
  }

  castRay(origin, direction, options) { return this.raycast(origin, direction, options); }
}
