// The engine facade: init, one call per frame, and input.
//
// A program draws a 3D scene with five calls:
//
//   guard g3::init(1280, 720, "window title") else { return; }
//   let mesh = g3::mesh_cube(1.0);
//   let n .= g3::node(g3::node_add(mesh));     // `.` binds the reference
//   n.color = float4 { 0.9, 0.55, 0.25, 1.0 };
//   g3::camera_orbit(0.6, 0.4, 8.0, float3 { 0.0, 0.0, 0.0 });
//   loop {
//       g3::frame(0.016);          // input, transforms, cull, sort, draw
//       if g3::key_pressed(g3::KEY_ESCAPE) { break; }
//   }
//   g3::shutdown();
//
// Whichever backend is linked decides whether that loop ends up in a browser
// canvas or in a PPM on disk; the program above is the same for both.

import vec;
import math;
import g3.math;
import g3.platform;
import g3.mesh;
import g3.scene;
import g3.render;
import g3.texture;

namespace g3;

let KEY_COUNT = 512;

// Key codes. They are the numbers a keyboard's classic keys have always had,
// which is also what `web/shell.js` maps the browser's events onto.
let KEY_BACKSPACE = 8;
let KEY_TAB = 9;
let KEY_ENTER = 13;
let KEY_SHIFT = 16;
let KEY_CONTROL = 17;
let KEY_ALT = 18;
let KEY_ESCAPE = 27;
let KEY_SPACE = 32;
let KEY_LEFT = 37;
let KEY_UP = 38;
let KEY_RIGHT = 39;
let KEY_DOWN = 40;
let KEY_A = 65;
let KEY_D = 68;
let KEY_E = 69;
let KEY_Q = 81;
let KEY_S = 83;
let KEY_W = 87;
let KEY_MINUS = 189;
let KEY_PLUS = 187;

var g_width: i32 = 1280;
var g_height: i32 = 720;
var g_time: f64;
var g_frames: i64;
var g_keys: bool[KEY_COUNT];
var g_keys_prev: bool[KEY_COUNT];

// Make the surface and set the lighting a scene wants before it says
// otherwise: a warm key light from above and behind, a cool sky fill, and a
// little distance fog so far geometry settles into the background.
fn init(width: i32, height: i32, title: const u8[:]) -> bool {
    guard g3p_init(width, height, title) else { return false; }
    g_width = g3p_width();
    g_height = g3p_height();
    set_light(float3 { -0.45, -0.8, -0.4 }, float3 { 1.0, 0.96, 0.88 });
    clear_lights();
    set_environment(float3_0, float3_0, 0.0);
    set_environment_map(-1, 0.0);
    clear_shadows();
    set_shadow_filter_radius(0);
    set_shadow_resolution(512);
    set_output_srgb(false);
    set_tone_mapping(false);
    set_fxaa(false);
    set_exposure(1.0);
    set_ambient(float3 { 0.34, 0.38, 0.5 }, 0.7);
    set_fog(float3 { 0.09, 0.1, 0.14 }, 0.0022);
    set_background(float4 { 0.09, 0.1, 0.14, 1.0 });
    return true;
}

fn shutdown() { g3p_shutdown(); }

// Read every key once, keeping last frame's state for the edge queries.
fn sample_input() {
    for i in 0..KEY_COUNT {
        g_keys_prev[i] = g_keys[i];
        g_keys[i] = g3p_key_down(i as i32);
    }
}

// One frame: sample input, multiply out the scene, cull, sort, draw.
fn frame(dt: f64) {
    g_time += dt;
    g_frames += 1;
    sample_input();
    g_width = g3p_width();
    g_height = g3p_height();
    begin_frame(g_time, g_width, g_height);
    render_scene();
}

fn width() -> i32 { return g_width }
fn height() -> i32 { return g_height }
fn aspect() -> f32 {
    if g_render_target >= 0 && g_render_target_height > 0 { return g_render_target_width as f32 / g_render_target_height; }
    return if g_height < 1 { 1.0 } else { g_width as f32 / g_height };
}
fn time() -> f64 { return g_time }
fn frame_count() -> i64 { return g_frames }

// Keys outside the table read as never pressed, so a caller can pass any code.
fn key_tracked(key: i32) -> bool { return key >= 0 && key < KEY_COUNT }

fn key_down(key: i32) -> bool {
    guard key_tracked(key) else { return false; }
    return g_keys[key];
}

fn key_pressed(key: i32) -> bool {
    guard key_tracked(key) else { return false; }
    return g_keys[key] && !g_keys_prev[key];
}

fn key_released(key: i32) -> bool {
    guard key_tracked(key) else { return false; }
    return !g_keys[key] && g_keys_prev[key];
}

// Mouse movement since the previous frame; reading it starts it over.
fn mouse_dx() -> f32 { return g3p_mouse_dx() }
fn mouse_dy() -> f32 { return g3p_mouse_dy() }

// Save the frame that was just drawn as a PPM image, where the backend can.
fn save_frame(path: const u8[:]) -> bool { return g3p_save_frame(path); }

// The rgb of one pixel of the frame just drawn, 0xRRGGBB, (0, 0) top left.
fn read_pixel(x: i32, y: i32) -> u32 { return g3p_read_pixel(x, y) }
