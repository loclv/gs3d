import { normalize3 } from './math';
import { BufferGeometry, Float32BufferAttribute, Uint32BufferAttribute } from './geometry';

/* --- primitive geometries -----------------------------------------------------
   Parametric generators matching three.js vertex layouts: positions,
   normals and uvs plus an index buffer, so lighting and UV mapping behave
   the same as the real thing. */

function gridGeometry(nu, nv, vertexAt, uvAt, flip = false) {
  // vertexAt(u, v) -> [x, y, z, nx, ny, nz]; uvAt(u, v) -> [u, v]
  const positions = [], normals = [], uvs = [], indices = [];
  for (let j = 0; j <= nv; j++) for (let i = 0; i <= nu; i++) {
    const u = i / nu, v = j / nv;
    const [x, y, z, nx, ny, nz] = vertexAt(u, v);
    positions.push(x, y, z); normals.push(nx, ny, nz);
    const [tu, tv] = uvAt(u, v); uvs.push(tu, tv);
  }
  const stride = nu + 1;
  for (let j = 0; j < nv; j++) for (let i = 0; i < nu; i++) {
    const a = j * stride + i, b = a + 1, c = a + stride, d = c + 1;
    if (flip) indices.push(a, c, b, b, c, d);
    else indices.push(a, b, c, b, d, c);
  }
  return { positions, normals, uvs, indices };
}

function makeGeometry(data) {
  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new Float32BufferAttribute(data.positions, 3));
  geometry.setAttribute('normal', new Float32BufferAttribute(data.normals, 3));
  geometry.setAttribute('uv', new Float32BufferAttribute(data.uvs, 2));
  geometry.setIndex(new Uint32BufferAttribute(data.indices, 1));
  return geometry;
}

export class BoxGeometry extends BufferGeometry {
  constructor(width = 1, height = 1, depth = 1, widthSegments = 1, heightSegments = 1, depthSegments = 1) {
    super();
    const positions = [], normals = [], uvs = [], indices = [];
    const hw = width / 2, hh = height / 2, hd = depth / 2;
    // Each face is a grid in its own two axes; three.js duplicates vertices
    // per face so normals and uvs stay per-face.
    const face = (nu, nv, normal, build) => {
      const base = positions.length / 3;
      for (let j = 0; j <= nv; j++) for (let i = 0; i <= nu; i++) {
        const [p, uv] = build(i / nu, j / nv);
        positions.push(p[0], p[1], p[2]); normals.push(normal[0], normal[1], normal[2]); uvs.push(uv[0], uv[1]);
      }
      const stride = nu + 1;
      for (let j = 0; j < nv; j++) for (let i = 0; i < nu; i++) {
        const a = base + j * stride + i;
        indices.push(a, a + 1, a + stride, a + 1, a + stride + 1, a + stride);
      }
    };
    // +X / -X faces span z (u) and y (v).
    face(depthSegments, heightSegments, [1, 0, 0], (u, v) => [[hw, (0.5 - v) * height, (u - 0.5) * depth], [u, v]]);
    face(depthSegments, heightSegments, [-1, 0, 0], (u, v) => [[-hw, (0.5 - v) * height, (0.5 - u) * depth], [u, v]]);
    // +Y / -Y faces span x (u) and z (v).
    face(widthSegments, depthSegments, [0, 1, 0], (u, v) => [[(u - 0.5) * width, hh, (0.5 - v) * depth], [u, v]]);
    face(widthSegments, depthSegments, [0, -1, 0], (u, v) => [[(u - 0.5) * width, -hh, (v - 0.5) * depth], [u, v]]);
    // +Z / -Z faces span x (u) and y (v).
    face(widthSegments, heightSegments, [0, 0, 1], (u, v) => [[(u - 0.5) * width, (v - 0.5) * height, hd], [u, v]]);
    face(widthSegments, heightSegments, [0, 0, -1], (u, v) => [[(0.5 - u) * width, (v - 0.5) * height, -hd], [u, v]]);
    this.setAttribute('position', new Float32BufferAttribute(positions, 3));
    this.setAttribute('normal', new Float32BufferAttribute(normals, 3));
    this.setAttribute('uv', new Float32BufferAttribute(uvs, 2));
    this.setIndex(new Uint32BufferAttribute(indices, 1));
  }
}

