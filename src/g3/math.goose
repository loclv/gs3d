// The 3D engine's math: column-major 4x4 matrices, the transforms an engine
// needs, perspective and view matrices, bounding boxes and frustum planes.
//
// Everything here is plain packed data (a Mat4 is 64 bytes and a float3 is
// 12), so a matrix crosses to the platform layer exactly as it sits in
// memory, with no packing step. Column-major is `m[column * 4 + row]`, which
// is what GL wants for `uniformMatrix4fv` with transpose off.
//
// Float math is f32 throughout: it is what the GPU uses, so the CPU side of
// the engine computes what the shader will, and the reference rasterizer
// agrees with the GPU to the last rounding of the arithmetic it shares.

import vec;
import math;

namespace g3;

struct Mat4 { m: f32[16] }

struct Aabb { lo: float3, hi: float3 }

// A frustum plane: `dot(p, n) + d >= 0` holds for the inside.
struct Plane { n: float3, d: f32 }

struct Frustum { planes: Plane[6] }

fn mat4_zero() -> Mat4 { Mat4 { m: [0.0; 16] } }

fn mat4_identity() -> Mat4 {
    Mat4 { m: [1.0, 0.0, 0.0, 0.0,
               0.0, 1.0, 0.0, 0.0,
               0.0, 0.0, 1.0, 0.0,
               0.0, 0.0, 0.0, 1.0] }
}

// `a * b`, as it reads in math: the result applies b first, then a.
// Hand-unrolled: the k-loop accumulates in the same order as the nested
// loops did, so results are bit-identical, but the compiler sees sixteen
// independent dot products instead of indexing through the loop.
fn mat4_mul(a: Mat4, b: Mat4) -> Mat4 {
    var out = mat4_zero();
    out.m[0] = a.m[0] * b.m[0] + a.m[4] * b.m[1] + a.m[8] * b.m[2] + a.m[12] * b.m[3];
    out.m[1] = a.m[1] * b.m[0] + a.m[5] * b.m[1] + a.m[9] * b.m[2] + a.m[13] * b.m[3];
    out.m[2] = a.m[2] * b.m[0] + a.m[6] * b.m[1] + a.m[10] * b.m[2] + a.m[14] * b.m[3];
    out.m[3] = a.m[3] * b.m[0] + a.m[7] * b.m[1] + a.m[11] * b.m[2] + a.m[15] * b.m[3];
    out.m[4] = a.m[0] * b.m[4] + a.m[4] * b.m[5] + a.m[8] * b.m[6] + a.m[12] * b.m[7];
    out.m[5] = a.m[1] * b.m[4] + a.m[5] * b.m[5] + a.m[9] * b.m[6] + a.m[13] * b.m[7];
    out.m[6] = a.m[2] * b.m[4] + a.m[6] * b.m[5] + a.m[10] * b.m[6] + a.m[14] * b.m[7];
    out.m[7] = a.m[3] * b.m[4] + a.m[7] * b.m[5] + a.m[11] * b.m[6] + a.m[15] * b.m[7];
    out.m[8] = a.m[0] * b.m[8] + a.m[4] * b.m[9] + a.m[8] * b.m[10] + a.m[12] * b.m[11];
    out.m[9] = a.m[1] * b.m[8] + a.m[5] * b.m[9] + a.m[9] * b.m[10] + a.m[13] * b.m[11];
    out.m[10] = a.m[2] * b.m[8] + a.m[6] * b.m[9] + a.m[10] * b.m[10] + a.m[14] * b.m[11];
    out.m[11] = a.m[3] * b.m[8] + a.m[7] * b.m[9] + a.m[11] * b.m[10] + a.m[15] * b.m[11];
    out.m[12] = a.m[0] * b.m[12] + a.m[4] * b.m[13] + a.m[8] * b.m[14] + a.m[12] * b.m[15];
    out.m[13] = a.m[1] * b.m[12] + a.m[5] * b.m[13] + a.m[9] * b.m[14] + a.m[13] * b.m[15];
    out.m[14] = a.m[2] * b.m[12] + a.m[6] * b.m[13] + a.m[10] * b.m[14] + a.m[14] * b.m[15];
    out.m[15] = a.m[3] * b.m[12] + a.m[7] * b.m[13] + a.m[11] * b.m[14] + a.m[15] * b.m[15];
    return out;
}

