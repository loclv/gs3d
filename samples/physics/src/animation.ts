export type Vec3 = [number, number, number];

export type EaseName = 'linear' | 'in' | 'out' | 'inOut' | 'bounce';

export interface Keyframe {
  /** Time in seconds from the start of the clip. */
  t: number;
  /** Euler rotation values are degrees; position is a delta; scale is absolute. */
  value: Vec3;
  /** Easing applied to the segment that starts at this keyframe. */
  ease?: EaseName;
}

export interface Track {
  position?: Keyframe[];
  rotation?: Keyframe[];
  scale?: Keyframe[];
}

export interface Clip {
  name: string;
  /** Loop duration in seconds. */
  duration: number;
  /** Joint name -> animated channels. Joints absent here return to rest pose. */
  tracks: Record<string, Track>;
}

export interface PoseChannel {
  position?: Vec3;
  rotation?: Vec3;
  scale?: Vec3;
}

export type ClipPose = Record<string, PoseChannel>;

const BONCE = 2.75;

export function applyEase(name: EaseName, t: number): number {
  let x = Math.max(0, Math.min(1, t));
  switch (name) {
    case 'in': return x * x;
    case 'out': return 1 - (1 - x) * (1 - x);
    case 'inOut': return x * x * (3 - 2 * x);
    case 'bounce': {
      const n = 7.5625;
      const d = BONCE;
      if (x < 1 / d) return n * x * x;
      if (x < 2 / d) return n * (x -= 1.5 / d) * x + 0.75;
      if (x < 2.5 / d) return n * (x -= 2.25 / d) * x + 0.9375;
      return n * (x -= 2.625 / d) * x + 0.984375;
    }
    default: return x;
  }
}

function lerpVec(a: Vec3, b: Vec3, t: number, wrap: boolean): Vec3 {
  const out: Vec3 = [0, 0, 0];
  for (let i = 0; i < 3; i++) {
    let d = b[i] - a[i];
    if (wrap) d -= 360 * Math.round(d / 360);
    const v = a[i] + d * t;
    out[i] = wrap ? ((v + 180) % 360 + 360) % 360 - 180 : v;
  }
  return out;
}

/** Sample one channel. `wrap` treats values as degrees and takes the shortest arc. */
export function sampleChannel(keys: Keyframe[] | undefined, time: number, wrap = false): Vec3 | undefined {
  if (!keys || !keys.length) return undefined;
  if (time <= keys[0].t) return [...keys[0].value] as Vec3;
  const last = keys[keys.length - 1];
  if (time >= last.t) return [...last.value] as Vec3;
  for (let i = 0; i < keys.length - 1; i++) {
    const a = keys[i];
    const b = keys[i + 1];
    if (time < b.t) {
      const span = b.t - a.t || 1e-6;
      const t = applyEase(a.ease ?? 'linear', (time - a.t) / span);
      return lerpVec(a.value, b.value, t, wrap);
    }
  }
  return [...last.value] as Vec3;
}

/**
 * Sample a clip at `time` seconds. With `loop` (default) time wraps into
 * [0, duration); otherwise it clamps and holds the final pose.
 */
export function sampleClip(clip: Clip, time: number, loop = true): ClipPose {
  let t = time;
  if (loop) {
    const d = clip.duration || 1;
    t = ((t % d) + d) % d;
  } else {
    t = Math.max(0, Math.min(clip.duration, t));
  }
  const pose: ClipPose = {};
  for (const [joint, track] of Object.entries(clip.tracks)) {
    const channel: PoseChannel = {};
    const position = sampleChannel(track.position, t);
    if (position) channel.position = position;
    const rotation = sampleChannel(track.rotation, t, true);
    if (rotation) channel.rotation = rotation;
    const scale = sampleChannel(track.scale, t);
    if (scale) channel.scale = scale;
    pose[joint] = channel;
  }
  return pose;
}
