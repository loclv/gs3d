import { Vector2, Vector3, invertMat4, normalize3 } from './math';
import { Box3, Sphere } from './bounds';
import { Object3D } from './scene';
import { MeshBasicMaterial } from './materials';
import { attrData, releaseGeometry } from './bridge';

/* --- geometry -------------------------------------------------------------- */

export class BufferAttribute {
  isBufferAttribute: boolean;
  array: any;
  itemSize: number;
  normalized: boolean;
  count: number;
  needsUpdate?: boolean;
  constructor(array: any, itemSize: number, normalized = false) {
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
  isInterleavedBuffer: boolean;
  array: any;
  stride: number;
  usage: number;
  constructor(array: any, stride: number) {
    this.isInterleavedBuffer = true;
    this.array = array;
    this.stride = stride;
    this.usage = 35044;
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
  count: number;
  constructor(data: InterleavedBuffer, itemSize: number, offset = 0, normalized = false) {
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
  isBufferGeometry: boolean;
  attributes: Record<string, any>;
  index: BufferAttribute | null;
  groups: Array<{ start: number; count: number; materialIndex?: number }>;
  boundingBox: Box3 | null;
  boundingSphere: Sphere | null;
  version: number;
  [key: string]: any;
  constructor() {
    this.isBufferGeometry = true;
    this.attributes = {};
    this.index = null;
    this.groups = [];
    this.boundingBox = null;
    this.boundingSphere = null;
    this.version = 0;
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
}

export class Line extends Object3D {
  isLine: boolean;
  geometry: any;
  material: any;
  constructor(geometry: any, material: any) { super(); this.isLine = true; this.geometry = geometry; this.material = material; }
}
export class Points extends Object3D {
  isPoints: boolean;
  geometry: any;
  material: any;
  constructor(geometry: any, material: any) { super(); this.isPoints = true; this.geometry = geometry; this.material = material; }
}
export class Sprite extends Object3D {
  isSprite: boolean;
  material: any;
  constructor(material: any) { super(); this.isSprite = true; this.material = material; }
}

