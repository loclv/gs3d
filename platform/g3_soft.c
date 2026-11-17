/* The CPU backend: a reference rasterizer that writes frames to a PPM.
 
   It exists so the engine can be run, tested and debugged with no browser and
   no GPU: `src/app_native.goose` builds this in and renders stills. It also
   keeps the GPU backend honest, because the fragment math below is the GLSL
   shader in g3_web.c written out in C, term for term, and both are driven by
   whatever matrices the engine computed. If a frame looks wrong here it is
   wrong in the engine, not in a driver.
 
   It is a small, correct rasterizer, not a fast one:
     - triangles are clipped against the six homogeneous clip planes;
     - one thread, no tiles, no early-z;
     - depth LESS, back faces culled, CCW front, perspective-correct
       attributes: the same state the WebGL backend sets. */

#include "g3_abi.h"
#include "g3_input.h"

#include <math.h>
#include <stdio.h>
#include <stdlib.h>
#include <stdatomic.h>
#include <string.h>
#include <time.h>

/* Emscripten's threads are opt-in behind shared memory and COOP/COEP headers,
   and the browser build uses the GPU backend anyway, so the CPU backend is
   single-banded there and parallel here. */
#if defined(__EMSCRIPTEN__)
#define G3_HAVE_THREADS 0
#else
#include <pthread.h>
#include <unistd.h>
#define G3_HAVE_THREADS 1
#endif

typedef struct {
    g3_vertex *verts;
    int64_t vcount;
    uint32_t *idx;
    int64_t icount;
} soft_mesh;

static int32_t fb_w, fb_h;
static uint8_t *fb;      /* rgb, top row first */
static uint8_t *fxaa_buffer;
static size_t fxaa_capacity;
static float *hdr_fb;     /* linear RGB, unbounded until tone mapping */
static float *depth;     /* [0, 1], 1 is far */
static soft_mesh *meshes;
static int32_t mesh_count, mesh_cap;
typedef struct {
    uint8_t *pixels, *mips[31], *env_mips[31];
    float *hdr_pixels, *hdr_mips[31], *hdr_env_mips[31];
    uint8_t *target_fb;
    float *target_hdr_fb, *target_depth;
    int32_t w, h, wrap_u, wrap_v, min_filter, mag_filter, levels, env_levels, srgb;
} soft_texture;
static soft_texture *textures;
static int32_t texture_count;
#define SHADOW_MAX_SIZE 1024
static float shadow_depth[SHADOW_MAX_SIZE * SHADOW_MAX_SIZE];
static float point_shadow_depth[6][SHADOW_MAX_SIZE * SHADOW_MAX_SIZE];
static float spot_shadow_depth[SHADOW_MAX_SIZE * SHADOW_MAX_SIZE];
static uint8_t brdf_lut[G3_BRDF_LUT_SIZE * G3_BRDF_LUT_SIZE * 4];

/* --- the frame's scratch

   A triangle on its way to the framebuffer: screen-space corners in pixels (y
   down, as the framebuffer is), their normalised depth, the inverse clip w that
   makes interpolated attributes perspective-correct, the world position and
   normal the shader wants at each corner, and the pixel box it covers.

   `soft_quad` is one of those plus which draw item it belongs to: the whole
   frame's triangles are transformed once into `queue`, and every band then
   rasterizes the ones that reach its rows. About 140 bytes per triangle in the
   frame, which buys a transform pass that runs once instead of once per band. */
typedef struct {
    float sx[3], sy[3], sz[3];
    float inv_w[3];
    float world[3][3];
    float nrm[3][3];
    float uv[3][2];
    float uv1[3][2];
    float uv2[3][2];
    float uv3[3][2];
    float uv4[3][2];
    float uv5[3][2];
    float uv6[3][2];
    float uv7[3][2];
    float tangent[3][4];
    float color[3][4];
    float derived_tangent[3], derived_bitangent[3];
    float det;              /* twice the signed area in pixels */
    float edge_sense;       /* +1 or -1: the sign l0 has when an edge is 0 */
    float normal_sign;      /* -1 for back faces, for double-sided shading */
    int x0, y0, x1, y1;
} soft_tri;

static void transform_uv(const g3_uv_transform *transform, float u, float v, float *out_u, float *out_v);
static int uv_transform_identity(const g3_uv_transform *transform);
static void apply_fxaa(void);
static void interpolate_uv(const soft_tri *triangle, int set, float b0, float b1, float b2, float *u, float *v);
static const float (*triangle_uv(const soft_tri *triangle, int set))[2] {
    switch (set) {
        case 1: return triangle->uv1;
        case 2: return triangle->uv2;
        case 3: return triangle->uv3;
        case 4: return triangle->uv4;
        case 5: return triangle->uv5;
        case 6: return triangle->uv6;
        case 7: return triangle->uv7;
        default: return triangle->uv;
    }
}

typedef struct {
    soft_tri tri;
    const g3_draw_item *item;
    int blended;
} soft_quad;

static soft_quad *queue;
static int64_t queue_len, queue_cap;

/* How many bands the rasterizer is split into: one per core by default. */
static int band_count = 1;

/* --- where the time goes

   Set G3_PROFILE=1 and the backend times itself: clear, triangle setup and the
   raster loop, reported at shutdown. Off by default, and when off it costs two
   predictable branches per triangle: no rebuild, no separate binary, so the
   numbers are the numbers the shipped backend runs at. */
typedef struct {
    int on;
    double clear, setup, raster;      /* seconds, accumulated */
    double wall;                      /* whole frame, as it felt to the caller */
    long frames, triangles, pixels, shaded;
} soft_profile;

static soft_profile prof;

static double now_seconds(void) {
    struct timespec ts;
    clock_gettime(CLOCK_MONOTONIC, &ts);
    return (double)ts.tv_sec + (double)ts.tv_nsec * 1e-9;
}

static void path_of(g3_u8_slice s, char *out, size_t cap) {
    size_t n = (size_t)s.len;
    if (n >= cap) n = cap - 1;
    if (n && s.data) memcpy(out, s.data, n);
    out[n] = 0;
}

/* --- the platform side --- */

/* One band per core, up to 8: each band is a contiguous run of scanlines.
   G3_THREADS=1 forces a single band, which is what an A/B measurement of the
   threading needs. */
static int default_bands(void) {
#if G3_HAVE_THREADS
    int n = 1;
    const char *want = getenv("G3_THREADS");
    if (want && want[0] != '\0') {
        n = (int)strtol(want, NULL, 10);
    } else {
        long cores = sysconf(_SC_NPROCESSORS_ONLN);
        n = cores > 0 ? (int)cores : 1;
    }
    if (n > 8) n = 8;
    if (n < 1) n = 1;
    return n;
#else
    return 1;
#endif
}

uint8_t g3p_init(int32_t width, int32_t height, g3_u8_slice title) {
    (void)title;   /* a headless surface has no title to show */
    g3_brdf_lut_generate(brdf_lut);
    fb_w = width > 0 ? width : 1;
    fb_h = height > 0 ? height : 1;
    size_t pixels = (size_t)fb_w * (size_t)fb_h;
    fb = (uint8_t *)calloc(pixels * 3, 1);
    hdr_fb = (float *)calloc(pixels * 3, sizeof(float));
    depth = (float *)malloc(sizeof(float) * pixels);
    if (!fb || !hdr_fb || !depth) {
        fprintf(stderr, "g3_soft: out of memory for a %dx%d surface\n", fb_w, fb_h);
        return 0;
    }
    for (size_t i = 0; i < pixels; i++) depth[i] = 1.0f;
    const char *want = getenv("G3_PROFILE");
    prof.on = want && want[0] != '\0' && want[0] != '0';
    band_count = default_bands();
    return 1;
}

/* One line per phase, per frame: the units a profile is readable in. */
static void report_profile(void) {
    if (!prof.on || prof.frames == 0) return;
    double per = 1.0 / (double)prof.frames;
    double clear = prof.clear * per, setup = prof.setup * per, raster = prof.raster * per;
    double tris = (double)prof.triangles * per;
    double shaded = (double)prof.shaded * per, pixels = (double)prof.pixels * per;
    fprintf(stderr, "g3_soft profile, %ld frames of %dx%d:\n", prof.frames, fb_w, fb_h);
    fprintf(stderr, "  clear   %7.2f ms/frame\n", clear * 1e3);
    fprintf(stderr, "  setup   %7.2f ms/frame  (%5.0f triangles, %5.0f ns each)\n",
            setup * 1e3, tris, tris > 0.0 ? setup * 1e9 / tris : 0.0);
    fprintf(stderr, "  raster  %7.2f ms/frame  (%6.0f shaded of %6.0f pixels, %4.1f ns each)\n",
            raster * 1e3, shaded, pixels, shaded > 0.0 ? raster * 1e9 / shaded : 0.0);
    double wall = prof.wall * per;
    fprintf(stderr, "  frame   %7.2f ms/frame  on %d worker(s), %.0f fps\n",
            wall * 1e3, band_count, wall > 0.0 ? 1.0 / wall : 0.0);
}

void g3p_shutdown(void) {
    report_profile();
    for (int32_t i = 0; i < texture_count; i++) {
        free(textures[i].pixels);
        free(textures[i].hdr_pixels);
        free(textures[i].target_fb); free(textures[i].target_hdr_fb); free(textures[i].target_depth);
        for (int j = 0; j < 31; j++) {
            free(textures[i].mips[j]); free(textures[i].env_mips[j]);
            free(textures[i].hdr_mips[j]); free(textures[i].hdr_env_mips[j]);
        }
    }
    free(textures); textures = NULL; texture_count = 0;
    free(queue);
    queue = NULL;
    queue_len = queue_cap = 0;
    free(fb);
    free(fxaa_buffer);
    fxaa_buffer = NULL; fxaa_capacity = 0;
    free(hdr_fb);
    free(depth);
    fb = NULL;
    hdr_fb = NULL;
    depth = NULL;
    for (int32_t i = 0; i < mesh_count; i++) {
        free(meshes[i].verts);
        free(meshes[i].idx);
    }
    free(meshes);
    meshes = NULL;
    mesh_count = mesh_cap = 0;
}

int32_t g3p_width(void) { return fb_w; }
int32_t g3p_height(void) { return fb_h; }

static void ensure_mesh(int32_t id) {
    if (id < mesh_cap) return;
    int32_t cap = mesh_cap ? mesh_cap : 16;
    while (cap <= id) cap *= 2;
    soft_mesh *grown = (soft_mesh *)realloc(meshes, sizeof(soft_mesh) * (size_t)cap);
    if (!grown) {
        fprintf(stderr, "g3_soft: out of memory for mesh %d\n", id);
        exit(1);
    }
    memset(grown + mesh_cap, 0, sizeof(soft_mesh) * (size_t)(cap - mesh_cap));
    meshes = grown;
    mesh_cap = cap;
}

void g3p_upload_mesh(int32_t id, g3_vertex_slice verts, g3_u32_slice indices) {
    if (id < 0) return;
    ensure_mesh(id);
    soft_mesh *m = &meshes[id];
    free(m->verts);
    free(m->idx);
    m->vcount = verts.len;
    m->icount = indices.len;
    m->verts = (g3_vertex *)malloc(sizeof(g3_vertex) * (size_t)(verts.len ? verts.len : 1));
    m->idx = (uint32_t *)malloc(sizeof(uint32_t) * (size_t)(indices.len ? indices.len : 1));
    if (!m->verts || !m->idx) {
        fprintf(stderr, "g3_soft: out of memory uploading mesh %d\n", id);
        exit(1);
    }
    if (verts.len) memcpy(m->verts, verts.data, sizeof(g3_vertex) * (size_t)verts.len);
    if (indices.len) memcpy(m->idx, indices.data, sizeof(uint32_t) * (size_t)indices.len);
    if (id >= mesh_count) mesh_count = id + 1;
}

void g3p_release_mesh(int32_t id) {
    if (id < 0 || id >= mesh_count) return;
    free(meshes[id].verts);
    free(meshes[id].idx);
    memset(&meshes[id], 0, sizeof(meshes[id]));
}

static float srgb_decode(float x) {
    return x <= 0.04045f ? x / 12.92f : powf((x + 0.055f) / 1.055f, 2.4f);
}

static float srgb_encode(float x) {
    if (x < 0.0f) x = 0.0f;
    if (x > 1.0f) x = 1.0f;
    return x <= 0.0031308f ? x * 12.92f : 1.055f * powf(x, 1.0f / 2.4f) - 0.055f;
}

static float tone_map_value(float x, int mode) {
    if (!isfinite(x) || x < 0.0f) x=0.0f;
    if (mode == 1) return x/(1.0f+x);
    if (mode == 2) return (x*(2.51f*x+0.03f))/(x*(2.43f*x+0.59f)+0.14f);
    return x;
}

static void upload_texture(int32_t id, g3_u8_slice pixels, int32_t width, int32_t height, int srgb) {
    if (id < 0 || width <= 0 || height <= 0 || pixels.len != (int64_t)width * height * 4) return;
    if (id >= texture_count) {
        soft_texture *grown = realloc(textures, ((size_t)id + 1) * sizeof(*textures));
        if (!grown) { fprintf(stderr, "g3_soft: out of memory for textures\n"); exit(1); }
        textures = grown;
        memset(textures + texture_count, 0, ((size_t)id + 1 - (size_t)texture_count) * sizeof(*textures));
        texture_count = id + 1;
    }
    uint8_t *copy = malloc((size_t)pixels.len);
    if (!copy) { fprintf(stderr, "g3_soft: out of memory for texture pixels\n"); exit(1); }
    memcpy(copy, pixels.data, (size_t)pixels.len);
    free(textures[id].pixels); free(textures[id].hdr_pixels);
    for (int j = 0; j < 31; j++) {
        free(textures[id].mips[j]); free(textures[id].env_mips[j]);
        free(textures[id].hdr_mips[j]); free(textures[id].hdr_env_mips[j]);
    }
    textures[id] = (soft_texture){ .pixels = copy, .w = width, .h = height,
                                   .min_filter = 9729, .mag_filter = 9729, .levels = 1, .srgb = srgb };
}

void g3p_upload_texture_hdr(int32_t id, g3_f32_slice pixels, int32_t width, int32_t height) {
    if (id < 0 || width <= 0 || height <= 0 || pixels.len != (int64_t)width * height * 4) return;
    if (id >= texture_count) {
        soft_texture *grown = realloc(textures, ((size_t)id + 1) * sizeof(*textures));
        if (!grown) { fprintf(stderr, "g3_soft: out of memory for textures\n"); exit(1); }
        textures = grown;
        memset(textures + texture_count, 0, ((size_t)id + 1 - (size_t)texture_count) * sizeof(*textures));
        texture_count = id + 1;
    }
    float *copy = malloc((size_t)pixels.len * sizeof(float));
    if (!copy) { fprintf(stderr, "g3_soft: out of memory for HDR texture pixels\n"); exit(1); }
    memcpy(copy, pixels.data, (size_t)pixels.len * sizeof(float));
    free(textures[id].pixels); free(textures[id].hdr_pixels);
    for (int j = 0; j < 31; j++) {
        free(textures[id].mips[j]); free(textures[id].env_mips[j]);
        free(textures[id].hdr_mips[j]); free(textures[id].hdr_env_mips[j]);
    }
    textures[id] = (soft_texture){ .hdr_pixels = copy, .w = width, .h = height,
                                   .min_filter = 9729, .mag_filter = 9729, .levels = 1 };
}

/* Load the browser loader's supported Radiance subset for native programs:
   RGBE, canonical -Y +X orientation, and modern per-channel scanline RLE. */
