// Host for the gs3d package's Three.js-compatible facade (web/three.js).
//
// Unlike the demo and viewer hosts this scene starts empty and neutral: no
// key light, ambient, fog, environment map or orbit camera. The facade owns
// the scene through the g3_asset_* bridge and selects its own camera, so the
// only job here is a clean surface with sRGB output.
import vec;
import g3.scene;
import g3.engine;
import g3.render;
import g3.texture;
import g3.asset_web;

export fn g3_app_init(width: i32, height: i32) -> bool {
    guard g3::init(width, height, "Goose 3D") else { return false; }
    g3::set_output_srgb(true);
    g3::set_ambient(float3_0, 0.0);
    g3::set_fog(float3_0, 0.0);
    g3::set_light(float3 { 0.0, -1.0, 0.0 }, float3_0);
    g3::set_background(float4 { 0.0, 0.0, 0.0, 1.0 });
    return true;
}
export fn g3_app_frame(dt: f32) { g3::frame(dt); }
export fn g3_app_shutdown() { g3::shutdown(); }
