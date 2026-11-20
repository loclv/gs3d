// TypeScript declarations for the Three.js-compatible facade in three.js.
// This is a deliberate subset of the three.js API — see three.js for scope.

export class Color {
  constructor(r?: number | string | Color, g?: number, b?: number);
  readonly isColor: true;
  r: number; g: number; b: number;
  set(value: number | string | Color, g?: number, b?: number): this;
  setHex(hex: number): this;
  setRGB(r: number, g: number, b: number): this;
  setStyle(style: string): this;
  copy(color: Color): this;
  clone(): Color;
  getHex(): number;
  getHexString(): string;
  getStyle(): string;
  lerp(color: Color, alpha: number): this;
  getHSL(target?: { h: number; s: number; l: number }): { h: number; s: number; l: number };
  offsetHSL(h: number, s: number, l: number): this;
}

export class Vector2 {
  constructor(x?: number, y?: number);
  readonly isVector2: true;
  x: number; y: number;
  set(x: number, y: number): this;
  setScalar(s: number): this;
  copy(v: Vector2): this;
  clone(): Vector2;
  add(v: Vector2): this;
  sub(v: Vector2): this;
  multiplyScalar(s: number): this;
  divideScalar(s: number): this;
  negate(): this;
  dot(v: Vector2): number;
  cross(v: Vector2): number;
  length(): number;
  lengthSq(): number;
  normalize(): this;
  distanceTo(v: Vector2): number;
  distanceToSquared(v: Vector2): number;
  lerp(v: Vector2, alpha: number): this;
  clamp(min: Vector2, max: Vector2): this;
  equals(v: Vector2): boolean;
}

export class Vector3 {
  constructor(x?: number, y?: number, z?: number);
  readonly isVector3: true;
  x: number; y: number; z: number;
  set(x: number, y: number, z: number): this;
  setScalar(s: number): this;
  copy(v: Vector3): this;
  clone(): Vector3;
  add(v: Vector3): this;
  addVectors(a: Vector3, b: Vector3): this;
  addScaledVector(v: Vector3, scale: number): this;
  sub(v: Vector3): this;
  subVectors(a: Vector3, b: Vector3): this;
  multiplyScalar(s: number): this;
  divideScalar(s: number): this;
  min(v: Vector3): this;
  max(v: Vector3): this;
  clamp(min: Vector3, max: Vector3): this;
  equals(v: Vector3): boolean;
  length(): number;
  lengthSq(): number;
  normalize(): this;
  distanceTo(v: Vector3): number;
  distanceToSquared(v: Vector3): number;
  dot(v: Vector3): number;
  cross(v: Vector3): this;
  crossVectors(a: Vector3, b: Vector3): this;
  lerp(v: Vector3, alpha: number): this;
  negate(): this;
  fromArray(a: ArrayLike<number>, offset?: number): this;
  toArray(a?: number[], offset?: number): number[];
  applyQuaternion(q: Quaternion): this;
  applyEuler(e: Euler): this;
  applyAxisAngle(axis: Vector3, angle: number): this;
  applyMatrix4(m: Matrix4): this;
  transformDirection(m: Matrix4): this;
  setFromMatrixPosition(m: Matrix4 | ArrayLike<number>): this;
}

export class Euler {
  constructor(x?: number, y?: number, z?: number, order?: string);
  readonly isEuler: true;
  x: number; y: number; z: number; order: string;
  set(x: number, y: number, z: number, order?: string): this;
  copy(e: Euler): this;
  clone(): Euler;
}

export class Quaternion {
  constructor(x?: number, y?: number, z?: number, w?: number);
  readonly isQuaternion: true;
  x: number; y: number; z: number; w: number;
  set(x: number, y: number, z: number, w: number): this;
  copy(q: Quaternion): this;
  clone(): Quaternion;
  identity(): this;
  setFromEuler(e: Euler): this;
  setFromAxisAngle(axis: Vector3, angle: number): this;
  setFromRotationMatrix(m: ArrayLike<number>): this;
  normalize(): this;
  dot(q: Quaternion): number;
  multiply(q: Quaternion): this;
  premultiply(q: Quaternion): this;
  conjugate(): this;
  invert(): this;
  slerp(qb: Quaternion, t: number): this;
}

