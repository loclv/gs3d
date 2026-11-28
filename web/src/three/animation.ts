/* --- animation -------------------------------------------------------------
 *
 * A self-contained implementation of three.js's animation API operating on
 * the facade's Object3D graph: AnimationClip describes keyframe tracks,
 * PropertyBinding resolves "nodeName.property" track names to objects, and
 * AnimationMixer/AnimationAction evaluate and blend them each update().
 * Transforms written to position/quaternion/scale/rotation flow through the
 * existing localMatrixOf cache into the engine on the next frame, so no
 * engine-side animation support is needed.
 *
 * Covered: Vector/Quaternion/Number/Color/Boolean/String keyframe tracks,
 * linear, discrete and Catmull-Rom cubic interpolation, node paths by name
 * or uuid, material sub-paths ("mesh.material.color"), indexed subtargets
 * ("mesh.morphTargetInfluences[0]"), loop modes Once/Repeat/PingPong,
 * weight blending with fadeIn/fadeOut, clampWhenFinished, and mixer
 * 'finished'/'loop' events.
 * Not covered: skeletal (bones) tracks, additive blending, property
 * bindings into textures or morph weights beyond indexed arrays.
 */

import { Vector3, Quaternion, Euler } from './math';
import { Color } from './color';
import { Object3D } from './scene';
import { EventDispatcher } from './events';

/* --- interpolants ------------------------------------------------------------ */

// Binary-search interval cache: animation evaluation calls evaluate() once
// per track per frame, and consecutive frames almost always land in the same
// or neighbouring interval.
function intervalIndex(times: ArrayLike<number>, t: number, lastIndex = 0) {
  const n = times.length;
  if (n === 0) return 0;
  if (t <= times[0]) return 0;
  if (t >= times[n - 1]) return n - 2;
  let i = lastIndex;
  if (i < 0 || i >= n - 1) i = 0;
  if (t < times[i]) {
    while (i > 0 && t < times[i]) i--;
  } else {
    while (i < n - 2 && t >= times[i + 1]) i++;
  }
  return i;
}

// Interpolation type constants, matching three's Interpolate* numbering.
export const InterpolateDiscrete = 2300;
export const InterpolateLinear = 2301;
export const InterpolateSmooth = 2302;

export class Interpolant {
  parameterPositions: any;
  sampleValues: any;
  valueSize: number;
  resultBuffer: any;
  interpolantFactor = 0;
  interpolantBuffer = null;
  isInterpolant = true;
  constructor(parameterPositions, sampleValues, sampleSize, resultBuffer) {
    this.parameterPositions = parameterPositions;
    this.sampleValues = sampleValues;
    this.valueSize = sampleSize;
    this.resultBuffer = resultBuffer !== undefined ? resultBuffer : new (sampleValues as any).constructor(sampleSize);
  }
  evaluate(t) {
    throw new Error('Interpolant.evaluate must be implemented by subclasses');
  }
  interpolate_(i1, t0, t, i2) {
    throw new Error('Interpolant.interpolate_ must be implemented by subclasses');
  }
  before(t) {}
  after(t) {}
  // three.js private-method names; subclasses implement real logic.
  copySampleValue_(index) { return this.sampleValues.subarray ? this.sampleValues.subarray(index * this.valueSize, (index + 1) * this.valueSize) : this.sampleValues.slice(index * this.valueSize, (index + 1) * this.valueSize); }
  getSettings_() { return {}; }
  intervalChanged_(i1, t0, t, i2) {}
}

export class LinearInterpolant extends Interpolant {
  isLinearInterpolant = true;
  evaluate(t) {
    const pp = this.parameterPositions, sv = this.sampleValues, vs = this.valueSize;
    const i1 = intervalIndex(pp, t, (this as any)._lastIndex | 0);
    (this as any)._lastIndex = i1;
    const i2 = Math.min(i1 + 1, pp.length - 1);
    const t1 = pp[i1], t2 = pp[i2];
    const weight = t2 === t1 ? 0 : (t - t1) / (t2 - t1);
    this.interpolate_(i1, t1, weight, i2);
    return this.resultBuffer;
  }
  interpolate_(i1, t0, t, i2) {
    const sv = this.sampleValues, vs = this.valueSize, rb = this.resultBuffer;
    const o1 = i1 * vs, o2 = i2 * vs;
    for (let j = 0; j < vs; j++) rb[j] = sv[o1 + j] + (sv[o2 + j] - sv[o1 + j]) * t;
  }
}

