import std;
import vec;
import math;
import g3.engine;
import g3.scene;
import g3.collision;
import game.siege;
import testing;
fn main() {
    let a = float3 { -5.0, 0.0, 0.0 }; let b = float3 { 5.0, 0.0, 0.0 };
    testing::check(g3::segment_sphere_intersects(a, b, float3_0, 0.5), "sweep hits target between endpoints");
    testing::check(g3::segment_sphere_intersects(a, b, float3 { 0.0, 1.0, 0.0 }, 1.0), "tangent counts as contact");
    testing::check(!g3::segment_sphere_intersects(a, b, float3 { 6.0, 0.0, 0.0 }, 0.5), "ray extension is not a segment hit");
    testing::check(g3::segment_sphere_intersects(a, a, a, 0.0), "stationary point contact");
    testing::check(!g3::segment_sphere_intersects(a, b, float3_0, -1.0), "negative radius rejected");
    guard g3::init(480, 360, "Rift Siege tests") else { exit(1); }
    siege::build();
    let nodes = g3::node_count();
    g3::g_keys[g3::KEY_D] = true; g3::g_keys[g3::KEY_W] = true;
    let origin = g3::node(siege::player).pos;
    siege::update(0.1);
    testing::check(abs(length(g3::node(siege::player).pos - origin) - 0.6) < 0.001, "diagonal movement has the same speed");
    g3::g_keys[g3::KEY_SHIFT] = true; siege::update(0.02);
    testing::check(siege::dash_time > 0.0 && siege::dash_cooldown > 1.7, "dash starts with a cooldown");
    g3::g_keys[g3::KEY_D] = false; g3::g_keys[g3::KEY_W] = false;
    g3::g_keys[g3::KEY_SHIFT] = false;
    siege::reset();
    // A point travelling from z=-6 to the cover center must be stopped.
    let cover = g3::node(siege::pillars[0]).pos;
    siege::shoot(cover - float3 { 0.0, 0.0, 2.0 }, float3 { 0.0, 0.0, 1.0 }, false);
    siege::update(0.1);
    testing::check(siege::shots[0].life <= 0.0, "cover absorbs projectiles");
    siege::reset();
    for i in 140 { siege::shoot(origin, float3 { 1.0, 0.0, 0.0 }, false); }
    testing::check(g3::node_count() == nodes && siege::shots[127].life > 0.0, "exhausting projectile pool allocates no nodes");
    siege::reset();
    testing::check(siege::alive == 8 && siege::health == 5, "first wave starts with eight enemies");
    // Isolate a target directly in a fast shot's path, away from cover.
    for &e in siege::enemies { e.hp = 0; g3::node(e.node).visible = false; }
    siege::enemies[0].hp = 1; siege::alive = 1;
    g3::node(siege::enemies[0].node).pos = float3 { 2.0, 0.65, 0.0 };
    siege::shoot(float3 { 0.0, 0.65, 0.0 }, float3 { 1.0, 0.0, 0.0 }, false);
    siege::update(0.1);
    testing::check(siege::alive == 0 && siege::score == 100, "projectile kills and scores once");
    for i in 21 { siege::update(0.1); }
    testing::check(siege::wave == 2 && siege::alive == 12 && siege::enemies[0].ranged, "intermission escalates to ranged wave");
    siege::immunity = 0.0; siege::dash_time = 0.1; siege::damage();
    testing::check(siege::health == 5, "dash blocks damage");
    siege::dash_time = 0.0; siege::damage(); siege::damage();
    testing::check(siege::health == 4, "damage grants temporary immunity");
    let pillar = g3::node(siege::pillars[0]).pos;
    let corrected = siege::constrain(pillar);
    testing::check(length(corrected - pillar) >= 1.399, "pillar center resolves without zero normalization");
    siege::immunity = 0.0; siege::health = 1; siege::damage();
    testing::check(siege::state == 2, "zero hull loses");
    siege::reset();
    for i in 4 { siege::spawn_wave(); }
    for &e in siege::enemies { e.hp = 0; }
    siege::alive = 0; siege::update(0.02);
    testing::check(siege::state == 1 && siege::wave == 5, "clearing final wave wins");
    for i in 20 { siege::reset(); }
    testing::check(g3::node_count() == nodes && siege::state == 0 && siege::score == 0, "restarts reuse every node and restore state");
    siege::update(0.0); g3::frame(0.0);
    testing::check(g3::save_frame("build/siege.ppm"), "CPU renderer saves playable scene");
    g3::shutdown();
    if !testing::finish() { exit(1); }
}
