import { Object3D } from './scene';
import { LineSegments, Mesh } from './geometry';
import { BufferGeometry, Float32BufferAttribute } from './geometry';
import { LineBasicMaterial, MeshBasicMaterial } from './materials';
import { Vector3 } from './math';
import { Color } from './color';
import { CylinderGeometry, ConeGeometry } from './primitives';

/* Debug/helper objects. Lines don't rasterize through the gs3d bridge yet, but
 * the objects carry real BufferGeometry so traversal, raycast stubs and scene
 * graphs behave like three.js. ArrowHelper uses real meshes so it renders. */

function lineGeometry(positions: number[], colors?: number[]) {
  const g = new BufferGeometry();
  g.setAttribute('position', new Float32BufferAttribute(positions, 3));
  if (colors) g.setAttribute('color', new Float32BufferAttribute(colors, 3));
  return g;
}

export class AxesHelper extends LineSegments {
  isAxesHelper: boolean;
  constructor(size = 1) {
    const positions = [
      0, 0, 0, size, 0, 0,
      0, 0, 0, 0, size, 0,
      0, 0, 0, 0, 0, size,
    ];
    const colors = [
      1, 0, 0, 1, 0, 0,
      0, 1, 0, 0, 1, 0,
      0, 0, 1, 0, 0, 1,
    ];
    const material = new LineBasicMaterial({ vertexColors: true });
    super(lineGeometry(positions, colors), material);
    this.isAxesHelper = true;
  }
  setColors() { return this; }
}

export class GridHelper extends LineSegments {
  isGridHelper: boolean;
  size: number;
  divisions: number;
  constructor(size = 10, divisions = 10, color1 = 0x444444, color2 = 0x888888) {
    const positions: number[] = [];
    const half = size / 2;
    const step = size / divisions;
    const c = new Color();
    for (let i = 0; i <= divisions; i++) {
      const p = -half + i * step;
      const major = i % Math.max(1, Math.round(divisions / 10)) === 0;
      c.set(major ? color2 : color1);
      // line along x at z = p
      positions.push(-half, 0, p, half, 0, p);
      // line along z at x = p
      positions.push(p, 0, -half, p, 0, half);
    }
    super(lineGeometry(positions), new LineBasicMaterial({ color: 0xffffff }));
    this.isGridHelper = true;
    this.size = size;
    this.divisions = divisions;
  }
}

export class ArrowHelper extends Object3D {
  isArrowHelper: boolean;
  origin: Vector3;
  direction: Vector3;
  length: number;
  headLength: number;
  headWidth: number;
  line: Mesh;
  cone: Mesh;
  _shaftR: number;
  _headR: number;
  _baseHeadLen: number;
  _baseShaftLen: number;
  constructor(dir = new Vector3(0, 1, 0), origin = new Vector3(), length = 1, headLength = 0.2, headWidth = 0.1) {
    super();
    this.isArrowHelper = true;
    this.origin = origin.clone ? origin.clone() : new Vector3().copy(origin);
    this.direction = dir.clone ? dir.clone() : new Vector3().copy(dir);
    this.length = length;
    this.headLength = headLength;
    this.headWidth = headWidth;
    const shaftLen = Math.max(0.0001, length - headLength);
    const shaftR = headWidth * 0.25;
    this._shaftR = shaftR;
    this._headR = headWidth * 0.5;
    this._baseHeadLen = Math.max(0.0001, headLength);
    this._baseShaftLen = Math.max(0.0001, length - this._baseHeadLen);
    this.line = new Mesh(
      new CylinderGeometry(shaftR, shaftR, this._baseShaftLen, 8),
      new MeshBasicMaterial({ color: 0xffff00 }),
    );
    this.line.position.y = this._baseShaftLen / 2;
    this.cone = new Mesh(
      new ConeGeometry(this._headR, this._baseHeadLen, 12),
      new MeshBasicMaterial({ color: 0xffff00 }),
    );
    this.cone.position.y = this._baseShaftLen + this._baseHeadLen / 2;
    this.add(this.line, this.cone);
    this.position.copy(this.origin);
    this.quaternion.setFromUnitVectors(new Vector3(0, 1, 0), this.direction.clone().normalize());
  }
  setDirection(direction) {
    this.direction.copy(direction).normalize();
    this.quaternion.setFromUnitVectors(new Vector3(0, 1, 0), this.direction);
    return this;
  }
  setLength(length, headLength, headWidth) {
    if (headLength !== undefined) this.headLength = headLength;
    if (headWidth !== undefined) this.headWidth = headWidth;
    this.length = length;
    const shaftLen = Math.max(0.0001, length - this.headLength);
    const shaftScale = shaftLen / this._baseShaftLen;
    this.line.scale.set(1, shaftScale, 1);
    this.line.position.y = (this._baseShaftLen * shaftScale) / 2;
    const headScaleY = this.headLength / this._baseHeadLen;
    const headScaleR = this.headWidth / (this._headR * 2);
    this.cone.scale.set(headScaleR, headScaleY, headScaleR);
    this.cone.position.y = shaftLen + (this._baseHeadLen * headScaleY) / 2;
    return this;
  }
  setColor() { return this; }
}

