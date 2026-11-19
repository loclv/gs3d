import { Vector3, transformDir, normalize3 } from './math';
import { worldMatrixOf } from './bridge';

/* --- orbit controls ---------------------------------------------------------------
   A three.js-style OrbitControls: it owns a camera's position around a
   target and answers pointer/wheel events on a DOM element. Call update()
   once per frame (or rely on the event handlers, which update immediately). */

export class OrbitControls {
  object: any;
  domElement: any;
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
  _radius: number;
  _theta: number;
  _phi: number;
  _thetaDelta: number;
  _phiDelta: number;
  _radiusDelta: number;
  _panOffset: Vector3;
  _pointers: Map<number, any>;
  _disposed: boolean;
  _onPointerDown: (e: any) => void;
  _onPointerMove: (e: any) => void;
  _onPointerUp: (e: any) => void;
  _onWheel: (e: any) => void;
  _onContextMenu: (e: any) => void;
  _listeners: Map<string, Set<Function>>;
  constructor(object: any, domElement: any) {
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
    this._listeners = new Map();
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

  // Minimal EventDispatcher surface (three.js parity for the events this
  // control emits): 'start', 'change', 'end'.
  addEventListener(type, listener) {
    if (typeof listener !== 'function') return;
    let set = this._listeners.get(type);
    if (!set) this._listeners.set(type, set = new Set());
    set.add(listener);
  }
  removeEventListener(type, listener) {
    this._listeners.get(type)?.delete(listener);
  }
  hasEventListener(type, listener) {
    return !!this._listeners.get(type)?.has(listener);
  }
  dispatchEvent(event) {
    const type = typeof event === 'string' ? event : event?.type;
    const set = this._listeners.get(type);
    if (!set) return false;
    const payload = typeof event === 'string' || !event ? { type, target: this } : event;
    if (payload.target === undefined) payload.target = this;
    for (const listener of [...set]) listener.call(this, payload);
    return true;
  }

  rotateLeft(angle) { this._thetaDelta -= angle; this.update(); }
  rotateUp(angle) { this._phiDelta -= angle; this.update(); }
  dollyIn(scale) { this._radiusDelta *= Math.max(1e-6, scale); this.update(); }
  dollyOut(scale) { this._radiusDelta /= Math.max(1e-6, scale); this.update(); }

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
    const moved = this._thetaDelta !== 0 || this._phiDelta !== 0 || this._radiusDelta !== 1
      || this._panOffset.x !== 0 || this._panOffset.y !== 0 || this._panOffset.z !== 0;
    const EPS = 1e-5;
    const ZERO_EPS = 1e-6;
    const damp = this.enableDamping ? Math.min(1, Math.max(0.01, this.dampingFactor)) : 1;
    const keep = 1 - damp;

    this._phi = Math.max(EPS, Math.min(Math.PI - EPS,
      Math.max(this.minPolarAngle, Math.min(this.maxPolarAngle, this._phi + this._phiDelta * damp))));
    this._theta += this._thetaDelta * damp;
    this._radius = Math.max(this.minDistance, Math.min(this.maxDistance,
      this._radius * (1 + (this._radiusDelta - 1) * damp)));

    this._thetaDelta *= keep;
    this._phiDelta *= keep;
    this._radiusDelta = 1 + (this._radiusDelta - 1) * keep;
    if (Math.abs(this._thetaDelta) < ZERO_EPS) this._thetaDelta = 0;
    if (Math.abs(this._phiDelta) < ZERO_EPS) this._phiDelta = 0;
    if (Math.abs(this._radiusDelta - 1) < ZERO_EPS) this._radiusDelta = 1;

    const offset = this._sphericalVector(new Vector3());
    const pan = this._panOffset;
    this.object.position.set(
      this.target.x + offset.x + pan.x * damp,
      this.target.y + offset.y + pan.y * damp,
      this.target.z + offset.z + pan.z * damp,
    );
    pan.x *= keep;
    pan.y *= keep;
    pan.z *= keep;
    if (Math.hypot(pan.x, pan.y, pan.z) < ZERO_EPS) pan.set(0, 0, 0);

    this.object.lookAt(this.target);
    if (moved) this.dispatchEvent('change');
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

