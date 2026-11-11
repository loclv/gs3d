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

#pragma pack(push, 1)

typedef struct { float x, y, z; } g3_vec3;
typedef struct { float x, y, z, w; } g3_vec4;
typedef struct { float m[16]; } g3_mat4;          /* column-major */

typedef struct { g3_vec3 pos, normal; } g3_vertex; /* 24 bytes */

/* One primitive: mesh, matrices, colour, and the shading parameters.
   params.x is 1 for unlit, .y specular strength, .z shininess, .w 1 when
   the item is blended.
 
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
} g3_draw_item;

/* The frame's shared constants. */
typedef struct {
    g3_vec3 eye;
    g3_vec3 light_dir;
    g3_vec3 light_color;
    g3_vec4 ambient;      /* rgb, a = intensity */
    g3_vec4 fog;          /* rgb, a = density */
    g3_vec4 clear;
    g3_vec4 params;       /* x = seconds since start */
} g3_view_state;

typedef struct { const g3_vertex *data; int64_t len; } g3_vertex_slice;
typedef struct { const uint32_t *data; int64_t len; } g3_u32_slice;
typedef struct { const g3_draw_item *data; int64_t len; } g3_draw_item_slice;
/* A Goose `const u8[:]`: data and length, with no terminator. */
typedef struct { const uint8_t *data; int64_t len; } g3_u8_slice;

#pragma pack(pop)

_Static_assert(sizeof(g3_vertex) == 24, "g3_vertex must be 24 bytes");
_Static_assert(sizeof(g3_mat4) == 64, "g3_mat4 must be 64 bytes");
_Static_assert(sizeof(g3_draw_item) == 168, "g3_draw_item must be 168 bytes");
_Static_assert(sizeof(g3_view_state) == 100, "g3_view_state must be 100 bytes");
_Static_assert(offsetof(g3_draw_item, mvp) == 4, "DrawItem.mvp offset");
_Static_assert(offsetof(g3_draw_item, color) == 132, "DrawItem.color offset");
_Static_assert(offsetof(g3_draw_item, params) == 148, "DrawItem.params offset");
_Static_assert(offsetof(g3_view_state, ambient) == 36, "ViewState.ambient offset");
_Static_assert(offsetof(g3_view_state, clear) == 68, "ViewState.clear offset");

/* --- what a backend implements (see src/g3/platform.goose) --- */

uint8_t g3p_init(int32_t width, int32_t height, g3_u8_slice title);
void g3p_shutdown(void);
int32_t g3p_width(void);
int32_t g3p_height(void);
void g3p_upload_mesh(int32_t id, g3_vertex_slice verts, g3_u32_slice indices);
void g3p_draw_frame(g3_draw_item_slice items, const g3_view_state *view);
uint8_t g3p_key_down(int32_t key);
float g3p_mouse_dx(void);
float g3p_mouse_dy(void);
uint8_t g3p_save_frame(g3_u8_slice path);
uint32_t g3p_read_pixel(int32_t x, int32_t y);

#endif /* G3_ABI_H */