export class BufferAttribute {
  constructor(array: ArrayLike<number>, itemSize: number, normalized?: boolean);
  readonly isBufferAttribute: true;
  array: ArrayLike<number>;
  itemSize: number;
  normalized: boolean;
  count: number;
}
export class Float32BufferAttribute extends BufferAttribute {}
export class Uint16BufferAttribute extends BufferAttribute {}
export class Uint32BufferAttribute extends BufferAttribute {}

export class BufferGeometry {
  readonly isBufferGeometry: true;
  attributes: Record<string, BufferAttribute>;
  index: BufferAttribute | null;
  groups: Array<{ start: number; count: number; materialIndex?: number }>;
  drawRange: { start: number; count: number };
  setDrawRange(start: number, count: number): this;
  boundingBox: Box3 | null;
  boundingSphere: Sphere | null;
  version: number;
  setAttribute(name: string, attribute: BufferAttribute): this;
  getAttribute(name: string): BufferAttribute | undefined;
  deleteAttribute(name: string): this;
  getIndex(): BufferAttribute | null;
  setIndex(index: ArrayLike<number> | BufferAttribute | null): this;
  addGroup(start: number, count: number, materialIndex?: number): this;
  clearGroups(): this;
  rotateX(angle: number): this;
  rotateY(angle: number): this;
  rotateZ(angle: number): this;
  translate(x: number, y: number, z: number): this;
  scale(x: number, y: number, z: number): this;
  center(): this;
  applyMatrix4(matrix: Matrix4): this;
  clone(): BufferGeometry;
  computeVertexNormals(): this;
  computeBoundingBox(): this;
  computeBoundingSphere(): this;
  dispose(): void;
}

