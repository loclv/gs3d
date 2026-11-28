// compat.ts — Three.js r180 API surface additions that have no engine backing.
// These exist for API parity: constants mirror three's values exactly; classes
// are functional facade objects that either delegate to existing classes or
// store state without GPU-side effects.

import {
  Texture, DataTexture, CubeTexture, CompressedTexture,
  WebGLRenderTarget,
} from './textures';
import { Curve, Path, Shape } from './shapes';
import { Object3D, Camera, PerspectiveCamera } from './scene';
import { Mesh, BufferGeometry, BufferAttribute, InterleavedBuffer } from './geometry';
import { HemisphereLight } from './scene';
import { Vector2, Vector3, Matrix4 } from './math';
import { Color } from './color';
import { EventDispatcher } from './events';
import { AnimationClip } from './animation';
import { Loader, FileLoader } from './loaders';
import { ImageLoader } from './textures';
import { RGBAFormat, UnsignedByteType, NearestFilter } from './textures';

// ---------------------------------------------------------------------------
// Constants (values mirrored from three r180)
// ---------------------------------------------------------------------------

export const AddOperation = 2;
export const AlwaysCompare = 519;
export const AttachedBindMode = "attached";
export const BasicDepthPacking = 3200;
export const ConstantAlphaFactor = 213;
export const ConstantColorFactor = 211;
export const CubeReflectionMapping = 301;
export const CubeRefractionMapping = 302;
export const CubeUVReflectionMapping = 306;
export const CullFaceBack = 1;
export const CullFaceFront = 2;
export const CullFaceFrontBack = 3;
export const CullFaceNone = 0;
export const DetachedBindMode = "detached";
export const EqualCompare = 514;
export const EquirectangularReflectionMapping = 303;
export const EquirectangularRefractionMapping = 304;
export const GreaterCompare = 516;
export const GreaterEqualCompare = 518;
export const LessCompare = 513;
export const LessEqualCompare = 515;
export const LinearMipMapLinearFilter = 1008;
export const LinearMipMapNearestFilter = 1007;
export const LinearTransfer = "linear";
export const MixOperation = 0;
export const MultiplyOperation = 1;
export const NearestMipMapLinearFilter = 1006;
export const NearestMipMapNearestFilter = 1005;
export const NeverCompare = 512;
export const NotEqualCompare = 517;
export const ObjectSpaceNormalMap = 1;
export const OneMinusConstantAlphaFactor = 215;
export const OneMinusConstantColorFactor = 214;
export const RED_GREEN_RGTC2_Format = 1035;
export const RED_RGTC1_Format = 1034;
export const RGBADepthPacking = 3202;
export const RGBA_ASTC_10x10_Format = 37808;
export const RGBA_ASTC_10x5_Format = 37809;
export const RGBA_ASTC_10x6_Format = 37810;
export const RGBA_ASTC_10x8_Format = 37811;
export const RGBA_ASTC_12x10_Format = 37812;
export const RGBA_ASTC_12x12_Format = 37813;
export const RGBA_ASTC_4x4_Format = 37814;
export const RGBA_ASTC_5x4_Format = 37815;
export const RGBA_ASTC_5x5_Format = 37816;
export const RGBA_ASTC_6x5_Format = 37817;
export const RGBA_ASTC_6x6_Format = 37818;
export const RGBA_ASTC_8x5_Format = 37819;
export const RGBA_ASTC_8x6_Format = 37820;
export const RGBA_ASTC_8x8_Format = 37821;
export const RGBA_BPTC_Format = 36492;
export const RGBA_ETC2_EAC_Format = 37492;
export const RGBA_PVRTC_2BPPV1_Format = 35843;
export const RGBA_PVRTC_4BPPV1_Format = 35840;
export const RGBA_S3TC_DXT1_Format = 33777;
export const RGBA_S3TC_DXT3_Format = 33778;
export const RGBA_S3TC_DXT5_Format = 33779;
export const RGBDepthPacking = 3201;
export const RGB_BPTC_SIGNED_Format = 36494;
export const RGB_BPTC_UNSIGNED_Format = 36493;
export const RGB_ETC1_Format = 36196;
export const RGB_ETC2_Format = 37490;
export const RGB_PVRTC_2BPPV1_Format = 35842;
export const RGB_PVRTC_4BPPV1_Format = 35841;
export const RGB_S3TC_DXT1_Format = 33776;
export const RGDepthPacking = 3203;
export const SIGNED_RED_GREEN_RGTC2_Format = 1037;
export const SIGNED_RED_RGTC1_Format = 1036;
export const SRGBTransfer = "srgb";
export const TangentSpaceNormalMap = 0;
export const TriangleFanDrawMode = 6;
export const TriangleStripDrawMode = 5;
export const TrianglesDrawMode = 4;
export const UVMapping = 300;
export const WebGLCoordinateSystem = 2000;
export const WebGPUCoordinateSystem = 2001;

// Small enum objects
export const MOUSE = { LEFT: 0, MIDDLE: 1, RIGHT: 2, ROTATE: 0, DOLLY: 1, PAN: 2 };
export const TOUCH = { ROTATE: 0, PAN: 1, DOLLY_PAN: 2, DOLLY_ROTATE: 3 };
export const InterpolationSamplingMode = { LINEAR: 1, NEAREST: 0 };
export const InterpolationSamplingType = { COLORSPACE: 2, SEPARATOR: 1, ASSIGN: 0 };
export const TimestampQuery = { NONE: 0, WAIT: 1, INVERT: 2 };

// ---------------------------------------------------------------------------
// 2D / spherical coordinates
// ---------------------------------------------------------------------------

export class Spherical {
  isSpherical = true;
  radius: number; phi: number; theta: number;
  constructor(radius = 1, phi = 0, theta = 0) { this.radius = radius; this.phi = phi; this.theta = theta; }
  set(radius: number, phi: number, theta: number) { this.radius = radius; this.phi = phi; this.theta = theta; return this; }
  copy(other: Spherical) { this.radius = other.radius; this.phi = other.phi; this.theta = other.theta; return this; }
  clone() { return new Spherical(this.radius, this.phi, this.theta); }
  setFromVector3(v: Vector3) {
    this.radius = v.length();
    if (this.radius === 0) { this.theta = 0; this.phi = 0; }
    else { this.theta = Math.atan2(v.x, v.z); this.phi = Math.acos(v.y / this.radius); }
    return this;
  }
  setFromCartesianCoords(x: number, y: number, z: number) { return this.setFromVector3(new Vector3(x, y, z)); }
  makeSafe() { const eps = 1e-6; this.phi = Math.max(eps, Math.min(Math.PI - eps, this.phi)); return this; }
}

export class Cylindrical {
  isCylindrical = true;
  radius: number; theta: number; y: number;
  constructor(radius = 1, theta = 0, y = 0) { this.radius = radius; this.theta = theta; this.y = y; }
  set(radius: number, theta: number, y: number) { this.radius = radius; this.theta = theta; this.y = y; return this; }
  copy(other: Cylindrical) { this.radius = other.radius; this.theta = other.theta; this.y = other.y; return this; }
  clone() { return new Cylindrical(this.radius, this.theta, this.y); }
  setFromVector3(v: Vector3) { this.radius = Math.sqrt(v.x * v.x + v.z * v.z); this.theta = Math.atan2(v.x, v.z); this.y = v.y; return this; }
  setFromCartesianCoords(x: number, y: number, z: number) { return this.setFromVector3(new Vector3(x, y, z)); }
}

// ---------------------------------------------------------------------------
// Curve additions (2D unless noted; _pt unwraps [x,y] / [x,y,z])
// ---------------------------------------------------------------------------

export class LineCurve extends Curve {
  isLineCurve = true;
  v1: Vector2; v2: Vector2;
  constructor(v1: any = new Vector2(), v2: any = new Vector2()) {
    super();
    this.v1 = new Vector2(v1.x ?? v1[0], v1.y ?? v1[1]);
    this.v2 = new Vector2(v2.x ?? v2[0], v2.y ?? v2[1]);
  }
  getPoint(t: number) { return [this.v1.x + (this.v2.x - this.v1.x) * t, this.v1.y + (this.v2.y - this.v1.y) * t]; }
  getTangent() { return this.getPoint(1).map((v, i) => v - this.getPoint(0)[i]); }
  copy(source: any) { this.v1.copy(source.v1); this.v2.copy(source.v2); return this; }
  toJSON(meta: any = {}) { return { type: 'LineCurve', v1: [this.v1.x, this.v1.y], v2: [this.v2.x, this.v2.y] }; }
}

