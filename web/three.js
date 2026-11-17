// A Three.js-compatible facade over the Goose 3D WebAssembly engine.
//
// `import * as THREE from 'gs3d'` (or 'gs3d/three') covers the common scene
// graph: Object3D transforms, meshes with BufferGeometry, standard and basic
// materials, the four light types plus hemisphere fill, perspective and
// orthographic cameras, and a WebGPURenderer whose init/render/setSize calls
// drive the engine's WebGL2 backend one frame at a time.
//
// The facade keeps a parallel scene graph in JavaScript and mirrors it into
// the engine through the g3_asset_* bridge on every render() call: engine
// nodes are created lazily, local matrices are rewritten only when they
// change, and geometry/material uploads are cached per object and rebuilt
// when their version or signature changes.
//
// Deliberate subset: no skinning, morph targets, fog objects beyond
// Fog/FogExp2 approximation, quaternion editing, or post-processing. One
// directional light can cast a single shadow map; point and spot lights do
// not shadow yet. The renderer class is named WebGPURenderer for API
// compatibility; the engine currently renders through its WebGL2 backend.

import createGoose3D from './gs3d/app.js';

const wasmUrl = new URL('./gs3d/app.wasm', import.meta.url);
const DEG2RAD = Math.PI / 180;
const MAX_EXTRA_LIGHTS = 8;

function requestFrame(callback) {
  if (typeof requestAnimationFrame === 'function') return requestAnimationFrame(callback);
  return setTimeout(() => callback(performance.now()), 16);
}
function cancelFrame(handle) {
  if (typeof cancelAnimationFrame === 'function') cancelAnimationFrame(handle);
  else clearTimeout(handle);
}

/* --- colour management -------------------------------------------------- */