uint8_t g3p_load_radiance_hdr(int32_t id, g3_u8_slice path) {
    if (id < 0 || !path.data || path.len <= 0 || path.len > 4096) return 0;
    char filename[4097];
    for (int64_t i = 0; i < path.len; i++) {
        if (path.data[i] == 0) return 0;
        filename[i] = (char)path.data[i];
    }
    filename[path.len] = 0;
    FILE *file = fopen(filename, "rb");
    if (!file) return 0;

    char line[256];
    int ok = fgets(line, sizeof(line), file) &&
             (!strcmp(line, "#?RADIANCE\n") || !strcmp(line, "#?RADIANCE\r\n") ||
              !strcmp(line, "#?RGBE\n") || !strcmp(line, "#?RGBE\r\n"));
    int format_ok = 0;
    while (ok && fgets(line, sizeof(line), file)) {
        if (!strcmp(line, "\n") || !strcmp(line, "\r\n")) break;
        if (!strcmp(line, "FORMAT=32-bit_rle_rgbe\n") ||
            !strcmp(line, "FORMAT=32-bit_rle_rgbe\r\n")) format_ok = 1;
    }
    int width = 0, height = 0;
    if (!ok || !format_ok || !fgets(line, sizeof(line), file) ||
        sscanf(line, "-Y %d +X %d", &height, &width) != 2 ||
        width <= 0 || height <= 0 || width > 16384 || height > 16384 ||
        (int64_t)width * height > 16777216) {
        fclose(file);
        return 0;
    }

    size_t pixel_count = (size_t)width * (size_t)height;
    uint8_t *rgbe = malloc(pixel_count * 4);
    float *rgba = malloc(pixel_count * 4 * sizeof(float));
    uint8_t *scanline = malloc((size_t)width * 4);
    uint8_t *channel_data = malloc((size_t)width);
    if (!rgbe || !rgba || !scanline || !channel_data) {
        free(rgbe); free(rgba); free(scanline); free(channel_data); fclose(file); return 0;
    }
    for (int y = 0; y < height && ok; y++) {
        uint8_t first[4];
        if (fread(first, 1, 4, file) != 4) { ok = 0; break; }
        if (width >= 8 && width <= 32767 && first[0] == 2 && first[1] == 2 &&
            !(first[2] & 128) && (((int)first[2] << 8) | first[3]) == width) {
            for (int channel = 0; channel < 4 && ok; channel++) {
                int x = 0;
                while (x < width) {
                    int code = fgetc(file);
                    if (code == EOF || code == 0) { ok = 0; break; }
                    if (code > 128) {
                        int count = code - 128, value = fgetc(file);
                        if (value == EOF || count > width - x) { ok = 0; break; }
                        for (int i = 0; i < count; i++) channel_data[x++] = (uint8_t)value;
                    } else {
                        int count = code;
                        if (count > width - x || fread(channel_data + x, 1, (size_t)count, file) != (size_t)count) { ok = 0; break; }
                        x += count;
                    }
                }
                if (ok) for (int x = 0; x < width; x++) scanline[(size_t)x * 4 + channel] = channel_data[x];
            }
            if (ok) memcpy(rgbe + (size_t)y * width * 4, scanline, (size_t)width * 4);
        } else {
            memcpy(rgbe + (size_t)y * width * 4, first, 4);
            if (width > 1 && fread(rgbe + (size_t)y * width * 4 + 4, 4, (size_t)width - 1, file) != (size_t)width - 1) ok = 0;
        }
    }
    fclose(file);
    if (ok) {
        for (size_t i = 0; i < pixel_count; i++) {
            const uint8_t *p = rgbe + i * 4;
            float scale = p[3] ? ldexpf(1.0f, (int)p[3] - 136) : 0.0f;
            rgba[i * 4] = ((float)p[0] + 0.5f) * scale;
            rgba[i * 4 + 1] = ((float)p[1] + 0.5f) * scale;
            rgba[i * 4 + 2] = ((float)p[2] + 0.5f) * scale;
            rgba[i * 4 + 3] = 1.0f;
        }
        g3_f32_slice pixels = { rgba, (int64_t)pixel_count * 4 };
        g3p_upload_texture_hdr(id, pixels, width, height);
    }
    free(rgbe); free(rgba); free(scanline); free(channel_data);
    return (uint8_t)ok;
}

void g3p_upload_texture(int32_t id, g3_u8_slice pixels, int32_t width, int32_t height) {
    upload_texture(id, pixels, width, height, 0);
}
void g3p_upload_texture_srgb(int32_t id, g3_u8_slice pixels, int32_t width, int32_t height) {
    upload_texture(id, pixels, width, height, 1);
}

void g3p_release_texture(int32_t id) {
    if (id < 0 || id >= texture_count) return;
    soft_texture *t = &textures[id];
    free(t->pixels);
    free(t->hdr_pixels);
    free(t->target_fb); free(t->target_hdr_fb); free(t->target_depth);
    for (int j = 0; j < 31; j++) {
        free(t->mips[j]); free(t->env_mips[j]);
        free(t->hdr_mips[j]); free(t->hdr_env_mips[j]);
    }
    memset(t, 0, sizeof(*t));
}

uint8_t g3p_create_render_target(int32_t id, int32_t width, int32_t height) {
    if (id < 0 || width <= 0 || height <= 0 || width > 4096 || height > 4096 ||
        (uint64_t)width * (uint64_t)height > 4194304ull) return 0;
    if (id >= texture_count) {
        soft_texture *grown = realloc(textures, ((size_t)id + 1) * sizeof(*textures));
        if (!grown) return 0;
        textures = grown;
        memset(textures + texture_count, 0, ((size_t)id + 1 - (size_t)texture_count) * sizeof(*textures));
        texture_count = id + 1;
    }
    size_t pixels = (size_t)width * (size_t)height;
    if (pixels > SIZE_MAX / (sizeof(float) * 4)) return 0;
    soft_texture *t = &textures[id];
    float *sample = calloc(pixels * 4, sizeof(float));
    uint8_t *rgb = calloc(pixels * 3, 1);
    float *hdr = calloc(pixels * 3, sizeof(float));
    float *z = malloc(pixels * sizeof(float));
    if (!sample || !rgb || !hdr || !z) { free(sample); free(rgb); free(hdr); free(z); return 0; }
    for (size_t i = 0; i < pixels; i++) { sample[i*4+3] = 1.0f; z[i] = 1.0f; }
    free(t->pixels); free(t->hdr_pixels);
    for (int j = 0; j < 31; j++) { free(t->mips[j]); free(t->env_mips[j]); free(t->hdr_mips[j]); free(t->hdr_env_mips[j]); }
    memset(t, 0, sizeof(*t));
    t->hdr_pixels = sample; t->w = width; t->h = height; t->levels = 1; t->min_filter = t->mag_filter = 9729;
    t->target_fb = rgb; t->target_hdr_fb = hdr; t->target_depth = z;
    return 1;
}

int32_t g3p_texture_width(int32_t id) { return id >= 0 && id < texture_count ? textures[id].w : 0; }
int32_t g3p_texture_height(int32_t id) { return id >= 0 && id < texture_count ? textures[id].h : 0; }

uint8_t g3p_resize_render_target(int32_t id, int32_t width, int32_t height) {
    if (id < 0 || id >= texture_count || !textures[id].target_fb || width <= 0 || height <= 0 ||
        width > 4096 || height > 4096 || (uint64_t)width * (uint64_t)height > 4194304ull) return 0;
    size_t pixels = (size_t)width * (size_t)height;
    float *sample = calloc(pixels * 4, sizeof(float));
    uint8_t *rgb = calloc(pixels * 3, 1);
    float *hdr = calloc(pixels * 3, sizeof(float));
    float *z = malloc(pixels * sizeof(float));
    if (!sample || !rgb || !hdr || !z) { free(sample); free(rgb); free(hdr); free(z); return 0; }
    for (size_t i = 0; i < pixels; i++) { sample[i*4+3] = 1.0f; z[i] = 1.0f; }
    soft_texture *t = &textures[id];
    int keep_mips = t->levels > 1;
    free(t->hdr_pixels); free(t->target_fb); free(t->target_hdr_fb); free(t->target_depth);
    for (int j = 0; j < 31; j++) { free(t->mips[j]); free(t->env_mips[j]); free(t->hdr_mips[j]); free(t->hdr_env_mips[j]);
        t->mips[j] = t->env_mips[j] = NULL; t->hdr_mips[j] = t->hdr_env_mips[j] = NULL; }
    t->hdr_pixels = sample; t->target_fb = rgb; t->target_hdr_fb = hdr; t->target_depth = z;
    t->w = width; t->h = height; t->levels = 1; t->env_levels = 0;
    if (keep_mips) g3p_texture_generate_mips(id);
    return 1;
}

static int samples_texture(const g3_draw_item *it, int32_t id) {
    return it->texture == id || it->metallic_roughness_texture == id || it->normal_texture == id ||
           it->occlusion_texture == id || it->emissive_texture == id || it->specular_texture == id ||
           it->specular_color_texture == id || it->clearcoat_texture == id ||
           it->clearcoat_roughness_texture == id || it->clearcoat_normal_texture == id ||
           it->sheen_color_texture == id || it->sheen_roughness_texture == id || it->anisotropy_texture == id;
}

void g3p_texture_wrap(int32_t id, int32_t wrap_u, int32_t wrap_v) {
    if (id < 0 || id >= texture_count || (!textures[id].pixels && !textures[id].hdr_pixels) || wrap_u < 0 || wrap_u > 2 || wrap_v < 0 || wrap_v > 2) return;
    textures[id].wrap_u = wrap_u;
    textures[id].wrap_v = wrap_v;
}

/* Generate each level with bilinear sampling at destination texel centres.
   This also handles non-power-of-two dimensions and preserves alpha. */
static void generate_mips(soft_texture *t) {
    if (t->hdr_pixels) {
        int w = t->w, h = t->h;
        const float *src = t->hdr_pixels;
        while ((w > 1 || h > 1) && t->levels < 32) {
            int nw = w > 1 ? w / 2 : 1, nh = h > 1 ? h / 2 : 1;
            float *dst = malloc((size_t)nw * (size_t)nh * 4 * sizeof(float));
            if (!dst) { fprintf(stderr, "g3_soft: out of memory for HDR mipmaps\n"); exit(1); }
            for (int y = 0; y < nh; y++) for (int x = 0; x < nw; x++) {
                float sx = ((x + 0.5f) * w / nw) - 0.5f, sy = ((y + 0.5f) * h / nh) - 0.5f;
                int x0 = (int)floorf(sx), y0 = (int)floorf(sy);
                int x1 = x0 + 1 < w ? x0 + 1 : x0, y1 = y0 + 1 < h ? y0 + 1 : y0;
                float fx = sx - x0, fy = sy - y0;
                for (int c = 0; c < 4; c++) {
                    float a=src[((size_t)y0*w+x0)*4+c], b=src[((size_t)y0*w+x1)*4+c];
                    float d=src[((size_t)y1*w+x0)*4+c], e=src[((size_t)y1*w+x1)*4+c];
                    dst[((size_t)y*nw+x)*4+c] = (a+(b-a)*fx)*(1-fy)+(d+(e-d)*fx)*fy;
                }
            }
            t->hdr_mips[t->levels - 1] = dst;
            t->levels++;
            src = dst; w = nw; h = nh;
        }
        return;
    }
    int w = t->w, h = t->h;
    const uint8_t *src = t->pixels;
    while ((w > 1 || h > 1) && t->levels < 32) {
        int nw = w > 1 ? w / 2 : 1, nh = h > 1 ? h / 2 : 1;
        uint8_t *dst = malloc((size_t)nw * (size_t)nh * 4);
        if (!dst) { fprintf(stderr, "g3_soft: out of memory for mipmaps\n"); exit(1); }
        for (int y = 0; y < nh; y++) for (int x = 0; x < nw; x++) {
            float sx = ((x + 0.5f) * w / nw) - 0.5f, sy = ((y + 0.5f) * h / nh) - 0.5f;
            int x0 = (int)floorf(sx), y0 = (int)floorf(sy);
            int x1 = x0 + 1 < w ? x0 + 1 : x0, y1 = y0 + 1 < h ? y0 + 1 : y0;
            float fx = sx - x0, fy = sy - y0;
            for (int c = 0; c < 4; c++) {
                float a=src[((size_t)y0*w+x0)*4+c]/255.0f, b=src[((size_t)y0*w+x1)*4+c]/255.0f;
                float d=src[((size_t)y1*w+x0)*4+c]/255.0f, e=src[((size_t)y1*w+x1)*4+c]/255.0f;
                if (t->srgb && c < 3) { a=srgb_decode(a); b=srgb_decode(b); d=srgb_decode(d); e=srgb_decode(e); }
                float value=(a+(b-a)*fx)*(1-fy)+(d+(e-d)*fx)*fy;
                if (t->srgb && c < 3) value=srgb_encode(value);
                dst[((size_t)y*nw+x)*4+c] = (uint8_t)(value * 255.0f + 0.5f);
            }
        }
        t->mips[t->levels - 1] = dst;
        t->levels++;
        src = dst; w = nw; h = nh;
    }
}

void g3p_texture_filter(int32_t id, int32_t min_filter, int32_t mag_filter) {
    int valid_min = min_filter == 9728 || min_filter == 9729 || (min_filter >= 9984 && min_filter <= 9987);
    if (id < 0 || id >= texture_count || (!textures[id].pixels && !textures[id].hdr_pixels) || !valid_min || (mag_filter != 9728 && mag_filter != 9729)) return;
    soft_texture *t = &textures[id];
    if (min_filter >= 9984 && t->levels == 1) generate_mips(t);
    t->min_filter = min_filter;
    t->mag_filter = mag_filter;
}

void g3p_texture_generate_mips(int32_t id) {
    if (id < 0 || id >= texture_count || (!textures[id].pixels && !textures[id].hdr_pixels)) return;
    if (textures[id].levels == 1) generate_mips(&textures[id]);
}

/* Resizing a headless surface means reallocating the framebuffer and the z
   buffer; the meshes stay where they are. */
int g3_backend_resize(int w, int h) {
    int32_t nw = w, nh = h;
    size_t pixels = (size_t)nw * (size_t)nh;
    uint8_t *nfb = (uint8_t *)calloc(pixels * 3, 1);
    float *nhdr = (float *)calloc(pixels * 3, sizeof(float));
    float *nd = (float *)malloc(sizeof(float) * pixels);
    if (!nfb || !nhdr || !nd) { free(nfb); free(nhdr); free(nd); return 0; }
    for (size_t i = 0; i < pixels; i++) nd[i] = 1.0f;
    free(fb);
    free(hdr_fb);
    free(depth);
    fb = nfb;
    hdr_fb = nhdr;
    depth = nd;
    fb_w = nw;
    fb_h = nh;
    return 1;
}

/* --- shading: the GLSL in g3_web.c, term for term --- */

static void sample_texture(int32_t id, float u, float v, float rho, float out[4]);
static void sample_environment_lod(int32_t id, float u, float v, float lod, float out[4]);
static float shadow_visibility(const g3_view_state *vs, g3_vec3 wp);
static float point_shadow_visibility(const g3_view_state *vs, g3_vec3 wp, int light_index);
static float spot_shadow_visibility(const g3_view_state *vs, g3_vec3 wp);

static int shadow_map_size(const g3_view_state *vs) {
    return vs->shadow_resolution == 256 || vs->shadow_resolution == 512 || vs->shadow_resolution == 1024 ? vs->shadow_resolution : 512;
}

static float shadow_depth_visibility(const float *map, int size, int px, int py, float z, float bias, int radius) {
    if (radius < 0) radius = 0;
    if (radius > 2) radius = 2;
    int visible = 0, samples = 0;
    for (int y=-radius; y<=radius; y++) for (int x=-radius; x<=radius; x++) {
        int sx=px+x, sy=py+y;
        if (sx<0) sx=0; else if (sx>=size) sx=size-1;
        if (sy<0) sy=0; else if (sy>=size) sy=size-1;
        visible += z-bias <= map[sy*size+sx];
        samples++;
    }
    return samples ? (float)visible/(float)samples : 1.0f;
}

/* glTF metallic-roughness direct BRDF: GGX, correlated Smith, Schlick. */
static float dielectric_f0(float ior) {
    float bounded = fmaxf(1.0f, fminf(ior, 2.333f));
    float ratio = (bounded - 1.0f) / (bounded + 1.0f);
    return ratio * ratio;
}

static void pbr_light(g3_vec3 n, g3_vec3 v, g3_vec3 l, const float base[3],
                      float metallic, float roughness, float ior, float specular_strength,
                      const float specular_color[3], float out[3]) {
    float nl = fmaxf(n.x*l.x + n.y*l.y + n.z*l.z, 0.0f);
    float nv = fmaxf(n.x*v.x + n.y*v.y + n.z*v.z, 0.0f);
    if (nl <= 0.0f || nv <= 0.0f) { out[0] = out[1] = out[2] = 0.0f; return; }
    float hx = l.x + v.x, hy = l.y + v.y, hz = l.z + v.z;
    float len = sqrtf(hx*hx + hy*hy + hz*hz);
    if (len <= 1e-12f) { out[0] = out[1] = out[2] = 0.0f; return; }
    hx /= len; hy /= len; hz /= len;
    float nh = fmaxf(n.x*hx + n.y*hy + n.z*hz, 0.0f);
    float vh = fmaxf(v.x*hx + v.y*hy + v.z*hz, 0.0f);
    float rough = fmaxf(0.045f, fminf(roughness, 1.0f));
    float alpha = rough * rough, a2 = alpha * alpha;
    float denom = nh*nh*(a2 - 1.0f) + 1.0f;
    float distribution = a2 / (3.14159265359f * denom * denom);
    float gv = nl * sqrtf(nv*nv*(1.0f-a2)+a2);
    float gl = nv * sqrtf(nl*nl*(1.0f-a2)+a2);
    float visibility = 0.5f / fmaxf(gv + gl, 1e-6f);
    float m = fmaxf(0.0f, fminf(metallic, 1.0f));
    float dielectric = dielectric_f0(ior);
    float fresnel_weight = powf(1.0f - fminf(vh, 1.0f), 5.0f);
    float f_values[3];
    for (int i = 0; i < 3; i++) {
        float dc = fmaxf(0.0f, fminf(dielectric*specular_color[i], 1.0f));
        float f0 = dc*(1.0f-m) + base[i]*m;
        float strength = specular_strength*(1.0f-m)+m;
        f_values[i] = (f0 + (1.0f-f0)*fresnel_weight)*strength;
    }
    for (int i = 0; i < 3; i++) {
        out[i] = ((1.0f-f_values[i])*(1.0f-m)*base[i]/3.14159265359f + distribution*visibility*f_values[i])*nl;
    }
}