fn mat4_translate(t: float3) -> Mat4 {
    var out = mat4_identity();
    out.m[12] = t.x;
    out.m[13] = t.y;
    out.m[14] = t.z;
    return out;
}

fn mat4_scale(s: float3) -> Mat4 {
    var out = mat4_identity();
    out.m[0] = s.x;
    out.m[5] = s.y;
    out.m[10] = s.z;
    return out;
}

fn mat4_rotate_x(a: f32) -> Mat4 {
    let c = cos(a);
    let s = sin(a);
    var out = mat4_identity();
    out.m[5] = c;
    out.m[6] = s;
    out.m[9] = -s;
    out.m[10] = c;
    return out;
}

fn mat4_rotate_y(a: f32) -> Mat4 {
    let c = cos(a);
    let s = sin(a);
    var out = mat4_identity();
    out.m[0] = c;
    out.m[2] = -s;
    out.m[8] = s;
    out.m[10] = c;
    return out;
}

fn mat4_rotate_z(a: f32) -> Mat4 {
    let c = cos(a);
    let s = sin(a);
    var out = mat4_identity();
    out.m[0] = c;
    out.m[1] = s;
    out.m[4] = -s;
    out.m[5] = c;
    return out;
}

// Euler angles in radians, applied Z then Y then X, so `Ry * Rx` is the
// usual "yaw, then pitch". The engine's nodes store their rotation this way.
fn mat4_rotate_euler(r: float3) -> Mat4 {
    mat4_mul(mat4_rotate_z(r.z), mat4_mul(mat4_rotate_y(r.y), mat4_rotate_x(r.x)))
}

// translate * rotate * scale: the local matrix of a scene node.
fn mat4_trs(t: float3, r: float3, s: float3) -> Mat4 {
    if r.x == 0.0 && r.y == 0.0 && r.z == 0.0 {
        var out = mat4_scale(s);
        out.m[12] = t.x;
        out.m[13] = t.y;
        out.m[14] = t.z;
        return out;
    }
    // Rz * Ry * Rx, with scale applied to columns and translation in column 3.
    let cx = cos(r.x); let sx = sin(r.x);
    let cy = cos(r.y); let sy = sin(r.y);
    let cz = cos(r.z); let sz = sin(r.z);
    let sy_sx = sy * sx; let sy_cx = sy * cx;
    var out = mat4_zero();
    out.m[0] = cz * cy * s.x;
    out.m[1] = sz * cy * s.x;
    out.m[2] = -sy * s.x;
    out.m[4] = (cz * sy_sx - sz * cx) * s.y;
    out.m[5] = (sz * sy_sx + cz * cx) * s.y;
    out.m[6] = cy * sx * s.y;
    out.m[8] = (cz * sy_cx + sz * sx) * s.z;
    out.m[9] = (sz * sy_cx - cz * sx) * s.z;
    out.m[10] = cy * cx * s.z;
    out.m[12] = t.x; out.m[13] = t.y; out.m[14] = t.z;
    out.m[15] = 1.0;
    return out;
}

// A right-handed perspective projection into GL's clip space (z in [-1, 1]).
fn mat4_perspective(fov_y: f32, aspect: f32, near: f32, far: f32) -> Mat4 {
    let f = 1.0 / tan(fov_y * 0.5);
    var out = mat4_zero();
    out.m[0] = f / aspect;
    out.m[5] = f;
    out.m[10] = (far + near) / (near - far);
    out.m[11] = -1.0;
    out.m[14] = (2.0 * far * near) / (near - far);
    return out;
}

// The general off-axis form of mat4_perspective: an asymmetric frustum for
// tiled rendering (three.js camera.setViewOffset). `left/right/bottom/top`
// are the near-plane extents in the same units as a symmetric frustum.
fn mat4_perspective_frustum(left: f32, right: f32, bottom: f32, top: f32, near: f32, far: f32) -> Mat4 {
    var out = mat4_zero();
    out.m[0] = (2.0 * near) / (right - left);
    out.m[8] = (right + left) / (right - left);
    out.m[5] = (2.0 * near) / (top - bottom);
    out.m[9] = (top + bottom) / (top - bottom);
    out.m[10] = -(far + near) / (far - near);
    out.m[11] = -1.0;
    out.m[14] = (-2.0 * far * near) / (far - near);
    return out;
}