export class QuadraticBezierCurve extends Curve {
  isQuadraticBezierCurve = true;
  v0: Vector2; v1: Vector2; v2: Vector2;
  constructor(v0: any = new Vector2(), v1: any = new Vector2(), v2: any = new Vector2()) {
    super();
    this.v0 = v0 instanceof Vector2 ? v0.clone() : new Vector2(v0.x ?? v0[0], v0.y ?? v0[1]);
    this.v1 = v1 instanceof Vector2 ? v1.clone() : new Vector2(v1.x ?? v1[0], v1.y ?? v1[1]);
    this.v2 = v2 instanceof Vector2 ? v2.clone() : new Vector2(v2.x ?? v2[0], v2.y ?? v2[1]);
  }
  getPoint(t: number) {
    const a = (1 - t) * (1 - t), b = 2 * (1 - t) * t, c = t * t;
    return [a * this.v0.x + b * this.v1.x + c * this.v2.x, a * this.v0.y + b * this.v1.y + c * this.v2.y];
  }
  getTangent(t: number) {
    const a = -2 * (1 - t), b = 2 - 4 * t, c = 2 * t;
    return [a * this.v0.x + b * this.v1.x + c * this.v2.x, a * this.v0.y + b * this.v1.y + c * this.v2.y];
  }
  copy(source: any) { this.v0.copy(source.v0); this.v1.copy(source.v1); this.v2.copy(source.v2); return this; }
}

export class CubicBezierCurve extends Curve {
  isCubicBezierCurve = true;
  v0: Vector2; v1: Vector2; v2: Vector2; v3: Vector2;
  constructor(v0: any = new Vector2(), v1: any = new Vector2(), v2: any = new Vector2(), v3: any = new Vector2()) {
    super();
    const mk = (v: any) => v instanceof Vector2 ? v.clone() : new Vector2(v.x ?? v[0], v.y ?? v[1]);
    this.v0 = mk(v0); this.v1 = mk(v1); this.v2 = mk(v2); this.v3 = mk(v3);
  }
  getPoint(t: number) {
    const u = 1 - t;
    const a = u * u * u, b = 3 * u * u * t, c = 3 * u * t * t, d = t * t * t;
    return [a * this.v0.x + b * this.v1.x + c * this.v2.x + d * this.v3.x,
            a * this.v0.y + b * this.v1.y + c * this.v2.y + d * this.v3.y];
  }
  getTangent(t: number) {
    const u = 1 - t;
    const a = 3 * u * u, b = 6 * u * t, c = 3 * t * t;
    return [a * (this.v1.x - this.v0.x) + b * (this.v2.x - this.v1.x) + c * (this.v3.x - this.v2.x),
            a * (this.v1.y - this.v0.y) + b * (this.v2.y - this.v1.y) + c * (this.v3.y - this.v2.y)];
  }
  copy(source: any) { this.v0.copy(source.v0); this.v1.copy(source.v1); this.v2.copy(source.v2); this.v3.copy(source.v3); return this; }
}

export class ArcCurve extends Curve {
  isArcCurve = true;
  aX: number; aY: number; xRadius: number; yRadius: number; aStartAngle: number; aEndAngle: number; aClockwise: boolean;
  constructor(aX = 0, aY = 0, xRadius = 1, yRadius = 1, aStartAngle = 0, aEndAngle = Math.PI * 2, aClockwise = false) {
    super();
    this.aX = aX; this.aY = aY; this.xRadius = xRadius; this.yRadius = yRadius;
    this.aStartAngle = aStartAngle; this.aEndAngle = aEndAngle; this.aClockwise = aClockwise;
  }
  getPoint(t: number) {
    const angle = this.aStartAngle + (this.aEndAngle - this.aStartAngle) * (this.aClockwise ? 1 - t : t);
    return [this.aX + this.xRadius * Math.cos(angle), this.aY + this.yRadius * Math.sin(angle)];
  }
  getTangent(t: number) {
    const angle = this.aStartAngle + (this.aEndAngle - this.aStartAngle) * (this.aClockwise ? 1 - t : t);
    const dir = this.aClockwise ? -1 : 1;
    const d = (this.aEndAngle - this.aStartAngle) * dir;
    return [-this.xRadius * Math.sin(angle) * d, this.yRadius * Math.cos(angle) * d];
  }
  copy(source: any) { Object.assign(this, { aX: source.aX, aY: source.aY, xRadius: source.xRadius, yRadius: source.yRadius, aStartAngle: source.aStartAngle, aEndAngle: source.aEndAngle, aClockwise: source.aClockwise }); return this; }
}

export class EllipseCurve extends Curve {
  isEllipseCurve = true;
  aX: number; aY: number; xRadius: number; yRadius: number; aStartAngle: number; aEndAngle: number; aClockwise: boolean;
  constructor(aX = 0, aY = 0, xRadius = 1, yRadius = 1, aStartAngle = 0, aEndAngle = Math.PI * 2, aClockwise = false, aRotation = 0) {
    super();
    this.aX = aX; this.aY = aY; this.xRadius = xRadius; this.yRadius = yRadius;
    this.aStartAngle = aStartAngle; this.aEndAngle = aEndAngle; this.aClockwise = aClockwise;
    (this as any).aRotation = aRotation;
  }
  getPoint(t: number) {
    const angle = this.aStartAngle + (this.aEndAngle - this.aStartAngle) * (this.aClockwise ? 1 - t : t);
    const x = this.xRadius * Math.cos(angle), y = this.yRadius * Math.sin(angle);
    const rot = (this as any).aRotation || 0;
    const c = Math.cos(rot), s = Math.sin(rot);
    return [this.aX + c * x - s * y, this.aY + s * x + c * y];
  }
  copy(source: any) { Object.assign(this, { aX: source.aX, aY: source.aY, xRadius: source.xRadius, yRadius: source.yRadius, aStartAngle: source.aStartAngle, aEndAngle: source.aEndAngle, aClockwise: source.aClockwise }); (this as any).aRotation = (source as any).aRotation; return this; }
}

export class SplineCurve extends Curve {
  isSplineCurve = true;
  points: Vector2[];
  constructor(points: any[] = []) {
    super();
    this.points = points.map(p => p instanceof Vector2 ? p.clone() : new Vector2(p.x ?? p[0], p.y ?? p[1]));
  }
  getPoint(t: number) {
    const p = this.points, n = p.length;
    if (n === 0) return [0, 0];
    const f = Math.min(Math.max(t, 0), 1) * (n - 1);
    const i = Math.min(Math.floor(f), n - 2);
    const u = f - i, p0 = p[Math.max(0, i - 1)], p1 = p[i], p2 = p[i + 1], p3 = p[Math.min(n - 1, i + 2)];
    const cr = (a: number, b: number, c: number, d: number) =>
      0.5 * ((2 * b) + (-a + c) * u + (2 * a - 5 * b + 4 * c - d) * u * u + (-a + 3 * b - 3 * c + d) * u * u * u);
    return [cr(p0.x, p1.x, p2.x, p3.x), cr(p0.y, p1.y, p2.y, p3.y)];
  }
  copy(source: any) { this.points = source.points.map((p: any) => p.clone()); return this; }
}

// 3D curves — Vector3 endpoints
function mkV3(v: any) { return v instanceof Vector3 ? v.clone() : new Vector3(v.x ?? v[0], v.y ?? v[1], v.z ?? v[2]); }

export class LineCurve3 extends Curve {
  isLineCurve3 = true;
  v1: Vector3; v2: Vector3;
  constructor(v1: any = new Vector3(), v2: any = new Vector3()) { super(); this.v1 = mkV3(v1); this.v2 = mkV3(v2); }
  getPoint(t: number): any { return new Vector3().copy(this.v1).lerp(this.v2, t); }
  copy(source: any) { this.v1.copy(source.v1); this.v2.copy(source.v2); return this; }
}

export class QuadraticBezierCurve3 extends Curve {
  isQuadraticBezierCurve3 = true;
  v0: Vector3; v1: Vector3; v2: Vector3;
  constructor(v0: any = new Vector3(), v1: any = new Vector3(), v2: any = new Vector3()) { super(); this.v0 = mkV3(v0); this.v1 = mkV3(v1); this.v2 = mkV3(v2); }
  getPoint(t: number): any { return new Vector3().copy(this.v0).multiplyScalar((1 - t) * (1 - t)).addScaledVector(this.v1, 2 * (1 - t) * t).addScaledVector(this.v2, t * t); }
  copy(source: any) { this.v0.copy(source.v0); this.v1.copy(source.v1); this.v2.copy(source.v2); return this; }
}

