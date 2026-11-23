import std;
import vec;
import g3.scene;
import g3.physics;

extern "gs_os_clock_ns" fn clock_ns() -> i64;

fn main() {
    // 20x20 grid of dynamic spheres spaced 2 units apart — mostly separated.
    for y in 0..20 {
        for x in 0..20 {
            let n = g3::node_add(-1);
            g3::node(n).pos = float3 { x * 2.0, y * 2.0, 0.0 };
            g3::physics_body_add_sphere(n, 0.4, 1.0);
        }
    }
    // A few static boxes scattered far away.
    for i in 0..10 {
        let n = g3::node_add(-1);
        g3::node(n).pos = float3 { i * 50.0, -100.0, 0.0 };
        g3::physics_body_add(n, float3 { 1.0, 1.0, 1.0 }, 0.0);
    }
    g3::physics_set_gravity(float3_0);
    let t0 = clock_ns();
    for i in 0..600 { g3::physics_step(1.0 / 60.0); }
    let t1 = clock_ns();
    print("600 steps, 410 bodies: ", (t1 - t0) as f64 / 1.0e6, " ms");
}
