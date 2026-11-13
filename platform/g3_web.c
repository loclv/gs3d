/* The browser backend: WebGL2, through Emscripten.
 
   This is the same contract as g3_soft.c — one `g3p_draw_frame` per frame with
   the engine's sorted draw list — implemented by a single shader and one draw
   call per item. The fragment shader is the one g3_soft.c's `shade()` spells
   out in C, so a frame drawn on the GPU matches the reference rasterizer's.
 
   The program is built `--standalone`: Goose emits `goose_init` and the
   exported `g3_app_*` functions, and `g3_host_start` (below) is the C entry
   point the page calls. It builds the GL context and hands the loop to the
   page, which calls `g3_app_frame` from requestAnimationFrame; see
   web/shell.js.
 
   Input arrives from the page through the `g3_input_*` functions of
   platform/g3_input.c, which is shared with the other backend and exported to
   JavaScript by that file's Emscripten attribute. */

#include "g3_abi.h"
#include "g3_input.h"

#include <GLES3/gl3.h>
#include <emscripten.h>
#include <emscripten/html5.h>

#include <stdio.h>
#include <stdlib.h>
#include <string.h>

#include "g3.h"   /* the exported Goose functions: g3_app_init, g3_app_frame, ... */

typedef struct {
    GLuint vao, vbo, ebo;
    GLsizei count;
} web_mesh;

/* The one program every item draws with, and where its uniforms live. */
typedef struct {
    GLuint program;
    GLint mvp, model, normal_matrix, color, params, eye, light_dir, light_color, ambient, fog, tex, textured;
    GLint light_count, light_position[4], light_direction[4], light_color_extra[4], light_inner[4];
    GLint env_sky, env_ground, view_direction, pbr, mr_tex, mr_textured;
    GLint normal_tex, normal_textured, normal_scale, occlusion_tex, occlusion_textured, occlusion_strength;
    GLint emissive, emissive_tex, emissive_textured;
    GLint env_map, env_map_enabled, env_map_intensity;
    GLint shadow_map, shadow_matrix, shadow_params, shadow_resolution;
    GLint point_shadow_map, point_shadow_matrices, point_shadow_index, point_shadow_params;
    GLint spot_shadow_map, spot_shadow_matrix, spot_shadow_index, spot_shadow_params;
    GLint alpha_mode, alpha_cutoff;
} web_shader;

static EMSCRIPTEN_WEBGL_CONTEXT_HANDLE ctx;
static web_shader shader;

static int32_t surf_w = 1280, surf_h = 720;
static web_mesh *meshes;
static int32_t mesh_count, mesh_cap;
static GLuint *textures;
static int32_t texture_count;
static GLuint env_sampler;
static int checked_gl;
static GLuint shadow_program, shadow_fbo, shadow_texture;
static GLuint point_shadow_texture;
static GLuint spot_shadow_texture;
static GLint shadow_light_matrix, shadow_model_matrix;
static GLint shadow_mask, shadow_cutoff, shadow_alpha, shadow_tex, shadow_textured;
static GLuint output_program, output_fbo, output_color, output_depth, output_vao;
static GLint output_sampler;
static int output_width, output_height;
static int shadow_map_size = 512;
static int allocated_shadow_size;

static const char *VERTEX_SRC =
    "#version 300 es\n"
    "layout(location = 0) in vec3 a_pos;\n"
    "layout(location = 1) in vec3 a_normal;\n"
    "layout(location = 2) in vec2 a_uv;\n"
    "uniform mat4 u_mvp;\n"
    "uniform mat4 u_model;\n"
    "uniform mat3 u_normal_matrix;\n"
    "out vec3 v_normal;\n"
    "out vec3 v_world;\n"
    "out vec2 v_uv;\n"
    "void main() {\n"
    "    vec4 world = u_model * vec4(a_pos, 1.0);\n"
    "    v_world = world.xyz;\n"
    "    v_uv = a_uv;\n"
    "    v_normal = u_normal_matrix * a_normal;\n"
    "    gl_Position = u_mvp * vec4(a_pos, 1.0);\n"
    "}\n";

