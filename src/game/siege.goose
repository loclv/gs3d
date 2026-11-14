// Fixed-step combat, bounded reusable node pools, shared by both backends.
import vec;
import math;
import g3.mesh;
import g3.scene;
import g3.render;
import g3.engine;
import g3.collision;
namespace siege;
struct Enemy { node: i64, hp: i32, cooldown: f32, ranged: bool }
struct Shot { node: i64, velocity: float3, life: f32, hostile: bool }
var enemies: Enemy[32];
var shots: Shot[128];
var pillars: i64[4];
var player: i64;
var gun: i64;
var wave: i32;
var health: i32;
var score: i32;
var state: i32;
var alive: i32;
var cooldown: f32;
var dash_cooldown: f32;
var dash_time: f32;
var immunity: f32;
var intermission: f32;
var accumulator: f32;
var aim: float3;
var dash_direction: float3;

fn object(mesh: i32, pos: float3, scale: float3, color: float4, unlit: bool) -> i64 {
    let id = g3::node_add(mesh);
    let n .= g3::node(id);
    n.pos = pos; n.scale = scale; n.color = color; n.unlit = unlit;
    return id;
}
fn spawn_wave() {
    wave += 1; alive = 4 + wave * 4; health = min(5, health + 1);
    for i in 32 {
        let e .= enemies[i];
        e.hp = if i < alive { if wave >= 4 { 2 } else { 1 } } else { 0 };
        e.ranged = wave >= 2 && i % 3 == 0;
        e.cooldown = 0.8 + i * 0.09;
        let n .= g3::node(e.node); n.visible = e.hp > 0;
        let angle = i as f32 * TAU / alive;
        n.pos = float3 { cos(angle) * 10.0, 0.65, sin(angle) * 10.0 };
        n.color = if e.ranged { float4 { 0.9, 0.35, 1.0, 1.0 } } else { float4 { 1.0, 0.22, 0.12, 1.0 } };
    }
}
fn reset() {
    wave = 0; health = 5; score = 0; state = 0;
    cooldown = 0.0; dash_cooldown = 0.0; dash_time = 0.0; immunity = 1.5;
    intermission = 0.0; accumulator = 0.0;
    aim = float3 { 0.0, 0.0, -1.0 }; dash_direction = aim;
    g3::node(player).pos = float3 { 0.0, 0.65, 0.0 };
    for &s in shots { s.life = 0.0; g3::node(s.node).visible = false; }
    spawn_wave();
}
fn build() {
    let cube = g3::mesh_cube(1.0);
    let ball = g3::mesh_sphere(1.0, 8, 12);
    object(cube, float3 { 0.0, -0.3, 0.0 }, float3 { 12.0, 0.3, 12.0 }, float4 { 0.045, 0.085, 0.13, 1.0 }, false);
    for i in 25 {
        let p = i as f32 - 12.0;
        object(cube, float3 { p, 0.015, 0.0 }, float3 { 0.012, 0.012, 12.0 }, float4 { 0.08, 0.22, 0.3, 1.0 }, true);
        object(cube, float3 { 0.0, 0.015, p }, float3 { 12.0, 0.012, 0.012 }, float4 { 0.08, 0.22, 0.3, 1.0 }, true);
    }
    for i in 4 {
        let a = i as f32 * TAU / 4.0 + PI / 4.0;
        let pos = float3 { cos(a) * 5.0, 0.65, sin(a) * 5.0 };
        pillars[i] = object(ball, pos, float3 { 0.95, 1.4, 0.95 }, float4 { 0.15, 0.27, 0.38, 1.0 }, false);
        object(ball, pos + float3 { 0.0, 1.2, 0.0 }, float3 { 0.75, 0.12, 0.75 }, float4 { 0.15, 0.9, 1.0, 1.0 }, true);
    }
    player = object(ball, float3_0, float3 { 0.45, 0.45, 0.45 }, float4 { 0.15, 0.9, 1.0, 1.0 }, false);
    gun = object(cube, float3_0, float3 { 0.13, 0.14, 0.5 }, float4 { 0.8, 1.0, 1.0, 1.0 }, true);
    for &e in enemies { e.node = object(cube, float3_0, float3 { 0.45, 0.6, 0.45 }, float4_1, false); }
    for &s in shots { s.node = object(ball, float3_0, float3 { 0.14, 0.14, 0.14 }, float4_1, true); }
    g3::set_background(float4 { 0.012, 0.025, 0.05, 1.0 });
    g3::set_fog(float3 { 0.012, 0.025, 0.05 }, 0.0);
    reset();
}
fn shoot(pos: float3, direction: float3, hostile: bool) {
    for &s in shots {
        if s.life > 0.0 { continue; }
        s.life = 2.5; s.hostile = hostile;
        s.velocity = direction * (if hostile { 6.0 + wave * 0.5 } else { 24.0 });
        let n .= g3::node(s.node); n.pos = pos; n.visible = true;
        n.color = if hostile { float4 { 1.0, 0.3, 0.7, 1.0 } } else { float4 { 1.0, 0.85, 0.3, 1.0 } };
        return;
    }
}
fn damage() {
    if immunity > 0.0 || dash_time > 0.0 { return; }
    health -= 1; immunity = 1.0;
    if health <= 0 { state = 2; }
}
fn constrain(pos: float3) -> float3 {
    var p = pos;
    p.x = max(-11.0, min(11.0, p.x)); p.z = max(-11.0, min(11.0, p.z));
    for id in pillars {
        var d = p - g3::node(id).pos; d.y = 0.0;
        let distance = length(d);
        if distance < 1.4 {
            let normal = if distance > 0.00001 { d / distance } else { float3 { 1.0, 0.0, 0.0 } };
            p += normal * (1.4 - distance);
        }
    }
    return p;
}
fn tick(dt: f32) {
    cooldown -= dt; immunity -= dt; dash_cooldown -= dt; dash_time -= dt;
    var movement = float3_0; var facing = float3_0;
    if g3::key_down(g3::KEY_W) { movement.z -= 1.0; }
    if g3::key_down(g3::KEY_S) { movement.z += 1.0; }
    if g3::key_down(g3::KEY_A) { movement.x -= 1.0; }
    if g3::key_down(g3::KEY_D) { movement.x += 1.0; }
    if g3::key_down(g3::KEY_UP) { facing.z -= 1.0; }
    if g3::key_down(g3::KEY_DOWN) { facing.z += 1.0; }
    if g3::key_down(g3::KEY_LEFT) { facing.x -= 1.0; }
    if g3::key_down(g3::KEY_RIGHT) { facing.x += 1.0; }
    if length(facing) > 0.0 { aim = normalize(facing); }
    if length(movement) > 0.0 { movement = normalize(movement); }
    if g3::key_down(g3::KEY_SHIFT) && dash_cooldown <= 0.0 {
        dash_direction = if length(movement) > 0.0 { movement } else { aim };
        dash_time = 0.18; dash_cooldown = 1.8;
    }
    let p .= g3::node(player);
    p.pos = constrain(p.pos + (if dash_time > 0.0 { dash_direction * 18.0 } else { movement * 6.0 }) * dt);
    p.color = if immunity > 0.0 || dash_time > 0.0 { float4 { 0.85, 1.0, 1.0, 1.0 } } else { float4 { 0.1, 0.7, 0.95, 1.0 } };
    g3::node(gun).pos = p.pos + aim * 0.5;
    g3::node(gun).rot.y = atan2(aim.x, aim.z);
    if cooldown <= 0.0 && (length(facing) > 0.0 || g3::key_down(g3::KEY_SPACE)) {
        shoot(p.pos + aim * 0.7, aim, false); cooldown = 0.13;
    }
    for &e in enemies {
        if e.hp <= 0 { continue; }
        let n .= g3::node(e.node);
        let delta = p.pos - n.pos; let distance = length(delta);
        if distance > 0.001 {
            let direction = delta / distance;
            let speed = if e.ranged && distance < 6.0 { -0.7 } else { 1.2 + wave * 0.25 };
            n.pos = constrain(n.pos + direction * speed * dt); n.rot.y += dt * 1.5;
            e.cooldown -= dt;
            if e.ranged && e.cooldown <= 0.0 { shoot(n.pos, direction, true); e.cooldown = 2.4 - wave * 0.2; }
        }
        if distance < 1.0 { damage(); }
    }
    for &s in shots {
        if s.life <= 0.0 { continue; }
        let n .= g3::node(s.node);
        let start = n.pos; n.pos += s.velocity * dt; s.life -= dt;
        for id in pillars {
            if g3::segment_sphere_intersects(start, n.pos, g3::node(id).pos, 1.09) { s.life = 0.0; }
        }
        if s.life > 0.0 {
            if s.hostile {
                if g3::segment_sphere_intersects(start, n.pos, p.pos, 0.59) { damage(); s.life = 0.0; }
            } else {
                for &e in enemies {
                    if e.hp <= 0 { continue; }
                    if g3::segment_sphere_intersects(start, n.pos, g3::node(e.node).pos, 0.65) {
                        e.hp -= 1; s.life = 0.0;
                        if e.hp == 0 { g3::node(e.node).visible = false; alive -= 1; score += 100 * wave; }
                        break;
                    }
                }
            }
        }
        if abs(n.pos.x) > 12.0 || abs(n.pos.z) > 12.0 { s.life = 0.0; }
        n.visible = s.life > 0.0;
    }
    if state != 0 { return; }
    if alive == 0 {
        if wave == 5 { state = 1; return; }
        intermission += dt;
        if intermission >= 2.0 { intermission = 0.0; spawn_wave(); }
    }
}
fn update(dt: f32) {
    if dt >= 0.0 && state == 0 {
        accumulator += min(dt, 0.1);
        while accumulator >= 1.0 / 120.0 && state == 0 {
            tick(1.0 / 120.0); accumulator -= 1.0 / 120.0;
        }
    }
    let cam .= g3::camera(); cam.orthographic = true;
    cam.ortho_height = max(32.0, 30.0 / max(g3::aspect(), 0.1));
    g3::camera_look_at(float3 { 0.0, 26.0, 18.0 }, float3_0);
}