export class SphereGeometry extends BufferGeometry {
  constructor(radius = 1, widthSegments = 32, heightSegments = 16, phiStart = 0, phiLength = Math.PI * 2, thetaStart = 0, thetaLength = Math.PI) {
    super();
    const data = gridGeometry(widthSegments, heightSegments,
      (u, v) => {
        const phi = phiStart + u * phiLength;
        const theta = thetaStart + v * thetaLength;
        const x = -radius * Math.cos(phi) * Math.sin(theta);
        const y = radius * Math.cos(theta);
        const z = radius * Math.sin(phi) * Math.sin(theta);
        const l = radius || 1;
        return [x, y, z, x / l, y / l, z / l];
      },
      (u, v) => [u, 1 - v], true);
    const g = makeGeometry(data);
    this.attributes = g.attributes; this.index = g.index; this.version++;
  }
}

export class PlaneGeometry extends BufferGeometry {
  constructor(width = 1, height = 1, widthSegments = 1, heightSegments = 1) {
    super();
    const data = gridGeometry(widthSegments, heightSegments,
      (u, v) => [(u - 0.5) * width, (0.5 - v) * height, 0, 0, 0, 1],
      (u, v) => [u, 1 - v], true);
    const g = makeGeometry(data);
    this.attributes = g.attributes; this.index = g.index; this.version++;
  }
}

export class CircleGeometry extends BufferGeometry {
  constructor(radius = 1, segments = 32, thetaStart = 0, thetaLength = Math.PI * 2) {
    super();
    const positions = [0, 0, 0], normals = [0, 0, 1], uvs = [0.5, 0.5], indices = [];
    for (let i = 0; i <= segments; i++) {
      const theta = thetaStart + (i / segments) * thetaLength;
      positions.push(Math.cos(theta) * radius, Math.sin(theta) * radius, 0);
      normals.push(0, 0, 1);
      uvs.push(Math.cos(theta) * 0.5 + 0.5, Math.sin(theta) * 0.5 + 0.5);
    }
    for (let i = 1; i <= segments; i++) indices.push(0, i, i + 1);
    this.setAttribute('position', new Float32BufferAttribute(positions, 3));
    this.setAttribute('normal', new Float32BufferAttribute(normals, 3));
    this.setAttribute('uv', new Float32BufferAttribute(uvs, 2));
    this.setIndex(new Uint32BufferAttribute(indices, 1));
  }
}

export class RingGeometry extends BufferGeometry {
  constructor(innerRadius = 0.5, outerRadius = 1, thetaSegments = 32, phiSegments = 1, thetaStart = 0, thetaLength = Math.PI * 2) {
    super();
    const positions = [], normals = [], uvs = [], indices = [];
    for (let j = 0; j <= phiSegments; j++) for (let i = 0; i <= thetaSegments; i++) {
      const theta = thetaStart + (i / thetaSegments) * thetaLength;
      const phi = (j / phiSegments) * Math.PI; // radial rings from inner to outer edge-on? use simple radial blend
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
    this.setAttribute('position', new Float32BufferAttribute(positions, 3));
    this.setAttribute('normal', new Float32BufferAttribute(normals, 3));
    this.setAttribute('uv', new Float32BufferAttribute(uvs, 2));
    this.setIndex(new Uint32BufferAttribute(indices, 1));
  }
}

export class CylinderGeometry extends BufferGeometry {
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
    if (!openEnded) {
      // Caps as triangle fans.
      for (const [y, r, ny] of [[half, radiusTop, 1], [-half, radiusBottom, -1]]) {
        if (r <= 0) continue;
        const center = positions.length / 3;
        positions.push(0, y, 0); normals.push(0, ny, 0); uvs.push(0.5, 0.5);
        const ringStart = positions.length / 3;
        for (let i = 0; i <= radialSegments; i++) {
          const theta = thetaStart + (i / radialSegments) * thetaLength;
          positions.push(Math.cos(theta) * r, y, Math.sin(theta) * r);
          normals.push(0, ny, 0);
          uvs.push(Math.cos(theta) * 0.5 + 0.5, Math.sin(theta) * 0.5 + 0.5);
        }
        for (let i = 0; i < radialSegments; i++) {
          if (ny > 0) indices.push(center, ringStart + i + 1, ringStart + i);
          else indices.push(center, ringStart + i, ringStart + i + 1);
        }
      }
    }
    this.setAttribute('position', new Float32BufferAttribute(positions, 3));
    this.setAttribute('normal', new Float32BufferAttribute(normals, 3));
    this.setAttribute('uv', new Float32BufferAttribute(uvs, 2));
    this.setIndex(new Uint32BufferAttribute(indices, 1));
  }
}

