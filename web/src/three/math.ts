/* --- vectors and transforms ---------------------------------------------- */

export class Vector3 {
  isVector3: boolean;
  x: number;
  y: number;
  z: number;
  constructor(x = 0, y = 0, z = 0) { this.isVector3 = true; this.x = x; this.y = y; this.z = z; }
  set(x, y, z) { this.x = x; this.y = y; this.z = z; return this; }
  setScalar(s) { return this.set(s, s, s); }
  copy(v) { this.x = v.x; this.y = v.y; this.z = v.z; return this; }
  clone() { return new Vector3(this.x, this.y, this.z); }
  add(v) { this.x += v.x; this.y += v.y; this.z += v.z; return this; }
  addVectors(a, b) { return this.set(a.x + b.x, a.y + b.y, a.z + b.z); }
  addScaledVector(v, scale) { this.x += v.x * scale; this.y += v.y * scale; this.z += v.z * scale; return this; }
  sub(v) { this.x -= v.x; this.y -= v.y; this.z -= v.z; return this; }
  subVectors(a, b) { return this.set(a.x - b.x, a.y - b.y, a.z - b.z); }
  multiplyScalar(s) { this.x *= s; this.y *= s; this.z *= s; return this; }
  divideScalar(s) { return this.multiplyScalar(1 / (s || 1)); }
  min(v) { this.x = Math.min(this.x, v.x); this.y = Math.min(this.y, v.y); this.z = Math.min(this.z, v.z); return this; }
  max(v) { this.x = Math.max(this.x, v.x); this.y = Math.max(this.y, v.y); this.z = Math.max(this.z, v.z); return this; }
  clamp(min, max) {
    this.x = Math.max(min.x, Math.min(max.x, this.x));
    this.y = Math.max(min.y, Math.min(max.y, this.y));
    this.z = Math.max(min.z, Math.min(max.z, this.z));
    return this;
  }
  equals(v) { return this.x === v.x && this.y === v.y && this.z === v.z; }
  length() { return Math.hypot(this.x, this.y, this.z); }
  lengthSq() { return this.x * this.x + this.y * this.y + this.z * this.z; }
  normalize() { const l = this.length() || 1; return this.multiplyScalar(1 / l); }
  distanceTo(v) { return Math.hypot(this.x - v.x, this.y - v.y, this.z - v.z); }
  distanceToSquared(v) { const dx = this.x - v.x, dy = this.y - v.y, dz = this.z - v.z; return dx * dx + dy * dy + dz * dz; }
  dot(v) { return this.x * v.x + this.y * v.y + this.z * v.z; }
  cross(v) {
    const x = this.y * v.z - this.z * v.y, y = this.z * v.x - this.x * v.z, z = this.x * v.y - this.y * v.x;
    return this.set(x, y, z);
  }
  crossVectors(a, b) {
    return this.set(a.y * b.z - a.z * b.y, a.z * b.x - a.x * b.z, a.x * b.y - a.y * b.x);
  }
  lerp(v, alpha) {
    this.x += (v.x - this.x) * alpha; this.y += (v.y - this.y) * alpha; this.z += (v.z - this.z) * alpha;
    return this;
  }
  negate() { return this.set(-this.x, -this.y, -this.z); }
  fromArray(a, offset = 0) { this.x = a[offset]; this.y = a[offset + 1]; this.z = a[offset + 2]; return this; }
  toArray(a = [], offset = 0) { a[offset] = this.x; a[offset + 1] = this.y; a[offset + 2] = this.z; return a; }
  applyQuaternion(q) {
    const qx = q.x, qy = q.y, qz = q.z, qw = q.w;
    const tx = 2 * (qy * this.z - qz * this.y);
    const ty = 2 * (qz * this.x - qx * this.z);
    const tz = 2 * (qx * this.y - qy * this.x);
    this.x += qw * tx + qy * tz - qz * ty;
    this.y += qw * ty + qz * tx - qx * tz;
    this.z += qw * tz + qx * ty - qy * tx;
    return this;
  }
  applyEuler(e) { return this.applyQuaternion(new Quaternion().setFromEuler(e)); }
  applyAxisAngle(axis, angle) { return this.applyQuaternion(new Quaternion().setFromAxisAngle(axis, angle)); }
  applyMatrix4(m) {
    const e = m.elements || m, x = this.x, y = this.y, z = this.z;
    const w = 1 / ((e[3] * x + e[7] * y + e[11] * z + e[15]) || 1);
    return this.set(
      (e[0] * x + e[4] * y + e[8] * z + e[12]) * w,
      (e[1] * x + e[5] * y + e[9] * z + e[13]) * w,
      (e[2] * x + e[6] * y + e[10] * z + e[14]) * w,
    );
  }
  transformDirection(m) {
    const e = m.elements || m, x = this.x, y = this.y, z = this.z;
    return this.set(
      e[0] * x + e[4] * y + e[8] * z,
      e[1] * x + e[5] * y + e[9] * z,
      e[2] * x + e[6] * y + e[10] * z,
    ).normalize();
  }
  setFromMatrix3Column(m, index) {
    return this.set(m.elements ? m.elements[index * 4] : m[index * 4],
      m.elements ? m.elements[index * 4 + 1] : m[index * 4 + 1],
      m.elements ? m.elements[index * 4 + 2] : m[index * 4 + 2]);
  }
  setFromMatrixPosition(m) { const e = m.elements || m; return this.set(e[12], e[13], e[14]); }
  addScalar(s) { return this.set(this.x + s, this.y + s, this.z + s); }
  subScalar(s) { return this.set(this.x - s, this.y - s, this.z - s); }
  multiply(v) { this.x *= v.x; this.y *= v.y; this.z *= v.z; return this; }
  multiplyVectors(a, b) { return this.set(a.x * b.x, a.y * b.y, a.z * b.z); }
  divide(v) { return this.set(this.x / (v.x || 1), this.y / (v.y || 1), this.z / (v.z || 1)); }
  ceil() { return this.set(Math.ceil(this.x), Math.ceil(this.y), Math.ceil(this.z)); }
  floor() { return this.set(Math.floor(this.x), Math.floor(this.y), Math.floor(this.z)); }
  round() { return this.set(Math.round(this.x), Math.round(this.y), Math.round(this.z)); }
  roundToZero() {
    return this.set(this.x < 0 ? Math.ceil(this.x) : Math.floor(this.x),
      this.y < 0 ? Math.ceil(this.y) : Math.floor(this.y),
      this.z < 0 ? Math.ceil(this.z) : Math.floor(this.z));
  }
  setLength(length) { return this.normalize().multiplyScalar(length); }
  clampLength(min, max) {
    const l = this.length();
    if (l === 0) return this;
    return this.multiplyScalar(Math.max(min, Math.min(max, l)) / l);
  }
  clampScalar(min, max) { return this.clamp(_clampMin.set(min, min, min), _clampMax.set(max, max, max)); }
  lerpVectors(a, b, t) {
    return this.set(a.x + (b.x - a.x) * t, a.y + (b.y - a.y) * t, a.z + (b.z - a.z) * t);
  }
  manhattanLength() { return Math.abs(this.x) + Math.abs(this.y) + Math.abs(this.z); }
  manhattanDistanceTo(v) {
    return Math.abs(this.x - v.x) + Math.abs(this.y - v.y) + Math.abs(this.z - v.z);
  }
  angleTo(v) {
    const d = Math.sqrt(this.lengthSq() * v.lengthSq());
    if (d === 0) return Math.PI / 2;
    return Math.acos(Math.max(-1, Math.min(1, this.dot(v) / d)));
  }
  random() {
    this.x = Math.random() * 2 - 1;
    this.y = Math.random() * 2 - 1;
    this.z = Math.random() * 2 - 1;
    return this.normalize();
  }
  randomDirection() { return this.random(); }
  projectOnVector(v) {
    const d = v.lengthSq() || 1;
    const s = this.dot(v) / d;
    return this.copy(v).multiplyScalar(s);
  }
  projectOnPlane(planeNormal) {
    _projV.copy(this).projectOnVector(planeNormal);
    return this.sub(_projV);
  }
  reflect(normal) {
    // this = this - 2 * dot(this, normal) * normal (normal assumed unit).
    return this.sub(_projV.copy(normal).multiplyScalar(2 * this.dot(normal)));
  }
  setX(x) { this.x = x; return this; }
  setY(y) { this.y = y; return this; }
  setZ(z) { this.z = z; return this; }
  setComponent(index, value) {
    switch (index) { case 0: this.x = value; break; case 1: this.y = value; break; default: this.z = value; }
    return this;
  }
  getComponent(index) { return index === 0 ? this.x : index === 1 ? this.y : this.z; }
  fromBufferAttribute(attribute, index) {
    const a = attribute.array, s = attribute.itemSize || 3;
    return this.set(a[index * s], a[index * s + 1], a[index * s + 2]);
  }
  applyMatrix3(m) {
    const e = m.elements || m, x = this.x, y = this.y, z = this.z;
    return this.set(
      e[0] * x + e[4] * y + e[8] * z,
      e[1] * x + e[5] * y + e[9] * z,
      e[2] * x + e[6] * y + e[10] * z,
    );
  }
  applyNormalMatrix(m) {
    // Inverse-transpose of the upper 3x3, like three's normalMatrix.
    const inv = invertMat4(m.elements || m);
    if (!inv) return this;
    // Transpose the rotation/scale block (indices are column-major).
    const t = new Float64Array(16);
    t.set(inv);
    for (let r = 0; r < 3; r++) for (let c = 0; c < 3; c++) {
      const src = c * 4 + r, dst = r * 4 + c;
      // swap (r,c) <-> (c,r) within the 3x3
      const tmp = t[src]; t[src] = t[dst]; t[dst] = tmp;
    }
    return this.applyMatrix3(t).normalize();
  }
  setFromMatrixColumn(m, index) {
    const e = m.elements || m, o = index * 4;
    return this.set(e[o], e[o + 1], e[o + 2]);
  }
  setFromMatrixScale(m) {
    const e = m.elements || m;
    return this.set(Math.hypot(e[0], e[1], e[2]), Math.hypot(e[4], e[5], e[6]), Math.hypot(e[8], e[9], e[10]));
  }
  setFromSphericalCoords(radius, phi, theta) {
    const sp = Math.sin(phi);
    return this.set(radius * sp * Math.sin(theta), radius * Math.cos(phi), radius * sp * Math.cos(theta));
  }
  setFromCylindricalCoords(radius, theta, y) {
    return this.set(radius * Math.sin(theta), y, radius * Math.cos(theta));
  }
  setFromSpherical(s) {
    return this.setFromSphericalCoords(s.radius ?? 1, s.phi ?? 0, s.theta ?? 0);
  }
  setFromCylindrical(c) {
    return this.setFromCylindricalCoords(c.radius ?? 1, c.theta ?? 0, c.y ?? 0);
  }
  setFromEuler(e) {
    // Unit -Z direction rotated by the euler, like three's Vector3.setFromEuler.
    return this.set(0, 0, -1).applyEuler(e);
  }
  setFromColor(c) { return this.set(c.r, c.g, c.b); }
  project(camera) {
    // view = inverse(camera.matrixWorld); proj = camera.projectionMatrix.
    if (camera.updateWorldMatrix) camera.updateWorldMatrix(true, false);
    const world = camera.matrixWorld;
    if (!world) return this;
    const view = invertMat4(world.elements || world);
    const proj = camera.projectionMatrix;
    if (!view || !proj) return this;
    this.applyMatrix4(view).applyMatrix4(proj.elements || proj);
    const w = this.z || 1;
    return this.set(this.x / w, this.y / w, this.z / w);
  }
  unproject(camera) {
    const proj = camera.projectionMatrix;
    if (!proj) return this;
    if (camera.updateWorldMatrix) camera.updateWorldMatrix(true, false);
    const world = camera.matrixWorld;
    const invProj = invertMat4(proj.elements || proj);
    if (!invProj || !world) return this;
    const view = invertMat4(world.elements || world);
    this.applyMatrix4(invProj);
    if (view) this.applyMatrix4(view);
    return this;
  }
}

