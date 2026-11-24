import std;
import vec;
import math;
import g3.engine;
import g3.math;
import g3.scene;
import g3.mesh;
import g3.physics;
import g3.rapier;
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

    // Rapier-style facade: same solver and bodies, Rapier vocabulary.
    // Timestep is world state, clamped to physics_step's (0, 1] range.
    testing::check(!g3::rapier_set_timestep(0.0) && !g3::rapier_set_timestep(2.0) &&
                   g3::rapier_set_timestep(1.0 / 30.0) && g3::rapier_timestep() == 1.0 / 30.0,
                   "rapier timestep accepts only (0, 1] seconds");
    g3::physics_clear();
    g3::physics_set_gravity(float3_0);
    let rfloor = g3::node_add(unit_mesh);
    g3::node(rfloor).pos = float3 { 0.0, -0.5, 0.0 };
    g3::rapier_body_add_cuboid(rfloor, float3 { 5.0, 0.5, 5.0 }, 0.0);
    let rball_node = g3::node_add(unit_mesh);
    g3::node(rball_node).pos = float3 { 0.0, 2.0, 0.0 };
    let rball = g3::rapier_body_add_ball(rball_node, 0.5, 1.0);
    testing::check(g3::rapier_body_is_dynamic(rball) && !g3::rapier_body_is_dynamic(0),
                   "rapier mass zero is fixed, positive is dynamic");
    // applyImpulse on a mass-1 body is a pure velocity change; world.step()
    // then integrates it at the stored timestep: dx = 2.0 * (1/30).
    g3::rapier_body_apply_impulse(rball, float3 { 2.0, 0.0, 0.0 });
    testing::check(g3::rapier_body_linvel(rball).x == 2.0, "rapier applyImpulse sets velocity on a unit-mass body");
    g3::rapier_world_step();
    testing::check(abs(g3::rapier_body_translation(rball).x - 2.0 / 30.0) < 0.0001,
                   "rapier world.step integrates linvel at the stored timestep");
    // setTranslation teleports, zeroes velocity and updates the node at once.
    g3::rapier_body_set_translation(rball, float3 { 10.0, 0.0, 0.0 });
    testing::check(g3::node(rball_node).pos.x == 10.0 && g3::rapier_body_linvel(rball).x == 0.0,
                   "rapier setTranslation teleports the body and its node");

    // Rapier facade guards: constructors and accessors reject bad input.
    testing::check(g3::rapier_body_add_ball(g3::node_count() + 100, 0.5, 1.0) < 0 &&
                   g3::rapier_body_add_cuboid(0, float3 { -1.0, 1.0, 1.0 }, 1.0) < 0 &&
                   g3::rapier_body_add_capsule(0, -0.5, 0.5, 1.0) < 0,
                   "rapier body constructors reject bad arguments");
    testing::check(!g3::rapier_body_set_translation(-1, float3_0) &&
                   !g3::rapier_body_set_linvel(-1, float3_0) &&
                   !g3::rapier_body_set_restitution(-1, 0.5) &&
                   !g3::rapier_body_set_friction(-1, 0.5),
                   "rapier accessors reject bad body ids");
    // Body 0 is the fixed floor: impulse is rejected there, accepted on rball.
    testing::check(!g3::rapier_body_apply_impulse(0, float3 { 1.0, 0.0, 0.0 }) &&
                   g3::rapier_body_apply_impulse(rball, float3 { 0.0, 1.0, 0.0 }),
                   "rapier applyImpulse works on dynamic bodies only");
    // Gravity (0,-1,0) for one second at 1/60 steps: the +1 impulse gives
    // v.y = 1 - t, ending at 0, and y = sum(v_k)/60 = 29.5/60 = 0.49166...
    // Hand-derived, not read back from the engine.
    g3::rapier_set_timestep(1.0 / 60.0);
    g3::rapier_set_gravity(float3 { 0.0, -1.0, 0.0 });
    for i in 60 { g3::rapier_world_step(); }
    testing::check(abs(g3::rapier_body_linvel(rball).y) < 0.001 &&
                   abs(g3::rapier_body_translation(rball).y - 0.4917) < 0.001 &&
                   g3::rapier_body_translation(rball).x == 10.0,
                   "rapier gravity integrates through world.step");
    g3::rapier_world_clear();
    testing::check(g3::physics_body_count() == 0, "rapier world_clear removes every body");
    // Capsule end-to-end through the facade: the bottom cap settles with its
    // center one radius-plus-half-length above the floor top, y = 1.0.
    g3::physics_set_gravity(float3 { 0.0, -9.81, 0.0 });
    let rcap_floor = g3::node_add(unit_mesh);
    g3::node(rcap_floor).pos = float3 { 0.0, -0.5, 0.0 };
    g3::rapier_body_add_cuboid(rcap_floor, float3 { 5.0, 0.5, 5.0 }, 0.0);
    let rcap_node = g3::node_add(unit_mesh);
    g3::node(rcap_node).pos = float3 { 0.0, 3.0, 0.0 };
    let rcap = g3::rapier_body_add_capsule(rcap_node, 0.5, 0.5, 1.0);
    for i in 300 { g3::rapier_world_step(); }
    testing::check(abs(g3::rapier_body_translation(rcap).y - 1.0) < 0.02,
                   "rapier capsule settles on a box floor");

    // Kinematic bodies: velocity-driven, untouched by gravity, forces or
    // impulses, but they still carry dynamic bodies through friction.
    g3::physics_clear();
    g3::physics_set_gravity(float3 { 0.0, -9.81, 0.0 });
    let pad_node = g3::node_add(unit_mesh);
    g3::node(pad_node).pos = float3_0;
    let platform = g3::physics_body_add(pad_node, float3 { 2.0, 0.5, 2.0 }, 1.0);
    testing::check(g3::physics_body_set_kinematic(platform, true) &&
                   g3::physics_body_is_kinematic(platform), "kinematic flag sets and reads back");
    g3::physics_body_set_velocity(platform, float3 { 1.0, 0.0, 0.0 });
    testing::check(!g3::physics_apply_force(platform, float3 { 0.0, 1.0, 0.0 }),
                   "kinematic bodies ignore forces");
    let rider_node = g3::node_add(unit_mesh);
    g3::node(rider_node).pos = float3 { 0.0, 0.75, 0.0 };
    // A box rider: a sphere would roll without slipping and its center
    // legitimately trails the platform while it spins up.
    let rider = g3::physics_body_add(rider_node, float3 { 0.25, 0.25, 0.25 }, 1.0);
    for i in 60 { g3::physics_step(1.0 / 60.0); }
    // The platform's top face is y=0.5, so the 0.5-wide box rests at
    // y=0.75 while friction drags it along at the platform's 1 u/s.
    testing::check(abs(g3::physics_body(platform).position.x - 1.0) < 0.001 &&
                   g3::physics_body(platform).position.y == 0.0 &&
                   g3::physics_body(platform).velocity.y == 0.0,
                   "kinematic body moves at its velocity only, gravity aside");
    testing::check(g3::physics_body(rider).position.x > 0.7 &&
                   abs(g3::physics_body(rider).position.y - 0.75) < 0.05,
                   "kinematic platform carries a resting dynamic body");

    // Removal tombstones the slot: ids stay valid for lookups, the body
    // stops simulating, and the count still includes the dead slot.
    testing::check(g3::physics_body_remove(platform), "remove accepts a live body");
    testing::check(!g3::physics_body_remove(platform) && !g3::physics_body_remove(999) &&
                   !g3::physics_body_set_mass(platform, 2.0) &&
                   !g3::physics_body_set_velocity(platform, float3_1) &&
                   !g3::physics_body_set_kinematic(platform, false),
                   "removed bodies reject state changes and re-removal");
    testing::check(g3::physics_body_count() == 2, "removal keeps the slot as a tombstone");
    for i in 30 { g3::physics_step(1.0 / 60.0); }
    // With the platform gone the rider falls under gravity from y=0.75.
    testing::check(g3::physics_body(rider).position.y < 0.6,
                   "removed kinematic body no longer supports its rider");

    // set_mass re-derives inverse mass, and kinematic mode round-trips it.
    g3::physics_clear();
    g3::physics_set_gravity(float3_0);
    let mnode = g3::node_add(unit_mesh);
    g3::node(mnode).pos = float3_0;
    let mb = g3::physics_body_add_sphere(mnode, 0.5, 1.0);
    testing::check(g3::physics_body_set_mass(mb, 4.0) &&
                   g3::physics_body_set_kinematic(mb, true) &&
                   !g3::physics_apply_force(mb, float3 { 0.0, 0.0, 1.0 }) &&
                   g3::physics_body_set_kinematic(mb, false),
                   "mass and kinematic changes guard and restore correctly");
    g3::physics_apply_force(mb, float3 { 0.0, 0.0, 1.0 });
    g3::physics_step(1.0 / 60.0);
    // One substep: dv = F/m * dt = 1/4 * 1/60 = 1/240.
    testing::check(abs(g3::physics_body(mb).velocity.z - 1.0 / 240.0) < 0.0001,
                   "set_mass rescales force response");
    testing::check(g3::physics_body_set_mass(mb, 0.0) && !g3::physics_apply_force(mb, float3_1),
                   "zero mass makes a body static again");

    // sync adopts an externally moved node position; without it the body
    // writes its own stale position back over the node on the next step.
    g3::physics_clear();
    let snode = g3::node_add(unit_mesh);
    g3::node(snode).pos = float3_0;
    let sb = g3::physics_body_add_sphere(snode, 0.5, 1.0);
    g3::node(snode).pos = float3 { 5.0, 0.0, 0.0 };
    g3::physics_step(1.0 / 60.0);
    testing::check(g3::node(snode).pos.x == 0.0, "unsynced node move is overwritten by the body");
    g3::node(snode).pos = float3 { 5.0, 0.0, 0.0 };
    testing::check(g3::physics_body_sync(sb) && g3::physics_body(sb).position.x == 5.0,
                   "sync adopts the node's position");
    g3::physics_step(1.0 / 60.0);
    testing::check(g3::node(snode).pos.x == 5.0, "synced body keeps the node in place");

    // Contact query: two r=0.5 spheres with centers 0.9 apart overlap by
    // 0.1; the normal points from the first body toward the second.
    g3::physics_clear();
    let ca_node = g3::node_add(unit_mesh);
    g3::node(ca_node).pos = float3 { -0.45, 0.0, 0.0 };
    let ca_id = g3::physics_body_add_sphere(ca_node, 0.5, 1.0);
    let cb_node = g3::node_add(unit_mesh);
    g3::node(cb_node).pos = float3 { 0.45, 0.0, 0.0 };
    let cb_id = g3::physics_body_add_sphere(cb_node, 0.5, 0.0);
    g3::physics_step(1.0 / 60.0);
    testing::check(g3::physics_contact_count() == 1, "overlapping spheres record one contact");
    let ct = g3::physics_contact(0);
    testing::check(ct.a == ca_id && ct.b == cb_id &&
                   abs(ct.penetration - 0.1) < 0.0001 &&
                   abs(ct.normal.x - 1.0) < 0.0001 && abs(ct.normal.y) < 0.0001 &&
                   abs(ct.point.x) < 0.0001 && abs(ct.point.y) < 0.0001 && abs(ct.point.z) < 0.0001,
                   "contact reports ids, normal, point and penetration");

    // Raycast: sphere, box and capsule hits plus misses, against a
    // hand-derived layout.
    g3::physics_clear();
    let rs_node = g3::node_add(unit_mesh);
    g3::node(rs_node).pos = float3_0;
    let rs_id = g3::physics_body_add_sphere(rs_node, 0.5, 0.0);
    let rhit = g3::physics_raycast(float3 { 0.0, 0.0, 3.0 }, float3 { 0.0, 0.0, -1.0 }, 10.0);
    testing::check(rhit.hit && rhit.body == rs_id &&
                   abs(rhit.distance - 2.5) < 0.0001 &&
                   abs(rhit.point.z - 0.5) < 0.0001 && abs(rhit.normal.z - 1.0) < 0.0001,
                   "raycast hits a sphere with distance, point and normal");
    testing::check(!g3::physics_raycast(float3 { 0.0, 5.0, 3.0 }, float3 { 0.0, 0.0, -1.0 }, 10.0).hit &&
                   !g3::physics_raycast(float3_0, float3_0, 10.0).hit,
                   "raycast reports misses and rejects a zero direction");
    testing::check(g3::physics_body_remove(rs_id) &&
                   !g3::physics_raycast(float3 { 0.0, 0.0, 3.0 }, float3 { 0.0, 0.0, -1.0 }, 10.0).hit,
                   "raycast skips removed bodies");
    g3::physics_clear();
    let rb_node = g3::node_add(unit_mesh);
    g3::node(rb_node).pos = float3_0;
    let rb_id = g3::physics_body_add(rb_node, float3 { 0.5, 0.5, 0.5 }, 0.0);
    let bhit = g3::physics_raycast(float3 { 0.0, 3.0, 0.0 }, float3 { 0.0, -1.0, 0.0 }, 10.0);
    testing::check(bhit.hit && bhit.body == rb_id &&
                   abs(bhit.distance - 2.5) < 0.0001 && abs(bhit.point.y - 0.5) < 0.0001 &&
                   abs(bhit.normal.y - 1.0) < 0.0001,
                   "raycast enters a box through its top face");
    let inside = g3::physics_raycast(float3_0, float3 { 0.0, 1.0, 0.0 }, 10.0);
    testing::check(inside.hit && inside.body == rb_id && inside.distance == 0.0,
                   "ray starting inside a box hits at distance zero");
    g3::physics_clear();
    let rc_node = g3::node_add(unit_mesh);
    g3::node(rc_node).pos = float3_0;
    let rc_id = g3::physics_body_add_capsule(rc_node, 0.5, 0.5, 0.0);
    // The capsule axis is the y segment [-0.5, 0.5]; a ray along -x at
    // y=z=0 reaches the +x cap surface at x=0.5 after traveling 1.5.
    let chit = g3::physics_raycast(float3 { 2.0, 0.0, 0.0 }, float3 { -1.0, 0.0, 0.0 }, 10.0);
    testing::check(chit.hit && chit.body == rc_id &&
                   abs(chit.distance - 1.5) < 0.001 && abs(chit.normal.x - 1.0) < 0.001,
                   "raycast hits a capsule cap");

    // Rotation and angular dynamics. Euler angles round-trip through the
    // node convention, including the gimbal-lock case where yaw and roll
    // merge — what matters is that the rebuilt matrix matches.
    g3::physics_clear();
    g3::physics_set_gravity(float3_0);
    let rnode = g3::node_add(unit_mesh);
    g3::node(rnode).pos = float3_0;
    g3::node(rnode).rot = float3 { 0.3, 0.7, -0.2 };
    let euler_body = g3::physics_body_add_sphere(rnode, 0.5, 1.0);
    let e = g3::physics_body_euler(euler_body);
    testing::check(abs(e.x - 0.3) < 0.0001 && abs(e.y - 0.7) < 0.0001 && abs(e.z + 0.2) < 0.0001,
                   "body euler matches the node's rotation");
    g3::node(rnode).rot = float3 { 0.4, 1.5707963, 0.9 };
    g3::physics_body_sync(euler_body);
    let eg = g3::physics_body_euler(euler_body);
    let m_want = g3::mat4_rotate_euler(float3 { 0.4, 1.5707963, 0.9 });
    let m_got = g3::mat4_rotate_euler(eg);
    var m_close = true;
    for i in 16 { if abs(m_want.m[i] - m_got.m[i]) > 0.0001 { m_close = false; } }
    testing::check(m_close, "euler extraction survives gimbal lock");

    // Torque integrates into angular velocity; for a sphere I = 2/5 m r^2
    // so the inverse inertia is 2.5/(1*0.25) = 10 about every axis.
    // torque (0,0,0.2) for one 1/60 step gives w.z = 0.2*10/60 = 1/30.
    let tnode = g3::node_add(unit_mesh);
    g3::node(tnode).pos = float3_0;
    let tbody = g3::physics_body_add_sphere(tnode, 0.5, 1.0);
    testing::check(g3::physics_apply_torque(tbody, float3 { 0.0, 0.0, 0.2 }),
                   "apply_torque accepts a dynamic body");
    g3::physics_step(1.0 / 60.0);
    let w = g3::physics_body_angvel(tbody);
    testing::check(abs(w.z - 1.0 / 30.0) < 0.0001 && abs(w.x) < 0.0001,
                   "torque produces angular velocity through the inertia tensor");
    // The orientation advanced by w*dt = 1/1800 rad about z, and the
    // node's euler rotation was written back.
    testing::check(abs(g3::physics_body_euler(tbody).z - 1.0 / 1800.0) < 0.0001 &&
                   abs(g3::node(tnode).rot.z - 1.0 / 1800.0) < 0.0001,
                   "angular velocity integrates orientation and writes node.rot");

    // An off-center impulse spins the body: J=(0,0,1) at r=(1,0,0) gives
    // dv=(0,0,1) and torque impulse r x J = (0,-1,0), so dw = (0,-10,0).
    testing::check(g3::physics_body_apply_impulse_at(tbody, float3 { 0.0, 0.0, 1.0 }, float3 { 1.0, 0.0, 0.0 }),
                   "impulse at a point applies to dynamic bodies");
    let w2 = g3::physics_body_angvel(tbody);
    testing::check(abs(w2.y + 10.0) < 0.0001 && abs(w2.z - 1.0 / 30.0) < 0.0001 &&
                   abs(g3::physics_body(tbody).velocity.z - 1.0) < 0.0001,
                   "off-center impulse adds angular velocity about the lever arm");
    testing::check(!g3::physics_body_apply_impulse_at(-1, float3_1, float3_0) &&
                   !g3::physics_apply_torque(-1, float3_1),
                   "torque and point impulse reject bad body ids");

    // Kinematic bodies rotate too: angvel integrates the orientation and
    // the node's euler rotation follows, with no torque or gravity.
    let knode = g3::node_add(unit_mesh);
    g3::node(knode).pos = float3_0;
    let kbody = g3::physics_body_add_sphere(knode, 0.5, 1.0);
    g3::physics_body_set_kinematic(kbody, true);
    g3::physics_body_set_angvel(kbody, float3 { 0.0, 1.0, 0.0 });
    g3::physics_step(1.0 / 60.0);
    testing::check(abs(g3::physics_body_angvel(kbody).y - 1.0) < 0.0001 &&
                   abs(g3::node(knode).rot.y - 1.0 / 60.0) < 0.0001,
                   "kinematic angvel rotates the node");

    // Rotated colliders: a box yawed 90 degrees swaps its x/z extents.
    // A sphere at x=0.9 overlaps the unrotated box (half x = 1) but misses
    // the rotated one (world x extent becomes half z = 0.5, and the box
    // end at local z = 0.5 + radius 0.3 = 0.8 < 0.9).
    g3::physics_clear();
    g3::physics_set_gravity(float3_0);
    let obox_node = g3::node_add(unit_mesh);
    g3::node(obox_node).pos = float3_0;
    g3::physics_body_add(obox_node, float3 { 1.0, 0.5, 0.5 }, 0.0);
    let os_node = g3::node_add(unit_mesh);
    g3::node(os_node).pos = float3 { 0.9, 0.0, 0.0 };
    g3::physics_body_add_sphere(os_node, 0.3, 1.0);
    g3::physics_step(1.0 / 60.0);
    testing::check(g3::physics_contact_count() >= 1 &&
                   g3::physics_body(1).position.x > 1.0,
                   "sphere inside an axis-aligned box is pushed out");
    g3::physics_clear();
    g3::node(obox_node).rot = float3 { 0.0, 1.5707963, 0.0 };
    g3::node(os_node).pos = float3 { 0.9, 0.0, 0.0 };
    g3::physics_body_add(obox_node, float3 { 1.0, 0.5, 0.5 }, 0.0);
    g3::physics_body_add_sphere(os_node, 0.3, 1.0);
    g3::physics_step(1.0 / 60.0);
    testing::check(g3::physics_contact_count() == 0 &&
                   g3::physics_body(1).position.x == 0.9,
                   "sphere misses a box rotated 90 degrees about Y");

    // Rotated box raycast: the same yawed box presents half extent 1.0
    // along world z (local x maps to world z), so a ray down -z enters
    // at z=1.0 — distance 2.0 — instead of the unrotated 2.5.
    g3::physics_clear();
    g3::node(obox_node).rot = float3 { 0.0, 1.5707963, 0.0 };
    g3::physics_body_add(obox_node, float3 { 1.0, 0.5, 0.5 }, 0.0);
    let rhit2 = g3::physics_raycast(float3 { 0.0, 0.0, 3.0 }, float3 { 0.0, 0.0, -1.0 }, 10.0);
    testing::check(rhit2.hit && abs(rhit2.distance - 2.0) < 0.0001 &&
                   abs(rhit2.normal.z - 1.0) < 0.0001,
                   "raycast respects the rotated box's world extents");

    // Matrix-driven nodes (use_local_matrix, as produced by asset/facade
    // imports): the solver reads TRS out of local_matrix and writes the
    // simulated transform back into it, scale preserved.
    g3::physics_clear();
    g3::physics_set_gravity(float3 { 0.0, -9.81, 0.0 });
    let mfloor_node = g3::node_add(unit_mesh);
    g3::node(mfloor_node).use_local_matrix = true;
    g3::node(mfloor_node).local_matrix = g3::mat4_trs(float3 { 0.0, -0.5, 0.0 }, float3_0, float3_1);
    g3::physics_body_add(mfloor_node, float3 { 5.0, 0.5, 5.0 }, 0.0);
    let mball_node = g3::node_add(unit_mesh);
    g3::node(mball_node).use_local_matrix = true;
    g3::node(mball_node).local_matrix = g3::mat4_trs(float3 { 0.0, 2.0, 0.0 }, float3 { 0.0, 0.0, 0.4 }, float3 { 2.0, 2.0, 2.0 });
    let mball = g3::physics_body_add_sphere(mball_node, 0.5, 1.0);
    for i in 240 { g3::physics_step(1.0 / 60.0); }
    // Rest contact puts the sphere center at y = 0.5, written into
    // local_matrix's translation column; scale stays 2.0.
    let mmm = g3::node(mball_node).local_matrix.m;
    testing::check(abs(g3::physics_body(mball).position.y - 0.5) < 0.02 &&
                   abs(mmm[13] - 0.5) < 0.02 &&
                   abs(sqrt(mmm[0] * mmm[0] + mmm[1] * mmm[1] + mmm[2] * mmm[2]) - 2.0) < 0.01,
                   "matrix node sphere settles and writes back local_matrix");
    // A kinematic spin on a matrix node rotates the matrix columns.
    let kspin_node = g3::node_add(unit_mesh);
    g3::node(kspin_node).use_local_matrix = true;
    g3::node(kspin_node).local_matrix = g3::mat4_trs(float3_0, float3_0, float3_1);
    let kspin = g3::physics_body_add(kspin_node, float3 { 0.5, 0.5, 0.5 }, 1.0);
    g3::physics_body_set_kinematic(kspin, true);
    g3::physics_body_set_angvel(kspin, float3 { 0.0, 1.0, 0.0 });
    for i in 30 { g3::physics_step(1.0 / 60.0); }
    // 0.5 rad about Y: column 2 picks up sin(0.5) ~= 0.479 in m[8].
    testing::check(abs(g3::node(kspin_node).local_matrix.m[8] - 0.4794) < 0.01,
                   "kinematic angvel rotates a matrix-driven node");

    // Iterative solve: a box dropped on a static slab settles onto it and
    // stays — no sink, no bounce, and it falls asleep. A two-box stack
    // keeps both boxes resting at their contact heights.
    g3::physics_clear();
    g3::physics_set_gravity(float3 { 0.0, -9.81, 0.0 });
    let sfloor_node = g3::node_add(unit_mesh);
    g3::node(sfloor_node).pos = float3 { 0.0, -0.5, 0.0 };
    g3::physics_body_add(sfloor_node, float3 { 5.0, 0.5, 5.0 }, 0.0);
    let drop_node = g3::node_add(unit_mesh);
    g3::node(drop_node).pos = float3 { 0.0, 3.0, 0.0 };
    let drop = g3::physics_body_add(drop_node, float3 { 0.5, 0.5, 0.5 }, 1.0);
    for i in 300 { g3::physics_step(1.0 / 60.0); }
    let settled = g3::physics_body(drop);
    testing::check(abs(settled.position.y - 0.5) < 0.02 &&
                   abs(settled.position.x) < 0.05 && abs(settled.position.z) < 0.05 &&
                   length(settled.velocity) < 0.05,
                   "dropped box settles on the slab and sleeps");
    // Stack a second box on the first: both rest at y = 0.5 and 1.5.
    let stack_node = g3::node_add(unit_mesh);
    g3::node(stack_node).pos = float3 { 0.0, 4.0, 0.0 };
    let stack = g3::physics_body_add(stack_node, float3 { 0.5, 0.5, 0.5 }, 1.0);
    for i in 300 { g3::physics_step(1.0 / 60.0); }
    testing::check(abs(g3::physics_body(stack).position.y - 1.5) < 0.03 &&
                   abs(g3::physics_body(drop).position.y - 0.5) < 0.03,
                   "two-box stack rests at contact heights");
    // Sleeping contacts persist: both resting pairs still report their
    // overlap once the bodies sleep, one record per pair — records from
    // earlier substeps must not duplicate within the step.
    var pairs: i64[>..] = [];
    for i in 0..g3::physics_contact_count() {
        let c = g3::physics_contact(i);
        pairs.push(min(c.a, c.b) * 65536 + max(c.a, c.b));
    }
    var unique_pairs: i64 = 0;
    for i in 0..pairs.len {
        var seen = false;
        for j in 0..i { if pairs[j] == pairs[i] { seen = true; } }
        if !seen { unique_pairs += 1; }
    }
    testing::check(g3::physics_contact_count() == 2 && unique_pairs == 2,
                   "sleeping contacts persist without duplicates");
    g3::physics_clear();

    g3::rapier_set_timestep(1.0 / 60.0);
    g3::physics_clear();
    g3::shutdown();
    if !testing::finish() { exit(1); }
}
