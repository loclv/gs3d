import { Color } from './color';
import { Vector2, Vector3, Euler, Quaternion, Matrix4, transformPoint, transformDir, normalize3 } from './math';
import { releaseEngineTree, localMatrixOf, worldMatrixOf } from './bridge';

/* --- scene graph ---------------------------------------------------------- */

export class Object3D {
  isObject3D: boolean;
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
    this.isObject3D = true;
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
  // Cameras and lights face -Z; other objects face +Z. Construct an upright
  // basis so crossing the far side of an orbit does not introduce roll.
  lookAt(target) {
    const pos = transformPoint(worldMatrixOf(this), 0, 0, 0);
    const tp = target && target.isVector3 ? [target.x, target.y, target.z]
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
  isOrthographicCamera: boolean;
  left: number;
  right: number;
  top: number;
  bottom: number;
  near: number;
  far: number;
  view?: any;
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
  isFogExp2: boolean;
  color: Color;
  density: number;
  constructor(color: any = 0xffffff, density = 0.00025) {
    this.isFogExp2 = true;
    this.color = color instanceof Color ? color : new Color(color);
    this.density = density;
  }
}

