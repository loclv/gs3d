import { Vector2, Vector3, multiplyMat4, invertMat4, transformPoint, transformDir, normalize3 } from './math';
import { Ray, rayBoxT, rayTriangle } from './bounds';
import { FrontSide } from './materials';
import { worldMatrixOf } from './bridge';


export class Raycaster {
  ray: Ray;
  near: number;
  far: number;
  camera: any;
  layers: { mask: number };
  constructor(origin = new Vector3(), direction = new Vector3(0, 0, -1), near = 0, far = Infinity) {
    this.ray = new Ray(origin, direction);
    this.near = near;
    this.far = far;
    this.camera = null;
    this.layers = { mask: 1 };
  }
  set(origin, direction) { this.ray.set(origin, direction); return this; }
  setFromCamera(coords, camera) {
    // coords are normalized device coordinates (-1..1); camera is a facade camera.
    const world = worldMatrixOf(camera);
    this.camera = camera;
    if (camera.isOrthographicCamera) {
      const cx = (camera.left + camera.right) * 0.5 + coords.x * (camera.right - camera.left) * 0.5;
      const cy = (camera.bottom + camera.top) * 0.5 + coords.y * (camera.top - camera.bottom) * 0.5;
      const near = Number.isFinite(camera.near) ? camera.near : 0.1;
      const pos = transformPoint(world, cx, cy, -near);
      const dir = normalize3(transformDir(world, 0, 0, -1));
      this.ray.origin.set(pos[0], pos[1], pos[2]);
      this.ray.direction.set(dir[0], dir[1], dir[2]);
      return this;
    }
    const pos = transformPoint(world, 0, 0, 0);
    const tanFov = Math.max(1e-4, Math.tan(((camera.fov ?? 50) * Math.PI / 180) / 2));
    const aspect = camera.aspect > 0 ? camera.aspect : 1;
    // Camera-space ray through the NDC point, then rotate into world space.
    const lx = coords.x * tanFov * aspect, ly = coords.y * tanFov;
    const local = normalize3([lx, ly, -1]);
    const dir = normalize3(transformDir(world, local[0], local[1], local[2]));
    this.ray.origin.set(pos[0], pos[1], pos[2]);
    this.ray.direction.set(dir[0], dir[1], dir[2]);
    return this;
  }
  intersectObject(object, recursive = true, hits = []) {
    const walk = node => {
      if (node.isInstancedMesh && node.geometry && node.geometry.attributes && node.geometry.attributes.position) {
        const world = worldMatrixOf(node);
        const count = Math.min(node.count, node._maxCount);
        const arr = node.instanceMatrix.array;
        for (let i = 0; i < count; i++) {
          const instWorld = multiplyMat4(world, arr.subarray(i * 16, i * 16 + 16));
          this._intersectMesh(node, instWorld, hits, i);
        }
      } else if (node.isMesh && node.geometry && node.geometry.attributes && node.geometry.attributes.position) {
        this._intersectMesh(node, worldMatrixOf(node), hits);
      }
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
  _intersectMesh(mesh: any, world: any, hits: any[], instanceId?: number) {
    const geometry = mesh.geometry;
    const pos = geometry.attributes.position;
    if (!pos) return;
    if (!geometry.boundingBox) geometry.computeBoundingBox();
    const inv = invertMat4(world);
    if (!inv) return;
    const ox = this.ray.origin.x, oy = this.ray.origin.y, oz = this.ray.origin.z;
    // Ray into mesh-local space.
    const lo = transformPoint(inv, ox, oy, oz);
    const ld = normalize3(transformDir(inv, this.ray.direction.x, this.ray.direction.y, this.ray.direction.z));
    if (geometry.boundingBox && rayBoxT(lo[0], lo[1], lo[2], ld[0], ld[1], ld[2], geometry.boundingBox) === null) {
      return;
    }
    const p = pos.array, is = pos.itemSize;
    const uvAttr = geometry.attributes.uv;
    const uvArr = uvAttr ? uvAttr.array : null;
    const uvSize = uvAttr ? uvAttr.itemSize : 0;
    const index = geometry.index && geometry.index.array;
    const totalIndices = index ? index.length : pos.count;
    const groups = geometry.groups && geometry.groups.length
      ? geometry.groups
      : [{ start: 0, count: totalIndices, materialIndex: 0 }];
    const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
    let best = null;
    for (const grp of groups) {
      const mat = mats[Math.min(grp.materialIndex || 0, mats.length - 1)];
      const side = mat && mat.side !== undefined ? mat.side : FrontSide;
      const end = Math.min(grp.start + grp.count, totalIndices);
      for (let i = grp.start; i + 2 < end; i += 3) {
        const ia = index ? index[i] : i;
        const ib = index ? index[i + 1] : i + 1;
        const ic = index ? index[i + 2] : i + 2;
        const a = ia * is, b = ib * is, c = ic * is;
        const hit = rayTriangle(lo[0], lo[1], lo[2], ld[0], ld[1], ld[2],
          p[a], p[a + 1], p[a + 2], p[b], p[b + 1], p[b + 2], p[c], p[c + 1], p[c + 2], side);
        if (!hit) continue;
        const wp = transformPoint(world, lo[0] + ld[0] * hit.t, lo[1] + ld[1] * hit.t, lo[2] + ld[2] * hit.t);
        const distance = Math.hypot(wp[0] - ox, wp[1] - oy, wp[2] - oz);
        if (distance < this.near || distance > this.far) continue;
        if (!best || distance < best.distance) {
          best = {
            distance, wp, ia, ib, ic, a, b, c, u: hit.u, v: hit.v,
            faceIndex: Math.floor(i / 3), materialIndex: grp.materialIndex || 0,
          };
        }
      }
    }
    if (!best) return;
    const { distance, wp, ia, ib, ic, a, b, c, u, v, faceIndex, materialIndex } = best;
    const e1 = [p[b] - p[a], p[b + 1] - p[a + 1], p[b + 2] - p[a + 2]];
    const e2 = [p[c] - p[a], p[c + 1] - p[a + 1], p[c + 2] - p[a + 2]];
    const n = normalize3([e1[1] * e2[2] - e1[2] * e2[1], e1[2] * e2[0] - e1[0] * e2[2], e1[0] * e2[1] - e1[1] * e2[0]]);
    const wn = normalize3(transformDir(world, n[0], n[1], n[2]));
    let uv = null;
    if (uvArr && uvSize >= 2) {
      const w0 = 1 - u - v;
      uv = new Vector2(
        uvArr[ia * uvSize] * w0 + uvArr[ib * uvSize] * u + uvArr[ic * uvSize] * v,
        uvArr[ia * uvSize + 1] * w0 + uvArr[ib * uvSize + 1] * u + uvArr[ic * uvSize + 1] * v,
      );
    }
    const entry: any = {
      distance,
      point: new Vector3(wp[0], wp[1], wp[2]),
      face: { a: ia, b: ib, c: ic, normal: new Vector3(wn[0], wn[1], wn[2]), materialIndex },
      faceIndex,
      object: mesh,
      uv,
    };
    if (instanceId !== undefined) entry.instanceId = instanceId;
    hits.push(entry);
  }
}

