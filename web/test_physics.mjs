// Mock-engine checks for gs3d/physics — no wasm required. The fake engine
// records calls and services the read-back slice the way HEAPF32 would.
import assert from 'node:assert/strict';
import { PhysicsWorld, PhysicsBody, ColliderDesc, RigidBodyDesc, BodyType, CollisionEventQueue } from './physics.js';
import { AssetError } from './assets.js';

function mockEngine() {
  const calls = [];
  const buffer = new ArrayBuffer(4096);
  const heap = new Float32Array(buffer);
  const bytes = new Uint8Array(buffer);
  let nextPtr = 256;
  // Decode the sl_f32 header the way the wasm export does: data ptr at
  // offset 0, i64 length at offset 8.
  const sliceTarget = header => {
    const dv = new DataView(buffer, header, 16);
    return { ptr: dv.getUint32(0, true), len: Number(dv.getBigUint64(8, true)) };
  };
  // Contact pairs the mock reports; tests can swap the list between steps.
  let contactList = [{ a: 1, b: 2, n: [0, 1, 0], p: [0.1, 0.2, 0.3], pen: 0.05 }];
  const setContacts = pairs => { contactList = pairs; };
  // Masses assigned at creation, updated by set_mass — mass() reads this.
  const masses = {};
  const writeRayHit = header => {
    const { ptr, len } = sliceTarget(header);
    assert.ok(len >= 8, 'raycast read-back slice holds 8 floats');
    heap[ptr / 4] = 4; heap[ptr / 4 + 1] = 2.5;
    heap[ptr / 4 + 2] = 0; heap[ptr / 4 + 3] = 0; heap[ptr / 4 + 4] = -1;
    heap[ptr / 4 + 5] = 0; heap[ptr / 4 + 6] = 0; heap[ptr / 4 + 7] = 1;
  };
  const engine = {
    calls,
    HEAPF32: heap,
    HEAPU8: bytes,
    _malloc: size => { calls.push(['malloc', size]); const p = nextPtr; nextPtr += (size + 15) & ~15; return p; },
    _free: ptr => calls.push(['free', ptr]),
    _g3_phys_world_step: () => calls.push(['step']),
    _g3_phys_set_gravity: (x, y, z) => calls.push(['gravity', x, y, z]),
    _g3_phys_clear: () => calls.push(['clear']),
    _g3_phys_set_timestep: s => calls.push(['timestep', s]),
    _g3_phys_body_cuboid: (node, hx, hy, hz, mass) => {
      calls.push(['cuboid', node, hx, hy, hz, mass]);
      if (!(hx > 0 && hy > 0 && hz > 0 && mass >= 0)) return -1;
      masses[7] = mass;
      return 7;
    },
    _g3_phys_body_ball: (node, radius, mass) => {
      calls.push(['ball', node, radius, mass]);
      if (!(radius > 0)) return -1;
      masses[8] = mass;
      return 8;
    },
    _g3_phys_body_capsule: (node, halfLength, radius, mass) => {
      calls.push(['capsule', node, halfLength, radius, mass]);
      if (!(halfLength >= 0 && radius > 0)) return -1;
      masses[9] = mass;
      return 9;
    },
    _g3_phys_body_dynamic: id => id !== 3 && (masses[id] ?? 1) > 0,
    _g3_phys_body_mass: id => (id in masses ? masses[id] : (id >= 0 ? 2 : 0)),
    _g3_phys_body_is_sleeping: id => id === 6,
    _g3_phys_body_sleep: id => { calls.push(['sleep', id]); return id > 0; },
    _g3_phys_body_wake: id => { calls.push(['wake', id]); return id >= 0; },
    _g3_phys_body_add_force: (id, x, y, z) => { calls.push(['force', id, x, y, z]); return id > 0; },
    _g3_phys_body_reset_force: id => { calls.push(['resetForce', id]); return id >= 0; },
    _g3_phys_body_reset_torque: id => { calls.push(['resetTorque', id]); return id >= 0; },
    _g3_phys_body_remove: id => { calls.push(['remove', id]); return id >= 0; },
    _g3_phys_body_set_kinematic: (id, k) => { calls.push(['setKinematic', id, k]); return id >= 0; },
    _g3_phys_body_kinematic: id => id === 5,
    _g3_phys_body_set_mass: (id, m) => {
      calls.push(['setMass', id, m]);
      if (!(id >= 0 && m >= 0)) return false;
      masses[id] = m;
      return true;
    },
    _g3_phys_body_sync: id => { calls.push(['sync', id]); return id >= 0; },
    _g3_phys_raycast: (ox, oy, oz, dx, dy, dz, maxDist, header) => {
      calls.push(['raycast', ox, oy, oz, dx, dy, dz, maxDist]);
      writeRayHit(header);
      return true;
    },
    _g3_phys_raycast_filtered: (ox, oy, oz, dx, dy, dz, maxDist, exclude, header) => {
      calls.push(['raycastFiltered', ox, oy, oz, dx, dy, dz, maxDist, exclude]);
      writeRayHit(header);
      return true;
    },
    _g3_phys_body_pos: (id, header) => {
      const { ptr, len } = sliceTarget(header);
      assert.ok(len >= 3, 'pos read-back slice is large enough');
      heap[ptr / 4] = 1; heap[ptr / 4 + 1] = 2; heap[ptr / 4 + 2] = 3;
      return id >= 0;
    },
    _g3_phys_body_vel: (id, header) => {
      const { ptr } = sliceTarget(header);
      heap[ptr / 4] = 4; heap[ptr / 4 + 1] = 5; heap[ptr / 4 + 2] = 6;
      return id >= 0;
    },
    _g3_phys_body_set_pos: (id, x, y, z) => { calls.push(['setPos', id, x, y, z]); return id >= 0; },
    _g3_phys_body_set_vel: (id, x, y, z) => { calls.push(['setVel', id, x, y, z]); return id >= 0; },
    _g3_phys_body_apply_impulse: (id, x, y, z) => { calls.push(['impulse', id, x, y, z]); return id > 0; },
    _g3_phys_body_set_restitution: (id, v) => id >= 0 && v >= 0 && v <= 1,
    _g3_phys_body_set_friction: (id, v) => id >= 0 && v >= 0 && v <= 1,
    _g3_phys_body_angvel: (id, header) => {
      const { ptr } = sliceTarget(header);
      heap[ptr / 4] = 0.1; heap[ptr / 4 + 1] = 0.2; heap[ptr / 4 + 2] = 0.3;
      return id >= 0;
    },
    _g3_phys_body_set_angvel: (id, x, y, z) => { calls.push(['setAngvel', id, x, y, z]); return id >= 0; },
    _g3_phys_body_rot: (id, header) => {
      const { ptr } = sliceTarget(header);
      heap[ptr / 4] = 0.4; heap[ptr / 4 + 1] = 0.5; heap[ptr / 4 + 2] = 0.6;
      return id >= 0;
    },
    _g3_phys_body_set_rot: (id, x, y, z) => { calls.push(['setRot', id, x, y, z]); return id >= 0; },
    _g3_phys_body_apply_torque: (id, x, y, z) => { calls.push(['torque', id, x, y, z]); return id > 0; },
    _g3_phys_body_apply_impulse_at: (id, jx, jy, jz, px, py, pz) => {
      calls.push(['impulseAt', id, jx, jy, jz, px, py, pz]);
      return id > 0;
    },
    _g3_phys_contact_count: () => contactList.length,
    _g3_phys_contact: (id, header) => {
      const c = contactList[id];
      if (!c) return false;
      const { ptr, len } = sliceTarget(header);
      assert.ok(len >= 9, 'contact read-back slice holds 9 floats');
      heap[ptr / 4] = c.a; heap[ptr / 4 + 1] = c.b;
      heap[ptr / 4 + 2] = c.n[0]; heap[ptr / 4 + 3] = c.n[1]; heap[ptr / 4 + 4] = c.n[2];
      heap[ptr / 4 + 5] = c.p[0]; heap[ptr / 4 + 6] = c.p[1]; heap[ptr / 4 + 7] = c.p[2];
      heap[ptr / 4 + 8] = c.pen;
      return true;
    },
  };
  engine.setContacts = setContacts;
  return engine;
}