// Quaternion tracks blend on the sphere, not component-wise.
export class QuaternionLinearInterpolant extends LinearInterpolant {
  isQuaternionInterpolant = true;
  interpolate_(i1, t0, t, i2) {
    const sv = this.sampleValues, vs = this.valueSize, rb = this.resultBuffer;
    const o1 = i1 * vs, o2 = i2 * vs;
    // Flat-array slerp between the two quaternion keys.
    let bx = sv[o2], by = sv[o2 + 1], bz = sv[o2 + 2], bw = sv[o2 + 3];
    let cosHalf = sv[o1] * bx + sv[o1 + 1] * by + sv[o1 + 2] * bz + sv[o1 + 3] * bw;
    if (cosHalf < 0) { cosHalf = -cosHalf; bx = -bx; by = -by; bz = -bz; bw = -bw; }
    if (cosHalf > 0.9995) {
      rb[0] = sv[o1] + (bx - sv[o1]) * t; rb[1] = sv[o1 + 1] + (by - sv[o1 + 1]) * t;
      rb[2] = sv[o1 + 2] + (bz - sv[o1 + 2]) * t; rb[3] = sv[o1 + 3] + (bw - sv[o1 + 3]) * t;
      const l = Math.hypot(rb[0], rb[1], rb[2], rb[3]) || 1;
      rb[0] /= l; rb[1] /= l; rb[2] /= l; rb[3] /= l;
      return;
    }
    const half = Math.acos(Math.min(1, cosHalf));
    const sinHalf = Math.sin(half);
    const ra = Math.sin((1 - t) * half) / sinHalf, rbw = Math.sin(t * half) / sinHalf;
    rb[0] = sv[o1] * ra + bx * rbw; rb[1] = sv[o1 + 1] * ra + by * rbw;
    rb[2] = sv[o1 + 2] * ra + bz * rbw; rb[3] = sv[o1 + 3] * ra + bw * rbw;
  }
}

// Catmull-Rom cubic: tangents come from the neighbouring keys, matching
// three.js CubicInterpolant closely enough for authored splines.
export class CubicInterpolant extends LinearInterpolant {
  isCubicInterpolant = true;
  evaluate(t) {
    const pp = this.parameterPositions, sv = this.sampleValues, vs = this.valueSize;
    const n = pp.length;
    if (n < 2) return this.resultBuffer;
    const i = intervalIndex(pp, t, (this as any)._lastIndex | 0);
    (this as any)._lastIndex = i;
    const i1 = i, i2 = Math.min(i + 1, n - 1);
    const t1 = pp[i1], t2 = pp[i2];
    const w = t2 === t1 ? 0 : (t - t1) / (t2 - t1);
    const rb = this.resultBuffer;
    const i0 = Math.max(0, i1 - 1), i3 = Math.min(n - 1, i2 + 1);
    for (let j = 0; j < vs; j++) {
      const p0 = sv[i0 * vs + j], p1 = sv[i1 * vs + j];
      const p2 = sv[i2 * vs + j], p3 = sv[i3 * vs + j];
      const m1 = (p2 - p0) / (pp[i2] - pp[i0] || 1);
      const m2 = (p3 - p1) / (pp[i3] - pp[i1] || 1);
      const w2 = w * w, w3 = w2 * w;
      const h00 = 2 * w3 - 3 * w2 + 1, h10 = w3 - 2 * w2 + w;
      const h01 = -2 * w3 + 3 * w2, h11 = w3 - w2;
      const dt = t2 - t1 || 1;
      rb[j] = h00 * p1 + h10 * dt * m1 + h01 * p2 + h11 * dt * m2;
    }
    return rb;
  }
}

export class DiscreteInterpolant extends LinearInterpolant {
  isDiscreteInterpolant = true;
  evaluate(t) {
    const pp = this.parameterPositions, sv = this.sampleValues, vs = this.valueSize;
    const i = intervalIndex(pp, t, (this as any)._lastIndex | 0);
    (this as any)._lastIndex = i;
    // Discrete holds the earlier key until the next key is reached.
    const src = Math.min(i, pp.length - 1) * vs, rb = this.resultBuffer;
    for (let j = 0; j < vs; j++) rb[j] = sv[src + j];
    return rb;
  }
}

/* --- keyframe tracks ---------------------------------------------------------- */

const TRACK_VALUE_SIZES = { vector: 3, quaternion: 4, color: 3, number: 1, bool: 1, string: 1 };

