import type { Clip, Keyframe, Vec3 } from './animation';

const k = (t: number, value: Vec3, ease?: Keyframe['ease']): Keyframe => ({ t, value, ease });
const d = (deg: number): Vec3 => [deg, 0, 0];
const zero = (): Vec3 => [0, 0, 0];

/** Subtle breathing idle. Rotation values are degrees. */
const idle: Clip = {
  name: 'Idle',
  duration: 2.4,
  tracks: {
    torso: {
      rotation: [k(0, [0, 0, 0]), k(1.2, [2.5, 0, 0], 'inOut'), k(2.4, [0, 0, 0], 'inOut')],
      scale: [k(0, [1, 1, 1]), k(1.2, [1.03, 1.03, 1.03], 'inOut'), k(2.4, [1, 1, 1], 'inOut')],
    },
    head: {
      rotation: [k(0, [0, 0, 0]), k(0.9, [-3, 4, 0], 'inOut'), k(1.8, [1, -3, 0], 'inOut'), k(2.4, [0, 0, 0], 'inOut')],
    },
    shoulderL: { rotation: [k(0, [0, 0, 4]), k(1.2, [0, 0, -4], 'inOut'), k(2.4, [0, 0, 4], 'inOut')] },
    shoulderR: { rotation: [k(0, [0, 0, -4]), k(1.2, [0, 0, 4], 'inOut'), k(2.4, [0, 0, -4], 'inOut')] },
    hips: { position: [k(0, zero()), k(1.2, [0, 0.015, 0], 'inOut'), k(2.4, zero(), 'inOut')] },
  },
};

/** Treadmill walk cycle; positive X rotation swings a limb backward. */
const walk: Clip = {
  name: 'Walk',
  duration: 1.6,
  tracks: {
    hips: {
      position: [k(0, zero()), k(0.4, [0, -0.025, 0], 'inOut'), k(0.8, zero(), 'inOut'), k(1.2, [0, -0.025, 0], 'inOut'), k(1.6, zero(), 'inOut')],
      rotation: [k(0, [4, 0, 0]), k(0.8, [2, -4, 0], 'inOut'), k(1.6, [4, 0, 0], 'inOut')],
    },
    torso: {
      rotation: [k(0, [6, 0, 0]), k(0.4, [8, 6, -2], 'inOut'), k(0.8, [6, 0, 0], 'inOut'), k(1.2, [8, -6, 2], 'inOut'), k(1.6, [6, 0, 0], 'inOut')],
    },
    head: {
      rotation: [k(0, [-4, 0, 0]), k(0.8, [-4, 3, 0], 'inOut'), k(1.6, [-4, 0, 0], 'inOut')],
    },
    hipL: {
      rotation: [k(0, [0, 0, 0]), k(0.4, d(-32), 'inOut'), k(0.8, zero(), 'inOut'), k(1.2, d(30), 'inOut'), k(1.6, zero(), 'inOut')],
    },
    kneeL: {
      rotation: [k(0, zero()), k(0.5, d(18), 'inOut'), k(0.9, d(4)), k(1.2, d(52), 'inOut'), k(1.6, zero(), 'inOut')],
    },
    hipR: {
      rotation: [k(0, zero()), k(0.4, d(30), 'inOut'), k(0.8, zero(), 'inOut'), k(1.2, d(-32), 'inOut'), k(1.6, zero(), 'inOut')],
    },
    kneeR: {
      rotation: [k(0, zero()), k(0.5, d(4)), k(0.9, d(52), 'inOut'), k(1.2, d(18), 'inOut'), k(1.6, zero(), 'inOut')],
    },
    shoulderL: {
      rotation: [k(0, zero()), k(0.4, d(24), 'inOut'), k(0.8, zero(), 'inOut'), k(1.2, d(-22), 'inOut'), k(1.6, zero(), 'inOut')],
    },
    shoulderR: {
      rotation: [k(0, zero()), k(0.4, d(-22), 'inOut'), k(0.8, zero(), 'inOut'), k(1.2, d(24), 'inOut'), k(1.6, zero(), 'inOut')],
    },
    elbowL: { rotation: [k(0, d(-12)), k(0.8, d(-18), 'inOut'), k(1.6, d(-12), 'inOut')] },
    elbowR: { rotation: [k(0, d(-18)), k(0.8, d(-12), 'inOut'), k(1.6, d(-18), 'inOut')] },
  },
};

