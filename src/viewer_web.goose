// Minimal host for the browser glTF viewer example.
import vec;
import g3.scene;
import g3.engine;
import g3.render;
import g3.asset_web;

export fn g3_app_init(width: i32, height: i32) -> bool {
    guard g3::init(width, height, "Goose 3D viewer") else { return false; }
    g3::set_output_srgb(true);
    g3::set_environment(float3 { 0.32, 0.48, 0.72 }, float3 { 0.16, 0.12, 0.08 }, 0.55);
    g3::camera_orbit(0.65, 0.35, 5.0, float3_0);
    return true;
}
export fn g3_app_frame(dt: f32) { g3::frame(dt); }
export fn g3_app_shutdown() { g3::shutdown(); }
export fn g3_viewer_orbit(yaw: f32, pitch: f32) { g3::camera_orbit_nudge(yaw, pitch); }
export fn g3_viewer_zoom(factor: f32) { g3::camera_zoom(factor); }
export fn g3_viewer_pan(dx: f32, dy: f32, viewport_height: i32) { g3::camera_pan(dx, dy, viewport_height); }
