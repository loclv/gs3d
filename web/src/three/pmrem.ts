import { Color } from './color';
import { Vector3 } from './math';
import { Scene, PerspectiveCamera } from './scene';
import { Mesh } from './geometry';
import { PlaneGeometry } from './primitives';
import { DataTexture } from './textures';
import { MeshBasicMaterial } from './materials';
import { releaseTexture } from './bridge';

/* --- environment capture --------------------------------------------------------
 * PMREMGenerator renders the scene into a cubemap and stitches it into the
 * equirectangular layout the engine's environment-map path expects. There is
 * no roughness-dependent prefiltering: the engine generates its own filtered
 * mips from the base equirect, which approximates PMREM for typical env scenes.
 * `sigma`/`near`/`far` follow three.js signatures; `options.size` sets the
 * equirect width (height = size/2), default 256. */

const ENV_FACES = [
  { f: [1, 0, 0], u: [0, 1, 0] },
  { f: [-1, 0, 0], u: [0, 1, 0] },
  { f: [0, 1, 0], u: [0, 0, -1] },
  { f: [0, -1, 0], u: [0, 0, 1] },
  { f: [0, 0, 1], u: [0, 1, 0] },
  { f: [0, 0, -1], u: [0, 1, 0] },
];

function envFaceBasis(face) {
  const f = face.f, up = face.u;
  // Camera looks down -Z toward f, so camera +Z (backward) is -f.
  const zx = -f[0], zy = -f[1], zz = -f[2];
  // xaxis = normalize(cross(up, zaxis))
  let xx = up[1] * zz - up[2] * zy, xy = up[2] * zx - up[0] * zz, xz = up[0] * zy - up[1] * zx;
  const xl = Math.hypot(xx, xy, xz) || 1;
  xx /= xl; xy /= xl; xz /= xl;
  // yaxis = cross(zaxis, xaxis)
  const yx = zy * xz - zz * xy, yy = zz * xx - zx * xz, yz = zx * xy - zy * xx;
  return { f, x: [xx, xy, xz], y: [yx, yy, yz] };
}

export class PMREMGenerator {
  renderer: any;
  _rt: number;
  constructor(renderer: any) { this.renderer = renderer; this._rt = -1; }
  // Shader precompilation hooks — the engine has no separate shader cache;
  // these exist for three.js API parity and are no-ops.
  compileCubemapShader() { return this; }
  compileEquirectangularShader() { return this; }
  // CubeTexture input: flatten the six faces into an equirect layout would
  // need a GPU pass; return the texture unchanged as the closest mapping.
  fromCubemap(texture: any) {
    return { texture, dispose() {} };
  }

  fromEquirectangular(texture) {
    // Already equirectangular — pass through; the engine generates env mips.
    return { texture, dispose() {} };
  }

  fromScene(scene: any, sigma = 0, near = 0.1, far = 100, options: Record<string, any> = {}) {
    const renderer = this.renderer;
    const engine = renderer && renderer._engine;
    const size = options && options.size ? options.size : 256;
    const eqW = size, eqH = size >> 1;
    const face = Math.max(32, size >> 1);
    if (!engine || typeof engine._g3_asset_render_target_create !== 'function') {
      return { texture: new DataTexture(new Uint8Array(eqW * eqH * 4), eqW, eqH), dispose() {} };
    }
    const rt = engine._g3_asset_render_target_create(face, face);
    if (rt < 0) return { texture: new DataTexture(new Uint8Array(eqW * eqH * 4), eqW, eqH), dispose() {} };
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
    // Trig tables keep the inner loop allocation-free: lambda per column,
    // phi per row, matching envTexelDir's equirect parameterization.
    const cosL = new Float64Array(eqW), sinL = new Float64Array(eqW);
    for (let i = 0; i < eqW; i++) {
      const l = ((i + 0.5) / eqW - 0.5) * 2 * Math.PI;
      cosL[i] = Math.cos(l); sinL[i] = Math.sin(l);
    }
    const sinP = new Float64Array(eqH), cosP = new Float64Array(eqH);
    for (let j = 0; j < eqH; j++) {
      const phi = (j + 0.5) / eqH * Math.PI;
      sinP[j] = Math.sin(phi); cosP[j] = Math.cos(phi);
    }
    for (let j = 0; j < eqH; j++) {
      const sp = sinP[j], cp = cosP[j];
      for (let i = 0; i < eqW; i++) {
        const dx = sp * cosL[i], dy = cp, dz = sp * sinL[i];
        // Nearest face; its forward dot is also the projection denominator.
        let k = 0, denom = -Infinity;
        for (let f = 0; f < 6; f++) {
          const dot = dx * bases[f].f[0] + dy * bases[f].f[1] + dz * bases[f].f[2];
          if (dot > denom) { denom = dot; k = f; }
        }
        const b = bases[k];
        const cx = (dx * b.x[0] + dy * b.x[1] + dz * b.x[2]) / denom;
        const cy = (dx * b.y[0] + dy * b.y[1] + dz * b.y[2]) / denom;
        const fx = Math.min(face - 1, Math.max(0, Math.floor((cx * 0.5 + 0.5) * face)));
        const fy = Math.min(face - 1, Math.max(0, Math.floor((0.5 - cy * 0.5) * face)));
        sampleFaceBilinear(faces[k], face, fx, fy, out, (j * eqW + i) * 4);
      }
    }
    const texture = new DataTexture(out, eqW, eqH);
    return { texture, dispose() { releaseTexture(texture); } };
  }