export class BoxGeometry extends BufferGeometry {
  constructor(width?: number, height?: number, depth?: number,
    widthSegments?: number, heightSegments?: number, depthSegments?: number);
}
export class SphereGeometry extends BufferGeometry {
  constructor(radius?: number, widthSegments?: number, heightSegments?: number,
    phiStart?: number, phiLength?: number, thetaStart?: number, thetaLength?: number);
}
export class PlaneGeometry extends BufferGeometry {
  constructor(width?: number, height?: number, widthSegments?: number, heightSegments?: number);
}
export class CircleGeometry extends BufferGeometry {
  constructor(radius?: number, segments?: number, thetaStart?: number, thetaLength?: number);
}
export class RingGeometry extends BufferGeometry {
  constructor(innerRadius?: number, outerRadius?: number, thetaSegments?: number,
    phiSegments?: number, thetaStart?: number, thetaLength?: number);
}
export class CylinderGeometry extends BufferGeometry {
  constructor(radiusTop?: number, radiusBottom?: number, height?: number,
    radialSegments?: number, heightSegments?: number, openEnded?: boolean,
    thetaStart?: number, thetaLength?: number);
}
export class TorusGeometry extends BufferGeometry {
  constructor(radius?: number, tube?: number, radialSegments?: number,
    tubularSegments?: number, arc?: number);
}
export class ConeGeometry extends CylinderGeometry {
  constructor(radius?: number, height?: number, radialSegments?: number,
    heightSegments?: number, openEnded?: boolean, thetaStart?: number, thetaLength?: number);
}
export class CapsuleGeometry extends BufferGeometry {
  constructor(radius?: number, length?: number, capSegments?: number, radialSegments?: number);
}
export class PolyhedronGeometry extends BufferGeometry {
  constructor(vertices: number[][], indices: number[], radius?: number, detail?: number);
}
export class TetrahedronGeometry extends PolyhedronGeometry {
  constructor(radius?: number, detail?: number);
}
export class OctahedronGeometry extends PolyhedronGeometry {
  constructor(radius?: number, detail?: number);
}
export class IcosahedronGeometry extends PolyhedronGeometry {
  constructor(radius?: number, detail?: number);
}
export class DodecahedronGeometry extends PolyhedronGeometry {
  constructor(radius?: number, detail?: number);
}
export class TorusKnotGeometry extends BufferGeometry {
  constructor(radius?: number, tube?: number, tubularSegments?: number,
    radialSegments?: number, p?: number, q?: number);
}
export class LatheGeometry extends BufferGeometry {
  constructor(points?: { x: number; y: number }[] | Vector2[], segments?: number,
    phiStart?: number, phiLength?: number);
}
export class Path {
  constructor();
  readonly isPath: true;
  moveTo(x: number, y: number): this;
  lineTo(x: number, y: number): this;
  quadraticCurveTo(cx: number, cy: number, x: number, y: number): this;
  bezierCurveTo(c1x: number, c1y: number, c2x: number, c2y: number, x: number, y: number): this;
  closePath(): this;
  getPoints(divisions?: number): number[][];
}
export class Shape extends Path {
  constructor();
  readonly isShape: true;
  holes: Path[];
}
export class ShapeGeometry extends BufferGeometry {
  constructor(shape: Shape | Path, curveSegments?: number);
}
export class ExtrudeGeometry extends BufferGeometry {
  constructor(shape: Shape | Path, options?: {
    depth?: number; steps?: number; curveSegments?: number;
    bevelEnabled?: boolean; bevelThickness?: number; bevelSize?: number;
    bevelSegments?: number;
  });
}
export class TubeGeometry extends BufferGeometry {
  constructor(path: { getPoint(t: number): { x: number; y: number; z: number } | number[] },
    tubularSegments?: number, radius?: number, radialSegments?: number, closed?: boolean);
}
export class Curve {
  getPoint(t: number): number[];
  getPointAt(t: number): number[];
}
export class CatmullRomCurve3 extends Curve {
  constructor(points?: ({ x: number; y: number; z: number } | number[])[],
    closed?: boolean, curveType?: string, tension?: number);
}
export const MathUtils: {
  DEG2RAD: number; RAD2DEG: number;
  clamp(v: number, min: number, max: number): number;
  lerp(a: number, b: number, t: number): number;
  mapLinear(v: number, inMin: number, inMax: number, outMin: number, outMax: number): number;
  degToRad(d: number): number;
  radToDeg(r: number): number;
  smoothstep(x: number, min: number, max: number): number;
};

export const FrontSide: 0;
export const BackSide: 1;
export const DoubleSide: 2;

export const RepeatWrapping: 1000;
export const ClampToEdgeWrapping: 1001;
export const MirroredRepeatWrapping: 1002;
export const NearestFilter: 1003;
export const LinearFilter: 1006;
export const NearestMipmapNearestFilter: 1004;
export const NearestMipmapLinearFilter: 1005;
export const LinearMipmapNearestFilter: 1007;
export const LinearMipmapLinearFilter: 1008;

export interface TextureImageSource {
  width: number;
  height: number;
  data?: ArrayLike<number>;
  pixels?: ArrayLike<number>;
}

export class Texture {
  constructor(image?: TextureImageSource | HTMLCanvasElement | HTMLImageElement | ImageBitmap | ImageData | null);
  readonly isTexture: true;
  image: unknown;
  colorSpace: string;
  wrapS: number;
  wrapT: number;
  magFilter: number;
  minFilter: number;
  offset: Vector2;
  repeat: Vector2;
  rotation: number;
  center: Vector2;
  channel: number;
  matrixAutoUpdate: boolean;
  generateMipmaps: boolean;
  version: number;
  needsUpdate: boolean;
  updateMatrix(): this;
  dispose(): void;
}
export class DataTexture extends Texture {
  constructor(data?: ArrayLike<number> | null, width?: number, height?: number);
  readonly isDataTexture: true;
  flipY: boolean;
  unpackAlignment: number;
}
export function checkerTexture(a?: Color | number | string, b?: Color | number | string, cells?: number, size?: number): DataTexture;
export class CanvasTexture extends Texture { readonly isCanvasTexture: true; }
export class CompressedTexture extends Texture { readonly isCompressedTexture: true; }
export class CubeTexture extends Texture {
  readonly isCubeTexture: true;
  images: unknown[];
}
export class TextureLoader {
  constructor();
  manager: unknown;
  load(url: string, onLoad?: (texture: Texture) => void, onProgress?: (event: ProgressEvent) => void, onError?: (error: unknown) => void): this;
}
export class ImageLoader {
  constructor();
  manager: unknown;
  load(url: string, onLoad?: (image: HTMLImageElement) => void, onProgress?: (event: ProgressEvent) => void, onError?: (event: unknown) => void): HTMLImageElement;
}