function srgbToLinear(c) {
  return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
}
function linearToSrgb(c) {
  return c <= 0.0031308 ? c * 12.92 : 1.055 * Math.pow(c, 1 / 2.4) - 0.055;
}
function hexToRgb(hex) {
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
  constructor(r = 0xffffff, g, b) {
    this.isColor = true;
    this.r = 1; this.g = 1; this.b = 1;
    this.set(r, g, b);
  }
  set(value, g, b) {
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
  getHSL(target = {}) {
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

export class Euler {
  constructor(x = 0, y = 0, z = 0, order = 'XYZ') {
    this.x = x; this.y = y; this.z = z; this.order = order; this.isEuler = true;
  }
  set(x, y, z, order) { this.x = x; this.y = y; this.z = z; if (order) this.order = order; return this; }
  copy(e) { this.x = e.x; this.y = e.y; this.z = e.z; this.order = e.order; return this; }
  clone() { return new Euler(this.x, this.y, this.z, this.order); }
}

// XYZ-order Euler <-> quaternion, matching the convention composeLocal used.
function quatFromEulerXYZ(x, y, z) {
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

function eulerFromQuatXYZ(q) {
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
  constructor(x = 0, y = 0, z = 0, w = 1) { this.isQuaternion = true; this.x = x; this.y = y; this.z = z; this.w = w; }
  set(x, y, z, w) { this.x = x; this.y = y; this.z = z; this.w = w; return this; }
  copy(q) { this.x = q.x; this.y = q.y; this.z = q.z; this.w = q.w; return this; }
  clone() { return new Quaternion(this.x, this.y, this.z, this.w); }
  identity() { return this.set(0, 0, 0, 1); }
  setFromEuler(e) { const q = quatFromEulerXYZ(e.x, e.y, e.z); return this.set(q.x, q.y, q.z, q.w); }
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
function composeLocal(position, quat, scale) {
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

function multiplyMat4(a, b) {
  const out = new Float64Array(16);
  for (let c = 0; c < 4; c++) for (let r = 0; r < 4; r++) {
    let sum = 0;
    for (let k = 0; k < 4; k++) sum += a[k * 4 + r] * b[c * 4 + k];
    out[c * 4 + r] = sum;
  }
  return out;
}

function transformPoint(m, x, y, z) {
  return [m[0] * x + m[4] * y + m[8] * z + m[12],
    m[1] * x + m[5] * y + m[9] * z + m[13],
    m[2] * x + m[6] * y + m[10] * z + m[14]];
}
function transformDir(m, x, y, z) {
  return [m[0] * x + m[4] * y + m[8] * z,
    m[1] * x + m[5] * y + m[9] * z,
    m[2] * x + m[6] * y + m[10] * z];
}
function normalize3(v) {
  const l = Math.hypot(v[0], v[1], v[2]) || 1;
  return [v[0] / l, v[1] / l, v[2] / l];
}

// General column-major 4x4 inverse (cofactor expansion).
function invertMat4(m) {
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

/* --- scene graph ---------------------------------------------------------- */

export class Object3D {
  constructor() {
    this.isObject3D = true;
    this.name = '';
    this.position = new Vector3();
    this.rotation = new Euler();
    this.quaternion = new Quaternion();
    this.scale = new Vector3(1, 1, 1);
    // Rotation snapshots for resolvedQuaternion's change detection.
    this._qCache = { x: 0, y: 0, z: 0, w: 1 };
    this._eCache = { x: 0, y: 0, z: 0 };
    this.children = [];
    this.parent = null;
    this.visible = true;
    this.castShadow = false;
    this.receiveShadow = false;
    this.matrixAutoUpdate = true;
    this.matrix = new Matrix4();
    this.matrixWorld = new Matrix4();
    this.userData = {};
  }
  add(...objects) {
    for (const object of objects) {
      if (object.parent) object.parent.remove(object);
      object.parent = this;
      this.children.push(object);
    }
    return this;
  }
  remove(...objects) {
    for (const object of objects) {
      const index = this.children.indexOf(object);
      if (index >= 0) {
        this.children.splice(index, 1);
        object.parent = null;
        releaseEngineTree(object);
      }
    }
    return this;
  }
  clear() {
    for (const child of [...this.children]) this.remove(child);
    return this;
  }
  removeFromParent() {
    if (this.parent) this.parent.remove(this);
    return this;
  }
  traverse(callback) {
    callback(this);
    for (const child of this.children) child.traverse(callback);
  }
  getObjectByName(name) {
    if (this.name === name) return this;
    for (const child of this.children) {
      const found = child.getObjectByName(name);
      if (found) return found;
    }
    return null;
  }
  getObjectByProperty(name, value) {
    if (this[name] === value) return this;
    for (const child of this.children) {
      const found = child.getObjectByProperty(name, value);
      if (found) return found;
    }
    return null;
  }
  traverseAncestors(callback) {
    let parent = this.parent;
    while (parent) { callback(parent); parent = parent.parent; }
    return this;
  }
  get ancestors() {
    const out = [];
    this.traverseAncestors(o => out.push(o));
    return out;
  }
  updateMatrix() {
    if (this.matrixAutoUpdate) {
      // localMatrixOf caches the composed elements, so this is a copy
      // unless the transform actually changed.
      this.matrix.elements.set(localMatrixOf(this));
    }
    return this;
  }
  updateMatrixWorld(force) {
    if (this.matrixAutoUpdate) this.updateMatrix();
    if (this.parent && this.parent.matrixWorld) {
      this.matrixWorld.multiplyMatrices(this.parent.matrixWorld, this.matrix);
    } else {
      this.matrixWorld.copy(this.matrix);
    }
    for (const child of this.children) child.updateMatrixWorld(force);
    return this;
  }
  // Yaw/pitch look-at: cameras and lights face -Z toward the target like
  // three.js; other objects face +Z. Roll and non-uniform parent scale are
  // not modelled.
  lookAt(target) {
    const pos = transformPoint(worldMatrixOf(this), 0, 0, 0);
    const tp = target && target.isVector3 ? [target.x, target.y, target.z]
      : target ? transformPoint(worldMatrixOf(target), 0, 0, 0) : [0, 0, 0];
    let dx = tp[0] - pos[0], dy = tp[1] - pos[1], dz = tp[2] - pos[2];
    const len = Math.hypot(dx, dy, dz) || 1;
    dx /= len; dy /= len; dz /= len;
    if (!this.isCamera && !this.isLight) { dx = -dx; dy = -dy; dz = -dz; }
    const dyz = Math.hypot(dy, dz);
    this.rotation.set(Math.atan2(dy, -dz), Math.atan2(-dx, dyz || 1e-9), 0);
    return this;
  }
  getWorldPosition(target = new Vector3()) {
    const p = transformPoint(worldMatrixOf(this), 0, 0, 0);
    return target.set(p[0], p[1], p[2]);
  }
  getWorldDirection(target = new Vector3()) {
    const d = normalize3(transformDir(worldMatrixOf(this), 0, 0, -1));
    return target.set(d[0], d[1], d[2]);
  }
  getWorldQuaternion(target = new Quaternion()) {
    return target.setFromRotationMatrix(worldMatrixOf(this));
  }
}

export class Group extends Object3D {
  constructor() { super(); this.isGroup = true; }
}

export class Scene extends Object3D {
  constructor() {
    super();
    this.isScene = true;
    this.background = null;
    this.fog = null;
    this.environment = null;
    this.environmentIntensity = 1;
    this.environmentRotation = 0;
  }
}

/* --- geometry -------------------------------------------------------------- */

export class BufferAttribute {
  constructor(array, itemSize, normalized = false) {
    this.isBufferAttribute = true;
    this.array = array;
    this.itemSize = itemSize;
    this.normalized = normalized;
    this.count = array.length / itemSize;
  }
}
export class Float32BufferAttribute extends BufferAttribute {
  constructor(array, itemSize) { super(Float32Array.from(array), itemSize); }
}
export class Uint16BufferAttribute extends BufferAttribute {
  constructor(array, itemSize) { super(Uint16Array.from(array), itemSize); }
}
export class Uint32BufferAttribute extends BufferAttribute {
  constructor(array, itemSize) { super(Uint32Array.from(array), itemSize); }
}

export class InterleavedBuffer {
  constructor(array, stride) {
    this.isInterleavedBuffer = true;
    this.array = array;
    this.stride = stride;
    this.usage = 35044;
  }
}

// Strided view into an InterleavedBuffer; ensureGeometry deinterleaves it
// into a plain per-attribute array before packing engine vertices.
export class InterleavedBufferAttribute {
  constructor(data, itemSize, offset = 0, normalized = false) {
    this.isBufferAttribute = true;
    this.isInterleavedBufferAttribute = true;
    this.data = data;
    this.itemSize = itemSize;
    this.offset = offset;
    this.normalized = normalized;
    this.count = Math.max(0, Math.floor(data.array.length / data.stride));
  }
}

export class BufferGeometry {
  constructor() {
    this.isBufferGeometry = true;
    this.attributes = {};
    this.index = null;
    this.groups = [];
    this.boundingSphere = null;
    this.version = 0;
  }
  setAttribute(name, attribute) {
    this.attributes[name] = attribute;
    this.version++;
    return this;
  }
  getAttribute(name) { return this.attributes[name]; }
  setIndex(index) {
    if (index === null || index === undefined) this.index = null;
    else if (index.isBufferAttribute) this.index = index;
    else this.index = new Uint32BufferAttribute(index, 1);
    this.version++;
    return this;
  }
  computeVertexNormals() {
    const position = this.attributes.position;
    if (!position) return this;
    const pd = attrData(position);
    const p = pd.array, ps = pd.itemSize;
    const index = this.index;
    const normals = new Float32Array(pd.count * 3);
    const tri = (a, b, c) => {
      const ax = p[a * ps], ay = p[a * ps + 1], az = p[a * ps + 2];
      const abx = p[b * ps] - ax, aby = p[b * ps + 1] - ay, abz = p[b * ps + 2] - az;
      const acx = p[c * ps] - ax, acy = p[c * ps + 1] - ay, acz = p[c * ps + 2] - az;
      const nx = aby * acz - abz * acy, ny = abz * acx - abx * acz, nz = abx * acy - aby * acx;
      for (const v of [a, b, c]) {
        normals[v * 3] += nx; normals[v * 3 + 1] += ny; normals[v * 3 + 2] += nz;
      }
    };
    if (index) {
      const ids = index.array;
      for (let i = 0; i + 2 < ids.length; i += 3) tri(ids[i], ids[i + 1], ids[i + 2]);
    } else {
      for (let i = 0; i + 2 < pd.count; i += 3) tri(i, i + 1, i + 2);
    }
    for (let i = 0; i < normals.length; i += 3) {
      const l = Math.hypot(normals[i], normals[i + 1], normals[i + 2]);
      if (l > 0) { normals[i] /= l; normals[i + 1] /= l; normals[i + 2] /= l; }
      else { normals[i] = 0; normals[i + 1] = 0; normals[i + 2] = 1; }
    }
    this.setAttribute('normal', new Float32BufferAttribute(normals, 3));
    return this;
  }
  computeBoundingSphere() {
    const position = this.attributes.position;
    if (!position) { this.boundingSphere = null; return this; }
    const pd = attrData(position);
    const p = pd.array, ps = pd.itemSize;
    let minX = Infinity, minY = Infinity, minZ = Infinity;
    let maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;
    for (let i = 0; i < pd.count; i++) {
      const x = p[i * ps], y = p[i * ps + 1], z = p[i * ps + 2];
      if (x < minX) minX = x; if (x > maxX) maxX = x;
      if (y < minY) minY = y; if (y > maxY) maxY = y;
      if (z < minZ) minZ = z; if (z > maxZ) maxZ = z;
    }
    const center = new Vector3((minX + maxX) / 2, (minY + maxY) / 2, (minZ + maxZ) / 2);
    let radius = 0;
    for (let i = 0; i < pd.count; i++) {
      const dx = p[i * ps] - center.x, dy = p[i * ps + 1] - center.y, dz = p[i * ps + 2] - center.z;
      const d = dx * dx + dy * dy + dz * dz;
      if (d > radius) radius = d;
    }
    this.boundingSphere = { isBoundingSphere: true, center, radius: Math.sqrt(radius) };
    return this;
  }
  dispose() {
    this.version++;
    releaseGeometry(this);
  }
}

/* --- primitive geometries -----------------------------------------------------
   Parametric generators matching three.js vertex layouts: positions,
   normals and uvs plus an index buffer, so lighting and UV mapping behave
   the same as the real thing. */

function gridGeometry(nu, nv, vertexAt, uvAt, flip = false) {
  // vertexAt(u, v) -> [x, y, z, nx, ny, nz]; uvAt(u, v) -> [u, v]
  const positions = [], normals = [], uvs = [], indices = [];
  for (let j = 0; j <= nv; j++) for (let i = 0; i <= nu; i++) {
    const u = i / nu, v = j / nv;
    const [x, y, z, nx, ny, nz] = vertexAt(u, v);
    positions.push(x, y, z); normals.push(nx, ny, nz);
    const [tu, tv] = uvAt(u, v); uvs.push(tu, tv);
  }
  const stride = nu + 1;
  for (let j = 0; j < nv; j++) for (let i = 0; i < nu; i++) {
    const a = j * stride + i, b = a + 1, c = a + stride, d = c + 1;
    if (flip) indices.push(a, c, b, b, c, d);
    else indices.push(a, b, c, b, d, c);
  }
  return { positions, normals, uvs, indices };
}

function makeGeometry(data) {
  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new Float32BufferAttribute(data.positions, 3));
  geometry.setAttribute('normal', new Float32BufferAttribute(data.normals, 3));
  geometry.setAttribute('uv', new Float32BufferAttribute(data.uvs, 2));
  geometry.setIndex(new Uint32BufferAttribute(data.indices, 1));
  return geometry;
}

export class BoxGeometry extends BufferGeometry {
  constructor(width = 1, height = 1, depth = 1, widthSegments = 1, heightSegments = 1, depthSegments = 1) {
    super();
    const positions = [], normals = [], uvs = [], indices = [];
    const hw = width / 2, hh = height / 2, hd = depth / 2;
    // Each face is a grid in its own two axes; three.js duplicates vertices
    // per face so normals and uvs stay per-face.
    const face = (nu, nv, normal, build) => {
      const base = positions.length / 3;
      for (let j = 0; j <= nv; j++) for (let i = 0; i <= nu; i++) {
        const [p, uv] = build(i / nu, j / nv);
        positions.push(p[0], p[1], p[2]); normals.push(normal[0], normal[1], normal[2]); uvs.push(uv[0], uv[1]);
      }
      const stride = nu + 1;
      for (let j = 0; j < nv; j++) for (let i = 0; i < nu; i++) {
        const a = base + j * stride + i;
        indices.push(a, a + 1, a + stride, a + 1, a + stride + 1, a + stride);
      }
    };
    // +X / -X faces span z (u) and y (v).
    face(depthSegments, heightSegments, [1, 0, 0], (u, v) => [[hw, (0.5 - v) * height, (u - 0.5) * depth], [u, v]]);
    face(depthSegments, heightSegments, [-1, 0, 0], (u, v) => [[-hw, (0.5 - v) * height, (0.5 - u) * depth], [u, v]]);
    // +Y / -Y faces span x (u) and z (v).
    face(widthSegments, depthSegments, [0, 1, 0], (u, v) => [[(u - 0.5) * width, hh, (0.5 - v) * depth], [u, v]]);
    face(widthSegments, depthSegments, [0, -1, 0], (u, v) => [[(u - 0.5) * width, -hh, (v - 0.5) * depth], [u, v]]);
    // +Z / -Z faces span x (u) and y (v).
    face(widthSegments, heightSegments, [0, 0, 1], (u, v) => [[(u - 0.5) * width, (v - 0.5) * height, hd], [u, v]]);
    face(widthSegments, heightSegments, [0, 0, -1], (u, v) => [[(0.5 - u) * width, (v - 0.5) * height, -hd], [u, v]]);
    this.setAttribute('position', new Float32BufferAttribute(positions, 3));
    this.setAttribute('normal', new Float32BufferAttribute(normals, 3));
    this.setAttribute('uv', new Float32BufferAttribute(uvs, 2));
    this.setIndex(new Uint32BufferAttribute(indices, 1));
  }
}

export class SphereGeometry extends BufferGeometry {
  constructor(radius = 1, widthSegments = 32, heightSegments = 16, phiStart = 0, phiLength = Math.PI * 2, thetaStart = 0, thetaLength = Math.PI) {
    super();
    const data = gridGeometry(widthSegments, heightSegments,
      (u, v) => {
        const phi = phiStart + u * phiLength;
        const theta = thetaStart + v * thetaLength;
        const x = -radius * Math.cos(phi) * Math.sin(theta);
        const y = radius * Math.cos(theta);
        const z = radius * Math.sin(phi) * Math.sin(theta);
        const l = radius || 1;
        return [x, y, z, x / l, y / l, z / l];
      },
      (u, v) => [u, 1 - v], true);
    const g = makeGeometry(data);
    this.attributes = g.attributes; this.index = g.index; this.version++;
  }
}

export class PlaneGeometry extends BufferGeometry {
  constructor(width = 1, height = 1, widthSegments = 1, heightSegments = 1) {
    super();
    const data = gridGeometry(widthSegments, heightSegments,
      (u, v) => [(u - 0.5) * width, (0.5 - v) * height, 0, 0, 0, 1],
      (u, v) => [u, 1 - v], true);
    const g = makeGeometry(data);
    this.attributes = g.attributes; this.index = g.index; this.version++;
  }
}

export class CircleGeometry extends BufferGeometry {
  constructor(radius = 1, segments = 32, thetaStart = 0, thetaLength = Math.PI * 2) {
    super();
    const positions = [0, 0, 0], normals = [0, 0, 1], uvs = [0.5, 0.5], indices = [];
    for (let i = 0; i <= segments; i++) {
      const theta = thetaStart + (i / segments) * thetaLength;
      positions.push(Math.cos(theta) * radius, Math.sin(theta) * radius, 0);
      normals.push(0, 0, 1);
      uvs.push(Math.cos(theta) * 0.5 + 0.5, Math.sin(theta) * 0.5 + 0.5);
    }
    for (let i = 1; i <= segments; i++) indices.push(0, i, i + 1);
    this.setAttribute('position', new Float32BufferAttribute(positions, 3));
    this.setAttribute('normal', new Float32BufferAttribute(normals, 3));
    this.setAttribute('uv', new Float32BufferAttribute(uvs, 2));
    this.setIndex(new Uint32BufferAttribute(indices, 1));
  }
}

export class RingGeometry extends BufferGeometry {
  constructor(innerRadius = 0.5, outerRadius = 1, thetaSegments = 32, phiSegments = 1, thetaStart = 0, thetaLength = Math.PI * 2) {
    super();
    const positions = [], normals = [], uvs = [], indices = [];
    for (let j = 0; j <= phiSegments; j++) for (let i = 0; i <= thetaSegments; i++) {
      const theta = thetaStart + (i / thetaSegments) * thetaLength;
      const phi = (j / phiSegments) * Math.PI; // radial rings from inner to outer edge-on? use simple radial blend
      const r = innerRadius + (outerRadius - innerRadius) * (j / phiSegments);
      positions.push(Math.cos(theta) * r, Math.sin(theta) * r, 0);
      normals.push(0, 0, 1);
      uvs.push((Math.cos(theta) * r / outerRadius + 1) / 2, (Math.sin(theta) * r / outerRadius + 1) / 2);
    }
    const stride = thetaSegments + 1;
    for (let j = 0; j < phiSegments; j++) for (let i = 0; i < thetaSegments; i++) {
      const a = j * stride + i;
      indices.push(a, a + stride, a + 1, a + 1, a + stride, a + stride + 1);
    }
    this.setAttribute('position', new Float32BufferAttribute(positions, 3));
    this.setAttribute('normal', new Float32BufferAttribute(normals, 3));
    this.setAttribute('uv', new Float32BufferAttribute(uvs, 2));
    this.setIndex(new Uint32BufferAttribute(indices, 1));
  }
}

export class CylinderGeometry extends BufferGeometry {
  constructor(radiusTop = 1, radiusBottom = 1, height = 1, radialSegments = 32, heightSegments = 1, openEnded = false, thetaStart = 0, thetaLength = Math.PI * 2) {
    super();
    const positions = [], normals = [], uvs = [], indices = [];
    const half = height / 2;
    const slope = (radiusBottom - radiusTop) / height;
    for (let j = 0; j <= heightSegments; j++) {
      const v = j / heightSegments;
      const r = radiusBottom + (radiusTop - radiusBottom) * v;
      const y = -half + v * height;
      for (let i = 0; i <= radialSegments; i++) {
        const u = i / radialSegments;
        const theta = thetaStart + u * thetaLength;
        const c = Math.cos(theta), s = Math.sin(theta);
        positions.push(c * r, y, s * r);
        const nl = Math.hypot(1, slope) || 1;
        normals.push(c / nl, slope / nl, s / nl);
        uvs.push(u, 1 - v);
      }
    }
    const stride = radialSegments + 1;
    for (let j = 0; j < heightSegments; j++) for (let i = 0; i < radialSegments; i++) {
      const a = j * stride + i;
      indices.push(a, a + stride, a + 1, a + 1, a + stride, a + stride + 1);
    }
    if (!openEnded) {
      // Caps as triangle fans.
      for (const [y, r, ny] of [[half, radiusTop, 1], [-half, radiusBottom, -1]]) {
        if (r <= 0) continue;
        const center = positions.length / 3;
        positions.push(0, y, 0); normals.push(0, ny, 0); uvs.push(0.5, 0.5);
        const ringStart = positions.length / 3;
        for (let i = 0; i <= radialSegments; i++) {
          const theta = thetaStart + (i / radialSegments) * thetaLength;
          positions.push(Math.cos(theta) * r, y, Math.sin(theta) * r);
          normals.push(0, ny, 0);
          uvs.push(Math.cos(theta) * 0.5 + 0.5, Math.sin(theta) * 0.5 + 0.5);
        }
        for (let i = 0; i < radialSegments; i++) {
          if (ny > 0) indices.push(center, ringStart + i + 1, ringStart + i);
          else indices.push(center, ringStart + i, ringStart + i + 1);
        }
      }
    }
    this.setAttribute('position', new Float32BufferAttribute(positions, 3));
    this.setAttribute('normal', new Float32BufferAttribute(normals, 3));
    this.setAttribute('uv', new Float32BufferAttribute(uvs, 2));
    this.setIndex(new Uint32BufferAttribute(indices, 1));
  }
}

export class TorusGeometry extends BufferGeometry {
  constructor(radius = 1, tube = 0.4, radialSegments = 12, tubularSegments = 48, arc = Math.PI * 2) {
    super();
    const positions = [], normals = [], uvs = [], indices = [];
    for (let j = 0; j <= tubularSegments; j++) {
      const u = j / tubularSegments;
      const phi = u * arc;
      for (let i = 0; i <= radialSegments; i++) {
        const v = i / radialSegments;
        const theta = v * Math.PI * 2;
        const cx = Math.cos(phi), sx = Math.sin(phi);
        const ct = Math.cos(theta), st = Math.sin(theta);
        const nx = ct * cx, ny = st, nz = ct * sx;
        positions.push((radius + tube * ct) * cx, tube * st, (radius + tube * ct) * sx);
        normals.push(nx, ny, nz);
        uvs.push(u, v);
      }
    }
    const stride = radialSegments + 1;
    for (let j = 0; j < tubularSegments; j++) for (let i = 0; i < radialSegments; i++) {
      const a = j * stride + i;
      indices.push(a, a + 1, a + stride, a + 1, a + stride + 1, a + stride);
    }
    this.setAttribute('position', new Float32BufferAttribute(positions, 3));
    this.setAttribute('normal', new Float32BufferAttribute(normals, 3));
    this.setAttribute('uv', new Float32BufferAttribute(uvs, 2));
    this.setIndex(new Uint32BufferAttribute(indices, 1));
  }
}

export class ConeGeometry extends CylinderGeometry {
  constructor(radius = 1, height = 1, radialSegments = 32, heightSegments = 1, openEnded = false, thetaStart = 0, thetaLength = Math.PI * 2) {
    super(radius, 0, height, radialSegments, heightSegments, openEnded, thetaStart, thetaLength);
    this.isConeGeometry = true;
  }
}

export class CapsuleGeometry extends BufferGeometry {
  // Radius, cylindrical mid-section length, and segment counts; axis is Y.
  constructor(radius = 0.5, length = 1, capSegments = 8, radialSegments = 16) {
    super();
    const halfLen = length / 2;
    const positions = [], normals = [], uvs = [], indices = [];
    const rings = capSegments * 2 + 1; // -90..+90 across both caps plus equator rows
    // Build profile: angle from -PI (bottom pole) to +PI (top pole) excluding poles.
    const profile = [];
    for (let i = 1; i <= capSegments * 2; i++) {
      const t = i / (capSegments * 2);           // 0..1
      const phi = -Math.PI / 2 + t * Math.PI;    // -90..90 deg
      profile.push(phi);
    }
    const rows = profile.length;
    for (let j = 0; j <= rows; j++) {
      const phi = j === 0 ? -Math.PI / 2 : j === rows ? Math.PI / 2 : profile[j - 1];
      const cy = Math.sin(phi) * radius + (phi < 0 ? -halfLen : phi > 0 ? halfLen : 0);
      const ringR = Math.cos(phi) * radius;
      for (let i = 0; i <= radialSegments; i++) {
        const theta = (i / radialSegments) * Math.PI * 2;
        const c = Math.cos(theta), s = Math.sin(theta);
        positions.push(c * ringR, cy, s * ringR);
        // Normal points away from the capsule segment axis.
        const ny = Math.sin(phi);
        normals.push(c * Math.cos(phi), ny, s * Math.cos(phi));
        uvs.push(i / radialSegments, j / rows);
      }
    }
    // Pole vertices.
    const bottomCenter = positions.length / 3;
    positions.push(0, -halfLen - radius, 0); normals.push(0, -1, 0); uvs.push(0.5, 0);
    const topCenter = positions.length / 3;
    positions.push(0, halfLen + radius, 0); normals.push(0, 1, 0); uvs.push(0.5, 1);
    const stride = radialSegments + 1;
    for (let j = 0; j < rows; j++) for (let i = 0; i < radialSegments; i++) {
      const a = j * stride + i;
      indices.push(a, a + stride, a + 1, a + 1, a + stride, a + stride + 1);
    }
    for (let i = 0; i < radialSegments; i++) indices.push(bottomCenter, stride + i, stride + i + 1);
    const lastRing = rows * stride;
    for (let i = 0; i < radialSegments; i++) indices.push(topCenter, lastRing + i + 1, lastRing + i);
    this.setAttribute('position', new Float32BufferAttribute(positions, 3));
    this.setAttribute('normal', new Float32BufferAttribute(normals, 3));
    this.setAttribute('uv', new Float32BufferAttribute(uvs, 2));
    this.setIndex(new Uint32BufferAttribute(indices, 1));
  }
}

// Convex polyhedron from vertex/face lists; `detail` subdivides faces and
// projects new vertices onto the circumsphere. Face winding is fixed
// automatically so normals point outward.
export class PolyhedronGeometry extends BufferGeometry {
  constructor(vertices, indices, radius = 1, detail = 0) {
    super();
    let verts = vertices.map(v => {
      const l = Math.hypot(v[0], v[1], v[2]) || 1;
      return [v[0] / l * radius, v[1] / l * radius, v[2] / l * radius];
    });
    let faces = [];
    for (let i = 0; i < indices.length; i += 3) {
      let [a, b, c] = [indices[i], indices[i + 1], indices[i + 2]];
      const ab = [verts[b][0] - verts[a][0], verts[b][1] - verts[a][1], verts[b][2] - verts[a][2]];
      const ac = [verts[c][0] - verts[a][0], verts[c][1] - verts[a][1], verts[c][2] - verts[a][2]];
      const n = [ab[1] * ac[2] - ab[2] * ac[1], ab[2] * ac[0] - ab[0] * ac[2], ab[0] * ac[1] - ab[1] * ac[0]];
      const cx = (verts[a][0] + verts[b][0] + verts[c][0]) / 3;
      const cy = (verts[a][1] + verts[b][1] + verts[c][1]) / 3;
      const cz = (verts[a][2] + verts[b][2] + verts[c][2]) / 3;
      if (n[0] * cx + n[1] * cy + n[2] * cz < 0) [b, c] = [c, b];
      faces.push([a, b, c]);
    }
    const midpointCache = new Map();
    const midpoint = (i, j) => {
      const key = i < j ? `${i},${j}` : `${j},${i}`;
      if (midpointCache.has(key)) return midpointCache.get(key);
      const a = verts[i], b = verts[j];
      const m = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2, (a[2] + b[2]) / 2];
      const l = Math.hypot(...m) || 1;
      const idx = verts.length;
      verts.push([m[0] / l * radius, m[1] / l * radius, m[2] / l * radius]);
      midpointCache.set(key, idx);
      return idx;
    };
    for (let d = 0; d < detail; d++) {
      const next = [];
      midpointCache.clear();
      for (const [a, b, c] of faces) {
        const ab = midpoint(a, b), bc = midpoint(b, c), ca = midpoint(c, a);
        next.push([a, ab, ca], [b, bc, ab], [c, ca, bc], [ab, bc, ca]);
      }
      faces = next;
    }
    const positions = [], normals = [], uvs = [], indexList = [];
    for (const [a, b, c] of faces) {
      const base = positions.length / 3;
      for (const vi of [a, b, c]) {
        const v = verts[vi];
        positions.push(v[0], v[1], v[2]);
        const l = Math.hypot(v[0], v[1], v[2]) || 1;
        normals.push(v[0] / l, v[1] / l, v[2] / l);
        // Spherical UVs like three.js.
        uvs.push(Math.atan2(v[2], v[0]) / (Math.PI * 2) + 0.5, Math.acos(Math.max(-1, Math.min(1, v[1] / l))) / Math.PI);
      }
      indexList.push(base, base + 1, base + 2);
    }
    this.setAttribute('position', new Float32BufferAttribute(positions, 3));
    this.setAttribute('normal', new Float32BufferAttribute(normals, 3));
    this.setAttribute('uv', new Float32BufferAttribute(uvs, 2));
    this.setIndex(new Uint32BufferAttribute(indexList, 1));
    this.isPolyhedronGeometry = true;
  }
}

export class TetrahedronGeometry extends PolyhedronGeometry {
  constructor(radius = 1, detail = 0) {
    super([[1, 1, 1], [1, -1, -1], [-1, 1, -1], [-1, -1, 1]], [0, 1, 2, 0, 3, 1, 0, 2, 3, 1, 3, 2], radius, detail);
    this.isTetrahedronGeometry = true;
  }
}
export class OctahedronGeometry extends PolyhedronGeometry {
  constructor(radius = 1, detail = 0) {
    super([[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]],
      [0, 2, 4, 2, 1, 4, 1, 3, 4, 3, 0, 4, 2, 0, 5, 1, 2, 5, 3, 1, 5, 0, 3, 5], radius, detail);
    this.isOctahedronGeometry = true;
  }
}
const PHI = (1 + Math.sqrt(5)) / 2;
const ICO_VERTS = [[0, 1, PHI], [0, 1, -PHI], [0, -1, PHI], [0, -1, -PHI], [1, PHI, 0], [1, -PHI, 0], [-1, PHI, 0], [-1, -PHI, 0], [PHI, 0, 1], [-PHI, 0, 1], [PHI, 0, -1], [-PHI, 0, -1]];
const ICO_FACES = [
  0, 11, 5, 0, 5, 1, 0, 1, 7, 0, 7, 10, 0, 10, 11,
  1, 5, 9, 5, 11, 4, 11, 10, 2, 10, 7, 6, 7, 1, 8,
  3, 9, 4, 3, 4, 2, 3, 2, 6, 3, 6, 8, 3, 8, 9,
  4, 9, 5, 2, 4, 11, 6, 2, 10, 8, 6, 7, 9, 8, 1,
];
export class IcosahedronGeometry extends PolyhedronGeometry {
  constructor(radius = 1, detail = 0) {
    super(ICO_VERTS, ICO_FACES, radius, detail);
    this.isIcosahedronGeometry = true;
  }
}
// The dodecahedron is the dual of the icosahedron: its vertices are the
// icosahedron's face centroids and each icosahedron vertex becomes a pentagon.
function dodecahedronData() {
  const norm = v => { const l = Math.hypot(v[0], v[1], v[2]) || 1; return [v[0] / l, v[1] / l, v[2] / l]; };
  const icoFaces = [];
  for (let i = 0; i < ICO_FACES.length; i += 3) icoFaces.push([ICO_FACES[i], ICO_FACES[i + 1], ICO_FACES[i + 2]]);
  const verts = icoFaces.map(f => norm([
    (ICO_VERTS[f[0]][0] + ICO_VERTS[f[1]][0] + ICO_VERTS[f[2]][0]) / 3,
    (ICO_VERTS[f[0]][1] + ICO_VERTS[f[1]][1] + ICO_VERTS[f[2]][1]) / 3,
    (ICO_VERTS[f[0]][2] + ICO_VERTS[f[1]][2] + ICO_VERTS[f[2]][2]) / 3,
  ]));
  const incident = ICO_VERTS.map(() => []);
  icoFaces.forEach((f, fi) => { for (const vi of f) incident[vi].push(fi); });
  const tris = [];
  incident.forEach((faces, vi) => {
    // Order the incident faces cyclically around the vertex axis.
    const axis = norm(ICO_VERTS[vi]);
    const ref = Math.abs(axis[1]) < 0.9 ? [0, 1, 0] : [1, 0, 0];
    const u = norm([axis[1] * ref[2] - axis[2] * ref[1], axis[2] * ref[0] - axis[0] * ref[2], axis[0] * ref[1] - axis[1] * ref[0]]);
    const w = [axis[1] * u[2] - axis[2] * u[1], axis[2] * u[0] - axis[0] * u[2], axis[0] * u[1] - axis[1] * u[0]];
    const ordered = faces.slice().sort((p, q) => {
      const cp = [
        (verts[p][1] * axis[2] - verts[p][2] * axis[1]),
        (verts[p][2] * axis[0] - verts[p][0] * axis[2]),
        (verts[p][0] * axis[1] - verts[p][1] * axis[0]),
      ];
      const angle = v3 => Math.atan2(v3[0] * w[0] + v3[1] * w[1] + v3[2] * w[2], v3[0] * u[0] + v3[1] * u[1] + v3[2] * u[2]);
      return angle(cp) - angle([
        (verts[q][1] * axis[2] - verts[q][2] * axis[1]),
        (verts[q][2] * axis[0] - verts[q][0] * axis[2]),
        (verts[q][0] * axis[1] - verts[q][1] * axis[0]),
      ]);
    });
    for (let i = 1; i < ordered.length - 1; i++) tris.push(ordered[0], ordered[i], ordered[i + 1]);
  });
  return { verts, tris };
}
export class DodecahedronGeometry extends PolyhedronGeometry {
  constructor(radius = 1, detail = 0) {
    const { verts, tris } = dodecahedronData();
    super(verts, tris, radius, detail);
    this.isDodecahedronGeometry = true;
  }
}

export class TorusKnotGeometry extends BufferGeometry {
  // p/q are the winding numbers (default trefoil 2,3).
  constructor(radius = 1, tube = 0.4, tubularSegments = 64, radialSegments = 8, p = 2, q = 3) {
    super();
    const positions = [], normals = [], uvs = [], indices = [];
    // Curve C(u) = ((2+cos(q u)) cos(p u), (2+cos(q u)) sin(p u), sin(q u))
    const curve = u => {
      const a = p * u * Math.PI * 2, b = q * u * Math.PI * 2;
      const r = 2 + Math.cos(b);
      return [r * Math.cos(a) * radius, r * Math.sin(a) * radius, Math.sin(b) * radius];
    };
    const eps = 1e-4;
    const frames = [];
    for (let j = 0; j <= tubularSegments; j++) {
      const u = j / tubularSegments;
      const P = curve(u);
      const P2 = curve(Math.min(1, u + eps));
      const T = normalize3([P2[0] - P[0], P2[1] - P[1], P2[2] - P[2]]);
      // Normal = component of radial dir perpendicular to tangent.
      const up = Math.abs(T[1]) < 0.9 ? [0, 1, 0] : [1, 0, 0];
      const N = normalize3([
        T[1] * up[2] - T[2] * up[1], T[2] * up[0] - T[0] * up[2], T[0] * up[1] - T[1] * up[0]]);
      const B = [
        T[1] * N[2] - T[2] * N[1], T[2] * N[0] - T[0] * N[2], T[0] * N[1] - T[1] * N[0]];
      frames.push([P, T, N, B]);
    }
    for (let j = 0; j <= tubularSegments; j++) {
      const u = j / tubularSegments;
      const [P, T, N, B] = frames[j];
      for (let i = 0; i <= radialSegments; i++) {
        const v = i / radialSegments;
        const theta = v * Math.PI * 2;
        const ct = Math.cos(theta), st = Math.sin(theta);
        const nx = N[0] * ct + B[0] * st, ny = N[1] * ct + B[1] * st, nz = N[2] * ct + B[2] * st;
        positions.push(P[0] + tube * nx, P[1] + tube * ny, P[2] + tube * nz);
        normals.push(nx, ny, nz);
        uvs.push(u, v);
      }
    }
    const stride = radialSegments + 1;
    for (let j = 0; j < tubularSegments; j++) for (let i = 0; i < radialSegments; i++) {
      const a = j * stride + i;
      indices.push(a, a + stride, a + 1, a + 1, a + stride, a + stride + 1);
    }
    this.setAttribute('position', new Float32BufferAttribute(positions, 3));
    this.setAttribute('normal', new Float32BufferAttribute(normals, 3));
    this.setAttribute('uv', new Float32BufferAttribute(uvs, 2));
    this.setIndex(new Uint32BufferAttribute(indices, 1));
    this.isTorusKnotGeometry = true;
  }
}

export class TubeGeometry extends BufferGeometry {
  // path: object with getPoint(t) -> {x,y,z} or [x,y,z] (Curve, CatmullRomCurve3, ...)
  constructor(path, tubularSegments = 64, radius = 1, radialSegments = 8, closed = false) {
    super();
    const getPoint = t => {
      const p = path.getPoint ? path.getPoint(t) : path.getPointAt ? path.getPointAt(t) : null;
      if (!p) throw new Error('gs3d: TubeGeometry path needs getPoint(t)');
      return Array.isArray(p) ? p : [p.x, p.y, p.z];
    };
    const positions = [], normals = [], uvs = [], indices = [];
    const frames = [];
    const eps = 1e-4;
    const segs = closed ? tubularSegments : tubularSegments;
    for (let j = 0; j <= segs; j++) {
      const u = j / segs;
      const t = closed ? u % 1 : Math.min(1, u);
      const P = getPoint(t);
      const P2 = getPoint(Math.min(1, t + eps));
      const T = normalize3([P2[0] - P[0], P2[1] - P[1], P2[2] - P[2]]);
      const up = Math.abs(T[1]) < 0.9 ? [0, 1, 0] : [1, 0, 0];
      const N = normalize3([
        T[1] * up[2] - T[2] * up[1], T[2] * up[0] - T[0] * up[2], T[0] * up[1] - T[1] * up[0]]);
      const B = [
        T[1] * N[2] - T[2] * N[1], T[2] * N[0] - T[0] * N[2], T[0] * N[1] - T[1] * N[0]];
      frames.push([P, N, B]);
    }
    for (let j = 0; j <= segs; j++) {
      const u = j / segs;
      const [P, N, B] = frames[j];
      for (let i = 0; i <= radialSegments; i++) {
        const v = i / radialSegments;
        const theta = v * Math.PI * 2;
        const ct = Math.cos(theta), st = Math.sin(theta);
        const nx = N[0] * ct + B[0] * st, ny = N[1] * ct + B[1] * st, nz = N[2] * ct + B[2] * st;
        positions.push(P[0] + radius * nx, P[1] + radius * ny, P[2] + radius * nz);
        normals.push(nx, ny, nz);
        uvs.push(u, v);
      }
    }
    const stride = radialSegments + 1;
    const rings = closed ? segs : segs + 1;
    for (let j = 0; j < rings - 1; j++) for (let i = 0; i < radialSegments; i++) {
      const a = j * stride + i;
      indices.push(a, a + stride, a + 1, a + 1, a + stride, a + stride + 1);
    }
    if (closed) {
      // Wrap last ring to first.
      const last = (rings - 1) * stride, first = 0;
      for (let i = 0; i < radialSegments; i++) {
        indices.push(last + i, first + i, last + i + 1);
        indices.push(last + i + 1, first + i, first + i + 1);
      }
    }
    this.setAttribute('position', new Float32BufferAttribute(positions, 3));
    this.setAttribute('normal', new Float32BufferAttribute(normals, 3));
    this.setAttribute('uv', new Float32BufferAttribute(uvs, 2));
    this.setIndex(new Uint32BufferAttribute(indices, 1));
    this.isTubeGeometry = true;
  }
}

/* --- curves -------------------------------------------------------------------- */

export class Curve {
  getPoint(t) { return this.getPointAt ? this.getPointAt(t) : [0, 0, 0]; }
  getPointAt(t) { return this.getPoint(t); }
}

export class CatmullRomCurve3 extends Curve {
  constructor(points = [], closed = false, curveType = 'centripetal', tension = 0.5) {
    super();
    this.points = points.map(p => Array.isArray(p) ? p : [p.x, p.y, p.z]);
    this.closed = closed;
    this.curveType = curveType;
    this.tension = tension;
    this.isCatmullRomCurve3 = true;
  }
  getPoint(t) {
    const pts = this.points, n = pts.length;
    if (n === 0) return [0, 0, 0];
    if (n === 1) return pts[0];
    const scaled = this.closed ? t * n : t * (n - 1);
    let i = Math.floor(scaled);
    const u = scaled - i;
    const at = k => this.closed ? pts[((k % n) + n) % n] : pts[Math.max(0, Math.min(n - 1, k))];
    const p0 = at(i - 1), p1 = at(i), p2 = at(i + 1), p3 = at(i + 2);
    const cr = (a, b, c, d, t) => {
      const t2 = t * t, t3 = t2 * t;
      return 0.5 * ((2 * b) + (-a + c) * t + (2 * a - 5 * b + 4 * c - d) * t2 + (-a + 3 * b - 3 * c + d) * t3);
    };
    return [cr(p0[0], p1[0], p2[0], p3[0], u),
      cr(p0[1], p1[1], p2[1], p3[1], u),
      cr(p0[2], p1[2], p2[2], p3[2], u)];
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

export class LatheGeometry extends BufferGeometry {
  // points: array of Vector2-like {x: radius, y: height}; spun around Y.
  constructor(points = [], segments = 32, phiStart = 0, phiLength = Math.PI * 2) {
    super();
    const positions = [], normals = [], uvs = [], indices = [];
    const n = points.length;
    for (let j = 0; j <= segments; j++) {
      const u = j / segments;
      const phi = phiStart + u * phiLength;
      const c = Math.cos(phi), s = Math.sin(phi);
      for (let i = 0; i < n; i++) {
        const pt = points[i];
        positions.push(pt.x * c, pt.y, pt.x * s);
        uvs.push(u, i / (n - 1 || 1));
      }
    }
    const ringNormals = [];
    for (let i = 0; i < n; i++) {
      const pPrev = points[Math.max(0, i - 1)], pNext = points[Math.min(n - 1, i + 1)];
      const dx = pNext.x - pPrev.x, dy = pNext.y - pPrev.y;
      const nl = Math.hypot(dx, dy) || 1;
      ringNormals.push([-dy / nl, dx / nl]);
    }
    for (let j = 0; j <= segments; j++) {
      const phi = phiStart + (j / segments) * phiLength;
      const c = Math.cos(phi), s = Math.sin(phi);
      for (let i = 0; i < n; i++) {
        normals.push(ringNormals[i][0] * c, ringNormals[i][1], ringNormals[i][0] * s);
      }
    }
    const stride = n;
    for (let j = 0; j < segments; j++) for (let i = 0; i < n - 1; i++) {
      const a = j * stride + i;
      indices.push(a, a + stride, a + 1, a + 1, a + stride, a + stride + 1);
    }
    this.setAttribute('position', new Float32BufferAttribute(positions, 3));
    this.setAttribute('normal', new Float32BufferAttribute(normals, 3));
    this.setAttribute('uv', new Float32BufferAttribute(uvs, 2));
    this.setIndex(new Uint32BufferAttribute(indices, 1));
    this.isLatheGeometry = true;
  }
}

/* --- shapes ------------------------------------------------------------------ */

// 2D path: moveTo/lineTo/quadraticCurveTo/bezierCurveTo/closePath, flattened
// to point lists by getPoints(). Shape adds holes like three.js.
export class Path {
  constructor() { this.isPath = true; this.segments = []; }
  moveTo(x, y) { this.segments.push({ t: 'M', x, y }); return this; }
  lineTo(x, y) { this.segments.push({ t: 'L', x, y }); return this; }
  quadraticCurveTo(cx, cy, x, y) { this.segments.push({ t: 'Q', cx, cy, x, y }); return this; }
  bezierCurveTo(c1x, c1y, c2x, c2y, x, y) { this.segments.push({ t: 'C', c1x, c1y, c2x, c2y, x, y }); return this; }
  closePath() { this.segments.push({ t: 'Z' }); return this; }
  getPoints(divisions = 12) {
    const pts = [];
    let cur = null, start = null;
    const cubic = (p0, p1, p2, p3, t) => {
      const u = 1 - t;
      return u * u * u * p0 + 3 * u * u * t * p1 + 3 * u * t * t * p2 + t * t * t * p3;
    };
    for (const s of this.segments) {
      if (s.t === 'M') { cur = { x: s.x, y: s.y }; start = { ...cur }; pts.push([cur.x, cur.y]); }
      else if (s.t === 'L') { cur = { x: s.x, y: s.y }; pts.push([cur.x, cur.y]); }
      else if (s.t === 'Q') {
        for (let i = 1; i <= divisions; i++) {
          const t = i / divisions, u = 1 - t;
          pts.push([u * u * cur.x + 2 * u * t * s.cx + t * t * s.x,
            u * u * cur.y + 2 * u * t * s.cy + t * t * s.y]);
        }
        cur = { x: s.x, y: s.y };
      } else if (s.t === 'C') {
        for (let i = 1; i <= divisions; i++) {
          const t = i / divisions;
          pts.push([cubic(cur.x, s.c1x, s.c2x, s.x, t), cubic(cur.y, s.c1y, s.c2y, s.y, t)]);
        }
        cur = { x: s.x, y: s.y };
      } else if (s.t === 'Z' && cur && start) { pts.push([start.x, start.y]); cur = { ...start }; }
    }
    // Drop consecutive duplicates and a duplicated closing point.
    const out = [];
    for (const p of pts) {
      const last = out[out.length - 1];
      if (!last || Math.abs(last[0] - p[0]) > 1e-9 || Math.abs(last[1] - p[1]) > 1e-9) out.push(p);
    }
    if (out.length > 1) {
      const f = out[0], l = out[out.length - 1];
      if (Math.abs(f[0] - l[0]) < 1e-9 && Math.abs(f[1] - l[1]) < 1e-9) out.pop();
    }
    return out;
  }
}

export class Shape extends Path {
  constructor() { super(); this.isShape = true; this.holes = []; }
}

const orient2 = (a, b, c) => (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
const inTri2 = (p, a, b, c) => {
  const d1 = orient2(a, b, p), d2 = orient2(b, c, p), d3 = orient2(c, a, p);
  const neg = d1 < 0 || d2 < 0 || d3 < 0, pos = d1 > 0 || d2 > 0 || d3 > 0;
  return !(neg && pos);
};

// Ear-clipping triangulation of a simple polygon (CCW). Returns index triples.
function triangulatePolygon(verts) {
  const n = verts.length;
  if (n < 3) return [];
  let area = 0;
  for (let i = 0; i < n; i++) {
    const a = verts[i], b = verts[(i + 1) % n];
    area += a[0] * b[1] - b[0] * a[1];
  }
  const idx = [...Array(n).keys()];
  if (area < 0) idx.reverse();
  const tris = [];
  let guard = n * n * 4;
  while (idx.length > 3 && guard-- > 0) {
    let clipped = false;
    for (let i = 0; i < idx.length; i++) {
      const ia = idx[(i - 1 + idx.length) % idx.length], ib = idx[i], ic = idx[(i + 1) % idx.length];
      const a = verts[ia], b = verts[ib], c = verts[ic];
      if (orient2(a, b, c) <= 1e-12) continue;
      let blocked = false;
      for (const j of idx) {
        if (j === ia || j === ib || j === ic) continue;
        if (inTri2(verts[j], a, b, c)) { blocked = true; break; }
      }
      if (blocked) continue;
      tris.push([ia, ib, ic]);
      idx.splice(i, 1);
      clipped = true;
      break;
    }
    if (!clipped) break;
  }
  if (idx.length === 3) tris.push([idx[0], idx[1], idx[2]]);
  return tris;
}

// Merge holes into the outer contour by ray-casting from each hole's
// rightmost vertex to the nearest outer edge, producing one loop with
// duplicated bridge vertices (standard hole-bridging).
function bridgeHoles(outer, holes) {
  let verts = outer.map(p => [p[0], p[1]]);
  for (const holeRaw of holes) {
    let hole = holeRaw.map(p => [p[0], p[1]]);
    // Ensure hole winds opposite the outer loop.
    let hArea = 0;
    for (let i = 0; i < hole.length; i++) {
      const a = hole[i], b = hole[(i + 1) % hole.length];
      hArea += a[0] * b[1] - b[0] * a[1];
    }
    let oArea = 0;
    for (let i = 0; i < verts.length; i++) {
      const a = verts[i], b = verts[(i + 1) % verts.length];
      oArea += a[0] * b[1] - b[0] * a[1];
    }
    if ((hArea < 0) === (oArea < 0)) hole.reverse();
    // Rightmost hole vertex.
    let mh = 0;
    for (let i = 1; i < hole.length; i++) if (hole[i][0] > hole[mh][0]) mh = i;
    const m = hole[mh];
    // Nearest +x edge intersection on the outer polygon.
    let best = null;
    for (let i = 0; i < verts.length; i++) {
      const a = verts[i], b = verts[(i + 1) % verts.length];
      // Ray (m + t*(1,0)), t>0 vs segment a->b.
      const dx = b[0] - a[0], dy = b[1] - a[1];
      if (Math.abs(dy) < 1e-12) continue;
      const t = (m[1] - a[1]) / dy;
      if (t < 0 || t > 1) continue;
      const x = a[0] + dx * t;
      const dist = x - m[0];
      if (dist <= 1e-9) continue;
      if (!best || dist < best.dist) best = { dist, edge: i, t, point: [x, a[1] + dy * t] };
    }
    if (!best) continue; // degenerate hole — skip bridging
    // Insert bridge point after edge start vertex, then hole loop.
    const ei = best.edge;
    const bridge = [best.point[0], best.point[1]];
    const rotated = hole.slice(mh).concat(hole.slice(0, mh));
    const insert = [bridge, m, ...rotated.slice(1), m, bridge];
    verts = verts.slice(0, ei + 1).concat(insert, verts.slice(ei + 1));
  }
  return verts;
}

// Triangulate a shape's outer contour; holes are bridged in when the merged
// loop triangulates cleanly, otherwise the hole is filled (documented
// limitation — bridged polygons can contain degenerate vertices).
function triangulateShape(outer, holes) {
  if (!holes.length) return { verts: outer, tris: triangulatePolygon(outer), holesUsed: false };
  const merged = bridgeHoles(outer, holes);
  const tris = triangulatePolygon(merged);
  if (tris.length === merged.length - 2) return { verts: merged, tris, holesUsed: true };
  return { verts: outer, tris: triangulatePolygon(outer), holesUsed: false };
}

function shapeToGeometry(shape, depth = 0, curveSegments = 12) {
  const outer = shape.getPoints(curveSegments);
  const holes = (shape.holes || []).map(h => h.getPoints(curveSegments)).filter(h => h.length >= 3);
  const { verts, tris } = triangulateShape(outer, holes);
  const geo = new BufferGeometry();
  const positions = [], normals = [], uvs = [];
  for (const [x, y] of verts) { positions.push(x, y, 0); normals.push(0, 0, 1); uvs.push(x, y); }
  const indices = [];
  for (const [a, b, c] of tris) indices.push(a, b, c);
  geo.setAttribute('position', new Float32BufferAttribute(positions, 3));
  geo.setAttribute('normal', new Float32BufferAttribute(normals, 3));
  geo.setAttribute('uv', new Float32BufferAttribute(uvs, 2));
  if (indices.length) geo.setIndex(new Uint32BufferAttribute(indices, 1));
  return geo;
}

export class ShapeGeometry extends BufferGeometry {
  constructor(shape, curveSegments = 12) {
    super();
    const src = shapeToGeometry(shape, 0, curveSegments);
    for (const name of ['position', 'normal', 'uv']) {
      this.setAttribute(name, src.attributes[name]);
    }
    this.setIndex(src.index);
    this.isShapeGeometry = true;
  }
}

export class ExtrudeGeometry extends BufferGeometry {
  // options: { depth, bevelEnabled, bevelThickness, bevelSize, bevelSegments, steps, curveSegments }
  // Bevel parameters are accepted for signature compatibility but ignored.
  constructor(shape, options = {}) {
    super();
    const depth = options.depth ?? 1;
    const curveSegments = options.curveSegments ?? 12;
    const outer = shape.getPoints(curveSegments);
    const holes = (shape.holes || []).map(h => h.getPoints(curveSegments)).filter(h => h.length >= 3);
    const contours = [outer, ...holes];
    const positions = [], normals = [], uvs = [], indices = [];
    // Caps triangulate the (hole-bridged when possible) contour.
    const { verts: capVerts, tris: capTris, holesUsed } = triangulateShape(outer, holes);
    const wallContours = holesUsed ? contours : [outer];
    const emitCap = (z, up) => {
      const offset = positions.length / 3;
      for (const [x, y] of capVerts) {
        positions.push(x, y, z); normals.push(0, 0, up ? 1 : -1); uvs.push(x, y);
      }
      for (const [a, b, c] of capTris) {
        // Bottom cap faces -Z, top faces +Z.
        if (up) indices.push(offset + a, offset + b, offset + c);
        else indices.push(offset + a, offset + c, offset + b);
      }
    };
    emitCap(0, false);
    // Walls: two verts per contour point (z=0, z=depth). (ey,-ex) is the
    // right-hand side of the edge direction — outward for the CCW outer loop,
    // into the void for CW holes — so it is the visible side for both.
    for (const contour of wallContours) {
      const n = contour.length;
      if (n < 2) continue;
      const base = positions.length / 3;
      for (let i = 0; i < n; i++) {
        const [x, y] = contour[i];
        const [px, py] = contour[(i + 1) % n];
        const ex = px - x, ey = py - y;
        const nl = Math.hypot(ex, ey) || 1;
        const nx = ey / nl, ny = -ex / nl;
        positions.push(x, y, 0, x, y, depth);
        normals.push(nx, ny, 0, nx, ny, 0);
        uvs.push(i / n, 0, i / n, 1);
      }
      for (let i = 0; i < n; i++) {
        const a = base + i * 2, b = a + 1, c = base + ((i + 1) % n) * 2, d = c + 1;
        indices.push(a, c, b, c, d, b);
      }
    }
    emitCap(depth, true);
    this.setAttribute('position', new Float32BufferAttribute(positions, 3));
    this.setAttribute('normal', new Float32BufferAttribute(normals, 3));
    this.setAttribute('uv', new Float32BufferAttribute(uvs, 2));
    this.setIndex(new Uint32BufferAttribute(indices, 1));
    this.isExtrudeGeometry = true;
  }
}

/* --- textures ------------------------------------------------------------------ */

export const UnsignedByteType = 1009;
export const RGBFormat = 1022;
export const RGBAFormat = 1023;
export const DepthFormat = 1026;
export const DepthStencilFormat = 1027;
export const RedFormat = 1028;
export const RGFormat = 1030;
export const RGBIntegerFormat = 1033;
export const RGBAIntegerFormat = 1036;
export const FloatType = 1015;
export const HalfFloatType = 1016;

export const NoBlending = 0;
export const NormalBlending = 1;
export const AdditiveBlending = 2;
export const SubtractiveBlending = 3;
export const MultiplyBlending = 4;
export const CustomBlending = 5;

export const RepeatWrapping = 1000;
export const ClampToEdgeWrapping = 1001;
export const MirroredRepeatWrapping = 1002;

export const NearestFilter = 1003;
export const LinearFilter = 1006;
export const NearestMipmapNearestFilter = 1004;
export const NearestMipmapLinearFilter = 1005;
export const LinearMipmapNearestFilter = 1007;
export const LinearMipmapLinearFilter = 1008;

const WRAP_TO_ENGINE = { [ClampToEdgeWrapping]: 0, [RepeatWrapping]: 1, [MirroredRepeatWrapping]: 2 };
const FILTER_TO_GL = { [NearestFilter]: 9728, [LinearFilter]: 9729 };

// Normalizes the accepted image sources to {width, height, pixels} where
// pixels is RGBA8. Returns null while the image is not ready.
function textureImageData(image) {
  if (!image) return null;
  if (image.pixels && image.width && image.height) return image;
  if (image.data && image.width && image.height) {
    return { width: image.width, height: image.height, pixels: image.data };
  }
  if (typeof document !== 'undefined' &&
      (image instanceof HTMLCanvasElement || image instanceof HTMLImageElement ||
       (typeof ImageBitmap !== 'undefined' && image instanceof ImageBitmap))) {
    const canvas = document.createElement('canvas');
    canvas.width = image.width || image.videoWidth || image.naturalWidth;
    canvas.height = image.height || image.videoHeight || image.naturalHeight;
    const ctx = canvas.getContext('2d');
    if (!ctx) return null;
    ctx.drawImage(image, 0, 0);
    return { width: canvas.width, height: canvas.height, pixels: ctx.getImageData(0, 0, canvas.width, canvas.height).data };
  }
  if (image instanceof ImageData) {
    return { width: image.width, height: image.height, pixels: image.data };
  }
  return null;
}

export class Texture {
  constructor(image = null) {
    this.isTexture = true;
    this.image = image;
    this.colorSpace = NoColorSpace;
    this.wrapS = RepeatWrapping;
    this.wrapT = RepeatWrapping;
    this.magFilter = LinearFilter;
    this.minFilter = LinearMipmapLinearFilter;
    this.offset = new Vector2();
    this.repeat = new Vector2(1, 1);
    this.rotation = 0;
    this.center = new Vector2(0.5, 0.5);
    this.channel = 0;
    this.type = UnsignedByteType;
    this.matrixAutoUpdate = true;
    this.generateMipmaps = true;
    this.version = 0;
    this.needsUpdate = false;
  }
  updateMatrix() { return this; }
  dispose() {
    this.version++;
    releaseTexture(this);
  }
}

export class DataTexture extends Texture {
  constructor(data = null, width = 1, height = 1) {
    super(data ? { data, width, height } : null);
    this.isDataTexture = true;
    this.flipY = false;
    this.unpackAlignment = 4;
  }
}

// RGBA8 3D texture for custom material shaders (material.lutTexture, sampled
// as u_lut). Only Uint8Array/Uint8ClampedArray data uploads; the engine
// fixes linear filtering and clamp-to-edge wrapping.
export class Data3DTexture extends Texture {
  constructor(data = null, width = 1, height = 1, depth = 1) {
    super(data ? { data, width, height, depth } : null);
    this.isData3DTexture = true;
    this.flipY = false;
    this.unpackAlignment = 4;
  }
}

export class CanvasTexture extends Texture {
  constructor(canvas = document.createElement('canvas')) {
    super(canvas);
    this.isCanvasTexture = true;
  }
}

export class CompressedTexture extends Texture {
  constructor() { super(null); this.isCompressedTexture = true; }
}
export class CubeTexture extends Texture {
  constructor() { super(null); this.isCubeTexture = true; this.images = []; }
}

export class TextureLoader {
  constructor() { this.manager = null; }
  load(url, onLoad, onProgress, onError) {
    fetch(url)
      .then(response => {
        if (!response.ok) throw new Error(`gs3d: failed to fetch texture ${url} (${response.status})`);
        return response.blob();
      })
      .then(blob => createImageBitmap(blob))
      .then(bitmap => {
        const image = textureImageData(bitmap);
        bitmap.close();
        const texture = new Texture(image);
        texture.needsUpdate = true;
        texture.version++;
        if (onLoad) onLoad(texture);
        return texture;
      })
      .catch(error => onError ? onError(error) : console.error(error));
    return this;
  }
}

export class ImageLoader {
  constructor() { this.manager = null; }
  load(url, onLoad, onProgress, onError) {
    const image = new Image();
    image.onload = () => onLoad && onLoad(image);
    image.onerror = event => onError && onError(event);
    if (onProgress) image.onprogress = onProgress;
    image.src = url;
    return image;
  }
}

/* --- materials --------------------------------------------------------------- */

export const FrontSide = 0;
export const BackSide = 1;
export const DoubleSide = 2;

export class Material {
  constructor(parameters = {}) {
    this.isMaterial = true;
    this.name = '';
    this.color = new Color(0xffffff);
    this.opacity = 1;
    this.transparent = false;
    this.alphaTest = 0;
    this.side = FrontSide;
    this.visible = true;
    this.map = null;
    this.vertexColors = false;
    this.flatShading = false;
    this.normalMap = null;
    this.normalScale = new Vector2(1, 1);
    this.roughnessMap = null;
    this.metalnessMap = null;
    this.emissiveMap = null;
    this.aoMap = null;
    this.aoMapIntensity = 1;
    this.envMapIntensity = 1;
    Object.assign(this, parameters);
    if (parameters.color !== undefined && !(parameters.color instanceof Color)) this.color = new Color(parameters.color);
  }
  dispose() {
    this.version = (this.version || 0) + 1;
    releaseMaterial(this);
  }
}

export class MeshBasicMaterial extends Material {
  constructor(parameters = {}) {
    super(parameters);
    this.isMeshBasicMaterial = true;
    if (parameters.color !== undefined) this.color = parameters.color instanceof Color ? parameters.color : new Color(parameters.color);
  }
}

export class MeshStandardMaterial extends Material {
  constructor(parameters = {}) {
    super(parameters);
    this.isMeshStandardMaterial = true;
    this.metalness = parameters.metalness ?? 0;
    this.roughness = parameters.roughness ?? 1;
    this.emissive = parameters.emissive !== undefined ? (parameters.emissive instanceof Color ? parameters.emissive : new Color(parameters.emissive)) : new Color(0x000000);
    this.emissiveIntensity = parameters.emissiveIntensity ?? 1;
    this.ior = parameters.ior ?? 1.5;
    if (parameters.color !== undefined) this.color = parameters.color instanceof Color ? parameters.color : new Color(parameters.color);
  }
}
export { MeshStandardMaterial as MeshPhysicalMaterial };
export { MeshStandardMaterial as MeshPhongMaterial };
export { MeshStandardMaterial as MeshLambertMaterial };
export { MeshBasicMaterial as MeshNormalMaterial };
export { MeshBasicMaterial as SpriteMaterial };
export { MeshBasicMaterial as PointsMaterial };
export { MeshBasicMaterial as LineBasicMaterial };

// Complete user vertex+fragment programs (GLSL ES 1.00, three.js style).
// The engine supplies the standard matrix/camera uniforms and the vertex
// attributes position, normal, uv, color and tangent; packed UV sets beyond
// `uv`, custom vertex attributes, projective texturing and custom blending
// modes are not reachable. `#include <tonemapping_fragment>` and
// `#include <colorspace_fragment>` resolve to the engine's output chain.
export class ShaderMaterial extends Material {
  constructor(parameters = {}) {
    super(parameters);
    this.isShaderMaterial = true;
    this.uniforms = parameters.uniforms || {};
    this.vertexShader = parameters.vertexShader || '';
    this.fragmentShader = parameters.fragmentShader || '';
    this.depthWrite = parameters.depthWrite !== false;
    this.depthTest = parameters.depthTest !== false;
    this.blending = parameters.blending ?? NormalBlending;
    this.side = parameters.side ?? FrontSide;
    this.transparent = parameters.transparent === true;
  }
}

/* --- lights ------------------------------------------------------------------- */

export class Light extends Object3D {
  constructor(color = 0xffffff, intensity = 1) {
    super();
    this.isLight = true;
    this.color = color instanceof Color ? color : new Color(color);
    this.intensity = intensity;
  }
}

export class AmbientLight extends Light {
  constructor(color = 0xffffff, intensity = 1) { super(color, intensity); this.isAmbientLight = true; }
}

export class HemisphereLight extends Light {
  constructor(skyColor = 0xffffff, groundColor = 0x444444, intensity = 1) {
    super(skyColor, intensity);
    this.isHemisphereLight = true;
    this.groundColor = groundColor instanceof Color ? groundColor : new Color(groundColor);
  }
}

// The engine has one directional shadow map, so a light's shadow settings
// collapse into a world-space box: mapSize picks the map resolution (256,
// 512 or 1024 — larger requests clamp), the camera's ortho bounds pick the
// coverage, and bias/normalBias fold into a single depth bias. autoUpdate
// and needsUpdate are accepted for API compatibility; the map re-renders
// every frame while shadows are enabled.
export class DirectionalLightShadow {
  constructor() {
    this.mapSize = new Vector2(512, 512);
    this.bias = 0;
    this.normalBias = 0;
    this.radius = 1;
    this.camera = {
      left: -5, right: 5, top: 5, bottom: -5, near: 0.5, far: 500,
      updateProjectionMatrix() {},
    };
    this.map = null;
    this.mapPass = null;
    this.autoUpdate = true;
    this.needsUpdate = true;
  }
  dispose() {}
}

export class DirectionalLight extends Light {
  constructor(color = 0xffffff, intensity = 1) {
    super(color, intensity);
    this.isDirectionalLight = true;
    this.target = new Object3D();
    this.shadow = new DirectionalLightShadow();
  }
}

export class PointLight extends Light {
  constructor(color = 0xffffff, intensity = 1, distance = 0, decay = 2) {
    super(color, intensity);
    this.isPointLight = true;
    this.distance = distance;
    this.decay = decay;
  }
}

export class SpotLight extends Light {
  constructor(color = 0xffffff, intensity = 1, distance = 0, angle = Math.PI / 3, penumbra = 0, decay = 2) {
    super(color, intensity);
    this.isSpotLight = true;
    this.distance = distance;
    this.angle = angle;
    this.penumbra = penumbra;
    this.decay = decay;
    this.target = new Object3D();
  }
}

export class RectAreaLight extends Light {
  constructor(color = 0xffffff, intensity = 1) { super(color, intensity); this.isRectAreaLight = true; }
}

/* --- cameras -------------------------------------------------------------------- */

export class PerspectiveCamera extends Object3D {
  constructor(fov = 50, aspect = 1, near = 0.1, far = 2000) {
    super();
    this.isCamera = true; this.isPerspectiveCamera = true;
    this.fov = fov; this.aspect = aspect; this.near = near; this.far = far;
  }
  updateProjectionMatrix() { return this; }
}

// camera.setViewOffset / clearViewOffset (three.js): render only a
// sub-rectangle of a larger virtual image through an off-axis frustum.
// Shared by perspective and orthographic cameras.
const cameraViewOffset = {
  setViewOffset(fullWidth, fullHeight, x, y, width, height) {
    this.view = { enabled: true, fullWidth, fullHeight, offsetX: x, offsetY: y, width, height };
    return this;
  },
  clearViewOffset() { this.view = null; return this; },
};
Object.assign(PerspectiveCamera.prototype, cameraViewOffset);

export class OrthographicCamera extends Object3D {
  constructor(left = -1, right = 1, top = 1, bottom = -1, near = 0.1, far = 2000) {
    super();
    this.isCamera = true; this.isOrthographicCamera = true;
    this.left = left; this.right = right; this.top = top; this.bottom = bottom;
    this.near = near; this.far = far;
  }
  updateProjectionMatrix() { return this; }
}
Object.assign(OrthographicCamera.prototype, cameraViewOffset);

export class Camera extends Object3D {
  constructor() { super(); this.isCamera = true; }
}

export class Mesh extends Object3D {
  constructor(geometry = new BufferGeometry(), material = new MeshBasicMaterial()) {
    super();
    this.isMesh = true;
    this.geometry = geometry;
    this.material = material;
  }
  clone() {
    const copy = new Mesh(this.geometry, this.material);
    copy.position.copy(this.position);
    copy.quaternion.copy(this.quaternion);
    copy.scale.copy(this.scale);
    copy.name = this.name;
    copy.visible = this.visible;
    copy.castShadow = this.castShadow;
    copy.receiveShadow = this.receiveShadow;
    return copy;
  }
}

export class Line extends Object3D {
  constructor(geometry, material) { super(); this.isLine = true; this.geometry = geometry; this.material = material; }
}
export class Points extends Object3D {
  constructor(geometry, material) { super(); this.isPoints = true; this.geometry = geometry; this.material = material; }
}
export class Sprite extends Object3D {
  constructor(material) { super(); this.isSprite = true; this.material = material; }
}

/* --- raycasting and bounds ------------------------------------------------------ */

export class Ray {
  constructor(origin = new Vector3(), direction = new Vector3(0, 0, -1)) {
    this.origin = origin;
    this.direction = direction;
  }
  set(origin, direction) { this.origin.copy(origin); this.direction.copy(direction).normalize(); return this; }
  at(t, target = new Vector3()) {
    return target.set(this.origin.x + this.direction.x * t,
      this.origin.y + this.direction.y * t, this.origin.z + this.direction.z * t);
  }
}

// Möller–Trumbore ray/triangle test in the mesh's local space.
function rayTriangle(ox, oy, oz, dx, dy, dz, ax, ay, az, bx, by, bz, cx, cy, cz) {
  const e1x = bx - ax, e1y = by - ay, e1z = bz - az;
  const e2x = cx - ax, e2y = cy - ay, e2z = cz - az;
  const px = dy * e2z - dz * e2y, py = dz * e2x - dx * e2z, pz = dx * e2y - dy * e2x;
  const det = e1x * px + e1y * py + e1z * pz;
  if (Math.abs(det) < 1e-12) return null;
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

export class Raycaster {
  constructor(origin = new Vector3(), direction = new Vector3(0, 0, -1), near = 0, far = Infinity) {
    this.ray = new Ray(origin, direction);
    this.near = near;
    this.far = far;
    this.camera = null;
    this.layers = { mask: 1 };
  }
  set(origin, direction) { this.ray.set(origin, direction); return this; }
  setFromCamera(coords, camera) {
    // coords are normalized device coordinates (-1..1); camera is a facade camera.
    const world = worldMatrixOf(camera);
    const pos = transformPoint(world, 0, 0, 0);
    const tanFov = Math.max(1e-4, Math.tan(((camera.fov ?? 50) * Math.PI / 180) / 2));
    const aspect = camera.aspect > 0 ? camera.aspect : 1;
    // Camera-space ray through the NDC point, then rotate into world space.
    const lx = coords.x * tanFov * aspect, ly = coords.y * tanFov;
    const local = normalize3([lx, ly, -1]);
    const dir = normalize3(transformDir(world, local[0], local[1], local[2]));
    this.ray.origin.set(pos[0], pos[1], pos[2]);
    this.ray.direction.set(dir[0], dir[1], dir[2]);
    return this;
  }
  intersectObject(object, recursive = true) {
    const hits = [];
    const walk = node => {
      if (node.isMesh && node.geometry && node.geometry.attributes && node.geometry.attributes.position) {
        const hit = this._intersectMesh(node);
        if (hit) hits.push(hit);
      }
      if (recursive) for (const child of node.children) walk(child);
    };
    walk(object);
    hits.sort((a, b) => a.distance - b.distance);
    return hits;
  }
  intersectObjects(objects, recursive = true) {
    const hits = [];
    for (const object of objects) hits.push(...this.intersectObject(object, recursive));
    hits.sort((a, b) => a.distance - b.distance);
    return hits;
  }
  _intersectMesh(mesh) {
    const geometry = mesh.geometry;
    const pos = geometry.attributes.position;
    if (!pos) return null;
    const p = pos.array, is = pos.itemSize;
    const index = geometry.index && geometry.index.array;
    const world = worldMatrixOf(mesh);
    const inv = invertMat4(world);
    if (!inv) return null;
    // Ray into mesh-local space.
    const lo = transformPoint(inv, this.ray.origin.x, this.ray.origin.y, this.ray.origin.z);
    const ld = normalize3(transformDir(inv, this.ray.direction.x, this.ray.direction.y, this.ray.direction.z));
    const count = pos.count;
    const triCount = index ? index.length / 3 : count / 3;
    let best = null;
    for (let t = 0; t < triCount; t++) {
      const ia = index ? index[t * 3] : t * 3, ib = index ? index[t * 3 + 1] : t * 3 + 1, ic = index ? index[t * 3 + 2] : t * 3 + 2;
      const a = ia * is, b = ib * is, c = ic * is;
      const hit = rayTriangle(lo[0], lo[1], lo[2], ld[0], ld[1], ld[2],
        p[a], p[a + 1], p[a + 2], p[b], p[b + 1], p[b + 2], p[c], p[c + 1], p[c + 2]);
      if (!hit || hit.t < this.near || hit.t > this.far) continue;
      if (!best || hit.t < best.t) best = { t: hit.t, u: hit.u, v: hit.v, a: ia, b: ib, c: ic };
    }
    if (!best) return null;
    // Distance in world units: local t scaled by the world scale along the ray.
    // Approximate with the average world scale of the mesh.
    const ws = Math.cbrt(Math.abs(world[0] * world[5] * world[10]) || 1);
    const distance = best.t * ws;
    const point = this.ray.at(distance);
    const pa = best.a * is, pb = best.b * is, pc = best.c * is;
    const e1 = [p[pb] - p[pa], p[pb + 1] - p[pa + 1], p[pb + 2] - p[pa + 2]];
    const e2 = [p[pc] - p[pa], p[pc + 1] - p[pa + 1], p[pc + 2] - p[pa + 2]];
    const n = normalize3([e1[1] * e2[2] - e1[2] * e2[1], e1[2] * e2[0] - e1[0] * e2[2], e1[0] * e2[1] - e1[1] * e2[0]]);
    const wn = normalize3(transformDir(world, n[0], n[1], n[2]));
    return {
      distance, point,
      face: { a: best.a, b: best.b, c: best.c, normal: new Vector3(wn[0], wn[1], wn[2]) },
      object: mesh,
      uv: null,
    };
  }
}

export class Box3 {
  constructor(min = new Vector3(Infinity, Infinity, Infinity), max = new Vector3(-Infinity, -Infinity, -Infinity)) {
    this.min = min; this.max = max; this.isBox3 = true;
  }
  set(min, max) { this.min.copy(min); this.max.copy(max); return this; }
  makeEmpty() { this.min.set(Infinity, Infinity, Infinity); this.max.set(-Infinity, -Infinity, -Infinity); return this; }
  isEmpty() { return this.max.x < this.min.x || this.max.y < this.min.y || this.max.z < this.min.z; }
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
    object.traverse(node => {
      if (!node.isMesh || !node.geometry || !node.geometry.attributes || !node.geometry.attributes.position) return;
      const geometry = node.geometry;
      let bb = geometry._bbox;
      if (!bb) {
        bb = geometry._bbox = [Infinity, Infinity, Infinity, -Infinity, -Infinity, -Infinity];
        const p = geometry.attributes.position.array, is = geometry.attributes.position.itemSize;
        for (let i = 0; i < p.length; i += is) {
          for (let k = 0; k < 3; k++) {
            const v = p[i + k];
            if (v < bb[k]) bb[k] = v;
            if (v > bb[3 + k]) bb[3 + k] = v;
          }
        }
      }
      const world = worldMatrixOf(node);
      for (let cx = 0; cx <= 1; cx++) for (let cy = 0; cy <= 1; cy++) for (let cz = 0; cz <= 1; cz++) {
        const w = transformPoint(world, cx ? bb[3] : bb[0], cy ? bb[4] : bb[1], cz ? bb[5] : bb[2]);
        this.expandByPoint(new Vector3(w[0], w[1], w[2]));
      }
    });
    return this;
  }
}

/* --- fog ------------------------------------------------------------------------- */

export class Fog {
  constructor(color = 0xffffff, near = 1, far = 1000) {
    this.isFog = true;
    this.color = color instanceof Color ? color : new Color(color);
    this.near = near; this.far = far;
  }
}
export class FogExp2 {
  constructor(color = 0xffffff, density = 0.00025) {
    this.isFogExp2 = true;
    this.color = color instanceof Color ? color : new Color(color);
    this.density = density;
  }
}

/* --- orbit controls ---------------------------------------------------------------
   A three.js-style OrbitControls: it owns a camera's position around a
   target and answers pointer/wheel events on a DOM element. Call update()
   once per frame (or rely on the event handlers, which update immediately). */

export class OrbitControls {
  constructor(object, domElement) {
    if (!object || !object.isCamera) throw new TypeError('gs3d: OrbitControls requires a camera');
    this.object = object;
    this.domElement = domElement;
    this.target = new Vector3();
    this.enabled = true;
    this.enableDamping = false;
    this.dampingFactor = 0.05;
    this.enableZoom = true;
    this.enablePan = true;
    this.enableRotate = true;
    this.rotateSpeed = 1;
    this.zoomSpeed = 1;
    this.panSpeed = 1;
    this.minDistance = 0;
    this.maxDistance = Infinity;
    this.minPolarAngle = 0;
    this.maxPolarAngle = Math.PI;
    this.screenSpacePanning = true;

    // Spherical offset of the camera around the target (three.js convention:
    // theta azimuth from +Z, phi polar angle from +Y).
    this._radius = 1; this._theta = 0; this._phi = Math.PI / 2;
    this._thetaDelta = 0; this._phiDelta = 0; this._radiusDelta = 1;
    this._panOffset = new Vector3();
    this._pointers = new Map();
    this._disposed = false;

    this._onPointerDown = e => this._pointerDown(e);
    this._onPointerMove = e => this._pointerMove(e);
    this._onPointerUp = e => this._pointerUp(e);
    this._onWheel = e => this._wheel(e);
    this._onContextMenu = e => e.preventDefault();
    this._listeners = new Map();
    const el = domElement;
    el.addEventListener('pointerdown', this._onPointerDown);
    el.addEventListener('pointermove', this._onPointerMove);
    el.addEventListener('pointerup', this._onPointerUp);
    el.addEventListener('pointercancel', this._onPointerUp);
    el.addEventListener('wheel', this._onWheel, { passive: false });
    el.addEventListener('contextmenu', this._onContextMenu);
    if (el.setPointerCapture) { /* capture happens per-pointer */ }
    if (el.style) el.style.touchAction = 'none';

    this._readSpherical();
  }

  // Minimal EventDispatcher surface (three.js parity for the events this
  // control emits): 'start', 'change', 'end'.
  addEventListener(type, listener) {
    if (typeof listener !== 'function') return;
    let set = this._listeners.get(type);
    if (!set) this._listeners.set(type, set = new Set());
    set.add(listener);
  }
  removeEventListener(type, listener) {
    this._listeners.get(type)?.delete(listener);
  }
  hasEventListener(type, listener) {
    return !!this._listeners.get(type)?.has(listener);
  }
  dispatchEvent(event) {
    const type = typeof event === 'string' ? event : event?.type;
    const set = this._listeners.get(type);
    if (!set) return false;
    const payload = typeof event === 'string' || !event ? { type, target: this } : event;
    if (payload.target === undefined) payload.target = this;
    for (const listener of [...set]) listener.call(this, payload);
    return true;
  }

  rotateLeft(angle) { this._thetaDelta -= angle; this.update(); }
  rotateUp(angle) { this._phiDelta -= angle; this.update(); }
  dollyIn(scale) { this._radiusDelta *= Math.max(1e-6, scale); this.update(); }
  dollyOut(scale) { this._radiusDelta /= Math.max(1e-6, scale); this.update(); }

  _readSpherical() {
    const p = this.object.position, t = this.target;
    const dx = p.x - t.x, dy = p.y - t.y, dz = p.z - t.z;
    this._radius = Math.hypot(dx, dy, dz) || 1e-4;
    this._theta = Math.atan2(dx, dz);
    this._phi = Math.acos(Math.max(-1, Math.min(1, dy / this._radius)));
  }

  _sphericalVector(out) {
    const sp = Math.sin(this._phi);
    return out.set(this._radius * sp * Math.sin(this._theta),
      this._radius * Math.cos(this._phi),
      this._radius * sp * Math.cos(this._theta));
  }

  _pointerDown(event) {
    if (!this.enabled) return;
    this._pointers.set(event.pointerId, {
      x: event.clientX, y: event.clientY,
      pan: event.button === 2 || (event.button === 0 && event.shiftKey),
    });
    try { this.domElement.setPointerCapture(event.pointerId); } catch {}
  }

  _pointerMove(event) {
    const point = this._pointers.get(event.pointerId);
    if (!point || !this.enabled) return;
    const dx = event.clientX - point.x, dy = event.clientY - point.y;
    const height = this.domElement.clientHeight || 1;
    if (this._pointers.size === 2 && this.enableZoom) {
      // Pinch: the moved pointer's old position vs its new one, relative to
      // the other pointer's last position.
      const other = [...this._pointers.values()].find(p => p !== point);
      if (other) {
        const before = Math.hypot(point.x - other.x, point.y - other.y);
        const after = Math.hypot(event.clientX - other.x, event.clientY - other.y);
        if (before > 0 && after > 0) this._radiusDelta *= before / after;
      }
    } else if (this._pointers.size === 1) {
      if (point.pan) {
        if (this.enablePan) this._pan(dx, dy);
      } else if (this.enableRotate) {
        this._thetaDelta -= (2 * Math.PI * dx) / height * this.rotateSpeed;
        this._phiDelta -= (2 * Math.PI * dy) / height * this.rotateSpeed;
      }
    }
    point.x = event.clientX; point.y = event.clientY;
    this.update();
  }

  _pointerUp(event) {
    this._pointers.delete(event.pointerId);
    try { this.domElement.releasePointerCapture?.(event.pointerId); } catch {}
  }

  _wheel(event) {
    if (!this.enabled || !this.enableZoom) return;
    event.preventDefault();
    const units = event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? (this.domElement.clientHeight || 1) : 1;
    const dy = Math.max(-1, Math.min(1, event.deltaY * units * 0.002)) * this.zoomSpeed;
    this._radiusDelta *= Math.exp(dy);
    this.update();
  }

  _pan(dx, dy) {
    const s = this._radius * 0.0016 * this.panSpeed;
    // Camera right and up in world space (roll-free approximation).
    const world = worldMatrixOf(this.object);
    const right = normalize3(transformDir(world, 1, 0, 0));
    const up = normalize3(transformDir(world, 0, 1, 0));
    const pan = this._panOffset;
    pan.x += (-right[0] * dx + up[0] * dy) * s;
    pan.y += (-right[1] * dx + up[1] * dy) * s;
    pan.z += (-right[2] * dx + up[2] * dy) * s;
  }

  update() {
    if (this._disposed) return false;
    const moved = this._thetaDelta !== 0 || this._phiDelta !== 0 || this._radiusDelta !== 1
      || this._panOffset.x !== 0 || this._panOffset.y !== 0 || this._panOffset.z !== 0;
    this._phi = Math.max(this.minPolarAngle, Math.min(this.maxPolarAngle, this._phi + this._phiDelta));
    this._theta += this._thetaDelta;
    this._radius = Math.max(this.minDistance, Math.min(this.maxDistance, this._radius * this._radiusDelta));
    this._thetaDelta = 0; this._phiDelta = 0; this._radiusDelta = 1;
    const offset = this._sphericalVector(new Vector3());
    this.object.position.set(this.target.x + offset.x + this._panOffset.x,
      this.target.y + offset.y + this._panOffset.y,
      this.target.z + offset.z + this._panOffset.z);
    this._panOffset.set(0, 0, 0);
    this.object.lookAt(this.target);
    if (moved) this.dispatchEvent('change');
    return true;
  }

  dispose() {
    if (this._disposed) return;
    this._disposed = true;
    const el = this.domElement;
    el.removeEventListener('pointerdown', this._onPointerDown);
    el.removeEventListener('pointermove', this._onPointerMove);
    el.removeEventListener('pointerup', this._onPointerUp);
    el.removeEventListener('pointercancel', this._onPointerUp);
    el.removeEventListener('wheel', this._onWheel);
    el.removeEventListener('contextmenu', this._onContextMenu);
    this._pointers.clear();
  }
}

/* --- engine bridge state ----------------------------------------------------------- */

// One wasm engine per page. Entries are WeakMaps so scenes collect normally.
let sharedEngine = null;
const nodeStates = new WeakMap();   // Object3D -> engine node record
const geometryStates = new WeakMap(); // BufferGeometry -> {flag: {id,generation,version}}
const materialStates = new WeakMap(); // Material -> {id,generation,signature}
// Custom fragment shaders ({header, body} GLSL) are compiled once per object
// and shared by every material that references it.
const customShaderIds = new WeakMap(); // customShader object -> engine shader id
let customShaderSeq = 0;
const cameraStates = new WeakMap();  // Camera -> engine camera id
const textureStates = new WeakMap(); // Texture -> {id,generation,signature}
const texture3dStates = new WeakMap(); // Data3DTexture -> {id,generation,signature}
let engineCanvasSeq = 0;
// Objects that currently own an engine node. render() releases records for
// objects absent from the scene being drawn, so switching scenes cannot leak
// the previous scene's nodes into the frame.
const syncedObjects = new Set();

function releaseNodeRecord(record) {
  if (!record || !sharedEngine) return;
  sharedEngine._g3_asset_node_release(record.index, record.generation, record.epoch);
}
function releaseEngineTree(object) {
  // Release every engine node in the detached subtree. Engine-side children
  // reparent automatically; the sync pass recreates whatever is reattached.
  const records = [];
  object.traverse(node => {
    const record = nodeStates.get(node);
    if (record) { records.push(record); nodeStates.delete(node); syncedObjects.delete(node); }
  });
  for (const record of records) releaseNodeRecord(record);
}

function releaseGeometryFlag(geometry, flag) {
  const byFlag = geometryStates.get(geometry);
  const state = byFlag?.[flag];
  if (state && sharedEngine) sharedEngine._g3_asset_release_mesh(state.id, state.generation);
  if (byFlag) delete byFlag[flag];
}
function releaseGeometry(geometry) {
  const byFlag = geometryStates.get(geometry);
  if (byFlag) for (const flag of Object.keys(byFlag)) {
    const state = byFlag[flag];
    if (state && sharedEngine) sharedEngine._g3_asset_release_mesh(state.id, state.generation);
  }
  geometryStates.delete(geometry);
}
function releaseMaterial(material) {
  const state = materialStates.get(material);
  if (state && sharedEngine) sharedEngine._g3_asset_release_material(state.id, state.generation);
  materialStates.delete(material);
}
function releaseTexture(texture) {
  const state = textureStates.get(texture);
  if (state && sharedEngine) sharedEngine._g3_asset_release_texture(state.id, state.generation);
  textureStates.delete(texture);
  const state3d = texture3dStates.get(texture);
  if (state3d && sharedEngine) sharedEngine._g3_asset_release_texture(state3d.id, state3d.generation);
  texture3dStates.delete(texture);
}

function textureSignature(texture) {
  // Only upload-affecting fields; UV transform lives on the material.
  const image = textureImageData(texture.image);
  return [
    image ? `${image.width}x${image.height}` : 'pending',
    texture.colorSpace, texture.wrapS, texture.wrapT,
    texture.magFilter, texture.minFilter, texture.version,
  ].join(',');
}

function ensureTexture(engine, texture) {
  const signature = textureSignature(texture);
  const state = textureStates.get(texture);
  if (state && state.signature === signature) return state.id;
  if (state) engine._g3_asset_release_texture(state.id, state.generation);
  const image = textureImageData(texture.image);
  if (!image?.pixels?.length) return -1;

  const f16 = (texture.type === HalfFloatType || image.pixels instanceof Uint16Array) &&
    image.pixels.byteLength === image.width * image.height * 8 &&
    typeof engine._g3_host_texture_f16 === 'function';
  const ptr = engine._malloc(image.pixels.byteLength || image.pixels.length);
  if (!ptr) return -1;
  let id = -1;
  try {
    engine.HEAPU8.set(image.pixels instanceof Uint8Array || image.pixels instanceof Uint8ClampedArray
      ? image.pixels
      : image.pixels instanceof Uint16Array
        ? new Uint8Array(image.pixels.buffer, image.pixels.byteOffset, image.pixels.byteLength)
        : new Uint8ClampedArray(image.pixels), ptr);
    if (f16) {
      id = engine._g3_host_texture_f16(image.width, image.height, ptr, image.pixels.byteLength);
    } else {
      id = engine._g3_asset_texture();
      if (id >= 0) {
        const srgb = texture.colorSpace === SRGBColorSpace;
        if (srgb) engine._g3_host_texture_srgb(id, ptr, image.width, image.height);
        else engine._g3_host_texture(id, ptr, image.width, image.height);
      }
    }
    if (id < 0) return -1;
    const wrapU = WRAP_TO_ENGINE[texture.wrapS] ?? 1;
    const wrapV = WRAP_TO_ENGINE[texture.wrapT] ?? 1;
    engine._g3_host_texture_wrap(id, wrapU, wrapV);
    const minFilter = FILTER_TO_GL[texture.minFilter] ?? 9729;
    const magFilter = FILTER_TO_GL[texture.magFilter] ?? 9729;
    engine._g3_host_texture_filter(id, minFilter, magFilter);
  } finally {
    engine._free(ptr);
  }
  const record = { id, generation: engine._g3_asset_texture_generation(id), signature };
  textureStates.set(texture, record);
  return id;
}

function ensureTexture3D(engine, texture) {
  if (!texture || !texture.isData3DTexture) return -1;
  if (typeof engine._g3_host_texture_3d !== 'function') return -1;
  const image = texture.image;
  const data = image?.data;
  const f16 = data instanceof Uint16Array &&
    typeof engine._g3_host_texture_3d_f16 === 'function';
  if (!data || !(data instanceof Uint8Array || data instanceof Uint8ClampedArray || f16)) return -1;
  const signature = [image ? `${image.width}x${image.height}x${image.depth}` : 'pending',
    texture.version, f16 ? 'f16' : 'rgba8'].join(',');
  const state = texture3dStates.get(texture);
  if (state && state.signature === signature) return state.id;
  if (state) engine._g3_asset_release_texture(state.id, state.generation);
  const ptr = engine._malloc(data.byteLength || data.length);
  if (!ptr) return -1;
  try {
    engine.HEAPU8.set(data instanceof Uint8Array || data instanceof Uint8ClampedArray
      ? data : new Uint8Array(data.buffer, data.byteOffset, data.byteLength), ptr);
    const id = f16
      ? engine._g3_host_texture_3d_f16(image.width, image.height, image.depth, ptr, data.byteLength)
      : engine._g3_host_texture_3d(image.width, image.height, image.depth, ptr, data.length);
    if (id < 0) return -1;
    const record = { id, generation: engine._g3_asset_texture_generation(id), signature };
    texture3dStates.set(texture, record);
    return id;
  } finally {
    engine._free(ptr);
  }
}

// rotation (Euler) and quaternion are two views of the same orientation.
// Whichever changed since the last resolve wins; the other is synced so
// reads stay consistent. Both-changed resolves to the quaternion.
function resolvedQuaternion(object) {
  const q = object.quaternion, e = object.rotation;
  const qc = object._qCache, ec = object._eCache;
  const qChanged = q.x !== qc.x || q.y !== qc.y || q.z !== qc.z || q.w !== qc.w;
  const eChanged = e.x !== ec.x || e.y !== ec.y || e.z !== ec.z;
  if (qChanged) {
    const [ex, ey, ez] = eulerFromQuatXYZ(q);
    e.set(ex, ey, ez);
  } else if (eChanged) {
    const nq = quatFromEulerXYZ(e.x, e.y, e.z);
    q.set(nq.x, nq.y, nq.z, nq.w);
  }
  qc.x = q.x; qc.y = q.y; qc.z = q.z; qc.w = q.w;
  ec.x = e.x; ec.y = e.y; ec.z = e.z;
  return q;
}

function localMatrixOf(object) {
  if (object.matrixAutoUpdate === false && object.matrix) return object.matrix.elements;
  const p = object.position, s = object.scale, q = resolvedQuaternion(object);
  // Compose is the expensive part (six trig calls); skip it while the
  // transform inputs are unchanged. The cache lives on the object so it
  // survives across frames and worlds.
  const c = object._lmCache;
  if (c && c.px === p.x && c.py === p.y && c.pz === p.z &&
      c.qx === q.x && c.qy === q.y && c.qz === q.z && c.qw === q.w &&
      c.sx === s.x && c.sy === s.y && c.sz === s.z) return c.elements;
  const elements = composeLocal(p, q, s);
  object._lmCache = { elements, px: p.x, py: p.y, pz: p.z,
    qx: q.x, qy: q.y, qz: q.z, qw: q.w, sx: s.x, sy: s.y, sz: s.z };
  return elements;
}

function worldMatrixOf(object) {
  let world = localMatrixOf(object);
  let parent = object.parent;
  while (parent) {
    world = multiplyMat4(localMatrixOf(parent), world);
    parent = parent.parent;
  }
  return world;
}

// material.flatShading is emulated by expanding the geometry into
// non-indexed triangles with per-face normals. Cached per source geometry
// and rebuilt whenever its version bumps.
const flatGeometryCache = new WeakMap();
function flatShadedGeometry(geometry) {
  const cached = flatGeometryCache.get(geometry);
  if (cached && cached.version === geometry.version) return cached.geo;
  const src = attrData(geometry.attributes.position);
  const p = src?.array, is = src?.itemSize;
  const index = geometry.index && geometry.index.array;
  const triCount = index ? index.length / 3 : src.count / 3;
  const vertCount = triCount * 3;
  const positions = new Float32Array(vertCount * 3);
  const normals = new Float32Array(vertCount * 3);
  const uvs = [], colors = [];
  const uvData = attrData(geometry.attributes.uv);
  const colorData = attrData(geometry.attributes.color);
  const uvAttr = uvData, colorAttr = colorData;
  const readVert = vi => {
    const i = vi * is;
    return [p[i], p[i + 1] || 0, p[i + 2] || 0];
  };
  let w = 0;
  for (let t = 0; t < triCount; t++) {
    const ia = index ? index[t * 3] : t * 3;
    const ib = index ? index[t * 3 + 1] : t * 3 + 1;
    const ic = index ? index[t * 3 + 2] : t * 3 + 2;
    const a = readVert(ia), b = readVert(ib), c = readVert(ic);
    const ux = b[0] - a[0], uy = b[1] - a[1], uz = b[2] - a[2];
    const vx = c[0] - a[0], vy = c[1] - a[1], vz = c[2] - a[2];
    let nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
    const nl = Math.hypot(nx, ny, nz);
    if (nl > 1e-12) { nx /= nl; ny /= nl; nz /= nl; }
    for (const vi of [ia, ib, ic]) {
      const v = readVert(vi);
      positions[w] = v[0]; positions[w + 1] = v[1]; positions[w + 2] = v[2];
      normals[w] = nx; normals[w + 1] = ny; normals[w + 2] = nz;
      w += 3;
      if (uvAttr) {
        const ui = vi * uvAttr.itemSize;
        uvs.push(uvAttr.array[ui] || 0, uvAttr.array[ui + 1] || 0);
      }
      if (colorAttr) {
        const ci = vi * colorAttr.itemSize;
        colors.push(colorAttr.array[ci] || 1, colorAttr.array[ci + 1] || 1,
          colorAttr.array[ci + 2] || 1, colorAttr.array[ci + 3] ?? 1);
      }
    }
  }
  const geo = new BufferGeometry();
  geo.setAttribute('position', new Float32BufferAttribute(positions, 3));
  geo.setAttribute('normal', new Float32BufferAttribute(normals, 3));
  if (uvAttr) geo.setAttribute('uv', new Float32BufferAttribute(uvs, 2));
  if (colorAttr) geo.setAttribute('color', new Float32BufferAttribute(colors, colorAttr.itemSize));
  flatGeometryCache.set(geometry, { version: geometry.version, geo });
  return geo;
}

/* Custom vertex attributes — anything that is not position, normal, color,
   tangent or an explicit uv/uvN slot — are packed into the eight vec2 UV
   channels the engine vertex format carries, after the explicit uv
   attributes claim theirs. Each attribute owns ceil(itemSize/2) whole
   slots, filled in component order. Slot ownership is global and
   append-only (customAttrRegistry) so a ShaderMaterial's vertex decode is
   consistent across geometries; an attribute whose slots collide with a
   geometry's explicit uvN attributes is dropped there (its channels read
   as zeros or the material's defaultAttributeValues). Attributes a
   material needs but the geometry lacks are filled from
   material.defaultAttributeValues, or declared ShaderMaterial attributes. */

const UV_SLOT_ATTRS = ['uv', 'uv1', 'uv2', 'uv3', 'uv4', 'uv5', 'uv6', 'uv7'];
const STANDARD_ATTRS = new Set(['position', 'normal', 'color', 'tangent', ...UV_SLOT_ATTRS]);
const customAttrRegistry = new Map(); // name -> {slots:[...], itemSize}
let customAttrRegistryVersion = 0;
const attrDataCache = new WeakMap();

function attrData(attribute) {
  if (!attribute) return null;
  if (attribute.isInterleavedBufferAttribute) {
    let cached = attrDataCache.get(attribute);
    if (!cached) {
      const { data, itemSize, offset } = attribute;
      const stride = data.stride, count = attribute.count, src = data.array;
      const out = new Float32Array(count * itemSize);
      for (let i = 0; i < count; i++) {
        const base = i * stride + offset;
        for (let c = 0; c < itemSize; c++) out[i * itemSize + c] = src[base + c] ?? 0;
      }
      cached = { array: out, itemSize, count };
      attrDataCache.set(attribute, cached);
    }
    return cached;
  }
  return { array: attribute.array, itemSize: attribute.itemSize, count: attribute.count };
}

function allocateCustomSlots(need, blocked) {
  const used = new Set();
  for (const reg of customAttrRegistry.values()) for (const s of reg.slots) used.add(s);
  for (let s = 0; s < 8; s++) if (blocked[s]) used.add(s);
  for (let start = 0; start + need <= 8; start++) {
    let ok = true;
    for (let k = 0; k < need; k++) if (used.has(start + k)) { ok = false; break; }
    if (ok) return Array.from({ length: need }, (_, k) => start + k);
  }
  return null;
}

// The attribute layout resolution (uv slots, custom attributes, fills) only
// depends on the geometry's attributes, the vertex-color/flat-shading flags
// and the material's defaultAttributeValues/ShaderMaterial declarations —
// none of which change between frames in practice. Cache the resolved layout
// per (geometry, material, flags) and revalidate cheaply each call instead of
// rebuilding attribute tables and signature strings every render().
const preparedGeometryCache = new WeakMap(); // geometry -> WeakMap<material, Map<flags, entry>>
const NO_MATERIAL = {};

function preparedGeometry(geometry, useVertexColors, flatShading, material) {
  const src = flatShading ? flatShadedGeometry(geometry) : geometry;
  const position = attrData(src.attributes.position);
  if (!position) return null;
  if (!src.attributes.normal) src.computeVertexNormals();
  const normal = attrData(src.attributes.normal);
  const count = position.count;

  // Explicit uv/uvN attributes claim their named slots first.
  const slotData = new Array(8).fill(null);
  const claimed = new Array(8).fill(false);
  for (let set = 0; set < 8; set++) {
    const attr = attrData(src.attributes[set === 0 ? 'uv' : `uv${set}`]);
    if (attr) { slotData[set] = attr; claimed[set] = true; }
  }
  const color = useVertexColors ? attrData(src.attributes.color) : null;
  const ns = normal ? normal.itemSize : 3, cs = color ? color.itemSize : 4;

  // Collect custom attribute names: everything on the geometry outside the
  // standard set, plus names the material references through
  // defaultAttributeValues or ShaderMaterial vertex declarations.
  const customNames = [];
  const pushName = name => {
    if (!STANDARD_ATTRS.has(name) && !customNames.includes(name)) customNames.push(name);
  };
  for (const name of Object.keys(src.attributes)) pushName(name);
  const defaults = material && material.defaultAttributeValues;
  if (defaults) for (const name of Object.keys(defaults)) {
    if (Array.isArray(defaults[name])) pushName(name);
  }
  if (material && material.isShaderMaterial) {
    for (const a of vertexAttrInfo(material)) pushName(a.name);
  }

  const customs = [], fills = [];
  for (const name of customNames) {
    const data = attrData(src.attributes[name]);
    const itemSize = Math.min(4, Math.max(1,
      data ? data.itemSize : (defaults && Array.isArray(defaults[name]) ? defaults[name].length : 2)));
    let reg = customAttrRegistry.get(name);
    if (!reg) {
      const slots = allocateCustomSlots(Math.ceil(itemSize / 2), claimed);
      if (!slots) continue; // channel budget exhausted; attribute reads as zero
      reg = { slots, itemSize };
      customAttrRegistry.set(name, reg);
      customAttrRegistryVersion++;
    }
    const capacity = reg.slots.length * 2;
    if (reg.slots.some(s => claimed[s])) {
      // Explicit uvN attributes win this geometry's slots; the custom
      // attribute is dropped here and its channels stay at defaults.
      if (defaults && Array.isArray(defaults[name])) {
        fills.push({ slots: reg.slots, values: defaults[name], count: Math.min(defaults[name].length, capacity) });
      }
      continue;
    }
    if (data) {
      customs.push({ name, data, slots: reg.slots, count: Math.min(data.itemSize, capacity) });
    } else if (defaults && Array.isArray(defaults[name])) {
      fills.push({ slots: reg.slots, values: defaults[name], count: Math.min(defaults[name].length, capacity) });
    }
  }

  const customSig = customs.map(c => `${c.name}:${c.slots}`).join(',') +
    '|' + fills.map(f => `${f.name}=${f.values}`).join(',');
  return {
    src, position, normal, color, count, ns, cs, slotData, customs, fills,
    flag: `${useVertexColors ? 1 : 0}${flatShading ? 1 : 0}|${customSig}`,
    indexIds: src.index ? src.index.array : null,
    // Revalidation inputs: anything the layout depends on that can change
    // without bumping geometry.version.
    gVersion: geometry.version,
    regVersion: customAttrRegistryVersion,
    vs: material ? material.vertexShader : undefined,
    defaults,
    isShader: !!(material && material.isShaderMaterial),
  };
}

function cachedPreparedGeometry(geometry, useVertexColors, flatShading, material) {
  const flags = `${useVertexColors ? 1 : 0}${flatShading ? 1 : 0}`;
  let byMaterial = preparedGeometryCache.get(geometry);
  if (!byMaterial) preparedGeometryCache.set(geometry, byMaterial = new WeakMap());
  const key = material || NO_MATERIAL;
  let byFlags = byMaterial.get(key);
  if (!byFlags) byMaterial.set(key, byFlags = new Map());
  let entry = byFlags.get(flags);
  const defaults = material && material.defaultAttributeValues;
  const isShader = !!(material && material.isShaderMaterial);
  if (entry && entry.gVersion === geometry.version &&
      entry.regVersion === customAttrRegistryVersion &&
      entry.vs === (material ? material.vertexShader : undefined) &&
      entry.defaults === defaults && entry.isShader === isShader) {
    return entry;
  }
  entry = preparedGeometry(geometry, useVertexColors, flatShading, material);
  if (entry) byFlags.set(flags, entry);
  return entry;
}

function ensureGeometry(engine, geometry, useVertexColors = false, flatShading = false, material = null) {
  if (!geometry || !geometry.attributes || !geometry.attributes.position) return -1;
  const prepared = cachedPreparedGeometry(geometry, useVertexColors, flatShading, material);
  if (!prepared) return -1;
  const { position, normal, color, count, ns, cs, slotData, customs, fills, flag, indexIds } = prepared;
  const p = position.array, n = normal ? normal.array : null, c = color ? color.array : null;
  const byFlag = geometryStates.get(geometry) || {};
  const state = byFlag[flag];
  if (state && state.version === geometry.version) return state.id;
  if (state) engine._g3_asset_release_mesh(state.id, state.generation);

  const slotVals = new Float64Array(16);
  engine._g3_asset_mesh_begin();
  for (let i = 0; i < count; i++) {
    const pi = i * position.itemSize, ni = i * ns, ci = i * cs;
    slotVals.fill(0);
    for (let set = 0; set < 8; set++) {
      const attr = slotData[set];
      if (attr) {
        const ui = i * attr.itemSize;
        slotVals[set * 2] = attr.array[ui] || 0;
        slotVals[set * 2 + 1] = attr.array[ui + 1] || 0;
      }
    }
    for (const cu of customs) {
      const base = i * cu.data.itemSize;
      for (let f = 0; f < cu.count; f++) {
        slotVals[cu.slots[f >> 1] * 2 + (f & 1)] = cu.data.array[base + f] || 0;
      }
    }
    for (const f of fills) {
      for (let k = 0; k < f.count; k++) {
        slotVals[f.slots[k >> 1] * 2 + (k & 1)] = f.values[k] || 0;
      }
    }
    engine._g3_asset_vertex(
      p[pi], p[pi + 1], p[pi + 2],
      n && ns > 0 ? n[ni] : 0, n && ns > 1 ? n[ni + 1] : 0, n && ns > 2 ? n[ni + 2] : 1,
      ...slotVals,
      0, 0, 0, 0, // tangent
      c && cs > 0 ? c[ci] : 1, c && cs > 1 ? c[ci + 1] : 1, c && cs > 2 ? c[ci + 2] : 1,
      c && cs > 3 ? c[ci + 3] : 1,
    );
  }
  if (indexIds) {
    const ids = indexIds;
    for (let i = 0; i + 2 < ids.length; i += 3) engine._g3_asset_triangle(ids[i], ids[i + 1], ids[i + 2]);
  } else {
    for (let i = 0; i + 2 < count; i += 3) engine._g3_asset_triangle(i, i + 1, i + 2);
  }
  const id = engine._g3_asset_mesh_end();
  const record = { id, generation: engine._g3_asset_mesh_generation(id), version: geometry.version };
  byFlag[flag] = record;
  geometryStates.set(geometry, byFlag);
  return id;
}

const ALPHA_OPAQUE = 0, ALPHA_MASK = 1, ALPHA_BLEND = 2;

function materialSignature(material) {
  const parts = [material.color.r, material.color.g, material.color.b, material.opacity,
    material.transparent, material.alphaTest, material.side, material.visible];
  if (material.isMeshStandardMaterial || material.isMeshPhysicalMaterial) {
    parts.push(material.metalness, material.roughness, material.emissive.r, material.emissive.g,
      material.emissive.b, material.emissiveIntensity, material.ior, material.envMapIntensity);
  }
  const cs = material.customShader;
  if (cs) {
    if (!cs._gs3dKey) cs._gs3dKey = ++customShaderSeq;
    parts.push('cs' + cs._gs3dKey);
    const u = material.customUniforms;
    if (u) for (let i = 0; i < 32; i++) parts.push(u[i] ?? 0);
  }
  return parts.join(',');
}

// Engine texture slots mirror the g3_asset_material argument order:
// 0 base color, 1 metallic-roughness (packed G=roughness, B=metallic),
// 2 normal, 3 occlusion (R channel), 4 emissive.
const MATERIAL_MAPS = [
  ['map', 0],
  ['metalnessMap', 1], ['roughnessMap', 1],
  ['normalMap', 2],
  ['aoMap', 3],
  ['emissiveMap', 4],
];

function materialMaps(material) {
  const maps = [null, null, null, null, null];
  for (const [key, slot] of MATERIAL_MAPS) {
    const texture = material[key];
    if (texture && texture.isTexture && !maps[slot]) maps[slot] = texture;
  }
  return maps;
}

function textureUvSignature(texture) {
  return `${texture.offset.x},${texture.offset.y},${texture.repeat.x},${texture.repeat.y},${texture.rotation},${texture.channel || 0}`;
}

// Material -> engine material id, deduplicated for the duration of one
// render() pass so shared materials pay the signature cost once per frame.
let frameMaterialCache = null;
let fallbackMaterial = null;

/* --- raw shader materials ----------------------------------------------------- */

// ShaderMaterial -> {id, sourceKey, uniformSig}: one engine program per
// material instance; uniform values update in place through the program's
// generation counter, so they never force a material re-creation.
const rawShaderStates = new WeakMap();

const RAW_SHADER_CHUNKS = {
  tonemapping_fragment: 'gl_FragColor.rgb = g3_tone_map(gl_FragColor.rgb);',
  colorspace_fragment: 'if (u_g3_output_srgb > 0.5) { gl_FragColor.rgb = g3_encode_srgb(gl_FragColor.rgb); }',
};

function resolveRawChunks(source) {
  return String(source || '').replace(/#include\s*<([^>\s]+)>/g, (_match, name) => {
    const chunk = RAW_SHADER_CHUNKS[name];
    if (chunk === undefined) console.warn(`gs3d: unsupported shader chunk #include <${name}> dropped`);
    return chunk ?? '';
  });
}

function rawUploadText(engine, text) {
  const bytes = new TextEncoder().encode(text || '');
  const ptr = engine._malloc(bytes.length);
  engine.HEAPU8.set(bytes, ptr);
  return [ptr, bytes.length];
}

function ensureRawShader(engine, material) {
  const vertex = rewriteRawVertex(material);
  const fragment = resolveRawChunks(material.fragmentShader);
  const sourceKey = vertex + '\n' + fragment;
  let state = rawShaderStates.get(material);
  if (state && state.sourceKey === sourceKey) return state;
  if (state && typeof engine._g3_asset_raw_shader_release === 'function') {
    engine._g3_asset_raw_shader_release(state.id);
  }
  if (typeof engine._g3_host_raw_shader_create !== 'function') return { id: -1, sourceKey };
  const v = rawUploadText(engine, vertex);
  const f = rawUploadText(engine, fragment);
  let id = -1;
  try {
    id = engine._g3_host_raw_shader_create(v[0], v[1], f[0], f[1]);
  } finally {
    engine._free(v[0]);
    engine._free(f[0]);
  }
  state = { id, sourceKey, uniformSig: null };
  rawShaderStates.set(material, state);
  return state;
}

const RAW_UNIFORM_KIND = { float: 0, vec2: 1, vec3: 2, vec4: 3, mat4: 4, int: 5 };

/* Raw vertex attributes: the engine's vertex format exposes position,
   normal, uv (slot 0), color and tangent directly, plus the packed UV
   channels as four vec4 attributes named _g3_uv01/_g3_uv23/_g3_uv45/_g3_uv67
   (uv/uv1, uv2/uv3, uv4/uv5, uv6/uv7). ShaderMaterial vertex shaders keep
   three.js syntax: every `attribute` declaration is stripped (the prefix
   supplies the standard ones) and uv1+ plus custom attributes become local
   variables decoded from the packed channels at the top of main(). Slot
   assignments come from customAttrRegistry, so the rewrite is recomputed
   whenever the registry grows (tracked by customAttrRegistryVersion). */

const RAW_VEC4_ATTRS = ['_g3_uv01', '_g3_uv01', '_g3_uv23', '_g3_uv23',
  '_g3_uv45', '_g3_uv45', '_g3_uv67', '_g3_uv67'];
const RAW_GLSL_SIZE = { float: 1, int: 1, vec2: 2, vec3: 3, vec4: 4 };
const rawRewriteCache = new WeakMap();
const vertexAttrCache = new WeakMap();

function vertexAttrInfo(material) {
  const source = material.vertexShader;
  const hit = vertexAttrCache.get(material);
  if (hit && hit.source === source) return hit.info;
  const info = [];
  const re = /attribute\s+(float|int|vec2|vec3|vec4)\s+(\w+)\s*;/g;
  for (const m of resolveRawChunks(source).matchAll(re)) info.push({ type: m[1], name: m[2] });
  vertexAttrCache.set(material, { source, info });
  return info;
}

function rawAttrDecode(name, type, material) {
  const n = RAW_GLSL_SIZE[type] || 2;
  const uvIndex = UV_SLOT_ATTRS.indexOf(name);
  const reg = uvIndex >= 0 ? null : customAttrRegistry.get(name);
  const slots = uvIndex >= 0 ? [uvIndex] : (reg?.slots.length ? reg.slots : null);
  const defaults = material.defaultAttributeValues;
  const def = defaults && Array.isArray(defaults[name]) ? defaults[name] : null;
  const capacity = slots ? slots.length * 2 : 0;
  const comps = [];
  for (let f = 0; f < n; f++) {
    let expr = '0.0';
    if (slots && f < capacity) {
      const slot = slots[f >> 1];
      expr = `${RAW_VEC4_ATTRS[slot >> 1]}.${'xyzw'[(slot & 1) * 2 + (f & 1)]}`;
    } else if (!slots && def && f < def.length) {
      expr = String(def[f]);
    }
    comps.push(expr);
  }
  if (type === 'float' || type === 'int') return `${type}(${comps[0]})`;
  return `${type}(${comps.join(',')})`;
}

function rewriteRawVertex(material) {
  const resolved = resolveRawChunks(material.vertexShader);
  const hit = rawRewriteCache.get(material);
  if (hit && hit.source === material.vertexShader && hit.version === customAttrRegistryVersion) return hit.result;
  const info = vertexAttrInfo(material);
  const byName = new Map(info.map(a => [a.name, a]));
  const decodes = [];
  const stripped = resolved.replace(/attribute\s+(float|int|vec2|vec3|vec4)\s+(\w+)\s*;/g,
    (match, type, name) => {
      if (name === 'position' || name === 'normal' || name === 'uv' || name === 'color' || name === 'tangent') return '';
      const decl = byName.get(name) || { type };
      decodes.push(`${decl.type} ${name} = ${rawAttrDecode(name, decl.type, material)};`);
      return '';
    });
  // Attributes the shader uses without declaring (three auto-declares the
  // standard set) still resolve through the prefix; uv1+ and custom names
  // only exist when declared, matching three.js.
  let result = stripped;
  if (decodes.length) {
    const mainAt = result.search(/void\s+main\s*\(/);
    if (mainAt >= 0) {
      const brace = result.indexOf('{', mainAt);
      if (brace >= 0) result = result.slice(0, brace + 1) + '\n' + decodes.join('\n') + result.slice(brace + 1);
    }
  }
  rawRewriteCache.set(material, { source: material.vertexShader, version: customAttrRegistryVersion, result });
  return result;
}

// Classify a uniform value into {kind, floats} or {texture}. Returns null
// for unsupported shapes (the uniform is skipped with a warning).
function rawUniformPayload(value) {
  const v = value && value.value !== undefined ? value.value : value;
  if (v === undefined || v === null) return null;
  if (typeof v === 'number') return { kind: RAW_UNIFORM_KIND.float, floats: [v] };
  if (typeof v === 'boolean') return { kind: RAW_UNIFORM_KIND.int, floats: [v ? 1 : 0] };
  if (v.isTexture || v.isDataTexture || v.isData3DTexture) return { texture: v };
  if (v.isMatrix4 || (v.elements && v.elements.length === 16)) {
    return { kind: RAW_UNIFORM_KIND.mat4, floats: Array.from(v.elements || v) };
  }
  if (v.isColor) return { kind: RAW_UNIFORM_KIND.vec3, floats: [v.r, v.g, v.b] };
  if (v.isVector3) return { kind: RAW_UNIFORM_KIND.vec3, floats: [v.x, v.y, v.z] };
  if (v.isVector2) return { kind: RAW_UNIFORM_KIND.vec2, floats: [v.x, v.y] };
  if (typeof v.x === 'number' && typeof v.y === 'number' && typeof v.z === 'number' && typeof v.w === 'number') {
    return { kind: RAW_UNIFORM_KIND.vec4, floats: [v.x, v.y, v.z, v.w] };
  }
  if (typeof v.x === 'number' && typeof v.y === 'number' && typeof v.z === 'number') {
    return { kind: RAW_UNIFORM_KIND.vec3, floats: [v.x, v.y, v.z] };
  }
  if (typeof v.x === 'number' && typeof v.y === 'number' && v.z === undefined) {
    return { kind: RAW_UNIFORM_KIND.vec2, floats: [v.x, v.y] };
  }
  if (Array.isArray(v) || ArrayBuffer.isView(v)) {
    const floats = Array.from(v);
    if (floats.every(x => typeof x === 'number')) {
      return { kind: RAW_UNIFORM_KIND.float, floats };
    }
    // Homogeneous vector arrays become vecN arrays.
    const dims = floats.map(e => {
      const p = rawUniformPayload(e);
      return p && !p.texture ? p : null;
    });
    if (dims.length && dims.every(p => p && p.kind === dims[0].kind && p.floats.length === dims[0].floats.length)) {
      return { kind: dims[0].kind, floats: dims.flatMap(p => p.floats) };
    }
    return null;
  }
  return null;
}

function rawUniformEntries(engine, material) {
  const entries = [];
  for (const name of Object.keys(material.uniforms || {})) {
    const entry = material.uniforms[name];
    const payload = rawUniformPayload(entry);
    if (!payload) continue;
    if (payload.texture) {
      const tex = payload.texture;
      const texId = tex.isData3DTexture
        ? ensureTexture3D(engine, tex)
        : ensureTexture(engine, tex);
      entries.push({ name, texture: texId });
    } else {
      entries.push({ name, kind: payload.kind, floats: payload.floats });
    }
  }
  return entries;
}

function rawUniformSignature(entries) {
  return entries.map(e => e.texture !== undefined
    ? `${e.name}=t${e.texture}`
    : `${e.name}=${e.kind}:${e.floats.join(',')}`).join('|');
}

function uploadRawUniforms(engine, shaderId, entries) {
  for (const e of entries) {
    const nameBytes = new TextEncoder().encode(e.name);
    const namePtr = engine._malloc(nameBytes.length);
    engine.HEAPU8.set(nameBytes, namePtr);
    try {
      if (e.texture !== undefined) {
        engine._g3_host_raw_shader_uniform_texture(shaderId, namePtr, nameBytes.length, e.texture);
        continue;
      }
      const f32 = new Float32Array(e.floats);
      const dataPtr = engine._malloc(f32.byteLength);
      engine.HEAPU8.set(new Uint8Array(f32.buffer, f32.byteOffset, f32.byteLength), dataPtr);
      try {
        engine._g3_host_raw_shader_uniform(shaderId, namePtr, nameBytes.length,
          e.kind, dataPtr, f32.length);
      } finally {
        engine._free(dataPtr);
      }
    } finally {
      engine._free(namePtr);
    }
  }
}

function ensureRawMaterial(engine, material) {
  const src = ensureRawShader(engine, material);
  if (src.id < 0) return -1;
  const entries = rawUniformEntries(engine, material);
  const uniformSig = rawUniformSignature(entries);
  if (src.uniformSig !== uniformSig) {
    uploadRawUniforms(engine, src.id, entries);
    src.uniformSig = uniformSig;
  }
  // The engine material only carries render state for raw programs:
  // double-sidedness, blending and the shader id itself.
  const signature = `raw|${material.side}|${material.transparent}|${material.opacity}|${src.id}`;
  const state = materialStates.get(material);
  if (state && state.signature === signature) return state.id;
  if (state) engine._g3_asset_release_material(state.id, state.generation);
  const alpha = material.transparent ? material.opacity : 1;
  const id = engine._g3_asset_material(1, 1, 1, alpha,
    -1, material.transparent ? 2 : 0, 0, 0, 0,
    -1, -1, 0, -1, 0,
    0, 0, 0, -1,
    material.side !== FrontSide, true, 1.5);
  if (id < 0) return -1;
  engine._g3_asset_material_set_shader(id, src.id);
  const record = { id, generation: engine._g3_asset_material_generation(id), signature };
  materialStates.set(material, record);
  return id;
}


/* --- onBeforeCompile compatibility ----------------------------------------
   three.js materials may define onBeforeCompile(shader) to splice GLSL into
   the lit program. The engine's customShader contract splices user code into
   a fixed point of its own fragment shader, so the facade translates:

   - sentinel-marked chunk templates let us recover which #include <...>
     bodies the callback injected, in pipeline order;
   - uniforms become u_user[] slots (packed floats), u_lut (sampler3D) or
     the emissive-map sampler slot (one sampler2D);
   - three's built-ins become locals with a write-back epilogue: normal is
     view-space like three (written back through the view matrix), and
     diffuseColor, roughnessFactor, the material struct and
   totalEmissiveRadiance sync back to base/mr/coat/sheen/f0/emissive;
   - custom varyings become #defines over the packed v_uvN inputs or the
     v_obj_pos/v_obj_normal/v_view_normal_matrix ins, so helper functions in
     the injected header can read them too. */

const G3CHK = '//__G3CHK_';
const G3_VERT_CHUNKS = ['begin_vertex', 'beginnormal_vertex', 'project_vertex', 'worldpos_vertex'];
const G3_FRAG_CHUNKS = [
  'map_fragment', 'color_fragment', 'alphamap_fragment', 'alphatest_fragment',
  'roughnessmap_fragment', 'metalnessmap_fragment', 'normal_fragment_begin',
  'normal_fragment_maps', 'lights_fragment_begin', 'lights_physical_fragment',
  'aomap_fragment', 'emissivemap_fragment',
  // Output-stage chunks route to the shader tail instead of the body.
  'opaque_fragment', 'tonemapping_fragment', 'colorspace_fragment',
  'fog_fragment', 'output_fragment', 'dithering_fragment',
];
const G3_TAIL_CHUNKS = new Set(['opaque_fragment', 'tonemapping_fragment',
  'colorspace_fragment', 'fog_fragment', 'output_fragment', 'dithering_fragment']);
const G3_SWZ = 'xyzw';

function g3ChunkTemplate(names) {
  return names.map(n => `${G3CHK}${n}\n#include <${n}>`).join('\n') + '\n';
}

// Split a shader string at the sentinel comments into {prelude, chunks:[{name,body}]}.
function g3SplitChunks(src) {
  const first = src.indexOf(G3CHK);
  if (first < 0) return { prelude: src, chunks: [] };
  const prelude = src.slice(0, first);
  const rest = src.slice(first);
  const parts = rest.split(G3CHK).slice(1);
  const chunks = [];
  for (const part of parts) {
    const nl = part.indexOf('\n');
    const name = nl < 0 ? part.trim() : part.slice(0, nl).trim();
    let body = nl < 0 ? '' : part.slice(nl + 1);
    body = body.split('\n').filter(l => !/^\s*#include\b/.test(l)).join('\n');
    chunks.push({ name, body });
  }
  return { prelude, chunks };
}

function g3UniformSize(type) {
  return { float: 1, int: 1, bool: 1, vec2: 2, vec3: 3, vec4: 4 }[type] || 0;
}

// Read a three uniform value ({value}) into up-to-four floats.
function g3UniformFloats(value) {
  if (value === undefined || value === null) return [0, 0, 0, 0];
  if (typeof value === 'number') return [value, 0, 0, 0];
  if (typeof value === 'boolean') return [value ? 1 : 0, 0, 0, 0];
  if (value.isVector2 || value.isVector3 || value.isVector4) {
    const n = value.isVector2 ? 2 : value.isVector3 ? 3 : 4;
    return [value.x, value.y, value.z ?? 0, value.w ?? 0].slice(0, n).concat(
      Array(Math.max(0, 4 - n)).fill(0));
  }
  if (value.isColor) return [value.r, value.g, value.b, 1];
  if (value.isMatrix3 || value.isMatrix4) return [0, 0, 0, 0];
  return [0, 0, 0, 0];
}

// u_user packing cursor: vec4 slots, components packed without crossing.
function g3UniformSlot(slot, comp, n) {
  const sw = c => G3_SWZ[c];
  if (n === 4) return `u_user[${slot}]`;
  if (n === 1) return `u_user[${slot}].${sw(comp)}`;
  let out = `u_user[${slot}].`;
  for (let i = 0; i < n; i++) out += sw(comp + i);
  return out;
}

// Decode a packed custom attribute into a GLSL expression of `type`.
function g3DecodeAttr(name, type) {
  const n = { float: 1, int: 1, bool: 1, vec2: 2, vec3: 3, vec4: 4 }[type] || 4;
  const reg = customAttrRegistry.get(name);
  if (!reg) return `${type}(0.0)`;
  const count = Math.min(n, reg.itemSize, reg.slots.length * 2);
  const comps = [];
  for (let i = 0; i < count; i++) {
    const slot = reg.slots[i >> 1];
    const v = slot === 0 ? 'v_uv' : `v_uv${slot}`;
    comps.push(`${v}.${i & 1 ? 'y' : 'x'}`);
  }
  while (comps.length < n) comps.push('0.0');
  if (n === 1) return comps[0];
  return `${type}(${comps.join(',')})`;
}

// Map a vertex-side assignment RHS (position/normal/attribute name) to a
// fragment-side expression for a varying of `type`.
function g3VaryingExpr(rhs, type, assignSwizzle) {
  let base;
  if (rhs === 'position') base = 'v_obj_pos';
  else if (rhs === 'normal') base = 'v_obj_normal';
  else if (rhs === 'normalMatrix') base = 'v_view_normal_matrix';
  else if (rhs === 'uv') base = 'v_uv';
  else if (/^uv[1-7]$/.test(rhs)) base = `v_uv${rhs.slice(2)}`;
  else if (rhs && customAttrRegistry.has(rhs)) base = g3DecodeAttr(rhs, type);
  else if (rhs === 'color') base = type === 'float' ? 'v_color.r' : type === 'vec2' ? 'v_color.rg' : type === 'vec3' ? 'v_color.rgb' : 'v_color';
  else base = `${type}(0.0)`;
  // Swizzle carried over from the vertex assignment (e.g. attr.xy).
  if (assignSwizzle && /^[xyzwrgba]{2,4}$/.test(assignSwizzle)) {
    const clean = assignSwizzle.replace(/[^xyzw]/g, '');
    if (clean.length >= 2 && (type === 'vec2' || type === 'vec3' || type === 'vec4')) {
      return `(${base}).${clean.slice(0, { vec2: 2, vec3: 3, vec4: 4 }[type])}`;
    }
  }
  return base;
}

// Identifier rewrites inside injected chunk bodies. Locals declared in the
// body prelude shadow three's globals, so only names without locals need
// textual substitution.
const G3_BODY_SUBS = [
  [/\breflectedLight\.indirectSpecular\b/g, 'g3_indirect_specular'],
  [/\breflectedLight\.directSpecular\b/g, 'g3_direct_specular'],
  [/\breflectedLight\.indirectDiffuse\b/g, 'ao'],
  [/\breflectedLight\.directDiffuse\b/g, 'g3_direct_diffuse'],
  [/\breflectedLight\.total\b/g, 'g3_reflected_total'],
  [/\bclearcoatSpecularIndirect\b/g, 'g3_clearcoat_spec_indirect'],
  [/\bgl_FragColor\.rgb\b/g, 'col'],
  [/\bgl_FragColor\.a\b/g, 'alpha'],
  [/\bgl_FragColor\b/g, 'vec4(col,alpha)'],
];

function g3TranslateBody(src) {
  let out = src;
  for (const [re, rep] of G3_BODY_SUBS) out = out.replace(re, rep);
  return out;
}

// The G3Material struct mirrors the engine's resolved material inputs.
const G3_MATERIAL_STRUCT = `
struct G3Material {
  float clearcoat; float clearcoatRoughness;
  vec3 specularColor; vec3 specularF90;
  vec3 sheenColor; float sheenRoughness;
  float roughness; float metalness;
  vec3 color; vec3 specular; vec3 emissive;
  float ior; float opacity; float alpha; vec3 diffuse;
  float reflectivity; float sheen; float envMapIntensity;
};
struct G3ReflectedLight {
  vec3 indirectDiffuse; vec3 indirectSpecular;
  vec3 directDiffuse; vec3 directSpecular; vec3 total;
};`;

function ensureObcMaterial(engine, material) {
  if (!material || typeof material.onBeforeCompile !== 'function') return;
  if (typeof engine._g3_host_material_shader_create !== 'function') return;
  // The callback is cheap enough to run per material per frame; the parsed
  // plan is cached and only rebuilt when the uniform set or the custom
  // attribute registry changes.
  const fake = {
    uniforms: {},
    vertexShader: g3ChunkTemplate(G3_VERT_CHUNKS),
    fragmentShader: g3ChunkTemplate(G3_FRAG_CHUNKS),
  };
  material.onBeforeCompile(fake);
  const uniformKey = Object.keys(fake.uniforms).sort().join('|') + '#' + customAttrRegistryVersion;
  let plan = material._obcPlan;
  if (!plan || plan.uniformKey !== uniformKey) {
    plan = g3BuildObcPlan(material, fake, uniformKey);
    material._obcPlan = plan;
    // Texture side effects: sampler2D uniforms ride the emissive-map slot
    // (emissive colour is black for these materials, so the engine's own
    // emissive term stays zero); sampler3D uniforms ride u_lut.
    for (const t of plan.textureAssigns) {
      if (t.kind === 'sampler2D') {
        if (material.emissiveMap && material.emissiveMap !== t.texture) {
          console.warn('gs3d: onBeforeCompile sampler2D uniform', t.name,
            'shares the emissiveMap slot; additional samplers are unsupported');
        } else material.emissiveMap = t.texture;
      }
      if (t.kind === 'sampler3D') material.lutTexture = t.texture;
    }
  }
  material.customShader = plan.shader;
  material.customUniforms = undefined;
}

function g3BuildObcPlan(material, fake, uniformKey) {
  const vsrc = g3SplitChunks(String(fake.vertexShader || ''));
  const fsrc = g3SplitChunks(String(fake.fragmentShader || ''));

  // Vertex varying declarations and begin_vertex assignments.
  const vDecls = new Map(); // name -> type
  for (const m of vsrc.prelude.matchAll(/varying\s+(?:lowp\s+|mediump\s+|highp\s+)?(\w+)\s+(\w+)\s*;/g)) {
    vDecls.set(m[2], m[1]);
  }
  const assignMap = new Map(); // varying name -> {rhs, swizzle}
  for (const ch of vsrc.chunks) {
    if (ch.name !== 'begin_vertex') continue;
    for (const m of ch.body.matchAll(/([A-Za-z_]\w*)\s*=\s*([A-Za-z_]\w*)((?:\.[xyzwrgba]+)?)\s*;/g)) {
      assignMap.set(m[1], { rhs: m[2], swizzle: m[3] ? m[3].slice(1) : '' });
    }
  }

  // Fragment prelude: strip varying/uniform declarations, keep the rest
  // (structs and helper functions) as global-scope header code.
  const fVaryings = new Map(); // name -> type
  const uniforms = []; // {name,type,decl}
  let headerCode = '';
  {
    let rest = fsrc.prelude;
    rest = rest.replace(/varying\s+(?:lowp\s+|mediump\s+|highp\s+)?(\w+)\s+(\w+)\s*;/g,
      (_m, type, name) => { fVaryings.set(name, type); return ''; });
    rest = rest.replace(/uniform\s+(?:lowp\s+|mediump\s+|highp\s+)?(\w+)\s+(\w+)\s*;/g,
      (_m, type, name) => { uniforms.push({ name, type }); return ''; });
    headerCode = rest;
  }

  // Classify uniforms: samplers bind textures, scalars pack into u_user.
  const defines = ['#define texture2D texture', '#define saturate(x) clamp((x), 0.0, 1.0)', '#define USE_SHEEN 1',
    '#define USE_CLEARCOAT 1', '#define USE_ENVMAP 1',
    '#define viewMatrix u_view', '#define cameraPosition u_eye'];
  const uniformPlan = [];
  const textureAssigns = [];
  const uniformKeyParts = [];
  let slot = 0, comp = 0;
  let sampler2DUsed = false;
  for (const u of uniforms) {
    const value = fake.uniforms[u.name];
    uniformKeyParts.push(u.name + ':' + u.type);
    if (u.type === 'sampler2D' || u.type === 'sampler3D' || u.type === 'samplerCube' || u.type === 'sampler2DShadow') {
      const tex = value && value.value;
      if (u.type === 'sampler3D' && tex && tex.isData3DTexture) {
        defines.push(`#define ${u.name} u_lut`);
        textureAssigns.push({ kind: 'sampler3D', name: u.name, texture: tex });
      } else if (u.type === 'sampler2D' && tex && !sampler2DUsed) {
        sampler2DUsed = true;
        defines.push(`#define ${u.name} u_emissive_tex`);
        textureAssigns.push({ kind: 'sampler2D', name: u.name, texture: tex });
      } else {
        defines.push(`#define ${u.name} u_emissive_tex`);
      }
      continue;
    }
    const n = g3UniformSize(u.type);
    if (!n) continue;
    if (comp + n > 4) { slot++; comp = 0; }
    if (slot >= 8) continue; // u_user exhausted; uniform reads as undefined
    const expr = g3UniformSlot(slot, comp, n);
    defines.push(`#define ${u.name} ${u.type === 'int' || u.type === 'bool' ? `${u.type}(${expr})` : expr}`);
    uniformPlan.push({ name: u.name, type: u.type, slot, comp, n, src: value });
    comp += n;
    if (comp === 4) { slot++; comp = 0; }
  }

  // Varying defines: fragment-declared varyings map to engine ins.
  for (const [name, type] of fVaryings) {
    const vtype = vDecls.get(name) || type;
    const assign = assignMap.get(name);
    let expr;
    if (name === 'vColor') expr = type === 'vec4' ? 'v_color' : type === 'vec3' ? 'v_color.rgb' : type === 'vec2' ? 'v_color.rg' : 'v_color.r';
    else if (name === 'vUv' || name === 'vUV') expr = type === 'vec3' ? 'vec3(v_uv,0.0)' : 'v_uv';
    else expr = g3VaryingExpr(assign ? assign.rhs : null, vtype || type, assign && assign.swizzle);
    defines.push(`#define ${name} ${expr}`);
  }

  // Route chunk bodies: output-stage chunks go to the tail.
  const bodyParts = [], tailParts = [];
  for (const ch of fsrc.chunks) {
    // Three initializes PhysicalMaterial from the map factors at this chunk.
    // Preserve that pipeline step before user edits to the material struct.
    if (ch.name === 'lights_physical_fragment') {
      bodyParts.push('material.roughness = roughnessFactor; material.metalness = metalnessFactor;');
    }
    if (!ch.body.trim()) continue;
    (G3_TAIL_CHUNKS.has(ch.name) ? tailParts : bodyParts).push(g3TranslateBody(ch.body));
  }

  // Body prelude: three-compatible locals, then the write-back epilogue.
  const prelude = `
    vec3 vViewPosition = -(u_view * vec4(v_world, 1.0)).xyz;
    vec3 geometryViewDir = normalize(vViewPosition);
    vec3 geometryPosition = vViewPosition;
    vec3 geometryNormal = mat3(u_view) * n;
    vec3 normal = mat3(u_view) * n;
    vec4 diffuseColor = vec4(base, 1.0);
    float roughnessFactor = mr.y;
    float metalnessFactor = mr.x;
    vec3 totalEmissiveRadiance = g3_emissive_extra;
    G3Material material = G3Material(
      coat_factor, coat_roughness, specular_color, f0, sheen_color, sheen_roughness,
      mr.y, mr.x, vec3(base), specular_color, u_emissive.rgb, u_pbr.w, alpha, alpha, base, 0.0, 0.0, 1.0);
    float g3_indirect_specular = 1.0;
    float g3_direct_specular = 1.0;
    float g3_direct_diffuse = 1.0;
    float g3_reflected_total = 1.0;
    float g3_clearcoat_spec_indirect = 1.0;
`;
  const epilogue = `
    n = transpose(mat3(u_view)) * normal;
    base = diffuseColor.rgb;
    coat_factor = material.clearcoat; coat_roughness = material.clearcoatRoughness;
    specular_color = material.specularColor; f0 = material.specularF90;
    sheen_color = material.sheenColor; sheen_roughness = material.sheenRoughness;
    mr.y = material.roughness; mr.x = material.metalness;
    g3_emissive_extra = totalEmissiveRadiance;
`;

  const header = defines.join('\n') + '\n' + G3_MATERIAL_STRUCT + '\n' +
    'float computeSpecularOcclusion(float dotNV, float occlusion, float roughness) { return occlusion; }\n' +
    headerCode;
  const body = prelude + bodyParts.join('\n') + epilogue;
  const tail = tailParts.join('\n');
  return {
    shader: { header, body, tail },
    uniformPlan,
    textureAssigns,
    uniformKey,
  };
}

// Live-sync u_user slots from the shared three uniform objects. Called once
// per material per frame through ensureMaterial; unchanged vec4 slots skip
// the engine call.
function syncObcUniforms(engine, material, id) {
  const plan = material && material._obcPlan;
  if (!plan || !plan.uniformPlan.length) return;
  if (!plan.last) plan.last = new Float32Array(32).fill(NaN);
  const next = plan.next || (plan.next = new Float32Array(32));
  next.fill(0);
  for (const u of plan.uniformPlan) {
    const f = g3UniformFloats(u.src && u.src.value);
    const base = u.slot * 4 + u.comp;
    for (let i = 0; i < u.n; i++) next[base + i] = f[i];
  }
  for (let i = 0; i < 8; i++) {
    const o = i * 4;
    if (next[o] === plan.last[o] && next[o + 1] === plan.last[o + 1] &&
        next[o + 2] === plan.last[o + 2] && next[o + 3] === plan.last[o + 3]) continue;
    engine._g3_asset_material_user(id, i, next[o], next[o + 1], next[o + 2], next[o + 3]);
    plan.last[o] = next[o]; plan.last[o + 1] = next[o + 1];
    plan.last[o + 2] = next[o + 2]; plan.last[o + 3] = next[o + 3];
  }
}

function ensureMaterial(engine, material) {
  if (material && material.isShaderMaterial) {
    const id = ensureRawMaterial(engine, material);
    if (frameMaterialCache) frameMaterialCache.set(material, id);
    return id;
  }
  if (!material) {
    // A shared fallback keeps material-less meshes from allocating a new
    // engine material (and leaking the old one) on every frame.
    fallbackMaterial ??= new MeshBasicMaterial();
    material = fallbackMaterial;
  }
  if (frameMaterialCache) {
    const hit = frameMaterialCache.get(material);
    if (hit !== undefined) { syncObcUniforms(engine, material, hit); return hit; }
  }
  // onBeforeCompile runs once per material per frame (the frame cache above
  // dedupes meshes sharing it); the parsed plan itself is cached on the
  // material and only rebuilt when uniforms or attribute slots change.
  if (material && typeof material.onBeforeCompile === 'function') {
    ensureObcMaterial(engine, material);
  }
  const maps = materialMaps(material);
  const textureIds = maps.map(t => t ? ensureTexture(engine, t) : -1);
  const lutTextureId = material.lutTexture ? ensureTexture3D(engine, material.lutTexture) : -1;
  const signature = materialSignature(material) + '|tex:' + textureIds.join(',') +
    '|lut:' + lutTextureId +
    '|' + maps.map(t => t ? textureUvSignature(t) : '-').join(';');
  const state = materialStates.get(material);
  if (state && state.signature === signature) {
    syncObcUniforms(engine, material, state.id);
    if (frameMaterialCache) frameMaterialCache.set(material, state.id);
    return state.id;
  }
  if (state) engine._g3_asset_release_material(state.id, state.generation);

  const color = material.color || new Color(0xffffff);
  const opacity = material.opacity ?? 1;
  const alphaMode = material.transparent || opacity < 1 ? ALPHA_BLEND : material.alphaTest > 0 ? ALPHA_MASK : ALPHA_OPAQUE;
  const alphaCutoff = material.alphaTest > 0 ? material.alphaTest : 0.5;
  const unlit = material.isMeshBasicMaterial || material.isMeshNormalMaterial ? 1 : 0;
  const metallic = material.metalness ?? (unlit ? 0 : 0);
  const roughness = material.roughness ?? 1;
  const emissive = material.emissive || new Color(0);
  const emissiveStrength = material.emissiveIntensity ?? 1;
  const normalScale = material.normalScale;
  const normalScaleValue = normalScale instanceof Vector2 ? normalScale.x : (normalScale ?? 1);
  const id = engine._g3_asset_material(
    color.r, color.g, color.b, opacity, textureIds[0], alphaMode, alphaCutoff,
    metallic, roughness, textureIds[1], textureIds[2], normalScaleValue, textureIds[3],
    material.aoMapIntensity ?? 1,
    emissive.r * emissiveStrength, emissive.g * emissiveStrength, emissive.b * emissiveStrength, textureIds[4],
    material.side === DoubleSide ? 1 : 0, unlit, material.ior ?? 1.5,
  );
  for (let slot = 0; slot < maps.length; slot++) {
    const texture = maps[slot];
    if (texture && textureIds[slot] >= 0) {
      engine._g3_asset_material_uv_transform(id, slot,
        texture.offset.x, texture.offset.y,
        texture.repeat.x, texture.repeat.y, texture.rotation, texture.channel || 0);
    }
  }
  if (!unlit && typeof engine._g3_asset_material_environment === 'function') {
    engine._g3_asset_material_environment(id, material.envMapIntensity ?? 1);
  }
  if (!unlit) {
    // Dielectric F0 of about 0.04 matches three.js's standard-material sheen.
    engine._g3_asset_material_specular(id, 0.04, 1, 1, 1, -1, -1);
  }
  const customShader = material.customShader;
  if (customShader && typeof engine._g3_host_material_shader_create === 'function') {
    let shaderId = customShaderIds.get(customShader);
    if (shaderId === undefined) {
      const upload = text => {
        const bytes = new TextEncoder().encode(text || '');
        const ptr = engine._malloc(bytes.length);
        engine.HEAPU8.set(bytes, ptr);
        return [ptr, bytes.length];
      };
      const header = upload(customShader.header);
      const body = upload(customShader.body);
      const tail = upload(customShader.tail);
      try {
        shaderId = engine._g3_host_material_shader_create(header[0], header[1], body[0], body[1], tail[0], tail[1]);
      } finally {
        engine._free(header[0]);
        engine._free(body[0]);
        engine._free(tail[0]);
      }
      customShaderIds.set(customShader, shaderId);
    }
    if (shaderId >= 0) engine._g3_asset_material_set_shader(id, shaderId);
  }
  if (lutTextureId >= 0 && typeof engine._g3_asset_material_lut === 'function') {
    engine._g3_asset_material_lut(id, lutTextureId);
  }
  const customUniforms = material.customUniforms;
  if (customUniforms && typeof engine._g3_asset_material_user === 'function') {
    for (let i = 0; i < 8; i++) {
      engine._g3_asset_material_user(id, i,
        customUniforms[i * 4] ?? 0, customUniforms[i * 4 + 1] ?? 0,
        customUniforms[i * 4 + 2] ?? 0, customUniforms[i * 4 + 3] ?? 0);
    }
  }
  syncObcUniforms(engine, material, id);
  const record = { id, generation: engine._g3_asset_material_generation(id), signature };
  materialStates.set(material, record);
  if (frameMaterialCache) frameMaterialCache.set(material, id);
  return id;
}

/* --- sync ---------------------------------------------------------------------- */

function syncNode(engine, object, parentEngineIndex, local) {
  const isMesh = object.isMesh === true;
  const material = isMesh ? (Array.isArray(object.material) ? object.material[0] : object.material) : null;
  const meshId = isMesh ? ensureGeometry(engine, object.geometry,
    !!(material && material.vertexColors), !!(material && material.flatShading), material) : -1;
  let record = nodeStates.get(object);
  if (record && (record.parent !== parentEngineIndex || record.mesh !== meshId)) {
    releaseNodeRecord(record);
    nodeStates.delete(object);
    record = undefined;
  }
  if (!record) {
    const index = engine._g3_asset_node(meshId, parentEngineIndex);
    record = { index, generation: engine._g3_asset_node_generation(index),
      epoch: engine._g3_asset_scene_epoch(), parent: parentEngineIndex, mesh: meshId,
      material: -1, matrix: null };
    nodeStates.set(object, record);
  }
  if (isMesh) {
    const materialId = ensureMaterial(engine, material);
    if (record.material !== materialId) {
      engine._g3_asset_node_material(record.index, materialId);
      record.material = materialId;
    }
  }
  if (!record.matrix || !matricesEqual(record.matrix, local)) {
    for (let i = 0; i < 16; i++) engine._g3_asset_matrix(record.index, i, local[i]);
    record.matrix = Float64Array.from(local);
  }
  return record.index;
}

function matricesEqual(a, b) {
  for (let i = 0; i < 16; i++) if (a[i] !== b[i]) return false;
  return true;
}

function lightWorldPose(object) {
  const world = worldMatrixOf(object);
  const position = transformPoint(world, 0, 0, 0);
  return { world, position };
}

function targetWorldPosition(light) {
  const target = light.target;
  if (!target) return [0, 0, 0];
  return transformPoint(worldMatrixOf(target), 0, 0, 0);
}

function collectLights(scene) {
  const result = { ambient: [0, 0, 0], hemisphere: null, lights: [] };
  const walk = (object, visible) => {
    const effective = visible && object.visible !== false;
    if (!effective) return;
    if (object.isLight) {
      const intensity = object.intensity ?? 1;
      const color = object.color || new Color(0xffffff);
      const scaled = [color.r * intensity, color.g * intensity, color.b * intensity];
      if (object.isAmbientLight) {
        result.ambient[0] += scaled[0]; result.ambient[1] += scaled[1]; result.ambient[2] += scaled[2];
      } else if (object.isHemisphereLight) {
        result.hemisphere = { sky: [color.r, color.g, color.b],
          ground: [object.groundColor.r, object.groundColor.g, object.groundColor.b], intensity };
      } else if (result.lights.length < MAX_EXTRA_LIGHTS) {
        const { position } = lightWorldPose(object);
        if (object.isDirectionalLight) {
          const target = targetWorldPosition(object);
          const delta = [target[0] - position[0], target[1] - position[1], target[2] - position[2]];
          result.lights.push({ kind: 'directional', direction: normalize3(delta), color: scaled,
            source: object, position, target });
        } else if (object.isPointLight) {
          result.lights.push({ kind: 'point', position, color: scaled, range: object.distance || 0 });
        } else if (object.isSpotLight) {
          const target = targetWorldPosition(object);
          const delta = [target[0] - position[0], target[1] - position[1], target[2] - position[2]];
          result.lights.push({ kind: 'spot', position, direction: normalize3(delta), color: scaled,
            range: object.distance || 0,
            inner: Math.max(0.0001, object.angle * (1 - (object.penumbra ?? 0))), outer: object.angle });
        }
      }
    }
    for (const child of object.children) walk(child, effective);
  };
  walk(scene, true);
  return result;
}

function shadowMapResolution(size) {
  const s = Math.max(size || 0, 0);
  return s >= 1024 ? 1024 : s >= 512 ? 512 : 256;
}

function shadowFilterRadius(type) {
  if (type === BasicShadowMap) return 0;
  if (type === PCFSoftShadowMap || type === VSMShadowMap) return 2;
  return 1;
}

// The engine has a single directional shadow map, so the shadow-casting
// directional light is routed to the primary light slot and its ortho
// camera collapses into one world-space box. The box's half extent must
// cover the frustum horizontally and reach upstream to the light itself
// (the shadow camera sits 2*extent behind the target and sees extent*4
// deep), so light distance and ortho bounds share one number. Every mesh
// inside the box casts and receives; per-object flags are accepted for
// API compatibility but only light.castShadow selects the caster.
function syncKeyLight(engine, light, renderer) {
  if (typeof engine._g3_asset_light_key !== 'function') return;
  if (!light) {
    // No facade key light: restore the engine's default key and drop shadows.
    engine._g3_asset_light_key(-0.45, -0.8, -0.4, 1.0, 0.96, 0.88);
    engine._g3_asset_light_key_shadow_clear();
    return;
  }
  engine._g3_asset_light_key(light.direction[0], light.direction[1], light.direction[2],
    light.color[0], light.color[1], light.color[2]);
  const shadow = light.source.shadow || {};
  const camera = shadow.camera || {};
  const halfWidth = Math.max(0, ((camera.right ?? 5) - (camera.left ?? -5)) / 2);
  const halfHeight = Math.max(0, ((camera.top ?? 5) - (camera.bottom ?? -5)) / 2);
  const distance = Math.hypot(
    light.position[0] - light.target[0],
    light.position[1] - light.target[1],
    light.position[2] - light.target[2]);
  const extent = Math.max(halfWidth, halfHeight, distance / 2 + 1);
  // normalBias is a world-space offset; the shadow camera's depth range is
  // extent*4, so the same offset is that much smaller in depth units.
  const bias = Math.max(0, shadow.bias ?? 0) + Math.max(0, shadow.normalBias ?? 0) / (extent * 4);
  engine._g3_asset_light_key_shadow(light.target[0], light.target[1], light.target[2], extent, bias);
  if (typeof engine._g3_asset_shadow_resolution === 'function') {
    const size = Math.max(shadow.mapSize?.x ?? 512, shadow.mapSize?.y ?? 512);
    engine._g3_asset_shadow_resolution(shadowMapResolution(size));
  }
  if (typeof engine._g3_asset_shadow_filter_radius === 'function') {
    engine._g3_asset_shadow_filter_radius(shadowFilterRadius(renderer?.shadowMap?.type));
  }
}

function syncLights(engine, collected, renderer) {
  engine._g3_asset_lights_clear();
  const shadowsOn = !!(renderer && renderer.shadowMap && renderer.shadowMap.enabled);
  let keyLight = null;
  for (const light of collected.lights) {
    if (light.kind === 'directional' && shadowsOn && !keyLight && light.source && light.source.castShadow) {
      keyLight = light;
      continue;
    }
    if (light.kind === 'directional') engine._g3_asset_light_directional(...light.direction, ...light.color);
    else if (light.kind === 'point') engine._g3_asset_light_point(...light.position, ...light.color, light.range);
    else engine._g3_asset_light_spot(...light.position, ...light.direction, ...light.color,
      light.range, light.inner, light.outer);
  }
  engine._g3_asset_ambient(collected.ambient[0], collected.ambient[1], collected.ambient[2], 1);
  if (collected.hemisphere) {
    const h = collected.hemisphere;
    engine._g3_asset_environment_lighting(h.sky[0], h.sky[1], h.sky[2],
      h.ground[0], h.ground[1], h.ground[2], h.intensity);
  } else {
    engine._g3_asset_environment_lighting(0, 0, 0, 0, 0, 0, 0);
  }
  syncKeyLight(engine, keyLight, renderer);
}

function syncBackground(engine, scene, renderer) {
  const background = scene.background;
  if (background && background.isColor) {
    engine._g3_asset_background(background.r, background.g, background.b, 1);
  } else if (renderer._clearColor) {
    engine._g3_asset_background(renderer._clearColor.r, renderer._clearColor.g, renderer._clearColor.b, renderer._clearAlpha ?? 1);
  } else {
    engine._g3_asset_background(0, 0, 0, 1);
  }
}

function syncFog(engine, scene) {
  const fog = scene.fog;
  if (fog && fog.isFogExp2) {
    engine._g3_asset_fog(fog.color.r, fog.color.g, fog.color.b, fog.density);
  } else if (fog && fog.isFog) {
    // The engine fog is exponential; a linear Fog maps approximately with a
    // density derived from its range.
    const density = fog.far > fog.near ? 2.5 / (fog.far - fog.near) : 0;
    engine._g3_asset_fog(fog.color.r, fog.color.g, fog.color.b, density);
  } else {
    engine._g3_asset_fog(0, 0, 0, 0);
  }
}

// scene.environment is an equirectangular texture in the engine; three.js
// also accepts it directly for PMREM-processed environments, which we pass
// through unchanged.
function syncEnvironment(engine, scene) {
  const env = scene.environment;
  if (env && env.isTexture) {
    const id = ensureTexture(engine, env);
    if (id >= 0) engine._g3_asset_environment_map(id, scene.environmentIntensity ?? 1);
  } else {
    engine._g3_asset_environment_map(-1, 0);
  }
  if (typeof engine._g3_asset_environment_rotation === 'function') {
    engine._g3_asset_environment_rotation(scene.environmentRotation ?? 0);
  }
}

function syncCamera(engine, renderer, camera) {
  if (!camera || !camera.isCamera) return;
  const world = worldMatrixOf(camera);
  const position = transformPoint(world, 0, 0, 0);
  const forward = normalize3(transformDir(world, 0, 0, -1));
  const up = normalize3(transformDir(world, 0, 1, 0));
  const target = [position[0] + forward[0], position[1] + forward[1], position[2] + forward[2]];
  const aspect = camera.aspect > 0 ? camera.aspect : renderer._cssWidth / Math.max(1, renderer._cssHeight);
  let state = cameraStates.get(camera);
  if (!state) {
    const orthographic = camera.isOrthographicCamera ? 1 : 0;
    const fov = camera.isPerspectiveCamera ? camera.fov * DEG2RAD : 0.9;
    const orthoHeight = camera.isOrthographicCamera ? camera.top - camera.bottom : 0;
    const id = engine._g3_asset_camera_add(position[0], position[1], position[2],
      target[0], target[1], target[2], up[0], up[1], up[2],
      fov, aspect, orthographic, orthoHeight, camera.near, camera.far);
    if (id < 0) return;
    state = { id, selected: false, viewKey: '' };
    cameraStates.set(camera, state);
  }
  const orthographic = camera.isOrthographicCamera ? 1 : 0;
  const fov = camera.isPerspectiveCamera ? camera.fov * DEG2RAD : 0.9;
  const orthoHeight = camera.isOrthographicCamera ? camera.top - camera.bottom : 0;
  engine._g3_asset_camera_update(state.id,
    position[0], position[1], position[2], target[0], target[1], target[2],
    up[0], up[1], up[2], fov, aspect, orthographic, orthoHeight, camera.near, camera.far);
  if (!state.selected) {
    engine._g3_asset_camera_select(state.id);
    state.selected = true;
  }
  const vo = camera.view;
  const voKey = vo && vo.enabled
    ? [vo.fullWidth, vo.fullHeight, vo.offsetX, vo.offsetY, vo.width, vo.height].join(',')
    : '';
  if (state.viewKey !== voKey && typeof engine._g3_asset_camera_view_offset === 'function') {
    if (voKey) {
      engine._g3_asset_camera_view_offset(state.id,
        vo.fullWidth, vo.fullHeight, vo.offsetX, vo.offsetY, vo.width, vo.height);
    } else {
      engine._g3_asset_camera_view_offset(state.id, 0, 0, 0, 0, 0, 0);
    }
    state.viewKey = voKey;
  }
}

function syncSceneTree(scene, seen) {
  scene.updateMatrixWorld();
  const walk = (object, parentEngineIndex) => {
    // An invisible object hides its whole subtree, like three.js.
    if (object.visible === false) { releaseEngineTree(object); return; }
    let engineParent = parentEngineIndex;
    if (!object.isLight && !object.isCamera) {
      engineParent = syncNode(sharedEngine, object, parentEngineIndex, localMatrixOf(object));
      seen.add(object);
    }
    for (const child of object.children) walk(child, engineParent);
  };
  walk(scene, -1);
}

/* --- output settings ------------------------------------------------------------- */

export const NoColorSpace = 'none';
export const SRGBColorSpace = 'srgb';
export const LinearSRGBColorSpace = 'linear';
export const DisplayP3ColorSpace = 'display-p3';

export const NoToneMapping = 0;
export const LinearToneMapping = 1;
export const ReinhardToneMapping = 2;
export const CineonToneMapping = 3;
export const ACESFilmicToneMapping = 4;
export const CustomToneMapping = 5;
export const AgXToneMapping = 6;
export const NeutralToneMapping = 7;

export const BasicShadowMap = 0;
export const PCFShadowMap = 1;
export const PCFSoftShadowMap = 2;
export const VSMShadowMap = 3;

// Three.js tone-mapping constants mapped onto the engine's three modes.
const TONE_MODES = {
  0: 'none',   // NoToneMapping
  1: 'none',   // LinearToneMapping
  2: 'reinhard', // ReinhardToneMapping
  3: 'reinhard', // CineonToneMapping
  4: 'aces',   // ACESFilmicToneMapping
};

/* --- the renderer ------------------------------------------------------------------ */

export class WebGPURenderer {
  constructor(parameters = {}) {
    const canvas = parameters.canvas;
    if (!canvas || typeof canvas.getContext !== 'function') {
      throw new Error('gs3d: WebGPURenderer requires a canvas element');
    }
    this.domElement = canvas;
    this.isWebGPURenderer = true;
    this._enginePromise = null;
    this._engine = null;
    this._lightLease = -1;
    this._pixelRatio = 1;
    this._cssWidth = 0;
    this._cssHeight = 0;
    this._lastFrame = 0;
    this._animationLoop = null;
    this._raf = 0;
    this._disposed = false;
    this.backend = { isWebGPUBackend: false, isWebGLBackend: true };
    this.outputColorSpace = parameters.outputColorSpace ?? SRGBColorSpace;
    this.toneMapping = parameters.toneMapping ?? NoToneMapping;
    this.toneMappingExposure = parameters.toneMappingExposure ?? 1;
    // Advanced/testing hook: a prebuilt engine module (or promise of one)
    // replaces the bundled wasm loader. The browser path never sets this.
    this._engineOverride = parameters.engine ?? null;
    // autoUpdate/needsUpdate are accepted for API compatibility: the engine
    // re-renders the shadow map on every frame while it is enabled.
    this.shadowMap = { enabled: false, type: PCFShadowMap, autoUpdate: true, needsUpdate: true };
    this._captureTarget = -1;
    // Conservative stand-ins for the GL caps apps probe; the engine owns the
    // context, so these cannot be queried without a second getContext call.
    this.capabilities = { maxTextureSize: 8192, getMaxAnisotropy: () => 16 };
    this.setPixelRatio(parameters.pixelRatio ?? (typeof devicePixelRatio !== 'undefined' ? devicePixelRatio : 1));
    this._measure();
  }

  _measure() {
    const canvas = this.domElement;
    const rect = canvas.getBoundingClientRect ? canvas.getBoundingClientRect() : null;
    this._cssWidth = rect && rect.width > 0 ? rect.width : (canvas.clientWidth || canvas.width || 300);
    this._cssHeight = rect && rect.height > 0 ? rect.height : (canvas.clientHeight || canvas.height || 150);
  }

  setPixelRatio(value) {
    this._pixelRatio = Number.isFinite(value) && value > 0 ? value : 1;
    return this;
  }
  getPixelRatio() { return this._pixelRatio; }

  setSize(width, height, updateStyle = true) {
    this._cssWidth = width;
    this._cssHeight = height;
    const pw = Math.max(1, Math.round(width * this._pixelRatio));
    const ph = Math.max(1, Math.round(height * this._pixelRatio));
    this.domElement.width = pw;
    this.domElement.height = ph;
    if (updateStyle) {
      this.domElement.style.width = `${width}px`;
      this.domElement.style.height = `${height}px`;
    }
    if (this._engine) this._engine._g3_input_resize(pw, ph);
    return this;
  }
  getSize(target = new Vector2()) { target.set(this._cssWidth, this._cssHeight); return target; }

  setOutputColorSpace(space) { this.outputColorSpace = space; this._applyOutputSettings(); return this; }
  setToneMapping(mode) { this.toneMapping = mode; this._applyOutputSettings(); return this; }
  setClearColor(color, alpha = 1) {
    this._clearColor = color instanceof Color ? color : new Color(color);
    this._clearAlpha = alpha;
    return this;
  }

  _applyOutputSettings() {
    const engine = this._engine;
    if (!engine) return;
    const srgb = this.outputColorSpace === SRGBColorSpace ? 'srgb' : 'linear';
    try { engine._g3_asset_output_srgb(srgb === 'srgb' ? 1 : 0); } catch {}
    const mode = typeof this.toneMapping === 'number' ? (TONE_MODES[this.toneMapping] ?? 'none') : this.toneMapping;
    try { engine._g3_asset_tone_mapping(mode); engine._g3_asset_exposure(this.toneMappingExposure ?? 1); } catch {}
  }

  async init() {
    if (this._engine) return this._engine;
    this._enginePromise = this._enginePromise || (async () => {
      const engine = this._engineOverride
        ? await this._engineOverride
        : await createGoose3D({ locateFile: () => wasmUrl.href });
      sharedEngine = engine;
      const canvas = this.domElement;
      if (!canvas.id) canvas.id = `gs3d-${++engineCanvasSeq}`;
      if (typeof engine._g3_host_set_canvas === 'function') {
        const selector = `[id="${String(canvas.id).replace(/["\\]/g, '\\$&')}"]`;
        const bytes = new TextEncoder().encode(selector);
        const ptr = engine._malloc(bytes.length);
        engine.HEAPU8.set(bytes, ptr);
        engine._g3_host_set_canvas(ptr, bytes.length);
        engine._free(ptr);
      }
      if (!this._cssWidth || !this._cssHeight) this._measure();
      const pw = Math.max(1, Math.round(this._cssWidth * this._pixelRatio));
      const ph = Math.max(1, Math.round(this._cssHeight * this._pixelRatio));
      canvas.width = pw;
      canvas.height = ph;
      if (typeof engine._g3_host_start === 'function' && !engine._g3_host_start(pw, ph)) {
        throw new Error('gs3d: the engine could not start a WebGL2 context on this canvas');
      }
      this._lightLease = typeof engine._g3_asset_lights_begin === 'function' ? engine._g3_asset_lights_begin() : -1;
      this._applyOutputSettings();
      return engine;
    })();
    this._engine = await this._enginePromise;
    return this._engine;
  }

  render(scene, camera) {
    const engine = this._engine;
    if (!engine) throw new Error('gs3d: call init() before render()');
    const now = typeof performance !== 'undefined' ? performance.now() : Date.now();
    const dt = this._lastFrame ? Math.min((now - this._lastFrame) / 1000, 0.1) : 1 / 60;
    this._lastFrame = now;
    if (scene) {
      const collected = collectLights(scene);
      const seen = new Set();
      frameMaterialCache = new Map();
      try {
        syncSceneTree(scene, seen);
      } finally {
        frameMaterialCache = null;
      }
      // Release engine nodes owned by objects outside this scene.
      for (const object of syncedObjects) {
        if (!seen.has(object)) {
          const record = nodeStates.get(object);
          if (record) releaseNodeRecord(record);
          nodeStates.delete(object);
          syncedObjects.delete(object);
        }
      }
      for (const object of seen) syncedObjects.add(object);
      this._applyOutputSettings();
      syncBackground(engine, scene, this);
      syncFog(engine, scene);
      syncEnvironment(engine, scene);
      syncLights(engine, collected, this);
      camera.updateMatrixWorld();
      syncCamera(engine, this, camera);
    }
    const rt = this._captureTarget;
    if (rt >= 0 && engine._g3_asset_render_target_select) engine._g3_asset_render_target_select(rt);
    try {
      engine._g3_app_frame(dt);
    } finally {
      if (rt >= 0 && engine._g3_asset_render_target_select) engine._g3_asset_render_target_select(-1);
    }
  }

  setAnimationLoop(callback) {
    this._animationLoop = callback;
    if (this._raf) { cancelFrame(this._raf); this._raf = 0; }
    if (callback) {
      const tick = time => {
        if (this._animationLoop !== callback) return;
        callback(time);
        this._raf = requestFrame(tick);
      };
      this._raf = requestFrame(tick);
    }
    return this;
  }

  dispose() {
    if (this._disposed) return;
    this._disposed = true;
    this.setAnimationLoop(null);
    const engine = this._engine;
    if (engine) {
      if (this._lightLease >= 0) { try { engine._g3_asset_lights_release(this._lightLease); } catch {} }
      try { engine._g3_app_shutdown(); } catch {}
    }
    this._engine = null;
    this._enginePromise = null;
  }
}

// Vector2 is used only by getSize; keep it dependency-free.
export class Vector2 {
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

// three.js names the class WebGLRenderer; gs3d renders through WebGL2 behind
// the same API, so alias it for drop-in ports.
export const WebGLRenderer = WebGPURenderer;

/* --- environment capture --------------------------------------------------------
 * PMREMGenerator renders the scene into a cubemap and stitches it into the
 * equirectangular layout the engine's environment-map path expects. There is
 * no roughness-dependent prefiltering: the engine generates its own filtered
 * mips from the base equirect, which approximates PMREM for typical env scenes.
 * `sigma`/`near`/`far` follow three.js signatures; `options.size` sets the
 * equirect width (height = size/2), default 256. */

const ENV_FACES = [
  { f: [1, 0, 0], u: [0, 1, 0] },
  { f: [-1, 0, 0], u: [0, 1, 0] },
  { f: [0, 1, 0], u: [0, 0, -1] },
  { f: [0, -1, 0], u: [0, 0, 1] },
  { f: [0, 0, 1], u: [0, 1, 0] },
  { f: [0, 0, -1], u: [0, 1, 0] },
];

function envFaceBasis(face) {
  const f = face.f, up = face.u;
  // Camera looks down -Z toward f, so camera +Z (backward) is -f.
  const zx = -f[0], zy = -f[1], zz = -f[2];
  // xaxis = normalize(cross(up, zaxis))
  let xx = up[1] * zz - up[2] * zy, xy = up[2] * zx - up[0] * zz, xz = up[0] * zy - up[1] * zx;
  const xl = Math.hypot(xx, xy, xz) || 1;
  xx /= xl; xy /= xl; xz /= xl;
  // yaxis = cross(zaxis, xaxis)
  const yx = zy * xz - zz * xy, yy = zz * xx - zx * xz, yz = zx * xy - zy * xx;
  return { f, x: [xx, xy, xz], y: [yx, yy, yz] };
}

export class PMREMGenerator {
  constructor(renderer) { this.renderer = renderer; this._rt = -1; }

  fromEquirectangular(texture) {
    // Already equirectangular — pass through; the engine generates env mips.
    return { texture, dispose() {} };
  }

  fromScene(scene, sigma = 0, near = 0.1, far = 100, options = {}) {
    const renderer = this.renderer;
    const engine = renderer && renderer._engine;
    const size = options && options.size ? options.size : 256;
    const eqW = size, eqH = size >> 1;
    const face = Math.max(32, size >> 1);
    if (!engine || typeof engine._g3_asset_render_target_create !== 'function') {
      return { texture: new DataTexture(new Uint8Array(eqW * eqH * 4), eqW, eqH), dispose() {} };
    }
    const rt = engine._g3_asset_render_target_create(face, face);
    if (rt < 0) return { texture: new DataTexture(new Uint8Array(eqW * eqH * 4), eqW, eqH), dispose() {} };
    this._rt = rt;

    const bases = ENV_FACES.map(envFaceBasis);
    const faces = [];
    const prevTarget = renderer._captureTarget;
    try {
      for (const b of bases) {
        const cam = new PerspectiveCamera(90, 1, near, far);
        cam.position.set(0, 0, 0);
        cam.lookAt(new Vector3(b.f[0], b.f[1], b.f[2]));
        cam.updateMatrixWorld();
        renderer._captureTarget = rt;
        renderer.render(scene, cam);
        faces.push(readTargetPixels(engine, rt, face));
      }
    } finally {
      renderer._captureTarget = prevTarget;
    }

    const out = new Uint8Array(eqW * eqH * 4);
    // Trig tables keep the inner loop allocation-free: lambda per column,
    // phi per row, matching envTexelDir's equirect parameterization.
    const cosL = new Float64Array(eqW), sinL = new Float64Array(eqW);
    for (let i = 0; i < eqW; i++) {
      const l = ((i + 0.5) / eqW - 0.5) * 2 * Math.PI;
      cosL[i] = Math.cos(l); sinL[i] = Math.sin(l);
    }
    const sinP = new Float64Array(eqH), cosP = new Float64Array(eqH);
    for (let j = 0; j < eqH; j++) {
      const phi = (j + 0.5) / eqH * Math.PI;
      sinP[j] = Math.sin(phi); cosP[j] = Math.cos(phi);
    }
    for (let j = 0; j < eqH; j++) {
      const sp = sinP[j], cp = cosP[j];
      for (let i = 0; i < eqW; i++) {
        const dx = sp * cosL[i], dy = cp, dz = sp * sinL[i];
        // Nearest face; its forward dot is also the projection denominator.
        let k = 0, denom = -Infinity;
        for (let f = 0; f < 6; f++) {
          const dot = dx * bases[f].f[0] + dy * bases[f].f[1] + dz * bases[f].f[2];
          if (dot > denom) { denom = dot; k = f; }
        }
        const b = bases[k];
        const cx = (dx * b.x[0] + dy * b.x[1] + dz * b.x[2]) / denom;
        const cy = (dx * b.y[0] + dy * b.y[1] + dz * b.y[2]) / denom;
        const fx = Math.min(face - 1, Math.max(0, Math.floor((cx * 0.5 + 0.5) * face)));
        const fy = Math.min(face - 1, Math.max(0, Math.floor((0.5 - cy * 0.5) * face)));
        sampleFaceBilinear(faces[k], face, fx, fy, out, (j * eqW + i) * 4);
      }
    }
    const texture = new DataTexture(out, eqW, eqH);
    return { texture, dispose() { releaseTexture(texture); } };
  }

  dispose() {}
}

function readTargetPixels(engine, rt, size) {
  const bytes = size * size * 4;
  const ptr = engine._malloc(bytes);
  const buf = new Uint8Array(engine.HEAPU8.buffer, ptr, bytes);
  if (!engine._g3_host_render_target_read(rt, 0, 0, size, size, ptr, bytes)) {
    engine._free(ptr);
    throw new Error('gs3d: environment render target readback failed');
  }
  // Readback arrives bottom-up; flip to top-down for sampling.
  const out = new Uint8Array(bytes);
  for (let y = 0; y < size; y++) {
    out.set(buf.subarray((size - 1 - y) * size * 4, (size - y) * size * 4), y * size * 4);
  }
  engine._free(ptr);
  return out;
}

function sampleFaceBilinear(face, size, fx, fy, out, outOff) {
  const x0 = Math.max(0, fx - 0.5 | 0), y0 = Math.max(0, fy - 0.5 | 0);
  const x1 = Math.min(size - 1, x0 + 1), y1 = Math.min(size - 1, y0 + 1);
  const tx = Math.min(1, Math.max(0, fx - 0.5 - x0)), ty = Math.min(1, Math.max(0, fy - 0.5 - y0));
  const i00 = (y0 * size + x0) * 4, i10 = (y0 * size + x1) * 4;
  const i01 = (y1 * size + x0) * 4, i11 = (y1 * size + x1) * 4;
  for (let c = 0; c < 4; c++) {
    const top = face[i00 + c] * (1 - tx) + face[i10 + c] * tx;
    const bot = face[i01 + c] * (1 - tx) + face[i11 + c] * tx;
    out[outOff + c] = top * (1 - ty) + bot * ty;
  }
}

// Minimal stand-in for three's RoomEnvironment: a softbox-style env scene
// built from emissive planes, matching the look of the addon closely enough
// for image-based lighting.
export class RoomEnvironment extends Scene {
  constructor() {
    super();
    this.isRoomEnvironment = true;
    const box = (w, h, color, intensity, pos, look) => {
      const c = new Color(color);
      c.r *= intensity; c.g *= intensity; c.b *= intensity;
      const m = new Mesh(
        new PlaneGeometry(w, h),
        new MeshBasicMaterial({ color: c })
      );
      m.position.set(...pos);
      m.lookAt(new Vector3(...look));
      m.updateMatrixWorld();
      this.add(m);
    };
    // Ceiling light panel + a few wall/floor softboxes, roughly matching
    // three's RoomEnvironment layout.
    box(10, 10, 0xffffff, 5, [0, 4, 0], [0, 0, -1]);
    box(6, 3, 0xfff4e0, 3, [-4, 1, -3], [0, 1, 0]);
    box(4, 6, 0xe8f0ff, 2, [4, 0.5, -2], [0, 1, 0]);
    box(8, 4, 0xffffff, 1.5, [0, -3, 2], [0, 1, 0]);
    box(3, 3, 0xd0e8ff, 2, [-3, 2, 3], [0, 0, -1]);
    box(3, 3, 0xffe8d0, 1.5, [3, 2, 3], [0, 0, -1]);
    this.updateMatrixWorld();
  }
  dispose() {
    this.traverse(node => {
      node.geometry?.dispose?.();
      for (const material of Array.isArray(node.material) ? node.material : [node.material]) material?.dispose?.();
    });
  }
}
