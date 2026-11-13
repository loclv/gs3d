# The engine/backend ABI

The contract between the Goose engine (`src/g3/platform.goose`) and a C backend
(`platform/g3_abi.h`). One call per frame; everything is packed, flat and
fixed-size.

Read this before changing `DrawItem`, `ViewState`, `Vertex` or the extern list.
The procedural checklist lives in
`.agents/skills/g3-abi-and-backends/SKILL.md`.

## Why it looks like this

* Goose structs are **packed with no padding**, so `Mat4` is 64 bytes and a
  `float3` is 12 — the same bytes the backend reads are the bytes the engine
  wrote, with no marshalling.
* `Mat4` is **column-major**, `m[col * 4 + row]`, which is GL's layout for
  `glUniformMatrix4fv` with `transpose = GL_FALSE`. The CPU backend indexes it
  the same way (`m[0]*x + m[4]*y + m[8]*z + m[12]`).
* Slices cross as `{ const T *data; int64_t len; }`. Goose `bool` crosses as
  `uint8_t`.
* Nothing variable-size, nothing nested, nothing by value that is not flat.
* `platform/g3_abi.h` static-asserts the sizes and the interesting offsets. A
  layout drift is a compile error, not a garbled image.

## Types

### `g3_vertex` — 120 bytes

| offset | type | field | meaning |
|---|---|---|---|
| 0 | `float[3]` | `pos` | local-space position |
| 12 | `float[3]` | `normal` | local-space normal, transformed by the inverse-transpose model matrix and re-normalized |
| 24 | `float[2]` | `uv` | texture coordinates, first image row at v = 0 |
| 32 | `float[2]` | `uv1` | second texture coordinate set; zero when absent |
| 40 | `float[2]` | `uv2` | third texture coordinate set; zero when absent |
| 48 | `float[2]` | `uv3` | fourth texture coordinate set; zero when absent |
| 56 | `float[2]` | `uv4` | fifth texture coordinate set; zero when absent |
| 64 | `float[2]` | `uv5` | sixth texture coordinate set; zero when absent |
| 72 | `float[2]` | `uv6` | seventh texture coordinate set; zero when absent |
| 80 | `float[2]` | `uv7` | eighth texture coordinate set; zero when absent |
| 88 | `float[4]` | `tangent` | local tangent direction and handedness; a zero direction selects the derived frame |
| 104 | `float[4]` | `color` | linear vertex colour multiplied by the material base colour; built-ins and assets use white when absent |

### `g3_mat4` — 64 bytes

`float m[16]`, column-major: element `(row r, column c)` is `m[c*4 + r]`.

### `g3_uv_transform` — 24 bytes

`offset: float2`, `scale: float2`, `rotation: float` in radians, and the
selected `texcoord` set (0 through 7). The renderer scales the selected UV, rotates
it, then adds the offset.

### `g3_draw_item` — 605 bytes