export class Material {
  constructor(parameters?: Record<string, unknown>);
  readonly isMaterial: true;
  name: string;
  color: Color;
  map: Texture | null;
  vertexColors: boolean;
  flatShading: boolean;
  normalMap: Texture | null;
  normalScale: Vector2;
  roughnessMap: Texture | null;
  metalnessMap: Texture | null;
  emissiveMap: Texture | null;
  aoMap: Texture | null;
  aoMapIntensity: number;
  envMapIntensity: number;
  opacity: number;
  transparent: boolean;
  alphaTest: number;
  side: number;
  visible: boolean;
  dispose(): void;
}
export class MeshBasicMaterial extends Material {
  constructor(parameters?: Record<string, unknown>);
}
export class MeshStandardMaterial extends Material {
  constructor(parameters?: {
    color?: number | string | Color;
    map?: Texture | null;
    vertexColors?: boolean;
    flatShading?: boolean;
    normalMap?: Texture | null;
    normalScale?: Vector2 | number;
    roughnessMap?: Texture | null;
    metalnessMap?: Texture | null;
    emissiveMap?: Texture | null;
    aoMap?: Texture | null;
    aoMapIntensity?: number;
    envMapIntensity?: number;
    metalness?: number;
    roughness?: number;
    emissive?: number | string | Color;
    emissiveIntensity?: number;
    opacity?: number;
    transparent?: boolean;
    alphaTest?: number;
    side?: number;
    ior?: number;
    [key: string]: unknown;
  });
  metalness: number;
  roughness: number;
  emissive: Color;
  emissiveIntensity: number;
  ior: number;
}
export { MeshStandardMaterial as MeshPhysicalMaterial };
export { MeshStandardMaterial as MeshPhongMaterial };
export { MeshStandardMaterial as MeshLambertMaterial };
export { MeshBasicMaterial as MeshNormalMaterial };
export { MeshBasicMaterial as SpriteMaterial };
export { MeshBasicMaterial as PointsMaterial };
export { MeshBasicMaterial as LineBasicMaterial };

export class Matrix4 {
  constructor();
  readonly isMatrix4: true;
  elements: Float64Array;
  set(n11: number, n12: number, n13: number, n14: number,
    n21: number, n22: number, n23: number, n24: number,
    n31: number, n32: number, n33: number, n34: number,
    n41: number, n42: number, n43: number, n44: number): this;
  identity(): this;
  copy(m: Matrix4 | ArrayLike<number>): this;
  clone(): Matrix4;
  compose(position: Vector3, quaternion: Quaternion, scale: Vector3): this;
  multiply(m: Matrix4 | ArrayLike<number>): this;
  multiplyMatrices(a: Matrix4 | ArrayLike<number>, b: Matrix4 | ArrayLike<number>): this;
  invert(): this;
  makeRotationFromQuaternion(q: Quaternion): this;
  makeTranslation(x: number, y: number, z: number): this;
  makeScale(x: number, y: number, z: number): this;
  makeRotationX(theta: number): this;
  makeRotationY(theta: number): this;
  makeRotationZ(theta: number): this;
  lookAt(eye: Vector3, target: Vector3, up: Vector3): this;
  equals(m: Matrix4): boolean;
  setPosition(v: Vector3 | number[]): this;
  extractRotation(): this;
}

