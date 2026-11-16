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
typedef struct { g3_vec2 offset, scale; float rotation; int32_t texcoord; } g3_uv_transform;

/* Tangent.xyz is local direction and w is handedness; zero xyz derives it from UVs.
   Vertex colour is linear RGBA and defaults to white. */
typedef struct { g3_vec3 pos, normal; g3_vec2 uv, uv1, uv2, uv3, uv4, uv5, uv6, uv7; g3_vec4 tangent, color; } g3_vertex;

/* One primitive: mesh, matrices, colour, and the shading parameters.
   params.x is 1 for unlit, .y specular strength, .z shininess, .w 1 when
   the item is blended. alpha_mode selects opaque, mask, or blend.
   double_sided draws both winding directions and flips back-face normals.
 
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
    g3_vec4 pbr; /* x enabled, y metallic, z roughness, w index of refraction */
    int32_t metallic_roughness_texture;
    int32_t normal_texture;
    float normal_scale;
    int32_t occlusion_texture;
    float occlusion_strength;
    g3_vec4 emissive;
    int32_t emissive_texture;
    uint8_t double_sided;
    g3_uv_transform base_color_uv;
    g3_uv_transform metallic_roughness_uv;
    g3_uv_transform normal_uv;
    g3_uv_transform occlusion_uv;
    g3_uv_transform emissive_uv;
    g3_vec4 specular; /* rgb colour factor, w strength factor */
    int32_t specular_texture;
    int32_t specular_color_texture;
    g3_uv_transform specular_uv;
    g3_uv_transform specular_color_uv;
    g3_vec4 clearcoat; /* x clearcoat factor, y roughness */
    int32_t clearcoat_texture, clearcoat_roughness_texture;
    int32_t clearcoat_normal_texture;
    float clearcoat_normal_scale;
    g3_uv_transform clearcoat_uv, clearcoat_roughness_uv, clearcoat_normal_uv;
    g3_vec4 sheen; /* rgb colour factor, w roughness */
    int32_t sheen_color_texture, sheen_roughness_texture;
    g3_uv_transform sheen_color_uv, sheen_roughness_uv;
    g3_vec4 anisotropy; /* x strength, y rotation */
    int32_t anisotropy_texture;
    g3_uv_transform anisotropy_uv;
    float environment_intensity; /* per-material multiplier for environment fill and reflections */
    int32_t shader;      /* custom fragment program id, -1 selects the standard program; WebGL-only */
    g3_vec4 user0, user1, user2, user3; /* exposed to custom shaders as u_user[4] */
} g3_draw_item;

typedef struct { g3_vec4 position, direction, color; float inner, attenuation; } g3_light;

/* The frame's shared constants. */
typedef struct {
    g3_vec3 eye;
    g3_vec3 light_dir;
    g3_vec3 light_color;
    g3_vec4 ambient;      /* rgb, a = intensity */
    g3_vec4 fog;          /* rgb, a = density */
    g3_vec4 clear;
    g3_vec4 params;       /* x time, y sRGB output, z tone mapping, w exposure */
    g3_light lights[8];
    int32_t light_count;
    g3_vec4 env_sky, env_ground;
    int32_t environment_texture; /* equirectangular RGB or HDR texture, -1 disables */
    float environment_intensity;
    g3_mat4 shadow_view_proj;
    g3_vec4 shadow_params; /* x enabled, y depth bias, z PCF radius */
    g3_vec4 view_direction; /* xyz toward viewer, w = orthographic */
    g3_mat4 point_shadow_view_proj[6];
    int32_t point_shadow_light_index;
    g3_vec4 point_shadow_params; /* x enabled, y depth bias, z PCF radius */
    g3_mat4 spot_shadow_view_proj;
    int32_t spot_shadow_light_index;
    g3_vec4 spot_shadow_params; /* x enabled, y depth bias, z PCF radius */
    int32_t shadow_resolution; /* 256, 512, or 1024 */
    int32_t post_process; /* bit 0 enables FXAA */
    int32_t render_target; /* texture id, -1 renders to surface */
    int32_t target_width, target_height;
    g3_mat4 view_proj;
    g3_vec2 env_rotation; /* cosine and sine of equirectangular yaw */
} g3_view_state;

typedef struct { const g3_vertex *data; int64_t len; } g3_vertex_slice;
typedef struct { const uint32_t *data; int64_t len; } g3_u32_slice;
typedef struct { const g3_draw_item *data; int64_t len; } g3_draw_item_slice;
/* A Goose `const u8[:]`: data and length, with no terminator. */
typedef struct { const uint8_t *data; int64_t len; } g3_u8_slice;
typedef struct { const float *data; int64_t len; } g3_f32_slice;

#pragma pack(pop)