| offset | type | field | meaning |
|---|---|---|---|
| 0 | `int32_t` | `mesh` | backend mesh id from `g3p_upload_mesh` |
| 4 | `g3_mat4` | `mvp` | `view_proj * model`, pre-multiplied by the engine |
| 68 | `g3_mat4` | `model` | model matrix: world-space normals, fog distance, eye-relative work |
| 132 | `g3_vec4` | `color` | RGB multiplier and alpha factor |
| 148 | `g3_vec4` | `params` | x unlit, y specular strength, z shininess, w blended (1.0) |
| 164 | `float` | `key` | the engine's sort key; **draw in list order** |
| 168 | `int32_t` | `texture` | texture id, or -1 for no texture |
| 172 | `int32_t` | `alpha_mode` | 0 opaque, 1 mask, 2 blend |
| 176 | `float` | `alpha_cutoff` | alpha threshold for mask mode |
| 180 | `g3_vec4` | `pbr` | x enables metallic-roughness shading, y metallic, z roughness, w index of refraction |
| 196 | `int32_t` | `metallic_roughness_texture` | linear data texture: G roughness, B metallic; -1 disables |
| 200 | `int32_t` | `normal_texture` | linear tangent-space normal texture; -1 disables |
| 204 | `float` | `normal_scale` | glTF normal scale applied to tangent-space X/Y |
| 208 | `int32_t` | `occlusion_texture` | linear data texture: R ambient occlusion; -1 disables |
| 212 | `float` | `occlusion_strength` | glTF strength blended between full and sampled occlusion |
| 216 | `g3_vec4` | `emissive` | linear RGB emission factor |
| 232 | `int32_t` | `emissive_texture` | sRGB emission texture id, or -1 for no texture |
| 236 | `uint8_t` | `double_sided` | draw both winding directions and flip back-face normals |
| 237 | `g3_uv_transform` | `base_color_uv` | base-colour UV offset, scale, rotation and set |
| 261 | `g3_uv_transform` | `metallic_roughness_uv` | metallic-roughness UV offset, scale, rotation and set |
| 285 | `g3_uv_transform` | `normal_uv` | normal-map UV offset, scale, rotation and set |
| 309 | `g3_uv_transform` | `occlusion_uv` | occlusion UV offset, scale, rotation and set |
| 333 | `g3_uv_transform` | `emissive_uv` | emissive UV offset, scale, rotation and set |
| 357 | `g3_vec4` | `specular` | RGB dielectric specular colour factor, w dielectric specular strength factor |
| 373 | `int32_t` | `specular_texture` | linear data texture: alpha scales dielectric specular strength; -1 disables |
| 377 | `int32_t` | `specular_color_texture` | sRGB texture: RGB scales dielectric specular colour; -1 disables |
| 381 | `g3_uv_transform` | `specular_uv` | specular-strength UV offset, scale, rotation and set |
| 405 | `g3_uv_transform` | `specular_color_uv` | specular-colour UV offset, scale, rotation and set |
| 429 | `g3_vec4` | `clearcoat` | x clearcoat factor, y clearcoat roughness |
| 445 | `int32_t` | `clearcoat_texture` | linear R clearcoat strength map; -1 disables |
| 449 | `int32_t` | `clearcoat_roughness_texture` | linear G clearcoat roughness map; -1 disables |
| 453 | `int32_t` | `clearcoat_normal_texture` | tangent-space clearcoat normal map; -1 disables |
| 457 | `float` | `clearcoat_normal_scale` | scale applied to tangent-space X/Y |
| 461 | `g3_uv_transform` | `clearcoat_uv` | clearcoat strength-map transform |
| 485 | `g3_uv_transform` | `clearcoat_roughness_uv` | clearcoat roughness-map transform |
| 509 | `g3_uv_transform` | `clearcoat_normal_uv` | clearcoat normal-map transform |
| 533 | `g3_vec4` | `sheen` | RGB colour factor, w roughness |
| 549 | `int32_t` | `sheen_color_texture` | sRGB RGB sheen colour map; -1 disables |
| 553 | `int32_t` | `sheen_roughness_texture` | linear alpha sheen roughness map; -1 disables |
| 557 | `g3_uv_transform` | `sheen_color_uv` | sheen colour-map transform |
| 581 | `g3_uv_transform` | `sheen_roughness_uv` | sheen roughness-map transform |

Placement in the list is the instruction; `key` only documents why that is the
order (mesh id for opaque, `1000000 + (100000 - distance)` for blended).
Mask fragments with texture alpha times colour alpha below the cutoff are
discarded, including in the shadow pass. Blended items read depth but do not
write it; opaque and surviving mask fragments write depth. Texture alpha is
ignored for opaque items.

### `g3_view_state` — 1020 bytes

| offset | type | field | meaning |
|---|---|---|---|
| 0 | `g3_vec3` | `eye` | camera position in world space |
| 12 | `g3_vec3` | `light_dir` | direction the light *travels*; the shader uses `-light_dir` |
| 24 | `g3_vec3` | `light_color` | light colour, linear 0..1 |
| 36 | `g3_vec4` | `ambient` | rgb, a = intensity (multiply by it) |
| 52 | `g3_vec4` | `fog` | rgb, a = density, exponential per world unit; 0 disables |
| 68 | `g3_vec4` | `clear` | the colour a frame starts from |
| 84 | `g3_vec4` | `params` | x time, y sRGB output encoding, z tone-map mode (0 none, 1 Reinhard, 2 ACES), w exposure |
| 100 | `g3_light[4]` | `lights` | extra directional, point and spot lights |
| 308 | `int32_t` | `light_count` | number of active extra lights, 0–4 |
| 312 | `g3_vec4` | `env_sky` | hemispherical sky RGB and intensity |
| 328 | `g3_vec4` | `env_ground` | hemispherical ground RGB |
| 344 | `int32_t` | `environment_texture` | equirectangular RGB texture handle, or -1 |
| 348 | `float` | `environment_intensity` | multiplier for texture-based environment fill and reflection |
| 352 | `g3_mat4` | `shadow_view_proj` | primary directional light's world-to-shadow clip transform |
| 416 | `g3_vec4` | `shadow_params` | x enabled, y normalized depth bias, z PCF radius in texels |
| 432 | `g3_vec4` | `view_direction` | xyz direction toward viewer, w selects orthographic shading |
| 448 | `g3_mat4[6]` | `point_shadow_view_proj` | six point-light cube-face world-to-shadow transforms |
| 832 | `int32_t` | `point_shadow_light_index` | selected extra point light, or -1 |
| 836 | `g3_vec4` | `point_shadow_params` | x enabled, y normalized depth bias, z PCF radius in texels |
| 852 | `g3_mat4` | `spot_shadow_view_proj` | selected spot light's world-to-shadow clip transform |
| 916 | `int32_t` | `spot_shadow_light_index` | selected extra spot light, or -1 |
| 920 | `g3_vec4` | `spot_shadow_params` | x enabled, y normalized depth bias, z PCF radius in texels |
| 936 | `int32_t` | `shadow_resolution` | square map size: 256, 512, or 1024 |
| 940 | `int32_t` | `post_process` | bit 0 enables the FXAA full-screen output pass |
| 944 | `int32_t` | `render_target` | texture id to draw into, or -1 for the window surface |
| 948 | `int32_t` | `target_width` | selected render-target width, in pixels |
| 952 | `int32_t` | `target_height` | selected render-target height, in pixels |
| 956 | `g3_mat4` | `view_proj` | camera view-projection matrix, also used to form instanced MVP matrices |

