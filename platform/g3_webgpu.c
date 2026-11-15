/* WebGPU renderer for the default browser app.  The mature WebGL2 backend is
   compiled beside it under g3glp_* names and remains the compatibility path. */
#include "g3_abi.h"
#include "g3_input.h"
#include <emscripten.h>
#include <stdio.h>
#include "g3.h"

extern uint8_t g3glp_init(int32_t, int32_t, g3_u8_slice);
extern void g3glp_shutdown(void);
extern int32_t g3glp_width(void);
extern int32_t g3glp_height(void);
extern void g3glp_upload_mesh(int32_t, g3_vertex_slice, g3_u32_slice);
extern void g3glp_release_mesh(int32_t);
extern void g3glp_draw_frame(g3_draw_item_slice, const g3_view_state *);
extern int g3gl_backend_resize(int, int);
extern void g3glp_upload_texture(int32_t, g3_u8_slice, int32_t, int32_t);
extern void g3glp_upload_texture_srgb(int32_t, g3_u8_slice, int32_t, int32_t);
extern void g3glp_upload_texture_hdr(int32_t, g3_f32_slice, int32_t, int32_t);
extern void g3glp_release_texture(int32_t);
extern void g3glp_texture_wrap(int32_t, int32_t, int32_t);
extern void g3glp_texture_filter(int32_t, int32_t, int32_t);
extern void g3glp_texture_generate_mips(int32_t);
extern void g3glp_texture_generate_env_mips(int32_t);
extern uint8_t g3glp_create_render_target(int32_t, int32_t, int32_t);
extern uint8_t g3glp_resize_render_target(int32_t, int32_t, int32_t);
extern uint8_t g3glp_post_process(int32_t, int32_t, int32_t);
extern uint8_t g3glp_post_process_shader_create(int32_t, g3_u8_slice);
extern void g3glp_post_process_shader_release(int32_t);
extern uint8_t g3glp_post_process_shader_run(int32_t, int32_t, int32_t);
extern int32_t g3glp_texture_width(int32_t);
extern int32_t g3glp_texture_height(int32_t);
extern uint8_t g3glp_load_radiance_hdr(int32_t, g3_u8_slice);
extern int32_t g3glp_decode_texture_srgb(int32_t, g3_u8_slice);
extern int32_t g3glp_decode_texture_linear(int32_t, g3_u8_slice);
extern uint8_t g3glp_save_frame(g3_u8_slice);
extern uint32_t g3glp_read_pixel(int32_t, int32_t);
extern int32_t g3gl_host_scene_draw_calls(void);

EM_JS(void, gpu_set_module, (), { if (window.g3wgpu) window.g3wgpu.setModule(Module); });
EM_JS(int, gpu_init, (int w, int h), { return window.g3wgpu && window.g3wgpu.init(w, h) ? 1 : 0; });
EM_JS(void, gpu_shutdown, (), { if (window.g3wgpu) window.g3wgpu.shutdown(); });
EM_JS(void, gpu_resize, (int w, int h), { if (window.g3wgpu) window.g3wgpu.resize(w, h); });
EM_JS(void, gpu_upload_mesh, (int id, int vp, int vn, int ip, int index_count), {
  if (window.g3wgpu) window.g3wgpu.uploadMesh(id, vp, vn, ip, index_count);
});
EM_JS(void, gpu_release_mesh, (int id), { if (window.g3wgpu) window.g3wgpu.releaseMesh(id); });
EM_JS(void, gpu_draw, (int p, int n, int v), { if (window.g3wgpu) window.g3wgpu.draw(p, n, v); });
EM_JS(int, gpu_draw_calls, (), { return window.g3wgpu ? window.g3wgpu.drawCalls() : 0; });
EM_JS(void, gpu_reset_canvas, (), { if (window.g3wgpu) window.g3wgpu.resetCanvas(); });

static int active_backend; /* 0 = not initialized, 1 = WebGL2, 2 = WebGPU */

