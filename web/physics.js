// Rapier-style physics for the gs3d engine host.
//
// `import { PhysicsWorld } from 'gs3d/physics'` mirrors the shape of
// three.js' RapierPhysics addon: a world with a timestep and step(), bodies
// created from collider descriptors, and translation/linvel accessors.
//
// Bodies attach to engine node indices (the values g3_asset_node returns or
// isNodeHandleValid accepts), not to Three.js Object3Ds — read translation()
// after step() and write it back to your scene objects yourself, the same
// way RapierPhysics copies body.translation() onto mesh.position.
//
// Scope matches g3.rapier: translation only — no rotation, angular velocity
// or torque; one collider per body. Mass 0 is fixed, mass > 0 is dynamic,
// and setKinematic makes a body velocity-driven: it ignores gravity, forces
// and impulses but still pushes dynamic bodies. removeBody tombstones a
// body without renumbering the others; clear() resets the world. Contacts
// detected during the last step() are available through contacts(), and
// raycast() casts against every live collider.

import { AssetError } from './assets.js';

const SCRATCH_FLOATS = 8;

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

export class PhysicsWorld {
  constructor(engine) {
    requirePhysics(engine);
    this.engine = engine;
    this._scratch = engine._malloc(SCRATCH_FLOATS * 4);
    if (!this._scratch) throw new AssetError('MEMORY', 'Could not allocate physics scratch buffer');
    this._vec = new Float32Array(engine.HEAPF32.buffer, this._scratch, SCRATCH_FLOATS);
    this.timestep = 1 / 60;
  }

  dispose() {
    if (this._scratch) { this.engine._free(this._scratch); this._scratch = 0; }
  }

  setGravity(x, y, z) { this.engine._g3_phys_set_gravity(x, y, z); }
  clear() { this.engine._g3_phys_clear(); }

  // world.timestep — seconds simulated per step() call.
  setTimestep(seconds) {
    if (!(seconds > 0) || seconds > 1) throw new AssetError('INVALID', 'timestep must be in (0, 1] seconds');
    this.timestep = seconds;
    this.engine._g3_phys_set_timestep(seconds);
  }

  // world.step()
  step() { this.engine._g3_phys_world_step(); }

  // ColliderDesc.cuboid(hx, hy, hz) + RigidBodyDesc mass. Returns a body id.
  addCuboid(node, halfExtents, mass = 0) {
    const [hx, hy, hz] = halfExtents;
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

  // ColliderDesc.capsule(halfLength, radius) — world-Y aligned.
  addCapsule(node, halfLength, radius, mass = 0) {
    const id = this.engine._g3_phys_body_capsule(node, halfLength, radius, mass);
    if (id < 0) throw new AssetError('INVALID', 'Could not create capsule body');
    return id;
  }

  isDynamic(body) { return !!this.engine._g3_phys_body_dynamic(body); }

  // body.translation() -> [x, y, z]
  translation(body) {
    if (!this.engine._g3_phys_body_pos(body, this._scratch, SCRATCH_FLOATS)) {
      throw new AssetError('INVALID', `Unknown physics body ${body}`);
    }
    return [this._vec[0], this._vec[1], this._vec[2]];
  }

  // body.setTranslation() — teleports and zeroes velocity.
  setTranslation(body, position) {
    const [x, y, z] = position;
    if (!this.engine._g3_phys_body_set_pos(body, x, y, z)) {
      throw new AssetError('INVALID', `Unknown physics body ${body}`);
    }
  }

  // body.linvel() -> [x, y, z]
  linvel(body) {
    if (!this.engine._g3_phys_body_vel(body, this._scratch, SCRATCH_FLOATS)) {
      throw new AssetError('INVALID', `Unknown physics body ${body}`);
    }
    return [this._vec[0], this._vec[1], this._vec[2]];
  }

  // body.setLinvel()
  setLinvel(body, velocity) {
    const [x, y, z] = velocity;
    if (!this.engine._g3_phys_body_set_vel(body, x, y, z)) {
      throw new AssetError('INVALID', `Unknown physics body ${body}`);
    }
  }

  // body.applyImpulse() — instantaneous velocity change; dynamic bodies only.
  applyImpulse(body, impulse) {
    const [x, y, z] = impulse;
    if (!this.engine._g3_phys_body_apply_impulse(body, x, y, z)) {
      throw new AssetError('INVALID', `Cannot impulse body ${body} (unknown or fixed)`);
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

  // world.removeRigidBody — tombstones the body; other ids stay valid.
  removeBody(body) {
    requireExport(this.engine, '_g3_phys_body_remove');
    if (!this.engine._g3_phys_body_remove(body)) {
      throw new AssetError('INVALID', `Unknown physics body ${body}`);
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

  // Copy the node's current position into the body — call after moving the
  // node directly, or the next step() writes the body's stale position back.
  syncFromNode(body) {
    requireExport(this.engine, '_g3_phys_body_sync');
    if (!this.engine._g3_phys_body_sync(body)) {
      throw new AssetError('INVALID', `Unknown physics body ${body}`);
    }
  }

  // Contacts detected during the last step(): [{a, b, normal, penetration}].
  contacts() {
    requireExport(this.engine, '_g3_phys_contact_count');
    const count = this.engine._g3_phys_contact_count();
    const out = [];
    for (let i = 0; i < count; i++) {
      if (!this.engine._g3_phys_contact(i, this._scratch, SCRATCH_FLOATS)) break;
      out.push({
        a: this._vec[0],
        b: this._vec[1],
        normal: [this._vec[2], this._vec[3], this._vec[4]],
        penetration: this._vec[5],
      });
    }
    return out;
  }

  // world.castRay — nearest hit along origin + direction * t. `direction`
  // need not be normalized. Returns {body, distance, point, normal} or null.
  raycast(origin, direction, maxDist = 1000) {
    requireExport(this.engine, '_g3_phys_raycast');
    const [ox, oy, oz] = origin;
    const [dx, dy, dz] = direction;
    if (!this.engine._g3_phys_raycast(ox, oy, oz, dx, dy, dz, maxDist, this._scratch, SCRATCH_FLOATS)) {
      return null;
    }
    return {
      body: this._vec[0],
      distance: this._vec[1],
      point: [this._vec[2], this._vec[3], this._vec[4]],
      normal: [this._vec[5], this._vec[6], this._vec[7]],
    };
  }
}
