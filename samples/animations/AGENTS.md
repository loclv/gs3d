# Typescript + Rsbuild sample for "gs3d" package — animation

Procedural keyframe clips on a `gs3d/three` `Object3D` rig. No mixer/skeleton
in the facade; clips live in `src/clips.ts`, sampling in `src/animation.ts`.

## Commands

- `bun install` - Install dependencies (gs3d is a `file:../../web` dep)
- `bun run dev` - Start the dev server
- `bun run check` - Typecheck
- `bun run test` - Node test for the clip sampler (`test-animation.ts`)
- `bun run lint` / `bun run build`
