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
// Mesh IDs are permanent for ordinary geometry; freed vertex/index spans are
// reusable by later ordinary or asset meshes. Asset-owned IDs may also recycle.

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
    bounds_version: i64 = 1, // increments when deformation changes local bounds
    vertex_capacity: i64, index_capacity: i64,
    asset_owned: bool,
    asset_free: bool,
    removed: bool,
    compact_mark: bool,
    generation: i32 = 1,
}

struct MeshHandle { id: i32 = -1, generation: i32 }

var g_verts: Vertex[>..];
var g_indices: u32[>..];
// Primitive and custom-mesh builders use scratch vectors so closing a mesh can
// allocate from reclaimed arena spans without retaining a second copy.
var g_build_verts: Vertex[>..];
var g_build_indices: u32[>..];
var g_meshes: Mesh[>..];

// Free ranges are tracked independently: a mesh's vertex and index spans
// need not have been released by the same asset. Empty entries are reusable.
struct FreeSpan { first: i64, count: i64, kind: i32 }
var g_free_spans: FreeSpan[>..];

fn span_release(first: i64, count: i64, kind: i32) {
    if count <= 0 { return; }
    var start = first;
    var size = count;
    // Restart after each merge because a newly extended range may touch a
    // range visited earlier. Existing live allocations are never moved.
    var merged = true;
    while merged {
        merged = false;
        for i in 0..g_free_spans.len {
            let s .= g_free_spans[i];
            if s.kind != kind || s.count == 0 { continue; }
            if s.first + s.count == start {
                start = s.first;
                size += s.count;
                s.count = 0;
                merged = true;
            } else if start + size == s.first {
                size += s.count;
                s.count = 0;
                merged = true;
            }
        }
    }
    for i in 0..g_free_spans.len {
        if g_free_spans[i].count == 0 {
            g_free_spans[i] = FreeSpan { first: start, count: size, kind: kind };
            return;
        }
    }
    g_free_spans.push(FreeSpan { first: start, count: size, kind: kind });
}

// Best-fit allocation splits a larger free span and retains its remainder.
fn span_take(count: i64, kind: i32) -> i64 {
    if count <= 0 { return -1; }
    var best: i64 = -1;
    for i in 0..g_free_spans.len {
        let s = g_free_spans[i];
        if s.kind == kind && s.count >= count && (best < 0 || s.count < g_free_spans[best].count) { best = i; }
    }
    if best < 0 { return -1; }
    let s .= g_free_spans[best];
    let first = s.first;
    s.first += count;
    s.count -= count;
    return first;
}

// A free span at the end can be extended instead of abandoned when a larger
// model follows a smaller one. Return its start and consume the free span.
fn span_take_tail(end: i64, kind: i32) -> i64 {
    for i in 0..g_free_spans.len {
        let s .= g_free_spans[i];
        if s.kind == kind && s.count > 0 && s.first + s.count == end {
            let first = s.first;
            s.count = 0;
            return first;
        }
    }
    return -1;
}

// Where `count` elements of `kind` should go: a reclaimed span, the tail span
// ending at `end`, or a fresh append at `end`. The caller grows the arena.
fn span_alloc_first(count: i64, kind: i32, end: i64) -> i64 {
    if count <= 0 { return end; }
    var first = span_take(count, kind);
    if first < 0 { first = span_take_tail(end, kind); }
    if first < 0 { first = end; }
    return first;
}

fn mesh_count() -> i64 { g_meshes.len }

fn mesh(id: i32) -> Mesh& { return g_meshes[id] }

fn mesh_handle(id: i32) -> MeshHandle {
    guard id >= 0 && id < g_meshes.len && !g_meshes[id].asset_free && !g_meshes[id].removed else { return MeshHandle { .. }; }
    return MeshHandle { id: id, generation: g_meshes[id].generation };
}

fn mesh_handle_valid(handle: MeshHandle) -> bool {
    return handle.id >= 0 && handle.id < g_meshes.len && !g_meshes[handle.id].asset_free && !g_meshes[handle.id].removed &&
           g_meshes[handle.id].generation == handle.generation;
}

