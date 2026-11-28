# Lighting in goose-3d

Use when adding, changing or debugging lights, shadows, light sets, or the
per-fragment light loop — in `src/g3/render.goose`, `platform/g3_web.c`,
`platform/g3_soft.c`, or the facade's `collectLights`/`syncLights` in
`web/src/three/sync.ts`.

Read `docs/performance-light-culling.md` for the mask design and
`docs/performance-scene-sync.md` for the surrounding version-cache pattern.

## Architecture map

```text
facade collectLights (sync.ts)          engine (render.goose)
  scene walk → world poses        →     g_view_state.lights[8]  (extra lights)
  ≤8 punctual lights, key light    →     light_dir/color (primary directional)
  ambient/hemisphere/environment   →     ambient/env terms (not in the loop)
        │
        ▼
DrawItem.light_mask (per node, cached) → g3p_draw_frame
        │
        ├─ WebGL: u_light_mask uniform; fragment loop skips masked lights
        ├─ CPU:   per-pixel loop applies the same bitmask
        └─ WebGPU: field ignored, all lights evaluated (no speedup yet)
```

## The light model — `struct Light` (`platform.goose`)

Eight extra lights max (`g_view_state.light_count`, hard cap 8). Field
encoding is load-bearing; the GLSL (`platform/g3_web.c` ~line 700) and CPU
(`platform/g3_soft.c` `shade`) loops must agree exactly:

| Field | Meaning |
|---|---|
| `position.w` | type: `0` directional, `1` point, `2` spot |
| `direction.w` | range; `0` = no cutoff. `range_fade = max(1 - dist/range, 0)²` — exactly zero past range |
| `color.w` | spot only: `cos(outer half-angle)` |
| `inner` | spot only: `cos(inner half-angle)` (> `color.w`) |
| `attenuation` | `0` squared-linear range falloff, `1` inverse-square + range fade |

`direction.xyz` is the spot axis (normalized at creation). Directional
extras ignore position. The **primary** directional light is separate
(`light_dir`/`light_color`) and always applies — the mask never gates it,
nor ambient/hemisphere/environment terms.

## API surface

Engine (`src/g3/render.goose`, exported via `src/g3/asset_web.goose`):

- `add_directional_light`, `add_point_light[_mode|_physical]`,
  `add_spot_light[_mode|_physical]` — all return `false` past 8 lights or on
  bad args; `_physical` = inverse-square attenuation.
- `clear_lights` — empties the extra list **and** all shadow slots.
- Shadows: `set_point_light_shadows(index, bias)` and
  `set_spot_light_shadows(index, bias)` each support **two slots per type** —
  a new light index takes a free slot, the same index refreshes in place,
  a third distinct index returns `false`. Point slots own six cube-face
  matrices (`point_shadow_view_proj[s*6+face]`); spot slots one perspective
  matrix; outer angle must be ≤ hemisphere. `set_directional_shadows`/
  `clear_shadows` for the key light, `set_shadow_filter_radius`
  (0/1/2 → hard/3×3/5×5 PCF), `set_shadow_resolution`. Shadow index refers
  to position in the extra-light list — re-adding lights requires
  re-calling.
- Light sets: `asset_light_set_begin/active/clear/release` — glTF scenes
  each own a saved set; `release` restores the parent's lights **directly
  into `g_view_state.lights`**.

Facade: `collectLights`/`syncLights` in `web/src/three/sync.ts` walk the
scene every frame (world poses via `worldMatrixOf`), cap at `MAX_EXTRA_LIGHTS`,
route the first shadowed `DirectionalLight` to the key-light ortho path, and
call the `_g3_asset_light_*` exports — including `_g3_asset_light_point_shadow`/
`_g3_asset_light_spot_shadow` for `castShadow` punctual lights (engine slots
are per-frame since `lights_clear` resets them). `RectAreaLight` is a stub.

## The light mask — per-object light culling

`node_light_mask` (`render.goose`) produces `DrawItem.light_mask`: bit *i* set
means extra light *i* may contribute to the node's drawn mesh. Conservative
rules — a cleared bit must be a *proof* of zero shader contribution:

- Directional extras: always set.
- Point/spot: culled when `distance(light, box_centre) - box_radius > range`
  (bounding sphere ⇒ lower bound on true distance; safe direction).
- Spot cone: culled when the best-case `dot(axis, light→surface)` over the
  box — `cos(θ-α)` with `α = asin(radius/dc)` — fails `cos(outer)`. When
  `θ < α` the true best dot is `1.0`, not `cos(θ-α)`; that case is
  special-cased (the "spot light illuminates its cone" test caught it).
- `range == 0` → no range test (matches shader's `direction.w > 0.0` guard).

Cached on `Node` as `cached_light_mask` + keys `world_version`,
`g_lights_version`, mesh id, `bounds_version`. **Any new code path that
writes `g_view_state.lights` or `light_count` MUST bump `g_lights_version`**
— including saved-set restores (`asset_light_set_release` already does).
Missing a bump = stale masks = lights that stop affecting moved objects.

## Backends

- `platform/g3_abi.h`: `g3_draw_item` is 793 bytes; `light_mask` at offset
  789. Static asserts pin every offset — update them when extending.
- WebGL: `u_light_mask` uniform uploads **per draw item**, outside the
  `scene_compatible` material block. `light_mask` is part of
  `scene_compatible` because compatible items draw **instanced** sharing
  uniforms — any new per-item shader input must join that check or
  instances inherit the first item's value.
- CPU (`g3_soft.c`): same bitmask skip inside `shade`'s light loop.
- Custom shaders (`material_shader_create`/raw shaders) share the fragment
  prelude, so `u_light_mask` exists for them; `glGetUniformLocation` returns
  -1 on programs that optimize it out and `glUniform1i(-1,…)` is a no-op.
- Texture units 0–6 are reserved: env(0), key shadow(1), point shadow
  slots(2–3), spot shadow slots(4–5), BRDF LUT(6); material maps and raw
  shader samplers allocate from unit 7. Disabled shadow slots still occupy
  their unit binding (texture 0) but are never sampled.

## Pitfalls

- **Falloff must match the shader exactly.** The mask may only skip a light
  whose contribution is provably zero; `range_fade` and the cone smoothstep
  boundaries are the contract. If you change attenuation math in either
  loop, re-derive the cull bound.
- **Mask is per object, not per fragment.** Big objects keep lights for all
  fragments; per-tile/clustered culling is future work.
- **Shadow indices are list positions into slots.** `set_*_light_shadows`
  stores a `lights[]` index per slot; inserting/removing lights invalidates
  the mapping — the facade rebuilds the whole light set (and shadow calls)
  every frame for this reason. Two slots per type: a third distinct index
  fails rather than evicting.
- **`clear_lights` also clears shadow slots** — code that wants shadows
  after clearing must re-set them.

## Verify

- `CC=/usr/bin/cc ./build_native.sh --test` — byte-identical PPMs catch a
  wrongly culled light immediately.
- `goose check src/gs3d_web.goose` after Goose edits (entry file, not
  `render.goose` directly).
- `./build_web.sh --gs3d` rebuilds `web/gs3d/app.{js,wasm}` (gitignored);
  new exports must be added to `asset_exports` in `build_web.sh`.
- `node web/test_browser_reference.mjs` exercises real GLSL; the
  `point shadow changes rendered pixels` failure is pre-existing
  (SwiftShader), not a lighting regression signal.