const _clampMin = new Vector3(), _clampMax = new Vector3(), _projV = new Vector3();

export class Vector4 {
  isVector4: boolean;
  x: number;
  y: number;
  z: number;
  w: number;
  constructor(x = 0, y = 0, z = 0, w = 0) { this.isVector4 = true; this.x = x; this.y = y; this.z = z; this.w = w; }
  set(x, y, z, w) { this.x = x; this.y = y; this.z = z; this.w = w; return this; }
  setScalar(s) { this.x = s; this.y = s; this.z = s; this.w = s; return this; }
  copy(v) { this.x = v.x; this.y = v.y; this.z = v.z; this.w = v.w; return this; }
  clone() { return new Vector4(this.x, this.y, this.z, this.w); }
  add(v) { this.x += v.x; this.y += v.y; this.z += v.z; this.w += v.w; return this; }
  addScalar(s) { this.x += s; this.y += s; this.z += s; this.w += s; return this; }
  sub(v) { this.x -= v.x; this.y -= v.y; this.z -= v.z; this.w -= v.w; return this; }
  subScalar(s) { this.x -= s; this.y -= s; this.z -= s; this.w -= s; return this; }
  multiplyScalar(s) { this.x *= s; this.y *= s; this.z *= s; this.w *= s; return this; }
  divideScalar(s) { return this.multiplyScalar(1 / (s || 1)); }
  negate() { return this.set(-this.x, -this.y, -this.z, -this.w); }
  dot(v) { return this.x * v.x + this.y * v.y + this.z * v.z + this.w * v.w; }
  length() { return Math.hypot(this.x, this.y, this.z, this.w); }
  lengthSq() { return this.x * this.x + this.y * this.y + this.z * this.z + this.w * this.w; }
  manhattanLength() { return Math.abs(this.x) + Math.abs(this.y) + Math.abs(this.z) + Math.abs(this.w); }
  normalize() { const l = this.length() || 1; return this.multiplyScalar(1 / l); }
  setLength(length) { return this.normalize().multiplyScalar(length); }
  lerp(v, alpha) {
    this.x += (v.x - this.x) * alpha; this.y += (v.y - this.y) * alpha;
    this.z += (v.z - this.z) * alpha; this.w += (v.w - this.w) * alpha;
    return this;
  }
  distanceTo(v) { return Math.hypot(this.x - v.x, this.y - v.y, this.z - v.z, this.w - v.w); }
  distanceToSquared(v) {
    const dx = this.x - v.x, dy = this.y - v.y, dz = this.z - v.z, dw = this.w - v.w;
    return dx * dx + dy * dy + dz * dz + dw * dw;
  }
  manhattanDistanceTo(v) {
    return Math.abs(this.x - v.x) + Math.abs(this.y - v.y) + Math.abs(this.z - v.z) + Math.abs(this.w - v.w);
  }
  equals(v) { return this.x === v.x && this.y === v.y && this.z === v.z && this.w === v.w; }
  setX(x) { this.x = x; return this; }
  setY(y) { this.y = y; return this; }
  setZ(z) { this.z = z; return this; }
  setW(w) { this.w = w; return this; }
  setComponent(index, value) {
    switch (index) { case 0: this.x = value; break; case 1: this.y = value; break;
      case 2: this.z = value; break; default: this.w = value; }
    return this;
  }
  getComponent(index) { return index === 0 ? this.x : index === 1 ? this.y : index === 2 ? this.z : this.w; }
  fromArray(a, offset = 0) { return this.set(a[offset], a[offset + 1], a[offset + 2], a[offset + 3]); }
  toArray(a = [], offset = 0) {
    a[offset] = this.x; a[offset + 1] = this.y; a[offset + 2] = this.z; a[offset + 3] = this.w;
    return a;
  }
  fromBufferAttribute(attribute, index) {
    const a = attribute.array, s = attribute.itemSize || 4;
    return this.set(a[index * s], a[index * s + 1], a[index * s + 2], a[index * s + 3]);
  }
  applyMatrix4(m) {
    const e = m.elements || m;
    const x = this.x, y = this.y, z = this.z, w = this.w;
    const d = e[3] * x + e[7] * y + e[11] * z + e[15] * w || 1;
    return this.set(
      (e[0] * x + e[4] * y + e[8] * z + e[12] * w) / d,
      (e[1] * x + e[5] * y + e[9] * z + e[13] * w) / d,
      (e[2] * x + e[6] * y + e[10] * z + e[14] * w) / d,
      (e[3] * x + e[7] * y + e[11] * z + e[15] * w) / d,
    );
  }
  addVectors(a, b) { return this.set(a.x + b.x, a.y + b.y, a.z + b.z, a.w + b.w); }
  subVectors(a, b) { return this.set(a.x - b.x, a.y - b.y, a.z - b.z, a.w - b.w); }
  multiply(v) { this.x *= v.x; this.y *= v.y; this.z *= v.z; this.w *= v.w; return this; }
  divide(v) { this.x /= v.x || 1; this.y /= v.y || 1; this.z /= v.z || 1; this.w /= v.w || 1; return this; }
  addScaledVector(v, s) { this.x += v.x * s; this.y += v.y * s; this.z += v.z * s; this.w += v.w * s; return this; }
  lerpVectors(a, b, t) { return this.set(a.x + (b.x - a.x) * t, a.y + (b.y - a.y) * t,
    a.z + (b.z - a.z) * t, a.w + (b.w - a.w) * t); }
  clamp(min, max) {
    this.x = Math.max(min.x, Math.min(max.x, this.x));
    this.y = Math.max(min.y, Math.min(max.y, this.y));
    this.z = Math.max(min.z, Math.min(max.z, this.z));
    this.w = Math.max(min.w, Math.min(max.w, this.w));
    return this;
  }
  clampScalar(min, max) {
    return this.set(
      Math.max(min, Math.min(max, this.x)), Math.max(min, Math.min(max, this.y)),
      Math.max(min, Math.min(max, this.z)), Math.max(min, Math.min(max, this.w)));
  }
  clampLength(min, max) {
    const l = this.length();
    return this.divideScalar(l || 1).multiplyScalar(Math.max(min, Math.min(max, l)));
  }
  floor() { return this.set(Math.floor(this.x), Math.floor(this.y), Math.floor(this.z), Math.floor(this.w)); }
  ceil() { return this.set(Math.ceil(this.x), Math.ceil(this.y), Math.ceil(this.z), Math.ceil(this.w)); }
  round() { return this.set(Math.round(this.x), Math.round(this.y), Math.round(this.z), Math.round(this.w)); }
  roundToZero() {
    return this.set(
      this.x < 0 ? Math.ceil(this.x) : Math.floor(this.x),
      this.y < 0 ? Math.ceil(this.y) : Math.floor(this.y),
      this.z < 0 ? Math.ceil(this.z) : Math.floor(this.z),
      this.w < 0 ? Math.ceil(this.w) : Math.floor(this.w));
  }
  min(v) { this.x = Math.min(this.x, v.x); this.y = Math.min(this.y, v.y); this.z = Math.min(this.z, v.z); this.w = Math.min(this.w, v.w); return this; }
  max(v) { this.x = Math.max(this.x, v.x); this.y = Math.max(this.y, v.y); this.z = Math.max(this.z, v.z); this.w = Math.max(this.w, v.w); return this; }
  random() {
    return this.set(Math.random(), Math.random(), Math.random(), Math.random());
  }
  setFromMatrixPosition(m) {
    const e = m.elements || m;
    return this.set(e[12], e[13], e[14], e[15]);
  }
  setAxisAngleFromQuaternion(q) { return this.set(q.x, q.y, q.z, q.w); }
  setAxisAngleFromRotationMatrix(m) {
    const q = new Quaternion().setFromRotationMatrix(m.elements || m);
    return this.setAxisAngleFromQuaternion(q);
  }
  // three.js Vector4 has no width/height; kept for duck-type parity.
  get width() { return this.z; }
  get height() { return this.w; }
}

