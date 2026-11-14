// The math module's unit test: transforms, projections, the inverse, bounding
// boxes and frustum planes, checked against numbers worked out by hand.
//
// test_engine.goose asks "did it come out the right way up on screen?"; this
// asks "is the matrix the matrix?". A failure here is arithmetic in one
// function, not rasterization, and the derivation for each expected value is
// in the comment above it.
//
//   ./build_native.sh --test                                  builds and runs it
//   goose build -o build/test_math src/test_math.goose && ./build/test_math
//
// No backend is linked: this root imports only g3.math, so none of the
// platform externs are referenced and no surface is needed.

import std;
import vec;
import math;
import g3.math;
import testing;

// tan(0.9 / 2), the half angle of the field of view used below.
let TAN_HALF = 0.48305547;

// f32 arithmetic through a chain of matrices, so compare against a tolerance
// scaled to the magnitudes involved rather than bit for bit. Where an answer is
// exact in f32 (identity multiplication, +-1, a power of two) the tolerance is
// zero on purpose.
fn close_to(a: f32, b: f32, tol: f32) -> bool { return abs(a - b) <= tol }

fn close3(a: float3, b: float3, tol: f32) -> bool {
    close_to(a.x, b.x, tol) && close_to(a.y, b.y, tol) && close_to(a.z, b.z, tol)
}

fn close_mat(a: g3::Mat4, b: g3::Mat4, tol: f32) -> bool {
    for i in 16 {
        if !close_to(a.m[i], b.m[i], tol) { return false; }
    }
    true
}

// A box from two corners, without spelling out the struct.
fn box(lo: float3, hi: float3) -> g3::Aabb {
    var b = g3::aabb_empty();
    g3::aabb_add(b, lo);
    g3::aabb_add(b, hi);
    b
}

fn point_box(p: float3, half: f32) -> g3::Aabb {
    let d = float3 { half, half, half };
    box(p - d, p + d)
}

fn case_identity() {
    print("identity and multiplication");
    let i = g3::mat4_identity();
    testing::check(close_mat(g3::mat4_mul(i, i), i, 0.0), "I * I is I");
    let t = g3::mat4_translate(float3 { 10.0, 0.0, 0.0 });
    testing::check(close_mat(g3::mat4_mul(t, i), t, 0.0), "M * I is M");
    testing::check(close_mat(g3::mat4_mul(i, t), t, 0.0), "I * M is M");
    testing::check(close3(g3::mat4_apply(i, float3 { 1.0, 2.0, 3.0 }), float3 { 1.0, 2.0, 3.0 }, 0.0),
                  "I leaves a point where it is");
}

// `mat4_mul(a, b)` applies b first, then a. A corner at (1,1,1) is (2,2,2)
// after a scale of 2 and (12,2,2) after the move, so T * S gives (12,2,2)
// while S * T scales the moved point and gives (22,2,2).
fn case_order() {
    print("order of composition");
    let t = g3::mat4_translate(float3 { 10.0, 0.0, 0.0 });
    let s = g3::mat4_scale(float3 { 2.0, 2.0, 2.0 });
    let p = float3 { 1.0, 1.0, 1.0 };
    testing::check(close3(g3::mat4_apply(g3::mat4_mul(t, s), p), float3 { 12.0, 2.0, 2.0 }, 0.0),
                  "T * S scales, then moves");
    testing::check(close3(g3::mat4_apply(g3::mat4_mul(s, t), p), float3 { 22.0, 2.0, 2.0 }, 0.0),
                  "S * T moves, then scales");
}

