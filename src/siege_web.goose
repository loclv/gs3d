import g3.engine;
import g3.render;
import game.siege;
import g3.asset_web;
export fn g3_app_init(width: i32, height: i32) -> bool {
    guard g3::init(width, height, "Rift Siege") else { return false; }
    siege::build(); return true;
}
export fn g3_app_frame(dt: f32) { g3::sample_input(); siege::update(dt); g3::frame(dt); }
export fn g3_app_shutdown() { g3::shutdown(); }
export fn siege_reset() { siege::reset(); }
export fn siege_wave() -> i32 { return siege::wave; }
export fn siege_health() -> i32 { return siege::health; }
export fn siege_score() -> i32 { return siege::score; }
export fn siege_state() -> i32 { return siege::state; }
export fn siege_alive() -> i32 { return siege::alive; }
export fn siege_dash() -> f32 { return siege::dash_cooldown; }
export fn siege_drawn() -> i32 { return g3::stats().drawn as i32; }