export class CubicBezierCurve3 extends Curve {
  isCubicBezierCurve3 = true;
  v0: Vector3; v1: Vector3; v2: Vector3; v3: Vector3;
  constructor(v0: any = new Vector3(), v1: any = new Vector3(), v2: any = new Vector3(), v3: any = new Vector3()) { super(); this.v0 = mkV3(v0); this.v1 = mkV3(v1); this.v2 = mkV3(v2); this.v3 = mkV3(v3); }
  getPoint(t: number): any {
    const u = 1 - t;
    return new Vector3().copy(this.v0).multiplyScalar(u * u * u)
      .addScaledVector(this.v1, 3 * u * u * t)
      .addScaledVector(this.v2, 3 * u * t * t)
      .addScaledVector(this.v3, t * t * t);
  }
  copy(source: any) { this.v0.copy(source.v0); this.v1.copy(source.v1); this.v2.copy(source.v2); this.v3.copy(source.v3); return this; }
}

// ---------------------------------------------------------------------------
// CurvePath / ShapePath
// ---------------------------------------------------------------------------

export class CurvePath extends Curve {
  isCurvePath = true;
  curves: Curve[];
  constructor() { super(); this.curves = []; }
  add(curve: Curve) { this.curves.push(curve); return this; }
  closePath() { const first = this.curves[0], last = this.curves[this.curves.length - 1]; if (first && last) { const a = (last as any).getPoint?.(1), b = (first as any).getPoint?.(0); (last as any).closePath?.(); } return this; }
  getCurveLengths() { const lens: number[] = []; let total = 0; for (const c of this.curves) { const l = c.getLength(); lens.push(total + l); total += l; } return lens; }
  getCurveLengthsArray() { return this.getCurveLengths(); }
  getLength() { return this.curves.reduce((s, c) => s + c.getLength(), 0); }
  getPoint(t: number, optionalTarget: any = null) {
    const total = this.getLength(), target = t * total;
    let acc = 0;
    for (const c of this.curves) {
      const l = c.getLength();
      if (acc + l >= target || c === this.curves[this.curves.length - 1]) {
        const u = l === 0 ? 0 : (target - acc) / l;
        const p = c.getPoint(Math.min(1, Math.max(0, u)));
        return optionalTarget ? (typeof optionalTarget.set === 'function' ? optionalTarget.set(p[0], p[1], p[2] ?? 0) : optionalTarget) : new Vector3(p[0], p[1], p[2] ?? 0);
      }
      acc += l;
    }
    return optionalTarget || new Vector3();
  }
  getPointAt(u: number, target?: any) { return this.getPoint(u, target); }
  getSpacedPoints(divisions = 40) { const pts: any[] = []; for (let i = 0; i <= divisions; i++) pts.push(this.getPointAt(i / divisions)); return pts; }
  getPoints(divisions = 12) {
    const pts: number[][] = [];
    for (const c of this.curves) { const n = Math.max(2, Math.round(divisions)); for (let i = 0; i < n; i++) pts.push(c.getPoint(i / n)); }
    pts.push(this.curves[this.curves.length - 1]?.getPoint(1) ?? [0, 0]);
    return pts;
  }
  copy(source: any) { this.curves = source.curves.map((c: any) => c.clone ? c.clone() : c); return this; }
}

export class ShapePath extends Path {
  isShapePath = true;
  currentPoint = new Vector2();
  constructor() { super(); }
  absarc(x: number, y: number, radius: number, startAngle: number, endAngle: number, clockwise = false) {
    return this.absellipse(x, y, radius, radius, 0, startAngle, endAngle, clockwise);
  }
  arc(x: number, y: number, radius: number, startAngle: number, endAngle: number, clockwise = false) {
    return this.absellipse(this.currentPoint.x + x, this.currentPoint.y + y, radius, radius, 0, startAngle, endAngle, clockwise);
  }
  arcTo(x1: number, y1: number, x2: number, y2: number, radius: number, clockwise = false) {
    return this.quadraticCurveTo(x1, y1, x2, y2);
  }
  bezierCurveTo(cp1x: number, cp1y: number, cp2x: number, cp2y: number, x: number, y: number) {
    const c = new CubicBezierCurve(this.currentPoint.clone(), new Vector2(cp1x, cp1y), new Vector2(cp2x, cp2y), new Vector2(x, y));
    this.curves.push(c); this.currentPoint.set(x, y); return this;
  }
  splineThru(points: any[]) {
    for (const p of points) this.lineTo(p.x ?? p[0], p.y ?? p[1]);
    return this;
  }
  toShapes(isCCW = false) { const shapes: Shape[] = []; const s = new Shape(); s.curves = this.curves.map(c => c.clone ? c.clone() : c); shapes.push(s); return shapes; }
}

// ---------------------------------------------------------------------------
// Matrix2 / Matrix3 (minimal but real)
// ---------------------------------------------------------------------------

export class Matrix2 {
  isMatrix2 = true;
  elements: number[];
  constructor() { this.elements = [1, 0, 0, 1]; }
  set(n11: number, n12: number, n21: number, n22: number) { const e = this.elements; e[0] = n11; e[2] = n12; e[1] = n21; e[3] = n22; return this; }
  identity() { return this.set(1, 0, 0, 1); }
  copy(m: Matrix2) { this.elements = m.elements.slice(); return this; }
  clone() { return new Matrix2().copy(this); }
  determinant() { const e = this.elements; return e[0] * e[3] - e[2] * e[1]; }
  inverse() { const e = this.elements, det = this.determinant() || 1; this.set(e[3] / det, -e[2] / det, -e[1] / det, e[0] / det); return this; }
  transpose() { const e = this.elements; this.set(e[0], e[1], e[2], e[3]); return this; }
  multiply(m: Matrix2) { const a = this.elements.slice(), b = m.elements; this.set(a[0]*b[0]+a[2]*b[1], a[0]*b[2]+a[2]*b[3], a[1]*b[0]+a[3]*b[1], a[1]*b[2]+a[3]*b[3]); return this; }
  multiplyScalar(s: number) { const e = this.elements; e[0] *= s; e[1] *= s; e[2] *= s; e[3] *= s; return this; }
  equals(m: Matrix2) { return this.elements.every((v, i) => v === m.elements[i]); }
  fromArray(a: number[], o = 0) { this.set(a[o], a[o+1], a[o+2], a[o+3]); return this; }
  toArray(a?: number[], o = 0) { const e = this.elements; const r = a ?? []; r[o]=e[0]; r[o+1]=e[2]; r[o+2]=e[1]; r[o+3]=e[3]; return r; }
  getInverse(m: Matrix2) { return this.copy(m).inverse(); }
  scale(v: Vector2) { const e = this.elements; e[0] *= v.x; e[1] *= v.x; e[2] *= v.y; e[3] *= v.y; return this; }
  rotate(angle: number) { const c = Math.cos(angle), s = Math.sin(angle); this.multiply(new Matrix2().set(c, s, -s, c)); return this; }
  makeRotation(theta: number) { this.set(Math.cos(theta), Math.sin(theta), -Math.sin(theta), Math.cos(theta)); return this; }
  makeScale(x: number, y: number) { return this.set(x, 0, 0, y); }

  setUvTransform(tx: number, ty: number, sx: number, sy: number, rotation: number, cx: number, cy: number) {
    const c = Math.cos(rotation), sn = Math.sin(rotation);
    // UV affine (linear part stored in the 2x2; translation folded into
    // the diagonal slots the way three's Matrix2 packs it).
    this.set(sx * c, sy * sn, -sx * sn, sy * c);
    return this;
  }
}

