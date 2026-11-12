// Meshes: the geometry arena and the primitives.
//
// A goose program has no heap, so the engine keeps its geometry in two
// grow-only global arrays — all vertices, and all indices into them — and a
// small array of records that say where each mesh's run lies inside them.
// Growth adopts a pointer bump, so an id stays valid for the program's life,
// and a `Mesh` is 8 fields of numbers: culling needs its bounds, nothing
// else needs the geometry on this side once it is uploaded.
//
// A mesh id is an `i32` because it is a backend handle. `-1` means "no mesh"
// and is what a group node (a node with children and nothing to draw) uses.
// Ordinary mesh ids are permanent; asset-owned ids and their spans may be
// reused after their owner releases them.

import vec;
import math;
import g3.math;
import g3.platform;

namespace g3;

struct Mesh {
    id: i32,
    first_vertex: i64, vertex_count: i64,
    first_index: i64, index_count: i64,
    bounds: Aabb,           // local space, for frustum culling
    vertex_capacity: i64, index_capacity: i64,
    asset_owned: bool,
    asset_free: bool,
}

var g_verts: Vertex[>..];
var g_indices: u32[>..];
var g_meshes: Mesh[>..];

fn mesh_count() -> i64 { g_meshes.len }

fn mesh(id: i32) -> Mesh& { return g_meshes[id] }

fn push_vertex(p: float3, n: float3) {
    push_vertex_uv(p, n, float2 { 0.0, 0.0 });
}

fn push_vertex_uv(p: float3, n: float3, uv: float2) {
    g_verts.push(Vertex { pos: p, normal: n, uv: uv });
}

fn push_triangle(a: u32, b: u32, c: u32) {
    g_indices.push(a);
    g_indices.push(b);
    g_indices.push(c);
}

// Emit the two triangles of every cell of a grid whose vertices were pushed
// row by row, `stride` vertices per row. `flip` chooses which way the faces
// wind, which is what makes a plane face up and a sphere face out.
fn push_grid(rows: i64, cols: i64, stride: i64, flip: bool) {
    for r in 0..rows {
        for c in 0..cols {
            let a = (r * stride + c) as u32;
            let b = (r * stride + c + 1) as u32;
            let c2 = ((r + 1) * stride + c + 1) as u32;
            let d = ((r + 1) * stride + c) as u32;
            if flip {
                push_triangle(a, c2, b);
                push_triangle(a, d, c2);
            } else {
                push_triangle(a, b, c2);
                push_triangle(a, c2, d);
            }
        }
    }
}

// Close the mesh that started at vertex `fv` and index `fi`: measure its
// bounds, record it, and upload it. The vertex positions are only read here,
// so a mesh costs nothing on the Goose side afterwards.
fn mesh_close(fv: i64, fi: i64) -> i32 {
    var b = aabb_empty();
    for i in fv..g_verts.len { aabb_add(b, g_verts[i].pos); }
    let id = g_meshes.len as i32;
    g_meshes.push(Mesh { id: id, first_vertex: fv, vertex_count: g_verts.len - fv,
                         first_index: fi, index_count: g_indices.len - fi, bounds: b,
                         vertex_capacity: g_verts.len - fv, index_capacity: g_indices.len - fi, .. });
    g3p_upload_mesh(id, g_verts[fv..], g_indices[fi..]);
    return id;
}

// Asset meshes retain CPU geometry for picking. Reuse a released allocation
// only when both of its spans fit; ordinary mesh handles remain permanent.
fn mesh_asset_create(verts: const Vertex[:], indices: const u32[:]) -> i32 {
    var bounds = aabb_empty();
    for v in verts { aabb_add(bounds, v.pos); }
    for i in 0..g_meshes.len {
        let m .= g_meshes[i];
        if m.asset_owned && m.asset_free && m.vertex_capacity >= verts.len && m.index_capacity >= indices.len {
            for j in 0..verts.len { g_verts[m.first_vertex + j] = verts[j]; }
            for j in 0..indices.len { g_indices[m.first_index + j] = indices[j]; }
            m.vertex_count = verts.len;
            m.index_count = indices.len;
            m.bounds = bounds;
            m.asset_free = false;
            g3p_upload_mesh(m.id, g_verts[m.first_vertex..m.first_vertex + m.vertex_count],
                            g_indices[m.first_index..m.first_index + m.index_count]);
            return m.id;
        }
    }
    let fv = g_verts.len;
    let fi = g_indices.len;
    for v in verts { g_verts.push(v); }
    for i in indices { g_indices.push(i); }
    let id = mesh_close(fv, fi);
    g_meshes[id].asset_owned = true;
    return id;
}

