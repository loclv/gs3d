import { FrontSide, BackSide, DoubleSide } from './materials';
import { worldMatrixOf } from './bridge';
import { Vector3, multiplyMat4, transformPoint } from './math';

/* --- raycasting and bounds ------------------------------------------------------ */

export class Plane {
  isPlane: boolean;
  normal: Vector3;
  constant: number;
  constructor(normal = new Vector3(1, 0, 0), constant = 0) {
    this.isPlane = true;
    this.normal = normal.clone ? normal.clone() : new Vector3(normal.x, normal.y, normal.z);
    this.constant = constant;
  }
  set(normal, constant) { this.normal.copy(normal); this.constant = constant; return this; }
}

export class Ray {
  origin: Vector3;
  direction: Vector3;
  constructor(origin = new Vector3(), direction = new Vector3(0, 0, -1)) {
    this.origin = origin;
    this.direction = direction;
  }
  set(origin, direction) { this.origin.copy(origin); this.direction.copy(direction).normalize(); return this; }
  at(t, target = new Vector3()) {
    return target.set(this.origin.x + this.direction.x * t,
      this.origin.y + this.direction.y * t, this.origin.z + this.direction.z * t);
  }
  intersectPlane(plane, target = new Vector3()) {
    const denom = plane.normal.dot(this.direction);
    if (Math.abs(denom) < 1e-12) return null;
    const t = -(plane.normal.dot(this.origin) + plane.constant) / denom;
    if (t < 0) return null;
    return target.copy(this.origin).addScaledVector(this.direction, t);
  }
  intersectBox(box, target = new Vector3()) {
    const t = rayBoxT(this.origin.x, this.origin.y, this.origin.z,
      this.direction.x, this.direction.y, this.direction.z, box);
    return t === null ? null : this.at(t, target);
  }
  intersectsBox(box) {
    return rayBoxT(this.origin.x, this.origin.y, this.origin.z,
      this.direction.x, this.direction.y, this.direction.z, box) !== null;
  }
  intersectSphere(sphere, target = new Vector3()) {
    const t = raySphereT(this.origin.x, this.origin.y, this.origin.z,
      this.direction.x, this.direction.y, this.direction.z, sphere);
    return t === null ? null : this.at(t, target);
  }
  intersectsSphere(sphere) {
    return raySphereT(this.origin.x, this.origin.y, this.origin.z,
      this.direction.x, this.direction.y, this.direction.z, sphere) !== null;
  }
  intersectTriangle(a, b, c, backfaceCulling = false, target = new Vector3()) {
    const hit = rayTriangle(this.origin.x, this.origin.y, this.origin.z,
      this.direction.x, this.direction.y, this.direction.z,
      a.x, a.y, a.z, b.x, b.y, b.z, c.x, c.y, c.z, backfaceCulling ? FrontSide : DoubleSide);
    return hit ? this.at(hit.t, target) : null;
  }
}

export function rayBoxT(ox, oy, oz, dx, dy, dz, box) {
  if (!box || box.isEmpty()) return null;
  let tmin = -Infinity, tmax = Infinity;
  const mins = [box.min.x, box.min.y, box.min.z];
  const maxs = [box.max.x, box.max.y, box.max.z];
  const orig = [ox, oy, oz];
  const dir = [dx, dy, dz];
  for (let i = 0; i < 3; i++) {
    if (Math.abs(dir[i]) < 1e-12) {
      if (orig[i] < mins[i] || orig[i] > maxs[i]) return null;
    } else {
      const inv = 1 / dir[i];
      let t1 = (mins[i] - orig[i]) * inv;
      let t2 = (maxs[i] - orig[i]) * inv;
      if (t1 > t2) { const tmp = t1; t1 = t2; t2 = tmp; }
      if (t1 > tmin) tmin = t1;
      if (t2 < tmax) tmax = t2;
      if (tmin > tmax) return null;
    }
  }
  if (tmax < 0) return null;
  return tmin >= 0 ? tmin : tmax;
}

export function raySphereT(ox, oy, oz, dx, dy, dz, sphere) {
  if (!sphere || sphere.radius < 0) return null;
  const vx = sphere.center.x - ox, vy = sphere.center.y - oy, vz = sphere.center.z - oz;
  const tca = vx * dx + vy * dy + vz * dz;
  const d2 = vx * vx + vy * vy + vz * vz - tca * tca;
  const r2 = sphere.radius * sphere.radius;
  if (d2 > r2) return null;
  const thc = Math.sqrt(r2 - d2);
  const t0 = tca - thc;
  const t1 = tca + thc;
  if (t1 < 0) return null;
  return t0 < 0 ? t1 : t0;
}