const world = new PhysicsWorld(mockEngine());
assert.equal(world.timestep, 1 / 60);
assert.throws(() => world.setTimestep(0), AssetError);
assert.throws(() => world.setTimestep(2), AssetError);
assert.throws(() => world.setTimestep(NaN), AssetError);
world.setTimestep(1); // upper boundary is inclusive
assert.throws(() => world.setTimestep(1.0001), AssetError);
world.setTimestep(1 / 30);
assert.deepEqual(world.engine.calls.filter(c => c[0] === 'timestep').at(-1), ['timestep', 1 / 30]);

world.setGravity(0, -9.81, 0);
world.step();
world.clear();
assert.ok(world.engine.calls.some(c => c[0] === 'step'));
assert.deepEqual(world.engine.calls.find(c => c[0] === 'gravity'), ['gravity', 0, -9.81, 0]);

const ball = world.addBall(4, 0.5, 1);
assert.equal(ball, 8);
assert.deepEqual(world.engine.calls.find(c => c[0] === 'ball'), ['ball', 4, 0.5, 1]);
const cuboid = world.addCuboid(2, [1, 2, 3], 0);
assert.equal(cuboid, 7);
const capsule = world.addCapsule(5, 0.5, 0.25, 2);
assert.equal(capsule, 9);
assert.throws(() => world.addBall(0, -1), AssetError);
assert.throws(() => world.addCuboid(1, [0, 1, 1]), AssetError);
assert.throws(() => world.addCuboid(1, [1, -1, 1]), AssetError);
assert.throws(() => world.addCapsule(1, -0.5, 0.5), AssetError);
assert.throws(() => world.addCapsule(1, 0.5, -0.5), AssetError);

