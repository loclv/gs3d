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
static float *depth;     /* [0, 1], 1 is far */
static soft_mesh *meshes;
static int32_t mesh_count, mesh_cap;
typedef struct {
    uint8_t *pixels, *mips[31];
    int32_t w, h, wrap_u, wrap_v, min_filter, mag_filter, levels, srgb;
} soft_texture;
static soft_texture *textures;
static int32_t texture_count;
#define SHADOW_SIZE 512
static float shadow_depth[SHADOW_SIZE * SHADOW_SIZE];

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
    float det;              /* twice the signed area in pixels */
    float edge_sense;       /* +1 or -1: the sign l0 has when an edge is 0 */
    int x0, y0, x1, y1;
} soft_tri;

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
    fb_w = width > 0 ? width : 1;
    fb_h = height > 0 ? height : 1;
    size_t pixels = (size_t)fb_w * (size_t)fb_h;
    fb = (uint8_t *)calloc(pixels * 3, 1);
    depth = (float *)malloc(sizeof(float) * pixels);
    if (!fb || !depth) {
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
        for (int j = 0; j < 31; j++) free(textures[i].mips[j]);
    }
    free(textures); textures = NULL; texture_count = 0;
    free(queue);
    queue = NULL;
    queue_len = queue_cap = 0;
    free(fb);
    free(depth);
    fb = NULL;
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

static float srgb_decode(float x) {
    return x <= 0.04045f ? x / 12.92f : powf((x + 0.055f) / 1.055f, 2.4f);
}

static float srgb_encode(float x) {
    if (x < 0.0f) x = 0.0f;
    if (x > 1.0f) x = 1.0f;
    return x <= 0.0031308f ? x * 12.92f : 1.055f * powf(x, 1.0f / 2.4f) - 0.055f;
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
    free(textures[id].pixels);
    for (int j = 0; j < 31; j++) free(textures[id].mips[j]);
    textures[id] = (soft_texture){ .pixels = copy, .w = width, .h = height,
                                   .min_filter = 9729, .mag_filter = 9729, .levels = 1, .srgb = srgb };
}

void g3p_upload_texture(int32_t id, g3_u8_slice pixels, int32_t width, int32_t height) {
    upload_texture(id, pixels, width, height, 0);
}
void g3p_upload_texture_srgb(int32_t id, g3_u8_slice pixels, int32_t width, int32_t height) {
    upload_texture(id, pixels, width, height, 1);
}

void g3p_texture_wrap(int32_t id, int32_t wrap_u, int32_t wrap_v) {
    if (id < 0 || id >= texture_count || !textures[id].pixels || wrap_u < 0 || wrap_u > 2 || wrap_v < 0 || wrap_v > 2) return;
    textures[id].wrap_u = wrap_u;
    textures[id].wrap_v = wrap_v;
}

/* Generate each level with bilinear sampling at destination texel centres.
   This also handles non-power-of-two dimensions and preserves alpha. */
static void generate_mips(soft_texture *t) {
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
    if (id < 0 || id >= texture_count || !textures[id].pixels || !valid_min || (mag_filter != 9728 && mag_filter != 9729)) return;
    soft_texture *t = &textures[id];
    if (min_filter >= 9984 && t->levels == 1) generate_mips(t);
    t->min_filter = min_filter;
    t->mag_filter = mag_filter;
}

/* Resizing a headless surface means reallocating the framebuffer and the z
   buffer; the meshes stay where they are. */
int g3_backend_resize(int w, int h) {
    int32_t nw = w, nh = h;
    size_t pixels = (size_t)nw * (size_t)nh;
    uint8_t *nfb = (uint8_t *)calloc(pixels * 3, 1);
    float *nd = (float *)malloc(sizeof(float) * pixels);
    if (!nfb || !nd) { free(nfb); free(nd); return 0; }
    for (size_t i = 0; i < pixels; i++) nd[i] = 1.0f;
    free(fb);
    free(depth);
    fb = nfb;
    depth = nd;
    fb_w = nw;
    fb_h = nh;
    return 1;
}

