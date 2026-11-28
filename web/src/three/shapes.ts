import { BufferGeometry, Float32BufferAttribute, Uint32BufferAttribute } from './geometry';

/* --- curves -------------------------------------------------------------------- */

export class Curve {
  arcLengthDivisions = 200;
  needsUpdate = true;
  _lengths: number[] | null = null;
  _lengthPts: any[] | null = null;
  _lengthsDiv = 0;
  [key: string]: any;
  // Subclasses return a point (array or {x,y,z}) at curve parameter t in [0,1].
  getPoint(t) { return [0, 0, 0]; }
  _pt(p) { return Array.isArray(p) ? p : [p.x ?? 0, p.y ?? 0, p.z ?? 0]; }
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
  getLength() { const l = this.getLengths(); return l[l.length - 1]; }
  updateArcLengths() { this._lengths = null; return this; }
  getCurveLengths() { return this.getLengths(); }
  // Map arc-length fraction u to curve parameter t.
  getUtoTmapping(u, distance) {
    const lengths = this.getLengths();
    const total = lengths[lengths.length - 1] || 1;
    const target = distance !== undefined ? distance : u * total;
    for (let i = 1; i < lengths.length; i++) {
      if (lengths[i] >= target) {
        const t0 = (i - 1) / (lengths.length - 1), t1 = i / (lengths.length - 1);
        const seg = lengths[i] - lengths[i - 1] || 1;
        return t0 + (t1 - t0) * ((target - lengths[i - 1]) / seg);
      }
    }
    return 1;
  }
  getPointAt(u) { return this.getPoint(this.getUtoTmapping(u, u * (this.getLength() || 1))); }
  getTangent(t) {
    const e = 1e-4;
    const a = this._pt(this.getPoint(Math.max(0, t - e)));
    const b = this._pt(this.getPoint(Math.min(1, t + e)));
    const dx = b[0] - a[0], dy = b[1] - a[1], dz = (b[2] ?? 0) - (a[2] ?? 0);
    const l = Math.hypot(dx, dy, dz) || 1;
    return [dx / l, dy / l, dz / l];
  }
  getTangentAt(u) { return this.getTangent(this.getUtoTmapping(u, u * (this.getLength() || 1))); }
  getSpacedPoints(divisions = 40) {
    const pts = [];
    for (let i = 0; i <= divisions; i++) pts.push(this.getPointAt(i / divisions));
    return pts;
  }
  computeFrenetFrames(segments, closed) {
    // Tangents along the curve; normals via parallel transport is overkill —
    // use a fixed up heuristic like three's fallback.
    const tangents = [], normals = [], binormals = [];
    let prevNormal = null;
    for (let i = 0; i <= segments; i++) {
      const t = i / segments;
      const tan = this._pt(this.getTangent(t));
      tangents.push(tan);
      let n = prevNormal;
      if (!n) {
        // Pick any vector not parallel to tangent.
        const up = Math.abs(tan[1]) < 0.9 ? [0, 1, 0] : [1, 0, 0];
        n = [tan[1] * up[2] - tan[2] * up[1], tan[2] * up[0] - tan[0] * up[2], tan[0] * up[1] - tan[1] * up[0]];
      } else {
        // Gram-Schmidt against tangent.
        const d = n[0] * tan[0] + n[1] * tan[1] + n[2] * tan[2];
        n = [n[0] - d * tan[0], n[1] - d * tan[1], n[2] - d * tan[2]];
      }
      const nl = Math.hypot(n[0], n[1], n[2]) || 1;
      n = [n[0] / nl, n[1] / nl, n[2] / nl];
      prevNormal = n;
      normals.push(n);
      binormals.push([tan[1] * n[2] - tan[2] * n[1], tan[2] * n[0] - tan[0] * n[2], tan[0] * n[1] - tan[1] * n[0]]);
    }
    return { tangents, normals, binormals };
  }
  // Sample the curve into point pairs (x,y) like three's getPoints.
  getPoints(divisions = 12) {
    const pts = [];
    for (let i = 0; i <= divisions; i++) {
      const p = this._pt(this.getPoint(i / divisions));
      pts.push([p[0], p[1]]);
    }
    return pts;
  }
  copy(source: any) { this.needsUpdate = true; return this; }
  clone() { return new (this as any).constructor().copy(this); }
  toJSON(meta: any = {}): any { return { type: (this as any).type || this.constructor.name, data: { points: (this as any).points || [] } }; }
  fromJSON(json: any) { return this; }
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
  copy(source: CatmullRomCurve3) {
    this.points = source.points.map(p => Array.isArray(p) ? [...p] : { ...p });
    this.closed = source.closed;
    this.curveType = source.curveType;
    this.tension = source.tension;
    this.updateArcLengths();
    return this;
  }
  clone() { return new CatmullRomCurve3(this.points.map(p => [...p]), this.closed, this.curveType, this.tension); }
  toJSON() {
    return { type: 'CatmullRomCurve3',
      data: { points: this.points.map(p => p.slice()), closed: this.closed, curveType: this.curveType, tension: this.tension } };
  }
  fromJSON(json: any) {
    const d = json.data || {};
    this.points = (d.points || []).map((p: any) => Array.isArray(p) ? [...p] : [p.x, p.y, p.z]);
    this.closed = !!d.closed; this.curveType = d.curveType || 'centripetal';
    this.tension = d.tension ?? 0.5;
    this.updateArcLengths();
    return this;
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



/* --- shapes ------------------------------------------------------------------ */

// 2D path: moveTo/lineTo/quadraticCurveTo/bezierCurveTo/closePath, flattened
// to point lists by getPoints(). Shape adds holes like three.js.
export class Path extends Curve {
  isPath: boolean;
  segments: any[];
  constructor() { super(); this.isPath = true; this.segments = []; }
  moveTo(x, y) { this.segments.push({ t: 'M', x, y }); this.updateArcLengths(); return this; }
  lineTo(x, y) { this.segments.push({ t: 'L', x, y }); this.updateArcLengths(); return this; }
  quadraticCurveTo(cx, cy, x, y) { this.segments.push({ t: 'Q', cx, cy, x, y }); this.updateArcLengths(); return this; }
  bezierCurveTo(c1x, c1y, c2x, c2y, x, y) { this.segments.push({ t: 'C', c1x, c1y, c2x, c2y, x, y }); this.updateArcLengths(); return this; }
  closePath() { this.segments.push({ t: 'Z' }); this.updateArcLengths(); return this; }
  // --- three.js curve segment types ------------------------------------------
  // arc: center offset by current point; absarc: absolute center. Angles in radians.
  arc(aX, aY, aRadius, aStartAngle, aEndAngle, aClockwise = false) {
    const last = this.segments.filter(s => s.t === 'M' || s.t === 'L' || s.t === 'C' || s.t === 'Q').pop();
    const cx = (last ? last.x ?? last._ex ?? 0 : 0) + aX, cy = (last ? last.y ?? last._ey ?? 0 : 0) + aY;
    return this._pushArc(cx, cy, aRadius, aStartAngle, aEndAngle, aClockwise);
  }
  absarc(x, y, radius, startAngle, endAngle, clockwise = false) {
    return this._pushArc(x, y, radius, startAngle, endAngle, clockwise);
  }
  _pushArc(cx, cy, r, a0, a1, ccw) {
    this.segments.push({ t: 'A', cx, cy, r, a0, a1, ccw });
    this.updateArcLengths();
    return this;
  }
  ellipse(x, y, xRadius, yRadius, rotation, startAngle, endAngle, clockwise = false, aRotation = 0) {
    return this.absellipse(x, y, xRadius, yRadius, rotation, startAngle, endAngle, clockwise);
  }
  absellipse(cx, cy, rx, ry, rot, a0, a1, ccw = false) {
    this.segments.push({ t: 'E', cx, cy, rx, ry, rot, a0, a1, ccw });
    this.updateArcLengths();
    return this;
  }
  splineThru(points: any[]) {
    const pts = points.map(p => [p.x ?? p[0], p.y ?? p[1]]);
    for (let i = 1; i < pts.length; i++) {
      const p0 = pts[Math.max(0, i - 2)] || pts[0], p1 = pts[i - 1], p2 = pts[i],
        p3 = pts[Math.min(pts.length - 1, i + 1)];
      this.segments.push({ t: 'S', p0, p1, p2, p3 });
    }
    this.updateArcLengths();
    return this;
  }
  add(curve: any) {
    // Approximate: flatten the added curve/shape into line segments.
    const pts = curve.getPoints ? curve.getPoints(12) : [];
    if (pts.length) {
      if (!this.segments.length || this.segments[this.segments.length - 1].t !== 'M')
        this.moveTo(pts[0][0], pts[0][1]);
      for (const p of pts) this.lineTo(p[0], p[1]);
    }
    return this;
  }
  setFromPoints(points: any[]) {
    this.segments.length = 0;
    points.forEach((p, i) => {
      const x = p.x ?? p[0], y = p.y ?? p[1];
      if (i === 0) this.moveTo(x, y); else this.lineTo(x, y);
    });
    return this;
  }
  copy(source: Path, recursive = true) {
    super.copy(source);
    this.segments = source.segments.map(s => ({ ...s }));
    this.updateArcLengths();
    return this;
  }
  clone() { return new (this as any).constructor().copy(this); }
  // Point/tangent queries via arc-length over the flattened contour.
  getPoint(t) { return this._contourPoint(this.getUtoTmapping(t, t * (this.getLength() || 1))); }
  getPointAt(u) { return this._contourPoint(u); }
  getTangent(t) {
    const e = 1e-3, a = this._contourPoint(Math.max(0, t - e)), b = this._contourPoint(Math.min(1, t + e));
    const dx = b[0] - a[0], dy = b[1] - a[1], l = Math.hypot(dx, dy) || 1;
    return [dx / l, dy / l, 0];
  }
  getTangentAt(u) {
    const e = 1e-3, a = this._contourPoint(Math.max(0, u - e)), b = this._contourPoint(Math.min(1, u + e));
    const dx = b[0] - a[0], dy = b[1] - a[1], l = Math.hypot(dx, dy) || 1;
    return [dx / l, dy / l, 0];
  }
  _contour() {
    if (!this._ptsCache) {
      const pts = this.getPoints(240);
      const cum = [0];
      for (let i = 1; i < pts.length; i++) cum.push(cum[i - 1] + Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]));
      this._ptsCache = { pts, cum, total: cum[cum.length - 1] || 0 };
    }
    return this._ptsCache;
  }
  _contourPoint(u) {
    const { pts, cum, total } = this._contour();
    if (!pts.length) return [0, 0];
    const target = u * total;
    for (let i = 1; i < cum.length; i++) {
      if (cum[i] >= target) {
        const seg = cum[i] - cum[i - 1] || 1, f = (target - cum[i - 1]) / seg;
        return [pts[i - 1][0] + (pts[i][0] - pts[i - 1][0]) * f,
          pts[i - 1][1] + (pts[i][1] - pts[i - 1][1]) * f];
      }
    }
    return pts[pts.length - 1];
  }
  updateArcLengths() { this._lengths = null; this._ptsCache = null; return this; }
  getLength() { return this._contour().total; }
  toJSON(): any {
    return { type: (this as any).isShape ? 'Shape' : 'Path',
      data: { segments: this.segments.map(s => ({ ...s })),
        ...(this.holes ? { holes: this.holes.map(h => h.toJSON ? h.toJSON() : null).filter(Boolean) } : {}) } };
  }
  fromJSON(json: any) {
    this.segments = (json.data?.segments || []).map((s: any) => ({ ...s }));
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
      } else if (s.t === 'A' || s.t === 'E') {
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
        cur = pts[pts.length - 1] ? { x: pts[pts.length - 1][0], y: pts[pts.length - 1][1] } : cur;
      } else if (s.t === 'S') {
        for (let i = 1; i <= divisions; i++) {
          const t = i / divisions, u = 1 - t;
          // Catmull-Rom through p0..p3
          pts.push([
            0.5 * ((2 * s.p1[0]) + (-s.p0[0] + s.p2[0]) * t + (2 * s.p0[0] - 5 * s.p1[0] + 4 * s.p2[0] - s.p3[0]) * t * t + (-s.p0[0] + 3 * s.p1[0] - 3 * s.p2[0] + s.p3[0]) * t * t * t),
            0.5 * ((2 * s.p1[1]) + (-s.p0[1] + s.p2[1]) * t + (2 * s.p0[1] - 5 * s.p1[1] + 4 * s.p2[1] - s.p3[1]) * t * t + (-s.p0[1] + 3 * s.p1[1] - 3 * s.p2[1] + s.p3[1]) * t * t * t)]);
        }
        cur = { x: pts[pts.length - 1][0], y: pts[pts.length - 1][1] };
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
  type: string;
  constructor() { super(); this.isShape = true; this.holes = []; this.type = 'Shape'; }
  copy(source: Shape, recursive = true) {
    super.copy(source, recursive);
    this.holes = source.holes.map(h => h.clone ? h.clone() : h);
    return this;
  }
  getPointsHoles(divisions = 12) { return this.holes.map(h => h.getPoints(divisions)); }
  extractPoints(divisions = 12) {
    return { shape: this.getPoints(divisions), holes: this.getPointsHoles(divisions) };
  }
  getSpacedPoints(divisions = 40) { return super.getSpacedPoints(divisions); }
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