assert.deepEqual(world.translation(ball), [1, 2, 3]);
assert.deepEqual(world.linvel(ball), [4, 5, 6]);
world.setTranslation(ball, [7, 8, 9]);
assert.deepEqual(world.engine.calls.find(c => c[0] === 'setPos'), ['setPos', 8, 7, 8, 9]);
world.setLinvel(ball, [0, -1, 0]);
assert.deepEqual(world.engine.calls.find(c => c[0] === 'setVel'), ['setVel', 8, 0, -1, 0]);
world.applyImpulse(ball, [0, 2, 0]);
assert.deepEqual(world.engine.calls.find(c => c[0] === 'impulse'), ['impulse', 8, 0, 2, 0]);
assert.throws(() => world.applyImpulse(0, [1, 0, 0]), AssetError); // fixed/unknown
assert.equal(world.isDynamic(ball), true);
assert.equal(world.isDynamic(3), false);
world.setRestitution(ball, 0.5);
world.setFriction(ball, 0.25);
assert.throws(() => world.setRestitution(ball, 2), AssetError);
assert.throws(() => world.setFriction(ball, -0.5), AssetError);
assert.throws(() => world.translation(-1), AssetError);
assert.throws(() => world.linvel(-1), AssetError);
assert.throws(() => world.setTranslation(-1, [0, 0, 0]), AssetError);
assert.throws(() => world.setLinvel(-1, [0, 0, 0]), AssetError);
assert.throws(() => world.setRestitution(-1, 0.5), AssetError);
assert.throws(() => world.setFriction(-1, 0.5), AssetError);