export class Euler {
  _x: number;
  _y: number;
  _z: number;
  _order: string;
  isEuler: boolean;
  get x() { return this._x; } set x(v) { this._x = v; }
  get y() { return this._y; } set y(v) { this._y = v; }
  get z() { return this._z; } set z(v) { this._z = v; }
  get order() { return this._order; } set order(v) { this._order = v; }
  constructor(x = 0, y = 0, z = 0, order = 'XYZ') {
    this._x = x; this._y = y; this._z = z; this._order = order; this.isEuler = true;
  }
  set(x, y, z, order) { this.x = x; this.y = y; this.z = z; if (order) this.order = order; return this; }
  copy(e) { this.x = e.x; this.y = e.y; this.z = e.z; this.order = e.order; return this; }
  clone() { return new Euler(this.x, this.y, this.z, this.order); }
  equals(e) { return this.x === e.x && this.y === e.y && this.z === e.z && this.order === e.order; }
  setFromVector3(v, order) { return this.set(v.x, v.y, v.z, order || this.order); }
  setFromQuaternion(q, order = null, update = true) {
    this.order = order || this.order;
    const [x, y, z] = eulerFromQuatXYZ(q);
    this.x = x; this.y = y; this.z = z;
    return this;
  }
  setFromRotationMatrix(m, order = null, update = true) {
    this.order = order || this.order;
    const q = new Quaternion().setFromRotationMatrix(m.elements || m);
    return this.setFromQuaternion(q, this.order);
  }
  // Reorder the components into a new rotation order (three.js reorder).
  reorder(newOrder) {
    const q = new Quaternion().setFromEuler(this);
    this.order = newOrder;
    this.setFromQuaternion(q, newOrder);
    return this;
  }
  fromArray(a, offset = 0) {
    return this.set(a[offset], a[offset + 1], a[offset + 2],
      a[offset + 3] !== undefined ? a[offset + 3] : this.order);
  }
  toArray(a = [], offset = 0) {
    a[offset] = this.x; a[offset + 1] = this.y; a[offset + 2] = this.z; a[offset + 3] = this.order;
    return a;
  }
}