static void pbr_anisotropic_light(g3_vec3 n, g3_vec3 v, g3_vec3 l, g3_vec3 t, g3_vec3 b,
                                  const float base[3], float metallic, float roughness, float ior,
                                  float specular_strength, const float specular_color[3],
                                  float strength, float out[3]) {
    float nl=fmaxf(n.x*l.x+n.y*l.y+n.z*l.z,0.0f), nv=fmaxf(n.x*v.x+n.y*v.y+n.z*v.z,0.0f);
    float hx=l.x+v.x,hy=l.y+v.y,hz=l.z+v.z,hl=sqrtf(hx*hx+hy*hy+hz*hz);
    if(nl<=0.0f||nv<=0.0f||hl<=1e-12f){out[0]=out[1]=out[2]=0.0f;return;}
    hx/=hl;hy/=hl;hz/=hl;
    float rough=fmaxf(0.045f,fminf(roughness,1.0f));
    float alpha=rough*rough,at=alpha+(1.0f-alpha)*strength*strength,ab=alpha;
    float th=t.x*hx+t.y*hy+t.z*hz,bh=b.x*hx+b.y*hy+b.z*hz,nh=fmaxf(n.x*hx+n.y*hy+n.z*hz,0.0f);
    float a2=at*ab,fx=ab*th,fy=at*bh,fz=a2*nh,w2=a2/fmaxf(fx*fx+fy*fy+fz*fz,1e-12f);
    float distribution=a2*w2*w2/3.14159265359f;
    float gv=nl*sqrtf(at*at*(t.x*v.x+t.y*v.y+t.z*v.z)*(t.x*v.x+t.y*v.y+t.z*v.z)+ab*ab*(b.x*v.x+b.y*v.y+b.z*v.z)*(b.x*v.x+b.y*v.y+b.z*v.z)+nv*nv);
    float gl=nv*sqrtf(at*at*(t.x*l.x+t.y*l.y+t.z*l.z)*(t.x*l.x+t.y*l.y+t.z*l.z)+ab*ab*(b.x*l.x+b.y*l.y+b.z*l.z)*(b.x*l.x+b.y*l.y+b.z*l.z)+nl*nl);
    float visibility=fminf(1.0f,0.5f/fmaxf(gv+gl,1e-6f));
    float vh=fmaxf(v.x*hx+v.y*hy+v.z*hz,0.0f),m=fmaxf(0.0f,fminf(metallic,1.0f));
    float fresnel_weight=powf(1.0f-vh,5.0f),dielectric=dielectric_f0(ior);
    for(int i=0;i<3;i++){
        float dc=fmaxf(0.0f,fminf(dielectric*specular_color[i],1.0f));
        float f0=dc*(1.0f-m)+base[i]*m;
        float f=(f0+(1.0f-f0)*fresnel_weight)*(specular_strength*(1.0f-m)+m);
        out[i]=((1.0f-f)*(1.0f-m)*base[i]/3.14159265359f+distribution*visibility*f)*nl;
    }
}

static void sheen_light(g3_vec3 n,g3_vec3 v,g3_vec3 l,const float color[3],float rough,float out[3]) {
    float nl=fmaxf(n.x*l.x+n.y*l.y+n.z*l.z,0.0f), nv=fmaxf(n.x*v.x+n.y*v.y+n.z*v.z,0.0f);
    float hx=l.x+v.x,hy=l.y+v.y,hz=l.z+v.z,hl=sqrtf(hx*hx+hy*hy+hz*hz);
    if(nl<=0.0f||nv<=0.0f||hl<=1e-12f){out[0]=out[1]=out[2]=0.0f;return;}
    hx/=hl;hy/=hl;hz/=hl;
    float nh=fmaxf(n.x*hx+n.y*hy+n.z*hz,0.0f),inv=1.0f/fmaxf(rough,0.07f);
    float d=(2.0f+inv)*powf(fmaxf(1.0f-nh*nh,0.0f),0.5f*inv)/6.28318530718f;
    float vis=1.0f/fmaxf(4.0f*(nl+nv-nl*nv),1e-6f);
    for(int c=0;c<3;c++)out[c]=color[c]*d*vis*nl;
}

static void sample_brdf_lut(float nv, float roughness, float *a, float *b) {
    int size=G3_BRDF_LUT_SIZE;
    float x=fmaxf(0.0f,fminf(nv,1.0f))*size-0.5f;
    float y=fmaxf(0.0f,fminf(roughness,1.0f))*size-0.5f;
    int x0=(int)floorf(x),y0=(int)floorf(y);float fx=x-x0,fy=y-y0;
    int x1=x0+1,y1=y0+1;
    if(x0<0)x0=0;
    if(x1<0)x1=0;
    if(y0<0)y0=0;
    if(y1<0)y1=0;
    if(x0>=size)x0=size-1;
    if(x1>=size)x1=size-1;
    if(y0>=size)y0=size-1;
    if(y1>=size)y1=size-1;
    float values[2]={0.0f,0.0f};
    for(int c=0;c<2;c++){
        float p00=brdf_lut[((size_t)y0*size+x0)*4+c]/255.0f;
        float p10=brdf_lut[((size_t)y0*size+x1)*4+c]/255.0f;
        float p01=brdf_lut[((size_t)y1*size+x0)*4+c]/255.0f;
        float p11=brdf_lut[((size_t)y1*size+x1)*4+c]/255.0f;
        values[c]=(p00+(p10-p00)*fx)*(1.0f-fy)+(p01+(p11-p01)*fx)*fy;
    }
    *a=values[0];*b=values[1];
}

static void shade(const g3_draw_item *it, const g3_view_state *vs,
                  const g3_vec3 wp, g3_vec3 n, g3_vec3 clearcoat_n, const float tex[3], const float vertex_color[4], const float mr[4], float ao,
const float emission[3], float specular_strength, const float specular_color[3],
float material_clearcoat, float material_clearcoat_roughness, const float sheen_color[3], float sheen_roughness,
g3_vec3 anisotropy_t, g3_vec3 anisotropy_b, float anisotropy_strength, float *out_rgb) {
    float len = sqrtf(n.x * n.x + n.y * n.y + n.z * n.z);
    if (len > 1e-12f) { n.x /= len; n.y /= len; n.z /= len; }
    else { n.x = n.y = n.z = 0.0f; }
    float coat_len=sqrtf(clearcoat_n.x*clearcoat_n.x+clearcoat_n.y*clearcoat_n.y+clearcoat_n.z*clearcoat_n.z);
    if(coat_len>1e-12f){clearcoat_n.x/=coat_len;clearcoat_n.y/=coat_len;clearcoat_n.z/=coat_len;}

    const float lx = -vs->light_dir.x, ly = -vs->light_dir.y, lz = -vs->light_dir.z;
    float diff = n.x * lx + n.y * ly + n.z * lz;
    if (diff < 0.0f) diff = 0.0f;

    float vx = vs->view_direction.w > 0.5f ? vs->view_direction.x : vs->eye.x - wp.x;
    float vy = vs->view_direction.w > 0.5f ? vs->view_direction.y : vs->eye.y - wp.y;
    float vz = vs->view_direction.w > 0.5f ? vs->view_direction.z : vs->eye.z - wp.z;
    float vl = sqrtf(vx * vx + vy * vy + vz * vz);
    if (vl > 1e-12f) { vx /= vl; vy /= vl; vz /= vl; }
    float hx = lx + vx, hy = ly + vy, hz = lz + vz;
    float hl = sqrtf(hx * hx + hy * hy + hz * hz);
    if (hl > 1e-12f) { hx /= hl; hy /= hl; hz /= hl; }
    float nh = n.x * hx + n.y * hy + n.z * hz;
    if (nh < 0.0f) nh = 0.0f;
    float shine = it->params.z > 1.0f ? it->params.z : 1.0f;
    float spec = powf(nh, shine) * it->params.y;

    float amb = vs->ambient.w;
    float visible = shadow_visibility(vs, wp);
    float coat_factor = fmaxf(0.0f, fminf(material_clearcoat, 1.0f));
    float coat_roughness = fmaxf(0.045f, fminf(material_clearcoat_roughness, 1.0f));
    float coat[3] = {0.0f, 0.0f, 0.0f};
    float base[3] = { it->color.x * vertex_color[0] * tex[0], it->color.y * vertex_color[1] * tex[1], it->color.z * vertex_color[2] * tex[2] };
    float r = base[0] * (vs->ambient.x * amb * ao + vs->light_color.x * diff * visible) + vs->light_color.x * spec * visible;
    float g = base[1] * (vs->ambient.y * amb * ao + vs->light_color.y * diff * visible) + vs->light_color.y * spec * visible;
    float b = base[2] * (vs->ambient.z * amb * ao + vs->light_color.z * diff * visible) + vs->light_color.z * spec * visible;
    float metallic = it->pbr.y * mr[2], roughness = it->pbr.z * mr[1];
    if (it->pbr.x > 0.5f) {
        float brdf[3];
        if (anisotropy_strength > 0.0f) pbr_anisotropic_light(n,(g3_vec3){vx,vy,vz},(g3_vec3){lx,ly,lz},anisotropy_t,anisotropy_b,base,metallic,roughness,it->pbr.w,specular_strength,specular_color,anisotropy_strength,brdf);
        else pbr_light(n, (g3_vec3){vx,vy,vz}, (g3_vec3){lx,ly,lz}, base, metallic, roughness, it->pbr.w, specular_strength, specular_color, brdf);
        float sheen[3]; sheen_light(n,(g3_vec3){vx,vy,vz},(g3_vec3){lx,ly,lz},sheen_color,sheen_roughness,sheen);
        for(int c=0;c<3;c++)brdf[c]+=sheen[c];
        if (coat_factor > 0.0f) {
            float layer[3];
            pbr_light(clearcoat_n,(g3_vec3){vx,vy,vz},(g3_vec3){lx,ly,lz},(float[3]){0,0,0},0.0f,coat_roughness,1.5f,1.0f,(float[3]){1,1,1},layer);
            for (int c=0;c<3;c++) coat[c] += layer[c]*(c==0?vs->light_color.x:c==1?vs->light_color.y:vs->light_color.z)*visible*coat_factor;
        }
        float metal = fmaxf(0.0f, fminf(metallic, 1.0f));
        float diffuse = 1.0f-metal;
        r = base[0]*vs->ambient.x*amb*diffuse*ao + brdf[0]*vs->light_color.x*visible;
        g = base[1]*vs->ambient.y*amb*diffuse*ao + brdf[1]*vs->light_color.y*visible;
        b = base[2]*vs->ambient.z*amb*diffuse*ao + brdf[2]*vs->light_color.z*visible;
    }
    float sky = n.y * 0.5f + 0.5f;
    float env_scale = it->pbr.x > 0.5f ? 1.0f - fmaxf(0.0f, fminf(metallic, 1.0f)) : 1.0f;
    if (sky < 0.0f) sky = 0.0f;
    if (sky > 1.0f) sky = 1.0f;
    r += base[0] * (vs->env_ground.x * (1.0f - sky) + vs->env_sky.x * sky) * vs->env_sky.w * env_scale * ao * it->environment_intensity;
    g += base[1] * (vs->env_ground.y * (1.0f - sky) + vs->env_sky.y * sky) * vs->env_sky.w * env_scale * ao * it->environment_intensity;
    b += base[2] * (vs->env_ground.z * (1.0f - sky) + vs->env_sky.z * sky) * vs->env_sky.w * env_scale * ao * it->environment_intensity;
    if (vs->environment_texture >= 0 && vs->environment_texture < texture_count &&
        (textures[vs->environment_texture].pixels || textures[vs->environment_texture].hdr_pixels)) {
        float env[4];
        float y = n.y < -1.0f ? -1.0f : n.y > 1.0f ? 1.0f : n.y;
        float env_x = n.x * vs->env_rotation.x + n.z * vs->env_rotation.y;
        float env_z = -n.x * vs->env_rotation.y + n.z * vs->env_rotation.x;
        sample_environment_lod(vs->environment_texture, atan2f(env_z, env_x) / 6.28318530718f + 0.5f,
                               acosf(y) / 3.14159265359f, 0.0f, env);
        r += base[0] * env[0] * vs->environment_intensity * env_scale * ao * it->environment_intensity;
        g += base[1] * env[1] * vs->environment_intensity * env_scale * ao * it->environment_intensity;
        b += base[2] * env[2] * vs->environment_intensity * env_scale * ao * it->environment_intensity;
        if (it->pbr.x > 0.5f) {
            float rx=2.0f*(n.x*vx+n.y*vy+n.z*vz)*n.x-vx;
            float ry=2.0f*(n.x*vx+n.y*vy+n.z*vz)*n.y-vy;
            float rz=2.0f*(n.x*vx+n.y*vy+n.z*vz)*n.z-vz;
            if(anisotropy_strength>0.0f){
                float cx=anisotropy_b.y*vz-anisotropy_b.z*vy,cy=anisotropy_b.z*vx-anisotropy_b.x*vz,cz=anisotropy_b.x*vy-anisotropy_b.y*vx;
                float bx=cy*anisotropy_b.z-cz*anisotropy_b.y,by=cz*anisotropy_b.x-cx*anisotropy_b.z,bz=cx*anisotropy_b.y-cy*anisotropy_b.x;
                float bl=sqrtf(bx*bx+by*by+bz*bz);if(bl>1e-12f){bx/=bl;by/=bl;bz/=bl;}
                float mixv=powf(1.0f-anisotropy_strength*(1.0f-fmaxf(0.0f,fminf(roughness,1.0f))),4.0f);
                bx=bx+(n.x-bx)*mixv;by=by+(n.y-by)*mixv;bz=bz+(n.z-bz)*mixv;bl=sqrtf(bx*bx+by*by+bz*bz);if(bl>1e-12f){bx/=bl;by/=bl;bz/=bl;}
                float vd=bx*vx+by*vy+bz*vz,rrx=2.0f*vd*bx-vx,rry=2.0f*vd*by-vy,rrz=2.0f*vd*bz-vz,q=roughness*roughness;
                rx=rrx+(bx-rrx)*q;ry=rry+(by-rry)*q;rz=rrz+(bz-rrz)*q;float rl=sqrtf(rx*rx+ry*ry+rz*rz);if(rl>1e-12f){rx/=rl;ry/=rl;rz/=rl;}
            }
            float rotated_rx = rx * vs->env_rotation.x + rz * vs->env_rotation.y;
            float rotated_rz = -rx * vs->env_rotation.y + rz * vs->env_rotation.x;
            float ryc=ry < -1.0f ? -1.0f : ry > 1.0f ? 1.0f : ry;
            float rough=fmaxf(0.045f,fminf(roughness,1.0f));
            soft_texture *environment=&textures[vs->environment_texture];
            int max_lod=environment->env_levels>1?environment->env_levels-1:environment->levels-1;
            float lod=rough*(float)max_lod, reflected[4];
            sample_environment_lod(vs->environment_texture,atan2f(rotated_rz,rotated_rx)/6.28318530718f+0.5f,
                                   acosf(ryc)/3.14159265359f,lod,reflected);
            float nv=fmaxf(n.x*vx+n.y*vy+n.z*vz,0.0f);
            float brdf_a,brdf_b;
            sample_brdf_lut(nv,rough,&brdf_a,&brdf_b);
            for (int c=0;c<3;c++) {
                float metal=fmaxf(0.0f,fminf(metallic,1.0f));
                float dc=fmaxf(0.0f,fminf(dielectric_f0(it->pbr.w)*specular_color[c],1.0f));
                float f0=dc*(1.0f-metal)+base[c]*metal;
                float strength=specular_strength*(1.0f-metal)+metal;
                float specular=reflected[c]*(f0*brdf_a+brdf_b)*strength*vs->environment_intensity*ao*it->environment_intensity;
                if (c==0) r+=specular; else if (c==1) g+=specular; else b+=specular;
            }
            if (coat_factor > 0.0f) {
                float coat_rough=fmaxf(0.045f,fminf(coat_roughness,1.0f));
                float coat_nv=fmaxf(clearcoat_n.x*vx+clearcoat_n.y*vy+clearcoat_n.z*vz,0.0f);
                float coat_dv=clearcoat_n.x*vx+clearcoat_n.y*vy+clearcoat_n.z*vz;
                float crx=2.0f*coat_dv*clearcoat_n.x-vx, cry=2.0f*coat_dv*clearcoat_n.y-vy, crz=2.0f*coat_dv*clearcoat_n.z-vz;
                float rotated_crx = crx * vs->env_rotation.x + crz * vs->env_rotation.y;
                float rotated_crz = -crx * vs->env_rotation.y + crz * vs->env_rotation.x;
                float coat_ry=cry < -1.0f ? -1.0f : cry > 1.0f ? 1.0f : cry;
                float coat_lod=coat_rough*(float)max_lod, coat_reflected[4], coat_a, coat_b;
                sample_environment_lod(vs->environment_texture,atan2f(rotated_crz,rotated_crx)/6.28318530718f+0.5f,
                                       acosf(coat_ry)/3.14159265359f,coat_lod,coat_reflected);
                sample_brdf_lut(coat_nv,coat_rough,&coat_a,&coat_b);
                for(int c=0;c<3;c++) coat[c]+=coat_reflected[c]*(0.04f*coat_a+coat_b)*vs->environment_intensity*ao*coat_factor*it->environment_intensity;
            }
            float sheen_nv=fmaxf(n.x*vx+n.y*vy+n.z*vz,0.0f);
            float sheen_fresnel=powf(1.0f-sheen_nv,5.0f);
            float sheen_lod=fmaxf(0.07f,fminf(sheen_roughness,1.0f))*(float)max_lod, sheen_reflected[4];
            sample_environment_lod(vs->environment_texture,atan2f(rotated_rz,rotated_rx)/6.28318530718f+0.5f,
                                   acosf(ryc)/3.14159265359f,sheen_lod,sheen_reflected);
            r+=sheen_color[0]*sheen_reflected[0]*vs->environment_intensity*ao*sheen_fresnel*it->environment_intensity;
            g+=sheen_color[1]*sheen_reflected[1]*vs->environment_intensity*ao*sheen_fresnel*it->environment_intensity;
            b+=sheen_color[2]*sheen_reflected[2]*vs->environment_intensity*ao*sheen_fresnel*it->environment_intensity;
        }
    }
    int count = vs->light_count < 0 ? 0 : vs->light_count > 8 ? 8 : vs->light_count;
    for (int i = 0; i < count; i++) {
        const g3_light *light = &vs->lights[i];
        float dx = light->position.x - wp.x, dy = light->position.y - wp.y, dz = light->position.z - wp.z;
        float distance = sqrtf(dx * dx + dy * dy + dz * dz);
        float ll = distance > 0.000001f ? distance : 0.000001f;
        float ex = light->position.w < 0.5f ? -light->direction.x : dx / ll;
        float ey = light->position.w < 0.5f ? -light->direction.y : dy / ll;
        float ez = light->position.w < 0.5f ? -light->direction.z : dz / ll;
        float falloff = 1.0f;
        if (light->position.w > 0.5f) {
            if (light->direction.w > 0.0f) {
                float range_fade = 1.0f - distance / light->direction.w;
                if (range_fade < 0.0f) range_fade = 0.0f;
                falloff *= range_fade * range_fade;
            }
            if (light->attenuation > 0.5f) {
                float distance_squared = distance * distance;
                if (distance_squared < 0.0001f) distance_squared = 0.0001f;
                falloff *= 1.0f / distance_squared;
            }
        }
        if (light->position.w > 1.5f) {
            float cone = (-ex * light->direction.x - ey * light->direction.y - ez * light->direction.z - light->color.w) / (light->inner - light->color.w);
            if (cone < 0.0f) cone = 0.0f;
            if (cone > 1.0f) cone = 1.0f;
            falloff *= cone * cone * (3.0f - 2.0f * cone);
        }
        if (vs->point_shadow_params.x > 0.5f && i == vs->point_shadow_light_index && light->position.w > 0.5f && light->position.w < 1.5f)
            falloff *= point_shadow_visibility(vs, wp, i);
        if (vs->spot_shadow_params.x > 0.5f && i == vs->spot_shadow_light_index && light->position.w > 1.5f)
            falloff *= spot_shadow_visibility(vs, wp);
        float d = n.x * ex + n.y * ey + n.z * ez;
        if (d < 0.0f) d = 0.0f;
        float ax = ex + vx, ay = ey + vy, az = ez + vz;
        float al = sqrtf(ax * ax + ay * ay + az * az);
        if (al > 1e-12f) { ax /= al; ay /= al; az /= al; }
        float nh2 = n.x * ax + n.y * ay + n.z * az;
        if (nh2 < 0.0f) nh2 = 0.0f;
        float s = powf(nh2, shine) * it->params.y;
        if (it->pbr.x > 0.5f) {
            float brdf[3];
            if (anisotropy_strength > 0.0f) pbr_anisotropic_light(n,(g3_vec3){vx,vy,vz},(g3_vec3){ex,ey,ez},anisotropy_t,anisotropy_b,base,metallic,roughness,it->pbr.w,specular_strength,specular_color,anisotropy_strength,brdf);
            else pbr_light(n, (g3_vec3){vx,vy,vz}, (g3_vec3){ex,ey,ez}, base, metallic, roughness, it->pbr.w, specular_strength, specular_color, brdf);
            float sheen[3]; sheen_light(n,(g3_vec3){vx,vy,vz},(g3_vec3){ex,ey,ez},sheen_color,sheen_roughness,sheen);
            for(int c=0;c<3;c++)brdf[c]+=sheen[c];
            r += brdf[0]*light->color.x*falloff; g += brdf[1]*light->color.y*falloff; b += brdf[2]*light->color.z*falloff;
            if (coat_factor > 0.0f) {
                float layer[3];
                pbr_light(clearcoat_n,(g3_vec3){vx,vy,vz},(g3_vec3){ex,ey,ez},(float[3]){0,0,0},0.0f,coat_roughness,1.5f,1.0f,(float[3]){1,1,1},layer);
                coat[0]+=layer[0]*light->color.x*falloff*coat_factor;
                coat[1]+=layer[1]*light->color.y*falloff*coat_factor;
                coat[2]+=layer[2]*light->color.z*falloff*coat_factor;
            }
        } else {
            r += (base[0] * d + s) * light->color.x * falloff;
            g += (base[1] * d + s) * light->color.y * falloff;
            b += (base[2] * d + s) * light->color.z * falloff;
        }
    }
    if (it->params.x > 0.5f) { r = base[0]; g = base[1]; b = base[2]; }
    r += emission[0]; g += emission[1]; b += emission[2];
    float coat_fresnel=0.04f+0.96f*powf(1.0f-fmaxf(clearcoat_n.x*vx+clearcoat_n.y*vy+clearcoat_n.z*vz,0.0f),5.0f);
    float coat_attenuation=1.0f-coat_factor*coat_fresnel;
    r=r*coat_attenuation+coat[0]; g=g*coat_attenuation+coat[1]; b=b*coat_attenuation+coat[2];

    float fog = 1.0f - expf(-vl * vs->fog.w);
    if (fog < 0.0f) fog = 0.0f;
    if (fog > 1.0f) fog = 1.0f;
    out_rgb[0] = r + (vs->fog.x - r) * fog;
    out_rgb[1] = g + (vs->fog.y - g) * fog;
    out_rgb[2] = b + (vs->fog.z - b) * fog;
}