/* Keep this in step with shade() in g3_soft.c. */
static const char *FRAGMENT_SRC =
    "#version 300 es\n"
    "precision highp float;\n"
    "in vec3 v_normal;\n"
    "in vec3 v_world;\n"
    "in vec2 v_uv;\n"
    "uniform sampler2D u_tex;\n"
    "uniform bool u_textured;\n"
    "uniform vec4 u_color;\n"
    "uniform vec4 u_params;\n"   /* x unlit, y specular strength, z shininess, w blended */
    "uniform vec4 u_pbr;\n"
    "uniform sampler2D u_mr_tex;\n"
    "uniform bool u_mr_textured;\n"
    "uniform sampler2D u_normal_tex;\n"
    "uniform bool u_normal_textured;\n"
    "uniform float u_normal_scale;\n"
    "uniform sampler2D u_occlusion_tex;\n"
    "uniform bool u_occlusion_textured;\n"
    "uniform float u_occlusion_strength;\n"
    "uniform vec4 u_emissive;\n"
    "uniform sampler2D u_emissive_tex;\n"
    "uniform bool u_emissive_textured;\n"
    "uniform int u_alpha_mode;\n"
    "uniform float u_alpha_cutoff;\n"
    "uniform vec3 u_eye;\n"
    "uniform vec4 u_view_direction;\n"
    "uniform vec3 u_light_dir;\n"
    "uniform vec3 u_light_color;\n"
    "struct Light { vec4 position; vec4 direction; vec4 color; float inner; };\n"
    "uniform Light u_lights[4];\n"
    "uniform int u_light_count;\n"
    "uniform vec4 u_env_sky;\n"
    "uniform vec4 u_env_ground;\n"
    "uniform sampler2D u_env_map;\n"
    "uniform bool u_env_map_enabled;\n"
    "uniform float u_env_map_intensity;\n"
    "uniform sampler2D u_shadow_map;\n"
    "uniform mat4 u_shadow_matrix;\n"
    "uniform vec4 u_shadow_params;\n"
    "uniform float u_shadow_resolution;\n"
    "uniform samplerCubeShadow u_point_shadow_map;\n"
    "uniform mat4 u_point_shadow_matrices[6];\n"
    "uniform int u_point_shadow_index;\n"
    "uniform vec4 u_point_shadow_params;\n"
    "uniform sampler2DShadow u_spot_shadow_map;\n"
    "uniform mat4 u_spot_shadow_matrix;\n"
    "uniform int u_spot_shadow_index;\n"
    "uniform vec4 u_spot_shadow_params;\n"
    "uniform vec4 u_ambient;\n"
    "uniform vec4 u_fog;\n"
    "out vec4 out_color;\n"
    "vec3 pbr_light(vec3 n, vec3 v, vec3 l, vec3 base, float metal, float rough) {\n"
    "    float nl = max(dot(n,l), 0.0), nv = max(dot(n,v), 0.0);\n"
    "    vec3 sum = l + v; float len = length(sum);\n"
    "    if (nl <= 0.0 || nv <= 0.0 || len <= 1e-12) return vec3(0.0);\n"
    "    vec3 h = sum / len; float nh = max(dot(n,h), 0.0), vh = max(dot(v,h), 0.0);\n"
    "    rough = clamp(rough, 0.045, 1.0); float alpha = rough*rough, a2 = alpha*alpha;\n"
    "    float denom = nh*nh*(a2-1.0)+1.0; float d = a2 / (3.14159265359*denom*denom);\n"
    "    float gv = nl*sqrt(nv*nv*(1.0-a2)+a2), gl = nv*sqrt(nl*nl*(1.0-a2)+a2);\n"
    "    float vis = 0.5/max(gv+gl, 1e-6); metal = clamp(metal, 0.0, 1.0);\n"
    "    vec3 f0 = mix(vec3(0.04), base, metal);\n"
    "    vec3 f = f0 + (1.0-f0)*pow(1.0-min(vh, 1.0), 5.0);\n"
    "    return ((1.0-f)*(1.0-metal)*base/3.14159265359 + d*vis*f)*nl;\n"
    "}\n"
    "void main() {\n"
    "    float normal_length = length(v_normal);\n"
    "    vec3 n = normal_length > 1e-12 ? v_normal / normal_length : vec3(0.0);\n"
    "    if (u_normal_textured && normal_length > 1e-12) {\n"
    "        vec3 dpdx = dFdx(v_world), dpdy = dFdy(v_world);\n"
    "        vec2 duvdx = dFdx(v_uv), duvdy = dFdy(v_uv);\n"
    "        float det = duvdx.x*duvdy.y - duvdx.y*duvdy.x;\n"
    "        if (abs(det) > 1e-12) {\n"
    "            vec3 t = (dpdx*duvdy.y - dpdy*duvdx.y) / det;\n"
    "            vec3 b = (-dpdx*duvdy.x + dpdy*duvdx.x) / det;\n"
    "            t -= n*dot(n,t); float tl = length(t);\n"
    "            if (tl > 1e-12) {\n"
    "                t /= tl; b -= n*dot(n,b) + t*dot(t,b); float bl = length(b);\n"
    "                if (bl > 1e-12) {\n"
    "                    b /= bl; vec3 map_n = texture(u_normal_tex, v_uv).xyz*2.0-1.0;\n"
    "                    map_n.xy *= u_normal_scale; float ml = length(map_n);\n"
    "                    if (ml > 1e-12) n = normalize(t*map_n.x + b*map_n.y + n*map_n.z);\n"
    "                }\n"
    "            }\n"
    "        }\n"
    "    }\n"
    "    vec3 l = -u_light_dir;\n"
    "    float diff = max(dot(n, l), 0.0);\n"
    "    vec3 v = normalize(u_view_direction.w > 0.5 ? u_view_direction.xyz : u_eye - v_world);\n"
    "    vec3 h = normalize(l + v);\n"
    "    float spec = pow(max(dot(n, h), 0.0), max(u_params.z, 1.0)) * u_params.y;\n"
    "    vec4 texel = u_textured ? texture(u_tex, v_uv) : vec4(1.0);\n"
    "    float alpha = u_color.a * texel.a;\n"
    "    if (u_alpha_mode == 1 && alpha < u_alpha_cutoff) discard;\n"
    "    vec3 base = u_color.rgb * texel.rgb;\n"
    "    float ao = 1.0;\n"
    "    if (u_occlusion_textured) ao = 1.0 + u_occlusion_strength*(texture(u_occlusion_tex, v_uv).r-1.0);\n"
    "    vec2 mr = u_pbr.yz;\n"
    "    if (u_mr_textured) { vec4 packed_mr = texture(u_mr_tex, v_uv); mr *= packed_mr.bg; }\n"
    "    float visibility = 1.0;\n"
    "    if (u_shadow_params.x > 0.5) {\n"
    "        vec4 light_pos = u_shadow_matrix * vec4(v_world, 1.0);\n"
    "        vec3 uvz = light_pos.xyz / light_pos.w * 0.5 + 0.5;\n"
    "        if (light_pos.w > 0.0 && all(greaterThanEqual(uvz, vec3(0.0))) && all(lessThan(uvz.xy, vec2(1.0))) && uvz.z <= 1.0) {\n"
    "            int radius = int(u_shadow_params.z + 0.5); float sum = 0.0; float count = 0.0;\n"
    "            for (int y=-2; y<=2; y++) for (int x=-2; x<=2; x++) if (abs(x)<=radius && abs(y)<=radius) {\n"
    "                float depth = texture(u_shadow_map, uvz.xy + vec2(float(x),float(y))/u_shadow_resolution).r;\n"
    "                sum += uvz.z-u_shadow_params.y <= depth ? 1.0 : 0.0; count += 1.0;\n"
    "            }\n"
    "            visibility = sum / max(count,1.0);\n"
    "        }\n"
    "    }\n"
    "    vec3 col = base * (u_ambient.rgb * u_ambient.a * ao + u_light_color * diff * visibility)\n"
    "             + u_light_color * spec * visibility;\n"
    "    float env_scale = u_pbr.x > 0.5 ? 1.0-clamp(mr.x,0.0,1.0) : 1.0;\n"
    "    if (u_pbr.x > 0.5) col = base*u_ambient.rgb*u_ambient.a*env_scale*ao + pbr_light(n,v,l,base,mr.x,mr.y)*u_light_color*visibility;\n"
    "    float sky = clamp(n.y * 0.5 + 0.5, 0.0, 1.0);\n"
    "    col += base * mix(u_env_ground.rgb, u_env_sky.rgb, sky) * u_env_sky.a * env_scale * ao;\n"
    "    if (u_env_map_enabled) {\n"
    "        vec2 env_uv = vec2(atan(n.z, n.x) / 6.28318530718 + 0.5, acos(clamp(n.y, -1.0, 1.0)) / 3.14159265359);\n"
    "        col += base * textureLod(u_env_map, env_uv, 0.0).rgb * u_env_map_intensity * env_scale * ao;\n"
    "        if (u_pbr.x > 0.5) {\n"
    "            vec3 reflected = reflect(-v, n);\n"
    "            vec2 spec_uv = vec2(atan(reflected.z, reflected.x) / 6.28318530718 + 0.5, acos(clamp(reflected.y, -1.0, 1.0)) / 3.14159265359);\n"
    "            float rough = clamp(mr.y, 0.045, 1.0);\n"
    "            vec3 f0 = mix(vec3(0.04), base, clamp(mr.x, 0.0, 1.0));\n"
    "            vec3 fresnel = f0 + (max(vec3(1.0-rough), f0)-f0)*pow(1.0-max(dot(n,v),0.0),5.0);\n"
    "            col += textureLod(u_env_map, spec_uv, rough*rough*8.0).rgb * fresnel * u_env_map_intensity * ao;\n"
    "        }\n"
    "    }\n"
    "    for (int i = 0; i < u_light_count; i++) {\n"
    "        Light light = u_lights[i];\n"
    "        vec3 delta = light.position.xyz - v_world;\n"
    "        float distance_to_light = length(delta);\n"
    "        vec3 ld = light.position.w < 0.5 ? -light.direction.xyz : delta / max(distance_to_light, 0.000001);\n"
    "        float falloff = 1.0;\n"
    "        if (light.position.w > 0.5) {\n"
    "            falloff = max(1.0 - distance_to_light / light.direction.w, 0.0);\n"
    "            falloff *= falloff;\n"
    "        }\n"
    "        if (light.position.w > 1.5) {\n"
    "            float cone = clamp((dot(-ld, light.direction.xyz) - light.color.w) / (light.inner - light.color.w), 0.0, 1.0);\n"
    "            falloff *= cone * cone * (3.0 - 2.0 * cone);\n"
    "        }\n"
    "        if (u_point_shadow_params.x > 0.5 && i == u_point_shadow_index && light.position.w > 0.5 && light.position.w < 1.5) {\n"
    "            vec3 delta = v_world - light.position.xyz; vec3 ad = abs(delta);\n"
    "            int face = ad.x >= ad.y && ad.x >= ad.z ? (delta.x >= 0.0 ? 0 : 1) : ad.y >= ad.z ? (delta.y >= 0.0 ? 2 : 3) : (delta.z >= 0.0 ? 4 : 5);\n"
    "            vec4 lp = u_point_shadow_matrices[face] * vec4(v_world, 1.0);\n"
    "            float refz = lp.z / lp.w * 0.5 + 0.5 - u_point_shadow_params.y;\n"
    "            if (lp.w > 0.0 && refz >= 0.0 && refz <= 1.0) {\n"
    "                int radius=int(u_point_shadow_params.z+0.5); float sum=0.0; float count=0.0;\n"
    "                vec3 ray=normalize(delta); vec3 up=abs(ray.y)<0.99?vec3(0.0,1.0,0.0):vec3(1.0,0.0,0.0);\n"
    "                vec3 tangent=normalize(cross(ray,up)); vec3 bitangent=cross(ray,tangent);\n"
    "                for(int y=-2;y<=2;y++) for(int x=-2;x<=2;x++) if(abs(x)<=radius&&abs(y)<=radius) {\n"
    "                    vec3 sample_ray=delta+(tangent*float(x)+bitangent*float(y))*(2.0/u_shadow_resolution*length(delta));\n"
    "                    sum+=texture(u_point_shadow_map,vec4(sample_ray,refz)); count+=1.0;\n"
    "                }\n"
    "                falloff*=sum/max(count,1.0);\n"
    "            }\n"
    "        }\n"
    "        if (u_spot_shadow_params.x > 0.5 && i == u_spot_shadow_index && light.position.w > 1.5) {\n"
    "            vec4 lp = u_spot_shadow_matrix * vec4(v_world, 1.0);\n"
    "            if (lp.w > 0.0) { vec3 uvz = lp.xyz / lp.w * 0.5 + 0.5;\n"
    "                if (all(greaterThanEqual(uvz, vec3(0.0))) && all(lessThan(uvz.xy, vec2(1.0))) && uvz.z <= 1.0) {\n"
    "                    int radius=int(u_spot_shadow_params.z+0.5); float sum=0.0; float count=0.0;\n"
    "                    for(int y=-2;y<=2;y++) for(int x=-2;x<=2;x++) if(abs(x)<=radius&&abs(y)<=radius) {\n"
    "                        sum+=texture(u_spot_shadow_map,vec3(uvz.xy+vec2(float(x),float(y))/u_shadow_resolution,uvz.z-u_spot_shadow_params.y)); count+=1.0;\n"
    "                    }\n"
    "                    falloff*=sum/max(count,1.0);\n"
    "                }\n"
    "            }\n"
    "        }\n"
    "        float d = max(dot(n, ld), 0.0);\n"
    "        vec3 halfdir = normalize(ld + v);\n"
    "        float s = pow(max(dot(n, halfdir), 0.0), max(u_params.z, 1.0)) * u_params.y;\n"
    "        col += (u_pbr.x > 0.5 ? pbr_light(n,v,ld,base,mr.x,mr.y) : base*d + vec3(s)) * light.color.rgb * falloff;\n"
    "    }\n"
    "    if (u_params.x > 0.5) col = base;\n"
    "    vec3 emissive_texel = u_emissive_textured ? texture(u_emissive_tex, v_uv).rgb : vec3(1.0);\n"
    "    col += u_emissive.rgb * emissive_texel;\n"
    "    float dist = length(u_eye - v_world);\n"
    "    float fog = clamp(1.0 - exp(-dist * u_fog.a), 0.0, 1.0);\n"
    "    col = mix(col, u_fog.rgb, fog);\n"
    "    out_color = vec4(col, u_alpha_mode == 2 ? alpha : 1.0);\n"
    "}\n";