export class Layers {
  mask: number;
  set(channel: number): void;
  enable(channel: number): void;
  enableAll(): void;
  toggle(channel: number): void;
  disable(channel: number): void;
  disableAll(): void;
  test(layers: Layers): boolean;
  isEnabled(channel: number): boolean;
}

export class Object3D {
  constructor();
  readonly isObject3D: true;
  name: string;
  position: Vector3;
  rotation: Euler;
  quaternion: Quaternion;
  scale: Vector3;
  children: Object3D[];
  parent: Object3D | null;
  visible: boolean;
  layers: Layers;
  matrixAutoUpdate: boolean;
  matrix: Matrix4;
  matrixWorld: Matrix4;
  userData: Record<string, unknown>;
  add(...objects: Object3D[]): this;
  remove(...objects: Object3D[]): this;
  clear(): this;
  removeFromParent(): this;
  traverse(callback: (object: Object3D) => void): void;
  traverseVisible(callback: (object: Object3D) => void): void;
  getObjectByName(name: string): Object3D | null;
  getObjectByProperty(name: string, value: unknown): Object3D | null;
  traverseAncestors(callback: (object: Object3D) => void): this;
  readonly ancestors: Object3D[];
  updateMatrixWorld(force?: boolean): this;
  updateWorldMatrix(updateParents: boolean, updateChildren: boolean): this;
  updateMatrix(): this;
  localToWorld(vector: Vector3): Vector3;
  worldToLocal(vector: Vector3): Vector3;
  lookAt(target?: Object3D | Vector3): this;
  lookAt(x: number, y: number, z: number): this;
  getWorldPosition(target?: Vector3): Vector3;
  getWorldDirection(target?: Vector3): Vector3;
  getWorldQuaternion(target?: Quaternion): Quaternion;
}
export class Group extends Object3D { constructor(); readonly isGroup: true; }
export class Scene extends Object3D {
  constructor();
  readonly isScene: true;
  background: Color | null;
  fog: Fog | FogExp2 | null;
  environment: Texture | null;
  environmentIntensity: number;
  environmentRotation: number;
}

export class Light extends Object3D {
  constructor(color?: number | string | Color, intensity?: number);
  readonly isLight: true;
  color: Color;
  intensity: number;
}
export class AmbientLight extends Light {
  constructor(color?: number | string | Color, intensity?: number);
  readonly isAmbientLight: true;
}
export class HemisphereLight extends Light {
  constructor(skyColor?: number | string | Color, groundColor?: number | string | Color, intensity?: number);
  readonly isHemisphereLight: true;
  groundColor: Color;
}
export class DirectionalLight extends Light {
  constructor(color?: number | string | Color, intensity?: number);
  readonly isDirectionalLight: true;
  target: Object3D;
}
export class PointLight extends Light {
  constructor(color?: number | string | Color, intensity?: number, distance?: number, decay?: number);
  readonly isPointLight: true;
  distance: number;
  decay: number;
}
export class SpotLight extends Light {
  constructor(color?: number | string | Color, intensity?: number, distance?: number, angle?: number, penumbra?: number, decay?: number);
  readonly isSpotLight: true;
  distance: number;
  angle: number;
  penumbra: number;
  decay: number;
  target: Object3D;
}
export class RectAreaLight extends Light {
  constructor(color?: number | string | Color, intensity?: number);
  readonly isRectAreaLight: true;
}

export class Camera extends Object3D { constructor(); readonly isCamera: true; }
export class PerspectiveCamera extends Camera {
  constructor(fov?: number, aspect?: number, near?: number, far?: number);
  readonly isPerspectiveCamera: true;
  fov: number; aspect: number; near: number; far: number;
  updateProjectionMatrix(): this;
}
export class OrthographicCamera extends Camera {
  constructor(left?: number, right?: number, top?: number, bottom?: number, near?: number, far?: number);
  readonly isOrthographicCamera: true;
  left: number; right: number; top: number; bottom: number; near: number; far: number;
  updateProjectionMatrix(): this;
}