/* --- one triangle --- */

static float clamp01(float v) {
    if (v < 0.0f) return 0.0f;
    if (v > 1.0f) return 1.0f;
    return v;
}

/* Reduce before converting to integer so large UVs cannot overflow. */
static float wrap_coordinate(float value, int mode) {
    if (mode == 0) return clamp01(value);
    if (mode == 1) return value - floorf(value);
    float v = fmodf(value, 2.0f);
    if (v < 0.0f) v += 2.0f;
    return v > 1.0f ? 2.0f - v : v;
}

static int wrap_index(int index, int size, int mode) {
    if (mode == 0) return index < 0 ? 0 : index >= size ? size - 1 : index;
    if (mode == 1) { int n = index % size; return n < 0 ? n + size : n; }
    /* Reduced mirror coordinates require only the adjacent edge texel. */
    return index < 0 ? 0 : index >= size ? size - 1 : index;
}

static void sample_level(const soft_texture *t, int level, int linear, float u, float v, float out[4]) {
    int w = t->w >> level, h = t->h >> level;
    if (w < 1) w = 1; if (h < 1) h = 1;
    if (t->hdr_pixels) {
        const float *pixels = level ? t->hdr_mips[level - 1] : t->hdr_pixels;
        float x = wrap_coordinate(u, t->wrap_u) * w;
        float y = wrap_coordinate(v, t->wrap_v) * h;
        if (!linear) {
            int ix = wrap_index((int)floorf(x), w, t->wrap_u);
            int iy = wrap_index((int)floorf(y), h, t->wrap_v);
            for (int c = 0; c < 4; c++) out[c] = pixels[((size_t)iy*w+ix)*4+c];
            return;
        }
        x -= 0.5f; y -= 0.5f;
        int x0 = (int)floorf(x), y0 = (int)floorf(y);
        float fx = x - x0, fy = y - y0;
        int x1 = x0 + 1, y1 = y0 + 1;
        x0 = wrap_index(x0, w, t->wrap_u); x1 = wrap_index(x1, w, t->wrap_u);
        y0 = wrap_index(y0, h, t->wrap_v); y1 = wrap_index(y1, h, t->wrap_v);
        for (int c = 0; c < 4; c++) {
            float a = pixels[((size_t)y0*w+x0)*4+c], b = pixels[((size_t)y0*w+x1)*4+c];
            float d = pixels[((size_t)y1*w+x0)*4+c], e = pixels[((size_t)y1*w+x1)*4+c];
            out[c] = (a+(b-a)*fx)*(1.0f-fy)+(d+(e-d)*fx)*fy;
        }
        return;
    }
    const uint8_t *pixels = level ? t->mips[level - 1] : t->pixels;
    float x = wrap_coordinate(u, t->wrap_u) * w;
    float y = wrap_coordinate(v, t->wrap_v) * h;
    if (!linear) {
        int ix = wrap_index((int)floorf(x), w, t->wrap_u);
        int iy = wrap_index((int)floorf(y), h, t->wrap_v);
        for (int c = 0; c < 4; c++) {
            out[c] = pixels[((size_t)iy*w+ix)*4+c] / 255.0f;
            if (t->srgb && c < 3) out[c] = srgb_decode(out[c]);
        }
        return;
    }
    x -= 0.5f; y -= 0.5f;
    int x0 = (int)floorf(x), y0 = (int)floorf(y);
    float fx = x - x0, fy = y - y0;
    int x1 = x0 + 1, y1 = y0 + 1;
    x0 = wrap_index(x0, w, t->wrap_u); x1 = wrap_index(x1, w, t->wrap_u);
    y0 = wrap_index(y0, h, t->wrap_v); y1 = wrap_index(y1, h, t->wrap_v);
    for (int c = 0; c < 4; c++) {
        float a = pixels[((size_t)y0 * w + x0) * 4 + c];
        float b = pixels[((size_t)y0 * w + x1) * 4 + c];
        float d = pixels[((size_t)y1 * w + x0) * 4 + c];
        float e = pixels[((size_t)y1 * w + x1) * 4 + c];
        if (t->srgb && c < 3) {
            a=srgb_decode(a/255.0f); b=srgb_decode(b/255.0f);
            d=srgb_decode(d/255.0f); e=srgb_decode(e/255.0f);
            out[c] = (a + (b - a) * fx) * (1.0f - fy) + (d + (e - d) * fx) * fy;
        } else {
            out[c] = ((a + (b - a) * fx) * (1.0f - fy) + (d + (e - d) * fx) * fy) / 255.0f;
        }
    }
}

/* rho is the texture footprint in texels per screen pixel. */
static void sample_texture(int32_t id, float u, float v, float rho, float out[4]) {
    out[0] = out[1] = out[2] = out[3] = 1.0f;
    if (id < 0 || id >= texture_count || (!textures[id].pixels && !textures[id].hdr_pixels)) return;
    const soft_texture *t = &textures[id];
    if (rho <= 1.0f) { sample_level(t, 0, t->mag_filter == 9729, u, v, out); return; }
    int f = t->min_filter;
    if (f == 9728 || f == 9729 || t->levels == 1) {
        sample_level(t, 0, f == 9729 || f == 9985 || f == 9987, u, v, out);
        return;
    }
    float lod = log2f(rho);
    if (lod > t->levels - 1) lod = (float)(t->levels - 1);
    int linear = f == 9985 || f == 9987;
    if (f == 9984 || f == 9985) {
        sample_level(t, (int)floorf(lod + 0.5f), linear, u, v, out);
    } else {
        int lo = (int)floorf(lod), hi = lo + 1 < t->levels ? lo + 1 : lo;
        float fraction = lod - lo, other[4];
        sample_level(t, lo, linear, u, v, out);
        sample_level(t, hi, linear, u, v, other);
        for (int c = 0; c < 4; c++) out[c] += (other[c] - out[c]) * fraction;
    }
}

static float post_luma(const float c[4]) { return 0.299f*c[0] + 0.587f*c[1] + 0.114f*c[2]; }

uint8_t g3p_post_process(int32_t source, int32_t destination, int32_t effect) {
    if (source < 0 || source >= texture_count || destination < 0 || destination >= texture_count ||
        source == destination || (!textures[source].pixels && !textures[source].hdr_pixels) ||
        !textures[destination].target_fb || effect < 0 || effect > 3) return 0;
    soft_texture *src = &textures[source], *dst = &textures[destination];
    int keep_mips = dst->levels > 1;
    for (int32_t y = 0; y < dst->h; y++) for (int32_t x = 0; x < dst->w; x++) {
        float u = ((float)x + 0.5f) / dst->w, v = ((float)y + 0.5f) / dst->h;
        float c[4]; sample_level(src, 0, 0, u, v, c);
        if (effect == 1) { float l = post_luma(c); c[0] = c[1] = c[2] = l; }
        else if (effect == 2) { c[0] = 1.0f-c[0]; c[1] = 1.0f-c[1]; c[2] = 1.0f-c[2]; }
        else if (effect == 3) {
            float du=1.0f/src->w, dv=1.0f/src->h;
            float left[4],right[4],up[4],down[4];
            sample_level(src, 0, 0, fmaxf(0.0f,u-du), v, left);
            sample_level(src, 0, 0, fminf(1.0f,u+du), v, right);
            sample_level(src, 0, 0, u, fmaxf(0.0f,v-dv), up);
            sample_level(src, 0, 0, u, fminf(1.0f,v+dv), down);
            float lc=post_luma(c), ll=post_luma(left), lr=post_luma(right), lu=post_luma(up), ld=post_luma(down);
            float lo=fminf(lc,fminf(fminf(ll,lr),fminf(lu,ld))), hi=fmaxf(lc,fmaxf(fmaxf(ll,lr),fmaxf(lu,ld)));
            if (hi-lo >= 0.125f) {
                float *a = fabsf(lr-ll) >= fabsf(ld-lu) ? left : up;
                float *b = fabsf(lr-ll) >= fabsf(ld-lu) ? right : down;
                for (int k=0;k<3;k++) c[k]=0.5f*(c[k]+0.5f*(a[k]+b[k]));
            }
        }
        size_t at=((size_t)y*dst->w+x)*4;
        for(int k=0;k<3;k++) dst->hdr_pixels[at+k]=floorf(fminf(fmaxf(c[k],0.0f),1.0f)*255.0f+0.5f)/255.0f;
        dst->hdr_pixels[at+3]=1.0f;
    }
    for (int j=0;j<31;j++) { free(dst->hdr_mips[j]); free(dst->hdr_env_mips[j]); dst->hdr_mips[j]=dst->hdr_env_mips[j]=NULL; }
    dst->levels=1; dst->env_levels=0;
    if (keep_mips) g3p_texture_generate_mips(destination);
    return 1;
}