export class TorusGeometry extends BufferGeometry {
  constructor(radius = 1, tube = 0.4, radialSegments = 12, tubularSegments = 48, arc = Math.PI * 2) {
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
    this.setAttribute('position', new Float32BufferAttribute(positions, 3));
    this.setAttribute('normal', new Float32BufferAttribute(normals, 3));
    this.setAttribute('uv', new Float32BufferAttribute(uvs, 2));
    this.setIndex(new Uint32BufferAttribute(indices, 1));
  }
}

export class ConeGeometry extends CylinderGeometry {
  constructor(radius = 1, height = 1, radialSegments = 32, heightSegments = 1, openEnded = false, thetaStart = 0, thetaLength = Math.PI * 2) {
    super(radius, 0, height, radialSegments, heightSegments, openEnded, thetaStart, thetaLength);
    this.isConeGeometry = true;
  }
}

export class CapsuleGeometry extends BufferGeometry {
  // Radius, cylindrical mid-section length, and segment counts; axis is Y.
  constructor(radius = 0.5, length = 1, capSegments = 8, radialSegments = 16) {
    super();
    const halfLen = length / 2;
    const positions = [], normals = [], uvs = [], indices = [];
    const rings = capSegments * 2 + 1; // -90..+90 across both caps plus equator rows
    // Build profile: angle from -PI (bottom pole) to +PI (top pole) excluding poles.
    const profile = [];
    for (let i = 1; i <= capSegments * 2; i++) {
      const t = i / (capSegments * 2);           // 0..1
      const phi = -Math.PI / 2 + t * Math.PI;    // -90..90 deg
      profile.push(phi);
    }
    const rows = profile.length;
    for (let j = 0; j <= rows; j++) {
      const phi = j === 0 ? -Math.PI / 2 : j === rows ? Math.PI / 2 : profile[j - 1];
      const cy = Math.sin(phi) * radius + (phi < 0 ? -halfLen : phi > 0 ? halfLen : 0);
      const ringR = Math.cos(phi) * radius;
      for (let i = 0; i <= radialSegments; i++) {
        const theta = (i / radialSegments) * Math.PI * 2;
        const c = Math.cos(theta), s = Math.sin(theta);
        positions.push(c * ringR, cy, s * ringR);
        // Normal points away from the capsule segment axis.
        const ny = Math.sin(phi);
        normals.push(c * Math.cos(phi), ny, s * Math.cos(phi));
        uvs.push(i / radialSegments, j / rows);
      }
    }
    // Pole vertices.
    const bottomCenter = positions.length / 3;
    positions.push(0, -halfLen - radius, 0); normals.push(0, -1, 0); uvs.push(0.5, 0);
    const topCenter = positions.length / 3;
    positions.push(0, halfLen + radius, 0); normals.push(0, 1, 0); uvs.push(0.5, 1);
    const stride = radialSegments + 1;
    for (let j = 0; j < rows; j++) for (let i = 0; i < radialSegments; i++) {
      const a = j * stride + i;
      indices.push(a, a + stride, a + 1, a + 1, a + stride, a + stride + 1);
    }
    for (let i = 0; i < radialSegments; i++) indices.push(bottomCenter, stride + i, stride + i + 1);
    const lastRing = rows * stride;
    for (let i = 0; i < radialSegments; i++) indices.push(topCenter, lastRing + i + 1, lastRing + i);
    this.setAttribute('position', new Float32BufferAttribute(positions, 3));
    this.setAttribute('normal', new Float32BufferAttribute(normals, 3));
    this.setAttribute('uv', new Float32BufferAttribute(uvs, 2));
    this.setIndex(new Uint32BufferAttribute(indices, 1));
  }
}