// Right handed rotations at a quarter turn, where the answer is a signed unit
// vector: +90 about x takes +y to +z, about y takes +x to -z, about z takes +x
// to +y. A left handed convention would flip every one of these signs.
fn case_rotations() {
    print("rotations");
    let q = PI * 0.5;
    testing::check(close3(g3::mat4_apply(g3::mat4_rotate_x(q), float3 { 0.0, 1.0, 0.0 }),
                          float3 { 0.0, 0.0, 1.0 }, 1e-6), "+90 about x takes +y to +z");
    testing::check(close3(g3::mat4_apply(g3::mat4_rotate_y(q), float3 { 1.0, 0.0, 0.0 }),
                          float3 { 0.0, 0.0, -1.0 }, 1e-6), "+90 about y takes +x to -z");
    testing::check(close3(g3::mat4_apply(g3::mat4_rotate_z(q), float3 { 1.0, 0.0, 0.0 }),
                          float3 { 0.0, 1.0, 0.0 }, 1e-6), "+90 about z takes +x to +y");
    testing::check(close3(g3::mat4_apply(g3::mat4_rotate_x(q), float3 { 1.0, 0.0, 0.0 }),
                          float3 { 1.0, 0.0, 0.0 }, 1e-6), "a rotation leaves its own axis alone");
    // cos(0.5) = 0.8775826, sin(0.5) = 0.4794255.
    testing::check(close3(g3::mat4_apply(g3::mat4_rotate_y(0.5), float3 { 1.0, 0.0, 0.0 }),
                          float3 { 0.8775826, 0.0, -0.4794255 }, 1e-6),
                  "a partial turn about y gives (cos, 0, -sin)");
    let v = float3 { 1.0, 2.0, 3.0 };
    testing::check(close_to(length(g3::mat4_apply(g3::mat4_rotate_y(0.7), v)), length(v), 1e-5),
                  "a rotation preserves length");
}

// Euler angles apply z, then y, then x. With a quarter turn on both x and y,
// +y goes to +z under x, then +z goes to +x under y: the result is +x. The
// opposite order would leave it at +z, so this check pins the order down.
fn case_euler() {
    print("euler order");
    let q = PI * 0.5;
    let r = g3::mat4_rotate_euler(float3 { q, q, 0.0 });
    testing::check(close3(g3::mat4_apply(r, float3 { 0.0, 1.0, 0.0 }), float3 { 1.0, 0.0, 0.0 }, 1e-6),
                  "x then y: +y ends up at +x");
    testing::check(close_mat(g3::mat4_rotate_euler(float3 { q, 0.0, 0.0 }), g3::mat4_rotate_x(q), 1e-6),
                  "one angle is one axis rotation");
    testing::check(close_mat(g3::mat4_rotate_euler(float3_0), g3::mat4_identity(), 0.0),
                  "no angles is the identity");
}

