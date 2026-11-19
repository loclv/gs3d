import { BufferGeometry, Float32BufferAttribute, Uint32BufferAttribute } from './geometry';

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


