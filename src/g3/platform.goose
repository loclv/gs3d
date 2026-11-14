// The seam between the engine and whatever draws its triangles.
//
// The engine is pure Goose and knows nothing about WebGL, GLFW or a window.
// It hands the backend one call per frame: a sorted list of `DrawItem`s and
// the frame's `ViewState`. A backend is any C (or Goose) code that defines
// the `g3p_*` symbols below; this repository ships two:
//
//   platform/g3_web.c   WebGL2 through Emscripten, for the browser
//   platform/g3_soft.c  a CPU rasterizer, for headless frames and tests
//
// Every type that crosses the boundary is packed with no padding, so the
// C side reads the same bytes the Goose side wrote (the C files declare the
// matching structs under `#pragma pack(push, 1)`). Nothing crosses by value
// that is not flat and fixed-size.

import vec;
import math;
import g3.math;

namespace g3;

// UV (0,0) addresses the first row of the supplied RGBA image. A zero tangent
// selects the backend's UV-derived frame; otherwise tangent.w is handedness.
// Vertex colour is linear RGBA; white leaves the material base colour intact.
struct Vertex { pos: float3, normal: float3, uv: float2, uv1: float2, uv2: float2, uv3: float2, uv4: float2, uv5: float2, uv6: float2, uv7: float2, tangent: float4, color: float4 }
struct UvTransform { offset: float2, scale: float2, rotation: f32, texcoord: i32 }

// One triangle soup to draw with one state: mesh, its matrices, its colour.
struct DrawItem {
    mesh: i32,          // the id the mesh was uploaded with
    mvp: Mat4,          // model-view-projection, column-major
    model: Mat4,        // the model matrix, for world-space normals
    color: float4,      // RGB multiplier and alpha factor
    // x: 1 for unlit, y: specular strength, z: shininess, w: 1 when blended
    params: float4,
    // The engine's sort key: backends draw in list order, so this only says
    // why that order is what it is (mesh id for opaque, distance for blended).
    key: f32,
    texture: i32,       // -1 means untextured
    alpha_mode: i32,    // 0 opaque, 1 mask, 2 blend
    alpha_cutoff: f32,
    pbr: float4,        // x enabled, y metallic, z roughness, w index of refraction
    metallic_roughness_texture: i32, // linear texture: G roughness, B metallic
    normal_texture: i32, // linear tangent-space normal texture, -1 disables
    normal_scale: f32,
    occlusion_texture: i32, // linear data texture: R ambient occlusion
    occlusion_strength: f32,
    emissive: float4,   // RGB emission factor in linear space
    emissive_texture: i32, // sRGB emissive image, -1 disables
    double_sided: bool, // draw and light both winding directions
    base_color_uv: UvTransform,
    metallic_roughness_uv: UvTransform,
    normal_uv: UvTransform,
    occlusion_uv: UvTransform,
    emissive_uv: UvTransform,
    specular: float4, // rgb specular colour factor, w specular strength factor
    specular_texture: i32, // alpha channel controls dielectric reflection strength
    specular_color_texture: i32, // sRGB RGB controls dielectric F0 colour
    specular_uv: UvTransform,
    specular_color_uv: UvTransform,
    clearcoat: float4, // x factor, y roughness; z/w reserved
    clearcoat_texture: i32,
    clearcoat_roughness_texture: i32,
    clearcoat_normal_texture: i32,
    clearcoat_normal_scale: f32,
    clearcoat_uv: UvTransform,
    clearcoat_roughness_uv: UvTransform,
    clearcoat_normal_uv: UvTransform,
    sheen: float4, // RGB sheen colour factor, w sheen roughness
    sheen_color_texture: i32, // sRGB RGB controls sheen tint
    sheen_roughness_texture: i32, // linear alpha controls sheen roughness
    sheen_color_uv: UvTransform,
    sheen_roughness_uv: UvTransform,
    anisotropy: float4, // x strength, y rotation in radians
    anisotropy_texture: i32, // linear RG direction and B strength map
    anisotropy_uv: UvTransform,
    environment_intensity: f32, // scales environment lighting for this material
}

// Additional light: position.w = 0 directional, 1 point, 2 spot;
// direction.w = range, color.w = outer cone cosine, inner = inner cosine,
// attenuation = 0 squared linear range, 1 inverse square with range fade.
struct Light { position: float4, direction: float4, color: float4, inner: f32, attenuation: f32 }