_Static_assert(sizeof(g3_vertex) == 120, "g3_vertex must be 120 bytes");
_Static_assert(offsetof(g3_vertex, uv) == 24, "Vertex.uv offset");
_Static_assert(offsetof(g3_vertex, uv1) == 32, "Vertex.uv1 offset");
_Static_assert(offsetof(g3_vertex, uv2) == 40, "Vertex.uv2 offset");
_Static_assert(offsetof(g3_vertex, uv3) == 48, "Vertex.uv3 offset");
_Static_assert(offsetof(g3_vertex, uv4) == 56, "Vertex.uv4 offset");
_Static_assert(offsetof(g3_vertex, uv5) == 64, "Vertex.uv5 offset");
_Static_assert(offsetof(g3_vertex, uv6) == 72, "Vertex.uv6 offset");
_Static_assert(offsetof(g3_vertex, uv7) == 80, "Vertex.uv7 offset");
_Static_assert(offsetof(g3_vertex, tangent) == 88, "Vertex.tangent offset");
_Static_assert(offsetof(g3_vertex, color) == 104, "Vertex.color offset");
_Static_assert(sizeof(g3_mat4) == 64, "g3_mat4 must be 64 bytes");
_Static_assert(sizeof(g3_draw_item) == 721, "g3_draw_item must be 721 bytes");
_Static_assert(offsetof(g3_draw_item, texture) == 168, "DrawItem.texture offset");
_Static_assert(offsetof(g3_draw_item, alpha_mode) == 172, "DrawItem.alpha_mode offset");
_Static_assert(offsetof(g3_draw_item, alpha_cutoff) == 176, "DrawItem.alpha_cutoff offset");
_Static_assert(offsetof(g3_draw_item, pbr) == 180, "DrawItem.pbr offset");
_Static_assert(offsetof(g3_draw_item, metallic_roughness_texture) == 196, "DrawItem.metallic_roughness_texture offset");
_Static_assert(offsetof(g3_draw_item, normal_texture) == 200, "DrawItem.normal_texture offset");
_Static_assert(offsetof(g3_draw_item, normal_scale) == 204, "DrawItem.normal_scale offset");
_Static_assert(offsetof(g3_draw_item, occlusion_texture) == 208, "DrawItem.occlusion_texture offset");
_Static_assert(offsetof(g3_draw_item, occlusion_strength) == 212, "DrawItem.occlusion_strength offset");
_Static_assert(offsetof(g3_draw_item, emissive) == 216, "DrawItem.emissive offset");
_Static_assert(offsetof(g3_draw_item, emissive_texture) == 232, "DrawItem.emissive_texture offset");
_Static_assert(offsetof(g3_draw_item, double_sided) == 236, "DrawItem.double_sided offset");
_Static_assert(sizeof(g3_uv_transform) == 24, "g3_uv_transform must be 24 bytes");
_Static_assert(offsetof(g3_draw_item, base_color_uv) == 237, "DrawItem.base_color_uv offset");
_Static_assert(offsetof(g3_draw_item, metallic_roughness_uv) == 261, "DrawItem.metallic_roughness_uv offset");
_Static_assert(offsetof(g3_draw_item, normal_uv) == 285, "DrawItem.normal_uv offset");
_Static_assert(offsetof(g3_draw_item, occlusion_uv) == 309, "DrawItem.occlusion_uv offset");
_Static_assert(offsetof(g3_draw_item, emissive_uv) == 333, "DrawItem.emissive_uv offset");
_Static_assert(offsetof(g3_draw_item, specular) == 357, "DrawItem.specular offset");
_Static_assert(offsetof(g3_draw_item, specular_texture) == 373, "DrawItem.specular_texture offset");
_Static_assert(offsetof(g3_draw_item, specular_color_texture) == 377, "DrawItem.specular_color_texture offset");
_Static_assert(offsetof(g3_draw_item, specular_uv) == 381, "DrawItem.specular_uv offset");
_Static_assert(offsetof(g3_draw_item, specular_color_uv) == 405, "DrawItem.specular_color_uv offset");
_Static_assert(offsetof(g3_draw_item, clearcoat) == 429, "DrawItem.clearcoat offset");
_Static_assert(offsetof(g3_draw_item, clearcoat_texture) == 445, "DrawItem.clearcoat_texture offset");
_Static_assert(offsetof(g3_draw_item, clearcoat_normal_texture) == 453, "DrawItem.clearcoat_normal_texture offset");
_Static_assert(offsetof(g3_draw_item, clearcoat_normal_scale) == 457, "DrawItem.clearcoat_normal_scale offset");
_Static_assert(offsetof(g3_draw_item, clearcoat_uv) == 461, "DrawItem.clearcoat_uv offset");
_Static_assert(offsetof(g3_draw_item, clearcoat_roughness_uv) == 485, "DrawItem.clearcoat_roughness_uv offset");
_Static_assert(offsetof(g3_draw_item, clearcoat_normal_uv) == 509, "DrawItem.clearcoat_normal_uv offset");
_Static_assert(offsetof(g3_draw_item, sheen) == 533, "DrawItem.sheen offset");
_Static_assert(offsetof(g3_draw_item, sheen_color_texture) == 549, "DrawItem.sheen_color_texture offset");
_Static_assert(offsetof(g3_draw_item, sheen_roughness_texture) == 553, "DrawItem.sheen_roughness_texture offset");
_Static_assert(offsetof(g3_draw_item, sheen_color_uv) == 557, "DrawItem.sheen_color_uv offset");
_Static_assert(offsetof(g3_draw_item, sheen_roughness_uv) == 581, "DrawItem.sheen_roughness_uv offset");
_Static_assert(offsetof(g3_draw_item, anisotropy) == 605, "DrawItem.anisotropy offset");
_Static_assert(offsetof(g3_draw_item, anisotropy_texture) == 621, "DrawItem.anisotropy_texture offset");
_Static_assert(offsetof(g3_draw_item, anisotropy_uv) == 625, "DrawItem.anisotropy_uv offset");
_Static_assert(offsetof(g3_draw_item, environment_intensity) == 649, "DrawItem.environment_intensity offset");
_Static_assert(offsetof(g3_draw_item, shader) == 653, "DrawItem.shader offset");
_Static_assert(offsetof(g3_draw_item, user0) == 657, "DrawItem.user0 offset");
_Static_assert(sizeof(g3_light) == 56, "g3_light must be 56 bytes");
_Static_assert(offsetof(g3_light, attenuation) == 52, "Light.attenuation offset");
_Static_assert(sizeof(g3_view_state) == 1268, "g3_view_state must be 1268 bytes");
_Static_assert(offsetof(g3_view_state, lights) == 100, "ViewState.lights offset");
_Static_assert(offsetof(g3_view_state, light_count) == 548, "ViewState.light_count offset");
_Static_assert(offsetof(g3_view_state, env_sky) == 552, "ViewState.env_sky offset");
_Static_assert(offsetof(g3_view_state, environment_texture) == 584, "ViewState.environment_texture offset");
_Static_assert(offsetof(g3_view_state, shadow_view_proj) == 592, "ViewState.shadow_view_proj offset");
_Static_assert(offsetof(g3_view_state, shadow_params) == 656, "ViewState.shadow_params offset");
_Static_assert(offsetof(g3_view_state, view_direction) == 672, "ViewState.view_direction offset");
_Static_assert(offsetof(g3_view_state, point_shadow_view_proj) == 688, "ViewState.point_shadow_view_proj offset");
_Static_assert(offsetof(g3_view_state, point_shadow_light_index) == 1072, "ViewState.point_shadow_light_index offset");
_Static_assert(offsetof(g3_view_state, point_shadow_params) == 1076, "ViewState.point_shadow_params offset");
_Static_assert(offsetof(g3_view_state, spot_shadow_view_proj) == 1092, "ViewState.spot_shadow_view_proj offset");
_Static_assert(offsetof(g3_view_state, spot_shadow_light_index) == 1156, "ViewState.spot_shadow_light_index offset");
_Static_assert(offsetof(g3_view_state, spot_shadow_params) == 1160, "ViewState.spot_shadow_params offset");
_Static_assert(offsetof(g3_view_state, shadow_resolution) == 1176, "ViewState.shadow_resolution offset");
_Static_assert(offsetof(g3_view_state, post_process) == 1180, "ViewState.post_process offset");
_Static_assert(offsetof(g3_view_state, render_target) == 1184, "ViewState.render_target offset");
_Static_assert(offsetof(g3_view_state, target_width) == 1188, "ViewState.target_width offset");
_Static_assert(offsetof(g3_view_state, target_height) == 1192, "ViewState.target_height offset");
_Static_assert(offsetof(g3_view_state, view_proj) == 1196, "ViewState.view_proj offset");
_Static_assert(offsetof(g3_view_state, env_rotation) == 1260, "ViewState.env_rotation offset");
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