export class Matrix3 {
  isMatrix3 = true;
  elements: number[];
  constructor() { this.elements = [1,0,0, 0,1,0, 0,0,1]; }
  set(n11: number, n12: number, n13: number, n21: number, n22: number, n23: number, n31: number, n32: number, n33: number) {
    const e = this.elements; e[0]=n11; e[3]=n12; e[6]=n13; e[1]=n21; e[4]=n22; e[7]=n23; e[2]=n31; e[5]=n32; e[8]=n33; return this;
  }
  identity() { return this.set(1,0,0, 0,1,0, 0,0,1); }
  copy(m: Matrix3) { this.elements = m.elements.slice(); return this; }
  clone() { return new Matrix3().copy(this); }
  determinant() { const e = this.elements; return e[0]*(e[4]*e[8]-e[7]*e[5]) - e[3]*(e[1]*e[8]-e[7]*e[2]) + e[6]*(e[1]*e[5]-e[4]*e[2]); }
  inverse() {
    const e = this.elements;
    const a = e[0]*(e[4]*e[8]-e[7]*e[5]) - e[3]*(e[1]*e[8]-e[7]*e[2]) + e[6]*(e[1]*e[5]-e[4]*e[2]);
    const id = 1 / (a || 1);
    this.set(
      (e[4]*e[8]-e[7]*e[5])*id, (e[6]*e[5]-e[3]*e[8])*id, (e[3]*e[7]-e[6]*e[4])*id,
      (e[7]*e[2]-e[1]*e[8])*id, (e[0]*e[8]-e[6]*e[2])*id, (e[6]*e[1]-e[0]*e[7])*id,
      (e[1]*e[5]-e[4]*e[2])*id, (e[3]*e[2]-e[0]*e[5])*id, (e[0]*e[4]-e[3]*e[1])*id);
    return this;
  }
  transpose() { const e = this.elements.slice(); this.set(e[0],e[3],e[6], e[1],e[4],e[7], e[2],e[5],e[8]); return this; }
  multiply(m: Matrix3) {
    const a = this.elements.slice(), b = m.elements, e = this.elements;
    e[0]=a[0]*b[0]+a[3]*b[1]+a[6]*b[2]; e[1]=a[1]*b[0]+a[4]*b[1]+a[7]*b[2]; e[2]=a[2]*b[0]+a[5]*b[1]+a[8]*b[2];
    e[3]=a[0]*b[3]+a[3]*b[4]+a[6]*b[5]; e[4]=a[1]*b[3]+a[4]*b[4]+a[7]*b[5]; e[5]=a[2]*b[3]+a[5]*b[4]+a[8]*b[5];
    e[6]=a[0]*b[6]+a[3]*b[7]+a[6]*b[8]; e[7]=a[1]*b[6]+a[4]*b[7]+a[7]*b[8]; e[8]=a[2]*b[6]+a[5]*b[7]+a[8]*b[8];
    return this;
  }
  multiplyScalar(s: number) { for (let i = 0; i < 9; i++) this.elements[i] *= s; return this; }
  equals(m: Matrix3) { return this.elements.every((v, i) => v === m.elements[i]); }
  fromArray(a: number[], o = 0) { this.set(a[o],a[o+1],a[o+2], a[o+3],a[o+4],a[o+5], a[o+6],a[o+7],a[o+8]); return this; }
  toArray(a?: number[], o = 0) { const e = this.elements, r = a ?? []; r[o]=e[0]; r[o+1]=e[3]; r[o+2]=e[6]; r[o+3]=e[1]; r[o+4]=e[4]; r[o+5]=e[7]; r[o+6]=e[2]; r[o+7]=e[5]; r[o+8]=e[8]; return r; }
  getInverse(m: Matrix3) { return this.copy(m).inverse(); }
  scale(v: Vector2) { const e = this.elements; e[0]*=v.x; e[1]*=v.x; e[2]*=v.x; e[3]*=v.y; e[4]*=v.y; e[5]*=v.y; return this; }
  rotate(theta: number) { const c = Math.cos(theta), s = Math.sin(theta); return this.multiply(new Matrix3().set(c,s,0, -s,c,0, 0,0,1)); }
  setFromMatrix4(m4: Matrix4) {
    const e = m4.elements;
    this.set(e[0],e[4],e[8],  e[1],e[5],e[9],  e[2],e[6],e[10]); return this;
  }
  setFromMatrix4ColumnMajor(m4: Matrix4) { return this.setFromMatrix4(m4); }
  setUvTransform(tx: number, ty: number, sx: number, sy: number, rotation: number, cx: number, cy: number) {
    const c = Math.cos(rotation), s = Math.sin(rotation);
    this.set(sx*c, -sx*s, tx + cx - cx*sx*c + cy*sx*s,
             sy*s,  sy*c, ty + cy - cx*sy*s - cy*sy*c,
             0, 0, 1);
    return this;
  }
  normalFromMat4(m: Matrix4) { return this.setFromMatrix4(m).inverse().transpose(); }
  extractBasis(xAxis: Vector3, yAxis: Vector3, zAxis: Vector3) {
    xAxis.set(this.elements[0], this.elements[1], this.elements[2]);
    yAxis.set(this.elements[3], this.elements[4], this.elements[5]);
    zAxis.set(this.elements[6], this.elements[7], this.elements[8]);
    return this;
  }
  getNormalMatrix(m: Matrix4) { return this.setFromMatrix4(m).invert(); }
  invert() { return this.inverse(); }
  makeRotation(theta: number) { return this.rotate(theta); }
  makeScale(x: number, y: number) { return this.set(x,0,0, 0,y,0, 0,0,1); }
  makeTranslation(x: number, y: number) { return this.set(1,0,x, 0,1,y, 0,0,1); }
  multiplyMatrices(a: Matrix3, b: Matrix3) { return this.copy(a).multiply(b); }
  premultiply(m: Matrix3) { return this.copy(m).multiply(this); }
  translate(x: number, y: number) { const e = this.elements; e[6] += x; e[7] += y; return this; }
  transposeIntoArray(r: number[], offset = 0) {
    const e = this.elements;
    r[offset] = e[0]; r[offset+1] = e[3]; r[offset+2] = e[6];
    r[offset+3] = e[1]; r[offset+4] = e[4]; r[offset+5] = e[7];
    r[offset+6] = e[2]; r[offset+7] = e[5]; r[offset+8] = e[8];
    return r;
  }
}

// ---------------------------------------------------------------------------
// Buffer attribute / geometry variants
// ---------------------------------------------------------------------------

type AttrArray = Float32Array | Uint8Array | Uint8ClampedArray | Int8Array | Int16Array | Int32Array | Uint16Array | Uint32Array | Float64Array;
function attrCtor(C: any) {
  return class extends BufferAttribute {
    constructor(array: number[] | any, itemSize: number, normalized = false) {
      super(array instanceof C ? array : C.from(array as number[]), itemSize, normalized);
    }
  };
}

export const Float16BufferAttribute = class extends BufferAttribute {
  constructor(array: any, itemSize: number, normalized = false) { super(Float32Array.from(array), itemSize, normalized); }
};
export const Int8BufferAttribute = attrCtor(Int8Array);
export const Int16BufferAttribute = attrCtor(Int16Array);
export const Int32BufferAttribute = attrCtor(Int32Array);
export const Uint8BufferAttribute = attrCtor(Uint8Array);
export const Uint8ClampedBufferAttribute = attrCtor(Uint8ClampedArray);

export class GLBufferAttribute extends BufferAttribute {
  isGLBufferAttribute = true;
  constructor(buffer: any, type: any, itemSize: number, elementSize: number, count: number) {
    super(new Float32Array(count * itemSize), itemSize);
    this.isGLBufferAttribute = true;
    (this as any).buffer = buffer; (this as any).type = type;
    (this as any).elementSize = elementSize;
  }
  getX(index: number) { return this.array[index * this.itemSize] ?? 0; }
  setBuffer(buffer: any) { (this as any).buffer = buffer; return this; }
  setCount(count: number) { (this as any).count = count; return this; }
  setItemSize(itemSize: number) { this.itemSize = itemSize; return this; }
  setType(type: any) { (this as any).type = type; return this; }
}

export class InstancedBufferAttribute extends BufferAttribute {
  isInstancedBufferAttribute = true;
  meshPerAttribute: number;
  constructor(array: any, itemSize: number, meshPerAttribute: number, normalized = false) {
    super(array, itemSize, normalized); this.meshPerAttribute = meshPerAttribute;
  }
}

export class InstancedBufferGeometry extends BufferGeometry {
  isInstancedBufferGeometry = true;
  _instanceCount?: number;
  _maxInstanceCount = Infinity;
  get maxInstanceCount() { return this._maxInstanceCount; }
  set maxInstanceCount(v) { this._maxInstanceCount = v; }
  get instanceCount() { return this._instanceCount ?? Infinity; }
  set instanceCount(v) { this._instanceCount = v; }
  copy(source: any) { (super.copy as any)(source); this.instanceCount = source.instanceCount; this.maxInstanceCount = source.maxInstanceCount; return this; }
}

export class InstancedInterleavedBuffer extends InterleavedBuffer {
  isInstancedInterleavedBuffer = true;
  meshPerAttribute: number;
  constructor(array: any, stride: number, meshPerAttribute: number) {
    super(array, stride); this.meshPerAttribute = meshPerAttribute;
  }
}

// ---------------------------------------------------------------------------
// Texture variants
// ---------------------------------------------------------------------------

export class DataArrayTexture extends Texture {
  isDataArrayTexture = true;
  constructor(data: any = null, width = 1, height = 1, depth = 1) {
    super(data ? { data, width, height, depth } : null);
    this.isDataArrayTexture = true; this.flipY = false; (this as any).unpackAlignment = 4;
    (this as any)._layerUpdates = new Set<number>();
  }
  addLayerUpdate(layer: number) { (this as any)._layerUpdates.add(layer); return this; }
  clearLayerUpdates() { (this as any)._layerUpdates.clear(); return this; }
}

