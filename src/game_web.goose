import g3.engine;
import game.arena;

export fn g3_app_init(width: i32, height: i32) -> bool {
    guard g3::init(width, height, "Beacon Run") else { return false; }
    game::build();
    return true;
}
export fn g3_app_frame(dt: f32) { game::update(dt); g3::frame(dt); }
export fn g3_app_shutdown() { g3::shutdown(); }
export fn game_reset() { game::reset(); }
export fn game_score() -> i32 { return game::score; }
export fn game_state() -> i32 { return game::state; }
export fn game_time() -> f32 { return game::elapsed; }
export fn game_floor_texture() -> i32 { return game::floor_texture; }