// The frame's constants: what every draw of the frame shares.
struct ViewState {
    eye: float3,
    light_dir: float3,      // the direction the light travels, so -dir points at it
    light_color: float3,
    ambient: float4,        // rgb, and a = intensity
    fog: float4,            // rgb, and a = density (0 turns fog off)
    clear: float4,          // the colour the frame starts from
    params: float4,         // x time, y sRGB output, z tone-map mode (0 none, 1 Reinhard, 2 ACES), w exposure
    lights: Light[8],
    light_count: i32,
    env_sky: float4,        // rgb, w = intensity
    env_ground: float4,
    environment_texture: i32, // equirectangular RGB or HDR texture, -1 disables
    environment_intensity: f32,
    shadow_view_proj: Mat4,
    shadow_params: float4, // x enabled, y depth bias, z PCF radius in texels
    view_direction: float4, // xyz toward the viewer, w = orthographic
    point_shadow_view_proj: Mat4[6],
    point_shadow_light_index: i32,
    point_shadow_params: float4, // x enabled, y depth bias, z PCF radius in texels
    spot_shadow_view_proj: Mat4,
    spot_shadow_light_index: i32,
    spot_shadow_params: float4, // x enabled, y depth bias, z PCF radius in texels
    shadow_resolution: i32, // 256, 512, or 1024 square shadow maps
    post_process: i32, // bit 0 enables the FXAA output pass
    render_target: i32, // texture id to render into, -1 for the surface
    target_width: i32, // render-target size, ignored when render_target is -1
    target_height: i32,
    view_proj: Mat4, // camera view-projection matrix, used for WebGL instancing
    env_rotation: float2, // cosine and sine of the equirectangular yaw
}

// --- the backend interface

// Create the surface (a canvas on the web, a framebuffer natively). False if
// it cannot be made, after printing why. The title is a hint.
extern fn g3p_init(width: i32, height: i32, title: const u8[:]) -> bool;

extern fn g3p_shutdown();

// The drawable's current size in pixels, which changes with the canvas.
extern fn g3p_width() -> i32;
extern fn g3p_height() -> i32;

// Hand a mesh to the backend: verts, and indices into them. An id is uploaded
// once and drawn by that id for the rest of the program.
extern fn g3p_upload_mesh(id: i32, verts: const Vertex[:], indices: const u32[:]);
extern fn g3p_release_mesh(id: i32);
extern fn g3p_upload_texture(id: i32, pixels: const u8[:], width: i32, height: i32);
extern fn g3p_upload_texture_srgb(id: i32, pixels: const u8[:], width: i32, height: i32);
extern fn g3p_upload_texture_hdr(id: i32, pixels: const f32[:], width: i32, height: i32);
extern fn g3p_create_render_target(id: i32, width: i32, height: i32) -> bool;
extern fn g3p_resize_render_target(id: i32, width: i32, height: i32) -> bool;
extern fn g3p_post_process(source: i32, destination: i32, effect: i32) -> bool;
extern fn g3p_post_process_shader_create(id: i32, body: const u8[:]) -> bool;
extern fn g3p_post_process_shader_release(id: i32);
extern fn g3p_post_process_shader_run(shader: i32, source: i32, destination: i32) -> bool;
extern fn g3p_texture_width(id: i32) -> i32;
extern fn g3p_texture_height(id: i32) -> i32;
extern fn g3p_load_radiance_hdr(id: i32, path: const u8[:]) -> bool;
// Native CPU backend decodes PNG/JPEG memory and uploads an sRGB texture.
// Browser assets use the JavaScript decoder instead.
extern fn g3p_decode_texture_srgb(id: i32, encoded: const u8[:]) -> i32;
extern fn g3p_release_texture(id: i32);
// 0 clamp, 1 repeat, 2 mirrored repeat, independently for U and V.
extern fn g3p_texture_wrap(id: i32, wrap_u: i32, wrap_v: i32);
// Filters use glTF/WebGL numeric values: 9728/9729, plus 9984..9987 for minification.
extern fn g3p_texture_filter(id: i32, min_filter: i32, mag_filter: i32);
extern fn g3p_texture_generate_mips(id: i32);
extern fn g3p_texture_generate_env_mips(id: i32);

// Draw one whole frame: clear, then each item in order.
extern fn g3p_draw_frame(items: const DrawItem[:], view: const ViewState&);

// Input, as the backend sees it: key codes are the ones `engine.goose`
// names, and the mouse deltas are consumed by reading them.
extern fn g3p_key_down(key: i32) -> bool;
extern fn g3p_mouse_dx() -> f32;
extern fn g3p_mouse_dy() -> f32;

// Write the current frame as a PPM. False where there is no such thing
// (the web backend), which is how an app tells whether it can.
extern fn g3p_save_frame(path: const u8[:]) -> bool;

// The rgb of one pixel of the frame just drawn, as 0xRRGGBB, with (0, 0) at
// the top left. 0 outside the surface. This is how a headless program checks
// what it drew; it is a read of the framebuffer, so it costs a stall.
extern fn g3p_read_pixel(x: i32, y: i32) -> u32;
