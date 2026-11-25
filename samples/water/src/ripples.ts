import * as THREE from 'gs3d/three';

// A tileable water-ripple normal map generated procedurally: a height
// field summed from integer-frequency sines (so the texture wraps
// seamlessly under RepeatWrapping) converted to tangent-space normals by
// finite differences. Scroll texture.offset each frame for moving ripples.

const SIZE = 256;

// [k, l, amplitude, phase] — integer wave vectors keep the sum periodic
// over the unit tile, so offset scrolling never shows a seam.
const WAVES: [number, number, number, number][] = [
  [3, 1, 0.55, 0.0],
  [1, 4, 0.45, 1.7],
  [5, -2, 0.30, 3.1],
  [-2, 5, 0.28, 0.6],
  [7, 3, 0.16, 2.2],
  [4, -6, 0.14, 4.0],
];

function height(u: number, v: number): number {
  let h = 0;
  for (const [k, l, a, p] of WAVES) {
    h += a * Math.sin(2 * Math.PI * (k * u + l * v) + p);
  }
  return h;
}

const EPS = 1 / SIZE;

export function createRippleNormalMap(): THREE.DataTexture {
  const data = new Uint8Array(SIZE * SIZE * 4);
  const strength = 2.2; // normal perturbation strength before encoding
  for (let y = 0; y < SIZE; y++) {
    const v = y / SIZE;
    for (let x = 0; x < SIZE; x++) {
      const u = x / SIZE;
      const dx = (height(u + EPS, v) - height(u - EPS, v)) / (2 * EPS);
      const dy = (height(u, v + EPS) - height(u, v - EPS)) / (2 * EPS);
      // Tangent-space normal: perturb x/y by the height gradient.
      let nx = -dx * strength;
      let ny = -dy * strength;
      const nz = 1;
      const len = Math.hypot(nx, ny, nz);
      nx /= len; ny /= len;
      const o = (y * SIZE + x) * 4;
      data[o] = Math.round((nx * 0.5 + 0.5) * 255);
      data[o + 1] = Math.round((ny * 0.5 + 0.5) * 255);
      data[o + 2] = Math.round(((nz / len) * 0.5 + 0.5) * 255);
      data[o + 3] = 255;
    }
  }
  const tex = new THREE.DataTexture(data, SIZE, SIZE);
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  tex.magFilter = THREE.LinearFilter;
  tex.needsUpdate = true;
  return tex;
}
