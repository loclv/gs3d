import std;
import vec;
import g3.scene;
import g3.physics;

extern "gs_os_clock_ns" fn clock_ns() -> i64;

fn main() {
    // Static floor plus a 10x10 grid of dynamic boxes stacked 10 high —
    // every box rests on the floor or another box, so the solver sees
    // hundreds of contact-manifold points per substep while the pile is
    // active. Slender towers do topple under this solver, which keeps the
    // benchmark in the expensive regime on purpose.
    let floor_node = g3::node_add(-1);
    g3::node(floor_node).pos = float3 { 0.0, -0.5, 0.0 };
    g3::physics_body_add(floor_node, float3 { 20.0, 0.5, 20.0 }, 0.0);
    for y in 0..10 {
        for x in 0..10 {
            let n = g3::node_add(-1);
            g3::node(n).pos = float3 { x * 1.3, 1.0 + y * 1.1, 0.0 };
            g3::physics_body_add(n, float3 { 0.5, 0.5, 0.5 }, 1.0);
        }
    }
    // Let the pile land and partially settle, then report how many bodies
    // managed to sleep — the sleep fast path is the biggest perf lever.
    for i in 120 { g3::physics_step(1.0 / 60.0); }
    var asleep: i64 = 0;
    var max_v: f32 = 0.0;
    for i in 0..g3::physics_body_count() {
        let b = g3::physics_body(i);
        if b.sleeping { asleep += 1; }
        max_v = max(max_v, length(b.velocity));
    }
    print("after settle: ", asleep, " / ", g3::physics_body_count(),
          " asleep, max_v=", max_v, "\n");
    let t0 = clock_ns();
    for i in 600 { g3::physics_step(1.0 / 60.0); }
    let t1 = clock_ns();
    print("600 steps, 101 bodies contact pile: ", (t1 - t0) as f64 / 1.0e6, " ms");
}
