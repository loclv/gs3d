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
    _g3_phys_body_cuboid: (node, hx, hy, hz, mass) => { calls.push(['cuboid', node, hx, hy, hz, mass]); return 7; },
    _g3_phys_body_ball: (node, radius, mass) => { calls.push(['ball', node, radius, mass]); return radius > 0 ? 8 : -1; },
    _g3_phys_body_capsule: (node, halfLength, radius, mass) => { calls.push(['capsule', node, halfLength, radius, mass]); return 9; },
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
  };
  return engine;
}

const world = new PhysicsWorld(mockEngine());
assert.equal(world.timestep, 1 / 60);
assert.throws(() => world.setTimestep(0), AssetError);
assert.throws(() => world.setTimestep(2), AssetError);
world.setTimestep(1 / 30);
assert.deepEqual(world.engine.calls.find(c => c[0] === 'timestep'), ['timestep', 1 / 30]);

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
assert.throws(() => world.translation(-1), AssetError);
world.dispose();
assert.ok(world.engine.calls.some(c => c[0] === 'free'));
assert.throws(() => new PhysicsWorld({}), AssetError);

console.log('physics package checks passed');