export class Mesh extends Object3D {
  constructor(geometry?: BufferGeometry, material?: Material | Material[]);
  readonly isMesh: true;
  geometry: BufferGeometry;
  material: Material | Material[];
}
export class InstancedMesh extends Mesh {
  constructor(geometry?: BufferGeometry, material?: Material | Material[], count?: number);
  readonly isInstancedMesh: true;
  count: number;
  instanceMatrix: BufferAttribute;
  instanceColor: BufferAttribute | null;
  setMatrixAt(index: number, matrix: Matrix4): void;
  getMatrixAt(index: number, matrix: Matrix4): Matrix4;
  setColorAt(index: number, color: Color): void;
  getColorAt(index: number, color: Color): Color;
  dispose(): void;
}
export class Line extends Object3D {
  constructor(geometry?: BufferGeometry, material?: Material | Material[]);
  readonly isLine: true; geometry: BufferGeometry; material: Material | Material[];
}
export class Points extends Object3D {
  constructor(geometry?: BufferGeometry, material?: Material | Material[]);
  readonly isPoints: true; geometry: BufferGeometry; material: Material | Material[];
}
export class Ray {
  constructor(origin?: Vector3, direction?: Vector3);
  origin: Vector3;
  direction: Vector3;
  set(origin: Vector3, direction: Vector3): this;
  at(t: number, target?: Vector3): Vector3;
  intersectPlane(plane: Plane, target?: Vector3): Vector3 | null;
  intersectBox(box: Box3, target?: Vector3): Vector3 | null;
  intersectsBox(box: Box3): boolean;
  intersectSphere(sphere: Sphere, target?: Vector3): Vector3 | null;
  intersectsSphere(sphere: Sphere): boolean;
  intersectTriangle(a: Vector3, b: Vector3, c: Vector3, backfaceCulling?: boolean, target?: Vector3): Vector3 | null;
}

export interface Intersection {
  distance: number;
  point: Vector3;
  face: { a: number; b: number; c: number; normal: Vector3; materialIndex?: number } | null;
  faceIndex?: number;
  object: Object3D;
  uv: Vector2 | null;
  instanceId?: number;
}

export class Raycaster {
  constructor(origin?: Vector3, direction?: Vector3, near?: number, far?: number);
  ray: Ray;
  near: number;
  far: number;
  camera: Camera | null;
  layers: Layers;
  set(origin: Vector3, direction: Vector3): this;
  setFromCamera(coords: Vector2, camera: Camera): this;
  intersectObject(object: Object3D, recursive?: boolean, target?: Intersection[]): Intersection[];
  intersectObjects(objects: Object3D[], recursive?: boolean, target?: Intersection[]): Intersection[];
}

export class Sphere {
  constructor(center?: Vector3, radius?: number);
  readonly isSphere: true;
  center: Vector3;
  radius: number;
  set(center: Vector3, radius: number): this;
  copy(sphere: Sphere): this;
  clone(): Sphere;
  isEmpty(): boolean;
  makeEmpty(): this;
  containsPoint(point: Vector3): boolean;
  distanceToPoint(point: Vector3): number;
  intersectsSphere(sphere: Sphere): boolean;
  intersectsBox(box: Box3): boolean;
  getBoundingBox(target?: Box3): Box3;
  setFromPoints(points: Vector3[], optionalCenter?: Vector3): this;
}

export class Box3 {
  constructor(min?: Vector3, max?: Vector3);
  readonly isBox3: true;
  min: Vector3;
  max: Vector3;
  set(min: Vector3, max: Vector3): this;
  copy(box: Box3): this;
  makeEmpty(): this;
  isEmpty(): boolean;
  setFromArray(array: ArrayLike<number>): this;
  setFromPoints(points: Vector3[]): this;
  getBoundingSphere(target?: Sphere): Sphere;
  intersectsSphere(sphere: Sphere): boolean;
  getCenter(target?: Vector3): Vector3;
  getSize(target?: Vector3): Vector3;
  expandByPoint(point: Vector3): this;
  expandByScalar(scalar: number): this;
  translate(offset: Vector3): this;
  applyMatrix4(matrix: Matrix4): this;
  containsPoint(point: Vector3): boolean;
  intersectsBox(box: Box3): boolean;
  clone(): Box3;
  setFromObject(object: Object3D): this;
}