// Möller–Trumbore ray/triangle test in the mesh's local space.
export function rayTriangle(ox, oy, oz, dx, dy, dz, ax, ay, az, bx, by, bz, cx, cy, cz, side = DoubleSide) {
  const e1x = bx - ax, e1y = by - ay, e1z = bz - az;
  const e2x = cx - ax, e2y = cy - ay, e2z = cz - az;
  const px = dy * e2z - dz * e2y, py = dz * e2x - dx * e2z, pz = dx * e2y - dy * e2x;
  const det = e1x * px + e1y * py + e1z * pz;
  if (side === FrontSide) {
    if (det < 1e-12) return null;
  } else if (side === BackSide) {
    if (det > -1e-12) return null;
  } else if (Math.abs(det) < 1e-12) {
    return null;
  }
  const inv = 1 / det;
  const tx = ox - ax, ty = oy - ay, tz = oz - az;
  const u = (tx * px + ty * py + tz * pz) * inv;
  if (u < 0 || u > 1) return null;
  const qx = ty * e1z - tz * e1y, qy = tz * e1x - tx * e1z, qz = tx * e1y - ty * e1x;
  const v = (dx * qx + dy * qy + dz * qz) * inv;
  if (v < 0 || u + v > 1) return null;
  const t = (e2x * qx + e2y * qy + e2z * qz) * inv;
  return t >= 0 ? { t, u, v } : null;
}

export class Sphere {
  center: Vector3;
  radius: number;
  isSphere: boolean;
  isBoundingSphere: boolean;
  constructor(center = new Vector3(), radius = -1) {
    this.center = center;
    this.radius = radius;
    this.isSphere = true;
    this.isBoundingSphere = true;
  }
  set(center, radius) { this.center.copy(center); this.radius = radius; return this; }
  copy(sphere) { this.center.copy(sphere.center); this.radius = sphere.radius; return this; }
  clone() { return new Sphere(this.center.clone(), this.radius); }
  isEmpty() { return this.radius < 0; }
  makeEmpty() { this.center.set(0, 0, 0); this.radius = -1; return this; }
  containsPoint(point) {
    if (this.radius < 0) return false;
    const dx = point.x - this.center.x, dy = point.y - this.center.y, dz = point.z - this.center.z;
    return dx * dx + dy * dy + dz * dz <= this.radius * this.radius;
  }
  distanceToPoint(point) {
    const dx = point.x - this.center.x, dy = point.y - this.center.y, dz = point.z - this.center.z;
    return Math.hypot(dx, dy, dz) - this.radius;
  }
  intersectsSphere(sphere) {
    if (this.radius < 0 || sphere.radius < 0) return false;
    const r = this.radius + sphere.radius;
    const dx = sphere.center.x - this.center.x, dy = sphere.center.y - this.center.y, dz = sphere.center.z - this.center.z;
    return dx * dx + dy * dy + dz * dz <= r * r;
  }
  intersectsBox(box) { return box.intersectsSphere(this); }
  getBoundingBox(target = new Box3()) {
    if (this.isEmpty()) return target.makeEmpty();
    target.min.set(this.center.x - this.radius, this.center.y - this.radius, this.center.z - this.radius);
    target.max.set(this.center.x + this.radius, this.center.y + this.radius, this.center.z + this.radius);
    return target;
  }
  setFromPoints(points, optionalCenter) {
    if (optionalCenter) this.center.copy(optionalCenter);
    else new Box3().setFromPoints(points).getCenter(this.center);
    let maxR2 = 0;
    for (const p of points) {
      const dx = p.x - this.center.x, dy = p.y - this.center.y, dz = p.z - this.center.z;
      maxR2 = Math.max(maxR2, dx * dx + dy * dy + dz * dz);
    }
    this.radius = points.length ? Math.sqrt(maxR2) : -1;
    return this;
  }
}