fn mat4_ortho(left: f32, right: f32, bottom: f32, top: f32, near: f32, far: f32) -> Mat4 {
    var out = mat4_identity();
    out.m[0] = 2.0 / (right - left);
    out.m[5] = 2.0 / (top - bottom);
    out.m[10] = -2.0 / (far - near);
    out.m[12] = -(right + left) / (right - left);
    out.m[13] = -(top + bottom) / (top - bottom);
    out.m[14] = -(far + near) / (far - near);
    return out;
}

// The view matrix of a camera at `eye` looking at `center`.
fn mat4_look_at(eye: float3, center: float3, up: float3) -> Mat4 {
    var f = center - eye;
    let fl = length(f);
    if fl > 0.000001 { f = f / fl; } else { f = float3 { 0.0, 0.0, -1.0 }; }
    var s = cross(f, up);
    let sl = length(s);
    if sl > 0.000001 { s = s / sl; } else { s = float3 { 1.0, 0.0, 0.0 }; }
    let u = cross(s, f);
    var out = mat4_identity();
    // Rows 0, 1 and 2 of the rotation, then the eye offset.
    out.m[0] = s.x;  out.m[4] = s.y;  out.m[8] = s.z;   out.m[12] = -dot(s, eye);
    out.m[1] = u.x;  out.m[5] = u.y;  out.m[9] = u.z;   out.m[13] = -dot(u, eye);
    out.m[2] = -f.x; out.m[6] = -f.y; out.m[10] = -f.z; out.m[14] = dot(f, eye);
    return out;
}

// The full 4x4 inverse, by cofactor expansion: 2x2 and 3x3 determinants over
// the four 3x3 submatrices. Returns the identity for a singular matrix, which
// is what a scene with a zero scale on a node wants rather than NaNs.
fn mat4_invert(a: Mat4) -> Mat4 {
    let m = a.m;
    let a00 = m[0];  let a01 = m[1];  let a02 = m[2];  let a03 = m[3];
    let a10 = m[4];  let a11 = m[5];  let a12 = m[6];  let a13 = m[7];
    let a20 = m[8];  let a21 = m[9];  let a22 = m[10]; let a23 = m[11];
    let a30 = m[12]; let a31 = m[13]; let a32 = m[14]; let a33 = m[15];

    let b00 = a00 * a11 - a01 * a10;
    let b01 = a00 * a12 - a02 * a10;
    let b02 = a00 * a13 - a03 * a10;
    let b03 = a01 * a12 - a02 * a11;
    let b04 = a01 * a13 - a03 * a11;
    let b05 = a02 * a13 - a03 * a12;
    let b06 = a20 * a31 - a21 * a30;
    let b07 = a20 * a32 - a22 * a30;
    let b08 = a20 * a33 - a23 * a30;
    let b09 = a21 * a32 - a22 * a31;
    let b10 = a21 * a33 - a23 * a31;
    let b11 = a22 * a33 - a23 * a32;

    let det = b00 * b11 - b01 * b10 + b02 * b09 + b03 * b08 - b04 * b07 + b05 * b06;
    var out = mat4_identity();
    if abs(det) < 1e-20 { return out; }
    let inv = 1.0 / det;

    out.m[0] = (a11 * b11 - a12 * b10 + a13 * b09) * inv;
    out.m[1] = (a02 * b10 - a01 * b11 - a03 * b09) * inv;
    out.m[2] = (a31 * b05 - a32 * b04 + a33 * b03) * inv;
    out.m[3] = (a22 * b04 - a21 * b05 - a23 * b03) * inv;
    out.m[4] = (a12 * b08 - a10 * b11 - a13 * b07) * inv;
    out.m[5] = (a00 * b11 - a02 * b08 + a03 * b07) * inv;
    out.m[6] = (a32 * b02 - a30 * b05 - a33 * b01) * inv;
    out.m[7] = (a20 * b05 - a22 * b02 + a23 * b01) * inv;
    out.m[8] = (a10 * b10 - a11 * b08 + a13 * b06) * inv;
    out.m[9] = (a01 * b08 - a00 * b10 - a03 * b06) * inv;
    out.m[10] = (a30 * b04 - a31 * b02 + a33 * b00) * inv;
    out.m[11] = (a21 * b02 - a20 * b04 - a23 * b00) * inv;
    out.m[12] = (a11 * b07 - a10 * b09 - a12 * b06) * inv;
    out.m[13] = (a00 * b09 - a01 * b07 + a02 * b06) * inv;
    out.m[14] = (a31 * b01 - a30 * b03 - a32 * b00) * inv;
    out.m[15] = (a20 * b03 - a21 * b01 + a22 * b00) * inv;
    return out;
}