/* --- shading: the GLSL in g3_web.c, term for term --- */

static void sample_texture(int32_t id, float u, float v, float rho, float out[4]);
static float shadow_visibility(const g3_view_state *vs, g3_vec3 wp);

/* glTF metallic-roughness direct BRDF: GGX, correlated Smith, Schlick. */
static void pbr_light(g3_vec3 n, g3_vec3 v, g3_vec3 l, const float base[3],
                      float metallic, float roughness, float out[3]) {
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
    float fresnel_weight = powf(1.0f - fminf(vh, 1.0f), 5.0f);
    for (int i = 0; i < 3; i++) {
        float f0 = 0.04f*(1.0f-m) + base[i]*m;
        float f = f0 + (1.0f-f0)*fresnel_weight;
        out[i] = ((1.0f-f)*(1.0f-m)*base[i]/3.14159265359f + distribution*visibility*f)*nl;
    }
}

static void shade(const g3_draw_item *it, const g3_view_state *vs,
                  const g3_vec3 wp, g3_vec3 n, const float tex[3], float *out_rgb) {
    float len = sqrtf(n.x * n.x + n.y * n.y + n.z * n.z);
    if (len > 1e-12f) { n.x /= len; n.y /= len; n.z /= len; }
    else { n.x = n.y = n.z = 0.0f; }

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
    float r = it->color.x * tex[0] * (vs->ambient.x * amb + vs->light_color.x * diff * visible) + vs->light_color.x * spec * visible;
    float g = it->color.y * tex[1] * (vs->ambient.y * amb + vs->light_color.y * diff * visible) + vs->light_color.y * spec * visible;
    float b = it->color.z * tex[2] * (vs->ambient.z * amb + vs->light_color.z * diff * visible) + vs->light_color.z * spec * visible;
    float base[3] = { it->color.x * tex[0], it->color.y * tex[1], it->color.z * tex[2] };
    if (it->pbr.x > 0.5f) {
        float brdf[3];
        pbr_light(n, (g3_vec3){vx,vy,vz}, (g3_vec3){lx,ly,lz}, base, it->pbr.y, it->pbr.z, brdf);
        float diffuse = 1.0f - fmaxf(0.0f, fminf(it->pbr.y, 1.0f));
        r = base[0]*vs->ambient.x*amb*diffuse + brdf[0]*vs->light_color.x*visible;
        g = base[1]*vs->ambient.y*amb*diffuse + brdf[1]*vs->light_color.y*visible;
        b = base[2]*vs->ambient.z*amb*diffuse + brdf[2]*vs->light_color.z*visible;
    }
    float sky = n.y * 0.5f + 0.5f;
    float env_scale = it->pbr.x > 0.5f ? 1.0f - fmaxf(0.0f, fminf(it->pbr.y, 1.0f)) : 1.0f;
    if (sky < 0.0f) sky = 0.0f;
    if (sky > 1.0f) sky = 1.0f;
    r += base[0] * (vs->env_ground.x * (1.0f - sky) + vs->env_sky.x * sky) * vs->env_sky.w * env_scale;
    g += base[1] * (vs->env_ground.y * (1.0f - sky) + vs->env_sky.y * sky) * vs->env_sky.w * env_scale;
    b += base[2] * (vs->env_ground.z * (1.0f - sky) + vs->env_sky.z * sky) * vs->env_sky.w * env_scale;
    if (vs->environment_texture >= 0 && vs->environment_texture < texture_count && textures[vs->environment_texture].pixels) {
        float env[4];
        float y = n.y < -1.0f ? -1.0f : n.y > 1.0f ? 1.0f : n.y;
        sample_texture(vs->environment_texture, atan2f(n.z, n.x) / 6.28318530718f + 0.5f,
                       acosf(y) / 3.14159265359f, 0.0f, env);
        r += base[0] * env[0] * vs->environment_intensity * env_scale;
        g += base[1] * env[1] * vs->environment_intensity * env_scale;
        b += base[2] * env[2] * vs->environment_intensity * env_scale;
    }
    int count = vs->light_count < 0 ? 0 : vs->light_count > 4 ? 4 : vs->light_count;
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
            falloff = 1.0f - distance / light->direction.w;
            if (falloff < 0.0f) falloff = 0.0f;
            falloff *= falloff;
        }
        if (light->position.w > 1.5f) {
            float cone = (-ex * light->direction.x - ey * light->direction.y - ez * light->direction.z - light->color.w) / (light->inner - light->color.w);
            if (cone < 0.0f) cone = 0.0f;
            if (cone > 1.0f) cone = 1.0f;
            falloff *= cone * cone * (3.0f - 2.0f * cone);
        }
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
            pbr_light(n, (g3_vec3){vx,vy,vz}, (g3_vec3){ex,ey,ez}, base, it->pbr.y, it->pbr.z, brdf);
            r += brdf[0]*light->color.x*falloff; g += brdf[1]*light->color.y*falloff; b += brdf[2]*light->color.z*falloff;
        } else {
            r += (base[0] * d + s) * light->color.x * falloff;
            g += (base[1] * d + s) * light->color.y * falloff;
            b += (base[2] * d + s) * light->color.z * falloff;
        }
    }
    if (it->params.x > 0.5f) { r = it->color.x * tex[0]; g = it->color.y * tex[1]; b = it->color.z * tex[2]; }

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
    if (id < 0 || id >= texture_count || !textures[id].pixels) return;
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

    /* Front faces are counterclockwise in NDC, which is what GL means by
       GL_CCW with the y-up window it uses. */
    float area = (ndc[1][0] - ndc[0][0]) * (ndc[2][1] - ndc[0][1]) -
                 (ndc[2][0] - ndc[0][0]) * (ndc[1][1] - ndc[0][1]);
    if (area <= 0.0f) return 0;

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
    int px = (int)(x * SHADOW_SIZE), py = SHADOW_SIZE - 1 - (int)(y * SHADOW_SIZE);
    return z - vs->shadow_params.y <= shadow_depth[py * SHADOW_SIZE + px] ? 1.0f : 0.0f;
}

