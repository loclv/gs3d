# Goose 3D Water Lab

A small TypeScript sample for the `gs3d` package showing rigid-body water
physics on the `gs3d/three` facade. A `gs3d/physics` `PhysicsWorld` simulates
a pool: a static floor slab below a water plane, and bodies that get
**buoyancy** and **hydrodynamic drag** while submerged.

## How the water model works

There is no fluid simulation — each dynamic body below the water level
(`world.setWaterLevel(y)`, a height on world Y) receives:

- **Buoyancy** — the weight of displaced water as an acceleration,
  `-gravity × (ρ_water / ρ_body) × submerged_fraction`, applied at the
  center of mass. ρ_water = 1000. Spheres use the exact submerged-cap
  volume fraction; boxes and capsules use a linear approximation across
  their world-Y extent.
- **Drag** — linear damping on linear and angular velocity, scaled by the
  submerged fraction.

Effective body density is `mass / collider volume`, so realistic floating
needs `mass ≈ volume × desired density`. The sandbox ([`src/water.ts`](src/water.ts))
does this for you: floaters spawn at density 350 (they bob at the surface),
the stone at 2600 (it sinks). Densities and volumes live in
[`src/kinds.ts`](src/kinds.ts).

## Run it

Use Bun and Node.js 24 or newer. From this directory:

```sh
bun install
bun run dev
```

Open the local URL printed by Rsbuild. Spawn float balls/boxes/capsules or a
stone, drag the **Water level** slider to raise or lower the surface (the
translucent plane follows), or click the pool to drop a ball via
`world.raycast`. `bun run check` typechecks, `bun run test` runs the
Node-side constant checks, `bun run lint` / `bun run build` verify the rest.

## Files

- `src/kinds.ts` — spawn kinds, collider volumes and densities (no gs3d imports).
- `src/ripples.ts` — procedural tileable ripple normal map (summed sines → finite-difference normals), scrolled each frame.
- `src/water.ts` — `createWaterSandbox`: pool floor, deferred body creation, per-frame transform write-back, `setWaterLevel`.
- `src/index.ts` — UI, scene, water plane visual, click-to-drop.

## The look

The surface is a `MeshStandardMaterial` with `roughness 0.08`, a scrolling
procedural `normalMap` (`src/ripples.ts`, seamless under `RepeatWrapping`)
and `envMapIntensity 1.4`; the scene gets image-based lighting from
`PMREMGenerator.fromScene(new RoomEnvironment())` at `environmentIntensity
0.55`, so the key light and the env map both produce specular glints that
travel across the ripples.