export class KeyframeTrack {
  isKeyframeTrack: boolean;
  name: string;
  times: any;
  values: any;
  valueTypeName: string;
  DefaultInterpolation: string;
  constructor(name: string, times: any, values: any, interpolation?: string) {
    this.isKeyframeTrack = true;
    this.name = name;
    this.times = times instanceof Float32Array ? times : Float32Array.from(times);
    this.values = values;
    this.valueTypeName = 'number';
    this.DefaultInterpolation = interpolation || 'linear';
    // Keys must be strictly increasing for interpolation lookups.
    for (let i = 1; i < this.times.length; i++) {
      if (this.times[i] <= this.times[i - 1]) throw new Error(`gs3d: KeyframeTrack '${name}' times must be strictly increasing`);
    }
  }
  getValueSize() { return TRACK_VALUE_SIZES[this.valueTypeName] ?? 1; }
  getInterpolation() { return this.DefaultInterpolation; }
  setInterpolation(interpolation: string) {
    this.DefaultInterpolation = interpolation;
    return this;
  }
  // Scale all key times by a factor (three.js KeyframeTrack.scale).
  scale(timeScale: number) {
    const times = this.times;
    for (let i = 0; i < times.length; i++) times[i] *= timeScale;
    return this;
  }
  // Shift all key times by an offset.
  shift(timeOffset: number) {
    const times = this.times;
    for (let i = 0; i < times.length; i++) times[i] += timeOffset;
    return this;
  }
  // Keep only keys in [startTime, endTime); returns the removed count.
  trim(startTime: number, endTime: number) {
    const times = this.times, values = this.values, size = this.getValueSize();
    const keepTimes: number[] = [], keepValues: number[] = [];
    let removed = 0;
    for (let i = 0; i < times.length; i++) {
      if (times[i] >= startTime && times[i] < endTime) {
        keepTimes.push(times[i]);
        for (let j = 0; j < size; j++) keepValues.push(values[i * size + j]);
      } else removed++;
    }
    if (!removed) return 0;
    this.times = Float32Array.from(keepTimes);
    this.values = values instanceof Float32Array ? Float32Array.from(keepValues) : keepValues;
    return removed;
  }
  // Validate monotonic times and value count; returns true when sane.
  validate() {
    const n = this.times.length, size = this.getValueSize();
    const expected = n * size;
    const actual = this.values.length;
    if (actual !== expected) {
      console.warn?.(`gs3d: KeyframeTrack '${this.name}' values length ${actual} != times*size ${expected}`);
      return false;
    }
    for (let i = 1; i < n; i++) {
      if (this.times[i] <= this.times[i - 1]) {
        console.warn?.(`gs3d: KeyframeTrack '${this.name}' times not increasing at ${i}`);
        return false;
      }
    }
    return true;
  }
  // Remove redundant keys (equal adjacent values); returns the track.
  optimize() {
    const times = this.times, values = this.values, size = this.getValueSize();
    if (times.length <= 2) return this;
    const kt: number[] = [], kv: number[] = [];
    const push = i => {
      kt.push(times[i]);
      for (let j = 0; j < size; j++) kv.push(values[i * size + j]);
    };
    push(0);
    for (let i = 1; i < times.length - 1; i++) {
      let same = true;
      for (let j = 0; j < size; j++) {
        if (values[i * size + j] !== values[(i - 1) * size + j] ||
            values[i * size + j] !== values[(i + 1) * size + j]) { same = false; break; }
      }
      if (!same) push(i);
    }
    push(times.length - 1);
    this.times = Float32Array.from(kt);
    this.values = values instanceof Float32Array ? Float32Array.from(kv) : kv;
    return this;
  }
  toJSON() {
    return {
      name: this.name,
      times: Array.from(this.times),
      values: Array.from(this.values),
      type: this.constructor.name,
    };
  }
  createInterpolant(result?: any) {
    const size = this.getValueSize();
    const values = this.values instanceof Float32Array ? this.values : Float32Array.from(this.values as any);
    const kind = this.DefaultInterpolation || 'linear';
    const rb = result !== undefined ? result : new Float32Array(size);
    if (kind === 'discrete') return new DiscreteInterpolant(this.times, values, size, rb);
    if (kind === 'cubic') return new CubicInterpolant(this.times, values, size, rb);
    if (this.valueTypeName === 'quaternion') return new QuaternionLinearInterpolant(this.times, values, size, rb);
    return new LinearInterpolant(this.times, values, size, rb);
  }
  clone() {
    const Ctor = (this as any).constructor;
    const copy = new Ctor(this.name,
      this.times instanceof Float32Array ? this.times.slice() : Array.from(this.times),
      this.values instanceof Float32Array ? this.values.slice() : Array.from(this.values),
      this.DefaultInterpolation);
    return copy;
  }
}

// Prototype-level factory hooks, matching three r180's per-instance surface.
const _KTproto: any = KeyframeTrack.prototype;
_KTproto.InterpolantFactoryMethodDiscrete = function (buffer?: any) {
  return new DiscreteInterpolant(this.times, this.values, this.getValueSize(), buffer);
};
_KTproto.InterpolantFactoryMethodLinear = function (buffer?: any) {
  return new LinearInterpolant(this.times, this.values, this.getValueSize(), buffer);
};
_KTproto.InterpolantFactoryMethodSmooth = function (buffer?: any) {
  return new CubicInterpolant(this.times, this.values, this.getValueSize(), buffer);
};
_KTproto.TimeBufferType = Float32Array;
_KTproto.ValueBufferType = Float32Array;

export class VectorKeyframeTrack extends KeyframeTrack {
  constructor(name, times, values, interpolation?) { super(name, times, values, interpolation); this.valueTypeName = 'vector'; }
}
export class QuaternionKeyframeTrack extends KeyframeTrack {
  constructor(name, times, values, interpolation?) { super(name, times, values, interpolation); this.valueTypeName = 'quaternion'; }
}
export class NumberKeyframeTrack extends KeyframeTrack {
  constructor(name, times, values, interpolation?) { super(name, times, values, interpolation); this.valueTypeName = 'number'; }
}
export class ColorKeyframeTrack extends KeyframeTrack {
  constructor(name, times, values, interpolation?) { super(name, times, values, interpolation); this.valueTypeName = 'color'; }
}
export class BooleanKeyframeTrack extends KeyframeTrack {
  constructor(name, times, values, interpolation?) { super(name, times, values, interpolation); this.valueTypeName = 'bool'; }
}
export class StringKeyframeTrack extends KeyframeTrack {
  constructor(name, times, values, interpolation?) { super(name, times, values, interpolation); this.valueTypeName = 'string'; this.DefaultInterpolation = 'discrete'; }
}

const TRACK_CTORS: Record<string, any> = {
  VectorKeyframeTrack, QuaternionKeyframeTrack, NumberKeyframeTrack,
  ColorKeyframeTrack, BooleanKeyframeTrack, StringKeyframeTrack,
};

/* --- property binding ---------------------------------------------------------- */