fn mat4_transpose(a: Mat4) -> Mat4 {
    var out = mat4_zero();
    for c in 4 { for r in 4 { out.m[r * 4 + c] = a.m[c * 4 + r]; } }
    return out;
}

// The inverse, plus whether the matrix was invertible. mat4_invert's
// identity-on-singular fallback is kept for callers that want it; this is
// for callers that must distinguish "inverted to identity" from "singular".
fn mat4_try_invert(a: Mat4) -> Mat4, bool {
    let m = a.m;
    let a00 = m[0];  let a01 = m[1];  let a02 = m[2];  let a03 = m[3];
    let a10 = m[4];  let a11 = m[5];  let a12 = m[6];  let a13 = m[7];
    let a20 = m[8];  let a21 = m[9];  let a22 = m[10]; let a23 = m[11];
    let a30 = m[12]; let a31 = m[13]; let a32 = m[14]; let a33 = m[15];

    let b00 = a00 * a11 - a01 * a10;
    let b01 = a00 * a12 - a02 * a10;
    let b02 = a00 * a13 - a03 * a10;
    let b03 = a01 * a12 - a02 * a11;
    let b04 = a01 * a13 - a03 * a11;
    let b05 = a02 * a13 - a03 * a12;
    let b06 = a20 * a31 - a21 * a30;
    let b07 = a20 * a32 - a22 * a30;
    let b08 = a20 * a33 - a23 * a30;
    let b09 = a21 * a32 - a22 * a31;
    let b10 = a21 * a33 - a23 * a31;
    let b11 = a22 * a33 - a23 * a32;

    let det = b00 * b11 - b01 * b10 + b02 * b09 + b03 * b08 - b04 * b07 + b05 * b06;
    if abs(det) < 1e-20 { return mat4_identity(), false; }
    let inv = 1.0 / det;
    var out = mat4_zero();
    out.m[0] = (a11 * b11 - a12 * b10 + a13 * b09) * inv;
    out.m[1] = (a02 * b10 - a01 * b11 - a03 * b09) * inv;
    out.m[2] = (a31 * b05 - a32 * b04 + a33 * b03) * inv;
    out.m[3] = (a22 * b04 - a21 * b05 - a23 * b03) * inv;
    out.m[4] = (a12 * b08 - a10 * b11 - a13 * b07) * inv;
    out.m[5] = (a00 * b11 - a02 * b08 + a03 * b07) * inv;
    out.m[6] = (a32 * b02 - a30 * b05 - a33 * b01) * inv;
    out.m[7] = (a20 * b05 - a22 * b02 + a23 * b01) * inv;
    out.m[8] = (a10 * b10 - a11 * b08 + a13 * b06) * inv;
    out.m[9] = (a01 * b08 - a00 * b10 - a03 * b06) * inv;
    out.m[10] = (a30 * b04 - a31 * b02 + a33 * b00) * inv;
    out.m[11] = (a21 * b02 - a20 * b04 - a23 * b00) * inv;
    out.m[12] = (a11 * b07 - a10 * b09 - a12 * b06) * inv;
    out.m[13] = (a00 * b09 - a01 * b07 + a02 * b06) * inv;
    out.m[14] = (a31 * b01 - a30 * b03 - a32 * b00) * inv;
    out.m[15] = (a20 * b03 - a21 * b01 + a22 * b00) * inv;
    return out, true;
}