A selected target is a linear RGBA8 texture with RGB clamped to 0..1 and alpha
fixed to 1. Its texture-coordinate origin is the lower-left, matching WebGL.
Target dimensions drive projection and viewport size. Tone mapping, sRGB output
encoding, and FXAA are applied only to the window surface. A draw item that
samples the active target in any material slot is skipped to avoid a framebuffer
feedback loop.

One extra point light and one extra spot light can cast shadows per frame. The
WebGL backend stores point depth in a cube texture and spot depth in a 2D
texture; the CPU backend stores six point depth arrays and one spot depth
array. Maps use 512×512 depth and hard, 3×3, or 5×5 PCF filtering; blended
casters are discarded and masked alpha cutouts are supported. Spot projection
supports outer half-angles below 90°.

Each packed `g3_light` is 52 bytes: position and type in a `vec4`, direction
and range in a `vec4`, colour and outer-cone cosine in a `vec4`, followed by
the inner-cone cosine as a float. Type 0 is directional, 1 point, and 2 spot.

### Slices

```c
typedef struct { const g3_vertex *data; int64_t len; }    g3_vertex_slice;
typedef struct { const uint32_t *data; int64_t len; }     g3_u32_slice;
typedef struct { const g3_draw_item *data; int64_t len; } g3_draw_item_slice;
typedef struct { const uint8_t *data; int64_t len; }      g3_u8_slice;   /* no NUL */
typedef struct { const float *data; int64_t len; }        g3_f32_slice;
```

`g3_u8_slice` is a Goose `const u8[:]`: **not** null-terminated. `g3_f32_slice`
is a float pointer and element count for linear HDR texture uploads. A backend that
needs a C string copies it and appends `'\0'` (see `path_of()` in
`platform/g3_soft.c`).

## The functions a backend implements

| symbol | contract |
|---|---|
| `uint8_t g3p_init(int32_t w, int32_t h, g3_u8_slice title)` | create the surface; return 0 after printing/reporting the reason |
| `void g3p_shutdown(void)` | release everything |
| `int32_t g3p_width(void)` / `g3p_height(void)` | current surface size in pixels |
| `void g3p_upload_mesh(int32_t id, g3_vertex_slice, g3_u32_slice)` | store geometry under `id`; may be called repeatedly; ids are dense from 0 |
| `void g3p_release_mesh(int32_t id)` | release backend geometry for a removed mesh; the numeric slot remains reserved |
| `void g3p_upload_texture(int32_t id, g3_u8_slice, int32_t w, int32_t h)` | copy row-major RGBA8 pixels; reset to bilinear filtering and clamp-to-edge |
| `void g3p_upload_texture_srgb(int32_t id, g3_u8_slice, int32_t w, int32_t h)` | same upload, decoding sRGB RGB channels to linear for filtering; alpha remains linear |
| `void g3p_upload_texture_hdr(int32_t id, g3_f32_slice, int32_t w, int32_t h)` | copy row-major linear RGBA32F radiance; intended for environment maps |
| `uint8_t g3p_create_render_target(int32_t id, int32_t w, int32_t h)` | create a sampleable linear RGBA8 target with depth storage |
| `uint8_t g3p_resize_render_target(int32_t id, int32_t w, int32_t h)` | resize a target; its contents are cleared |
| `uint8_t g3p_post_process(int32_t source, int32_t destination, int32_t effect)` | run copy (0), grayscale (1), invert (2), or FXAA (3) from a texture into a distinct target |
| `uint8_t g3p_post_process_shader_create(int32_t id, g3_u8_slice body)` | compile a bounded WebGL2 fragment-body program; the CPU backend rejects it |
| `uint8_t g3p_post_process_shader_run(int32_t shader, int32_t source, int32_t destination)` | run a custom fragment program into a distinct render target |
| `void g3p_post_process_shader_release(int32_t id)` | release a compiled custom fragment program |
| `int32_t g3p_texture_width(int32_t id)` / `g3p_texture_height(int32_t id)` | dimensions of a backend texture |
| `void g3p_release_texture(int32_t id)` | release backend texture and derived mip storage; the numeric slot remains reserved |
| `void g3p_texture_wrap(int32_t id, int32_t u, int32_t v)` | set U and V wrapping: 0 clamp, 1 repeat, 2 mirrored repeat |
| `void g3p_texture_filter(int32_t id, int32_t min_filter, int32_t mag_filter)` | set glTF/WebGL filter enum values; generate mipmaps when a mipmapped minification filter is requested |
| `void g3p_texture_generate_env_mips(int32_t id)` | build GGX importance-sampled roughness mips without changing ordinary material mipmaps |
| `void g3p_draw_frame(g3_draw_item_slice, const g3_view_state *)` | clear, then draw every item in order |
| `uint8_t g3p_key_down(int32_t key)` | is this key down right now |
| `float g3p_mouse_dx(void)` / `g3p_mouse_dy(void)` | movement since last read; **reading consumes it** |
| `uint8_t g3p_save_frame(g3_u8_slice path)` | write the frame; 0 where impossible (browser) |
| `uint32_t g3p_read_pixel(int32_t x, int32_t y)` | `0xRRGGBB` of the frame just drawn, (0,0) top-left, 0 outside |

