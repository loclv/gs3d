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
// Deliberate subset: no textures, skinning, morph targets, shadows, fog
// objects beyond Fog/FogExp2 approximation, quaternion editing, or
// post-processing. The renderer class is named WebGPURenderer for API
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
}

/* --- vectors and transforms ---------------------------------------------- */

export class Vector3 {
  constructor(x = 0, y = 0, z = 0) { this.isVector3 = true; this.x = x; this.y = y; this.z = z; }
  set(x, y, z) { this.x = x; this.y = y; this.z = z; return this; }
  setScalar(s) { return this.set(s, s, s); }
  copy(v) { this.x = v.x; this.y = v.y; this.z = v.z; return this; }
  clone() { return new Vector3(this.x, this.y, this.z); }
  add(v) { this.x += v.x; this.y += v.y; this.z += v.z; return this; }
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
  setFromRotationMatrix() { return this; }
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
    this.matrixAutoUpdate = true;
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
  traverse(callback) {
    callback(this);
    for (const child of this.children) child.traverse(callback);
  }
  updateMatrixWorld(force) { return this; }
  updateMatrix() { return this; }
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
    const p = position.array, ps = position.itemSize;
    const index = this.index;
    const normals = new Float32Array(position.count * 3);
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
      for (let i = 0; i + 2 < position.count; i += 3) tri(i, i + 1, i + 2);
    }
    for (let i = 0; i < normals.length; i += 3) {
      const l = Math.hypot(normals[i], normals[i + 1], normals[i + 2]);
      if (l > 0) { normals[i] /= l; normals[i + 1] /= l; normals[i + 2] /= l; }
      else { normals[i] = 0; normals[i + 1] = 0; normals[i + 2] = 1; }
    }
    this.setAttribute('normal', new Float32BufferAttribute(normals, 3));
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

/* --- textures ------------------------------------------------------------------ */

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

export class DirectionalLight extends Light {
  constructor(color = 0xffffff, intensity = 1) {
    super(color, intensity);
    this.isDirectionalLight = true;
    this.target = new Object3D();
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
  updateMatrixWorld(force) { return this; }
}

export class OrthographicCamera extends Object3D {
  constructor(left = -1, right = 1, top = 1, bottom = -1, near = 0.1, far = 2000) {
    super();
    this.isCamera = true; this.isOrthographicCamera = true;
    this.left = left; this.right = right; this.top = top; this.bottom = bottom;
    this.near = near; this.far = far;
  }
  updateProjectionMatrix() { return this; }
  updateMatrixWorld(force) { return this; }
}

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
const cameraStates = new WeakMap();  // Camera -> engine camera id
const textureStates = new WeakMap(); // Texture -> {id,generation,signature}
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
  const state = byFlag && byFlag[flag];
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
  if (!image || !image.pixels || !image.pixels.length) return -1;