// trs is translate * rotate * scale, so scale runs first: (1,0,0) scaled by 2
// is (2,0,0), a quarter turn about y is (0,0,-2), the move adds 10 to x.
fn case_trs() {
    print("translate * rotate * scale");
    let m = g3::mat4_trs(float3 { 10.0, 0.0, 0.0 }, float3 { 0.0, PI * 0.5, 0.0 },
                         float3 { 2.0, 2.0, 2.0 });
    testing::check(close3(g3::mat4_apply(m, float3 { 1.0, 0.0, 0.0 }), float3 { 10.0, 0.0, -2.0 }, 1e-6),
                  "scale, then rotate, then translate");
    testing::check(close3(g3::mat4_apply(g3::mat4_trs(float3_0, float3_0, float3 { 2.0, 3.0, 4.0 }),
                                        float3_1), float3 { 2.0, 3.0, 4.0 }, 0.0),
                  "a pure scale multiplies each axis");
    testing::check(close3(g3::mat4_apply(g3::mat4_trs(float3_0, float3_0, float3_1),
                                        float3 { 1.0, 2.0, 3.0 }), float3 { 1.0, 2.0, 3.0 }, 0.0),
                  "a unit trs is the identity");
    // The same node with a zero scale collapses: everything lands on the
    // translation, which is what a hidden-by-scale node should do.
    testing::check(close3(g3::mat4_apply(g3::mat4_trs(float3 { 4.0, 5.0, 6.0 }, float3_0, float3_0),
                                        float3 { 1.0, 2.0, 3.0 }), float3 { 4.0, 5.0, 6.0 }, 0.0),
                  "a zero scale collapses to the position");

    // The translation is applied last, so a node's own origin always lands
    // exactly on its position whatever the rotation and scale are.
    let t = float3 { 1.0, 2.0, 3.0 };
    let quarter = float3 { 0.0, PI * 0.5, 0.0 };
    testing::check(close3(g3::mat4_apply(g3::mat4_trs(t, quarter, float3 { 2.0, 3.0, 4.0 }),
                                        float3_0), t, 0.0),
                  "the local origin lands on the position");

    // Scale acts on the node's own axes, before the rotation. The x axis here
    // is multiplied by 2 and then turned a quarter about y, which maps
    // (1,0,0) to (0,0,-1); z is multiplied by 4 and turned onto +x. Both then
    // get the move.
    let m2 = g3::mat4_trs(t, quarter, float3 { 2.0, 3.0, 4.0 });
    testing::check(close3(g3::mat4_apply(m2, float3 { 1.0, 0.0, 0.0 }),
                          float3 { 1.0, 2.0, 1.0 }, 1e-6),
                  "the local x axis is scaled before it is turned");
    testing::check(close3(g3::mat4_apply(m2, float3 { 0.0, 0.0, 1.0 }),
                          float3 { 5.0, 2.0, 3.0 }, 1e-6),
                  "and so is the local z axis");

    // No rotation leaves translate * scale: (1,2,3) doubled is (2,4,6), then
    // moved to (3,6,9).
    testing::check(close3(g3::mat4_apply(g3::mat4_trs(t, float3_0, float3 { 2.0, 2.0, 2.0 }),
                                        float3 { 1.0, 2.0, 3.0 }),
                          float3 { 3.0, 6.0, 9.0 }, 0.0),
                  "no rotation leaves the scale then the move");

    // A negative scale mirrors rather than collapsing: the point on +x ends up
    // one unit to the left of the position instead of on it.
    testing::check(close3(g3::mat4_apply(g3::mat4_trs(t, float3_0, float3 { -1.0, 1.0, 1.0 }),
                                        float3 { 2.0, 0.0, 0.0 }),
                          float3 { -1.0, 2.0, 3.0 }, 0.0),
                  "a negative scale mirrors instead of collapsing");
}

// GL clip space: the eye at the origin looking down -z, z in [-1, 1], w = the
// distance in front of the eye. The view edge at depth d is d * tan(fov / 2).
fn case_projection() {
    print("perspective projection");
    let p = g3::mat4_perspective(0.9, 1.0, 1.0, 100.0);
    let near_pt = g3::mat4_transform_point(p, float3 { 0.0, 0.0, -1.0 });
    testing::check(close_to(near_pt.w, 1.0, 1e-6), "w is the distance in front of the eye");
    testing::check(close_to(near_pt.z / near_pt.w, -1.0, 1e-6), "the near plane lands on z = -1");
    let far_pt = g3::mat4_transform_point(p, float3 { 0.0, 0.0, -100.0 });
    testing::check(close_to(far_pt.z / far_pt.w, 1.0, 1e-4), "the far plane lands on z = +1");
    // Halfway in distance is not halfway in depth: at z = -50.5 the matrix
    // gives 49.5 / 50.5 = 0.9802, which is why a distant scene has z precision
    // to spare and a near one does not.
    let mid = g3::mat4_transform_point(p, float3 { 0.0, 0.0, -50.5 });
    testing::check(close_to(mid.z / mid.w, 0.980198, 1e-4),
                   "the midpoint of near and far is at z = 0.980");
    let edge = g3::mat4_transform_point(p, float3 { 4.0 * TAN_HALF, 0.0, -4.0 });
    testing::check(close_to(edge.x / edge.w, 1.0, 1e-5), "x = d tan(fov/2) is the right edge");
    let top = g3::mat4_transform_point(p, float3 { 0.0, 4.0 * TAN_HALF, -4.0 });
    testing::check(close_to(top.y / top.w, 1.0, 1e-5), "y = d tan(fov/2) is the top edge");
    // Twice the aspect is twice as wide, so the same point is half way out.
    let wide = g3::mat4_perspective(0.9, 2.0, 1.0, 100.0);
    let wide_edge = g3::mat4_transform_point(wide, float3 { 4.0 * TAN_HALF, 0.0, -4.0 });
    testing::check(close_to(wide_edge.x / wide_edge.w, 0.5, 1e-5),
                   "twice the aspect puts that point at half the x");
}