// Track names look like "nodeName.position", "uuid.quaternion",
// "mesh.material.color" or "node.morphTargetInfluences[0]". The first
// segment names the node (by name or uuid); the rest is a property path
// with optional [index] subtargets.
export function parseTrackName(trackName: string) {
  const lastDot = trackName.lastIndexOf('.');
  const nodeName = lastDot < 0 ? trackName : trackName.slice(0, lastDot);
  const propertyPath = lastDot < 0 ? '' : trackName.slice(lastDot + 1);
  const path: string[] = [];
  const re = /([^.[\]]+)|\[(\d+)\]/g;
  let m;
  while ((m = re.exec(propertyPath)) !== null) {
    if (m[1] !== undefined) path.push(m[1]);
    else path.push(`[${m[2]}]`);
  }
  return { nodeName, propertyPath, path };
}

export function findNodeByName(root: Object3D, nodeName: string): Object3D | null {
  if (!nodeName) return root;
  let found: Object3D | null = null;
  root.traverse(node => {
    if (found) return;
    if (node.name === nodeName || (node as any).uuid === nodeName) found = node;
  });
  return found;
}

// Track names embed the node name as a prefix: "box.material.color" binds
// node "box" then walks ["material","color"]. Node names may contain dots,
// so resolve by longest prefix match over name/uuid, like three's
// PropertyBinding.parseTrackName + findNode.
export function findNodeForTrack(root: Object3D, trackName: string) {
  let bestNode: Object3D | null = null;
  let bestIdLen = -1;
  let bestRest = '';
  root.traverse(node => {
    for (const id of [node.name, (node as any).uuid]) {
      if (!id) continue;
      if (trackName === id || trackName.startsWith(id + '.')) {
        if (id.length > bestIdLen) {
          bestIdLen = id.length;
          bestNode = node;
          bestRest = trackName === id ? '' : trackName.slice(id.length + 1);
        }
      }
    }
  });
  if (!bestNode) return trackName ? null : { node: root, path: [] };
  const path: string[] = [];
  const re = /([^.[\]]+)|\[(\d+)\]/g;
  let m;
  while ((m = re.exec(bestRest)) !== null) {
    if (m[1] !== undefined) path.push(m[1]);
    else path.push(`[${m[2]}]`);
  }
  return { node: bestNode, path };
}

function resolveTarget(object: any, path: string[]): any {
  // Walk "material.color", "morphTargetInfluences[2]" style segments.
  let target = object;
  for (const seg of path) {
    if (target == null) return null;
    const indexed = seg.match(/^\[(\d+)\]$/);
    if (indexed) {
      target = target[Number(indexed[1])];
      continue;
    }
    if (seg === 'material') {
      target = Array.isArray(target.material) ? target.material[0] : target.material;
      continue;
    }
    target = target[seg];
  }
  return target;
}

