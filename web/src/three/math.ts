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
  setFromMatrixPosition(m) { const e = m.elements || m; return this.set(e[12], e[13], e[14]); }
}

export class Vector4 {
  isVector4: boolean;
  x: number;
  y: number;
  z: number;
  w: number;
  constructor(x = 0, y = 0, z = 0, w = 0) { this.isVector4 = true; this.x = x; this.y = y; this.z = z; this.w = w; }
  set(x, y, z, w) { this.x = x; this.y = y; this.z = z; this.w = w; return this; }
  copy(v) { this.x = v.x; this.y = v.y; this.z = v.z; this.w = v.w; return this; }
  clone() { return new Vector4(this.x, this.y, this.z, this.w); }
}

export class Euler {
  x: number;
  y: number;
  z: number;
  order: string;
  isEuler: boolean;
  constructor(x = 0, y = 0, z = 0, order = 'XYZ') {
    this.x = x; this.y = y; this.z = z; this.order = order; this.isEuler = true;
  }
  set(x, y, z, order) { this.x = x; this.y = y; this.z = z; if (order) this.order = order; return this; }
  copy(e) { this.x = e.x; this.y = e.y; this.z = e.z; this.order = e.order; return this; }
  clone() { return new Euler(this.x, this.y, this.z, this.order); }
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
  x: number;
  y: number;
  z: number;
  w: number;
  constructor(x = 0, y = 0, z = 0, w = 1) { this.isQuaternion = true; this.x = x; this.y = y; this.z = z; this.w = w; }
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
}



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
};



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
}