`g3p_key_down`, `g3p_mouse_d*` and the host-facing `g3_input_key`,
`g3_input_mouse`, `g3_input_resize` are implemented once in
`platform/g3_input.c`. A backend supplies only:

```c
int g3_backend_resize(int width, int height);   /* 0 if it cannot resize */
```

## Drawing rules (both backends)

1. Clear colour and depth from `ViewState.clear`.
2. Depth test `LESS`, depth write on, front faces CCW. Back faces are culled
   unless the draw item is double-sided; double-sided back-face normals are
   flipped before lighting.
3. For `params.w > 0.5`: enable blending
   `src_alpha, 1 - src_alpha`, **disable depth writes**. Otherwise blending off
   and depth writes on.
4. Draw items strictly in list order.
5. Fragment maths exactly as in `docs/architecture.md` — the C `shade()` and the
   GLSL are the same computation written twice.

## Host APIs (not part of the ABI)

These exist for a host, not for the engine:

| host | function | purpose |
|---|---|---|
| native | `g3_input_key(int, int)`, `g3_input_mouse(float, float)`, `g3_input_resize(int, int)` | feed input from a test or script |
| web | `g3_host_start(int w, int h)` | **the page's entry point**: `goose_init` + `g3_app_init`; exported with `EMSCRIPTEN_KEEPALIVE` |
| web | `g3_input_key/mouse/resize` | same three, exported to JS by `g3_input.h`'s `G3_HOST_API` |
| web | `g3_host_scene_draw_calls()` | WebGL scene-pass draw calls for the current frame; shadow and presentation passes are excluded |
| web | `g3_host_mesh_morph`, `g3_host_morph_weights`, `g3_host_mesh_morph_release` | upload per-mesh glTF position, normal and tangent deltas, update animated weights, and release the optional GPU morph path |
| web | `g3_host_mesh_skin`, `g3_host_joint_palette`, `g3_host_mesh_update_cpu` | upload per-mesh skin attributes and joint matrices while keeping retained picking geometry updated |
| web | exported Goose: `g3_app_init`, `g3_app_frame`, `g3_app_shutdown`, `g3_app_drawn/culled/triangles/meshes/nodes` | what `web/shell.js` calls |

A `--standalone` Emscripten module does not run `main`, so `g3_host_start` is how
everything starts. Every symbol the page calls must appear in
`build_web.sh`'s `-sEXPORTED_FUNCTIONS`.

## Evolving the ABI

1. Edit `src/g3/platform.goose` (field + comment).
2. Edit `platform/g3_abi.h`: same position, then update
   `_Static_assert(sizeof(g3_draw_item) == ...)` and add
   `_Static_assert(offsetof(g3_draw_item, new_field) == ..., "... offset")`.
3. Set the field in `src/g3/render.goose`'s `pack_item()` (or `begin_frame` for
   `ViewState`).
4. Read it in both backends, or comment why one ignores it.
5. Update the byte counts in `README.md` and this file.
6. Verify: `goose check` all roots (asserts fire at build), then
   `./build_native.sh --test`, then a PPM `cmp` if the change was meant to be
   neutral.

### History

| change | effect |
|---|---|
| `DrawItem.depth` removed | 172 → 168 bytes. Nothing read it: the sort key already encodes the order, and backends draw in list order. |
| `platform/g3_input.{h,c}` extracted | the key table, mouse deltas and resize wrapper now exist once instead of in both backends; each backend implements only `g3_backend_resize`. |
