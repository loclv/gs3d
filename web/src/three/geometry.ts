import { Vector2, Vector3, Matrix4, Quaternion, invertMat4, normalize3 } from './math';
import { Box3, Sphere } from './bounds';
import { Object3D } from './scene';
import { MeshBasicMaterial } from './materials';
import { attrData, releaseGeometry } from './bridge';
import { EventDispatcher } from './events';

/* --- geometry -------------------------------------------------------------- */

export class BufferAttribute {
  isBufferAttribute: boolean;
  array: any;
  itemSize: number;
  normalized: boolean;
  count: number;
  updateRanges: Array<{ start: number; count: number }>;
  usage: number;
  version: number;
  gpuType: number;
  constructor(array: any, itemSize: number, normalized = false) {
    this.isBufferAttribute = true;
    this.array = array;
    this.itemSize = itemSize;
    this.normalized = normalized;
    this.count = array.length / itemSize;
    this.updateRanges = [];
    this.usage = 35044;
    this.version = 0;
    this.gpuType = 5126;
  }
  // three r180 exposes needsUpdate as a prototype setter that bumps version.
  set needsUpdate(v: boolean) { if (v) this.version++; }
  get needsUpdate() { return false; }
  addUpdateRange(start: number, count: number) { this.updateRanges.push({ start, count }); }
  clearUpdateRanges() { this.updateRanges.length = 0; }
  setUsage(usage: number) { this.usage = usage; return this; }
  onUpload(callback: Function) { (this as any)._onUpload = callback; return this; }
  onUploadCallback() { return this; }
  clone() {
    return new BufferAttribute(this.array.slice(), this.itemSize, this.normalized);
  }
  copy(source: BufferAttribute) {
    this.array = source.array.slice ? source.array.slice() : source.array;
    this.itemSize = source.itemSize;
    this.normalized = source.normalized;
    this.count = source.count;
    this.updateRanges = source.updateRanges.map(r => ({ ...r }));
    this.usage = source.usage;
    return this;
  }
  copyArray(array: any) {
    this.array.set ? this.array.set(array) : (this.array = array);
    this.needsUpdate = true;
    return this;
  }
  copyAt(index: number, array: any) {
    const o = index * this.itemSize;
    for (let i = 0; i < this.itemSize && o + i < this.array.length; i++) this.array[o + i] = array[i];
    this.needsUpdate = true;
    return this;
  }
  // --- component accessors ------------------------------------------------------
  _c(index: number, k: number) { return this.array[index * this.itemSize + k]; }
  getX(index: number) { return this._c(index, 0); }
  getY(index: number) { return this._c(index, 1); }
  getZ(index: number) { return this._c(index, 2); }
  getW(index: number) { return this._c(index, 3); }
  setX(index: number, v: number) { this.array[index * this.itemSize] = v; this.needsUpdate = true; return this; }
  setY(index: number, v: number) { this.array[index * this.itemSize + 1] = v; this.needsUpdate = true; return this; }
  setZ(index: number, v: number) { this.array[index * this.itemSize + 2] = v; this.needsUpdate = true; return this; }
  setW(index: number, v: number) { this.array[index * this.itemSize + 3] = v; this.needsUpdate = true; return this; }
  setXY(index: number, x: number, y: number) {
    const o = index * this.itemSize;
    this.array[o] = x; this.array[o + 1] = y; this.needsUpdate = true; return this;
  }
  setXYZ(index: number, x: number, y: number, z: number) {
    const o = index * this.itemSize;
    this.array[o] = x; this.array[o + 1] = y; this.array[o + 2] = z; this.needsUpdate = true; return this;
  }
  setXYZW(index: number, x: number, y: number, z: number, w: number) {
    const o = index * this.itemSize;
    this.array[o] = x; this.array[o + 1] = y; this.array[o + 2] = z; this.array[o + 3] = w;
    this.needsUpdate = true; return this;
  }
  getComponent(index: number, k: number) { return this._c(index, k); }
  setComponent(index: number, k: number, v: number) {
    this.array[index * this.itemSize + k] = v; this.needsUpdate = true; return this;
  }
  set(array: any, offset = 0) {
    for (let i = 0; i < this.count * this.itemSize && offset + i < array.length; i++)
      this.array[i] = array[offset + i];
    this.needsUpdate = true;
    return this;
  }
  // --- transforms ----------------------------------------------------------------
  applyMatrix3(m: any) {
    const e = m.elements || m;
    for (let i = 0; i < this.count; i++) {
      const o = i * this.itemSize;
      const x = this.array[o], y = this.array[o + 1], z = this.array[o + 2];
      this.array[o] = e[0] * x + e[3] * y + e[6] * z;
      this.array[o + 1] = e[1] * x + e[4] * y + e[7] * z;
      this.array[o + 2] = e[2] * x + e[5] * y + e[8] * z;
    }
    this.needsUpdate = true;
    return this;
  }
  applyMatrix4(m: any) {
    const e = m.elements || m;
    for (let i = 0; i < this.count; i++) {
      const o = i * this.itemSize;
      const x = this.array[o], y = this.array[o + 1], z = this.array[o + 2];
      const w = this.itemSize > 3 ? this.array[o + 3] : 1;
      this.array[o] = e[0] * x + e[4] * y + e[8] * z + e[12] * w;
      this.array[o + 1] = e[1] * x + e[5] * y + e[9] * z + e[13] * w;
      this.array[o + 2] = e[2] * x + e[6] * y + e[10] * z + e[14] * w;
      if (this.itemSize > 3) this.array[o + 3] = e[3] * x + e[7] * y + e[11] * z + e[15] * w;
    }
    this.needsUpdate = true;
    return this;
  }
  transformDirection(m: any) {
    const e = m.elements || m;
    for (let i = 0; i < this.count; i++) {
      const o = i * this.itemSize;
      const x = this.array[o], y = this.array[o + 1], z = this.array[o + 2];
      const nx = e[0] * x + e[4] * y + e[8] * z;
      const ny = e[1] * x + e[5] * y + e[9] * z;
      const nz = e[2] * x + e[6] * y + e[10] * z;
      const l = Math.hypot(nx, ny, nz) || 1;
      this.array[o] = nx / l; this.array[o + 1] = ny / l; this.array[o + 2] = nz / l;
    }
    this.needsUpdate = true;
    return this;
  }
  applyNormalMatrix(m: any) {
    // m is a 3x3 (row-major elements of length 9 or column-major 16).
    const e = m.elements || m;
    const n = e.length >= 16 ? 16 : 9;
    for (let i = 0; i < this.count; i++) {
      const o = i * this.itemSize;
      const x = this.array[o], y = this.array[o + 1], z = this.array[o + 2];
      let nx: number, ny: number, nz: number;
      if (n === 16) {
        nx = e[0] * x + e[4] * y + e[8] * z;
        ny = e[1] * x + e[5] * y + e[9] * z;
        nz = e[2] * x + e[6] * y + e[10] * z;
      } else {
        nx = e[0] * x + e[3] * y + e[6] * z;
        ny = e[1] * x + e[4] * y + e[7] * z;
        nz = e[2] * x + e[5] * y + e[8] * z;
      }
      const l = Math.hypot(nx, ny, nz) || 1;
      this.array[o] = nx / l; this.array[o + 1] = ny / l; this.array[o + 2] = nz / l;
    }
    this.needsUpdate = true;
    return this;
  }
  toJSON() {
    const a = this.array;
    return {
      itemSize: this.itemSize,
      type: a.constructor.name === 'Float32Array' ? 'Float32Array' :
        a.constructor.name === 'Uint16Array' ? 'Uint16Array' :
        a.constructor.name === 'Uint32Array' ? 'Uint32Array' : 'Float32Array',
      array: Array.from(a),
      normalized: this.normalized,
    };
  }
}
export class Float32BufferAttribute extends BufferAttribute {
  constructor(array, itemSize, normalized = false) { super(Float32Array.from(array), itemSize, normalized); }
  clone() { return new Float32BufferAttribute(this.array.slice(), this.itemSize, this.normalized); }
}
export class Uint16BufferAttribute extends BufferAttribute {
  constructor(array, itemSize, normalized = false) { super(Uint16Array.from(array), itemSize, normalized); }
  clone() { return new Uint16BufferAttribute(this.array.slice(), this.itemSize, this.normalized); }
}
export class Uint32BufferAttribute extends BufferAttribute {
  constructor(array, itemSize, normalized = false) { super(Uint32Array.from(array), itemSize, normalized); }
  clone() { return new Uint32BufferAttribute(this.array.slice(), this.itemSize, this.normalized); }
}

