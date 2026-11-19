import { FrontSide, BackSide, DoubleSide } from './materials';
import { worldMatrixOf } from './bridge';

/* --- colour management -------------------------------------------------- */

export function srgbToLinear(c) {
  return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
}
export function linearToSrgb(c) {
  return c <= 0.0031308 ? c * 12.92 : 1.055 * Math.pow(c, 1 / 2.4) - 0.055;
}
export function hexToRgb(hex) {
  const value = hex & 0xffffff;
  return [(value >> 16 & 0xff) / 255, (value >> 8 & 0xff) / 255, (value & 0xff) / 255];
}
function parseCssColor(style) {
  const text = String(style).trim().toLowerCase();
  const hex = text.match(/^#([0-9a-f]{3,8})$/);
  if (hex) {
    let digits = hex[1];
    if (digits.length === 3 || digits.length === 4) digits = [...digits].map(d => d + d).join('');
    if (digits.length === 6 || digits.length === 8) {
      const value = parseInt(digits.slice(0, 6), 16);
      return [...hexToRgb(value).map(srgbToLinear), digits.length === 8 ? parseInt(digits.slice(6), 16) / 255 : 1];
    }
  }
  const rgb = text.match(/^rgba?\(\s*([\d.]+)[\s,]+([\d.]+)[\s,]+([\d.]+)/);
  if (rgb) return [srgbToLinear(+rgb[1] / 255), srgbToLinear(+rgb[2] / 255), srgbToLinear(+rgb[3] / 255), 1];
  const named = { white: [1, 1, 1], black: [0, 0, 0], red: [1, 0, 0], green: [0, 128 / 255, 0],
    blue: [0, 0, 1], gray: [0.502, 0.502, 0.502], grey: [0.502, 0.502, 0.502],
    yellow: [1, 1, 0], cyan: [0, 1, 1], magenta: [1, 0, 1], orange: [1, 0.647, 0] };
  if (named[text]) return [...named[text], 1];
  throw new Error(`gs3d: unsupported colour '${style}'`);
}

// Colours store linear working-space components, like three r152+ with the
// default color management. Hex and CSS strings arrive in sRGB and convert.
export class Color {
  isColor: boolean;
  r: number;
  g: number;
  b: number;
  constructor(r: any = 0xffffff, g?: number, b?: number) {
    this.isColor = true;
    this.r = 1; this.g = 1; this.b = 1;
    this.set(r, g, b);
  }
  set(value: any, g?: number, b?: number) {
    if (value === undefined) return this;
    if (typeof value === 'number' && g === undefined) return this.setHex(value);
    if (typeof value === 'string') {
      const [r, gg, bb] = parseCssColor(value);
      this.r = r; this.g = gg; this.b = bb;
      return this;
    }
    if (value && value.isColor) return this.copy(value);
    return this.setRGB(value, g, b);
  }
  setHex(hex) {
    const [r, g, b] = hexToRgb(hex);
    // Hex colours arrive in sRGB and convert to the linear working space.
    return this.setRGB(srgbToLinear(r), srgbToLinear(g), srgbToLinear(b));
  }
  setRGB(r, g, b) {
    // Numeric triples are already working-space (linear) values.
    this.r = r; this.g = g; this.b = b;
    return this;
  }
  setStyle(style) { return this.set(style); }
  copy(color) { this.r = color.r; this.g = color.g; this.b = color.b; return this; }
  clone() { return new Color().copy(this); }
  getHex() {
    const toByte = c => Math.round(Math.min(Math.max(linearToSrgb(c), 0), 1) * 255);
    return (toByte(this.r) << 16) | (toByte(this.g) << 8) | toByte(this.b);
  }
  getHexString() { return this.getHex().toString(16).padStart(6, '0'); }
  getStyle() {
    const toByte = c => Math.round(Math.min(Math.max(linearToSrgb(c), 0), 1) * 255);
    return `rgb(${toByte(this.r)}, ${toByte(this.g)}, ${toByte(this.b)})`;
  }
  lerp(color, alpha) {
    this.r += (color.r - this.r) * alpha;
    this.g += (color.g - this.g) * alpha;
    this.b += (color.b - this.b) * alpha;
    return this;
  }
  // HSL helpers operate in linear space like the stored components.
  getHSL(target: { h?: number; s?: number; l?: number } = {}) {
    const r = this.r, g = this.g, b = this.b;
    const max = Math.max(r, g, b), min = Math.min(r, g, b);
    const l = (max + min) / 2, d = max - min;
    let h = 0, s = 0;
    if (d > 1e-12) {
      s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
      if (max === r) h = (g - b) / d + (g < b ? 6 : 0);
      else if (max === g) h = (b - r) / d + 2;
      else h = (r - g) / d + 4;
      h /= 6;
    }
    target.h = h; target.s = s; target.l = l;
    return target;
  }
  offsetHSL(h, s, l) {
    const hsl = this.getHSL({ h: 0, s: 0, l: 0 });
    hsl.h = (hsl.h + h) % 1; if (hsl.h < 0) hsl.h += 1;
    hsl.s = Math.min(1, Math.max(0, hsl.s + s));
    hsl.l = Math.min(1, Math.max(0, hsl.l + l));
    const { h: hh, s: ss, l: ll } = hsl;
    if (ss === 0) { const v = ll; return this.setRGB(v, v, v); }
    const q = ll < 0.5 ? ll * (1 + ss) : ll + ss - ll * ss;
    const p = 2 * ll - q;
    const f = t => {
      t = ((t % 1) + 1) % 1;
      if (t < 1 / 6) return p + (q - p) * 6 * t;
      if (t < 1 / 2) return q;
      if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
      return p;
    };
    return this.setRGB(f(hh + 1 / 3), f(hh), f(hh - 1 / 3));
  }
}

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
  addScaledVector(v, scale) { this.x += v.x * scale; this.y += v.y * scale; this.z += v.z * scale; return this; }
  sub(v) { this.x -= v.x; this.y -= v.y; this.z -= v.z; return this; }
  multiplyScalar(s) { this.x *= s; this.y *= s; this.z *= s; return this; }
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
  setFromMatrixPosition(m) { return this.set(m[12], m[13], m[14]); }
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