export class PropertyBinding {
  isPropertyBinding: boolean;
  path: string;
  nodeName: string;
  rootNode: Object3D;
  node: any;
  propertyPath: string[];
  parsedPath: any;
  getValueSize: number;
  value: any = null;
  _target: any = null;
  _resolved = false;
  constructor(rootNode: Object3D, path: string, parsedPath?: any) {
    this.isPropertyBinding = true;
    this.path = path;
    this.rootNode = rootNode;
    const parsed = parsedPath || parseTrackName(path);
    this.nodeName = parsed.nodeName;
    this.propertyPath = parsed.path;
    this.parsedPath = parsed;
    this.getValueSize = 0;
    this.node = null;
    this._resolved = false;
  }
  static create(rootNode: Object3D, trackName: string, parsedPath?: any) {
    return new PropertyBinding(rootNode, trackName, parsedPath);
  }
  bind() { return this; }
  unbind() { this._resolved = false; this._target = null; return this; }
  // Resolve to { object, key }: the parent object and the property (or array
  // index) the values write into. Nodes may be added after clipAction, so
  // resolution retries until it succeeds.
  resolve() {
    if (this._resolved) return this._target;
    const found = findNodeForTrack(this.rootNode, this.path);
    if (!found) return null;
    this.node = found.node;
    const path = found.path;
    let target: any = null;
    if (!path.length) {
      target = null; // bare node name binds nothing writable
    } else {
      const leaf = path[path.length - 1];
      const indexed = leaf.match(/^\[(\d+)\]$/);
      if (indexed) {
        // path like [...,'morphTargetInfluences','[0]']: parent is the array.
        const array = resolveTarget(this.node, path.slice(0, -1));
        target = array == null ? null : { object: array, key: Number(indexed[1]) };
      } else {
        const object = resolveTarget(this.node, path.slice(0, -1));
        target = object == null || object === undefined ? null : { object, key: leaf };
      }
    }
    this._target = target;
    this._resolved = target !== null;
    return target;
  }
  _readProp(prop: any, targetArray: any, offset: number) {
    if (prop == null) return targetArray;
    if (prop.isVector3 || prop.isVector2) {
      targetArray[offset] = prop.x; targetArray[offset + 1] = prop.y;
      if (this.getValueSize >= 3) targetArray[offset + 2] = prop.z;
      return targetArray;
    }
    if (prop.isQuaternion) {
      targetArray[offset] = prop.x; targetArray[offset + 1] = prop.y;
      targetArray[offset + 2] = prop.z; targetArray[offset + 3] = prop.w;
      return targetArray;
    }
    if (prop.isEuler) {
      targetArray[offset] = prop.x; targetArray[offset + 1] = prop.y; targetArray[offset + 2] = prop.z;
      return targetArray;
    }
    if (prop.isColor) {
      targetArray[offset] = prop.r; targetArray[offset + 1] = prop.g; targetArray[offset + 2] = prop.b;
      return targetArray;
    }
    targetArray[offset] = typeof prop === 'number' ? prop : (prop ? 1 : 0);
    return targetArray;
  }
  _writeProp(prop: any, object: any, key: any, buffer: any, offset: number) {
    if (prop != null) {
      if (prop.isVector3 || prop.isVector2) {
        prop.set(buffer[offset], buffer[offset + 1], prop.isVector2 ? prop.y : buffer[offset + 2]);
        return;
      }
      if (prop.isQuaternion) { prop.set(buffer[offset], buffer[offset + 1], buffer[offset + 2], buffer[offset + 3]); return; }
      if (prop.isEuler) { prop.set(buffer[offset], buffer[offset + 1], buffer[offset + 2]); return; }
      if (prop.isColor) { prop.setRGB(buffer[offset], buffer[offset + 1], buffer[offset + 2]); return; }
    }
    object[key] = buffer[offset];
  }
  getValue(targetArray: any, offset = 0) {
    const resolved = this.resolve();
    if (!resolved) return targetArray;
    return this._readProp(resolved.object[resolved.key], targetArray, offset);
  }
  setValue(buffer: any, offset = 0) {
    const resolved = this.resolve();
    if (!resolved) return;
    this._writeProp(resolved.object[resolved.key], resolved.object, resolved.key, buffer, offset);
  }
  accumulate(accuIndex: number, value: any, weight: number, valueType: string) {
    const s = bindingAcc(this);
    const size = this.getValueSize || value.length;
    if (s.buffer.length < size) s.buffer = new Float64Array(size);
    s.quat = valueType === 'quaternion';
    for (let i = 0; i < size; i++) s.buffer[i] += (value[i] ?? 0) * weight;
    s.weight += weight;
  }
  apply(accuIndex: number) {
    const s = bindingState.get(this);
    if (!s || s.weight === 0) return;
    const buf = s.buffer;
    if (s.quat) {
      const l = Math.hypot(buf[0], buf[1], buf[2], buf[3]) || 1;
      buf[0] /= l; buf[1] /= l; buf[2] /= l; buf[3] /= l;
    } else {
      const inv = 1 / s.weight;
      for (let i = 0; i < buf.length; i++) buf[i] *= inv;
    }
    this.setValue(buf, 0);
    s.weight = 0;
    s.buffer.fill(0);
  }
}

/* --- animation clip ------------------------------------------------------------ */

export class AnimationClip {
  isAnimationClip: boolean;
  name: string;
  tracks: KeyframeTrack[];
  duration: number;
  uuid: string;
  blendMode: string;
  constructor(name: string, duration: number, tracks: KeyframeTrack[] = [], blendMode = 'normal') {
    this.isAnimationClip = true;
    this.name = name;
    this.tracks = tracks.slice();
    this.blendMode = blendMode;
    this.uuid = 'clip-' + Math.random().toString(36).slice(2, 10);
    this.resetDuration();
  }
  resetDuration() {
    let max = 0;
    for (const track of this.tracks) {
      const t = track.times;
      if (t.length && t[t.length - 1] > max) max = t[t.length - 1];
    }
    this.duration = max;
    return this;
  }
  // Sanity-check tracks: monotonic times and matching value strides.
  validate() {
    for (const track of this.tracks) {
      const t = track.times, vs = track.getValueSize ? track.getValueSize() : 1;
      const expected = t.length * vs;
      if (track.values && track.values.length !== expected)
        console.warn(`gs3d: AnimationClip '${this.name}' track '${track.name}' has mismatched value count`);
      for (let i = 1; i < t.length; i++)
        if (t[i] <= t[i - 1])
          console.warn(`gs3d: AnimationClip '${this.name}' track '${track.name}' times not sorted`);
    }
    return this;
  }
  clone() {
    return new AnimationClip(this.name, this.duration, this.tracks.map(t => t.clone()), this.blendMode);
  }
  optimize() { return this; }
  trim() { return this; }
  toJSON() {
    return {
      name: this.name,
      duration: this.duration,
      tracks: this.tracks.map(t => t.toJSON ? t.toJSON() : null).filter(Boolean),
      uuid: this.uuid,
      blendMode: this.blendMode,
    };
  }
  static parse(json: any) {
    // Minimal inverse of toJSON for round-tripping simple clips.
    const tracks = (json.tracks || []).map((t: any) => {
      const Ctor = TRACK_CTORS[t.type] || NumberKeyframeTrack;
      return new Ctor(t.name, t.times || [], t.values || [], 'linear');
    });
    const clip = new AnimationClip(json.name || 'clip', json.duration ?? -1, tracks, json.blendMode);
    clip.resetDuration();
    return clip;
  }
  static CreateClipsFromMorphTargetTracks(name, tracks, fps = 30) {
    const clip = new AnimationClip(name, -1, tracks);
    clip.resetDuration();
    return clip;
  }
}