fn case_ortho() {
    print("orthographic projection");
    let o = g3::mat4_ortho(-2.0, 2.0, -1.0, 1.0, 1.0, 10.0);
    testing::check(close3(g3::mat4_apply(o, float3 { -2.0, -1.0, -1.0 }),
                          float3 { -1.0, -1.0, -1.0 }, 1e-6),
                  "the near bottom left corner is (-1, -1, -1)");
    testing::check(close3(g3::mat4_apply(o, float3 { 2.0, 1.0, -10.0 }),
                          float3 { 1.0, 1.0, 1.0 }, 1e-6),
                  "the far top right corner is (1, 1, 1)");
    testing::check(close3(g3::mat4_apply(o, float3 { 0.0, 0.0, -5.5 }), float3_0, 1e-6),
                  "the middle of the box is the origin");
    testing::check(close_to(g3::mat4_transform_point(o, float3_0).w, 1.0, 0.0),
                   "an ortho matrix has w = 1");
}

// The view matrix of a camera at (0,0,5) looking at the origin: the eye maps
// to the origin, the target to -z, and a world point keeps the axis meaning
// it had (world +x is view +x, world +y is view +y).
fn case_look_at() {
    print("view matrix");
    let eye = float3 { 0.0, 0.0, 5.0 };
    let v = g3::mat4_look_at(eye, float3_0, float3 { 0.0, 1.0, 0.0 });
    testing::check(close3(g3::mat4_apply(v, eye), float3_0, 1e-6),
                  "the eye is the origin of view space");
    testing::check(close3(g3::mat4_apply(v, float3_0), float3 { 0.0, 0.0, -5.0 }, 1e-6),
                  "the target is 5 along -z");
    testing::check(close3(g3::mat4_apply(v, float3 { 1.0, 0.0, 0.0 }), float3 { 1.0, 0.0, -5.0 }, 1e-6),
                  "world +x stays view +x");
    testing::check(close3(g3::mat4_apply(v, float3 { 0.0, 1.0, 0.0 }), float3 { 0.0, 1.0, -5.0 }, 1e-6),
                  "world +y stays view +y");
    testing::check(close3(g3::mat4_apply(v, float3 { 0.0, 0.0, 4.0 }), float3 { 0.0, 0.0, -1.0 }, 1e-6),
                  "a point one in front is at -1");
    testing::check(close3(g3::mat4_apply(v, float3 { 0.0, 0.0, 6.0 }), float3 { 0.0, 0.0, 1.0 }, 1e-6),
                  "a point behind the eye is at +1");
    // From +x looking at the origin, forward is -x, so world -z is view +x.
    let v2 = g3::mat4_look_at(float3 { 5.0, 0.0, 0.0 }, float3_0, float3 { 0.0, 1.0, 0.0 });
    testing::check(close3(g3::mat4_apply(v2, float3 { 0.0, 0.0, -1.0 }), float3 { 1.0, 0.0, -5.0 }, 1e-6),
                  "a turned camera: world -z is view +x");
    testing::check(close3(g3::mat4_apply(v2, float3_0), float3 { 0.0, 0.0, -5.0 }, 1e-6),
                  "and its target is still 5 along -z");
}

