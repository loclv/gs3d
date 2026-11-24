import std;
import vec;
import g3.scene;
import g3.physics;

extern "gs_os_clock_ns" fn clock_ns() -> i64;

// Continuous rain of boxes onto a floor: keeps both engines in the
// active-contact regime (unlike a settling pile, nothing sleeps).
var live: i64[1024];
var live_n: i64 = 0;

fn spawn_box(i: i64) -> i64 {
    let n = g3::node_add(-1);
    // deterministic scatter, +/-8 units
    let hx = ((i * 2654435761) % 1600) / 100.0 - 8.0;
    let hz = ((i * 2246822519) % 1600) / 100.0 - 8.0;
    g3::node(n).pos = float3 { hx, 12.0 + (i % 5), hz };
    return g3::physics_body_add(n, float3 { 0.5, 0.5, 0.5 }, 1.0);
}

fn cull() {
    var w: i64 = 0;
    for i in 0..live_n {
        let id = live[i];
        let b = g3::physics_body(id);
        if b.removed { continue; }
        if g3::node(b.node.index).pos.y < 1.5 && length(b.velocity) < 1.0 {
            g3::physics_body_remove(id);
        } else {
            live[w] = id; w += 1;
        }
    }
    live_n = w;
}

fn step_with_spawn(var step_i: i64) -> i64 {
    if live_n < 1000 {
        live[live_n] = spawn_box(step_i); live_n += 1;
        step_i += 1;
    }
    g3::physics_step(1.0 / 60.0);
    cull();
    return step_i;
}

fn main() {
    let floor_node = g3::node_add(-1);
    g3::node(floor_node).pos = float3 { 0.0, -0.5, 0.0 };
    g3::physics_body_add(floor_node, float3 { 20.0, 0.5, 20.0 }, 0.0);

    var step_i: i64 = 0;
    // warmup: fill the air and let the first boxes land
    for i in 0..180 { step_i = step_with_spawn(step_i); }
    let t0 = clock_ns();
    for i in 0..600 { step_i = step_with_spawn(step_i); }
    let t1 = clock_ns();
    print("600 steps rain, ", live_n, " live bodies: ",
          (t1 - t0) as f64 / 1.0e6, " ms");
}
