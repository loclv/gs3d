import * as THREE from 'gs3d/three';
import type { Vec3 } from './animation';

export interface CharacterRig {
  root: THREE.Group;
  /** Joint name -> Object3D. 'root' is the whole-character group. */
  joints: Record<string, THREE.Object3D>;
  /** Local position each joint rests at; clip position channels are deltas from this. */
  bases: Record<string, Vec3>;
}

const BODY = 0x8ca6ff;
const BODY_DARK = 0x5a6aa8;
const ACCENT = 0x73d3b0;
const JOINT = 0x2a3244;
const DARK = 0x171c28;

function material(color: number | string, roughness = 0.45, metalness = 0.15): THREE.MeshStandardMaterial {
  return new THREE.MeshStandardMaterial({ color, roughness, metalness });
}

function part(
  parent: THREE.Object3D,
  geo: THREE.BufferGeometry,
  mat: THREE.Material,
  x = 0,
  y = 0,
  z = 0,
): THREE.Mesh {
  const mesh = new THREE.Mesh(geo, mat);
  mesh.position.set(x, y, z);
  parent.add(mesh);
  return mesh;
}

function box(w: number, h: number, d: number): THREE.BoxGeometry {
  return new THREE.BoxGeometry(w, h, d);
}

function capsule(radius: number, length: number): THREE.CapsuleGeometry {
  return new THREE.CapsuleGeometry(radius, length, 6, 14);
}

/**
 * A small two-legged robot built from primitives. Every moving part hangs
 * off a named joint group so clips can rotate limbs around their pivots.
 * Faces +Z, stands on y = 0, roughly 2 units tall.
 */
export function buildCharacter(): CharacterRig {
  const root = new THREE.Group();
  root.name = 'rig';
  const joints: Record<string, THREE.Object3D> = { root };
  const bases: Record<string, Vec3> = { root: [0, 0, 0] };

  const bodyMat = material(BODY);
  const darkMat = material(BODY_DARK);
  const accentMat = material(ACCENT, 0.4, 0.2);
  const jointMat = material(JOINT, 0.6, 0.3);
  const darkMat2 = material(DARK, 0.7, 0.2);
  const eyeMat = material(0xbfe3ff, 0.25, 0.1);
  eyeMat.emissive = new THREE.Color(0x9fd0ff);
  eyeMat.emissiveIntensity = 1.4;
  const tipMat = material(0xffb35f, 0.3, 0.1);
  tipMat.emissive = new THREE.Color(0xff9a3c);
  tipMat.emissiveIntensity = 1.6;

  const joint = (parent: THREE.Object3D, name: string, x: number, y: number, z: number): THREE.Group => {
    const g = new THREE.Group();
    g.name = name;
    g.position.set(x, y, z);
    parent.add(g);
    joints[name] = g;
    bases[name] = [x, y, z];
    return g;
  };

  const hips = joint(root, 'hips', 0, 0.98, 0);
  part(hips, box(0.48, 0.28, 0.32), darkMat, 0, 0, 0);
  part(hips, box(0.3, 0.1, 0.05), accentMat, 0, 0.02, 0.17);

  const torso = joint(hips, 'torso', 0, 0.16, 0);
  part(torso, capsule(0.26, 0.18), bodyMat, 0, 0.3, 0);
  part(torso, box(0.4, 0.34, 0.1), accentMat, 0, 0.34, 0.2);
  part(torso, box(0.56, 0.12, 0.36), jointMat, 0, 0.02, 0);

  const head = joint(torso, 'head', 0, 0.56, 0);
  part(head, capsule(0.07, 0.08), jointMat, 0, 0.0, 0);
  part(head, new THREE.SphereGeometry(0.22, 24, 18), bodyMat, 0, 0.18, 0);
  part(head, box(0.34, 0.1, 0.06), darkMat2, 0, 0.17, 0.19);
  part(head, new THREE.SphereGeometry(0.032, 10, 8), eyeMat, -0.08, 0.19, 0.22);
  part(head, new THREE.SphereGeometry(0.032, 10, 8), eyeMat, 0.08, 0.19, 0.22);
  part(head, new THREE.CylinderGeometry(0.015, 0.015, 0.24, 8), jointMat, 0.12, 0.42, 0);
  part(head, new THREE.SphereGeometry(0.045, 12, 10), tipMat, 0.12, 0.55, 0);

  const limb = (
    parent: THREE.Object3D,
    name: string,
    x: number,
    y: number,
    z: number,
    upperLen: number,
    lowerLen: number,
    rTop: number,
    rBottom: number,
    hand: boolean,
    endName: string,
  ): { joint: THREE.Group; end: THREE.Group } => {
    const shoulder = joint(parent, name, x, y, z);
    part(shoulder, new THREE.SphereGeometry(rTop + 0.025, 14, 10), jointMat, 0, 0, 0);
    part(shoulder, capsule(rTop, upperLen), bodyMat, 0, -upperLen / 2 - 0.03, 0);
    const elbow = joint(shoulder, endName, 0, -upperLen - 0.06, 0);
    part(elbow, capsule(rBottom, lowerLen), darkMat2, 0, -lowerLen / 2 - 0.03, 0);
    if (hand) part(elbow, new THREE.SphereGeometry(rBottom + 0.02, 12, 10), accentMat, 0, -lowerLen - 0.08, 0);
    return { joint: shoulder, end: elbow };
  };

  limb(torso, 'shoulderL', -0.37, 0.36, 0, 0.3, 0.3, 0.065, 0.055, true, 'elbowL');
  limb(torso, 'shoulderR', 0.37, 0.36, 0, 0.3, 0.3, 0.065, 0.055, true, 'elbowR');

  const leg = (parent: THREE.Object3D, name: string, endName: string, x: number): void => {
    const hip = joint(parent, name, x, -0.05, 0);
    part(hip, capsule(0.095, 0.34), darkMat, 0, -0.24, 0);
    const knee = joint(hip, endName, 0, -0.46, 0);
    part(knee, new THREE.SphereGeometry(0.07, 12, 10), jointMat, 0, 0, 0);
    part(knee, capsule(0.07, 0.3), bodyMat, 0, -0.2, 0);
    part(knee, box(0.18, 0.1, 0.34), darkMat2, 0, -0.42, 0.07);
  };
  leg(hips, 'hipL', 'kneeL', -0.16);
  leg(hips, 'hipR', 'kneeR', 0.16);

  return { root, joints, bases };
}

/** Joint names in a stable order for UI pickers. */
export const JOINT_NAMES = [
  'root', 'hips', 'torso', 'head',
  'shoulderL', 'elbowL', 'shoulderR', 'elbowR',
  'hipL', 'kneeL', 'hipR', 'kneeR',
] as const;