uint8_t g3p_post_process_shader_create(int32_t id, g3_u8_slice body) { (void)id; (void)body; return 0; }
void g3p_post_process_shader_release(int32_t id) { (void)id; }
uint8_t g3p_material_shader_create(int32_t id, g3_u8_slice header, g3_u8_slice body, g3_u8_slice tail) { (void)id; (void)header; (void)body; (void)tail; return 0; }
void g3p_material_shader_release(int32_t id) { (void)id; }
void g3p_upload_texture_3d(int32_t id, g3_u8_slice pixels, int32_t width, int32_t height, int32_t depth) { (void)id; (void)pixels; (void)width; (void)height; (void)depth; }
void g3p_upload_texture_f16(int32_t id, g3_u8_slice pixels, int32_t width, int32_t height) { (void)id; (void)pixels; (void)width; (void)height; }
void g3p_upload_texture_3d_f16(int32_t id, g3_u8_slice pixels, int32_t width, int32_t height, int32_t depth) { (void)id; (void)pixels; (void)width; (void)height; (void)depth; }
uint8_t g3p_raw_shader_create(int32_t id, g3_u8_slice vertex, g3_u8_slice fragment) { (void)id; (void)vertex; (void)fragment; return 0; }
void g3p_raw_shader_release(int32_t id) { (void)id; }
uint8_t g3p_raw_shader_uniform(int32_t id, g3_u8_slice name, int32_t type, int32_t count, g3_f32_slice values) { (void)id; (void)name; (void)type; (void)count; (void)values; return 0; }
uint8_t g3p_raw_shader_uniform_texture(int32_t id, g3_u8_slice name, int32_t texture) { (void)id; (void)name; (void)texture; return 0; }
uint8_t g3p_post_process_shader_run(int32_t shader, int32_t source, int32_t destination) {
    (void)shader; (void)source; (void)destination; return 0;
}

/* Explicit trilinear LOD for roughness-filtered environment radiance. */
static void sample_texture_lod_from(const soft_texture *t, float u, float v, float lod, float out[4]) {
    out[0] = out[1] = out[2] = out[3] = 1.0f;
    if (!t || (!t->pixels && !t->hdr_pixels)) return;
    if (lod < 0.0f) lod = 0.0f;
    if (lod > t->levels - 1) lod = (float)(t->levels - 1);
    int lo=(int)floorf(lod), hi=lo+1<t->levels?lo+1:lo;
    float other[4], fraction=lod-lo;
    sample_level(t,lo,1,u,v,out);
    if (hi == lo) return;
    sample_level(t,hi,1,u,v,other);
    for (int c=0;c<4;c++) out[c]+=(other[c]-out[c])*fraction;
}

static void sample_environment_lod(int32_t id, float u, float v, float lod, float out[4]) {
    out[0]=out[1]=out[2]=out[3]=1.0f;
    if (id < 0 || id >= texture_count || (!textures[id].pixels && !textures[id].hdr_pixels)) return;
    soft_texture environment = textures[id];
    environment.wrap_u = 1; /* equirectangular longitude wraps */
    environment.wrap_v = 0; /* latitude clamps at the poles */
    if (environment.env_levels > 1) {
        environment.levels = environment.env_levels;
        for (int i=0; i<environment.env_levels-1; i++) {
            if (environment.hdr_pixels) environment.hdr_mips[i] = environment.hdr_env_mips[i];
            else environment.mips[i] = environment.env_mips[i];
        }
    }
    sample_texture_lod_from(&environment,u,v,lod,out);
}

static float radical_inverse_vdc(uint32_t bits) {
    bits=(bits<<16)|(bits>>16);
    bits=((bits&0x55555555u)<<1)|((bits&0xAAAAAAAAu)>>1);
    bits=((bits&0x33333333u)<<2)|((bits&0xCCCCCCCCu)>>2);
    bits=((bits&0x0F0F0F0Fu)<<4)|((bits&0xF0F0F0F0u)>>4);
    bits=((bits&0x00FF00FFu)<<8)|((bits&0xFF00FF00u)>>8);
    return (float)bits * 2.3283064365386963e-10f;
}

void g3p_texture_generate_env_mips(int32_t id) {
    if (id < 0 || id >= texture_count || (!textures[id].pixels && !textures[id].hdr_pixels)) return;
    soft_texture *t=&textures[id];
    if (t->env_levels > 1) return;
    int levels=1,w=t->w,h=t->h;
    while ((w>1 || h>1) && levels<32) { w=w>1?w/2:1; h=h>1?h/2:1; levels++; }
    t->env_levels=levels;
    soft_texture source=*t;
    source.wrap_u=1; source.wrap_v=0; source.levels=1;
    w=t->w; h=t->h;
    const int sample_count=32;
    for (int level=1; level<levels; level++) {
        int nw=w>1?w/2:1, nh=h>1?h/2:1;
        uint8_t *dst=t->hdr_pixels?NULL:malloc((size_t)nw*(size_t)nh*4);
        float *hdr_dst=t->hdr_pixels?malloc((size_t)nw*(size_t)nh*4*sizeof(float)):NULL;
        if ((!t->hdr_pixels && !dst) || (t->hdr_pixels && !hdr_dst)) { fprintf(stderr,"g3_soft: out of memory for GGX environment mipmaps\n"); exit(1); }
        float roughness=(float)level/(float)(levels-1), alpha=roughness*roughness, alpha2=alpha*alpha;
        for (int y=0;y<nh;y++) for (int x=0;x<nw;x++) {
            float u=((float)x+0.5f)/(float)nw, v=((float)y+0.5f)/(float)nh;
            float phi=(u-0.5f)*6.28318530718f, theta=v*3.14159265359f;
            float nx=sinf(theta)*cosf(phi), ny=cosf(theta), nz=sinf(theta)*sinf(phi);
            float ux=fabsf(ny)<0.999f?0.0f:1.0f, uy=fabsf(ny)<0.999f?1.0f:0.0f, uz=0.0f;
            float tx=uy*nz-uz*ny, ty=uz*nx-ux*nz, tz=ux*ny-uy*nx;
            float tl=sqrtf(tx*tx+ty*ty+tz*tz); tx/=tl; ty/=tl; tz/=tl;
            float bx=ny*tz-nz*ty, by=nz*tx-nx*tz, bz=nx*ty-ny*tx;
            float sum[3]={0,0,0}, weight=0.0f;
            for (uint32_t i=0;i<sample_count;i++) {
                float xi1=((float)i+0.5f)/(float)sample_count, xi2=radical_inverse_vdc(i);
                float sample_phi=6.28318530718f*xi1;
                float cos_theta=sqrtf((1.0f-xi2)/(1.0f+(alpha2-1.0f)*xi2));
                float sin_theta=sqrtf(fmaxf(0.0f,1.0f-cos_theta*cos_theta));
                float hx=tx*cosf(sample_phi)*sin_theta+bx*sinf(sample_phi)*sin_theta+nx*cos_theta;
                float hy=ty*cosf(sample_phi)*sin_theta+by*sinf(sample_phi)*sin_theta+ny*cos_theta;
                float hz=tz*cosf(sample_phi)*sin_theta+bz*sinf(sample_phi)*sin_theta+nz*cos_theta;
                float nh=fmaxf(nx*hx+ny*hy+nz*hz,0.0f);
                float lx=2.0f*nh*hx-nx, ly=2.0f*nh*hy-ny, lz=2.0f*nh*hz-nz;
                float nl=fmaxf(nx*lx+ny*ly+nz*lz,0.0f);
                if (nl<=0.0f) continue;
                float sample_u=atan2f(lz,lx)/6.28318530718f+0.5f;
                float sample_y=ly<-1.0f?-1.0f:ly>1.0f?1.0f:ly;
                float sample_v=acosf(sample_y)/3.14159265359f, rgba[4];
                sample_level(&source,0,1,sample_u,sample_v,rgba);
                for (int c=0;c<3;c++) sum[c]+=rgba[c]*nl;
                weight+=nl;
            }
            size_t offset=((size_t)y*nw+x)*4;
            for (int c=0;c<3;c++) {
                float value=weight>0.0f?sum[c]/weight:0.0f;
                if (t->hdr_pixels) hdr_dst[offset+c]=value;
                else {
                    if (t->srgb) value=srgb_encode(value);
                    dst[offset+c]=(uint8_t)(fmaxf(0.0f,fminf(value,1.0f))*255.0f+0.5f);
                }
            }
            if (t->hdr_pixels) hdr_dst[offset+3]=1.0f;
            else dst[offset+3]=255;
        }
        if (t->hdr_pixels) t->hdr_env_mips[level-1]=hdr_dst;
        else t->env_mips[level-1]=dst;
        w=nw; h=nh;
    }
}

/* Clip in homogeneous space before division. Interpolating object-space
   attributes at each intersection preserves perspective-correct interpolation
   after setup_triangle computes 1/w. A clipped triangle has at most 9 vertices. */
static float clip_distance(const g3_vertex *v, const g3_mat4 *m, int plane) {
    const float *p = &v->pos.x, *a = m->m;
    float x=a[0]*p[0]+a[4]*p[1]+a[8]*p[2]+a[12];
    float y=a[1]*p[0]+a[5]*p[1]+a[9]*p[2]+a[13];
    float z=a[2]*p[0]+a[6]*p[1]+a[10]*p[2]+a[14];
    float w=a[3]*p[0]+a[7]*p[1]+a[11]*p[2]+a[15];
    switch (plane) { case 0: return w+x; case 1: return w-x;
        case 2: return w+y; case 3: return w-y; case 4: return w+z; default: return w-z; }
}

static g3_vertex clip_lerp(g3_vertex a, g3_vertex b, float t) {
#define LERP(field) a.field += (b.field - a.field) * t
    LERP(pos.x); LERP(pos.y); LERP(pos.z);
    LERP(normal.x); LERP(normal.y); LERP(normal.z);
    LERP(uv.x); LERP(uv.y);
    LERP(uv1.x); LERP(uv1.y);
    LERP(uv2.x); LERP(uv2.y);
    LERP(uv3.x); LERP(uv3.y);
    LERP(uv4.x); LERP(uv4.y);
    LERP(uv5.x); LERP(uv5.y);
    LERP(uv6.x); LERP(uv6.y);
    LERP(uv7.x); LERP(uv7.y);
    LERP(tangent.x); LERP(tangent.y); LERP(tangent.z); LERP(tangent.w);
    LERP(color.x); LERP(color.y); LERP(color.z); LERP(color.w);
#undef LERP
    return a;
}

static int clip_triangle(const g3_draw_item *it, const g3_vertex *const tri[3], g3_vertex out[32]) {
    g3_vertex a[32], b[32];
    a[0] = *tri[0]; a[1] = *tri[1]; a[2] = *tri[2];
    int count = 3;
    for (int plane = 0; plane < 6 && count; plane++) {
        int next = 0;
        g3_vertex prev = a[count - 1];
        float dp = clip_distance(&prev, &it->mvp, plane);
        for (int j = 0; j < count; j++) {
            g3_vertex cur = a[j];
            float dc = clip_distance(&cur, &it->mvp, plane);
            if ((dp >= 0.0f) != (dc >= 0.0f)) {
                if (next == 32) return 0;
                b[next++] = clip_lerp(prev, cur, dp / (dp - dc));
            }
            if (dc >= 0.0f) {
                if (next == 32) return 0;
                b[next++] = cur;
            }
            prev = cur; dp = dc;
        }
        count = next;
        memcpy(a, b, (size_t)count * sizeof(*a));
    }
    memcpy(out, a, (size_t)count * sizeof(*out));
    return count;
}

/* Transform a clipped triangle and reject back faces or empty screen boxes. */
static int setup_triangle(const g3_draw_item *it, const g3_vertex *const tri[3], soft_tri *t) {
    float ndc[3][3];
    float normal_matrix[9];
    g3_normal_matrix(&it->model, normal_matrix);
    for (int k = 0; k < 3; k++) {
        const float *p = &tri[k]->pos.x;
        const float *m = it->mvp.m;
        float cx = m[0] * p[0] + m[4] * p[1] + m[8] * p[2] + m[12];
        float cy = m[1] * p[0] + m[5] * p[1] + m[9] * p[2] + m[13];
        float cz = m[2] * p[0] + m[6] * p[1] + m[10] * p[2] + m[14];
        float cw = m[3] * p[0] + m[7] * p[1] + m[11] * p[2] + m[15];
        if (cw <= 1e-6f) return 0;
        float w = 1.0f / cw;
        t->inv_w[k] = w;
        t->uv[k][0] = tri[k]->uv.x;
        t->uv[k][1] = tri[k]->uv.y;
        t->uv1[k][0] = tri[k]->uv1.x;
        t->uv1[k][1] = tri[k]->uv1.y;
        t->uv2[k][0] = tri[k]->uv2.x;
        t->uv2[k][1] = tri[k]->uv2.y;
        t->uv3[k][0] = tri[k]->uv3.x;
        t->uv3[k][1] = tri[k]->uv3.y;
        t->uv4[k][0] = tri[k]->uv4.x;
        t->uv4[k][1] = tri[k]->uv4.y;
        t->uv5[k][0] = tri[k]->uv5.x;
        t->uv5[k][1] = tri[k]->uv5.y;
        t->uv6[k][0] = tri[k]->uv6.x;
        t->uv6[k][1] = tri[k]->uv6.y;
        t->uv7[k][0] = tri[k]->uv7.x;
        t->uv7[k][1] = tri[k]->uv7.y;
        t->color[k][0] = tri[k]->color.x;
        t->color[k][1] = tri[k]->color.y;
        t->color[k][2] = tri[k]->color.z;
        t->color[k][3] = tri[k]->color.w;
        ndc[k][0] = cx * w;
        ndc[k][1] = cy * w;
        ndc[k][2] = cz * w;

        const float *nm = it->model.m;
        const float *n = &tri[k]->normal.x;
        t->nrm[k][0] = normal_matrix[0] * n[0] + normal_matrix[3] * n[1] + normal_matrix[6] * n[2];
        t->nrm[k][1] = normal_matrix[1] * n[0] + normal_matrix[4] * n[1] + normal_matrix[7] * n[2];
        t->nrm[k][2] = normal_matrix[2] * n[0] + normal_matrix[5] * n[1] + normal_matrix[8] * n[2];
        t->world[k][0] = nm[0] * p[0] + nm[4] * p[1] + nm[8] * p[2] + nm[12];
        t->world[k][1] = nm[1] * p[0] + nm[5] * p[1] + nm[9] * p[2] + nm[13];
        t->world[k][2] = nm[2] * p[0] + nm[6] * p[1] + nm[10] * p[2] + nm[14];
    }

    /* Derive the tangent frame from this triangle's world positions and UVs,
       matching the derivative-based frame in the WebGL fragment shader. */
    const float *model = it->model.m;
    float determinant = model[0] * (model[5] * model[10] - model[9] * model[6]) -
                        model[4] * (model[1] * model[10] - model[9] * model[2]) +
                        model[8] * (model[1] * model[6] - model[5] * model[2]);
    float orientation = determinant < 0.0f ? -1.0f : 1.0f;
    for (int k = 0; k < 3; k++) {
        const float *v = &tri[k]->tangent.x;
        t->tangent[k][0] = model[0] * v[0] + model[4] * v[1] + model[8] * v[2];
        t->tangent[k][1] = model[1] * v[0] + model[5] * v[1] + model[9] * v[2];
        t->tangent[k][2] = model[2] * v[0] + model[6] * v[1] + model[10] * v[2];
        t->tangent[k][3] = v[3] * orientation;
    }

    float normal_uv[3][2];
    const float (*normal_coords)[2] = triangle_uv(t, it->normal_uv.texcoord);
    for (int k=0;k<3;k++) transform_uv(&it->normal_uv,normal_coords[k][0],normal_coords[k][1],&normal_uv[k][0],&normal_uv[k][1]);
    float e1[3], e2[3], du1=normal_uv[1][0]-normal_uv[0][0], dv1=normal_uv[1][1]-normal_uv[0][1];
    float du2=normal_uv[2][0]-normal_uv[0][0], dv2=normal_uv[2][1]-normal_uv[0][1];
    for (int c=0;c<3;c++) { e1[c]=t->world[1][c]-t->world[0][c]; e2[c]=t->world[2][c]-t->world[0][c]; }
    float uv_det=du1*dv2-dv1*du2;
    if (fabsf(uv_det)>1e-12f) for (int c=0;c<3;c++) {
        t->derived_tangent[c]=(e1[c]*dv2-e2[c]*dv1)/uv_det;
        t->derived_bitangent[c]=(-e1[c]*du2+e2[c]*du1)/uv_det;
    } else { memset(t->derived_tangent,0,sizeof(t->derived_tangent)); memset(t->derived_bitangent,0,sizeof(t->derived_bitangent)); }

    /* Front faces are counterclockwise in NDC, which is what GL means by
       GL_CCW with the y-up window it uses. */
    float area = (ndc[1][0] - ndc[0][0]) * (ndc[2][1] - ndc[0][1]) -
                 (ndc[2][0] - ndc[0][0]) * (ndc[1][1] - ndc[0][1]);
    if (!it->double_sided && area <= 0.0f) return 0;
    t->normal_sign = area > 0.0f ? 1.0f : -1.0f;

    for (int k = 0; k < 3; k++) {
        t->sx[k] = (ndc[k][0] * 0.5f + 0.5f) * (float)fb_w;
        t->sy[k] = (1.0f - (ndc[k][1] * 0.5f + 0.5f)) * (float)fb_h;
        t->sz[k] = ndc[k][2] * 0.5f + 0.5f;
        /* Clipped points can round a few ulps beyond a depth plane. */
        if (t->sz[k] < 0.0f) t->sz[k] = 0.0f;
        if (t->sz[k] > 1.0f) t->sz[k] = 1.0f;
    }

    t->det = (t->sx[1] - t->sx[0]) * (t->sy[2] - t->sy[0]) -
             (t->sx[2] - t->sx[0]) * (t->sy[1] - t->sy[0]);
    if (fabsf(t->det) < 1e-9f) return 0;
    /* The screen y axis is flipped against ndc, so a front face has a
       negative det here. Folding that into a +-1 keeps the inner loop's
       edge test a multiply rather than a branch on the winding. */
    t->edge_sense = t->det > 0.0f ? 1.0f : -1.0f;

    float minx = t->sx[0], maxx = t->sx[0], miny = t->sy[0], maxy = t->sy[0];
    for (int k = 1; k < 3; k++) {
        if (t->sx[k] < minx) minx = t->sx[k];
        if (t->sx[k] > maxx) maxx = t->sx[k];
        if (t->sy[k] < miny) miny = t->sy[k];
        if (t->sy[k] > maxy) maxy = t->sy[k];
    }
    t->x0 = (int)floorf(minx);
    t->y0 = (int)floorf(miny);
    t->x1 = (int)ceilf(maxx);
    t->y1 = (int)ceilf(maxy);
    if (t->x0 < 0) t->x0 = 0;
    if (t->y0 < 0) t->y0 = 0;
    if (t->x1 > fb_w - 1) t->x1 = fb_w - 1;
    if (t->y1 > fb_h - 1) t->y1 = fb_h - 1;
    return t->x0 <= t->x1 && t->y0 <= t->y1;
}