fn push_vertex(p: float3, n: float3) {
    push_vertex_uv(p, n, float2 { 0.0, 0.0 });
}

fn push_vertex_uv(p: float3, n: float3, uv: float2) {
    g_build_verts.push(Vertex { pos: p, normal: n, uv: uv, tangent: float4_0, color: float4_1, .. });
}

fn push_vertex_uv_sets(p: float3, n: float3, uv: float2, uv1: float2) {
    g_build_verts.push(Vertex { pos: p, normal: n, uv: uv, uv1: uv1, uv2: float2_0, tangent: float4_0, color: float4_1, .. });
}

fn push_vertex_uv_3sets(p: float3, n: float3, uv: float2, uv1: float2, uv2: float2) {
    g_build_verts.push(Vertex { pos: p, normal: n, uv: uv, uv1: uv1, uv2: uv2, tangent: float4_0, color: float4_1, .. });
}

fn push_vertex_uv_6sets(p: float3, n: float3, uv: float2, uv1: float2, uv2: float2, uv3: float2, uv4: float2, uv5: float2) {
    g_build_verts.push(Vertex { pos: p, normal: n, uv: uv, uv1: uv1, uv2: uv2, uv3: uv3, uv4: uv4, uv5: uv5, tangent: float4_0, color: float4_1, .. });
}

fn push_vertex_uv_8sets(p: float3, n: float3, uv: float2, uv1: float2, uv2: float2, uv3: float2, uv4: float2, uv5: float2, uv6: float2, uv7: float2) {
    g_build_verts.push(Vertex { pos: p, normal: n, uv: uv, uv1: uv1, uv2: uv2, uv3: uv3, uv4: uv4, uv5: uv5, uv6: uv6, uv7: uv7, tangent: float4_0, color: float4_1 });
}

fn push_vertex_uv_tangent(p: float3, n: float3, uv: float2, tangent: float4) {
    g_build_verts.push(Vertex { pos: p, normal: n, uv: uv, tangent: tangent, color: float4_1, .. });
}

