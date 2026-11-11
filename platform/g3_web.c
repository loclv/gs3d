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
    GLint mvp, model, color, params, eye, light_dir, light_color, ambient, fog;
} web_shader;

static EMSCRIPTEN_WEBGL_CONTEXT_HANDLE ctx;
static web_shader shader;

static int32_t surf_w = 1280, surf_h = 720;
static web_mesh *meshes;
static int32_t mesh_count, mesh_cap;
static int checked_gl;

static const char *VERTEX_SRC =
    "#version 300 es\n"
    "layout(location = 0) in vec3 a_pos;\n"
    "layout(location = 1) in vec3 a_normal;\n"
    "uniform mat4 u_mvp;\n"
    "uniform mat4 u_model;\n"
    "out vec3 v_normal;\n"
    "out vec3 v_world;\n"
    "void main() {\n"
    "    vec4 world = u_model * vec4(a_pos, 1.0);\n"
    "    v_world = world.xyz;\n"
    "    v_normal = mat3(u_model) * a_normal;\n"
    "    gl_Position = u_mvp * vec4(a_pos, 1.0);\n"
    "}\n";

/* Keep this in step with shade() in g3_soft.c. */
static const char *FRAGMENT_SRC =
    "#version 300 es\n"
    "precision highp float;\n"
    "in vec3 v_normal;\n"
    "in vec3 v_world;\n"
    "uniform vec4 u_color;\n"
    "uniform vec4 u_params;\n"   /* x unlit, y specular strength, z shininess, w blended */
    "uniform vec3 u_eye;\n"
    "uniform vec3 u_light_dir;\n"
    "uniform vec3 u_light_color;\n"
    "uniform vec4 u_ambient;\n"
    "uniform vec4 u_fog;\n"
    "out vec4 out_color;\n"
    "void main() {\n"
    "    vec3 n = normalize(v_normal);\n"
    "    vec3 l = -u_light_dir;\n"
    "    float diff = max(dot(n, l), 0.0);\n"
    "    vec3 v = normalize(u_eye - v_world);\n"
    "    vec3 h = normalize(l + v);\n"
    "    float spec = pow(max(dot(n, h), 0.0), max(u_params.z, 1.0)) * u_params.y;\n"
    "    vec3 col = u_color.rgb * (u_ambient.rgb * u_ambient.a + u_light_color * diff)\n"
    "             + u_light_color * spec;\n"
    "    if (u_params.x > 0.5) col = u_color.rgb;\n"
    "    float dist = length(u_eye - v_world);\n"
    "    float fog = clamp(1.0 - exp(-dist * u_fog.a), 0.0, 1.0);\n"
    "    col = mix(col, u_fog.rgb, fog);\n"
    "    out_color = vec4(col, u_color.a);\n"
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
    shader.color = glGetUniformLocation(shader.program, "u_color");
    shader.params = glGetUniformLocation(shader.program, "u_params");
    shader.eye = glGetUniformLocation(shader.program, "u_eye");
    shader.light_dir = glGetUniformLocation(shader.program, "u_light_dir");
    shader.light_color = glGetUniformLocation(shader.program, "u_light_color");
    shader.ambient = glGetUniformLocation(shader.program, "u_ambient");
    shader.fog = glGetUniformLocation(shader.program, "u_fog");
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
    glBindVertexArray(0);

    m->count = (GLsizei)indices.len;
    if (id >= mesh_count) mesh_count = id + 1;
}

/* --- a frame --- */

/* What every item of this frame shares. */
static void bind_view(const g3_view_state *view) {
    glUniform3f(shader.eye, view->eye.x, view->eye.y, view->eye.z);
    glUniform3f(shader.light_dir, view->light_dir.x, view->light_dir.y, view->light_dir.z);
    glUniform3f(shader.light_color, view->light_color.x, view->light_color.y,
                view->light_color.z);
    glUniform4f(shader.ambient, view->ambient.x, view->ambient.y, view->ambient.z,
                view->ambient.w);
    glUniform4f(shader.fog, view->fog.x, view->fog.y, view->fog.z, view->fog.w);
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
    glUniform4f(shader.color, it->color.x, it->color.y, it->color.z, it->color.w);
    glUniform4f(shader.params, it->params.x, it->params.y, it->params.z, it->params.w);

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

void g3p_draw_frame(g3_draw_item_slice items, const g3_view_state *view) {
    if (!ctx || !shader.program) return;
    glViewport(0, 0, surf_w, surf_h);
    glClearColor(view->clear.x, view->clear.y, view->clear.z, 1.0f);
    glClear(GL_COLOR_BUFFER_BIT | GL_DEPTH_BUFFER_BIT);

    glUseProgram(shader.program);
    bind_view(view);
    for (int64_t i = 0; i < items.len; i++) draw_item(&items.data[i]);
    glBindVertexArray(0);
    glDisable(GL_BLEND);
    glDepthMask(GL_TRUE);

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