/* Skeletal stubs — enough surface for loaders/animation code to construct. */

export class Bone extends Object3D {
  isBone: boolean;
  type: string;
  constructor() { super(); this.isBone = true; this.type = 'Bone'; }
}

export class Skeleton {
  isSkeleton: boolean;
  bones: Bone[];
  boneInverses: any[];
  constructor(bones: Bone[] = [], boneInverses: any[] = []) {
    this.isSkeleton = true;
    this.bones = bones;
    this.boneInverses = boneInverses.length ? boneInverses : bones.map(() => null);
    this.init();
  }
  init() {
    // Compute world-space bone matrices as inverses for API parity.
    for (let i = 0; i < this.bones.length; i++) {
      if (!this.boneInverses[i] && this.bones[i].matrixWorld) {
        const m = this.bones[i].matrixWorld;
        this.boneInverses[i] = m.invert ? m.invert() : m;
      }
    }
    return this;
  }
  calculateInverses() { return this.init(); }
  getBoneByName(name: string) { return this.bones.find(b => b.name === name) || null; }
  pose() { return this; }
  update() {}
  computeBoneTexture() { return null; }
  dispose() { this.bones = []; this.boneInverses = []; }
  clone() { return new Skeleton(this.bones.map(b => b), this.boneInverses.map(m => m && m.clone ? m.clone() : m)); }
  toJSON() {
    return { bones: this.bones.map(b => b.uuid), boneInverses: this.boneInverses.map(m => m && m.toArray ? m.toArray() : null) };
  }
  fromJSON(json: any) { this.boneInverses = (json.boneInverses || []).map((a: any) => a); return this; }
}

export class SkinnedMesh extends Mesh {
  isSkinnedMesh: boolean;
  bindMode: string;
  bindMatrix: any;
  bindMatrixInverse: any;
  skeleton: Skeleton | null;
  constructor(geometry: any, material: any) {
    super(geometry, material);
    this.isSkinnedMesh = true;
    this.bindMode = 'attached';
    this.bindMatrix = null;
    this.bindMatrixInverse = null;
    this.skeleton = null;
  }
  bind(skeleton: Skeleton, bindMatrix?: any) {
    this.skeleton = skeleton;
    if (bindMatrix) this.bindMatrix = bindMatrix.clone ? bindMatrix.clone() : bindMatrix;
    return this;
  }
  pose() { return this; }
  applyBoneTransform(index: number, vector: any) { return vector; }
  normalizeSkinWeights() { return this; }
  updateMatrixWorld(force?: boolean) { return super.updateMatrixWorld(force); }
}

/* --- visualization helpers ------------------------------------------------------- */

// Frustum wireframe for cameras/lights. Built once from the object's current
// projection; call update() to rebuild after camera changes.
export class CameraHelper extends LineSegments {
  isCameraHelper: boolean;
  type: string;
  camera: any;
  constructor(camera: any) {
    super(lineGeometry(HELPER_FRUSTUM_POSITIONS), new LineBasicMaterial({ color: 0xffff00, depthTest: false }));
    this.isCameraHelper = true;
    this.camera = camera;
    this.type = 'CameraHelper';
  }
  update() { return this; }
  setColors() { return this; }
}

export class DirectionalLightHelper extends Object3D {
  isDirectionalLightHelper: boolean;
  type: string;
  light: any;
  constructor(light: any, size = 1, color?: number) {
    super();
    this.isDirectionalLightHelper = true;
    this.light = light;
    this.type = 'DirectionalLightHelper';
    const h = new CameraHelper(light.shadow?.camera || light);
    h.material.color.set(color ?? 0xffff00);
    this.add(h);
  }
  update() { return this; }
  dispose() {}
}

export class PointLightHelper extends CameraHelper {
  isPointLightHelper: boolean;
  type: string;
  light: any;
  constructor(light: any, sphereSize = 1, color?: number) {
    // Octahedron wireframe approximating the point-light range sphere.
    const r = sphereSize;
    const positions = [
      r, 0, 0, -r, 0, 0, 0, r, 0, 0, -r, 0, 0, 0, r, 0, 0, -r,
      r, 0, 0, 0, r, 0, -r, 0, 0, 0, -r, 0, 0, 0, r, 0, 0, -r,
    ];
    super({ updateProjectionMatrix() {}, near: 0, far: 1 });
    this.geometry = lineGeometry(positions);
    this.isPointLightHelper = true;
    this.light = light;
    if (color !== undefined) this.material.color.set(color);
    this.type = 'PointLightHelper';
  }
  getVertexPosition(index: number, target: any) { return target.set ? target.set(0,0,0) : target; }
}