/* Perspective-correct UV at a neighboring pixel, even if it lies just
   outside this triangle. These finite differences approximate GPU LOD. */
static float texture_footprint(const soft_tri *t, int32_t id, float l0, float l1, float l2, float u, float v) {
    if (id < 0 || id >= texture_count || !textures[id].pixels) return 0.0f;
    const soft_texture *tex = &textures[id];
    if (tex->min_filter == tex->mag_filter) return 0.0f;
    float dl0x = (t->sy[1] - t->sy[2]) / t->det;
    float dl1x = (t->sy[2] - t->sy[0]) / t->det;
    float dl0y = (t->sx[2] - t->sx[1]) / t->det;
    float dl1y = (t->sx[0] - t->sx[2]) / t->det;
    float d0[2] = { dl0x, dl0y }, d1[2] = { dl1x, dl1y };
    float max_sq = 0.0f;
    for (int axis = 0; axis < 2; axis++) {
        float w0 = (l0+d0[axis])*t->inv_w[0], w1 = (l1+d1[axis])*t->inv_w[1];
        float w2 = (l2-d0[axis]-d1[axis])*t->inv_w[2];
        float sum = w0+w1+w2;
        if (sum <= 1e-12f) continue;
        float du = ((t->uv[0][0]*w0+t->uv[1][0]*w1+t->uv[2][0]*w2)/sum-u)*tex->w;
        float dv = ((t->uv[0][1]*w0+t->uv[1][1]*w1+t->uv[2][1]*w2)/sum-v)*tex->h;
        float sq = du*du+dv*dv;
        if (sq > max_sq) max_sq = sq;
    }
    return sqrtf(max_sq);
}

/* Rasterize the same opaque draw items from the light before the colour pass.
   Shadow map rows are top-first, like the main software framebuffer. */