// Euler order: three.js applies the axes in the listed order, so 'XYZ' is
// qx * qy * qz (verified against the original XYZ formula below).
function axisQuat(axis, angle) {
  const h = angle * 0.5, s = Math.sin(h), c = Math.cos(h);
  if (axis === 'x') return { x: s, y: 0, z: 0, w: c };
  if (axis === 'y') return { x: 0, y: s, z: 0, w: c };
  return { x: 0, y: 0, z: s, w: c };
}
function quatMul(a, b) {
  return {
    x: a.w * b.x + a.x * b.w + a.y * b.z - a.z * b.y,
    y: a.w * b.y - a.x * b.z + a.y * b.w + a.z * b.x,
    z: a.w * b.z + a.x * b.y - a.y * b.x + a.z * b.w,
    w: a.w * b.w - a.x * b.x - a.y * b.y - a.z * b.z,
  };
}
export function quatFromEulerOrder(x, y, z, order = 'XYZ') {
  const angles = { x, y, z };
  let q = null;
  for (const axis of String(order).toLowerCase()) {
    if (axis !== 'x' && axis !== 'y' && axis !== 'z') continue;
    const a = axisQuat(axis, angles[axis]);
    q = q ? quatMul(q, a) : a;
  }
  return q || { x: 0, y: 0, z: 0, w: 1 };
}

// XYZ-order Euler <-> quaternion, matching the convention composeLocal used.
export function quatFromEulerXYZ(x, y, z) {
  const hx = x * 0.5, hy = y * 0.5, hz = z * 0.5;
  const sx = Math.sin(hx), sy = Math.sin(hy), sz = Math.sin(hz);
  const cx = Math.cos(hx), cy = Math.cos(hy), cz = Math.cos(hz);
  return {
    x: sx * cy * cz + cx * sy * sz,
    y: cx * sy * cz - sx * cy * sz,
    z: cx * cy * sz + sx * sy * cz,
    w: cx * cy * cz - sx * sy * sz,
  };
}

export function eulerFromQuatXYZ(q) {
  // Returns [x, y, z]; gimbal-lock safe enough for facade use.
  const x = q.x, y = q.y, z = q.z, w = q.w;
  const sinrCosp = 2 * (w * x + y * z), cosrCosp = 1 - 2 * (x * x + y * y);
  const sinp = 2 * (w * y - z * x);
  const sinyCosp = 2 * (w * z + x * y), cosyCosp = 1 - 2 * (y * y + z * z);
  const ex = Math.atan2(sinrCosp, cosrCosp);
  const ey = Math.abs(sinp) >= 1 ? Math.sign(sinp) * Math.PI / 2 : Math.asin(sinp);
  const ez = Math.atan2(sinyCosp, cosyCosp);
  return [ex, ey, ez];
}

export class Quaternion {
  isQuaternion: boolean;
  _x: number;
  _y: number;
  _z: number;
  _w: number;
  // three r180 exposes these as prototype accessors backed by _x.._w.
  get x() { return this._x; } set x(v) { this._x = v; }
  get y() { return this._y; } set y(v) { this._y = v; }
  get z() { return this._z; } set z(v) { this._z = v; }
  get w() { return this._w; } set w(v) { this._w = v; }
  constructor(x = 0, y = 0, z = 0, w = 1) { this.isQuaternion = true; this._x = x; this._y = y; this._z = z; this._w = w; }
  set(x, y, z, w) { this.x = x; this.y = y; this.z = z; this.w = w; return this; }
  copy(q) { this.x = q.x; this.y = q.y; this.z = q.z; this.w = q.w; return this; }
  clone() { return new Quaternion(this.x, this.y, this.z, this.w); }
  identity() { return this.set(0, 0, 0, 1); }
  setFromEuler(e) { const q = quatFromEulerOrder(e.x, e.y, e.z, e.order); return this.set(q.x, q.y, q.z, q.w); }
  setFromAxisAngle(axis, angle) {
    const h = angle / 2, s = Math.sin(h);
    const l = Math.hypot(axis.x, axis.y, axis.z) || 1;
    return this.set(axis.x / l * s, axis.y / l * s, axis.z / l * s, Math.cos(h));
  }
  // Column-major 4x4 (matches composeLocal/multiplyMat4 layout). Columns are
  // normalized first so non-uniform scale doesn't skew the rotation.
  setFromRotationMatrix(m) {
    const col = i => {
      const x = m[i], y = m[i + 1], z = m[i + 2];
      const l = Math.hypot(x, y, z) || 1;
      return [x / l, y / l, z / l];
    };
    const c0 = col(0), c1 = col(4), c2 = col(8);
    // m_rc = row r, column c (three.js naming).
    const m11 = c0[0], m21 = c0[1], m31 = c0[2];
    const m12 = c1[0], m22 = c1[1], m32 = c1[2];
    const m13 = c2[0], m23 = c2[1], m33 = c2[2];
    const trace = m11 + m22 + m33;
    if (trace > 0) {
      const s = 0.5 / Math.sqrt(trace + 1);
      return this.set((m32 - m23) * s, (m13 - m31) * s, (m21 - m12) * s, 0.25 / s);
    }
    if (m11 > m22 && m11 > m33) {
      const s = 2 * Math.sqrt(Math.max(1e-12, 1 + m11 - m22 - m33));
      return this.set(0.25 * s, (m12 + m21) / s, (m13 + m31) / s, (m32 - m23) / s);
    }
    if (m22 > m33) {
      const s = 2 * Math.sqrt(Math.max(1e-12, 1 + m22 - m11 - m33));
      return this.set((m12 + m21) / s, 0.25 * s, (m23 + m32) / s, (m13 - m31) / s);
    }
    const s = 2 * Math.sqrt(Math.max(1e-12, 1 + m33 - m11 - m22));
    return this.set((m13 + m31) / s, (m23 + m32) / s, 0.25 * s, (m21 - m12) / s);
  }
  normalize() {
    const l = Math.hypot(this.x, this.y, this.z, this.w) || 1;
    return this.set(this.x / l, this.y / l, this.z / l, this.w / l);
  }
  dot(q) { return this.x * q.x + this.y * q.y + this.z * q.z + this.w * q.w; }
  // this = this * q (apply q in local space first, like three.js multiply).
  multiply(q) {
    const ax = this.x, ay = this.y, az = this.z, aw = this.w;
    const bx = q.x, by = q.y, bz = q.z, bw = q.w;
    return this.set(
      aw * bx + ax * bw + ay * bz - az * by,
      aw * by - ax * bz + ay * bw + az * bx,
      aw * bz + ax * by - ay * bx + az * bw,
      aw * bw - ax * bx - ay * by - az * bz,
    );
  }
  premultiply(q) {
    const ax = q.x, ay = q.y, az = q.z, aw = q.w;
    const bx = this.x, by = this.y, bz = this.z, bw = this.w;
    return this.set(
      aw * bx + ax * bw + ay * bz - az * by,
      aw * by - ax * bz + ay * bw + az * bx,
      aw * bz + ax * by - ay * bx + az * bw,
      aw * bw - ax * bx - ay * by - az * bz,
    );
  }
  setFromUnitVectors(vFrom, vTo) {
    // Quaternion rotating unit vector vFrom onto vTo (three.js algorithm).
    let r = vFrom.x * vTo.x + vFrom.y * vTo.y + vFrom.z * vTo.z + 1;
    if (r < 1e-8) {
      r = 0;
      if (Math.abs(vFrom.x) > Math.abs(vFrom.z)) this.set(-vFrom.y, vFrom.x, 0, r);
      else this.set(0, -vFrom.z, vFrom.y, r);
      return this.normalize();
    }
    return this.set(vFrom.y * vTo.z - vFrom.z * vTo.y, vFrom.z * vTo.x - vFrom.x * vTo.z,
      vFrom.x * vTo.y - vFrom.y * vTo.x, r).normalize();
  }
  conjugate() { this.x = -this.x; this.y = -this.y; this.z = -this.z; return this; }
  invert() { return this.conjugate().normalize(); }
  slerp(qb, t) {
    let cosHalf = this.w * qb.w + this.x * qb.x + this.y * qb.y + this.z * qb.z;
    let bx = qb.x, by = qb.y, bz = qb.z, bw = qb.w;
    if (cosHalf < 0) { cosHalf = -cosHalf; bx = -bx; by = -by; bz = -bz; bw = -bw; }
    if (cosHalf > 0.9995) {
      this.x += (bx - this.x) * t; this.y += (by - this.y) * t;
      this.z += (bz - this.z) * t; this.w += (bw - this.w) * t;
      return this.normalize();
    }
    const half = Math.acos(Math.min(1, cosHalf));
    const sinHalf = Math.sin(half);
    const ra = Math.sin((1 - t) * half) / sinHalf, rb = Math.sin(t * half) / sinHalf;
    return this.set(this.x * ra + bx * rb, this.y * ra + by * rb,
      this.z * ra + bz * rb, this.w * ra + bw * rb);
  }
  angleTo(q) { return 2 * Math.acos(Math.min(1, Math.abs(this.dot(q)))); }
  rotateTowards(q, step) {
    const angle = this.angleTo(q);
    if (angle === 0) return this;
    return this.slerp(q, Math.min(1, step / angle));
  }
  equals(q) { return this.x === q.x && this.y === q.y && this.z === q.z && this.w === q.w; }
  length() { return Math.hypot(this.x, this.y, this.z, this.w); }
  lengthSq() { return this.x * this.x + this.y * this.y + this.z * this.z + this.w * this.w; }
  fromArray(array, offset = 0) { return this.set(array[offset], array[offset + 1], array[offset + 2], array[offset + 3]); }
  toArray(array = [], offset = 0) {
    array[offset] = this.x; array[offset + 1] = this.y;
    array[offset + 2] = this.z; array[offset + 3] = this.w;
    return array;
  }
  fromBufferAttribute(attribute, index) {
    const o = index * attribute.itemSize;
    return this.set(attribute.array[o], attribute.array[o + 1], attribute.array[o + 2], attribute.array[o + 3]);
  }
  multiplyQuaternions(a, b) {
    const ax = a.x, ay = a.y, az = a.z, aw = a.w;
    const bx = b.x, by = b.y, bz = b.z, bw = b.w;
    return this.set(
      aw * bx + ax * bw + ay * bz - az * by,
      aw * by - ax * bz + ay * bw + az * bx,
      aw * bz + ax * by - ay * bx + az * bw,
      aw * bw - ax * bx - ay * by - az * bz,
    );
  }
  slerpQuaternions(qa, qb, t) {
    return this.copy(qa).slerp(qb, t);
  }
  random() {
    // Uniform random unit quaternion (Shoemake's method).
    const u1 = Math.random(), u2 = Math.random() * Math.PI * 2, u3 = Math.random() * Math.PI * 2;
    const a = Math.sqrt(1 - u1), b = Math.sqrt(u1);
    return this.set(a * Math.sin(u2), a * Math.cos(u2), b * Math.sin(u3), b * Math.cos(u3));
  }
  toJSON() { return [this.x, this.y, this.z, this.w]; }
}