// Convex polyhedron from vertex/face lists; `detail` subdivides faces and
// projects new vertices onto the circumsphere. Face winding is fixed
// automatically so normals point outward.
export class PolyhedronGeometry extends BufferGeometry {
  constructor(vertices, indices, radius = 1, detail = 0) {
    super();
    let verts = vertices.map(v => {
      const l = Math.hypot(v[0], v[1], v[2]) || 1;
      return [v[0] / l * radius, v[1] / l * radius, v[2] / l * radius];
    });
    let faces = [];
    for (let i = 0; i < indices.length; i += 3) {
      let [a, b, c] = [indices[i], indices[i + 1], indices[i + 2]];
      const ab = [verts[b][0] - verts[a][0], verts[b][1] - verts[a][1], verts[b][2] - verts[a][2]];
      const ac = [verts[c][0] - verts[a][0], verts[c][1] - verts[a][1], verts[c][2] - verts[a][2]];
      const n = [ab[1] * ac[2] - ab[2] * ac[1], ab[2] * ac[0] - ab[0] * ac[2], ab[0] * ac[1] - ab[1] * ac[0]];
      const cx = (verts[a][0] + verts[b][0] + verts[c][0]) / 3;
      const cy = (verts[a][1] + verts[b][1] + verts[c][1]) / 3;
      const cz = (verts[a][2] + verts[b][2] + verts[c][2]) / 3;
      if (n[0] * cx + n[1] * cy + n[2] * cz < 0) [b, c] = [c, b];
      faces.push([a, b, c]);
    }
    const midpointCache = new Map();
    const midpoint = (i, j) => {
      const key = i < j ? `${i},${j}` : `${j},${i}`;
      if (midpointCache.has(key)) return midpointCache.get(key);
      const a = verts[i], b = verts[j];
      const m = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2, (a[2] + b[2]) / 2];
      const l = Math.hypot(...m) || 1;
      const idx = verts.length;
      verts.push([m[0] / l * radius, m[1] / l * radius, m[2] / l * radius]);
      midpointCache.set(key, idx);
      return idx;
    };
    for (let d = 0; d < detail; d++) {
      const next = [];
      midpointCache.clear();
      for (const [a, b, c] of faces) {
        const ab = midpoint(a, b), bc = midpoint(b, c), ca = midpoint(c, a);
        next.push([a, ab, ca], [b, bc, ab], [c, ca, bc], [ab, bc, ca]);
      }
      faces = next;
    }
    const positions = [], normals = [], uvs = [], indexList = [];
    for (const [a, b, c] of faces) {
      const base = positions.length / 3;
      for (const vi of [a, b, c]) {
        const v = verts[vi];
        positions.push(v[0], v[1], v[2]);
        const l = Math.hypot(v[0], v[1], v[2]) || 1;
        normals.push(v[0] / l, v[1] / l, v[2] / l);
        // Spherical UVs like three.js.
        uvs.push(Math.atan2(v[2], v[0]) / (Math.PI * 2) + 0.5, Math.acos(Math.max(-1, Math.min(1, v[1] / l))) / Math.PI);
      }
      indexList.push(base, base + 1, base + 2);
    }
    this.setAttribute('position', new Float32BufferAttribute(positions, 3));
    this.setAttribute('normal', new Float32BufferAttribute(normals, 3));
    this.setAttribute('uv', new Float32BufferAttribute(uvs, 2));
    this.setIndex(new Uint32BufferAttribute(indexList, 1));
    this.isPolyhedronGeometry = true;
  }
}