static void render_shadow_map(g3_draw_item_slice items, const g3_view_state *vs) {
    for (int i = 0; i < SHADOW_SIZE * SHADOW_SIZE; i++) shadow_depth[i] = 1.0f;
    int old_w = fb_w, old_h = fb_h;
    fb_w = fb_h = SHADOW_SIZE;
    for (int64_t i = 0; i < items.len; i++) {
        const g3_draw_item *source = &items.data[i];
        if (source->params.w > 0.5f || source->mesh < 0 || source->mesh >= mesh_count) continue;
        const soft_mesh *mesh = &meshes[source->mesh];
        if (!mesh->verts || !mesh->idx) continue;
        g3_draw_item item = *source;
        for (int c = 0; c < 4; c++) for (int r = 0; r < 4; r++) {
            float sum = 0.0f;
            for (int k = 0; k < 4; k++) sum += vs->shadow_view_proj.m[k * 4 + r] * source->model.m[c * 4 + k];
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
                    float u=t.uv[0][0]*b0+t.uv[1][0]*b1+t.uv[2][0]*b2;
                    float v=t.uv[0][1]*b0+t.uv[1][1]*b1+t.uv[2][1]*b2;
                    float tex[4];
                    float rho = texture_footprint(&t, source->texture, l0, l1, l2, u, v);
                    sample_texture(source->texture, u, v, rho, tex);
                    if (tex[3] * source->color.w < source->alpha_cutoff) continue;
                }
                float z = l0*t.sz[0] + l1*t.sz[1] + l2*t.sz[2];
                float *dst = &shadow_depth[y * SHADOW_SIZE + x];
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

            g3_vec3 wp, n;
            wp.x = t->world[0][0] * b0 + t->world[1][0] * b1 + t->world[2][0] * b2;
            wp.y = t->world[0][1] * b0 + t->world[1][1] * b1 + t->world[2][1] * b2;
            wp.z = t->world[0][2] * b0 + t->world[1][2] * b1 + t->world[2][2] * b2;
            n.x = t->nrm[0][0] * b0 + t->nrm[1][0] * b1 + t->nrm[2][0] * b2;
            n.y = t->nrm[0][1] * b0 + t->nrm[1][1] * b1 + t->nrm[2][1] * b2;
            n.z = t->nrm[0][2] * b0 + t->nrm[1][2] * b1 + t->nrm[2][2] * b2;

            float rgb[3], tex[4];
            float u = t->uv[0][0] * b0 + t->uv[1][0] * b1 + t->uv[2][0] * b2;
            float v = t->uv[0][1] * b0 + t->uv[1][1] * b1 + t->uv[2][1] * b2;
            float rho = texture_footprint(t, it->texture, l0, l1, l2, u, v);
            sample_texture(it->texture, u, v, rho, tex);
            float alpha = it->color.w * tex[3];
            if (it->alpha_mode == 1 && alpha < it->alpha_cutoff) continue;
            shade(it, vs, wp, n, tex, rgb);
            if (counting) shaded += 1;
            blend_pixel(fb + at * 3, rgb, alpha, blended);
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
        depth[i] = 1.0f;
    }
}

void g3p_draw_frame(g3_draw_item_slice items, const g3_view_state *view) {
    if (!fb) return;
    if (view->shadow_params.x > 0.5f) render_shadow_map(items, view);
    prof.frames += 1;
    const double t0 = prof.on ? now_seconds() : 0.0;

    clear_frame(view);
    const double t1 = prof.on ? now_seconds() : 0.0;

    queue_len = 0;
    for (int64_t i = 0; i < items.len; i++) {
        const g3_draw_item *it = &items.data[i];
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
    if (view->params.y > 0.5f) {
        size_t components = (size_t)fb_w * (size_t)fb_h * 3;
        for (size_t i = 0; i < components; i++)
            fb[i] = (uint8_t)(srgb_encode(fb[i] / 255.0f) * 255.0f + 0.5f);
    }
    const double t3 = prof.on ? now_seconds() : 0.0;
    if (prof.on) {
        prof.clear += t1 - t0;
        prof.setup += t2 - t1;
        prof.raster += t3 - t2;
        prof.wall += t3 - t0;
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