// Column-major 4x4, the layout both three.js and the engine's Mat4 use.
// `quat` is {x,y,z,w}; callers resolve object.rotation/object.quaternion first.
export function composeLocal(position, quat, scale) {
  const qx = quat.x, qy = quat.y, qz = quat.z, qw = quat.w;
  const x2 = qx + qx, y2 = qy + qy, z2 = qz + qz;
  const xx = qx * x2, xy = qx * y2, xz = qx * z2;
  const yy = qy * y2, yz = qy * z2, zz = qz * z2;
  const wx = qw * x2, wy = qw * y2, wz = qw * z2;
  const m = new Float64Array(16);
  m[0] = (1 - (yy + zz)) * scale.x; m[1] = (xy + wz) * scale.x; m[2] = (xz - wy) * scale.x;
  m[4] = (xy - wz) * scale.y; m[5] = (1 - (xx + zz)) * scale.y; m[6] = (yz + wx) * scale.y;
  m[8] = (xz + wy) * scale.z; m[9] = (yz - wx) * scale.z; m[10] = (1 - (xx + yy)) * scale.z;
  m[12] = position.x; m[13] = position.y; m[14] = position.z; m[15] = 1;
  return m;
}

export function multiplyMat4(a, b) {
  const out = new Float64Array(16);
  for (let c = 0; c < 4; c++) for (let r = 0; r < 4; r++) {
    let sum = 0;
    for (let k = 0; k < 4; k++) sum += a[k * 4 + r] * b[c * 4 + k];
    out[c * 4 + r] = sum;
  }
  return out;
}

export function transformPoint(m, x, y, z) {
  return [m[0] * x + m[4] * y + m[8] * z + m[12],
    m[1] * x + m[5] * y + m[9] * z + m[13],
    m[2] * x + m[6] * y + m[10] * z + m[14]];
}
export function transformDir(m, x, y, z) {
  return [m[0] * x + m[4] * y + m[8] * z,
    m[1] * x + m[5] * y + m[9] * z,
    m[2] * x + m[6] * y + m[10] * z];
}
export function normalize3(v) {
  const l = Math.hypot(v[0], v[1], v[2]) || 1;
  return [v[0] / l, v[1] / l, v[2] / l];
}