/* --- the program --- */

/* Startup failures are reported to the page as well as to the console: a
   visitor without WebGL2 should be told what happened, not told to open dev
   tools. shell.js defines window.gooseError. */
static void report(const char *what) {
    EM_ASM({ if (window.gooseError) window.gooseError(UTF8ToString($0)); }, what);
}

static GLuint compile_shader(GLenum kind, const char *src, const char *what) {
    GLuint s = glCreateShader(kind);
    glShaderSource(s, 1, &src, NULL);
    glCompileShader(s);
    GLint ok = 0;
    glGetShaderiv(s, GL_COMPILE_STATUS, &ok);
    if (ok) return s;
    char log[2048];
    glGetShaderInfoLog(s, (GLsizei)sizeof(log) - 1, NULL, log);
    fprintf(stderr, "g3_web: %s shader did not compile:\n%s\n", what, log);
    report(log);
    glDeleteShader(s);
    return 0;
}

static int link_program(GLuint vs, GLuint fs) {
    GLuint p = glCreateProgram();
    glAttachShader(p, vs);
    glAttachShader(p, fs);
    glLinkProgram(p);
    GLint ok = 0;
    glGetProgramiv(p, GL_LINK_STATUS, &ok);
    if (!ok) {
        char log[2048];
        glGetProgramInfoLog(p, (GLsizei)sizeof(log) - 1, NULL, log);
        fprintf(stderr, "g3_web: program did not link:\n%s\n", log);
        report(log);
        glDeleteProgram(p);
        return 0;
    }
    shader.program = p;
    return 1;
}

static void find_uniforms(void) {
    shader.mvp = glGetUniformLocation(shader.program, "u_mvp");
    shader.model = glGetUniformLocation(shader.program, "u_model");
    shader.normal_matrix = glGetUniformLocation(shader.program, "u_normal_matrix");
    shader.color = glGetUniformLocation(shader.program, "u_color");
    shader.params = glGetUniformLocation(shader.program, "u_params");
    shader.pbr = glGetUniformLocation(shader.program, "u_pbr");
    shader.mr_tex = glGetUniformLocation(shader.program, "u_mr_tex");
    shader.mr_textured = glGetUniformLocation(shader.program, "u_mr_textured");
    shader.normal_tex = glGetUniformLocation(shader.program, "u_normal_tex");
    shader.normal_textured = glGetUniformLocation(shader.program, "u_normal_textured");
    shader.normal_scale = glGetUniformLocation(shader.program, "u_normal_scale");
    shader.occlusion_tex = glGetUniformLocation(shader.program, "u_occlusion_tex");
    shader.occlusion_textured = glGetUniformLocation(shader.program, "u_occlusion_textured");
    shader.occlusion_strength = glGetUniformLocation(shader.program, "u_occlusion_strength");
    shader.emissive = glGetUniformLocation(shader.program, "u_emissive");
    shader.emissive_tex = glGetUniformLocation(shader.program, "u_emissive_tex");
    shader.emissive_textured = glGetUniformLocation(shader.program, "u_emissive_textured");
    shader.eye = glGetUniformLocation(shader.program, "u_eye");
    shader.view_direction = glGetUniformLocation(shader.program, "u_view_direction");
    shader.light_dir = glGetUniformLocation(shader.program, "u_light_dir");
    shader.light_color = glGetUniformLocation(shader.program, "u_light_color");
    shader.ambient = glGetUniformLocation(shader.program, "u_ambient");
    shader.fog = glGetUniformLocation(shader.program, "u_fog");
    shader.tex = glGetUniformLocation(shader.program, "u_tex");
    shader.textured = glGetUniformLocation(shader.program, "u_textured");
    shader.light_count = glGetUniformLocation(shader.program, "u_light_count");
    shader.env_sky = glGetUniformLocation(shader.program, "u_env_sky");
    shader.env_ground = glGetUniformLocation(shader.program, "u_env_ground");
    shader.env_map = glGetUniformLocation(shader.program, "u_env_map");
    shader.env_map_enabled = glGetUniformLocation(shader.program, "u_env_map_enabled");
    shader.env_map_intensity = glGetUniformLocation(shader.program, "u_env_map_intensity");
    shader.shadow_map = glGetUniformLocation(shader.program, "u_shadow_map");
    shader.shadow_matrix = glGetUniformLocation(shader.program, "u_shadow_matrix");
    shader.shadow_params = glGetUniformLocation(shader.program, "u_shadow_params");
    shader.shadow_resolution = glGetUniformLocation(shader.program, "u_shadow_resolution");
    shader.point_shadow_map = glGetUniformLocation(shader.program, "u_point_shadow_map");
    shader.point_shadow_matrices = glGetUniformLocation(shader.program, "u_point_shadow_matrices[0]");
    shader.point_shadow_index = glGetUniformLocation(shader.program, "u_point_shadow_index");
    shader.point_shadow_params = glGetUniformLocation(shader.program, "u_point_shadow_params");
    shader.spot_shadow_map = glGetUniformLocation(shader.program, "u_spot_shadow_map");
    shader.spot_shadow_matrix = glGetUniformLocation(shader.program, "u_spot_shadow_matrix");
    shader.spot_shadow_index = glGetUniformLocation(shader.program, "u_spot_shadow_index");
    shader.spot_shadow_params = glGetUniformLocation(shader.program, "u_spot_shadow_params");
    shader.alpha_mode = glGetUniformLocation(shader.program, "u_alpha_mode");
    shader.alpha_cutoff = glGetUniformLocation(shader.program, "u_alpha_cutoff");
    for (int i = 0; i < 4; i++) {
        char name[64];
        snprintf(name, sizeof(name), "u_lights[%d].position", i); shader.light_position[i] = glGetUniformLocation(shader.program, name);
        snprintf(name, sizeof(name), "u_lights[%d].direction", i); shader.light_direction[i] = glGetUniformLocation(shader.program, name);
        snprintf(name, sizeof(name), "u_lights[%d].color", i); shader.light_color_extra[i] = glGetUniformLocation(shader.program, name);
        snprintf(name, sizeof(name), "u_lights[%d].inner", i); shader.light_inner[i] = glGetUniformLocation(shader.program, name);
    }
}

