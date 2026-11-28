// Ray picking against retained mesh geometry. Handles refer to live scene
// nodes; asset-owned handles become invalid when their asset is disposed.
import vec;
import math;
import g3.math;
import g3.mesh;
import g3.scene;
import g3.collision;

namespace g3;

struct RayHit {
    node: i64 = -1,
    distance: f32,
    point: float3,
    triangle: i64 = -1,
    // Barycentric coordinates of the hit inside its triangle: the hit point
    // is a + u*(b-a) + v*(c-a). Useful for UV lookup and decals.
    u: f32 = 0.0,
    v: f32 = 0.0,
}

var g_raycast_all: RayHit[>..];

// Möller–Trumbore with the same CCW front-face culling as the renderer.
// Returns negative for a miss, otherwise distance along the normalized ray.
fn ray_triangle(origin: float3, dir: float3, a: float3, b: float3, c: float3) -> f32 {
    let t, _u, _v = ray_triangle_bary(origin, dir, a, b, c);
    return t;
}

// ray_triangle plus the barycentric coordinates. On a miss all three
// returns are negative.
fn ray_triangle_bary(origin: float3, dir: float3, a: float3, b: float3, c: float3) -> f32, f32, f32 {
    let e1 = b - a;
    let e2 = c - a;
    let p = cross(dir, e2);
    let det = dot(e1, p);
    if det <= 0.0000001 { return -1.0, -1.0, -1.0; }
    let inv = 1.0 / det;
    let s = origin - a;
    let u = dot(s, p) * inv;
    if u < 0.0 || u > 1.0 { return -1.0, -1.0, -1.0; }
    let q = cross(s, e1);
    let v = dot(dir, q) * inv;
    if v < 0.0 || u + v > 1.0 { return -1.0, -1.0, -1.0; }
    let t = dot(e2, q) * inv;
    if t < 0.0 { return -1.0, -1.0, -1.0; }
    return t, u, v;
}

// World-space bounds of a node's mesh, or an empty box when the node has
// nothing raycastable. Used to reject whole nodes before the triangle loop.
fn raycast_node_bounds(id: i64) -> Aabb {
    let n .= g_nodes[id];
    if n.mesh < 0 || n.mesh >= g_meshes.len { return aabb_empty(); }
    let m .= g_meshes[n.mesh];
    if m.index_count == 0 || aabb_is_empty(m.bounds) { return aabb_empty(); }
    return aabb_transform_affine(m.bounds, n.world);
}

// Scan one node's triangles, appending every hit in [near, far] to `hits`.
// The node's world AABB rejects the mesh before any vertex is touched.
fn raycast_node_all(origin: float3, dir: float3, near: f32, far: f32, id: i64, hits: RayHit[>..]&) {
    let n .= g_nodes[id];
    if !n.visible || n.mesh < 0 || n.mesh >= g_meshes.len || !mesh_handle_valid(mesh_handle(n.mesh)) { return; }
    let m .= g_meshes[n.mesh];
    if m.asset_free { return; }
    let wb = raycast_node_bounds(id);
    if aabb_is_empty(wb) { return; }
    if !segment_aabb_intersects(origin, origin + dir * far, wb) { return; }
    var i: i64 = 0;
    while i + 2 < m.index_count {
        let a = g_indices[m.first_index + i] as i64;
        let b = g_indices[m.first_index + i + 1] as i64;
        let c = g_indices[m.first_index + i + 2] as i64;
        if a < m.vertex_count && b < m.vertex_count && c < m.vertex_count {
            let pa = mat4_apply(n.world, g_verts[m.first_vertex + a].pos);
            let pb = mat4_apply(n.world, g_verts[m.first_vertex + b].pos);
            let pc = mat4_apply(n.world, g_verts[m.first_vertex + c].pos);
            let t, u, v = ray_triangle_bary(origin, dir, pa, pb, pc);
            if t >= near && t <= far {
                hits.push(RayHit { node: id, distance: t, point: origin + dir * t,
                                  triangle: i / 3, u: u, v: v });
            }
        }
        i += 3;
    }
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
        if !n.visible || n.mesh < 0 || n.mesh >= g_meshes.len || !mesh_handle_valid(mesh_handle(n.mesh)) { continue; }
        let m .= g_meshes[n.mesh];
        if m.asset_free { continue; }
        var wb = aabb_empty();
        if !aabb_is_empty(m.bounds) { wb = aabb_transform_affine(m.bounds, n.world); }
        if aabb_is_empty(wb) || !segment_aabb_intersects(origin, origin + dir * best, wb) { continue; }
        var i: i64 = 0;
        while i + 2 < m.index_count {
            let a = g_indices[m.first_index + i] as i64;
            let b = g_indices[m.first_index + i + 1] as i64;
            let c = g_indices[m.first_index + i + 2] as i64;
            if a < m.vertex_count && b < m.vertex_count && c < m.vertex_count {
                let pa = mat4_apply(n.world, g_verts[m.first_vertex + a].pos);
                let pb = mat4_apply(n.world, g_verts[m.first_vertex + b].pos);
                let pc = mat4_apply(n.world, g_verts[m.first_vertex + c].pos);
                let t, u, v = ray_triangle_bary(origin, dir, pa, pb, pc);
                if t >= near && t <= best {
                    best = t;
                    hit = RayHit { node: id, distance: t, point: origin + dir * t,
                                   triangle: i / 3, u: u, v: v };
                }
            }
            i += 3;
        }
    }
    return hit;
}

// Every triangle hit along the ray, nearest first. Costs one triangle test
// per surface the ray crosses — use raycast when only the nearest matters.
fn raycast_all(origin: float3, direction: float3, near: f32, far: f32) -> i64 {
    g_raycast_all.clear();
    let magnitude = length(direction);
    guard magnitude > 0.0000001 && near >= 0.0 && far >= near else { return 0; }
    let dir = direction / magnitude;
    node_update_worlds();
    for id in 0..g_nodes.len {
        raycast_node_all(origin, dir, near, far, id, g_raycast_all);
    }
    // Insertion sort by distance; hit counts are small in practice.
    for i in 1..g_raycast_all.len {
        let h = g_raycast_all[i];
        var j = i;
        while j > 0 && g_raycast_all[j - 1].distance > h.distance {
            g_raycast_all[j] = g_raycast_all[j - 1];
            j -= 1;
        }
        g_raycast_all[j] = h;
    }
    return g_raycast_all.len;
}

fn raycast_all_count() -> i64 { return g_raycast_all.len }

fn raycast_all_hit(id: i64) -> RayHit& { return g_raycast_all[id] }

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
    let camera_aspect = if cam.aspect > 0.0 { cam.aspect } else { aspect };
    if cam.orthographic {
        guard cam.ortho_height > 0.0 else { return RayHit { .. }; }
        let half = cam.ortho_height * 0.5;
        let origin = cam.pos + right * (x * camera_aspect * half) + up * (y * half);
        return raycast(origin, forward, cam.near, cam.far);
    }
    let half = tan(cam.fov * 0.5);
    let direction = normalize(forward + right * (x * camera_aspect * half) + up * (y * half));
    let depth = dot(direction, forward);
    guard depth > 0.0 else { return RayHit { .. }; }
    return raycast(cam.pos, direction, cam.near / depth, cam.far / depth);
}
