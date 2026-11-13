// The browser entry point.
//
// This file has no `main`: it is built with `--standalone`, so the C host
// owns the process and the loop. `web/shell.js` creates the module, calls
// `g3_app_init` once the canvas has its size, then calls `g3_app_frame` from
// `requestAnimationFrame` until the tab closes.
//
// The engine reads input from the backend (see platform.goose), which on the
// web is fed by the same shell: keyboard and pointer events go to the C
// backend, and the frame's key state is sampled from there.
//
//   ./build_web.sh          → build/web/  (serve it over http, see README)

import std;
import vec;
import math;
import g3.math;
import g3.platform;
import g3.mesh;
import g3.scene;
import g3.render;
import g3.engine;
import demo.scene;
import g3.asset_web;

export fn g3_app_init(width: i32, height: i32) -> bool {
    guard g3::init(width, height, "Goose 3D engine") else { return false; }
    demo::build();
    return true;
}

export fn g3_app_frame(dt: f32) {
    demo::update(dt);
    g3::frame(dt);
}

export fn g3_app_shutdown() { g3::shutdown(); }

// What the shell's status line shows.
export fn g3_app_drawn() -> i32 { return g3::stats().drawn as i32 }
export fn g3_app_culled() -> i32 { return g3::stats().culled as i32 }
export fn g3_app_triangles() -> i32 { return g3::stats().triangles as i32 }
export fn g3_app_feedback_items_suppressed() -> i32 { return g3::stats().feedback_items_suppressed as i32 }
export fn g3_app_meshes() -> i32 { return g3::mesh_count() as i32 }
export fn g3_app_nodes() -> i32 { return g3::node_count() as i32 }
