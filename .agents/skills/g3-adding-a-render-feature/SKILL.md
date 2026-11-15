---
name: g3-adding-a-render-feature
description: Use when adding a rendering capability to goose-3d — textures, instancing, shadows, more lights, clipping — the ordered checklist through arena, draw item, shaders and both backends, with the traps at each step.
---

# Adding a rendering feature

The engine is a pipeline with fixed stations. A feature touches them in order,
and skipping a station is how you get a scene that renders on one backend and
not the other. Follow the checklist for the feature you want.

```text
mesh arena → Node/material → cull + pack (render.goose) → DrawItem → ABI →
    backend state + shader → pixels → tests
```

The rule that keeps this simple: the engine computes, the backend presents.
If you find yourself wanting a GL call in Goose, the value belongs in a
`DrawItem`/`ViewState` field instead.

## Recipe: a texture on a material

1. Vertex. `Vertex` currently stores position, normal, six UV sets,
   tangent and colour (104 bytes). Add per-vertex data to both
   `src/g3/platform.goose` and `platform/g3_abi.h`, update the size/offset
   asserts, every constructor in `src/g3/mesh.goose`, and both backends' vertex
   layouts. Built-in geometry uses white vertex colour and zero for unused UV
   sets; preserve those defaults.
2. Texture storage. Two options, pick one deliberately:
   * Engine-side arena: `var g_texels: u8[>..]` plus a `Texture { id, width,
     height, first, count }` record arena, mirroring `mesh.goose`. Uploaded once
     through a new `extern fn g3p_upload_texture(id, texels, w, h)`.
   * Backend-side handles: the app loads the image and registers it directly.
     Cheaper, but the CPU backend then needs a decoder, so the arena approach is
     usually the right one.
3. DrawItem. Add `texture: i32` (and `uv_scale: float2` if you want tiling).
   Follow the checklist in skill `g3-abi-and-backends` — including the
   `offsetof` assert and the README byte count.
4. Shader. `g3_web.c`: add `layout(location = 2) in vec2 a_uv`, `out vec2
   v_uv`, a `uniform sampler2D u_tex`, and multiply the sampled colour into
   `u_color.rgb`. Keep the rest term for term. `g3_soft.c`: bilinear sample in
   `shade()` with the same wrap/clamp choice; this is the reference, so it must
   be the definition of correct.
5. Tests. `test_math` is untouched; `test_engine` gains a case with a
   known 2×2 texture (e.g. 4 distinct colours): a plane facing the camera, then
   `read_pixel` at the centre of each quadrant and assert the exact colours.
   That is the only way to prove the sampler agrees across backends.
6. Blending. A texture with alpha interacts with the blended pass: alpha
   used to come from `DrawItem.color.w`. Decide whether the item is in the
   blended band by `color.w < 1` still, and say so in a comment — the sort lives
   in `sort_key()`.

## Recipe: instancing (many copies, one draw call)

The current model is one `DrawItem` per node, which is why `Stats.draws` equals
`Stats.drawn`.

1. DrawItem. Replace the single `model`/`mvp` with either
   * a `first_instance`/`count` pair indexing a new per-frame instance buffer on
     the seam (`extern fn g3p_set_instances(instances)`), or
   * keep `DrawItem` as is and let the backend merge consecutive items with the
     same mesh (a backend-side decision, no ABI change).
2. Renderer. `render.goose`: after sorting by mesh id, coalesce runs into
   one item with a count. The sort already groups by mesh — this is the payoff
   that order was designed for.
3. Backends. `g3_web.c`: `glDrawElementsInstanced` + a per-instance
   `mat4` attribute (divisor 1). `g3_soft.c`: loop the instance list inside the
   item loop, keeping draw-list order so blending stays correct.
4. Stats. `draws` should now be smaller than `drawn` — update the HUD
   wording in `web/hud.js` and any test that asserts counts.

## Recipe: shadows (one directional light, one shadow map)

Half a day of work, in this order — do not start with the shader.

1. ViewState. Add `light_view_proj: Mat4` and `shadow_texel: f32`, computed
   by the engine from the light direction and the scene bounds (`render.goose`:
   a second pass over `g_nodes` to fit an orthographic box around visible
   geometry).
2. Engine pass. `render_scene()` gains a depth-only pre-pass: it must
   reuse the same cull and pack code with a different projection. Factor
   `pack_item()` so the depth pass can call it with `light_view_proj`.
3. Backends. `g3_web.c`: an FBO with a depth texture, a second program that
   writes only `gl_Position`. `g3_soft.c`: a separate `float *shadow` buffer and
   a rasterizer call that writes depth only — `setup_triangle` already computes
   everything a depth pass needs.
4. Shading. Both shaders sample the shadow map with the same bias constant
   and the same PCF radius, or the two backends diverge on every surface.
5. Tests. A cube above a plane: assert the pixel directly under the cube is
   darker than a neighbouring pixel outside the shadow, in `test_engine`. Assert
   both backends (the CPU one runs in tests; the GPU one is checked by the
   identical stats + a manual browser look).

## Recipe: more lights

`ViewState` currently carries one directional light. For N lights:

1. Fixed-size arrays only (no heap): `lights: Light[8]`, `light_count: i32`,
   in `ViewState` — the ABI is packed, so this changes its size; update the
   asserts and README.
2. `render.goose`: `add_light(...)` appending to the frame's array; keep
   `set_light()` as sugar for `clear_lights()` + one `add_light()` so the demo
   and tests keep working.
3. Both shaders: `for (int i = 0; i < u_light_count; i++)`, identical loop and
   identical accumulation order (float addition is not associative — a different
   order is a different pixel).
4. Test: two coloured lights on one plane, at known angles, with the ambient
   term off, and hand-computed expected channel values.

## Recipe: near-plane clipping (a known gap)

Both backends drop a triangle with a vertex behind the eye instead of clipping
it, so a large object straddling the near plane pops. To fix it properly:

1. `src/g3/render.goose`: clip the triangle in world or clip space against
   `w > epsilon`, producing 0, 1 or 2 triangles, before packing. This keeps both
   backends honest and is the only place to do it once.
2. Alternative (backend-side, do both or neither): clip in `g3_web.c`'s geometry
   stage — expensive — and in `g3_soft.c`'s `setup_triangle`.
3. Test: a quad whose one corner is behind the eye; assert the visible part is
   drawn to the screen edge rather than missing.

## Checklist that applies to all of them

- [ ] Field added to `platform.goose` and `platform/g3_abi.h`, asserts and
    README sizes updated together.
- [ ] `pack_item()` (or a new builder next to it) is the only place the new data
    is filled in.
- [ ] Both backends implement it; `shade()` and the GLSL stay term for term.
- [ ] Sorting still puts blended items last and far-to-near.
- [ ] A hand-derived check exists in `test_math` (if it is arithmetic) or
    `test_engine` (if it is pixels), with the derivation in the comment.
- [ ] `goose check` on all four roots: zero warnings.
- [ ] `./build_native.sh --test` passes; any neutral change still renders
    byte-identical PPMs (same `--frames` and same size).
- [ ] Browser build boots and reports the same scene stats as before the change
    (or the new, intended ones).
- [ ] `README.md` "Limits" section updated: a feature that is no longer missing
    should stop being listed.