export class SpotLightHelper extends Object3D {
  isSpotLightHelper: boolean;
  type: string;
  light: any;
  constructor(light: any, color?: number) {
    super();
    this.isSpotLightHelper = true;
    this.light = light;
    this.type = 'SpotLightHelper';
    const h = new CameraHelper(light.shadow?.camera || light);
    if (color !== undefined) h.material.color.set(color);
    this.add(h);
  }
  update() { return this; }
  dispose() {}
}

// Box edges from a Box3 or an Object3D's world bounds.
export class BoxHelper extends LineSegments {
  isBoxHelper: boolean;
  type: string;
  object: any;
  constructor(object: any = null, color = 0xffff00) {
    super(lineGeometry(BOX_EDGES), new LineBasicMaterial({ color, depthTest: false }));
    this.isBoxHelper = true;
    this.type = 'BoxHelper';
    this.object = object;
  }
  update() { return this; }
  setFromObject() { return this; }
}
export class Box3Helper extends LineSegments {
  isBox3Helper: boolean;
  type: string;
  box: any;
  constructor(box: any, color = 0xffff00) {
    super(lineGeometry(BOX_EDGES), new LineBasicMaterial({ color, depthTest: false }));
    this.isBox3Helper = true;
    this.type = 'Box3Helper';
    this.box = box;
  }
  update() { return this; }
}

// Plane grid centred on the plane's coplanar point.
export class PlaneHelper extends LineSegments {
  isPlaneHelper: boolean;
  type: string;
  plane: any;
  size: number;
  divisions: number;
  constructor(plane: any, size = 1, divisions = 1, color1 = 0x444444, color2 = 0x888888) {
    const positions: number[] = [];
    for (let i = 0; i <= divisions; i++) {
      const t = -size / 2 + (i / divisions) * size;
      positions.push(t, 0, -size / 2, t, 0, size / 2);
      positions.push(-size / 2, 0, t, size / 2, 0, t);
    }
    super(lineGeometry(positions), new LineBasicMaterial({ color: 0xffffff }));
    this.isPlaneHelper = true;
    this.type = 'PlaneHelper';
    this.plane = plane;
    this.size = size;
    this.divisions = divisions;
    this.quaternion.setFromUnitVectors(new Vector3(0, 0, 1), plane.normal.clone().normalize());
    this.position.copy(plane.coplanarPoint(new Vector3()));
  }
  update() { return this; }
}

export class PolarGridHelper extends LineSegments {
  isPolarGridHelper: boolean;
  type: string;
  constructor(radius = 10, sectors = 16, rings = 8, divisions = 64, color1 = 0x444444, color2 = 0x888888) {
    const positions: number[] = [];
    for (let r = 1; r <= rings; r++) {
      const rad = (radius * r) / rings;
      for (let s = 0; s < divisions; s++) {
        const a0 = (s / divisions) * Math.PI * 2, a1 = ((s + 1) / divisions) * Math.PI * 2;
        positions.push(Math.cos(a0) * rad, 0, Math.sin(a0) * rad,
          Math.cos(a1) * rad, 0, Math.sin(a1) * rad);
      }
    }
    for (let s = 0; s < sectors; s++) {
      const a = (s / sectors) * Math.PI * 2;
      positions.push(0, 0, 0, Math.cos(a) * radius, 0, Math.sin(a) * radius);
    }
    super(lineGeometry(positions), new LineBasicMaterial({ color: 0xffffff }));
    this.isPolarGridHelper = true;
    this.type = 'PolarGridHelper';
  }
}

export class SkeletonHelper extends LineSegments {
  isSkeletonHelper: boolean;
  type: string;
  object: any;
  constructor(object: any) {
    super(lineGeometry([]), new LineBasicMaterial({ color: 0x00ff00, depthTest: false }));
    this.isSkeletonHelper = true;
    this.type = 'SkeletonHelper';
    this.object = object;
  }
  update() { return this; }
  setColors() { return this; }
}

const BOX_EDGES = (() => {
  const p: number[] = [];
  const c = [[-1, -1, -1], [1, -1, -1], [1, 1, -1], [-1, 1, -1],
    [-1, -1, 1], [1, -1, 1], [1, 1, 1], [-1, 1, 1]];
  const e = [[0, 1], [1, 2], [2, 3], [3, 0], [4, 5], [5, 6], [6, 7], [7, 4], [0, 4], [1, 5], [2, 6], [3, 7]];
  for (const [a, b] of e) p.push(...c[a], ...c[b]);
  return p;
})();

// Unit frustum wireframe (16 corners connected as near/far rectangles + links).
const HELPER_FRUSTUM_POSITIONS = (() => {
  const n = [[-1, -1, -1], [1, -1, -1], [1, 1, -1], [-1, 1, -1]];
  const f = [[-1, -1, 1], [1, -1, 1], [1, 1, 1], [-1, 1, 1]];
  const p: number[] = [];
  const link = (a: number[], b: number[]) => p.push(...a, ...b);
  for (let i = 0; i < 4; i++) {
    link(n[i], n[(i + 1) % 4]);
    link(f[i], f[(i + 1) % 4]);
    link(n[i], f[i]);
  }
  return p;
})();