fn case_invert() {
    print("the inverse");
    let i = g3::mat4_identity();
    testing::check(close_mat(g3::mat4_invert(i), i, 0.0), "the inverse of the identity is it");
    testing::check(close3(g3::mat4_apply(g3::mat4_invert(g3::mat4_translate(float3 { 5.0, -2.0, 7.0 })),
                                        float3_0), float3 { -5.0, 2.0, -7.0 }, 1e-6),
                  "the inverse of a move is the move back");
    let r = g3::mat4_rotate_y(0.7);
    testing::check(close_mat(g3::mat4_invert(r), g3::mat4_transpose(r), 1e-6),
                  "a rotation inverts to its transpose");

    // A matrix with a projective row, which is where the affine shortcut
    // breaks: perspective * view * model.
    let p = g3::mat4_perspective(0.9, 1.6, 0.1, 200.0);
    let v = g3::mat4_look_at(float3 { 4.0, 3.0, 9.0 }, float3 { 0.0, 1.0, 0.0 },
                             float3 { 0.0, 1.0, 0.0 });
    let model = g3::mat4_trs(float3 { 1.0, 2.0, 3.0 }, float3 { 0.3, 0.9, -0.2 },
                             float3 { 2.0, 0.5, 1.5 });
    let m = g3::mat4_mul(g3::mat4_mul(p, v), model);
    testing::check(close_mat(g3::mat4_mul(m, g3::mat4_invert(m)), i, 1e-3),
                   "M * inverse(M) is the identity");
    let q = float3 { 0.3, -0.7, -2.0 };
    testing::check(close3(g3::mat4_apply(g3::mat4_invert(m), g3::mat4_apply(m, q)), q, 1e-3),
                  "a point survives a trip through M and back");
    // A node with a zero scale is singular; the documented answer is the
    // identity, so a program gets a collapsed node and not NaNs.
    testing::check(close_mat(g3::mat4_invert(g3::mat4_scale(float3 { 0.0, 1.0, 1.0 })), i, 0.0),
                  "a singular matrix inverts to the identity");

    // The projection on its own, which is the case with the projective row and
    // no rotation: its inverse has to map the middle of the near plane, NDC
    // z = -1, back to the eye point `near` in front of the camera, and NDC
    // z = +1 back to `far`.
    let p2 = g3::mat4_perspective(0.9, 1.6, 0.1, 200.0);
    testing::check(close3(g3::mat4_apply(g3::mat4_invert(p2), float3 { 0.0, 0.0, -1.0 }),
                          float3 { 0.0, 0.0, -0.1 }, 1e-5),
                  "the inverse projection puts NDC -1 back on the near plane");
    // NDC 0 is the midpoint of *depth*, which is the harmonic mean 2fn / (f+n)
    // = 0.1999 in front of the eye, not the arithmetic 100.05.
    testing::check(close3(g3::mat4_apply(g3::mat4_invert(p2), float3 { 0.0, 0.0, 0.0 }),
                          float3 { 0.0, 0.0, -0.19990005 }, 1e-6),
                  "and NDC 0 back to 2fn/(f+n) in front of the eye");
    // NDC +1 has to come back as -far, but only to 0.01: the inverse's own w row
    // is a difference of two numbers near 5.0, so at a 2000:1 near/far ratio
    // f32 cancellation costs ~0.005 here. That is a property of inverting a
    // projection, not a defect, and it is why picking rays uses the camera base
    // vectors rather than the inverse.
    testing::check(close3(g3::mat4_apply(g3::mat4_invert(p2), float3 { 0.0, 0.0, 1.0 }),
                          float3 { 0.0, 0.0, -200.0 }, 0.01),
                  "and NDC +1 back on the far plane, to 0.01");

    // A view matrix's inverse is the camera's own frame: the view origin goes
    // back to the eye the camera was placed at.
    testing::check(close3(g3::mat4_apply(g3::mat4_invert(v), float3_0),
                          float3 { 4.0, 3.0, 9.0 }, 1e-6),
                  "the inverse of the view puts the origin back at the eye");

    // The affine case: a rotation and a non-uniform scale, so no projective row
    // but not orthonormal either. It inverts tighter than the chain above.
    let a = g3::mat4_trs(float3 { 1.0, 2.0, 3.0 }, float3 { 0.3, 0.9, -0.2 },
                         float3 { 2.0, 0.5, 1.5 });
    testing::check(close_mat(g3::mat4_mul(a, g3::mat4_invert(a)), i, 1e-6),
                  "an affine matrix inverts to tighter than a projective one");
    testing::check(close3(g3::mat4_apply(g3::mat4_invert(a), float3 { 1.0, 2.0, 3.0 }),
                          float3_0, 1e-6),
                  "and the inverse sends the node's position to the origin");
    testing::check(close_mat(g3::mat4_invert(g3::mat4_invert(a)), a, 1e-4),
                  "inverting twice comes back");
}