  dispose() {}
}

function readTargetPixels(engine, rt, size) {
  const bytes = size * size * 4;
  const ptr = engine._malloc(bytes);
  const buf = new Uint8Array(engine.HEAPU8.buffer, ptr, bytes);
  if (!engine._g3_host_render_target_read(rt, 0, 0, size, size, ptr, bytes)) {
    engine._free(ptr);
    throw new Error('gs3d: environment render target readback failed');
  }
  // Readback arrives bottom-up; flip to top-down for sampling.
  const out = new Uint8Array(bytes);
  for (let y = 0; y < size; y++) {
    out.set(buf.subarray((size - 1 - y) * size * 4, (size - y) * size * 4), y * size * 4);
  }
  engine._free(ptr);
  return out;
}

function sampleFaceBilinear(face, size, fx, fy, out, outOff) {
  const x0 = Math.max(0, fx - 0.5 | 0), y0 = Math.max(0, fy - 0.5 | 0);
  const x1 = Math.min(size - 1, x0 + 1), y1 = Math.min(size - 1, y0 + 1);
  const tx = Math.min(1, Math.max(0, fx - 0.5 - x0)), ty = Math.min(1, Math.max(0, fy - 0.5 - y0));
  const i00 = (y0 * size + x0) * 4, i10 = (y0 * size + x1) * 4;
  const i01 = (y1 * size + x0) * 4, i11 = (y1 * size + x1) * 4;
  for (let c = 0; c < 4; c++) {
    const top = face[i00 + c] * (1 - tx) + face[i10 + c] * tx;
    const bot = face[i01 + c] * (1 - tx) + face[i11 + c] * tx;
    out[outOff + c] = top * (1 - ty) + bot * ty;
  }
}

// Minimal stand-in for three's RoomEnvironment: a softbox-style env scene
// built from emissive planes, matching the look of the addon closely enough
// for image-based lighting.
export class RoomEnvironment extends Scene {
  isRoomEnvironment: boolean;
  constructor() {
    super();
    this.isRoomEnvironment = true;
    const box = (w, h, color, intensity, pos, look) => {
      const c = new Color(color);
      c.r *= intensity; c.g *= intensity; c.b *= intensity;
      const m = new Mesh(
        new PlaneGeometry(w, h),
        new MeshBasicMaterial({ color: c })
      );
      m.position.set(pos[0], pos[1], pos[2]);
      m.lookAt(new Vector3(look[0], look[1], look[2]));
      m.updateMatrixWorld();
      this.add(m);
    };
    // Ceiling light panel + a few wall/floor softboxes, roughly matching
    // three's RoomEnvironment layout.
    box(10, 10, 0xffffff, 5, [0, 4, 0], [0, 0, -1]);
    box(6, 3, 0xfff4e0, 3, [-4, 1, -3], [0, 1, 0]);
    box(4, 6, 0xe8f0ff, 2, [4, 0.5, -2], [0, 1, 0]);
    box(8, 4, 0xffffff, 1.5, [0, -3, 2], [0, 1, 0]);
    box(3, 3, 0xd0e8ff, 2, [-3, 2, 3], [0, 0, -1]);
    box(3, 3, 0xffe8d0, 1.5, [3, 2, 3], [0, 0, -1]);
    this.updateMatrixWorld();
  }
  dispose() {
    this.traverse(node => {
      node.geometry?.dispose?.();
      for (const material of Array.isArray(node.material) ? node.material : [node.material]) material?.dispose?.();
    });
  }
}
