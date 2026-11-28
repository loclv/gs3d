import { Color } from './color';
import { Vector2, Vector3, Vector4, Euler, Quaternion, Matrix4, transformPoint, transformDir, normalize3 } from './math';
import { releaseEngineTree, localMatrixOf, worldMatrixOf } from './bridge';
import { EventDispatcher } from './events';

/* --- scene graph ---------------------------------------------------------- */

export class Layers {
  mask = 1;
  set(channel: number) { this.mask = (1 << channel) >>> 0; }
  enable(channel: number) { this.mask |= 1 << channel; }
  enableAll() { this.mask = 0xffffffff; }
  toggle(channel: number) { this.mask ^= 1 << channel; }
  disable(channel: number) { this.mask &= ~(1 << channel); }
  disableAll() { this.mask = 0; }
  test(layers: Layers) { return (this.mask & layers.mask) !== 0; }
  isEnabled(channel: number) { return (this.mask & (1 << channel)) !== 0; }
}

const _rotQuat = new Quaternion();
const _rotVec = new Vector3();
const _axisX = new Vector3(1, 0, 0), _axisY = new Vector3(0, 1, 0), _axisZ = new Vector3(0, 0, 1);

let _object3DId = 0;

export class Object3D extends EventDispatcher {
  isObject3D: boolean;
  id: number;
  uuid: string;
  name: string;
  position: Vector3;
  rotation: Euler;
  quaternion: Quaternion;
  scale: Vector3;
  _qCache: { x: number; y: number; z: number; w: number };
  _eCache: { x: number; y: number; z: number; order: string };
  children: Object3D[];
  parent: Object3D | null;
  visible: boolean;
  layers: Layers;
  castShadow: boolean;
  receiveShadow: boolean;
  renderOrder: number;
  frustumCulled: boolean;
  matrixAutoUpdate: boolean;
  matrix: Matrix4;
  matrixWorld: Matrix4;
  userData: Record<string, any>;
  isCamera?: boolean;
  isLight?: boolean;
  isMesh?: boolean;
  isInstancedMesh?: boolean;
  isGroup?: boolean;
  isScene?: boolean;
  constructor() {
    super();
    this.isObject3D = true;
    this.id = _object3DId++;
    this.uuid = 'obj-' + Math.random().toString(36).slice(2, 10);
    this.name = '';
    this.position = new Vector3();
    this.rotation = new Euler();
    this.quaternion = new Quaternion();
    this.scale = new Vector3(1, 1, 1);
    // Rotation snapshots for resolvedQuaternion's change detection.
    this._qCache = { x: 0, y: 0, z: 0, w: 1 };
    this._eCache = { x: 0, y: 0, z: 0, order: 'XYZ' };
    this.children = [];
    this.parent = null;
    this.visible = true;
    this.layers = new Layers();
    this.castShadow = false;
    this.receiveShadow = false;
    this.renderOrder = 0;
    this.frustumCulled = true;
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
  traverseVisible(callback) {
    if (!this.visible) return;
    callback(this);
    for (const child of this.children) child.traverseVisible(callback);
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
  updateMatrixWorld(force?: boolean) {
    if (this.matrixAutoUpdate) this.updateMatrix();
    if (this.parent && this.parent.matrixWorld) {
      this.matrixWorld.multiplyMatrices(this.parent.matrixWorld, this.matrix);
    } else {
      this.matrixWorld.copy(this.matrix);
    }
    for (const child of this.children) child.updateMatrixWorld(force);
    return this;
  }
  updateWorldMatrix(updateParents: boolean, updateChildren: boolean) {
    if (updateParents && this.parent) this.parent.updateWorldMatrix(true, false);
    if (this.matrixAutoUpdate) this.updateMatrix();
    if (this.parent) this.matrixWorld.multiplyMatrices(this.parent.matrixWorld, this.matrix);
    else this.matrixWorld.copy(this.matrix);
    if (updateChildren) for (const child of this.children) child.updateWorldMatrix(false, true);
    return this;
  }
  localToWorld(vector: Vector3) {
    this.updateWorldMatrix(true, false);
    return vector.applyMatrix4(this.matrixWorld);
  }
  worldToLocal(vector: Vector3) {
    this.updateWorldMatrix(true, false);
    return vector.applyMatrix4(new Matrix4().copy(this.matrixWorld).invert());
  }
  // Cameras and lights face -Z; other objects face +Z. Construct an upright
  // basis so crossing the far side of an orbit does not introduce roll.
  lookAt(target, y?: number, z?: number) {
    const pos = transformPoint(worldMatrixOf(this), 0, 0, 0);
    const tp = typeof target === 'number' ? [target, y, z]
      : target && target.isVector3 ? [target.x, target.y, target.z]
      : target ? transformPoint(worldMatrixOf(target), 0, 0, 0) : [0, 0, 0];
    let dx = tp[0] - pos[0], dy = tp[1] - pos[1], dz = tp[2] - pos[2];
    const len = Math.hypot(dx, dy, dz) || 1;
    dx /= len; dy /= len; dz /= len;
    if (!this.isCamera && !this.isLight) { dx = -dx; dy = -dy; dz = -dz; }
    let zx = -dx, zy = -dy, zz = -dz;
    let rx = zz, rz = -zx;
    let rl = Math.hypot(rx, rz);
    if (rl < 1e-9) { zx += 1e-6; const l = Math.hypot(zx, zy, zz); zx /= l; zy /= l; zz /= l; rx = zz; rz = -zx; rl = Math.hypot(rx, rz); }
    rx /= rl; rz /= rl;
    const ux = zy * rz, uy = zz * rx - zx * rz, uz = -zy * rx;
    this.quaternion.setFromRotationMatrix([rx, 0, rz, 0, ux, uy, uz, 0, zx, zy, zz, 0, 0, 0, 0, 1]);
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
  // Local-axis rotations/translations, matching three.js Object3D helpers.
  rotateOnAxis(axis: Vector3, angle: number) {
    _rotQuat.setFromAxisAngle(axis, angle);
    this.quaternion.multiply(_rotQuat);
    return this;
  }
  rotateOnWorldAxis(axis: Vector3, angle: number) {
    _rotQuat.setFromAxisAngle(axis, angle);
    this.quaternion.premultiply(_rotQuat);
    return this;
  }
  rotateX(angle: number) { return this.rotateOnAxis(_axisX, angle); }
  rotateY(angle: number) { return this.rotateOnAxis(_axisY, angle); }
  rotateZ(angle: number) { return this.rotateOnAxis(_axisZ, angle); }
  translateX(distance: number) { return this.translateOnAxis(_axisX, distance); }
  translateY(distance: number) { return this.translateOnAxis(_axisY, distance); }
  translateZ(distance: number) { return this.translateOnAxis(_axisZ, distance); }
  translateOnAxis(axis: Vector3, distance: number) {
    _rotVec.copy(axis).applyQuaternion(this.quaternion);
    this.position.addScaledVector(_rotVec, distance);
    return this;
  }
  // --- three.js parity helpers -------------------------------------------------
  // Prototype accessors (three r180 exposes these on the prototype too).
  get onBeforeRender() { return this._onBeforeRender ?? null; }
  set onBeforeRender(v: Function | null) { this._onBeforeRender = v; }
  get onAfterRender() { return this._onAfterRender ?? null; }
  set onAfterRender(v: Function | null) { this._onAfterRender = v; }
  get onBeforeShadow() { return this._onBeforeShadow ?? null; }
  set onBeforeShadow(v: Function | null) { this._onBeforeShadow = v; }
  get onAfterShadow() { return this._onAfterShadow ?? null; }
  set onAfterShadow(v: Function | null) { this._onAfterShadow = v; }
  _onBeforeRender: Function | null = null;
  _onAfterRender: Function | null = null;
  _onBeforeShadow: Function | null = null;
  _onAfterShadow: Function | null = null;
  applyMatrix4(m: Matrix4) {
    // Transform the world transform, then fold back into the local TRS.
    this.updateWorldMatrix(true, false);
    const world = new Matrix4().multiplyMatrices(m.elements || m, this.matrixWorld);
    const local = this.parent
      ? world.premultiply(new Matrix4().copy(this.parent.matrixWorld).invert())
      : world;
    local.decompose(this.position, this.quaternion, this.scale);
    this.updateMatrix();
    return this;
  }
  applyQuaternion(q: Quaternion) {
    // World-space rotation premultiplied onto the local quaternion.
    const world = new Quaternion().setFromRotationMatrix(worldMatrixOf(this));
    world.premultiply(q);
    this.quaternion.copy(world);
    return this;
  }
  setRotationFromAxisAngle(axis: Vector3, angle: number) {
    this.quaternion.setFromAxisAngle(axis, angle);
    return this;
  }
  setRotationFromEuler(euler: Euler) {
    this.quaternion.setFromEuler(euler);
    this.rotation.copy(euler);
    return this;
  }
  setRotationFromMatrix(m: Matrix4) {
    this.quaternion.setFromRotationMatrix(m);
    return this;
  }
  setRotationFromQuaternion(q: Quaternion) {
    this.quaternion.copy(q);
    return this;
  }
  // Reparent keeping the world transform (three.Object3D.attach).
  attach(object: Object3D) {
    this.updateWorldMatrix(true, false);
    object.updateWorldMatrix(true, false);
    const world = object.matrixWorld.clone();
    const inv = new Matrix4().copy(this.matrixWorld).invert();
    const local = world.premultiply(inv);
    local.decompose(object.position, object.quaternion, object.scale);
    object.updateMatrix();
    this.add(object);
    return this;
  }
  getObjectById(id: number) {
    if (this.id === id) return this;
    for (const child of this.children) {
      const found = child.getObjectById(id);
      if (found) return found;
    }
    return null;
  }
  getObjectsByProperty(name: string, value: any, result: Object3D[] = []) {
    if ((this as any)[name] === value) result.push(this);
    for (const child of this.children) child.getObjectsByProperty(name, value, result);
    return result;
  }
  getWorldScale(target = new Vector3()) {
    const m = worldMatrixOf(this);
    return target.set(
      Math.hypot(m[0], m[1], m[2]),
      Math.hypot(m[4], m[5], m[6]),
      Math.hypot(m[8], m[9], m[10]),
    );
  }
  // Copy transform + common fields; recursive clones children like three.
  copy(source: Object3D, recursive = true) {
    this.name = source.name;
    this.position.copy(source.position);
    this.quaternion.copy(source.quaternion);
    this.scale.copy(source.scale);
    this.rotation.copy(source.rotation);
    this.visible = source.visible;
    this.castShadow = source.castShadow;
    this.receiveShadow = source.receiveShadow;
    this.renderOrder = source.renderOrder;
    this.frustumCulled = source.frustumCulled;
    this.matrixAutoUpdate = source.matrixAutoUpdate;
    this.userData = JSON.parse(JSON.stringify(source.userData || {}));
    if (recursive) {
      for (const child of source.children) this.add(child.clone(true));
    }
    return this;
  }
  clone(recursive = true) {
    return new (this as any).constructor().copy(this, recursive);
  }
  raycast(raycaster: any, intersects: any[] = []) { return intersects; }
  updateMorphTargets() { return this; }
  dispose() {}
  toJSON(meta: any = {}) {
    return {
      uuid: this.uuid,
      type: (this as any).type || this.constructor.name,
      name: this.name,
      matrix: Array.from(this.matrix.elements),
      children: this.children.map(c => c.toJSON ? c.toJSON(meta) : null).filter(Boolean),
    };
  }
}

export class Group extends Object3D {
  constructor() { super(); this.isGroup = true; }
}

export class Scene extends Object3D {
  background: any;
  fog: any;
  environment: any;
  environmentIntensity: number;
  environmentRotation: number;
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


/* --- lights ------------------------------------------------------------------- */

export class Light extends Object3D {
  color: Color;
  intensity: number;
  constructor(color: any = 0xffffff, intensity = 1) {
    super();
    this.isLight = true;
    this.color = color instanceof Color ? color : new Color(color);
    this.intensity = intensity;
  }
}

export class AmbientLight extends Light {
  isAmbientLight: boolean;
  constructor(color: any = 0xffffff, intensity = 1) { super(color, intensity); this.isAmbientLight = true; }
}

export class HemisphereLight extends Light {
  isHemisphereLight: boolean;
  groundColor: Color;
  constructor(skyColor: any = 0xffffff, groundColor: any = 0x444444, intensity = 1) {
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
  mapSize: Vector2;
  bias: number;
  normalBias: number;
  radius: number;
  camera: { left: number; right: number; top: number; bottom: number; near: number; far: number; updateProjectionMatrix(): void };
  map: any;
  mapPass: any;
  autoUpdate: boolean;
  needsUpdate: boolean;
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
  isDirectionalLight: boolean;
  target: Object3D;
  shadow: DirectionalLightShadow;
  constructor(color: any = 0xffffff, intensity = 1) {
    super(color, intensity);
    this.isDirectionalLight = true;
    this.target = new Object3D();
    this.shadow = new DirectionalLightShadow();
  }
}

export class PointLight extends Light {
  isPointLight: boolean;
  distance: number;
  decay: number;
    get power() { return (this as any).intensity * 4 * Math.PI; }
  set power(v: number) { (this as any).intensity = v / (4 * Math.PI); }
  constructor(color: any = 0xffffff, intensity = 1, distance = 0, decay = 2) {
    super(color, intensity);
    this.isPointLight = true;
    this.distance = distance;
    this.decay = decay;
  }
}

export class SpotLight extends Light {
  isSpotLight: boolean;
  distance: number;
  angle: number;
  penumbra: number;
  decay: number;
  target: Object3D;
    get power() { return (this as any).intensity * 4 * Math.PI; }
  set power(v: number) { (this as any).intensity = v / (4 * Math.PI); }
  constructor(color: any = 0xffffff, intensity = 1, distance = 0, angle = Math.PI / 3, penumbra = 0, decay = 2) {
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
  isRectAreaLight: boolean;
    get power() { return (this as any).intensity * 4 * Math.PI; }
  set power(v: number) { (this as any).intensity = v / (4 * Math.PI); }
  constructor(color: any = 0xffffff, intensity = 1) { super(color, intensity); this.isRectAreaLight = true; }
}

/* --- cameras -------------------------------------------------------------------- */

export class PerspectiveCamera extends Object3D {
  isPerspectiveCamera: boolean;
  fov: number;
  aspect: number;
  near: number;
  far: number;
  view?: any;
  projectionMatrix: Matrix4;
  _filmWidth?: number;
  _filmHeight?: number;
  _reversedDepth?: boolean;
  constructor(fov = 50, aspect = 1, near = 0.1, far = 2000) {
    super();
    this.isCamera = true; this.isPerspectiveCamera = true;
    this.fov = fov; this.aspect = aspect; this.near = near; this.far = far;
    this.projectionMatrix = new Matrix4();
    this.updateProjectionMatrix();
  }
  updateProjectionMatrix() {
    const fov = this.fov * Math.PI / 180;
    this.projectionMatrix = new Matrix4().makePerspective(fov, this.aspect, this.near, this.far);
    const v = this.view;
    if (v && v.enabled) {
      // Off-axis frustum for setViewOffset: shift the projection so only the
      // sub-rectangle renders, like three's updateProjectionMatrix.
      const e = this.projectionMatrix.elements;
      const fullW = v.fullWidth, fullH = v.fullHeight;
      const w = v.width, h = v.height;
      const x = v.offsetX, y = v.offsetY;
      e[8] = (2 * x + w) / fullW - 1;
      e[9] = 1 - (2 * y + h) / fullH;
      e[0] *= fullW / w;
      e[5] *= fullH / h;
    }
    return this;
  }
  // Film/gate math matching three.js PerspectiveCamera.
  get filmWidth() { return this._filmWidth ?? 35; }
  set filmWidth(v) { this._filmWidth = v; this.updateProjectionMatrix(); }
  get filmHeight() { return this._filmHeight ?? 0; }
  set filmHeight(v) { this._filmHeight = v; this.updateProjectionMatrix(); }
  getViewSize(target = new Vector2()) {
    const h = this.getFilmHeight();
    const w = h * this.aspect;
    return target.set(w, h);
  }
  getViewBounds(target = new Vector4()) {
    const v = this.getViewSize(_perspSize);
    return target.set(-v.x / 2, -v.y / 2, v.x / 2, v.y / 2);
  }
  getFilmWidth() { return this._filmHeight ? this._filmHeight * this.aspect : 35; }
  getFilmHeight() { return this._filmHeight ?? (35 / this.aspect); }
  getFocalLength() {
    const vFov = this.fov * Math.PI / 180;
    return (this.getFilmHeight() / 2) / Math.tan(vFov / 2);
  }
  setFocalLength(focalLength: number) {
    const vExtentSlope = (this.getFilmHeight() / 2) / focalLength;
    this.fov = 2 * Math.atan(vExtentSlope) * 180 / Math.PI;
    this.updateProjectionMatrix();
    return this;
  }
  getEffectiveFOV() { return this.fov; }
  get reversedDepth() { return this._reversedDepth ?? false; }
  set reversedDepth(v) { this._reversedDepth = v; this.updateProjectionMatrix(); }
}
const _perspSize = new Vector2();

// camera.setViewOffset / clearViewOffset (three.js): render only a
// sub-rectangle of a larger virtual image through an off-axis frustum.
// Shared by perspective and orthographic cameras.
const cameraViewOffset = {
  setViewOffset(fullWidth, fullHeight, x, y, width, height) {
    this.view = { enabled: true, fullWidth, fullHeight, offsetX: x, offsetY: y, width, height };
    if (this.updateProjectionMatrix) this.updateProjectionMatrix();
    return this;
  },
  clearViewOffset() { this.view = null; if (this.updateProjectionMatrix) this.updateProjectionMatrix(); return this; },
};
Object.assign(PerspectiveCamera.prototype, cameraViewOffset);

export class OrthographicCamera extends Object3D {
  _reversedDepth?: boolean;
  get reversedDepth() { return this._reversedDepth ?? false; }
  set reversedDepth(v) { this._reversedDepth = v; this.updateProjectionMatrix(); }
  isOrthographicCamera: boolean;
  left: number;
  right: number;
  top: number;
  bottom: number;
  near: number;
  far: number;
  view?: any;
  projectionMatrix: Matrix4;
  constructor(left = -1, right = 1, top = 1, bottom = -1, near = 0.1, far = 2000) {
    super();
    this.isCamera = true; this.isOrthographicCamera = true;
    this.left = left; this.right = right; this.top = top; this.bottom = bottom;
    this.near = near; this.far = far;
    this.projectionMatrix = new Matrix4();
    this.updateProjectionMatrix();
  }
  updateProjectionMatrix() {
    this.projectionMatrix = new Matrix4().makeOrthographic(this.left, this.right, this.bottom, this.top, this.near, this.far);
    const v = this.view;
    if (v && v.enabled) {
      const e = this.projectionMatrix.elements;
      e[12] = -(2 * v.offsetX + v.width) / v.fullWidth + 1;
      e[13] = (2 * v.offsetY + v.height) / v.fullHeight - 1;
      e[0] *= v.fullWidth / v.width;
      e[5] *= v.fullHeight / v.height;
    }
    return this;
  }
}
Object.assign(OrthographicCamera.prototype, cameraViewOffset);

// CubeCamera renders the scene into six faces of a cube render target.
// The gs3d engine has no cube render targets yet, so update() is a stub that
// keeps the API shape; render targets passed in are honoured if present.
export class CubeCamera extends Object3D {
  updateCoordinateSystem() { return this; }
  isCubeCamera: boolean;
  renderTarget: any;
  near: number;
  far: number;
  constructor(near = 0.1, far = 2000, renderTarget?: any) {
    super();
    this.isCubeCamera = true;
    this.near = near; this.far = far;
    this.renderTarget = renderTarget || null;
    for (let i = 0; i < 6; i++) {
      const cam = new PerspectiveCamera(90, 1, near, far);
      cam.name = 'cube' + i;
      this.add(cam);
    }
  }
  getRenderTarget() { return this.renderTarget; }
  update(renderer: any, scene: any) { /* no cube targets in gs3d yet */ return this; }
}

export class Camera extends Object3D {
  get reversedDepth() { return false; }
  near: number;
  far: number;
  aspect: number;
  fov: number;
  constructor() {
    super(); this.isCamera = true;
    // Defaults so a bare Camera still yields a sane engine projection; the
    // drawing shaders of compute passes ignore the matrices anyway.
    this.near = 0.1; this.far = 2000; this.aspect = 1; this.fov = 50;
  }
}


/* --- fog ------------------------------------------------------------------------- */

export class Fog {
  clone() { return new Fog(this.color.clone ? this.color.clone() : this.color, this.near, this.far); }
  toJSON() { return { color: this.color.getHex ? this.color.getHex() : this.color, near: this.near, far: this.far }; }
  isFog: boolean;
  color: Color;
  near: number;
  far: number;
  constructor(color: any = 0xffffff, near = 1, far = 1000) {
    this.isFog = true;
    this.color = color instanceof Color ? color : new Color(color);
    this.near = near; this.far = far;
  }
}
export class FogExp2 {
  clone() { return new FogExp2(this.color.clone ? this.color.clone() : this.color, this.density); }
  toJSON() { return { color: this.color.getHex ? this.color.getHex() : this.color, density: this.density }; }
  isFogExp2: boolean;
  color: Color;
  density: number;
  constructor(color: any = 0xffffff, density = 0.00025) {
    this.isFogExp2 = true;
    this.color = color instanceof Color ? color : new Color(color);
    this.density = density;
  }
}