fn case_transpose() {
    print("the transpose");
    let m = g3::mat4_trs(float3 { 1.0, 2.0, 3.0 }, float3 { 0.1, 0.2, 0.3 },
                         float3 { 2.0, 3.0, 4.0 });
    testing::check(close_mat(g3::mat4_transpose(g3::mat4_transpose(m)), m, 0.0),
                  "transposing twice gives the matrix back");
    let t = g3::mat4_transpose(g3::mat4_translate(float3 { 1.0, 2.0, 3.0 }));
    testing::check(close_to(t.m[3], 1.0, 0.0) && close_to(t.m[7], 2.0, 0.0) &&
                   close_to(t.m[11], 3.0, 0.0),
                   "a transposed move sits in the last column");
    testing::check(close_to(t.m[12], 0.0, 0.0) && close_to(t.m[15], 1.0, 0.0),
                   "and no longer in the last row");
    testing::check(close3(g3::mat4_apply(g3::mat4_transpose(g3::mat4_rotate_z(0.9)),
                                        float3 { 1.0, 0.0, 0.0 }),
                          g3::mat4_apply(g3::mat4_rotate_z(-0.9), float3 { 1.0, 0.0, 0.0 }), 1e-6),
                  "the transpose of a rotation turns the other way");
}

fn case_aabb() {
    print("bounding boxes");
    var b = g3::aabb_empty();
    g3::aabb_add(b, float3 { 1.0, 2.0, 3.0 });
    g3::aabb_add(b, float3 { -1.0, 0.0, 5.0 });
    testing::check(close3(b.lo, float3 { -1.0, 0.0, 3.0 }, 0.0), "the box grows to the lowest corner");
    testing::check(close3(b.hi, float3 { 1.0, 2.0, 5.0 }, 0.0), "and the highest");

    let cube = box(float3 { -1.0, -1.0, -1.0 }, float3_1);
    testing::check(close3(g3::aabb_center(cube), float3_0, 0.0), "the centre is the middle");
    testing::check(close_to(g3::aabb_radius(cube), 1.7320508, 1e-6),
                   "the radius is half the diagonal: sqrt(3)");

    let moved = g3::aabb_transform(cube, g3::mat4_translate(float3 { 1.0, 2.0, 3.0 }));
    testing::check(close3(moved.lo, float3 { 0.0, 1.0, 2.0 }, 0.0) &&
                   close3(moved.hi, float3 { 2.0, 3.0, 4.0 }, 0.0),
                  "moving a box moves both corners");

    // Under a quarter turn about y, (x, y, z) becomes (z, y, -x), so a slab
    // spanning x in [1, 3] and z in [0, 1] comes out x in [0, 1], z in [-3, -1].
    let slab = box(float3 { 1.0, 0.0, 0.0 }, float3 { 3.0, 1.0, 1.0 });
    let turned = g3::aabb_transform(slab, g3::mat4_rotate_y(PI * 0.5));
    testing::check(close3(turned.lo, float3 { 0.0, 0.0, -3.0 }, 1e-6) &&
                   close3(turned.hi, float3 { 1.0, 1.0, -1.0 }, 1e-6),
                  "a turned box is the box around its turned corners");
    let affine = g3::mat4_mul(g3::mat4_translate(float3 { -2.0, 3.0, 1.0 }),
                              g3::mat4_mul(g3::mat4_rotate_y(0.7),
                                           g3::mat4_scale(float3 { 2.0, 0.5, 1.5 })));
    let fast_box = g3::aabb_transform_affine(slab, affine);
    let corner_box = g3::aabb_transform(slab, affine);
    testing::check(close3(fast_box.lo, corner_box.lo, 1e-6) &&
                   close3(fast_box.hi, corner_box.hi, 1e-6),
                   "affine centre/extents bounds match all transformed corners");
    // A turned cube's box is not the cube: at 0.5 rad its x and z extents grow
    // from 1 to cos(0.5) + sin(0.5) = 1.3570, so the radius is
    // sqrt(2 * 1.3570^2 + 1) = 2.1640, not sqrt(3). aabb_transform is exact
    // for corners, not invariant under rotation, and the cull only needs the
    // first of those.
    testing::check(close_to(g3::aabb_radius(g3::aabb_transform(cube, g3::mat4_rotate_y(0.5))),
                           2.16401, 1e-4),
                   "turning a cube widens the box around it to 2.164");
}