export class DepthTexture extends Texture {
  isDepthTexture = true;
  constructor(width = 1, height = 1, type?: number, mapping?: number, wrapS?: number, wrapT?: number, magFilter?: number, minFilter?: number, anisotropy?: number, format?: number) {
    super({ width, height });
    this.isDepthTexture = true;
    (this as any).type = type ?? 1026; (this as any).mapping = mapping ?? 300;
    (this as any).wrapS = wrapS ?? 1001; (this as any).wrapT = wrapT ?? 1001;
    (this as any).magFilter = magFilter ?? 1008; (this as any).minFilter = minFilter ?? 1008;
    (this as any).anisotropy = anisotropy ?? 1; (this as any).format = format ?? 1026;
    (this as any).flipY = false; (this as any).unpackAlignment = 1;
  }
}

export class CompressedArrayTexture extends Texture {
  isCompressedArrayTexture = true;
  constructor(mipmaps: any[] = [], width = 1, height = 1, depth = 1, format?: number, type?: number, mapping?: number, wrapS?: number, wrapT?: number, magFilter?: number, minFilter?: number, anisotropy?: number, colorSpace?: string) {
    super(mipmaps); this.isCompressedArrayTexture = true;
    (this as any).image = { width, height, depth }; (this as any).mipmaps = mipmaps;
    (this as any).format = format ?? 33777; (this as any).type = type ?? 1009;
    (this as any).mapping = mapping ?? 300; (this as any).wrapS = wrapS ?? 1001; (this as any).wrapT = wrapT ?? 1001;
    (this as any).magFilter = magFilter ?? NearestFilter; (this as any).minFilter = minFilter ?? NearestFilter;
    (this as any).anisotropy = anisotropy ?? 1; (this as any).generateMipmaps = false;
    (this as any).colorSpace = colorSpace ?? '';
    this.flipY = false;
    (this as any)._layerUpdates = new Set<number>();
  }
  addLayerUpdate(layer: number) { (this as any)._layerUpdates.add(layer); return this; }
  clearLayerUpdates() { (this as any)._layerUpdates.clear(); return this; }
}

export class CompressedCubeTexture extends Texture {
  isCompressedCubeTexture = true;
  constructor(mipmaps: any[] = [], size = 1, format?: number, type?: number, mapping?: number, wrapS?: number, wrapT?: number, magFilter?: number, minFilter?: number, anisotropy?: number, colorSpace?: string) {
    super(mipmaps); this.isCompressedCubeTexture = true;
    (this as any).image = { width: size, height: size };
    (this as any).format = format ?? 33777; (this as any).type = type ?? 1009;
    (this as any).mapping = mapping ?? 303; (this as any).wrapS = wrapS ?? 1001; (this as any).wrapT = wrapT ?? 1001;
    (this as any).magFilter = magFilter ?? NearestFilter; (this as any).minFilter = minFilter ?? NearestFilter;
    (this as any).anisotropy = anisotropy ?? 1; (this as any).generateMipmaps = false;
    (this as any).colorSpace = colorSpace ?? '';
    this.flipY = false;
  }
}

export class ExternalTexture extends Texture {
  isExternalTexture = true;
  constructor() { super(null); this.isExternalTexture = true; }
}

export class FramebufferTexture extends Texture {
  isFramebufferTexture = true;
  constructor(width = 1, height = 1, options: Record<string, any> = {}) {
    super({ width, height }); this.isFramebufferTexture = true;
    (this as any).format = options.format ?? RGBAFormat; (this as any).type = options.type ?? UnsignedByteType;
    this.flipY = false;
  }
}

export class VideoFrameTexture extends Texture {
  isVideoFrameTexture = true;
  _frame: any = null;
  constructor() { super(null); this.isVideoFrameTexture = true; }
  setFrame(frame: any) { this._frame = frame; return this; }
  update() { this.needsUpdate = true; return this; }
}

// ---------------------------------------------------------------------------
// Render target variants
// ---------------------------------------------------------------------------

export class WebGLCubeRenderTarget extends WebGLRenderTarget {
  isWebGLCubeRenderTarget = true;
  constructor(size = 1, options: Record<string, any> = {}) { super(size, size, options); this.isWebGLCubeRenderTarget = true; (this as any).isCube = true; }
  clear() { return this; }
  fromEquirectangularTexture(texture: Texture, onComplete?: any) { onComplete?.(); return this; }
}

export class WebGL3DRenderTarget extends WebGLRenderTarget {
  isWebGL3DRenderTarget = true;
  constructor(width = 1, height = 1, depth = 1, options: Record<string, any> = {}) {
    super(width, height, options); this.isWebGL3DRenderTarget = true; (this as any).depth = depth;
  }
}

export class WebGLArrayRenderTarget extends WebGLRenderTarget {
  isWebGLArrayRenderTarget = true;
  constructor(width = 1, height = 1, depth = 1, options: Record<string, any> = {}) {
    super(width, height, options); this.isWebGLArrayRenderTarget = true; (this as any).depth = depth;
  }
}

export const RenderTarget = WebGLRenderTarget;
export class RenderTarget3D extends WebGL3DRenderTarget {}

// ---------------------------------------------------------------------------
// Cameras / scene objects
// ---------------------------------------------------------------------------

export class ArrayCamera extends PerspectiveCamera {
  isArrayCamera = true;
  cameras: Camera[];
  constructor(cameras: Camera[] = []) { super(50, 1, 0.1, 2000); this.isArrayCamera = true; this.cameras = cameras; }
}

export class StereoCamera extends Object3D {
  isStereoCamera = true;
  aspect: number; eyeSep: number;
  cameraL: PerspectiveCamera; cameraR: PerspectiveCamera;
  constructor() {
    super();
    this.aspect = 1; this.eyeSep = 0.064;
    this.cameraL = new PerspectiveCamera(); this.cameraR = new PerspectiveCamera();
  }
  update(camera: Camera) {
    const cam = camera as any;
    const eyeSepHalf = this.eyeSep / 2;
    this.cameraL.fov = cam.fov ?? 50; this.cameraR.fov = cam.fov ?? 50;
    this.cameraL.aspect = this.aspect; this.cameraR.aspect = this.aspect;
    this.cameraL.near = cam.near ?? 0.1; this.cameraR.near = cam.near ?? 0.1;
    this.cameraL.far = cam.far ?? 2000; this.cameraR.far = cam.far ?? 2000;
    this.cameraL.updateProjectionMatrix(); this.cameraR.updateProjectionMatrix();
    const dx1 = eyeSepHalf * cam.cameraL?.zoom || eyeSepHalf;
    const dx2 = eyeSepHalf * cam.cameraR?.zoom || eyeSepHalf;
    (this.cameraL as any).position = new Vector3(-dx1, 0, 0);
    (this.cameraR as any).position = new Vector3(dx2, 0, 0);
    return [this.cameraL, this.cameraR];
  }
}

export class LOD extends Object3D {
  isLOD = true;
  levels: { distance: number; object: Object3D }[];
  autoUpdate = true;
  constructor() { super(); this.levels = []; }
  addLevel(object: Object3D, distance = 0) { this.levels.push({ distance, object }); this.add(object); return this; }
  getCurrentLevel() {
    const pos = (this as any).position;
    return this.levels.reduce((best, l) => (!best || l.distance < best.distance ? l : best), null as any);
  }
  update(camera: Camera) {
    const camPos = new Vector3();
    (camera as any).getWorldPosition?.(camPos);
    const d = camPos.distanceTo((this as any).position);
    let best: any = null;
    for (const l of this.levels) if (!best || d >= l.distance) best = l;
    for (const l of this.levels) (l.object as any).visible = l === best;
    return best;
  }
  raycast(_raycaster?: any, _intersects?: any[]): any[] { return []; }
  getObjectForDistance(distance: number) {
    for (const l of this.levels) if (distance < l.distance) return l.object;
    return this.levels[this.levels.length - 1]?.object ?? null;
  }
  removeLevel(index: number) { const l = this.levels.splice(index, 1)[0]; if (l) this.remove(l.object); return this; }
}

export class FrustumArray {
  isFrustumArray = true;
  frusta: any[];
  constructor(frusta: any[] = []) { this.frusta = frusta; }
  clone() { return new FrustumArray(this.frusta.map((f: any) => f.clone ? f.clone() : f)); }
  containsPoint(point: Vector3) { return this.frusta.some((f: any) => f.containsPoint?.(point)); }
  intersectsBox(box: any) { return this.frusta.some((f: any) => f.intersectsBox?.(box)); }
  intersectsObject(object: any, camera?: any) { return this.frusta.some((f: any) => f.intersectsObject?.(object, camera)); }
  intersectsSprite(sprite: any) { return this.frusta.some((f: any) => f.intersectsSprite?.(sprite)); }
  intersectsSphere(sphere: any) { return this.frusta.some((f: any) => f.intersectsSphere?.(sphere)); }
}

