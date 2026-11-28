import createGoose3D from "./gs3d/app.js";

// src/three/math.ts
var Vector3 = class Vector3 {
	constructor(x = 0, y = 0, z = 0) {
		this.isVector3 = true;
		this.x = x;
		this.y = y;
		this.z = z;
	}
	set(x, y, z) {
		this.x = x;
		this.y = y;
		this.z = z;
		return this;
	}
	setScalar(s) {
		return this.set(s, s, s);
	}
	copy(v) {
		this.x = v.x;
		this.y = v.y;
		this.z = v.z;
		return this;
	}
	clone() {
		return new Vector3(this.x, this.y, this.z);
	}
	add(v) {
		this.x += v.x;
		this.y += v.y;
		this.z += v.z;
		return this;
	}
	addVectors(a, b) {
		return this.set(a.x + b.x, a.y + b.y, a.z + b.z);
	}
	addScaledVector(v, scale) {
		this.x += v.x * scale;
		this.y += v.y * scale;
		this.z += v.z * scale;
		return this;
	}
	sub(v) {
		this.x -= v.x;
		this.y -= v.y;
		this.z -= v.z;
		return this;
	}
	subVectors(a, b) {
		return this.set(a.x - b.x, a.y - b.y, a.z - b.z);
	}
	multiplyScalar(s) {
		this.x *= s;
		this.y *= s;
		this.z *= s;
		return this;
	}
	divideScalar(s) {
		return this.multiplyScalar(1 / (s || 1));
	}
	min(v) {
		this.x = Math.min(this.x, v.x);
		this.y = Math.min(this.y, v.y);
		this.z = Math.min(this.z, v.z);
		return this;
	}
	max(v) {
		this.x = Math.max(this.x, v.x);
		this.y = Math.max(this.y, v.y);
		this.z = Math.max(this.z, v.z);
		return this;
	}
	clamp(min, max) {
		this.x = Math.max(min.x, Math.min(max.x, this.x));
		this.y = Math.max(min.y, Math.min(max.y, this.y));
		this.z = Math.max(min.z, Math.min(max.z, this.z));
		return this;
	}
	equals(v) {
		return this.x === v.x && this.y === v.y && this.z === v.z;
	}
	length() {
		return Math.hypot(this.x, this.y, this.z);
	}
	lengthSq() {
		return this.x * this.x + this.y * this.y + this.z * this.z;
	}
	normalize() {
		const l = this.length() || 1;
		return this.multiplyScalar(1 / l);
	}
	distanceTo(v) {
		return Math.hypot(this.x - v.x, this.y - v.y, this.z - v.z);
	}
	distanceToSquared(v) {
		const dx = this.x - v.x, dy = this.y - v.y, dz = this.z - v.z;
		return dx * dx + dy * dy + dz * dz;
	}
	dot(v) {
		return this.x * v.x + this.y * v.y + this.z * v.z;
	}
	cross(v) {
		const x = this.y * v.z - this.z * v.y, y = this.z * v.x - this.x * v.z, z = this.x * v.y - this.y * v.x;
		return this.set(x, y, z);
	}
	crossVectors(a, b) {
		return this.set(a.y * b.z - a.z * b.y, a.z * b.x - a.x * b.z, a.x * b.y - a.y * b.x);
	}
	lerp(v, alpha) {
		this.x += (v.x - this.x) * alpha;
		this.y += (v.y - this.y) * alpha;
		this.z += (v.z - this.z) * alpha;
		return this;
	}
	negate() {
		return this.set(-this.x, -this.y, -this.z);
	}
	fromArray(a, offset = 0) {
		this.x = a[offset];
		this.y = a[offset + 1];
		this.z = a[offset + 2];
		return this;
	}
	toArray(a = [], offset = 0) {
		a[offset] = this.x;
		a[offset + 1] = this.y;
		a[offset + 2] = this.z;
		return a;
	}
	applyQuaternion(q) {
		const qx = q.x, qy = q.y, qz = q.z, qw = q.w;
		const tx = 2 * (qy * this.z - qz * this.y);
		const ty = 2 * (qz * this.x - qx * this.z);
		const tz = 2 * (qx * this.y - qy * this.x);
		this.x += qw * tx + qy * tz - qz * ty;
		this.y += qw * ty + qz * tx - qx * tz;
		this.z += qw * tz + qx * ty - qy * tx;
		return this;
	}
	applyEuler(e) {
		return this.applyQuaternion(new Quaternion().setFromEuler(e));
	}
	applyAxisAngle(axis, angle) {
		return this.applyQuaternion(new Quaternion().setFromAxisAngle(axis, angle));
	}
	applyMatrix4(m) {
		const e = m.elements || m, x = this.x, y = this.y, z = this.z;
		const w = 1 / (e[3] * x + e[7] * y + e[11] * z + e[15] || 1);
		return this.set((e[0] * x + e[4] * y + e[8] * z + e[12]) * w, (e[1] * x + e[5] * y + e[9] * z + e[13]) * w, (e[2] * x + e[6] * y + e[10] * z + e[14]) * w);
	}
	transformDirection(m) {
		const e = m.elements || m, x = this.x, y = this.y, z = this.z;
		return this.set(e[0] * x + e[4] * y + e[8] * z, e[1] * x + e[5] * y + e[9] * z, e[2] * x + e[6] * y + e[10] * z).normalize();
	}
	setFromMatrix3Column(m, index) {
		return this.set(m.elements ? m.elements[index * 4] : m[index * 4], m.elements ? m.elements[index * 4 + 1] : m[index * 4 + 1], m.elements ? m.elements[index * 4 + 2] : m[index * 4 + 2]);
	}
	setFromMatrixPosition(m) {
		const e = m.elements || m;
		return this.set(e[12], e[13], e[14]);
	}
	addScalar(s) {
		return this.set(this.x + s, this.y + s, this.z + s);
	}
	subScalar(s) {
		return this.set(this.x - s, this.y - s, this.z - s);
	}
	multiply(v) {
		this.x *= v.x;
		this.y *= v.y;
		this.z *= v.z;
		return this;
	}
	multiplyVectors(a, b) {
		return this.set(a.x * b.x, a.y * b.y, a.z * b.z);
	}
	divide(v) {
		return this.set(this.x / (v.x || 1), this.y / (v.y || 1), this.z / (v.z || 1));
	}
	ceil() {
		return this.set(Math.ceil(this.x), Math.ceil(this.y), Math.ceil(this.z));
	}
	floor() {
		return this.set(Math.floor(this.x), Math.floor(this.y), Math.floor(this.z));
	}
	round() {
		return this.set(Math.round(this.x), Math.round(this.y), Math.round(this.z));
	}
	roundToZero() {
		return this.set(this.x < 0 ? Math.ceil(this.x) : Math.floor(this.x), this.y < 0 ? Math.ceil(this.y) : Math.floor(this.y), this.z < 0 ? Math.ceil(this.z) : Math.floor(this.z));
	}
	setLength(length) {
		return this.normalize().multiplyScalar(length);
	}
	clampLength(min, max) {
		const l = this.length();
		if (l === 0) return this;
		return this.multiplyScalar(Math.max(min, Math.min(max, l)) / l);
	}
	clampScalar(min, max) {
		return this.clamp(_clampMin.set(min, min, min), _clampMax.set(max, max, max));
	}
	lerpVectors(a, b, t) {
		return this.set(a.x + (b.x - a.x) * t, a.y + (b.y - a.y) * t, a.z + (b.z - a.z) * t);
	}
	manhattanLength() {
		return Math.abs(this.x) + Math.abs(this.y) + Math.abs(this.z);
	}
	manhattanDistanceTo(v) {
		return Math.abs(this.x - v.x) + Math.abs(this.y - v.y) + Math.abs(this.z - v.z);
	}
	angleTo(v) {
		const d = Math.sqrt(this.lengthSq() * v.lengthSq());
		if (d === 0) return Math.PI / 2;
		return Math.acos(Math.max(-1, Math.min(1, this.dot(v) / d)));
	}
	random() {
		this.x = Math.random() * 2 - 1;
		this.y = Math.random() * 2 - 1;
		this.z = Math.random() * 2 - 1;
		return this.normalize();
	}
	randomDirection() {
		return this.random();
	}
	projectOnVector(v) {
		const d = v.lengthSq() || 1;
		const s = this.dot(v) / d;
		return this.copy(v).multiplyScalar(s);
	}
	projectOnPlane(planeNormal) {
		_projV.copy(this).projectOnVector(planeNormal);
		return this.sub(_projV);
	}
	reflect(normal) {
		return this.sub(_projV.copy(normal).multiplyScalar(2 * this.dot(normal)));
	}
	setX(x) {
		this.x = x;
		return this;
	}
	setY(y) {
		this.y = y;
		return this;
	}
	setZ(z) {
		this.z = z;
		return this;
	}
	setComponent(index, value) {
		switch (index) {
			case 0:
				this.x = value;
				break;
			case 1:
				this.y = value;
				break;
			default: this.z = value;
		}
		return this;
	}
	getComponent(index) {
		return index === 0 ? this.x : index === 1 ? this.y : this.z;
	}
	fromBufferAttribute(attribute, index) {
		const a = attribute.array, s = attribute.itemSize || 3;
		return this.set(a[index * s], a[index * s + 1], a[index * s + 2]);
	}
	applyMatrix3(m) {
		const e = m.elements || m, x = this.x, y = this.y, z = this.z;
		return this.set(e[0] * x + e[4] * y + e[8] * z, e[1] * x + e[5] * y + e[9] * z, e[2] * x + e[6] * y + e[10] * z);
	}
	applyNormalMatrix(m) {
		const inv = invertMat4(m.elements || m);
		if (!inv) return this;
		const t = /* @__PURE__ */ new Float64Array(16);
		t.set(inv);
		for (let r = 0; r < 3; r++) for (let c = 0; c < 3; c++) {
			const src = c * 4 + r, dst = r * 4 + c;
			const tmp = t[src];
			t[src] = t[dst];
			t[dst] = tmp;
		}
		return this.applyMatrix3(t).normalize();
	}
	setFromMatrixColumn(m, index) {
		const e = m.elements || m, o = index * 4;
		return this.set(e[o], e[o + 1], e[o + 2]);
	}
	setFromMatrixScale(m) {
		const e = m.elements || m;
		return this.set(Math.hypot(e[0], e[1], e[2]), Math.hypot(e[4], e[5], e[6]), Math.hypot(e[8], e[9], e[10]));
	}
	setFromSphericalCoords(radius, phi, theta) {
		const sp = Math.sin(phi);
		return this.set(radius * sp * Math.sin(theta), radius * Math.cos(phi), radius * sp * Math.cos(theta));
	}
	setFromCylindricalCoords(radius, theta, y) {
		return this.set(radius * Math.sin(theta), y, radius * Math.cos(theta));
	}
	setFromSpherical(s) {
		return this.setFromSphericalCoords(s.radius ?? 1, s.phi ?? 0, s.theta ?? 0);
	}
	setFromCylindrical(c) {
		return this.setFromCylindricalCoords(c.radius ?? 1, c.theta ?? 0, c.y ?? 0);
	}
	setFromEuler(e) {
		return this.set(0, 0, -1).applyEuler(e);
	}
	setFromColor(c) {
		return this.set(c.r, c.g, c.b);
	}
	project(camera) {
		if (camera.updateWorldMatrix) camera.updateWorldMatrix(true, false);
		const world = camera.matrixWorld;
		if (!world) return this;
		const view = invertMat4(world.elements || world);
		const proj = camera.projectionMatrix;
		if (!view || !proj) return this;
		this.applyMatrix4(view).applyMatrix4(proj.elements || proj);
		const w = this.z || 1;
		return this.set(this.x / w, this.y / w, this.z / w);
	}
	unproject(camera) {
		const proj = camera.projectionMatrix;
		if (!proj) return this;
		if (camera.updateWorldMatrix) camera.updateWorldMatrix(true, false);
		const world = camera.matrixWorld;
		const invProj = invertMat4(proj.elements || proj);
		if (!invProj || !world) return this;
		const view = invertMat4(world.elements || world);
		this.applyMatrix4(invProj);
		if (view) this.applyMatrix4(view);
		return this;
	}
};
const _clampMin = new Vector3();
const _clampMax = new Vector3();
const _projV = new Vector3();
var Vector4 = class Vector4 {
	constructor(x = 0, y = 0, z = 0, w = 0) {
		this.isVector4 = true;
		this.x = x;
		this.y = y;
		this.z = z;
		this.w = w;
	}
	set(x, y, z, w) {
		this.x = x;
		this.y = y;
		this.z = z;
		this.w = w;
		return this;
	}
	setScalar(s) {
		this.x = s;
		this.y = s;
		this.z = s;
		this.w = s;
		return this;
	}
	copy(v) {
		this.x = v.x;
		this.y = v.y;
		this.z = v.z;
		this.w = v.w;
		return this;
	}
	clone() {
		return new Vector4(this.x, this.y, this.z, this.w);
	}
	add(v) {
		this.x += v.x;
		this.y += v.y;
		this.z += v.z;
		this.w += v.w;
		return this;
	}
	addScalar(s) {
		this.x += s;
		this.y += s;
		this.z += s;
		this.w += s;
		return this;
	}
	sub(v) {
		this.x -= v.x;
		this.y -= v.y;
		this.z -= v.z;
		this.w -= v.w;
		return this;
	}
	subScalar(s) {
		this.x -= s;
		this.y -= s;
		this.z -= s;
		this.w -= s;
		return this;
	}
	multiplyScalar(s) {
		this.x *= s;
		this.y *= s;
		this.z *= s;
		this.w *= s;
		return this;
	}
	divideScalar(s) {
		return this.multiplyScalar(1 / (s || 1));
	}
	negate() {
		return this.set(-this.x, -this.y, -this.z, -this.w);
	}
	dot(v) {
		return this.x * v.x + this.y * v.y + this.z * v.z + this.w * v.w;
	}
	length() {
		return Math.hypot(this.x, this.y, this.z, this.w);
	}
	lengthSq() {
		return this.x * this.x + this.y * this.y + this.z * this.z + this.w * this.w;
	}
	manhattanLength() {
		return Math.abs(this.x) + Math.abs(this.y) + Math.abs(this.z) + Math.abs(this.w);
	}
	normalize() {
		const l = this.length() || 1;
		return this.multiplyScalar(1 / l);
	}
	setLength(length) {
		return this.normalize().multiplyScalar(length);
	}
	lerp(v, alpha) {
		this.x += (v.x - this.x) * alpha;
		this.y += (v.y - this.y) * alpha;
		this.z += (v.z - this.z) * alpha;
		this.w += (v.w - this.w) * alpha;
		return this;
	}
	distanceTo(v) {
		return Math.hypot(this.x - v.x, this.y - v.y, this.z - v.z, this.w - v.w);
	}
	distanceToSquared(v) {
		const dx = this.x - v.x, dy = this.y - v.y, dz = this.z - v.z, dw = this.w - v.w;
		return dx * dx + dy * dy + dz * dz + dw * dw;
	}
	manhattanDistanceTo(v) {
		return Math.abs(this.x - v.x) + Math.abs(this.y - v.y) + Math.abs(this.z - v.z) + Math.abs(this.w - v.w);
	}
	equals(v) {
		return this.x === v.x && this.y === v.y && this.z === v.z && this.w === v.w;
	}
	setX(x) {
		this.x = x;
		return this;
	}
	setY(y) {
		this.y = y;
		return this;
	}
	setZ(z) {
		this.z = z;
		return this;
	}
	setW(w) {
		this.w = w;
		return this;
	}
	setComponent(index, value) {
		switch (index) {
			case 0:
				this.x = value;
				break;
			case 1:
				this.y = value;
				break;
			case 2:
				this.z = value;
				break;
			default: this.w = value;
		}
		return this;
	}
	getComponent(index) {
		return index === 0 ? this.x : index === 1 ? this.y : index === 2 ? this.z : this.w;
	}
	fromArray(a, offset = 0) {
		return this.set(a[offset], a[offset + 1], a[offset + 2], a[offset + 3]);
	}
	toArray(a = [], offset = 0) {
		a[offset] = this.x;
		a[offset + 1] = this.y;
		a[offset + 2] = this.z;
		a[offset + 3] = this.w;
		return a;
	}
	fromBufferAttribute(attribute, index) {
		const a = attribute.array, s = attribute.itemSize || 4;
		return this.set(a[index * s], a[index * s + 1], a[index * s + 2], a[index * s + 3]);
	}
	applyMatrix4(m) {
		const e = m.elements || m;
		const x = this.x, y = this.y, z = this.z, w = this.w;
		const d = e[3] * x + e[7] * y + e[11] * z + e[15] * w || 1;
		return this.set((e[0] * x + e[4] * y + e[8] * z + e[12] * w) / d, (e[1] * x + e[5] * y + e[9] * z + e[13] * w) / d, (e[2] * x + e[6] * y + e[10] * z + e[14] * w) / d, (e[3] * x + e[7] * y + e[11] * z + e[15] * w) / d);
	}
	addVectors(a, b) {
		return this.set(a.x + b.x, a.y + b.y, a.z + b.z, a.w + b.w);
	}
	subVectors(a, b) {
		return this.set(a.x - b.x, a.y - b.y, a.z - b.z, a.w - b.w);
	}
	multiply(v) {
		this.x *= v.x;
		this.y *= v.y;
		this.z *= v.z;
		this.w *= v.w;
		return this;
	}
	divide(v) {
		this.x /= v.x || 1;
		this.y /= v.y || 1;
		this.z /= v.z || 1;
		this.w /= v.w || 1;
		return this;
	}
	addScaledVector(v, s) {
		this.x += v.x * s;
		this.y += v.y * s;
		this.z += v.z * s;
		this.w += v.w * s;
		return this;
	}
	lerpVectors(a, b, t) {
		return this.set(a.x + (b.x - a.x) * t, a.y + (b.y - a.y) * t, a.z + (b.z - a.z) * t, a.w + (b.w - a.w) * t);
	}
	clamp(min, max) {
		this.x = Math.max(min.x, Math.min(max.x, this.x));
		this.y = Math.max(min.y, Math.min(max.y, this.y));
		this.z = Math.max(min.z, Math.min(max.z, this.z));
		this.w = Math.max(min.w, Math.min(max.w, this.w));
		return this;
	}
	clampScalar(min, max) {
		return this.set(Math.max(min, Math.min(max, this.x)), Math.max(min, Math.min(max, this.y)), Math.max(min, Math.min(max, this.z)), Math.max(min, Math.min(max, this.w)));
	}
	clampLength(min, max) {
		const l = this.length();
		return this.divideScalar(l || 1).multiplyScalar(Math.max(min, Math.min(max, l)));
	}
	floor() {
		return this.set(Math.floor(this.x), Math.floor(this.y), Math.floor(this.z), Math.floor(this.w));
	}
	ceil() {
		return this.set(Math.ceil(this.x), Math.ceil(this.y), Math.ceil(this.z), Math.ceil(this.w));
	}
	round() {
		return this.set(Math.round(this.x), Math.round(this.y), Math.round(this.z), Math.round(this.w));
	}
	roundToZero() {
		return this.set(this.x < 0 ? Math.ceil(this.x) : Math.floor(this.x), this.y < 0 ? Math.ceil(this.y) : Math.floor(this.y), this.z < 0 ? Math.ceil(this.z) : Math.floor(this.z), this.w < 0 ? Math.ceil(this.w) : Math.floor(this.w));
	}
	min(v) {
		this.x = Math.min(this.x, v.x);
		this.y = Math.min(this.y, v.y);
		this.z = Math.min(this.z, v.z);
		this.w = Math.min(this.w, v.w);
		return this;
	}
	max(v) {
		this.x = Math.max(this.x, v.x);
		this.y = Math.max(this.y, v.y);
		this.z = Math.max(this.z, v.z);
		this.w = Math.max(this.w, v.w);
		return this;
	}
	random() {
		return this.set(Math.random(), Math.random(), Math.random(), Math.random());
	}
	setFromMatrixPosition(m) {
		const e = m.elements || m;
		return this.set(e[12], e[13], e[14], e[15]);
	}
	setAxisAngleFromQuaternion(q) {
		return this.set(q.x, q.y, q.z, q.w);
	}
	setAxisAngleFromRotationMatrix(m) {
		const q = new Quaternion().setFromRotationMatrix(m.elements || m);
		return this.setAxisAngleFromQuaternion(q);
	}
	get width() {
		return this.z;
	}
	get height() {
		return this.w;
	}
};
var Euler = class Euler {
	get x() {
		return this._x;
	}
	set x(v) {
		this._x = v;
	}
	get y() {
		return this._y;
	}
	set y(v) {
		this._y = v;
	}
	get z() {
		return this._z;
	}
	set z(v) {
		this._z = v;
	}
	get order() {
		return this._order;
	}
	set order(v) {
		this._order = v;
	}
	constructor(x = 0, y = 0, z = 0, order = "XYZ") {
		this._x = x;
		this._y = y;
		this._z = z;
		this._order = order;
		this.isEuler = true;
	}
	set(x, y, z, order) {
		this.x = x;
		this.y = y;
		this.z = z;
		if (order) this.order = order;
		return this;
	}
	copy(e) {
		this.x = e.x;
		this.y = e.y;
		this.z = e.z;
		this.order = e.order;
		return this;
	}
	clone() {
		return new Euler(this.x, this.y, this.z, this.order);
	}
	equals(e) {
		return this.x === e.x && this.y === e.y && this.z === e.z && this.order === e.order;
	}
	setFromVector3(v, order) {
		return this.set(v.x, v.y, v.z, order || this.order);
	}
	setFromQuaternion(q, order = null, update = true) {
		this.order = order || this.order;
		const [x, y, z] = eulerFromQuatXYZ(q);
		this.x = x;
		this.y = y;
		this.z = z;
		return this;
	}
	setFromRotationMatrix(m, order = null, update = true) {
		this.order = order || this.order;
		const q = new Quaternion().setFromRotationMatrix(m.elements || m);
		return this.setFromQuaternion(q, this.order);
	}
	reorder(newOrder) {
		const q = new Quaternion().setFromEuler(this);
		this.order = newOrder;
		this.setFromQuaternion(q, newOrder);
		return this;
	}
	fromArray(a, offset = 0) {
		return this.set(a[offset], a[offset + 1], a[offset + 2], a[offset + 3] !== void 0 ? a[offset + 3] : this.order);
	}
	toArray(a = [], offset = 0) {
		a[offset] = this.x;
		a[offset + 1] = this.y;
		a[offset + 2] = this.z;
		a[offset + 3] = this.order;
		return a;
	}
};
function axisQuat(axis, angle) {
	const h = angle * .5, s = Math.sin(h), c = Math.cos(h);
	if (axis === "x") return {
		x: s,
		y: 0,
		z: 0,
		w: c
	};
	if (axis === "y") return {
		x: 0,
		y: s,
		z: 0,
		w: c
	};
	return {
		x: 0,
		y: 0,
		z: s,
		w: c
	};
}
function quatMul(a, b) {
	return {
		x: a.w * b.x + a.x * b.w + a.y * b.z - a.z * b.y,
		y: a.w * b.y - a.x * b.z + a.y * b.w + a.z * b.x,
		z: a.w * b.z + a.x * b.y - a.y * b.x + a.z * b.w,
		w: a.w * b.w - a.x * b.x - a.y * b.y - a.z * b.z
	};
}
function quatFromEulerOrder(x, y, z, order = "XYZ") {
	const angles = {
		x,
		y,
		z
	};
	let q = null;
	for (const axis of String(order).toLowerCase()) {
		if (axis !== "x" && axis !== "y" && axis !== "z") continue;
		const a = axisQuat(axis, angles[axis]);
		q = q ? quatMul(q, a) : a;
	}
	return q || {
		x: 0,
		y: 0,
		z: 0,
		w: 1
	};
}
function eulerFromQuatXYZ(q) {
	const x = q.x, y = q.y, z = q.z, w = q.w;
	const sinrCosp = 2 * (w * x + y * z), cosrCosp = 1 - 2 * (x * x + y * y);
	const sinp = 2 * (w * y - z * x);
	const sinyCosp = 2 * (w * z + x * y), cosyCosp = 1 - 2 * (y * y + z * z);
	return [
		Math.atan2(sinrCosp, cosrCosp),
		Math.abs(sinp) >= 1 ? Math.sign(sinp) * Math.PI / 2 : Math.asin(sinp),
		Math.atan2(sinyCosp, cosyCosp)
	];
}
var Quaternion = class Quaternion {
	get x() {
		return this._x;
	}
	set x(v) {
		this._x = v;
	}
	get y() {
		return this._y;
	}
	set y(v) {
		this._y = v;
	}
	get z() {
		return this._z;
	}
	set z(v) {
		this._z = v;
	}
	get w() {
		return this._w;
	}
	set w(v) {
		this._w = v;
	}
	constructor(x = 0, y = 0, z = 0, w = 1) {
		this.isQuaternion = true;
		this._x = x;
		this._y = y;
		this._z = z;
		this._w = w;
	}
	set(x, y, z, w) {
		this.x = x;
		this.y = y;
		this.z = z;
		this.w = w;
		return this;
	}
	copy(q) {
		this.x = q.x;
		this.y = q.y;
		this.z = q.z;
		this.w = q.w;
		return this;
	}
	clone() {
		return new Quaternion(this.x, this.y, this.z, this.w);
	}
	identity() {
		return this.set(0, 0, 0, 1);
	}
	setFromEuler(e) {
		const q = quatFromEulerOrder(e.x, e.y, e.z, e.order);
		return this.set(q.x, q.y, q.z, q.w);
	}
	setFromAxisAngle(axis, angle) {
		const h = angle / 2, s = Math.sin(h);
		const l = Math.hypot(axis.x, axis.y, axis.z) || 1;
		return this.set(axis.x / l * s, axis.y / l * s, axis.z / l * s, Math.cos(h));
	}
	setFromRotationMatrix(m) {
		const col = (i) => {
			const x = m[i], y = m[i + 1], z = m[i + 2];
			const l = Math.hypot(x, y, z) || 1;
			return [
				x / l,
				y / l,
				z / l
			];
		};
		const c0 = col(0), c1 = col(4), c2 = col(8);
		const m11 = c0[0], m21 = c0[1], m31 = c0[2];
		const m12 = c1[0], m22 = c1[1], m32 = c1[2];
		const m13 = c2[0], m23 = c2[1], m33 = c2[2];
		const trace = m11 + m22 + m33;
		if (trace > 0) {
			const s = .5 / Math.sqrt(trace + 1);
			return this.set((m32 - m23) * s, (m13 - m31) * s, (m21 - m12) * s, .25 / s);
		}
		if (m11 > m22 && m11 > m33) {
			const s = 2 * Math.sqrt(Math.max(1e-12, 1 + m11 - m22 - m33));
			return this.set(.25 * s, (m12 + m21) / s, (m13 + m31) / s, (m32 - m23) / s);
		}
		if (m22 > m33) {
			const s = 2 * Math.sqrt(Math.max(1e-12, 1 + m22 - m11 - m33));
			return this.set((m12 + m21) / s, .25 * s, (m23 + m32) / s, (m13 - m31) / s);
		}
		const s = 2 * Math.sqrt(Math.max(1e-12, 1 + m33 - m11 - m22));
		return this.set((m13 + m31) / s, (m23 + m32) / s, .25 * s, (m21 - m12) / s);
	}
	normalize() {
		const l = Math.hypot(this.x, this.y, this.z, this.w) || 1;
		return this.set(this.x / l, this.y / l, this.z / l, this.w / l);
	}
	dot(q) {
		return this.x * q.x + this.y * q.y + this.z * q.z + this.w * q.w;
	}
	multiply(q) {
		const ax = this.x, ay = this.y, az = this.z, aw = this.w;
		const bx = q.x, by = q.y, bz = q.z, bw = q.w;
		return this.set(aw * bx + ax * bw + ay * bz - az * by, aw * by - ax * bz + ay * bw + az * bx, aw * bz + ax * by - ay * bx + az * bw, aw * bw - ax * bx - ay * by - az * bz);
	}
	premultiply(q) {
		const ax = q.x, ay = q.y, az = q.z, aw = q.w;
		const bx = this.x, by = this.y, bz = this.z, bw = this.w;
		return this.set(aw * bx + ax * bw + ay * bz - az * by, aw * by - ax * bz + ay * bw + az * bx, aw * bz + ax * by - ay * bx + az * bw, aw * bw - ax * bx - ay * by - az * bz);
	}
	setFromUnitVectors(vFrom, vTo) {
		let r = vFrom.x * vTo.x + vFrom.y * vTo.y + vFrom.z * vTo.z + 1;
		if (r < 1e-8) {
			r = 0;
			if (Math.abs(vFrom.x) > Math.abs(vFrom.z)) this.set(-vFrom.y, vFrom.x, 0, r);
			else this.set(0, -vFrom.z, vFrom.y, r);
			return this.normalize();
		}
		return this.set(vFrom.y * vTo.z - vFrom.z * vTo.y, vFrom.z * vTo.x - vFrom.x * vTo.z, vFrom.x * vTo.y - vFrom.y * vTo.x, r).normalize();
	}
	conjugate() {
		this.x = -this.x;
		this.y = -this.y;
		this.z = -this.z;
		return this;
	}
	invert() {
		return this.conjugate().normalize();
	}
	slerp(qb, t) {
		let cosHalf = this.w * qb.w + this.x * qb.x + this.y * qb.y + this.z * qb.z;
		let bx = qb.x, by = qb.y, bz = qb.z, bw = qb.w;
		if (cosHalf < 0) {
			cosHalf = -cosHalf;
			bx = -bx;
			by = -by;
			bz = -bz;
			bw = -bw;
		}
		if (cosHalf > .9995) {
			this.x += (bx - this.x) * t;
			this.y += (by - this.y) * t;
			this.z += (bz - this.z) * t;
			this.w += (bw - this.w) * t;
			return this.normalize();
		}
		const half = Math.acos(Math.min(1, cosHalf));
		const sinHalf = Math.sin(half);
		const ra = Math.sin((1 - t) * half) / sinHalf, rb = Math.sin(t * half) / sinHalf;
		return this.set(this.x * ra + bx * rb, this.y * ra + by * rb, this.z * ra + bz * rb, this.w * ra + bw * rb);
	}
	angleTo(q) {
		return 2 * Math.acos(Math.min(1, Math.abs(this.dot(q))));
	}
	rotateTowards(q, step) {
		const angle = this.angleTo(q);
		if (angle === 0) return this;
		return this.slerp(q, Math.min(1, step / angle));
	}
	equals(q) {
		return this.x === q.x && this.y === q.y && this.z === q.z && this.w === q.w;
	}
	length() {
		return Math.hypot(this.x, this.y, this.z, this.w);
	}
	lengthSq() {
		return this.x * this.x + this.y * this.y + this.z * this.z + this.w * this.w;
	}
	fromArray(array, offset = 0) {
		return this.set(array[offset], array[offset + 1], array[offset + 2], array[offset + 3]);
	}
	toArray(array = [], offset = 0) {
		array[offset] = this.x;
		array[offset + 1] = this.y;
		array[offset + 2] = this.z;
		array[offset + 3] = this.w;
		return array;
	}
	fromBufferAttribute(attribute, index) {
		const o = index * attribute.itemSize;
		return this.set(attribute.array[o], attribute.array[o + 1], attribute.array[o + 2], attribute.array[o + 3]);
	}
	multiplyQuaternions(a, b) {
		const ax = a.x, ay = a.y, az = a.z, aw = a.w;
		const bx = b.x, by = b.y, bz = b.z, bw = b.w;
		return this.set(aw * bx + ax * bw + ay * bz - az * by, aw * by - ax * bz + ay * bw + az * bx, aw * bz + ax * by - ay * bx + az * bw, aw * bw - ax * bx - ay * by - az * bz);
	}
	slerpQuaternions(qa, qb, t) {
		return this.copy(qa).slerp(qb, t);
	}
	random() {
		const u1 = Math.random(), u2 = Math.random() * Math.PI * 2, u3 = Math.random() * Math.PI * 2;
		const a = Math.sqrt(1 - u1), b = Math.sqrt(u1);
		return this.set(a * Math.sin(u2), a * Math.cos(u2), b * Math.sin(u3), b * Math.cos(u3));
	}
	toJSON() {
		return [
			this.x,
			this.y,
			this.z,
			this.w
		];
	}
};
function composeLocal(position, quat, scale) {
	const qx = quat.x, qy = quat.y, qz = quat.z, qw = quat.w;
	const x2 = qx + qx, y2 = qy + qy, z2 = qz + qz;
	const xx = qx * x2, xy = qx * y2, xz = qx * z2;
	const yy = qy * y2, yz = qy * z2, zz = qz * z2;
	const wx = qw * x2, wy = qw * y2, wz = qw * z2;
	const m = /* @__PURE__ */ new Float64Array(16);
	m[0] = (1 - (yy + zz)) * scale.x;
	m[1] = (xy + wz) * scale.x;
	m[2] = (xz - wy) * scale.x;
	m[4] = (xy - wz) * scale.y;
	m[5] = (1 - (xx + zz)) * scale.y;
	m[6] = (yz + wx) * scale.y;
	m[8] = (xz + wy) * scale.z;
	m[9] = (yz - wx) * scale.z;
	m[10] = (1 - (xx + yy)) * scale.z;
	m[12] = position.x;
	m[13] = position.y;
	m[14] = position.z;
	m[15] = 1;
	return m;
}
function multiplyMat4(a, b) {
	const out = /* @__PURE__ */ new Float64Array(16);
	for (let c = 0; c < 4; c++) for (let r = 0; r < 4; r++) {
		let sum = 0;
		for (let k = 0; k < 4; k++) sum += a[k * 4 + r] * b[c * 4 + k];
		out[c * 4 + r] = sum;
	}
	return out;
}
function transformPoint(m, x, y, z) {
	return [
		m[0] * x + m[4] * y + m[8] * z + m[12],
		m[1] * x + m[5] * y + m[9] * z + m[13],
		m[2] * x + m[6] * y + m[10] * z + m[14]
	];
}
function transformDir(m, x, y, z) {
	return [
		m[0] * x + m[4] * y + m[8] * z,
		m[1] * x + m[5] * y + m[9] * z,
		m[2] * x + m[6] * y + m[10] * z
	];
}
function normalize3(v) {
	const l = Math.hypot(v[0], v[1], v[2]) || 1;
	return [
		v[0] / l,
		v[1] / l,
		v[2] / l
	];
}
function invertMat4(m) {
	const inv = /* @__PURE__ */ new Float64Array(16);
	const a = m;
	inv[0] = a[5] * a[10] * a[15] - a[5] * a[11] * a[14] - a[9] * a[6] * a[15] + a[9] * a[7] * a[14] + a[13] * a[6] * a[11] - a[13] * a[7] * a[10];
	inv[4] = -a[4] * a[10] * a[15] + a[4] * a[11] * a[14] + a[8] * a[6] * a[15] - a[8] * a[7] * a[14] - a[12] * a[6] * a[11] + a[12] * a[7] * a[10];
	inv[8] = a[4] * a[9] * a[15] - a[4] * a[11] * a[13] - a[8] * a[5] * a[15] + a[8] * a[7] * a[13] + a[12] * a[5] * a[11] - a[12] * a[7] * a[9];
	inv[12] = -a[4] * a[9] * a[14] + a[4] * a[10] * a[13] + a[8] * a[5] * a[14] - a[8] * a[6] * a[13] - a[12] * a[5] * a[10] + a[12] * a[6] * a[9];
	inv[1] = -a[1] * a[10] * a[15] + a[1] * a[11] * a[14] + a[9] * a[2] * a[15] - a[9] * a[3] * a[14] - a[13] * a[2] * a[11] + a[13] * a[3] * a[10];
	inv[5] = a[0] * a[10] * a[15] - a[0] * a[11] * a[14] - a[8] * a[2] * a[15] + a[8] * a[3] * a[14] + a[12] * a[2] * a[11] - a[12] * a[3] * a[10];
	inv[9] = -a[0] * a[9] * a[15] + a[0] * a[11] * a[13] + a[8] * a[1] * a[15] - a[8] * a[3] * a[13] - a[12] * a[1] * a[11] + a[12] * a[3] * a[9];
	inv[13] = a[0] * a[9] * a[14] - a[0] * a[10] * a[13] - a[8] * a[1] * a[14] + a[8] * a[2] * a[13] + a[12] * a[1] * a[10] - a[12] * a[2] * a[9];
	inv[2] = a[1] * a[6] * a[15] - a[1] * a[7] * a[14] - a[5] * a[2] * a[15] + a[5] * a[3] * a[14] + a[13] * a[2] * a[7] - a[13] * a[3] * a[6];
	inv[6] = -a[0] * a[6] * a[15] + a[0] * a[7] * a[14] + a[4] * a[2] * a[15] - a[4] * a[3] * a[14] - a[12] * a[2] * a[7] + a[12] * a[3] * a[6];
	inv[10] = a[0] * a[5] * a[15] - a[0] * a[7] * a[13] - a[4] * a[1] * a[15] + a[4] * a[3] * a[13] + a[12] * a[1] * a[7] - a[12] * a[3] * a[5];
	inv[14] = -a[0] * a[5] * a[14] + a[0] * a[6] * a[13] + a[4] * a[1] * a[14] - a[4] * a[2] * a[13] - a[12] * a[1] * a[6] + a[12] * a[2] * a[5];
	inv[3] = -a[1] * a[6] * a[11] + a[1] * a[7] * a[10] + a[5] * a[2] * a[11] - a[5] * a[3] * a[10] - a[9] * a[2] * a[7] + a[9] * a[3] * a[6];
	inv[7] = a[0] * a[6] * a[11] - a[0] * a[7] * a[10] - a[4] * a[2] * a[11] + a[4] * a[3] * a[10] + a[8] * a[2] * a[7] - a[8] * a[3] * a[6];
	inv[11] = -a[0] * a[5] * a[11] + a[0] * a[7] * a[9] + a[4] * a[1] * a[11] - a[4] * a[3] * a[9] - a[8] * a[1] * a[7] + a[8] * a[3] * a[5];
	inv[15] = a[0] * a[5] * a[10] - a[0] * a[6] * a[9] - a[4] * a[1] * a[10] + a[4] * a[2] * a[9] + a[8] * a[1] * a[6] - a[8] * a[2] * a[5];
	let det = a[0] * inv[0] + a[1] * inv[4] + a[2] * inv[8] + a[3] * inv[12];
	if (Math.abs(det) < 1e-12) return null;
	det = 1 / det;
	for (let i = 0; i < 16; i++) inv[i] *= det;
	return inv;
}
var Matrix4 = class Matrix4 {
	constructor() {
		this.isMatrix4 = true;
		this.elements = /* @__PURE__ */ new Float64Array(16);
		this.identity();
	}
	set(n11, n12, n13, n14, n21, n22, n23, n24, n31, n32, n33, n34, n41, n42, n43, n44) {
		const e = this.elements;
		e[0] = n11;
		e[4] = n12;
		e[8] = n13;
		e[12] = n14;
		e[1] = n21;
		e[5] = n22;
		e[9] = n23;
		e[13] = n24;
		e[2] = n31;
		e[6] = n32;
		e[10] = n33;
		e[14] = n34;
		e[3] = n41;
		e[7] = n42;
		e[11] = n43;
		e[15] = n44;
		return this;
	}
	identity() {
		const e = this.elements;
		e.fill(0);
		e[0] = e[5] = e[10] = e[15] = 1;
		return this;
	}
	copy(m) {
		this.elements.set(m.elements || m);
		return this;
	}
	clone() {
		return new Matrix4().copy(this);
	}
	compose(position, quaternion, scale) {
		const e = this.elements, q = quaternion;
		const x2 = q.x + q.x, y2 = q.y + q.y, z2 = q.z + q.z;
		const xx = q.x * x2, xy = q.x * y2, xz = q.x * z2;
		const yy = q.y * y2, yz = q.y * z2, zz = q.z * z2;
		const wx = q.w * x2, wy = q.w * y2, wz = q.w * z2;
		e[0] = (1 - (yy + zz)) * scale.x;
		e[1] = (xy + wz) * scale.x;
		e[2] = (xz - wy) * scale.x;
		e[3] = 0;
		e[4] = (xy - wz) * scale.y;
		e[5] = (1 - (xx + zz)) * scale.y;
		e[6] = (yz + wx) * scale.y;
		e[7] = 0;
		e[8] = (xz + wy) * scale.z;
		e[9] = (yz - wx) * scale.z;
		e[10] = (1 - (xx + yy)) * scale.z;
		e[11] = 0;
		e[12] = position.x;
		e[13] = position.y;
		e[14] = position.z;
		e[15] = 1;
		return this;
	}
	multiply(m) {
		this.elements.set(multiplyMat4(this.elements, m.elements || m));
		return this;
	}
	multiplyMatrices(a, b) {
		const ae = a.elements || a, be = b.elements || b, e = this.elements;
		if (ae === e || be === e) {
			e.set(multiplyMat4(ae, be));
			return this;
		}
		for (let c = 0; c < 4; c++) for (let r = 0; r < 4; r++) e[c * 4 + r] = ae[r] * be[c * 4] + ae[4 + r] * be[c * 4 + 1] + ae[8 + r] * be[c * 4 + 2] + ae[12 + r] * be[c * 4 + 3];
		return this;
	}
	invert() {
		const inv = invertMat4(this.elements);
		if (inv) this.elements.set(inv);
		return this;
	}
	makeRotationFromQuaternion(q) {
		return this.compose(new Vector3(), q, new Vector3(1, 1, 1));
	}
	makeTranslation(x, y, z) {
		const e = this.elements;
		e.fill(0);
		e[0] = e[5] = e[10] = e[15] = 1;
		e[12] = x;
		e[13] = y;
		e[14] = z;
		return this;
	}
	makeScale(x, y, z) {
		const e = this.elements;
		e.fill(0);
		e[0] = x;
		e[5] = y;
		e[10] = z;
		e[15] = 1;
		return this;
	}
	makePerspective(fov, aspect, near, far) {
		const e = this.elements;
		const f = 1 / Math.tan(fov * Math.PI / 180 / 2);
		const nf = 1 / (near - far);
		e.fill(0);
		e[0] = f / aspect;
		e[5] = f;
		e[10] = (far + near) * nf;
		e[11] = -1;
		e[14] = 2 * far * near * nf;
		return this;
	}
	makeOrthographic(left, right, top, bottom, near, far) {
		const e = this.elements;
		const w = 1 / (right - left), h = 1 / (top - bottom);
		const p = 1 / (far - near), q = (far + near) / (far - near);
		e.fill(0);
		e[0] = 2 * w;
		e[5] = 2 * h;
		e[10] = -2 * p;
		e[14] = -q;
		e[12] = -(right + left) * w;
		e[13] = -(top + bottom) * h;
		e[15] = 1;
		return this;
	}
	makeRotationX(theta) {
		const c = Math.cos(theta), s = Math.sin(theta);
		return this.set(1, 0, 0, 0, 0, c, -s, 0, 0, s, c, 0, 0, 0, 0, 1);
	}
	makeRotationY(theta) {
		const c = Math.cos(theta), s = Math.sin(theta);
		return this.set(c, 0, s, 0, 0, 1, 0, 0, -s, 0, c, 0, 0, 0, 0, 1);
	}
	makeRotationZ(theta) {
		const c = Math.cos(theta), s = Math.sin(theta);
		return this.set(c, -s, 0, 0, s, c, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1);
	}
	lookAt(eye, target, up) {
		const e = this.elements;
		let zx = eye.x - target.x, zy = eye.y - target.y, zz = eye.z - target.z;
		let zl = Math.hypot(zx, zy, zz);
		if (zl === 0) {
			zz = 1;
			zl = 1;
		}
		zx /= zl;
		zy /= zl;
		zz /= zl;
		let xx = up.y * zz - up.z * zy, xy = up.z * zx - up.x * zz, xz = up.x * zy - up.y * zx;
		let xl = Math.hypot(xx, xy, xz);
		if (xl === 0) {
			if (Math.abs(up.z) === 1) zx += 1e-4;
			else zz += 1e-4;
			const nz = Math.hypot(zx, zy, zz) || 1;
			zx /= nz;
			zy /= nz;
			zz /= nz;
			xx = up.y * zz - up.z * zy;
			xy = up.z * zx - up.x * zz;
			xz = up.x * zy - up.y * zx;
			xl = Math.hypot(xx, xy, xz) || 1;
		}
		xx /= xl;
		xy /= xl;
		xz /= xl;
		const yx = zy * xz - zz * xy, yy = zz * xx - zx * xz, yz = zx * xy - zy * xx;
		e[0] = xx;
		e[1] = xy;
		e[2] = xz;
		e[3] = 0;
		e[4] = yx;
		e[5] = yy;
		e[6] = yz;
		e[7] = 0;
		e[8] = zx;
		e[9] = zy;
		e[10] = zz;
		e[11] = 0;
		e[12] = 0;
		e[13] = 0;
		e[14] = 0;
		e[15] = 1;
		return this;
	}
	equals(m) {
		const a = this.elements, b = m.elements || m;
		for (let i = 0; i < 16; i++) if (a[i] !== b[i]) return false;
		return true;
	}
	setPosition(v) {
		const e = this.elements;
		e[12] = v.x ?? v[0];
		e[13] = v.y ?? v[1];
		e[14] = v.z ?? v[2];
		return this;
	}
	extractRotation() {
		const e = this.elements;
		for (let c = 0; c < 3; c++) {
			const i = c * 4, l = Math.hypot(e[i], e[i + 1], e[i + 2]) || 1;
			e[i] /= l;
			e[i + 1] /= l;
			e[i + 2] /= l;
		}
		e[3] = e[7] = e[11] = 0;
		e[15] = 1;
		return this;
	}
	copyPosition(m) {
		const e = this.elements, me = m.elements || m;
		e[12] = me[12];
		e[13] = me[13];
		e[14] = me[14];
		return this;
	}
	determinant() {
		const e = this.elements;
		return e[0] * (e[5] * e[10] - e[6] * e[9]) - e[4] * (e[1] * e[10] - e[2] * e[9]) + e[8] * (e[1] * e[6] - e[2] * e[5]);
	}
	extractBasis(xAxis, yAxis, zAxis) {
		const e = this.elements;
		xAxis.set(e[0], e[1], e[2]);
		yAxis.set(e[4], e[5], e[6]);
		zAxis.set(e[8], e[9], e[10]);
		return this;
	}
	makeBasis(xAxis, yAxis, zAxis) {
		return this.set(xAxis.x, xAxis.y, xAxis.z, 0, yAxis.x, yAxis.y, yAxis.z, 0, zAxis.x, zAxis.y, zAxis.z, 0, 0, 0, 0, 1);
	}
	makeRotationAxis(axis, angle) {
		const c = Math.cos(angle), s = Math.sin(angle), t = 1 - c;
		const x = axis.x, y = axis.y, z = axis.z;
		return this.set(t * x * x + c, t * x * y - s * z, t * x * z + s * y, 0, t * x * y + s * z, t * y * y + c, t * y * z - s * x, 0, t * x * z - s * y, t * y * z + s * x, t * z * z + c, 0, 0, 0, 0, 1);
	}
	makeRotationFromEuler(euler) {
		return this.makeRotationFromQuaternion(new Quaternion().setFromEuler(euler));
	}
	makeShear(xy = 0, xz = 0, yx = 0, yz = 0, zx = 0, zy = 0) {
		return this.set(1, yx, zx, 0, xy, 1, zy, 0, xz, yz, 1, 0, 0, 0, 1, 1);
	}
	getMaxScaleOnAxis() {
		const e = this.elements;
		const sx = e[0] * e[0] + e[1] * e[1] + e[2] * e[2];
		const sy = e[4] * e[4] + e[5] * e[5] + e[6] * e[6];
		const sz = e[8] * e[8] + e[9] * e[9] + e[10] * e[10];
		return Math.sqrt(Math.max(sx, sy, sz));
	}
	scale(v) {
		const e = this.elements;
		e[0] *= v.x;
		e[1] *= v.x;
		e[2] *= v.x;
		e[4] *= v.y;
		e[5] *= v.y;
		e[6] *= v.y;
		e[8] *= v.z;
		e[9] *= v.z;
		e[10] *= v.z;
		return this;
	}
	multiplyScalar(s) {
		const e = this.elements;
		for (let i = 0; i < 16; i++) e[i] *= s;
		return this;
	}
	transpose() {
		const e = this.elements;
		for (let r = 0; r < 3; r++) for (let c = r + 1; c < 3; c++) {
			const a = c * 4 + r, b = r * 4 + c;
			const t = e[a];
			e[a] = e[b];
			e[b] = t;
		}
		return this;
	}
	fromArray(array, offset = 0) {
		const e = this.elements;
		for (let i = 0; i < 16; i++) e[i] = array[offset + i];
		return this;
	}
	toArray(array = [], offset = 0) {
		const e = this.elements;
		for (let i = 0; i < 16; i++) array[offset + i] = e[i];
		return array;
	}
	setFromMatrix3(m) {
		const e = this.elements, me = m.elements || m;
		e[0] = me[0];
		e[1] = me[1];
		e[2] = me[2];
		e[3] = 0;
		e[4] = me[3];
		e[5] = me[4];
		e[6] = me[5];
		e[7] = 0;
		e[8] = me[6];
		e[9] = me[7];
		e[10] = me[8];
		e[11] = 0;
		e[12] = 0;
		e[13] = 0;
		e[14] = 0;
		e[15] = 1;
		return this;
	}
	premultiply(m) {
		this.elements.set(multiplyMat4(m.elements || m, this.elements));
		return this;
	}
	decompose(position, quaternion, scale) {
		const e = this.elements;
		position.set(e[12], e[13], e[14]);
		const sx = Math.hypot(e[0], e[1], e[2]);
		const sy = Math.hypot(e[4], e[5], e[6]);
		const sz = Math.hypot(e[8], e[9], e[10]);
		const det = e[0] * (e[5] * e[10] - e[6] * e[9]) - e[4] * (e[1] * e[10] - e[2] * e[9]) + e[8] * (e[1] * e[6] - e[2] * e[5]);
		scale.set(sx, sy, det < 0 ? -sz : sz);
		const rot = _decompMat.copy(this);
		const re = rot.elements;
		if (sx) {
			re[0] /= sx;
			re[1] /= sx;
			re[2] /= sx;
		}
		if (sy) {
			re[4] /= sy;
			re[5] /= sy;
			re[6] /= sy;
		}
		if (sz) {
			re[8] /= sz;
			re[9] /= sz;
			re[10] /= sz;
		}
		quaternion.setFromRotationMatrix(rot);
		return this;
	}
};
const _decompMat = new Matrix4();
const MathUtils = {
	DEG2RAD: Math.PI / 180,
	RAD2DEG: 180 / Math.PI,
	clamp: (v, min, max) => Math.max(min, Math.min(max, v)),
	lerp: (a, b, t) => a + (b - a) * t,
	mapLinear: (v, inMin, inMax, outMin, outMax) => outMin + (outMax - outMin) * ((v - inMin) / (inMax - inMin || 1)),
	degToRad: (d) => d * Math.PI / 180,
	radToDeg: (r) => r * 180 / Math.PI,
	smoothstep: (x, min, max) => {
		const t = Math.max(0, Math.min(1, (x - min) / (max - min || 1e-12)));
		return t * t * (3 - 2 * t);
	},
	generateUUID: () => "uuid-" + Math.random().toString(36).slice(2) + Math.random().toString(36).slice(2),
	euclideanModulo: (n, m) => (n % m + m) % m,
	isPowerOfTwo: (n) => n > 0 && (n & n - 1) === 0,
	ceilPowerOfTwo: (n) => Math.pow(2, Math.ceil(Math.log(n) / Math.LN2)),
	floorPowerOfTwo: (n) => Math.pow(2, Math.floor(Math.log(n) / Math.LN2)),
	setQuaternionFromProperEuler: (q, a, b, c, order) => q
};
var Clock = class {
	constructor(autoStart = true) {
		this.startTime = 0;
		this.oldTime = 0;
		this.elapsedTime = 0;
		this.running = false;
		this.autoStart = autoStart;
	}
	start() {
		this.startTime = nowMs();
		this.oldTime = this.startTime;
		this.elapsedTime = 0;
		this.running = true;
	}
	stop() {
		this.getElapsedTime();
		this.running = false;
		this.autoStart = false;
		return this.elapsedTime;
	}
	getElapsedTime() {
		this.getDelta();
		return this.elapsedTime;
	}
	getDelta() {
		let diff = 0;
		if (this.autoStart && !this.running) this.start();
		if (this.running) {
			const newTime = nowMs();
			diff = (newTime - this.oldTime) / 1e3;
			this.oldTime = newTime;
			this.elapsedTime += diff;
		}
		return diff;
	}
};
function nowMs() {
	return typeof performance !== "undefined" && performance.now ? performance.now() : Date.now();
}
var Vector2 = class Vector2 {
	constructor(x = 0, y = 0) {
		this.isVector2 = true;
		this.x = x;
		this.y = y;
	}
	set(x, y) {
		this.x = x;
		this.y = y;
		return this;
	}
	setScalar(s) {
		this.x = s;
		this.y = s;
		return this;
	}
	copy(v) {
		this.x = v.x;
		this.y = v.y;
		return this;
	}
	clone() {
		return new Vector2(this.x, this.y);
	}
	add(v) {
		this.x += v.x;
		this.y += v.y;
		return this;
	}
	sub(v) {
		this.x -= v.x;
		this.y -= v.y;
		return this;
	}
	multiplyScalar(s) {
		this.x *= s;
		this.y *= s;
		return this;
	}
	divideScalar(s) {
		return this.multiplyScalar(1 / (s || 1));
	}
	negate() {
		return this.set(-this.x, -this.y);
	}
	dot(v) {
		return this.x * v.x + this.y * v.y;
	}
	cross(v) {
		return this.x * v.y - this.y * v.x;
	}
	length() {
		return Math.hypot(this.x, this.y);
	}
	lengthSq() {
		return this.x * this.x + this.y * this.y;
	}
	normalize() {
		const l = this.length() || 1;
		return this.multiplyScalar(1 / l);
	}
	distanceTo(v) {
		return Math.hypot(this.x - v.x, this.y - v.y);
	}
	distanceToSquared(v) {
		const dx = this.x - v.x, dy = this.y - v.y;
		return dx * dx + dy * dy;
	}
	lerp(v, alpha) {
		this.x += (v.x - this.x) * alpha;
		this.y += (v.y - this.y) * alpha;
		return this;
	}
	clamp(min, max) {
		this.x = Math.min(Math.max(this.x, min.x), max.x);
		this.y = Math.min(Math.max(this.y, min.y), max.y);
		return this;
	}
	equals(v) {
		return this.x === v.x && this.y === v.y;
	}
	addScalar(s) {
		this.x += s;
		this.y += s;
		return this;
	}
	subScalar(s) {
		this.x -= s;
		this.y -= s;
		return this;
	}
	multiply(v) {
		this.x *= v.x;
		this.y *= v.y;
		return this;
	}
	divide(v) {
		this.x /= v.x || 1;
		this.y /= v.y || 1;
		return this;
	}
	addVectors(a, b) {
		return this.set(a.x + b.x, a.y + b.y);
	}
	subVectors(a, b) {
		return this.set(a.x - b.x, a.y - b.y);
	}
	lerpVectors(a, b, alpha) {
		return this.set(a.x + (b.x - a.x) * alpha, a.y + (b.y - a.y) * alpha);
	}
	angle() {
		return Math.atan2(this.y, this.x);
	}
	angleTo(v) {
		const d = Math.sqrt(this.lengthSq() * v.lengthSq());
		if (d === 0) return Math.PI / 2;
		return Math.acos(Math.max(-1, Math.min(1, this.dot(v) / d)));
	}
	manhattanLength() {
		return Math.abs(this.x) + Math.abs(this.y);
	}
	manhattanDistanceTo(v) {
		return Math.abs(this.x - v.x) + Math.abs(this.y - v.y);
	}
	ceil() {
		return this.set(Math.ceil(this.x), Math.ceil(this.y));
	}
	floor() {
		return this.set(Math.floor(this.x), Math.floor(this.y));
	}
	round() {
		return this.set(Math.round(this.x), Math.round(this.y));
	}
	roundToZero() {
		return this.set(this.x < 0 ? Math.ceil(this.x) : Math.floor(this.x), this.y < 0 ? Math.ceil(this.y) : Math.floor(this.y));
	}
	setLength(length) {
		return this.normalize().multiplyScalar(length);
	}
	clampLength(min, max) {
		const l = this.length();
		if (l === 0) return this;
		return this.multiplyScalar(Math.max(min, Math.min(max, l)) / l);
	}
	clampScalar(min, max) {
		return this.clamp(_v2Min.set(min, min), _v2Max.set(max, max));
	}
	setX(x) {
		this.x = x;
		return this;
	}
	setY(y) {
		this.y = y;
		return this;
	}
	rotateAround(center, angle) {
		const c = Math.cos(angle), s = Math.sin(angle);
		const dx = this.x - center.x, dy = this.y - center.y;
		return this.set(center.x + dx * c - dy * s, center.y + dx * s + dy * c);
	}
	random() {
		this.x = Math.random();
		this.y = Math.random();
		return this;
	}
	get width() {
		return this.x;
	}
	get height() {
		return this.y;
	}
	fromArray(a, offset = 0) {
		return this.set(a[offset], a[offset + 1]);
	}
	toArray(a = [], offset = 0) {
		a[offset] = this.x;
		a[offset + 1] = this.y;
		return a;
	}
	fromBufferAttribute(attribute, index) {
		const a = attribute.array, s = attribute.itemSize || 2;
		return this.set(a[index * s], a[index * s + 1]);
	}
	getComponent(index) {
		return index === 0 ? this.x : this.y;
	}
	setComponent(index, value) {
		if (index === 0) this.x = value;
		else this.y = value;
		return this;
	}
	addScaledVector(v, s) {
		this.x += v.x * s;
		this.y += v.y * s;
		return this;
	}
	min(v) {
		this.x = Math.min(this.x, v.x);
		this.y = Math.min(this.y, v.y);
		return this;
	}
	max(v) {
		this.x = Math.max(this.x, v.x);
		this.y = Math.max(this.y, v.y);
		return this;
	}
	applyMatrix3(m) {
		const e = m.elements || m;
		const x = this.x, y = this.y;
		return this.set(e[0] * x + e[3] * y, e[1] * x + e[4] * y);
	}
};
const _v2Min = new Vector2();
const _v2Max = new Vector2();

// src/three/color.ts
function srgbToLinear(c) {
	return c <= .04045 ? c / 12.92 : Math.pow((c + .055) / 1.055, 2.4);
}
function linearToSrgb(c) {
	return c <= .0031308 ? c * 12.92 : 1.055 * Math.pow(c, 1 / 2.4) - .055;
}
function hexToRgb(hex) {
	const value = hex & 0xffffff;
	return [
		(value >> 16 & 255) / 255,
		(value >> 8 & 255) / 255,
		(value & 255) / 255
	];
}
function parseCssColor(style) {
	const text = String(style).trim().toLowerCase();
	const hex = text.match(/^#([0-9a-f]{3,8})$/);
	if (hex) {
		let digits = hex[1];
		if (digits.length === 3 || digits.length === 4) digits = [...digits].map((d) => d + d).join("");
		if (digits.length === 6 || digits.length === 8) return [...hexToRgb(parseInt(digits.slice(0, 6), 16)).map(srgbToLinear), digits.length === 8 ? parseInt(digits.slice(6), 16) / 255 : 1];
	}
	const rgb = text.match(/^rgba?\(\s*([\d.]+)[\s,]+([\d.]+)[\s,]+([\d.]+)/);
	if (rgb) return [
		srgbToLinear(+rgb[1] / 255),
		srgbToLinear(+rgb[2] / 255),
		srgbToLinear(+rgb[3] / 255),
		1
	];
	const named = {
		white: [
			1,
			1,
			1
		],
		black: [
			0,
			0,
			0
		],
		red: [
			1,
			0,
			0
		],
		green: [
			0,
			128 / 255,
			0
		],
		blue: [
			0,
			0,
			1
		],
		gray: [
			.502,
			.502,
			.502
		],
		grey: [
			.502,
			.502,
			.502
		],
		yellow: [
			1,
			1,
			0
		],
		cyan: [
			0,
			1,
			1
		],
		magenta: [
			1,
			0,
			1
		],
		orange: [
			1,
			.647,
			0
		]
	};
	if (named[text]) return [...named[text], 1];
	throw new Error(`gs3d: unsupported colour '${style}'`);
}
var Color = class Color {
	constructor(r = 0xffffff, g, b) {
		this.isColor = true;
		this.r = 1;
		this.g = 1;
		this.b = 1;
		this.set(r, g, b);
	}
	set(value, g, b) {
		if (value === void 0) return this;
		if (typeof value === "number" && g === void 0) return this.setHex(value);
		if (typeof value === "string") {
			const [r, gg, bb] = parseCssColor(value);
			this.r = r;
			this.g = gg;
			this.b = bb;
			return this;
		}
		if (value && value.isColor) return this.copy(value);
		return this.setRGB(value, g, b);
	}
	setHex(hex) {
		const [r, g, b] = hexToRgb(hex);
		return this.setRGB(srgbToLinear(r), srgbToLinear(g), srgbToLinear(b));
	}
	setRGB(r, g, b) {
		this.r = r;
		this.g = g;
		this.b = b;
		return this;
	}
	setStyle(style) {
		return this.set(style);
	}
	copy(color) {
		this.r = color.r;
		this.g = color.g;
		this.b = color.b;
		return this;
	}
	clone() {
		return new Color().copy(this);
	}
	getHex() {
		const toByte = (c) => Math.round(Math.min(Math.max(linearToSrgb(c), 0), 1) * 255);
		return toByte(this.r) << 16 | toByte(this.g) << 8 | toByte(this.b);
	}
	getHexString() {
		return this.getHex().toString(16).padStart(6, "0");
	}
	getStyle() {
		const toByte = (c) => Math.round(Math.min(Math.max(linearToSrgb(c), 0), 1) * 255);
		return `rgb(${toByte(this.r)}, ${toByte(this.g)}, ${toByte(this.b)})`;
	}
	lerp(color, alpha) {
		this.r += (color.r - this.r) * alpha;
		this.g += (color.g - this.g) * alpha;
		this.b += (color.b - this.b) * alpha;
		return this;
	}
	getHSL(target = {}) {
		const r = this.r, g = this.g, b = this.b;
		const max = Math.max(r, g, b), min = Math.min(r, g, b);
		const l = (max + min) / 2, d = max - min;
		let h = 0, s = 0;
		if (d > 1e-12) {
			s = l > .5 ? d / (2 - max - min) : d / (max + min);
			if (max === r) h = (g - b) / d + (g < b ? 6 : 0);
			else if (max === g) h = (b - r) / d + 2;
			else h = (r - g) / d + 4;
			h /= 6;
		}
		target.h = h;
		target.s = s;
		target.l = l;
		return target;
	}
	offsetHSL(h, s, l) {
		const hsl = this.getHSL({
			h: 0,
			s: 0,
			l: 0
		});
		hsl.h = (hsl.h + h) % 1;
		if (hsl.h < 0) hsl.h += 1;
		hsl.s = Math.min(1, Math.max(0, hsl.s + s));
		hsl.l = Math.min(1, Math.max(0, hsl.l + l));
		const { h: hh, s: ss, l: ll } = hsl;
		if (ss === 0) {
			const v = ll;
			return this.setRGB(v, v, v);
		}
		const q = ll < .5 ? ll * (1 + ss) : ll + ss - ll * ss;
		const p = 2 * ll - q;
		const f = (t) => {
			t = (t % 1 + 1) % 1;
			if (t < 1 / 6) return p + (q - p) * 6 * t;
			if (t < 1 / 2) return q;
			if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
			return p;
		};
		return this.setRGB(f(hh + 1 / 3), f(hh), f(hh - 1 / 3));
	}
	setHSL(h, s, l) {
		const hue2rgb = (p, q, t) => {
			if (t < 0) t += 1;
			if (t > 1) t -= 1;
			if (t < 1 / 6) return p + (q - p) * 6 * t;
			if (t < 1 / 2) return q;
			if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
			return p;
		};
		h = (h % 1 + 1) % 1;
		if (s === 0) return this.setRGB(l, l, l);
		const q = l < .5 ? l * (1 + s) : l + s - l * s;
		const p = 2 * l - q;
		return this.setRGB(hue2rgb(p, q, h + 1 / 3), hue2rgb(p, q, h), hue2rgb(p, q, h - 1 / 3));
	}
	setScalar(s) {
		return this.setRGB(s, s, s);
	}
	setColorName(name) {
		return this.setStyle(name);
	}
	setFromVector3(v) {
		return this.setRGB(v.x, v.y, v.z);
	}
	setFromBufferAttribute(attribute, index) {
		const o = index * attribute.itemSize;
		return this.setRGB(attribute.array[o], attribute.array[o + 1], attribute.array[o + 2]);
	}
	fromBufferAttribute(attribute, index) {
		return this.setFromBufferAttribute(attribute, index);
	}
	equals(c) {
		return c && this.r === c.r && this.g === c.g && this.b === c.b;
	}
	fromArray(array, offset = 0) {
		return this.setRGB(array[offset], array[offset + 1], array[offset + 2]);
	}
	toArray(array = [], offset = 0) {
		array[offset] = this.r;
		array[offset + 1] = this.g;
		array[offset + 2] = this.b;
		return array;
	}
	add(c) {
		this.r += c.r;
		this.g += c.g;
		this.b += c.b;
		return this;
	}
	addColors(a, b) {
		return this.add(a).add(b);
	}
	addScalar(s) {
		this.r += s;
		this.g += s;
		this.b += s;
		return this;
	}
	sub(c) {
		this.r -= c.r;
		this.g -= c.g;
		this.b -= c.b;
		return this;
	}
	multiply(c) {
		this.r *= c.r;
		this.g *= c.g;
		this.b *= c.b;
		return this;
	}
	multiplyScalar(s) {
		this.r *= s;
		this.g *= s;
		this.b *= s;
		return this;
	}
	lerpColors(c1, c2, alpha) {
		return this.copy(c1).lerp(c2, alpha);
	}
	lerpHSL(c, alpha) {
		const a = this.getHSL({
			h: 0,
			s: 0,
			l: 0
		}), b = c.getHSL({
			h: 0,
			s: 0,
			l: 0
		});
		const dh = (b.h - a.h + 1.5) % 1 - .5;
		return this.setHSL((a.h + dh * alpha) % 1 || 0, a.s + (b.s - a.s) * alpha, a.l + (b.l - a.l) * alpha);
	}
	getRGB(target = {}) {
		target.r = Math.round(Math.min(Math.max(linearToSrgb(this.r), 0), 1) * 255);
		target.g = Math.round(Math.min(Math.max(linearToSrgb(this.g), 0), 1) * 255);
		target.b = Math.round(Math.min(Math.max(linearToSrgb(this.b), 0), 1) * 255);
		return target;
	}
	applyMatrix3(m) {
		const e = m.elements || m;
		const x = this.r, y = this.g, z = this.b;
		this.r = e[0] * x + e[3] * y + e[6] * z;
		this.g = e[1] * x + e[4] * y + e[7] * z;
		this.b = e[2] * x + e[5] * y + e[8] * z;
		return this;
	}
	convertSRGBToLinear() {
		this.r = srgbToLinear(this.r);
		this.g = srgbToLinear(this.g);
		this.b = srgbToLinear(this.b);
		return this;
	}
	convertLinearToSRGB() {
		this.r = linearToSrgb(this.r);
		this.g = linearToSrgb(this.g);
		this.b = linearToSrgb(this.b);
		return this;
	}
	copySRGBToLinear() {
		return this.convertSRGBToLinear();
	}
	copyLinearToSRGB() {
		return this.convertLinearToSRGB();
	}
	toJSON() {
		return this.getHex();
	}
};

// src/three/events.ts
var EventDispatcher = class {
	constructor() {
		this.isEventDispatcher = true;
		this._listeners = /* @__PURE__ */ new Map();
	}
	addEventListener(type, listener) {
		if (typeof listener !== "function") return this;
		let list = this._listeners.get(type);
		if (!list) this._listeners.set(type, list = []);
		if (!list.includes(listener)) list.push(listener);
		return this;
	}
	hasEventListener(type, listener) {
		const list = this._listeners.get(type);
		return !!list && list.includes(listener);
	}
	removeEventListener(type, listener) {
		const list = this._listeners.get(type);
		if (list) {
			const i = list.indexOf(listener);
			if (i >= 0) list.splice(i, 1);
			if (!list.length) this._listeners.delete(type);
		}
		return this;
	}
	dispatchEvent(event) {
		const type = typeof event === "string" ? event : event && event.type;
		if (!type) return false;
		const ev = typeof event === "string" ? { type: event } : event;
		ev.target = ev.target || this;
		const list = this._listeners.get(type);
		if (list) {
			for (const fn of [...list]) if (fn.call(this, ev) === false) return false;
		}
		return true;
	}
};

// src/three/scene.ts
var Layers = class {
	constructor() {
		this.mask = 1;
	}
	set(channel) {
		this.mask = 1 << channel >>> 0;
	}
	enable(channel) {
		this.mask |= 1 << channel;
	}
	enableAll() {
		this.mask = 0xffffffff;
	}
	toggle(channel) {
		this.mask ^= 1 << channel;
	}
	disable(channel) {
		this.mask &= ~(1 << channel);
	}
	disableAll() {
		this.mask = 0;
	}
	test(layers) {
		return (this.mask & layers.mask) !== 0;
	}
	isEnabled(channel) {
		return (this.mask & 1 << channel) !== 0;
	}
};
const _rotQuat = new Quaternion();
const _rotVec = new Vector3();
const _axisX = new Vector3(1, 0, 0);
const _axisY = new Vector3(0, 1, 0);
const _axisZ = new Vector3(0, 0, 1);
let _object3DId = 0;
var Object3D = class extends EventDispatcher {
	constructor() {
		super();
		this._onBeforeRender = null;
		this._onAfterRender = null;
		this._onBeforeShadow = null;
		this._onAfterShadow = null;
		this.isObject3D = true;
		this.id = _object3DId++;
		this.uuid = "obj-" + Math.random().toString(36).slice(2, 10);
		this.name = "";
		this.position = new Vector3();
		this.rotation = new Euler();
		this.quaternion = new Quaternion();
		this.scale = new Vector3(1, 1, 1);
		this._qCache = {
			x: 0,
			y: 0,
			z: 0,
			w: 1
		};
		this._eCache = {
			x: 0,
			y: 0,
			z: 0,
			order: "XYZ"
		};
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
		while (parent) {
			callback(parent);
			parent = parent.parent;
		}
		return this;
	}
	get ancestors() {
		const out = [];
		this.traverseAncestors((o) => out.push(o));
		return out;
	}
	updateMatrix() {
		if (this.matrixAutoUpdate) this.matrix.elements.set(localMatrixOf(this));
		return this;
	}
	updateMatrixWorld(force) {
		if (this.matrixAutoUpdate) this.updateMatrix();
		if (this.parent && this.parent.matrixWorld) this.matrixWorld.multiplyMatrices(this.parent.matrixWorld, this.matrix);
		else this.matrixWorld.copy(this.matrix);
		for (const child of this.children) child.updateMatrixWorld(force);
		return this;
	}
	updateWorldMatrix(updateParents, updateChildren) {
		if (updateParents && this.parent) this.parent.updateWorldMatrix(true, false);
		if (this.matrixAutoUpdate) this.updateMatrix();
		if (this.parent) this.matrixWorld.multiplyMatrices(this.parent.matrixWorld, this.matrix);
		else this.matrixWorld.copy(this.matrix);
		if (updateChildren) for (const child of this.children) child.updateWorldMatrix(false, true);
		return this;
	}
	localToWorld(vector) {
		this.updateWorldMatrix(true, false);
		return vector.applyMatrix4(this.matrixWorld);
	}
	worldToLocal(vector) {
		this.updateWorldMatrix(true, false);
		return vector.applyMatrix4(new Matrix4().copy(this.matrixWorld).invert());
	}
	lookAt(target, y, z) {
		const pos = transformPoint(worldMatrixOf(this), 0, 0, 0);
		const tp = typeof target === "number" ? [
			target,
			y,
			z
		] : target && target.isVector3 ? [
			target.x,
			target.y,
			target.z
		] : target ? transformPoint(worldMatrixOf(target), 0, 0, 0) : [
			0,
			0,
			0
		];
		let dx = tp[0] - pos[0], dy = tp[1] - pos[1], dz = tp[2] - pos[2];
		const len = Math.hypot(dx, dy, dz) || 1;
		dx /= len;
		dy /= len;
		dz /= len;
		if (!this.isCamera && !this.isLight) {
			dx = -dx;
			dy = -dy;
			dz = -dz;
		}
		let zx = -dx, zy = -dy, zz = -dz;
		let rx = zz, rz = -zx;
		let rl = Math.hypot(rx, rz);
		if (rl < 1e-9) {
			zx += 1e-6;
			const l = Math.hypot(zx, zy, zz);
			zx /= l;
			zy /= l;
			zz /= l;
			rx = zz;
			rz = -zx;
			rl = Math.hypot(rx, rz);
		}
		rx /= rl;
		rz /= rl;
		const ux = zy * rz, uy = zz * rx - zx * rz, uz = -zy * rx;
		this.quaternion.setFromRotationMatrix([
			rx,
			0,
			rz,
			0,
			ux,
			uy,
			uz,
			0,
			zx,
			zy,
			zz,
			0,
			0,
			0,
			0,
			1
		]);
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
	rotateOnAxis(axis, angle) {
		_rotQuat.setFromAxisAngle(axis, angle);
		this.quaternion.multiply(_rotQuat);
		return this;
	}
	rotateOnWorldAxis(axis, angle) {
		_rotQuat.setFromAxisAngle(axis, angle);
		this.quaternion.premultiply(_rotQuat);
		return this;
	}
	rotateX(angle) {
		return this.rotateOnAxis(_axisX, angle);
	}
	rotateY(angle) {
		return this.rotateOnAxis(_axisY, angle);
	}
	rotateZ(angle) {
		return this.rotateOnAxis(_axisZ, angle);
	}
	translateX(distance) {
		return this.translateOnAxis(_axisX, distance);
	}
	translateY(distance) {
		return this.translateOnAxis(_axisY, distance);
	}
	translateZ(distance) {
		return this.translateOnAxis(_axisZ, distance);
	}
	translateOnAxis(axis, distance) {
		_rotVec.copy(axis).applyQuaternion(this.quaternion);
		this.position.addScaledVector(_rotVec, distance);
		return this;
	}
	get onBeforeRender() {
		return this._onBeforeRender ?? null;
	}
	set onBeforeRender(v) {
		this._onBeforeRender = v;
	}
	get onAfterRender() {
		return this._onAfterRender ?? null;
	}
	set onAfterRender(v) {
		this._onAfterRender = v;
	}
	get onBeforeShadow() {
		return this._onBeforeShadow ?? null;
	}
	set onBeforeShadow(v) {
		this._onBeforeShadow = v;
	}
	get onAfterShadow() {
		return this._onAfterShadow ?? null;
	}
	set onAfterShadow(v) {
		this._onAfterShadow = v;
	}
	applyMatrix4(m) {
		this.updateWorldMatrix(true, false);
		const world = new Matrix4().multiplyMatrices(m.elements || m, this.matrixWorld);
		(this.parent ? world.premultiply(new Matrix4().copy(this.parent.matrixWorld).invert()) : world).decompose(this.position, this.quaternion, this.scale);
		this.updateMatrix();
		return this;
	}
	applyQuaternion(q) {
		const world = new Quaternion().setFromRotationMatrix(worldMatrixOf(this));
		world.premultiply(q);
		this.quaternion.copy(world);
		return this;
	}
	setRotationFromAxisAngle(axis, angle) {
		this.quaternion.setFromAxisAngle(axis, angle);
		return this;
	}
	setRotationFromEuler(euler) {
		this.quaternion.setFromEuler(euler);
		this.rotation.copy(euler);
		return this;
	}
	setRotationFromMatrix(m) {
		this.quaternion.setFromRotationMatrix(m);
		return this;
	}
	setRotationFromQuaternion(q) {
		this.quaternion.copy(q);
		return this;
	}
	attach(object) {
		this.updateWorldMatrix(true, false);
		object.updateWorldMatrix(true, false);
		const world = object.matrixWorld.clone();
		const inv = new Matrix4().copy(this.matrixWorld).invert();
		world.premultiply(inv).decompose(object.position, object.quaternion, object.scale);
		object.updateMatrix();
		this.add(object);
		return this;
	}
	getObjectById(id) {
		if (this.id === id) return this;
		for (const child of this.children) {
			const found = child.getObjectById(id);
			if (found) return found;
		}
		return null;
	}
	getObjectsByProperty(name, value, result = []) {
		if (this[name] === value) result.push(this);
		for (const child of this.children) child.getObjectsByProperty(name, value, result);
		return result;
	}
	getWorldScale(target = new Vector3()) {
		const m = worldMatrixOf(this);
		return target.set(Math.hypot(m[0], m[1], m[2]), Math.hypot(m[4], m[5], m[6]), Math.hypot(m[8], m[9], m[10]));
	}
	copy(source, recursive = true) {
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
		if (recursive) for (const child of source.children) this.add(child.clone(true));
		return this;
	}
	clone(recursive = true) {
		return new this.constructor().copy(this, recursive);
	}
	raycast(raycaster, intersects = []) {
		return intersects;
	}
	updateMorphTargets() {
		return this;
	}
	dispose() {}
	toJSON(meta = {}) {
		return {
			uuid: this.uuid,
			type: this.type || this.constructor.name,
			name: this.name,
			matrix: Array.from(this.matrix.elements),
			children: this.children.map((c) => c.toJSON ? c.toJSON(meta) : null).filter(Boolean)
		};
	}
};
var Group = class extends Object3D {
	constructor() {
		super();
		this.isGroup = true;
	}
};
var Scene = class extends Object3D {
	constructor() {
		super();
		this.isScene = true;
		this.background = null;
		this.fog = null;
		this.environment = null;
		this.environmentIntensity = 1;
		this.environmentRotation = 0;
	}
};
var Light = class extends Object3D {
	constructor(color = 0xffffff, intensity = 1) {
		super();
		this.isLight = true;
		this.color = color instanceof Color ? color : new Color(color);
		this.intensity = intensity;
	}
};
var AmbientLight = class extends Light {
	constructor(color = 0xffffff, intensity = 1) {
		super(color, intensity);
		this.isAmbientLight = true;
	}
};
var HemisphereLight = class extends Light {
	constructor(skyColor = 0xffffff, groundColor = 4473924, intensity = 1) {
		super(skyColor, intensity);
		this.isHemisphereLight = true;
		this.groundColor = groundColor instanceof Color ? groundColor : new Color(groundColor);
	}
};
var DirectionalLightShadow = class {
	constructor() {
		this.mapSize = new Vector2(512, 512);
		this.bias = 0;
		this.normalBias = 0;
		this.radius = 1;
		this.camera = {
			left: -5,
			right: 5,
			top: 5,
			bottom: -5,
			near: .5,
			far: 500,
			updateProjectionMatrix() {}
		};
		this.map = null;
		this.mapPass = null;
		this.autoUpdate = true;
		this.needsUpdate = true;
	}
	dispose() {}
};
var DirectionalLight = class extends Light {
	constructor(color = 0xffffff, intensity = 1) {
		super(color, intensity);
		this.isDirectionalLight = true;
		this.target = new Object3D();
		this.shadow = new DirectionalLightShadow();
	}
};
var PointLight = class extends Light {
	get power() {
		return this.intensity * 4 * Math.PI;
	}
	set power(v) {
		this.intensity = v / (4 * Math.PI);
	}
	constructor(color = 0xffffff, intensity = 1, distance = 0, decay = 2) {
		super(color, intensity);
		this.isPointLight = true;
		this.distance = distance;
		this.decay = decay;
	}
};
var SpotLight = class extends Light {
	get power() {
		return this.intensity * 4 * Math.PI;
	}
	set power(v) {
		this.intensity = v / (4 * Math.PI);
	}
	constructor(color = 0xffffff, intensity = 1, distance = 0, angle = Math.PI / 3, penumbra = 0, decay = 2) {
		super(color, intensity);
		this.isSpotLight = true;
		this.distance = distance;
		this.angle = angle;
		this.penumbra = penumbra;
		this.decay = decay;
		this.target = new Object3D();
	}
};
var RectAreaLight = class extends Light {
	get power() {
		return this.intensity * 4 * Math.PI;
	}
	set power(v) {
		this.intensity = v / (4 * Math.PI);
	}
	constructor(color = 0xffffff, intensity = 1) {
		super(color, intensity);
		this.isRectAreaLight = true;
	}
};
var PerspectiveCamera = class extends Object3D {
	constructor(fov = 50, aspect = 1, near = .1, far = 2e3) {
		super();
		this.isCamera = true;
		this.isPerspectiveCamera = true;
		this.fov = fov;
		this.aspect = aspect;
		this.near = near;
		this.far = far;
		this.projectionMatrix = new Matrix4();
		this.updateProjectionMatrix();
	}
	updateProjectionMatrix() {
		const fov = this.fov * Math.PI / 180;
		this.projectionMatrix = new Matrix4().makePerspective(fov, this.aspect, this.near, this.far);
		const v = this.view;
		if (v && v.enabled) {
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
	get filmWidth() {
		return this._filmWidth ?? 35;
	}
	set filmWidth(v) {
		this._filmWidth = v;
		this.updateProjectionMatrix();
	}
	get filmHeight() {
		return this._filmHeight ?? 0;
	}
	set filmHeight(v) {
		this._filmHeight = v;
		this.updateProjectionMatrix();
	}
	getViewSize(target = new Vector2()) {
		const h = this.getFilmHeight();
		const w = h * this.aspect;
		return target.set(w, h);
	}
	getViewBounds(target = new Vector4()) {
		const v = this.getViewSize(_perspSize);
		return target.set(-v.x / 2, -v.y / 2, v.x / 2, v.y / 2);
	}
	getFilmWidth() {
		return this._filmHeight ? this._filmHeight * this.aspect : 35;
	}
	getFilmHeight() {
		return this._filmHeight ?? 35 / this.aspect;
	}
	getFocalLength() {
		const vFov = this.fov * Math.PI / 180;
		return this.getFilmHeight() / 2 / Math.tan(vFov / 2);
	}
	setFocalLength(focalLength) {
		const vExtentSlope = this.getFilmHeight() / 2 / focalLength;
		this.fov = 2 * Math.atan(vExtentSlope) * 180 / Math.PI;
		this.updateProjectionMatrix();
		return this;
	}
	getEffectiveFOV() {
		return this.fov;
	}
	get reversedDepth() {
		return this._reversedDepth ?? false;
	}
	set reversedDepth(v) {
		this._reversedDepth = v;
		this.updateProjectionMatrix();
	}
};
const _perspSize = new Vector2();
const cameraViewOffset = {
	setViewOffset(fullWidth, fullHeight, x, y, width, height) {
		this.view = {
			enabled: true,
			fullWidth,
			fullHeight,
			offsetX: x,
			offsetY: y,
			width,
			height
		};
		if (this.updateProjectionMatrix) this.updateProjectionMatrix();
		return this;
	},
	clearViewOffset() {
		this.view = null;
		if (this.updateProjectionMatrix) this.updateProjectionMatrix();
		return this;
	}
};
Object.assign(PerspectiveCamera.prototype, cameraViewOffset);
var OrthographicCamera = class extends Object3D {
	get reversedDepth() {
		return this._reversedDepth ?? false;
	}
	set reversedDepth(v) {
		this._reversedDepth = v;
		this.updateProjectionMatrix();
	}
	constructor(left = -1, right = 1, top = 1, bottom = -1, near = .1, far = 2e3) {
		super();
		this.isCamera = true;
		this.isOrthographicCamera = true;
		this.left = left;
		this.right = right;
		this.top = top;
		this.bottom = bottom;
		this.near = near;
		this.far = far;
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
};
Object.assign(OrthographicCamera.prototype, cameraViewOffset);
var CubeCamera = class extends Object3D {
	updateCoordinateSystem() {
		return this;
	}
	constructor(near = .1, far = 2e3, renderTarget) {
		super();
		this.isCubeCamera = true;
		this.near = near;
		this.far = far;
		this.renderTarget = renderTarget || null;
		for (let i = 0; i < 6; i++) {
			const cam = new PerspectiveCamera(90, 1, near, far);
			cam.name = "cube" + i;
			this.add(cam);
		}
	}
	getRenderTarget() {
		return this.renderTarget;
	}
	update(renderer, scene) {
		return this;
	}
};
var Camera = class extends Object3D {
	get reversedDepth() {
		return false;
	}
	constructor() {
		super();
		this.isCamera = true;
		this.near = .1;
		this.far = 2e3;
		this.aspect = 1;
		this.fov = 50;
	}
};
var Fog = class Fog {
	clone() {
		return new Fog(this.color.clone ? this.color.clone() : this.color, this.near, this.far);
	}
	toJSON() {
		return {
			color: this.color.getHex ? this.color.getHex() : this.color,
			near: this.near,
			far: this.far
		};
	}
	constructor(color = 0xffffff, near = 1, far = 1e3) {
		this.isFog = true;
		this.color = color instanceof Color ? color : new Color(color);
		this.near = near;
		this.far = far;
	}
};
var FogExp2 = class FogExp2 {
	clone() {
		return new FogExp2(this.color.clone ? this.color.clone() : this.color, this.density);
	}
	toJSON() {
		return {
			color: this.color.getHex ? this.color.getHex() : this.color,
			density: this.density
		};
	}
	constructor(color = 0xffffff, density = 25e-5) {
		this.isFogExp2 = true;
		this.color = color instanceof Color ? color : new Color(color);
		this.density = density;
	}
};

// src/three/geometry.ts
var BufferAttribute = class BufferAttribute {
	constructor(array, itemSize, normalized = false) {
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
	set needsUpdate(v) {
		if (v) this.version++;
	}
	get needsUpdate() {
		return false;
	}
	addUpdateRange(start, count) {
		this.updateRanges.push({
			start,
			count
		});
	}
	clearUpdateRanges() {
		this.updateRanges.length = 0;
	}
	setUsage(usage) {
		this.usage = usage;
		return this;
	}
	onUpload(callback) {
		this._onUpload = callback;
		return this;
	}
	onUploadCallback() {
		return this;
	}
	clone() {
		return new BufferAttribute(this.array.slice(), this.itemSize, this.normalized);
	}
	copy(source) {
		this.array = source.array.slice ? source.array.slice() : source.array;
		this.itemSize = source.itemSize;
		this.normalized = source.normalized;
		this.count = source.count;
		this.updateRanges = source.updateRanges.map((r) => ({ ...r }));
		this.usage = source.usage;
		return this;
	}
	copyArray(array) {
		this.array.set ? this.array.set(array) : this.array = array;
		this.needsUpdate = true;
		return this;
	}
	copyAt(index, array) {
		const o = index * this.itemSize;
		for (let i = 0; i < this.itemSize && o + i < this.array.length; i++) this.array[o + i] = array[i];
		this.needsUpdate = true;
		return this;
	}
	_c(index, k) {
		return this.array[index * this.itemSize + k];
	}
	getX(index) {
		return this._c(index, 0);
	}
	getY(index) {
		return this._c(index, 1);
	}
	getZ(index) {
		return this._c(index, 2);
	}
	getW(index) {
		return this._c(index, 3);
	}
	setX(index, v) {
		this.array[index * this.itemSize] = v;
		this.needsUpdate = true;
		return this;
	}
	setY(index, v) {
		this.array[index * this.itemSize + 1] = v;
		this.needsUpdate = true;
		return this;
	}
	setZ(index, v) {
		this.array[index * this.itemSize + 2] = v;
		this.needsUpdate = true;
		return this;
	}
	setW(index, v) {
		this.array[index * this.itemSize + 3] = v;
		this.needsUpdate = true;
		return this;
	}
	setXY(index, x, y) {
		const o = index * this.itemSize;
		this.array[o] = x;
		this.array[o + 1] = y;
		this.needsUpdate = true;
		return this;
	}
	setXYZ(index, x, y, z) {
		const o = index * this.itemSize;
		this.array[o] = x;
		this.array[o + 1] = y;
		this.array[o + 2] = z;
		this.needsUpdate = true;
		return this;
	}
	setXYZW(index, x, y, z, w) {
		const o = index * this.itemSize;
		this.array[o] = x;
		this.array[o + 1] = y;
		this.array[o + 2] = z;
		this.array[o + 3] = w;
		this.needsUpdate = true;
		return this;
	}
	getComponent(index, k) {
		return this._c(index, k);
	}
	setComponent(index, k, v) {
		this.array[index * this.itemSize + k] = v;
		this.needsUpdate = true;
		return this;
	}
	set(array, offset = 0) {
		for (let i = 0; i < this.count * this.itemSize && offset + i < array.length; i++) this.array[i] = array[offset + i];
		this.needsUpdate = true;
		return this;
	}
	applyMatrix3(m) {
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
	applyMatrix4(m) {
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
	transformDirection(m) {
		const e = m.elements || m;
		for (let i = 0; i < this.count; i++) {
			const o = i * this.itemSize;
			const x = this.array[o], y = this.array[o + 1], z = this.array[o + 2];
			const nx = e[0] * x + e[4] * y + e[8] * z;
			const ny = e[1] * x + e[5] * y + e[9] * z;
			const nz = e[2] * x + e[6] * y + e[10] * z;
			const l = Math.hypot(nx, ny, nz) || 1;
			this.array[o] = nx / l;
			this.array[o + 1] = ny / l;
			this.array[o + 2] = nz / l;
		}
		this.needsUpdate = true;
		return this;
	}
	applyNormalMatrix(m) {
		const e = m.elements || m;
		const n = e.length >= 16 ? 16 : 9;
		for (let i = 0; i < this.count; i++) {
			const o = i * this.itemSize;
			const x = this.array[o], y = this.array[o + 1], z = this.array[o + 2];
			let nx, ny, nz;
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
			this.array[o] = nx / l;
			this.array[o + 1] = ny / l;
			this.array[o + 2] = nz / l;
		}
		this.needsUpdate = true;
		return this;
	}
	toJSON() {
		const a = this.array;
		return {
			itemSize: this.itemSize,
			type: a.constructor.name === "Float32Array" ? "Float32Array" : a.constructor.name === "Uint16Array" ? "Uint16Array" : a.constructor.name === "Uint32Array" ? "Uint32Array" : "Float32Array",
			array: Array.from(a),
			normalized: this.normalized
		};
	}
};
var Float32BufferAttribute = class Float32BufferAttribute extends BufferAttribute {
	constructor(array, itemSize, normalized = false) {
		super(Float32Array.from(array), itemSize, normalized);
	}
	clone() {
		return new Float32BufferAttribute(this.array.slice(), this.itemSize, this.normalized);
	}
};
var Uint16BufferAttribute = class Uint16BufferAttribute extends BufferAttribute {
	constructor(array, itemSize, normalized = false) {
		super(Uint16Array.from(array), itemSize, normalized);
	}
	clone() {
		return new Uint16BufferAttribute(this.array.slice(), this.itemSize, this.normalized);
	}
};
var Uint32BufferAttribute = class Uint32BufferAttribute extends BufferAttribute {
	constructor(array, itemSize, normalized = false) {
		super(Uint32Array.from(array), itemSize, normalized);
	}
	clone() {
		return new Uint32BufferAttribute(this.array.slice(), this.itemSize, this.normalized);
	}
};
var InterleavedBuffer = class InterleavedBuffer {
	constructor(array, stride) {
		this.isInterleavedBuffer = true;
		this.array = array;
		this.stride = stride;
		this.usage = 35044;
		this.updateRanges = [];
		this.version = 0;
	}
	get needsUpdate() {
		return false;
	}
	set needsUpdate(v) {
		if (v) this.version++;
	}
	addUpdateRange(start, count) {
		this.updateRanges.push({
			start,
			count
		});
	}
	clearUpdateRanges() {
		this.updateRanges.length = 0;
	}
	setUsage(usage) {
		this.usage = usage;
		return this;
	}
	onUpload(callback) {
		this._onUpload = callback;
		return this;
	}
	onUploadCallback() {
		return this;
	}
	copy(source) {
		this.array = source.array.slice ? source.array.slice() : source.array;
		this.stride = source.stride;
		this.usage = source.usage;
		return this;
	}
	clone() {
		return new InterleavedBuffer(this.array.slice(), this.stride);
	}
	copyAt(index, array) {
		const o = index * this.stride;
		for (let i = 0; i < this.stride && o + i < this.array.length; i++) this.array[o + i] = array[i];
		this.needsUpdate = true;
		return this;
	}
	set(array, offset = 0) {
		for (let i = 0; i < this.array.length && offset + i < array.length; i++) this.array[i] = array[offset + i];
		this.needsUpdate = true;
		return this;
	}
	toJSON() {
		return {
			isInterleavedBuffer: true,
			array: Array.from(this.array),
			stride: this.stride,
			type: this.array.constructor.name === "Float32Array" ? "Float32Array" : this.array.constructor.name === "Uint16Array" ? "Uint16Array" : this.array.constructor.name === "Uint32Array" ? "Uint32Array" : "Float32Array"
		};
	}
};
var InterleavedBufferAttribute = class InterleavedBufferAttribute {
	constructor(data, itemSize, offset = 0, normalized = false) {
		this.isBufferAttribute = true;
		this.isInterleavedBufferAttribute = true;
		this.data = data;
		this.itemSize = itemSize;
		this.offset = offset;
		this.normalized = normalized;
		this._count = Math.max(0, Math.floor(data.array.length / data.stride));
		this.version = 0;
	}
	get array() {
		return this.data.array;
	}
	get count() {
		return this._count;
	}
	get needsUpdate() {
		return false;
	}
	set needsUpdate(v) {
		if (v) this.version++;
	}
	_o(index, k) {
		return index * this.data.stride + this.offset + k;
	}
	getX(i) {
		return this.array[this._o(i, 0)];
	}
	getY(i) {
		return this.array[this._o(i, 1)];
	}
	getZ(i) {
		return this.array[this._o(i, 2)];
	}
	getW(i) {
		return this.array[this._o(i, 3)];
	}
	setX(i, v) {
		this.array[this._o(i, 0)] = v;
		this.needsUpdate = true;
		return this;
	}
	setY(i, v) {
		this.array[this._o(i, 1)] = v;
		this.needsUpdate = true;
		return this;
	}
	setZ(i, v) {
		this.array[this._o(i, 2)] = v;
		this.needsUpdate = true;
		return this;
	}
	setW(i, v) {
		this.array[this._o(i, 3)] = v;
		this.needsUpdate = true;
		return this;
	}
	setXY(i, x, y) {
		this.array[this._o(i, 0)] = x;
		this.array[this._o(i, 1)] = y;
		this.needsUpdate = true;
		return this;
	}
	setXYZ(i, x, y, z) {
		this.array[this._o(i, 0)] = x;
		this.array[this._o(i, 1)] = y;
		this.array[this._o(i, 2)] = z;
		this.needsUpdate = true;
		return this;
	}
	setXYZW(i, x, y, z, w) {
		this.array[this._o(i, 0)] = x;
		this.array[this._o(i, 1)] = y;
		this.array[this._o(i, 2)] = z;
		this.array[this._o(i, 3)] = w;
		this.needsUpdate = true;
		return this;
	}
	getComponent(i, k) {
		return this.array[this._o(i, k)];
	}
	setComponent(i, k, v) {
		this.array[this._o(i, k)] = v;
		this.needsUpdate = true;
		return this;
	}
	clone() {
		return new InterleavedBufferAttribute(this.data, this.itemSize, this.offset, this.normalized);
	}
	copy(source) {
		this.data = source.data;
		this.itemSize = source.itemSize;
		this.offset = source.offset;
		this.normalized = source.normalized;
		this._count = source.count;
		return this;
	}
	_each3(fn) {
		for (let i = 0; i < this.count; i++) {
			const o = i * this.data.stride + this.offset;
			fn((k) => this.array[o + k], (k, v) => {
				this.array[o + k] = v;
			});
		}
		this.needsUpdate = true;
	}
	applyMatrix4(m) {
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
	transformDirection(m) {
		const e = m.elements || m;
		this._each3((get, set) => {
			const x = get(0), y = get(1), z = get(2);
			const nx = e[0] * x + e[4] * y + e[8] * z;
			const ny = e[1] * x + e[5] * y + e[9] * z;
			const nz = e[2] * x + e[6] * y + e[10] * z;
			const l = Math.hypot(nx, ny, nz) || 1;
			set(0, nx / l);
			set(1, ny / l);
			set(2, nz / l);
		});
		return this;
	}
	applyNormalMatrix(m) {
		const e = m.elements || m;
		const is16 = e.length >= 16;
		this._each3((get, set) => {
			const x = get(0), y = get(1), z = get(2);
			let nx, ny, nz;
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
			set(0, nx / l);
			set(1, ny / l);
			set(2, nz / l);
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
				type: a.constructor.name === "Float32Array" ? "Float32Array" : a.constructor.name === "Uint16Array" ? "Uint16Array" : a.constructor.name === "Uint32Array" ? "Uint32Array" : "Float32Array"
			}
		};
	}
};
var BufferGeometry = class BufferGeometry extends EventDispatcher {
	constructor() {
		super();
		this.isBufferGeometry = true;
		this.attributes = {};
		this.index = null;
		this.groups = [];
		this.drawRange = {
			start: 0,
			count: 1e400
		};
		this.boundingBox = null;
		this.boundingSphere = null;
		this.version = 0;
		this.uuid = "geo-" + Math.random().toString(36).slice(2, 10);
		this.morphAttributes = {};
		this.morphTargetsRelative = false;
	}
	setDrawRange(start, count) {
		this.drawRange.start = start;
		this.drawRange.count = count;
		return this;
	}
	setAttribute(name, attribute) {
		this.attributes[name] = attribute;
		if (name === "position") {
			this.boundingBox = null;
			this.boundingSphere = null;
		}
		this.version++;
		return this;
	}
	getAttribute(name) {
		return this.attributes[name];
	}
	deleteAttribute(name) {
		delete this.attributes[name];
		if (name === "position") {
			this.boundingBox = null;
			this.boundingSphere = null;
		}
		this.version++;
		return this;
	}
	getIndex() {
		return this.index;
	}
	hasAttribute(name) {
		return name in this.attributes;
	}
	setFromPoints(points) {
		const arr = new Float32Array(points.length * 3);
		points.forEach((p, i) => {
			arr[i * 3] = p.x;
			arr[i * 3 + 1] = p.y;
			arr[i * 3 + 2] = p.z;
		});
		return this.setAttribute("position", new Float32BufferAttribute(arr, 3));
	}
	toNonIndexed() {
		if (!this.index) return this.clone();
		const pos = this.attributes.position, ids = this.index.array;
		pos && pos.itemSize;
		const triCount = Math.floor(ids.length / 3);
		const out = {};
		for (const [name, attr] of Object.entries(this.attributes)) {
			const a = attr.array, st = attr.itemSize;
			const flat = new attr.array.constructor(triCount * 3 * st);
			for (let t = 0; t < triCount; t++) for (let k = 0; k < 3; k++) {
				const src = ids[t * 3 + k] * st, dst = (t * 3 + k) * st;
				for (let c = 0; c < st; c++) flat[dst + c] = a[src + c];
			}
			out[name] = new BufferAttribute(flat, st, attr.normalized);
		}
		const g = new BufferGeometry();
		for (const [k, v] of Object.entries(out)) g.setAttribute(k, v);
		return g;
	}
	getIndirect() {
		return null;
	}
	setIndirect(_buffer, _type = 0) {
		return this;
	}
	applyQuaternion(q) {
		const x = q.x, y = q.y, z = q.z, w = q.w;
		const rot = (v) => {
			const vx = v[0], vy = v[1], vz = v[2];
			const ix = w * vx + y * vz - z * vy, iy = w * vy + z * vx - x * vz, iz = w * vz + x * vy - y * vx;
			const iw = -x * vx - y * vy - z * vz;
			v[0] = ix * w + iw * -x + iy * -z - iz * -y;
			v[1] = iy * w + iw * -y + iz * -x - ix * -z;
			v[2] = iz * w + iw * -z + ix * -y - iy * -x;
		};
		const v = [
			0,
			0,
			0
		];
		return this._transformPositions((a, o) => {
			v[0] = a[o];
			v[1] = a[o + 1];
			v[2] = a[o + 2];
			rot(v);
			a[o] = v[0];
			a[o + 1] = v[1];
			a[o + 2] = v[2];
		}, (a, o) => {
			v[0] = a[o];
			v[1] = a[o + 1];
			v[2] = a[o + 2];
			rot(v);
			const l = Math.hypot(v[0], v[1], v[2]) || 1;
			a[o] = v[0] / l;
			a[o + 1] = v[1] / l;
			a[o + 2] = v[2] / l;
		});
	}
	normalizeNormals() {
		const n = this.attributes.normal;
		if (!n) return this;
		const d = attrData(n);
		for (let i = 0; i < d.count; i++) {
			const o = i * d.itemSize;
			const l = Math.hypot(d.array[o], d.array[o + 1], d.array[o + 2]) || 1;
			d.array[o] /= l;
			d.array[o + 1] /= l;
			d.array[o + 2] /= l;
		}
		this.version++;
		return this;
	}
	computeTangents() {
		return this;
	}
	lookAt(vector) {
		const m = new Matrix4().lookAt(new Vector3(), vector, new Vector3(0, 1, 0));
		const q = new Quaternion().setFromRotationMatrix(m);
		return this.applyQuaternion(q);
	}
	toJSON() {
		const data = {
			metadata: {
				version: 4.7,
				type: "BufferGeometry",
				generator: "gs3d"
			},
			uuid: this.uuid,
			type: "BufferGeometry"
		};
		for (const [name, attr] of Object.entries(this.attributes)) {
			const a = attr.array;
			data[name] = {
				itemSize: attr.itemSize,
				type: a.constructor.name,
				array: Array.from(a),
				normalized: attr.normalized
			};
		}
		if (this.index) {
			const a = this.index.array;
			data.index = {
				itemSize: this.index.itemSize,
				type: a.constructor.name,
				array: Array.from(a),
				normalized: this.index.normalized
			};
		}
		data.groups = this.groups;
		data.drawRange = this.drawRange;
		return data;
	}
	copy(source) {
		for (const key of Object.keys(source.attributes)) {
			const attr = source.attributes[key];
			this.setAttribute(key, new BufferAttribute(attr.array.slice(), attr.itemSize, attr.normalized));
		}
		if (source.index) this.index = new BufferAttribute(source.index.array.slice(), source.index.itemSize, source.index.normalized);
		this.groups = source.groups.map((g) => ({ ...g }));
		if (source.boundingBox) this.boundingBox = source.boundingBox.clone();
		if (source.boundingSphere) this.boundingSphere = source.boundingSphere.clone();
		return this;
	}
	setIndex(index) {
		if (index === null || index === void 0) this.index = null;
		else if (index.isBufferAttribute) this.index = index;
		else this.index = new Uint32BufferAttribute(index, 1);
		this.version++;
		return this;
	}
	addGroup(start, count, materialIndex = 0) {
		this.groups.push({
			start,
			count,
			materialIndex
		});
		return this;
	}
	clearGroups() {
		this.groups.length = 0;
		return this;
	}
	_transformPositions(fn, normalFn = null) {
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
			a[o + 1] = c * y - sn * z;
			a[o + 2] = sn * y + c * z;
		}, (a, o, st) => {
			const y = a[o + 1], z = a[o + 2];
			a[o + 1] = c * y - sn * z;
			a[o + 2] = sn * y + c * z;
		});
	}
	rotateY(angle) {
		const c = Math.cos(angle), sn = Math.sin(angle);
		return this._transformPositions((a, o, st) => {
			const x = a[o], z = a[o + 2];
			a[o] = c * x + sn * z;
			a[o + 2] = -sn * x + c * z;
		}, (a, o, st) => {
			const x = a[o], z = a[o + 2];
			a[o] = c * x + sn * z;
			a[o + 2] = -sn * x + c * z;
		});
	}
	rotateZ(angle) {
		const c = Math.cos(angle), sn = Math.sin(angle);
		return this._transformPositions((a, o, st) => {
			const x = a[o], y = a[o + 1];
			a[o] = c * x - sn * y;
			a[o + 1] = sn * x + c * y;
		}, (a, o, st) => {
			const x = a[o], y = a[o + 1];
			a[o] = c * x - sn * y;
			a[o + 1] = sn * x + c * y;
		});
	}
	translate(x, y, z) {
		return this._transformPositions((a, o) => {
			a[o] += x;
			a[o + 1] += y;
			a[o + 2] += z;
		});
	}
	scale(x, y, z) {
		const ix = x ? 1 / x : 0, iy = y ? 1 / y : 0, iz = z ? 1 / z : 0;
		return this._transformPositions((a, o) => {
			a[o] *= x;
			a[o + 1] *= y;
			a[o + 2] *= z;
		}, (a, o) => {
			const nx = a[o] * ix, ny = a[o + 1] * iy, nz = a[o + 2] * iz;
			const l = Math.hypot(nx, ny, nz) || 1;
			a[o] = nx / l;
			a[o + 1] = ny / l;
			a[o + 2] = nz / l;
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
			a[o] = nx / l;
			a[o + 1] = ny / l;
			a[o + 2] = nz / l;
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
			for (const v of [
				a,
				b,
				c
			]) {
				normals[v * 3] += nx;
				normals[v * 3 + 1] += ny;
				normals[v * 3 + 2] += nz;
			}
		};
		if (index) {
			const ids = index.array;
			for (let i = 0; i + 2 < ids.length; i += 3) tri(ids[i], ids[i + 1], ids[i + 2]);
		} else for (let i = 0; i + 2 < pd.count; i += 3) tri(i, i + 1, i + 2);
		for (let i = 0; i < normals.length; i += 3) {
			const l = Math.hypot(normals[i], normals[i + 1], normals[i + 2]);
			if (l > 0) {
				normals[i] /= l;
				normals[i + 1] /= l;
				normals[i + 2] /= l;
			} else {
				normals[i] = 0;
				normals[i + 1] = 0;
				normals[i + 2] = 1;
			}
		}
		this.setAttribute("normal", new Float32BufferAttribute(normals, 3));
		return this;
	}
	computeBoundingBox() {
		const position = this.attributes.position;
		if (!position) {
			this.boundingBox = null;
			return this;
		}
		const pd = attrData(position);
		const p = pd.array, ps = pd.itemSize;
		let minX = 1e400, minY = 1e400, minZ = 1e400;
		let maxX = -1e400, maxY = -1e400, maxZ = -1e400;
		for (let i = 0; i < pd.count; i++) {
			const o = i * ps;
			const x = p[o], y = p[o + 1], z = p[o + 2];
			if (x < minX) minX = x;
			if (x > maxX) maxX = x;
			if (y < minY) minY = y;
			if (y > maxY) maxY = y;
			if (z < minZ) minZ = z;
			if (z > maxZ) maxZ = z;
		}
		if (!this.boundingBox) this.boundingBox = new Box3();
		this.boundingBox.min.set(minX, minY, minZ);
		this.boundingBox.max.set(maxX, maxY, maxZ);
		return this;
	}
	computeBoundingSphere() {
		this.computeBoundingBox();
		if (!this.boundingBox) {
			this.boundingSphere = null;
			return this;
		}
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
};
var Mesh = class extends Object3D {
	constructor(geometry = new BufferGeometry(), material = new MeshBasicMaterial()) {
		super();
		this.isMesh = true;
		this.geometry = geometry;
		this.material = material;
	}
	copy(source, recursive = true) {
		super.copy(source, recursive);
		this.geometry = source.geometry;
		this.material = source.material;
		return this;
	}
	computeBoundingBox() {
		this.geometry.computeBoundingBox();
		return this;
	}
	computeBoundingSphere() {
		this.geometry.computeBoundingSphere();
		return this;
	}
	getVertexPosition(index, target = new Vector3()) {
		const pos = this.geometry.getAttribute("position");
		if (!pos) return target.set(0, 0, 0);
		const o = index * pos.itemSize;
		return target.set(pos.array[o] ?? 0, pos.array[o + 1] ?? 0, pos.array[o + 2] ?? 0);
	}
	updateMorphTargets() {
		return this;
	}
};
var InstancedMesh = class extends Mesh {
	constructor(geometry = new BufferGeometry(), material = new MeshBasicMaterial(), count = 0) {
		super(geometry, material);
		this.isMesh = false;
		this.isInstancedMesh = true;
		this.count = Math.max(0, count | 0);
		this._maxCount = this.count;
		this.instanceMatrix = new BufferAttribute(new Float32Array(this._maxCount * 16), 16);
		this.instanceColor = null;
		this._instances = [];
		this._colorMaterials = /* @__PURE__ */ new Map();
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
	copy(source, recursive = true) {
		super.copy(source, recursive);
		this.count = source.count;
		this.instanceMatrix.array.set(source.instanceMatrix.array.subarray(0, this.count * 16));
		if (source.instanceColor && !this.instanceColor) this.instanceColor = new BufferAttribute(new Float32Array(this._maxCount * 3), 3);
		if (this.instanceColor && source.instanceColor) this.instanceColor.array.set(source.instanceColor.array.subarray(0, this.count * 3));
		return this;
	}
	getMorphAt(index) {
		return null;
	}
	setMorphAt(index, mesh) {
		return this;
	}
};
var Line = class extends Object3D {
	constructor(geometry, material) {
		super();
		this.isLine = true;
		this.geometry = geometry;
		this.material = material;
	}
	copy(source, recursive = true) {
		super.copy(source, recursive);
		this.geometry = source.geometry;
		this.material = source.material;
		return this;
	}
	computeLineDistances() {
		return this;
	}
};
var LineSegments = class extends Line {
	constructor(geometry, material) {
		super(geometry, material);
		this.isLineSegments = true;
	}
};
var LineLoop = class extends Line {
	constructor(geometry, material) {
		super(geometry, material);
		this.isLineLoop = true;
	}
};
var Points = class extends Object3D {
	constructor(geometry, material) {
		super();
		this.isPoints = true;
		this.geometry = geometry;
		this.material = material;
	}
	copy(source, recursive = true) {
		super.copy(source, recursive);
		this.geometry = source.geometry;
		this.material = source.material;
		return this;
	}
};
var Sprite = class extends Object3D {
	constructor(material) {
		super();
		this.isSprite = true;
		this.material = material;
	}
	copy(source, recursive = true) {
		super.copy(source, recursive);
		this.material = source.material;
		return this;
	}
};

// src/three/raw-shader.ts
const rawShaderStates = /* @__PURE__ */ new WeakMap();
const RAW_SHADER_CHUNKS = {
	tonemapping_fragment: "gl_FragColor.rgb = g3_tone_map(gl_FragColor.rgb);",
	colorspace_fragment: "if (u_g3_output_srgb > 0.5) { gl_FragColor.rgb = g3_encode_srgb(gl_FragColor.rgb); }"
};
function resolveRawChunks(source) {
	return String(source || "").replace(/#include\s*<([^>\s]+)>/g, (_match, name) => {
		const chunk = RAW_SHADER_CHUNKS[name];
		if (chunk === void 0) console.warn(`gs3d: unsupported shader chunk #include <${name}> dropped`);
		return chunk ?? "";
	});
}
function rawUploadText(engine, text) {
	const bytes = new TextEncoder().encode(text || "");
	const ptr = engine._malloc(bytes.length);
	engine.HEAPU8.set(bytes, ptr);
	return [ptr, bytes.length];
}
function rawNeedsGlsl3(vs, fs) {
	const re = /(?:^|[^\w.])(texture|textureLod|textureGrad|textureProj|textureSize)\s*\(|#version\s+300|\b(?:in|out)\s+(?:lowp\s+|mediump\s+|highp\s+)?(?:vec[234]|mat[234]|float|int|bool|sampler\w*)\b|gl_FragDepth/;
	return re.test(vs || "") || re.test(fs || "");
}
function shaderDefinesPrefix(defines) {
	if (!defines) return "";
	let out = "";
	for (const key of Object.keys(defines)) {
		const val = defines[key];
		if (val === false || val === void 0 || val === null) continue;
		out += val === true ? `#define ${key}\n` : `#define ${key} ${val}\n`;
	}
	return out;
}
function injectShaderDefines(source, defPrefix) {
	if (!defPrefix) return source;
	const match = /^\s*#version[^\n]*\n/.exec(source);
	if (match) return match[0] + defPrefix + source.slice(match[0].length);
	return defPrefix + source;
}
function ensureRawShader(engine, material) {
	const defPrefix = shaderDefinesPrefix(material.defines);
	const vertex = injectShaderDefines(rewriteRawVertex(material), defPrefix);
	const fragment = injectShaderDefines(resolveRawChunks(material.fragmentShader), defPrefix);
	const sourceKey = vertex + "\n" + fragment;
	let state = rawShaderStates.get(material);
	if (state && state.sourceKey === sourceKey) return state;
	if (state && typeof engine._g3_asset_raw_shader_release === "function") engine._g3_asset_raw_shader_release(state.id);
	if (typeof engine._g3_host_raw_shader_create !== "function") return {
		id: -1,
		sourceKey
	};
	const v = rawUploadText(engine, vertex);
	const f = rawUploadText(engine, fragment);
	const glsl3 = rawNeedsGlsl3(material.vertexShader, material.fragmentShader) ? 1 : 0;
	let id = -1;
	try {
		id = engine._g3_host_raw_shader_create(v[0], v[1], f[0], f[1], glsl3);
	} finally {
		engine._free(v[0]);
		engine._free(f[0]);
	}
	state = {
		id,
		sourceKey,
		uniformSig: null
	};
	rawShaderStates.set(material, state);
	return state;
}
const RAW_UNIFORM_KIND = {
	float: 0,
	vec2: 1,
	vec3: 2,
	vec4: 3,
	mat4: 4,
	int: 5
};
const RAW_VEC4_ATTRS = [
	"_g3_uv01",
	"_g3_uv01",
	"_g3_uv23",
	"_g3_uv23",
	"_g3_uv45",
	"_g3_uv45",
	"_g3_uv67",
	"_g3_uv67"
];
const RAW_GLSL_SIZE = {
	float: 1,
	int: 1,
	vec2: 2,
	vec3: 3,
	vec4: 4
};
const rawRewriteCache = /* @__PURE__ */ new WeakMap();
const vertexAttrCache = /* @__PURE__ */ new WeakMap();
function vertexAttrInfo(material) {
	const source = material.vertexShader;
	const hit = vertexAttrCache.get(material);
	if (hit && hit.source === source) return hit.info;
	const info = [];
	for (const m of resolveRawChunks(source).matchAll(/attribute\s+(float|int|vec2|vec3|vec4)\s+(\w+)\s*;/g)) info.push({
		type: m[1],
		name: m[2]
	});
	vertexAttrCache.set(material, {
		source,
		info
	});
	return info;
}
function rawAttrDecode(name, type, material) {
	const n = RAW_GLSL_SIZE[type] || 2;
	const uvIndex = UV_SLOT_ATTRS.indexOf(name);
	const reg = uvIndex >= 0 ? null : customAttrRegistry.get(name);
	const slots = uvIndex >= 0 ? [uvIndex] : reg?.slots.length ? reg.slots : null;
	const defaults = material.defaultAttributeValues;
	const def = defaults && Array.isArray(defaults[name]) ? defaults[name] : null;
	const capacity = slots ? slots.length * 2 : 0;
	const comps = [];
	for (let f = 0; f < n; f++) {
		let expr = "0.0";
		if (slots && f < capacity) {
			const slot = slots[f >> 1];
			expr = `${RAW_VEC4_ATTRS[slot >> 1]}.${"xyzw"[(slot & 1) * 2 + (f & 1)]}`;
		} else if (!slots && def && f < def.length) expr = String(def[f]);
		comps.push(expr);
	}
	if (type === "float" || type === "int") return `${type}(${comps[0]})`;
	return `${type}(${comps.join(",")})`;
}
function rewriteRawVertex(material) {
	const resolved = resolveRawChunks(material.vertexShader);
	const hit = rawRewriteCache.get(material);
	if (hit && hit.source === material.vertexShader && hit.version === customAttrRegistryVersion) return hit.result;
	const info = vertexAttrInfo(material);
	const byName = new Map(info.map((a) => [a.name, a]));
	const decodes = [];
	let result = resolved.replace(/attribute\s+(float|int|vec2|vec3|vec4)\s+(\w+)\s*;/g, (match, type, name) => {
		if (name === "position" || name === "normal" || name === "uv" || name === "color" || name === "tangent") return "";
		const decl = byName.get(name) || { type };
		decodes.push(`${decl.type} ${name} = ${rawAttrDecode(name, decl.type, material)};`);
		return "";
	});
	if (decodes.length) {
		const mainAt = result.search(/void\s+main\s*\(/);
		if (mainAt >= 0) {
			const brace = result.indexOf("{", mainAt);
			if (brace >= 0) result = result.slice(0, brace + 1) + "\n" + decodes.join("\n") + result.slice(brace + 1);
		}
	}
	rawRewriteCache.set(material, {
		source: material.vertexShader,
		version: customAttrRegistryVersion,
		result
	});
	return result;
}
const RAW_UNIFORM_DECL_KIND = {
	float: 0,
	int: 5,
	bool: 5,
	ivec2: 5,
	ivec3: 5,
	ivec4: 5,
	vec2: 1,
	vec3: 2,
	vec4: 3,
	bvec2: 5,
	bvec3: 5,
	bvec4: 5,
	mat4: 4,
	mat3: 4
};
function shaderUniformDecls(vs, fs) {
	const decls = /* @__PURE__ */ new Map();
	const re = /uniform\s+(\w+)\s+([^;]+);/g;
	for (const src of [vs, fs]) {
		if (!src) continue;
		let m;
		while (m = re.exec(src)) {
			const type = m[1];
			if (type.startsWith("sampler")) continue;
			const kind = RAW_UNIFORM_DECL_KIND[type];
			if (kind === void 0) continue;
			for (const part of m[2].split(",")) {
				const dm = part.trim().match(/^(\w+)\s*(?:\[\s*(\d+)\s*\])?$/);
				if (!dm) continue;
				if (!decls.has(dm[1])) decls.set(dm[1], {
					kind,
					count: dm[2] ? +dm[2] : 1
				});
			}
		}
	}
	return decls;
}
function rawUniformPayload(value) {
	const v = value && value.value !== void 0 ? value.value : value;
	if (v === void 0 || v === null) return null;
	if (typeof v === "number") return {
		kind: RAW_UNIFORM_KIND.float,
		floats: [v]
	};
	if (typeof v === "boolean") return {
		kind: RAW_UNIFORM_KIND.int,
		floats: [v ? 1 : 0]
	};
	if (v.isTexture || v.isDataTexture || v.isData3DTexture) return { texture: v };
	if (v.isMatrix4 || v.elements && v.elements.length === 16) return {
		kind: RAW_UNIFORM_KIND.mat4,
		floats: Array.from(v.elements || v)
	};
	if (v.isColor) return {
		kind: RAW_UNIFORM_KIND.vec3,
		floats: [
			v.r,
			v.g,
			v.b
		]
	};
	if (v.isVector3) return {
		kind: RAW_UNIFORM_KIND.vec3,
		floats: [
			v.x,
			v.y,
			v.z
		]
	};
	if (v.isVector2) return {
		kind: RAW_UNIFORM_KIND.vec2,
		floats: [v.x, v.y]
	};
	if (typeof v.x === "number" && typeof v.y === "number" && typeof v.z === "number" && typeof v.w === "number") return {
		kind: RAW_UNIFORM_KIND.vec4,
		floats: [
			v.x,
			v.y,
			v.z,
			v.w
		]
	};
	if (typeof v.x === "number" && typeof v.y === "number" && typeof v.z === "number") return {
		kind: RAW_UNIFORM_KIND.vec3,
		floats: [
			v.x,
			v.y,
			v.z
		]
	};
	if (typeof v.x === "number" && typeof v.y === "number" && v.z === void 0) return {
		kind: RAW_UNIFORM_KIND.vec2,
		floats: [v.x, v.y]
	};
	if (Array.isArray(v) || ArrayBuffer.isView(v)) {
		const floats = Array.from(v);
		if (floats.every((x) => typeof x === "number")) return {
			kind: RAW_UNIFORM_KIND.float,
			floats
		};
		const dims = floats.map((e) => {
			const p = rawUniformPayload(e);
			return p && !p.texture ? p : null;
		});
		if (dims.length && dims.every((p) => p && p.kind === dims[0].kind && p.floats.length === dims[0].floats.length)) return {
			kind: dims[0].kind,
			floats: dims.flatMap((p) => p.floats)
		};
		return null;
	}
	return null;
}
function rawUniformEntries(engine, material, decls) {
	const entries = [];
	for (const name of Object.keys(material.uniforms || {})) {
		const payload = rawUniformPayload(material.uniforms[name]);
		if (!payload) continue;
		if (payload.texture) {
			const tex = payload.texture;
			const texId = tex.isData3DTexture ? ensureTexture3D(engine, tex) : ensureTexture(engine, tex);
			entries.push({
				name,
				texture: texId
			});
		} else {
			const decl = decls && decls.get(name);
			const kind = decl ? decl.kind : payload.kind;
			entries.push({
				name,
				kind,
				floats: payload.floats
			});
		}
	}
	return entries;
}
function rawUniformSignature(entries) {
	return entries.map((e) => e.texture !== void 0 ? `${e.name}=t${e.texture}` : `${e.name}=${e.kind}:${e.floats.join(",")}`).join("|");
}
function uploadRawUniforms(engine, shaderId, entries) {
	for (const e of entries) {
		const nameBytes = new TextEncoder().encode(e.name);
		const namePtr = engine._malloc(nameBytes.length);
		engine.HEAPU8.set(nameBytes, namePtr);
		try {
			if (e.texture !== void 0) {
				engine._g3_host_raw_shader_uniform_texture(shaderId, namePtr, nameBytes.length, e.texture);
				continue;
			}
			const f32 = new Float32Array(e.floats);
			const dataPtr = engine._malloc(f32.byteLength);
			engine.HEAPU8.set(new Uint8Array(f32.buffer, f32.byteOffset, f32.byteLength), dataPtr);
			try {
				engine._g3_host_raw_shader_uniform(shaderId, namePtr, nameBytes.length, e.kind, dataPtr, f32.length);
			} finally {
				engine._free(dataPtr);
			}
		} finally {
			engine._free(namePtr);
		}
	}
}
function materialAlphaMode(material, opacity) {
	if ((material.blendEquation ?? 100) === 100 && material.blendSrc === 201) {
		if (material.blending === 2 || material.blending === 5 && material.blendDst === 201) return 3;
		if (material.blending === 5 && material.blendDst === 205) return 4;
	}
	if (material.transparent || opacity < 1) return 2;
	if (material.alphaTest > 0) return 1;
	return 0;
}
function ensureRawMaterial(engine, material) {
	const src = ensureRawShader(engine, material);
	if (src.id < 0) return -1;
	if (!material._rawDecls) material._rawDecls = shaderUniformDecls(material.vertexShader, material.fragmentShader);
	const entries = rawUniformEntries(engine, material, material._rawDecls);
	const uniformSig = rawUniformSignature(entries);
	if (src.uniformSig !== uniformSig) {
		uploadRawUniforms(engine, src.id, entries);
		src.uniformSig = uniformSig;
	}
	const opacity = material.opacity ?? 1;
	const alphaMode = materialAlphaMode(material, opacity);
	const signature = `raw|${material.side}|${alphaMode}|${opacity}|${src.id}`;
	const state = materialStates.get(material);
	if (state && state.signature === signature) return state.id;
	if (state) engine._g3_asset_release_material(state.id, state.generation);
	const alpha = material.transparent ? opacity : 1;
	const id = engine._g3_asset_material(1, 1, 1, alpha, -1, alphaMode, 0, 0, 0, -1, -1, 0, -1, 0, 0, 0, 0, -1, material.side !== 0, true, 1.5);
	if (id < 0) return -1;
	engine._g3_asset_material_set_shader(id, src.id);
	const record = {
		id,
		generation: engine._g3_asset_material_generation(id),
		signature
	};
	materialStates.set(material, record);
	return id;
}

// src/three/on-before-compile.ts
const G3CHK = "//__G3CHK_";
const G3_VERT_CHUNKS = [
	"begin_vertex",
	"beginnormal_vertex",
	"project_vertex",
	"worldpos_vertex"
];
const G3_FRAG_CHUNKS = [
	"map_fragment",
	"color_fragment",
	"alphamap_fragment",
	"alphatest_fragment",
	"roughnessmap_fragment",
	"metalnessmap_fragment",
	"normal_fragment_begin",
	"normal_fragment_maps",
	"lights_fragment_begin",
	"lights_physical_fragment",
	"aomap_fragment",
	"emissivemap_fragment",
	"opaque_fragment",
	"tonemapping_fragment",
	"colorspace_fragment",
	"fog_fragment",
	"output_fragment",
	"dithering_fragment"
];
const G3_TAIL_CHUNKS = /* @__PURE__ */ new Set([
	"opaque_fragment",
	"tonemapping_fragment",
	"colorspace_fragment",
	"fog_fragment",
	"output_fragment",
	"dithering_fragment"
]);
const G3_SWZ = "xyzw";
function g3ChunkTemplate(names) {
	return names.map((n) => `${G3CHK}${n}\n#include <${n}>`).join("\n") + "\n";
}
function g3SplitChunks(src) {
	const first = src.indexOf(G3CHK);
	if (first < 0) return {
		prelude: src,
		chunks: []
	};
	const prelude = src.slice(0, first);
	const parts = src.slice(first).split(G3CHK).slice(1);
	const chunks = [];
	for (const part of parts) {
		const nl = part.indexOf("\n");
		const name = nl < 0 ? part.trim() : part.slice(0, nl).trim();
		let body = nl < 0 ? "" : part.slice(nl + 1);
		body = body.split("\n").filter((l) => !/^\s*#include\b/.test(l)).join("\n");
		chunks.push({
			name,
			body
		});
	}
	return {
		prelude,
		chunks
	};
}
function g3UniformSize(type) {
	return {
		float: 1,
		int: 1,
		bool: 1,
		vec2: 2,
		vec3: 3,
		vec4: 4
	}[type] || 0;
}
function g3UniformFloats(value) {
	if (value === void 0 || value === null) return [
		0,
		0,
		0,
		0
	];
	if (typeof value === "number") return [
		value,
		0,
		0,
		0
	];
	if (typeof value === "boolean") return [
		value ? 1 : 0,
		0,
		0,
		0
	];
	if (value.isVector2 || value.isVector3 || value.isVector4) {
		const n = value.isVector2 ? 2 : value.isVector3 ? 3 : 4;
		return [
			value.x,
			value.y,
			value.z ?? 0,
			value.w ?? 0
		].slice(0, n).concat(Array(Math.max(0, 4 - n)).fill(0));
	}
	if (value.isColor) return [
		value.r,
		value.g,
		value.b,
		1
	];
	if (value.isMatrix3 || value.isMatrix4) return [
		0,
		0,
		0,
		0
	];
	return [
		0,
		0,
		0,
		0
	];
}
function g3UniformSlot(slot, comp, n) {
	const sw = (c) => G3_SWZ[c];
	if (n === 4) return `u_user[${slot}]`;
	if (n === 1) return `u_user[${slot}].${sw(comp)}`;
	let out = `u_user[${slot}].`;
	for (let i = 0; i < n; i++) out += sw(comp + i);
	return out;
}
function g3DecodeAttr(name, type) {
	const n = {
		float: 1,
		int: 1,
		bool: 1,
		vec2: 2,
		vec3: 3,
		vec4: 4
	}[type] || 4;
	const reg = customAttrRegistry.get(name);
	if (!reg) return `${type}(0.0)`;
	const count = Math.min(n, reg.itemSize, reg.slots.length * 2);
	const comps = [];
	for (let i = 0; i < count; i++) {
		const slot = reg.slots[i >> 1];
		const v = slot === 0 ? "v_uv" : `v_uv${slot}`;
		comps.push(`${v}.${i & 1 ? "y" : "x"}`);
	}
	while (comps.length < n) comps.push("0.0");
	if (n === 1) return comps[0];
	return `${type}(${comps.join(",")})`;
}
function g3VaryingExpr(rhs, type, assignSwizzle) {
	let base;
	if (rhs === "position") base = "v_obj_pos";
	else if (rhs === "normal") base = "v_obj_normal";
	else if (rhs === "normalMatrix") base = "v_view_normal_matrix";
	else if (rhs === "uv") base = "v_uv";
	else if (/^uv[1-7]$/.test(rhs)) base = `v_uv${rhs.slice(2)}`;
	else if (rhs && customAttrRegistry.has(rhs)) base = g3DecodeAttr(rhs, type);
	else if (rhs === "color") base = type === "float" ? "v_color.r" : type === "vec2" ? "v_color.rg" : type === "vec3" ? "v_color.rgb" : "v_color";
	else base = `${type}(0.0)`;
	if (assignSwizzle && /^[xyzwrgba]{2,4}$/.test(assignSwizzle)) {
		const clean = assignSwizzle.replace(/[^xyzw]/g, "");
		if (clean.length >= 2 && (type === "vec2" || type === "vec3" || type === "vec4")) return `(${base}).${clean.slice(0, {
			vec2: 2,
			vec3: 3,
			vec4: 4
		}[type])}`;
	}
	return base;
}
const G3_BODY_SUBS = [
	[/\breflectedLight\.indirectSpecular\b/g, "g3_indirect_specular"],
	[/\breflectedLight\.directSpecular\b/g, "g3_direct_specular"],
	[/\breflectedLight\.indirectDiffuse\b/g, "ao"],
	[/\breflectedLight\.directDiffuse\b/g, "g3_direct_diffuse"],
	[/\breflectedLight\.total\b/g, "g3_reflected_total"],
	[/\bclearcoatSpecularIndirect\b/g, "g3_clearcoat_spec_indirect"],
	[/\bgl_FragColor\.rgb\b/g, "col"],
	[/\bgl_FragColor\.a\b/g, "alpha"],
	[/\bgl_FragColor\b/g, "vec4(col,alpha)"]
];
function g3TranslateBody(src) {
	let out = src;
	for (const [re, rep] of G3_BODY_SUBS) out = out.replace(re, rep);
	return out;
}
const G3_MATERIAL_STRUCT = `
struct G3Material {
  float clearcoat; float clearcoatRoughness;
  vec3 specularColor; vec3 specularF90;
  vec3 sheenColor; float sheenRoughness;
  float roughness; float metalness;
  vec3 color; vec3 specular; vec3 emissive;
  float ior; float opacity; float alpha; vec3 diffuse;
  float reflectivity; float sheen; float envMapIntensity;
};
struct G3ReflectedLight {
  vec3 indirectDiffuse; vec3 indirectSpecular;
  vec3 directDiffuse; vec3 directSpecular; vec3 total;
};`;
function ensureObcMaterial(engine, material) {
	if (!material || typeof material.onBeforeCompile !== "function") return;
	if (material.onBeforeCompile._gs3dDefault) return;
	if (typeof engine._g3_host_material_shader_create !== "function") return;
	const fake = {
		uniforms: {},
		vertexShader: g3ChunkTemplate(G3_VERT_CHUNKS),
		fragmentShader: g3ChunkTemplate(G3_FRAG_CHUNKS)
	};
	material.onBeforeCompile(fake);
	const uniformKey = Object.keys(fake.uniforms).sort().join("|") + "#" + customAttrRegistryVersion;
	let plan = material._obcPlan;
	if (!plan || plan.uniformKey !== uniformKey) {
		plan = g3BuildObcPlan(material, fake, uniformKey);
		material._obcPlan = plan;
		for (const t of plan.textureAssigns) {
			if (t.kind === "sampler2D") {
				if (material.emissiveMap && material.emissiveMap !== t.texture) console.warn("gs3d: onBeforeCompile sampler2D uniform", t.name, "shares the emissiveMap slot; additional samplers are unsupported");
				else material.emissiveMap = t.texture;
			}
			if (t.kind === "sampler3D") material.lutTexture = t.texture;
		}
	}
	material.customShader = plan.shader;
	material.customUniforms = void 0;
}
function g3BuildObcPlan(material, fake, uniformKey) {
	const vsrc = g3SplitChunks(String(fake.vertexShader || ""));
	const fsrc = g3SplitChunks(String(fake.fragmentShader || ""));
	const vDecls = /* @__PURE__ */ new Map();
	for (const m of vsrc.prelude.matchAll(/varying\s+(?:lowp\s+|mediump\s+|highp\s+)?(\w+)\s+(\w+)\s*;/g)) vDecls.set(m[2], m[1]);
	const assignMap = /* @__PURE__ */ new Map();
	for (const ch of vsrc.chunks) {
		if (ch.name !== "begin_vertex") continue;
		for (const m of ch.body.matchAll(/([A-Za-z_]\w*)\s*=\s*([A-Za-z_]\w*)((?:\.[xyzwrgba]+)?)\s*;/g)) assignMap.set(m[1], {
			rhs: m[2],
			swizzle: m[3] ? m[3].slice(1) : ""
		});
	}
	const fVaryings = /* @__PURE__ */ new Map();
	const uniforms = [];
	let headerCode = "";
	{
		let rest = fsrc.prelude;
		rest = rest.replace(/varying\s+(?:lowp\s+|mediump\s+|highp\s+)?(\w+)\s+(\w+)\s*;/g, (_m, type, name) => {
			fVaryings.set(name, type);
			return "";
		});
		rest = rest.replace(/uniform\s+(?:lowp\s+|mediump\s+|highp\s+)?(\w+)\s+(\w+)\s*;/g, (_m, type, name) => {
			uniforms.push({
				name,
				type
			});
			return "";
		});
		headerCode = rest;
	}
	const defines = [
		"#define texture2D texture",
		"#define saturate(x) clamp((x), 0.0, 1.0)",
		"#define USE_SHEEN 1",
		"#define USE_CLEARCOAT 1",
		"#define USE_ENVMAP 1",
		"#define viewMatrix u_view",
		"#define cameraPosition u_eye"
	];
	const uniformPlan = [];
	const textureAssigns = [];
	const uniformKeyParts = [];
	let slot = 0, comp = 0;
	let sampler2DUsed = false;
	for (const u of uniforms) {
		const value = fake.uniforms[u.name];
		uniformKeyParts.push(u.name + ":" + u.type);
		if (u.type === "sampler2D" || u.type === "sampler3D" || u.type === "samplerCube" || u.type === "sampler2DShadow") {
			const tex = value && value.value;
			if (u.type === "sampler3D" && tex && tex.isData3DTexture) {
				defines.push(`#define ${u.name} u_lut`);
				textureAssigns.push({
					kind: "sampler3D",
					name: u.name,
					texture: tex
				});
			} else if (u.type === "sampler2D" && tex && !sampler2DUsed) {
				sampler2DUsed = true;
				defines.push(`#define ${u.name} u_emissive_tex`);
				textureAssigns.push({
					kind: "sampler2D",
					name: u.name,
					texture: tex
				});
			} else defines.push(`#define ${u.name} u_emissive_tex`);
			continue;
		}
		const n = g3UniformSize(u.type);
		if (!n) continue;
		if (comp + n > 4) {
			slot++;
			comp = 0;
		}
		if (slot >= 8) continue;
		const expr = g3UniformSlot(slot, comp, n);
		defines.push(`#define ${u.name} ${u.type === "int" || u.type === "bool" ? `${u.type}(${expr})` : expr}`);
		uniformPlan.push({
			name: u.name,
			type: u.type,
			slot,
			comp,
			n,
			src: value
		});
		comp += n;
		if (comp === 4) {
			slot++;
			comp = 0;
		}
	}
	for (const [name, type] of fVaryings) {
		const vtype = vDecls.get(name) || type;
		const assign = assignMap.get(name);
		let expr;
		if (name === "vColor") expr = type === "vec4" ? "v_color" : type === "vec3" ? "v_color.rgb" : type === "vec2" ? "v_color.rg" : "v_color.r";
		else if (name === "vUv" || name === "vUV") expr = type === "vec3" ? "vec3(v_uv,0.0)" : "v_uv";
		else expr = g3VaryingExpr(assign ? assign.rhs : null, vtype || type, assign && assign.swizzle);
		defines.push(`#define ${name} ${expr}`);
	}
	const bodyParts = [], tailParts = [];
	for (const ch of fsrc.chunks) {
		if (ch.name === "lights_physical_fragment") bodyParts.push("material.roughness = roughnessFactor; material.metalness = metalnessFactor;");
		if (!ch.body.trim()) continue;
		(G3_TAIL_CHUNKS.has(ch.name) ? tailParts : bodyParts).push(g3TranslateBody(ch.body));
	}
	return {
		shader: {
			header: defines.join("\n") + "\n" + G3_MATERIAL_STRUCT + "\nfloat computeSpecularOcclusion(float dotNV, float occlusion, float roughness) { return occlusion; }\n" + headerCode,
			body: `
    vec3 vViewPosition = -(u_view * vec4(v_world, 1.0)).xyz;
    vec3 geometryViewDir = normalize(vViewPosition);
    vec3 geometryPosition = vViewPosition;
    vec3 geometryNormal = mat3(u_view) * n;
    vec3 normal = mat3(u_view) * n;
    vec4 diffuseColor = vec4(base, 1.0);
    float roughnessFactor = mr.y;
    float metalnessFactor = mr.x;
    vec3 totalEmissiveRadiance = g3_emissive_extra;
    G3Material material = G3Material(
      coat_factor, coat_roughness, specular_color, f0, sheen_color, sheen_roughness,
      mr.y, mr.x, vec3(base), specular_color, u_emissive.rgb, u_pbr.w, alpha, alpha, base, 0.0, 0.0, 1.0);
    float g3_indirect_specular = 1.0;
    float g3_direct_specular = 1.0;
    float g3_direct_diffuse = 1.0;
    float g3_reflected_total = 1.0;
    float g3_clearcoat_spec_indirect = 1.0;
` + bodyParts.join("\n") + `
    n = transpose(mat3(u_view)) * normal;
    base = diffuseColor.rgb;
    coat_factor = material.clearcoat; coat_roughness = material.clearcoatRoughness;
    specular_color = material.specularColor; f0 = material.specularF90;
    sheen_color = material.sheenColor; sheen_roughness = material.sheenRoughness;
    mr.y = material.roughness; mr.x = material.metalness;
    g3_emissive_extra = totalEmissiveRadiance;
`,
			tail: tailParts.join("\n")
		},
		uniformPlan,
		textureAssigns,
		uniformKey
	};
}
function syncObcUniforms(engine, material, id) {
	const plan = material && material._obcPlan;
	if (!plan || !plan.uniformPlan.length) return;
	if (!plan.last) plan.last = (/* @__PURE__ */ new Float32Array(32)).fill(NaN);
	const next = plan.next || (plan.next = /* @__PURE__ */ new Float32Array(32));
	next.fill(0);
	for (const u of plan.uniformPlan) {
		const f = g3UniformFloats(u.src && u.src.value);
		const base = u.slot * 4 + u.comp;
		for (let i = 0; i < u.n; i++) next[base + i] = f[i];
	}
	for (let i = 0; i < 8; i++) {
		const o = i * 4;
		if (next[o] === plan.last[o] && next[o + 1] === plan.last[o + 1] && next[o + 2] === plan.last[o + 2] && next[o + 3] === plan.last[o + 3]) continue;
		engine._g3_asset_material_user(id, i, next[o], next[o + 1], next[o + 2], next[o + 3]);
		plan.last[o] = next[o];
		plan.last[o + 1] = next[o + 1];
		plan.last[o + 2] = next[o + 2];
		plan.last[o + 3] = next[o + 3];
	}
}
function ensureMaterial(engine, material) {
	if (material && (material.isShaderMaterial || material.isRawShaderMaterial)) {
		const id = ensureRawMaterial(engine, material);
		if (frameMaterialCache) frameMaterialCache.set(material, id);
		return id;
	}
	if (!material) {
		if (!fallbackMaterial) setFallbackMaterial(new MeshBasicMaterial());
		material = fallbackMaterial;
	}
	if (frameMaterialCache) {
		const hit = frameMaterialCache.get(material);
		if (hit !== void 0) {
			syncObcUniforms(engine, material, hit);
			return hit;
		}
	}
	if (material && typeof material.onBeforeCompile === "function" && !material.onBeforeCompile._gs3dDefault) ensureObcMaterial(engine, material);
	const maps = materialMaps(material);
	const textureIds = maps.map((t) => t ? ensureTexture(engine, t) : -1);
	const lutTextureId = material.lutTexture ? ensureTexture3D(engine, material.lutTexture) : -1;
	const signature = materialSignature(material) + "|tex:" + textureIds.join(",") + "|lut:" + lutTextureId + "|" + maps.map((t) => t ? textureUvSignature(t) : "-").join(";");
	const state = materialStates.get(material);
	if (state && state.signature === signature) {
		syncObcUniforms(engine, material, state.id);
		if (frameMaterialCache) frameMaterialCache.set(material, state.id);
		return state.id;
	}
	if (state) engine._g3_asset_release_material(state.id, state.generation);
	const color = material.color || new Color(0xffffff);
	const opacity = material.opacity ?? 1;
	const alphaMode = materialAlphaMode(material, opacity);
	const alphaCutoff = material.alphaTest > 0 ? material.alphaTest : .5;
	const unlit = material.isMeshBasicMaterial || material.isMeshNormalMaterial ? 1 : 0;
	const metallic = material.metalness ?? (unlit ? 0 : 0);
	const roughness = material.roughness ?? 1;
	const emissive = material.emissive || new Color(0);
	const emissiveStrength = material.emissiveIntensity ?? 1;
	const normalScale = material.normalScale;
	const normalScaleValue = normalScale instanceof Vector2 ? normalScale.x : normalScale ?? 1;
	const id = engine._g3_asset_material(color.r, color.g, color.b, opacity, textureIds[0], alphaMode, alphaCutoff, metallic, roughness, textureIds[1], textureIds[2], normalScaleValue, textureIds[3], material.aoMapIntensity ?? 1, emissive.r * emissiveStrength, emissive.g * emissiveStrength, emissive.b * emissiveStrength, textureIds[4], material.side === 2 ? 1 : 0, unlit, material.ior ?? 1.5);
	for (let slot = 0; slot < maps.length; slot++) {
		const texture = maps[slot];
		if (texture && textureIds[slot] >= 0) engine._g3_asset_material_uv_transform(id, slot, texture.offset.x, texture.offset.y, texture.repeat.x, texture.repeat.y, texture.rotation, texture.channel || 0);
	}
	if (!unlit && typeof engine._g3_asset_material_environment === "function") engine._g3_asset_material_environment(id, material.envMapIntensity ?? 1);
	if (!unlit) engine._g3_asset_material_specular(id, .04, 1, 1, 1, -1, -1);
	const customShader = material.customShader;
	if (customShader && typeof engine._g3_host_material_shader_create === "function") {
		let shaderId = customShaderIds.get(customShader);
		if (shaderId === void 0) {
			const upload = (text) => {
				const bytes = new TextEncoder().encode(text || "");
				const ptr = engine._malloc(bytes.length);
				engine.HEAPU8.set(bytes, ptr);
				return [ptr, bytes.length];
			};
			const header = upload(customShader.header);
			const body = upload(customShader.body);
			const tail = upload(customShader.tail);
			try {
				shaderId = engine._g3_host_material_shader_create(header[0], header[1], body[0], body[1], tail[0], tail[1]);
			} finally {
				engine._free(header[0]);
				engine._free(body[0]);
				engine._free(tail[0]);
			}
			customShaderIds.set(customShader, shaderId);
		}
		if (shaderId >= 0) engine._g3_asset_material_set_shader(id, shaderId);
	}
	if (lutTextureId >= 0 && typeof engine._g3_asset_material_lut === "function") engine._g3_asset_material_lut(id, lutTextureId);
	const customUniforms = material.customUniforms;
	if (customUniforms && typeof engine._g3_asset_material_user === "function") for (let i = 0; i < 8; i++) engine._g3_asset_material_user(id, i, customUniforms[i * 4] ?? 0, customUniforms[i * 4 + 1] ?? 0, customUniforms[i * 4 + 2] ?? 0, customUniforms[i * 4 + 3] ?? 0);
	syncObcUniforms(engine, material, id);
	const record = {
		id,
		generation: engine._g3_asset_material_generation(id),
		signature
	};
	materialStates.set(material, record);
	if (frameMaterialCache) frameMaterialCache.set(material, id);
	return id;
}

// src/three/sync.ts
const DEG2RAD = Math.PI / 180;
const MAX_EXTRA_LIGHTS = 8;
function syncNode(engine, object, parentEngineIndex, local, draw = true) {
	const isMesh = draw && object.isMesh === true;
	const material = isMesh ? Array.isArray(object.material) ? object.material[0] : object.material : null;
	const meshId = isMesh ? ensureGeometry(engine, object.geometry, !!(material && material.vertexColors), !!(material && material.flatShading), material) : -1;
	let record = nodeStates.get(object);
	if (record && (record.parent !== parentEngineIndex || record.mesh !== meshId)) {
		releaseNodeRecord(record);
		nodeStates.delete(object);
		record = void 0;
	}
	if (!record) {
		const index = engine._g3_asset_node(meshId, parentEngineIndex);
		record = {
			index,
			generation: engine._g3_asset_node_generation(index),
			epoch: engine._g3_asset_scene_epoch(),
			parent: parentEngineIndex,
			mesh: meshId,
			material: -1,
			matrix: null
		};
		nodeStates.set(object, record);
	}
	if (isMesh) {
		const materialId = ensureMaterial(engine, material);
		if (record.material !== materialId) {
			engine._g3_asset_node_material(record.index, materialId);
			record.material = materialId;
		}
	}
	if (!record.matrix || !matricesEqual(record.matrix, local)) {
		if (typeof engine._g3_asset_matrix16 === "function") engine._g3_asset_matrix16(record.index, local[0], local[1], local[2], local[3], local[4], local[5], local[6], local[7], local[8], local[9], local[10], local[11], local[12], local[13], local[14], local[15]);
		else for (let i = 0; i < 16; i++) engine._g3_asset_matrix(record.index, i, local[i]);
		if (!record.matrix) record.matrix = Float64Array.from(local);
		else record.matrix.set(local);
	}
	return record.index;
}
function matricesEqual(a, b) {
	for (let i = 0; i < 16; i++) if (a[i] !== b[i]) return false;
	return true;
}
function lightWorldPose(object) {
	const world = worldMatrixOf(object);
	return {
		world,
		position: transformPoint(world, 0, 0, 0)
	};
}
function targetWorldPosition(light) {
	const target = light.target;
	if (!target) return [
		0,
		0,
		0
	];
	return transformPoint(worldMatrixOf(target), 0, 0, 0);
}
function collectLights(scene, camera) {
	const result = {
		ambient: [
			0,
			0,
			0
		],
		hemisphere: null,
		lights: []
	};
	const walk = (object, visible) => {
		const effective = visible && object.visible !== false;
		if (!effective) return;
		if (object.isLight && object.layers.test(camera.layers)) {
			const intensity = object.intensity ?? 1;
			const color = object.color || new Color(0xffffff);
			const scaled = [
				color.r * intensity,
				color.g * intensity,
				color.b * intensity
			];
			if (object.isAmbientLight) {
				result.ambient[0] += scaled[0];
				result.ambient[1] += scaled[1];
				result.ambient[2] += scaled[2];
			} else if (object.isHemisphereLight) result.hemisphere = {
				sky: [
					color.r,
					color.g,
					color.b
				],
				ground: [
					object.groundColor.r,
					object.groundColor.g,
					object.groundColor.b
				],
				intensity
			};
			else if (result.lights.length < MAX_EXTRA_LIGHTS) {
				const { position } = lightWorldPose(object);
				if (object.isDirectionalLight) {
					const target = targetWorldPosition(object);
					const delta = [
						target[0] - position[0],
						target[1] - position[1],
						target[2] - position[2]
					];
					result.lights.push({
						kind: "directional",
						direction: normalize3(delta),
						color: scaled,
						source: object,
						position,
						target
					});
				} else if (object.isPointLight) result.lights.push({
					kind: "point",
					position,
					color: scaled,
					range: object.distance || 0
				});
				else if (object.isSpotLight) {
					const target = targetWorldPosition(object);
					const delta = [
						target[0] - position[0],
						target[1] - position[1],
						target[2] - position[2]
					];
					result.lights.push({
						kind: "spot",
						position,
						direction: normalize3(delta),
						color: scaled,
						range: object.distance || 0,
						inner: Math.max(1e-4, object.angle * (1 - (object.penumbra ?? 0))),
						outer: object.angle
					});
				}
			}
		}
		for (const child of object.children) walk(child, effective);
	};
	walk(scene, true);
	return result;
}
function shadowMapResolution(size) {
	const s = Math.max(size || 0, 0);
	return s >= 1024 ? 1024 : s >= 512 ? 512 : 256;
}
function shadowFilterRadius(type) {
	if (type === 0) return 0;
	if (type === 2 || type === 3) return 2;
	return 1;
}
function syncKeyLight(engine, light, renderer) {
	if (typeof engine._g3_asset_light_key !== "function") return;
	if (!light) {
		engine._g3_asset_light_key(-.45, -.8, -.4, 1, .96, .88);
		engine._g3_asset_light_key_shadow_clear();
		return;
	}
	engine._g3_asset_light_key(light.direction[0], light.direction[1], light.direction[2], light.color[0], light.color[1], light.color[2]);
	const shadow = light.source.shadow || {};
	const camera = shadow.camera || {};
	const halfWidth = Math.max(0, ((camera.right ?? 5) - (camera.left ?? -5)) / 2);
	const halfHeight = Math.max(0, ((camera.top ?? 5) - (camera.bottom ?? -5)) / 2);
	const distance = Math.hypot(light.position[0] - light.target[0], light.position[1] - light.target[1], light.position[2] - light.target[2]);
	const extent = Math.max(halfWidth, halfHeight, distance / 2 + 1);
	const bias = Math.max(0, shadow.bias ?? 0) + Math.max(0, shadow.normalBias ?? 0) / (extent * 4);
	engine._g3_asset_light_key_shadow(light.target[0], light.target[1], light.target[2], extent, bias);
	if (typeof engine._g3_asset_shadow_resolution === "function") {
		const size = Math.max(shadow.mapSize?.x ?? 512, shadow.mapSize?.y ?? 512);
		engine._g3_asset_shadow_resolution(shadowMapResolution(size));
	}
	if (typeof engine._g3_asset_shadow_filter_radius === "function") engine._g3_asset_shadow_filter_radius(shadowFilterRadius(renderer?.shadowMap?.type));
}
function syncLights(engine, collected, renderer) {
	engine._g3_asset_lights_clear();
	const shadowsOn = !!(renderer && renderer.shadowMap && renderer.shadowMap.enabled);
	let keyLight = null;
	for (const light of collected.lights) {
		if (light.kind === "directional" && shadowsOn && !keyLight && light.source && light.source.castShadow) {
			keyLight = light;
			continue;
		}
		if (light.kind === "directional") engine._g3_asset_light_directional(...light.direction, ...light.color);
		else if (light.kind === "point") engine._g3_asset_light_point(...light.position, ...light.color, light.range);
		else engine._g3_asset_light_spot(...light.position, ...light.direction, ...light.color, light.range, light.inner, light.outer);
	}
	engine._g3_asset_ambient(collected.ambient[0], collected.ambient[1], collected.ambient[2], 1);
	if (collected.hemisphere) {
		const h = collected.hemisphere;
		engine._g3_asset_environment_lighting(h.sky[0], h.sky[1], h.sky[2], h.ground[0], h.ground[1], h.ground[2], h.intensity);
	} else engine._g3_asset_environment_lighting(0, 0, 0, 0, 0, 0, 0);
	syncKeyLight(engine, keyLight, renderer);
}
function syncBackground(engine, scene, renderer) {
	const background = scene.background;
	if (background && background.isColor) engine._g3_asset_background(background.r, background.g, background.b, 1);
	else if (renderer._clearColor) engine._g3_asset_background(renderer._clearColor.r, renderer._clearColor.g, renderer._clearColor.b, renderer._clearAlpha ?? 1);
	else engine._g3_asset_background(0, 0, 0, 1);
}
function syncFog(engine, scene) {
	const fog = scene.fog;
	if (fog && fog.isFogExp2) engine._g3_asset_fog(fog.color.r, fog.color.g, fog.color.b, fog.density);
	else if (fog && fog.isFog) {
		const density = fog.far > fog.near ? 2.5 / (fog.far - fog.near) : 0;
		engine._g3_asset_fog(fog.color.r, fog.color.g, fog.color.b, density);
	} else engine._g3_asset_fog(0, 0, 0, 0);
}
function syncEnvironment(engine, scene) {
	const env = scene.environment;
	if (env && env.isTexture) {
		const id = ensureTexture(engine, env);
		if (id >= 0) engine._g3_asset_environment_map(id, scene.environmentIntensity ?? 1);
	} else engine._g3_asset_environment_map(-1, 0);
	if (typeof engine._g3_asset_environment_rotation === "function") engine._g3_asset_environment_rotation(scene.environmentRotation ?? 0);
}
function syncCamera(engine, renderer, camera) {
	if (!camera || !camera.isCamera) return;
	const world = worldMatrixOf(camera);
	const position = transformPoint(world, 0, 0, 0);
	const forward = normalize3(transformDir(world, 0, 0, -1));
	const up = normalize3(transformDir(world, 0, 1, 0));
	const target = [
		position[0] + forward[0],
		position[1] + forward[1],
		position[2] + forward[2]
	];
	const aspect = camera.aspect > 0 ? camera.aspect : renderer._cssWidth / Math.max(1, renderer._cssHeight);
	const isPlainCam = !camera.isPerspectiveCamera && !camera.isOrthographicCamera;
	const orthographic = camera.isOrthographicCamera || isPlainCam ? 1 : 0;
	const fov = camera.isPerspectiveCamera ? camera.fov * DEG2RAD : .9;
	const orthoHeight = camera.isOrthographicCamera ? camera.top - camera.bottom : isPlainCam ? 2e3 : 0;
	const near = isPlainCam ? -1e3 : Number.isFinite(camera.near) ? camera.near : .1;
	const far = isPlainCam ? 1e3 : Number.isFinite(camera.far) ? camera.far : 2e3;
	let state = cameraStates.get(camera);
	if (!state) {
		const id = engine._g3_asset_camera_add(position[0], position[1], position[2], target[0], target[1], target[2], up[0], up[1], up[2], fov, aspect, orthographic, orthoHeight, near, far);
		if (id < 0) return;
		state = {
			id,
			viewKey: ""
		};
		cameraStates.set(camera, state);
	}
	engine._g3_asset_camera_update(state.id, position[0], position[1], position[2], target[0], target[1], target[2], up[0], up[1], up[2], fov, aspect, orthographic, orthoHeight, near, far);
	if (renderer._selectedCameraId !== state.id) {
		engine._g3_asset_camera_select(state.id);
		renderer._selectedCameraId = state.id;
	}
	const vo = camera.view;
	const voKey = vo && vo.enabled ? [
		vo.fullWidth,
		vo.fullHeight,
		vo.offsetX,
		vo.offsetY,
		vo.width,
		vo.height
	].join(",") : "";
	if (state.viewKey !== voKey && typeof engine._g3_asset_camera_view_offset === "function") {
		if (voKey) engine._g3_asset_camera_view_offset(state.id, vo.fullWidth, vo.fullHeight, vo.offsetX, vo.offsetY, vo.width, vo.height);
		else engine._g3_asset_camera_view_offset(state.id, 0, 0, 0, 0, 0, 0);
		state.viewKey = voKey;
	}
}
function tintedInstanceMaterial(instanced, proxy, colArr, index) {
	const o = index * 3;
	const r = colArr[o], g = colArr[o + 1], b = colArr[o + 2];
	if (proxy._tintedMat && proxy._cr === r && proxy._cg === g && proxy._cb === b) return proxy._tintedMat;
	const key = `${r.toFixed(4)},${g.toFixed(4)},${b.toFixed(4)}`;
	let tinted = instanced._colorMaterials.get(key);
	if (!tinted) {
		const baseMat = instanced.material;
		tinted = Object.assign(Object.create(Object.getPrototypeOf(baseMat)), baseMat);
		const base = baseMat.color || new Color(1, 1, 1);
		tinted.color = new Color(base.r * r, base.g * g, base.b * b);
		instanced._colorMaterials.set(key, tinted);
	}
	proxy._cr = r;
	proxy._cg = g;
	proxy._cb = b;
	proxy._tintedMat = tinted;
	return tinted;
}
function syncInstancedMesh(instanced, engineParent, seen) {
	const count = Math.min(instanced.count, instanced._maxCount);
	const arr = instanced.instanceMatrix.array;
	const colArr = instanced.instanceColor ? instanced.instanceColor.array : null;
	if (instanced._tintedSourceMaterial !== instanced.material) {
		instanced._colorMaterials.clear();
		instanced._tintedSourceMaterial = instanced.material;
		for (const p of instanced._instances) if (p) p._tintedMat = null;
	}
	for (let i = 0; i < count; i++) {
		let proxy = instanced._instances[i];
		if (!proxy) {
			proxy = new Mesh(instanced.geometry, instanced.material);
			instanced._instances[i] = proxy;
		}
		proxy.geometry = instanced.geometry;
		proxy.castShadow = instanced.castShadow;
		proxy.receiveShadow = instanced.receiveShadow;
		proxy.material = colArr && instanced.material ? tintedInstanceMaterial(instanced, proxy, colArr, i) : instanced.material;
		syncNode(sharedEngine, proxy, engineParent, arr.subarray(i * 16, i * 16 + 16));
		seen.add(proxy);
	}
}
function syncSceneTree(scene, seen, camera) {
	scene.updateMatrixWorld();
	const walk = (object, parentEngineIndex) => {
		if (object.visible === false) {
			releaseEngineTree(object);
			return;
		}
		let engineParent = parentEngineIndex;
		if (!object.isLight && !object.isCamera) {
			const matchesLayer = object.layers.test(camera.layers);
			engineParent = syncNode(sharedEngine, object, parentEngineIndex, localMatrixOf(object), matchesLayer);
			seen.add(object);
			if (object.isInstancedMesh && matchesLayer) syncInstancedMesh(object, engineParent, seen);
		}
		for (const child of object.children) walk(child, engineParent);
	};
	walk(scene, -1);
}

// src/three/renderer.ts
let engineCanvasSeq = 0;
const wasmUrl = new URL("./gs3d/app.wasm", import.meta.url);
function requestFrame(callback) {
	if (typeof requestAnimationFrame === "function") return requestAnimationFrame(callback);
	return setTimeout(() => callback(performance.now()), 16);
}
function cancelFrame(handle) {
	if (typeof cancelAnimationFrame === "function") cancelAnimationFrame(handle);
	else clearTimeout(handle);
}
const NoColorSpace = "none";
const SRGBColorSpace = "srgb";
const LinearSRGBColorSpace = "linear";
const DisplayP3ColorSpace = "display-p3";
const NoToneMapping = 0;
const LinearToneMapping = 1;
const ReinhardToneMapping = 2;
const CineonToneMapping = 3;
const ACESFilmicToneMapping = 4;
const CustomToneMapping = 5;
const AgXToneMapping = 6;
const NeutralToneMapping = 7;
const BasicShadowMap = 0;
const PCFShadowMap = 1;
const PCFSoftShadowMap = 2;
const VSMShadowMap = 3;
const TONE_MODES = {
	0: 0,
	1: 0,
	2: 1,
	3: 1,
	4: 2
};
var WebGPURenderer = class {
	get outputColorSpace() {
		return this._outputColorSpace;
	}
	set outputColorSpace(v) {
		this._outputColorSpace = v;
	}
	get coordinateSystem() {
		return this._coordinateSystem ?? 2e3;
	}
	set coordinateSystem(v) {
		this._coordinateSystem = v;
	}
	constructor(parameters = {}) {
		const canvas = parameters.canvas;
		if (!canvas || typeof canvas.getContext !== "function") throw new Error("gs3d: WebGPURenderer requires a canvas element");
		this.domElement = canvas;
		this.isWebGPURenderer = true;
		this._enginePromise = null;
		this._engine = null;
		this._lightLease = -1;
		this._pixelRatio = 1;
		this._cssWidth = 0;
		this._cssHeight = 0;
		this._lastFrame = 0;
		this._animationLoop = null;
		this._raf = 0;
		this._disposed = false;
		this.backend = {
			isWebGPUBackend: false,
			isWebGLBackend: true
		};
		this._outputColorSpace = parameters.outputColorSpace ?? "srgb";
		this.toneMapping = parameters.toneMapping ?? 0;
		this.toneMappingExposure = parameters.toneMappingExposure ?? 1;
		this._engineOverride = parameters.engine ?? null;
		this.shadowMap = {
			enabled: false,
			type: 1,
			autoUpdate: true,
			needsUpdate: true
		};
		this._captureTarget = -1;
		this.capabilities = {
			maxTextureSize: 8192,
			getMaxAnisotropy: () => 16
		};
		this.autoClear = true;
		this.info = {
			autoReset: true,
			render: {
				calls: 0,
				triangles: 0,
				frame: 0
			},
			memory: {
				geometries: 0,
				textures: 0
			},
			reset() {
				this.render.calls = 0;
				this.render.triangles = 0;
			}
		};
		this.debug = {
			checkShaderErrors: true,
			onShaderError: null
		};
		const propMap = /* @__PURE__ */ new WeakMap();
		this.properties = { get(obj) {
			let p = propMap.get(obj);
			if (!p) {
				p = {};
				propMap.set(obj, p);
			}
			return p;
		} };
		this._viewport = new Vector4(0, 0, this._cssWidth, this._cssHeight);
		this._scissor = new Vector4(0, 0, this._cssWidth, this._cssHeight);
		this._scissorTest = false;
		this.setPixelRatio(parameters.pixelRatio ?? (typeof devicePixelRatio !== "undefined" ? devicePixelRatio : 1));
		this._measure();
	}
	_measure() {
		const canvas = this.domElement;
		const rect = canvas.getBoundingClientRect ? canvas.getBoundingClientRect() : null;
		this._cssWidth = rect && rect.width > 0 ? rect.width : canvas.clientWidth || canvas.width || 300;
		this._cssHeight = rect && rect.height > 0 ? rect.height : canvas.clientHeight || canvas.height || 150;
	}
	setPixelRatio(value) {
		this._pixelRatio = Number.isFinite(value) && value > 0 ? value : 1;
		return this;
	}
	getPixelRatio() {
		return this._pixelRatio;
	}
	setSize(width, height, updateStyle = true) {
		this._cssWidth = width;
		this._cssHeight = height;
		const pw = Math.max(1, Math.round(width * this._pixelRatio));
		const ph = Math.max(1, Math.round(height * this._pixelRatio));
		this.domElement.width = pw;
		this.domElement.height = ph;
		if (updateStyle) {
			this.domElement.style.width = `${width}px`;
			this.domElement.style.height = `${height}px`;
		}
		if (this._engine) this._engine._g3_input_resize(pw, ph);
		return this;
	}
	getSize(target = new Vector2()) {
		target.set(this._cssWidth, this._cssHeight);
		return target;
	}
	setOutputColorSpace(space) {
		this.outputColorSpace = space;
		this._applyOutputSettings();
		return this;
	}
	setToneMapping(mode) {
		this.toneMapping = mode;
		this._applyOutputSettings();
		return this;
	}
	setClearColor(color, alpha = 1) {
		this._clearColor = color instanceof Color ? color : new Color(color);
		this._clearAlpha = alpha;
		return this;
	}
	clear(_color = true, _depth = true, _stencil = true) {
		return this;
	}
	getContext() {
		try {
			return this.domElement.getContext("webgl2") || this.domElement.getContext("experimental-webgl2") || null;
		} catch {
			return null;
		}
	}
	setViewport(x, y, width, height) {
		this._viewport.set(x, y, width, height);
		return this;
	}
	setScissor(x, y, width, height) {
		this._scissor.set(x, y, width, height);
		return this;
	}
	setScissorTest(enable) {
		this._scissorTest = !!enable;
		return this;
	}
	compile(_scene, _camera) {
		return /* @__PURE__ */ new Set();
	}
	async compileAsync(_scene, _camera) {
		return /* @__PURE__ */ new Set();
	}
	_ensureRenderTarget(rt) {
		const engine = this._engine;
		if (!engine) throw new Error("gs3d: call init() before using render targets");
		ensureEngineRenderTarget(engine, rt);
		return rt;
	}
	setRenderTarget(rt) {
		this._currentRenderTarget = rt || null;
		if (rt) this._ensureRenderTarget(rt);
		this._captureTarget = rt ? rt._rtId : -1;
		return this;
	}
	getRenderTarget() {
		return this._currentRenderTarget || null;
	}
	get extensions() {
		if (!this._extensions) {
			const renderer = this;
			this._extensions = { has(name) {
				if (name !== "EXT_color_buffer_float" && name !== "EXT_color_buffer_half_float" && name !== "EXT_color_buffer_half_float" && name !== "OES_texture_float_linear" && name !== "OES_texture_half_float_linear") return false;
				return renderer._floatTargetsSupported();
			} };
		}
		return this._extensions;
	}
	_floatTargetsSupported() {
		if (this._floatSupport !== void 0) return this._floatSupport;
		let gl = null;
		try {
			gl = this.domElement.getContext("webgl2") || this.domElement.getContext("experimental-webgl2");
		} catch {}
		if (gl && typeof gl.getExtension === "function") this._floatSupport = !!(gl.getExtension("EXT_color_buffer_float") || gl.getExtension("EXT_color_buffer_half_float"));
		else this._floatSupport = true;
		return this._floatSupport;
	}
	_applyOutputSettings() {
		const engine = this._engine;
		if (!engine) return;
		const srgb = this.outputColorSpace === "srgb" ? "srgb" : "linear";
		try {
			engine._g3_asset_output_srgb(srgb === "srgb" ? 1 : 0);
		} catch {}
		const mode = typeof this.toneMapping === "number" ? TONE_MODES[this.toneMapping] ?? 0 : {
			none: 0,
			reinhard: 1,
			aces: 2
		}[this.toneMapping] ?? 0;
		try {
			engine._g3_asset_tone_mapping(mode);
			engine._g3_asset_exposure(this.toneMappingExposure ?? 1);
		} catch {}
	}
	async init() {
		if (this._engine) return this._engine;
		this._enginePromise = this._enginePromise || (async () => {
			const engine = this._engineOverride ? await this._engineOverride : await createGoose3D({ locateFile: () => wasmUrl.href });
			setSharedEngine(engine);
			const canvas = this.domElement;
			if (!canvas.id) canvas.id = `gs3d-${++engineCanvasSeq}`;
			if (typeof engine._g3_host_set_canvas === "function") {
				const selector = `[id="${String(canvas.id).replace(/["\\]/g, "\\$&")}"]`;
				const bytes = new TextEncoder().encode(selector);
				const ptr = engine._malloc(bytes.length);
				engine.HEAPU8.set(bytes, ptr);
				engine._g3_host_set_canvas(ptr, bytes.length);
				engine._free(ptr);
			}
			if (!this._cssWidth || !this._cssHeight) this._measure();
			const pw = Math.max(1, Math.round(this._cssWidth * this._pixelRatio));
			const ph = Math.max(1, Math.round(this._cssHeight * this._pixelRatio));
			canvas.width = pw;
			canvas.height = ph;
			if (typeof engine._g3_host_start === "function" && !engine._g3_host_start(pw, ph)) throw new Error("gs3d: the engine could not start a WebGL2 context on this canvas");
			this._lightLease = typeof engine._g3_asset_lights_begin === "function" ? engine._g3_asset_lights_begin() : -1;
			this._applyOutputSettings();
			return engine;
		})();
		this._engine = await this._enginePromise;
		return this._engine;
	}
	render(scene, camera) {
		const engine = this._engine;
		if (!engine) throw new Error("gs3d: call init() before render()");
		const now = typeof performance !== "undefined" ? performance.now() : Date.now();
		const dt = this._lastFrame ? Math.min((now - this._lastFrame) / 1e3, .1) : 1 / 60;
		this._lastFrame = now;
		if (scene) {
			const collected = collectLights(scene, camera);
			const seen = /* @__PURE__ */ new Set();
			setFrameMaterialCache(/* @__PURE__ */ new Map());
			try {
				syncSceneTree(scene, seen, camera);
			} finally {
				setFrameMaterialCache(null);
			}
			for (const object of syncedObjects) if (!seen.has(object)) {
				const record = nodeStates.get(object);
				if (record) releaseNodeRecord(record);
				nodeStates.delete(object);
				syncedObjects.delete(object);
			}
			for (const object of seen) syncedObjects.add(object);
			this._applyOutputSettings();
			syncBackground(engine, scene, this);
			syncFog(engine, scene);
			syncEnvironment(engine, scene);
			syncLights(engine, collected, this);
			camera.updateMatrixWorld();
			syncCamera(engine, this, camera);
		}
		const rt = this._captureTarget;
		if (rt >= 0 && engine._g3_asset_render_target_select) engine._g3_asset_render_target_select(rt);
		try {
			engine._g3_app_frame(dt);
		} finally {
			if (rt >= 0 && engine._g3_asset_render_target_select) engine._g3_asset_render_target_select(-1);
		}
	}
	setAnimationLoop(callback) {
		this._animationLoop = callback;
		if (this._raf) {
			cancelFrame(this._raf);
			this._raf = 0;
		}
		if (callback) {
			const tick = (time) => {
				if (this._animationLoop !== callback) return;
				callback(time);
				this._raf = requestFrame(tick);
			};
			this._raf = requestFrame(tick);
		}
		return this;
	}
	dispose() {
		if (this._disposed) return;
		this._disposed = true;
		this.setAnimationLoop(null);
		const engine = this._engine;
		if (engine) {
			if (this._lightLease >= 0) try {
				engine._g3_asset_lights_release(this._lightLease);
			} catch {}
			try {
				engine._g3_app_shutdown();
			} catch {}
		}
		this._engine = null;
		this._enginePromise = null;
	}
};
const WebGLRenderer = WebGPURenderer;

// src/three/bridge.ts
let sharedEngine = null;
function setSharedEngine(e) {
	sharedEngine = e;
}
const nodeStates = /* @__PURE__ */ new WeakMap();
const geometryStates = /* @__PURE__ */ new WeakMap();
const materialStates = /* @__PURE__ */ new WeakMap();
const customShaderIds = /* @__PURE__ */ new WeakMap();
let customShaderSeq = 0;
const cameraStates = /* @__PURE__ */ new WeakMap();
const textureStates = /* @__PURE__ */ new WeakMap();
const texture3dStates = /* @__PURE__ */ new WeakMap();
const syncedObjects = /* @__PURE__ */ new Set();
function engineNodeIndex(object) {
	return nodeStates.get(object)?.index ?? -1;
}
function releaseNodeRecord(record) {
	if (!record || !sharedEngine) return;
	sharedEngine._g3_asset_node_release(record.index, record.generation, record.epoch);
}
function releaseEngineTree(object) {
	const records = [];
	object.traverse((node) => {
		const record = nodeStates.get(node);
		if (record) {
			records.push(record);
			nodeStates.delete(node);
			syncedObjects.delete(node);
		}
	});
	for (const record of records) releaseNodeRecord(record);
}
function releaseGeometry(geometry) {
	const byFlag = geometryStates.get(geometry);
	if (byFlag) for (const flag of Object.keys(byFlag)) {
		const state = byFlag[flag];
		if (state && sharedEngine) sharedEngine._g3_asset_release_mesh(state.id, state.generation);
	}
	geometryStates.delete(geometry);
}
function releaseMaterial(material) {
	const state = materialStates.get(material);
	if (state && sharedEngine) sharedEngine._g3_asset_release_material(state.id, state.generation);
	materialStates.delete(material);
}
function releaseTexture(texture) {
	const state = textureStates.get(texture);
	if (state && sharedEngine) sharedEngine._g3_asset_release_texture(state.id, state.generation);
	textureStates.delete(texture);
	const state3d = texture3dStates.get(texture);
	if (state3d && sharedEngine) sharedEngine._g3_asset_release_texture(state3d.id, state3d.generation);
	texture3dStates.delete(texture);
}
function textureSignature(texture) {
	const image = textureImageData(texture.image);
	return [
		image ? `${image.width}x${image.height}` : "pending",
		texture.colorSpace,
		texture.wrapS,
		texture.wrapT,
		texture.magFilter,
		texture.minFilter,
		texture.version
	].join(",");
}
function ensureTexture(engine, texture) {
	if (texture.isRenderTargetTexture) {
		const rt = texture._renderTarget;
		return rt ? ensureEngineRenderTarget(engine, rt) : -1;
	}
	const signature = textureSignature(texture);
	const state = textureStates.get(texture);
	if (state && state.signature === signature) return state.id;
	if (state) engine._g3_asset_release_texture(state.id, state.generation);
	const image = textureImageData(texture.image);
	if (!image?.pixels?.length) return -1;
	const f16 = (texture.type === 1016 || image.pixels instanceof Uint16Array) && image.pixels.byteLength === image.width * image.height * 8 && typeof engine._g3_host_texture_f16 === "function";
	const ptr = engine._malloc(image.pixels.byteLength || image.pixels.length);
	if (!ptr) return -1;
	let id = -1;
	try {
		engine.HEAPU8.set(image.pixels instanceof Uint8Array || image.pixels instanceof Uint8ClampedArray ? image.pixels : image.pixels instanceof Uint16Array ? new Uint8Array(image.pixels.buffer, image.pixels.byteOffset, image.pixels.byteLength) : new Uint8ClampedArray(image.pixels), ptr);
		if (f16) id = engine._g3_host_texture_f16(image.width, image.height, ptr, image.pixels.byteLength);
		else {
			id = engine._g3_asset_texture();
			if (id >= 0) {
				if (texture.colorSpace === "srgb") engine._g3_host_texture_srgb(id, ptr, image.width, image.height);
				else engine._g3_host_texture(id, ptr, image.width, image.height);
			}
		}
		if (id < 0) return -1;
		const wrapU = WRAP_TO_ENGINE[texture.wrapS] ?? 1;
		const wrapV = WRAP_TO_ENGINE[texture.wrapT] ?? 1;
		engine._g3_host_texture_wrap(id, wrapU, wrapV);
		const minFilter = FILTER_TO_GL[texture.minFilter] ?? 9729;
		const magFilter = FILTER_TO_GL[texture.magFilter] ?? 9729;
		engine._g3_host_texture_filter(id, minFilter, magFilter);
	} finally {
		engine._free(ptr);
	}
	const record = {
		id,
		generation: engine._g3_asset_texture_generation(id),
		signature
	};
	textureStates.set(texture, record);
	return id;
}
function ensureTexture3D(engine, texture) {
	if (!texture || !texture.isData3DTexture) return -1;
	if (typeof engine._g3_host_texture_3d !== "function") return -1;
	const image = texture.image;
	const data = image?.data;
	const f16 = data instanceof Uint16Array && typeof engine._g3_host_texture_3d_f16 === "function";
	if (!data || !(data instanceof Uint8Array || data instanceof Uint8ClampedArray || f16)) return -1;
	const signature = [
		image ? `${image.width}x${image.height}x${image.depth}` : "pending",
		texture.version,
		f16 ? "f16" : "rgba8"
	].join(",");
	const state = texture3dStates.get(texture);
	if (state && state.signature === signature) return state.id;
	if (state) engine._g3_asset_release_texture(state.id, state.generation);
	const ptr = engine._malloc(data.byteLength || data.length);
	if (!ptr) return -1;
	try {
		engine.HEAPU8.set(data instanceof Uint8Array || data instanceof Uint8ClampedArray ? data : new Uint8Array(data.buffer, data.byteOffset, data.byteLength), ptr);
		const id = f16 ? engine._g3_host_texture_3d_f16(image.width, image.height, image.depth, ptr, data.byteLength) : engine._g3_host_texture_3d(image.width, image.height, image.depth, ptr, data.length);
		if (id < 0) return -1;
		const record = {
			id,
			generation: engine._g3_asset_texture_generation(id),
			signature
		};
		texture3dStates.set(texture, record);
		return id;
	} finally {
		engine._free(ptr);
	}
}
function resolvedQuaternion(object) {
	const q = object.quaternion, e = object.rotation;
	const qc = object._qCache, ec = object._eCache;
	const qChanged = q.x !== qc.x || q.y !== qc.y || q.z !== qc.z || q.w !== qc.w;
	const eChanged = e.x !== ec.x || e.y !== ec.y || e.z !== ec.z || e.order !== ec.order;
	if (qChanged) {
		if ((e.order || "XYZ") === "XYZ") {
			const [ex, ey, ez] = eulerFromQuatXYZ(q);
			e.set(ex, ey, ez);
		}
	} else if (eChanged) {
		const nq = quatFromEulerOrder(e.x, e.y, e.z, e.order);
		q.set(nq.x, nq.y, nq.z, nq.w);
	}
	qc.x = q.x;
	qc.y = q.y;
	qc.z = q.z;
	qc.w = q.w;
	ec.x = e.x;
	ec.y = e.y;
	ec.z = e.z;
	ec.order = e.order;
	return q;
}
function localMatrixOf(object) {
	if (object.matrixAutoUpdate === false && object.matrix) return object.matrix.elements;
	const p = object.position, s = object.scale, q = resolvedQuaternion(object);
	const c = object._lmCache;
	if (c && c.px === p.x && c.py === p.y && c.pz === p.z && c.qx === q.x && c.qy === q.y && c.qz === q.z && c.qw === q.w && c.sx === s.x && c.sy === s.y && c.sz === s.z) return c.elements;
	const elements = composeLocal(p, q, s);
	object._lmCache = {
		elements,
		px: p.x,
		py: p.y,
		pz: p.z,
		qx: q.x,
		qy: q.y,
		qz: q.z,
		qw: q.w,
		sx: s.x,
		sy: s.y,
		sz: s.z
	};
	return elements;
}
function worldMatrixOf(object) {
	let world = localMatrixOf(object);
	let parent = object.parent;
	while (parent) {
		world = multiplyMat4(localMatrixOf(parent), world);
		parent = parent.parent;
	}
	return world;
}
const flatGeometryCache = /* @__PURE__ */ new WeakMap();
function flatShadedGeometry(geometry) {
	const cached = flatGeometryCache.get(geometry);
	if (cached && cached.version === geometry.version) return cached.geo;
	const src = attrData(geometry.attributes.position);
	const p = src?.array, is = src?.itemSize;
	const index = geometry.index && geometry.index.array;
	const triCount = index ? index.length / 3 : src.count / 3;
	const vertCount = triCount * 3;
	const positions = new Float32Array(vertCount * 3);
	const normals = new Float32Array(vertCount * 3);
	const uvs = [], colors = [];
	const uvData = attrData(geometry.attributes.uv);
	const colorData = attrData(geometry.attributes.color);
	const uvAttr = uvData, colorAttr = colorData;
	const readVert = (vi) => {
		const i = vi * is;
		return [
			p[i],
			p[i + 1] || 0,
			p[i + 2] || 0
		];
	};
	let w = 0;
	for (let t = 0; t < triCount; t++) {
		const ia = index ? index[t * 3] : t * 3;
		const ib = index ? index[t * 3 + 1] : t * 3 + 1;
		const ic = index ? index[t * 3 + 2] : t * 3 + 2;
		const a = readVert(ia), b = readVert(ib), c = readVert(ic);
		const ux = b[0] - a[0], uy = b[1] - a[1], uz = b[2] - a[2];
		const vx = c[0] - a[0], vy = c[1] - a[1], vz = c[2] - a[2];
		let nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
		const nl = Math.hypot(nx, ny, nz);
		if (nl > 1e-12) {
			nx /= nl;
			ny /= nl;
			nz /= nl;
		}
		for (const vi of [
			ia,
			ib,
			ic
		]) {
			const v = readVert(vi);
			positions[w] = v[0];
			positions[w + 1] = v[1];
			positions[w + 2] = v[2];
			normals[w] = nx;
			normals[w + 1] = ny;
			normals[w + 2] = nz;
			w += 3;
			if (uvAttr) {
				const ui = vi * uvAttr.itemSize;
				uvs.push(uvAttr.array[ui] || 0, uvAttr.array[ui + 1] || 0);
			}
			if (colorAttr) {
				const ci = vi * colorAttr.itemSize;
				colors.push(colorAttr.array[ci] || 1, colorAttr.array[ci + 1] || 1, colorAttr.array[ci + 2] || 1, colorAttr.array[ci + 3] ?? 1);
			}
		}
	}
	const geo = new BufferGeometry();
	geo.setAttribute("position", new Float32BufferAttribute(positions, 3));
	geo.setAttribute("normal", new Float32BufferAttribute(normals, 3));
	if (uvAttr) geo.setAttribute("uv", new Float32BufferAttribute(uvs, 2));
	if (colorAttr) geo.setAttribute("color", new Float32BufferAttribute(colors, colorAttr.itemSize));
	flatGeometryCache.set(geometry, {
		version: geometry.version,
		geo
	});
	return geo;
}
const UV_SLOT_ATTRS = [
	"uv",
	"uv1",
	"uv2",
	"uv3",
	"uv4",
	"uv5",
	"uv6",
	"uv7"
];
const STANDARD_ATTRS = /* @__PURE__ */ new Set([
	"position",
	"normal",
	"color",
	"tangent",
	...UV_SLOT_ATTRS
]);
const customAttrRegistry = /* @__PURE__ */ new Map();
let customAttrRegistryVersion = 0;
const attrDataCache = /* @__PURE__ */ new WeakMap();
function attrData(attribute) {
	if (!attribute) return null;
	if (attribute.isInterleavedBufferAttribute) {
		let cached = attrDataCache.get(attribute);
		if (!cached) {
			const { data, itemSize, offset } = attribute;
			const stride = data.stride, count = attribute.count, src = data.array;
			const out = new Float32Array(count * itemSize);
			for (let i = 0; i < count; i++) {
				const base = i * stride + offset;
				for (let c = 0; c < itemSize; c++) out[i * itemSize + c] = src[base + c] ?? 0;
			}
			cached = {
				array: out,
				itemSize,
				count
			};
			attrDataCache.set(attribute, cached);
		}
		return cached;
	}
	return {
		array: attribute.array,
		itemSize: attribute.itemSize,
		count: attribute.count
	};
}
function allocateCustomSlots(need, blocked) {
	const used = /* @__PURE__ */ new Set();
	for (const reg of customAttrRegistry.values()) for (const s of reg.slots) used.add(s);
	for (let s = 0; s < 8; s++) if (blocked[s]) used.add(s);
	for (let start = 0; start + need <= 8; start++) {
		let ok = true;
		for (let k = 0; k < need; k++) if (used.has(start + k)) {
			ok = false;
			break;
		}
		if (ok) return Array.from({ length: need }, (_, k) => start + k);
	}
	return null;
}
const preparedGeometryCache = /* @__PURE__ */ new WeakMap();
const NO_MATERIAL = {};
function preparedGeometry(geometry, useVertexColors, flatShading, material) {
	const src = flatShading ? flatShadedGeometry(geometry) : geometry;
	const position = attrData(src.attributes.position);
	if (!position) return null;
	if (!src.attributes.normal) src.computeVertexNormals();
	const normal = attrData(src.attributes.normal);
	const count = position.count;
	const slotData = new Array(8).fill(null);
	const claimed = new Array(8).fill(false);
	for (let set = 0; set < 8; set++) {
		const attr = attrData(src.attributes[set === 0 ? "uv" : `uv${set}`]);
		if (attr) {
			slotData[set] = attr;
			claimed[set] = true;
		}
	}
	const color = useVertexColors ? attrData(src.attributes.color) : null;
	const ns = normal ? normal.itemSize : 3, cs = color ? color.itemSize : 4;
	const customNames = [];
	const pushName = (name) => {
		if (!STANDARD_ATTRS.has(name) && !customNames.includes(name)) customNames.push(name);
	};
	for (const name of Object.keys(src.attributes)) pushName(name);
	const defaults = material && material.defaultAttributeValues;
	if (defaults) {
		for (const name of Object.keys(defaults)) if (Array.isArray(defaults[name])) pushName(name);
	}
	if (material && (material.isShaderMaterial || material.isRawShaderMaterial)) for (const a of vertexAttrInfo(material)) pushName(a.name);
	const customs = [], fills = [];
	for (const name of customNames) {
		const data = attrData(src.attributes[name]);
		const itemSize = Math.min(4, Math.max(1, data ? data.itemSize : defaults && Array.isArray(defaults[name]) ? defaults[name].length : 2));
		let reg = customAttrRegistry.get(name);
		if (!reg) {
			const slots = allocateCustomSlots(Math.ceil(itemSize / 2), claimed);
			if (!slots) continue;
			reg = {
				slots,
				itemSize
			};
			customAttrRegistry.set(name, reg);
			customAttrRegistryVersion++;
		}
		const capacity = reg.slots.length * 2;
		if (reg.slots.some((s) => claimed[s])) {
			if (defaults && Array.isArray(defaults[name])) fills.push({
				slots: reg.slots,
				values: defaults[name],
				count: Math.min(defaults[name].length, capacity)
			});
			continue;
		}
		if (data) customs.push({
			name,
			data,
			slots: reg.slots,
			count: Math.min(data.itemSize, capacity)
		});
		else if (defaults && Array.isArray(defaults[name])) fills.push({
			slots: reg.slots,
			values: defaults[name],
			count: Math.min(defaults[name].length, capacity)
		});
	}
	const customSig = customs.map((c) => `${c.name}:${c.slots}`).join(",") + "|" + fills.map((f) => `${f.name}=${f.values}`).join(",");
	return {
		src,
		position,
		normal,
		color,
		count,
		ns,
		cs,
		slotData,
		customs,
		fills,
		flag: `${useVertexColors ? 1 : 0}${flatShading ? 1 : 0}|${customSig}`,
		indexIds: src.index ? src.index.array : null,
		gVersion: geometry.version,
		regVersion: customAttrRegistryVersion,
		vs: material ? material.vertexShader : void 0,
		defaults,
		isShader: !!(material && (material.isShaderMaterial || material.isRawShaderMaterial))
	};
}
function cachedPreparedGeometry(geometry, useVertexColors, flatShading, material) {
	const flags = `${useVertexColors ? 1 : 0}${flatShading ? 1 : 0}`;
	let byMaterial = preparedGeometryCache.get(geometry);
	if (!byMaterial) preparedGeometryCache.set(geometry, byMaterial = /* @__PURE__ */ new WeakMap());
	const key = material || NO_MATERIAL;
	let byFlags = byMaterial.get(key);
	if (!byFlags) byMaterial.set(key, byFlags = /* @__PURE__ */ new Map());
	let entry = byFlags.get(flags);
	const defaults = material && material.defaultAttributeValues;
	const isShader = !!(material && (material.isShaderMaterial || material.isRawShaderMaterial));
	if (entry && entry.gVersion === geometry.version && entry.regVersion === customAttrRegistryVersion && entry.vs === (material ? material.vertexShader : void 0) && entry.defaults === defaults && entry.isShader === isShader) return entry;
	entry = preparedGeometry(geometry, useVertexColors, flatShading, material);
	if (entry) byFlags.set(flags, entry);
	return entry;
}
function fillVertexSlots(slotVals, slotData, customs, fills, i) {
	slotVals.fill(0);
	for (let set = 0; set < 8; set++) {
		const attr = slotData[set];
		if (attr) {
			const ui = i * attr.itemSize;
			slotVals[set * 2] = attr.array[ui] || 0;
			slotVals[set * 2 + 1] = attr.array[ui + 1] || 0;
		}
	}
	for (const cu of customs) {
		const base = i * cu.data.itemSize;
		for (let f = 0; f < cu.count; f++) slotVals[cu.slots[f >> 1] * 2 + (f & 1)] = cu.data.array[base + f] || 0;
	}
	for (const f of fills) for (let k = 0; k < f.count; k++) slotVals[f.slots[k >> 1] * 2 + (k & 1)] = f.values[k] || 0;
}
const _slotVals = /* @__PURE__ */ new Float64Array(16);
function uploadGeometryBulk(engine, prepared) {
	const { position, normal, color, count, ns, cs, slotData, customs, fills, indexIds } = prepared;
	const indexCount = indexIds ? indexIds.length - indexIds.length % 3 : count - count % 3;
	if (count <= 0 || indexCount <= 0) return -1;
	const p = position.array, n = normal ? normal.array : null, c = color ? color.array : null;
	const floatCount = count * 30;
	const vPtr = engine._malloc(floatCount * 4);
	const iPtr = engine._malloc(indexCount * 4);
	try {
		const vf = engine.HEAPF32;
		const vBase = vPtr >> 2;
		for (let i = 0; i < count; i++) {
			const pi = i * position.itemSize, ni = i * ns, ci = i * cs;
			fillVertexSlots(_slotVals, slotData, customs, fills, i);
			const o = vBase + i * 30;
			vf[o] = p[pi];
			vf[o + 1] = p[pi + 1];
			vf[o + 2] = p[pi + 2];
			vf[o + 3] = n && ns > 0 ? n[ni] : 0;
			vf[o + 4] = n && ns > 1 ? n[ni + 1] : 0;
			vf[o + 5] = n && ns > 2 ? n[ni + 2] : 1;
			for (let s = 0; s < 16; s++) vf[o + 6 + s] = _slotVals[s];
			vf[o + 22] = 0;
			vf[o + 23] = 0;
			vf[o + 24] = 0;
			vf[o + 25] = 0;
			vf[o + 26] = c && cs > 0 ? c[ci] : 1;
			vf[o + 27] = c && cs > 1 ? c[ci + 1] : 1;
			vf[o + 28] = c && cs > 2 ? c[ci + 2] : 1;
			vf[o + 29] = c && cs > 3 ? c[ci + 3] : 1;
		}
		const iu = engine.HEAPU32 || new Uint32Array(engine.HEAPU8.buffer);
		const iBase = iPtr >> 2;
		if (indexIds) for (let i = 0; i < indexCount; i++) iu[iBase + i] = indexIds[i];
		else for (let i = 0; i < indexCount; i++) iu[iBase + i] = i;
		return engine._g3_host_mesh_upload(vPtr, floatCount, iPtr, indexCount);
	} finally {
		engine._free(vPtr);
		engine._free(iPtr);
	}
}
function ensureGeometry(engine, geometry, useVertexColors = false, flatShading = false, material = null) {
	if (!geometry || !geometry.attributes || !geometry.attributes.position) return -1;
	const prepared = cachedPreparedGeometry(geometry, useVertexColors, flatShading, material);
	if (!prepared) return -1;
	const { position, normal, color, count, ns, cs, slotData, customs, fills, flag, indexIds } = prepared;
	const p = position.array, n = normal ? normal.array : null, c = color ? color.array : null;
	const byFlag = geometryStates.get(geometry) || {};
	const state = byFlag[flag];
	if (state && state.version === geometry.version) return state.id;
	if (state) engine._g3_asset_release_mesh(state.id, state.generation);
	let id = -1;
	if (typeof engine._g3_host_mesh_upload === "function" && engine.HEAPF32 && (engine.HEAPU32 || engine.HEAPU8)) id = uploadGeometryBulk(engine, prepared);
	if (id < 0) {
		const slotVals = /* @__PURE__ */ new Float64Array(16);
		engine._g3_asset_mesh_begin();
		for (let i = 0; i < count; i++) {
			const pi = i * position.itemSize, ni = i * ns, ci = i * cs;
			fillVertexSlots(slotVals, slotData, customs, fills, i);
			engine._g3_asset_vertex(p[pi], p[pi + 1], p[pi + 2], n && ns > 0 ? n[ni] : 0, n && ns > 1 ? n[ni + 1] : 0, n && ns > 2 ? n[ni + 2] : 1, ...slotVals, 0, 0, 0, 0, c && cs > 0 ? c[ci] : 1, c && cs > 1 ? c[ci + 1] : 1, c && cs > 2 ? c[ci + 2] : 1, c && cs > 3 ? c[ci + 3] : 1);
		}
		if (indexIds) {
			const ids = indexIds;
			for (let i = 0; i + 2 < ids.length; i += 3) engine._g3_asset_triangle(ids[i], ids[i + 1], ids[i + 2]);
		} else for (let i = 0; i + 2 < count; i += 3) engine._g3_asset_triangle(i, i + 1, i + 2);
		id = engine._g3_asset_mesh_end();
	}
	byFlag[flag] = {
		id,
		generation: engine._g3_asset_mesh_generation(id),
		version: geometry.version
	};
	geometryStates.set(geometry, byFlag);
	return id;
}
function materialSignature(material) {
	const parts = [
		material.color.r,
		material.color.g,
		material.color.b,
		material.opacity,
		material.transparent,
		material.alphaTest,
		material.side,
		material.visible
	];
	if (material.isMeshStandardMaterial || material.isMeshPhysicalMaterial) parts.push(material.metalness, material.roughness, material.emissive.r, material.emissive.g, material.emissive.b, material.emissiveIntensity, material.ior, material.envMapIntensity);
	const cs = material.customShader;
	if (cs) {
		if (!cs._gs3dKey) cs._gs3dKey = ++customShaderSeq;
		parts.push("cs" + cs._gs3dKey);
		const u = material.customUniforms;
		if (u) for (let i = 0; i < 32; i++) parts.push(u[i] ?? 0);
	}
	return parts.join(",");
}
const MATERIAL_MAPS = [
	["map", 0],
	["metalnessMap", 1],
	["roughnessMap", 1],
	["normalMap", 2],
	["aoMap", 3],
	["emissiveMap", 4]
];
function materialMaps(material) {
	const maps = [
		null,
		null,
		null,
		null,
		null
	];
	for (const [key, slot] of MATERIAL_MAPS) {
		const texture = material[key];
		if (texture && texture.isTexture && !maps[slot]) maps[slot] = texture;
	}
	return maps;
}
function textureUvSignature(texture) {
	return `${texture.offset.x},${texture.offset.y},${texture.repeat.x},${texture.repeat.y},${texture.rotation},${texture.channel || 0}`;
}
let frameMaterialCache = null;
function setFrameMaterialCache(c) {
	frameMaterialCache = c;
}
let fallbackMaterial = null;
function setFallbackMaterial(m) {
	fallbackMaterial = m;
}

// src/three/textures.ts
const UnsignedByteType = 1009;
const ByteType = 1010;
const ShortType = 1011;
const UnsignedShortType = 1012;
const IntType = 1013;
const UnsignedIntType = 1014;
const FloatType = 1015;
const HalfFloatType = 1016;
const UnsignedShort4444Type = 1017;
const UnsignedShort5551Type = 1018;
const UnsignedInt248Type = 1020;
const UnsignedInt5999Type = 35902;
const UnsignedInt101111Type = 35899;
const AlphaFormat = 1021;
const RGBFormat = 1022;
const RGBAFormat = 1023;
const RedFormat = 1028;
const RedIntegerFormat = 1029;
const RGFormat = 1030;
const RGIntegerFormat = 1031;
const RGBIntegerFormat = 1032;
const RGBAIntegerFormat = 1033;
const DepthFormat = 1026;
const DepthStencilFormat = 1027;
const NoBlending = 0;
const NormalBlending = 1;
const AdditiveBlending = 2;
const SubtractiveBlending = 3;
const MultiplyBlending = 4;
const GLSL1 = "100";
const GLSL3 = "300 es";
const CustomBlending = 5;
const ZeroFactor = 200;
const OneFactor = 201;
const SrcColorFactor = 202;
const OneMinusSrcColorFactor = 203;
const SrcAlphaFactor = 204;
const OneMinusSrcAlphaFactor = 205;
const DstAlphaFactor = 206;
const OneMinusDstAlphaFactor = 207;
const DstColorFactor = 208;
const OneMinusDstColorFactor = 209;
const SrcAlphaSaturateFactor = 210;
const AddEquation = 100;
const SubtractEquation = 101;
const ReverseSubtractEquation = 102;
const MinEquation = 103;
const MaxEquation = 104;
const ZeroStencilOp = 0;
const KeepStencilOp = 7680;
const ReplaceStencilOp = 7681;
const IncrementStencilOp = 7682;
const DecrementStencilOp = 7683;
const IncrementWrapStencilOp = 34055;
const DecrementWrapStencilOp = 34056;
const InvertStencilOp = 5386;
const NeverStencilFunc = 512;
const LessStencilFunc = 513;
const EqualStencilFunc = 514;
const LessEqualStencilFunc = 515;
const GreaterStencilFunc = 516;
const NotEqualStencilFunc = 517;
const GreaterEqualStencilFunc = 518;
const AlwaysStencilFunc = 519;
const NeverDepth = 0;
const AlwaysDepth = 1;
const LessDepth = 2;
const LessEqualDepth = 3;
const EqualDepth = 4;
const GreaterEqualDepth = 5;
const GreaterDepth = 6;
const NotEqualDepth = 7;
const StaticDrawUsage = 35044;
const DynamicDrawUsage = 35048;
const StreamDrawUsage = 35040;
const StaticReadUsage = 35045;
const DynamicReadUsage = 35049;
const StreamReadUsage = 35041;
const StaticCopyUsage = 35046;
const DynamicCopyUsage = 35050;
const StreamCopyUsage = 35042;
const RepeatWrapping = 1e3;
const ClampToEdgeWrapping = 1001;
const MirroredRepeatWrapping = 1002;
const NearestFilter = 1003;
const LinearFilter = 1006;
const NearestMipmapNearestFilter = 1004;
const NearestMipmapLinearFilter = 1005;
const LinearMipmapNearestFilter = 1007;
const LinearMipmapLinearFilter = 1008;
const WRAP_TO_ENGINE = {
	[ClampToEdgeWrapping]: 0,
	[RepeatWrapping]: 1,
	[MirroredRepeatWrapping]: 2
};
const FILTER_TO_GL = {
	[NearestFilter]: 9728,
	[LinearFilter]: 9729,
	[NearestMipmapNearestFilter]: 9984,
	[NearestMipmapLinearFilter]: 9985,
	[LinearMipmapNearestFilter]: 9986,
	[LinearMipmapLinearFilter]: 9987
};
function textureImageData(image) {
	if (!image) return null;
	if (image.pixels && image.width && image.height) return image;
	if (image.data && image.width && image.height) return {
		width: image.width,
		height: image.height,
		pixels: image.data
	};
	if (typeof document !== "undefined" && (image instanceof HTMLCanvasElement || image instanceof HTMLImageElement || typeof ImageBitmap !== "undefined" && image instanceof ImageBitmap)) {
		const canvas = document.createElement("canvas");
		canvas.width = image.width || image.videoWidth || image.naturalWidth;
		canvas.height = image.height || image.videoHeight || image.naturalHeight;
		const ctx = canvas.getContext("2d");
		if (!ctx) return null;
		ctx.drawImage(image, 0, 0);
		return {
			width: canvas.width,
			height: canvas.height,
			pixels: ctx.getImageData(0, 0, canvas.width, canvas.height).data
		};
	}
	if (image instanceof ImageData) return {
		width: image.width,
		height: image.height,
		pixels: image.data
	};
	return null;
}
var Texture = class extends EventDispatcher {
	get image() {
		return this._image;
	}
	set image(v) {
		this._image = v;
	}
	get depth() {
		return this._depth;
	}
	set depth(v) {
		this._depth = v;
	}
	get needsPMREMUpdate() {
		return this._needsPMREMUpdate;
	}
	set needsPMREMUpdate(v) {
		this._needsPMREMUpdate = v;
	}
	constructor(image = null) {
		super();
		this.isTexture = true;
		this._image = image;
		this.colorSpace = NoColorSpace;
		this.wrapS = RepeatWrapping;
		this.wrapT = RepeatWrapping;
		this.magFilter = LinearFilter;
		this.minFilter = LinearMipmapLinearFilter;
		this.offset = new Vector2();
		this.repeat = new Vector2(1, 1);
		this.rotation = 0;
		this.center = new Vector2(.5, .5);
		this.channel = 0;
		this.type = UnsignedByteType;
		this.matrixAutoUpdate = true;
		this.generateMipmaps = true;
		this.version = 0;
		this._depth = 1;
		this.updateRanges = [];
		this._needsPMREMUpdate = false;
		this.matrix = null;
	}
	get width() {
		const i = this.image;
		return i ? i.width ?? i.naturalWidth ?? i.videoWidth ?? 0 : 0;
	}
	get height() {
		const i = this.image;
		return i ? i.height ?? i.naturalHeight ?? i.videoHeight ?? 0 : 0;
	}
	set needsUpdate(v) {
		if (v) this.version++;
	}
	get needsUpdate() {
		return false;
	}
	addUpdateRange(start, count) {
		this.updateRanges.push({
			start,
			count
		});
	}
	clearUpdateRanges() {
		this.updateRanges.length = 0;
	}
	transformUv(uv) {
		return uv;
	}
	setValues(values) {
		for (const [k, v] of Object.entries(values)) if (k === "offset" || k === "repeat" || k === "center") this[k].set(v.x ?? v[0], v.y ?? v[1]);
		else this[k] = v;
		return this;
	}
	copy(source) {
		this._image = source.image;
		this.colorSpace = source.colorSpace;
		this.wrapS = source.wrapS;
		this.wrapT = source.wrapT;
		this.magFilter = source.magFilter;
		this.minFilter = source.minFilter;
		this.offset.copy(source.offset);
		this.repeat.copy(source.repeat);
		this.rotation = source.rotation;
		this.center.copy(source.center);
		this.channel = source.channel;
		this.type = source.type;
		this.flipY = source.flipY;
		this.generateMipmaps = source.generateMipmaps;
		this.matrixAutoUpdate = source.matrixAutoUpdate;
		return this;
	}
	clone() {
		return new this.constructor(this.image).copy(this);
	}
	toJSON(meta = {}) {
		const image = this.image;
		return {
			metadata: {
				version: 4.7,
				type: "Texture",
				generator: "gs3d"
			},
			uuid: this.uuid,
			type: this.isTexture ? "Texture" : "Texture",
			name: this.name || "",
			image: image && image.src ? image.src : void 0,
			mapping: 300,
			wrapS: this.wrapS,
			wrapT: this.wrapT,
			magFilter: this.magFilter,
			minFilter: this.minFilter,
			anisotropy: this.anisotropy ?? 1,
			colorSpace: this.colorSpace,
			offset: [this.offset.x, this.offset.y],
			repeat: [this.repeat.x, this.repeat.y],
			center: [this.center.x, this.center.y],
			rotation: this.rotation,
			channel: this.channel
		};
	}
	updateMatrix() {
		return this;
	}
	dispose() {
		this.version++;
		releaseTexture(this);
	}
};
var DataTexture = class extends Texture {
	constructor(data = null, width = 1, height = 1) {
		super(data ? {
			data,
			width,
			height
		} : null);
		this.isDataTexture = true;
		this.flipY = false;
		this.unpackAlignment = 4;
	}
};
function checkerTexture(a = 0xd0d0d0, b = 3158064, cells = 8, size = 512) {
	const ca = new Color(a), cb = new Color(b);
	const ar = Math.round(ca.r * 255), ag = Math.round(ca.g * 255), ab = Math.round(ca.b * 255);
	const br = Math.round(cb.r * 255), bg = Math.round(cb.g * 255), bb = Math.round(cb.b * 255);
	const data = new Uint8Array(size * size * 4);
	const step = Math.max(1, size / cells);
	for (let y = 0; y < size; y++) {
		const cy = Math.floor(y / step);
		for (let x = 0; x < size; x++) {
			const useA = (Math.floor(x / step) + cy & 1) === 0;
			const o = (y * size + x) * 4;
			data[o] = useA ? ar : br;
			data[o + 1] = useA ? ag : bg;
			data[o + 2] = useA ? ab : bb;
			data[o + 3] = 255;
		}
	}
	const tex = new DataTexture(data, size, size);
	tex.wrapS = RepeatWrapping;
	tex.wrapT = RepeatWrapping;
	tex.colorSpace = SRGBColorSpace;
	tex.needsUpdate = true;
	return tex;
}
var Data3DTexture = class extends Texture {
	constructor(data = null, width = 1, height = 1, depth = 1) {
		super(data ? {
			data,
			width,
			height,
			depth
		} : null);
		this.isData3DTexture = true;
		this.flipY = false;
		this.unpackAlignment = 4;
	}
};
var CanvasTexture = class extends Texture {
	constructor(canvas = document.createElement("canvas")) {
		super(canvas);
		this.isCanvasTexture = true;
	}
};
var CompressedTexture = class extends Texture {
	constructor() {
		super(null);
		this.isCompressedTexture = true;
	}
};
var CubeTexture = class extends Texture {
	get images() {
		return this._images;
	}
	set images(v) {
		this._images = v;
	}
	constructor(images = []) {
		super(images);
		this.isCubeTexture = true;
		this._images = images;
	}
};
var VideoTexture = class extends Texture {
	constructor(video = null) {
		super(video);
		this.isVideoTexture = true;
	}
	update() {
		this.needsUpdate = true;
		return this;
	}
};
const RT_FORMAT = {
	[UnsignedByteType]: 0,
	[HalfFloatType]: 1,
	[FloatType]: 2
};
var WebGLRenderTarget = class WebGLRenderTarget extends EventDispatcher {
	get depthTexture() {
		return this._depthTexture;
	}
	set depthTexture(v) {
		this._depthTexture = v;
	}
	get texture() {
		return this._texture;
	}
	set texture(v) {
		this._texture = v;
	}
	constructor(width = 1, height = 1, options = {}) {
		super();
		this._depthTexture = null;
		this.isRenderTarget = true;
		this.width = Math.max(1, width | 0);
		this.height = Math.max(1, height | 0);
		this.depthBuffer = options.depthBuffer !== false;
		this.stencilBuffer = !!options.stencilBuffer;
		this.count = options.count || 1;
		this._texture = new Texture(null);
		this.textures = [this._texture];
		this.viewport = new Vector4(0, 0, this.width, this.height);
		this.scissor = new Vector4(0, 0, this.width, this.height);
		this.scissorTest = false;
		this.texture.isRenderTargetTexture = true;
		this.texture._renderTarget = this;
		this.texture.generateMipmaps = false;
		this.texture.flipY = false;
		this.texture.minFilter = options.minFilter ?? 1006;
		this.texture.magFilter = options.magFilter ?? 1006;
		this.texture.wrapS = options.wrapS ?? options.wrap ?? 1001;
		this.texture.wrapT = options.wrapT ?? options.wrap ?? 1001;
		this.texture.type = options.type ?? 1009;
		this._rtId = -1;
		this._rtWidth = 0;
		this._rtHeight = 0;
		this._rtGeneration = -1;
	}
	copy(source) {
		this.width = source.width;
		this.height = source.height;
		this.depthBuffer = source.depthBuffer;
		this.stencilBuffer = source.stencilBuffer;
		return this;
	}
	clone() {
		return new WebGLRenderTarget(this.width, this.height).copy(this);
	}
	setSize(width, height) {
		this.width = Math.max(1, width | 0);
		this.height = Math.max(1, height | 0);
		this.viewport.set(0, 0, this.width, this.height);
		return this;
	}
	dispose() {
		const engine = sharedEngine;
		if (engine && this._rtId >= 0 && typeof engine._g3_asset_render_target_release === "function") try {
			engine._g3_asset_render_target_release(this._rtId);
		} catch {}
		this._rtId = -1;
		this._rtWidth = 0;
		this._rtHeight = 0;
	}
};
function ensureEngineRenderTarget(engine, rt) {
	if (!rt || !rt.isRenderTarget) return -1;
	if (rt.count !== 1) throw new Error("gs3d: multiple render targets are not supported");
	if (rt._rtId >= 0 && rt._rtWidth === rt.width && rt._rtHeight === rt.height) return rt._rtId;
	if (typeof engine._g3_asset_render_target_create !== "function") throw new Error("gs3d: this engine build has no render-target support");
	const format = RT_FORMAT[rt.texture.type] ?? 0;
	const id = engine._g3_asset_render_target_create(rt.width, rt.height, format);
	if (id < 0) throw new Error("gs3d: render target creation failed (float targets need EXT_color_buffer_float)");
	if (rt._rtId >= 0 && typeof engine._g3_asset_render_target_release === "function") try {
		engine._g3_asset_render_target_release(rt._rtId);
	} catch {}
	rt._rtId = id;
	rt._rtWidth = rt.width;
	rt._rtHeight = rt.height;
	rt._rtGeneration = typeof engine._g3_asset_texture_generation === "function" ? engine._g3_asset_texture_generation(id) : 0;
	const wrapU = WRAP_TO_ENGINE[rt.texture.wrapS] ?? 1;
	const wrapV = WRAP_TO_ENGINE[rt.texture.wrapT] ?? 1;
	engine._g3_host_texture_wrap(id, wrapU, wrapV);
	const minFilter = FILTER_TO_GL[rt.texture.minFilter] ?? 9729;
	const magFilter = FILTER_TO_GL[rt.texture.magFilter] ?? 9729;
	engine._g3_host_texture_filter(id, minFilter, magFilter);
	return id;
}
var TextureLoader = class {
	constructor(manager = null) {
		this.crossOrigin = "anonymous";
		this.path = "";
		this.resourcePath = "";
		this.requestHeader = {};
		this.withCredentials = false;
		this.manager = manager;
	}
	load(url, onLoad, _onProgress, onError) {
		const resolved = this.manager ? this.manager.resolveURL(url) : url;
		this.manager && this.manager.itemStart(resolved);
		fetch(resolved).then((response) => {
			if (!response.ok) throw new Error(`gs3d: failed to fetch texture ${url} (${response.status})`);
			return response.blob();
		}).then((blob) => createImageBitmap(blob)).then((bitmap) => {
			const image = textureImageData(bitmap);
			bitmap.close();
			const texture = new Texture(image);
			texture.needsUpdate = true;
			texture.version++;
			if (onLoad) onLoad(texture);
			this.manager && this.manager.itemEnd(resolved);
			return texture;
		}).catch((error) => {
			this.manager && this.manager.itemError(resolved);
			this.manager && this.manager.itemEnd(resolved);
			if (onError) onError(error);
			else console.error(error);
		});
		return this;
	}
	setPath(value) {
		this.path = value;
		return this;
	}
	setResourcePath(value) {
		this.resourcePath = value;
		return this;
	}
	setRequestHeader(key, value) {
		this.requestHeader[key] = value;
		return this;
	}
	setWithCredentials(value) {
		this.withCredentials = value;
		return this;
	}
	setCrossOrigin(value) {
		this.crossOrigin = value;
		return this;
	}
	abort() {
		return this;
	}
	parse(data) {
		return data;
	}
	loadAsync(url, onProgress) {
		return new Promise((resolve, reject) => {
			this.load(url, resolve, onProgress, reject);
		});
	}
};
var ImageBitmapLoader = class {
	constructor(manager = null) {
		this.crossOrigin = "anonymous";
		this.path = "";
		this.resourcePath = "";
		this.requestHeader = {};
		this.withCredentials = false;
		this.manager = manager;
	}
	load(url, onLoad, onProgress, onError) {
		const resolved = this.manager ? this.manager.resolveURL(this.path + url) : this.path + url;
		this.manager && this.manager.itemStart(resolved);
		fetch(resolved).then((response) => {
			if (!response.ok) throw new Error(`gs3d: failed to fetch image ${url} (${response.status})`);
			return response.blob();
		}).then((blob) => createImageBitmap(blob)).then((bitmap) => {
			if (onLoad) onLoad(bitmap);
			this.manager && this.manager.itemEnd(resolved);
		}).catch((error) => {
			this.manager && this.manager.itemError(resolved);
			this.manager && this.manager.itemEnd(resolved);
			if (onError) onError(error);
		});
		return this;
	}
	setPath(value) {
		this.path = value;
		return this;
	}
	setResourcePath(value) {
		this.resourcePath = value;
		return this;
	}
	setRequestHeader(key, value) {
		this.requestHeader[key] = value;
		return this;
	}
	setWithCredentials(value) {
		this.withCredentials = value;
		return this;
	}
	setCrossOrigin(value) {
		this.crossOrigin = value;
		return this;
	}
	setOptions(options) {
		Object.assign(this, options);
		return this;
	}
	abort() {
		return this;
	}
	parse(data) {
		return data;
	}
	loadAsync(url, onProgress) {
		return new Promise((resolve, reject) => {
			this.load(url, resolve, onProgress, reject);
		});
	}
};
var ImageLoader = class {
	constructor(manager = null) {
		this.crossOrigin = "anonymous";
		this.path = "";
		this.resourcePath = "";
		this.requestHeader = {};
		this.withCredentials = false;
		this.manager = manager;
	}
	load(url, onLoad, onProgress, onError) {
		const resolved = this.manager ? this.manager.resolveURL(this.path + url) : this.path + url;
		this.manager && this.manager.itemStart(resolved);
		const image = new Image();
		image.onload = () => {
			if (onLoad) onLoad(image);
			this.manager && this.manager.itemEnd(resolved);
		};
		image.onerror = (event) => {
			this.manager && this.manager.itemError(resolved);
			this.manager && this.manager.itemEnd(resolved);
			if (onError) onError(event);
		};
		if (onProgress) image.onprogress = onProgress;
		image.src = resolved;
		return image;
	}
	setPath(value) {
		this.path = value;
		return this;
	}
	setResourcePath(value) {
		this.resourcePath = value;
		return this;
	}
	setRequestHeader(key, value) {
		this.requestHeader[key] = value;
		return this;
	}
	setWithCredentials(value) {
		this.withCredentials = value;
		return this;
	}
	setCrossOrigin(value) {
		this.crossOrigin = value;
		return this;
	}
	abort() {
		return this;
	}
	parse(data) {
		return data;
	}
	loadAsync(url, onProgress) {
		return new Promise((resolve, reject) => {
			this.load(url, resolve, onProgress, reject);
		});
	}
};

// src/three/materials.ts
const FrontSide = 0;
const BackSide = 1;
const DoubleSide = 2;
var Material = class extends EventDispatcher {
	get alphaTest() {
		return this._alphaTest;
	}
	set alphaTest(v) {
		this._alphaTest = v;
	}
	constructor(parameters = {}) {
		super();
		this.isMaterial = true;
		this.name = "";
		this.color = new Color(0xffffff);
		this.opacity = 1;
		this.transparent = false;
		this._alphaTest = 0;
		this.polygonOffset = false;
		this.polygonOffsetFactor = 0;
		this.polygonOffsetUnits = 0;
		this.side = 0;
		this.visible = true;
		this.map = null;
		this.vertexColors = false;
		this.flatShading = false;
		this.normalMap = null;
		this.normalScale = new Vector2(1, 1);
		this.roughnessMap = null;
		this.metalnessMap = null;
		this.emissiveMap = null;
		this.aoMap = null;
		this.aoMapIntensity = 1;
		this.envMapIntensity = 1;
		this.depthTest = true;
		this.depthWrite = true;
		this.depthFunc = 3;
		this.blending = 1;
		this.blendEquation = 100;
		this.blendEquationAlpha = 100;
		this.blendSrc = 204;
		this.blendDst = 205;
		this.blendSrcAlpha = 201;
		this.blendDstAlpha = 205;
		this.stencilWrite = false;
		this.stencilWriteMask = 255;
		this.stencilFunc = 519;
		this.stencilRef = 0;
		this.stencilFuncMask = 255;
		this.stencilFail = KeepStencilOp;
		this.stencilZFail = KeepStencilOp;
		this.stencilZPass = KeepStencilOp;
		this.dithering = false;
		this.alphaHash = false;
		Object.assign(this, parameters);
		if (parameters.color !== void 0 && !(parameters.color instanceof Color)) this.color = new Color(parameters.color);
	}
	onBeforeCompile(parameters, renderer) {}
	onBeforeRender(renderer, scene, camera, geometry, object, group) {}
	dispose() {
		this.version = (this.version || 0) + 1;
		releaseMaterial(this);
	}
	set needsUpdate(value) {
		if (value) this.version = (this.version || 0) + 1;
	}
	get needsUpdate() {
		return false;
	}
	setValues(parameters) {
		for (const key of Object.keys(parameters)) {
			const value = parameters[key];
			if (value === void 0) continue;
			const current = this[key];
			if (current && current.isColor && value && !value.isColor) current.set(value);
			else if (current && current.isVector2 && value && !value.isVector2) current.set(value.x, value.y);
			else this[key] = value;
		}
		return this;
	}
	copy(source) {
		const skip = /* @__PURE__ */ new Set([
			"isMaterial",
			"isEventDispatcher",
			"uuid",
			"type",
			"version",
			"onBeforeCompile",
			"_listeners"
		]);
		for (const key of Object.keys(source)) {
			if (skip.has(key)) continue;
			const v = source[key];
			if (v && typeof v === "object") {
				if (v.isColor || v.isVector2 || v.isVector3 || v.isVector4 || v.isMatrix4 || v.isMatrix3 || v.isQuaternion || v.isEuler) {
					this[key] = v.clone();
					continue;
				}
				if (v.isTexture || v.isRenderTargetTexture) {
					this[key] = v;
					continue;
				}
			}
			this[key] = v;
		}
		return this;
	}
	clone() {
		return new this.constructor().copy(this);
	}
	customProgramCacheKey() {
		return this.onBeforeCompile ? this.onBeforeCompile.toString() : "";
	}
	toJSON(meta = {}) {
		const data = {
			type: this.type || this.constructor.name,
			name: this.name
		};
		for (const key of Object.keys(this)) {
			const v = this[key];
			if (typeof v === "number" || typeof v === "string" || typeof v === "boolean") data[key] = v;
			else if (v && v.isColor) data[key] = "#" + v.getHexString();
		}
		return data;
	}
};
Material.prototype.onBeforeCompile._gs3dDefault = true;
var MeshBasicMaterial = class extends Material {
	constructor(parameters = {}) {
		super(parameters);
		this.isMeshBasicMaterial = true;
		if (parameters.color !== void 0) this.color = parameters.color instanceof Color ? parameters.color : new Color(parameters.color);
	}
};
var MeshStandardMaterial = class extends Material {
	constructor(parameters = {}) {
		super(parameters);
		this.isMeshStandardMaterial = true;
		this.metalness = parameters.metalness ?? 0;
		this.roughness = parameters.roughness ?? 1;
		this.emissive = parameters.emissive !== void 0 ? parameters.emissive instanceof Color ? parameters.emissive : new Color(parameters.emissive) : new Color(0);
		this.emissiveIntensity = parameters.emissiveIntensity ?? 1;
		this.ior = parameters.ior ?? 1.5;
		if (parameters.color !== void 0) this.color = parameters.color instanceof Color ? parameters.color : new Color(parameters.color);
	}
};
const PHYSICAL_DEFAULTS = {
	clearcoat: 0,
	clearcoatRoughness: 0,
	sheen: 0,
	sheenRoughness: 1,
	transmission: 0,
	thickness: 0,
	ior: 1.5,
	iridescence: 0,
	iridescenceIOR: 1.3,
	iridescenceThicknessRange: [100, 400],
	dispersion: 0,
	anisotropy: 0,
	anisotropyRotation: 0,
	specularIntensity: 1,
	attenuationDistance: 1e400
};
for (const name of Object.keys(PHYSICAL_DEFAULTS)) {
	const key = "_" + name;
	Object.defineProperty(MeshStandardMaterial.prototype, name, {
		get() {
			return this[key] ?? PHYSICAL_DEFAULTS[name];
		},
		set(v) {
			this[key] = v;
			this.version = (this.version || 0) + 1;
		},
		configurable: true
	});
}
var MeshPhongMaterial = class extends MeshStandardMaterial {
	constructor(parameters = {}) {
		super(parameters);
		this.isMeshPhongMaterial = true;
		this.shininess = parameters.shininess ?? 30;
		this.specular = parameters.specular instanceof Color ? parameters.specular : new Color(parameters.specular ?? 1118481);
	}
};
var MeshLambertMaterial = class extends MeshStandardMaterial {
	constructor(parameters = {}) {
		super(parameters);
		this.isMeshLambertMaterial = true;
	}
};
var MeshNormalMaterial = class extends MeshBasicMaterial {
	constructor(parameters = {}) {
		super(parameters);
		this.isMeshNormalMaterial = true;
	}
};
var MeshToonMaterial = class extends MeshStandardMaterial {
	constructor(parameters = {}) {
		super(parameters);
		this.isMeshToonMaterial = true;
		this.gradientMap = parameters.gradientMap ?? null;
	}
};
var MeshDepthMaterial = class extends MeshBasicMaterial {
	constructor(parameters = {}) {
		super(parameters);
		this.isMeshDepthMaterial = true;
		this.depthPacking = parameters.depthPacking ?? 0;
	}
};
var MeshDistanceMaterial = class extends MeshBasicMaterial {
	constructor(parameters = {}) {
		super(parameters);
		this.isMeshDistanceMaterial = true;
		this.referencePosition = parameters.referencePosition ?? null;
		this.near = parameters.near ?? 1;
		this.far = parameters.far ?? 1e3;
	}
};
var ShadowMaterial = class extends Material {
	constructor(parameters = {}) {
		super(parameters);
		this.isShadowMaterial = true;
		this.opacity = parameters.opacity ?? 1;
	}
};
var MeshMatcapMaterial = class extends MeshBasicMaterial {
	constructor(parameters = {}) {
		super(parameters);
		this.isMeshMatcapMaterial = true;
		this.matcap = parameters.matcap ?? null;
	}
};
var SpriteMaterial = class extends MeshBasicMaterial {
	constructor(parameters = {}) {
		super(parameters);
		this.isSpriteMaterial = true;
		this.rotation = parameters.rotation ?? 0;
	}
};
var PointsMaterial = class extends MeshBasicMaterial {
	constructor(parameters = {}) {
		super(parameters);
		this.isPointsMaterial = true;
		this.size = parameters.size ?? 1;
		this.sizeAttenuation = parameters.sizeAttenuation !== false;
	}
};
var LineBasicMaterial = class extends Material {
	constructor(parameters = {}) {
		super(parameters);
		this.isLineBasicMaterial = true;
	}
};
var LineDashedMaterial = class extends LineBasicMaterial {
	constructor(parameters = {}) {
		super(parameters);
		this.isLineDashedMaterial = true;
		this.dashSize = parameters.dashSize ?? 1;
		this.gapSize = parameters.gapSize ?? 1;
		this.scale = parameters.scale ?? 1;
	}
};
var ShaderMaterial = class extends Material {
	constructor(parameters = {}) {
		super(parameters);
		this.isShaderMaterial = true;
		this.defines = parameters.defines ? { ...parameters.defines } : {};
		this.uniforms = parameters.uniforms || {};
		this.vertexShader = parameters.vertexShader || "";
		this.fragmentShader = parameters.fragmentShader || "";
		this.depthWrite = parameters.depthWrite !== false;
		this.depthTest = parameters.depthTest !== false;
		this.blending = parameters.blending ?? 1;
		this.side = parameters.side ?? 0;
		this.transparent = parameters.transparent === true;
	}
};
var RawShaderMaterial = class extends ShaderMaterial {
	constructor(parameters = {}) {
		super(parameters);
		this.isRawShaderMaterial = true;
	}
};

// src/three/bounds.ts
var Plane = class Plane {
	constructor(normal = new Vector3(1, 0, 0), constant = 0) {
		this.isPlane = true;
		this.normal = normal.clone ? normal.clone() : new Vector3(normal.x, normal.y, normal.z);
		this.constant = constant;
	}
	set(normal, constant) {
		this.normal.copy(normal);
		this.constant = constant;
		return this;
	}
	copy(plane) {
		this.normal.copy(plane.normal);
		this.constant = plane.constant;
		return this;
	}
	setComponents(x, y, z, w) {
		this.normal.set(x, y, z);
		this.constant = w;
		return this;
	}
	normalize() {
		const l = this.normal.length() || 1;
		this.normal.multiplyScalar(1 / l);
		this.constant /= l;
		return this;
	}
	distanceToPoint(point) {
		return this.normal.dot(point) + this.constant;
	}
	clone() {
		return new Plane(this.normal.clone(), this.constant);
	}
	equals(plane) {
		return plane.normal.equals(this.normal) && plane.constant === this.constant;
	}
	coplanarPoint(target = new Vector3()) {
		return target.copy(this.normal).multiplyScalar(-this.constant);
	}
	projectPoint(point, target = new Vector3()) {
		const d = this.normal.dot(point) + this.constant;
		return target.copy(point).addScaledVector(this.normal, -d);
	}
	distanceToSphere(sphere) {
		return this.distanceToPoint(sphere.center) - sphere.radius;
	}
	intersectsSphere(sphere) {
		return this.distanceToSphere(sphere) <= 0;
	}
	intersectsBox(box) {
		const n = this.normal;
		const pMin = _planeP1.set(n.x > 0 ? box.min.x : box.max.x, n.y > 0 ? box.min.y : box.max.y, n.z > 0 ? box.min.z : box.max.z);
		const pMax = _planeP2.set(n.x > 0 ? box.max.x : box.min.x, n.y > 0 ? box.max.y : box.min.y, n.z > 0 ? box.max.z : box.min.z);
		return this.distanceToPoint(pMin) <= 0 && this.distanceToPoint(pMax) >= 0;
	}
	intersectsLine(line) {
		const dir = _lineDir.subVectors(line.end, line.start);
		const denom = this.normal.dot(dir);
		if (Math.abs(denom) < 1e-12) return false;
		const t = -(this.normal.dot(line.start) + this.constant) / denom;
		return t >= 0 && t <= 1;
	}
	applyMatrix4(matrix, optionalNormalMatrix) {
		const m = matrix.elements || matrix;
		const px = -this.normal.x * this.constant, py = -this.normal.y * this.constant, pz = -this.normal.z * this.constant;
		const inv = optionalNormalMatrix ? optionalNormalMatrix.elements || optionalNormalMatrix : invertMat4(m);
		if (!inv) return this;
		const e = inv, nx = this.normal.x, ny = this.normal.y, nz = this.normal.z;
		const tx = e[0] * nx + e[4] * ny + e[8] * nz;
		const ty = e[1] * nx + e[5] * ny + e[9] * nz;
		const tz = e[2] * nx + e[6] * ny + e[10] * nz;
		const nl = Math.hypot(tx, ty, tz) || 1;
		this.normal.set(tx / nl, ty / nl, tz / nl);
		const tp = transformPoint(m, px, py, pz);
		this.constant = -(this.normal.x * tp[0] + this.normal.y * tp[1] + this.normal.z * tp[2]);
		return this;
	}
	translate(offset) {
		this.constant += this.normal.dot(offset);
		return this;
	}
	negate() {
		this.constant *= -1;
		this.normal.negate();
		return this;
	}
	setFromNormalAndCoplanarPoint(normal, point) {
		this.normal.copy(normal).normalize();
		this.constant = -this.normal.dot(point);
		return this;
	}
	setFromCoplanarPoints(a, b, c) {
		const ab = _planeN1.subVectors(b, a);
		const ac = _planeN2.subVectors(c, a);
		this.normal.copy(ab.cross(ac).normalize());
		this.constant = -this.normal.dot(a);
		return this;
	}
	intersectLine(line, target = new Vector3()) {
		const dir = _lineDir.subVectors(line.end, line.start);
		const denom = this.normal.dot(dir);
		if (Math.abs(denom) < 1e-12) return null;
		const t = -(this.normal.dot(line.start) + this.constant) / denom;
		if (t < 0 || t > 1) return null;
		return target.copy(line.start).addScaledVector(dir, t);
	}
	static fromNormalAndCoplanarPoint(normal, point) {
		return new Plane(normal.clone(), -normal.dot(point));
	}
	static fromCoplanarPoints(a, b, c) {
		const ab = _planeN1.subVectors(b, a);
		const ac = _planeN2.subVectors(c, a);
		const normal = ab.cross(ac).normalize();
		return new Plane(normal, -normal.dot(a));
	}
};
new Vector3();
const _lineDir = new Vector3();
const _planeP1 = new Vector3();
const _planeP2 = new Vector3();
const _planeN1 = new Vector3();
const _planeN2 = new Vector3();
var Ray = class Ray {
	constructor(origin = new Vector3(), direction = new Vector3(0, 0, -1)) {
		this.origin = origin;
		this.direction = direction;
	}
	set(origin, direction) {
		this.origin.copy(origin);
		this.direction.copy(direction).normalize();
		return this;
	}
	at(t, target = new Vector3()) {
		return target.set(this.origin.x + this.direction.x * t, this.origin.y + this.direction.y * t, this.origin.z + this.direction.z * t);
	}
	intersectPlane(plane, target = new Vector3()) {
		const denom = plane.normal.dot(this.direction);
		if (Math.abs(denom) < 1e-12) return null;
		const t = -(plane.normal.dot(this.origin) + plane.constant) / denom;
		if (t < 0) return null;
		return target.copy(this.origin).addScaledVector(this.direction, t);
	}
	intersectBox(box, target = new Vector3()) {
		const t = rayBoxT(this.origin.x, this.origin.y, this.origin.z, this.direction.x, this.direction.y, this.direction.z, box);
		return t === null ? null : this.at(t, target);
	}
	intersectsBox(box) {
		return rayBoxT(this.origin.x, this.origin.y, this.origin.z, this.direction.x, this.direction.y, this.direction.z, box) !== null;
	}
	intersectSphere(sphere, target = new Vector3()) {
		const t = raySphereT(this.origin.x, this.origin.y, this.origin.z, this.direction.x, this.direction.y, this.direction.z, sphere);
		return t === null ? null : this.at(t, target);
	}
	intersectsSphere(sphere) {
		return raySphereT(this.origin.x, this.origin.y, this.origin.z, this.direction.x, this.direction.y, this.direction.z, sphere) !== null;
	}
	intersectTriangle(a, b, c, backfaceCulling = false, target = new Vector3()) {
		const hit = rayTriangle(this.origin.x, this.origin.y, this.origin.z, this.direction.x, this.direction.y, this.direction.z, a.x, a.y, a.z, b.x, b.y, b.z, c.x, c.y, c.z, backfaceCulling ? 0 : 2);
		return hit ? this.at(hit.t, target) : null;
	}
	lookAt(target) {
		this.direction.subVectors(target, this.origin).normalize();
		return this;
	}
	closestPointToPoint(point, target = new Vector3()) {
		const t = Math.max(0, this.direction.dot(_rayTmp.subVectors(point, this.origin)));
		return this.at(t, target);
	}
	distanceSqToPoint(point) {
		const t = Math.max(0, this.direction.dot(_rayTmp.subVectors(point, this.origin)));
		_rayTmp2.copy(this.origin).addScaledVector(this.direction, t);
		return _rayTmp2.distanceToSquared(point);
	}
	distanceToPoint(point) {
		return Math.sqrt(this.distanceSqToPoint(point));
	}
	applyMatrix4(matrix4) {
		this.origin.applyMatrix4(matrix4);
		this.direction.transformDirection(matrix4);
		return this;
	}
	copy(ray) {
		this.origin.copy(ray.origin);
		this.direction.copy(ray.direction);
		return this;
	}
	clone() {
		return new Ray(this.origin.clone(), this.direction.clone());
	}
	equals(ray) {
		return this.origin.equals(ray.origin) && this.direction.equals(ray.direction);
	}
	distanceToPlane(plane) {
		const denom = plane.normal.dot(this.direction);
		if (Math.abs(denom) < 1e-12) return null;
		return -(plane.normal.dot(this.origin) + plane.constant) / denom;
	}
	intersectsPlane(plane) {
		const dist = this.distanceToPlane(plane);
		return dist !== null && dist >= 0;
	}
	recast(target) {
		this.origin.copy(target);
		return this;
	}
	distanceSqToSegment(v0, v1, optP = new Vector3(), optC = new Vector3()) {
		const d1x = this.direction.x, d1y = this.direction.y, d1z = this.direction.z;
		const d2x = v1.x - v0.x, d2y = v1.y - v0.y, d2z = v1.z - v0.z;
		const rx = this.origin.x - v0.x, ry = this.origin.y - v0.y, rz = this.origin.z - v0.z;
		const a = d1x * d1x + d1y * d1y + d1z * d1z;
		const e = d2x * d2x + d2y * d2y + d2z * d2z;
		const f = d2x * rx + d2y * ry + d2z * rz;
		const c = d1x * rx + d1y * ry + d1z * rz;
		const b = d1x * d2x + d1y * d2y + d1z * d2z;
		const denom = a * e - b * b;
		let t = 0, u = 0;
		if (denom > 1e-12) {
			t = (b * f - c * e) / denom;
			u = (a * f - b * c) / denom;
		} else {
			t = c / (a || 1);
			u = 0;
		}
		t = Math.max(0, t);
		u = Math.max(0, Math.min(1, u));
		optP.copy(this.origin).addScaledVector(this.direction, t);
		optC.set(v0.x + d2x * u, v0.y + d2y * u, v0.z + d2z * u);
		return optP.distanceToSquared(optC);
	}
};
const _rayTmp = new Vector3();
const _rayTmp2 = new Vector3();
var Line3 = class Line3 {
	constructor(start = new Vector3(), end = new Vector3()) {
		this.start = start;
		this.end = end;
		this.isLine3 = true;
	}
	set(start, end) {
		this.start.copy(start);
		this.end.copy(end);
		return this;
	}
	copy(line) {
		this.start.copy(line.start);
		this.end.copy(line.end);
		return this;
	}
	clone() {
		return new Line3(this.start.clone(), this.end.clone());
	}
	equals(line) {
		return this.start.equals(line.start) && this.end.equals(line.end);
	}
	delta(target = new Vector3()) {
		return target.subVectors(this.end, this.start);
	}
	distance() {
		return this.delta(_lineDelta).length();
	}
	distanceSq() {
		return this.delta(_lineDelta).lengthSq();
	}
	at(t, target = new Vector3()) {
		return target.copy(this.start).addScaledVector(_lineDelta.subVectors(this.end, this.start), t);
	}
	closestPointToPoint(point, target = new Vector3()) {
		return this.at(this.closestPointToPointParameter(point), target);
	}
	closestPointToPointParameter(point) {
		_lineDelta.subVectors(this.end, this.start);
		_lineTmp.subVectors(point, this.start);
		const lenSq = _lineDelta.lengthSq();
		return lenSq === 0 ? 0 : Math.max(0, Math.min(1, _lineTmp.dot(_lineDelta) / lenSq));
	}
	applyMatrix4(matrix4) {
		this.start.applyMatrix4(matrix4);
		this.end.applyMatrix4(matrix4);
		return this;
	}
	getCenter(target = new Vector3()) {
		return target.addVectors(this.start, this.end).multiplyScalar(.5);
	}
	distanceSqToLine3(line) {
		this.closestPointToPointParameter;
		const d1 = _l3d1.subVectors(this.end, this.start);
		const d2 = _l3d2.subVectors(line.end, line.start);
		const r = _l3r.subVectors(this.start, line.start);
		const a = d1.dot(d1), e = d2.dot(d2), f = d2.dot(r);
		const c = d1.dot(r), b = d1.dot(d2);
		const denom = a * e - b * b;
		let s = denom > 1e-12 ? (b * f - c * e) / denom : 0;
		let u = e > 1e-12 ? (b * s + f) / e : 0;
		if (u < 0) {
			u = 0;
			s = Math.max(0, Math.min(1, -c / (a || 1)));
		} else if (u > 1) {
			u = 1;
			s = Math.max(0, Math.min(1, (b - c) / (a || 1)));
		}
		s = Math.max(0, Math.min(1, s));
		const p = _l3p.copy(this.start).addScaledVector(d1, s);
		const q = _l3q.copy(line.start).addScaledVector(d2, u);
		return p.distanceToSquared(q);
	}
};
const _l3d1 = new Vector3();
const _l3d2 = new Vector3();
const _l3r = new Vector3();
const _l3p = new Vector3();
const _l3q = new Vector3();
const _lineDelta = new Vector3();
const _lineTmp = new Vector3();
var Box2 = class Box2 {
	constructor(min = new Vector2(1e400, 1e400), max = new Vector2(-1e400, -1e400)) {
		this.min = min;
		this.max = max;
		this.isBox2 = true;
	}
	set(min, max) {
		this.min.copy(min);
		this.max.copy(max);
		return this;
	}
	setFromPoints(points) {
		this.makeEmpty();
		for (const p of points) this.expandByPoint(p);
		return this;
	}
	setFromCenterAndSize(center, size) {
		const half = _box2Half.copy(size).multiplyScalar(.5);
		this.min.copy(center).sub(half);
		this.max.copy(center).add(half);
		return this;
	}
	copy(box) {
		this.min.copy(box.min);
		this.max.copy(box.max);
		return this;
	}
	clone() {
		return new Box2(this.min.clone(), this.max.clone());
	}
	makeEmpty() {
		this.min.set(1e400, 1e400);
		this.max.set(-1e400, -1e400);
		return this;
	}
	isEmpty() {
		return this.max.x < this.min.x || this.max.y < this.min.y;
	}
	getCenter(target = new Vector2()) {
		return this.isEmpty() ? target.set(0, 0) : target.set((this.min.x + this.max.x) / 2, (this.min.y + this.max.y) / 2);
	}
	getSize(target = new Vector2()) {
		return this.isEmpty() ? target.set(0, 0) : target.set(this.max.x - this.min.x, this.max.y - this.min.y);
	}
	expandByPoint(point) {
		this.min.set(Math.min(this.min.x, point.x), Math.min(this.min.y, point.y));
		this.max.set(Math.max(this.max.x, point.x), Math.max(this.max.y, point.y));
		return this;
	}
	expandByScalar(scalar) {
		this.min.set(this.min.x - scalar, this.min.y - scalar);
		this.max.set(this.max.x + scalar, this.max.y + scalar);
		return this;
	}
	expandByVector(vector) {
		this.expandByPoint(_box2Tmp.copy(this.min).add(vector));
		this.expandByPoint(_box2Tmp.copy(this.max).add(vector));
		return this;
	}
	union(box) {
		this.expandByPoint(box.min);
		this.expandByPoint(box.max);
		return this;
	}
	intersect(box) {
		this.min.set(Math.max(this.min.x, box.min.x), Math.max(this.min.y, box.min.y));
		this.max.set(Math.min(this.max.x, box.max.x), Math.min(this.max.y, box.max.y));
		return this;
	}
	containsPoint(point) {
		return point.x >= this.min.x && point.x <= this.max.x && point.y >= this.min.y && point.y <= this.max.y;
	}
	containsBox(box) {
		return box.min.x >= this.min.x && box.max.x <= this.max.x && box.min.y >= this.min.y && box.max.y <= this.max.y;
	}
	intersectsBox(box) {
		return !(box.max.x < this.min.x || box.min.x > this.max.x || box.max.y < this.min.y || box.min.y > this.max.y);
	}
	clampPoint(point, target = new Vector2()) {
		return target.set(Math.max(this.min.x, Math.min(point.x, this.max.x)), Math.max(this.min.y, Math.min(point.y, this.max.y)));
	}
	distanceToPoint(point) {
		const dx = Math.max(this.min.x - point.x, 0, point.x - this.max.x);
		const dy = Math.max(this.min.y - point.y, 0, point.y - this.max.y);
		return Math.hypot(dx, dy);
	}
	translate(offset) {
		this.min.add(offset);
		this.max.add(offset);
		return this;
	}
	equals(box) {
		return box.min.equals(this.min) && box.max.equals(this.max);
	}
	getParameter(point, target = new Vector2()) {
		return this.isEmpty() ? target.set(0, 0) : target.set((point.x - this.min.x) / (this.max.x - this.min.x || 1), (point.y - this.min.y) / (this.max.y - this.min.y || 1));
	}
};
const _box2Half = new Vector2();
const _box2Tmp = new Vector2();
function rayBoxT(ox, oy, oz, dx, dy, dz, box) {
	if (!box || box.isEmpty()) return null;
	let tmin = -1e400, tmax = 1e400;
	const mins = [
		box.min.x,
		box.min.y,
		box.min.z
	];
	const maxs = [
		box.max.x,
		box.max.y,
		box.max.z
	];
	const orig = [
		ox,
		oy,
		oz
	];
	const dir = [
		dx,
		dy,
		dz
	];
	for (let i = 0; i < 3; i++) if (Math.abs(dir[i]) < 1e-12) {
		if (orig[i] < mins[i] || orig[i] > maxs[i]) return null;
	} else {
		const inv = 1 / dir[i];
		let t1 = (mins[i] - orig[i]) * inv;
		let t2 = (maxs[i] - orig[i]) * inv;
		if (t1 > t2) {
			const tmp = t1;
			t1 = t2;
			t2 = tmp;
		}
		if (t1 > tmin) tmin = t1;
		if (t2 < tmax) tmax = t2;
		if (tmin > tmax) return null;
	}
	if (tmax < 0) return null;
	return tmin >= 0 ? tmin : tmax;
}
function raySphereT(ox, oy, oz, dx, dy, dz, sphere) {
	if (!sphere || sphere.radius < 0) return null;
	const vx = sphere.center.x - ox, vy = sphere.center.y - oy, vz = sphere.center.z - oz;
	const tca = vx * dx + vy * dy + vz * dz;
	const d2 = vx * vx + vy * vy + vz * vz - tca * tca;
	const r2 = sphere.radius * sphere.radius;
	if (d2 > r2) return null;
	const thc = Math.sqrt(r2 - d2);
	const t0 = tca - thc;
	const t1 = tca + thc;
	if (t1 < 0) return null;
	return t0 < 0 ? t1 : t0;
}
function rayTriangle(ox, oy, oz, dx, dy, dz, ax, ay, az, bx, by, bz, cx, cy, cz, side = 2) {
	const e1x = bx - ax, e1y = by - ay, e1z = bz - az;
	const e2x = cx - ax, e2y = cy - ay, e2z = cz - az;
	const px = dy * e2z - dz * e2y, py = dz * e2x - dx * e2z, pz = dx * e2y - dy * e2x;
	const det = e1x * px + e1y * py + e1z * pz;
	if (side === 0) {
		if (det < 1e-12) return null;
	} else if (side === 1) {
		if (det > -1e-12) return null;
	} else if (Math.abs(det) < 1e-12) return null;
	const inv = 1 / det;
	const tx = ox - ax, ty = oy - ay, tz = oz - az;
	const u = (tx * px + ty * py + tz * pz) * inv;
	if (u < 0 || u > 1) return null;
	const qx = ty * e1z - tz * e1y, qy = tz * e1x - tx * e1z, qz = tx * e1y - ty * e1x;
	const v = (dx * qx + dy * qy + dz * qz) * inv;
	if (v < 0 || u + v > 1) return null;
	const t = (e2x * qx + e2y * qy + e2z * qz) * inv;
	return t >= 0 ? {
		t,
		u,
		v
	} : null;
}
var Sphere = class Sphere {
	constructor(center = new Vector3(), radius = -1) {
		this.center = center;
		this.radius = radius;
		this.isSphere = true;
		this.isBoundingSphere = true;
	}
	set(center, radius) {
		this.center.copy(center);
		this.radius = radius;
		return this;
	}
	copy(sphere) {
		this.center.copy(sphere.center);
		this.radius = sphere.radius;
		return this;
	}
	clone() {
		return new Sphere(this.center.clone(), this.radius);
	}
	isEmpty() {
		return this.radius < 0;
	}
	makeEmpty() {
		this.center.set(0, 0, 0);
		this.radius = -1;
		return this;
	}
	containsPoint(point) {
		if (this.radius < 0) return false;
		const dx = point.x - this.center.x, dy = point.y - this.center.y, dz = point.z - this.center.z;
		return dx * dx + dy * dy + dz * dz <= this.radius * this.radius;
	}
	distanceToPoint(point) {
		const dx = point.x - this.center.x, dy = point.y - this.center.y, dz = point.z - this.center.z;
		return Math.hypot(dx, dy, dz) - this.radius;
	}
	intersectsSphere(sphere) {
		if (this.radius < 0 || sphere.radius < 0) return false;
		const r = this.radius + sphere.radius;
		const dx = sphere.center.x - this.center.x, dy = sphere.center.y - this.center.y, dz = sphere.center.z - this.center.z;
		return dx * dx + dy * dy + dz * dz <= r * r;
	}
	intersectsBox(box) {
		return box.intersectsSphere(this);
	}
	getBoundingBox(target = new Box3()) {
		if (this.isEmpty()) return target.makeEmpty();
		target.min.set(this.center.x - this.radius, this.center.y - this.radius, this.center.z - this.radius);
		target.max.set(this.center.x + this.radius, this.center.y + this.radius, this.center.z + this.radius);
		return target;
	}
	setFromPoints(points, optionalCenter = null) {
		if (optionalCenter) this.center.copy(optionalCenter);
		else new Box3().setFromPoints(points).getCenter(this.center);
		let maxR2 = 0;
		for (const p of points) {
			const dx = p.x - this.center.x, dy = p.y - this.center.y, dz = p.z - this.center.z;
			maxR2 = Math.max(maxR2, dx * dx + dy * dy + dz * dz);
		}
		this.radius = points.length ? Math.sqrt(maxR2) : -1;
		return this;
	}
	expandByPoint(point) {
		if (this.isEmpty()) {
			this.center.copy(point);
			this.radius = 0;
			return this;
		}
		const dx = point.x - this.center.x, dy = point.y - this.center.y, dz = point.z - this.center.z;
		const dist = Math.hypot(dx, dy, dz);
		if (dist <= this.radius) return this;
		const newRadius = (this.radius + dist) / 2;
		const k = (newRadius - this.radius) / (dist || 1);
		this.center.x += dx * k;
		this.center.y += dy * k;
		this.center.z += dz * k;
		this.radius = newRadius;
		return this;
	}
	expandByVector(vector) {
		this.expandByPoint(_sphereTmp.copy(this.center).add(vector));
		this.expandByPoint(_sphereTmp.copy(this.center).sub(vector));
		return this;
	}
	expandByScalar(scalar) {
		this.radius += scalar;
		return this;
	}
	union(sphere) {
		if (sphere.isEmpty()) return this;
		if (this.isEmpty()) return this.copy(sphere);
		const d = this.center.distanceTo(sphere.center);
		if (d + sphere.radius <= this.radius) return this;
		if (d + this.radius <= sphere.radius) return this.copy(sphere);
		const newRadius = (this.radius + d + sphere.radius) / 2;
		const k = (newRadius - this.radius) / (d || 1);
		this.center.lerp(sphere.center, k);
		this.radius = newRadius;
		return this;
	}
	intersection(sphere) {
		if (sphere.isEmpty()) return this.makeEmpty();
		if (this.isEmpty()) return this;
		const d = this.center.distanceTo(sphere.center);
		if (d + sphere.radius <= this.radius) return this;
		if (d + this.radius <= sphere.radius) return this.copy(sphere);
		const newRadius = (this.radius + d - sphere.radius) / 2;
		const k = (this.radius - newRadius) / (d || 1);
		this.center.lerp(sphere.center, k);
		this.radius = Math.max(0, newRadius);
		return this;
	}
	setFromBox3(box) {
		return this.setFromPoints([box.min, box.max]);
	}
	clampPoint(point, target = new Vector3()) {
		const d = _sphereTmp.subVectors(point, this.center);
		const l = d.length();
		if (l <= this.radius || l === 0) return target.copy(point);
		return target.copy(this.center).addScaledVector(d, this.radius / l);
	}
	getCenter(target = new Vector3()) {
		return target.copy(this.center);
	}
	translate(offset) {
		this.center.add(offset);
		return this;
	}
	applyMatrix4(matrix) {
		this.center.applyMatrix4(matrix);
		const scale = Math.hypot((matrix.elements || matrix)[0], (matrix.elements || matrix)[1], (matrix.elements || matrix)[2]);
		this.radius *= Math.abs(scale) || 1;
		return this;
	}
	equals(sphere) {
		return sphere.center.equals(this.center) && sphere.radius === this.radius;
	}
	intersectsPlane(plane) {
		return plane.distanceToSphere(this) <= 0;
	}
	toJSON() {
		return {
			center: this.center.toArray(),
			radius: this.radius
		};
	}
	fromJSON(json) {
		if (json.center) this.center.fromArray(json.center);
		this.radius = json.radius ?? -1;
		return this;
	}
};
const _sphereTmp = new Vector3();
const _box3Tmp = new Vector3();
const _box3Tmp2 = new Vector3();
var Box3 = class Box3 {
	constructor(min = new Vector3(1e400, 1e400, 1e400), max = new Vector3(-1e400, -1e400, -1e400)) {
		this.min = min;
		this.max = max;
		this.isBox3 = true;
	}
	set(min, max) {
		this.min.copy(min);
		this.max.copy(max);
		return this;
	}
	copy(box) {
		this.min.copy(box.min);
		this.max.copy(box.max);
		return this;
	}
	makeEmpty() {
		this.min.set(1e400, 1e400, 1e400);
		this.max.set(-1e400, -1e400, -1e400);
		return this;
	}
	isEmpty() {
		return this.max.x < this.min.x || this.max.y < this.min.y || this.max.z < this.min.z;
	}
	setFromArray(array) {
		this.makeEmpty();
		for (let i = 0; i + 2 < array.length; i += 3) {
			const x = array[i], y = array[i + 1], z = array[i + 2];
			if (x < this.min.x) this.min.x = x;
			if (x > this.max.x) this.max.x = x;
			if (y < this.min.y) this.min.y = y;
			if (y > this.max.y) this.max.y = y;
			if (z < this.min.z) this.min.z = z;
			if (z > this.max.z) this.max.z = z;
		}
		return this;
	}
	setFromPoints(points) {
		this.makeEmpty();
		for (const p of points) this.expandByPoint(p);
		return this;
	}
	intersectsSphere(sphere) {
		if (this.isEmpty() || sphere.isEmpty()) return false;
		const cx = Math.max(this.min.x, Math.min(sphere.center.x, this.max.x));
		const cy = Math.max(this.min.y, Math.min(sphere.center.y, this.max.y));
		const cz = Math.max(this.min.z, Math.min(sphere.center.z, this.max.z));
		const dx = cx - sphere.center.x, dy = cy - sphere.center.y, dz = cz - sphere.center.z;
		return dx * dx + dy * dy + dz * dz <= sphere.radius * sphere.radius;
	}
	getCenter(target = new Vector3()) {
		return this.isEmpty() ? target.set(0, 0, 0) : target.set((this.min.x + this.max.x) / 2, (this.min.y + this.max.y) / 2, (this.min.z + this.max.z) / 2);
	}
	getSize(target = new Vector3()) {
		return this.isEmpty() ? target.set(0, 0, 0) : target.set(this.max.x - this.min.x, this.max.y - this.min.y, this.max.z - this.min.z);
	}
	expandByPoint(point) {
		this.min.set(Math.min(this.min.x, point.x), Math.min(this.min.y, point.y), Math.min(this.min.z, point.z));
		this.max.set(Math.max(this.max.x, point.x), Math.max(this.max.y, point.y), Math.max(this.max.z, point.z));
		return this;
	}
	expandByScalar(scalar) {
		this.min.set(this.min.x - scalar, this.min.y - scalar, this.min.z - scalar);
		this.max.set(this.max.x + scalar, this.max.y + scalar, this.max.z + scalar);
		return this;
	}
	translate(offset) {
		this.min.add(offset);
		this.max.add(offset);
		return this;
	}
	applyMatrix4(matrix) {
		if (this.isEmpty()) return this;
		const m = matrix.elements || matrix;
		const x0 = this.min.x, y0 = this.min.y, z0 = this.min.z;
		const x1 = this.max.x, y1 = this.max.y, z1 = this.max.z;
		this.makeEmpty();
		for (let cx = 0; cx <= 1; cx++) for (let cy = 0; cy <= 1; cy++) for (let cz = 0; cz <= 1; cz++) {
			const w = transformPoint(m, cx ? x1 : x0, cy ? y1 : y0, cz ? z1 : z0);
			this.expandByPoint(new Vector3(w[0], w[1], w[2]));
		}
		return this;
	}
	containsPoint(point) {
		return point.x >= this.min.x && point.x <= this.max.x && point.y >= this.min.y && point.y <= this.max.y && point.z >= this.min.z && point.z <= this.max.z;
	}
	intersectsBox(box) {
		return !(box.max.x < this.min.x || box.min.x > this.max.x || box.max.y < this.min.y || box.min.y > this.max.y || box.max.z < this.min.z || box.min.z > this.max.z);
	}
	containsBox(box) {
		return box.min.x >= this.min.x && box.max.x <= this.max.x && box.min.y >= this.min.y && box.max.y <= this.max.y && box.min.z >= this.min.z && box.max.z <= this.max.z;
	}
	containsSphere(sphere) {
		return this.containsPoint(_box3Tmp.copy(sphere.center).add(_box3Tmp2.set(sphere.radius, sphere.radius, sphere.radius))) && this.containsPoint(_box3Tmp.copy(sphere.center).sub(_box3Tmp2));
	}
	setFromCenterAndSize(center, size) {
		const half = _box3Tmp.copy(size).multiplyScalar(.5);
		this.min.copy(center).sub(half);
		this.max.copy(center).add(half);
		return this;
	}
	union(box) {
		this.expandByPoint(box.min);
		this.expandByPoint(box.max);
		return this;
	}
	intersection(box) {
		this.min.set(Math.max(this.min.x, box.min.x), Math.max(this.min.y, box.min.y), Math.max(this.min.z, box.min.z));
		this.max.set(Math.min(this.max.x, box.max.x), Math.min(this.max.y, box.max.y), Math.min(this.max.z, box.max.z));
		return this;
	}
	expandByVector(vector) {
		this.expandByPoint(_box3Tmp.copy(this.min).add(vector));
		this.expandByPoint(_box3Tmp.copy(this.max).add(vector));
		return this;
	}
	getBoundingSphere(target = new Sphere()) {
		if (this.isEmpty()) return target.makeEmpty();
		this.getCenter(target.center);
		const sz = this.getSize(_box3Tmp);
		target.radius = Math.hypot(sz.x, sz.y, sz.z) * .5;
		return target;
	}
	clampPoint(point, target = new Vector3()) {
		return target.set(Math.max(this.min.x, Math.min(point.x, this.max.x)), Math.max(this.min.y, Math.min(point.y, this.max.y)), Math.max(this.min.z, Math.min(point.z, this.max.z)));
	}
	distanceToPoint(point) {
		const dx = Math.max(this.min.x - point.x, 0, point.x - this.max.x);
		const dy = Math.max(this.min.y - point.y, 0, point.y - this.max.y);
		const dz = Math.max(this.min.z - point.z, 0, point.z - this.max.z);
		return Math.hypot(dx, dy, dz);
	}
	equals(box) {
		return box.min.equals(this.min) && box.max.equals(this.max);
	}
	clone() {
		return new Box3(this.min.clone(), this.max.clone());
	}
	setFromObject(object) {
		this.makeEmpty();
		const expandBox = (box, world) => {
			for (let cx = 0; cx <= 1; cx++) for (let cy = 0; cy <= 1; cy++) for (let cz = 0; cz <= 1; cz++) {
				const w = transformPoint(world, cx ? box.max.x : box.min.x, cy ? box.max.y : box.min.y, cz ? box.max.z : box.min.z);
				this.expandByPoint(new Vector3(w[0], w[1], w[2]));
			}
		};
		object.traverse((node) => {
			if (!node.isMesh && !node.isInstancedMesh || !node.geometry || !node.geometry.attributes || !node.geometry.attributes.position) return;
			const geometry = node.geometry;
			if (!geometry.boundingBox) geometry.computeBoundingBox();
			if (!geometry.boundingBox || geometry.boundingBox.isEmpty()) return;
			const world = worldMatrixOf(node);
			if (node.isInstancedMesh) {
				const count = Math.min(node.count, node._maxCount);
				const arr = node.instanceMatrix.array;
				for (let i = 0; i < count; i++) expandBox(geometry.boundingBox, multiplyMat4(world, arr.subarray(i * 16, i * 16 + 16)));
			} else expandBox(geometry.boundingBox, world);
		});
		return this;
	}
	expandByObject(object) {
		this.makeEmpty();
		object.updateWorldMatrix(false, true);
		object.traverse((node) => {
			if (!node.isMesh && !node.isInstancedMesh || !node.geometry || !node.geometry.attributes || !node.geometry.attributes.position) return;
			if (!node.geometry.boundingBox) node.geometry.computeBoundingBox();
			if (node.geometry.boundingBox) {
				const b = node.geometry.boundingBox;
				const w = worldMatrixOf(node);
				for (const p of [b.min, b.max]) {
					const t = transformPoint(w, p.x, p.y, p.z);
					this.expandByPoint(new Vector3(t[0], t[1], t[2]));
				}
			}
		});
		return this;
	}
	setFromBufferAttribute(attribute) {
		this.makeEmpty();
		const a = attribute.array, s = attribute.itemSize || 3;
		for (let i = 0; i + 2 < a.length; i += s) this.expandByPoint(new Vector3(a[i], a[i + 1], a[i + 2]));
		return this;
	}
	getParameter(point, targetAxis = "x") {
		const axis = targetAxis === "y" ? 1 : targetAxis === "z" ? 2 : 0;
		return this.isEmpty() ? void 0 : (point[axis === 0 ? "x" : axis === 1 ? "y" : "z"] - this.min[axis === 0 ? "x" : axis === 1 ? "y" : "z"]) / (this.max[axis === 0 ? "x" : axis === 1 ? "y" : "z"] - this.min[axis === 0 ? "x" : axis === 1 ? "y" : "z"] || 1);
	}
	intersectsPlane(plane) {
		const n = plane.normal;
		const pMin = _planeP1.set(n.x > 0 ? this.min.x : this.max.x, n.y > 0 ? this.min.y : this.max.y, n.z > 0 ? this.min.z : this.max.z);
		const pMax = _planeP2.set(n.x > 0 ? this.max.x : this.min.x, n.y > 0 ? this.max.y : this.min.y, n.z > 0 ? this.max.z : this.min.z);
		return plane.distanceToPoint(pMin) <= 0 && plane.distanceToPoint(pMax) >= 0;
	}
	intersectsTriangle(triangle) {
		const plane = triangle.getPlane ? triangle.getPlane(new Plane()) : null;
		if (plane && !this.intersectsPlane(plane)) return false;
		for (const p of [
			triangle.a,
			triangle.b,
			triangle.c
		]) if (this.containsPoint(p)) return true;
		return false;
	}
	intersect(box) {
		return this.intersection(box.clone ? box.clone() : box);
	}
	toJSON() {
		return {
			min: this.min.toArray(),
			max: this.max.toArray()
		};
	}
	fromJSON(json) {
		if (json.min) this.min.fromArray(json.min);
		if (json.max) this.max.fromArray(json.max);
		return this;
	}
};
var Triangle = class Triangle {
	constructor(a = new Vector3(), b = new Vector3(), c = new Vector3()) {
		this.a = a;
		this.b = b;
		this.c = c;
		this.isTriangle = true;
	}
	set(a, b, c) {
		this.a.copy(a);
		this.b.copy(b);
		this.c.copy(c);
		return this;
	}
	setFromPointsAndIndices(points, i0, i1, i2) {
		this.a.copy(points[i0]);
		this.b.copy(points[i1]);
		this.c.copy(points[i2]);
		return this;
	}
	setFromAttributeAndIndices(attribute, i0, i1, i2) {
		const p = attribute.array, s = attribute.itemSize || 3;
		this.a.set(p[i0 * s], p[i0 * s + 1], p[i0 * s + 2]);
		this.b.set(p[i1 * s], p[i1 * s + 1], p[i1 * s + 2]);
		this.c.set(p[i2 * s], p[i2 * s + 1], p[i2 * s + 2]);
		return this;
	}
	clone() {
		return new Triangle(this.a.clone(), this.b.clone(), this.c.clone());
	}
	getArea() {
		return area3(this.a, this.b, this.c);
	}
	getMidpoint(target = new Vector3()) {
		return target.addVectors(this.a, this.b).add(this.c).multiplyScalar(1 / 3);
	}
	getNormal(target = new Vector3()) {
		target.subVectors(this.c, this.b);
		const cb = target.clone();
		target.subVectors(this.a, this.b);
		target.cross(cb);
		const l = target.length();
		return l > 0 ? target.multiplyScalar(1 / l) : target.set(0, 0, 0);
	}
	getPlane(target) {
		const normal = this.getNormal(new Vector3());
		const constant = -normal.dot(this.a);
		if (target && target.set) return target.set(normal, constant);
		return new Plane(normal, constant);
	}
	getBarycoord(point, target = new Vector3()) {
		const v0 = _v0.subVectors(this.c, this.a);
		const v1 = _v1.subVectors(this.b, this.a);
		const v2 = _v2.subVectors(point, this.a);
		const d00 = v0.dot(v0), d01 = v0.dot(v1), d11 = v1.dot(v1);
		const d20 = v2.dot(v0), d21 = v2.dot(v1);
		const denom = d00 * d11 - d01 * d01;
		if (Math.abs(denom) < 1e-12) return target.set(-1, -1, -1);
		const v = (d11 * d20 - d01 * d21) / denom;
		const w = (d00 * d21 - d01 * d20) / denom;
		return target.set(1 - v - w, v, w);
	}
	containsPoint(point) {
		const bary = this.getBarycoord(point);
		return bary.x >= -1e-10 && bary.y >= -1e-10 && bary.z >= -1e-10;
	}
	getUV(point, uv1, uv2, uv3, target = new Vector3()) {
		this.getBarycoord(point, target);
		const v = target.y, w = target.z;
		return target.set(uv1.x + v * (uv2.x - uv1.x) + w * (uv3.x - uv1.x), uv1.y + v * (uv2.y - uv1.y) + w * (uv3.y - uv1.y), 0);
	}
	closestPointToPoint(point, target = new Vector3()) {
		const a = this.a, b = this.b, c = this.c;
		const ab = _v0.subVectors(b, a), ac = _v1.subVectors(c, a), ap = _v2.subVectors(point, a);
		const d1 = ab.dot(ap), d2 = ac.dot(ap);
		if (d1 <= 0 && d2 <= 0) return target.copy(a);
		const bp = _v3.subVectors(point, b);
		const d3 = ab.dot(bp), d4 = ac.dot(bp);
		if (d3 >= 0 && d4 <= d3) return target.copy(b);
		const vc = d1 * d4 - d3 * d2;
		if (vc <= 0 && d1 >= 0 && d3 <= 0) {
			const v = d1 / (d1 - d3);
			return target.copy(a).addScaledVector(ab, v);
		}
		const cp = _v3.subVectors(point, c);
		const d5 = ab.dot(cp), d6 = ac.dot(cp);
		if (d6 >= 0 && d5 <= d6) return target.copy(c);
		const vb = d5 * d2 - d1 * d6;
		if (vb <= 0 && d2 >= 0 && d6 <= 0) {
			const w = d2 / (d2 - d6);
			return target.copy(a).addScaledVector(ac, w);
		}
		const va = d3 * d6 - d5 * d4;
		if (va <= 0 && d4 - d3 >= 0 && d5 - d6 >= 0) {
			const w = (d4 - d3) / (d4 - d3 + (d5 - d6));
			return target.copy(b).addScaledVector(_v4.subVectors(c, b), w);
		}
		const denom = 1 / (va + vb + vc);
		const v = vb * denom, w = vc * denom;
		return target.copy(a).addScaledVector(ab, v).addScaledVector(ac, w);
	}
	isFrontFacing(direction) {
		return this.getNormal(_v0).dot(direction) < 0;
	}
	equals(triangle) {
		return this.a.equals(triangle.a) && this.b.equals(triangle.b) && this.c.equals(triangle.c);
	}
	copy(triangle) {
		this.a.copy(triangle.a);
		this.b.copy(triangle.b);
		this.c.copy(triangle.c);
		return this;
	}
	getInterpolation(target = new Vector3()) {
		return this.getMidpoint(target);
	}
	intersectsBox(box) {
		const plane = this.getPlane(new Plane());
		const dMin = Math.min(plane.distanceToPoint(box.min), plane.distanceToPoint(box.max), plane.distanceToPoint(new Vector3(box.min.x, box.max.y, box.min.z)), plane.distanceToPoint(new Vector3(box.min.x, box.min.y, box.max.z)), plane.distanceToPoint(new Vector3(box.max.x, box.min.y, box.min.z)), plane.distanceToPoint(new Vector3(box.max.x, box.max.y, box.min.z)), plane.distanceToPoint(new Vector3(box.min.x, box.max.y, box.max.z)), plane.distanceToPoint(new Vector3(box.max.x, box.min.y, box.max.z)));
		const dMax = Math.max(plane.distanceToPoint(box.min), plane.distanceToPoint(box.max), plane.distanceToPoint(new Vector3(box.min.x, box.max.y, box.min.z)), plane.distanceToPoint(new Vector3(box.min.x, box.min.y, box.max.z)), plane.distanceToPoint(new Vector3(box.max.x, box.min.y, box.min.z)), plane.distanceToPoint(new Vector3(box.max.x, box.max.y, box.min.z)), plane.distanceToPoint(new Vector3(box.min.x, box.max.y, box.max.z)), plane.distanceToPoint(new Vector3(box.max.x, box.min.y, box.max.z)));
		if (dMin > 0 || dMax < 0) return false;
		for (const p of [
			this.a,
			this.b,
			this.c
		]) if (box.containsPoint(p)) return true;
		const n = plane.normal;
		Math.abs(n.x) > Math.abs(n.y) && Math.abs(n.x) > Math.abs(n.z) || (Math.abs(n.y), Math.abs(n.z));
		const corners = [
			[
				box.min.x,
				box.min.y,
				box.min.z
			],
			[
				box.max.x,
				box.min.y,
				box.min.z
			],
			[
				box.min.x,
				box.max.y,
				box.min.z
			],
			[
				box.max.x,
				box.max.y,
				box.min.z
			],
			[
				box.min.x,
				box.min.y,
				box.max.z
			],
			[
				box.max.x,
				box.min.y,
				box.max.z
			],
			[
				box.min.x,
				box.max.y,
				box.max.z
			],
			[
				box.max.x,
				box.max.y,
				box.max.z
			]
		];
		for (const c of corners) {
			const pt = new Vector3(c[0], c[1], c[2]);
			if (this.closestPointToPoint(pt, new Vector3()).distanceToSquared(pt) < 1e-12) return true;
		}
		return false;
	}
};
function area3(a, b, c) {
	const ux = b.x - a.x, uy = b.y - a.y, uz = b.z - a.z;
	const vx = c.x - a.x, vy = c.y - a.y, vz = c.z - a.z;
	const cx = uy * vz - uz * vy, cy = uz * vx - ux * vz, cz = ux * vy - uy * vx;
	return Math.hypot(cx, cy, cz) * .5;
}
const _v0 = new Vector3();
const _v1 = new Vector3();
const _v2 = new Vector3();
const _v3 = new Vector3();
const _v4 = new Vector3();
var Frustum = class Frustum {
	constructor(p0 = new Plane(), p1 = new Plane(), p2 = new Plane(), p3 = new Plane(), p4 = new Plane(), p5 = new Plane()) {
		this.isFrustum = true;
		this.planes = [
			p0,
			p1,
			p2,
			p3,
			p4,
			p5
		];
	}
	set(p0, p1, p2, p3, p4, p5) {
		const planes = this.planes;
		planes[0].copy(p0);
		planes[1].copy(p1);
		planes[2].copy(p2);
		planes[3].copy(p3);
		planes[4].copy(p4);
		planes[5].copy(p5);
		return this;
	}
	clone() {
		return new Frustum(...this.planes.map((p) => p.clone ? p.clone() : new Plane(p.normal.clone(), p.constant)));
	}
	copy(frustum) {
		for (let i = 0; i < 6; i++) this.planes[i].copy(frustum.planes[i]);
		return this;
	}
	setFromProjectionMatrix(m) {
		const me = m.elements || m;
		const planes = this.planes;
		planes[0].setComponents(me[3] - me[0], me[7] - me[4], me[11] - me[8], me[15] - me[12]).normalize();
		planes[1].setComponents(me[3] + me[0], me[7] + me[4], me[11] + me[8], me[15] + me[12]).normalize();
		planes[2].setComponents(me[3] + me[1], me[7] + me[5], me[11] + me[9], me[15] + me[13]).normalize();
		planes[3].setComponents(me[3] - me[1], me[7] - me[5], me[11] - me[9], me[15] - me[13]).normalize();
		planes[4].setComponents(me[3] - me[2], me[7] - me[6], me[11] - me[10], me[15] - me[14]).normalize();
		planes[5].setComponents(me[3] + me[2], me[7] + me[6], me[11] + me[10], me[15] + me[14]).normalize();
		return this;
	}
	intersectsSphere(sphere) {
		const center = sphere.center;
		for (const plane of this.planes) if (plane.normal.dot(center) + plane.constant < -sphere.radius) return false;
		return true;
	}
	containsSphere(sphere) {
		const center = sphere.center;
		for (const plane of this.planes) if (plane.normal.dot(center) + plane.constant < sphere.radius) return false;
		return true;
	}
	containsPoint(point) {
		for (const plane of this.planes) if (plane.normal.dot(point) + plane.constant < 0) return false;
		return true;
	}
	intersectsBox(box) {
		for (const plane of this.planes) {
			const n = plane.normal;
			const p = _boxPoint;
			p.set(n.x > 0 ? box.max.x : box.min.x, n.y > 0 ? box.max.y : box.min.y, n.z > 0 ? box.max.z : box.min.z);
			if (n.dot(p) + plane.constant < 0) return false;
		}
		return true;
	}
	intersectsObject(object) {
		if (object.geometry) {
			if (!object.geometry.boundingSphere) object.geometry.computeBoundingSphere();
			const bs = object.geometry.boundingSphere;
			if (bs) {
				const ws = object.getWorldScale ? object.getWorldScale(new Vector3()) : new Vector3(1, 1, 1);
				const r = bs.radius * Math.max(ws.x, ws.y, ws.z);
				const c = bs.center.clone().applyMatrix4(worldMatrixOf(object));
				return this.intersectsSphere(new Sphere(c, r));
			}
		}
		return true;
	}
	intersectsSprite() {
		return true;
	}
};
const _boxPoint = new Vector3();

// src/three/primitives.ts
function gridGeometry(nu, nv, vertexAt, uvAt, flip = false) {
	const positions = [], normals = [], uvs = [], indices = [];
	for (let j = 0; j <= nv; j++) for (let i = 0; i <= nu; i++) {
		const u = i / nu, v = j / nv;
		const [x, y, z, nx, ny, nz] = vertexAt(u, v);
		positions.push(x, y, z);
		normals.push(nx, ny, nz);
		const [tu, tv] = uvAt(u, v);
		uvs.push(tu, tv);
	}
	const stride = nu + 1;
	for (let j = 0; j < nv; j++) for (let i = 0; i < nu; i++) {
		const a = j * stride + i, b = a + 1, c = a + stride, d = c + 1;
		if (flip) indices.push(a, c, b, b, c, d);
		else indices.push(a, b, c, b, d, c);
	}
	return {
		positions,
		normals,
		uvs,
		indices
	};
}
function makeGeometry(data) {
	const geometry = new BufferGeometry();
	geometry.setAttribute("position", new Float32BufferAttribute(data.positions, 3));
	geometry.setAttribute("normal", new Float32BufferAttribute(data.normals, 3));
	geometry.setAttribute("uv", new Float32BufferAttribute(data.uvs, 2));
	geometry.setIndex(new Uint32BufferAttribute(data.indices, 1));
	return geometry;
}
var BoxGeometry = class extends BufferGeometry {
	constructor(width = 1, height = 1, depth = 1, widthSegments = 1, heightSegments = 1, depthSegments = 1) {
		super();
		const positions = [], normals = [], uvs = [], indices = [];
		const hw = width / 2, hh = height / 2, hd = depth / 2;
		const face = (nu, nv, normal, build) => {
			const base = positions.length / 3;
			for (let j = 0; j <= nv; j++) for (let i = 0; i <= nu; i++) {
				const [p, uv] = build(i / nu, j / nv);
				positions.push(p[0], p[1], p[2]);
				normals.push(normal[0], normal[1], normal[2]);
				uvs.push(uv[0], uv[1]);
			}
			const stride = nu + 1;
			for (let j = 0; j < nv; j++) for (let i = 0; i < nu; i++) {
				const a = base + j * stride + i;
				indices.push(a, a + 1, a + stride, a + 1, a + stride + 1, a + stride);
			}
		};
		face(depthSegments, heightSegments, [
			1,
			0,
			0
		], (u, v) => [[
			hw,
			(.5 - v) * height,
			(u - .5) * depth
		], [u, v]]);
		face(depthSegments, heightSegments, [
			-1,
			0,
			0
		], (u, v) => [[
			-hw,
			(.5 - v) * height,
			(.5 - u) * depth
		], [u, v]]);
		face(widthSegments, depthSegments, [
			0,
			1,
			0
		], (u, v) => [[
			(u - .5) * width,
			hh,
			(.5 - v) * depth
		], [u, v]]);
		face(widthSegments, depthSegments, [
			0,
			-1,
			0
		], (u, v) => [[
			(u - .5) * width,
			-hh,
			(v - .5) * depth
		], [u, v]]);
		face(widthSegments, heightSegments, [
			0,
			0,
			1
		], (u, v) => [[
			(u - .5) * width,
			(v - .5) * height,
			hd
		], [u, v]]);
		face(widthSegments, heightSegments, [
			0,
			0,
			-1
		], (u, v) => [[
			(.5 - u) * width,
			(v - .5) * height,
			-hd
		], [u, v]]);
		this.setAttribute("position", new Float32BufferAttribute(positions, 3));
		this.setAttribute("normal", new Float32BufferAttribute(normals, 3));
		this.setAttribute("uv", new Float32BufferAttribute(uvs, 2));
		this.setIndex(new Uint32BufferAttribute(indices, 1));
	}
};
var SphereGeometry = class extends BufferGeometry {
	constructor(radius = 1, widthSegments = 32, heightSegments = 16, phiStart = 0, phiLength = Math.PI * 2, thetaStart = 0, thetaLength = Math.PI) {
		super();
		const g = makeGeometry(gridGeometry(widthSegments, heightSegments, (u, v) => {
			const phi = phiStart + u * phiLength;
			const theta = thetaStart + v * thetaLength;
			const x = -radius * Math.cos(phi) * Math.sin(theta);
			const y = radius * Math.cos(theta);
			const z = radius * Math.sin(phi) * Math.sin(theta);
			const l = radius || 1;
			return [
				x,
				y,
				z,
				x / l,
				y / l,
				z / l
			];
		}, (u, v) => [u, 1 - v], true));
		this.attributes = g.attributes;
		this.index = g.index;
		this.version++;
	}
};
var PlaneGeometry = class extends BufferGeometry {
	constructor(width = 1, height = 1, widthSegments = 1, heightSegments = 1) {
		super();
		const g = makeGeometry(gridGeometry(widthSegments, heightSegments, (u, v) => [
			(u - .5) * width,
			(.5 - v) * height,
			0,
			0,
			0,
			1
		], (u, v) => [u, 1 - v], true));
		this.attributes = g.attributes;
		this.index = g.index;
		this.version++;
	}
};
var CircleGeometry = class extends BufferGeometry {
	constructor(radius = 1, segments = 32, thetaStart = 0, thetaLength = Math.PI * 2) {
		super();
		const positions = [
			0,
			0,
			0
		], normals = [
			0,
			0,
			1
		], uvs = [.5, .5], indices = [];
		for (let i = 0; i <= segments; i++) {
			const theta = thetaStart + i / segments * thetaLength;
			positions.push(Math.cos(theta) * radius, Math.sin(theta) * radius, 0);
			normals.push(0, 0, 1);
			uvs.push(Math.cos(theta) * .5 + .5, Math.sin(theta) * .5 + .5);
		}
		for (let i = 1; i <= segments; i++) indices.push(0, i, i + 1);
		this.setAttribute("position", new Float32BufferAttribute(positions, 3));
		this.setAttribute("normal", new Float32BufferAttribute(normals, 3));
		this.setAttribute("uv", new Float32BufferAttribute(uvs, 2));
		this.setIndex(new Uint32BufferAttribute(indices, 1));
	}
};
var RingGeometry = class extends BufferGeometry {
	constructor(innerRadius = .5, outerRadius = 1, thetaSegments = 32, phiSegments = 1, thetaStart = 0, thetaLength = Math.PI * 2) {
		super();
		const positions = [], normals = [], uvs = [], indices = [];
		for (let j = 0; j <= phiSegments; j++) for (let i = 0; i <= thetaSegments; i++) {
			const theta = thetaStart + i / thetaSegments * thetaLength;
			j / phiSegments * Math.PI;
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
		this.setAttribute("position", new Float32BufferAttribute(positions, 3));
		this.setAttribute("normal", new Float32BufferAttribute(normals, 3));
		this.setAttribute("uv", new Float32BufferAttribute(uvs, 2));
		this.setIndex(new Uint32BufferAttribute(indices, 1));
	}
};
var CylinderGeometry = class extends BufferGeometry {
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
		if (!openEnded) for (const [y, r, ny] of [[
			half,
			radiusTop,
			1
		], [
			-half,
			radiusBottom,
			-1
		]]) {
			if (r <= 0) continue;
			const center = positions.length / 3;
			positions.push(0, y, 0);
			normals.push(0, ny, 0);
			uvs.push(.5, .5);
			const ringStart = positions.length / 3;
			for (let i = 0; i <= radialSegments; i++) {
				const theta = thetaStart + i / radialSegments * thetaLength;
				positions.push(Math.cos(theta) * r, y, Math.sin(theta) * r);
				normals.push(0, ny, 0);
				uvs.push(Math.cos(theta) * .5 + .5, Math.sin(theta) * .5 + .5);
			}
			for (let i = 0; i < radialSegments; i++) if (ny > 0) indices.push(center, ringStart + i + 1, ringStart + i);
			else indices.push(center, ringStart + i, ringStart + i + 1);
		}
		this.setAttribute("position", new Float32BufferAttribute(positions, 3));
		this.setAttribute("normal", new Float32BufferAttribute(normals, 3));
		this.setAttribute("uv", new Float32BufferAttribute(uvs, 2));
		this.setIndex(new Uint32BufferAttribute(indices, 1));
	}
};
var TorusGeometry = class extends BufferGeometry {
	constructor(radius = 1, tube = .4, radialSegments = 12, tubularSegments = 48, arc = Math.PI * 2) {
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
		this.setAttribute("position", new Float32BufferAttribute(positions, 3));
		this.setAttribute("normal", new Float32BufferAttribute(normals, 3));
		this.setAttribute("uv", new Float32BufferAttribute(uvs, 2));
		this.setIndex(new Uint32BufferAttribute(indices, 1));
	}
};
var ConeGeometry = class extends CylinderGeometry {
	constructor(radius = 1, height = 1, radialSegments = 32, heightSegments = 1, openEnded = false, thetaStart = 0, thetaLength = Math.PI * 2) {
		super(radius, 0, height, radialSegments, heightSegments, openEnded, thetaStart, thetaLength);
		this.isConeGeometry = true;
	}
};
var CapsuleGeometry = class extends BufferGeometry {
	constructor(radius = .5, length = 1, capSegments = 8, radialSegments = 16) {
		super();
		const halfLen = length / 2;
		const positions = [], normals = [], uvs = [], indices = [];
		capSegments * 2 + 1;
		const profile = [];
		for (let i = 1; i <= capSegments * 2; i++) {
			const t = i / (capSegments * 2);
			const phi = -Math.PI / 2 + t * Math.PI;
			profile.push(phi);
		}
		const rows = profile.length;
		for (let j = 0; j <= rows; j++) {
			const phi = j === 0 ? -Math.PI / 2 : j === rows ? Math.PI / 2 : profile[j - 1];
			const cy = Math.sin(phi) * radius + (phi < 0 ? -halfLen : phi > 0 ? halfLen : 0);
			const ringR = Math.cos(phi) * radius;
			for (let i = 0; i <= radialSegments; i++) {
				const theta = i / radialSegments * Math.PI * 2;
				const c = Math.cos(theta), s = Math.sin(theta);
				positions.push(c * ringR, cy, s * ringR);
				const ny = Math.sin(phi);
				normals.push(c * Math.cos(phi), ny, s * Math.cos(phi));
				uvs.push(i / radialSegments, j / rows);
			}
		}
		const bottomCenter = positions.length / 3;
		positions.push(0, -halfLen - radius, 0);
		normals.push(0, -1, 0);
		uvs.push(.5, 0);
		const topCenter = positions.length / 3;
		positions.push(0, halfLen + radius, 0);
		normals.push(0, 1, 0);
		uvs.push(.5, 1);
		const stride = radialSegments + 1;
		for (let j = 0; j < rows; j++) for (let i = 0; i < radialSegments; i++) {
			const a = j * stride + i;
			indices.push(a, a + stride, a + 1, a + 1, a + stride, a + stride + 1);
		}
		for (let i = 0; i < radialSegments; i++) indices.push(bottomCenter, stride + i, stride + i + 1);
		const lastRing = rows * stride;
		for (let i = 0; i < radialSegments; i++) indices.push(topCenter, lastRing + i + 1, lastRing + i);
		this.setAttribute("position", new Float32BufferAttribute(positions, 3));
		this.setAttribute("normal", new Float32BufferAttribute(normals, 3));
		this.setAttribute("uv", new Float32BufferAttribute(uvs, 2));
		this.setIndex(new Uint32BufferAttribute(indices, 1));
	}
};
var PolyhedronGeometry = class extends BufferGeometry {
	constructor(vertices, indices, radius = 1, detail = 0) {
		super();
		let verts = vertices.map((v) => {
			const l = Math.hypot(v[0], v[1], v[2]) || 1;
			return [
				v[0] / l * radius,
				v[1] / l * radius,
				v[2] / l * radius
			];
		});
		let faces = [];
		for (let i = 0; i < indices.length; i += 3) {
			let [a, b, c] = [
				indices[i],
				indices[i + 1],
				indices[i + 2]
			];
			const ab = [
				verts[b][0] - verts[a][0],
				verts[b][1] - verts[a][1],
				verts[b][2] - verts[a][2]
			];
			const ac = [
				verts[c][0] - verts[a][0],
				verts[c][1] - verts[a][1],
				verts[c][2] - verts[a][2]
			];
			const n = [
				ab[1] * ac[2] - ab[2] * ac[1],
				ab[2] * ac[0] - ab[0] * ac[2],
				ab[0] * ac[1] - ab[1] * ac[0]
			];
			const cx = (verts[a][0] + verts[b][0] + verts[c][0]) / 3;
			const cy = (verts[a][1] + verts[b][1] + verts[c][1]) / 3;
			const cz = (verts[a][2] + verts[b][2] + verts[c][2]) / 3;
			if (n[0] * cx + n[1] * cy + n[2] * cz < 0) [b, c] = [c, b];
			faces.push([
				a,
				b,
				c
			]);
		}
		const midpointCache = /* @__PURE__ */ new Map();
		const midpoint = (i, j) => {
			const key = i < j ? `${i},${j}` : `${j},${i}`;
			if (midpointCache.has(key)) return midpointCache.get(key);
			const a = verts[i], b = verts[j];
			const m = [
				(a[0] + b[0]) / 2,
				(a[1] + b[1]) / 2,
				(a[2] + b[2]) / 2
			];
			const l = Math.hypot(...m) || 1;
			const idx = verts.length;
			verts.push([
				m[0] / l * radius,
				m[1] / l * radius,
				m[2] / l * radius
			]);
			midpointCache.set(key, idx);
			return idx;
		};
		for (let d = 0; d < detail; d++) {
			const next = [];
			midpointCache.clear();
			for (const [a, b, c] of faces) {
				const ab = midpoint(a, b), bc = midpoint(b, c), ca = midpoint(c, a);
				next.push([
					a,
					ab,
					ca
				], [
					b,
					bc,
					ab
				], [
					c,
					ca,
					bc
				], [
					ab,
					bc,
					ca
				]);
			}
			faces = next;
		}
		const positions = [], normals = [], uvs = [], indexList = [];
		for (const [a, b, c] of faces) {
			const base = positions.length / 3;
			for (const vi of [
				a,
				b,
				c
			]) {
				const v = verts[vi];
				positions.push(v[0], v[1], v[2]);
				const l = Math.hypot(v[0], v[1], v[2]) || 1;
				normals.push(v[0] / l, v[1] / l, v[2] / l);
				uvs.push(Math.atan2(v[2], v[0]) / (Math.PI * 2) + .5, Math.acos(Math.max(-1, Math.min(1, v[1] / l))) / Math.PI);
			}
			indexList.push(base, base + 1, base + 2);
		}
		this.setAttribute("position", new Float32BufferAttribute(positions, 3));
		this.setAttribute("normal", new Float32BufferAttribute(normals, 3));
		this.setAttribute("uv", new Float32BufferAttribute(uvs, 2));
		this.setIndex(new Uint32BufferAttribute(indexList, 1));
		this.isPolyhedronGeometry = true;
	}
};
var TetrahedronGeometry = class extends PolyhedronGeometry {
	constructor(radius = 1, detail = 0) {
		super([
			[
				1,
				1,
				1
			],
			[
				1,
				-1,
				-1
			],
			[
				-1,
				1,
				-1
			],
			[
				-1,
				-1,
				1
			]
		], [
			0,
			1,
			2,
			0,
			3,
			1,
			0,
			2,
			3,
			1,
			3,
			2
		], radius, detail);
		this.isTetrahedronGeometry = true;
	}
};
var OctahedronGeometry = class extends PolyhedronGeometry {
	constructor(radius = 1, detail = 0) {
		super([
			[
				1,
				0,
				0
			],
			[
				-1,
				0,
				0
			],
			[
				0,
				1,
				0
			],
			[
				0,
				-1,
				0
			],
			[
				0,
				0,
				1
			],
			[
				0,
				0,
				-1
			]
		], [
			0,
			2,
			4,
			2,
			1,
			4,
			1,
			3,
			4,
			3,
			0,
			4,
			2,
			0,
			5,
			1,
			2,
			5,
			3,
			1,
			5,
			0,
			3,
			5
		], radius, detail);
		this.isOctahedronGeometry = true;
	}
};
const PHI = (1 + Math.sqrt(5)) / 2;
const ICO_VERTS = [
	[
		0,
		1,
		PHI
	],
	[
		0,
		1,
		-PHI
	],
	[
		0,
		-1,
		PHI
	],
	[
		0,
		-1,
		-PHI
	],
	[
		1,
		PHI,
		0
	],
	[
		1,
		-PHI,
		0
	],
	[
		-1,
		PHI,
		0
	],
	[
		-1,
		-PHI,
		0
	],
	[
		PHI,
		0,
		1
	],
	[
		-PHI,
		0,
		1
	],
	[
		PHI,
		0,
		-1
	],
	[
		-PHI,
		0,
		-1
	]
];
const ICO_FACES = [
	0,
	11,
	5,
	0,
	5,
	1,
	0,
	1,
	7,
	0,
	7,
	10,
	0,
	10,
	11,
	1,
	5,
	9,
	5,
	11,
	4,
	11,
	10,
	2,
	10,
	7,
	6,
	7,
	1,
	8,
	3,
	9,
	4,
	3,
	4,
	2,
	3,
	2,
	6,
	3,
	6,
	8,
	3,
	8,
	9,
	4,
	9,
	5,
	2,
	4,
	11,
	6,
	2,
	10,
	8,
	6,
	7,
	9,
	8,
	1
];
var IcosahedronGeometry = class extends PolyhedronGeometry {
	constructor(radius = 1, detail = 0) {
		super(ICO_VERTS, ICO_FACES, radius, detail);
		this.isIcosahedronGeometry = true;
	}
};
function dodecahedronData() {
	const norm = (v) => {
		const l = Math.hypot(v[0], v[1], v[2]) || 1;
		return [
			v[0] / l,
			v[1] / l,
			v[2] / l
		];
	};
	const icoFaces = [];
	for (let i = 0; i < ICO_FACES.length; i += 3) icoFaces.push([
		ICO_FACES[i],
		ICO_FACES[i + 1],
		ICO_FACES[i + 2]
	]);
	const verts = icoFaces.map((f) => norm([
		(ICO_VERTS[f[0]][0] + ICO_VERTS[f[1]][0] + ICO_VERTS[f[2]][0]) / 3,
		(ICO_VERTS[f[0]][1] + ICO_VERTS[f[1]][1] + ICO_VERTS[f[2]][1]) / 3,
		(ICO_VERTS[f[0]][2] + ICO_VERTS[f[1]][2] + ICO_VERTS[f[2]][2]) / 3
	]));
	const incident = ICO_VERTS.map(() => []);
	icoFaces.forEach((f, fi) => {
		for (const vi of f) incident[vi].push(fi);
	});
	const tris = [];
	incident.forEach((faces, vi) => {
		const axis = norm(ICO_VERTS[vi]);
		const ref = Math.abs(axis[1]) < .9 ? [
			0,
			1,
			0
		] : [
			1,
			0,
			0
		];
		const u = norm([
			axis[1] * ref[2] - axis[2] * ref[1],
			axis[2] * ref[0] - axis[0] * ref[2],
			axis[0] * ref[1] - axis[1] * ref[0]
		]);
		const w = [
			axis[1] * u[2] - axis[2] * u[1],
			axis[2] * u[0] - axis[0] * u[2],
			axis[0] * u[1] - axis[1] * u[0]
		];
		const ordered = faces.slice().sort((p, q) => {
			const cp = [
				verts[p][1] * axis[2] - verts[p][2] * axis[1],
				verts[p][2] * axis[0] - verts[p][0] * axis[2],
				verts[p][0] * axis[1] - verts[p][1] * axis[0]
			];
			const angle = (v3) => Math.atan2(v3[0] * w[0] + v3[1] * w[1] + v3[2] * w[2], v3[0] * u[0] + v3[1] * u[1] + v3[2] * u[2]);
			return angle(cp) - angle([
				verts[q][1] * axis[2] - verts[q][2] * axis[1],
				verts[q][2] * axis[0] - verts[q][0] * axis[2],
				verts[q][0] * axis[1] - verts[q][1] * axis[0]
			]);
		});
		for (let i = 1; i < ordered.length - 1; i++) tris.push(ordered[0], ordered[i], ordered[i + 1]);
	});
	return {
		verts,
		tris
	};
}
var DodecahedronGeometry = class extends PolyhedronGeometry {
	constructor(radius = 1, detail = 0) {
		const { verts, tris } = dodecahedronData();
		super(verts, tris, radius, detail);
		this.isDodecahedronGeometry = true;
	}
};
var TorusKnotGeometry = class extends BufferGeometry {
	constructor(radius = 1, tube = .4, tubularSegments = 64, radialSegments = 8, p = 2, q = 3) {
		super();
		const positions = [], normals = [], uvs = [], indices = [];
		const curve = (u) => {
			const a = p * u * Math.PI * 2, b = q * u * Math.PI * 2;
			const r = 2 + Math.cos(b);
			return [
				r * Math.cos(a) * radius,
				r * Math.sin(a) * radius,
				Math.sin(b) * radius
			];
		};
		const eps = 1e-4;
		const frames = [];
		for (let j = 0; j <= tubularSegments; j++) {
			const u = j / tubularSegments;
			const P = curve(u);
			const P2 = curve(Math.min(1, u + eps));
			const T = normalize3([
				P2[0] - P[0],
				P2[1] - P[1],
				P2[2] - P[2]
			]);
			const up = Math.abs(T[1]) < .9 ? [
				0,
				1,
				0
			] : [
				1,
				0,
				0
			];
			const N = normalize3([
				T[1] * up[2] - T[2] * up[1],
				T[2] * up[0] - T[0] * up[2],
				T[0] * up[1] - T[1] * up[0]
			]);
			const B = [
				T[1] * N[2] - T[2] * N[1],
				T[2] * N[0] - T[0] * N[2],
				T[0] * N[1] - T[1] * N[0]
			];
			frames.push([
				P,
				T,
				N,
				B
			]);
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
		this.setAttribute("position", new Float32BufferAttribute(positions, 3));
		this.setAttribute("normal", new Float32BufferAttribute(normals, 3));
		this.setAttribute("uv", new Float32BufferAttribute(uvs, 2));
		this.setIndex(new Uint32BufferAttribute(indices, 1));
		this.isTorusKnotGeometry = true;
	}
};
var TubeGeometry = class extends BufferGeometry {
	constructor(path, tubularSegments = 64, radius = 1, radialSegments = 8, closed = false) {
		super();
		const getPoint = (t) => {
			const p = path.getPoint ? path.getPoint(t) : path.getPointAt ? path.getPointAt(t) : null;
			if (!p) throw new Error("gs3d: TubeGeometry path needs getPoint(t)");
			return Array.isArray(p) ? p : [
				p.x,
				p.y,
				p.z
			];
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
			const T = normalize3([
				P2[0] - P[0],
				P2[1] - P[1],
				P2[2] - P[2]
			]);
			const up = Math.abs(T[1]) < .9 ? [
				0,
				1,
				0
			] : [
				1,
				0,
				0
			];
			const N = normalize3([
				T[1] * up[2] - T[2] * up[1],
				T[2] * up[0] - T[0] * up[2],
				T[0] * up[1] - T[1] * up[0]
			]);
			const B = [
				T[1] * N[2] - T[2] * N[1],
				T[2] * N[0] - T[0] * N[2],
				T[0] * N[1] - T[1] * N[0]
			];
			frames.push([
				P,
				N,
				B
			]);
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
			const last = (rings - 1) * stride, first = 0;
			for (let i = 0; i < radialSegments; i++) {
				indices.push(last + i, first + i, last + i + 1);
				indices.push(last + i + 1, first + i, first + i + 1);
			}
		}
		this.setAttribute("position", new Float32BufferAttribute(positions, 3));
		this.setAttribute("normal", new Float32BufferAttribute(normals, 3));
		this.setAttribute("uv", new Float32BufferAttribute(uvs, 2));
		this.setIndex(new Uint32BufferAttribute(indices, 1));
		this.isTubeGeometry = true;
	}
};
var LatheGeometry = class extends BufferGeometry {
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
			const phi = phiStart + j / segments * phiLength;
			const c = Math.cos(phi), s = Math.sin(phi);
			for (let i = 0; i < n; i++) normals.push(ringNormals[i][0] * c, ringNormals[i][1], ringNormals[i][0] * s);
		}
		const stride = n;
		for (let j = 0; j < segments; j++) for (let i = 0; i < n - 1; i++) {
			const a = j * stride + i;
			indices.push(a, a + stride, a + 1, a + 1, a + stride, a + stride + 1);
		}
		this.setAttribute("position", new Float32BufferAttribute(positions, 3));
		this.setAttribute("normal", new Float32BufferAttribute(normals, 3));
		this.setAttribute("uv", new Float32BufferAttribute(uvs, 2));
		this.setIndex(new Uint32BufferAttribute(indices, 1));
		this.isLatheGeometry = true;
	}
};
function edgePositions(geometry, dedupe) {
	const pos = geometry.attributes.position;
	const index = geometry.index;
	const p = pos.array, is = pos.itemSize || 3;
	const triCount = index ? index.count / 3 : pos.count / 3;
	const out = [];
	const key = (a, b) => a < b ? a * 4294967296 + b : b * 4294967296 + a;
	const seen = /* @__PURE__ */ new Set();
	const push = (a, b) => {
		if (dedupe) {
			const k = key(a, b);
			if (seen.has(k)) return;
			seen.add(k);
		}
		out.push(p[a * is], p[a * is + 1], p[a * is + 2], p[b * is], p[b * is + 1], p[b * is + 2]);
	};
	for (let t = 0; t < triCount; t++) {
		const i0 = index ? index.array[t * 3] : t * 3;
		const i1 = index ? index.array[t * 3 + 1] : t * 3 + 1;
		const i2 = index ? index.array[t * 3 + 2] : t * 3 + 2;
		push(i0, i1);
		push(i1, i2);
		push(i2, i0);
	}
	return out;
}
var WireframeGeometry = class extends BufferGeometry {
	constructor(geometry, thresholdAngle = 1) {
		super();
		this.isWireframeGeometry = true;
		this.setAttribute("position", new Float32BufferAttribute(edgePositions(geometry, false), 3));
	}
};
var EdgesGeometry = class extends BufferGeometry {
	constructor(geometry, thresholdAngle = 1) {
		super();
		this.isEdgesGeometry = true;
		const thresholdDot = Math.cos(thresholdAngle * Math.PI / 180);
		const pos = geometry.attributes.position;
		const index = geometry.index;
		const p = pos.array, is = pos.itemSize || 3;
		const out = [];
		const edgeFaces = /* @__PURE__ */ new Map();
		const vkey = (a, b) => a < b ? a * 4294967296 + b : b * 4294967296 + a;
		const faceNormal = (ia, ib, ic) => {
			const ax = p[ia * is], ay = p[ia * is + 1], az = p[ia * is + 2];
			const e1x = p[ib * is] - ax, e1y = p[ib * is + 1] - ay, e1z = p[ib * is + 2] - az;
			const e2x = p[ic * is] - ax, e2y = p[ic * is + 1] - ay, e2z = p[ic * is + 2] - az;
			let nx = e1y * e2z - e1z * e2y, ny = e1z * e2x - e1x * e2z, nz = e1x * e2y - e1y * e2x;
			const l = Math.hypot(nx, ny, nz) || 1;
			return [
				nx / l,
				ny / l,
				nz / l
			];
		};
		const triCount = index ? index.count / 3 : pos.count / 3;
		for (let t = 0; t < triCount; t++) {
			const i0 = index ? index.array[t * 3] : t * 3;
			const i1 = index ? index.array[t * 3 + 1] : t * 3 + 1;
			const i2 = index ? index.array[t * 3 + 2] : t * 3 + 2;
			const n = faceNormal(i0, i1, i2);
			for (const [a, b] of [
				[i0, i1],
				[i1, i2],
				[i2, i0]
			]) {
				const k = vkey(a, b);
				const prev = edgeFaces.get(k);
				if (prev === void 0) edgeFaces.set(k, {
					a,
					b,
					n,
					count: 1,
					emitted: false
				});
				else {
					prev.count++;
					if (!prev.emitted && prev.count === 2) {
						if (prev.n[0] * n[0] + prev.n[1] * n[1] + prev.n[2] * n[2] <= thresholdDot) {
							prev.emitted = true;
							out.push(p[prev.a * is], p[prev.a * is + 1], p[prev.a * is + 2], p[prev.b * is], p[prev.b * is + 1], p[prev.b * is + 2]);
						}
					}
				}
			}
		}
		for (const e of edgeFaces.values()) if (e.count === 1) out.push(p[e.a * is], p[e.a * is + 1], p[e.a * is + 2], p[e.b * is], p[e.b * is + 1], p[e.b * is + 2]);
		this.setAttribute("position", new Float32BufferAttribute(out, 3));
	}
};

// src/three/helpers.ts
function lineGeometry(positions, colors) {
	const g = new BufferGeometry();
	g.setAttribute("position", new Float32BufferAttribute(positions, 3));
	if (colors) g.setAttribute("color", new Float32BufferAttribute(colors, 3));
	return g;
}
var AxesHelper = class extends LineSegments {
	constructor(size = 1) {
		const positions = [
			0,
			0,
			0,
			size,
			0,
			0,
			0,
			0,
			0,
			0,
			size,
			0,
			0,
			0,
			0,
			0,
			0,
			size
		];
		const colors = [
			1,
			0,
			0,
			1,
			0,
			0,
			0,
			1,
			0,
			0,
			1,
			0,
			0,
			0,
			1,
			0,
			0,
			1
		];
		const material = new LineBasicMaterial({ vertexColors: true });
		super(lineGeometry(positions, colors), material);
		this.isAxesHelper = true;
	}
	setColors() {
		return this;
	}
};
var GridHelper = class extends LineSegments {
	constructor(size = 10, divisions = 10, color1 = 4473924, color2 = 8947848) {
		const positions = [];
		const half = size / 2;
		const step = size / divisions;
		const c = new Color();
		for (let i = 0; i <= divisions; i++) {
			const p = -half + i * step;
			const major = i % Math.max(1, Math.round(divisions / 10)) === 0;
			c.set(major ? color2 : color1);
			positions.push(-half, 0, p, half, 0, p);
			positions.push(p, 0, -half, p, 0, half);
		}
		super(lineGeometry(positions), new LineBasicMaterial({ color: 0xffffff }));
		this.isGridHelper = true;
		this.size = size;
		this.divisions = divisions;
	}
};
var ArrowHelper = class extends Object3D {
	constructor(dir = new Vector3(0, 1, 0), origin = new Vector3(), length = 1, headLength = .2, headWidth = .1) {
		super();
		this.isArrowHelper = true;
		this.origin = origin.clone ? origin.clone() : new Vector3().copy(origin);
		this.direction = dir.clone ? dir.clone() : new Vector3().copy(dir);
		this.length = length;
		this.headLength = headLength;
		this.headWidth = headWidth;
		Math.max(1e-4, length - headLength);
		const shaftR = headWidth * .25;
		this._shaftR = shaftR;
		this._headR = headWidth * .5;
		this._baseHeadLen = Math.max(1e-4, headLength);
		this._baseShaftLen = Math.max(1e-4, length - this._baseHeadLen);
		this.line = new Mesh(new CylinderGeometry(shaftR, shaftR, this._baseShaftLen, 8), new MeshBasicMaterial({ color: 0xffff00 }));
		this.line.position.y = this._baseShaftLen / 2;
		this.cone = new Mesh(new ConeGeometry(this._headR, this._baseHeadLen, 12), new MeshBasicMaterial({ color: 0xffff00 }));
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
		if (headLength !== void 0) this.headLength = headLength;
		if (headWidth !== void 0) this.headWidth = headWidth;
		this.length = length;
		const shaftLen = Math.max(1e-4, length - this.headLength);
		const shaftScale = shaftLen / this._baseShaftLen;
		this.line.scale.set(1, shaftScale, 1);
		this.line.position.y = this._baseShaftLen * shaftScale / 2;
		const headScaleY = this.headLength / this._baseHeadLen;
		const headScaleR = this.headWidth / (this._headR * 2);
		this.cone.scale.set(headScaleR, headScaleY, headScaleR);
		this.cone.position.y = shaftLen + this._baseHeadLen * headScaleY / 2;
		return this;
	}
	setColor() {
		return this;
	}
};
var Bone = class extends Object3D {
	constructor() {
		super();
		this.isBone = true;
		this.type = "Bone";
	}
};
var Skeleton = class Skeleton {
	constructor(bones = [], boneInverses = []) {
		this.isSkeleton = true;
		this.bones = bones;
		this.boneInverses = boneInverses.length ? boneInverses : bones.map(() => null);
		this.init();
	}
	init() {
		for (let i = 0; i < this.bones.length; i++) if (!this.boneInverses[i] && this.bones[i].matrixWorld) {
			const m = this.bones[i].matrixWorld;
			this.boneInverses[i] = m.invert ? m.invert() : m;
		}
		return this;
	}
	calculateInverses() {
		return this.init();
	}
	getBoneByName(name) {
		return this.bones.find((b) => b.name === name) || null;
	}
	pose() {
		return this;
	}
	update() {}
	computeBoneTexture() {
		return null;
	}
	dispose() {
		this.bones = [];
		this.boneInverses = [];
	}
	clone() {
		return new Skeleton(this.bones.map((b) => b), this.boneInverses.map((m) => m && m.clone ? m.clone() : m));
	}
	toJSON() {
		return {
			bones: this.bones.map((b) => b.uuid),
			boneInverses: this.boneInverses.map((m) => m && m.toArray ? m.toArray() : null)
		};
	}
	fromJSON(json) {
		this.boneInverses = (json.boneInverses || []).map((a) => a);
		return this;
	}
};
var SkinnedMesh = class extends Mesh {
	constructor(geometry, material) {
		super(geometry, material);
		this.isSkinnedMesh = true;
		this.bindMode = "attached";
		this.bindMatrix = null;
		this.bindMatrixInverse = null;
		this.skeleton = null;
	}
	bind(skeleton, bindMatrix) {
		this.skeleton = skeleton;
		if (bindMatrix) this.bindMatrix = bindMatrix.clone ? bindMatrix.clone() : bindMatrix;
		return this;
	}
	pose() {
		return this;
	}
	applyBoneTransform(index, vector) {
		return vector;
	}
	normalizeSkinWeights() {
		return this;
	}
	updateMatrixWorld(force) {
		return super.updateMatrixWorld(force);
	}
};
var CameraHelper = class extends LineSegments {
	constructor(camera) {
		super(lineGeometry(HELPER_FRUSTUM_POSITIONS), new LineBasicMaterial({
			color: 0xffff00,
			depthTest: false
		}));
		this.isCameraHelper = true;
		this.camera = camera;
		this.type = "CameraHelper";
	}
	update() {
		return this;
	}
	setColors() {
		return this;
	}
};
var DirectionalLightHelper = class extends Object3D {
	constructor(light, size = 1, color) {
		super();
		this.isDirectionalLightHelper = true;
		this.light = light;
		this.type = "DirectionalLightHelper";
		const h = new CameraHelper(light.shadow?.camera || light);
		h.material.color.set(color ?? 0xffff00);
		this.add(h);
	}
	update() {
		return this;
	}
	dispose() {}
};
var PointLightHelper = class extends CameraHelper {
	constructor(light, sphereSize = 1, color) {
		const r = sphereSize;
		const positions = [
			r,
			0,
			0,
			-r,
			0,
			0,
			0,
			r,
			0,
			0,
			-r,
			0,
			0,
			0,
			r,
			0,
			0,
			-r,
			r,
			0,
			0,
			0,
			r,
			0,
			-r,
			0,
			0,
			0,
			-r,
			0,
			0,
			0,
			r,
			0,
			0,
			-r
		];
		super({
			updateProjectionMatrix() {},
			near: 0,
			far: 1
		});
		this.geometry = lineGeometry(positions);
		this.isPointLightHelper = true;
		this.light = light;
		if (color !== void 0) this.material.color.set(color);
		this.type = "PointLightHelper";
	}
	getVertexPosition(index, target) {
		return target.set ? target.set(0, 0, 0) : target;
	}
};
var SpotLightHelper = class extends Object3D {
	constructor(light, color) {
		super();
		this.isSpotLightHelper = true;
		this.light = light;
		this.type = "SpotLightHelper";
		const h = new CameraHelper(light.shadow?.camera || light);
		if (color !== void 0) h.material.color.set(color);
		this.add(h);
	}
	update() {
		return this;
	}
	dispose() {}
};
var BoxHelper = class extends LineSegments {
	constructor(object = null, color = 0xffff00) {
		super(lineGeometry(BOX_EDGES), new LineBasicMaterial({
			color,
			depthTest: false
		}));
		this.isBoxHelper = true;
		this.type = "BoxHelper";
		this.object = object;
	}
	update() {
		return this;
	}
	setFromObject() {
		return this;
	}
};
var Box3Helper = class extends LineSegments {
	constructor(box, color = 0xffff00) {
		super(lineGeometry(BOX_EDGES), new LineBasicMaterial({
			color,
			depthTest: false
		}));
		this.isBox3Helper = true;
		this.type = "Box3Helper";
		this.box = box;
	}
	update() {
		return this;
	}
};
var PlaneHelper = class extends LineSegments {
	constructor(plane, size = 1, divisions = 1, color1 = 4473924, color2 = 8947848) {
		const positions = [];
		for (let i = 0; i <= divisions; i++) {
			const t = -size / 2 + i / divisions * size;
			positions.push(t, 0, -size / 2, t, 0, size / 2);
			positions.push(-size / 2, 0, t, size / 2, 0, t);
		}
		super(lineGeometry(positions), new LineBasicMaterial({ color: 0xffffff }));
		this.isPlaneHelper = true;
		this.type = "PlaneHelper";
		this.plane = plane;
		this.size = size;
		this.divisions = divisions;
		this.quaternion.setFromUnitVectors(new Vector3(0, 0, 1), plane.normal.clone().normalize());
		this.position.copy(plane.coplanarPoint(new Vector3()));
	}
	update() {
		return this;
	}
};
var PolarGridHelper = class extends LineSegments {
	constructor(radius = 10, sectors = 16, rings = 8, divisions = 64, color1 = 4473924, color2 = 8947848) {
		const positions = [];
		for (let r = 1; r <= rings; r++) {
			const rad = radius * r / rings;
			for (let s = 0; s < divisions; s++) {
				const a0 = s / divisions * Math.PI * 2, a1 = (s + 1) / divisions * Math.PI * 2;
				positions.push(Math.cos(a0) * rad, 0, Math.sin(a0) * rad, Math.cos(a1) * rad, 0, Math.sin(a1) * rad);
			}
		}
		for (let s = 0; s < sectors; s++) {
			const a = s / sectors * Math.PI * 2;
			positions.push(0, 0, 0, Math.cos(a) * radius, 0, Math.sin(a) * radius);
		}
		super(lineGeometry(positions), new LineBasicMaterial({ color: 0xffffff }));
		this.isPolarGridHelper = true;
		this.type = "PolarGridHelper";
	}
};
var SkeletonHelper = class extends LineSegments {
	constructor(object) {
		super(lineGeometry([]), new LineBasicMaterial({
			color: 65280,
			depthTest: false
		}));
		this.isSkeletonHelper = true;
		this.type = "SkeletonHelper";
		this.object = object;
	}
	update() {
		return this;
	}
	setColors() {
		return this;
	}
};
const BOX_EDGES = (() => {
	const p = [];
	const c = [
		[
			-1,
			-1,
			-1
		],
		[
			1,
			-1,
			-1
		],
		[
			1,
			1,
			-1
		],
		[
			-1,
			1,
			-1
		],
		[
			-1,
			-1,
			1
		],
		[
			1,
			-1,
			1
		],
		[
			1,
			1,
			1
		],
		[
			-1,
			1,
			1
		]
	];
	for (const [a, b] of [
		[0, 1],
		[1, 2],
		[2, 3],
		[3, 0],
		[4, 5],
		[5, 6],
		[6, 7],
		[7, 4],
		[0, 4],
		[1, 5],
		[2, 6],
		[3, 7]
	]) p.push(...c[a], ...c[b]);
	return p;
})();
const HELPER_FRUSTUM_POSITIONS = (() => {
	const n = [
		[
			-1,
			-1,
			-1
		],
		[
			1,
			-1,
			-1
		],
		[
			1,
			1,
			-1
		],
		[
			-1,
			1,
			-1
		]
	];
	const f = [
		[
			-1,
			-1,
			1
		],
		[
			1,
			-1,
			1
		],
		[
			1,
			1,
			1
		],
		[
			-1,
			1,
			1
		]
	];
	const p = [];
	const link = (a, b) => p.push(...a, ...b);
	for (let i = 0; i < 4; i++) {
		link(n[i], n[(i + 1) % 4]);
		link(f[i], f[(i + 1) % 4]);
		link(n[i], f[i]);
	}
	return p;
})();

// src/three/shapes.ts
var Curve = class {
	constructor() {
		this.arcLengthDivisions = 200;
		this.needsUpdate = true;
		this._lengths = null;
		this._lengthPts = null;
		this._lengthsDiv = 0;
	}
	getPoint(t) {
		return [
			0,
			0,
			0
		];
	}
	_pt(p) {
		return Array.isArray(p) ? p : [
			p.x ?? 0,
			p.y ?? 0,
			p.z ?? 0
		];
	}
	_dist(a, b) {
		const d0 = (a[0] ?? 0) - (b[0] ?? 0), d1 = (a[1] ?? 0) - (b[1] ?? 0), d2 = (a[2] ?? 0) - (b[2] ?? 0);
		return Math.hypot(d0, d1, d2);
	}
	getLengths(divisions = this.arcLengthDivisions) {
		if (!this._lengths || this._lengthsDiv !== divisions) {
			const pts = [];
			for (let i = 0; i <= divisions; i++) pts.push(this._pt(this.getPoint(i / divisions)));
			const lengths = [0];
			for (let i = 1; i <= divisions; i++) lengths.push(lengths[i - 1] + this._dist(pts[i], pts[i - 1]));
			this._lengths = lengths;
			this._lengthPts = pts;
			this._lengthsDiv = divisions;
		}
		return this._lengths;
	}
	getLength() {
		const l = this.getLengths();
		return l[l.length - 1];
	}
	updateArcLengths() {
		this._lengths = null;
		return this;
	}
	getCurveLengths() {
		return this.getLengths();
	}
	getUtoTmapping(u, distance) {
		const lengths = this.getLengths();
		const total = lengths[lengths.length - 1] || 1;
		const target = distance !== void 0 ? distance : u * total;
		for (let i = 1; i < lengths.length; i++) if (lengths[i] >= target) {
			const t0 = (i - 1) / (lengths.length - 1), t1 = i / (lengths.length - 1);
			const seg = lengths[i] - lengths[i - 1] || 1;
			return t0 + (t1 - t0) * ((target - lengths[i - 1]) / seg);
		}
		return 1;
	}
	getPointAt(u) {
		return this.getPoint(this.getUtoTmapping(u, u * (this.getLength() || 1)));
	}
	getTangent(t) {
		const e = 1e-4;
		const a = this._pt(this.getPoint(Math.max(0, t - e)));
		const b = this._pt(this.getPoint(Math.min(1, t + e)));
		const dx = b[0] - a[0], dy = b[1] - a[1], dz = (b[2] ?? 0) - (a[2] ?? 0);
		const l = Math.hypot(dx, dy, dz) || 1;
		return [
			dx / l,
			dy / l,
			dz / l
		];
	}
	getTangentAt(u) {
		return this.getTangent(this.getUtoTmapping(u, u * (this.getLength() || 1)));
	}
	getSpacedPoints(divisions = 40) {
		const pts = [];
		for (let i = 0; i <= divisions; i++) pts.push(this.getPointAt(i / divisions));
		return pts;
	}
	computeFrenetFrames(segments, closed) {
		const tangents = [], normals = [], binormals = [];
		let prevNormal = null;
		for (let i = 0; i <= segments; i++) {
			const t = i / segments;
			const tan = this._pt(this.getTangent(t));
			tangents.push(tan);
			let n = prevNormal;
			if (!n) {
				const up = Math.abs(tan[1]) < .9 ? [
					0,
					1,
					0
				] : [
					1,
					0,
					0
				];
				n = [
					tan[1] * up[2] - tan[2] * up[1],
					tan[2] * up[0] - tan[0] * up[2],
					tan[0] * up[1] - tan[1] * up[0]
				];
			} else {
				const d = n[0] * tan[0] + n[1] * tan[1] + n[2] * tan[2];
				n = [
					n[0] - d * tan[0],
					n[1] - d * tan[1],
					n[2] - d * tan[2]
				];
			}
			const nl = Math.hypot(n[0], n[1], n[2]) || 1;
			n = [
				n[0] / nl,
				n[1] / nl,
				n[2] / nl
			];
			prevNormal = n;
			normals.push(n);
			binormals.push([
				tan[1] * n[2] - tan[2] * n[1],
				tan[2] * n[0] - tan[0] * n[2],
				tan[0] * n[1] - tan[1] * n[0]
			]);
		}
		return {
			tangents,
			normals,
			binormals
		};
	}
	getPoints(divisions = 12) {
		const pts = [];
		for (let i = 0; i <= divisions; i++) {
			const p = this._pt(this.getPoint(i / divisions));
			pts.push([p[0], p[1]]);
		}
		return pts;
	}
	copy(source) {
		this.needsUpdate = true;
		return this;
	}
	clone() {
		return new this.constructor().copy(this);
	}
	toJSON(meta = {}) {
		return {
			type: this.type || this.constructor.name,
			data: { points: this.points || [] }
		};
	}
	fromJSON(json) {
		return this;
	}
};
var CatmullRomCurve3 = class CatmullRomCurve3 extends Curve {
	constructor(points = [], closed = false, curveType = "centripetal", tension = .5) {
		super();
		this.points = points.map((p) => Array.isArray(p) ? p : [
			p.x,
			p.y,
			p.z
		]);
		this.closed = closed;
		this.curveType = curveType;
		this.tension = tension;
		this.isCatmullRomCurve3 = true;
	}
	copy(source) {
		this.points = source.points.map((p) => Array.isArray(p) ? [...p] : { ...p });
		this.closed = source.closed;
		this.curveType = source.curveType;
		this.tension = source.tension;
		this.updateArcLengths();
		return this;
	}
	clone() {
		return new CatmullRomCurve3(this.points.map((p) => [...p]), this.closed, this.curveType, this.tension);
	}
	toJSON() {
		return {
			type: "CatmullRomCurve3",
			data: {
				points: this.points.map((p) => p.slice()),
				closed: this.closed,
				curveType: this.curveType,
				tension: this.tension
			}
		};
	}
	fromJSON(json) {
		const d = json.data || {};
		this.points = (d.points || []).map((p) => Array.isArray(p) ? [...p] : [
			p.x,
			p.y,
			p.z
		]);
		this.closed = !!d.closed;
		this.curveType = d.curveType || "centripetal";
		this.tension = d.tension ?? .5;
		this.updateArcLengths();
		return this;
	}
	getPoint(t) {
		const pts = this.points, n = pts.length;
		if (n === 0) return [
			0,
			0,
			0
		];
		if (n === 1) return pts[0];
		const scaled = this.closed ? t * n : t * (n - 1);
		let i = Math.floor(scaled);
		const u = scaled - i;
		const at = (k) => this.closed ? pts[(k % n + n) % n] : pts[Math.max(0, Math.min(n - 1, k))];
		const p0 = at(i - 1), p1 = at(i), p2 = at(i + 1), p3 = at(i + 2);
		const cr = (a, b, c, d, t) => {
			const t2 = t * t, t3 = t2 * t;
			return .5 * (2 * b + (-a + c) * t + (2 * a - 5 * b + 4 * c - d) * t2 + (-a + 3 * b - 3 * c + d) * t3);
		};
		return [
			cr(p0[0], p1[0], p2[0], p3[0], u),
			cr(p0[1], p1[1], p2[1], p3[1], u),
			cr(p0[2], p1[2], p2[2], p3[2], u)
		];
	}
};
var Path = class extends Curve {
	constructor() {
		super();
		this.isPath = true;
		this.segments = [];
	}
	moveTo(x, y) {
		this.segments.push({
			t: "M",
			x,
			y
		});
		this.updateArcLengths();
		return this;
	}
	lineTo(x, y) {
		this.segments.push({
			t: "L",
			x,
			y
		});
		this.updateArcLengths();
		return this;
	}
	quadraticCurveTo(cx, cy, x, y) {
		this.segments.push({
			t: "Q",
			cx,
			cy,
			x,
			y
		});
		this.updateArcLengths();
		return this;
	}
	bezierCurveTo(c1x, c1y, c2x, c2y, x, y) {
		this.segments.push({
			t: "C",
			c1x,
			c1y,
			c2x,
			c2y,
			x,
			y
		});
		this.updateArcLengths();
		return this;
	}
	closePath() {
		this.segments.push({ t: "Z" });
		this.updateArcLengths();
		return this;
	}
	arc(aX, aY, aRadius, aStartAngle, aEndAngle, aClockwise = false) {
		const last = this.segments.filter((s) => s.t === "M" || s.t === "L" || s.t === "C" || s.t === "Q").pop();
		const cx = (last ? last.x ?? last._ex ?? 0 : 0) + aX, cy = (last ? last.y ?? last._ey ?? 0 : 0) + aY;
		return this._pushArc(cx, cy, aRadius, aStartAngle, aEndAngle, aClockwise);
	}
	absarc(x, y, radius, startAngle, endAngle, clockwise = false) {
		return this._pushArc(x, y, radius, startAngle, endAngle, clockwise);
	}
	_pushArc(cx, cy, r, a0, a1, ccw) {
		this.segments.push({
			t: "A",
			cx,
			cy,
			r,
			a0,
			a1,
			ccw
		});
		this.updateArcLengths();
		return this;
	}
	ellipse(x, y, xRadius, yRadius, rotation, startAngle, endAngle, clockwise = false, aRotation = 0) {
		return this.absellipse(x, y, xRadius, yRadius, rotation, startAngle, endAngle, clockwise);
	}
	absellipse(cx, cy, rx, ry, rot, a0, a1, ccw = false) {
		this.segments.push({
			t: "E",
			cx,
			cy,
			rx,
			ry,
			rot,
			a0,
			a1,
			ccw
		});
		this.updateArcLengths();
		return this;
	}
	splineThru(points) {
		const pts = points.map((p) => [p.x ?? p[0], p.y ?? p[1]]);
		for (let i = 1; i < pts.length; i++) {
			const p0 = pts[Math.max(0, i - 2)] || pts[0], p1 = pts[i - 1], p2 = pts[i], p3 = pts[Math.min(pts.length - 1, i + 1)];
			this.segments.push({
				t: "S",
				p0,
				p1,
				p2,
				p3
			});
		}
		this.updateArcLengths();
		return this;
	}
	add(curve) {
		const pts = curve.getPoints ? curve.getPoints(12) : [];
		if (pts.length) {
			if (!this.segments.length || this.segments[this.segments.length - 1].t !== "M") this.moveTo(pts[0][0], pts[0][1]);
			for (const p of pts) this.lineTo(p[0], p[1]);
		}
		return this;
	}
	setFromPoints(points) {
		this.segments.length = 0;
		points.forEach((p, i) => {
			const x = p.x ?? p[0], y = p.y ?? p[1];
			if (i === 0) this.moveTo(x, y);
			else this.lineTo(x, y);
		});
		return this;
	}
	copy(source, recursive = true) {
		super.copy(source);
		this.segments = source.segments.map((s) => ({ ...s }));
		this.updateArcLengths();
		return this;
	}
	clone() {
		return new this.constructor().copy(this);
	}
	getPoint(t) {
		return this._contourPoint(this.getUtoTmapping(t, t * (this.getLength() || 1)));
	}
	getPointAt(u) {
		return this._contourPoint(u);
	}
	getTangent(t) {
		const e = .001, a = this._contourPoint(Math.max(0, t - e)), b = this._contourPoint(Math.min(1, t + e));
		const dx = b[0] - a[0], dy = b[1] - a[1], l = Math.hypot(dx, dy) || 1;
		return [
			dx / l,
			dy / l,
			0
		];
	}
	getTangentAt(u) {
		const e = .001, a = this._contourPoint(Math.max(0, u - e)), b = this._contourPoint(Math.min(1, u + e));
		const dx = b[0] - a[0], dy = b[1] - a[1], l = Math.hypot(dx, dy) || 1;
		return [
			dx / l,
			dy / l,
			0
		];
	}
	_contour() {
		if (!this._ptsCache) {
			const pts = this.getPoints(240);
			const cum = [0];
			for (let i = 1; i < pts.length; i++) cum.push(cum[i - 1] + Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]));
			this._ptsCache = {
				pts,
				cum,
				total: cum[cum.length - 1] || 0
			};
		}
		return this._ptsCache;
	}
	_contourPoint(u) {
		const { pts, cum, total } = this._contour();
		if (!pts.length) return [0, 0];
		const target = u * total;
		for (let i = 1; i < cum.length; i++) if (cum[i] >= target) {
			const seg = cum[i] - cum[i - 1] || 1, f = (target - cum[i - 1]) / seg;
			return [pts[i - 1][0] + (pts[i][0] - pts[i - 1][0]) * f, pts[i - 1][1] + (pts[i][1] - pts[i - 1][1]) * f];
		}
		return pts[pts.length - 1];
	}
	updateArcLengths() {
		this._lengths = null;
		this._ptsCache = null;
		return this;
	}
	getLength() {
		return this._contour().total;
	}
	toJSON() {
		return {
			type: this.isShape ? "Shape" : "Path",
			data: {
				segments: this.segments.map((s) => ({ ...s })),
				...this.holes ? { holes: this.holes.map((h) => h.toJSON ? h.toJSON() : null).filter(Boolean) } : {}
			}
		};
	}
	fromJSON(json) {
		this.segments = (json.data?.segments || []).map((s) => ({ ...s }));
		this.updateArcLengths();
		return this;
	}
	getPoints(divisions = 12) {
		this._ptsCache = null;
		const pts = [];
		let cur = null, start = null;
		const cubic = (p0, p1, p2, p3, t) => {
			const u = 1 - t;
			return u * u * u * p0 + 3 * u * u * t * p1 + 3 * u * t * t * p2 + t * t * t * p3;
		};
		for (const s of this.segments) if (s.t === "M") {
			cur = {
				x: s.x,
				y: s.y
			};
			start = { ...cur };
			pts.push([cur.x, cur.y]);
		} else if (s.t === "L") {
			cur = {
				x: s.x,
				y: s.y
			};
			pts.push([cur.x, cur.y]);
		} else if (s.t === "Q") {
			for (let i = 1; i <= divisions; i++) {
				const t = i / divisions, u = 1 - t;
				pts.push([u * u * cur.x + 2 * u * t * s.cx + t * t * s.x, u * u * cur.y + 2 * u * t * s.cy + t * t * s.y]);
			}
			cur = {
				x: s.x,
				y: s.y
			};
		} else if (s.t === "C") {
			for (let i = 1; i <= divisions; i++) {
				const t = i / divisions;
				pts.push([cubic(cur.x, s.c1x, s.c2x, s.x, t), cubic(cur.y, s.c1y, s.c2y, s.y, t)]);
			}
			cur = {
				x: s.x,
				y: s.y
			};
		} else if (s.t === "A" || s.t === "E") {
			const steps = Math.max(4, Math.ceil(Math.abs(s.a1 - s.a0) / (Math.PI / divisions)));
			for (let i = 1; i <= steps; i++) {
				const t = i / steps;
				let ang = s.a0 + (s.a1 - s.a0) * t;
				if (s.ccw && s.a1 < s.a0) ang = s.a0 - (s.a0 - s.a1) * t;
				if (!s.ccw && s.a1 < s.a0) ang = s.a0 + (s.a1 + Math.PI * 2 - s.a0) * t;
				const rx = s.r ?? s.rx, ry = s.r ?? s.ry ?? s.rx;
				const ca = Math.cos(s.rot || 0), sa = Math.sin(s.rot || 0);
				const ex = Math.cos(ang) * rx, ey = Math.sin(ang) * ry;
				pts.push([s.cx + ex * ca - ey * sa, s.cy + ex * sa + ey * ca]);
			}
			cur = pts[pts.length - 1] ? {
				x: pts[pts.length - 1][0],
				y: pts[pts.length - 1][1]
			} : cur;
		} else if (s.t === "S") {
			for (let i = 1; i <= divisions; i++) {
				const t = i / divisions;
				1 - t;
				pts.push([.5 * (2 * s.p1[0] + (-s.p0[0] + s.p2[0]) * t + (2 * s.p0[0] - 5 * s.p1[0] + 4 * s.p2[0] - s.p3[0]) * t * t + (-s.p0[0] + 3 * s.p1[0] - 3 * s.p2[0] + s.p3[0]) * t * t * t), .5 * (2 * s.p1[1] + (-s.p0[1] + s.p2[1]) * t + (2 * s.p0[1] - 5 * s.p1[1] + 4 * s.p2[1] - s.p3[1]) * t * t + (-s.p0[1] + 3 * s.p1[1] - 3 * s.p2[1] + s.p3[1]) * t * t * t)]);
			}
			cur = {
				x: pts[pts.length - 1][0],
				y: pts[pts.length - 1][1]
			};
		} else if (s.t === "Z" && cur && start) {
			pts.push([start.x, start.y]);
			cur = { ...start };
		}
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
};
var Shape = class extends Path {
	constructor() {
		super();
		this.isShape = true;
		this.holes = [];
		this.type = "Shape";
	}
	copy(source, recursive = true) {
		super.copy(source, recursive);
		this.holes = source.holes.map((h) => h.clone ? h.clone() : h);
		return this;
	}
	getPointsHoles(divisions = 12) {
		return this.holes.map((h) => h.getPoints(divisions));
	}
	extractPoints(divisions = 12) {
		return {
			shape: this.getPoints(divisions),
			holes: this.getPointsHoles(divisions)
		};
	}
	getSpacedPoints(divisions = 40) {
		return super.getSpacedPoints(divisions);
	}
};
const orient2 = (a, b, c) => (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
const inTri2 = (p, a, b, c) => {
	const d1 = orient2(a, b, p), d2 = orient2(b, c, p), d3 = orient2(c, a, p);
	return !((d1 < 0 || d2 < 0 || d3 < 0) && (d1 > 0 || d2 > 0 || d3 > 0));
};
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
				if (inTri2(verts[j], a, b, c)) {
					blocked = true;
					break;
				}
			}
			if (blocked) continue;
			tris.push([
				ia,
				ib,
				ic
			]);
			idx.splice(i, 1);
			clipped = true;
			break;
		}
		if (!clipped) break;
	}
	if (idx.length === 3) tris.push([
		idx[0],
		idx[1],
		idx[2]
	]);
	return tris;
}
function bridgeHoles(outer, holes) {
	let verts = outer.map((p) => [p[0], p[1]]);
	for (const holeRaw of holes) {
		let hole = holeRaw.map((p) => [p[0], p[1]]);
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
		if (hArea < 0 === oArea < 0) hole.reverse();
		let mh = 0;
		for (let i = 1; i < hole.length; i++) if (hole[i][0] > hole[mh][0]) mh = i;
		const m = hole[mh];
		let best = null;
		for (let i = 0; i < verts.length; i++) {
			const a = verts[i], b = verts[(i + 1) % verts.length];
			const dx = b[0] - a[0], dy = b[1] - a[1];
			if (Math.abs(dy) < 1e-12) continue;
			const t = (m[1] - a[1]) / dy;
			if (t < 0 || t > 1) continue;
			const x = a[0] + dx * t;
			const dist = x - m[0];
			if (dist <= 1e-9) continue;
			if (!best || dist < best.dist) best = {
				dist,
				edge: i,
				t,
				point: [x, a[1] + dy * t]
			};
		}
		if (!best) continue;
		const ei = best.edge;
		const bridge = [best.point[0], best.point[1]];
		const insert = [
			bridge,
			m,
			...hole.slice(mh).concat(hole.slice(0, mh)).slice(1),
			m,
			bridge
		];
		verts = verts.slice(0, ei + 1).concat(insert, verts.slice(ei + 1));
	}
	return verts;
}
function triangulateShape(outer, holes) {
	if (!holes.length) return {
		verts: outer,
		tris: triangulatePolygon(outer),
		holesUsed: false
	};
	const merged = bridgeHoles(outer, holes);
	const tris = triangulatePolygon(merged);
	if (tris.length === merged.length - 2) return {
		verts: merged,
		tris,
		holesUsed: true
	};
	return {
		verts: outer,
		tris: triangulatePolygon(outer),
		holesUsed: false
	};
}
function shapeToGeometry(shape, depth = 0, curveSegments = 12) {
	const { verts, tris } = triangulateShape(shape.getPoints(curveSegments), (shape.holes || []).map((h) => h.getPoints(curveSegments)).filter((h) => h.length >= 3));
	const geo = new BufferGeometry();
	const positions = [], normals = [], uvs = [];
	for (const [x, y] of verts) {
		positions.push(x, y, 0);
		normals.push(0, 0, 1);
		uvs.push(x, y);
	}
	const indices = [];
	for (const [a, b, c] of tris) indices.push(a, b, c);
	geo.setAttribute("position", new Float32BufferAttribute(positions, 3));
	geo.setAttribute("normal", new Float32BufferAttribute(normals, 3));
	geo.setAttribute("uv", new Float32BufferAttribute(uvs, 2));
	if (indices.length) geo.setIndex(new Uint32BufferAttribute(indices, 1));
	return geo;
}
var ShapeGeometry = class extends BufferGeometry {
	constructor(shape, curveSegments = 12) {
		super();
		const src = shapeToGeometry(shape, 0, curveSegments);
		for (const name of [
			"position",
			"normal",
			"uv"
		]) this.setAttribute(name, src.attributes[name]);
		this.setIndex(src.index);
		this.isShapeGeometry = true;
	}
};
var ExtrudeGeometry = class extends BufferGeometry {
	constructor(shape, options = {}) {
		super();
		const depth = options.depth ?? 1;
		const curveSegments = options.curveSegments ?? 12;
		const outer = shape.getPoints(curveSegments);
		const holes = (shape.holes || []).map((h) => h.getPoints(curveSegments)).filter((h) => h.length >= 3);
		const contours = [outer, ...holes];
		const positions = [], normals = [], uvs = [], indices = [];
		const { verts: capVerts, tris: capTris, holesUsed } = triangulateShape(outer, holes);
		const wallContours = holesUsed ? contours : [outer];
		const emitCap = (z, up) => {
			const offset = positions.length / 3;
			for (const [x, y] of capVerts) {
				positions.push(x, y, z);
				normals.push(0, 0, up ? 1 : -1);
				uvs.push(x, y);
			}
			for (const [a, b, c] of capTris) if (up) indices.push(offset + a, offset + b, offset + c);
			else indices.push(offset + a, offset + c, offset + b);
		};
		emitCap(0, false);
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
				const a = base + i * 2, b = a + 1, c = base + (i + 1) % n * 2, d = c + 1;
				indices.push(a, c, b, c, d, b);
			}
		}
		emitCap(depth, true);
		this.setAttribute("position", new Float32BufferAttribute(positions, 3));
		this.setAttribute("normal", new Float32BufferAttribute(normals, 3));
		this.setAttribute("uv", new Float32BufferAttribute(uvs, 2));
		this.setIndex(new Uint32BufferAttribute(indices, 1));
		this.isExtrudeGeometry = true;
	}
};

// src/three/animation.ts
function intervalIndex(times, t, lastIndex = 0) {
	const n = times.length;
	if (n === 0) return 0;
	if (t <= times[0]) return 0;
	if (t >= times[n - 1]) return n - 2;
	let i = lastIndex;
	if (i < 0 || i >= n - 1) i = 0;
	if (t < times[i]) while (i > 0 && t < times[i]) i--;
	else while (i < n - 2 && t >= times[i + 1]) i++;
	return i;
}
const InterpolateDiscrete = 2300;
const InterpolateLinear = 2301;
const InterpolateSmooth = 2302;
var Interpolant = class {
	constructor(parameterPositions, sampleValues, sampleSize, resultBuffer) {
		this.interpolantFactor = 0;
		this.interpolantBuffer = null;
		this.isInterpolant = true;
		this.parameterPositions = parameterPositions;
		this.sampleValues = sampleValues;
		this.valueSize = sampleSize;
		this.resultBuffer = resultBuffer !== void 0 ? resultBuffer : new sampleValues.constructor(sampleSize);
	}
	evaluate(t) {
		throw new Error("Interpolant.evaluate must be implemented by subclasses");
	}
	interpolate_(i1, t0, t, i2) {
		throw new Error("Interpolant.interpolate_ must be implemented by subclasses");
	}
	before(t) {}
	after(t) {}
	copySampleValue_(index) {
		return this.sampleValues.subarray ? this.sampleValues.subarray(index * this.valueSize, (index + 1) * this.valueSize) : this.sampleValues.slice(index * this.valueSize, (index + 1) * this.valueSize);
	}
	getSettings_() {
		return {};
	}
	intervalChanged_(i1, t0, t, i2) {}
};
var LinearInterpolant = class extends Interpolant {
	constructor(..._args) {
		super(..._args);
		this.isLinearInterpolant = true;
	}
	evaluate(t) {
		const pp = this.parameterPositions;
		this.sampleValues;
		this.valueSize;
		const i1 = intervalIndex(pp, t, this._lastIndex | 0);
		this._lastIndex = i1;
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
};
var QuaternionLinearInterpolant = class extends LinearInterpolant {
	constructor(..._args2) {
		super(..._args2);
		this.isQuaternionInterpolant = true;
	}
	interpolate_(i1, t0, t, i2) {
		const sv = this.sampleValues, vs = this.valueSize, rb = this.resultBuffer;
		const o1 = i1 * vs, o2 = i2 * vs;
		let bx = sv[o2], by = sv[o2 + 1], bz = sv[o2 + 2], bw = sv[o2 + 3];
		let cosHalf = sv[o1] * bx + sv[o1 + 1] * by + sv[o1 + 2] * bz + sv[o1 + 3] * bw;
		if (cosHalf < 0) {
			cosHalf = -cosHalf;
			bx = -bx;
			by = -by;
			bz = -bz;
			bw = -bw;
		}
		if (cosHalf > .9995) {
			rb[0] = sv[o1] + (bx - sv[o1]) * t;
			rb[1] = sv[o1 + 1] + (by - sv[o1 + 1]) * t;
			rb[2] = sv[o1 + 2] + (bz - sv[o1 + 2]) * t;
			rb[3] = sv[o1 + 3] + (bw - sv[o1 + 3]) * t;
			const l = Math.hypot(rb[0], rb[1], rb[2], rb[3]) || 1;
			rb[0] /= l;
			rb[1] /= l;
			rb[2] /= l;
			rb[3] /= l;
			return;
		}
		const half = Math.acos(Math.min(1, cosHalf));
		const sinHalf = Math.sin(half);
		const ra = Math.sin((1 - t) * half) / sinHalf, rbw = Math.sin(t * half) / sinHalf;
		rb[0] = sv[o1] * ra + bx * rbw;
		rb[1] = sv[o1 + 1] * ra + by * rbw;
		rb[2] = sv[o1 + 2] * ra + bz * rbw;
		rb[3] = sv[o1 + 3] * ra + bw * rbw;
	}
};
var CubicInterpolant = class extends LinearInterpolant {
	constructor(..._args3) {
		super(..._args3);
		this.isCubicInterpolant = true;
	}
	evaluate(t) {
		const pp = this.parameterPositions, sv = this.sampleValues, vs = this.valueSize;
		const n = pp.length;
		if (n < 2) return this.resultBuffer;
		const i = intervalIndex(pp, t, this._lastIndex | 0);
		this._lastIndex = i;
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
};
var DiscreteInterpolant = class extends LinearInterpolant {
	constructor(..._args4) {
		super(..._args4);
		this.isDiscreteInterpolant = true;
	}
	evaluate(t) {
		const pp = this.parameterPositions, sv = this.sampleValues, vs = this.valueSize;
		const i = intervalIndex(pp, t, this._lastIndex | 0);
		this._lastIndex = i;
		const src = Math.min(i, pp.length - 1) * vs, rb = this.resultBuffer;
		for (let j = 0; j < vs; j++) rb[j] = sv[src + j];
		return rb;
	}
};
const TRACK_VALUE_SIZES = {
	vector: 3,
	quaternion: 4,
	color: 3,
	number: 1,
	bool: 1,
	string: 1
};
var KeyframeTrack = class {
	constructor(name, times, values, interpolation) {
		this.isKeyframeTrack = true;
		this.name = name;
		this.times = times instanceof Float32Array ? times : Float32Array.from(times);
		this.values = values;
		this.valueTypeName = "number";
		this.DefaultInterpolation = interpolation || "linear";
		for (let i = 1; i < this.times.length; i++) if (this.times[i] <= this.times[i - 1]) throw new Error(`gs3d: KeyframeTrack '${name}' times must be strictly increasing`);
	}
	getValueSize() {
		return TRACK_VALUE_SIZES[this.valueTypeName] ?? 1;
	}
	getInterpolation() {
		return this.DefaultInterpolation;
	}
	setInterpolation(interpolation) {
		this.DefaultInterpolation = interpolation;
		return this;
	}
	scale(timeScale) {
		const times = this.times;
		for (let i = 0; i < times.length; i++) times[i] *= timeScale;
		return this;
	}
	shift(timeOffset) {
		const times = this.times;
		for (let i = 0; i < times.length; i++) times[i] += timeOffset;
		return this;
	}
	trim(startTime, endTime) {
		const times = this.times, values = this.values, size = this.getValueSize();
		const keepTimes = [], keepValues = [];
		let removed = 0;
		for (let i = 0; i < times.length; i++) if (times[i] >= startTime && times[i] < endTime) {
			keepTimes.push(times[i]);
			for (let j = 0; j < size; j++) keepValues.push(values[i * size + j]);
		} else removed++;
		if (!removed) return 0;
		this.times = Float32Array.from(keepTimes);
		this.values = values instanceof Float32Array ? Float32Array.from(keepValues) : keepValues;
		return removed;
	}
	validate() {
		const n = this.times.length;
		const expected = n * this.getValueSize();
		const actual = this.values.length;
		if (actual !== expected) {
			console.warn?.(`gs3d: KeyframeTrack '${this.name}' values length ${actual} != times*size ${expected}`);
			return false;
		}
		for (let i = 1; i < n; i++) if (this.times[i] <= this.times[i - 1]) {
			console.warn?.(`gs3d: KeyframeTrack '${this.name}' times not increasing at ${i}`);
			return false;
		}
		return true;
	}
	optimize() {
		const times = this.times, values = this.values, size = this.getValueSize();
		if (times.length <= 2) return this;
		const kt = [], kv = [];
		const push = (i) => {
			kt.push(times[i]);
			for (let j = 0; j < size; j++) kv.push(values[i * size + j]);
		};
		push(0);
		for (let i = 1; i < times.length - 1; i++) {
			let same = true;
			for (let j = 0; j < size; j++) if (values[i * size + j] !== values[(i - 1) * size + j] || values[i * size + j] !== values[(i + 1) * size + j]) {
				same = false;
				break;
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
			type: this.constructor.name
		};
	}
	createInterpolant(result) {
		const size = this.getValueSize();
		const values = this.values instanceof Float32Array ? this.values : Float32Array.from(this.values);
		const kind = this.DefaultInterpolation || "linear";
		const rb = result !== void 0 ? result : new Float32Array(size);
		if (kind === "discrete") return new DiscreteInterpolant(this.times, values, size, rb);
		if (kind === "cubic") return new CubicInterpolant(this.times, values, size, rb);
		if (this.valueTypeName === "quaternion") return new QuaternionLinearInterpolant(this.times, values, size, rb);
		return new LinearInterpolant(this.times, values, size, rb);
	}
	clone() {
		return new this.constructor(this.name, this.times instanceof Float32Array ? this.times.slice() : Array.from(this.times), this.values instanceof Float32Array ? this.values.slice() : Array.from(this.values), this.DefaultInterpolation);
	}
};
const _KTproto = KeyframeTrack.prototype;
_KTproto.InterpolantFactoryMethodDiscrete = function(buffer) {
	return new DiscreteInterpolant(this.times, this.values, this.getValueSize(), buffer);
};
_KTproto.InterpolantFactoryMethodLinear = function(buffer) {
	return new LinearInterpolant(this.times, this.values, this.getValueSize(), buffer);
};
_KTproto.InterpolantFactoryMethodSmooth = function(buffer) {
	return new CubicInterpolant(this.times, this.values, this.getValueSize(), buffer);
};
_KTproto.TimeBufferType = Float32Array;
_KTproto.ValueBufferType = Float32Array;
var VectorKeyframeTrack = class extends KeyframeTrack {
	constructor(name, times, values, interpolation) {
		super(name, times, values, interpolation);
		this.valueTypeName = "vector";
	}
};
var QuaternionKeyframeTrack = class extends KeyframeTrack {
	constructor(name, times, values, interpolation) {
		super(name, times, values, interpolation);
		this.valueTypeName = "quaternion";
	}
};
var NumberKeyframeTrack = class extends KeyframeTrack {
	constructor(name, times, values, interpolation) {
		super(name, times, values, interpolation);
		this.valueTypeName = "number";
	}
};
var ColorKeyframeTrack = class extends KeyframeTrack {
	constructor(name, times, values, interpolation) {
		super(name, times, values, interpolation);
		this.valueTypeName = "color";
	}
};
var BooleanKeyframeTrack = class extends KeyframeTrack {
	constructor(name, times, values, interpolation) {
		super(name, times, values, interpolation);
		this.valueTypeName = "bool";
	}
};
var StringKeyframeTrack = class extends KeyframeTrack {
	constructor(name, times, values, interpolation) {
		super(name, times, values, interpolation);
		this.valueTypeName = "string";
		this.DefaultInterpolation = "discrete";
	}
};
const TRACK_CTORS = {
	VectorKeyframeTrack,
	QuaternionKeyframeTrack,
	NumberKeyframeTrack,
	ColorKeyframeTrack,
	BooleanKeyframeTrack,
	StringKeyframeTrack
};
function parseTrackName(trackName) {
	const lastDot = trackName.lastIndexOf(".");
	const nodeName = lastDot < 0 ? trackName : trackName.slice(0, lastDot);
	const propertyPath = lastDot < 0 ? "" : trackName.slice(lastDot + 1);
	const path = [];
	const re = /([^.[\]]+)|\[(\d+)\]/g;
	let m;
	while ((m = re.exec(propertyPath)) !== null) if (m[1] !== void 0) path.push(m[1]);
	else path.push(`[${m[2]}]`);
	return {
		nodeName,
		propertyPath,
		path
	};
}
function findNodeByName(root, nodeName) {
	if (!nodeName) return root;
	let found = null;
	root.traverse((node) => {
		if (found) return;
		if (node.name === nodeName || node.uuid === nodeName) found = node;
	});
	return found;
}
function findNodeForTrack(root, trackName) {
	let bestNode = null;
	let bestIdLen = -1;
	let bestRest = "";
	root.traverse((node) => {
		for (const id of [node.name, node.uuid]) {
			if (!id) continue;
			if (trackName === id || trackName.startsWith(id + ".")) {
				if (id.length > bestIdLen) {
					bestIdLen = id.length;
					bestNode = node;
					bestRest = trackName === id ? "" : trackName.slice(id.length + 1);
				}
			}
		}
	});
	if (!bestNode) return trackName ? null : {
		node: root,
		path: []
	};
	const path = [];
	const re = /([^.[\]]+)|\[(\d+)\]/g;
	let m;
	while ((m = re.exec(bestRest)) !== null) if (m[1] !== void 0) path.push(m[1]);
	else path.push(`[${m[2]}]`);
	return {
		node: bestNode,
		path
	};
}
function resolveTarget(object, path) {
	let target = object;
	for (const seg of path) {
		if (target == null) return null;
		const indexed = seg.match(/^\[(\d+)\]$/);
		if (indexed) {
			target = target[Number(indexed[1])];
			continue;
		}
		if (seg === "material") {
			target = Array.isArray(target.material) ? target.material[0] : target.material;
			continue;
		}
		target = target[seg];
	}
	return target;
}
var PropertyBinding = class PropertyBinding {
	constructor(rootNode, path, parsedPath) {
		this.value = null;
		this._target = null;
		this._resolved = false;
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
	static create(rootNode, trackName, parsedPath) {
		return new PropertyBinding(rootNode, trackName, parsedPath);
	}
	bind() {
		return this;
	}
	unbind() {
		this._resolved = false;
		this._target = null;
		return this;
	}
	resolve() {
		if (this._resolved) return this._target;
		const found = findNodeForTrack(this.rootNode, this.path);
		if (!found) return null;
		this.node = found.node;
		const path = found.path;
		let target = null;
		if (!path.length) target = null;
		else {
			const leaf = path[path.length - 1];
			const indexed = leaf.match(/^\[(\d+)\]$/);
			if (indexed) {
				const array = resolveTarget(this.node, path.slice(0, -1));
				target = array == null ? null : {
					object: array,
					key: Number(indexed[1])
				};
			} else {
				const object = resolveTarget(this.node, path.slice(0, -1));
				target = object == null || object === void 0 ? null : {
					object,
					key: leaf
				};
			}
		}
		this._target = target;
		this._resolved = target !== null;
		return target;
	}
	_readProp(prop, targetArray, offset) {
		if (prop == null) return targetArray;
		if (prop.isVector3 || prop.isVector2) {
			targetArray[offset] = prop.x;
			targetArray[offset + 1] = prop.y;
			if (this.getValueSize >= 3) targetArray[offset + 2] = prop.z;
			return targetArray;
		}
		if (prop.isQuaternion) {
			targetArray[offset] = prop.x;
			targetArray[offset + 1] = prop.y;
			targetArray[offset + 2] = prop.z;
			targetArray[offset + 3] = prop.w;
			return targetArray;
		}
		if (prop.isEuler) {
			targetArray[offset] = prop.x;
			targetArray[offset + 1] = prop.y;
			targetArray[offset + 2] = prop.z;
			return targetArray;
		}
		if (prop.isColor) {
			targetArray[offset] = prop.r;
			targetArray[offset + 1] = prop.g;
			targetArray[offset + 2] = prop.b;
			return targetArray;
		}
		targetArray[offset] = typeof prop === "number" ? prop : prop ? 1 : 0;
		return targetArray;
	}
	_writeProp(prop, object, key, buffer, offset) {
		if (prop != null) {
			if (prop.isVector3 || prop.isVector2) {
				prop.set(buffer[offset], buffer[offset + 1], prop.isVector2 ? prop.y : buffer[offset + 2]);
				return;
			}
			if (prop.isQuaternion) {
				prop.set(buffer[offset], buffer[offset + 1], buffer[offset + 2], buffer[offset + 3]);
				return;
			}
			if (prop.isEuler) {
				prop.set(buffer[offset], buffer[offset + 1], buffer[offset + 2]);
				return;
			}
			if (prop.isColor) {
				prop.setRGB(buffer[offset], buffer[offset + 1], buffer[offset + 2]);
				return;
			}
		}
		object[key] = buffer[offset];
	}
	getValue(targetArray, offset = 0) {
		const resolved = this.resolve();
		if (!resolved) return targetArray;
		return this._readProp(resolved.object[resolved.key], targetArray, offset);
	}
	setValue(buffer, offset = 0) {
		const resolved = this.resolve();
		if (!resolved) return;
		this._writeProp(resolved.object[resolved.key], resolved.object, resolved.key, buffer, offset);
	}
	accumulate(accuIndex, value, weight, valueType) {
		const s = bindingAcc(this);
		const size = this.getValueSize || value.length;
		if (s.buffer.length < size) s.buffer = new Float64Array(size);
		s.quat = valueType === "quaternion";
		for (let i = 0; i < size; i++) s.buffer[i] += (value[i] ?? 0) * weight;
		s.weight += weight;
	}
	apply(accuIndex) {
		const s = bindingState.get(this);
		if (!s || s.weight === 0) return;
		const buf = s.buffer;
		if (s.quat) {
			const l = Math.hypot(buf[0], buf[1], buf[2], buf[3]) || 1;
			buf[0] /= l;
			buf[1] /= l;
			buf[2] /= l;
			buf[3] /= l;
		} else {
			const inv = 1 / s.weight;
			for (let i = 0; i < buf.length; i++) buf[i] *= inv;
		}
		this.setValue(buf, 0);
		s.weight = 0;
		s.buffer.fill(0);
	}
};
var AnimationClip = class AnimationClip {
	constructor(name, duration, tracks = [], blendMode = "normal") {
		this.isAnimationClip = true;
		this.name = name;
		this.tracks = tracks.slice();
		this.blendMode = blendMode;
		this.uuid = "clip-" + Math.random().toString(36).slice(2, 10);
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
	validate() {
		for (const track of this.tracks) {
			const t = track.times, vs = track.getValueSize ? track.getValueSize() : 1;
			const expected = t.length * vs;
			if (track.values && track.values.length !== expected) console.warn(`gs3d: AnimationClip '${this.name}' track '${track.name}' has mismatched value count`);
			for (let i = 1; i < t.length; i++) if (t[i] <= t[i - 1]) console.warn(`gs3d: AnimationClip '${this.name}' track '${track.name}' times not sorted`);
		}
		return this;
	}
	clone() {
		return new AnimationClip(this.name, this.duration, this.tracks.map((t) => t.clone()), this.blendMode);
	}
	optimize() {
		return this;
	}
	trim() {
		return this;
	}
	toJSON() {
		return {
			name: this.name,
			duration: this.duration,
			tracks: this.tracks.map((t) => t.toJSON ? t.toJSON() : null).filter(Boolean),
			uuid: this.uuid,
			blendMode: this.blendMode
		};
	}
	static parse(json) {
		const tracks = (json.tracks || []).map((t) => {
			return new (TRACK_CTORS[t.type] || NumberKeyframeTrack)(t.name, t.times || [], t.values || [], "linear");
		});
		const clip = new AnimationClip(json.name || "clip", json.duration ?? -1, tracks, json.blendMode);
		clip.resetDuration();
		return clip;
	}
	static CreateClipsFromMorphTargetTracks(name, tracks, fps = 30) {
		const clip = new AnimationClip(name, -1, tracks);
		clip.resetDuration();
		return clip;
	}
};
const LoopOnce = 2200;
const LoopRepeat = 2201;
const LoopPingPong = 2202;
const ZeroCurvatureEnding = 2400;
const ZeroSlopeEnding = 2401;
const WrapAroundEnding = 2402;
const NormalAnimationBlendMode = 2500;
const AdditiveAnimationBlendMode = 2501;
var AnimationAction = class {
	constructor(mixer, clip, root) {
		this._propertyBindings = [];
		this.paused = false;
		this.enabled = true;
		this.time = 0;
		this.timeScale = 1;
		this._effectiveTimeScale = 1;
		this.weight = 1;
		this._effectiveWeight = 0;
		this.loop = LoopRepeat;
		this.repetitions = -1;
		this._loopCount = -1;
		this.clampWhenFinished = false;
		this.zeroSlopeAtStart = false;
		this.zeroSlopeAtEnd = false;
		this._startTime = -1;
		this._mixerTime = 0;
		this._rampStart = -1;
		this._rampEnd = -1;
		this._rampFrom = 1;
		this._rampTo = 1;
		this._direction = 1;
		this._finished = false;
		this._haltWhenRampDone = false;
		this._warpFrom = 1;
		this._warpTo = 1;
		this._warpStart = -1;
		this._warpEnd = -1;
		this.isAnimationAction = true;
		this.mixer = mixer;
		this.clip = clip;
		this.root = root !== void 0 ? root : mixer ? mixer._root : null;
	}
	_updateBindings() {
		if (this._propertyBindings.length) return;
		for (const track of this.clip.tracks) {
			const interpolant = track.createInterpolant();
			const binding = this.mixer ? this.mixer._getBinding(this.root, track) : PropertyBinding.create(this.root, track.name);
			if (!binding.resolve()) continue;
			binding.getValueSize = track.getValueSize();
			binding.value = interpolant.resultBuffer;
			this._propertyBindings.push({
				track,
				interpolant,
				binding
			});
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
	isRunning() {
		return this.enabled && !this.paused && !this._finished;
	}
	isScheduled() {
		return this._startTime >= 0;
	}
	pause() {
		this.paused = true;
		return this;
	}
	unpause() {
		this.paused = false;
		return this;
	}
	setLoop(mode, repetitions = -1) {
		this.loop = mode;
		this.repetitions = repetitions;
		return this;
	}
	setEffectiveTimeScale(s) {
		this._effectiveTimeScale = s;
		return this;
	}
	getEffectiveTimeScale() {
		return this._effectiveTimeScale;
	}
	setEffectiveWeight(w) {
		this.weight = w;
		return this;
	}
	getEffectiveWeight() {
		return this._effectiveWeight;
	}
	fadeIn(duration) {
		return this._scheduleFade(this.weight, duration);
	}
	fadeOut(duration) {
		return this._scheduleFade(0, duration);
	}
	_scheduleFade(to, duration) {
		const mixerTime = this.mixer ? this.mixer.time : 0;
		this._rampFrom = this._effectiveWeight;
		this._rampTo = to;
		this._rampStart = mixerTime;
		this._rampEnd = mixerTime + Math.max(1e-4, duration);
		return this;
	}
	setEffectiveWeightValue(w) {
		this._effectiveWeight = w;
		return this;
	}
	setClampWhenFinished(clamp) {
		this.clampWhenFinished = clamp;
		return this;
	}
	syncWith(action) {
		return this.play();
	}
	getMixer() {
		return this.mixer;
	}
	getRoot() {
		return this.root;
	}
	getClip() {
		return this.clip;
	}
	setDuration(duration) {
		this.timeScale = duration / (this.clip.duration || 1) || 1;
		return this;
	}
	startAt(time) {
		this.time = time;
		return this;
	}
	stopFading() {
		this._rampEnd = -1;
		return this;
	}
	stopWarping() {
		this._warpEnd = -1;
		return this;
	}
	crossFadeTo(fadeInAction, duration, warp = false) {
		fadeInAction.fadeIn(duration);
		this.fadeOut(duration);
		if (warp) {
			const scale = fadeInAction.clip.duration / (this.clip.duration || 1) * (fadeInAction.timeScale / (this.timeScale || 1));
			this.warp(scale, duration);
			fadeInAction.warp(1 / (scale || 1), duration);
		}
		return this;
	}
	crossFadeFrom(fadeOutAction, duration, warp = false) {
		return fadeOutAction.crossFadeTo(this, duration, warp);
	}
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
	warp(timeScale, duration = 0) {
		const mixerTime = this.mixer ? this.mixer.time : 0;
		this._warpFrom = this._effectiveTimeScale;
		this._warpTo = timeScale;
		this._warpStart = mixerTime;
		this._warpEnd = mixerTime + Math.max(1e-4, duration);
		return this;
	}
	_update(deltaTime, mixerTime) {
		if (!this.enabled) return;
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
		} else this._effectiveWeight = this.weight;
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
		let event = null;
		if (loop === 2200) {
			if (this.time >= duration) {
				this.time = duration;
				this._finish(1, mixerTime);
				event = {
					type: "finished",
					action: this,
					direction: 1
				};
			} else if (this.time < 0) {
				this.time = 0;
				this._direction = -this._direction;
			}
		} else if (loop === 2202) {
			if (this.time >= duration) {
				this._direction = -1;
				this.time = duration - (this.time - duration);
				if (this.repetitions >= 0 && ++this._loopCount >= this.repetitions) {
					this._finish(-1, mixerTime);
					event = {
						type: "finished",
						action: this,
						direction: -1
					};
				}
				event = event || {
					type: "loop",
					action: this,
					direction: -1
				};
			} else if (this.time < 0) {
				this._direction = 1;
				this.time = -this.time;
				if (this.repetitions >= 0 && ++this._loopCount >= this.repetitions) {
					this._finish(1, mixerTime);
					event = {
						type: "finished",
						action: this,
						direction: 1
					};
				}
				event = event || {
					type: "loop",
					action: this,
					direction: 1
				};
			}
		} else if (this.time >= duration) {
			this._loopCount++;
			this.time -= Math.floor(this.time / duration) * duration;
			if (this.repetitions >= 0 && this._loopCount >= this.repetitions) {
				this.time = duration;
				this._finish(1, mixerTime);
				event = {
					type: "finished",
					action: this,
					direction: 1
				};
			} else event = {
				type: "loop",
				action: this,
				direction: 1
			};
		} else if (this.time < 0) {
			this._loopCount++;
			this.time = -this.time;
			if (this.time >= duration) this.time = duration;
			if (this.repetitions >= 0 && this._loopCount >= this.repetitions) {
				this._finish(-1, mixerTime);
				event = {
					type: "finished",
					action: this,
					direction: -1
				};
			} else event = {
				type: "loop",
				action: this,
				direction: -1
			};
		}
		if (event && this.mixer) this.mixer._events.push(event);
	}
	_finish(direction, mixerTime) {
		this._finished = true;
		this._direction = direction;
		if (!this.clampWhenFinished && this.mixer) this.mixer._deactivateAction(this);
	}
	_accumulate(accuIndex) {
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
	_apply(accuIndex) {
		for (const pb of this._propertyBindings) pb.binding.apply(accuIndex);
	}
};
const bindingState = /* @__PURE__ */ new WeakMap();
function bindingAcc(binding) {
	let s = bindingState.get(binding);
	if (!s) {
		s = {
			buffer: new Float64Array(Math.max(4, binding.getValueSize)),
			weight: 0,
			quat: false
		};
		bindingState.set(binding, s);
	}
	return s;
}
var AnimationMixer = class extends EventDispatcher {
	constructor(root) {
		super();
		this._actions = [];
		this._bindings = /* @__PURE__ */ new Map();
		this._bindingCache = /* @__PURE__ */ new Map();
		this.time = 0;
		this.timeScale = 1;
		this._events = [];
		this.isAnimationMixer = true;
		this._root = root;
		this.time = 0;
		this.timeScale = 1;
	}
	get root() {
		return this._root;
	}
	getRoot() {
		return this._root;
	}
	clipAction(clip, optionalRoot) {
		const root = optionalRoot !== void 0 ? optionalRoot : this._root;
		const existing = this.existingAction(clip, root);
		if (existing) return existing;
		const action = new AnimationAction(this, clip, root);
		this._actions.push(action);
		return action;
	}
	_activateAction(action) {
		if (!this._actions.includes(action)) this._actions.push(action);
	}
	_deactivateAction(action) {
		const i = this._actions.indexOf(action);
		if (i >= 0) this._actions.splice(i, 1);
	}
	_getBinding(root, track) {
		const key = root.uuid + "|" + track.name;
		let binding = this._bindingCache.get(key);
		if (!binding) {
			binding = PropertyBinding.create(root, track.name);
			binding.getValueSize = track.getValueSize();
			this._bindingCache.set(key, binding);
		}
		return binding;
	}
	update(deltaTime) {
		this.time += deltaTime * this.timeScale;
		const accuIndex = 0;
		const active = this._actions.filter((a) => a.enabled);
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
	setTime(timeInSeconds) {
		const delta = timeInSeconds - this.time;
		if (delta !== 0) this.update(delta);
		return this;
	}
	stopAllAction() {
		for (const action of [...this._actions]) action.stop();
		return this;
	}
	uncacheClip(clip) {
		for (const action of [...this._actions]) if (action.clip === clip) this._deactivateAction(action);
		this._bindingCache.clear();
		return this;
	}
	uncacheRoot(root) {
		for (const action of [...this._actions]) {
			if (action._propertyBindings.every((pb) => pb.binding.rootNode !== root)) continue;
			this._deactivateAction(action);
		}
		this._bindingCache.clear();
		return this;
	}
	existingAction(clip, optionalRoot) {
		const root = optionalRoot !== void 0 ? optionalRoot : this._root;
		return this._actions.find((a) => a.clip === clip && a.root === root);
	}
	getActionByClip(clip) {
		return this._actions.filter((a) => a.clip === clip);
	}
	uncacheAction(clip, optionalRoot) {
		const root = optionalRoot !== void 0 ? optionalRoot : this._root;
		for (const action of [...this._actions]) if (action.clip === clip && action.root === root) this._deactivateAction(action);
		return this;
	}
};
const AnimationUtils = {
	subclip(clip, name, startFrame, endFrame, fps = 30) {
		const tracks = [];
		const start = startFrame / fps, end = endFrame / fps;
		for (const track of clip.tracks) {
			const times = track.times, values = track.values;
			const keep = [];
			const keptValues = [];
			const size = track.getValueSize();
			for (let i = 0; i < times.length; i++) if (times[i] >= start && times[i] < end) {
				keep.push(times[i] - start);
				for (let j = 0; j < size; j++) keptValues.push(values[i * size + j]);
			}
			if (keep.length) {
				const Ctor = track.constructor;
				tracks.push(new Ctor(track.name, keep, keptValues, track.DefaultInterpolation));
			}
		}
		return new AnimationClip(name, end - start, tracks, clip.blendMode);
	},
	clone(clip) {
		return clip.clone();
	}
};

// src/three/loaders.ts
var LoadingManager = class {
	constructor(onLoad, onProgress, onError) {
		this.itemsTotal = 0;
		this.itemsLoaded = 0;
		this.filesLoaded = 0;
		this.onStart = () => {};
		this.onLoad = () => {};
		this.onProgress = () => {};
		this.onError = () => {};
		this.onLoadAll = () => {};
		this.isLoadingManager = true;
		this.urlModifier = null;
		this.handlers = [];
		if (onLoad) this.onLoad = onLoad;
		if (onProgress) this.onProgress = onProgress;
		if (onError) this.onError = onError;
	}
	itemStart(url = "") {
		this.itemsTotal++;
		this.onStart(url, this.itemsLoaded, this.itemsTotal);
	}
	itemEnd(url = "") {
		this.itemsLoaded++;
		this.filesLoaded++;
		this.onProgress(url, this.itemsLoaded, this.itemsTotal);
		if (this.itemsLoaded === this.itemsTotal) {
			this.onLoadAll();
			this.onLoad("", this.itemsLoaded, this.itemsTotal);
		}
	}
	itemError(url = "") {
		this.onError(url);
	}
	resolveURL(url) {
		if (this.urlModifier) return this.urlModifier(url);
		return url;
	}
	addHandler(regex, loader) {
		this.handlers.push({
			type: "handler:" + String(regex),
			callback: loader
		});
		return this;
	}
	removeHandler(regex) {
		const key = "handler:" + String(regex);
		this.handlers = this.handlers.filter((h) => h.type !== key);
		return this;
	}
	getHandler(url) {
		for (const h of this.handlers) {
			if (!h.type.startsWith("handler:")) continue;
			const re = h.type.slice(8);
			try {
				if (new RegExp(re).test(url)) return h.callback;
			} catch {}
		}
		return null;
	}
};
const DefaultLoadingManager = new LoadingManager();
const Cache = {
	enabled: false,
	files: /* @__PURE__ */ new Map(),
	add(key, file) {
		if (this.enabled) this.files.set(key, file);
	},
	get(key) {
		return this.enabled ? this.files.get(key) : void 0;
	},
	remove(key) {
		this.files.delete(key);
		return this;
	},
	clear() {
		this.files.clear();
		return this;
	}
};
var Loader = class {
	constructor(manager = DefaultLoadingManager) {
		this.path = "";
		this.resourcePath = "";
		this.requestHeader = {};
		this.withCredentials = false;
		this.manager = manager;
		this.crossOrigin = "anonymous";
	}
	load(url, onLoad, onProgress, onError) {
		throw new Error("Loader.load must be implemented by subclasses");
	}
	loadAsync(url, onProgress) {
		return new Promise((resolve, reject) => {
			this.load(url, resolve, onProgress, reject);
		});
	}
	setCrossOrigin(value) {
		this.crossOrigin = value;
		return this;
	}
	setPath(value) {
		this.path = value;
		return this;
	}
	setResourcePath(value) {
		this.resourcePath = value;
		return this;
	}
	setRequestHeader(key, value) {
		this.requestHeader[key] = value;
		return this;
	}
	setWithCredentials(value) {
		this.withCredentials = value;
		return this;
	}
	abort() {
		return this;
	}
	parse(data) {
		return data;
	}
};
const LoaderUtils = {
	extractUrlBase(url) {
		const i = url.lastIndexOf("/");
		return i === -1 ? "" : url.slice(0, i + 1);
	},
	getUrlExtension(url) {
		const m = /\.([^\.\/?]+)(\?.*)?$/.exec(url);
		return m ? m[1].toLowerCase() : "";
	},
	createBlobURL(blob) {
		if (typeof URL !== "undefined" && URL.createObjectURL) return URL.createObjectURL(blob);
		return "";
	},
	revokeBlobURL(url) {
		if (typeof URL !== "undefined" && URL.revokeObjectURL) URL.revokeObjectURL(url);
	},
	resolveURL(base, url) {
		if (/^(https?:)?\/\//.test(url) || url.startsWith("data:") || url.startsWith("blob:")) return url;
		if (url.startsWith("/")) return url;
		return (base || "") + url;
	}
};
var FileLoader = class extends Loader {
	constructor(manager = DefaultLoadingManager) {
		super(manager);
		this.path = "";
		this.isFileLoader = true;
		this.responseType = "";
		this.mimeType = "";
	}
	load(url, onLoad, onProgress, onError) {
		const resolved = this.manager.resolveURL(this.resourcePath + this.path + url);
		const mimeType = this.mimeType;
		const cached = Cache.get(resolved);
		if (cached !== void 0) {
			Promise.resolve().then(() => {
				this.manager.itemStart(resolved);
				if (onLoad) onLoad(cached);
				this.manager.itemEnd(resolved);
			});
			return this;
		}
		this.manager.itemStart(resolved);
		const headers = { ...this.requestHeader || {} };
		if (mimeType) headers["Accept"] = mimeType;
		fetch(resolved, {
			headers,
			credentials: this.withCredentials ? "include" : "same-origin"
		}).then((response) => {
			if (!response.ok) throw new Error(`gs3d: failed to fetch '${resolved}' (${response.status})`);
			if (onProgress && response.body) {
				const total = Number(response.headers.get("content-length")) || 0;
				const reader = response.body.getReader();
				const chunks = [];
				let loaded = 0;
				const pump = () => reader.read().then(({ done, value }) => {
					if (done) return;
					chunks.push(value);
					loaded += value.length;
					if (onProgress) onProgress({
						loaded,
						total,
						lengthComputable: total > 0
					});
					return pump();
				});
				return pump().then(() => {
					const merged = new Uint8Array(loaded);
					let off = 0;
					for (const c of chunks) {
						merged.set(c, off);
						off += c.length;
					}
					return {
						response,
						data: merged
					};
				});
			}
			const type = this.responseType || "text";
			if (type === "arraybuffer") return response.arrayBuffer().then((data) => ({
				response,
				data
			}));
			if (type === "blob") return response.blob().then((data) => ({
				response,
				data
			}));
			if (type === "json") return response.json().then((data) => ({
				response,
				data
			}));
			return response.text().then((data) => ({
				response,
				data
			}));
		}).then(({ data }) => {
			Cache.add(resolved, data);
			if (onLoad) onLoad(data);
			this.manager.itemEnd(resolved);
		}).catch((error) => {
			this.manager.itemError(resolved);
			this.manager.itemEnd(resolved);
			if (onError) onError(error);
		});
		return this;
	}
	setPath(value) {
		this.path = value;
		return this;
	}
	setResourcePath(value) {
		this.resourcePath = value;
		return this;
	}
	setResponseType(value) {
		this.responseType = value;
		return this;
	}
	setMimeType(value) {
		this.mimeType = value;
		return this;
	}
	loadAsync(url, onProgress) {
		return new Promise((resolve, reject) => {
			this.load(url, resolve, onProgress, reject);
		});
	}
	abort() {
		return this;
	}
};

// src/three/raycaster.ts
var Raycaster = class {
	setFromXRController() {
		return this;
	}
	constructor(origin = new Vector3(), direction = new Vector3(0, 0, -1), near = 0, far = 1e400) {
		this.ray = new Ray(origin, direction);
		this.near = near;
		this.far = far;
		this.camera = null;
		this.layers = new Layers();
	}
	set(origin, direction) {
		this.ray.set(origin, direction);
		return this;
	}
	setFromCamera(coords, camera) {
		const world = worldMatrixOf(camera);
		this.camera = camera;
		if (camera.isOrthographicCamera) {
			const cx = (camera.left + camera.right) * .5 + coords.x * (camera.right - camera.left) * .5;
			const cy = (camera.bottom + camera.top) * .5 + coords.y * (camera.top - camera.bottom) * .5;
			const near = Number.isFinite(camera.near) ? camera.near : .1;
			const pos = transformPoint(world, cx, cy, -near);
			const dir = normalize3(transformDir(world, 0, 0, -1));
			this.ray.origin.set(pos[0], pos[1], pos[2]);
			this.ray.direction.set(dir[0], dir[1], dir[2]);
			return this;
		}
		const pos = transformPoint(world, 0, 0, 0);
		const tanFov = Math.max(1e-4, Math.tan((camera.fov ?? 50) * Math.PI / 180 / 2));
		const aspect = camera.aspect > 0 ? camera.aspect : 1;
		const lx = coords.x * tanFov * aspect, ly = coords.y * tanFov;
		const local = normalize3([
			lx,
			ly,
			-1
		]);
		const dir = normalize3(transformDir(world, local[0], local[1], local[2]));
		this.ray.origin.set(pos[0], pos[1], pos[2]);
		this.ray.direction.set(dir[0], dir[1], dir[2]);
		return this;
	}
	intersectObject(object, recursive = true, hits = []) {
		const walk = (node) => {
			if (this.layers.test(node.layers) && node.isInstancedMesh && node.geometry && node.geometry.attributes && node.geometry.attributes.position) {
				const world = worldMatrixOf(node);
				const count = Math.min(node.count, node._maxCount);
				const arr = node.instanceMatrix.array;
				for (let i = 0; i < count; i++) {
					const instWorld = multiplyMat4(world, arr.subarray(i * 16, i * 16 + 16));
					this._intersectMesh(node, instWorld, hits, i);
				}
			} else if (this.layers.test(node.layers) && node.isMesh && node.geometry && node.geometry.attributes && node.geometry.attributes.position) this._intersectMesh(node, worldMatrixOf(node), hits);
			if (recursive) for (const child of node.children) walk(child);
		};
		walk(object);
		hits.sort((a, b) => a.distance - b.distance);
		return hits;
	}
	intersectObjects(objects, recursive = true, hits = []) {
		for (const object of objects) this.intersectObject(object, recursive, hits);
		return hits;
	}
	_intersectMesh(mesh, world, hits, instanceId) {
		const geometry = mesh.geometry;
		const pos = geometry.attributes.position;
		if (!pos) return;
		if (!geometry.boundingBox) geometry.computeBoundingBox();
		const inv = invertMat4(world);
		if (!inv) return;
		const ox = this.ray.origin.x, oy = this.ray.origin.y, oz = this.ray.origin.z;
		const lo = transformPoint(inv, ox, oy, oz);
		const ld = normalize3(transformDir(inv, this.ray.direction.x, this.ray.direction.y, this.ray.direction.z));
		if (geometry.boundingBox && rayBoxT(lo[0], lo[1], lo[2], ld[0], ld[1], ld[2], geometry.boundingBox) === null) return;
		const p = pos.array, is = pos.itemSize;
		const uvAttr = geometry.attributes.uv;
		const uvArr = uvAttr ? uvAttr.array : null;
		const uvSize = uvAttr ? uvAttr.itemSize : 0;
		const index = geometry.index && geometry.index.array;
		const totalIndices = index ? index.length : pos.count;
		const groups = geometry.groups && geometry.groups.length ? geometry.groups : [{
			start: 0,
			count: totalIndices,
			materialIndex: 0
		}];
		const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
		let best = null;
		for (const grp of groups) {
			const mat = mats[Math.min(grp.materialIndex || 0, mats.length - 1)];
			const side = mat && mat.side !== void 0 ? mat.side : 0;
			const end = Math.min(grp.start + grp.count, totalIndices);
			for (let i = grp.start; i + 2 < end; i += 3) {
				const ia = index ? index[i] : i;
				const ib = index ? index[i + 1] : i + 1;
				const ic = index ? index[i + 2] : i + 2;
				const a = ia * is, b = ib * is, c = ic * is;
				const hit = rayTriangle(lo[0], lo[1], lo[2], ld[0], ld[1], ld[2], p[a], p[a + 1], p[a + 2], p[b], p[b + 1], p[b + 2], p[c], p[c + 1], p[c + 2], side);
				if (!hit) continue;
				const wp = transformPoint(world, lo[0] + ld[0] * hit.t, lo[1] + ld[1] * hit.t, lo[2] + ld[2] * hit.t);
				const distance = Math.hypot(wp[0] - ox, wp[1] - oy, wp[2] - oz);
				if (distance < this.near || distance > this.far) continue;
				if (!best || distance < best.distance) best = {
					distance,
					wp,
					ia,
					ib,
					ic,
					a,
					b,
					c,
					u: hit.u,
					v: hit.v,
					faceIndex: Math.floor(i / 3),
					materialIndex: grp.materialIndex || 0
				};
			}
		}
		if (!best) return;
		const { distance, wp, ia, ib, ic, a, b, c, u, v, faceIndex, materialIndex } = best;
		const e1 = [
			p[b] - p[a],
			p[b + 1] - p[a + 1],
			p[b + 2] - p[a + 2]
		];
		const e2 = [
			p[c] - p[a],
			p[c + 1] - p[a + 1],
			p[c + 2] - p[a + 2]
		];
		const n = normalize3([
			e1[1] * e2[2] - e1[2] * e2[1],
			e1[2] * e2[0] - e1[0] * e2[2],
			e1[0] * e2[1] - e1[1] * e2[0]
		]);
		const wn = normalize3(transformDir(world, n[0], n[1], n[2]));
		let uv = null;
		if (uvArr && uvSize >= 2) {
			const w0 = 1 - u - v;
			uv = new Vector2(uvArr[ia * uvSize] * w0 + uvArr[ib * uvSize] * u + uvArr[ic * uvSize] * v, uvArr[ia * uvSize + 1] * w0 + uvArr[ib * uvSize + 1] * u + uvArr[ic * uvSize + 1] * v);
		}
		const entry = {
			distance,
			point: new Vector3(wp[0], wp[1], wp[2]),
			face: {
				a: ia,
				b: ib,
				c: ic,
				normal: new Vector3(wn[0], wn[1], wn[2]),
				materialIndex
			},
			faceIndex,
			object: mesh,
			uv
		};
		if (instanceId !== void 0) entry.instanceId = instanceId;
		hits.push(entry);
	}
};

// src/three/controls.ts
var OrbitControls = class {
	constructor(object, domElement) {
		if (!object || !object.isCamera) throw new TypeError("gs3d: OrbitControls requires a camera");
		this.object = object;
		this.domElement = domElement;
		this.target = new Vector3();
		this.enabled = true;
		this.enableDamping = false;
		this.dampingFactor = .05;
		this.enableZoom = true;
		this.enablePan = true;
		this.enableRotate = true;
		this.rotateSpeed = 1;
		this.zoomSpeed = 1;
		this.panSpeed = 1;
		this.minDistance = 0;
		this.maxDistance = 1e400;
		this.minPolarAngle = 0;
		this.maxPolarAngle = Math.PI;
		this.screenSpacePanning = true;
		this._radius = 1;
		this._theta = 0;
		this._phi = Math.PI / 2;
		this._thetaDelta = 0;
		this._phiDelta = 0;
		this._radiusDelta = 1;
		this._panOffset = new Vector3();
		this._pointers = /* @__PURE__ */ new Map();
		this._disposed = false;
		this._onPointerDown = (e) => this._pointerDown(e);
		this._onPointerMove = (e) => this._pointerMove(e);
		this._onPointerUp = (e) => this._pointerUp(e);
		this._onWheel = (e) => this._wheel(e);
		this._onContextMenu = (e) => e.preventDefault();
		this._listeners = /* @__PURE__ */ new Map();
		const el = domElement;
		el.addEventListener("pointerdown", this._onPointerDown);
		el.addEventListener("pointermove", this._onPointerMove);
		el.addEventListener("pointerup", this._onPointerUp);
		el.addEventListener("pointercancel", this._onPointerUp);
		el.addEventListener("wheel", this._onWheel, { passive: false });
		el.addEventListener("contextmenu", this._onContextMenu);
		if (el.setPointerCapture) {}
		if (el.style) el.style.touchAction = "none";
		this._readSpherical();
	}
	addEventListener(type, listener) {
		if (typeof listener !== "function") return;
		let set = this._listeners.get(type);
		if (!set) this._listeners.set(type, set = /* @__PURE__ */ new Set());
		set.add(listener);
	}
	removeEventListener(type, listener) {
		this._listeners.get(type)?.delete(listener);
	}
	hasEventListener(type, listener) {
		return !!this._listeners.get(type)?.has(listener);
	}
	dispatchEvent(event) {
		const type = typeof event === "string" ? event : event?.type;
		const set = this._listeners.get(type);
		if (!set) return false;
		const payload = typeof event === "string" || !event ? {
			type,
			target: this
		} : event;
		if (payload.target === void 0) payload.target = this;
		for (const listener of [...set]) listener.call(this, payload);
		return true;
	}
	rotateLeft(angle) {
		this._thetaDelta -= angle;
		this.update();
	}
	rotateUp(angle) {
		this._phiDelta -= angle;
		this.update();
	}
	dollyIn(scale) {
		this._radiusDelta *= Math.max(1e-6, scale);
		this.update();
	}
	dollyOut(scale) {
		this._radiusDelta /= Math.max(1e-6, scale);
		this.update();
	}
	_readSpherical() {
		const p = this.object.position, t = this.target;
		const dx = p.x - t.x, dy = p.y - t.y, dz = p.z - t.z;
		this._radius = Math.hypot(dx, dy, dz) || 1e-4;
		this._theta = Math.atan2(dx, dz);
		this._phi = Math.acos(Math.max(-1, Math.min(1, dy / this._radius)));
	}
	_sphericalVector(out) {
		const sp = Math.sin(this._phi);
		return out.set(this._radius * sp * Math.sin(this._theta), this._radius * Math.cos(this._phi), this._radius * sp * Math.cos(this._theta));
	}
	_pointerDown(event) {
		if (!this.enabled) return;
		this._pointers.set(event.pointerId, {
			x: event.clientX,
			y: event.clientY,
			pan: event.button === 2 || event.button === 0 && event.shiftKey
		});
		try {
			this.domElement.setPointerCapture(event.pointerId);
		} catch {}
	}
	_pointerMove(event) {
		const point = this._pointers.get(event.pointerId);
		if (!point || !this.enabled) return;
		const dx = event.clientX - point.x, dy = event.clientY - point.y;
		const height = this.domElement.clientHeight || 1;
		if (this._pointers.size === 2 && this.enableZoom) {
			const other = [...this._pointers.values()].find((p) => p !== point);
			if (other) {
				const before = Math.hypot(point.x - other.x, point.y - other.y);
				const after = Math.hypot(event.clientX - other.x, event.clientY - other.y);
				if (before > 0 && after > 0) this._radiusDelta *= before / after;
			}
		} else if (this._pointers.size === 1) {
			if (point.pan) {
				if (this.enablePan) this._pan(dx, dy);
			} else if (this.enableRotate) {
				this._thetaDelta -= 2 * Math.PI * dx / height * this.rotateSpeed;
				this._phiDelta -= 2 * Math.PI * dy / height * this.rotateSpeed;
			}
		}
		point.x = event.clientX;
		point.y = event.clientY;
		this.update();
	}
	_pointerUp(event) {
		this._pointers.delete(event.pointerId);
		try {
			this.domElement.releasePointerCapture?.(event.pointerId);
		} catch {}
	}
	_wheel(event) {
		if (!this.enabled || !this.enableZoom) return;
		event.preventDefault();
		const units = event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? this.domElement.clientHeight || 1 : 1;
		const dy = Math.max(-1, Math.min(1, event.deltaY * units * .002)) * this.zoomSpeed;
		this._radiusDelta *= Math.exp(dy);
		this.update();
	}
	_pan(dx, dy) {
		const s = this._radius * .0016 * this.panSpeed;
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
		const moved = this._thetaDelta !== 0 || this._phiDelta !== 0 || this._radiusDelta !== 1 || this._panOffset.x !== 0 || this._panOffset.y !== 0 || this._panOffset.z !== 0;
		const EPS = 1e-5;
		const ZERO_EPS = 1e-6;
		const damp = this.enableDamping ? Math.min(1, Math.max(.01, this.dampingFactor)) : 1;
		const keep = 1 - damp;
		this._phi = Math.max(EPS, Math.min(Math.PI - EPS, Math.max(this.minPolarAngle, Math.min(this.maxPolarAngle, this._phi + this._phiDelta * damp))));
		this._theta += this._thetaDelta * damp;
		this._radius = Math.max(this.minDistance, Math.min(this.maxDistance, this._radius * (1 + (this._radiusDelta - 1) * damp)));
		this._thetaDelta *= keep;
		this._phiDelta *= keep;
		this._radiusDelta = 1 + (this._radiusDelta - 1) * keep;
		if (Math.abs(this._thetaDelta) < ZERO_EPS) this._thetaDelta = 0;
		if (Math.abs(this._phiDelta) < ZERO_EPS) this._phiDelta = 0;
		if (Math.abs(this._radiusDelta - 1) < ZERO_EPS) this._radiusDelta = 1;
		const offset = this._sphericalVector(new Vector3());
		const pan = this._panOffset;
		this.object.position.set(this.target.x + offset.x + pan.x * damp, this.target.y + offset.y + pan.y * damp, this.target.z + offset.z + pan.z * damp);
		pan.x *= keep;
		pan.y *= keep;
		pan.z *= keep;
		if (Math.hypot(pan.x, pan.y, pan.z) < ZERO_EPS) pan.set(0, 0, 0);
		this.object.lookAt(this.target);
		if (moved) this.dispatchEvent("change");
		return true;
	}
	dispose() {
		if (this._disposed) return;
		this._disposed = true;
		const el = this.domElement;
		el.removeEventListener("pointerdown", this._onPointerDown);
		el.removeEventListener("pointermove", this._onPointerMove);
		el.removeEventListener("pointerup", this._onPointerUp);
		el.removeEventListener("pointercancel", this._onPointerUp);
		el.removeEventListener("wheel", this._onWheel);
		el.removeEventListener("contextmenu", this._onContextMenu);
		this._pointers.clear();
	}
};

// src/three/pmrem.ts
const ENV_FACES = [
	{
		f: [
			1,
			0,
			0
		],
		u: [
			0,
			1,
			0
		]
	},
	{
		f: [
			-1,
			0,
			0
		],
		u: [
			0,
			1,
			0
		]
	},
	{
		f: [
			0,
			1,
			0
		],
		u: [
			0,
			0,
			-1
		]
	},
	{
		f: [
			0,
			-1,
			0
		],
		u: [
			0,
			0,
			1
		]
	},
	{
		f: [
			0,
			0,
			1
		],
		u: [
			0,
			1,
			0
		]
	},
	{
		f: [
			0,
			0,
			-1
		],
		u: [
			0,
			1,
			0
		]
	}
];
function envFaceBasis(face) {
	const f = face.f, up = face.u;
	const zx = -f[0], zy = -f[1], zz = -f[2];
	let xx = up[1] * zz - up[2] * zy, xy = up[2] * zx - up[0] * zz, xz = up[0] * zy - up[1] * zx;
	const xl = Math.hypot(xx, xy, xz) || 1;
	xx /= xl;
	xy /= xl;
	xz /= xl;
	const yx = zy * xz - zz * xy, yy = zz * xx - zx * xz, yz = zx * xy - zy * xx;
	return {
		f,
		x: [
			xx,
			xy,
			xz
		],
		y: [
			yx,
			yy,
			yz
		]
	};
}
var PMREMGenerator = class {
	constructor(renderer) {
		this.renderer = renderer;
		this._rt = -1;
	}
	compileCubemapShader() {
		return this;
	}
	compileEquirectangularShader() {
		return this;
	}
	fromCubemap(texture) {
		return {
			texture,
			dispose() {}
		};
	}
	fromEquirectangular(texture) {
		return {
			texture,
			dispose() {}
		};
	}
	fromScene(scene, sigma = 0, near = .1, far = 100, options = {}) {
		const renderer = this.renderer;
		const engine = renderer && renderer._engine;
		const size = options && options.size ? options.size : 256;
		const eqW = size, eqH = size >> 1;
		const face = Math.max(32, size >> 1);
		if (!engine || typeof engine._g3_asset_render_target_create !== "function") return {
			texture: new DataTexture(new Uint8Array(eqW * eqH * 4), eqW, eqH),
			dispose() {}
		};
		const rt = engine._g3_asset_render_target_create(face, face);
		if (rt < 0) return {
			texture: new DataTexture(new Uint8Array(eqW * eqH * 4), eqW, eqH),
			dispose() {}
		};
		this._rt = rt;
		const bases = ENV_FACES.map(envFaceBasis);
		const faces = [];
		const prevTarget = renderer._captureTarget;
		try {
			for (const b of bases) {
				const cam = new PerspectiveCamera(90, 1, near, far);
				cam.position.set(0, 0, 0);
				cam.lookAt(new Vector3(b.f[0], b.f[1], b.f[2]));
				cam.updateMatrixWorld();
				renderer._captureTarget = rt;
				renderer.render(scene, cam);
				faces.push(readTargetPixels(engine, rt, face));
			}
		} finally {
			renderer._captureTarget = prevTarget;
		}
		const out = new Uint8Array(eqW * eqH * 4);
		const cosL = new Float64Array(eqW), sinL = new Float64Array(eqW);
		for (let i = 0; i < eqW; i++) {
			const l = ((i + .5) / eqW - .5) * 2 * Math.PI;
			cosL[i] = Math.cos(l);
			sinL[i] = Math.sin(l);
		}
		const sinP = new Float64Array(eqH), cosP = new Float64Array(eqH);
		for (let j = 0; j < eqH; j++) {
			const phi = (j + .5) / eqH * Math.PI;
			sinP[j] = Math.sin(phi);
			cosP[j] = Math.cos(phi);
		}
		for (let j = 0; j < eqH; j++) {
			const sp = sinP[j], cp = cosP[j];
			for (let i = 0; i < eqW; i++) {
				const dx = sp * cosL[i], dy = cp, dz = sp * sinL[i];
				let k = 0, denom = -1e400;
				for (let f = 0; f < 6; f++) {
					const dot = dx * bases[f].f[0] + dy * bases[f].f[1] + dz * bases[f].f[2];
					if (dot > denom) {
						denom = dot;
						k = f;
					}
				}
				const b = bases[k];
				const cx = (dx * b.x[0] + dy * b.x[1] + dz * b.x[2]) / denom;
				const cy = (dx * b.y[0] + dy * b.y[1] + dz * b.y[2]) / denom;
				const fx = Math.min(face - 1, Math.max(0, Math.floor((cx * .5 + .5) * face)));
				const fy = Math.min(face - 1, Math.max(0, Math.floor((.5 - cy * .5) * face)));
				sampleFaceBilinear(faces[k], face, fx, fy, out, (j * eqW + i) * 4);
			}
		}
		const texture = new DataTexture(out, eqW, eqH);
		return {
			texture,
			dispose() {
				releaseTexture(texture);
			}
		};
	}
	dispose() {}
};
function readTargetPixels(engine, rt, size) {
	const bytes = size * size * 4;
	const ptr = engine._malloc(bytes);
	const buf = new Uint8Array(engine.HEAPU8.buffer, ptr, bytes);
	if (!engine._g3_host_render_target_read(rt, 0, 0, size, size, ptr, bytes)) {
		engine._free(ptr);
		throw new Error("gs3d: environment render target readback failed");
	}
	const out = new Uint8Array(bytes);
	for (let y = 0; y < size; y++) out.set(buf.subarray((size - 1 - y) * size * 4, (size - y) * size * 4), y * size * 4);
	engine._free(ptr);
	return out;
}
function sampleFaceBilinear(face, size, fx, fy, out, outOff) {
	const x0 = Math.max(0, fx - .5 | 0), y0 = Math.max(0, fy - .5 | 0);
	const x1 = Math.min(size - 1, x0 + 1), y1 = Math.min(size - 1, y0 + 1);
	const tx = Math.min(1, Math.max(0, fx - .5 - x0)), ty = Math.min(1, Math.max(0, fy - .5 - y0));
	const i00 = (y0 * size + x0) * 4, i10 = (y0 * size + x1) * 4;
	const i01 = (y1 * size + x0) * 4, i11 = (y1 * size + x1) * 4;
	for (let c = 0; c < 4; c++) {
		const top = face[i00 + c] * (1 - tx) + face[i10 + c] * tx;
		const bot = face[i01 + c] * (1 - tx) + face[i11 + c] * tx;
		out[outOff + c] = top * (1 - ty) + bot * ty;
	}
}
var RoomEnvironment = class extends Scene {
	constructor() {
		super();
		this.isRoomEnvironment = true;
		const box = (w, h, color, intensity, pos, look) => {
			const c = new Color(color);
			c.r *= intensity;
			c.g *= intensity;
			c.b *= intensity;
			const m = new Mesh(new PlaneGeometry(w, h), new MeshBasicMaterial({ color: c }));
			m.position.set(pos[0], pos[1], pos[2]);
			m.lookAt(new Vector3(look[0], look[1], look[2]));
			m.updateMatrixWorld();
			this.add(m);
		};
		box(10, 10, 0xffffff, 5, [
			0,
			4,
			0
		], [
			0,
			0,
			-1
		]);
		box(6, 3, 0xfff4e0, 3, [
			-4,
			1,
			-3
		], [
			0,
			1,
			0
		]);
		box(4, 6, 0xe8f0ff, 2, [
			4,
			.5,
			-2
		], [
			0,
			1,
			0
		]);
		box(8, 4, 0xffffff, 1.5, [
			0,
			-3,
			2
		], [
			0,
			1,
			0
		]);
		box(3, 3, 0xd0e8ff, 2, [
			-3,
			2,
			3
		], [
			0,
			0,
			-1
		]);
		box(3, 3, 0xffe8d0, 1.5, [
			3,
			2,
			3
		], [
			0,
			0,
			-1
		]);
		this.updateMatrixWorld();
	}
	dispose() {
		this.traverse((node) => {
			node.geometry?.dispose?.();
			for (const material of Array.isArray(node.material) ? node.material : [node.material]) material?.dispose?.();
		});
	}
};

// src/three/compat.ts
const AddOperation = 2;
const AlwaysCompare = 519;
const AttachedBindMode = "attached";
const BasicDepthPacking = 3200;
const ConstantAlphaFactor = 213;
const ConstantColorFactor = 211;
const CubeReflectionMapping = 301;
const CubeRefractionMapping = 302;
const CubeUVReflectionMapping = 306;
const CullFaceBack = 1;
const CullFaceFront = 2;
const CullFaceFrontBack = 3;
const CullFaceNone = 0;
const DetachedBindMode = "detached";
const EqualCompare = 514;
const EquirectangularReflectionMapping = 303;
const EquirectangularRefractionMapping = 304;
const GreaterCompare = 516;
const GreaterEqualCompare = 518;
const LessCompare = 513;
const LessEqualCompare = 515;
const LinearMipMapLinearFilter = 1008;
const LinearMipMapNearestFilter = 1007;
const LinearTransfer = "linear";
const MixOperation = 0;
const MultiplyOperation = 1;
const NearestMipMapLinearFilter = 1006;
const NearestMipMapNearestFilter = 1005;
const NeverCompare = 512;
const NotEqualCompare = 517;
const ObjectSpaceNormalMap = 1;
const OneMinusConstantAlphaFactor = 215;
const OneMinusConstantColorFactor = 214;
const RED_GREEN_RGTC2_Format = 1035;
const RED_RGTC1_Format = 1034;
const RGBADepthPacking = 3202;
const RGBA_ASTC_10x10_Format = 37808;
const RGBA_ASTC_10x5_Format = 37809;
const RGBA_ASTC_10x6_Format = 37810;
const RGBA_ASTC_10x8_Format = 37811;
const RGBA_ASTC_12x10_Format = 37812;
const RGBA_ASTC_12x12_Format = 37813;
const RGBA_ASTC_4x4_Format = 37814;
const RGBA_ASTC_5x4_Format = 37815;
const RGBA_ASTC_5x5_Format = 37816;
const RGBA_ASTC_6x5_Format = 37817;
const RGBA_ASTC_6x6_Format = 37818;
const RGBA_ASTC_8x5_Format = 37819;
const RGBA_ASTC_8x6_Format = 37820;
const RGBA_ASTC_8x8_Format = 37821;
const RGBA_BPTC_Format = 36492;
const RGBA_ETC2_EAC_Format = 37492;
const RGBA_PVRTC_2BPPV1_Format = 35843;
const RGBA_PVRTC_4BPPV1_Format = 35840;
const RGBA_S3TC_DXT1_Format = 33777;
const RGBA_S3TC_DXT3_Format = 33778;
const RGBA_S3TC_DXT5_Format = 33779;
const RGBDepthPacking = 3201;
const RGB_BPTC_SIGNED_Format = 36494;
const RGB_BPTC_UNSIGNED_Format = 36493;
const RGB_ETC1_Format = 36196;
const RGB_ETC2_Format = 37490;
const RGB_PVRTC_2BPPV1_Format = 35842;
const RGB_PVRTC_4BPPV1_Format = 35841;
const RGB_S3TC_DXT1_Format = 33776;
const RGDepthPacking = 3203;
const SIGNED_RED_GREEN_RGTC2_Format = 1037;
const SIGNED_RED_RGTC1_Format = 1036;
const SRGBTransfer = "srgb";
const TangentSpaceNormalMap = 0;
const TriangleFanDrawMode = 6;
const TriangleStripDrawMode = 5;
const TrianglesDrawMode = 4;
const UVMapping = 300;
const WebGLCoordinateSystem = 2e3;
const WebGPUCoordinateSystem = 2001;
const MOUSE = {
	LEFT: 0,
	MIDDLE: 1,
	RIGHT: 2,
	ROTATE: 0,
	DOLLY: 1,
	PAN: 2
};
const TOUCH = {
	ROTATE: 0,
	PAN: 1,
	DOLLY_PAN: 2,
	DOLLY_ROTATE: 3
};
const InterpolationSamplingMode = {
	LINEAR: 1,
	NEAREST: 0
};
const InterpolationSamplingType = {
	COLORSPACE: 2,
	SEPARATOR: 1,
	ASSIGN: 0
};
const TimestampQuery = {
	NONE: 0,
	WAIT: 1,
	INVERT: 2
};
var Spherical = class Spherical {
	constructor(radius = 1, phi = 0, theta = 0) {
		this.isSpherical = true;
		this.radius = radius;
		this.phi = phi;
		this.theta = theta;
	}
	set(radius, phi, theta) {
		this.radius = radius;
		this.phi = phi;
		this.theta = theta;
		return this;
	}
	copy(other) {
		this.radius = other.radius;
		this.phi = other.phi;
		this.theta = other.theta;
		return this;
	}
	clone() {
		return new Spherical(this.radius, this.phi, this.theta);
	}
	setFromVector3(v) {
		this.radius = v.length();
		if (this.radius === 0) {
			this.theta = 0;
			this.phi = 0;
		} else {
			this.theta = Math.atan2(v.x, v.z);
			this.phi = Math.acos(v.y / this.radius);
		}
		return this;
	}
	setFromCartesianCoords(x, y, z) {
		return this.setFromVector3(new Vector3(x, y, z));
	}
	makeSafe() {
		const eps = 1e-6;
		this.phi = Math.max(eps, Math.min(Math.PI - eps, this.phi));
		return this;
	}
};
var Cylindrical = class Cylindrical {
	constructor(radius = 1, theta = 0, y = 0) {
		this.isCylindrical = true;
		this.radius = radius;
		this.theta = theta;
		this.y = y;
	}
	set(radius, theta, y) {
		this.radius = radius;
		this.theta = theta;
		this.y = y;
		return this;
	}
	copy(other) {
		this.radius = other.radius;
		this.theta = other.theta;
		this.y = other.y;
		return this;
	}
	clone() {
		return new Cylindrical(this.radius, this.theta, this.y);
	}
	setFromVector3(v) {
		this.radius = Math.sqrt(v.x * v.x + v.z * v.z);
		this.theta = Math.atan2(v.x, v.z);
		this.y = v.y;
		return this;
	}
	setFromCartesianCoords(x, y, z) {
		return this.setFromVector3(new Vector3(x, y, z));
	}
};
var LineCurve = class extends Curve {
	constructor(v1 = new Vector2(), v2 = new Vector2()) {
		super();
		this.isLineCurve = true;
		this.v1 = new Vector2(v1.x ?? v1[0], v1.y ?? v1[1]);
		this.v2 = new Vector2(v2.x ?? v2[0], v2.y ?? v2[1]);
	}
	getPoint(t) {
		return [this.v1.x + (this.v2.x - this.v1.x) * t, this.v1.y + (this.v2.y - this.v1.y) * t];
	}
	getTangent() {
		return this.getPoint(1).map((v, i) => v - this.getPoint(0)[i]);
	}
	copy(source) {
		this.v1.copy(source.v1);
		this.v2.copy(source.v2);
		return this;
	}
	toJSON(meta = {}) {
		return {
			type: "LineCurve",
			v1: [this.v1.x, this.v1.y],
			v2: [this.v2.x, this.v2.y]
		};
	}
};
var QuadraticBezierCurve = class extends Curve {
	constructor(v0 = new Vector2(), v1 = new Vector2(), v2 = new Vector2()) {
		super();
		this.isQuadraticBezierCurve = true;
		this.v0 = v0 instanceof Vector2 ? v0.clone() : new Vector2(v0.x ?? v0[0], v0.y ?? v0[1]);
		this.v1 = v1 instanceof Vector2 ? v1.clone() : new Vector2(v1.x ?? v1[0], v1.y ?? v1[1]);
		this.v2 = v2 instanceof Vector2 ? v2.clone() : new Vector2(v2.x ?? v2[0], v2.y ?? v2[1]);
	}
	getPoint(t) {
		const a = (1 - t) * (1 - t), b = 2 * (1 - t) * t, c = t * t;
		return [a * this.v0.x + b * this.v1.x + c * this.v2.x, a * this.v0.y + b * this.v1.y + c * this.v2.y];
	}
	getTangent(t) {
		const a = -2 * (1 - t), b = 2 - 4 * t, c = 2 * t;
		return [a * this.v0.x + b * this.v1.x + c * this.v2.x, a * this.v0.y + b * this.v1.y + c * this.v2.y];
	}
	copy(source) {
		this.v0.copy(source.v0);
		this.v1.copy(source.v1);
		this.v2.copy(source.v2);
		return this;
	}
};
var CubicBezierCurve = class extends Curve {
	constructor(v0 = new Vector2(), v1 = new Vector2(), v2 = new Vector2(), v3 = new Vector2()) {
		super();
		this.isCubicBezierCurve = true;
		const mk = (v) => v instanceof Vector2 ? v.clone() : new Vector2(v.x ?? v[0], v.y ?? v[1]);
		this.v0 = mk(v0);
		this.v1 = mk(v1);
		this.v2 = mk(v2);
		this.v3 = mk(v3);
	}
	getPoint(t) {
		const u = 1 - t;
		const a = u * u * u, b = 3 * u * u * t, c = 3 * u * t * t, d = t * t * t;
		return [a * this.v0.x + b * this.v1.x + c * this.v2.x + d * this.v3.x, a * this.v0.y + b * this.v1.y + c * this.v2.y + d * this.v3.y];
	}
	getTangent(t) {
		const u = 1 - t;
		const a = 3 * u * u, b = 6 * u * t, c = 3 * t * t;
		return [a * (this.v1.x - this.v0.x) + b * (this.v2.x - this.v1.x) + c * (this.v3.x - this.v2.x), a * (this.v1.y - this.v0.y) + b * (this.v2.y - this.v1.y) + c * (this.v3.y - this.v2.y)];
	}
	copy(source) {
		this.v0.copy(source.v0);
		this.v1.copy(source.v1);
		this.v2.copy(source.v2);
		this.v3.copy(source.v3);
		return this;
	}
};
var ArcCurve = class extends Curve {
	constructor(aX = 0, aY = 0, xRadius = 1, yRadius = 1, aStartAngle = 0, aEndAngle = Math.PI * 2, aClockwise = false) {
		super();
		this.isArcCurve = true;
		this.aX = aX;
		this.aY = aY;
		this.xRadius = xRadius;
		this.yRadius = yRadius;
		this.aStartAngle = aStartAngle;
		this.aEndAngle = aEndAngle;
		this.aClockwise = aClockwise;
	}
	getPoint(t) {
		const angle = this.aStartAngle + (this.aEndAngle - this.aStartAngle) * (this.aClockwise ? 1 - t : t);
		return [this.aX + this.xRadius * Math.cos(angle), this.aY + this.yRadius * Math.sin(angle)];
	}
	getTangent(t) {
		const angle = this.aStartAngle + (this.aEndAngle - this.aStartAngle) * (this.aClockwise ? 1 - t : t);
		const dir = this.aClockwise ? -1 : 1;
		const d = (this.aEndAngle - this.aStartAngle) * dir;
		return [-this.xRadius * Math.sin(angle) * d, this.yRadius * Math.cos(angle) * d];
	}
	copy(source) {
		Object.assign(this, {
			aX: source.aX,
			aY: source.aY,
			xRadius: source.xRadius,
			yRadius: source.yRadius,
			aStartAngle: source.aStartAngle,
			aEndAngle: source.aEndAngle,
			aClockwise: source.aClockwise
		});
		return this;
	}
};
var EllipseCurve = class extends Curve {
	constructor(aX = 0, aY = 0, xRadius = 1, yRadius = 1, aStartAngle = 0, aEndAngle = Math.PI * 2, aClockwise = false, aRotation = 0) {
		super();
		this.isEllipseCurve = true;
		this.aX = aX;
		this.aY = aY;
		this.xRadius = xRadius;
		this.yRadius = yRadius;
		this.aStartAngle = aStartAngle;
		this.aEndAngle = aEndAngle;
		this.aClockwise = aClockwise;
		this.aRotation = aRotation;
	}
	getPoint(t) {
		const angle = this.aStartAngle + (this.aEndAngle - this.aStartAngle) * (this.aClockwise ? 1 - t : t);
		const x = this.xRadius * Math.cos(angle), y = this.yRadius * Math.sin(angle);
		const rot = this.aRotation || 0;
		const c = Math.cos(rot), s = Math.sin(rot);
		return [this.aX + c * x - s * y, this.aY + s * x + c * y];
	}
	copy(source) {
		Object.assign(this, {
			aX: source.aX,
			aY: source.aY,
			xRadius: source.xRadius,
			yRadius: source.yRadius,
			aStartAngle: source.aStartAngle,
			aEndAngle: source.aEndAngle,
			aClockwise: source.aClockwise
		});
		this.aRotation = source.aRotation;
		return this;
	}
};
var SplineCurve = class extends Curve {
	constructor(points = []) {
		super();
		this.isSplineCurve = true;
		this.points = points.map((p) => p instanceof Vector2 ? p.clone() : new Vector2(p.x ?? p[0], p.y ?? p[1]));
	}
	getPoint(t) {
		const p = this.points, n = p.length;
		if (n === 0) return [0, 0];
		const f = Math.min(Math.max(t, 0), 1) * (n - 1);
		const i = Math.min(Math.floor(f), n - 2);
		const u = f - i, p0 = p[Math.max(0, i - 1)], p1 = p[i], p2 = p[i + 1], p3 = p[Math.min(n - 1, i + 2)];
		const cr = (a, b, c, d) => .5 * (2 * b + (-a + c) * u + (2 * a - 5 * b + 4 * c - d) * u * u + (-a + 3 * b - 3 * c + d) * u * u * u);
		return [cr(p0.x, p1.x, p2.x, p3.x), cr(p0.y, p1.y, p2.y, p3.y)];
	}
	copy(source) {
		this.points = source.points.map((p) => p.clone());
		return this;
	}
};
function mkV3(v) {
	return v instanceof Vector3 ? v.clone() : new Vector3(v.x ?? v[0], v.y ?? v[1], v.z ?? v[2]);
}
var LineCurve3 = class extends Curve {
	constructor(v1 = new Vector3(), v2 = new Vector3()) {
		super();
		this.isLineCurve3 = true;
		this.v1 = mkV3(v1);
		this.v2 = mkV3(v2);
	}
	getPoint(t) {
		return new Vector3().copy(this.v1).lerp(this.v2, t);
	}
	copy(source) {
		this.v1.copy(source.v1);
		this.v2.copy(source.v2);
		return this;
	}
};
var QuadraticBezierCurve3 = class extends Curve {
	constructor(v0 = new Vector3(), v1 = new Vector3(), v2 = new Vector3()) {
		super();
		this.isQuadraticBezierCurve3 = true;
		this.v0 = mkV3(v0);
		this.v1 = mkV3(v1);
		this.v2 = mkV3(v2);
	}
	getPoint(t) {
		return new Vector3().copy(this.v0).multiplyScalar((1 - t) * (1 - t)).addScaledVector(this.v1, 2 * (1 - t) * t).addScaledVector(this.v2, t * t);
	}
	copy(source) {
		this.v0.copy(source.v0);
		this.v1.copy(source.v1);
		this.v2.copy(source.v2);
		return this;
	}
};
var CubicBezierCurve3 = class extends Curve {
	constructor(v0 = new Vector3(), v1 = new Vector3(), v2 = new Vector3(), v3 = new Vector3()) {
		super();
		this.isCubicBezierCurve3 = true;
		this.v0 = mkV3(v0);
		this.v1 = mkV3(v1);
		this.v2 = mkV3(v2);
		this.v3 = mkV3(v3);
	}
	getPoint(t) {
		const u = 1 - t;
		return new Vector3().copy(this.v0).multiplyScalar(u * u * u).addScaledVector(this.v1, 3 * u * u * t).addScaledVector(this.v2, 3 * u * t * t).addScaledVector(this.v3, t * t * t);
	}
	copy(source) {
		this.v0.copy(source.v0);
		this.v1.copy(source.v1);
		this.v2.copy(source.v2);
		this.v3.copy(source.v3);
		return this;
	}
};
var CurvePath = class extends Curve {
	constructor() {
		super();
		this.isCurvePath = true;
		this.curves = [];
	}
	add(curve) {
		this.curves.push(curve);
		return this;
	}
	closePath() {
		const first = this.curves[0], last = this.curves[this.curves.length - 1];
		if (first && last) {
			last.getPoint?.(1);
			first.getPoint?.(0);
			last.closePath?.();
		}
		return this;
	}
	getCurveLengths() {
		const lens = [];
		let total = 0;
		for (const c of this.curves) {
			const l = c.getLength();
			lens.push(total + l);
			total += l;
		}
		return lens;
	}
	getCurveLengthsArray() {
		return this.getCurveLengths();
	}
	getLength() {
		return this.curves.reduce((s, c) => s + c.getLength(), 0);
	}
	getPoint(t, optionalTarget = null) {
		const target = t * this.getLength();
		let acc = 0;
		for (const c of this.curves) {
			const l = c.getLength();
			if (acc + l >= target || c === this.curves[this.curves.length - 1]) {
				const u = l === 0 ? 0 : (target - acc) / l;
				const p = c.getPoint(Math.min(1, Math.max(0, u)));
				return optionalTarget ? typeof optionalTarget.set === "function" ? optionalTarget.set(p[0], p[1], p[2] ?? 0) : optionalTarget : new Vector3(p[0], p[1], p[2] ?? 0);
			}
			acc += l;
		}
		return optionalTarget || new Vector3();
	}
	getPointAt(u, target) {
		return this.getPoint(u, target);
	}
	getSpacedPoints(divisions = 40) {
		const pts = [];
		for (let i = 0; i <= divisions; i++) pts.push(this.getPointAt(i / divisions));
		return pts;
	}
	getPoints(divisions = 12) {
		const pts = [];
		for (const c of this.curves) {
			const n = Math.max(2, Math.round(divisions));
			for (let i = 0; i < n; i++) pts.push(c.getPoint(i / n));
		}
		pts.push(this.curves[this.curves.length - 1]?.getPoint(1) ?? [0, 0]);
		return pts;
	}
	copy(source) {
		this.curves = source.curves.map((c) => c.clone ? c.clone() : c);
		return this;
	}
};
var ShapePath = class extends Path {
	constructor() {
		super();
		this.isShapePath = true;
		this.currentPoint = new Vector2();
	}
	absarc(x, y, radius, startAngle, endAngle, clockwise = false) {
		return this.absellipse(x, y, radius, radius, 0, startAngle, endAngle, clockwise);
	}
	arc(x, y, radius, startAngle, endAngle, clockwise = false) {
		return this.absellipse(this.currentPoint.x + x, this.currentPoint.y + y, radius, radius, 0, startAngle, endAngle, clockwise);
	}
	arcTo(x1, y1, x2, y2, radius, clockwise = false) {
		return this.quadraticCurveTo(x1, y1, x2, y2);
	}
	bezierCurveTo(cp1x, cp1y, cp2x, cp2y, x, y) {
		const c = new CubicBezierCurve(this.currentPoint.clone(), new Vector2(cp1x, cp1y), new Vector2(cp2x, cp2y), new Vector2(x, y));
		this.curves.push(c);
		this.currentPoint.set(x, y);
		return this;
	}
	splineThru(points) {
		for (const p of points) this.lineTo(p.x ?? p[0], p.y ?? p[1]);
		return this;
	}
	toShapes(isCCW = false) {
		const shapes = [];
		const s = new Shape();
		s.curves = this.curves.map((c) => c.clone ? c.clone() : c);
		shapes.push(s);
		return shapes;
	}
};
var Matrix2 = class Matrix2 {
	constructor() {
		this.isMatrix2 = true;
		this.elements = [
			1,
			0,
			0,
			1
		];
	}
	set(n11, n12, n21, n22) {
		const e = this.elements;
		e[0] = n11;
		e[2] = n12;
		e[1] = n21;
		e[3] = n22;
		return this;
	}
	identity() {
		return this.set(1, 0, 0, 1);
	}
	copy(m) {
		this.elements = m.elements.slice();
		return this;
	}
	clone() {
		return new Matrix2().copy(this);
	}
	determinant() {
		const e = this.elements;
		return e[0] * e[3] - e[2] * e[1];
	}
	inverse() {
		const e = this.elements, det = this.determinant() || 1;
		this.set(e[3] / det, -e[2] / det, -e[1] / det, e[0] / det);
		return this;
	}
	transpose() {
		const e = this.elements;
		this.set(e[0], e[1], e[2], e[3]);
		return this;
	}
	multiply(m) {
		const a = this.elements.slice(), b = m.elements;
		this.set(a[0] * b[0] + a[2] * b[1], a[0] * b[2] + a[2] * b[3], a[1] * b[0] + a[3] * b[1], a[1] * b[2] + a[3] * b[3]);
		return this;
	}
	multiplyScalar(s) {
		const e = this.elements;
		e[0] *= s;
		e[1] *= s;
		e[2] *= s;
		e[3] *= s;
		return this;
	}
	equals(m) {
		return this.elements.every((v, i) => v === m.elements[i]);
	}
	fromArray(a, o = 0) {
		this.set(a[o], a[o + 1], a[o + 2], a[o + 3]);
		return this;
	}
	toArray(a, o = 0) {
		const e = this.elements;
		const r = a ?? [];
		r[o] = e[0];
		r[o + 1] = e[2];
		r[o + 2] = e[1];
		r[o + 3] = e[3];
		return r;
	}
	getInverse(m) {
		return this.copy(m).inverse();
	}
	scale(v) {
		const e = this.elements;
		e[0] *= v.x;
		e[1] *= v.x;
		e[2] *= v.y;
		e[3] *= v.y;
		return this;
	}
	rotate(angle) {
		const c = Math.cos(angle), s = Math.sin(angle);
		this.multiply(new Matrix2().set(c, s, -s, c));
		return this;
	}
	makeRotation(theta) {
		this.set(Math.cos(theta), Math.sin(theta), -Math.sin(theta), Math.cos(theta));
		return this;
	}
	makeScale(x, y) {
		return this.set(x, 0, 0, y);
	}
	setUvTransform(tx, ty, sx, sy, rotation, cx, cy) {
		const c = Math.cos(rotation), sn = Math.sin(rotation);
		this.set(sx * c, sy * sn, -sx * sn, sy * c);
		return this;
	}
};
var Matrix3 = class Matrix3 {
	constructor() {
		this.isMatrix3 = true;
		this.elements = [
			1,
			0,
			0,
			0,
			1,
			0,
			0,
			0,
			1
		];
	}
	set(n11, n12, n13, n21, n22, n23, n31, n32, n33) {
		const e = this.elements;
		e[0] = n11;
		e[3] = n12;
		e[6] = n13;
		e[1] = n21;
		e[4] = n22;
		e[7] = n23;
		e[2] = n31;
		e[5] = n32;
		e[8] = n33;
		return this;
	}
	identity() {
		return this.set(1, 0, 0, 0, 1, 0, 0, 0, 1);
	}
	copy(m) {
		this.elements = m.elements.slice();
		return this;
	}
	clone() {
		return new Matrix3().copy(this);
	}
	determinant() {
		const e = this.elements;
		return e[0] * (e[4] * e[8] - e[7] * e[5]) - e[3] * (e[1] * e[8] - e[7] * e[2]) + e[6] * (e[1] * e[5] - e[4] * e[2]);
	}
	inverse() {
		const e = this.elements;
		const id = 1 / (e[0] * (e[4] * e[8] - e[7] * e[5]) - e[3] * (e[1] * e[8] - e[7] * e[2]) + e[6] * (e[1] * e[5] - e[4] * e[2]) || 1);
		this.set((e[4] * e[8] - e[7] * e[5]) * id, (e[6] * e[5] - e[3] * e[8]) * id, (e[3] * e[7] - e[6] * e[4]) * id, (e[7] * e[2] - e[1] * e[8]) * id, (e[0] * e[8] - e[6] * e[2]) * id, (e[6] * e[1] - e[0] * e[7]) * id, (e[1] * e[5] - e[4] * e[2]) * id, (e[3] * e[2] - e[0] * e[5]) * id, (e[0] * e[4] - e[3] * e[1]) * id);
		return this;
	}
	transpose() {
		const e = this.elements.slice();
		this.set(e[0], e[3], e[6], e[1], e[4], e[7], e[2], e[5], e[8]);
		return this;
	}
	multiply(m) {
		const a = this.elements.slice(), b = m.elements, e = this.elements;
		e[0] = a[0] * b[0] + a[3] * b[1] + a[6] * b[2];
		e[1] = a[1] * b[0] + a[4] * b[1] + a[7] * b[2];
		e[2] = a[2] * b[0] + a[5] * b[1] + a[8] * b[2];
		e[3] = a[0] * b[3] + a[3] * b[4] + a[6] * b[5];
		e[4] = a[1] * b[3] + a[4] * b[4] + a[7] * b[5];
		e[5] = a[2] * b[3] + a[5] * b[4] + a[8] * b[5];
		e[6] = a[0] * b[6] + a[3] * b[7] + a[6] * b[8];
		e[7] = a[1] * b[6] + a[4] * b[7] + a[7] * b[8];
		e[8] = a[2] * b[6] + a[5] * b[7] + a[8] * b[8];
		return this;
	}
	multiplyScalar(s) {
		for (let i = 0; i < 9; i++) this.elements[i] *= s;
		return this;
	}
	equals(m) {
		return this.elements.every((v, i) => v === m.elements[i]);
	}
	fromArray(a, o = 0) {
		this.set(a[o], a[o + 1], a[o + 2], a[o + 3], a[o + 4], a[o + 5], a[o + 6], a[o + 7], a[o + 8]);
		return this;
	}
	toArray(a, o = 0) {
		const e = this.elements, r = a ?? [];
		r[o] = e[0];
		r[o + 1] = e[3];
		r[o + 2] = e[6];
		r[o + 3] = e[1];
		r[o + 4] = e[4];
		r[o + 5] = e[7];
		r[o + 6] = e[2];
		r[o + 7] = e[5];
		r[o + 8] = e[8];
		return r;
	}
	getInverse(m) {
		return this.copy(m).inverse();
	}
	scale(v) {
		const e = this.elements;
		e[0] *= v.x;
		e[1] *= v.x;
		e[2] *= v.x;
		e[3] *= v.y;
		e[4] *= v.y;
		e[5] *= v.y;
		return this;
	}
	rotate(theta) {
		const c = Math.cos(theta), s = Math.sin(theta);
		return this.multiply(new Matrix3().set(c, s, 0, -s, c, 0, 0, 0, 1));
	}
	setFromMatrix4(m4) {
		const e = m4.elements;
		this.set(e[0], e[4], e[8], e[1], e[5], e[9], e[2], e[6], e[10]);
		return this;
	}
	setFromMatrix4ColumnMajor(m4) {
		return this.setFromMatrix4(m4);
	}
	setUvTransform(tx, ty, sx, sy, rotation, cx, cy) {
		const c = Math.cos(rotation), s = Math.sin(rotation);
		this.set(sx * c, -sx * s, tx + cx - cx * sx * c + cy * sx * s, sy * s, sy * c, ty + cy - cx * sy * s - cy * sy * c, 0, 0, 1);
		return this;
	}
	normalFromMat4(m) {
		return this.setFromMatrix4(m).inverse().transpose();
	}
	extractBasis(xAxis, yAxis, zAxis) {
		xAxis.set(this.elements[0], this.elements[1], this.elements[2]);
		yAxis.set(this.elements[3], this.elements[4], this.elements[5]);
		zAxis.set(this.elements[6], this.elements[7], this.elements[8]);
		return this;
	}
	getNormalMatrix(m) {
		return this.setFromMatrix4(m).invert();
	}
	invert() {
		return this.inverse();
	}
	makeRotation(theta) {
		return this.rotate(theta);
	}
	makeScale(x, y) {
		return this.set(x, 0, 0, 0, y, 0, 0, 0, 1);
	}
	makeTranslation(x, y) {
		return this.set(1, 0, x, 0, 1, y, 0, 0, 1);
	}
	multiplyMatrices(a, b) {
		return this.copy(a).multiply(b);
	}
	premultiply(m) {
		return this.copy(m).multiply(this);
	}
	translate(x, y) {
		const e = this.elements;
		e[6] += x;
		e[7] += y;
		return this;
	}
	transposeIntoArray(r, offset = 0) {
		const e = this.elements;
		r[offset] = e[0];
		r[offset + 1] = e[3];
		r[offset + 2] = e[6];
		r[offset + 3] = e[1];
		r[offset + 4] = e[4];
		r[offset + 5] = e[7];
		r[offset + 6] = e[2];
		r[offset + 7] = e[5];
		r[offset + 8] = e[8];
		return r;
	}
};
function attrCtor(C) {
	return class extends BufferAttribute {
		constructor(array, itemSize, normalized = false) {
			super(array instanceof C ? array : C.from(array), itemSize, normalized);
		}
	};
}
const Float16BufferAttribute = class extends BufferAttribute {
	constructor(array, itemSize, normalized = false) {
		super(Float32Array.from(array), itemSize, normalized);
	}
};
const Int8BufferAttribute = attrCtor(Int8Array);
const Int16BufferAttribute = attrCtor(Int16Array);
const Int32BufferAttribute = attrCtor(Int32Array);
const Uint8BufferAttribute = attrCtor(Uint8Array);
const Uint8ClampedBufferAttribute = attrCtor(Uint8ClampedArray);
var GLBufferAttribute = class extends BufferAttribute {
	constructor(buffer, type, itemSize, elementSize, count) {
		super(new Float32Array(count * itemSize), itemSize);
		this.isGLBufferAttribute = true;
		this.isGLBufferAttribute = true;
		this.buffer = buffer;
		this.type = type;
		this.elementSize = elementSize;
	}
	getX(index) {
		return this.array[index * this.itemSize] ?? 0;
	}
	setBuffer(buffer) {
		this.buffer = buffer;
		return this;
	}
	setCount(count) {
		this.count = count;
		return this;
	}
	setItemSize(itemSize) {
		this.itemSize = itemSize;
		return this;
	}
	setType(type) {
		this.type = type;
		return this;
	}
};
var InstancedBufferAttribute = class extends BufferAttribute {
	constructor(array, itemSize, meshPerAttribute, normalized = false) {
		super(array, itemSize, normalized);
		this.isInstancedBufferAttribute = true;
		this.meshPerAttribute = meshPerAttribute;
	}
};
var InstancedBufferGeometry = class extends BufferGeometry {
	constructor(..._args) {
		super(..._args);
		this.isInstancedBufferGeometry = true;
		this._maxInstanceCount = 1e400;
	}
	get maxInstanceCount() {
		return this._maxInstanceCount;
	}
	set maxInstanceCount(v) {
		this._maxInstanceCount = v;
	}
	get instanceCount() {
		return this._instanceCount ?? 1e400;
	}
	set instanceCount(v) {
		this._instanceCount = v;
	}
	copy(source) {
		super.copy(source);
		this.instanceCount = source.instanceCount;
		this.maxInstanceCount = source.maxInstanceCount;
		return this;
	}
};
var InstancedInterleavedBuffer = class extends InterleavedBuffer {
	constructor(array, stride, meshPerAttribute) {
		super(array, stride);
		this.isInstancedInterleavedBuffer = true;
		this.meshPerAttribute = meshPerAttribute;
	}
};
var DataArrayTexture = class extends Texture {
	constructor(data = null, width = 1, height = 1, depth = 1) {
		super(data ? {
			data,
			width,
			height,
			depth
		} : null);
		this.isDataArrayTexture = true;
		this.isDataArrayTexture = true;
		this.flipY = false;
		this.unpackAlignment = 4;
		this._layerUpdates = /* @__PURE__ */ new Set();
	}
	addLayerUpdate(layer) {
		this._layerUpdates.add(layer);
		return this;
	}
	clearLayerUpdates() {
		this._layerUpdates.clear();
		return this;
	}
};
var DepthTexture = class extends Texture {
	constructor(width = 1, height = 1, type, mapping, wrapS, wrapT, magFilter, minFilter, anisotropy, format) {
		super({
			width,
			height
		});
		this.isDepthTexture = true;
		this.isDepthTexture = true;
		this.type = type ?? 1026;
		this.mapping = mapping ?? 300;
		this.wrapS = wrapS ?? 1001;
		this.wrapT = wrapT ?? 1001;
		this.magFilter = magFilter ?? 1008;
		this.minFilter = minFilter ?? 1008;
		this.anisotropy = anisotropy ?? 1;
		this.format = format ?? 1026;
		this.flipY = false;
		this.unpackAlignment = 1;
	}
};
var CompressedArrayTexture = class extends Texture {
	constructor(mipmaps = [], width = 1, height = 1, depth = 1, format, type, mapping, wrapS, wrapT, magFilter, minFilter, anisotropy, colorSpace) {
		super(mipmaps);
		this.isCompressedArrayTexture = true;
		this.isCompressedArrayTexture = true;
		this.image = {
			width,
			height,
			depth
		};
		this.mipmaps = mipmaps;
		this.format = format ?? 33777;
		this.type = type ?? 1009;
		this.mapping = mapping ?? 300;
		this.wrapS = wrapS ?? 1001;
		this.wrapT = wrapT ?? 1001;
		this.magFilter = magFilter ?? 1003;
		this.minFilter = minFilter ?? 1003;
		this.anisotropy = anisotropy ?? 1;
		this.generateMipmaps = false;
		this.colorSpace = colorSpace ?? "";
		this.flipY = false;
		this._layerUpdates = /* @__PURE__ */ new Set();
	}
	addLayerUpdate(layer) {
		this._layerUpdates.add(layer);
		return this;
	}
	clearLayerUpdates() {
		this._layerUpdates.clear();
		return this;
	}
};
var CompressedCubeTexture = class extends Texture {
	constructor(mipmaps = [], size = 1, format, type, mapping, wrapS, wrapT, magFilter, minFilter, anisotropy, colorSpace) {
		super(mipmaps);
		this.isCompressedCubeTexture = true;
		this.isCompressedCubeTexture = true;
		this.image = {
			width: size,
			height: size
		};
		this.format = format ?? 33777;
		this.type = type ?? 1009;
		this.mapping = mapping ?? 303;
		this.wrapS = wrapS ?? 1001;
		this.wrapT = wrapT ?? 1001;
		this.magFilter = magFilter ?? 1003;
		this.minFilter = minFilter ?? 1003;
		this.anisotropy = anisotropy ?? 1;
		this.generateMipmaps = false;
		this.colorSpace = colorSpace ?? "";
		this.flipY = false;
	}
};
var ExternalTexture = class extends Texture {
	constructor() {
		super(null);
		this.isExternalTexture = true;
		this.isExternalTexture = true;
	}
};
var FramebufferTexture = class extends Texture {
	constructor(width = 1, height = 1, options = {}) {
		super({
			width,
			height
		});
		this.isFramebufferTexture = true;
		this.isFramebufferTexture = true;
		this.format = options.format ?? 1023;
		this.type = options.type ?? 1009;
		this.flipY = false;
	}
};
var VideoFrameTexture = class extends Texture {
	constructor() {
		super(null);
		this.isVideoFrameTexture = true;
		this._frame = null;
		this.isVideoFrameTexture = true;
	}
	setFrame(frame) {
		this._frame = frame;
		return this;
	}
	update() {
		this.needsUpdate = true;
		return this;
	}
};
var WebGLCubeRenderTarget = class extends WebGLRenderTarget {
	constructor(size = 1, options = {}) {
		super(size, size, options);
		this.isWebGLCubeRenderTarget = true;
		this.isWebGLCubeRenderTarget = true;
		this.isCube = true;
	}
	clear() {
		return this;
	}
	fromEquirectangularTexture(texture, onComplete) {
		onComplete?.();
		return this;
	}
};
var WebGL3DRenderTarget = class extends WebGLRenderTarget {
	constructor(width = 1, height = 1, depth = 1, options = {}) {
		super(width, height, options);
		this.isWebGL3DRenderTarget = true;
		this.isWebGL3DRenderTarget = true;
		this.depth = depth;
	}
};
var WebGLArrayRenderTarget = class extends WebGLRenderTarget {
	constructor(width = 1, height = 1, depth = 1, options = {}) {
		super(width, height, options);
		this.isWebGLArrayRenderTarget = true;
		this.isWebGLArrayRenderTarget = true;
		this.depth = depth;
	}
};
const RenderTarget = WebGLRenderTarget;
var RenderTarget3D = class extends WebGL3DRenderTarget {};
var ArrayCamera = class extends PerspectiveCamera {
	constructor(cameras = []) {
		super(50, 1, .1, 2e3);
		this.isArrayCamera = true;
		this.isArrayCamera = true;
		this.cameras = cameras;
	}
};
var StereoCamera = class extends Object3D {
	constructor() {
		super();
		this.isStereoCamera = true;
		this.aspect = 1;
		this.eyeSep = .064;
		this.cameraL = new PerspectiveCamera();
		this.cameraR = new PerspectiveCamera();
	}
	update(camera) {
		const cam = camera;
		const eyeSepHalf = this.eyeSep / 2;
		this.cameraL.fov = cam.fov ?? 50;
		this.cameraR.fov = cam.fov ?? 50;
		this.cameraL.aspect = this.aspect;
		this.cameraR.aspect = this.aspect;
		this.cameraL.near = cam.near ?? .1;
		this.cameraR.near = cam.near ?? .1;
		this.cameraL.far = cam.far ?? 2e3;
		this.cameraR.far = cam.far ?? 2e3;
		this.cameraL.updateProjectionMatrix();
		this.cameraR.updateProjectionMatrix();
		const dx1 = eyeSepHalf * cam.cameraL?.zoom || eyeSepHalf;
		const dx2 = eyeSepHalf * cam.cameraR?.zoom || eyeSepHalf;
		this.cameraL.position = new Vector3(-dx1, 0, 0);
		this.cameraR.position = new Vector3(dx2, 0, 0);
		return [this.cameraL, this.cameraR];
	}
};
var LOD = class extends Object3D {
	constructor() {
		super();
		this.isLOD = true;
		this.autoUpdate = true;
		this.levels = [];
	}
	addLevel(object, distance = 0) {
		this.levels.push({
			distance,
			object
		});
		this.add(object);
		return this;
	}
	getCurrentLevel() {
		this.position;
		return this.levels.reduce((best, l) => !best || l.distance < best.distance ? l : best, null);
	}
	update(camera) {
		const camPos = new Vector3();
		camera.getWorldPosition?.(camPos);
		const d = camPos.distanceTo(this.position);
		let best = null;
		for (const l of this.levels) if (!best || d >= l.distance) best = l;
		for (const l of this.levels) l.object.visible = l === best;
		return best;
	}
	raycast(_raycaster, _intersects) {
		return [];
	}
	getObjectForDistance(distance) {
		for (const l of this.levels) if (distance < l.distance) return l.object;
		return this.levels[this.levels.length - 1]?.object ?? null;
	}
	removeLevel(index) {
		const l = this.levels.splice(index, 1)[0];
		if (l) this.remove(l.object);
		return this;
	}
};
var FrustumArray = class FrustumArray {
	constructor(frusta = []) {
		this.isFrustumArray = true;
		this.frusta = frusta;
	}
	clone() {
		return new FrustumArray(this.frusta.map((f) => f.clone ? f.clone() : f));
	}
	containsPoint(point) {
		return this.frusta.some((f) => f.containsPoint?.(point));
	}
	intersectsBox(box) {
		return this.frusta.some((f) => f.intersectsBox?.(box));
	}
	intersectsObject(object, camera) {
		return this.frusta.some((f) => f.intersectsObject?.(object, camera));
	}
	intersectsSprite(sprite) {
		return this.frusta.some((f) => f.intersectsSprite?.(sprite));
	}
	intersectsSphere(sphere) {
		return this.frusta.some((f) => f.intersectsSphere?.(sphere));
	}
};
var LightProbe = class extends Object3D {
	constructor(sh) {
		super();
		this.isLightProbe = true;
		this.isLightProbe = true;
		this.sh = sh ?? { coefficients: /* @__PURE__ */ new Float32Array(27) };
	}
	copy(source) {
		super.copy(source);
		this.sh = source.sh;
		return this;
	}
	fromJSON() {
		return this;
	}
	toJSON() {
		return {};
	}
};
var HemisphereLightHelper = class extends Object3D {
	constructor(light, size, color) {
		super();
		this.isHemisphereLightHelper = true;
		this.isHemisphereLightHelper = true;
		this.light = light;
		this.size = size ?? 1;
		this.color = color;
	}
	dispose() {}
	updateMatrixWorld(force) {
		super.updateMatrixWorld(force);
		return this;
	}
	update() {
		return this;
	}
	copy(source) {
		super.copy(source);
		this.light = source.light;
		this.size = source.size;
		return this;
	}
};
var BatchedMesh = class extends Mesh {
	get maxInstanceCount() {
		return this._maxInstanceCount;
	}
	set maxInstanceCount(v) {
		this._maxInstanceCount = v;
	}
	get unusedVertexCount() {
		return this._unusedVertexCount;
	}
	set unusedVertexCount(v) {
		this._unusedVertexCount = v;
	}
	get unusedIndexCount() {
		return this._unusedIndexCount;
	}
	set unusedIndexCount(v) {
		this._unusedIndexCount = v;
	}
	constructor(geometry, material, maxInstanceCount = 1e400) {
		super(geometry, material);
		this.isBatchedMesh = true;
		this._maxInstanceCount = 1e400;
		this._unusedVertexCount = 0;
		this._unusedIndexCount = 0;
		this._instances = [];
		this._geometryInfo = [];
		this._sortObjects = null;
		this.isBatchedMesh = true;
		this.maxInstanceCount = maxInstanceCount;
		this._geometryInfo = [];
		this.perObjectFrustumCulled = false;
	}
	addGeometry(geometry, reservedVertexCount = -1, reservedIndexCount = -1) {
		this._geometryInfo.push({ vertexCount: geometry.attributes?.position?.count ?? 0 });
		return this._geometryInfo.length - 1;
	}
	deleteGeometry(start, count) {
		this._geometryInfo.splice(start, count);
		this._instances = this._instances.filter((i) => i.geometryId < start || i.geometryId >= start + count);
		return this;
	}
	getGeometryIdAt(index) {
		return this._instances[index]?.geometryId ?? -1;
	}
	setGeometryAt(geometryId, geometry, reservedVertexCount = -1, reservedIndexCount = -1) {
		this._geometryInfo[geometryId] = { vertexCount: geometry.attributes?.position?.count ?? 0 };
		return this;
	}
	getGeometryRangeAt(geometryId, callback) {
		callback?.(0, 0, 0, 0);
		return this;
	}
	setGeometrySize(geometryId, vertexCount, indexCount) {
		if (this._geometryInfo[geometryId]) this._geometryInfo[geometryId].vertexCount = vertexCount;
		return this;
	}
	setGeometryIdAt(instanceId, geometryId) {
		if (this._instances[instanceId]) this._instances[instanceId].geometryId = geometryId;
		return this;
	}
	getBoundingBoxAt(geometryId, target) {
		return target ?? {};
	}
	getBoundingSphereAt(geometryId, target) {
		return target ?? {};
	}
	addInstance(geometryId) {
		this._instances.push({
			geometryId,
			matrix: new Matrix4()
		});
		this.count = this._instances.length;
		return this;
	}
	setInstanceCount(count) {
		this._instances.length = count;
		this.count = count;
		return this;
	}
	get instanceCount() {
		return this._instances.length;
	}
	set instanceCount(v) {
		this.setInstanceCount(v);
	}
	deleteInstance(geometryId, instanceId) {
		this._instances.splice(instanceId, 1);
		this.count = this._instances.length;
		return this;
	}
	getMatrixAt(index, matrix) {
		const m = this._instances[index]?.matrix;
		if (m) matrix.copy(m);
		return matrix;
	}
	setMatrixAt(index, matrix) {
		if (this._instances[index]) this._instances[index].matrix.copy(matrix);
		return this;
	}
	getVisibleAt(index) {
		return this._instances[index]?.visible ?? true;
	}
	setVisibleAt(index, visible) {
		if (this._instances[index]) this._instances[index].visible = visible;
		return this;
	}
	getColorAt(index, color) {
		return color.setRGB(1, 1, 1);
	}
	setColorAt(index, color) {
		return this;
	}
	setCustomSort(sortObjects) {
		this._sortObjects = sortObjects;
		return this;
	}
	sort(_objects, _camera) {}
	optimize() {
		return this;
	}
	validateGeometryId(geometryId) {
		return geometryId >= 0 && geometryId < this._geometryInfo.length;
	}
	validateInstanceId(instanceId) {
		return instanceId >= 0 && instanceId < this._instances.length;
	}
};
var AnimationObjectGroup = class extends Object3D {
	constructor(...objects) {
		super();
		this.isAnimationObjectGroup = true;
		this._bindings = [];
		this.isAnimationObjectGroup = true;
		for (const o of objects) this.add(o);
	}
	add(object, ...objects) {
		if (Array.isArray(object)) {
			for (const o of object) this.add(o);
			return this;
		}
		if (arguments.length > 1) {
			for (const o of objects) this.add(o);
			return this;
		}
		this._bindings.push({
			path: "",
			node: object ?? null,
			root: this
		});
		return super.add(object);
	}
	remove(object) {
		const i = this._bindings.findIndex((b) => b.node === object);
		if (i >= 0) this._bindings.splice(i, 1);
		return super.remove(object);
	}
	uncache(clip) {
		return this.uncacheClip(clip);
	}
	uncacheClip(clip) {
		return this;
	}
	subscribe_(binding) {
		this._bindings.push(binding);
		return this;
	}
	unsubscribe_(binding) {
		const i = this._bindings.indexOf(binding);
		if (i >= 0) this._bindings.splice(i, 1);
		return this;
	}
};
var AudioContext = class {
	constructor() {
		this.isAudioContext = true;
		this.state = "running";
		this.currentTime = 0;
		this.sampleRate = 48e3;
		this.destination = {
			connect() {},
			disconnect() {}
		};
	}
	resume() {
		return Promise.resolve();
	}
	suspend() {
		return Promise.resolve();
	}
	close() {
		return Promise.resolve();
	}
	createBuffer(channels, length, sampleRate) {
		return {
			getChannelData: () => new Float32Array(length),
			duration: length / sampleRate
		};
	}
	createBufferSource() {
		return {
			connect() {},
			start() {},
			stop() {},
			onended: null
		};
	}
	createGain() {
		return {
			gain: {
				value: 1,
				setValueAtTime() {},
				linearRampToValueAtTime() {},
				exponentialRampToValueAtTime() {}
			},
			connect() {},
			disconnect() {}
		};
	}
	createAnalyser() {
		return new AudioAnalyser();
	}
	decodeAudioData(data, ok, err) {
		const p = Promise.reject(/* @__PURE__ */ new Error("gs3d: audio decoding not supported"));
		if (err) p.catch(err);
		else p.catch(() => {});
		if (ok) return p.then(ok, err);
		return p;
	}
};
var AudioListener = class extends Object3D {
	constructor() {
		super();
		this.isAudioListener = true;
		this.filter = {
			type: "lowpass",
			frequency: 350,
			Q: 1,
			gain: 0
		};
		this.timeDelta = 0;
		this.context = new AudioContext();
	}
	getInput() {
		return this.context.createGain();
	}
	setFilter() {
		return this;
	}
	setMasterVolume() {
		return this;
	}
	setNodeSource() {
		return this;
	}
	getFilter() {
		return this.filter;
	}
	removeFilter() {
		this.filter = null;
		return this;
	}
	getMasterVolume() {
		return 1;
	}
	updateMatrixWorld(force) {
		super.updateMatrixWorld(force);
		return this;
	}
};
var Audio = class extends Object3D {
	constructor(listener) {
		super();
		this.isAudio = true;
		this.type = "audio";
		this.autoplay = false;
		this.buffers = [];
		this.loop = false;
		this.loopStart = 0;
		this.loopEnd = 0;
		this.offset = 0;
		this.duration = 0;
		this.playbackRate = 1;
		this.detune = 0;
		this.volume = 1;
		this.isPlaying = false;
		this.source = null;
		this._startedAt = 0;
		this.listener = listener;
	}
	play(delay = 0) {
		this.isPlaying = true;
		this._startedAt = performance?.now?.() ?? Date.now();
		return this;
	}
	pause() {
		this.isPlaying = false;
		return this;
	}
	stop() {
		this.isPlaying = false;
		this._startedAt = 0;
		return this;
	}
	setBuffer(buffer) {
		this.buffers = buffer ? [buffer] : [];
		this.duration = buffer?.duration ?? 0;
		return this;
	}
	setLoopTime() {
		return this;
	}
	setLoopStart() {
		return this;
	}
	setLoopEnd() {
		return this;
	}
	getLoopTime() {
		return this.loopEnd - this.loopStart;
	}
	setFilters() {
		return this;
	}
	setFilter() {
		return this;
	}
	setNodeSource() {
		return this;
	}
	getOutput() {
		return this.source ?? {};
	}
	onEnded() {}
	connect() {
		return this;
	}
	disconnect() {
		return this;
	}
	getVolume() {
		return this.volume;
	}
	setVolume(v) {
		this.volume = v;
		return this;
	}
	getPlaybackRate() {
		return this.playbackRate;
	}
	setPlaybackRate(v) {
		this.playbackRate = v;
		return this;
	}
	getDetune() {
		return this.detune;
	}
	setDetune(v) {
		this.detune = v;
		return this;
	}
	getFilter() {
		return null;
	}
	getFilters() {
		return [];
	}
	getLoop() {
		return this.loop;
	}
	setLoop(v) {
		this.loop = v;
		return this;
	}
	setMediaElementSource() {
		return this;
	}
	setMediaStreamSource() {
		return this;
	}
};
var PositionalAudio = class extends Audio {
	constructor(listener) {
		super(listener);
		this.isPositionalAudio = true;
		this.panner = {
			panningModel: "HRTF",
			distanceModel: "inverse",
			refDistance: 1,
			maxDistance: 1e4,
			rolloffFactor: 1,
			coneInnerAngle: 360,
			coneOuterAngle: 0,
			coneOuterGain: 0
		};
	}
	setRefDistance(v) {
		this.panner.refDistance = v;
		return this;
	}
	getRefDistance() {
		return this.panner.refDistance;
	}
	setDirectionalCone(inner, outer, outerGain) {
		Object.assign(this.panner, {
			coneInnerAngle: inner,
			coneOuterAngle: outer,
			coneOuterGain: outerGain
		});
		return this;
	}
	setDistanceModel(v) {
		this.panner.distanceModel = v;
		return this;
	}
	getDistanceModel() {
		return this.panner.distanceModel;
	}
	setMaxDistance(v) {
		this.panner.maxDistance = v;
		return this;
	}
	getMaxDistance() {
		return this.panner.maxDistance;
	}
	setRolloffFactor(v) {
		this.panner.rolloffFactor = v;
		return this;
	}
	getRolloffFactor() {
		return this.panner.rolloffFactor;
	}
	setPanningModel(v) {
		this.panner.panningModel = v;
		return this;
	}
	getPanningModel() {
		return this.panner.panningModel;
	}
};
var Source = class extends Audio {
	getSize() {
		return [0, 0];
	}
	set needsUpdate(v) {
		this.dispatchEvent?.({ type: "change" });
	}
	get needsUpdate() {
		return false;
	}
};
var AudioAnalyser = class {
	constructor() {
		this.isAudioAnalyser = true;
		this.fftSize = 2048;
		this.frequencyBinCount = 1024;
		this.minDecibels = -100;
		this.maxDecibels = -30;
		this.smoothingTimeConstant = .8;
	}
	getByteFrequencyData(arr) {
		arr.fill(0);
	}
	getByteTimeDomainData(arr) {
		arr.fill(128);
	}
	getFloatFrequencyData(arr) {
		arr.fill(-1e400);
	}
	getFloatTimeDomainData(arr) {
		arr.fill(0);
	}
	getFrequencyData(arr) {
		if (arr instanceof Uint8Array) this.getByteFrequencyData(arr);
		else this.getFloatFrequencyData(arr);
	}
	getAverageFrequency() {
		return 0;
	}
};
var AudioLoader = class extends Loader {
	constructor(manager = null) {
		super(manager);
	}
	load(url, onLoad, onProgress, onError) {
		const loader = new FileLoader(this.manager);
		loader.setResponseType("arraybuffer");
		return loader.load(url, (data) => {
			onLoad?.(data);
		}, onProgress, onError);
	}
};
var CubeTextureLoader = class extends Loader {
	constructor(manager = null) {
		super(manager);
	}
	load(url, onLoad, onProgress, onError) {
		const names = [
			"px",
			"nx",
			"py",
			"ny",
			"pz",
			"nz"
		];
		const imgs = [];
		let done = 0;
		for (const n of names) new ImageLoader(this.manager).load(url.replace("%s", n), (i) => {
			imgs[names.indexOf(n)] = i;
			if (++done === 6) onLoad?.(new CubeTexture(imgs));
		}, onProgress, onError);
		return imgs;
	}
};
var DataTextureLoader = class extends Loader {
	constructor(manager = null) {
		super(manager);
	}
	load(url, onLoad, onProgress, onError) {
		const loader = new FileLoader(this.manager);
		loader.setResponseType("arraybuffer");
		loader.load(url, (data) => onLoad?.(new DataTexture(data)), onProgress, onError);
	}
};
var CompressedTextureLoader = class extends Loader {
	constructor(manager = null) {
		super(manager);
	}
	load(url, onLoad, onProgress, onError) {
		const loader = new FileLoader(this.manager);
		loader.setResponseType("arraybuffer");
		loader.load(url, (data) => onLoad?.(Object.assign(new CompressedTexture(), { mipmaps: [data] })), onProgress, onError);
	}
};
var BufferGeometryLoader = class extends Loader {
	constructor(manager = null) {
		super(manager);
	}
	load(url, onLoad, onProgress, onError) {
		const loader = new FileLoader(this.manager);
		loader.setResponseType("json");
		loader.load(url, (data) => {
			const g = new BufferGeometry();
			if (data.attributes) for (const [name, attr] of Object.entries(data.attributes)) g.setAttribute(name, new BufferAttribute(new Float32Array(attr.array), attr.itemSize));
			if (data.index) g.setIndex(new BufferAttribute(new Uint16Array(data.index.array), 1));
			onLoad?.(g);
		}, onProgress, onError);
	}
	parse(json, path) {
		return json;
	}
};
var AnimationLoader = class extends Loader {
	constructor(manager = null) {
		super(manager);
	}
	load(url, onLoad, onProgress, onError) {
		const loader = new FileLoader(this.manager);
		loader.setResponseType("json");
		loader.load(url, (data) => onLoad?.(this.parse(data)), onProgress, onError);
	}
	parse(json) {
		const clips = [];
		if (json.animations) for (const a of json.animations) clips.push(new AnimationClip(a.name, a.duration, a.tracks ?? []));
		return clips.length ? clips : [new AnimationClip("clip", -1, [])];
	}
};
var ObjectLoader = class extends Loader {
	constructor(manager = null) {
		super(manager);
	}
	load(url, onLoad, onProgress, onError) {
		const loader = new FileLoader(this.manager);
		loader.setResponseType("json");
		loader.load(url, (data) => onLoad?.(this.parse(data)), onProgress, onError);
	}
	parse(json) {
		return new Object3D();
	}
	parseAsync(url) {
		return Promise.resolve(new Object3D());
	}
	parseGeometries(json) {
		return {};
	}
	parseMaterials(json) {
		return {};
	}
	parseAnimations(json) {
		return [];
	}
	parseImages(json) {
		return {};
	}
	parseImagesAsync(json) {
		return Promise.resolve({});
	}
	parseObject(data, geometries, materials, animations, textures) {
		return new Object3D();
	}
	parseShapes(json) {
		return [];
	}
	parseSkeletons(json, bones) {
		return {};
	}
	parseTextures(json, images) {
		return {};
	}
	bindLightTargets() {
		return this;
	}
	bindSkeletons() {
		return this;
	}
};
var MaterialLoader = class extends Loader {
	constructor(manager = null) {
		super(manager);
	}
	load(url, onLoad, onProgress, onError) {
		const loader = new FileLoader(this.manager);
		loader.setResponseType("json");
		loader.load(url, (data) => onLoad?.(this.parse(data)), onProgress, onError);
	}
	parse(json) {}
	parseAsync(url) {
		return Promise.resolve(void 0);
	}
	createMaterialFromType() {}
	setTextures(textures) {
		return this;
	}
};
var Uniform = class Uniform {
	constructor(value) {
		this.value = value;
	}
	clone() {
		return new Uniform(this.value);
	}
};
var UniformsGroup = class UniformsGroup extends EventDispatcher {
	constructor() {
		super();
		this.isUniformsGroup = true;
		this.uniforms = {};
	}
	addUniform(obj) {
		Object.assign(this.uniforms, obj);
		return this;
	}
	removeUniforms() {
		this.uniforms = {};
		return this;
	}
	dispose() {
		this.dispatchEvent({ type: "dispose" });
	}
	add(...uniforms) {
		for (const u of uniforms) Object.assign(this.uniforms, u.uniforms ?? u);
		return this;
	}
	remove() {
		this.uniforms = {};
		return this;
	}
	clone() {
		const g = new UniformsGroup();
		for (const k in this.uniforms) g.uniforms[k] = this.uniforms[k].clone ? this.uniforms[k].clone() : this.uniforms[k];
		return g;
	}
	copy(source) {
		this.uniforms = source.uniforms;
		return this;
	}
	setName(name) {
		this.name = name;
		return this;
	}
	setUsage(usage) {
		this.usage = usage;
		return this;
	}
};
const ShaderChunk = {};
const ShaderLib = {};
const UniformsLib = {};
const UniformsUtils = {
	clone(uniformsSrc) {
		const uniformsDst = {};
		for (const u in uniformsSrc) uniformsDst[u] = { value: Array.isArray(uniformsSrc[u].value) ? uniformsSrc[u].value.slice() : uniformsSrc[u].value };
		return uniformsDst;
	},
	merge(uniforms) {
		return uniforms.reduce((acc, u) => Object.assign(acc, u), {});
	}
};
const ColorManagement = {
	enabled: true,
	convert(color, sourceColorSpace, targetColorSpace) {
		return color;
	},
	fromWorkingColorSpace(color, targetColorSpace) {
		return color;
	},
	toWorkingColorSpace(color, sourceColorSpace) {
		return color;
	}
};
const DataUtils = {
	toHalfFloat(value) {
		return value;
	},
	fromHalfFloat(value) {
		return value;
	},
	isPowerOfTwo(value) {
		return (value & value - 1) === 0 && value !== 0;
	},
	ceilPowerOfTwo(value) {
		return Math.pow(2, Math.ceil(Math.log2(value)));
	},
	floorPowerOfTwo(value) {
		return Math.pow(2, Math.floor(Math.log2(value)));
	},
	getDataURL(img) {
		return img?.src ?? "";
	},
	getMaxAnisotropy() {
		return 16;
	}
};
const ImageUtils = {
	getDataURL(img) {
		return img?.src ?? "";
	},
	sRGBToLinear(c) {
		return c <= .04045 ? c / 12.92 : Math.pow((c + .055) / 1.055, 2.4);
	},
	LinearTosRGB(c) {
		return c <= .0031308 ? 12.92 * c : 1.055 * Math.pow(c, 1 / 2.4) - .055;
	},
	getMaxAnisotropy() {
		return 16;
	}
};
const TextureUtils = {
	getByteLength(width, height, depth, format, type) {
		return width * height * (depth ?? 1) * 4;
	},
	toHalfFloat(value) {
		return value;
	},
	isImageBitmap(image) {
		return typeof ImageBitmap !== "undefined" && image instanceof ImageBitmap;
	}
};
const ShapeUtils = {
	area(contour) {
		let a = 0;
		for (let i = 0; i < contour.length; i++) {
			const p = contour[i], q = contour[(i + 1) % contour.length];
			a += p[0] * q[1] - q[0] * p[1];
		}
		return a / 2;
	},
	isClockWise(pts) {
		let sum = 0;
		for (let i = 0; i < pts.length; i++) {
			const p = pts[i], q = pts[(i + 1) % pts.length];
			sum += (q[0] - p[0]) * (q[1] + p[1]);
		}
		return sum > 0;
	},
	triangulateShape(contour, holes) {
		const pts = [...contour, ...holes.flat()];
		const indices = [];
		for (let i = 1; i < pts.length - 1; i++) indices.push(0, i, i + 1);
		return indices;
	}
};
var Timer = class {
	constructor() {
		this.isTimer = true;
		this._prev = 0;
		this._now = 0;
		this._start = 0;
		this._delta = 0;
		this._elapsed = 0;
		this._timescale = 1;
	}
	update() {
		const now = performance?.now?.() ?? Date.now();
		this._prev = this._now;
		this._now = now;
		if (!this._start) this._start = now;
		this._delta = (this._now - this._prev) * this._timescale;
		this._elapsed = now - this._start;
		return this._delta;
	}
	getDelta() {
		return this._delta;
	}
	getElapsed() {
		return this._elapsed;
	}
	getElapsedSeconds() {
		return this._elapsed / 1e3;
	}
	getTimescale() {
		return this._timescale;
	}
	setTimescale(v) {
		this._timescale = v;
		return this;
	}
	reset() {
		this._prev = this._now;
		this._start = 0;
		this._delta = 0;
		this._elapsed = 0;
		return this;
	}
	connect() {
		return this;
	}
	disconnect() {
		return this;
	}
	dispose() {}
};
var PropertyMixer = class {
	constructor(mixer, binding, valueSize, mixDuration, mixEnd) {
		this.accumulator = null;
		this.valueSize = valueSize;
		this.path = binding?.path ?? "";
		this.bindNode = binding?.node ?? null;
		this.mixEnd = mixEnd;
		this.mixDuration = mixDuration;
	}
	accumulate(accuIndex, weight) {}
	apply(accuIndex) {}
	restoreState() {}
	restoreOriginalState() {
		return this.restoreState();
	}
	accumulateAdditive(weight) {}
	saveOriginalState() {}
	destroy() {}
};
var WebXRController = class {
	constructor() {
		this.isXRController = true;
		this.xrTargetRaySpace = null;
		this.xrGripSpace = null;
		this.handedness = "none";
		this.targetRayMode = "gaze";
	}
	getHand() {
		return null;
	}
	dispose() {}
	connect() {
		return Promise.resolve(this);
	}
	disconnect() {
		return Promise.resolve();
	}
	getGripSpace() {
		return this.xrGripSpace;
	}
	getHandSpace() {
		return this.xrGripSpace;
	}
	getTargetRaySpace() {
		return this.xrTargetRaySpace;
	}
	update(matrixWorld, frame) {}
	dispatchEvent(event) {
		return true;
	}
};
function createCanvasElement(width = 300, height = 150) {
	if (typeof document === "undefined") return null;
	const canvas = document.createElement("canvas");
	canvas.width = width;
	canvas.height = height;
	return canvas;
}
const WebGLUtils = { convert(data) {
	return data;
} };
const Controls = class extends EventDispatcher {
	constructor(object, domElement) {
		super();
		this.isControls = true;
		this.enabled = true;
		this.target = new Vector3();
		this.object = object;
		this.domElement = domElement;
	}
	update() {
		return true;
	}
	connect() {
		return this;
	}
	disconnect() {
		return this;
	}
	dispose() {}
};
var SphericalHarmonics3 = class SphericalHarmonics3 {
	constructor() {
		this.isSphericalHarmonics3 = true;
		this.coefficients = [];
		for (let i = 0; i < 9; i++) this.coefficients.push(/* @__PURE__ */ new Float32Array(3));
	}
	set(coefficients) {
		for (let i = 0; i < 27; i++) this.coefficients[Math.floor(i / 3)][i % 3] = coefficients[i];
		return this;
	}
	zero() {
		for (const c of this.coefficients) c.fill(0);
		return this;
	}
	clone() {
		const s = new SphericalHarmonics3();
		s.coefficients = this.coefficients.map((c) => c.slice());
		return s;
	}
	copy(source) {
		this.coefficients = source.coefficients.map((c) => c.slice());
		return this;
	}
	add(sh) {
		for (let i = 0; i < 9; i++) for (let j = 0; j < 3; j++) this.coefficients[i][j] += sh.coefficients[i][j];
		return this;
	}
	scale(r) {
		for (const c of this.coefficients) for (let j = 0; j < 3; j++) c[j] *= r;
		return this;
	}
	lerp(sh, alpha) {
		for (let i = 0; i < 9; i++) for (let j = 0; j < 3; j++) this.coefficients[i][j] += (sh.coefficients[i][j] - this.coefficients[i][j]) * alpha;
		return this;
	}
	getAt(normal, target) {
		let r = 0, g = 0, b = 0;
		for (const c of this.coefficients) {
			r += c[0];
			g += c[1];
			b += c[2];
		}
		target.setRGB(r, g, b);
		return target;
	}
	getIrradianceAt(normal, target) {
		return this.getAt(normal, target);
	}
	addScaledSH(sh, scale) {
		return this.add(sh.clone().scale(scale));
	}
	equals(sh) {
		for (let i = 0; i < 9; i++) for (let j = 0; j < 3; j++) if (this.coefficients[i][j] !== sh.coefficients[i][j]) return false;
		return true;
	}
	fromArray(array) {
		return this.set(array);
	}
	toArray(target = []) {
		for (let i = 0; i < 9; i++) for (let j = 0; j < 3; j++) target.push(this.coefficients[i][j]);
		return target;
	}
};

// src/three/index.ts
const REVISION = "180";

export { ACESFilmicToneMapping, AddEquation, AddOperation, AdditiveAnimationBlendMode, AdditiveBlending, AgXToneMapping, AlphaFormat, AlwaysCompare, AlwaysDepth, AlwaysStencilFunc, AmbientLight, AnimationAction, AnimationClip, AnimationLoader, AnimationMixer, AnimationObjectGroup, AnimationUtils, ArcCurve, ArrayCamera, ArrowHelper, AttachedBindMode, Audio, AudioAnalyser, AudioContext, AudioListener, AudioLoader, AxesHelper, BackSide, BasicDepthPacking, BasicShadowMap, BatchedMesh, Bone, BooleanKeyframeTrack, Box2, Box3, Box3Helper, BoxGeometry, BoxHelper, BufferAttribute, BufferGeometry, BufferGeometryLoader, ByteType, Cache, Camera, CameraHelper, CanvasTexture, CapsuleGeometry, CatmullRomCurve3, CineonToneMapping, CircleGeometry, ClampToEdgeWrapping, Clock, Color, ColorKeyframeTrack, ColorManagement, CompressedArrayTexture, CompressedCubeTexture, CompressedTexture, CompressedTextureLoader, ConeGeometry, ConstantAlphaFactor, ConstantColorFactor, Controls, CubeCamera, CubeReflectionMapping, CubeRefractionMapping, CubeTexture, CubeTextureLoader, CubeUVReflectionMapping, CubicBezierCurve, CubicBezierCurve3, CubicInterpolant, CullFaceBack, CullFaceFront, CullFaceFrontBack, CullFaceNone, Curve, CurvePath, CustomBlending, CustomToneMapping, CylinderGeometry, Cylindrical, Data3DTexture, DataArrayTexture, DataTexture, DataTextureLoader, DataUtils, DecrementStencilOp, DecrementWrapStencilOp, DefaultLoadingManager, DepthFormat, DepthStencilFormat, DepthTexture, DetachedBindMode, DirectionalLight, DirectionalLightHelper, DirectionalLightShadow, DiscreteInterpolant, DisplayP3ColorSpace, DodecahedronGeometry, DoubleSide, DstAlphaFactor, DstColorFactor, DynamicCopyUsage, DynamicDrawUsage, DynamicReadUsage, EdgesGeometry, EllipseCurve, EqualCompare, EqualDepth, EqualStencilFunc, EquirectangularReflectionMapping, EquirectangularRefractionMapping, Euler, EventDispatcher, ExternalTexture, ExtrudeGeometry, FileLoader, Float16BufferAttribute, Float32BufferAttribute, FloatType, Fog, FogExp2, FramebufferTexture, FrontSide, Frustum, FrustumArray, GLBufferAttribute, GLSL1, GLSL3, GreaterCompare, GreaterDepth, GreaterEqualCompare, GreaterEqualDepth, GreaterEqualStencilFunc, GreaterStencilFunc, GridHelper, Group, HalfFloatType, HemisphereLight, HemisphereLightHelper, IcosahedronGeometry, ImageBitmapLoader, ImageLoader, ImageUtils, IncrementStencilOp, IncrementWrapStencilOp, InstancedBufferAttribute, InstancedBufferGeometry, InstancedInterleavedBuffer, InstancedMesh, Int16BufferAttribute, Int32BufferAttribute, Int8BufferAttribute, IntType, InterleavedBuffer, InterleavedBufferAttribute, Interpolant, InterpolateDiscrete, InterpolateLinear, InterpolateSmooth, InterpolationSamplingMode, InterpolationSamplingType, InvertStencilOp, KeepStencilOp, KeyframeTrack, LOD, LatheGeometry, Layers, LessCompare, LessDepth, LessEqualCompare, LessEqualDepth, LessEqualStencilFunc, LessStencilFunc, Light, LightProbe, Line, Line3, LineBasicMaterial, LineCurve, LineCurve3, LineDashedMaterial, LineLoop, LineSegments, LinearFilter, LinearInterpolant, LinearMipMapLinearFilter, LinearMipMapNearestFilter, LinearMipmapLinearFilter, LinearMipmapNearestFilter, LinearSRGBColorSpace, LinearToneMapping, LinearTransfer, Loader, LoaderUtils, LoadingManager, LoopOnce, LoopPingPong, LoopRepeat, MOUSE, Material, MaterialLoader, MathUtils, Matrix2, Matrix3, Matrix4, MaxEquation, Mesh, MeshBasicMaterial, MeshDepthMaterial, MeshDistanceMaterial, MeshLambertMaterial, MeshMatcapMaterial, MeshNormalMaterial, MeshPhongMaterial, MeshStandardMaterial as MeshPhysicalMaterial, MeshStandardMaterial, MeshToonMaterial, MinEquation, MirroredRepeatWrapping, MixOperation, MultiplyBlending, MultiplyOperation, NearestFilter, NearestMipMapLinearFilter, NearestMipMapNearestFilter, NearestMipmapLinearFilter, NearestMipmapNearestFilter, NeutralToneMapping, NeverCompare, NeverDepth, NeverStencilFunc, NoBlending, NoColorSpace, NoToneMapping, NormalAnimationBlendMode, NormalBlending, NotEqualCompare, NotEqualDepth, NotEqualStencilFunc, NumberKeyframeTrack, Object3D, ObjectLoader, ObjectSpaceNormalMap, OctahedronGeometry, OneFactor, OneMinusConstantAlphaFactor, OneMinusConstantColorFactor, OneMinusDstAlphaFactor, OneMinusDstColorFactor, OneMinusSrcAlphaFactor, OneMinusSrcColorFactor, OrbitControls, OrthographicCamera, PCFShadowMap, PCFSoftShadowMap, PMREMGenerator, Path, PerspectiveCamera, Plane, PlaneGeometry, PlaneHelper, PointLight, PointLightHelper, Points, PointsMaterial, PolarGridHelper, PolyhedronGeometry, PositionalAudio, PropertyBinding, PropertyMixer, QuadraticBezierCurve, QuadraticBezierCurve3, Quaternion, QuaternionKeyframeTrack, QuaternionLinearInterpolant, RED_GREEN_RGTC2_Format, RED_RGTC1_Format, REVISION, RGBADepthPacking, RGBAFormat, RGBAIntegerFormat, RGBA_ASTC_10x10_Format, RGBA_ASTC_10x5_Format, RGBA_ASTC_10x6_Format, RGBA_ASTC_10x8_Format, RGBA_ASTC_12x10_Format, RGBA_ASTC_12x12_Format, RGBA_ASTC_4x4_Format, RGBA_ASTC_5x4_Format, RGBA_ASTC_5x5_Format, RGBA_ASTC_6x5_Format, RGBA_ASTC_6x6_Format, RGBA_ASTC_8x5_Format, RGBA_ASTC_8x6_Format, RGBA_ASTC_8x8_Format, RGBA_BPTC_Format, RGBA_ETC2_EAC_Format, RGBA_PVRTC_2BPPV1_Format, RGBA_PVRTC_4BPPV1_Format, RGBA_S3TC_DXT1_Format, RGBA_S3TC_DXT3_Format, RGBA_S3TC_DXT5_Format, RGBDepthPacking, RGBFormat, RGBIntegerFormat, RGB_BPTC_SIGNED_Format, RGB_BPTC_UNSIGNED_Format, RGB_ETC1_Format, RGB_ETC2_Format, RGB_PVRTC_2BPPV1_Format, RGB_PVRTC_4BPPV1_Format, RGB_S3TC_DXT1_Format, RGDepthPacking, RGFormat, RGIntegerFormat, RawShaderMaterial, Ray, Raycaster, RectAreaLight, RedFormat, RedIntegerFormat, ReinhardToneMapping, RenderTarget, RenderTarget3D, RepeatWrapping, ReplaceStencilOp, ReverseSubtractEquation, RingGeometry, RoomEnvironment, SIGNED_RED_GREEN_RGTC2_Format, SIGNED_RED_RGTC1_Format, SRGBColorSpace, SRGBTransfer, Scene, ShaderChunk, ShaderLib, ShaderMaterial, ShadowMaterial, Shape, ShapeGeometry, ShapePath, ShapeUtils, ShortType, Skeleton, SkeletonHelper, SkinnedMesh, Source, Sphere, SphereGeometry, Spherical, SphericalHarmonics3, SplineCurve, SpotLight, SpotLightHelper, Sprite, SpriteMaterial, SrcAlphaFactor, SrcAlphaSaturateFactor, SrcColorFactor, StaticCopyUsage, StaticDrawUsage, StaticReadUsage, StereoCamera, StreamCopyUsage, StreamDrawUsage, StreamReadUsage, StringKeyframeTrack, SubtractEquation, SubtractiveBlending, TOUCH, TangentSpaceNormalMap, TetrahedronGeometry, Texture, TextureLoader, TextureUtils, Timer, TimestampQuery, TorusGeometry, TorusKnotGeometry, Triangle, TriangleFanDrawMode, TriangleStripDrawMode, TrianglesDrawMode, TubeGeometry, UVMapping, Uint16BufferAttribute, Uint32BufferAttribute, Uint8BufferAttribute, Uint8ClampedBufferAttribute, Uniform, UniformsGroup, UniformsLib, UniformsUtils, UnsignedByteType, UnsignedInt101111Type, UnsignedInt248Type, UnsignedInt5999Type, UnsignedIntType, UnsignedShort4444Type, UnsignedShort5551Type, UnsignedShortType, VSMShadowMap, Vector2, Vector3, Vector4, VectorKeyframeTrack, VideoFrameTexture, VideoTexture, WebGL3DRenderTarget, WebGLArrayRenderTarget, WebGLCoordinateSystem, WebGLCubeRenderTarget, WebGLRenderTarget, WebGLRenderer, WebGLUtils, WebGPUCoordinateSystem, WebGPURenderer, WebXRController, WireframeGeometry, WrapAroundEnding, ZeroCurvatureEnding, ZeroFactor, ZeroSlopeEnding, ZeroStencilOp, checkerTexture, createCanvasElement, engineNodeIndex, findNodeByName, parseTrackName };