/** Right arm raised, forearm bent, hand waving side to side. */
const wave: Clip = {
  name: 'Wave',
  duration: 2.2,
  tracks: {
    shoulderR: {
      rotation: [
        k(0, zero()),
        k(0.3, [0, 0, 150], 'out'),
        k(0.55, [14, 0, 152], 'inOut'),
        k(0.8, [-14, 0, 152], 'inOut'),
        k(1.05, [14, 0, 152], 'inOut'),
        k(1.3, [-14, 0, 152], 'inOut'),
        k(1.6, [0, 0, 150], 'inOut'),
        k(1.95, zero(), 'inOut'),
        k(2.2, zero()),
      ],
    },
    elbowR: {
      rotation: [k(0, zero()), k(0.3, d(-105), 'out'), k(1.6, d(-105), 'inOut'), k(1.95, zero(), 'inOut'), k(2.2, zero())],
    },
    shoulderL: { rotation: [k(0, zero()), k(0.3, [0, 0, -12], 'out'), k(1.6, [0, 0, -12], 'inOut'), k(2.2, zero(), 'inOut')] },
    head: {
      rotation: [k(0, zero()), k(0.3, [0, -10, 6], 'out'), k(0.8, [0, 10, 6], 'inOut'), k(1.3, [0, -10, 6], 'inOut'), k(1.6, [0, -6, 4], 'inOut'), k(2.2, zero(), 'inOut')],
    },
    torso: { rotation: [k(0, zero()), k(0.3, [0, -6, -4], 'out'), k(1.6, [0, -4, -3], 'inOut'), k(2.2, zero(), 'inOut')] },
    hips: { position: [k(0, zero()), k(0.4, [0, 0.02, 0], 'inOut'), k(0.9, zero(), 'inOut'), k(1.4, [0, 0.02, 0], 'inOut'), k(1.9, zero(), 'inOut'), k(2.2, zero())] },
  },
};

/** Crouch, launch, tuck, land. Position channel on hips is a height delta. */
const jump: Clip = {
  name: 'Jump',
  duration: 1.4,
  tracks: {
    hips: {
      position: [
        k(0, zero()), k(0.2, [0, -0.15, 0], 'in'), k(0.38, [0, 0.5, 0], 'out'),
        k(0.55, [0, 0.42, 0], 'inOut'), k(0.68, [0, -0.14, 0], 'in'),
        k(0.85, zero(), 'out'), k(1.4, zero()),
      ],
      rotation: [k(0, zero()), k(0.2, d(18), 'in'), k(0.38, d(-8), 'out'), k(0.6, d(-4), 'inOut'), k(0.72, d(16), 'in'), k(0.9, zero(), 'out'), k(1.4, zero())],
    },
    kneeL: {
      rotation: [k(0, zero()), k(0.2, d(55), 'in'), k(0.38, d(6), 'out'), k(0.6, d(14), 'inOut'), k(0.74, d(60), 'in'), k(0.92, d(8), 'out'), k(1.4, zero())],
    },
    kneeR: {
      rotation: [k(0, zero()), k(0.2, d(55), 'in'), k(0.38, d(6), 'out'), k(0.6, d(14), 'inOut'), k(0.74, d(60), 'in'), k(0.92, d(8), 'out'), k(1.4, zero())],
    },
    hipL: {
      rotation: [k(0, zero()), k(0.2, d(-20), 'in'), k(0.38, d(8), 'out'), k(0.6, d(4), 'inOut'), k(0.74, d(-24), 'in'), k(0.92, zero(), 'out'), k(1.4, zero())],
    },
    hipR: {
      rotation: [k(0, zero()), k(0.2, d(-20), 'in'), k(0.38, d(8), 'out'), k(0.6, d(4), 'inOut'), k(0.74, d(-24), 'in'), k(0.92, zero(), 'out'), k(1.4, zero())],
    },
    shoulderL: {
      rotation: [k(0, zero()), k(0.2, [0, 0, -30], 'in'), k(0.38, [0, 0, -165], 'out'), k(0.7, [0, 0, -150], 'inOut'), k(0.9, zero(), 'out'), k(1.4, zero())],
    },
    shoulderR: {
      rotation: [k(0, zero()), k(0.2, [0, 0, 30], 'in'), k(0.38, [0, 0, 165], 'out'), k(0.7, [0, 0, 150], 'inOut'), k(0.9, zero(), 'out'), k(1.4, zero())],
    },
    elbowL: { rotation: [k(0, d(-10)), k(0.2, d(-40), 'in'), k(0.38, d(-30), 'out'), k(0.9, d(-10), 'inOut'), k(1.4, d(-10))] },
    elbowR: { rotation: [k(0, d(-10)), k(0.2, d(-40), 'in'), k(0.38, d(-30), 'out'), k(0.9, d(-10), 'inOut'), k(1.4, d(-10))] },
    head: { rotation: [k(0, zero()), k(0.2, d(-10), 'in'), k(0.38, d(12), 'out'), k(0.9, zero(), 'inOut'), k(1.4, zero())] },
  },
};

