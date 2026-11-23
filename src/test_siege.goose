import std;
import vec;
import math;
import g3.engine;
import g3.scene;
import g3.mesh;
import g3.physics;
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

    // Sphere colliders. Every expected value below is derived by hand.
    testing::check(g3::physics_body_add_sphere(g3::node_count() + 100, 0.5, 1.0) < 0 &&
                   g3::physics_body_add_sphere(0, 0.0, 1.0) < 0, "sphere bodies reject bad nodes and radii");
    g3::physics_clear();
    let unit_mesh = g3::mesh_cube(0.5);
    // A static box floor: center y=-0.5, half height 0.5, so its top face is y=0.
    let floor_node = g3::node_add(unit_mesh);
    g3::node(floor_node).pos = float3 { 0.0, -0.5, 0.0 };
    g3::physics_body_add(floor_node, float3 { 5.0, 0.5, 5.0 }, 0.0);
    let ball_node = g3::node_add(unit_mesh);
    g3::node(ball_node).pos = float3 { 0.0, 2.0, 0.0 };
    let ball = g3::physics_body_add_sphere(ball_node, 0.5, 1.0);
    for i in 240 { g3::physics_step(1.0 / 60.0); }
    // Rest contact puts the sphere center one radius above the top face: y = 0.5.
    testing::check(abs(g3::physics_body(ball).position.y - 0.5) < 0.02, "sphere settles one radius above the box floor");

    g3::physics_clear();
    g3::physics_set_gravity(float3_0);
    let hunter_node = g3::node_add(unit_mesh);
    g3::node(hunter_node).pos = float3 { -2.0, 0.0, 0.0 };
    let target_node = g3::node_add(unit_mesh);
    g3::node(target_node).pos = float3 { 0.0, 0.0, 0.0 };
    let hunter = g3::physics_body_add_sphere(hunter_node, 0.5, 1.0);
    g3::physics_body_add_sphere(target_node, 0.5, 0.0);
    g3::physics_body_set_velocity(hunter, float3 { 3.0, 0.0, 0.0 });
    for i in 40 { g3::physics_step(1.0 / 60.0); }
    g3::physics_set_gravity(float3 { 0.0, -9.81, 0.0 });
    // Two r=0.5 spheres touch at center distance 1.0, so the mover stops at
    // x = -1.0; with restitution 0 it keeps no normal velocity.
    testing::check(abs(g3::physics_body(hunter).position.x + 1.0) < 0.05 &&
                   abs(g3::physics_body(hunter).velocity.x) < 0.2, "sphere stops at contact distance");

    g3::physics_clear();
    let bounce_floor = g3::node_add(unit_mesh);
    g3::node(bounce_floor).pos = float3 { 0.0, -0.5, 0.0 };
    let floor_handle = g3::physics_body_add(bounce_floor, float3 { 5.0, 0.5, 5.0 }, 0.0);
    // Pair restitution is the minimum of the two bodies', so both need 1.0.
    g3::physics_body_set_restitution(floor_handle, 1.0);
    let bounce_ball = g3::node_add(unit_mesh);
    g3::node(bounce_ball).pos = float3 { 0.0, 0.5, 0.0 };
    let bounce = g3::physics_body_add_sphere(bounce_ball, 0.5, 1.0);
    g3::physics_body_set_restitution(bounce, 1.0);
    g3::physics_body_set_velocity(bounce, float3 { 0.0, -1.0, 0.0 });
    g3::physics_step(1.0 / 60.0);
    // One substep: gravity makes v.y = -1 - 9.81/60 = -1.1635 and the fall
    // gives penetration 0.0194; restitution 1 mirrors the normal velocity,
    // so v.y ends near +1.16.
    testing::check(g3::physics_body(bounce).velocity.y > 0.5, "restitution bounces a sphere off a box");

    // Capsule colliders: a cylinder of half_length capped by r spheres on
    // world Y. Bottom surface sits at center.y - (half_length + radius).
    testing::check(g3::physics_body_add_capsule(g3::node_count() + 100, 0.5, 0.5, 1.0) < 0 &&
                   g3::physics_body_add_capsule(0, -0.5, 0.5, 1.0) < 0 &&
                   g3::physics_body_add_capsule(0, 0.5, -0.5, 1.0) < 0, "capsule bodies reject bad nodes, radii and lengths");
    g3::physics_clear();
    let cap_floor = g3::node_add(unit_mesh);
    g3::node(cap_floor).pos = float3 { 0.0, -0.5, 0.0 };
    g3::physics_body_add(cap_floor, float3 { 5.0, 0.5, 5.0 }, 0.0);
    let cap_drop = g3::node_add(unit_mesh);
    g3::node(cap_drop).pos = float3 { 0.0, 3.0, 0.0 };
    let capsule = g3::physics_body_add_capsule(cap_drop, 0.5, 0.5, 1.0);
    for i in 300 { g3::physics_step(1.0 / 60.0); }
    // Bottom cap touches the floor's top face (y=0) when center y = 0.5+0.5 = 1.0.
    testing::check(abs(g3::physics_body(capsule).position.y - 1.0) < 0.02, "capsule settles with its cap on the box floor");

    // Capsule cap resting on a sphere: sphere top at y=0.5, capsule bottom
    // reaches it when center y = 0.5 + 0.5 + 0.5 = 1.5.
    g3::physics_clear();
    let peg = g3::node_add(unit_mesh);
    g3::node(peg).pos = float3_0;
    g3::physics_body_add_sphere(peg, 0.5, 0.0);
    let cap_on_sphere = g3::node_add(unit_mesh);
    g3::node(cap_on_sphere).pos = float3 { 0.0, 3.0, 0.0 };
    let capsule2 = g3::physics_body_add_capsule(cap_on_sphere, 0.5, 0.5, 1.0);
    for i in 300 { g3::physics_step(1.0 / 60.0); }
    testing::check(abs(g3::physics_body(capsule2).position.y - 1.5) < 0.02, "capsule cap rests on a sphere");

    // Two r=0.5 capsules touch when their axis distance is 1.0, so the
    // mover stops at x = -1.0 exactly like the sphere pair did.
    g3::physics_clear();
    g3::physics_set_gravity(float3_0);
    let cap_a_node = g3::node_add(unit_mesh);
    g3::node(cap_a_node).pos = float3 { -2.0, 0.0, 0.0 };
    let cap_b_node = g3::node_add(unit_mesh);
    g3::node(cap_b_node).pos = float3_0;
    let cap_a = g3::physics_body_add_capsule(cap_a_node, 0.5, 0.5, 1.0);
    g3::physics_body_add_capsule(cap_b_node, 0.5, 0.5, 0.0);
    g3::physics_body_set_velocity(cap_a, float3 { 3.0, 0.0, 0.0 });
    for i in 40 { g3::physics_step(1.0 / 60.0); }
    // A capsule rammed at a box wall: the wall's near face is x=1.5 and the
    // capsule surface reaches it when the center is at x = 1.0.
    testing::check(abs(g3::physics_body(cap_a).position.x + 1.0) < 0.05 &&
                   abs(g3::physics_body(cap_a).velocity.x) < 0.2, "capsule stops at capsule contact distance");
    g3::physics_clear();
    let wall = g3::node_add(unit_mesh);
    g3::node(wall).pos = float3 { 2.0, 0.0, 0.0 };
    g3::physics_body_add(wall, float3 { 0.5, 0.5, 0.5 }, 0.0);
    let ram = g3::node_add(unit_mesh);
    g3::node(ram).pos = float3_0;
    let ram_body = g3::physics_body_add_capsule(ram, 0.5, 0.5, 1.0);
    g3::physics_body_set_velocity(ram_body, float3 { 3.0, 0.0, 0.0 });
    for i in 40 { g3::physics_step(1.0 / 60.0); }
    g3::physics_set_gravity(float3 { 0.0, -9.81, 0.0 });
    testing::check(abs(g3::physics_body(ram_body).position.x - 1.0) < 0.05 &&
                   abs(g3::physics_body(ram_body).velocity.x) < 0.2, "capsule stops at a box wall");
    g3::physics_clear();
    g3::shutdown();
    if !testing::finish() { exit(1); }
}