const near = (a, b) => a.map((v, i) => assert.ok(Math.abs(v - b[i]) < 1e-6, `${v} ≈ ${b[i]}`));
near(world.angvel(ball), [0.1, 0.2, 0.3]);
world.setAngvel(ball, [0, 1, 0]);
assert.deepEqual(world.engine.calls.find(c => c[0] === 'setAngvel'), ['setAngvel', 8, 0, 1, 0]);
near(world.rotation(ball), [0.4, 0.5, 0.6]);
world.setRotation(ball, [0.1, 0.2, 0.3]);
assert.deepEqual(world.engine.calls.find(c => c[0] === 'setRot'), ['setRot', 8, 0.1, 0.2, 0.3]);
world.addTorque(ball, [0, 0, 1]);
assert.deepEqual(world.engine.calls.find(c => c[0] === 'torque'), ['torque', 8, 0, 0, 1]);
world.applyImpulseAtPoint(ball, [0, 0, 1], [1, 0, 0]);
assert.deepEqual(world.engine.calls.find(c => c[0] === 'impulseAt'),
  ['impulseAt', 8, 0, 0, 1, 1, 0, 0]);
assert.throws(() => world.addTorque(0, [1, 0, 0]), AssetError); // fixed/unknown
const [contact] = world.contacts();
assert.equal(contact.a, 1);
assert.equal(contact.b, 2);
near(contact.normal, [0, 1, 0]);
near(contact.point, [0.1, 0.2, 0.3]);
assert.ok(Math.abs(contact.penetration - 0.05) < 1e-6);

// --- Rapier-style descriptors, body handles, events, filters ---

// ColliderDesc volume/density -> mass.
const ballDesc = ColliderDesc.ball(0.5).setDensity(2).setFriction(0.7).setRestitution(0.2);
const expectedMass = 2 * (4 / 3) * Math.PI * 0.125;
const dyn = RigidBodyDesc.dynamic()
  .setTranslation({ x: 1, y: 2, z: 3 })
  .setLinvel([0, 1, 0]);
const handle = world.addBody({ node: 4, collider: ballDesc, body: dyn });
assert.ok(handle instanceof PhysicsBody);
assert.equal(handle.id, 8);
const ballCall = world.engine.calls.filter(c => c[0] === 'ball').at(-1);
assert.equal(ballCall[1], 4);
assert.equal(ballCall[2], 0.5);
assert.ok(Math.abs(ballCall[3] - expectedMass) < 1e-5, `density mass ${ballCall[3]} ≈ ${expectedMass}`);
assert.deepEqual(handle.translation(), [1, 2, 3]); // mock pos read-back
assert.deepEqual(handle.linvel(), [4, 5, 6]);       // mock vel read-back
assert.ok(Math.abs(handle.mass() - expectedMass) < 1e-6);
handle.addForce([1, 2, 3]);
assert.deepEqual(world.engine.calls.find(c => c[0] === 'force'), ['force', 8, 1, 2, 3]);
handle.addTorque([0, 0, 1]);
handle.resetForces();
handle.resetTorques();
assert.ok(world.engine.calls.some(c => c[0] === 'resetForce' && c[1] === 8));
assert.ok(world.engine.calls.some(c => c[0] === 'resetTorque' && c[1] === 8));
handle.setFriction(0.9);
handle.setRestitution(0.4);
assert.equal(handle.isDynamic(), true);
assert.equal(handle.isSleeping(), false); // mock: only id 6 sleeps
assert.equal(world.getBody(6).isSleeping(), true);
handle.wakeUp();
assert.deepEqual(world.engine.calls.find(c => c[0] === 'wake'), ['wake', 8]);

