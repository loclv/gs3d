// Beacon Run: collect all eight lights while avoiding the red sentinel.
import vec;
import math;
import g3.mesh;
import g3.scene;
import g3.render;
import g3.engine;
import g3.texture;

namespace game;

let BEACON_COUNT = 8;
let PLAYING = 0;
let WON = 1;
let CAUGHT = 2;

var player: i64;
var sentinel: i64;
var beacons: i64[BEACON_COUNT];
var score: i32;
var state: i32;
var elapsed: f32;
var floor_texture: i32;

fn reset() {
    score = 0;
    state = PLAYING;
    elapsed = 0.0;
    g3::node(player).pos = float3 { 0.0, 0.55, 4.5 };
    g3::node(sentinel).pos = float3 { 0.0, 0.65, -3.0 };
    for i in BEACON_COUNT { g3::node(beacons[i]).visible = true; }
}

fn build() {
    let cube = g3::mesh_cube(1.0);
    let ball = g3::mesh_sphere(0.5, 12, 16);
    let floor .= g3::node(g3::node_add(cube));
    floor.scale = float3 { 6.5, 0.15, 6.5 };
    floor.pos.y = -0.15;
    // A neutral placeholder keeps the arena playable if image decoding fails.
    let pixel: u8[4] = [180, 180, 180, 255];
    floor_texture = g3::texture_create(1, 1, pixel[..]);
    floor.texture = floor_texture;
    floor.color = float4 { 0.7, 0.85, 0.85, 1.0 };
    for i in 4 {
        let wall .= g3::node(g3::node_add(cube));
        if i < 2 {
            wall.pos = float3 { if i == 0 { -6.5 } else { 6.5 }, 0.35, 0.0 };
            wall.scale = float3 { 0.12, 0.35, 6.5 };
        } else {
            wall.pos = float3 { 0.0, 0.35, if i == 2 { -6.5 } else { 6.5 } };
            wall.scale = float3 { 6.5, 0.35, 0.12 };
        }
        wall.color = float4 { 0.22, 0.48, 0.5, 1.0 };
    }
    player = g3::node_add(cube);
    let p .= g3::node(player);
    p.scale = float3 { 0.42, 0.55, 0.42 };
    p.color = float4 { 0.3, 0.85, 0.95, 1.0 };
    sentinel = g3::node_add(ball);
    let s .= g3::node(sentinel);
    s.scale = float3 { 1.3, 1.3, 1.3 };
    s.color = float4 { 1.0, 0.22, 0.2, 1.0 };
    for i in BEACON_COUNT {
        beacons[i] = g3::node_add(ball);
        let b .= g3::node(beacons[i]);
        let a = i as f32 * TAU / BEACON_COUNT;
        b.pos = float3 { cos(a) * 4.2, 0.55, sin(a) * 4.2 };
        b.scale = float3 { 0.65, 0.65, 0.65 };
        b.color = float4 { 1.0, 0.78, 0.25, 1.0 };
        b.unlit = true;
    }
    g3::set_background(float4 { 0.035, 0.07, 0.1, 1.0 });
    g3::set_fog(float3 { 0.035, 0.07, 0.1 }, 0.0);
    g3::camera_look_at(float3 { 0.0, 14.0, 13.5 }, float3 { 0.0, 0.0, 0.0 });
    reset();
}

// Movement is in arena coordinates, independent of the camera.
fn move_player(dt: f32) {
    var direction = float3_0;
    if g3::key_down(g3::KEY_W) || g3::key_down(g3::KEY_UP) { direction.z -= 1.0; }
    if g3::key_down(g3::KEY_S) || g3::key_down(g3::KEY_DOWN) { direction.z += 1.0; }
    if g3::key_down(g3::KEY_A) || g3::key_down(g3::KEY_LEFT) { direction.x -= 1.0; }
    if g3::key_down(g3::KEY_D) || g3::key_down(g3::KEY_RIGHT) { direction.x += 1.0; }
    let p .= g3::node(player);
    if length(direction) > 0.0 { p.pos += normalize(direction) * (4.0 * dt); }
    p.pos.x = max(-5.9, min(5.9, p.pos.x));
    p.pos.z = max(-5.9, min(5.9, p.pos.z));
}

fn move_sentinel(dt: f32) {
    let p .= g3::node(player);
    let s .= g3::node(sentinel);
    let chase = float3 { p.pos.x - s.pos.x, 0.0, p.pos.z - s.pos.z };
    let distance = length(chase);
    if distance < 0.9 { state = CAUGHT; return; }
    s.pos += normalize(chase) * min(distance, (1.8 + min(elapsed * 0.025, 1.2)) * dt);
}

fn update_beacons() {
    let p .= g3::node(player);
    for i in BEACON_COUNT {
        let b .= g3::node(beacons[i]);
        if b.visible {
            b.pos.y = 0.55 + sin(elapsed * 3.0 + i) * 0.12;
            let delta = float3 { p.pos.x - b.pos.x, 0.0, p.pos.z - b.pos.z };
            if length(delta) < 0.8 { b.visible = false; score += 1; }
        }
    }
    if score == BEACON_COUNT { state = WON; }
}

fn update(dt: f32) {
    if state != PLAYING { return; }
    elapsed += dt;
    move_player(dt);
    move_sentinel(dt);
    if state == CAUGHT { return; }
    update_beacons();
}
