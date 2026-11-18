# Goose 3D Animation Lab

A small TypeScript-first animation sample for the `gs3d` package. It builds a
little robot from primitives, rigs it with named joint groups, and plays
keyframe clips through the Three.js-compatible `gs3d/three` facade. There is
no `AnimationMixer` or skeleton in the facade — clips are plain typed data in
[`src/clips.ts`](src/clips.ts), sampled each frame by
[`src/animation.ts`](src/animation.ts) and applied to `Object3D` transforms.

## Run it

Use Bun and Node.js 24 or newer. From this directory:

```sh
bun install
bun run dev
```

Open the local URL printed by Rsbuild. Pick a clip (Idle, Walk, Wave, Jump,
Dance), drag the timeline to scrub, change playback speed, or toggle loop.
The joint probe shows the live euler/position values of any joint. Orbit with
drag, zoom with scroll; pan with shift-drag.

```sh
bun run check
bun run test
bun run lint
bun run build
```

## Authoring a clip

[`src/clips.ts`](src/clips.ts) exports `CLIPS`, an array of `Clip` objects:

```ts
{
  name: 'Wave',
  duration: 2.2,
  tracks: {
    shoulderR: {
      rotation: [
        { t: 0, value: [0, 0, 0] },
        { t: 0.3, value: [0, 0, 150], ease: 'out' },
        { t: 2.2, value: [0, 0, 0], ease: 'inOut' },
      ],
    },
  },
}
```

- `rotation` values are euler degrees `[x, y, z]`; positive X swings a limb
  backward. Rotation interpolation always takes the shortest arc.
- `position` values are **deltas** added to the joint's rest offset, so
  `hips.position` `[0, 0.5, 0]` lifts the body half a unit.
- `scale` values are absolute.
- `ease` on a keyframe shapes the segment that starts there: `linear`, `in`,
  `out`, `inOut`, or `bounce`.
- Keep the first and last keyframe of every channel identical (or the clip
  will pop when it loops). `bun run test` checks this for every shipped clip.

Joint names come from [`src/character.ts`](src/character.ts): `root`, `hips`,
`torso`, `head`, `shoulderL/R`, `elbowL/R`, `hipL/R`, `kneeL/R`. To rig
something new, build `Group` pivots at each joint location, parent meshes
under them, and register the group in `joints`/`bases`.