fn push_triangle(a: u32, b: u32, c: u32) {
    g_build_indices.push(a);
    g_build_indices.push(b);
    g_build_indices.push(c);
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

// Close the staged mesh: measure its bounds, allocate geometry spans, and
// upload it. The scratch vectors are cleared after the arena copy.
fn mesh_close(_fv: i64, _fi: i64) -> i32 {
    // Keep the original arguments for source compatibility. Builders now use
    // bounded scratch vectors and close the whole current batch at once.
    let fv: i64 = 0;
    let fi: i64 = 0;
    let vertex_count = g_build_verts.len - fv;
    let index_count = g_build_indices.len - fi;
    var b = aabb_empty();
    for i in fv..g_build_verts.len { aabb_add(b, g_build_verts[i].pos); }
    let first_vertex = span_alloc_first(vertex_count, 0, g_verts.len);
    while g_verts.len < first_vertex + vertex_count { g_verts.push(Vertex { .. }); }
    let first_index = span_alloc_first(index_count, 1, g_indices.len);
    while g_indices.len < first_index + index_count { g_indices.push(0); }
    for i in 0..vertex_count { g_verts[first_vertex + i] = g_build_verts[fv + i]; }
    for i in 0..index_count { g_indices[first_index + i] = g_build_indices[fi + i]; }
    let id = g_meshes.len as i32;
    g_meshes.push(Mesh { id: id, first_vertex: first_vertex, vertex_count: vertex_count,
                         first_index: first_index, index_count: index_count, bounds: b,
                         vertex_capacity: vertex_count, index_capacity: index_count, .. });
    g3p_upload_mesh(id, g_verts[first_vertex..first_vertex + vertex_count],
                    g_indices[first_index..first_index + index_count]);
    g_build_verts.clear();
    g_build_indices.clear();
    return id;
}

// Asset meshes retain CPU geometry for picking. Their released spans are
// independently reused and coalesced; ordinary mesh handles remain permanent.
fn mesh_asset_create(verts: const Vertex[:], indices: const u32[:]) -> i32 {
    guard verts.len > 0 && indices.len > 0 else { return -1; }
    var bounds = aabb_empty();
    for v in verts { aabb_add(bounds, v.pos); }
    let fv = span_alloc_first(verts.len, 0, g_verts.len);
    while g_verts.len < fv + verts.len { g_verts.push(Vertex { .. }); }
    let fi = span_alloc_first(indices.len, 1, g_indices.len);
    while g_indices.len < fi + indices.len { g_indices.push(0); }
    for j in 0..verts.len { g_verts[fv + j] = verts[j]; }
    for j in 0..indices.len { g_indices[fi + j] = indices[j]; }
    for i in 0..g_meshes.len {
        let m .= g_meshes[i];
        if m.asset_owned && m.asset_free && m.generation < 2147483647 {
            m.first_vertex = fv;
            m.first_index = fi;
            m.vertex_count = verts.len;
            m.index_count = indices.len;
            m.vertex_capacity = verts.len;
            m.index_capacity = indices.len;
            m.bounds = bounds;
            m.asset_free = false;
            m.generation += 1;
            g3p_upload_mesh(m.id, g_verts[fv..fv + verts.len], g_indices[fi..fi + indices.len]);
            return m.id;
        }
    }
    let id = g_meshes.len as i32;
    g_meshes.push(Mesh { id: id, first_vertex: fv, vertex_count: verts.len,
        first_index: fi, index_count: indices.len, bounds: bounds,
        vertex_capacity: verts.len, index_capacity: indices.len, asset_owned: true, .. });
    g3p_upload_mesh(id, g_verts[fv..fv + verts.len], g_indices[fi..fi + indices.len]);
    return id;
}

fn mesh_asset_release(id: i32) {
    guard id >= 0 && id < g_meshes.len else { return; }
    let m .= g_meshes[id];
    if m.asset_owned && !m.asset_free {
        span_release(m.first_vertex, m.vertex_capacity, 0);
        span_release(m.first_index, m.index_capacity, 1);
        g3p_release_mesh(id);
        m.asset_free = true;
    }
}

// Release CPU arena spans for a mesh that cannot be drawn or picked again.
fn mesh_remove_storage(id: i32) {
    guard id >= 0 && id < g_meshes.len else { return; }
    let m .= g_meshes[id];
    guard !m.asset_owned && !m.asset_free && !m.removed else { return; }
    span_release(m.first_vertex, m.vertex_capacity, 0);
    span_release(m.first_index, m.index_capacity, 1);
    g3p_release_mesh(id);
    m.removed = true;
}

// Pack every live geometry range toward index zero without changing mesh IDs.
// Renderers own copies, so re-upload each mesh after moving its arena data.
fn mesh_compact() {
    var vertex_cursor: i64 = 0;
    while true {
        var best: i64 = -1;
        for i in 0..g_meshes.len {
            let m = g_meshes[i];
            if m.asset_free || m.removed || m.compact_mark { continue; }
            if best < 0 || m.first_vertex < g_meshes[best].first_vertex { best = i; }
        }
        if best < 0 { break; }
        let m .= g_meshes[best];
        for i in 0..m.vertex_count { g_verts[vertex_cursor + i] = g_verts[m.first_vertex + i]; }
        m.first_vertex = vertex_cursor;
        m.compact_mark = true;
        vertex_cursor += m.vertex_count;
    }
    for i in 0..g_meshes.len { g_meshes[i].compact_mark = false; }

    var index_cursor: i64 = 0;
    while true {
        var best: i64 = -1;
        for i in 0..g_meshes.len {
            let m = g_meshes[i];
            if m.asset_free || m.removed || m.compact_mark { continue; }
            if best < 0 || m.first_index < g_meshes[best].first_index { best = i; }
        }
        if best < 0 { break; }
        let m .= g_meshes[best];
        for i in 0..m.index_count { g_indices[index_cursor + i] = g_indices[m.first_index + i]; }
        m.first_index = index_cursor;
        m.compact_mark = true;
        index_cursor += m.index_count;
    }
    for i in 0..g_meshes.len { g_meshes[i].compact_mark = false; }

    g_free_spans.clear();
    if vertex_cursor < g_verts.len { span_release(vertex_cursor, g_verts.len - vertex_cursor, 0); }
    if index_cursor < g_indices.len { span_release(index_cursor, g_indices.len - index_cursor, 1); }
    for i in 0..g_meshes.len {
        let m = g_meshes[i];
        if m.asset_free || m.removed { continue; }
        g3p_upload_mesh(m.id, g_verts[m.first_vertex..m.first_vertex + m.vertex_count],
                        g_indices[m.first_index..m.first_index + m.index_count]);
    }
}

// Replace an asset mesh's deformed positions, normals, and tangents without
// moving its arena spans or changing its handle. CPU geometry stays current for
// bounds, picking, and the next upload to either backend.
fn mesh_asset_update_internal(id: i32, positions: const f32[:], normals: const f32[:], tangents: const f32[:], upload: bool) -> bool {
    guard id >= 0 && id < g_meshes.len else { return false; }
    let m .= g_meshes[id];
    guard m.asset_owned && !m.asset_free && positions.len == m.vertex_count * 3 &&
          normals.len == m.vertex_count * 3 && tangents.len == m.vertex_count * 4 else { return false; }
    var bounds = aabb_empty();
    for i in 0..m.vertex_count {
        let p = float3 { positions[i * 3], positions[i * 3 + 1], positions[i * 3 + 2] };
        let n = float3 { normals[i * 3], normals[i * 3 + 1], normals[i * 3 + 2] };
        let t = float4 { tangents[i * 4], tangents[i * 4 + 1], tangents[i * 4 + 2], tangents[i * 4 + 3] };
        if !(abs(p.x) <= 3.4e38) || !(abs(p.y) <= 3.4e38) || !(abs(p.z) <= 3.4e38) ||
           !(abs(n.x) <= 3.4e38) || !(abs(n.y) <= 3.4e38) || !(abs(n.z) <= 3.4e38) ||
           !(abs(t.x) <= 3.4e38) || !(abs(t.y) <= 3.4e38) || !(abs(t.z) <= 3.4e38) || !(abs(t.w) <= 3.4e38) { return false; }
        aabb_add(bounds, p);
    }
    for i in 0..m.vertex_count {
        g_verts[m.first_vertex + i].pos = float3 { positions[i * 3], positions[i * 3 + 1], positions[i * 3 + 2] };
        g_verts[m.first_vertex + i].normal = float3 { normals[i * 3], normals[i * 3 + 1], normals[i * 3 + 2] };
        g_verts[m.first_vertex + i].tangent = float4 { tangents[i * 4], tangents[i * 4 + 1], tangents[i * 4 + 2], tangents[i * 4 + 3] };
    }
    m.bounds = bounds;
    m.bounds_version += 1;
    if upload {
        g3p_upload_mesh(id, g_verts[m.first_vertex..m.first_vertex + m.vertex_count],
                        g_indices[m.first_index..m.first_index + m.index_count]);
    }
    return true;
}

fn mesh_asset_update(id: i32, positions: const f32[:], normals: const f32[:], tangents: const f32[:]) -> bool {
    return mesh_asset_update_internal(id, positions, normals, tangents, true);
}

// Update retained CPU geometry without uploading a duplicate mesh when WebGL
// deforms the GPU mesh from joint palettes and morph textures.
fn mesh_asset_update_cpu(id: i32, positions: const f32[:], normals: const f32[:], tangents: const f32[:]) -> bool {
    return mesh_asset_update_internal(id, positions, normals, tangents, false);
}

fn mesh_asset_release_handle(handle: MeshHandle) -> bool {
    guard mesh_handle_valid(handle) && g_meshes[handle.id].asset_owned else { return false; }
    mesh_asset_release(handle.id);
    return true;
}

// A cube of the given half extent, 4 corners and 2 triangles per face, with
// flat per-face normals, counterclockwise seen from outside.
fn mesh_cube(half: f32) -> i32 {
    let fv = g_build_verts.len;
    let fi = g_build_indices.len;
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
        let base = (g_build_verts.len - fv) as u32;
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
    let fv = g_build_verts.len;
    let fi = g_build_indices.len;
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
    let fv = g_build_verts.len;
    let fi = g_build_indices.len;
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