/* Compile both stages, link them, and look the uniforms up. 0 on any failure,
   after telling the page why. */
static int build_program(void) {
    GLuint vs = compile_shader(GL_VERTEX_SHADER, VERTEX_SRC, "vertex");
    if (!vs) return 0;
    GLuint fs = compile_shader(GL_FRAGMENT_SHADER, FRAGMENT_SRC, "fragment");
    if (!fs) {
        glDeleteShader(vs);
        return 0;
    }
    int ok = link_program(vs, fs);   /* the program keeps them alive */
    glDeleteShader(vs);
    glDeleteShader(fs);
    if (!ok) return 0;
    find_uniforms();
    return 1;
}

/* --- the surface --- */

static void set_surface_size(int32_t width, int32_t height) {
    surf_w = width > 0 ? width : 1;
    surf_h = height > 0 ? height : 1;
    emscripten_set_canvas_element_size("#canvas", surf_w, surf_h);
    glViewport(0, 0, surf_w, surf_h);
}

uint8_t g3p_init(int32_t width, int32_t height, g3_u8_slice title) {
    (void)title;   /* the page owns the document title */
    EmscriptenWebGLContextAttributes attrs;
    emscripten_webgl_init_context_attributes(&attrs);
    attrs.majorVersion = 2;      /* WebGL2: GLSL ES 3.00, VAOs, u32 indices */
    attrs.minorVersion = 0;
    attrs.alpha = 0;
    attrs.depth = 1;
    attrs.antialias = 1;
    attrs.premultipliedAlpha = 1;
    attrs.preserveDrawingBuffer = 0;
    attrs.failIfMajorPerformanceCaveat = 0;

    ctx = emscripten_webgl_create_context("#canvas", &attrs);
    if (ctx <= 0) {
        fprintf(stderr, "g3_web: could not create a WebGL2 context\n");
        report("Could not create a WebGL2 context.");
        return 0;
    }
    emscripten_webgl_make_context_current(ctx);
    set_surface_size(width, height);

    if (!build_program()) return 0;

    /* The state the CPU backend also sets: depth LESS, back faces culled,
       counterclockwise front, and a blend that is switched on per item. */
    glEnable(GL_DEPTH_TEST);
    glDepthFunc(GL_LESS);
    glEnable(GL_CULL_FACE);
    glCullFace(GL_BACK);
    glFrontFace(GL_CCW);
    glBlendFunc(GL_SRC_ALPHA, GL_ONE_MINUS_SRC_ALPHA);
    return 1;
}

void g3p_shutdown(void) {
    if (output_program) glDeleteProgram(output_program);
    if (output_fbo) glDeleteFramebuffers(1, &output_fbo);
    if (output_color) glDeleteTextures(1, &output_color);
    if (output_depth) glDeleteRenderbuffers(1, &output_depth);
    if (output_vao) glDeleteVertexArrays(1, &output_vao);
    output_program = output_fbo = output_color = output_depth = output_vao = 0;
    output_width = output_height = 0;
    if (shadow_program) glDeleteProgram(shadow_program);
    if (shadow_fbo) glDeleteFramebuffers(1, &shadow_fbo);
    if (shadow_texture) glDeleteTextures(1, &shadow_texture);
    if (point_shadow_texture) glDeleteTextures(1, &point_shadow_texture);
    if (spot_shadow_texture) glDeleteTextures(1, &spot_shadow_texture);
    shadow_program = shadow_fbo = shadow_texture = 0;
    point_shadow_texture = 0;
    spot_shadow_texture = 0;
    for (int32_t i = 0; i < texture_count; i++) glDeleteTextures(1, &textures[i]);
    free(textures); textures = NULL; texture_count = 0;
    if (env_sampler) glDeleteSamplers(1, &env_sampler);
    env_sampler = 0;
    for (int32_t i = 0; i < mesh_count; i++) {
        glDeleteVertexArrays(1, &meshes[i].vao);
        glDeleteBuffers(1, &meshes[i].vbo);
        glDeleteBuffers(1, &meshes[i].ebo);
    }
    free(meshes);
    meshes = NULL;
    mesh_count = mesh_cap = 0;
    if (shader.program) glDeleteProgram(shader.program);
    shader.program = 0;
    if (ctx) emscripten_webgl_destroy_context(ctx);
    ctx = 0;
}

int32_t g3p_width(void) { return surf_w; }
int32_t g3p_height(void) { return surf_h; }

/* --- meshes --- */

static void ensure_mesh(int32_t id) {
    if (id < mesh_cap) return;
    int32_t cap = mesh_cap ? mesh_cap : 16;
    while (cap <= id) cap *= 2;
    web_mesh *grown = (web_mesh *)realloc(meshes, sizeof(web_mesh) * (size_t)cap);
    if (!grown) {
        fprintf(stderr, "g3_web: out of memory for mesh %d\n", id);
        return;
    }
    memset(grown + mesh_cap, 0, sizeof(web_mesh) * (size_t)(cap - mesh_cap));
    meshes = grown;
    mesh_cap = cap;
}

void g3p_upload_mesh(int32_t id, g3_vertex_slice verts, g3_u32_slice indices) {
    if (id < 0) return;
    ensure_mesh(id);
    if (id >= mesh_cap) return;
    web_mesh *m = &meshes[id];
    if (!m->vao) {
        glGenVertexArrays(1, &m->vao);
        glGenBuffers(1, &m->vbo);
        glGenBuffers(1, &m->ebo);
    }
    glBindVertexArray(m->vao);

    glBindBuffer(GL_ARRAY_BUFFER, m->vbo);
    glBufferData(GL_ARRAY_BUFFER, (GLsizeiptr)(sizeof(g3_vertex) * (size_t)verts.len),
                 verts.data, GL_STATIC_DRAW);
    glBindBuffer(GL_ELEMENT_ARRAY_BUFFER, m->ebo);
    glBufferData(GL_ELEMENT_ARRAY_BUFFER, (GLsizeiptr)(sizeof(uint32_t) * (size_t)indices.len),
                 indices.data, GL_STATIC_DRAW);

    /* Two vec3 attributes out of one packed g3_vertex: position, then normal. */
    glEnableVertexAttribArray(0);
    glVertexAttribPointer(0, 3, GL_FLOAT, GL_FALSE, (GLsizei)sizeof(g3_vertex),
                          (const void *)0);
    glEnableVertexAttribArray(1);
    glVertexAttribPointer(1, 3, GL_FLOAT, GL_FALSE, (GLsizei)sizeof(g3_vertex),
                          (const void *)(sizeof(float) * 3));
    glEnableVertexAttribArray(2);
    glVertexAttribPointer(2, 2, GL_FLOAT, GL_FALSE, (GLsizei)sizeof(g3_vertex),
                          (const void *)(sizeof(float) * 6));
    glBindVertexArray(0);

    m->count = (GLsizei)indices.len;
    if (id >= mesh_count) mesh_count = id + 1;
}

static void upload_texture(int32_t id, g3_u8_slice pixels, int32_t width, int32_t height, int srgb) {
    if (id < 0 || width <= 0 || height <= 0 || pixels.len != (int64_t)width * height * 4) return;
    if (id >= texture_count) {
        GLuint *grown = realloc(textures, ((size_t)id + 1) * sizeof(*textures));
        if (!grown) return;
        textures = grown;
        memset(textures + texture_count, 0, ((size_t)id + 1 - (size_t)texture_count) * sizeof(*textures));
        texture_count = id + 1;
    }
    if (!textures[id]) glGenTextures(1, &textures[id]);
    glBindTexture(GL_TEXTURE_2D, textures[id]);
    glTexParameteri(GL_TEXTURE_2D, GL_TEXTURE_MIN_FILTER, GL_LINEAR);
    glTexParameteri(GL_TEXTURE_2D, GL_TEXTURE_MAG_FILTER, GL_LINEAR);
    glTexParameteri(GL_TEXTURE_2D, GL_TEXTURE_WRAP_S, GL_CLAMP_TO_EDGE);
    glTexParameteri(GL_TEXTURE_2D, GL_TEXTURE_WRAP_T, GL_CLAMP_TO_EDGE);
    glTexImage2D(GL_TEXTURE_2D, 0, srgb ? GL_SRGB8_ALPHA8 : GL_RGBA8, width, height, 0, GL_RGBA, GL_UNSIGNED_BYTE, pixels.data);
}