export class InterleavedBuffer {
  isInterleavedBuffer: boolean;
  array: any;
  stride: number;
  usage: number;
  updateRanges: Array<{ start: number; count: number }>;
  version: number;
  constructor(array: any, stride: number) {
    this.isInterleavedBuffer = true;
    this.array = array;
    this.stride = stride;
    this.usage = 35044;
    this.updateRanges = [];
    this.version = 0;
  }
  get needsUpdate() { return false; }
  set needsUpdate(v: boolean) { if (v) this.version++; }
  addUpdateRange(start: number, count: number) { this.updateRanges.push({ start, count }); }
  clearUpdateRanges() { this.updateRanges.length = 0; }
  setUsage(usage: number) { this.usage = usage; return this; }
  onUpload(callback: Function) { (this as any)._onUpload = callback; return this; }
  onUploadCallback() { return this; }
  copy(source: InterleavedBuffer) {
    this.array = source.array.slice ? source.array.slice() : source.array;
    this.stride = source.stride;
    this.usage = source.usage;
    return this;
  }
  clone() { return new InterleavedBuffer(this.array.slice(), this.stride); }
  copyAt(index: number, array: any) {
    const o = index * this.stride;
    for (let i = 0; i < this.stride && o + i < this.array.length; i++) this.array[o + i] = array[i];
    this.needsUpdate = true;
    return this;
  }
  set(array: any, offset = 0) {
    for (let i = 0; i < this.array.length && offset + i < array.length; i++) this.array[i] = array[offset + i];
    this.needsUpdate = true;
    return this;
  }
  toJSON() {
    return {
      isInterleavedBuffer: true,
      array: Array.from(this.array),
      stride: this.stride,
      type: this.array.constructor.name === 'Float32Array' ? 'Float32Array' :
        this.array.constructor.name === 'Uint16Array' ? 'Uint16Array' :
        this.array.constructor.name === 'Uint32Array' ? 'Uint32Array' : 'Float32Array',
    };
  }
}