export class Sprite extends Object3D {
  constructor(material?: Material | Material[]);
  readonly isSprite: true; material: Material | Material[];
}

export class Fog {
  constructor(color?: number | string | Color, near?: number, far?: number);
  readonly isFog: true;
  color: Color;
  near: number; far: number;
}
export class FogExp2 {
  constructor(color?: number | string | Color, density?: number);
  readonly isFogExp2: true;
  color: Color;
  density: number;
}

export class OrbitControls {
  constructor(object: Camera, domElement: HTMLElement);
  object: Camera;
  domElement: HTMLElement;
  target: Vector3;
  enabled: boolean;
  enableDamping: boolean;
  dampingFactor: number;
  enableZoom: boolean;
  enablePan: boolean;
  enableRotate: boolean;
  rotateSpeed: number;
  zoomSpeed: number;
  panSpeed: number;
  minDistance: number;
  maxDistance: number;
  minPolarAngle: number;
  maxPolarAngle: number;
  screenSpacePanning: boolean;
  addEventListener(type: string, listener: (event: { type: string; target: OrbitControls }) => void): void;
  removeEventListener(type: string, listener: (event: { type: string; target: OrbitControls }) => void): void;
  hasEventListener(type: string, listener: (event: { type: string; target: OrbitControls }) => void): boolean;
  dispatchEvent(event: string | { type: string }): boolean;
  rotateLeft(angle: number): void;
  rotateUp(angle: number): void;
  dollyIn(scale: number): void;
  dollyOut(scale: number): void;
  update(): boolean;
  dispose(): void;
}

/* --- renderer ----------------------------------------------------------------- */

export const NoColorSpace: 'none';
export const SRGBColorSpace: 'srgb';
export const LinearSRGBColorSpace: 'linear';
export const DisplayP3ColorSpace: 'display-p3';

export const NoToneMapping: 0;
export const LinearToneMapping: 1;
export const ReinhardToneMapping: 2;
export const CineonToneMapping: 3;
export const ACESFilmicToneMapping: 4;
export const CustomToneMapping: 5;
export const AgXToneMapping: 6;
export const NeutralToneMapping: 7;

export interface WebGPURendererParameters {
  canvas: HTMLCanvasElement;
  alpha?: boolean;
  antialias?: boolean;
  pixelRatio?: number;
  outputColorSpace?: string;
  toneMapping?: number;
  toneMappingExposure?: number;
  /** Testing/headless hook: a prebuilt engine module instead of the bundled wasm. */
  engine?: unknown;
}

export class WebGPURenderer {
  constructor(parameters: WebGPURendererParameters);
  readonly domElement: HTMLCanvasElement;
  readonly isWebGPURenderer: true;
  readonly backend: { isWebGPUBackend: boolean; isWebGLBackend: boolean };
  outputColorSpace: string;
  toneMapping: number;
  toneMappingExposure: number;
  shadowMap: { enabled: boolean };
  autoClear: boolean;
  info: { autoReset: boolean; reset(): void; render: { calls: number; triangles: number; frame: number }; memory: { geometries: number; textures: number } };
  debug: { checkShaderErrors: boolean; onShaderError: ((gl: unknown, program: unknown, vs: unknown, fs: unknown) => void) | null };
  properties: { get(obj: object): Record<string, unknown> };
  init(): Promise<unknown>;
  render(scene: Scene, camera: Camera): void;
  getContext(): WebGL2RenderingContext | null;
  setViewport(x: number, y: number, width: number, height: number): this;
  setScissor(x: number, y: number, width: number, height: number): this;
  setScissorTest(enable: boolean): this;
  clear(color?: boolean, depth?: boolean, stencil?: boolean): this;
  compile(scene: Object3D, camera?: Camera): Set<unknown>;
  compileAsync(scene: Object3D, camera?: Camera): Promise<Set<unknown>>;
  setAnimationLoop(callback: ((time: number) => void) | null): this;
  setPixelRatio(value: number): this;
  getPixelRatio(): number;
  setSize(width: number, height: number, updateStyle?: boolean): this;
  getSize(target?: Vector2): Vector2;
  setOutputColorSpace(space: string): this;
  setToneMapping(mode: number | string): this;
  setClearColor(color: number | string | Color, alpha?: number): this;
  dispose(): void;
}