export const LoopOnce = 2200;
export const LoopRepeat = 2201;
export const LoopPingPong = 2202;

// Keyframe interpolation endings and animation blend modes (three values).
export const ZeroCurvatureEnding = 2400;
export const ZeroSlopeEnding = 2401;
export const WrapAroundEnding = 2402;
export const NormalAnimationBlendMode = 2500;
export const AdditiveAnimationBlendMode = 2501;

/* --- animation action ------------------------------------------------------------ */

export class AnimationAction {
  isAnimationAction: boolean;
  mixer: AnimationMixer | null;
  clip: AnimationClip;
  root: Object3D | null;
  _propertyBindings: any[] = [];
  paused = false;
  enabled = true;
  time = 0;
  timeScale = 1;
  _effectiveTimeScale = 1;
  weight = 1;
  _effectiveWeight = 0;
  loop = LoopRepeat;
  repetitions = -1;
  _loopCount = -1;
  clampWhenFinished = false;
  zeroSlopeAtStart = false;
  zeroSlopeAtEnd = false;
  _startTime = -1;
  _mixerTime = 0;
  _rampStart = -1;
  _rampEnd = -1;
  _rampFrom = 1;
  _rampTo = 1;
  _direction = 1;
  _finished = false;
  _haltWhenRampDone = false;
  _warpFrom = 1;
  _warpTo = 1;
  _warpStart = -1;
  _warpEnd = -1;
  constructor(mixer: AnimationMixer | null, clip: AnimationClip, root?: Object3D) {
    this.isAnimationAction = true;
    this.mixer = mixer;
    this.clip = clip;
    this.root = root !== undefined ? root : (mixer ? mixer._root : null);
  }
  _updateBindings() {
    if (this._propertyBindings.length) return;
    for (const track of this.clip.tracks) {
      const interpolant = track.createInterpolant();
      // Bindings are shared per (root, track name) through the mixer so
      // multiple actions accumulate into one weighted result, like three's
      // PropertyMixer cache.
      const binding = this.mixer
        ? this.mixer._getBinding(this.root!, track)
        : PropertyBinding.create(this.root!, track.name);
      if (!binding.resolve()) continue;
      binding.getValueSize = track.getValueSize();
      binding.value = interpolant.resultBuffer;
      this._propertyBindings.push({ track, interpolant, binding });
    }
  }
  play() {
    if (this.enabled === false) return this;
    this.paused = false;
    this.enabled = true;
    if (this.mixer) this.mixer._activateAction(this);
    return this;
  }
  stop() {
    if (this._finished) {
      if (this.mixer) this.mixer._deactivateAction(this);
      return this;
    }
    if (this.clampWhenFinished) {
      this.paused = true;
      return this;
    }
    this.reset();
    if (this.mixer) this.mixer._deactivateAction(this);
    return this;
  }
  reset() {
    this.paused = false;
    this.enabled = true;
    this.time = 0;
    this._loopCount = -1;
    this._startTime = -1;
    this._direction = 1;
    this._finished = false;
    this._effectiveWeight = this.weight;
    return this;
  }
  isRunning() { return this.enabled && !this.paused && !this._finished; }
  isScheduled() { return this._startTime >= 0; }
  pause() { this.paused = true; return this; }
  unpause() { this.paused = false; return this; }
  setLoop(mode: number, repetitions = -1) { this.loop = mode; this.repetitions = repetitions; return this; }
  setEffectiveTimeScale(s: number) { this._effectiveTimeScale = s; return this; }
  getEffectiveTimeScale() { return this._effectiveTimeScale; }
  setEffectiveWeight(w: number) { this.weight = w; return this; }
  getEffectiveWeight() { return this._effectiveWeight; }
  fadeIn(duration: number) { return this._scheduleFade(this.weight, duration); }
  fadeOut(duration: number) { return this._scheduleFade(0, duration); }
  _scheduleFade(to: number, duration: number) {
    const mixerTime = this.mixer ? this.mixer.time : 0;
    this._rampFrom = this._effectiveWeight;
    this._rampTo = to;
    this._rampStart = mixerTime;
    this._rampEnd = mixerTime + Math.max(0.0001, duration);
    return this;
  }
  setEffectiveWeightValue(w: number) { this._effectiveWeight = w; return this; }
  setClampWhenFinished(clamp: boolean) { this.clampWhenFinished = clamp; return this; }
  syncWith(action: AnimationAction) { return this.play(); }
  getMixer() { return this.mixer; }
  getRoot() { return this.root; }
  getClip() { return this.clip; }
  setDuration(duration: number) {
    this.timeScale = duration / (this.clip.duration || 1) || 1;
    return this;
  }
  startAt(time: number) { this.time = time; return this; }
  stopFading() { this._rampEnd = -1; return this; }
  stopWarping() { this._warpEnd = -1; return this; }
  // Fade this action out while fadeInAction fades in over `duration`.
  crossFadeTo(fadeInAction: AnimationAction, duration: number, warp = false) {
    fadeInAction.fadeIn(duration);
    this.fadeOut(duration);
    if (warp) {
      const scale = (fadeInAction.clip.duration / (this.clip.duration || 1)) *
        (fadeInAction.timeScale / (this.timeScale || 1));
      this.warp(scale, duration);
      fadeInAction.warp(1 / (scale || 1), duration);
    }
    return this;
  }
  crossFadeFrom(fadeOutAction: AnimationAction, duration: number, warp = false) {
    return fadeOutAction.crossFadeTo(this, duration, warp);
  }
  // Stop after an optional fade-out.
  halt(duration = 0) {
    if (duration > 0) {
      this.fadeOut(duration);
      this._haltWhenRampDone = true;
    } else {
      this._haltWhenRampDone = false;
      this.stop();
    }
    return this;
  }
  // Ramp the effective time scale over `duration` seconds.
  warp(timeScale: number, duration = 0) {
    const mixerTime = this.mixer ? this.mixer.time : 0;
    this._warpFrom = this._effectiveTimeScale;
    this._warpTo = timeScale;
    this._warpStart = mixerTime;
    this._warpEnd = mixerTime + Math.max(0.0001, duration);
    return this;
  }
  _update(deltaTime: number, mixerTime: number) {
    if (!this.enabled) return;
    // Weight ramp; with no ramp scheduled the effective weight tracks weight.
    if (this._rampEnd >= 0) {
      if (mixerTime < this._rampEnd) {
        const span = this._rampEnd - this._rampStart || 1;
        const t = Math.min(1, (mixerTime - this._rampStart) / span);
        this._effectiveWeight = this._rampFrom + (this._rampTo - this._rampFrom) * t;
      } else {
        this.weight = this._rampTo;
        this._effectiveWeight = this._rampTo;
        this._rampEnd = -1;
      }
    } else {
      this._effectiveWeight = this.weight;
    }
    if (this._warpEnd >= 0) {
      if (mixerTime < this._warpEnd) {
        const span = this._warpEnd - this._warpStart || 1;
        const t = Math.min(1, (mixerTime - this._warpStart) / span);
        this._effectiveTimeScale = this._warpFrom + (this._warpTo - this._warpFrom) * t;
      } else {
        this._effectiveTimeScale = this._warpTo;
        this._warpEnd = -1;
      }
    }
    if (this._haltWhenRampDone && this._rampEnd < 0) {
      this._haltWhenRampDone = false;
      this.stop();
      return;
    }
    if (this.paused || this._finished) {
      if (this._finished && !this.clampWhenFinished) this.enabled = false;
      return;
    }
    const duration = this.clip.duration;
    const step = deltaTime * this.timeScale * this._direction;
    this.time += step;
    const loop = this.loop;
    let event: any = null;
    if (loop === LoopOnce) {
      if (this.time >= duration) {
        this.time = duration;
        this._finish(1, mixerTime);
        event = { type: 'finished', action: this, direction: 1 };
      } else if (this.time < 0) {
        this.time = 0;
        this._direction = -this._direction;
      }
    } else if (loop === LoopPingPong) {
      if (this.time >= duration) {
        this._direction = -1;
        this.time = duration - (this.time - duration);
        if (this.repetitions >= 0 && ++this._loopCount >= this.repetitions) {
          this._finish(-1, mixerTime);
          event = { type: 'finished', action: this, direction: -1 };
        }
        event = event || { type: 'loop', action: this, direction: -1 };
      } else if (this.time < 0) {
        this._direction = 1;
        this.time = -this.time;
        if (this.repetitions >= 0 && ++this._loopCount >= this.repetitions) {
          this._finish(1, mixerTime);
          event = { type: 'finished', action: this, direction: 1 };
        }
        event = event || { type: 'loop', action: this, direction: 1 };
      }
    } else {
      // LoopRepeat
      if (this.time >= duration) {
        this._loopCount++;
        this.time -= Math.floor(this.time / duration) * duration;
        if (this.repetitions >= 0 && this._loopCount >= this.repetitions) {
          this.time = duration;
          this._finish(1, mixerTime);
          event = { type: 'finished', action: this, direction: 1 };
        } else {
          event = { type: 'loop', action: this, direction: 1 };
        }
      } else if (this.time < 0) {
        this._loopCount++;
        this.time = -this.time;
        if (this.time >= duration) this.time = duration;
        if (this.repetitions >= 0 && this._loopCount >= this.repetitions) {
          this._finish(-1, mixerTime);
          event = { type: 'finished', action: this, direction: -1 };
        } else {
          event = { type: 'loop', action: this, direction: -1 };
        }
      }
    }
    if (event && this.mixer) this.mixer._events.push(event);
  }
  _finish(direction: number, mixerTime: number) {
    this._finished = true;
    this._direction = direction;
    if (!this.clampWhenFinished && this.mixer) this.mixer._deactivateAction(this);
  }
  // Evaluate every track at the action's local time into the binding's
  // accumulator, weighted by the effective weight.
  _accumulate(accuIndex: number) {
    this._updateBindings();
    if (!this._propertyBindings.length) return;
    const w = this._effectiveWeight;
    if (w === 0) return;
    const t = this.time;
    for (const pb of this._propertyBindings) {
      const value = pb.interpolant.evaluate(t);
      pb.binding.accumulate(accuIndex, value, w, pb.track.valueTypeName);
    }
  }
  _apply(accuIndex: number) {
    for (const pb of this._propertyBindings) pb.binding.apply(accuIndex);
  }
}