// Strided view into an InterleavedBuffer; ensureGeometry deinterleaves it
// into a plain per-attribute array before packing engine vertices.
export class InterleavedBufferAttribute {
  isBufferAttribute: boolean;
  isInterleavedBufferAttribute: boolean;
  data: InterleavedBuffer;
  itemSize: number;
  offset: number;
  normalized: boolean;
  _count: number;
  version: number;
  constructor(data: InterleavedBuffer, itemSize: number, offset = 0, normalized = false) {
    this.isBufferAttribute = true;
    this.isInterleavedBufferAttribute = true;
    this.data = data;
    this.itemSize = itemSize;
    this.offset = offset;
    this.normalized = normalized;
    this._count = Math.max(0, Math.floor(data.array.length / data.stride));
    this.version = 0;
  }
  // Prototype accessors matching three r180 (backing store is the interleaved buffer).
  get array() { return this.data.array; }
  get count() { return this._count; }
  get needsUpdate() { return false; }
  set needsUpdate(v: boolean) { if (v) this.version++; }
  _o(index: number, k: number) { return index * this.data.stride + this.offset + k; }
  getX(i: number) { return this.array[this._o(i, 0)]; }
  getY(i: number) { return this.array[this._o(i, 1)]; }
  getZ(i: number) { return this.array[this._o(i, 2)]; }
  getW(i: number) { return this.array[this._o(i, 3)]; }
  setX(i: number, v: number) { this.array[this._o(i, 0)] = v; this.needsUpdate = true; return this; }
  setY(i: number, v: number) { this.array[this._o(i, 1)] = v; this.needsUpdate = true; return this; }
  setZ(i: number, v: number) { this.array[this._o(i, 2)] = v; this.needsUpdate = true; return this; }
  setW(i: number, v: number) { this.array[this._o(i, 3)] = v; this.needsUpdate = true; return this; }
  setXY(i: number, x: number, y: number) {
    this.array[this._o(i, 0)] = x; this.array[this._o(i, 1)] = y; this.needsUpdate = true; return this;
  }
  setXYZ(i: number, x: number, y: number, z: number) {
    this.array[this._o(i, 0)] = x; this.array[this._o(i, 1)] = y; this.array[this._o(i, 2)] = z;
    this.needsUpdate = true; return this;
  }
  setXYZW(i: number, x: number, y: number, z: number, w: number) {
    this.array[this._o(i, 0)] = x; this.array[this._o(i, 1)] = y;
    this.array[this._o(i, 2)] = z; this.array[this._o(i, 3)] = w;
    this.needsUpdate = true; return this;
  }
  getComponent(i: number, k: number) { return this.array[this._o(i, k)]; }
  setComponent(i: number, k: number, v: number) { this.array[this._o(i, k)] = v; this.needsUpdate = true; return this; }
  clone() { return new InterleavedBufferAttribute(this.data, this.itemSize, this.offset, this.normalized); }
  copy(source: InterleavedBufferAttribute) {
    this.data = source.data; this.itemSize = source.itemSize;
    this.offset = source.offset; this.normalized = source.normalized;
    this._count = source.count; return this;
  }
  // --- transforms (operate through the strided view) ------------------------------
  _each3(fn: (get: (k: number) => number, set: (k: number, v: number) => void) => void) {
    for (let i = 0; i < this.count; i++) {
      const o = i * this.data.stride + this.offset;
      fn(k => this.array[o + k], (k, v) => { this.array[o + k] = v; });
    }
    this.needsUpdate = true;
  }
  applyMatrix4(m: any) {
    const e = m.elements || m;
    this._each3((get, set) => {
      const x = get(0), y = get(1), z = get(2);
      const w = this.itemSize > 3 ? get(3) : 1;
      set(0, e[0] * x + e[4] * y + e[8] * z + e[12] * w);
      set(1, e[1] * x + e[5] * y + e[9] * z + e[13] * w);
      set(2, e[2] * x + e[6] * y + e[10] * z + e[14] * w);
      if (this.itemSize > 3) set(3, e[3] * x + e[7] * y + e[11] * z + e[15] * w);
    });
    return this;
  }
  transformDirection(m: any) {
    const e = m.elements || m;
    this._each3((get, set) => {
      const x = get(0), y = get(1), z = get(2);
      const nx = e[0] * x + e[4] * y + e[8] * z;
      const ny = e[1] * x + e[5] * y + e[9] * z;
      const nz = e[2] * x + e[6] * y + e[10] * z;
      const l = Math.hypot(nx, ny, nz) || 1;
      set(0, nx / l); set(1, ny / l); set(2, nz / l);
    });
    return this;
  }
  applyNormalMatrix(m: any) {
    const e = m.elements || m;
    const is16 = e.length >= 16;
    this._each3((get, set) => {
      const x = get(0), y = get(1), z = get(2);
      let nx: number, ny: number, nz: number;
      if (is16) {
        nx = e[0] * x + e[4] * y + e[8] * z;
        ny = e[1] * x + e[5] * y + e[9] * z;
        nz = e[2] * x + e[6] * y + e[10] * z;
      } else {
        nx = e[0] * x + e[3] * y + e[6] * z;
        ny = e[1] * x + e[4] * y + e[7] * z;
        nz = e[2] * x + e[5] * y + e[8] * z;
      }
      const l = Math.hypot(nx, ny, nz) || 1;
      set(0, nx / l); set(1, ny / l); set(2, nz / l);
    });
    return this;
  }
  toJSON() {
    const a = this.array;
    return {
      isInterleavedBufferAttribute: true,
      itemSize: this.itemSize,
      offset: this.offset,
      normalized: this.normalized,
      data: {
        array: Array.from(a),
        stride: this.data.stride,
        type: a.constructor.name === 'Float32Array' ? 'Float32Array' :
          a.constructor.name === 'Uint16Array' ? 'Uint16Array' :
          a.constructor.name === 'Uint32Array' ? 'Uint32Array' : 'Float32Array',
      },
    };
  }
}

