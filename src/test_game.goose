import std;
import g3.engine;
import g3.scene;
import game.arena;
import testing;

fn main() {
    guard g3::init(320, 240, "Beacon Run test") else { exit(1); }
    game::build();
    testing::check(game::score == 0 && game::state == 0, "starts playing with no beacons");
    for i in 8 {
        g3::node(game::player).pos = g3::node(game::beacons[i]).pos;
        game::update(0.0);
    }
    testing::check(game::score == 8 && game::state == 1, "collecting eight beacons wins");
    game::reset();
    testing::check(game::score == 0 && game::state == 0 && g3::node(game::beacons[0]).visible, "reset restores the game");
    g3::node(game::player).pos = g3::node(game::sentinel).pos;
    game::update(0.0);
    testing::check(game::state == 2, "touching the sentinel loses");
    g3::frame(1.0 / 60.0);
    g3::shutdown();
    if !testing::finish() { exit(1); }
}
