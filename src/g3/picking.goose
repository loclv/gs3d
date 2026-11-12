// Ray picking against retained mesh geometry. Handles refer to live scene
// nodes; asset-owned handles become invalid when their asset is disposed.
import vec;
import math;
import g3.math;
import g3.mesh;
import g3.scene;

namespace g3;

struct RayHit {
    node: i64 = -1,
    distance: f32,
    point: float3,
    triangle: i64 = -1,
}

// Möller–Trumbore with the same CCW front-face culling as the renderer.
// Returns negative for a miss, otherwise distance along the normalized ray.
fn ray_triangle(origin: float3, dir: float3, a: float3, b: float3, c: float3) -> f32 {
    let e1 = b - a;
    let e2 = c - a;
    let p = cross(dir, e2);
    let det = dot(e1, p);
    if det <= 0.0000001 { return -1.0; }
    let inv = 1.0 / det;
    let s = origin - a;
    let u = dot(s, p) * inv;
    if u < 0.0 || u > 1.0 { return -1.0; }
    let q = cross(s, e1);
    let v = dot(dir, q) * inv;
    if v < 0.0 || u + v > 1.0 { return -1.0; }
    let t = dot(e2, q) * inv;
    if t < 0.0 { return -1.0; }
    return t;
}

// `near` and `far` are world distances along the ray. Nodes are tested in
// scene order, so the first encountered triangle wins exact-distance ties.
fn raycast(origin: float3, direction: float3, near: f32, far: f32) -> RayHit {
    var hit = RayHit { .. };
    let magnitude = length(direction);
    guard magnitude > 0.0000001 && near >= 0.0 && far >= near else { return hit; }
    let dir = direction / magnitude;
    var best = far;
    node_update_worlds();
    for id in 0..g_nodes.len {
        let n .= g_nodes[id];
        if !n.visible || n.mesh < 0 || n.mesh >= g_meshes.len { continue; }
        let m .= g_meshes[n.mesh];
        if m.asset_free { continue; }
        var i: i64 = 0;
        while i + 2 < m.index_count {
            let a = g_indices[m.first_index + i] as i64;
            let b = g_indices[m.first_index + i + 1] as i64;
            let c = g_indices[m.first_index + i + 2] as i64;
            if a < m.vertex_count && b < m.vertex_count && c < m.vertex_count {
                let pa = mat4_apply(n.world, g_verts[m.first_vertex + a].pos);
                let pb = mat4_apply(n.world, g_verts[m.first_vertex + b].pos);
                let pc = mat4_apply(n.world, g_verts[m.first_vertex + c].pos);
                let distance = ray_triangle(origin, dir, pa, pb, pc);
                if distance >= near && distance <= best && (hit.node < 0 || distance < best) {
                    best = distance;
                    hit = RayHit { node: id, distance: distance, point: origin + dir * distance, triangle: i / 3 };
                }
            }
            i += 3;
        }
    }
    return hit;
}

// Camera ray for NDC coordinates, x/y in [-1,1] (y up).
// Match mat4_look_at's fallbacks for degenerate camera directions.
fn pick_screen(x: f32, y: f32, aspect: f32) -> RayHit {
    guard x >= -1.0 && x <= 1.0 && y >= -1.0 && y <= 1.0 && aspect > 0.0 else { return RayHit { .. }; }
    let cam = camera();
    var forward = cam.target - cam.pos;
    if length(forward) > 0.000001 { forward = normalize(forward); }
    else { forward = float3 { 0.0, 0.0, -1.0 }; }
    var right = cross(forward, cam.up);
    if length(right) > 0.000001 { right = normalize(right); }
    else { right = float3 { 1.0, 0.0, 0.0 }; }
    let up = cross(right, forward);
    if cam.orthographic {
        guard cam.ortho_height > 0.0 else { return RayHit { .. }; }
        let half = cam.ortho_height * 0.5;
        let origin = cam.pos + right * (x * aspect * half) + up * (y * half);
        return raycast(origin, forward, cam.near, cam.far);
    }
    let half = tan(cam.fov * 0.5);
    let direction = normalize(forward + right * (x * aspect * half) + up * (y * half));
    let depth = dot(direction, forward);
    guard depth > 0.0 else { return RayHit { .. }; }
    return raycast(cam.pos, direction, cam.near / depth, cam.far / depth);
}