#define G3_BRDF_LUT_SIZE 128
static inline uint32_t g3_radical_inverse_vdc(uint32_t bits) {
    bits=(bits<<16)|(bits>>16);
    bits=((bits&0x55555555u)<<1)|((bits&0xAAAAAAAAu)>>1);
    bits=((bits&0x33333333u)<<2)|((bits&0xCCCCCCCCu)>>2);
    bits=((bits&0x0F0F0F0Fu)<<4)|((bits&0xF0F0F0F0u)>>4);
    bits=((bits&0x00FF00FFu)<<8)|((bits&0xFF00FF00u)>>8);
    return bits;
}

/* Integrate the split-sum GGX specular BRDF for each NdotV/roughness pair.
   RG store the scale and bias terms used as F0*A+B. */
static inline void g3_brdf_lut_generate(uint8_t *pixels) {
    const int samples=128, size=G3_BRDF_LUT_SIZE;
    for (int y=0;y<size;y++) for (int x=0;x<size;x++) {
        float nv=((float)x+0.5f)/(float)size;
        float rough=fmaxf(0.045f,((float)y+0.5f)/(float)size);
        float vx=sqrtf(fmaxf(0.0f,1.0f-nv*nv)), vy=0.0f, vz=nv;
        float k=rough*rough*0.5f, a_sum=0.0f, b_sum=0.0f;
        for (uint32_t i=0;i<(uint32_t)samples;i++) {
            float xi1=((float)i+0.5f)/(float)samples;
            float xi2=(float)g3_radical_inverse_vdc(i)*2.3283064365386963e-10f;
            float phi=6.28318530718f*xi1, alpha=rough*rough, alpha2=alpha*alpha;
            float cos_theta=sqrtf((1.0f-xi2)/(1.0f+(alpha2-1.0f)*xi2));
            float sin_theta=sqrtf(fmaxf(0.0f,1.0f-cos_theta*cos_theta));
            float hx=cosf(phi)*sin_theta, hy=sinf(phi)*sin_theta, hz=cos_theta;
            float vh=fmaxf(vx*hx+vy*hy+vz*hz,0.0f);
            float lx=2.0f*vh*hx-vx, ly=2.0f*vh*hy-vy, lz=2.0f*vh*hz-vz;
            float nl=fmaxf(lz,0.0f), nh=fmaxf(hz,0.0f);
            if (nl<=0.0f || nh<=0.0f || vh<=0.0f) continue;
            float gv=nv/(nv*(1.0f-k)+k), gl=nl/(nl*(1.0f-k)+k);
            float visibility=(gv*gl*vh)/fmaxf(nh*nv,1e-6f);
            float fc=powf(1.0f-vh,5.0f);
            a_sum+=(1.0f-fc)*visibility;
            b_sum+=fc*visibility;
        }
        size_t offset=((size_t)y*size+x)*4;
        float a=fmaxf(0.0f,fminf(a_sum/(float)samples,1.0f));
        float b=fmaxf(0.0f,fminf(b_sum/(float)samples,1.0f));
        pixels[offset]=(uint8_t)(a*255.0f+0.5f);
        pixels[offset+1]=(uint8_t)(b*255.0f+0.5f);
        pixels[offset+2]=0; pixels[offset+3]=255;
    }
}