/** Bouncy side-to-side dance with alternating arm raises. */
const dance: Clip = {
  name: 'Dance',
  duration: 2.0,
  tracks: {
    hips: {
      position: [
        k(0, zero()), k(0.25, [0.07, 0.03, 0], 'inOut'), k(0.5, [0, 0.06, -0.04], 'inOut'),
        k(0.75, [-0.07, 0.03, 0], 'inOut'), k(1.0, [0, 0.06, 0.04], 'inOut'),
        k(1.25, [0.07, 0.03, 0], 'inOut'), k(1.5, [0, 0.06, -0.04], 'inOut'),
        k(1.75, [-0.07, 0.03, 0], 'inOut'), k(2.0, zero(), 'inOut'),
      ],
      rotation: [k(0, [0, -10, 4]), k(0.5, [0, 10, -4], 'inOut'), k(1.0, [0, -10, 4], 'inOut'), k(1.5, [0, 10, -4], 'inOut'), k(2.0, [0, -10, 4], 'inOut')],
    },
    torso: {
      rotation: [k(0, [0, -14, 6]), k(0.5, [4, 14, -6], 'inOut'), k(1.0, [-4, -14, 6], 'inOut'), k(1.5, [4, 14, -6], 'inOut'), k(2.0, [0, -14, 6], 'inOut')],
    },
    head: {
      rotation: [k(0, [0, 12, -8]), k(0.5, [0, -12, 8], 'inOut'), k(1.0, [0, 12, -8], 'inOut'), k(1.5, [0, -12, 8], 'inOut'), k(2.0, [0, 12, -8], 'inOut')],
    },
    shoulderL: {
      rotation: [k(0, [0, 0, -20]), k(0.5, [0, 0, -150], 'out'), k(0.8, [0, 0, -120], 'inOut'), k(1.0, [0, 0, -20], 'inOut'), k(1.5, [0, 0, -140], 'out'), k(1.8, [0, 0, -110], 'inOut'), k(2.0, [0, 0, -20], 'inOut')],
    },
    shoulderR: {
      rotation: [k(0, [0, 0, 20]), k(0.5, [0, 0, 20], 'inOut'), k(1.0, [0, 0, 150], 'out'), k(1.3, [0, 0, 120], 'inOut'), k(1.5, [0, 0, 20], 'inOut'), k(2.0, [0, 0, 20], 'inOut')],
    },
    elbowL: { rotation: [k(0, d(-20)), k(0.5, d(-70), 'out'), k(0.8, d(-50), 'inOut'), k(1.0, d(-20), 'inOut'), k(1.5, d(-60), 'out'), k(1.8, d(-40), 'inOut'), k(2.0, d(-20), 'inOut')] },
    elbowR: { rotation: [k(0, d(-20)), k(1.0, d(-70), 'out'), k(1.3, d(-50), 'inOut'), k(1.5, d(-20), 'inOut'), k(2.0, d(-20))] },
    hipL: { rotation: [k(0, d(-10)), k(0.5, d(15), 'inOut'), k(1.0, d(-10), 'inOut'), k(1.5, d(15), 'inOut'), k(2.0, d(-10), 'inOut')] },
    hipR: { rotation: [k(0, d(15)), k(0.5, d(-10), 'inOut'), k(1.0, d(15), 'inOut'), k(1.5, d(-10), 'inOut'), k(2.0, d(15), 'inOut')] },
    kneeL: { rotation: [k(0, d(20)), k(0.5, d(35), 'inOut'), k(1.0, d(20), 'inOut'), k(1.5, d(35), 'inOut'), k(2.0, d(20), 'inOut')] },
    kneeR: { rotation: [k(0, d(35)), k(0.5, d(20), 'inOut'), k(1.0, d(35), 'inOut'), k(1.5, d(20), 'inOut'), k(2.0, d(35), 'inOut')] },
  },
};

export const CLIPS: Clip[] = [idle, walk, wave, jump, dance];