export class Box3 {
  min: Vector3;
  max: Vector3;
  isBox3: boolean;
  constructor(min = new Vector3(Infinity, Infinity, Infinity), max = new Vector3(-Infinity, -Infinity, -Infinity)) {
    this.min = min; this.max = max; this.isBox3 = true;
  }
  set(min, max) { this.min.copy(min); this.max.copy(max); return this; }
  copy(box) { this.min.copy(box.min); this.max.copy(box.max); return this; }
  makeEmpty() { this.min.set(Infinity, Infinity, Infinity); this.max.set(-Infinity, -Infinity, -Infinity); return this; }
  isEmpty() { return this.max.x < this.min.x || this.max.y < this.min.y || this.max.z < this.min.z; }
  setFromArray(array) {
    this.makeEmpty();
    for (let i = 0; i + 2 < array.length; i += 3) {
      const x = array[i], y = array[i + 1], z = array[i + 2];
      if (x < this.min.x) this.min.x = x; if (x > this.max.x) this.max.x = x;
      if (y < this.min.y) this.min.y = y; if (y > this.max.y) this.max.y = y;
      if (z < this.min.z) this.min.z = z; if (z > this.max.z) this.max.z = z;
    }
    return this;
  }
  setFromPoints(points) {
    this.makeEmpty();
    for (const p of points) this.expandByPoint(p);
    return this;
  }
  getBoundingSphere(target = new Sphere()) {
    if (this.isEmpty()) return target.makeEmpty();
    this.getCenter(target.center);
    const sz = this.getSize(new Vector3());
    target.radius = Math.hypot(sz.x, sz.y, sz.z) * 0.5;
    return target;
  }
  intersectsSphere(sphere) {
    if (this.isEmpty() || sphere.isEmpty()) return false;
    const cx = Math.max(this.min.x, Math.min(sphere.center.x, this.max.x));
    const cy = Math.max(this.min.y, Math.min(sphere.center.y, this.max.y));
    const cz = Math.max(this.min.z, Math.min(sphere.center.z, this.max.z));
    const dx = cx - sphere.center.x, dy = cy - sphere.center.y, dz = cz - sphere.center.z;
    return dx * dx + dy * dy + dz * dz <= sphere.radius * sphere.radius;
  }
  getCenter(target = new Vector3()) {
    return this.isEmpty() ? target.set(0, 0, 0)
      : target.set((this.min.x + this.max.x) / 2, (this.min.y + this.max.y) / 2, (this.min.z + this.max.z) / 2);
  }
  getSize(target = new Vector3()) {
    return this.isEmpty() ? target.set(0, 0, 0)
      : target.set(this.max.x - this.min.x, this.max.y - this.min.y, this.max.z - this.min.z);
  }
  expandByPoint(point) {
    this.min.set(Math.min(this.min.x, point.x), Math.min(this.min.y, point.y), Math.min(this.min.z, point.z));
    this.max.set(Math.max(this.max.x, point.x), Math.max(this.max.y, point.y), Math.max(this.max.z, point.z));
    return this;
  }
  expandByScalar(scalar) {
    this.min.set(this.min.x - scalar, this.min.y - scalar, this.min.z - scalar);
    this.max.set(this.max.x + scalar, this.max.y + scalar, this.max.z + scalar);
    return this;
  }
  translate(offset) {
    this.min.add(offset);
    this.max.add(offset);
    return this;
  }
  applyMatrix4(matrix) {
    if (this.isEmpty()) return this;
    const m = matrix.elements || matrix;
    const x0 = this.min.x, y0 = this.min.y, z0 = this.min.z;
    const x1 = this.max.x, y1 = this.max.y, z1 = this.max.z;
    this.makeEmpty();
    for (let cx = 0; cx <= 1; cx++) for (let cy = 0; cy <= 1; cy++) for (let cz = 0; cz <= 1; cz++) {
      const w = transformPoint(m, cx ? x1 : x0, cy ? y1 : y0, cz ? z1 : z0);
      this.expandByPoint(new Vector3(w[0], w[1], w[2]));
    }
    return this;
  }
  containsPoint(point) {
    return point.x >= this.min.x && point.x <= this.max.x &&
      point.y >= this.min.y && point.y <= this.max.y && point.z >= this.min.z && point.z <= this.max.z;
  }
  intersectsBox(box) {
    return !(box.max.x < this.min.x || box.min.x > this.max.x ||
      box.max.y < this.min.y || box.min.y > this.max.y ||
      box.max.z < this.min.z || box.min.z > this.max.z);
  }
  clone() { return new Box3(this.min.clone(), this.max.clone()); }
  setFromObject(object) {
    this.makeEmpty();
    const expandBox = (box, world) => {
      for (let cx = 0; cx <= 1; cx++) for (let cy = 0; cy <= 1; cy++) for (let cz = 0; cz <= 1; cz++) {
        const w = transformPoint(world, cx ? box.max.x : box.min.x, cy ? box.max.y : box.min.y, cz ? box.max.z : box.min.z);
        this.expandByPoint(new Vector3(w[0], w[1], w[2]));
      }
    };
    object.traverse(node => {
      if ((!node.isMesh && !node.isInstancedMesh) || !node.geometry || !node.geometry.attributes || !node.geometry.attributes.position) return;
      const geometry = node.geometry;
      if (!geometry.boundingBox) geometry.computeBoundingBox();
      if (!geometry.boundingBox || geometry.boundingBox.isEmpty()) return;
      const world = worldMatrixOf(node);
      if (node.isInstancedMesh) {
        const count = Math.min(node.count, node._maxCount);
        const arr = node.instanceMatrix.array;
        for (let i = 0; i < count; i++) {
          expandBox(geometry.boundingBox, multiplyMat4(world, arr.subarray(i * 16, i * 16 + 16)));
        }
      } else {
        expandBox(geometry.boundingBox, world);
      }
    });
    return this;
  }
}


// Vector2 is used only by getSize; keep it dependency-free.
