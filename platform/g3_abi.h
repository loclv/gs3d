/* The engine's C ABI: the bytes that cross between the Goose side
   (src/g3/platform.goose) and a backend.
 
   Goose packs structs with no padding and passes a slice as { data, len },
   so both backends can read the same memory the engine wrote. Nothing here
   is hand-maintained against a moving target: the static asserts below pin
   the layout, and build_web.sh / build_native.sh fail the build if the
   Goose declarations ever drift from it.
 
   Field names differ from the Goose ones on purpose (Goose gives every name
   a `_g` suffix in C); only the layout is a contract. */

#ifndef G3_ABI_H
#define G3_ABI_H

#include <stddef.h>
#include <stdint.h>
#include <math.h>

#pragma pack(push, 1)

typedef struct { float x, y, z; } g3_vec3;
typedef struct { float x, y; } g3_vec2;
typedef struct { float x, y, z, w; } g3_vec4;
typedef struct { float m[16]; } g3_mat4;          /* column-major */

typedef struct { g3_vec3 pos, normal; g3_vec2 uv; } g3_vertex;

/* One primitive: mesh, matrices, colour, and the shading parameters.
   params.x is 1 for unlit, .y specular strength, .z shininess, .w 1 when
   the item is blended. alpha_mode selects opaque, mask, or blend.
 
   `key` is the engine's sort key, kept so a backend can see why the list is
   in the order it is; drawing in list order is the contract, so a backend
   that ignores it is correct. */
typedef struct {
    int32_t mesh;
    g3_mat4 mvp;
    g3_mat4 model;
    g3_vec4 color;
    g3_vec4 params;
    float key;
    int32_t texture;
    int32_t alpha_mode;
    float alpha_cutoff;
} g3_draw_item;

typedef struct { g3_vec4 position, direction, color; float inner; } g3_light;

/* The frame's shared constants. */
typedef struct {
    g3_vec3 eye;
    g3_vec3 light_dir;
    g3_vec3 light_color;
    g3_vec4 ambient;      /* rgb, a = intensity */
    g3_vec4 fog;          /* rgb, a = density */
    g3_vec4 clear;
    g3_vec4 params;       /* x = seconds since start */
    g3_light lights[4];
    int32_t light_count;
    g3_vec4 env_sky, env_ground;
    int32_t environment_texture;
    float environment_intensity;
    g3_mat4 shadow_view_proj;
    g3_vec4 shadow_params;
    g3_vec4 view_direction; /* xyz toward viewer, w = orthographic */
} g3_view_state;

typedef struct { const g3_vertex *data; int64_t len; } g3_vertex_slice;
typedef struct { const uint32_t *data; int64_t len; } g3_u32_slice;
typedef struct { const g3_draw_item *data; int64_t len; } g3_draw_item_slice;
/* A Goose `const u8[:]`: data and length, with no terminator. */
typedef struct { const uint8_t *data; int64_t len; } g3_u8_slice;

#pragma pack(pop)

_Static_assert(sizeof(g3_vertex) == 32, "g3_vertex must be 32 bytes");
_Static_assert(offsetof(g3_vertex, uv) == 24, "Vertex.uv offset");
_Static_assert(sizeof(g3_mat4) == 64, "g3_mat4 must be 64 bytes");
_Static_assert(sizeof(g3_draw_item) == 180, "g3_draw_item must be 180 bytes");
_Static_assert(offsetof(g3_draw_item, texture) == 168, "DrawItem.texture offset");
_Static_assert(offsetof(g3_draw_item, alpha_mode) == 172, "DrawItem.alpha_mode offset");
_Static_assert(offsetof(g3_draw_item, alpha_cutoff) == 176, "DrawItem.alpha_cutoff offset");
_Static_assert(sizeof(g3_light) == 52, "g3_light must be 52 bytes");
_Static_assert(sizeof(g3_view_state) == 448, "g3_view_state must be 448 bytes");
_Static_assert(offsetof(g3_view_state, lights) == 100, "ViewState.lights offset");
_Static_assert(offsetof(g3_view_state, light_count) == 308, "ViewState.light_count offset");
_Static_assert(offsetof(g3_view_state, env_sky) == 312, "ViewState.env_sky offset");
_Static_assert(offsetof(g3_view_state, environment_texture) == 344, "ViewState.environment_texture offset");
_Static_assert(offsetof(g3_view_state, shadow_view_proj) == 352, "ViewState.shadow_view_proj offset");
_Static_assert(offsetof(g3_view_state, shadow_params) == 416, "ViewState.shadow_params offset");
_Static_assert(offsetof(g3_view_state, view_direction) == 432, "ViewState.view_direction offset");
_Static_assert(offsetof(g3_draw_item, mvp) == 4, "DrawItem.mvp offset");
_Static_assert(offsetof(g3_draw_item, color) == 132, "DrawItem.color offset");
_Static_assert(offsetof(g3_draw_item, params) == 148, "DrawItem.params offset");
_Static_assert(offsetof(g3_view_state, ambient) == 36, "ViewState.ambient offset");
_Static_assert(offsetof(g3_view_state, clear) == 68, "ViewState.clear offset");

/* Inverse transpose of the affine linear part, column-major. A singular
   transform has no well-defined surface normal; use zero in both backends. */
static inline void g3_normal_matrix(const g3_mat4 *model, float out[9]) {
    const float *m = model->m;
    float a=m[0], b=m[4], c=m[8], d=m[1], e=m[5], f=m[9], g=m[2], h=m[6], i=m[10];
    float A=e*i-f*h, B=f*g-d*i, C=d*h-e*g;
    float det=a*A+b*B+c*C;
    if (fabsf(det) < 1e-12f) { for (int n = 0; n < 9; n++) out[n] = 0.0f; return; }
    float inv=1.0f/det;
    out[0]=A*inv; out[1]=(c*h-b*i)*inv; out[2]=(b*f-c*e)*inv;
    out[3]=B*inv; out[4]=(a*i-c*g)*inv; out[5]=(c*d-a*f)*inv;
    out[6]=C*inv; out[7]=(b*g-a*h)*inv; out[8]=(a*e-b*d)*inv;
}

/* --- what a backend implements (see src/g3/platform.goose) --- */

uint8_t g3p_init(int32_t width, int32_t height, g3_u8_slice title);
void g3p_shutdown(void);
int32_t g3p_width(void);
int32_t g3p_height(void);
void g3p_upload_mesh(int32_t id, g3_vertex_slice verts, g3_u32_slice indices);
void g3p_upload_texture(int32_t id, g3_u8_slice pixels, int32_t width, int32_t height);
void g3p_upload_texture_srgb(int32_t id, g3_u8_slice pixels, int32_t width, int32_t height);
void g3p_texture_wrap(int32_t id, int32_t wrap_u, int32_t wrap_v);
void g3p_texture_filter(int32_t id, int32_t min_filter, int32_t mag_filter);
void g3p_draw_frame(g3_draw_item_slice items, const g3_view_state *view);
uint8_t g3p_key_down(int32_t key);
float g3p_mouse_dx(void);
float g3p_mouse_dy(void);
uint8_t g3p_save_frame(g3_u8_slice path);
uint32_t g3p_read_pixel(int32_t x, int32_t y);

#endif /* G3_ABI_H */