void g3p_upload_texture(int32_t id, g3_u8_slice pixels, int32_t width, int32_t height) {
    upload_texture(id, pixels, width, height, 0);
}

void g3p_upload_texture_srgb(int32_t id, g3_u8_slice pixels, int32_t width, int32_t height) {
    upload_texture(id, pixels, width, height, 1);
}

void g3p_texture_wrap(int32_t id, int32_t wrap_u, int32_t wrap_v) {
    if (id < 0 || id >= texture_count || !textures[id] || wrap_u < 0 || wrap_u > 2 || wrap_v < 0 || wrap_v > 2) return;
    const GLint modes[3] = { GL_CLAMP_TO_EDGE, GL_REPEAT, GL_MIRRORED_REPEAT };
    glBindTexture(GL_TEXTURE_2D, textures[id]);
    glTexParameteri(GL_TEXTURE_2D, GL_TEXTURE_WRAP_S, modes[wrap_u]);
    glTexParameteri(GL_TEXTURE_2D, GL_TEXTURE_WRAP_T, modes[wrap_v]);
}

void g3p_texture_filter(int32_t id, int32_t min_filter, int32_t mag_filter) {
    int valid_min = min_filter == GL_NEAREST || min_filter == GL_LINEAR ||
                    (min_filter >= GL_NEAREST_MIPMAP_NEAREST && min_filter <= GL_LINEAR_MIPMAP_LINEAR);
    if (id < 0 || id >= texture_count || !textures[id] || !valid_min ||
        (mag_filter != GL_NEAREST && mag_filter != GL_LINEAR)) return;
    glBindTexture(GL_TEXTURE_2D, textures[id]);
    if (min_filter >= GL_NEAREST_MIPMAP_NEAREST && min_filter <= GL_LINEAR_MIPMAP_LINEAR) glGenerateMipmap(GL_TEXTURE_2D);
    glTexParameteri(GL_TEXTURE_2D, GL_TEXTURE_MIN_FILTER, min_filter);
    glTexParameteri(GL_TEXTURE_2D, GL_TEXTURE_MAG_FILTER, mag_filter);
}

void g3p_texture_generate_mips(int32_t id) {
    if (id < 0 || id >= texture_count || !textures[id]) return;
    glBindTexture(GL_TEXTURE_2D, textures[id]);
    glGenerateMipmap(GL_TEXTURE_2D);
}

EMSCRIPTEN_KEEPALIVE void g3_host_texture_filter(int32_t id, int32_t min_filter, int32_t mag_filter) {
    g3p_texture_filter(id, min_filter, mag_filter);
}

EMSCRIPTEN_KEEPALIVE void g3_host_texture_wrap(int32_t id, int32_t wrap_u, int32_t wrap_v) {
    g3p_texture_wrap(id, wrap_u, wrap_v);
}

/* Browser hosts may replace an already allocated texture with decoded RGBA. */
EMSCRIPTEN_KEEPALIVE void g3_host_texture(int32_t id, const uint8_t *pixels, int32_t width, int32_t height) {
    if (width <= 0 || height <= 0 || !pixels) return;
    g3_u8_slice s = { pixels, (int64_t)width * height * 4 };
    g3p_upload_texture(id, s, width, height);
}

EMSCRIPTEN_KEEPALIVE void g3_host_texture_srgb(int32_t id, const uint8_t *pixels, int32_t width, int32_t height) {
    if (width <= 0 || height <= 0 || !pixels) return;
    g3_u8_slice s = { pixels, (int64_t)width * height * 4 };
    g3p_upload_texture_srgb(id, s, width, height);
}

/* Imported assets own their backend resources; Goose arena handles stay valid. */
EMSCRIPTEN_KEEPALIVE void g3_host_release_mesh(int32_t id) {
    if (id < 0 || id >= mesh_count) return;
    web_mesh *m = &meshes[id];
    glDeleteVertexArrays(1, &m->vao);
    glDeleteBuffers(1, &m->vbo);
    glDeleteBuffers(1, &m->ebo);
    memset(m, 0, sizeof(*m));
}

EMSCRIPTEN_KEEPALIVE void g3_host_release_texture(int32_t id) {
    if (id < 0 || id >= texture_count) return;
    glDeleteTextures(1, &textures[id]);
    textures[id] = 0;
}

/* --- a frame --- */

/* What every item of this frame shares. */
static void bind_view(const g3_view_state *view) {
    glUniform3f(shader.eye, view->eye.x, view->eye.y, view->eye.z);
    glUniform4f(shader.view_direction, view->view_direction.x, view->view_direction.y, view->view_direction.z, view->view_direction.w);
    glUniform3f(shader.light_dir, view->light_dir.x, view->light_dir.y, view->light_dir.z);
    glUniform3f(shader.light_color, view->light_color.x, view->light_color.y,
                view->light_color.z);
    glUniform4f(shader.ambient, view->ambient.x, view->ambient.y, view->ambient.z,
                view->ambient.w);
    glUniform4f(shader.fog, view->fog.x, view->fog.y, view->fog.z, view->fog.w);
    glUniform4f(shader.env_sky, view->env_sky.x, view->env_sky.y, view->env_sky.z, view->env_sky.w);
    glUniform4f(shader.env_ground, view->env_ground.x, view->env_ground.y, view->env_ground.z, view->env_ground.w);
    int env = view->environment_texture;
    int has_env = env >= 0 && env < texture_count && textures[env];
    glActiveTexture(GL_TEXTURE1);
    glBindTexture(GL_TEXTURE_2D, has_env ? textures[env] : 0);
    if (!env_sampler) {
        glGenSamplers(1, &env_sampler);
        glSamplerParameteri(env_sampler, GL_TEXTURE_MIN_FILTER, GL_LINEAR_MIPMAP_LINEAR);
        glSamplerParameteri(env_sampler, GL_TEXTURE_MAG_FILTER, GL_LINEAR);
        glSamplerParameteri(env_sampler, GL_TEXTURE_WRAP_S, GL_REPEAT);
        glSamplerParameteri(env_sampler, GL_TEXTURE_WRAP_T, GL_CLAMP_TO_EDGE);
    }
    glBindSampler(1, env_sampler);
    glUniform1i(shader.env_map, 1);
    glUniform1i(shader.env_map_enabled, has_env);
    glUniform1f(shader.env_map_intensity, view->environment_intensity);
    glActiveTexture(GL_TEXTURE2);
    glBindTexture(GL_TEXTURE_2D, shadow_texture);
    glUniform1i(shader.shadow_map, 2);
    glUniformMatrix4fv(shader.shadow_matrix, 1, GL_FALSE, view->shadow_view_proj.m);
    glUniform4f(shader.shadow_params, shadow_texture ? view->shadow_params.x : 0.0f, view->shadow_params.y, view->shadow_params.z, 0.0f);
    glUniform1f(shader.shadow_resolution, (float)shadow_map_size);
    glActiveTexture(GL_TEXTURE7);
    glBindTexture(GL_TEXTURE_CUBE_MAP, point_shadow_texture);
    glUniform1i(shader.point_shadow_map, 7);
    glUniformMatrix4fv(shader.point_shadow_matrices, 6, GL_FALSE, view->point_shadow_view_proj[0].m);
    glUniform1i(shader.point_shadow_index, view->point_shadow_light_index);
    glUniform4f(shader.point_shadow_params, point_shadow_texture ? view->point_shadow_params.x : 0.0f, view->point_shadow_params.y, view->point_shadow_params.z, 0.0f);
    glActiveTexture(GL_TEXTURE8);
    glBindTexture(GL_TEXTURE_2D, spot_shadow_texture);
    glUniform1i(shader.spot_shadow_map, 8);
    glUniformMatrix4fv(shader.spot_shadow_matrix, 1, GL_FALSE, view->spot_shadow_view_proj.m);
    glUniform1i(shader.spot_shadow_index, view->spot_shadow_light_index);
    glUniform4f(shader.spot_shadow_params, spot_shadow_texture ? view->spot_shadow_params.x : 0.0f, view->spot_shadow_params.y, view->spot_shadow_params.z, 0.0f);
    int count = view->light_count < 0 ? 0 : view->light_count > 4 ? 4 : view->light_count;
    glUniform1i(shader.light_count, count);
    for (int i = 0; i < count; i++) {
        const g3_light *l = &view->lights[i];
        glUniform4f(shader.light_position[i], l->position.x, l->position.y, l->position.z, l->position.w);
        glUniform4f(shader.light_direction[i], l->direction.x, l->direction.y, l->direction.z, l->direction.w);
        glUniform4f(shader.light_color_extra[i], l->color.x, l->color.y, l->color.z, l->color.w);
        glUniform1f(shader.light_inner[i], l->inner);
    }
}