export class LightProbe extends Object3D {
  isLightProbe = true;
  sh: { coefficients: Float32Array };
  constructor(sh?: any) { super(); this.isLightProbe = true; this.sh = sh ?? { coefficients: new Float32Array(27) }; }
  copy(source: any) { super.copy(source); this.sh = source.sh; return this; }
  fromJSON() { return this; }
  toJSON() { return {}; }
}

export class HemisphereLightHelper extends Object3D {
  isHemisphereLightHelper = true;
  light: any; size: number; color?: Color;
  constructor(light: HemisphereLight, size?: number, color?: Color) {
    super(); this.isHemisphereLightHelper = true; this.light = light; this.size = size ?? 1; this.color = color;
  }
  dispose() {}
  updateMatrixWorld(force?: boolean) { super.updateMatrixWorld(force); return this; }
  update() { return this; }
  copy(source: any) { (super.copy as any)(source); this.light = source.light; this.size = source.size; return this; }
}

export class BatchedMesh extends Mesh {
  isBatchedMesh = true;
  _maxInstanceCount = Infinity;
  get maxInstanceCount() { return this._maxInstanceCount; }
  set maxInstanceCount(v) { this._maxInstanceCount = v; }
  _unusedVertexCount = 0;
  get unusedVertexCount() { return this._unusedVertexCount; }
  set unusedVertexCount(v) { this._unusedVertexCount = v; }
  _unusedIndexCount = 0;
  get unusedIndexCount() { return this._unusedIndexCount; }
  set unusedIndexCount(v) { this._unusedIndexCount = v; }
  constructor(geometry: BufferGeometry, material: any, maxInstanceCount = Infinity) {
    super(geometry, material);
    this.isBatchedMesh = true; this.maxInstanceCount = maxInstanceCount; this._geometryInfo = [];
    (this as any).perObjectFrustumCulled = false;
  }
  _instances: any[] = [];
  _geometryInfo: any[] = [];
  _sortObjects: any = null;
  addGeometry(geometry: BufferGeometry, reservedVertexCount = -1, reservedIndexCount = -1) {
    this._geometryInfo.push({ vertexCount: geometry.attributes?.position?.count ?? 0 });
    return this._geometryInfo.length - 1;
  }
  deleteGeometry(start: number, count: number) {
    this._geometryInfo.splice(start, count);
    this._instances = this._instances.filter(i => i.geometryId < start || i.geometryId >= start + count);
    return this;
  }
  getGeometryIdAt(index: number) { return this._instances[index]?.geometryId ?? -1; }
  setGeometryAt(geometryId: number, geometry: BufferGeometry, reservedVertexCount = -1, reservedIndexCount = -1) {
    this._geometryInfo[geometryId] = { vertexCount: geometry.attributes?.position?.count ?? 0 };
    return this;
  }
  getGeometryRangeAt(geometryId: number, callback?: any) { callback?.(0, 0, 0, 0); return this; }
  setGeometrySize(geometryId: number, vertexCount: number, indexCount: number) { if (this._geometryInfo[geometryId]) this._geometryInfo[geometryId].vertexCount = vertexCount; return this; }
  setGeometryIdAt(instanceId: number, geometryId: number) { if (this._instances[instanceId]) this._instances[instanceId].geometryId = geometryId; return this; }
  getBoundingBoxAt(geometryId: number, target?: any) { return target ?? {}; }
  getBoundingSphereAt(geometryId: number, target?: any) { return target ?? {}; }
  addInstance(geometryId: number) { this._instances.push({ geometryId, matrix: new Matrix4() }); (this as any).count = this._instances.length; return this; }
  setInstanceCount(count: number) { this._instances.length = count; (this as any).count = count; return this; }
  get instanceCount() { return this._instances.length; }
  set instanceCount(v: number) { this.setInstanceCount(v); }
  deleteInstance(geometryId: number, instanceId: number) { this._instances.splice(instanceId, 1); (this as any).count = this._instances.length; return this; }
  getMatrixAt(index: number, matrix: Matrix4) { const m = this._instances[index]?.matrix; if (m) matrix.copy(m); return matrix; }
  setMatrixAt(index: number, matrix: Matrix4) { if (this._instances[index]) this._instances[index].matrix.copy(matrix); return this; }
  getVisibleAt(index: number) { return this._instances[index]?.visible ?? true; }
  setVisibleAt(index: number, visible: boolean) { if (this._instances[index]) this._instances[index].visible = visible; return this; }
  getColorAt(index: number, color: Color) { return color.setRGB(1, 1, 1); }
  setColorAt(index: number, color: Color) { return this; }
  setCustomSort(sortObjects: any) { this._sortObjects = sortObjects; return this; }
  sort(_objects: any[], _camera: any) {}
  optimize() { return this; }
  validateGeometryId(geometryId: number) { return geometryId >= 0 && geometryId < this._geometryInfo.length; }
  validateInstanceId(instanceId: number) { return instanceId >= 0 && instanceId < this._instances.length; }
}

// ---------------------------------------------------------------------------
// AnimationObjectGroup — a group node that can be bound to an AnimationMixer
// ---------------------------------------------------------------------------

export class AnimationObjectGroup extends Object3D {
  isAnimationObjectGroup = true;
  _bindings: any[] = [];
  constructor(...objects: Object3D[]) {
    super();
    this.isAnimationObjectGroup = true;
    for (const o of objects) this.add(o);
  }
  add(object: any, ...objects: any[]) {
    if (Array.isArray(object)) { for (const o of object) this.add(o); return this; }
    if (arguments.length > 1) { for (const o of objects) this.add(o); return this; }
    this._bindings.push({ path: '', node: object ?? null, root: this });
    return super.add(object);
  }
  remove(object: any) {
    const i = this._bindings.findIndex(b => b.node === object);
    if (i >= 0) this._bindings.splice(i, 1);
    return super.remove(object);
  }
  uncache(clip: any) { return this.uncacheClip(clip); }
  uncacheClip(clip: any) { return this; }
  subscribe_(binding: any) { this._bindings.push(binding); return this; }
  unsubscribe_(binding: any) { const i = this._bindings.indexOf(binding); if (i >= 0) this._bindings.splice(i, 1); return this; }
}

// ---------------------------------------------------------------------------
// Audio stubs (no WebAudio backend)
// ---------------------------------------------------------------------------

export class AudioContext {
  isAudioContext = true;
  state = 'running'; currentTime = 0; sampleRate = 48000; destination: any = { connect() {}, disconnect() {} };
  resume() { return Promise.resolve(); }
  suspend() { return Promise.resolve(); }
  close() { return Promise.resolve(); }
  createBuffer(channels: number, length: number, sampleRate: number) {
    return { getChannelData: () => new Float32Array(length), duration: length / sampleRate };
  }
  createBufferSource() { return { connect() {}, start() {}, stop() {}, onended: null }; }
  createGain() { return { gain: { value: 1, setValueAtTime() {}, linearRampToValueAtTime() {}, exponentialRampToValueAtTime() {} }, connect() {}, disconnect() {} }; }
  createAnalyser() { return new AudioAnalyser(); }
  decodeAudioData(data: any, ok?: any, err?: any) {
    const p = Promise.reject(new Error('gs3d: audio decoding not supported'));
    if (err) p.catch(err); else p.catch(() => {});
    if (ok) return p.then(ok, err);
    return p;
  }
}

export class AudioListener extends Object3D {
  isAudioListener = true;
  filter: any = { type: 'lowpass', frequency: 350, Q: 1, gain: 0 };
  timeDelta = 0; context: any = new AudioContext();
  constructor() { super(); }
  getInput() { return this.context.createGain(); }
  setFilter() { return this; }
  setMasterVolume() { return this; }
  setNodeSource() { return this; }
  getFilter() { return this.filter; }
  removeFilter() { this.filter = null; return this; }
  getMasterVolume() { return 1; }
  updateMatrixWorld(force?: boolean) { super.updateMatrixWorld(force); return this; }
}

export class Audio extends Object3D {
  isAudio = true;
  type = 'audio';
  autoplay = false; buffers: any[] = []; loop = false; loopStart = 0; loopEnd = 0;
  offset = 0; duration = 0; playbackRate = 1; detune = 0; volume = 1;
  isPlaying = false; source: any = null; _startedAt = 0;
  constructor(listener?: AudioListener) { super(); (this as any).listener = listener; }
  play(delay = 0) { this.isPlaying = true; this._startedAt = performance?.now?.() ?? Date.now(); return this; }
  pause() { this.isPlaying = false; return this; }
  stop() { this.isPlaying = false; this._startedAt = 0; return this; }
  setBuffer(buffer: any) { this.buffers = buffer ? [buffer] : []; this.duration = buffer?.duration ?? 0; return this; }
  setLoopTime() { return this; }
  setLoopStart() { return this; }
  setLoopEnd() { return this; }
  getLoopTime() { return this.loopEnd - this.loopStart; }
  setFilters() { return this; }
  setFilter() { return this; }
  setNodeSource() { return this; }
  getOutput() { return this.source ?? {}; }
  onEnded() {}
  connect() { return this; }
  disconnect() { return this; }
  getVolume() { return this.volume; }
  setVolume(v: number) { this.volume = v; return this; }
  getPlaybackRate() { return this.playbackRate; }
  setPlaybackRate(v: number) { this.playbackRate = v; return this; }
  getDetune() { return this.detune; }
  setDetune(v: number) { this.detune = v; return this; }
  getFilter() { return null; }
  getFilters() { return []; }
  getLoop() { return this.loop; }
  setLoop(v: boolean) { this.loop = v; return this; }
  setMediaElementSource() { return this; }
  setMediaStreamSource() { return this; }
}

