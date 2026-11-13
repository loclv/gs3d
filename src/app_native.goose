// The headless entry point: the same scene, drawn by the CPU backend, and
// written to a PPM. This is how the engine is tested without a browser, and
// how it can render stills from a script.
//
//   goose build --standalone src/app_native.goose   (see build_native.sh)
//   ./app_native --frames 12 --out frame.ppm --width 960 --height 600
//   ./app_native --glb web/viewer/sample.glb --out native-model.ppm
//
// The sidecar `app_native.build` compiles platform/g3_soft.c into the program;
// that file is the rasterizer behind the `g3p_*` symbols.

import std;
import vec;
import math;
import os;
import g3.math;
import g3.platform;
import g3.mesh;
import g3.scene;
import g3.render;
import g3.engine;
import g3.gltf_native;
import demo.scene;

// A numeric option, or the value it already had.
fn to_i32(text: const u8[:], fallback: i32) -> i32 {
    let n, ok = parse_int(text);
    if ok { return n as i32; }
    return fallback;
}

fn main() {
    let argv = args();
    var frames: i64 = 2;
    var width: i32 = 960;
    var height: i32 = 600;
    var out_path: u8[>..] = [];
    out_path.append("g3_frame.ppm");
    var glb_path: u8[>..] = [];

    var i = 1;
    while i + 1 < argv.len {
        let key = argv[i];
        let value = argv[i + 1];
        if key == "--frames" {
            frames = to_i32(value, frames as i32);
        } else if key == "--width" {
            width = to_i32(value, width);
        } else if key == "--height" {
            height = to_i32(value, height);
        } else if key == "--out" {
            out_path.clear();
            out_path.append(value);
        } else if key == "--glb" {
            glb_path.clear();
            glb_path.append(value);
        } else {
            print("unknown option: ", key);
            return;
        }
        i += 2;
    }

    guard g3::init(width, height, "Goose 3D engine (software)") else {
        print("g3: no surface");
        return;
    }
    var imported = g3::NativeGlbModel { .. };
    if glb_path.len > 0 {
        let model, ok = g3::native_glb_load_primitive(glb_path[..], 0, 0);
        guard ok else { print("could not load static GLB primitive 0/0 from ", glb_path); g3::shutdown(); return; }
        imported = model;
    } else {
        demo::build();
    }

    let dt = 1.0 / 60.0;
    for f in frames {
        if glb_path.len == 0 { demo::update(dt); }
        g3::frame(dt);
    }

    let s = g3::stats();
    print("mesh ", g3::mesh_count(), ", nodes ", g3::node_count(), ": drew ", s.drawn,
          " of ", s.nodes, " visible (", s.culled, " culled, ", s.triangles,
          " triangles, ", s.draws, " draw items)");
    print("camera at ", g3::camera().pos, " looking at ", g3::camera().target);
    let saved = g3::save_frame(out_path);
    print("wrote ", out_path, ": ", saved);
    if imported.mesh.id >= 0 { g3::native_glb_dispose(imported); }
    g3::shutdown();
}