// General column-major 4x4 inverse (cofactor expansion).
export function invertMat4(m) {
  const inv = new Float64Array(16);
  const a = m;
  inv[0] = a[5] * a[10] * a[15] - a[5] * a[11] * a[14] - a[9] * a[6] * a[15] + a[9] * a[7] * a[14] + a[13] * a[6] * a[11] - a[13] * a[7] * a[10];
  inv[4] = -a[4] * a[10] * a[15] + a[4] * a[11] * a[14] + a[8] * a[6] * a[15] - a[8] * a[7] * a[14] - a[12] * a[6] * a[11] + a[12] * a[7] * a[10];
  inv[8] = a[4] * a[9] * a[15] - a[4] * a[11] * a[13] - a[8] * a[5] * a[15] + a[8] * a[7] * a[13] + a[12] * a[5] * a[11] - a[12] * a[7] * a[9];
  inv[12] = -a[4] * a[9] * a[14] + a[4] * a[10] * a[13] + a[8] * a[5] * a[14] - a[8] * a[6] * a[13] - a[12] * a[5] * a[10] + a[12] * a[6] * a[9];
  inv[1] = -a[1] * a[10] * a[15] + a[1] * a[11] * a[14] + a[9] * a[2] * a[15] - a[9] * a[3] * a[14] - a[13] * a[2] * a[11] + a[13] * a[3] * a[10];
  inv[5] = a[0] * a[10] * a[15] - a[0] * a[11] * a[14] - a[8] * a[2] * a[15] + a[8] * a[3] * a[14] + a[12] * a[2] * a[11] - a[12] * a[3] * a[10];
  inv[9] = -a[0] * a[9] * a[15] + a[0] * a[11] * a[13] + a[8] * a[1] * a[15] - a[8] * a[3] * a[13] - a[12] * a[1] * a[11] + a[12] * a[3] * a[9];
  inv[13] = a[0] * a[9] * a[14] - a[0] * a[10] * a[13] - a[8] * a[1] * a[14] + a[8] * a[2] * a[13] + a[12] * a[1] * a[10] - a[12] * a[2] * a[9];
  inv[2] = a[1] * a[6] * a[15] - a[1] * a[7] * a[14] - a[5] * a[2] * a[15] + a[5] * a[3] * a[14] + a[13] * a[2] * a[7] - a[13] * a[3] * a[6];
  inv[6] = -a[0] * a[6] * a[15] + a[0] * a[7] * a[14] + a[4] * a[2] * a[15] - a[4] * a[3] * a[14] - a[12] * a[2] * a[7] + a[12] * a[3] * a[6];
  inv[10] = a[0] * a[5] * a[15] - a[0] * a[7] * a[13] - a[4] * a[1] * a[15] + a[4] * a[3] * a[13] + a[12] * a[1] * a[7] - a[12] * a[3] * a[5];
  inv[14] = -a[0] * a[5] * a[14] + a[0] * a[6] * a[13] + a[4] * a[1] * a[14] - a[4] * a[2] * a[13] - a[12] * a[1] * a[6] + a[12] * a[2] * a[5];
  inv[3] = -a[1] * a[6] * a[11] + a[1] * a[7] * a[10] + a[5] * a[2] * a[11] - a[5] * a[3] * a[10] - a[9] * a[2] * a[7] + a[9] * a[3] * a[6];
  inv[7] = a[0] * a[6] * a[11] - a[0] * a[7] * a[10] - a[4] * a[2] * a[11] + a[4] * a[3] * a[10] + a[8] * a[2] * a[7] - a[8] * a[3] * a[6];
  inv[11] = -a[0] * a[5] * a[11] + a[0] * a[7] * a[9] + a[4] * a[1] * a[11] - a[4] * a[3] * a[9] - a[8] * a[1] * a[7] + a[8] * a[3] * a[5];
  inv[15] = a[0] * a[5] * a[10] - a[0] * a[6] * a[9] - a[4] * a[1] * a[10] + a[4] * a[2] * a[9] + a[8] * a[1] * a[6] - a[8] * a[2] * a[5];
  let det = a[0] * inv[0] + a[1] * inv[4] + a[2] * inv[8] + a[3] * inv[12];
  if (Math.abs(det) < 1e-12) return null;
  det = 1 / det;
  for (let i = 0; i < 16; i++) inv[i] *= det;
  return inv;
}