// setBodyType round-trips mass like Rapier's mass properties.
handle.setBodyType(BodyType.FIXED);
assert.deepEqual(world.engine.calls.filter(c => c[0] === 'setMass').at(-1), ['setMass', 8, 0]);
assert.equal(handle.isFixed(), true);
handle.setBodyType(BodyType.DYNAMIC);
const restored = world.engine.calls.filter(c => c[0] === 'setMass').at(-1);
assert.equal(restored[1], 8);
assert.ok(Math.abs(restored[2] - expectedMass) < 1e-6, `restored mass ${restored[2]} ≈ ${expectedMass}`);
handle.setBodyType(BodyType.KINEMATIC_VELOCITY);
assert.deepEqual(world.engine.calls.filter(c => c[0] === 'setKinematic').at(-1), ['setKinematic', 8, true]);
assert.equal(handle.isKinematic(), false); // mock reports kinematic only for id 5

// Kinematic translation helper: (target - current) / timestep.
world.timestep = 1 / 30;
handle.setBodyType(BodyType.KINEMATIC_POSITION);
handle.setNextKinematicTranslation([4, 8, 12]);
const kinVel = world.engine.calls.filter(c => c[0] === 'setVel').at(-1);
// current pos reads [1,2,3]; target [4,8,12] over dt 1/30
assert.ok(Math.abs(kinVel[2] - 90) < 1e-3 && Math.abs(kinVel[3] - 180) < 1e-3 && Math.abs(kinVel[4] - 270) < 1e-3,
  `kinematic velocity ${kinVel.slice(2)}`);

// FIXED type forces mass 0 regardless of density.
const fixedHandle = world.addBody({
  node: 2,
  type: BodyType.FIXED,
  collider: ColliderDesc.cuboid([1, 1, 1]).setDensity(5),
});
assert.equal(fixedHandle.id, 7);
assert.equal(world.engine.calls.filter(c => c[0] === 'cuboid').at(-1)[5], 0);

// {x,y,z} object arguments are accepted everywhere arrays are.
world.setTranslation(8, { x: 9, y: 8, z: 7 });
assert.deepEqual(world.engine.calls.filter(c => c[0] === 'setPos').at(-1), ['setPos', 8, 9, 8, 7]);

// Raycast: plain maxDist, options object, and exclude filter.
const hit = world.raycast([0, 0, 0], [0, 0, -1]);
assert.equal(hit.body, 4);
assert.equal(hit.distance, 2.5);
near(hit.point, [0, 0, -1]);
near(hit.normal, [0, 0, 1]);
world.raycast([0, 0, 0], { x: 0, y: 0, z: -1 }, 50);
assert.deepEqual(world.engine.calls.filter(c => c[0] === 'raycast').at(-1).slice(7), [50]);
world.raycast([0, 0, 0], [0, 0, -1], { maxDist: 50, exclude: 4 });
assert.deepEqual(world.engine.calls.filter(c => c[0] === 'raycastFiltered').at(-1).slice(7, 9), [50, 4]);
world.raycast([0, 0, 0], [0, 0, -1], { exclude: handle });
assert.equal(world.engine.calls.filter(c => c[0] === 'raycastFiltered').at(-1)[8], 8);

// Collision events: started on first contact, silent while persisting,
// stopped when the pair separates.
const events = new CollisionEventQueue();
const seen = [];
world.step(events);
events.drainCollisionEvents((a, b, started) => seen.push([a, b, started]));
assert.deepEqual(seen, [[1, 2, true]]);
world.step(events);
events.drainCollisionEvents((a, b, started) => seen.push([a, b, started]));
assert.equal(seen.length, 1); // same pair still touching — no new events
world.engine.setContacts([]);
world.step(events);
events.drainCollisionEvents((a, b, started) => seen.push([a, b, started]));
assert.deepEqual(seen.at(-1), [1, 2, false]);

// removeBody accepts handles and tombstones them for _check().
fixedHandle.remove();
assert.deepEqual(world.engine.calls.filter(c => c[0] === 'remove').at(-1), ['remove', 7]);
assert.throws(() => fixedHandle.translation(), AssetError);

world.dispose();
world.dispose(); // idempotent
assert.ok(world.engine.calls.filter(c => c[0] === 'free').length === 2); // scratch + slice header
assert.throws(() => new PhysicsWorld({}), AssetError);

console.log('physics package checks passed');