fn mat4_equals(a: Mat4, b: Mat4) -> bool {
    for i in 16 { if a.m[i] != b.m[i] { return false; } }
    return true;
}

// The point `p` under `m`: a matrix with a projective last row divides by w,
// so the result is the point in the space `m` maps into.
fn mat4_transform_point(m: Mat4, p: float3) -> float4 {
    let x = m.m[0] * p.x + m.m[4] * p.y + m.m[8] * p.z + m.m[12];
    let y = m.m[1] * p.x + m.m[5] * p.y + m.m[9] * p.z + m.m[13];
    let z = m.m[2] * p.x + m.m[6] * p.y + m.m[10] * p.z + m.m[14];
    let w = m.m[3] * p.x + m.m[7] * p.y + m.m[11] * p.z + m.m[15];
    return float4 { x, y, z, w };
}

// The point under an affine matrix, with no divide.
fn mat4_apply(m: Mat4, p: float3) -> float3 {
    let r = mat4_transform_point(m, p);
    if r.w == 1.0 || r.w == 0.0 { return float3 { r.x, r.y, r.z }; }
    return float3 { r.x / r.w, r.y / r.w, r.z / r.w };
}

fn mat4_apply_dir(m: Mat4, v: float3) -> float3 {
    float3 { m.m[0] * v.x + m.m[4] * v.y + m.m[8] * v.z,
             m.m[1] * v.x + m.m[5] * v.y + m.m[9] * v.z,
             m.m[2] * v.x + m.m[6] * v.y + m.m[10] * v.z }
}

// --- bounding boxes

fn aabb_empty() -> Aabb {
    Aabb { lo: float3 { 3.0e38, 3.0e38, 3.0e38 }, hi: float3 { -3.0e38, -3.0e38, -3.0e38 } }
}

fn aabb_add(b: Aabb&, p: float3) {
    if p.x < b.lo.x { b.lo.x = p.x; }
    if p.y < b.lo.y { b.lo.y = p.y; }
    if p.z < b.lo.z { b.lo.z = p.z; }
    if p.x > b.hi.x { b.hi.x = p.x; }
    if p.y > b.hi.y { b.hi.y = p.y; }
    if p.z > b.hi.z { b.hi.z = p.z; }
}

fn aabb_center(b: Aabb) -> float3 { (b.lo + b.hi) * 0.5 }

fn aabb_radius(b: Aabb) -> f32 { length((b.hi - b.lo) * 0.5) }

// An empty box (from aabb_empty, or one with no points added) has lo > hi
// on every axis; tests below treat that as touching nothing.
fn aabb_is_empty(b: Aabb) -> bool { return b.lo.x > b.hi.x || b.lo.y > b.hi.y || b.lo.z > b.hi.z }

fn aabb_contains_point(b: Aabb, p: float3) -> bool {
    return p.x >= b.lo.x && p.x <= b.hi.x && p.y >= b.lo.y && p.y <= b.hi.y && p.z >= b.lo.z && p.z <= b.hi.z;
}

fn aabb_intersects(a: Aabb, b: Aabb) -> bool {
    return a.lo.x <= b.hi.x && a.hi.x >= b.lo.x &&
           a.lo.y <= b.hi.y && a.hi.y >= b.lo.y &&
           a.lo.z <= b.hi.z && a.hi.z >= b.lo.z;
}

fn aabb_contains_aabb(a: Aabb, b: Aabb) -> bool {
    return b.lo.x >= a.lo.x && b.hi.x <= a.hi.x &&
           b.lo.y >= a.lo.y && b.hi.y <= a.hi.y &&
           b.lo.z >= a.lo.z && b.hi.z <= a.hi.z;
}

// The smallest box covering both inputs; either may be empty.
fn aabb_merge(a: Aabb, b: Aabb) -> Aabb {
    if aabb_is_empty(a) { return b; }
    if aabb_is_empty(b) { return a; }
    Aabb {
        lo: float3 { min(a.lo.x, b.lo.x), min(a.lo.y, b.lo.y), min(a.lo.z, b.lo.z) },
        hi: float3 { max(a.hi.x, b.hi.x), max(a.hi.y, b.hi.y), max(a.hi.z, b.hi.z) },
    }
}