fn mesh_asset_release(id: i32) {
    guard id >= 0 && id < g_meshes.len else { return; }
    let m .= g_meshes[id];
    if m.asset_owned { m.asset_free = true; }
}

// A cube of the given half extent, 4 corners and 2 triangles per face, with
// flat per-face normals, counterclockwise seen from outside.
fn mesh_cube(half: f32) -> i32 {
    let fv = g_verts.len;
    let fi = g_indices.len;
    let axes: float3[3] = [float3 { 1.0, 0.0, 0.0 }, float3 { 0.0, 1.0, 0.0 },
                           float3 { 0.0, 0.0, 1.0 }];
    let corners: float2[4] = [float2 { -1.0, -1.0 }, float2 { 1.0, -1.0 },
                              float2 { 1.0, 1.0 }, float2 { -1.0, 1.0 }];
    for f in 6 {
        // A face's normal, and two directions along it whose cross product is
        // that normal.
        let sign: f32 = if f % 2 == 0 { 1.0 } else { -1.0 };
        let n = axes[f / 2] * float3 { sign, sign, sign };
        let u = axes[(f / 2 + 1) % 3] * float3 { sign, sign, sign };
        let v = cross(n, u);
        let base = (g_verts.len - fv) as u32;
        for c in corners {
            let p = n + u * float3 { c.x, c.x, c.x } + v * float3 { c.y, c.y, c.y };
            push_vertex_uv(p * half, n, float2 { (c.x + 1.0) * 0.5, (c.y + 1.0) * 0.5 });
        }
        push_triangle(base, base + 1, base + 2);
        push_triangle(base, base + 2, base + 3);
    }
    return mesh_close(fv, fi);
}

// A ball: `rings` bands from pole to pole, `segments` around, smooth normals.
// The poles end up with a whole fan of coincident vertices, which is one
// triangle fan's worth of waste and no work to avoid.
fn mesh_sphere(radius: f32, rings: i64, segments: i64) -> i32 {
    let fv = g_verts.len;
    let fi = g_indices.len;
    for r in 0..rings + 1 {
        let phi = (r as f32 / rings) * PI;
        for s in 0..segments + 1 {
            let theta = (s as f32 / segments) * TAU;
            let n = float3 { sin(phi) * cos(theta), cos(phi), sin(phi) * sin(theta) };
            push_vertex_uv(n * radius, n, float2 { s as f32 / segments, r as f32 / rings });
        }
    }
    push_grid(rings, segments, segments + 1, false);
    return mesh_close(fv, fi);
}

// A plane on the ground (x and z), `tiles` quads on a side, facing up. With
// tiles = 1 this is a single quad; more lets a per-vertex lighting model show
// up on it, and gives the fog something to do along its length.
fn mesh_plane(size: f32, tiles: i64) -> i32 {
    let fv = g_verts.len;
    let fi = g_indices.len;
    let half = size * 0.5;
    let n = float3 { 0.0, 1.0, 0.0 };
    for t in 0..tiles + 1 {
        let z = -half + size * (t as f32 / tiles);
        for s in 0..tiles + 1 {
            let x = -half + size * (s as f32 / tiles);
            push_vertex_uv(float3 { x, 0.0, z }, n, float2 { s as f32 / tiles, t as f32 / tiles });
        }
    }
    // Seen from above these must wind counterclockwise; the flipped order
    // faces down and would be culled.
    push_grid(tiles, tiles, tiles + 1, true);
    return mesh_close(fv, fi);
}