// Column-major 4x4, same layout as the internal matrices above.
export class Matrix4 {
  isMatrix4: boolean;
  elements: Float64Array;
  constructor() { this.isMatrix4 = true; this.elements = new Float64Array(16); this.identity(); }
  set(n11, n12, n13, n14, n21, n22, n23, n24, n31, n32, n33, n34, n41, n42, n43, n44) {
    const e = this.elements;
    e[0] = n11; e[4] = n12; e[8] = n13; e[12] = n14;
    e[1] = n21; e[5] = n22; e[9] = n23; e[13] = n24;
    e[2] = n31; e[6] = n32; e[10] = n33; e[14] = n34;
    e[3] = n41; e[7] = n42; e[11] = n43; e[15] = n44;
    return this;
  }
  identity() {
    const e = this.elements;
    e.fill(0); e[0] = e[5] = e[10] = e[15] = 1;
    return this;
  }
  copy(m) { this.elements.set(m.elements || m); return this; }
  clone() { return new Matrix4().copy(this); }
  compose(position, quaternion, scale) {
    const e = this.elements, q = quaternion;
    const x2 = q.x + q.x, y2 = q.y + q.y, z2 = q.z + q.z;
    const xx = q.x * x2, xy = q.x * y2, xz = q.x * z2;
    const yy = q.y * y2, yz = q.y * z2, zz = q.z * z2;
    const wx = q.w * x2, wy = q.w * y2, wz = q.w * z2;
    e[0] = (1 - (yy + zz)) * scale.x; e[1] = (xy + wz) * scale.x; e[2] = (xz - wy) * scale.x; e[3] = 0;
    e[4] = (xy - wz) * scale.y; e[5] = (1 - (xx + zz)) * scale.y; e[6] = (yz + wx) * scale.y; e[7] = 0;
    e[8] = (xz + wy) * scale.z; e[9] = (yz - wx) * scale.z; e[10] = (1 - (xx + yy)) * scale.z; e[11] = 0;
    e[12] = position.x; e[13] = position.y; e[14] = position.z; e[15] = 1;
    return this;
  }
  multiply(m) { this.elements.set(multiplyMat4(this.elements, m.elements || m)); return this; }
  multiplyMatrices(a, b) {
    const ae = a.elements || a, be = b.elements || b, e = this.elements;
    if (ae === e || be === e) { e.set(multiplyMat4(ae, be)); return this; }
    for (let c = 0; c < 4; c++) for (let r = 0; r < 4; r++) {
      e[c * 4 + r] = ae[r] * be[c * 4] + ae[4 + r] * be[c * 4 + 1]
        + ae[8 + r] * be[c * 4 + 2] + ae[12 + r] * be[c * 4 + 3];
    }
    return this;
  }
  invert() {
    const inv = invertMat4(this.elements);
    if (inv) this.elements.set(inv);
    return this;
  }
  makeRotationFromQuaternion(q) { return this.compose(new Vector3(), q, new Vector3(1, 1, 1)); }
  makeTranslation(x, y, z) {
    const e = this.elements;
    e.fill(0); e[0] = e[5] = e[10] = e[15] = 1;
    e[12] = x; e[13] = y; e[14] = z;
    return this;
  }
  makeScale(x, y, z) {
    const e = this.elements;
    e.fill(0);
    e[0] = x; e[5] = y; e[10] = z; e[15] = 1;
    return this;
  }
  makePerspective(fov, aspect, near, far) {
    // three.js makePerspective: fov in degrees, column-major result.
    const e = this.elements;
    const f = 1 / Math.tan((fov * Math.PI / 180) / 2);
    const nf = 1 / (near - far);
    e.fill(0);
    e[0] = f / aspect; e[5] = f;
    e[10] = (far + near) * nf; e[11] = -1;
    e[14] = 2 * far * near * nf;
    return this;
  }
  makeOrthographic(left, right, top, bottom, near, far) {
    const e = this.elements;
    const w = 1 / (right - left), h = 1 / (top - bottom);
    const p = 1 / (far - near), q = (far + near) / (far - near);
    e.fill(0);
    e[0] = 2 * w; e[5] = 2 * h;
    e[10] = -2 * p; e[14] = -q;
    e[12] = -(right + left) * w;
    e[13] = -(top + bottom) * h;
    e[15] = 1;
    return this;
  }
  makeRotationX(theta) {
    const c = Math.cos(theta), s = Math.sin(theta);
    return this.set(1, 0, 0, 0, 0, c, -s, 0, 0, s, c, 0, 0, 0, 0, 1);
  }
  makeRotationY(theta) {
    const c = Math.cos(theta), s = Math.sin(theta);
    return this.set(c, 0, s, 0, 0, 1, 0, 0, -s, 0, c, 0, 0, 0, 0, 1);
  }
  makeRotationZ(theta) {
    const c = Math.cos(theta), s = Math.sin(theta);
    return this.set(c, -s, 0, 0, s, c, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1);
  }
  lookAt(eye, target, up) {
    const e = this.elements;
    let zx = eye.x - target.x, zy = eye.y - target.y, zz = eye.z - target.z;
    let zl = Math.hypot(zx, zy, zz);
    if (zl === 0) { zz = 1; zl = 1; }
    zx /= zl; zy /= zl; zz /= zl;
    let xx = up.y * zz - up.z * zy, xy = up.z * zx - up.x * zz, xz = up.x * zy - up.y * zx;
    let xl = Math.hypot(xx, xy, xz);
    if (xl === 0) {
      if (Math.abs(up.z) === 1) zx += 1e-4; else zz += 1e-4;
      const nz = Math.hypot(zx, zy, zz) || 1;
      zx /= nz; zy /= nz; zz /= nz;
      xx = up.y * zz - up.z * zy; xy = up.z * zx - up.x * zz; xz = up.x * zy - up.y * zx;
      xl = Math.hypot(xx, xy, xz) || 1;
    }
    xx /= xl; xy /= xl; xz /= xl;
    const yx = zy * xz - zz * xy, yy = zz * xx - zx * xz, yz = zx * xy - zy * xx;
    e[0] = xx; e[1] = xy; e[2] = xz; e[3] = 0;
    e[4] = yx; e[5] = yy; e[6] = yz; e[7] = 0;
    e[8] = zx; e[9] = zy; e[10] = zz; e[11] = 0;
    e[12] = 0; e[13] = 0; e[14] = 0; e[15] = 1;
    return this;
  }
  equals(m) {
    const a = this.elements, b = m.elements || m;
    for (let i = 0; i < 16; i++) if (a[i] !== b[i]) return false;
    return true;
  }
  setPosition(v) { const e = this.elements; e[12] = v.x ?? v[0]; e[13] = v.y ?? v[1]; e[14] = v.z ?? v[2]; return this; }
  extractRotation() {
    // Drop scale: normalize each basis column.
    const e = this.elements;
    for (let c = 0; c < 3; c++) {
      const i = c * 4, l = Math.hypot(e[i], e[i + 1], e[i + 2]) || 1;
      e[i] /= l; e[i + 1] /= l; e[i + 2] /= l;
    }
    e[3] = e[7] = e[11] = 0; e[15] = 1;
    return this;
  }
  copyPosition(m) {
    const e = this.elements, me = m.elements || m;
    e[12] = me[12]; e[13] = me[13]; e[14] = me[14];
    return this;
  }
  determinant() {
    const e = this.elements;
    return e[0] * (e[5] * e[10] - e[6] * e[9])
      - e[4] * (e[1] * e[10] - e[2] * e[9])
      + e[8] * (e[1] * e[6] - e[2] * e[5]);
  }
  extractBasis(xAxis, yAxis, zAxis) {
    const e = this.elements;
    xAxis.set(e[0], e[1], e[2]);
    yAxis.set(e[4], e[5], e[6]);
    zAxis.set(e[8], e[9], e[10]);
    return this;
  }
  makeBasis(xAxis, yAxis, zAxis) {
    return this.set(
      xAxis.x, xAxis.y, xAxis.z, 0,
      yAxis.x, yAxis.y, yAxis.z, 0,
      zAxis.x, zAxis.y, zAxis.z, 0,
      0, 0, 0, 1,
    );
  }
  makeRotationAxis(axis, angle) {
    const c = Math.cos(angle), s = Math.sin(angle), t = 1 - c;
    const x = axis.x, y = axis.y, z = axis.z;
    return this.set(
      t * x * x + c, t * x * y - s * z, t * x * z + s * y, 0,
      t * x * y + s * z, t * y * y + c, t * y * z - s * x, 0,
      t * x * z - s * y, t * y * z + s * x, t * z * z + c, 0,
      0, 0, 0, 1,
    );
  }
  makeRotationFromEuler(euler) {
    return this.makeRotationFromQuaternion(new Quaternion().setFromEuler(euler));
  }
  makeShear(xy = 0, xz = 0, yx = 0, yz = 0, zx = 0, zy = 0) {
    return this.set(1, yx, zx, 0, xy, 1, zy, 0, xz, yz, 1, 0, 0, 0, 1, 1);
  }
  getMaxScaleOnAxis() {
    const e = this.elements;
    const sx = e[0] * e[0] + e[1] * e[1] + e[2] * e[2];
    const sy = e[4] * e[4] + e[5] * e[5] + e[6] * e[6];
    const sz = e[8] * e[8] + e[9] * e[9] + e[10] * e[10];
    return Math.sqrt(Math.max(sx, sy, sz));
  }
  scale(v) {
    const e = this.elements;
    e[0] *= v.x; e[1] *= v.x; e[2] *= v.x;
    e[4] *= v.y; e[5] *= v.y; e[6] *= v.y;
    e[8] *= v.z; e[9] *= v.z; e[10] *= v.z;
    return this;
  }
  multiplyScalar(s) {
    const e = this.elements;
    for (let i = 0; i < 16; i++) e[i] *= s;
    return this;
  }
  transpose() {
    const e = this.elements;
    for (let r = 0; r < 3; r++)
      for (let c = r + 1; c < 3; c++) {
        const a = c * 4 + r, b = r * 4 + c;
        const t = e[a]; e[a] = e[b]; e[b] = t;
      }
    return this;
  }
  fromArray(array, offset = 0) {
    const e = this.elements;
    for (let i = 0; i < 16; i++) e[i] = array[offset + i];
    return this;
  }
  toArray(array = [], offset = 0) {
    const e = this.elements;
    for (let i = 0; i < 16; i++) array[offset + i] = e[i];
    return array;
  }
  setFromMatrix3(m) {
    const e = this.elements, me = m.elements || m;
    e[0] = me[0]; e[1] = me[1]; e[2] = me[2]; e[3] = 0;
    e[4] = me[3]; e[5] = me[4]; e[6] = me[5]; e[7] = 0;
    e[8] = me[6]; e[9] = me[7]; e[10] = me[8]; e[11] = 0;
    e[12] = 0; e[13] = 0; e[14] = 0; e[15] = 1;
    return this;
  }
  premultiply(m) {
    this.elements.set(multiplyMat4(m.elements || m, this.elements));
    return this;
  }
  // Decompose into position/quaternion/scale, matching three.js Matrix4.decompose.
  decompose(position, quaternion, scale) {
    const e = this.elements;
    position.set(e[12], e[13], e[14]);
    const sx = Math.hypot(e[0], e[1], e[2]);
    const sy = Math.hypot(e[4], e[5], e[6]);
    const sz = Math.hypot(e[8], e[9], e[10]);
    // Sign of the determinant decides whether the z-scale is negative.
    const det = e[0] * (e[5] * e[10] - e[6] * e[9])
      - e[4] * (e[1] * e[10] - e[2] * e[9])
      + e[8] * (e[1] * e[6] - e[2] * e[5]);
    scale.set(sx, sy, det < 0 ? -sz : sz);
    // Rotation part: basis columns divided by their scale.
    const rot = _decompMat.copy(this);
    const re = rot.elements;
    if (sx) { re[0] /= sx; re[1] /= sx; re[2] /= sx; }
    if (sy) { re[4] /= sy; re[5] /= sy; re[6] /= sy; }
    if (sz) { re[8] /= sz; re[9] /= sz; re[10] /= sz; }
    quaternion.setFromRotationMatrix(rot);
    return this;
  }
}
const _decompMat = new Matrix4();



/* --- math utils --------------------------------------------------------------- */

