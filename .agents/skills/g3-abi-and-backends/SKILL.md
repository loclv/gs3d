---
name: g3-abi-and-backends
description: Use when changing the engine/backend boundary in goose-3d — the packed structs and their byte offsets, the draw-list contract, what a backend must implement, and how to add or modify one without breaking the other.
---

# The seam: ABI, backends, and the two hosts

`src/g3/platform.goose` declares the whole boundary; `platform/g3_abi.h` is the
same contract in C. One call per frame goes out: `g3p_draw_frame(items, view)`.

Read `docs/abi.md` for the reference tables; this skill is the procedure.

## What crosses, byte for byte

All structs are `#pragma pack(push, 1)` — no padding anywhere, asserted at
compile time in `platform/g3_abi.h`.

| type | size | layout |
|---|---|---|
| `Vertex` | 104 | position @0, normal @12, UV0–5 @24–64, tangent @72, colour @88 |
| `Mat4` | 64 | column-major `m[col*4 + row]`, i.e. GL's layout with transpose off |
| `DrawItem` | 168 | `mesh: i32` @0, `mvp: Mat4` @4, `model: Mat4` @68, `color: float4` @132, `params: float4` @148, `key: f32` @164 |
| `ViewState` | 1260 | eye @0, primary light and ambient/fog/clear/params @12–99, eight additional lights @100, shadows/environment/render-target state, camera `view_proj` @1196 |

Slices cross as `{ const T *data; int64_t len; }` (`g3_vertex_slice`,
`g3_u32_slice`, `g3_draw_item_slice`, `g3_u8_slice`). `bool` crosses as
`uint8_t`. Nothing is passed by value that is not flat and fixed-size.

Field meanings that the comments in `platform.goose` state and the code relies on:

* `DrawItem.mesh` — the id the mesh was uploaded with; `-1` means "nothing to
  draw" (group nodes never reach the draw list).
* `DrawItem.mvp` — `view_proj * model` for an ordinary draw. Instanced WebGL
  runs use `ViewState.view_proj` with the per-instance model transform.
* `DrawItem.model` — used for world-space normals (`mat3(model)`) and for any
  world-space work such as fog distance or lighting position.
* `DrawItem.color` — rgb and alpha; `a < 1` marks the item as blended (the
  engine also sets `params.w = 1`).
* `DrawItem.params` — `x` unlit (1 = skip lighting), `y` specular strength,
  `z` shininess, `w` blended.
* `DrawItem.key` — the engine's sort key. Backends draw in list order;
  the key is documentation of that order, not a second instruction.
* `ViewState.ambient` — rgb, `a` = intensity (multiply by it).
* `ViewState.fog` — rgb, `a` = density (exponential, per world unit; 0 = off).
* `ViewState.clear` — the colour the frame starts from.
* `ViewState.params.x` — seconds since start, for animated shaders.
* `ViewState.view_proj` — the current camera view-projection matrix, used to
  compose instanced MVP transforms in WebGL.

## What a backend must implement

