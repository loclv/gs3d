// Mock-engine checks for gs3d/physics — no wasm required. The fake engine
// records calls and services the read-back slice the way HEAPF32 would.
import assert from 'node:assert/strict';
import { PhysicsWorld } from './physics.js';
import { AssetError } from './assets.js';

function mockEngine() {
  const calls = [];
  const heap = new Float32Array(1024);
  const engine = {
    calls,
    HEAPF32: heap,
    _malloc: size => { calls.push(['malloc', size]); return 256; },
    _free: ptr => calls.push(['free', ptr]),
    _g3_phys_world_step: () => calls.push(['step']),
    _g3_phys_set_gravity: (x, y, z) => calls.push(['gravity', x, y, z]),
    _g3_phys_clear: () => calls.push(['clear']),
    _g3_phys_set_timestep: s => calls.push(['timestep', s]),
    _g3_phys_body_cuboid: (node, hx, hy, hz, mass) => {
      calls.push(['cuboid', node, hx, hy, hz, mass]);
      return hx > 0 && hy > 0 && hz > 0 && mass >= 0 ? 7 : -1;
    },
    _g3_phys_body_ball: (node, radius, mass) => { calls.push(['ball', node, radius, mass]); return radius > 0 ? 8 : -1; },
    _g3_phys_body_capsule: (node, halfLength, radius, mass) => {
      calls.push(['capsule', node, halfLength, radius, mass]);
      return halfLength >= 0 && radius > 0 ? 9 : -1;
    },
    _g3_phys_body_dynamic: id => id !== 3,
    _g3_phys_body_pos: (id, ptr, len) => {
      assert.ok(len >= 3, 'pos read-back slice is large enough');
      heap[ptr / 4] = 1; heap[ptr / 4 + 1] = 2; heap[ptr / 4 + 2] = 3;
      return id >= 0;
    },
    _g3_phys_body_vel: (id, ptr, len) => {
      heap[ptr / 4] = 4; heap[ptr / 4 + 1] = 5; heap[ptr / 4 + 2] = 6;
      return id >= 0;
    },
    _g3_phys_body_set_pos: (id, x, y, z) => { calls.push(['setPos', id, x, y, z]); return id >= 0; },
    _g3_phys_body_set_vel: (id, x, y, z) => { calls.push(['setVel', id, x, y, z]); return id >= 0; },
    _g3_phys_body_apply_impulse: (id, x, y, z) => { calls.push(['impulse', id, x, y, z]); return id > 0; },
    _g3_phys_body_set_restitution: (id, v) => id >= 0 && v >= 0 && v <= 1,
    _g3_phys_body_set_friction: (id, v) => id >= 0 && v >= 0 && v <= 1,
    _g3_phys_body_angvel: (id, ptr, len) => {
      heap[ptr / 4] = 0.1; heap[ptr / 4 + 1] = 0.2; heap[ptr / 4 + 2] = 0.3;
      return id >= 0;
    },
    _g3_phys_body_set_angvel: (id, x, y, z) => { calls.push(['setAngvel', id, x, y, z]); return id >= 0; },
    _g3_phys_body_rot: (id, ptr, len) => {
      heap[ptr / 4] = 0.4; heap[ptr / 4 + 1] = 0.5; heap[ptr / 4 + 2] = 0.6;
      return id >= 0;
    },
    _g3_phys_body_set_rot: (id, x, y, z) => { calls.push(['setRot', id, x, y, z]); return id >= 0; },
    _g3_phys_body_apply_torque: (id, x, y, z) => { calls.push(['torque', id, x, y, z]); return id > 0; },
    _g3_phys_body_apply_impulse_at: (id, jx, jy, jz, px, py, pz) => {
      calls.push(['impulseAt', id, jx, jy, jz, px, py, pz]);
      return id > 0;
    },
    _g3_phys_contact_count: () => 1,
    _g3_phys_contact: (id, ptr, len) => {
      assert.ok(len >= 9, 'contact read-back slice holds 9 floats');
      heap[ptr / 4] = 1; heap[ptr / 4 + 1] = 2;
      heap[ptr / 4 + 2] = 0; heap[ptr / 4 + 3] = 1; heap[ptr / 4 + 4] = 0;
      heap[ptr / 4 + 5] = 0.1; heap[ptr / 4 + 6] = 0.2; heap[ptr / 4 + 7] = 0.3;
      heap[ptr / 4 + 8] = 0.05;
      return true;
    },
  };
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
world.dispose();
world.dispose(); // idempotent
assert.ok(world.engine.calls.filter(c => c[0] === 'free').length === 1);
assert.throws(() => new PhysicsWorld({}), AssetError);

console.log('physics package checks passed');