export class BufferGeometry extends EventDispatcher {
  isBufferGeometry: boolean;
  attributes: Record<string, any>;
  index: BufferAttribute | null;
  groups: Array<{ start: number; count: number; materialIndex?: number }>;
  drawRange: { start: number; count: number };
  boundingBox: Box3 | null;
  boundingSphere: Sphere | null;
  version: number;
  uuid: string;
  morphAttributes: Record<string, any>;
  morphTargetsRelative: boolean;
  [key: string]: any;
  constructor() {
    super();
    this.isBufferGeometry = true;
    this.attributes = {};
    this.index = null;
    this.groups = [];
    this.drawRange = { start: 0, count: Infinity };
    this.boundingBox = null;
    this.boundingSphere = null;
    this.version = 0;
    this.uuid = 'geo-' + Math.random().toString(36).slice(2, 10);
    this.morphAttributes = {};
    this.morphTargetsRelative = false;
  }
  setDrawRange(start: number, count: number) {
    this.drawRange.start = start;
    this.drawRange.count = count;
    return this;
  }
  setAttribute(name, attribute) {
    this.attributes[name] = attribute;
    if (name === 'position') {
      this.boundingBox = null;
      this.boundingSphere = null;
    }
    this.version++;
    return this;
  }
  getAttribute(name) { return this.attributes[name]; }
  deleteAttribute(name) {
    delete this.attributes[name];
    if (name === 'position') {
      this.boundingBox = null;
      this.boundingSphere = null;
    }
    this.version++;
    return this;
  }
  getIndex() { return this.index; }
  hasAttribute(name: string) { return name in this.attributes; }
  setFromPoints(points: Vector3[]) {
    const arr = new Float32Array(points.length * 3);
    points.forEach((p, i) => { arr[i * 3] = p.x; arr[i * 3 + 1] = p.y; arr[i * 3 + 2] = p.z; });
    return this.setAttribute('position', new Float32BufferAttribute(arr, 3));
  }
  // Expand the index into a full vertex list, like three.js toNonIndexed.
  toNonIndexed() {
    if (!this.index) return this.clone();
    const pos = this.attributes.position;
    const ids = this.index.array, ps = pos ? pos.itemSize : 3;
    const triCount = Math.floor(ids.length / 3);
    const out: Record<string, any> = {};
    for (const [name, attr] of Object.entries(this.attributes)) {
      const a = attr.array, st = attr.itemSize;
      const flat = new attr.array.constructor(triCount * 3 * st);
      for (let t = 0; t < triCount; t++)
        for (let k = 0; k < 3; k++) {
          const src = ids[t * 3 + k] * st, dst = (t * 3 + k) * st;
          for (let c = 0; c < st; c++) flat[dst + c] = a[src + c];
        }
      out[name] = new BufferAttribute(flat, st, attr.normalized);
    }
    const g = new BufferGeometry();
    for (const [k, v] of Object.entries(out)) g.setAttribute(k, v);
    return g;
  }
  // Indirect draw buffers are engine-internal; accept but don't use them.
  getIndirect() { return null; }
  setIndirect(_buffer: any, _type = 0) { return this; }
  applyQuaternion(q: any) {
    const x = q.x, y = q.y, z = q.z, w = q.w;
    const rot = (v: number[]) => {
      const vx = v[0], vy = v[1], vz = v[2];
      // v' = q * v * q^-1 expanded (unit quaternion assumed).
      const ix = w * vx + y * vz - z * vy, iy = w * vy + z * vx - x * vz, iz = w * vz + x * vy - y * vx;
      const iw = -x * vx - y * vy - z * vz;
      v[0] = ix * w + iw * -x + iy * -z - iz * -y;
      v[1] = iy * w + iw * -y + iz * -x - ix * -z;
      v[2] = iz * w + iw * -z + ix * -y - iy * -x;
    };
    const v = [0, 0, 0];
    return this._transformPositions((a, o) => {
      v[0] = a[o]; v[1] = a[o + 1]; v[2] = a[o + 2]; rot(v);
      a[o] = v[0]; a[o + 1] = v[1]; a[o + 2] = v[2];
    }, (a, o) => {
      v[0] = a[o]; v[1] = a[o + 1]; v[2] = a[o + 2]; rot(v);
      const l = Math.hypot(v[0], v[1], v[2]) || 1;
      a[o] = v[0] / l; a[o + 1] = v[1] / l; a[o + 2] = v[2] / l;
    });
  }
  normalizeNormals() {
    const n = this.attributes.normal;
    if (!n) return this;
    const d = attrData(n);
    for (let i = 0; i < d.count; i++) {
      const o = i * d.itemSize;
      const l = Math.hypot(d.array[o], d.array[o + 1], d.array[o + 2]) || 1;
      d.array[o] /= l; d.array[o + 1] /= l; d.array[o + 2] /= l;
    }
    this.version++;
    return this;
  }
  computeTangents() { return this; }
  // Rotate the geometry so +Z points from the origin toward `vector`.
  lookAt(vector: Vector3) {
    const m = new Matrix4().lookAt(new Vector3(), vector, new Vector3(0, 1, 0));
    const q = new Quaternion().setFromRotationMatrix(m);
    return this.applyQuaternion(q);
  }
  toJSON() {
    const data: any = { metadata: { version: 4.7, type: 'BufferGeometry', generator: 'gs3d' },
      uuid: this.uuid, type: 'BufferGeometry' };
    for (const [name, attr] of Object.entries(this.attributes)) {
      const a = attr.array;
      data[name] = { itemSize: attr.itemSize, type: a.constructor.name, array: Array.from(a), normalized: attr.normalized };
    }
    if (this.index) {
      const a = this.index.array;
      data.index = { itemSize: this.index.itemSize, type: a.constructor.name, array: Array.from(a), normalized: this.index.normalized };
    }
    data.groups = this.groups;
    data.drawRange = this.drawRange;
    return data;
  }
  copy(source: BufferGeometry) {
    for (const key of Object.keys(source.attributes)) {
      const attr = source.attributes[key];
      this.setAttribute(key, new BufferAttribute(attr.array.slice(), attr.itemSize, attr.normalized));
    }
    if (source.index) this.index = new BufferAttribute(source.index.array.slice(), source.index.itemSize, source.index.normalized);
    this.groups = source.groups.map(g => ({ ...g }));
    if (source.boundingBox) this.boundingBox = source.boundingBox.clone();
    if (source.boundingSphere) this.boundingSphere = source.boundingSphere.clone();
    return this;
  }
  setIndex(index) {
    if (index === null || index === undefined) this.index = null;
    else if (index.isBufferAttribute) this.index = index;
    else this.index = new Uint32BufferAttribute(index, 1);
    this.version++;
    return this;
  }
  addGroup(start, count, materialIndex = 0) {
    this.groups.push({ start, count, materialIndex });
    return this;
  }
  clearGroups() {
    this.groups.length = 0;
    return this;
  }
  // Rotate/translate/scale the stored positions (and normals) in place, like
  // three.js geometry transforms: they bake into the attribute arrays.
  _transformPositions(fn: any, normalFn: any = null) {
    const position = this.attributes.position;
    if (position) {
      const pd = attrData(position);
      for (let i = 0; i < pd.count; i++) fn(pd.array, i * pd.itemSize, pd.itemSize);
      this.boundingBox = null;
      this.boundingSphere = null;
      this.version++;
    }
    const normal = this.attributes.normal;
    if (normal && normalFn) {
      const nd = attrData(normal);
      for (let i = 0; i < nd.count; i++) normalFn(nd.array, i * nd.itemSize, nd.itemSize);
      this.version++;
    }
    return this;
  }
  rotateX(angle) {
    const c = Math.cos(angle), sn = Math.sin(angle);
    return this._transformPositions((a, o, st) => {
      const y = a[o + 1], z = a[o + 2];
      a[o + 1] = c * y - sn * z; a[o + 2] = sn * y + c * z;
    }, (a, o, st) => {
      const y = a[o + 1], z = a[o + 2];
      a[o + 1] = c * y - sn * z; a[o + 2] = sn * y + c * z;
    });
  }
  rotateY(angle) {
    const c = Math.cos(angle), sn = Math.sin(angle);
    return this._transformPositions((a, o, st) => {
      const x = a[o], z = a[o + 2];
      a[o] = c * x + sn * z; a[o + 2] = -sn * x + c * z;
    }, (a, o, st) => {
      const x = a[o], z = a[o + 2];
      a[o] = c * x + sn * z; a[o + 2] = -sn * x + c * z;
    });
  }
  rotateZ(angle) {
    const c = Math.cos(angle), sn = Math.sin(angle);
    return this._transformPositions((a, o, st) => {
      const x = a[o], y = a[o + 1];
      a[o] = c * x - sn * y; a[o + 1] = sn * x + c * y;
    }, (a, o, st) => {
      const x = a[o], y = a[o + 1];
      a[o] = c * x - sn * y; a[o + 1] = sn * x + c * y;
    });
  }
  translate(x, y, z) {
    return this._transformPositions((a, o) => { a[o] += x; a[o + 1] += y; a[o + 2] += z; });
  }
  scale(x, y, z) {
    const ix = x ? 1 / x : 0, iy = y ? 1 / y : 0, iz = z ? 1 / z : 0;
    return this._transformPositions((a, o) => {
      a[o] *= x; a[o + 1] *= y; a[o + 2] *= z;
    }, (a, o) => {
      const nx = a[o] * ix, ny = a[o + 1] * iy, nz = a[o + 2] * iz;
      const l = Math.hypot(nx, ny, nz) || 1;
      a[o] = nx / l; a[o + 1] = ny / l; a[o + 2] = nz / l;
    });
  }
  center() {
    this.computeBoundingBox();
    if (!this.boundingBox || this.boundingBox.isEmpty()) return this;
    const c = this.boundingBox.getCenter(new Vector3());
    return this.translate(-c.x, -c.y, -c.z).computeBoundingBox();
  }
  applyMatrix4(matrix) {
    const m = matrix.elements || matrix;
    const inv = invertMat4(m);
    return this._transformPositions((a, o) => {
      const x = a[o], y = a[o + 1], z = a[o + 2];
      a[o] = m[0] * x + m[4] * y + m[8] * z + m[12];
      a[o + 1] = m[1] * x + m[5] * y + m[9] * z + m[13];
      a[o + 2] = m[2] * x + m[6] * y + m[10] * z + m[14];
    }, inv ? (a, o) => {
      const x = a[o], y = a[o + 1], z = a[o + 2];
      const nx = inv[0] * x + inv[1] * y + inv[2] * z;
      const ny = inv[4] * x + inv[5] * y + inv[6] * z;
      const nz = inv[8] * x + inv[9] * y + inv[10] * z;
      const l = Math.hypot(nx, ny, nz) || 1;
      a[o] = nx / l; a[o + 1] = ny / l; a[o + 2] = nz / l;
    } : null);
  }
  clone() {
    const copy = new BufferGeometry();
    for (const key of Object.keys(this.attributes)) {
      const attr = this.attributes[key];
      copy.attributes[key] = new BufferAttribute(attr.array.slice(), attr.itemSize, attr.normalized);
    }
    if (this.index) copy.index = new BufferAttribute(this.index.array.slice(), this.index.itemSize, this.index.normalized);
    for (const g of this.groups) copy.groups.push({ ...g });
    if (this.boundingBox) copy.boundingBox = this.boundingBox.clone();
    if (this.boundingSphere) copy.boundingSphere = this.boundingSphere.clone();
    return copy;
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
  computeBoundingBox() {
    const position = this.attributes.position;
    if (!position) { this.boundingBox = null; return this; }
    const pd = attrData(position);
    const p = pd.array, ps = pd.itemSize;
    let minX = Infinity, minY = Infinity, minZ = Infinity;
    let maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;
    for (let i = 0; i < pd.count; i++) {
      const o = i * ps;
      const x = p[o], y = p[o + 1], z = p[o + 2];
      if (x < minX) minX = x; if (x > maxX) maxX = x;
      if (y < minY) minY = y; if (y > maxY) maxY = y;
      if (z < minZ) minZ = z; if (z > maxZ) maxZ = z;
    }
    if (!this.boundingBox) this.boundingBox = new Box3();
    this.boundingBox.min.set(minX, minY, minZ);
    this.boundingBox.max.set(maxX, maxY, maxZ);
    return this;
  }
  computeBoundingSphere() {
    this.computeBoundingBox();
    if (!this.boundingBox) { this.boundingSphere = null; return this; }
    const pd = attrData(this.attributes.position);
    const p = pd.array, ps = pd.itemSize;
    const center = this.boundingBox.getCenter(new Vector3());
    let radius = 0;
    for (let i = 0; i < pd.count; i++) {
      const dx = p[i * ps] - center.x, dy = p[i * ps + 1] - center.y, dz = p[i * ps + 2] - center.z;
      const d = dx * dx + dy * dy + dz * dz;
      if (d > radius) radius = d;
    }
    this.boundingSphere = new Sphere(center, Math.sqrt(radius));
    return this;
  }
  dispose() {
    this.version++;
    releaseGeometry(this);
  }
}


export class Mesh extends Object3D {
  geometry: BufferGeometry;
  material: any;
  constructor(geometry = new BufferGeometry(), material: any = new MeshBasicMaterial()) {
    super();
    this.isMesh = true;
    this.geometry = geometry;
    this.material = material;
  }
  // Geometry/material are shared references, matching three.js Mesh.copy.
  copy(source: Mesh, recursive = true) {
    super.copy(source, recursive);
    this.geometry = source.geometry;
    this.material = source.material;
    return this;
  }
  computeBoundingBox() { this.geometry.computeBoundingBox(); return this; }
  computeBoundingSphere() { this.geometry.computeBoundingSphere(); return this; }
  getVertexPosition(index: number, target = new Vector3()) {
    const pos = this.geometry.getAttribute('position');
    if (!pos) return target.set(0, 0, 0);
    const o = index * pos.itemSize;
    return target.set(pos.array[o] ?? 0, pos.array[o + 1] ?? 0, pos.array[o + 2] ?? 0);
  }
  updateMorphTargets() { return this; }
}

export class InstancedMesh extends Mesh {
  count: number;
  _maxCount: number;
  instanceMatrix: BufferAttribute;
  instanceColor: BufferAttribute | null;
  _instances: Mesh[];
  _colorMaterials: Map<string, any>;
  _tintedSourceMaterial?: any;
  constructor(geometry = new BufferGeometry(), material: any = new MeshBasicMaterial(), count = 0) {
    super(geometry, material);
    this.isMesh = false;
    this.isInstancedMesh = true;
    this.count = Math.max(0, count | 0);
    this._maxCount = this.count;
    this.instanceMatrix = new BufferAttribute(new Float32Array(this._maxCount * 16), 16);
    this.instanceColor = null;
    this._instances = [];
    this._colorMaterials = new Map();
  }
  setMatrixAt(index, matrix) {
    if (index < 0 || index >= this._maxCount) return;
    this.instanceMatrix.array.set(matrix.elements, index * 16);
    this.instanceMatrix.needsUpdate = true;
  }
  getMatrixAt(index, matrix) {
    if (index < 0 || index >= this._maxCount) return matrix;
    const o = index * 16;
    for (let i = 0; i < 16; i++) matrix.elements[i] = this.instanceMatrix.array[o + i];
    return matrix;
  }
  setColorAt(index, color) {
    if (index < 0 || index >= this._maxCount) return;
    if (!this.instanceColor) this.instanceColor = new BufferAttribute(new Float32Array(this._maxCount * 3), 3);
    this.instanceColor.array[index * 3] = color.r;
    this.instanceColor.array[index * 3 + 1] = color.g;
    this.instanceColor.array[index * 3 + 2] = color.b;
    this.instanceColor.needsUpdate = true;
  }
  getColorAt(index, color) {
    if (!this.instanceColor || index < 0 || index >= this._maxCount) return color;
    const o = index * 3;
    return color.setRGB(this.instanceColor.array[o], this.instanceColor.array[o + 1], this.instanceColor.array[o + 2]);
  }
  dispose() {
    this._instances.length = 0;
    this._colorMaterials.clear();
  }
  copy(source: InstancedMesh, recursive = true) {
    super.copy(source, recursive);
    this.count = source.count;
    this.instanceMatrix.array.set(source.instanceMatrix.array.subarray(0, this.count * 16));
    if (source.instanceColor && !this.instanceColor)
      this.instanceColor = new BufferAttribute(new Float32Array(this._maxCount * 3), 3);
    if (this.instanceColor && source.instanceColor)
      this.instanceColor.array.set(source.instanceColor.array.subarray(0, this.count * 3));
    return this;
  }
  // Morph targets are not supported by the engine; API stubs only.
  getMorphAt(index: number) { return null; }
  setMorphAt(index: number, mesh: any) { return this; }
}

export class Line extends Object3D {
  isLine: boolean;
  geometry: any;
  material: any;
  constructor(geometry: any, material: any) { super(); this.isLine = true; this.geometry = geometry; this.material = material; }
  copy(source: Line, recursive = true) {
    super.copy(source, recursive);
    this.geometry = source.geometry;
    this.material = source.material;
    return this;
  }
  computeLineDistances() { return this; }
}
export class LineSegments extends Line {
  isLineSegments: boolean;
  constructor(geometry: any, material: any) {
    super(geometry, material);
    this.isLineSegments = true;
  }
}
export class LineLoop extends Line {
  isLineLoop: boolean;
  constructor(geometry: any, material: any) {
    super(geometry, material);
    this.isLineLoop = true;
  }
}
export class Points extends Object3D {
  isPoints: boolean;
  geometry: any;
  material: any;
  constructor(geometry: any, material: any) { super(); this.isPoints = true; this.geometry = geometry; this.material = material; }
  copy(source: Points, recursive = true) {
    super.copy(source, recursive);
    this.geometry = source.geometry;
    this.material = source.material;
    return this;
  }
}
export class Sprite extends Object3D {
  isSprite: boolean;
  material: any;
  constructor(material?: any) { super(); this.isSprite = true; this.material = material; }
  copy(source: Sprite, recursive = true) {
    super.copy(source, recursive);
    this.material = source.material;
    return this;
  }
}