static float shadow_visibility(const g3_view_state *vs, g3_vec3 wp) {
    if (vs->shadow_params.x < 0.5f) return 1.0f;
    const float *m = vs->shadow_view_proj.m;
    float x = m[0]*wp.x + m[4]*wp.y + m[8]*wp.z + m[12];
    float y = m[1]*wp.x + m[5]*wp.y + m[9]*wp.z + m[13];
    float z = m[2]*wp.x + m[6]*wp.y + m[10]*wp.z + m[14];
    float w = m[3]*wp.x + m[7]*wp.y + m[11]*wp.z + m[15];
    if (w <= 0.0f) return 1.0f;
    x = x / w * 0.5f + 0.5f; y = y / w * 0.5f + 0.5f; z = z / w * 0.5f + 0.5f;
    if (x < 0.0f || x >= 1.0f || y < 0.0f || y >= 1.0f || z < 0.0f || z > 1.0f) return 1.0f;
    int size=shadow_map_size(vs);
    int px = (int)(x * size), py = size - 1 - (int)(y * size);
    return shadow_depth_visibility(shadow_depth,size,px,py,z,vs->shadow_params.y,(int)(vs->shadow_params.z+0.5f));
}

static float point_shadow_visibility(const g3_view_state *vs, g3_vec3 wp, int light_index) {
    (void)light_index;
    const g3_light *light = &vs->lights[vs->point_shadow_light_index];
    float dx=wp.x-light->position.x, dy=wp.y-light->position.y, dz=wp.z-light->position.z;
    float ax=fabsf(dx), ay=fabsf(dy), az=fabsf(dz);
    int face = ax >= ay && ax >= az ? (dx >= 0.0f ? 0 : 1) : ay >= az ? (dy >= 0.0f ? 2 : 3) : (dz >= 0.0f ? 4 : 5);
    const float *m=vs->point_shadow_view_proj[face].m;
    float x=m[0]*wp.x+m[4]*wp.y+m[8]*wp.z+m[12];
    float y=m[1]*wp.x+m[5]*wp.y+m[9]*wp.z+m[13];
    float z=m[2]*wp.x+m[6]*wp.y+m[10]*wp.z+m[14];
    float w=m[3]*wp.x+m[7]*wp.y+m[11]*wp.z+m[15];
    if (w <= 0.0f) return 1.0f;
    x=x/w*0.5f+0.5f; y=y/w*0.5f+0.5f; z=z/w*0.5f+0.5f;
    if (x < 0.0f || x >= 1.0f || y < 0.0f || y >= 1.0f || z < 0.0f || z > 1.0f) return 1.0f;
    int size=shadow_map_size(vs);
    int px=(int)(x*size), py=size-1-(int)(y*size);
    return shadow_depth_visibility(point_shadow_depth[face],size,px,py,z,vs->point_shadow_params.y,(int)(vs->point_shadow_params.z+0.5f));
}

static float spot_shadow_visibility(const g3_view_state *vs, g3_vec3 wp) {
    const float *m=vs->spot_shadow_view_proj.m;
    float x=m[0]*wp.x+m[4]*wp.y+m[8]*wp.z+m[12];
    float y=m[1]*wp.x+m[5]*wp.y+m[9]*wp.z+m[13];
    float z=m[2]*wp.x+m[6]*wp.y+m[10]*wp.z+m[14];
    float w=m[3]*wp.x+m[7]*wp.y+m[11]*wp.z+m[15];
    if (w <= 0.0f) return 1.0f;
    x=x/w*0.5f+0.5f; y=y/w*0.5f+0.5f; z=z/w*0.5f+0.5f;
    if (x < 0.0f || x >= 1.0f || y < 0.0f || y >= 1.0f || z < 0.0f || z > 1.0f) return 1.0f;
    int size=shadow_map_size(vs);
    int px=(int)(x*size), py=size-1-(int)(y*size);
    return shadow_depth_visibility(spot_shadow_depth,size,px,py,z,vs->spot_shadow_params.y,(int)(vs->spot_shadow_params.z+0.5f));
}

/* Perspective-correct UV at a neighboring pixel, even if it lies just
   outside this triangle. These finite differences approximate GPU LOD. */
static void transform_uv(const g3_uv_transform *transform, float u, float v, float *out_u, float *out_v) {
    float c = cosf(transform->rotation), s = sinf(transform->rotation);
    float x = transform->scale.x * u, y = transform->scale.y * v;
    *out_u = transform->offset.x + c*x - s*y;
    *out_v = transform->offset.y + s*x + c*y;
}

static int uv_transform_identity(const g3_uv_transform *transform) {
    return transform->offset.x == 0.0f && transform->offset.y == 0.0f &&
           transform->scale.x == 1.0f && transform->scale.y == 1.0f && transform->rotation == 0.0f && transform->texcoord == 0;
}

static void interpolate_uv(const soft_tri *triangle, int set, float b0, float b1, float b2, float *u, float *v) {
    const float (*uv)[2] = triangle_uv(triangle, set);
    *u = uv[0][0]*b0+uv[1][0]*b1+uv[2][0]*b2;
    *v = uv[0][1]*b0+uv[1][1]*b1+uv[2][1]*b2;
}

static float texture_footprint(const soft_tri *t, int32_t id, const g3_uv_transform *transform, float l0, float l1, float l2, float u, float v) {
    if (id < 0 || id >= texture_count || (!textures[id].pixels && !textures[id].hdr_pixels)) return 0.0f;
    const soft_texture *tex = &textures[id];
    if (tex->min_filter == tex->mag_filter) return 0.0f;
    const float (*uv)[2] = triangle_uv(t, transform->texcoord);
    float dl0x = (t->sy[1] - t->sy[2]) / t->det;
    float dl1x = (t->sy[2] - t->sy[0]) / t->det;
    float dl0y = (t->sx[2] - t->sx[1]) / t->det;
    float dl1y = (t->sx[0] - t->sx[2]) / t->det;
    float d0[2] = { dl0x, dl0y }, d1[2] = { dl1x, dl1y };
    float center_u, center_v, max_sq = 0.0f;
    transform_uv(transform, u, v, &center_u, &center_v);
    for (int axis = 0; axis < 2; axis++) {
        float w0 = (l0+d0[axis])*t->inv_w[0], w1 = (l1+d1[axis])*t->inv_w[1];
        float w2 = (l2-d0[axis]-d1[axis])*t->inv_w[2];
        float sum = w0+w1+w2;
        if (sum <= 1e-12f) continue;
        float neighbor_u, neighbor_v;
        transform_uv(transform,
            (uv[0][0]*w0+uv[1][0]*w1+uv[2][0]*w2)/sum,
            (uv[0][1]*w0+uv[1][1]*w1+uv[2][1]*w2)/sum, &neighbor_u, &neighbor_v);
        float du = (neighbor_u-center_u)*tex->w;
        float dv = (neighbor_v-center_v)*tex->h;
        float sq = du*du+dv*dv;
        if (sq > max_sq) max_sq = sq;
    }
    return sqrtf(max_sq);
}

/* Rasterize the same opaque draw items from the light before the colour pass.
   Shadow map rows are top-first, like the main software framebuffer. */
static void render_shadow_map(g3_draw_item_slice items, const g3_view_state *vs, const g3_mat4 *light_matrix, float *target_depth, int size) {
    for (int i = 0; i < size * size; i++) target_depth[i] = 1.0f;
    int old_w = fb_w, old_h = fb_h;
    fb_w = fb_h = size;
    for (int64_t i = 0; i < items.len; i++) {
        const g3_draw_item *source = &items.data[i];
        if (source->params.w > 0.5f || source->mesh < 0 || source->mesh >= mesh_count) continue;
        const soft_mesh *mesh = &meshes[source->mesh];
        if (!mesh->verts || !mesh->idx) continue;
        g3_draw_item item = *source;
        for (int c = 0; c < 4; c++) for (int r = 0; r < 4; r++) {
            float sum = 0.0f;
            for (int k = 0; k < 4; k++) sum += light_matrix->m[k * 4 + r] * source->model.m[c * 4 + k];
            item.mvp.m[c * 4 + r] = sum;
        }
        for (int64_t j = 0; j + 2 < mesh->icount; j += 3) {
            uint32_t a = mesh->idx[j], b = mesh->idx[j+1], c = mesh->idx[j+2];
            if (a >= mesh->vcount || b >= mesh->vcount || c >= mesh->vcount) continue;
            const g3_vertex *verts[3] = { &mesh->verts[a], &mesh->verts[b], &mesh->verts[c] };
            g3_vertex clipped[32];
            int count = clip_triangle(&item, verts, clipped);
            for (int part = 1; part + 1 < count; part++) {
            const g3_vertex *triangle[3] = { &clipped[0], &clipped[part], &clipped[part+1] };
            soft_tri t;
            if (!setup_triangle(&item, triangle, &t)) continue;
            for (int y = t.y0; y <= t.y1; y++) for (int x = t.x0; x <= t.x1; x++) {
                float px = x + 0.5f, py = y + 0.5f;
                float e0 = (t.sx[1]-px)*(t.sy[2]-py) - (t.sx[2]-px)*(t.sy[1]-py);
                float e1 = (t.sx[2]-px)*(t.sy[0]-py) - (t.sx[0]-px)*(t.sy[2]-py);
                if (e0*t.edge_sense < 0.0f || e1*t.edge_sense < 0.0f) continue;
                float l0 = e0 / t.det, l1 = e1 / t.det, l2 = 1.0f - l0 - l1;
                if (l2 < 0.0f) continue;
                if (source->alpha_mode == 1) {
                    float pw = l0*t.inv_w[0] + l1*t.inv_w[1] + l2*t.inv_w[2];
                    if (pw <= 0.0f) continue;
                    float b0=l0*t.inv_w[0]/pw, b1=l1*t.inv_w[1]/pw, b2=l2*t.inv_w[2]/pw;
                    float u, v;
                    interpolate_uv(&t,source->base_color_uv.texcoord,b0,b1,b2,&u,&v);
                    float tex[4];
                    float tu, tv;
                    transform_uv(&source->base_color_uv,u,v,&tu,&tv);
                    float rho = texture_footprint(&t, source->texture, &source->base_color_uv, l0, l1, l2, u, v);
                    sample_texture(source->texture, tu, tv, rho, tex);
                    float vertex_alpha = t.color[0][3] * b0 + t.color[1][3] * b1 + t.color[2][3] * b2;
                    if (tex[3] * source->color.w * vertex_alpha < source->alpha_cutoff) continue;
                }
                float z = l0*t.sz[0] + l1*t.sz[1] + l2*t.sz[2];
                float *dst = &target_depth[y * size + x];
                if (z < *dst) *dst = z;
            }
            }
        }
    }
    fb_w = old_w; fb_h = old_h;
}

/* One shaded colour over what the framebuffer already holds: replace it, or
   alpha-blend over it, then quantise. `blended` items leave depth alone. */
static void blend_pixel(uint8_t *dst, const float rgb[3], float alpha, int blended) {
    for (int c = 0; c < 3; c++) {
        float v = clamp01(rgb[c]);
        if (blended) v = v * alpha + (float)dst[c] * (1.0f / 255.0f) * (1.0f - alpha);
        dst[c] = (uint8_t)(clamp01(v) * 255.0f + 0.5f);
    }
}

static void blend_pixel_hdr(float *dst, const float rgb[3], float alpha, int blended) {
    for (int c=0;c<3;c++) {
        float value=rgb[c];
        if (blended) value=value*alpha+dst[c]*(1.0f-alpha);
        dst[c]=value;
    }
}

/* Fill the triangle's box, one pixel at a time: barycentrics, depth test,
   perspective-correct attributes, shade, store. */