/* --- property mixer -------------------------------------------------------------- */

// Bindings accumulate weighted track values, then normalize and write once —
// the same accumulation three.js's PropertyMixer performs, specialised to a
// single accumulator slot per update.
const bindingState = new WeakMap<PropertyBinding, { buffer: Float64Array; weight: number; quat: boolean }>();

function bindingAcc(binding: PropertyBinding) {
  let s = bindingState.get(binding);
  if (!s) {
    s = { buffer: new Float64Array(Math.max(4, binding.getValueSize)), weight: 0, quat: false };
    bindingState.set(binding, s);
  }
  return s;
}

/* --- animation mixer -------------------------------------------------------------- */

export class AnimationMixer extends EventDispatcher {
  isAnimationMixer: boolean;
  _root: Object3D;
  _actions: AnimationAction[] = [];
  _bindings: Map<string, any> = new Map();
  _bindingCache: Map<string, PropertyBinding> = new Map();
  time = 0;
  timeScale = 1;
  _events: any[] = [];
  constructor(root: Object3D) {
    super();
    this.isAnimationMixer = true;
    this._root = root;
    this.time = 0;
    this.timeScale = 1;
  }
  get root() { return this._root; }
  getRoot() { return this._root; }
  clipAction(clip: AnimationClip, optionalRoot?: Object3D) {
    // three caches one action per (clip, root) pair.
    const root = optionalRoot !== undefined ? optionalRoot : this._root;
    const existing = this.existingAction(clip, root);
    if (existing) return existing;
    const action = new AnimationAction(this, clip, root);
    this._actions.push(action);
    return action;
  }
  _activateAction(action: AnimationAction) {
    if (!this._actions.includes(action)) this._actions.push(action);
  }
  _deactivateAction(action: AnimationAction) {
    const i = this._actions.indexOf(action);
    if (i >= 0) this._actions.splice(i, 1);
  }
  _getBinding(root: Object3D, track: KeyframeTrack): PropertyBinding {
    const key = (root as any).uuid + '|' + track.name;
    let binding = this._bindingCache.get(key);
    if (!binding) {
      binding = PropertyBinding.create(root, track.name);
      binding.getValueSize = track.getValueSize();
      this._bindingCache.set(key, binding);
    }
    return binding;
  }
  update(deltaTime: number) {
    this.time += deltaTime * this.timeScale;
    const accuIndex = 0;
    // Snapshot once: actions deactivated mid-update (LoopOnce finish) must
    // still accumulate and apply their final frame.
    const active = this._actions.filter(a => a.enabled);
    for (const action of active) {
      action._update(deltaTime * this.timeScale, this.time);
      action._accumulate(accuIndex);
    }
    for (const action of active) action._apply(accuIndex);
    if (this._events.length) {
      const events = this._events.splice(0);
      for (const e of events) this.dispatchEvent(e);
    }
    return this;
  }
  setTime(timeInSeconds: number) {
    // Drive every action to an absolute mixer time.
    const delta = timeInSeconds - this.time;
    if (delta !== 0) this.update(delta);
    return this;
  }
  stopAllAction() {
    for (const action of [...this._actions]) action.stop();
    return this;
  }
  uncacheClip(clip: AnimationClip) {
    for (const action of [...this._actions]) {
      if (action.clip === clip) this._deactivateAction(action);
    }
    this._bindingCache.clear();
    return this;
  }
  uncacheRoot(root: Object3D) {
    for (const action of [...this._actions]) {
      if (action._propertyBindings.every(pb => pb.binding.rootNode !== root)) continue;
      this._deactivateAction(action);
    }
    this._bindingCache.clear();
    return this;
  }
  // Return an existing action for the clip+root pair, or undefined.
  existingAction(clip: AnimationClip, optionalRoot?: Object3D) {
    const root = optionalRoot !== undefined ? optionalRoot : this._root;
    return this._actions.find(a => a.clip === clip && a.root === root);
  }
  // Find all actions referencing a clip (optionally filtered by root).
  getActionByClip(clip: AnimationClip) {
    return this._actions.filter(a => a.clip === clip);
  }
  uncacheAction(clip: AnimationClip, optionalRoot?: Object3D) {
    const root = optionalRoot !== undefined ? optionalRoot : this._root;
    for (const action of [...this._actions]) {
      if (action.clip === clip && action.root === root) this._deactivateAction(action);
    }
    return this;
  }
}

/* --- animation utils -------------------------------------------------------------- */

export const AnimationUtils = {
  // Extract [startFrame, endFrame] at fps into a new clip.
  subclip(clip: AnimationClip, name: string, startFrame: number, endFrame: number, fps = 30) {
    const tracks: KeyframeTrack[] = [];
    const start = startFrame / fps, end = endFrame / fps;
    for (const track of clip.tracks) {
      const times = track.times, values = track.values;
      const keep: number[] = [];
      const keptValues: number[] = [];
      const size = track.getValueSize();
      for (let i = 0; i < times.length; i++) {
        if (times[i] >= start && times[i] < end) {
          keep.push(times[i] - start);
          for (let j = 0; j < size; j++) keptValues.push(values[i * size + j]);
        }
      }
      if (keep.length) {
        const Ctor = (track as any).constructor;
        tracks.push(new Ctor(track.name, keep, keptValues, track.DefaultInterpolation));
      }
    }
    return new AnimationClip(name, end - start, tracks, clip.blendMode);
  },
  clone(clip: AnimationClip) { return clip.clone(); },
};