/* --- what a backend implements (see src/g3/platform.goose) --- */

uint8_t g3p_init(int32_t width, int32_t height, g3_u8_slice title);
void g3p_shutdown(void);
int32_t g3p_width(void);
int32_t g3p_height(void);
void g3p_upload_mesh(int32_t id, g3_vertex_slice verts, g3_u32_slice indices);
void g3p_release_mesh(int32_t id);
void g3p_upload_texture(int32_t id, g3_u8_slice pixels, int32_t width, int32_t height);
void g3p_upload_texture_srgb(int32_t id, g3_u8_slice pixels, int32_t width, int32_t height);
void g3p_upload_texture_hdr(int32_t id, g3_f32_slice pixels, int32_t width, int32_t height);
uint8_t g3p_create_render_target(int32_t id, int32_t width, int32_t height);
uint8_t g3p_resize_render_target(int32_t id, int32_t width, int32_t height);
uint8_t g3p_post_process(int32_t source, int32_t destination, int32_t effect);
uint8_t g3p_post_process_shader_create(int32_t id, g3_u8_slice body);
void g3p_post_process_shader_release(int32_t id);
uint8_t g3p_post_process_shader_run(int32_t shader, int32_t source, int32_t destination);
uint8_t g3p_material_shader_create(int32_t id, g3_u8_slice header, g3_u8_slice body);
void g3p_material_shader_release(int32_t id);
int32_t g3p_texture_width(int32_t id);
int32_t g3p_texture_height(int32_t id);
uint8_t g3p_load_radiance_hdr(int32_t id, g3_u8_slice path);
void g3p_release_texture(int32_t id);
void g3p_texture_wrap(int32_t id, int32_t wrap_u, int32_t wrap_v);
void g3p_texture_filter(int32_t id, int32_t min_filter, int32_t mag_filter);
void g3p_texture_generate_mips(int32_t id);
void g3p_texture_generate_env_mips(int32_t id);
void g3p_draw_frame(g3_draw_item_slice items, const g3_view_state *view);
uint8_t g3p_key_down(int32_t key);
float g3p_mouse_dx(void);
float g3p_mouse_dy(void);
uint8_t g3p_save_frame(g3_u8_slice path);
uint32_t g3p_read_pixel(int32_t x, int32_t y);

#endif /* G3_ABI_H */
