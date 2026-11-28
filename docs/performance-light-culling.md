# Per-object light culling

How the renderer avoids evaluating every light for every fragment. Before
this change the fragment shader looped all eight extra lights
(`u_lights[8]`) for every fragment of every lit draw — full BRDF, cone and
shadow work per light — regardless of whether the light could geometrically
reach the surface. Now each `DrawItem` carries a conservative bitmask of the
lights that can contribute, computed once per node per state-change and
cached.

## The mask

`node_light_mask` (`src/g3/render.goose`) runs per drawn node inside
`render_scene` and returns an `i32` where bit *i* means extra light *i* may
contribute to some fragment of the drawn mesh. The rules mirror the shader's
own falloff so a cleared bit is a proof of zero contribution:

- **Directional extras** (`position.w < 0.5`) affect everything → always set.
- **Point lights** (`position.w ≈ 1`) and **spots** (`position.w ≈ 2`) are
  bounded by `direction.w` = range: the shader computes
  `range_fade = max(1 - dist/range, 0)` squared, which is exactly zero at and
  beyond `range`. The test uses the world AABB's bounding sphere:
  `distance(light, centre) - radius > range` culls. The sphere is larger than
  the box, so `dc - radius` is a *lower* bound on the true closest distance —
  the test can keep a light that cannot actually reach (harmless) but never
  drops one that can.
- **Spot cones** add a second test: the box subtends at most
  `asin(radius/dc)` around the centre direction, so the best-case
  `dot(light→surface, spot_axis)` over the box is `cos(θ - α)` where `θ` is
  the centre angle and `α` the subtense. The light is culled only when even
  that best case fails the outer-cone cosine (`color.w`).
- `range == 0` means no cutoff (physical inverse-square lights) → the range
  test is skipped entirely, matching the shader's `direction.w > 0.0` guard.
- Empty bounds keep all lights — the item draws nothing anyway.

The subtle case: when `θ < α` — the light is close enough that the box's
direction cone contains the spot axis — some surface faces the light dead-on
and the true best dot is `1.0`, *not* `cos(θ - α)` (which underestimates and
would wrongly cull). The code special-cases `sin θ <= sin α && cos θ >= 0` to
return `max_dot = 1.0`. The engine test "spot light illuminates its cone"
caught exactly this.

## Caching

The mask is stored on `Node` (`cached_light_mask` plus four key fields) and
recomputed only when one of these changes:

| Key | Invalidated by |
|---|---|
| `world_version` | any transform change on the node or an ancestor |
| `g_lights_version` | every mutation of `g_view_state.lights` |
| `mesh id` | LOD swap or node re-meshing |
| `bounds_version` | mesh deformation |

`g_lights_version` (`render.goose`) is bumped by `add_directional_light`,
`add_point_light_mode` (covers point and spot variants), `clear_lights`, and
`asset_light_set_release` — the saved-light-set restore path writes
`g_view_state.lights` directly and must not be forgotten. When
`light_count == 0` the function returns 0 without touching the cache.

A static scene with static lights therefore pays zero mask work after the
first frame; a moving object pays 8 cheap sphere/cone tests once per frame.

## Plumbing

`DrawItem` gained a trailing `light_mask: i32` field (ABI size 789 → 793,
`platform/g3_abi.h` asserts updated). Backends:

- **WebGL** (`platform/g3_web.c`): `uniform int u_light_mask` declared in the
  shared fragment prelude; the light loop does
  `if ((u_light_mask & (1 << i)) == 0) continue;`. The uniform uploads in
  `draw_item` on *every* draw — deliberately outside the
  `scene_compatible` material-change block, because the mask varies per item
  independently of material state.
- **Instanced batching trap**: `scene_compatible` groups items into one
  instanced draw call sharing all uniforms. `light_mask` had to be added to
  the compatibility check — otherwise every instance in a batch would be
  shaded with the first item's mask. This is the general rule for any future
  per-item shader input.
- **CPU** (`platform/g3_soft.c`): the per-pixel light loop applies the same
  bitmask skip.
- **WebGPU** (`web/webgpu.js`): ignores the field; all lights are evaluated
  as before. No regression, just no speedup yet.

## What this does not do

- The primary directional light, ambient, hemisphere and environment terms
  are unaffected — they are not part of `u_lights[8]`.
- The mask is per *object*, not per fragment: a large object overlapping a
  small light's range keeps the light for all its fragments. Per-fragment or
  per-tile culling would need a different mechanism (e.g. a clustered light
  grid in a storage buffer).
- Shadow-map *rendering* cost is unchanged; only the per-fragment shadow
  lookup is skipped for culled lights.

## Measuring

- `CC=/usr/bin/cc ./build_native.sh --test` — the byte-identical PPM check
  across worker counts is the regression net: a wrongly culled light changes
  pixels.
- `node web/test_browser_reference.mjs` — exercises the real GLSL path.
- `web/benchmark/animation.html` — frame timings for scenes with several
  lights; the win scales with `light_count × overdraw`.