static int ensure_shadow_map(void) {
    if (shadow_program && shadow_fbo && shadow_texture && allocated_shadow_size == shadow_map_size) return 1;
    const char *vs_src = "#version 300 es\nlayout(location=0) in vec3 a_pos;\nlayout(location=2) in vec2 a_uv;\nuniform mat4 u_light;\nuniform mat4 u_model;\nout vec2 v_uv;\nvoid main(){v_uv=a_uv;gl_Position=u_light*u_model*vec4(a_pos,1.0);}\n";
    const char *fs_src = "#version 300 es\nprecision highp float;\nin vec2 v_uv;\nuniform bool u_mask;\nuniform bool u_textured;\nuniform sampler2D u_tex;\nuniform float u_alpha;\nuniform float u_cutoff;\nvoid main(){if(u_mask && u_alpha*(u_textured ? texture(u_tex,v_uv).a : 1.0)<u_cutoff) discard;}\n";
    GLuint vs = compile_shader(GL_VERTEX_SHADER, vs_src, "shadow vertex");
    GLuint fs = compile_shader(GL_FRAGMENT_SHADER, fs_src, "shadow fragment");
    if (!vs || !fs) { if (vs) glDeleteShader(vs); if (fs) glDeleteShader(fs); return 0; }
    GLuint program = glCreateProgram();
    glAttachShader(program, vs); glAttachShader(program, fs); glLinkProgram(program);
    glDeleteShader(vs); glDeleteShader(fs);
    GLint linked = 0; glGetProgramiv(program, GL_LINK_STATUS, &linked);
    if (!linked) { glDeleteProgram(program); report("Could not link shadow shader."); return 0; }
    glGenTextures(1, &shadow_texture);
    glBindTexture(GL_TEXTURE_2D, shadow_texture);
    glTexImage2D(GL_TEXTURE_2D, 0, GL_DEPTH_COMPONENT24, shadow_map_size, shadow_map_size, 0, GL_DEPTH_COMPONENT, GL_UNSIGNED_INT, NULL);
    glTexParameteri(GL_TEXTURE_2D, GL_TEXTURE_MIN_FILTER, GL_NEAREST);
    glTexParameteri(GL_TEXTURE_2D, GL_TEXTURE_MAG_FILTER, GL_NEAREST);
    glTexParameteri(GL_TEXTURE_2D, GL_TEXTURE_WRAP_S, GL_CLAMP_TO_EDGE);
    glTexParameteri(GL_TEXTURE_2D, GL_TEXTURE_WRAP_T, GL_CLAMP_TO_EDGE);
    glGenFramebuffers(1, &shadow_fbo);
    glBindFramebuffer(GL_FRAMEBUFFER, shadow_fbo);
    glFramebufferTexture2D(GL_FRAMEBUFFER, GL_DEPTH_ATTACHMENT, GL_TEXTURE_2D, shadow_texture, 0);
    GLenum none = GL_NONE;
    glDrawBuffers(1, &none);
    glReadBuffer(GL_NONE);
    GLenum status = glCheckFramebufferStatus(GL_FRAMEBUFFER);
    glBindFramebuffer(GL_FRAMEBUFFER, 0);
    if (status != GL_FRAMEBUFFER_COMPLETE) {
        glDeleteProgram(program); glDeleteFramebuffers(1, &shadow_fbo); glDeleteTextures(1, &shadow_texture);
        shadow_fbo = shadow_texture = 0; report("Could not create shadow framebuffer."); return 0;
    }
    shadow_program = program;
    shadow_light_matrix = glGetUniformLocation(program, "u_light");
    shadow_model_matrix = glGetUniformLocation(program, "u_model");
    shadow_mask = glGetUniformLocation(program, "u_mask");
    shadow_cutoff = glGetUniformLocation(program, "u_cutoff");
    shadow_alpha = glGetUniformLocation(program, "u_alpha");
    shadow_tex = glGetUniformLocation(program, "u_tex");
    shadow_textured = glGetUniformLocation(program, "u_textured");
    allocated_shadow_size = shadow_map_size;
    return 1;
}

static int ensure_point_shadow_map(void) {
    if (point_shadow_texture) return 1;
    if (!ensure_shadow_map()) return 0;
    glGenTextures(1, &point_shadow_texture);
    glBindTexture(GL_TEXTURE_CUBE_MAP, point_shadow_texture);
    for (int face=0; face<6; face++)
        glTexImage2D(GL_TEXTURE_CUBE_MAP_POSITIVE_X+face,0,GL_DEPTH_COMPONENT24,shadow_map_size,shadow_map_size,0,GL_DEPTH_COMPONENT,GL_UNSIGNED_INT,NULL);
    glTexParameteri(GL_TEXTURE_CUBE_MAP,GL_TEXTURE_MIN_FILTER,GL_NEAREST);
    glTexParameteri(GL_TEXTURE_CUBE_MAP,GL_TEXTURE_MAG_FILTER,GL_NEAREST);
    glTexParameteri(GL_TEXTURE_CUBE_MAP,GL_TEXTURE_WRAP_S,GL_CLAMP_TO_EDGE);
    glTexParameteri(GL_TEXTURE_CUBE_MAP,GL_TEXTURE_WRAP_T,GL_CLAMP_TO_EDGE);
    glTexParameteri(GL_TEXTURE_CUBE_MAP,GL_TEXTURE_WRAP_R,GL_CLAMP_TO_EDGE);
    glTexParameteri(GL_TEXTURE_CUBE_MAP,GL_TEXTURE_COMPARE_MODE,GL_COMPARE_REF_TO_TEXTURE);
    glTexParameteri(GL_TEXTURE_CUBE_MAP,GL_TEXTURE_COMPARE_FUNC,GL_LEQUAL);
    if (glGetError() != GL_NO_ERROR) { glDeleteTextures(1,&point_shadow_texture); point_shadow_texture=0; return 0; }
    return 1;
}

static int ensure_spot_shadow_map(void) {
    if (spot_shadow_texture) return 1;
    if (!ensure_shadow_map()) return 0;
    glGenTextures(1,&spot_shadow_texture);
    glBindTexture(GL_TEXTURE_2D,spot_shadow_texture);
    glTexImage2D(GL_TEXTURE_2D,0,GL_DEPTH_COMPONENT24,shadow_map_size,shadow_map_size,0,GL_DEPTH_COMPONENT,GL_UNSIGNED_INT,NULL);
    glTexParameteri(GL_TEXTURE_2D,GL_TEXTURE_MIN_FILTER,GL_NEAREST);
    glTexParameteri(GL_TEXTURE_2D,GL_TEXTURE_MAG_FILTER,GL_NEAREST);
    glTexParameteri(GL_TEXTURE_2D,GL_TEXTURE_WRAP_S,GL_CLAMP_TO_EDGE);
    glTexParameteri(GL_TEXTURE_2D,GL_TEXTURE_WRAP_T,GL_CLAMP_TO_EDGE);
    glTexParameteri(GL_TEXTURE_2D,GL_TEXTURE_COMPARE_MODE,GL_COMPARE_REF_TO_TEXTURE);
    glTexParameteri(GL_TEXTURE_2D,GL_TEXTURE_COMPARE_FUNC,GL_LEQUAL);
    if (glGetError()!=GL_NO_ERROR) { glDeleteTextures(1,&spot_shadow_texture); spot_shadow_texture=0; return 0; }
    return 1;
}

