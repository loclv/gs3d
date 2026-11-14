// Dedicated WebGL host for repeatable browser reference checks.
import vec;
import g3.scene;
import g3.engine;
import g3.mesh;
import g3.render;
import g3.texture;
import g3.asset_web;

export fn g3_app_init(width: i32, height: i32) -> bool {
    guard g3::init(width, height, "Goose 3D WebGL reference checks") else { return false; }
    g3::set_output_srgb(false);
    g3::set_tone_mapping_mode(g3::TONE_MAPPING_NONE);
    g3::set_fxaa(false);
    return true;
}

export fn g3_app_frame(dt: f32) { g3::frame(dt); }
export fn g3_app_shutdown() { g3::shutdown(); }

export fn g3_reference_target_create(width: i32, height: i32) -> i32 {
    return g3::render_target_create(width, height);
}

export fn g3_reference_target_resize(target: i32, width: i32, height: i32) -> bool {
    return g3::render_target_resize(target, width, height);
}

export fn g3_reference_target_fill(target: i32, red: f32, green: f32, blue: f32) -> bool {
    guard g3::render_target_set(target) else { return false; }
    g3::scene_clear();
    g3::set_background(float4 { red, green, blue, 1.0 });
    g3::frame(1.0 / 60.0);
    g3::render_target_set(-1);
    return true;
}

export fn g3_reference_target_feedback(target: i32) -> bool {
    guard g3::render_target_set(target) else { return false; }
    g3::frame(1.0 / 60.0);
    let skipped = g3::stats().feedback_items_suppressed;
    g3::render_target_set(-1);
    return skipped > 0;
}

export fn g3_reference_set_screen_effects(enabled: bool) {
    g3::set_output_srgb(enabled);
    g3::set_tone_mapping_mode(if enabled { g3::TONE_MAPPING_ACES } else { g3::TONE_MAPPING_NONE });
    g3::set_fxaa(enabled);
}

export fn g3_reference_set_output(srgb: bool, tone_mapping: i32, exposure: f32) -> bool {
    guard g3::set_tone_mapping_mode(tone_mapping) else { return false; }
    guard g3::set_exposure(exposure) else { return false; }
    g3::set_output_srgb(srgb);
    g3::set_fxaa(false);
    return true;
}

export fn g3_reference_clear_color(red: f32, green: f32, blue: f32) {
    g3::scene_clear();
    g3::render_target_set(-1);
    g3::set_background(float4 { red, green, blue, 1.0 });
}

export fn g3_reference_post_process(source: i32, destination: i32, effect: i32) -> bool {
    return g3::post_process_run(source, destination, effect);
}

export fn g3_reference_post_process_queue_clear() { g3::post_process_queue_clear(); }

export fn g3_reference_post_process_queue_add(source: i32, destination: i32, effect: i32) -> bool {
    return g3::post_process_queue_add(source, destination, effect);
}

export fn g3_reference_post_process_queue_add_shader(shader: i32, source: i32, destination: i32) -> bool {
    return g3::post_process_queue_add_shader(shader, source, destination);
}

export fn g3_reference_post_process_queue_execute() -> bool {
    return g3::post_process_queue_execute();
}

export fn g3_reference_shader_create() -> i32 {
    return g3::post_process_shader_create("color.rgb = vec3(0.1, 0.8, 0.2);");
}

export fn g3_reference_shader_create_invalid() -> i32 {
    return g3::post_process_shader_create("color.rgb = vec3( ;");
}

export fn g3_reference_shader_run(shader: i32, source: i32, destination: i32) -> bool {
    return g3::post_process_shader_run(shader, source, destination);
}

export fn g3_reference_shader_remove(shader: i32) -> bool {
    return g3::post_process_shader_remove(shader);
}

export fn g3_reference_show_texture(texture: i32) -> bool {
    guard texture >= 0 else { return false; }
    g3::scene_clear();
    g3::render_target_set(-1);
    g3::set_output_srgb(false);
    g3::set_tone_mapping_mode(g3::TONE_MAPPING_NONE);
    g3::set_fxaa(false);
    g3::set_ambient(float3_1, 1.0);
    g3::set_fog(float3_0, 0.0);
    g3::set_background(float4 { 1.0, 0.0, 1.0, 1.0 });
    let camera .= g3::camera();
    camera.pos = float3 { 0.0, 0.0, 5.0 };
    camera.target = float3_0;
    camera.up = float3 { 0.0, 1.0, 0.0 };
    camera.fov = 0.9;
    camera.orthographic = false;
    let node .= g3::node(g3::node_add(g3::mesh_cube(1.0)));
    node.texture = texture;
    node.unlit = true;
    return true;
}

export fn g3_reference_clear_scene() { g3::scene_clear(); }

export fn g3_reference_target_remove(target: i32) -> bool {
    return g3::render_target_remove(target);
}