These symbols (declared in the header, implemented in the
backend's `.c`):

```c
uint8_t g3p_init(int32_t width, int32_t height, g3_u8_slice title);  /* 0 = failed, after explaining */
void    g3p_shutdown(void);
int32_t g3p_width(void);
int32_t g3p_height(void);
void    g3p_upload_mesh(int32_t id, g3_vertex_slice verts, g3_u32_slice indices);
void    g3p_release_mesh(int32_t id);
void    g3p_upload_texture(int32_t id, g3_u8_slice pixels, int32_t width, int32_t height);
void    g3p_upload_texture_srgb(int32_t id, g3_u8_slice pixels, int32_t width, int32_t height);
void    g3p_upload_texture_hdr(int32_t id, g3_f32_slice pixels, int32_t width, int32_t height);
void    g3p_release_texture(int32_t id);
void    g3p_texture_wrap(int32_t id, int32_t wrap_u, int32_t wrap_v);
void    g3p_texture_filter(int32_t id, int32_t min_filter, int32_t mag_filter);
void    g3p_texture_generate_mips(int32_t id);
void    g3p_texture_generate_env_mips(int32_t id);
void    g3p_draw_frame(g3_draw_item_slice items, const g3_view_state *view);
uint8_t g3p_key_down(int32_t key);
float   g3p_mouse_dx(void);      /* reading consumes the accumulated delta */
float   g3p_mouse_dy(void);
uint8_t g3p_save_frame(g3_u8_slice path);   /* 0 where there is no file system */
uint32_t g3p_read_pixel(int32_t x, int32_t y);  /* 0xRRGGBB, (0,0) top left */
```

`g3p_key_down`/`g3p_mouse_d*` and the host-facing `g3_input_key`,
`g3_input_mouse`, `g3_input_resize` all live in `platform/g3_input.c`, shared by
both backends. A new backend supplies only:

```c
int g3_backend_resize(int width, int height);   /* 0 if it cannot */
```

## The rules every backend follows

1. State. Depth test `GL_LESS`/`z < depth`, back faces culled, front faces
   counter-clockwise. The CPU backend implements the same three rules by hand;
   changing one without the other is a bug.
2. Blending. Blended items (`params.w > 0.5`) are drawn with
   `src_alpha, 1-src_alpha` and do not write depth; opaque items write it.
   The engine's far→near ordering is what makes this correct.
3. Order. Draw items in list order. Do not re-sort.
4. Shading. The fragment maths must match the other backend term for term
   (see below).
5. Resize. `g3p_width/height` reflect the current surface; a resize call
   updates them and the viewport.
6. Failure talks. If init cannot make a surface, print the reason and, where
   there is a page, report it (`report()` in `g3_web.c` → `window.gooseError`).

## Keeping the two shaders in step

`platform/g3_web.c`'s `FRAGMENT_SRC` and `platform/g3_soft.c`'s `shade()` are
the same computation written twice:

| term | GLSL | C |
|---|---|---|
| diffuse | `max(dot(n, l), 0.0)` | `diff = n·l` clamped, `l = -light_dir` |
| specular | `pow(max(dot(n,h),0.0), max(params.z,1.0)) * params.y` | `powf(nh, shine) * params.y`, `h = normalize(l + v)` |
| base | `color.rgb * (ambient.rgb*ambient.a + light_color*diff) + light_color*spec` | same |
| unlit | `if (params.x > 0.5) col = color.rgb` | same, before fog |
| fog | `mix(col, fog.rgb, clamp(1-exp(-dist*fog.a), 0, 1))` | same |

Test data: a frame rendered by the CPU backend at 960×600 is 11 draw items and
6,884 triangles, and the browser build reports the same counts in its HUD.
If you change one shader, change the other, then compare those numbers and the
image.

## Hosts: who calls `g3p_init`

* Native — the Goose root has `main()` and calls `g3::init()`, which calls
  `g3p_init`. Simple, and the loop is a `for`.
* Web — the Goose root is `--standalone` (no `main`) and exports
  `g3_app_init/g3_app_frame/g3_app_shutdown` plus stats getters. `platform/g3_web.c`
  provides `g3_host_start(width, height)` (exported with
  `EMSCRIPTEN_KEEPALIVE`), which calls `goose_init(0, NULL)` and then
  `g3_app_init`; `web/shell.js` calls it once the canvas has its real size and
  then calls `g3_app_frame(dt)` from `requestAnimationFrame`.
  Do not rely on `main` running in the Emscripten module: with
  `-sMODULARIZE` + `-sEXPORT_ES6` it is not invoked, which is exactly why the
  host entry point exists. Exported symbols must also be listed in
  `build_web.sh`'s `-sEXPORTED_FUNCTIONS` (or marked `EMSCRIPTEN_KEEPALIVE`).

## Adding a field to `DrawItem`: the checklist

1. `src/g3/platform.goose` — add the field with a comment saying what it means
   and who computes it.
2. `platform/g3_abi.h` — add the matching C field in the same position, and
   update `sizeof(g3_draw_item)` plus an `offsetof` assert for the new field.
3. `src/g3/render.goose` — set it in `pack_item()` (it is the only place items
   are built).
4. Both backends — read it where they need it. If a backend can ignore it, say
   so in a comment rather than leaving it unmentioned.
5. `README.md` — update the byte size in "One seam, two backends".
6. Verify: `goose check` all roots, `./build_native.sh --test` (the static
   asserts fire at compile time if the layouts drifted), and a PPM `cmp` for
   anything meant to be neutral.

sizeof/offset changes are the only place in this repo where "it compiles" is
not enough — the asserts are there because a silent layout drift would show up
as garbage geometry, not as an error.

## Adding a whole new backend

1. Create `platform/g3_<name>.c` implementing every `g3p_*` symbol declared in
   `src/g3/platform.goose` (include
   `g3_abi.h` and `g3_input.h`) plus `g3_backend_resize`.
2. Add a root whose sidecar lists it:
   `c_sources = ["../platform/g3_<name>.c", "../platform/g3_input.c"];`
   `c_include = ["../platform"];` `c_libs = [...]` (e.g. `m`, `pthread`).
3. Implement `shade()` as the GLSL from `g3_web.c`, term for term, unless the
   backend is the GPU one.
4. Verify against the existing pair: render the same scene and compare images or,
   at minimum, the stats (draw items, triangles) and a handful of pixels from
   `src/test_engine.goose`.