export class TetrahedronGeometry extends PolyhedronGeometry {
  constructor(radius = 1, detail = 0) {
    super([[1, 1, 1], [1, -1, -1], [-1, 1, -1], [-1, -1, 1]], [0, 1, 2, 0, 3, 1, 0, 2, 3, 1, 3, 2], radius, detail);
    this.isTetrahedronGeometry = true;
  }
}
export class OctahedronGeometry extends PolyhedronGeometry {
  constructor(radius = 1, detail = 0) {
    super([[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]],
      [0, 2, 4, 2, 1, 4, 1, 3, 4, 3, 0, 4, 2, 0, 5, 1, 2, 5, 3, 1, 5, 0, 3, 5], radius, detail);
    this.isOctahedronGeometry = true;
  }
}
const PHI = (1 + Math.sqrt(5)) / 2;
const ICO_VERTS = [[0, 1, PHI], [0, 1, -PHI], [0, -1, PHI], [0, -1, -PHI], [1, PHI, 0], [1, -PHI, 0], [-1, PHI, 0], [-1, -PHI, 0], [PHI, 0, 1], [-PHI, 0, 1], [PHI, 0, -1], [-PHI, 0, -1]];
const ICO_FACES = [
  0, 11, 5, 0, 5, 1, 0, 1, 7, 0, 7, 10, 0, 10, 11,
  1, 5, 9, 5, 11, 4, 11, 10, 2, 10, 7, 6, 7, 1, 8,
  3, 9, 4, 3, 4, 2, 3, 2, 6, 3, 6, 8, 3, 8, 9,
  4, 9, 5, 2, 4, 11, 6, 2, 10, 8, 6, 7, 9, 8, 1,
];
export class IcosahedronGeometry extends PolyhedronGeometry {
  constructor(radius = 1, detail = 0) {
    super(ICO_VERTS, ICO_FACES, radius, detail);
    this.isIcosahedronGeometry = true;
  }
}
// The dodecahedron is the dual of the icosahedron: its vertices are the
// icosahedron's face centroids and each icosahedron vertex becomes a pentagon.
function dodecahedronData() {
  const norm = v => { const l = Math.hypot(v[0], v[1], v[2]) || 1; return [v[0] / l, v[1] / l, v[2] / l]; };
  const icoFaces = [];
  for (let i = 0; i < ICO_FACES.length; i += 3) icoFaces.push([ICO_FACES[i], ICO_FACES[i + 1], ICO_FACES[i + 2]]);
  const verts = icoFaces.map(f => norm([
    (ICO_VERTS[f[0]][0] + ICO_VERTS[f[1]][0] + ICO_VERTS[f[2]][0]) / 3,
    (ICO_VERTS[f[0]][1] + ICO_VERTS[f[1]][1] + ICO_VERTS[f[2]][1]) / 3,
    (ICO_VERTS[f[0]][2] + ICO_VERTS[f[1]][2] + ICO_VERTS[f[2]][2]) / 3,
  ]));
  const incident = ICO_VERTS.map(() => []);
  icoFaces.forEach((f, fi) => { for (const vi of f) incident[vi].push(fi); });
  const tris = [];
  incident.forEach((faces, vi) => {
    // Order the incident faces cyclically around the vertex axis.
    const axis = norm(ICO_VERTS[vi]);
    const ref = Math.abs(axis[1]) < 0.9 ? [0, 1, 0] : [1, 0, 0];
    const u = norm([axis[1] * ref[2] - axis[2] * ref[1], axis[2] * ref[0] - axis[0] * ref[2], axis[0] * ref[1] - axis[1] * ref[0]]);
    const w = [axis[1] * u[2] - axis[2] * u[1], axis[2] * u[0] - axis[0] * u[2], axis[0] * u[1] - axis[1] * u[0]];
    const ordered = faces.slice().sort((p, q) => {
      const cp = [
        (verts[p][1] * axis[2] - verts[p][2] * axis[1]),
        (verts[p][2] * axis[0] - verts[p][0] * axis[2]),
        (verts[p][0] * axis[1] - verts[p][1] * axis[0]),
      ];
      const angle = v3 => Math.atan2(v3[0] * w[0] + v3[1] * w[1] + v3[2] * w[2], v3[0] * u[0] + v3[1] * u[1] + v3[2] * u[2]);
      return angle(cp) - angle([
        (verts[q][1] * axis[2] - verts[q][2] * axis[1]),
        (verts[q][2] * axis[0] - verts[q][0] * axis[2]),
        (verts[q][0] * axis[1] - verts[q][1] * axis[0]),
      ]);
    });
    for (let i = 1; i < ordered.length - 1; i++) tris.push(ordered[0], ordered[i], ordered[i + 1]);
  });
  return { verts, tris };
}
export class DodecahedronGeometry extends PolyhedronGeometry {
  constructor(radius = 1, detail = 0) {
    const { verts, tris } = dodecahedronData();
    super(verts, tris, radius, detail);
    this.isDodecahedronGeometry = true;
  }
}