  const id = engine._g3_asset_texture();
  if (id < 0) return -1;
  const ptr = engine._malloc(image.pixels.length);
  if (!ptr) { engine._g3_asset_release_texture(id, engine._g3_asset_texture_generation(id)); return -1; }
  try {
    engine.HEAPU8.set(image.pixels instanceof Uint8Array || image.pixels instanceof Uint8ClampedArray
      ? image.pixels : new Uint8ClampedArray(image.pixels), ptr);
    const srgb = texture.colorSpace === SRGBColorSpace;
    if (srgb) engine._g3_host_texture_srgb(id, ptr, image.width, image.height);
    else engine._g3_host_texture(id, ptr, image.width, image.height);
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
  return composeLocal(object.position, resolvedQuaternion(object), object.scale);
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
  const src = geometry.attributes.position;
  const p = src.array, is = src.itemSize;
  const index = geometry.index && geometry.index.array;
  const triCount = index ? index.length / 3 : src.count / 3;
  const vertCount = triCount * 3;
  const positions = new Float32Array(vertCount * 3);
  const normals = new Float32Array(vertCount * 3);
  const uvs = [], colors = [];
  const uvAttr = geometry.attributes.uv || null;
  const colorAttr = geometry.attributes.color || null;
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

function ensureGeometry(engine, geometry, useVertexColors = false, flatShading = false) {
  if (!geometry || !geometry.attributes || !geometry.attributes.position) return -1;
  const flag = `${useVertexColors ? 1 : 0}${flatShading ? 1 : 0}`;
  const byFlag = geometryStates.get(geometry) || {};
  const state = byFlag[flag];
  if (state && state.version === geometry.version) return state.id;
  if (state) engine._g3_asset_release_mesh(state.id, state.generation);

  const src = flatShading ? flatShadedGeometry(geometry) : geometry;
  if (!src.attributes.normal) src.computeVertexNormals();
  const position = src.attributes.position;
  const normal = src.attributes.normal;
  const uvSets = [];
  for (let set = 0; set < 8; set++) {
    const attr = src.attributes[set === 0 ? 'uv' : `uv${set}`];
    uvSets.push(attr ? attr.array : null);
  }
  const color = useVertexColors ? src.attributes.color : null;
  const p = position.array, n = normal ? normal.array : null;
  const c = color ? color.array : null;
  const ns = normal ? normal.itemSize : 3, cs = color ? color.itemSize : 4;
  const uvAttrs = uvSets.map((arr, i) => arr ? src.attributes[i === 0 ? 'uv' : `uv${i}`] : null);
  const count = position.count;

  engine._g3_asset_mesh_begin();
  for (let i = 0; i < count; i++) {
    const pi = i * position.itemSize, ni = i * ns, ci = i * cs;
    const uvArgs = [];
    for (let set = 0; set < 8; set++) {
      const attr = uvAttrs[set];
      if (attr) {
        const ui = i * attr.itemSize;
        uvArgs.push(attr.array[ui] || 0, attr.array[ui + 1] || 0);
      } else uvArgs.push(0, 0);
    }
    engine._g3_asset_vertex(
      p[pi], p[pi + 1], p[pi + 2],
      n && ns > 0 ? n[ni] : 0, n && ns > 1 ? n[ni + 1] : 0, n && ns > 2 ? n[ni + 2] : 1,
      ...uvArgs,
      0, 0, 0, 0, // tangent
      c && cs > 0 ? c[ci] : 1, c && cs > 1 ? c[ci + 1] : 1, c && cs > 2 ? c[ci + 2] : 1,
      c && cs > 3 ? c[ci + 3] : 1,
    );
  }
  const index = src.index;
  if (index) {
    const ids = index.array;
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

function ensureMaterial(engine, material) {
  if (!material) material = new MeshBasicMaterial();
  const maps = materialMaps(material);
  const textureIds = maps.map(t => t ? ensureTexture(engine, t) : -1);
  const signature = materialSignature(material) + '|tex:' + textureIds.join(',') +
    '|' + maps.map(t => t ? textureUvSignature(t) : '-').join(';');
  const state = materialStates.get(material);
  if (state && state.signature === signature) return state.id;
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
  const record = { id, generation: engine._g3_asset_material_generation(id), signature };
  materialStates.set(material, record);
  return id;
}

/* --- sync ---------------------------------------------------------------------- */

function syncNode(engine, object, parentEngineIndex, local) {
  const isMesh = object.isMesh === true;
  const material = isMesh ? (Array.isArray(object.material) ? object.material[0] : object.material) : null;
  const meshId = isMesh ? ensureGeometry(engine, object.geometry,
    !!(material && material.vertexColors), !!(material && material.flatShading)) : -1;
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
          result.lights.push({ kind: 'directional', direction: normalize3(delta), color: scaled });
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

function syncLights(engine, collected) {
  engine._g3_asset_lights_clear();
  for (const light of collected.lights) {
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
    state = { id, selected: false };
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
}

function syncSceneTree(scene, seen) {
  const walk = (object, parentEngineIndex) => {
    // An invisible object hides its whole subtree, like three.js.
    if (object.visible === false) { releaseEngineTree(object); return; }
    const local = localMatrixOf(object);
    let engineParent = parentEngineIndex;
    if (!object.isLight && !object.isCamera) {
      engineParent = syncNode(sharedEngine, object, parentEngineIndex, local);
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
    this.shadowMap = { enabled: false };
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
      syncSceneTree(scene, seen);
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
      syncLights(engine, collected);
      syncCamera(engine, this, camera);
    }
    engine._g3_app_frame(dt);
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
}