static void render_shadow_map(g3_draw_item_slice items, const g3_view_state *view, const g3_mat4 *light_matrix, GLuint depth_texture) {
    glBindFramebuffer(GL_FRAMEBUFFER, shadow_fbo);
    glFramebufferTexture2D(GL_FRAMEBUFFER, GL_DEPTH_ATTACHMENT, GL_TEXTURE_2D, depth_texture, 0);
    glViewport(0, 0, shadow_map_size, shadow_map_size);
    glDepthMask(GL_TRUE); glDisable(GL_BLEND); glClear(GL_DEPTH_BUFFER_BIT);
    glUseProgram(shadow_program);
    glUniformMatrix4fv(shadow_light_matrix, 1, GL_FALSE, light_matrix->m);
    for (int64_t i = 0; i < items.len; i++) {
        const g3_draw_item *it = &items.data[i];
        if (it->params.w > 0.5f || it->mesh < 0 || it->mesh >= mesh_count) continue;
        const web_mesh *m = &meshes[it->mesh];
        if (!m->vao || !m->count) continue;
        glUniformMatrix4fv(shadow_model_matrix, 1, GL_FALSE, it->model.m);
        int textured = it->texture >= 0 && it->texture < texture_count && textures[it->texture];
        glActiveTexture(GL_TEXTURE0);
        glBindTexture(GL_TEXTURE_2D, textured ? textures[it->texture] : 0);
        glUniform1i(shadow_tex, 0);
        glUniform1i(shadow_textured, textured);
        glUniform1i(shadow_mask, it->alpha_mode == 1);
        glUniform1f(shadow_alpha, it->color.w);
        glUniform1f(shadow_cutoff, it->alpha_cutoff);
        glBindVertexArray(m->vao);
        glDrawElements(GL_TRIANGLES, m->count, GL_UNSIGNED_INT, 0);
    }
    glBindFramebuffer(GL_FRAMEBUFFER, 0);
}

static void render_point_shadow_maps(g3_draw_item_slice items, const g3_view_state *view) {
    if (!ensure_point_shadow_map()) return;
    glBindFramebuffer(GL_FRAMEBUFFER,shadow_fbo); glViewport(0,0,shadow_map_size,shadow_map_size);
    glDepthMask(GL_TRUE); glDisable(GL_BLEND); glUseProgram(shadow_program);
    for (int face=0; face<6; face++) {
        glFramebufferTexture2D(GL_FRAMEBUFFER,GL_DEPTH_ATTACHMENT,GL_TEXTURE_CUBE_MAP_POSITIVE_X+face,point_shadow_texture,0);
        glClear(GL_DEPTH_BUFFER_BIT);
        glUniformMatrix4fv(shadow_light_matrix,1,GL_FALSE,view->point_shadow_view_proj[face].m);
        for (int64_t i=0; i<items.len; i++) {
            const g3_draw_item *it=&items.data[i];
            if (it->params.w>0.5f || it->mesh<0 || it->mesh>=mesh_count) continue;
            const web_mesh *m=&meshes[it->mesh]; if (!m->vao || !m->count) continue;
            glUniformMatrix4fv(shadow_model_matrix,1,GL_FALSE,it->model.m);
            int textured=it->texture>=0 && it->texture<texture_count && textures[it->texture];
            glActiveTexture(GL_TEXTURE0); glBindTexture(GL_TEXTURE_2D,textured?textures[it->texture]:0);
            glUniform1i(shadow_tex,0); glUniform1i(shadow_textured,textured);
            glUniform1i(shadow_mask,it->alpha_mode==1); glUniform1f(shadow_alpha,it->color.w); glUniform1f(shadow_cutoff,it->alpha_cutoff);
            glBindVertexArray(m->vao); glDrawElements(GL_TRIANGLES,m->count,GL_UNSIGNED_INT,0);
        }
    }
    glBindFramebuffer(GL_FRAMEBUFFER,0);
}

/* One item: the state its transparency needs, its uniforms, its draw call. */
static void draw_item(const g3_draw_item *it) {
    if (it->mesh < 0 || it->mesh >= mesh_count) return;
    const web_mesh *m = &meshes[it->mesh];
    if (!m->vao || m->count == 0) return;

    if (it->params.w > 0.5f) {
        glEnable(GL_BLEND);
        glDepthMask(GL_FALSE);       /* blended: test depth, do not write it */
    } else {
        glDisable(GL_BLEND);
        glDepthMask(GL_TRUE);
    }
    glUniformMatrix4fv(shader.mvp, 1, GL_FALSE, it->mvp.m);
    glUniformMatrix4fv(shader.model, 1, GL_FALSE, it->model.m);
    float normal_matrix[9];
    g3_normal_matrix(&it->model, normal_matrix);
    glUniformMatrix3fv(shader.normal_matrix, 1, GL_FALSE, normal_matrix);
    glUniform4f(shader.color, it->color.x, it->color.y, it->color.z, it->color.w);
    glUniform4f(shader.params, it->params.x, it->params.y, it->params.z, it->params.w);
    glUniform4f(shader.pbr, it->pbr.x, it->pbr.y, it->pbr.z, it->pbr.w);
    glUniform1i(shader.alpha_mode, it->alpha_mode);
    glUniform1f(shader.alpha_cutoff, it->alpha_cutoff);
    int textured = it->texture >= 0 && it->texture < texture_count && textures[it->texture];
    glUniform1i(shader.textured, textured);
    glActiveTexture(GL_TEXTURE0);
    glBindTexture(GL_TEXTURE_2D, textured ? textures[it->texture] : 0);
    glUniform1i(shader.tex, 0);

    int mr_textured = it->metallic_roughness_texture >= 0 && it->metallic_roughness_texture < texture_count && textures[it->metallic_roughness_texture];
    glActiveTexture(GL_TEXTURE3);
    glBindTexture(GL_TEXTURE_2D, mr_textured ? textures[it->metallic_roughness_texture] : 0);
    glUniform1i(shader.mr_tex, 3);
    glUniform1i(shader.mr_textured, mr_textured);

    /* Keep all shader samplers on separate units: base 0, environment 1,
       shadow 2, metallic-roughness 3, normal 4, occlusion 5, emissive 6. */
    int normal_textured = it->normal_texture >= 0 && it->normal_texture < texture_count && textures[it->normal_texture];
    glActiveTexture(GL_TEXTURE4);
    glBindTexture(GL_TEXTURE_2D, normal_textured ? textures[it->normal_texture] : 0);
    glUniform1i(shader.normal_tex, 4);
    glUniform1i(shader.normal_textured, normal_textured);
    glUniform1f(shader.normal_scale, it->normal_scale);

    int occlusion_textured = it->occlusion_texture >= 0 && it->occlusion_texture < texture_count && textures[it->occlusion_texture];
    glActiveTexture(GL_TEXTURE5);
    glBindTexture(GL_TEXTURE_2D, occlusion_textured ? textures[it->occlusion_texture] : 0);
    glUniform1i(shader.occlusion_tex, 5);
    glUniform1i(shader.occlusion_textured, occlusion_textured);
    glUniform1f(shader.occlusion_strength, it->occlusion_strength);

    int emissive_textured = it->emissive_texture >= 0 && it->emissive_texture < texture_count && textures[it->emissive_texture];
    glActiveTexture(GL_TEXTURE6);
    glBindTexture(GL_TEXTURE_2D, emissive_textured ? textures[it->emissive_texture] : 0);
    glUniform1i(shader.emissive_tex, 6);
    glUniform1i(shader.emissive_textured, emissive_textured);
    glUniform4f(shader.emissive, it->emissive.x, it->emissive.y, it->emissive.z, it->emissive.w);

    glBindVertexArray(m->vao);
    glDrawElements(GL_TRIANGLES, m->count, GL_UNSIGNED_INT, (const void *)0);
}

/* Once, after the first frame: a backend that draws nothing because of a
   driver complaint should say so rather than leave a blank canvas. */
static void report_first_gl_error(void) {
    if (checked_gl) return;
    checked_gl = 1;
    GLenum err = glGetError();
    if (err == GL_NO_ERROR) return;
    char msg[64];
    snprintf(msg, sizeof(msg), "WebGL error 0x%04x on the first frame", (unsigned)err);
    fprintf(stderr, "g3_web: %s\n", msg);
    report(msg);
}

/* An RGBA8 linear target keeps blending linear. Encode only the finished
   frame, including the clear colour, when writing to the browser canvas. */
