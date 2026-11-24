# Typescript + Rsbuild sample for "gs3d" package — water

Rigid-body buoyancy and drag on a `gs3d/three` scene via `gs3d/physics`.
A static pool floor sits under a water plane driven by `world.setWaterLevel`;
spawned bodies float or sink by density (`mass / collider volume`). The
water sandbox lives in `src/water.ts`, spawn-kind constants in
`src/kinds.ts`, the page in `src/index.ts`.

## Commands

- `bun install` - Install dependencies (gs3d is a `file:../../web` dep)
- `bun run dev` - Start the dev server
- `bun run check` - Typecheck
- `bun run test` - Node test for the spawn-kind constants (`test-water.ts`)
- `bun run lint` / `bun run build`
