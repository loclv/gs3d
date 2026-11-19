import { Vector2, Vector3, Box3, Sphere, invertMat4, normalize3 } from './math';
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
  points: any[];
  closed: boolean;
  curveType: string;
  tension: number;
  isCatmullRomCurve3: boolean;
  constructor(points: any[] = [], closed = false, curveType = 'centripetal', tension = 0.5) {
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
  isPath: boolean;
  segments: any[];
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
  isShape: boolean;
  holes: any[];
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
  constructor(shape: any, options: Record<string, any> = {}) {
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