static int ensure_output_target(void) {
    if (!output_program) {
        const char *vs_src = "#version 300 es\nvoid main(){vec2 p=vec2((gl_VertexID<<1)&2,gl_VertexID&2);gl_Position=vec4(p*2.0-1.0,0.0,1.0);}\n";
        const char *fs_src = "#version 300 es\nprecision highp float;\nuniform sampler2D u_linear;\nout vec4 color;\nvoid main(){vec3 c=texelFetch(u_linear,ivec2(gl_FragCoord.xy),0).rgb;vec3 lo=c*12.92;vec3 hi=1.055*pow(c,vec3(1.0/2.4))-0.055;color=vec4(mix(hi,lo,lessThanEqual(c,vec3(0.0031308))),1.0);}\n";
        GLuint vs = compile_shader(GL_VERTEX_SHADER, vs_src, "output vertex");
        GLuint fs = compile_shader(GL_FRAGMENT_SHADER, fs_src, "output fragment");
        if (!vs || !fs) { if (vs) glDeleteShader(vs); if (fs) glDeleteShader(fs); return 0; }
        GLuint program = glCreateProgram();
        glAttachShader(program, vs); glAttachShader(program, fs); glLinkProgram(program);
        glDeleteShader(vs); glDeleteShader(fs);
        GLint linked = 0; glGetProgramiv(program, GL_LINK_STATUS, &linked);
        if (!linked) { glDeleteProgram(program); report("Could not link output shader."); return 0; }
        output_program = program;
        output_sampler = glGetUniformLocation(program, "u_linear");
        glGenVertexArrays(1, &output_vao);
        glGenFramebuffers(1, &output_fbo);
        glGenTextures(1, &output_color);
        glGenRenderbuffers(1, &output_depth);
    }
    if (output_width != surf_w || output_height != surf_h) {
        glActiveTexture(GL_TEXTURE0);
        glBindTexture(GL_TEXTURE_2D, output_color);
        glTexParameteri(GL_TEXTURE_2D, GL_TEXTURE_MIN_FILTER, GL_NEAREST);
        glTexParameteri(GL_TEXTURE_2D, GL_TEXTURE_MAG_FILTER, GL_NEAREST);
        glTexImage2D(GL_TEXTURE_2D, 0, GL_RGBA8, surf_w, surf_h, 0, GL_RGBA, GL_UNSIGNED_BYTE, NULL);
        glBindRenderbuffer(GL_RENDERBUFFER, output_depth);
        glRenderbufferStorage(GL_RENDERBUFFER, GL_DEPTH_COMPONENT24, surf_w, surf_h);
        glBindFramebuffer(GL_FRAMEBUFFER, output_fbo);
        glFramebufferTexture2D(GL_FRAMEBUFFER, GL_COLOR_ATTACHMENT0, GL_TEXTURE_2D, output_color, 0);
        glFramebufferRenderbuffer(GL_FRAMEBUFFER, GL_DEPTH_ATTACHMENT, GL_RENDERBUFFER, output_depth);
        GLenum status = glCheckFramebufferStatus(GL_FRAMEBUFFER);
        glBindFramebuffer(GL_FRAMEBUFFER, 0);
        if (status != GL_FRAMEBUFFER_COMPLETE) { report("Could not create linear output framebuffer."); return 0; }
        output_width = surf_w; output_height = surf_h;
    }
    return 1;
}

static void present_srgb(void) {
    glBindFramebuffer(GL_FRAMEBUFFER, 0);
    glViewport(0, 0, surf_w, surf_h);
    glDisable(GL_DEPTH_TEST); glDisable(GL_CULL_FACE); glDisable(GL_BLEND);
    glUseProgram(output_program);
    glActiveTexture(GL_TEXTURE0); glBindTexture(GL_TEXTURE_2D, output_color);
    glUniform1i(output_sampler, 0);
    glBindVertexArray(output_vao);
    glDrawArrays(GL_TRIANGLES, 0, 3);
    glBindVertexArray(0);
    glEnable(GL_DEPTH_TEST); glEnable(GL_CULL_FACE);
}

void g3p_draw_frame(g3_draw_item_slice items, const g3_view_state *view) {
    if (!ctx || !shader.program) return;
    int requested = view->shadow_resolution == 256 || view->shadow_resolution == 512 || view->shadow_resolution == 1024 ? view->shadow_resolution : 512;
    if (allocated_shadow_size && allocated_shadow_size != requested) {
        if (shadow_program) glDeleteProgram(shadow_program);
        if (shadow_fbo) glDeleteFramebuffers(1,&shadow_fbo);
        if (shadow_texture) glDeleteTextures(1,&shadow_texture);
        if (point_shadow_texture) glDeleteTextures(1,&point_shadow_texture);
        if (spot_shadow_texture) glDeleteTextures(1,&spot_shadow_texture);
        shadow_program=shadow_fbo=shadow_texture=point_shadow_texture=spot_shadow_texture=0;
        allocated_shadow_size=0;
    }
    shadow_map_size=requested;
    if (view->shadow_params.x > 0.5f && ensure_shadow_map()) render_shadow_map(items, view, &view->shadow_view_proj, shadow_texture);
    if (view->point_shadow_params.x > 0.5f && view->point_shadow_light_index >= 0 && view->point_shadow_light_index < view->light_count)
        render_point_shadow_maps(items, view);
    if (view->spot_shadow_params.x > 0.5f && view->spot_shadow_light_index >= 0 && view->spot_shadow_light_index < view->light_count && view->lights[view->spot_shadow_light_index].position.w > 1.5f && ensure_spot_shadow_map())
        render_shadow_map(items, view, &view->spot_shadow_view_proj, spot_shadow_texture);
    int encode = view->params.y > 0.5f && ensure_output_target();
    glBindFramebuffer(GL_FRAMEBUFFER, encode ? output_fbo : 0);
    glViewport(0, 0, surf_w, surf_h);
    glClearColor(view->clear.x, view->clear.y, view->clear.z, 1.0f);
    glClear(GL_COLOR_BUFFER_BIT | GL_DEPTH_BUFFER_BIT);

    glUseProgram(shader.program);
    bind_view(view);
    for (int64_t i = 0; i < items.len; i++) draw_item(&items.data[i]);
    glBindVertexArray(0);
    glDisable(GL_BLEND);
    glDepthMask(GL_TRUE);

    if (encode) present_srgb();

    report_first_gl_error();
}

/* --- the surface, queried and resized by the host --- */

int g3_backend_resize(int width, int height) {
    if (width == surf_w && height == surf_h) return 1;
    set_surface_size(width, height);
    return 1;
}

uint32_t g3p_read_pixel(int32_t x, int32_t y) {
    if (!ctx || x < 0 || y < 0 || x >= surf_w || y >= surf_h) return 0;
    uint8_t rgba[4] = {0, 0, 0, 0};
    glReadPixels(x, surf_h - 1 - y, 1, 1, GL_RGBA, GL_UNSIGNED_BYTE, rgba);
    return ((uint32_t)rgba[0] << 16) | ((uint32_t)rgba[1] << 8) | (uint32_t)rgba[2];
}

/* There is no file to write in the browser; the page can grab the canvas. */
uint8_t g3p_save_frame(g3_u8_slice path) {
    (void)path;
    return 0;
}

/* --- the C host: build the surface, then hand the loop to the page ---

   `g3_host_start` is the page's entry point: it sets the Goose runtime up and
   builds the GL surface, and the page calls it once the canvas has its real
   size. There is no main loop here on purpose: the page owns the clock (it has
   the refresh rate and the tab's visibility) and calls `g3_app_frame` from
   requestAnimationFrame, so a backgrounded tab costs nothing and the engine is
   handed the real dt. */

EMSCRIPTEN_KEEPALIVE int g3_host_start(int width, int height) {
    if (width <= 0 || height <= 0) {
        double css_w = 0, css_h = 0;
        emscripten_get_element_css_size("#canvas", &css_w, &css_h);
        width = (int)(css_w > 0 ? css_w : 1280);
        height = (int)(css_h > 0 ? css_h : 720);
    }
    goose_init(0, NULL);
    if (!g3_app_init(width, height)) {
        EM_ASM({ if (window.gooseSurfaceFailed) window.gooseSurfaceFailed(); });
        return 0;
    }
    return 1;
}

/* Nothing runs here: everything starts from g3_host_start. */
int main(void) { return 0; }
