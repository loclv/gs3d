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

// A vertex as the backend receives it: 24 bytes, position then normal.
// A future textured mesh would add uv coordinates here, and a matching
// attribute in the two backends.
struct Vertex { pos: float3, normal: float3 }

// One triangle soup to draw with one state: mesh, its matrices, its colour.
struct DrawItem {
    mesh: i32,          // the id the mesh was uploaded with
    mvp: Mat4,          // model-view-projection, column-major
    model: Mat4,        // the model matrix, for world-space normals
    color: float4,      // rgb and a; a < 1 is drawn in the transparent pass
    // x: 1 for unlit, y: specular strength, z: shininess, w: 1 when blended
    params: float4,
    // The engine's sort key: backends draw in list order, so this only says
    // why that order is what it is (mesh id for opaque, distance for blended).
    key: f32,
}

// The frame's constants: what every draw of the frame shares.
struct ViewState {
    eye: float3,
    light_dir: float3,      // the direction the light travels, so -dir points at it
    light_color: float3,
    ambient: float4,        // rgb, and a = intensity
    fog: float4,            // rgb, and a = density (0 turns fog off)
    clear: float4,          // the colour the frame starts from
    params: float4,         // x = seconds since start, for animated shaders
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
