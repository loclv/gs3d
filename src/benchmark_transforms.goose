// Run: goose build -o build/benchmark_transforms src/benchmark_transforms.goose
//      ./build/benchmark_transforms
import std;
import os;
import vec;
import g3.math;

fn composed(t: float3, r: float3, s: float3) -> g3::Mat4 {
    return g3::mat4_mul(g3::mat4_translate(t),
        g3::mat4_mul(g3::mat4_rotate_euler(r), g3::mat4_scale(s)));
}

fn main() {
    let count = 200000;
    let t = float3 { 1.0, -2.0, 3.0 };
    let s = float3 { -1.5, 0.75, 2.0 };
    var max_error: f32 = 0.0;
    for i in 1000 {
        let angle: f32 = i * 0.013;
        let r = float3 { angle, -angle * 0.7, angle * 0.3 };
        let scale = float3 { if i % 3 == 0 { 0.0 } else { s.x },
            if i % 5 == 0 { -s.y } else { s.y }, s.z };
        let translation = float3 { angle, -2.0, angle * 3.0 };
        let a = composed(translation, r, scale);
        let b = g3::mat4_trs(translation, r, scale);
        for j in 16 { max_error = max(max_error, abs(a.m[j] - b.m[j])); }
    }
    print("max component error over 1000 rotations: ", max_error);
    if max_error > 1e-6 { exit(1); }
    for trial in 5 {
        var old_sum: f64 = 0.0;
        let start = clock();
        for i in count {
            let angle: f32 = i * 0.00013;
            let r = float3 { angle, -angle * 0.7, angle * 0.3 };
            let m = composed(t, r, s);
            old_sum += m.m[i % 12];
        }
        let middle = clock();
        var new_sum: f64 = 0.0;
        for i in count {
            let angle: f32 = i * 0.00013;
            let r = float3 { angle, -angle * 0.7, angle * 0.3 };
            let m = g3::mat4_trs(t, r, s);
            new_sum += m.m[i % 12];
        }
        let end = clock();
        print("trial ", trial, ": composed ms=", (middle - start) * 1000.0,
            ", direct ms=", (end - middle) * 1000.0,
            ", checksums=", old_sum, "/", new_sum);
    }
}