export class TorusKnotGeometry extends BufferGeometry {
  // p/q are the winding numbers (default trefoil 2,3).
  constructor(radius = 1, tube = 0.4, tubularSegments = 64, radialSegments = 8, p = 2, q = 3) {
    super();
    const positions = [], normals = [], uvs = [], indices = [];
    // Curve C(u) = ((2+cos(q u)) cos(p u), (2+cos(q u)) sin(p u), sin(q u))
    const curve = u => {
      const a = p * u * Math.PI * 2, b = q * u * Math.PI * 2;
      const r = 2 + Math.cos(b);
      return [r * Math.cos(a) * radius, r * Math.sin(a) * radius, Math.sin(b) * radius];
    };
    const eps = 1e-4;
    const frames = [];
    for (let j = 0; j <= tubularSegments; j++) {
      const u = j / tubularSegments;
      const P = curve(u);
      const P2 = curve(Math.min(1, u + eps));
      const T = normalize3([P2[0] - P[0], P2[1] - P[1], P2[2] - P[2]]);
      // Normal = component of radial dir perpendicular to tangent.
      const up = Math.abs(T[1]) < 0.9 ? [0, 1, 0] : [1, 0, 0];
      const N = normalize3([
        T[1] * up[2] - T[2] * up[1], T[2] * up[0] - T[0] * up[2], T[0] * up[1] - T[1] * up[0]]);
      const B = [
        T[1] * N[2] - T[2] * N[1], T[2] * N[0] - T[0] * N[2], T[0] * N[1] - T[1] * N[0]];
      frames.push([P, T, N, B]);
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
    this.setAttribute('position', new Float32BufferAttribute(positions, 3));
    this.setAttribute('normal', new Float32BufferAttribute(normals, 3));
    this.setAttribute('uv', new Float32BufferAttribute(uvs, 2));
    this.setIndex(new Uint32BufferAttribute(indices, 1));
    this.isTorusKnotGeometry = true;
  }
}

export class TubeGeometry extends BufferGeometry {
  // path: object with getPoint(t) -> {x,y,z} or [x,y,z] (Curve, CatmullRomCurve3, ...)
  constructor(path, tubularSegments = 64, radius = 1, radialSegments = 8, closed = false) {
    super();
    const getPoint = t => {
      const p = path.getPoint ? path.getPoint(t) : path.getPointAt ? path.getPointAt(t) : null;
      if (!p) throw new Error('gs3d: TubeGeometry path needs getPoint(t)');
      return Array.isArray(p) ? p : [p.x, p.y, p.z];
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
      const T = normalize3([P2[0] - P[0], P2[1] - P[1], P2[2] - P[2]]);
      const up = Math.abs(T[1]) < 0.9 ? [0, 1, 0] : [1, 0, 0];
      const N = normalize3([
        T[1] * up[2] - T[2] * up[1], T[2] * up[0] - T[0] * up[2], T[0] * up[1] - T[1] * up[0]]);
      const B = [
        T[1] * N[2] - T[2] * N[1], T[2] * N[0] - T[0] * N[2], T[0] * N[1] - T[1] * N[0]];
      frames.push([P, N, B]);
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
      // Wrap last ring to first.
      const last = (rings - 1) * stride, first = 0;
      for (let i = 0; i < radialSegments; i++) {
        indices.push(last + i, first + i, last + i + 1);
        indices.push(last + i + 1, first + i, first + i + 1);
      }
    }
    this.setAttribute('position', new Float32BufferAttribute(positions, 3));
    this.setAttribute('normal', new Float32BufferAttribute(normals, 3));
    this.setAttribute('uv', new Float32BufferAttribute(uvs, 2));
    this.setIndex(new Uint32BufferAttribute(indices, 1));
    this.isTubeGeometry = true;
  }
}


export class LatheGeometry extends BufferGeometry {
  // points: array of Vector2-like {x: radius, y: height}; spun around Y.
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
      const phi = phiStart + (j / segments) * phiLength;
      const c = Math.cos(phi), s = Math.sin(phi);
      for (let i = 0; i < n; i++) {
        normals.push(ringNormals[i][0] * c, ringNormals[i][1], ringNormals[i][0] * s);
      }
    }
    const stride = n;
    for (let j = 0; j < segments; j++) for (let i = 0; i < n - 1; i++) {
      const a = j * stride + i;
      indices.push(a, a + stride, a + 1, a + 1, a + stride, a + stride + 1);
    }
    this.setAttribute('position', new Float32BufferAttribute(positions, 3));
    this.setAttribute('normal', new Float32BufferAttribute(normals, 3));
    this.setAttribute('uv', new Float32BufferAttribute(uvs, 2));
    this.setIndex(new Uint32BufferAttribute(indices, 1));
    this.isLatheGeometry = true;
  }
}