// The world-space box around a local box under `m`: all eight corners, which
// is exact enough to cull with and cheap enough to do per node.
fn aabb_transform(b: Aabb, m: Mat4) -> Aabb {
    var out = aabb_empty();
    for i in 8 {
        let p = float3 {
            if (i & 1) != 0 { b.hi.x } else { b.lo.x },
            if (i & 2) != 0 { b.hi.y } else { b.lo.y },
            if (i & 4) != 0 { b.hi.z } else { b.lo.z },
        };
        aabb_add(out, mat4_apply(m, p));
    }
    return out;
}

// Fast world bounds for affine model matrices (TRS and imported node transforms).
// Transforming centre/extents is equivalent to evaluating all eight corners,
// with three absolute-matrix products instead of eight point transforms.
fn aabb_transform_affine(b: Aabb, m: Mat4) -> Aabb {
    let center = mat4_apply(m, aabb_center(b));
    let half = (b.hi - b.lo) * 0.5;
    let extent = float3 {
        abs(m.m[0]) * half.x + abs(m.m[4]) * half.y + abs(m.m[8]) * half.z,
        abs(m.m[1]) * half.x + abs(m.m[5]) * half.y + abs(m.m[9]) * half.z,
        abs(m.m[2]) * half.x + abs(m.m[6]) * half.y + abs(m.m[10]) * half.z,
    };
    return Aabb { lo: center - extent, hi: center + extent };
}

// --- frustum planes

fn plane_normalize(p: Plane) -> Plane {
    let l = length(p.n);
    if l == 0.0 { return p; }
    Plane { n: p.n / l, d: p.d / l }
}

// Gribb-Hartmann: the six planes of the clip volume, from the view-projection
// matrix's rows. Row i of a column-major matrix is m[i], m[4+i], m[8+i], m[12+i].
fn frustum_from_view_proj(vp: Mat4) -> Frustum {
    var rows: float4[4] = [float4 { .. }; 4];
    for r in 4 { rows[r] = float4 { vp.m[r], vp.m[4 + r], vp.m[8 + r], vp.m[12 + r] }; }
    var f = Frustum { .. };
    // The planes come in pairs per axis: row 3 plus row i, then row 3 minus row i.
    for i in 3 {
        f.planes[i * 2] = plane_normalize(Plane { n: float3 { rows[3].x + rows[i].x, rows[3].y + rows[i].y,
                                                            rows[3].z + rows[i].z },
                                                d: rows[3].w + rows[i].w });
        f.planes[i * 2 + 1] = plane_normalize(Plane { n: float3 { rows[3].x - rows[i].x, rows[3].y - rows[i].y,
                                                                rows[3].z - rows[i].z },
                                                    d: rows[3].w - rows[i].w });
    }
    return f;
}

// Is any part of the box on the inside of every plane? The p-vertex test:
// for each plane only the box corner furthest along the normal is checked,
// which is one dot product per plane and never rejects a visible box.
fn frustum_intersects(f: Frustum, b: Aabb) -> bool {
    for i in 6 {
        let p = f.planes[i];
        let v = float3 {
            if p.n.x >= 0.0 { b.hi.x } else { b.lo.x },
            if p.n.y >= 0.0 { b.hi.y } else { b.lo.y },
            if p.n.z >= 0.0 { b.hi.z } else { b.lo.z },
        };
        if dot(p.n, v) + p.d < 0.0 { return false; }
    }
    return true;
}

// Is the point on the inside of every plane?
fn frustum_contains_point(f: Frustum, p: float3) -> bool {
    for i in 6 {
        let pl = f.planes[i];
        if dot(pl.n, p) + pl.d < 0.0 { return false; }
    }
    return true;
}

// Sphere-vs-frustum: reject when the centre is further than `radius` beyond
// any plane. The conservative bound (centre distance minus radius) keeps a
// sphere that straddles a plane visible.
fn frustum_intersects_sphere(f: Frustum, center: float3, radius: f32) -> bool {
    for i in 6 {
        let pl = f.planes[i];
        if dot(pl.n, center) + pl.d < -radius { return false; }
    }
    return true;
}