static void rasterize(const g3_draw_item *it, const g3_view_state *vs,
                      const soft_tri *t, int blended, int top, int bottom,
                      soft_profile *pf) {
    const int counting = pf->on;
    long tested = 0, shaded = 0;
    for (int y = top; y <= bottom; y++) {
        float py = (float)y + 0.5f;
        for (int x = t->x0; x <= t->x1; x++) {
            float px = (float)x + 0.5f;
            /* The edge functions first: a pixel outside the triangle is
               rejected on a sign, and only one inside pays for the division.
               e0 * edge_sense has the sign l0 would have, exactly, so the
               pixels rejected here and there are the same ones. */
            float e0 = (t->sx[1] - px) * (t->sy[2] - py) - (t->sx[2] - px) * (t->sy[1] - py);
            float e1 = (t->sx[2] - px) * (t->sy[0] - py) - (t->sx[0] - px) * (t->sy[2] - py);
            if (e0 * t->edge_sense < 0.0f || e1 * t->edge_sense < 0.0f) continue;
            float l0 = e0 / t->det;
            float l1 = e1 / t->det;
            float l2 = 1.0f - l0 - l1;
            if (l2 < 0.0f) continue;
            if (counting) tested += 1;

            float z = l0 * t->sz[0] + l1 * t->sz[1] + l2 * t->sz[2];
            size_t at = (size_t)y * (size_t)fb_w + (size_t)x;
            if (z >= depth[at]) continue;

            /* Perspective-correct: interpolate attribute/w and 1/w, divide. */
            float pw = l0 * t->inv_w[0] + l1 * t->inv_w[1] + l2 * t->inv_w[2];
            if (pw <= 0.0f) continue;
            float b0 = l0 * t->inv_w[0] / pw, b1 = l1 * t->inv_w[1] / pw, b2 = l2 * t->inv_w[2] / pw;
            float vertex_color[4];
            for (int c = 0; c < 4; c++) vertex_color[c] = t->color[0][c] * b0 + t->color[1][c] * b1 + t->color[2][c] * b2;

            g3_vec3 wp, n;
            wp.x = t->world[0][0] * b0 + t->world[1][0] * b1 + t->world[2][0] * b2;
            wp.y = t->world[0][1] * b0 + t->world[1][1] * b1 + t->world[2][1] * b2;
            wp.z = t->world[0][2] * b0 + t->world[1][2] * b1 + t->world[2][2] * b2;
            n.x = t->nrm[0][0] * b0 + t->nrm[1][0] * b1 + t->nrm[2][0] * b2;
            n.y = t->nrm[0][1] * b0 + t->nrm[1][1] * b1 + t->nrm[2][1] * b2;
            n.z = t->nrm[0][2] * b0 + t->nrm[1][2] * b1 + t->nrm[2][2] * b2;

            float rgb[3], tex[4], emissive_tex[4], emission[3], mr[4] = { 1, 1, 1, 1 }, ao = 1.0f;
            float clearcoat = it->clearcoat.x, clearcoat_roughness = it->clearcoat.y;
            float sheen_color[3]={it->sheen.x,it->sheen.y,it->sheen.z}, sheen_roughness=it->sheen.w;
            float u, v;
            interpolate_uv(t,it->base_color_uv.texcoord,b0,b1,b2,&u,&v);
            float nl=sqrtf(n.x*n.x+n.y*n.y+n.z*n.z);
            if (nl>1e-12f) { n.x/=nl; n.y/=nl; n.z/=nl; }
            g3_vec3 clearcoat_n=n;
            if (it->normal_texture >= 0 && nl>1e-12f) {
                float tx=t->tangent[0][0]*b0+t->tangent[1][0]*b1+t->tangent[2][0]*b2;
                float ty=t->tangent[0][1]*b0+t->tangent[1][1]*b1+t->tangent[2][1]*b2;
                float tz=t->tangent[0][2]*b0+t->tangent[1][2]*b1+t->tangent[2][2]*b2;
                float handedness=t->tangent[0][3]*b0+t->tangent[1][3]*b1+t->tangent[2][3]*b2;
                int authored = tx*tx+ty*ty+tz*tz > 1e-12f && fabsf(handedness) > 0.5f && uv_transform_identity(&it->normal_uv);
                if (!authored) { tx=t->derived_tangent[0]; ty=t->derived_tangent[1]; tz=t->derived_tangent[2]; }
                float ndott=n.x*tx+n.y*ty+n.z*tz;
                tx-=n.x*ndott; ty-=n.y*ndott; tz-=n.z*ndott;
                float tl=sqrtf(tx*tx+ty*ty+tz*tz);
                float bx, by, bz;
                if (authored) {
                    bx=(n.y*tz-n.z*ty)*(handedness<0.0f?-1.0f:1.0f);
                    by=(n.z*tx-n.x*tz)*(handedness<0.0f?-1.0f:1.0f);
                    bz=(n.x*ty-n.y*tx)*(handedness<0.0f?-1.0f:1.0f);
                } else { bx=t->derived_bitangent[0]; by=t->derived_bitangent[1]; bz=t->derived_bitangent[2]; }
                float ndotb=n.x*bx+n.y*by+n.z*bz;
                bx-=n.x*ndotb; by-=n.y*ndotb; bz-=n.z*ndotb;
                if (tl>1e-12f) {
                    tx/=tl; ty/=tl; tz/=tl;
                    float tdotb=tx*bx+ty*by+tz*bz;
                    bx-=tx*tdotb; by-=ty*tdotb; bz-=tz*tdotb;
                    float bl=sqrtf(bx*bx+by*by+bz*bz);
                    if (bl>1e-12f) {
                        bx/=bl; by/=bl; bz/=bl;
                        float normal_sample[4];
                        float nu, nv, normal_u, normal_v;
                        interpolate_uv(t,it->normal_uv.texcoord,b0,b1,b2,&normal_u,&normal_v);
                        transform_uv(&it->normal_uv,normal_u,normal_v,&nu,&nv);
                        sample_texture(it->normal_texture,nu,nv,texture_footprint(t,it->normal_texture,&it->normal_uv,l0,l1,l2,normal_u,normal_v),normal_sample);
                        float mx=(normal_sample[0]*2.0f-1.0f)*it->normal_scale;
                        float my=(normal_sample[1]*2.0f-1.0f)*it->normal_scale;
                        float mz=normal_sample[2]*2.0f-1.0f;
                        float ml=sqrtf(mx*mx+my*my+mz*mz);
                        if (ml>1e-12f) { mx/=ml; my/=ml; mz/=ml; }
                        n=(g3_vec3){tx*mx+bx*my+n.x*mz,ty*mx+by*my+n.y*mz,tz*mx+bz*my+n.z*mz};
                    }
                }
            }
            float bu, bv;
            transform_uv(&it->base_color_uv,u,v,&bu,&bv);
            float rho = texture_footprint(t, it->texture, &it->base_color_uv, l0, l1, l2, u, v);
            sample_texture(it->texture, bu, bv, rho, tex);
            if (it->pbr.x > 0.5f && it->metallic_roughness_texture >= 0) {
                float mu, mv, mr_u, mr_v;
                interpolate_uv(t,it->metallic_roughness_uv.texcoord,b0,b1,b2,&mr_u,&mr_v);
                transform_uv(&it->metallic_roughness_uv,mr_u,mr_v,&mu,&mv);
                float mr_rho = texture_footprint(t, it->metallic_roughness_texture, &it->metallic_roughness_uv, l0, l1, l2, mr_u, mr_v);
                sample_texture(it->metallic_roughness_texture, mu, mv, mr_rho, mr);
            }
            if (it->occlusion_texture >= 0) {
                float occlusion[4], ou, ov, occ_u, occ_v;
                interpolate_uv(t,it->occlusion_uv.texcoord,b0,b1,b2,&occ_u,&occ_v);
                transform_uv(&it->occlusion_uv,occ_u,occ_v,&ou,&ov);
                float ao_rho = texture_footprint(t, it->occlusion_texture, &it->occlusion_uv, l0, l1, l2, occ_u, occ_v);
                sample_texture(it->occlusion_texture, ou, ov, ao_rho, occlusion);
                ao = 1.0f + it->occlusion_strength * (occlusion[0] - 1.0f);
            }
            float eu, ev, emissive_u, emissive_v;
            interpolate_uv(t,it->emissive_uv.texcoord,b0,b1,b2,&emissive_u,&emissive_v);
            transform_uv(&it->emissive_uv,emissive_u,emissive_v,&eu,&ev);
            float emissive_rho = texture_footprint(t, it->emissive_texture, &it->emissive_uv, l0, l1, l2, emissive_u, emissive_v);
            sample_texture(it->emissive_texture, eu, ev, emissive_rho, emissive_tex);
            emission[0] = it->emissive.x * emissive_tex[0];
            emission[1] = it->emissive.y * emissive_tex[1];
            emission[2] = it->emissive.z * emissive_tex[2];
            float specular_strength=it->specular.w;
            float specular_color[3]={it->specular.x,it->specular.y,it->specular.z};
            if (it->specular_texture >= 0) {
                float su,sv,sample[4],raw_u,raw_v;
                interpolate_uv(t,it->specular_uv.texcoord,b0,b1,b2,&raw_u,&raw_v);
                transform_uv(&it->specular_uv,raw_u,raw_v,&su,&sv);
                sample_texture(it->specular_texture,su,sv,texture_footprint(t,it->specular_texture,&it->specular_uv,l0,l1,l2,raw_u,raw_v),sample);
                specular_strength*=sample[3];
            }
            if (it->specular_color_texture >= 0) {
                float su,sv,sample[4],raw_u,raw_v;
                interpolate_uv(t,it->specular_color_uv.texcoord,b0,b1,b2,&raw_u,&raw_v);
                transform_uv(&it->specular_color_uv,raw_u,raw_v,&su,&sv);
                sample_texture(it->specular_color_texture,su,sv,texture_footprint(t,it->specular_color_texture,&it->specular_color_uv,l0,l1,l2,raw_u,raw_v),sample);
                for (int c=0;c<3;c++) specular_color[c]*=sample[c];
            }
            if (it->clearcoat_normal_texture >= 0 && nl>1e-12f) {
                float tx=t->tangent[0][0]*b0+t->tangent[1][0]*b1+t->tangent[2][0]*b2;
                float ty=t->tangent[0][1]*b0+t->tangent[1][1]*b1+t->tangent[2][1]*b2;
                float tz=t->tangent[0][2]*b0+t->tangent[1][2]*b1+t->tangent[2][2]*b2;
                float handedness=t->tangent[0][3]*b0+t->tangent[1][3]*b1+t->tangent[2][3]*b2;
                int authored=tx*tx+ty*ty+tz*tz>1e-12f&&fabsf(handedness)>0.5f&&uv_transform_identity(&it->clearcoat_normal_uv)&&it->clearcoat_normal_uv.texcoord==0;
                float bx,by,bz;
                if(authored){
                    float ndott=clearcoat_n.x*tx+clearcoat_n.y*ty+clearcoat_n.z*tz;
                    tx-=clearcoat_n.x*ndott;ty-=clearcoat_n.y*ndott;tz-=clearcoat_n.z*ndott;
                    float tl=sqrtf(tx*tx+ty*ty+tz*tz);
                    if(tl>1e-12f){tx/=tl;ty/=tl;tz/=tl;}
                    float sign=handedness<0.0f?-1.0f:1.0f;
                    bx=(clearcoat_n.y*tz-clearcoat_n.z*ty)*sign;
                    by=(clearcoat_n.z*tx-clearcoat_n.x*tz)*sign;
                    bz=(clearcoat_n.x*ty-clearcoat_n.y*tx)*sign;
                } else {
                    float uv[3][2]; const float (*coords)[2]=triangle_uv(t,it->clearcoat_normal_uv.texcoord);
                    for(int k=0;k<3;k++) transform_uv(&it->clearcoat_normal_uv,coords[k][0],coords[k][1],&uv[k][0],&uv[k][1]);
                    float du1=uv[1][0]-uv[0][0],dv1=uv[1][1]-uv[0][1],du2=uv[2][0]-uv[0][0],dv2=uv[2][1]-uv[0][1];
                    float det=du1*dv2-dv1*du2;
                    if(fabsf(det)>1e-12f){
                        float e1[3],e2[3]; for(int c=0;c<3;c++){e1[c]=t->world[1][c]-t->world[0][c];e2[c]=t->world[2][c]-t->world[0][c];}
                        tx=(e1[0]*dv2-e2[0]*dv1)/det;ty=(e1[1]*dv2-e2[1]*dv1)/det;tz=(e1[2]*dv2-e2[2]*dv1)/det;
                        bx=(-e1[0]*du2+e2[0]*du1)/det;by=(-e1[1]*du2+e2[1]*du1)/det;bz=(-e1[2]*du2+e2[2]*du1)/det;
                    } else { tx=ty=tz=bx=by=bz=0.0f; }
                }
                float ndott=clearcoat_n.x*tx+clearcoat_n.y*ty+clearcoat_n.z*tz;
                tx-=clearcoat_n.x*ndott;ty-=clearcoat_n.y*ndott;tz-=clearcoat_n.z*ndott;
                float tl=sqrtf(tx*tx+ty*ty+tz*tz);
                if(tl>1e-12f){
                    tx/=tl;ty/=tl;tz/=tl;
                    float ndotb=clearcoat_n.x*bx+clearcoat_n.y*by+clearcoat_n.z*bz;
                    bx-=clearcoat_n.x*ndotb;by-=clearcoat_n.y*ndotb;bz-=clearcoat_n.z*ndotb;
                    float tdb=tx*bx+ty*by+tz*bz;bx-=tx*tdb;by-=ty*tdb;bz-=tz*tdb;
                    float bl=sqrtf(bx*bx+by*by+bz*bz);
                    if(bl>1e-12f){
                        bx/=bl;by/=bl;bz/=bl;
                        float raw_u,raw_v,nu,nv,sample[4];
                        interpolate_uv(t,it->clearcoat_normal_uv.texcoord,b0,b1,b2,&raw_u,&raw_v);
                        transform_uv(&it->clearcoat_normal_uv,raw_u,raw_v,&nu,&nv);
                        sample_texture(it->clearcoat_normal_texture,nu,nv,texture_footprint(t,it->clearcoat_normal_texture,&it->clearcoat_normal_uv,l0,l1,l2,raw_u,raw_v),sample);
                        float mx=(sample[0]*2.0f-1.0f)*it->clearcoat_normal_scale,my=(sample[1]*2.0f-1.0f)*it->clearcoat_normal_scale,mz=sample[2]*2.0f-1.0f;
                        float ml=sqrtf(mx*mx+my*my+mz*mz);
                        if(ml>1e-12f){mx/=ml;my/=ml;mz/=ml;clearcoat_n=(g3_vec3){tx*mx+bx*my+clearcoat_n.x*mz,ty*mx+by*my+clearcoat_n.y*mz,tz*mx+bz*my+clearcoat_n.z*mz};}
                    }
                }
            }
            if (it->clearcoat_texture >= 0) {
                float raw_u,raw_v,cu,cv,sample[4];
                interpolate_uv(t,it->clearcoat_uv.texcoord,b0,b1,b2,&raw_u,&raw_v);
                transform_uv(&it->clearcoat_uv,raw_u,raw_v,&cu,&cv);
                sample_texture(it->clearcoat_texture,cu,cv,texture_footprint(t,it->clearcoat_texture,&it->clearcoat_uv,l0,l1,l2,raw_u,raw_v),sample);
                clearcoat*=sample[0];
            }
            if (it->clearcoat_roughness_texture >= 0) {
                float raw_u,raw_v,cu,cv,sample[4];
                interpolate_uv(t,it->clearcoat_roughness_uv.texcoord,b0,b1,b2,&raw_u,&raw_v);
                transform_uv(&it->clearcoat_roughness_uv,raw_u,raw_v,&cu,&cv);
                sample_texture(it->clearcoat_roughness_texture,cu,cv,texture_footprint(t,it->clearcoat_roughness_texture,&it->clearcoat_roughness_uv,l0,l1,l2,raw_u,raw_v),sample);
                clearcoat_roughness*=sample[1];
            }
            if (it->sheen_color_texture >= 0) {
                float raw_u,raw_v,su,sv,sample[4];
                interpolate_uv(t,it->sheen_color_uv.texcoord,b0,b1,b2,&raw_u,&raw_v);
                transform_uv(&it->sheen_color_uv,raw_u,raw_v,&su,&sv);
                sample_texture(it->sheen_color_texture,su,sv,texture_footprint(t,it->sheen_color_texture,&it->sheen_color_uv,l0,l1,l2,raw_u,raw_v),sample);
                for(int c=0;c<3;c++)sheen_color[c]*=sample[c];
            }
            if (it->sheen_roughness_texture >= 0) {
                float raw_u,raw_v,su,sv,sample[4];
                interpolate_uv(t,it->sheen_roughness_uv.texcoord,b0,b1,b2,&raw_u,&raw_v);
                transform_uv(&it->sheen_roughness_uv,raw_u,raw_v,&su,&sv);
                sample_texture(it->sheen_roughness_texture,su,sv,texture_footprint(t,it->sheen_roughness_texture,&it->sheen_roughness_uv,l0,l1,l2,raw_u,raw_v),sample);
                sheen_roughness*=sample[3];
            }
            float alpha = it->color.w * vertex_color[3] * tex[3];
            if (it->alpha_mode == 1 && alpha < it->alpha_cutoff) continue;
            if (it->double_sided && t->normal_sign < 0.0f) {
                n.x = -n.x; n.y = -n.y; n.z = -n.z;
                clearcoat_n.x = -clearcoat_n.x; clearcoat_n.y = -clearcoat_n.y; clearcoat_n.z = -clearcoat_n.z;
            }
            g3_vec3 aniso_t={0,0,0},aniso_b={0,0,0};
            float anisotropy_strength=fmaxf(0.0f,fminf(it->anisotropy.x,1.0f));
            if(it->pbr.x>0.5f&&anisotropy_strength>0.0f){
                float tx=t->tangent[0][0]*b0+t->tangent[1][0]*b1+t->tangent[2][0]*b2;
                float ty=t->tangent[0][1]*b0+t->tangent[1][1]*b1+t->tangent[2][1]*b2;
                float tz=t->tangent[0][2]*b0+t->tangent[1][2]*b1+t->tangent[2][2]*b2;
                float handedness=t->tangent[0][3]*b0+t->tangent[1][3]*b1+t->tangent[2][3]*b2;
                if(sqrtf(tx*tx+ty*ty+tz*tz)<1e-12f){tx=t->derived_tangent[0];ty=t->derived_tangent[1];tz=t->derived_tangent[2];handedness=1.0f;}
                float ndt=n.x*tx+n.y*ty+n.z*tz;tx-=n.x*ndt;ty-=n.y*ndt;tz-=n.z*ndt;
                float tl=sqrtf(tx*tx+ty*ty+tz*tz);if(tl>1e-12f){tx/=tl;ty/=tl;tz/=tl;}
                float bx=(n.y*tz-n.z*ty)*(handedness<0?-1.0f:1.0f),by=(n.z*tx-n.x*tz)*(handedness<0?-1.0f:1.0f),bz=(n.x*ty-n.y*tx)*(handedness<0?-1.0f:1.0f);
                float du=1.0f,dv=0.0f;
                if(it->anisotropy_texture>=0){
                    float raw_u,raw_v,au,av,sample[4];interpolate_uv(t,it->anisotropy_uv.texcoord,b0,b1,b2,&raw_u,&raw_v);transform_uv(&it->anisotropy_uv,raw_u,raw_v,&au,&av);
                    sample_texture(it->anisotropy_texture,au,av,texture_footprint(t,it->anisotropy_texture,&it->anisotropy_uv,l0,l1,l2,raw_u,raw_v),sample);
                    du=sample[0]*2.0f-1.0f;dv=sample[1]*2.0f-1.0f;anisotropy_strength*=sample[2];
                }
                float dl=sqrtf(du*du+dv*dv);if(dl>1e-12f){du/=dl;dv/=dl;}else{du=1.0f;dv=0.0f;}
                float ca=cosf(it->anisotropy.y),sa=sinf(it->anisotropy.y),rdx=ca*du-sa*dv,rdy=sa*du+ca*dv;
                aniso_t=(g3_vec3){tx*rdx+bx*rdy,ty*rdx+by*rdy,tz*rdx+bz*rdy};
                float al=sqrtf(aniso_t.x*aniso_t.x+aniso_t.y*aniso_t.y+aniso_t.z*aniso_t.z);if(al>1e-12f){aniso_t.x/=al;aniso_t.y/=al;aniso_t.z/=al;}
                aniso_b=(g3_vec3){(n.y*aniso_t.z-n.z*aniso_t.y)*(handedness<0?-1.0f:1.0f),(n.z*aniso_t.x-n.x*aniso_t.z)*(handedness<0?-1.0f:1.0f),(n.x*aniso_t.y-n.y*aniso_t.x)*(handedness<0?-1.0f:1.0f)};
            }
            shade(it, vs, wp, n, clearcoat_n, tex, vertex_color, mr, ao, emission, specular_strength, specular_color,
                  clearcoat, clearcoat_roughness, sheen_color, sheen_roughness, aniso_t, aniso_b, anisotropy_strength, rgb);
            if (counting) shaded += 1;
            if (vs->params.z > 0.5f) blend_pixel_hdr(hdr_fb + at * 3, rgb, alpha, blended);
            else blend_pixel(fb + at * 3, rgb, alpha, blended);
            if (!blended) depth[at] = z;
        }
    }
    if (counting) {
        pf->pixels += tested;
        pf->shaded += shaded;
    }
}