/* --- derived line geometries -----------------------------------------------------
 * EdgesGeometry keeps only edges whose adjacent face normals differ by more
 * than the threshold angle; WireframeGeometry emits every triangle edge. Both
 * produce position-only BufferGeometry for use with Line/LineSegments. */

function edgePositions(geometry, dedupe) {
  const pos = geometry.attributes.position;
  const index = geometry.index;
  const p = pos.array, is = pos.itemSize || 3;
  const triCount = index ? index.count / 3 : pos.count / 3;
  const out = [];
  const key = (a, b) => a < b ? a * 4294967296 + b : b * 4294967296 + a;
  const seen = new Set();
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
    push(i0, i1); push(i1, i2); push(i2, i0);
  }
  return out;
}

export class WireframeGeometry extends BufferGeometry {
  constructor(geometry, thresholdAngle = 1) {
    super();
    this.isWireframeGeometry = true;
    this.setAttribute('position', new Float32BufferAttribute(edgePositions(geometry, false), 3));
  }
}

export class EdgesGeometry extends BufferGeometry {
  constructor(geometry, thresholdAngle = 1) {
    super();
    this.isEdgesGeometry = true;
    const thresholdDot = Math.cos((thresholdAngle * Math.PI) / 180);
    const pos = geometry.attributes.position;
    const index = geometry.index;
    const p = pos.array, is = pos.itemSize || 3;
    const out = [];
    // Map undirected vertex-index edge -> first adjacent face normal + edge.
    const edgeFaces = new Map();
    const vkey = (a, b) => a < b ? a * 4294967296 + b : b * 4294967296 + a;
    const faceNormal = (ia, ib, ic) => {
      const ax = p[ia * is], ay = p[ia * is + 1], az = p[ia * is + 2];
      const e1x = p[ib * is] - ax, e1y = p[ib * is + 1] - ay, e1z = p[ib * is + 2] - az;
      const e2x = p[ic * is] - ax, e2y = p[ic * is + 1] - ay, e2z = p[ic * is + 2] - az;
      let nx = e1y * e2z - e1z * e2y, ny = e1z * e2x - e1x * e2z, nz = e1x * e2y - e1y * e2x;
      const l = Math.hypot(nx, ny, nz) || 1;
      return [nx / l, ny / l, nz / l];
    };
    const triCount = index ? index.count / 3 : pos.count / 3;
    for (let t = 0; t < triCount; t++) {
      const i0 = index ? index.array[t * 3] : t * 3;
      const i1 = index ? index.array[t * 3 + 1] : t * 3 + 1;
      const i2 = index ? index.array[t * 3 + 2] : t * 3 + 2;
      const n = faceNormal(i0, i1, i2);
      for (const [a, b] of [[i0, i1], [i1, i2], [i2, i0]]) {
        const k = vkey(a, b);
        const prev = edgeFaces.get(k);
        if (prev === undefined) edgeFaces.set(k, { a, b, n, count: 1, emitted: false });
        else {
          prev.count++;
          if (!prev.emitted && prev.count === 2) {
            // Second adjacent face: emit the edge only where the faces bend
            // past the threshold angle.
            const dot = prev.n[0] * n[0] + prev.n[1] * n[1] + prev.n[2] * n[2];
            if (dot <= thresholdDot) {
              prev.emitted = true;
              out.push(p[prev.a * is], p[prev.a * is + 1], p[prev.a * is + 2],
                       p[prev.b * is], p[prev.b * is + 1], p[prev.b * is + 2]);
            }
          }
        }
      }
    }
    // Boundary edges (one adjacent face) always emit; smooth interior edges
    // (shared by two near-parallel faces) do not.
    for (const e of edgeFaces.values()) {
      if (e.count === 1) out.push(p[e.a * is], p[e.a * is + 1], p[e.a * is + 2], p[e.b * is], p[e.b * is + 1], p[e.b * is + 2]);
    }
    this.setAttribute('position', new Float32BufferAttribute(out, 3));
  }
}