uint8_t g3p_init(int32_t w, int32_t h, g3_u8_slice title) {
    gpu_set_module();
    if (gpu_init(w, h)) { active_backend = 2; EM_ASM({ window.g3Renderer = 'WebGPU'; }); return 1; }
    /* A failed WebGPU initialization may have claimed the canvas context. */
    gpu_reset_canvas();
    if (!g3glp_init(w, h, title)) return 0;
    active_backend = 1;
    EM_ASM({ window.g3Renderer = 'WebGL2'; });
    return 1;
}
void g3p_shutdown(void) {
    if (active_backend == 2) gpu_shutdown();
    else if (active_backend == 1) g3glp_shutdown();
    active_backend = 0;
}
int32_t g3p_width(void) { return active_backend == 2 ? EM_ASM_INT({return window.g3wgpu.width();}) : g3glp_width(); }
int32_t g3p_height(void) { return active_backend == 2 ? EM_ASM_INT({return window.g3wgpu.height();}) : g3glp_height(); }
void g3p_upload_mesh(int32_t id, g3_vertex_slice v, g3_u32_slice i) {
    if (active_backend == 2) gpu_upload_mesh(id, (int)(uintptr_t)v.data, (int)v.len,
                                             (int)(uintptr_t)i.data, (int)i.len);
    else g3glp_upload_mesh(id, v, i);
}
void g3p_release_mesh(int32_t id) { if (active_backend == 2) gpu_release_mesh(id); else g3glp_release_mesh(id); }
void g3p_draw_frame(g3_draw_item_slice items, const g3_view_state *view) {
    if (active_backend == 2) gpu_draw((int)(uintptr_t)items.data, (int)items.len, (int)(uintptr_t)view);
    else g3glp_draw_frame(items, view);
}
int g3_backend_resize(int w, int h) {
    if (active_backend == 2) { gpu_resize(w, h); return 1; }
    return g3gl_backend_resize(w, h);
}
EMSCRIPTEN_KEEPALIVE int32_t g3_host_scene_draw_calls(void) {
    return active_backend == 2 ? gpu_draw_calls() : g3gl_host_scene_draw_calls();
}

/* These paths are implemented by WebGL2 and return unsupported on WebGPU
   until their matching WebGPU render-target/texture operations are added. */
void g3p_upload_texture(int32_t a,g3_u8_slice b,int32_t c,int32_t d){if(active_backend==1)g3glp_upload_texture(a,b,c,d);}
void g3p_upload_texture_srgb(int32_t a,g3_u8_slice b,int32_t c,int32_t d){if(active_backend==1)g3glp_upload_texture_srgb(a,b,c,d);}
void g3p_upload_texture_hdr(int32_t a,g3_f32_slice b,int32_t c,int32_t d){if(active_backend==1)g3glp_upload_texture_hdr(a,b,c,d);}
void g3p_release_texture(int32_t a){if(active_backend==1)g3glp_release_texture(a);}
void g3p_texture_wrap(int32_t a,int32_t b,int32_t c){if(active_backend==1)g3glp_texture_wrap(a,b,c);}
void g3p_texture_filter(int32_t a,int32_t b,int32_t c){if(active_backend==1)g3glp_texture_filter(a,b,c);}
void g3p_texture_generate_mips(int32_t a){if(active_backend==1)g3glp_texture_generate_mips(a);}
void g3p_texture_generate_env_mips(int32_t a){if(active_backend==1)g3glp_texture_generate_env_mips(a);}
uint8_t g3p_create_render_target(int32_t a,int32_t b,int32_t c){return active_backend==1?g3glp_create_render_target(a,b,c):0;}
uint8_t g3p_resize_render_target(int32_t a,int32_t b,int32_t c){return active_backend==1?g3glp_resize_render_target(a,b,c):0;}
uint8_t g3p_post_process(int32_t a,int32_t b,int32_t c){return active_backend==1?g3glp_post_process(a,b,c):0;}
uint8_t g3p_post_process_shader_create(int32_t a,g3_u8_slice b){return active_backend==1?g3glp_post_process_shader_create(a,b):0;}
void g3p_post_process_shader_release(int32_t a){if(active_backend==1)g3glp_post_process_shader_release(a);}
uint8_t g3p_post_process_shader_run(int32_t a,int32_t b,int32_t c){return active_backend==1?g3glp_post_process_shader_run(a,b,c):0;}
int32_t g3p_texture_width(int32_t a){return active_backend==1?g3glp_texture_width(a):0;}
int32_t g3p_texture_height(int32_t a){return active_backend==1?g3glp_texture_height(a):0;}
uint8_t g3p_load_radiance_hdr(int32_t a,g3_u8_slice b){return active_backend==1?g3glp_load_radiance_hdr(a,b):0;}
int32_t g3p_decode_texture_srgb(int32_t a,g3_u8_slice b){return active_backend==1?g3glp_decode_texture_srgb(a,b):-1;}
int32_t g3p_decode_texture_linear(int32_t a,g3_u8_slice b){return active_backend==1?g3glp_decode_texture_linear(a,b):-1;}
uint8_t g3p_save_frame(g3_u8_slice a){return active_backend==1?g3glp_save_frame(a):0;}
uint32_t g3p_read_pixel(int32_t x,int32_t y){return active_backend==1?g3glp_read_pixel(x,y):0;}