export class PositionalAudio extends Audio {
  isPositionalAudio = true;
  panner: any = { panningModel: 'HRTF', distanceModel: 'inverse', refDistance: 1, maxDistance: 10000, rolloffFactor: 1, coneInnerAngle: 360, coneOuterAngle: 0, coneOuterGain: 0 };
  constructor(listener?: AudioListener) { super(listener); }
  setRefDistance(v: number) { this.panner.refDistance = v; return this; }
  getRefDistance() { return this.panner.refDistance; }
  setDirectionalCone(inner: number, outer: number, outerGain: number) { Object.assign(this.panner, { coneInnerAngle: inner, coneOuterAngle: outer, coneOuterGain: outerGain }); return this; }
  setDistanceModel(v: string) { this.panner.distanceModel = v; return this; }
  getDistanceModel() { return this.panner.distanceModel; }
  setMaxDistance(v: number) { this.panner.maxDistance = v; return this; }
  getMaxDistance() { return this.panner.maxDistance; }
  setRolloffFactor(v: number) { this.panner.rolloffFactor = v; return this; }
  getRolloffFactor() { return this.panner.rolloffFactor; }
  setPanningModel(v: string) { this.panner.panningModel = v; return this; }
  getPanningModel() { return this.panner.panningModel; }
}

export class Source extends Audio {
  getSize() { return [0, 0]; }
  set needsUpdate(v: boolean) { this.dispatchEvent?.({ type: 'change' } as any); }
  get needsUpdate() { return false; }
}

export class AudioAnalyser {
  isAudioAnalyser = true;
  fftSize = 2048; frequencyBinCount = 1024; minDecibels = -100; maxDecibels = -30; smoothingTimeConstant = 0.8;
  getByteFrequencyData(arr: Uint8Array) { arr.fill(0); }
  getByteTimeDomainData(arr: Uint8Array) { arr.fill(128); }
  getFloatFrequencyData(arr: Float32Array) { arr.fill(-Infinity); }
  getFloatTimeDomainData(arr: Float32Array) { arr.fill(0); }
  getFrequencyData(arr: any) { if (arr instanceof Uint8Array) this.getByteFrequencyData(arr); else this.getFloatFrequencyData(arr); }
  getAverageFrequency() { return 0; }
}

export class AudioLoader extends Loader {
  constructor(manager: any = null) { super(manager); }
  load(url: string, onLoad?: any, onProgress?: any, onError?: any) {
    const loader = new FileLoader(this.manager);
    loader.setResponseType('arraybuffer');
    return loader.load(url, (data: any) => { onLoad?.(data); }, onProgress, onError);
  }
}

// ---------------------------------------------------------------------------
// Loaders (stubs delegating to FileLoader where possible)
// ---------------------------------------------------------------------------

export class CubeTextureLoader extends Loader {
  constructor(manager: any = null) { super(manager); }
  load(url: string, onLoad?: any, onProgress?: any, onError?: any) {
    const names = ['px', 'nx', 'py', 'ny', 'pz', 'nz'];
    const imgs: any[] = [];
    let done = 0;
    for (const n of names) {
      const img = new ImageLoader(this.manager);
      img.load(url.replace('%s', n), (i: any) => { imgs[names.indexOf(n)] = i; if (++done === 6) onLoad?.(new CubeTexture(imgs)); }, onProgress, onError);
    }
    return imgs;
  }
}

export class DataTextureLoader extends Loader {
  constructor(manager: any = null) { super(manager); }
  load(url: string, onLoad?: any, onProgress?: any, onError?: any) {
    const loader = new FileLoader(this.manager); loader.setResponseType('arraybuffer');
    loader.load(url, (data: any) => onLoad?.(new DataTexture(data)), onProgress, onError);
  }
}

export class CompressedTextureLoader extends Loader {
  constructor(manager: any = null) { super(manager); }
  load(url: string, onLoad?: any, onProgress?: any, onError?: any) {
    const loader = new FileLoader(this.manager); loader.setResponseType('arraybuffer');
    loader.load(url, (data: any) => onLoad?.(Object.assign(new CompressedTexture(), { mipmaps: [data] })), onProgress, onError);
  }
}

export class BufferGeometryLoader extends Loader {
  constructor(manager: any = null) { super(manager); }
  load(url: string, onLoad?: any, onProgress?: any, onError?: any) {
    const loader = new FileLoader(this.manager); loader.setResponseType('json');
    loader.load(url, (data: any) => {
      const g = new BufferGeometry();
      if (data.attributes) for (const [name, attr] of Object.entries(data.attributes) as any) {
        g.setAttribute(name, new BufferAttribute(new Float32Array(attr.array), attr.itemSize));
      }
      if (data.index) g.setIndex(new BufferAttribute(new Uint16Array(data.index.array), 1));
      onLoad?.(g);
    }, onProgress, onError);
  }
  parse(json: any, path?: string) { return json; }
}

export class AnimationLoader extends Loader {
  constructor(manager: any = null) { super(manager); }
  load(url: string, onLoad?: any, onProgress?: any, onError?: any) {
    const loader = new FileLoader(this.manager); loader.setResponseType('json');
    loader.load(url, (data: any) => onLoad?.(this.parse(data)), onProgress, onError);
  }
  parse(json: any) {
    const clips: AnimationClip[] = [];
    if (json.animations) for (const a of json.animations) clips.push(new AnimationClip(a.name, a.duration, a.tracks ?? []));
    return clips.length ? clips : [new AnimationClip('clip', -1, [])];
  }
}

export class ObjectLoader extends Loader {
  constructor(manager: any = null) { super(manager); }
  load(url: string, onLoad?: any, onProgress?: any, onError?: any) {
    const loader = new FileLoader(this.manager); loader.setResponseType('json');
    loader.load(url, (data: any) => onLoad?.(this.parse(data)), onProgress, onError);
  }
  parse(json: any) { return new Object3D(); }
  parseAsync(url: string) { return Promise.resolve(new Object3D()); }
  parseGeometries(json: any) { return {}; }
  parseMaterials(json: any) { return {}; }
  parseAnimations(json: any) { return []; }
  parseImages(json: any) { return {}; }
  parseImagesAsync(json: any) { return Promise.resolve({}); }
  parseObject(data: any, geometries: any, materials: any, animations: any, textures: any) { return new Object3D(); }
  parseShapes(json: any) { return []; }
  parseSkeletons(json: any, bones: any) { return {}; }
  parseTextures(json: any, images: any) { return {}; }
  bindLightTargets() { return this; }
  bindSkeletons() { return this; }
}

export class MaterialLoader extends Loader {
  constructor(manager: any = null) { super(manager); }
  load(url: string, onLoad?: any, onProgress?: any, onError?: any) {
    const loader = new FileLoader(this.manager); loader.setResponseType('json');
    loader.load(url, (data: any) => onLoad?.(this.parse(data)), onProgress, onError);
  }
  parse(json: any) { return undefined as any; }
  parseAsync(url: string) { return Promise.resolve(undefined); }
  createMaterialFromType() { return undefined; }
  setTextures(textures: any) { return this; }
}

// ---------------------------------------------------------------------------
// Shader / uniforms objects
// ---------------------------------------------------------------------------

export class Uniform {
  value: any;
  constructor(value?: any) { this.value = value; }
  clone() { return new Uniform(this.value); }
}

export class UniformsGroup extends EventDispatcher {
  isUniformsGroup = true;
  uniforms: Record<string, Uniform>;
  constructor() { super(); this.uniforms = {}; }
  addUniform(obj: Record<string, Uniform>) { Object.assign(this.uniforms, obj); return this; }
  removeUniforms() { this.uniforms = {}; return this; }
  dispose() { this.dispatchEvent({ type: 'dispose' } as any); }
  add(...uniforms: any[]) { for (const u of uniforms) Object.assign(this.uniforms, u.uniforms ?? u); return this; }
  remove() { this.uniforms = {}; return this; }
  clone() { const g = new UniformsGroup(); for (const k in this.uniforms) g.uniforms[k] = this.uniforms[k].clone ? this.uniforms[k].clone() : this.uniforms[k]; return g; }
  copy(source: any) { this.uniforms = source.uniforms; return this; }
  setName(name: string) { (this as any).name = name; return this; }
  setUsage(usage: number) { (this as any).usage = usage; return this; }
}

