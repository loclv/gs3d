import assert from 'node:assert/strict';
import { applyEase, sampleChannel, sampleClip, type Clip, type Keyframe } from './src/animation.ts';
import { CLIPS } from './src/clips.ts';

// Easing endpoints and midpoint sanity.
assert.equal(applyEase('linear', 0.5), 0.5);
assert.equal(applyEase('in', 0), 0);
assert.equal(applyEase('out', 1), 1);
assert.ok(applyEase('inOut', 0.5) > 0.4 && applyEase('inOut', 0.5) < 0.6);
assert.ok(applyEase('bounce', 1) > 0.98);

const keys: Keyframe[] = [
  { t: 0, value: [0, 0, 0] },
  { t: 1, value: [10, 20, 30], ease: 'linear' },
  { t: 2, value: [20, 0, 10] },
];

// Before first / after last keyframe holds.
assert.deepEqual(sampleChannel(keys, -1), [0, 0, 0]);
assert.deepEqual(sampleChannel(keys, 5), [20, 0, 10]);
// Mid-segment linear interpolation.
assert.deepEqual(sampleChannel(keys, 0.5), [5, 10, 15]);
// Missing channel.
assert.equal(sampleChannel(undefined, 0.5), undefined);

// Rotation sampling takes the shortest arc: 350 -> 10 crosses 0, not 340.
const wrapKeys: Keyframe[] = [
  { t: 0, value: [350, 0, 0] },
  { t: 1, value: [10, 0, 0], ease: 'linear' },
];
const mid = sampleChannel(wrapKeys, 0.5, true)!;
assert.ok(Math.abs(mid[0]) < 1, `expected ~0, got ${mid[0]}`);

// Clip sampling: loop wraps, non-loop clamps.
const clip: Clip = {
  name: 'Test',
  duration: 2,
  tracks: {
    joint: {
      position: [
        { t: 0, value: [0, 0, 0] },
        { t: 1, value: [10, 0, 0], ease: 'linear' },
        { t: 2, value: [20, 0, 0] },
      ],
    },
  },
};
assert.deepEqual(sampleClip(clip, 3).joint.position, [10, 0, 0]); // 3 % 2 = 1
assert.deepEqual(sampleClip(clip, -1).joint.position, [10, 0, 0]); // -1 wraps to t=1
assert.deepEqual(sampleClip(clip, 5, false).joint.position, [20, 0, 0]);
assert.deepEqual(sampleClip(clip, 0.5).joint.position, [5, 0, 0]);

// Every shipped clip must be loop-safe: pose at t=0 equals pose at t=duration.
for (const c of CLIPS) {
  const a = sampleClip(c, 0, false);
  const b = sampleClip(c, c.duration, false);
  for (const joint of Object.keys(c.tracks)) {
    for (const channel of ['position', 'rotation', 'scale'] as const) {
      const va = a[joint]?.[channel];
      const vb = b[joint]?.[channel];
      if (!va || !vb) continue;
      for (let i = 0; i < 3; i++) {
        const wrap = channel === 'rotation';
        let d = vb[i] - va[i];
        if (wrap) d -= 360 * Math.round(d / 360);
        assert.ok(Math.abs(d) < 1e-6, `${c.name}/${joint}/${channel}[${i}] seam: ${va[i]} vs ${vb[i]}`);
      }
    }
  }
}

console.log(`animation checks passed (${CLIPS.length} clips)`);