export const MathUtils = {
  DEG2RAD: Math.PI / 180,
  RAD2DEG: 180 / Math.PI,
  clamp: (v, min, max) => Math.max(min, Math.min(max, v)),
  lerp: (a, b, t) => a + (b - a) * t,
  mapLinear: (v, inMin, inMax, outMin, outMax) =>
    outMin + (outMax - outMin) * ((v - inMin) / (inMax - inMin || 1)),
  degToRad: d => d * Math.PI / 180,
  radToDeg: r => r * 180 / Math.PI,
  smoothstep: (x, min, max) => {
    const t = Math.max(0, Math.min(1, (x - min) / (max - min || 1e-12)));
    return t * t * (3 - 2 * t);
  },
  generateUUID: () => 'uuid-' + Math.random().toString(36).slice(2) + Math.random().toString(36).slice(2),
  euclideanModulo: (n, m) => ((n % m) + m) % m,
  isPowerOfTwo: n => n > 0 && (n & (n - 1)) === 0,
  ceilPowerOfTwo: n => Math.pow(2, Math.ceil(Math.log(n) / Math.LN2)),
  floorPowerOfTwo: n => Math.pow(2, Math.floor(Math.log(n) / Math.LN2)),
  setQuaternionFromProperEuler: (q, a, b, c, order) => q,
};

// Frame clock matching three.js Clock: getDelta()/getElapsedTime() in
// seconds, with autoStart and an optional performance.now override.
export class Clock {
  autoStart: boolean;
  startTime = 0;
  oldTime = 0;
  elapsedTime = 0;
  running = false;
  constructor(autoStart = true) { this.autoStart = autoStart; }
  start() {
    this.startTime = nowMs();
    this.oldTime = this.startTime;
    this.elapsedTime = 0;
    this.running = true;
  }
  stop() { this.getElapsedTime(); this.running = false; this.autoStart = false; return this.elapsedTime; }
  getElapsedTime() {
    this.getDelta();
    return this.elapsedTime;
  }
  getDelta() {
    let diff = 0;
    if (this.autoStart && !this.running) this.start();
    if (this.running) {
      const newTime = nowMs();
      diff = (newTime - this.oldTime) / 1000;
      this.oldTime = newTime;
      this.elapsedTime += diff;
    }
    return diff;
  }
}

function nowMs() {
  return (typeof performance !== 'undefined' && performance.now) ? performance.now() : Date.now();
}



export class Vector2 {
  isVector2: boolean;
  x: number;
  y: number;
  constructor(x = 0, y = 0) { this.isVector2 = true; this.x = x; this.y = y; }
  set(x, y) { this.x = x; this.y = y; return this; }
  setScalar(s) { this.x = s; this.y = s; return this; }
  copy(v) { this.x = v.x; this.y = v.y; return this; }
  clone() { return new Vector2(this.x, this.y); }
  add(v) { this.x += v.x; this.y += v.y; return this; }
  sub(v) { this.x -= v.x; this.y -= v.y; return this; }
  multiplyScalar(s) { this.x *= s; this.y *= s; return this; }
  divideScalar(s) { return this.multiplyScalar(1 / (s || 1)); }
  negate() { return this.set(-this.x, -this.y); }
  dot(v) { return this.x * v.x + this.y * v.y; }
  cross(v) { return this.x * v.y - this.y * v.x; }
  length() { return Math.hypot(this.x, this.y); }
  lengthSq() { return this.x * this.x + this.y * this.y; }
  normalize() { const l = this.length() || 1; return this.multiplyScalar(1 / l); }
  distanceTo(v) { return Math.hypot(this.x - v.x, this.y - v.y); }
  distanceToSquared(v) { const dx = this.x - v.x, dy = this.y - v.y; return dx * dx + dy * dy; }
  lerp(v, alpha) { this.x += (v.x - this.x) * alpha; this.y += (v.y - this.y) * alpha; return this; }
  clamp(min, max) {
    this.x = Math.min(Math.max(this.x, min.x), max.x);
    this.y = Math.min(Math.max(this.y, min.y), max.y);
    return this;
  }
  equals(v) { return this.x === v.x && this.y === v.y; }
  addScalar(s) { this.x += s; this.y += s; return this; }
  subScalar(s) { this.x -= s; this.y -= s; return this; }
  multiply(v) { this.x *= v.x; this.y *= v.y; return this; }
  divide(v) { this.x /= v.x || 1; this.y /= v.y || 1; return this; }
  addVectors(a, b) { return this.set(a.x + b.x, a.y + b.y); }
  subVectors(a, b) { return this.set(a.x - b.x, a.y - b.y); }
  lerpVectors(a, b, alpha) { return this.set(a.x + (b.x - a.x) * alpha, a.y + (b.y - a.y) * alpha); }
  angle() { return Math.atan2(this.y, this.x); }
  angleTo(v) {
    const d = Math.sqrt(this.lengthSq() * v.lengthSq());
    if (d === 0) return Math.PI / 2;
    return Math.acos(Math.max(-1, Math.min(1, this.dot(v) / d)));
  }
  manhattanLength() { return Math.abs(this.x) + Math.abs(this.y); }
  manhattanDistanceTo(v) { return Math.abs(this.x - v.x) + Math.abs(this.y - v.y); }
  ceil() { return this.set(Math.ceil(this.x), Math.ceil(this.y)); }
  floor() { return this.set(Math.floor(this.x), Math.floor(this.y)); }
  round() { return this.set(Math.round(this.x), Math.round(this.y)); }
  roundToZero() {
    return this.set(this.x < 0 ? Math.ceil(this.x) : Math.floor(this.x),
      this.y < 0 ? Math.ceil(this.y) : Math.floor(this.y));
  }
  setLength(length) { return this.normalize().multiplyScalar(length); }
  clampLength(min, max) {
    const l = this.length();
    if (l === 0) return this;
    return this.multiplyScalar(Math.max(min, Math.min(max, l)) / l);
  }
  clampScalar(min, max) { return this.clamp(_v2Min.set(min, min), _v2Max.set(max, max)); }
  setX(x) { this.x = x; return this; }
  setY(y) { this.y = y; return this; }
  rotateAround(center, angle) {
    const c = Math.cos(angle), s = Math.sin(angle);
    const dx = this.x - center.x, dy = this.y - center.y;
    return this.set(center.x + dx * c - dy * s, center.y + dx * s + dy * c);
  }
  random() { this.x = Math.random(); this.y = Math.random(); return this; }
  get width() { return this.x; }
  get height() { return this.y; }
  fromArray(a, offset = 0) { return this.set(a[offset], a[offset + 1]); }
  toArray(a = [], offset = 0) { a[offset] = this.x; a[offset + 1] = this.y; return a; }
  fromBufferAttribute(attribute, index) {
    const a = attribute.array, s = attribute.itemSize || 2;
    return this.set(a[index * s], a[index * s + 1]);
  }
  getComponent(index) { return index === 0 ? this.x : this.y; }
  setComponent(index, value) { if (index === 0) this.x = value; else this.y = value; return this; }
  addScaledVector(v, s) { this.x += v.x * s; this.y += v.y * s; return this; }
  min(v) { this.x = Math.min(this.x, v.x); this.y = Math.min(this.y, v.y); return this; }
  max(v) { this.x = Math.max(this.x, v.x); this.y = Math.max(this.y, v.y); return this; }
  applyMatrix3(m) {
    const e = m.elements || m;
    const x = this.x, y = this.y;
    return this.set(e[0] * x + e[3] * y, e[1] * x + e[4] * y);
  }
}

const _v2Min = new Vector2(), _v2Max = new Vector2();