/* --- shader materials, render targets and blend state -----------------------
   Added with the raw-shader and render-target paths; still a subset. */

export const NoBlending: 0;
export const NormalBlending: 1;
export const AdditiveBlending: 2;
export const SubtractiveBlending: 3;
export const MultiplyBlending: 4;
export const CustomBlending: 5;

export const GLSL1: '100';
export const GLSL3: '300';

export const ZeroFactor: 0;
export const OneFactor: 1;
export const SrcColorFactor: 2;
export const OneMinusSrcColorFactor: 3;
export const SrcAlphaFactor: 4;
export const OneMinusSrcAlphaFactor: 5;
export const DstAlphaFactor: 6;
export const OneMinusDstAlphaFactor: 7;
export const DstColorFactor: 8;
export const OneMinusDstColorFactor: 9;
export const SrcAlphaSaturateFactor: 10;

export const AddEquation: 100;
export const SubtractEquation: 101;
export const ReverseSubtractEquation: 102;
export const MinEquation: 103;
export const MaxEquation: 104;

export class ShaderMaterial extends Material {
  constructor(parameters?: {
    defines?: Record<string, string | number | boolean>;
    uniforms?: Record<string, { value: unknown }>;
    vertexShader?: string;
    fragmentShader?: string;
    blending?: number;
    side?: number;
    transparent?: boolean;
    depthWrite?: boolean;
    depthTest?: boolean;
    [key: string]: unknown;
  });
  readonly isShaderMaterial: true;
  uniforms: Record<string, { value: unknown }>;
  vertexShader: string;
  fragmentShader: string;
  blending: number;
  side: number;
  transparent: boolean;
  depthWrite: boolean;
  depthTest: boolean;
}
export class RawShaderMaterial extends ShaderMaterial {
  readonly isRawShaderMaterial: true;
}

export interface WebGLRenderTargetOptions {
  depthBuffer?: boolean;
  stencilBuffer?: boolean;
  count?: number;
  minFilter?: number;
  magFilter?: number;
  wrapS?: number;
  wrapT?: number;
  wrap?: number;
  type?: number;
}
export class WebGLRenderTarget {
  constructor(width?: number, height?: number, options?: WebGLRenderTargetOptions);
  readonly isRenderTarget: true;
  width: number;
  height: number;
  depthBuffer: boolean;
  texture: Texture;
  textures: Texture[];
  viewport: Vector4;
  scissor: Vector4;
  scissorTest: boolean;
  setSize(width: number, height: number): this;
  dispose(): void;
}

export class Data3DTexture extends Texture {
  constructor(data?: ArrayLike<number> | null, width?: number, height?: number, depth?: number);
  readonly isData3DTexture: true;
}

export class PMREMGenerator {
  constructor(renderer: WebGPURenderer);
  fromScene(scene: Scene, sigma?: number, near?: number, far?: number, options?: { size?: number }): { texture: Texture; dispose(): void };
  fromEquirectangular(texture: Texture): { texture: Texture; dispose(): void };
}

export class RoomEnvironment extends Scene {
  constructor();
}

export interface RendererExtensions {
  has(name: string): boolean;
}
export interface RendererCapabilities {
  maxTextureSize: number;
  getMaxAnisotropy(): number;
}

export interface WebGPURenderer {
  readonly extensions: RendererExtensions;
  readonly capabilities: RendererCapabilities;
  clear(color?: boolean, depth?: boolean, stencil?: boolean): this;
  setRenderTarget(renderTarget: WebGLRenderTarget | null): this;
  getRenderTarget(): WebGLRenderTarget | null;
  compile?(scene: Scene, camera: Camera): void;
}