export const ShaderChunk: Record<string, string> = {};
export const ShaderLib: Record<string, any> = {};
export const UniformsLib: Record<string, any> = {};

export const UniformsUtils = {
  clone(uniformsSrc: any) {
    const uniformsDst: any = {};
    for (const u in uniformsSrc) {
      uniformsDst[u] = { value: Array.isArray(uniformsSrc[u].value) ? uniformsSrc[u].value.slice() : uniformsSrc[u].value };
    }
    return uniformsDst;
  },
  merge(uniforms: any[]) { return uniforms.reduce((acc, u) => Object.assign(acc, u), {}); },
};

// ---------------------------------------------------------------------------
// Misc utility objects
// ---------------------------------------------------------------------------

export const ColorManagement = {
  enabled: true,
  convert(color: Color, sourceColorSpace: string, targetColorSpace: string) { return color; },
  fromWorkingColorSpace(color: Color, targetColorSpace: string) { return color; },
  toWorkingColorSpace(color: Color, sourceColorSpace: string) { return color; },
};

export const DataUtils = {
  toHalfFloat(value: number) { return value; },
  fromHalfFloat(value: number) { return value; },
  isPowerOfTwo(value: number) { return (value & (value - 1)) === 0 && value !== 0; },
  ceilPowerOfTwo(value: number) { return Math.pow(2, Math.ceil(Math.log2(value))); },
  floorPowerOfTwo(value: number) { return Math.pow(2, Math.floor(Math.log2(value))); },
  getDataURL(img: any) { return img?.src ?? ''; },
  getMaxAnisotropy() { return 16; },
};

export const ImageUtils = {
  getDataURL(img: any) { return img?.src ?? ''; },
  sRGBToLinear(c: number) { return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4); },
  LinearTosRGB(c: number) { return c <= 0.0031308 ? 12.92 * c : 1.055 * Math.pow(c, 1 / 2.4) - 0.055; },
  getMaxAnisotropy() { return 16; },
};

export const TextureUtils = {
  getByteLength(width: number, height: number, depth: number, format: number, type: number) { return width * height * (depth ?? 1) * 4; },
  toHalfFloat(value: number) { return value; },
  isImageBitmap(image: any) { return typeof ImageBitmap !== 'undefined' && image instanceof ImageBitmap; },
};

export const ShapeUtils = {
  area(contour: any[]) {
    let a = 0;
    for (let i = 0; i < contour.length; i++) {
      const p = contour[i], q = contour[(i + 1) % contour.length];
      a += p[0] * q[1] - q[0] * p[1];
    }
    return a / 2;
  },
  isClockWise(pts: any[]) {
    let sum = 0;
    for (let i = 0; i < pts.length; i++) { const p = pts[i], q = pts[(i + 1) % pts.length]; sum += (q[0] - p[0]) * (q[1] + p[1]); }
    return sum > 0;
  },
  triangulateShape(contour: any[], holes: any[]) {
    const pts = [...contour, ...holes.flat()];
    const indices: number[] = [];
    for (let i = 1; i < pts.length - 1; i++) indices.push(0, i, i + 1);
    return indices;
  },
};

export class Timer {
  isTimer = true;
  _prev = 0; _now = 0; _start = 0; _delta = 0; _elapsed = 0; _timescale = 1;
  update() {
    const now = performance?.now?.() ?? Date.now();
    this._prev = this._now; this._now = now;
    if (!this._start) this._start = now;
    this._delta = (this._now - this._prev) * this._timescale;
    this._elapsed = now - this._start;
    return this._delta;
  }
  getDelta() { return this._delta; }
  getElapsed() { return this._elapsed; }
  getElapsedSeconds() { return this._elapsed / 1000; }
  getTimescale() { return this._timescale; }
  setTimescale(v: number) { this._timescale = v; return this; }
  reset() { this._prev = this._now; this._start = 0; this._delta = 0; this._elapsed = 0; return this; }
  connect() { return this; }
  disconnect() { return this; }
  dispose() {}
}

export class PropertyMixer {
  accumulator: any; valueSize: number; path: string; bindNode: any; mixEnd: number; mixDuration: number;
  constructor(mixer: any, binding: any, valueSize: number, mixDuration: number, mixEnd: number) {
    this.accumulator = null; this.valueSize = valueSize; this.path = binding?.path ?? ''; this.bindNode = binding?.node ?? null;
    this.mixEnd = mixEnd; this.mixDuration = mixDuration;
  }
  accumulate(accuIndex: number, weight?: number) {}
  apply(accuIndex: number) {}
  restoreState() {}
  restoreOriginalState() { return this.restoreState(); }
  accumulateAdditive(weight?: number) {}
  saveOriginalState() {}
  destroy() {}
}

export class WebXRController {
  isXRController = true;
  xrTargetRaySpace: any = null; xrGripSpace: any = null; handedness = 'none'; targetRayMode = 'gaze';
  constructor() {}
  getHand() { return null; }
  dispose() {}
  connect() { return Promise.resolve(this); }
  disconnect() { return Promise.resolve(); }
  getGripSpace() { return this.xrGripSpace; }
  getHandSpace() { return this.xrGripSpace; }
  getTargetRaySpace() { return this.xrTargetRaySpace; }
  update(matrixWorld: any, frame?: any) {}
  dispatchEvent(event: any) { return true; }
}

// ---------------------------------------------------------------------------
// Functions
// ---------------------------------------------------------------------------

export function createCanvasElement(width = 300, height = 150) {
  if (typeof document === 'undefined') return null;
  const canvas = document.createElement('canvas');
  canvas.width = width; canvas.height = height;
  return canvas;
}

export const WebGLUtils = {
  convert(data: any) { return data; },
};

export const Controls = class extends EventDispatcher {
  isControls = true;
  object: any; domElement: any;
  enabled = true; target = new Vector3();
  constructor(object?: any, domElement?: any) { super(); this.object = object; this.domElement = domElement; }
  update() { return true; }
  connect() { return this; }
  disconnect() { return this; }
  dispose() {}
};

// SphericalHarmonics3 — coefficient container
export class SphericalHarmonics3 {
  isSphericalHarmonics3 = true;
  coefficients: Float32Array[];
  constructor() {
    this.coefficients = [];
    for (let i = 0; i < 9; i++) this.coefficients.push(new Float32Array(3));
  }
  set(coefficients: number[]) {
    for (let i = 0; i < 27; i++) this.coefficients[Math.floor(i / 3)][i % 3] = coefficients[i];
    return this;
  }
  zero() { for (const c of this.coefficients) c.fill(0); return this; }
  clone() { const s = new SphericalHarmonics3(); s.coefficients = this.coefficients.map(c => c.slice()); return s; }
  copy(source: SphericalHarmonics3) { this.coefficients = source.coefficients.map(c => c.slice()); return this; }
  add(sh: SphericalHarmonics3) { for (let i = 0; i < 9; i++) for (let j = 0; j < 3; j++) this.coefficients[i][j] += sh.coefficients[i][j]; return this; }
  scale(r: number) { for (const c of this.coefficients) for (let j = 0; j < 3; j++) c[j] *= r; return this; }
  lerp(sh: SphericalHarmonics3, alpha: number) { for (let i = 0; i < 9; i++) for (let j = 0; j < 3; j++) this.coefficients[i][j] += (sh.coefficients[i][j] - this.coefficients[i][j]) * alpha; return this; }
  getAt(normal: Vector3, target: Color) {
    // Evaluate SH basis — simplified: luminance of coefficients
    let r = 0, g = 0, b = 0;
    for (const c of this.coefficients) { r += c[0]; g += c[1]; b += c[2]; }
    target.setRGB(r, g, b); return target;
  }
  getIrradianceAt(normal: Vector3, target: Color) { return this.getAt(normal, target); }
  addScaledSH(sh: SphericalHarmonics3, scale: number) { return this.add(sh.clone().scale(scale)); }
  equals(sh: SphericalHarmonics3) {
    for (let i = 0; i < 9; i++) for (let j = 0; j < 3; j++) if (this.coefficients[i][j] !== sh.coefficients[i][j]) return false;
    return true;
  }
  fromArray(array: number[]) { return this.set(array); }
  toArray(target: number[] = []) {
    for (let i = 0; i < 9; i++) for (let j = 0; j < 3; j++) target.push(this.coefficients[i][j]);
    return target;
  }
}