/* Phase one, serial: transform one triangle and keep it if it can be drawn.
   Transforming once for the whole frame is what makes banding cheap: the
   alternative redoes this work for every band a triangle touches. */
static void queue_clipped_triangle(const g3_draw_item *it, const g3_vertex *const tri[3], int blended) {
    if (queue_len == queue_cap) {
        int64_t cap = queue_cap ? queue_cap * 2 : 1024;
        soft_quad *grown = (soft_quad *)realloc(queue, sizeof(soft_quad) * (size_t)cap);
        if (!grown) {
            fprintf(stderr, "g3_soft: out of memory for %lld triangles\n", (long long)cap);
            exit(1);
        }
        queue = grown;
        queue_cap = cap;
    }
    soft_quad *q = &queue[queue_len];
    if (!setup_triangle(it, tri, &q->tri)) return;
    q->item = it;
    q->blended = blended;
    queue_len += 1;
}

static void queue_triangle(const g3_draw_item *it, const g3_vertex *const tri[3], int blended) {
    g3_vertex vertices[32];
    int count = clip_triangle(it, tri, vertices);
    for (int i = 1; i + 1 < count; i++) {
        const g3_vertex *part[3] = { &vertices[0], &vertices[i], &vertices[i + 1] };
        queue_clipped_triangle(it, part, blended);
    }
}

/* Phase two, one block of rows: walk the display list in order, so a pixel
   sees its triangles in exactly the order the engine sorted them into, and
   skip the triangles that do not reach these rows. */
static void rasterize_rows(const g3_view_state *vs, int y_begin, int y_end, soft_profile *pf) {
    for (int64_t i = 0; i < queue_len; i++) {
        const soft_quad *q = &queue[i];
        int top = q->tri.y0, bottom = q->tri.y1;
        if (top < y_begin) top = y_begin;
        if (bottom > y_end - 1) bottom = y_end - 1;
        if (top > bottom) continue;
        rasterize(q->item, vs, &q->tri, q->blended, top, bottom, pf);
    }
}

/* Rows are handed out in small blocks that any worker may claim, rather than
   split into equal contiguous bands: a scene with a horizon has all of its
   geometry in the lower half of the screen, and equal bands would leave half
   the threads waiting for the other half. Eight rows is small enough to
   balance the tail and large enough that claiming costs nothing. */
#define G3_BLOCK_ROWS 8

static atomic_int next_block;

static void rasterize_blocks(const g3_view_state *vs, soft_profile *pf) {
    for (;;) {
        int block = atomic_fetch_add(&next_block, 1);
        int y_begin = block * G3_BLOCK_ROWS;
        if (y_begin >= fb_h) return;
        int y_end = y_begin + G3_BLOCK_ROWS;
        if (y_end > fb_h) y_end = fb_h;
        rasterize_rows(vs, y_begin, y_end, pf);
    }
}

#if G3_HAVE_THREADS
typedef struct {
    const g3_view_state *view;
    soft_profile prof;
} band_job;

static void *run_band(void *arg) {
    band_job *job = (band_job *)arg;
    rasterize_blocks(job->view, &job->prof);
    return NULL;
}
#endif

/* Counters are per band — they are written from several threads — and added up
   once the bands have joined. */
static void merge_counts(soft_profile *into, const soft_profile *from) {
    into->pixels += from->pixels;
    into->shaded += from->shaded;
}

/* Paint the whole surface with the frame's clear colour and reset depth. */
static void clear_frame(const g3_view_state *view) {
    uint8_t r8 = (uint8_t)(clamp01(view->clear.x) * 255.0f + 0.5f);
    uint8_t g8 = (uint8_t)(clamp01(view->clear.y) * 255.0f + 0.5f);
    uint8_t b8 = (uint8_t)(clamp01(view->clear.z) * 255.0f + 0.5f);
    size_t pixels = (size_t)fb_w * (size_t)fb_h;
    for (size_t i = 0; i < pixels; i++) {
        fb[i * 3 + 0] = r8;
        fb[i * 3 + 1] = g8;
        fb[i * 3 + 2] = b8;
        if (view->params.z > 0.5f || view->render_target >= 0) {
            hdr_fb[i*3+0]=view->clear.x;
            hdr_fb[i*3+1]=view->clear.y;
            hdr_fb[i*3+2]=view->clear.z;
        }
        depth[i] = 1.0f;
    }
}

void g3p_draw_frame(g3_draw_item_slice items, const g3_view_state *view) {
    if (!fb) return;
    uint8_t *surface_fb = fb;
    float *surface_hdr = hdr_fb, *surface_depth = depth;
    int32_t surface_w = fb_w, surface_h = fb_h;
    soft_texture *target = NULL;
    int rendering_target = view->render_target >= 0 && view->render_target < texture_count &&
                           textures[view->render_target].target_fb && view->target_width > 0 && view->target_height > 0;
    g3_view_state safe_view;
    if (rendering_target) {
        safe_view = *view;
        if (safe_view.environment_texture == view->render_target) safe_view.environment_texture = -1;
        view = &safe_view;
        target = &textures[view->render_target];
        fb_w = target->w; fb_h = target->h; fb = target->target_fb;
        hdr_fb = target->target_hdr_fb; depth = target->target_depth;
    }
    int shadow_size=shadow_map_size(view);
    if (view->shadow_params.x > 0.5f) render_shadow_map(items, view, &view->shadow_view_proj, shadow_depth, shadow_size);
    if (view->point_shadow_params.x > 0.5f && view->point_shadow_light_index >= 0 && view->point_shadow_light_index < view->light_count)
        for (int face=0; face<6; face++) render_shadow_map(items, view, &view->point_shadow_view_proj[face], point_shadow_depth[face], shadow_size);
    if (view->spot_shadow_params.x > 0.5f && view->spot_shadow_light_index >= 0 && view->spot_shadow_light_index < view->light_count && view->lights[view->spot_shadow_light_index].position.w > 1.5f)
        render_shadow_map(items, view, &view->spot_shadow_view_proj, spot_shadow_depth, shadow_size);
    prof.frames += 1;
    const double t0 = prof.on ? now_seconds() : 0.0;

    clear_frame(view);
    const double t1 = prof.on ? now_seconds() : 0.0;

    queue_len = 0;
    for (int64_t i = 0; i < items.len; i++) {
        const g3_draw_item *it = &items.data[i];
        if (rendering_target && samples_texture(it, view->render_target)) continue;
        if (it->mesh < 0 || it->mesh >= mesh_count) continue;
        const soft_mesh *m = &meshes[it->mesh];
        if (!m->verts || !m->idx) continue;
        int blended = it->params.w > 0.5f;
        for (int64_t t = 0; t + 2 < m->icount; t += 3) {
            uint32_t i0 = m->idx[t], i1 = m->idx[t + 1], i2 = m->idx[t + 2];
            if ((int64_t)i0 >= m->vcount || (int64_t)i1 >= m->vcount ||
                (int64_t)i2 >= m->vcount) continue;
            const g3_vertex *tri[3] = { &m->verts[i0], &m->verts[i1], &m->verts[i2] };
            queue_triangle(it, tri, blended);
        }
    }
    prof.triangles += queue_len;
    const double t2 = prof.on ? now_seconds() : 0.0;

    int workers = band_count;
    if (workers < 1) workers = 1;
    atomic_store(&next_block, 0);
#if G3_HAVE_THREADS
    if (workers > 1) {
        pthread_t threads[8];
        band_job jobs[8];
        int started = 0;
        for (int b = 1; b < workers; b++) {
            jobs[b].view = view;
            jobs[b].prof.on = prof.on;
            jobs[b].prof.raster = jobs[b].prof.setup = jobs[b].prof.clear = jobs[b].prof.wall = 0.0;
            jobs[b].prof.frames = jobs[b].prof.triangles = 0;
            jobs[b].prof.pixels = jobs[b].prof.shaded = 0;
            if (pthread_create(&threads[started], NULL, run_band, &jobs[b]) != 0) {
                /* No thread to be had: claim blocks here instead, so no row of
                   the frame is lost. */
                jobs[b].prof.on = prof.on;
                rasterize_blocks(view, &jobs[b].prof);
                continue;
            }
            started += 1;
        }
        jobs[0].view = view;
        jobs[0].prof.on = prof.on;
        jobs[0].prof.raster = jobs[0].prof.setup = jobs[0].prof.clear = jobs[0].prof.wall = 0.0;
        jobs[0].prof.frames = jobs[0].prof.triangles = 0;
        jobs[0].prof.pixels = jobs[0].prof.shaded = 0;
        rasterize_blocks(view, &jobs[0].prof);
        for (int k = 0; k < started; k++) pthread_join(threads[k], NULL);
        for (int b = 0; b < workers; b++) merge_counts(&prof, &jobs[b].prof);
    } else
#endif
    {
        soft_profile one;
        one.on = prof.on;
        one.raster = one.setup = one.clear = one.wall = 0.0;
        one.frames = one.triangles = 0;
        one.pixels = one.shaded = 0;
        rasterize_blocks(view, &one);
        merge_counts(&prof, &one);
    }
    int tone_mode=rendering_target ? 0 : (int)(view->params.z+0.5f);
    if (tone_mode > 0) {
        size_t components=(size_t)fb_w*(size_t)fb_h*3;
        for(size_t i=0;i<components;i++){
            float value=hdr_fb[i]*view->params.w;
            float mapped=tone_map_value(value,tone_mode);
            mapped=clamp01(mapped);
            if(view->params.y>0.5f)mapped=srgb_encode(mapped);
            fb[i]=(uint8_t)(mapped*255.0f+0.5f);
        }
    } else if (!rendering_target && view->params.y > 0.5f) {
        size_t components = (size_t)fb_w * (size_t)fb_h * 3;
        for (size_t i = 0; i < components; i++)
            fb[i] = (uint8_t)(srgb_encode(fb[i] / 255.0f) * 255.0f + 0.5f);
    }
    if (!rendering_target && (view->post_process & 1)) apply_fxaa();
    if (rendering_target) {
        int keep_mips = target->levels > 1;
        size_t pixels = (size_t)fb_w * (size_t)fb_h;
        for (int32_t y = 0; y < fb_h; y++) for (int32_t x = 0; x < fb_w; x++) {
            size_t src = (size_t)y * fb_w + x;
            size_t dst = (size_t)(fb_h - 1 - y) * fb_w + x;
            target->hdr_pixels[dst*4] = floorf(fminf(fmaxf(hdr_fb[src*3], 0.0f), 1.0f) * 255.0f + 0.5f) / 255.0f;
            target->hdr_pixels[dst*4+1] = floorf(fminf(fmaxf(hdr_fb[src*3+1], 0.0f), 1.0f) * 255.0f + 0.5f) / 255.0f;
            target->hdr_pixels[dst*4+2] = floorf(fminf(fmaxf(hdr_fb[src*3+2], 0.0f), 1.0f) * 255.0f + 0.5f) / 255.0f;
            target->hdr_pixels[dst*4+3] = 1.0f;
        }
        for (int j=0;j<31;j++) { free(target->hdr_mips[j]); free(target->hdr_env_mips[j]); target->hdr_mips[j]=target->hdr_env_mips[j]=NULL; }
        target->levels=1; target->env_levels=0;
        if (keep_mips) g3p_texture_generate_mips(view->render_target);
        fb = surface_fb; hdr_fb = surface_hdr; depth = surface_depth; fb_w = surface_w; fb_h = surface_h;
    }
    const double t3 = prof.on ? now_seconds() : 0.0;
    if (prof.on) {
        prof.clear += t1 - t0;
        prof.setup += t2 - t1;
        prof.raster += t3 - t2;
        prof.wall += t3 - t0;
    }
}

/* A small FXAA-style post-process: detect a luma edge and blend each edge
   pixel with its two neighbours across the edge. Reads from a snapshot so
   results do not depend on traversal order. */
static float fxaa_luma(const uint8_t *pixels, size_t at) {
    return (0.299f*pixels[at] + 0.587f*pixels[at+1] + 0.114f*pixels[at+2])*(1.0f/255.0f);
}

static void apply_fxaa(void) {
    size_t components=(size_t)fb_w*(size_t)fb_h*3;
    if (components > fxaa_capacity) {
        uint8_t *grown=(uint8_t *)realloc(fxaa_buffer,components);
        if (!grown) return;
        fxaa_buffer=grown; fxaa_capacity=components;
    }
    memcpy(fxaa_buffer,fb,components);
    for (int y=0;y<fb_h;y++) for (int x=0;x<fb_w;x++) {
        int left=x>0?x-1:x, right=x+1<fb_w?x+1:x;
        int up=y>0?y-1:y, down=y+1<fb_h?y+1:y;
        size_t center=((size_t)y*fb_w+x)*3;
        size_t l=((size_t)y*fb_w+left)*3, r=((size_t)y*fb_w+right)*3;
        size_t u=((size_t)up*fb_w+x)*3, d=((size_t)down*fb_w+x)*3;
        float lc=fxaa_luma(fxaa_buffer,center), ll=fxaa_luma(fxaa_buffer,l), lr=fxaa_luma(fxaa_buffer,r);
        float lu=fxaa_luma(fxaa_buffer,u), ld=fxaa_luma(fxaa_buffer,d);
        float lo=fminf(lc,fminf(fminf(ll,lr),fminf(lu,ld)));
        float hi=fmaxf(lc,fmaxf(fmaxf(ll,lr),fmaxf(lu,ld)));
        if (hi-lo < 0.125f) continue;
        int across_horizontal=fabsf(lr-ll)>=fabsf(ld-lu);
        size_t a=across_horizontal?l:u, b=across_horizontal?r:d;
        for (int c=0;c<3;c++) {
            float across=0.5f*((float)fxaa_buffer[a+c]+fxaa_buffer[b+c]);
            fb[center+c]=(uint8_t)(((float)fxaa_buffer[center+c]+across)*0.5f+0.5f);
        }
    }
}

/* --- output --- */

uint32_t g3p_read_pixel(int32_t x, int32_t y) {
    if (!fb || x < 0 || y < 0 || x >= fb_w || y >= fb_h) return 0;
    const uint8_t *p = fb + ((size_t)y * (size_t)fb_w + (size_t)x) * 3;
    return ((uint32_t)p[0] << 16) | ((uint32_t)p[1] << 8) | (uint32_t)p[2];
}

uint8_t g3p_save_frame(g3_u8_slice path) {
    if (!fb) return 0;
    char name[4096];
    path_of(path, name, sizeof(name));
    FILE *f = fopen(name, "wb");
    if (!f) {
        fprintf(stderr, "g3_soft: cannot write %s\n", name);
        return 0;
    }
    fprintf(f, "P6\n%d %d\n255\n", fb_w, fb_h);
    size_t written = fwrite(fb, 3, (size_t)fb_w * (size_t)fb_h, f);
    int ok = fclose(f) == 0;
    return (uint8_t)(ok && written == (size_t)fb_w * (size_t)fb_h);
}