// The frustum of a camera at (0,0,10) looking at the origin, 0.9 rad field of
// view: at depth d the view is d * tan(0.45) wide, so at z = 0 (depth 10) the
// half width is 4.83.
fn test_frustum() -> g3::Frustum {
    let vp = g3::mat4_mul(g3::mat4_perspective(0.9, 1.0, 0.1, 100.0),
                          g3::mat4_look_at(float3 { 0.0, 0.0, 10.0 }, float3_0,
                                           float3 { 0.0, 1.0, 0.0 }));
    g3::frustum_from_view_proj(vp)
}

fn case_frustum() {
    print("frustum planes");
    let f = test_frustum();
    let eye = float3 { 0.0, 0.0, 10.0 };
    var unit_normals = true;
    var eye_inside_sides = true;
    var eye_behind_near = false;
    var target_inside = true;
    for i in 6 {
        let pl = f.planes[i];
        if !close_to(length(pl.n), 1.0, 1e-5) { unit_normals = false; }
        let at_eye = dot(pl.n, eye) + pl.d;
        // Planes 0..3 are left, right, bottom, top; 4 is near and 5 is far.
        // The eye is inside the side planes but behind the near plane, which
        // sits `near` in front of it: that is what a near plane is for.
        if i < 4 && at_eye < 0.0 { eye_inside_sides = false; }
        if i == 4 && at_eye < 0.0 { eye_behind_near = true; }
        if dot(pl.n, float3_0) + pl.d < 0.0 { target_inside = false; }
    }
    testing::check(unit_normals, "every plane normal is a unit vector");
    testing::check(eye_inside_sides, "the eye is inside the four side planes");
    testing::check(eye_behind_near, "the eye is behind the near plane");
    testing::check(target_inside, "and the target is inside all six planes");

    testing::check(g3::frustum_intersects(f, point_box(float3_0, 1.0)),
                   "a box at the target is visible");
    testing::check(g3::frustum_intersects(f, point_box(float3 { 3.0, 0.0, 0.0 }, 0.5)),
                   "a box inside the 4.83 wide view is visible");
    testing::check(!g3::frustum_intersects(f, point_box(float3 { 20.0, 0.0, 0.0 }, 0.5)),
                   "a box far to the right is culled");
    testing::check(g3::frustum_intersects(f, point_box(float3 { 5.3, 0.0, 0.0 }, 0.5)),
                   "a box straddling the right plane is kept");
    testing::check(!g3::frustum_intersects(f, point_box(float3 { 0.0, 0.0, 50.0 }, 0.5)),
                   "a box behind the camera is culled");
    testing::check(g3::frustum_intersects(f, point_box(float3 { 0.0, 0.0, 9.8 }, 0.01)),
                   "a point just inside the near plane is visible");
    testing::check(!g3::frustum_intersects(f, point_box(float3 { 0.0, 0.0, 9.95 }, 0.01)),
                   "a point inside the near plane is culled");
    testing::check(g3::frustum_intersects(f, point_box(float3 { 0.0, 0.0, -89.5 }, 0.01)),
                   "a point just inside the far plane is visible");
    testing::check(!g3::frustum_intersects(f, point_box(float3 { 0.0, 0.0, -95.0 }, 0.01)),
                   "a point beyond the far plane is culled");

    // The same again with the camera turned, so nothing above can pass by
    // relying on the frustum being axis aligned. From (10,10,10) the target is
    // 17.32 away, so the view is 8.37 wide, and the view's right vector is
    // (1, 0, -1) / sqrt(2).
    let vp = g3::mat4_mul(g3::mat4_perspective(0.9, 1.0, 0.1, 100.0),
                          g3::mat4_look_at(float3 { 10.0, 10.0, 10.0 }, float3_0,
                                           float3 { 0.0, 1.0, 0.0 }));
    let f2 = g3::frustum_from_view_proj(vp);
    let right = float3 { 0.70710678, 0.0, -0.70710678 };
    testing::check(g3::frustum_intersects(f2, point_box(float3_0, 1.0)),
                   "a turned camera sees its target");
    testing::check(g3::frustum_intersects(f2, point_box(right * 5.0, 0.5)),
                   "a box 5 to its right is visible");
    testing::check(!g3::frustum_intersects(f2, point_box(right * 20.0, 0.5)),
                   "a box 20 to its right is culled");
    testing::check(!g3::frustum_intersects(f2, point_box(float3 { 11.0, 11.0, 11.0 }, 0.5)),
                   "a box behind a turned camera is culled");

    // The plane equations carry signed distances, not just signs. The eye is
    // behind the near plane, so it evaluates to -0.1 there; it is 100 in front
    // of the far plane and on the inside of it, so that one evaluates to +100.
    testing::check(close_to(dot(f.planes[4].n, eye) + f.planes[4].d, -0.1, 1e-4),
                   "the near plane sits 0.1 behind the eye");
    testing::check(close_to(dot(f.planes[5].n, eye) + f.planes[5].d, 100.0, 1e-3),
                   "and the eye is 100 inside the far plane");

    // Each of the four sides has to reject on its own, not only the right one.
    testing::check(!g3::frustum_intersects(f, point_box(float3 { -20.0, 0.0, 0.0 }, 0.5)),
                   "a box far to the left is culled");
    testing::check(!g3::frustum_intersects(f, point_box(float3 { 0.0, 20.0, 0.0 }, 0.5)),
                   "a box far above the view is culled");
    testing::check(!g3::frustum_intersects(f, point_box(float3 { 0.0, -20.0, 0.0 }, 0.5)),
                   "a box far below the view is culled");
    testing::check(g3::frustum_intersects(f, point_box(float3 { 0.0, 0.0, -89.9 }, 0.5)),
                   "a box straddling the far plane is kept");
    // And the p-vertex test must not over-cull: a box containing the whole
    // frustum has every corner outside some plane, yet is visible.
    testing::check(g3::frustum_intersects(f, box(float3 { -1000.0, -1000.0, -1000.0 },
                                                 float3 { 1000.0, 1000.0, 1000.0 })),
                   "a box containing the frustum is kept");

    // An orthographic frustum is a box, not a cone, and the same six-plane
    // extraction has to produce parallel sides. x in [-5, 5], y in [-3, 3],
    // depth 1 to 11 along -z.
    let fo = g3::frustum_from_view_proj(g3::mat4_ortho(-5.0, 5.0, -3.0, 3.0, 1.0, 11.0));
    testing::check(g3::frustum_intersects(fo, point_box(float3 { 0.0, 0.0, -6.0 }, 0.5)),
                   "an ortho frustum sees straight down -z");
    testing::check(!g3::frustum_intersects(fo, point_box(float3 { 6.0, 0.0, -6.0 }, 0.5)),
                   "a box beyond its 5 half width is culled");
    testing::check(g3::frustum_intersects(fo, point_box(float3 { 4.6, 0.0, -6.0 }, 0.5)),
                   "a box straddling its side is kept");
    testing::check(g3::frustum_intersects(fo, point_box(float3 { 0.0, 2.5, -6.0 }, 0.5)),
                   "a box inside its 3 half height is visible");
    testing::check(!g3::frustum_intersects(fo, point_box(float3 { 0.0, 4.1, -6.0 }, 0.5)),
                   "a box above it is culled");
    testing::check(!g3::frustum_intersects(fo, point_box(float3 { 0.0, 0.0, -0.4 }, 0.1)),
                   "a box in front of its near plane is culled");
    testing::check(!g3::frustum_intersects(fo, point_box(float3 { 0.0, 0.0, -12.0 }, 0.5)),
                   "a box beyond its far plane is culled");
}

fn main() {
    print("g3 math self-test");

    case_identity();
    case_order();
    case_rotations();
    case_euler();
    case_trs();
    case_projection();
    case_ortho();
    case_look_at();
    case_invert();
    case_transpose();
    case_aabb();
    case_frustum();

    if !testing::finish() { exit(1); }
}
