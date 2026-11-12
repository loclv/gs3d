// The engine's self-test: known-answer frames, checked by reading pixels back.
//
// Everything here is independent of the engine's own math: the expected pixel
// positions are worked out by hand from the camera, the field of view and the
// cube's size, and written in the comments. So a check failing means the
// transform, the rasterizer or the ABI changed, not merely that two parts of
// the engine agree with each other.
//
//   ./build_native.sh && ./test_engine        (build_native.sh builds this too)
//
// It exits non-zero if a check fails, so a script or a CI job can run it.

import std;
import vec;
import math;
import g3.math;
import g3.platform;
import g3.mesh;
import g3.scene;
import g3.render;
import g3.engine;
import g3.texture;
import testing;

let W = 400;
let H = 400;
// tan(0.9 / 2), the field of view every case below uses.
let TAN_HALF_FOV = 0.48305547;

fn channel(px: u32, shift: i32) -> i32 { return ((px >> shift) & 255) as i32 }

// A pixel within `tol` of a colour, on every channel.
fn is_color(px: u32, r: i32, g: i32, b: i32, tol: i32) -> bool {
    return abs(channel(px, 16) - r) <= tol && abs(channel(px, 8) - g) <= tol &&
           abs(channel(px, 0) - b) <= tol;
}

// The pixel a world point lands on, for the camera these cases use: (0,0,5)
// looking down -z at the origin, 400x400, fov 0.9. Only used to say where a
// check should look; the engine's matrices never take part in it.
fn pixel_of(x: f32, y: f32, z: f32) -> i32, i32 {
    let depth = 5.0 - z;
    let ndc_x = x / (depth * TAN_HALF_FOV);
    let ndc_y = y / (depth * TAN_HALF_FOV);
    return ((ndc_x * 0.5 + 0.5) * W) as i32, ((1.0 - (ndc_y * 0.5 + 0.5)) * H) as i32;
}

// A camera at the origin-facing place the cases below measure against, with
// lighting that makes a surface exactly its own colour.
fn flat_camera() {
    let c .= g3::camera();
    c.pos = float3 { 0.0, 0.0, 5.0 };
    c.target = float3_0;
    c.up = float3 { 0.0, 1.0, 0.0 };
    c.fov = 0.9;
    c.near = 0.1;
    c.far = 200.0;
    g3::set_light(float3 { 0.0, -1.0, 0.0 }, float3_0);
    g3::set_ambient(float3_1, 1.0);
    g3::set_fog(float3_0, 0.0);
    g3::set_background(float4 { 1.0, 0.0, 1.0, 1.0 });   // magenta: nothing hides in it
}

const MAGENTA = 0xFF00FF;
const WHITE = 0xFFFFFF;

// A cube half of 1.0 at the origin is 2 units across; its near face is at
// z = +1, 4 from the eye, so it spans 1 / (4 * tan(fov/2)) = 0.5175 in ndc,
// which is 0.5175 * 200 = 103.5 pixels each way from the centre: the
// silhouette runs 96.5 to 303.5.
fn case_projection() {
    g3::scene_clear();
    flat_camera();
    let n .= g3::node(g3::node_add(g3::mesh_cube(1.0)));
    n.color = float4_1;
    n.spec = 0.0;
    g3::frame(1.0 / 60.0);

    testing::check(g3::stats().drawn == 1, "one cube is drawn");
    testing::check(g3::stats().triangles == 12, "a cube is 12 triangles");
    testing::check(is_color(g3::read_pixel(200, 200), 255, 255, 255, 2), "the cube covers the centre");
    testing::check(is_color(g3::read_pixel(200, 110), 255, 255, 255, 2), "it reaches y = 110, inside the silhouette");
    testing::check(is_color(g3::read_pixel(200, 85), 255, 0, 255, 2), "nothing is drawn at y = 85, outside it");
    testing::check(is_color(g3::read_pixel(3, 3), 255, 0, 255, 2), "the background is what the frame starts as");
    testing::check(is_color(g3::read_pixel(303, 200), 255, 255, 255, 2) &&
          is_color(g3::read_pixel(305, 200), 255, 0, 255, 2),
          "the right edge falls where 1 / (4 * tan(fov/2)) puts it");
}

// 50% red over magenta is (255, 0, 127.5), so 128 or 127: the blend is a
// normalized framebuffer mix, not a mix of 0..1 with 0..255.
fn case_blending() {
    g3::scene_clear();
    flat_camera();
    let n .= g3::node(g3::node_add(g3::mesh_sphere(1.0, 12, 16)));
    n.color = float4 { 1.0, 0.0, 0.0, 0.5 };
    n.spec = 0.0;
    g3::frame(1.0 / 60.0);

    let px = g3::read_pixel(200, 200);
    testing::check(is_color(px, 255, 0, 128, 1), "a 50% red sphere over magenta is (255, 0, 128)");
    testing::check(is_color(g3::read_pixel(200, 60), 255, 0, 255, 2), "its edge stops where the sphere does");
}

// Two cubes on the same line of sight: the near one is drawn, whatever order
// the sort put them in.
fn case_depth() {
    g3::scene_clear();
    flat_camera();
    let far .= g3::node(g3::node_add(g3::mesh_cube(1.0)));
    far.pos = float3 { 0.0, 0.0, -2.0 };
    far.color = float4 { 0.0, 1.0, 0.0, 1.0 };      // green
    far.spec = 0.0;
    let near .= g3::node(g3::node_add(g3::mesh_cube(1.0)));
    near.pos = float3 { 0.0, 0.0, 2.0 };
    near.color = float4 { 1.0, 0.0, 0.0, 1.0 };     // red
    near.spec = 0.0;
    g3::frame(1.0 / 60.0);

    testing::check(g3::stats().drawn == 2, "both cubes survive the frustum");
    testing::check(is_color(g3::read_pixel(200, 200), 255, 0, 0, 2), "the near (red) cube is in front");
}

// A child at local (2, 0, 0) under a parent at (0, 1, 0) is at world (2, 1, 0):
// 2 / (5 * tan(fov/2)) = 0.828 in ndc x, 1 / (5 * tan(fov/2)) = 0.414 in y.
fn case_hierarchy() {
    g3::scene_clear();
    flat_camera();
    let parent = g3::node_group();
    g3::node(parent).pos = float3 { 0.0, 1.0, 0.0 };
    let child = g3::node_add(g3::mesh_cube(0.3));
    g3::node_parent(child, parent);
    let c .= g3::node(child);
    c.pos = float3 { 2.0, 0.0, 0.0 };
    c.color = float4 { 0.0, 1.0, 0.0, 1.0 };
    c.spec = 0.0;
    g3::frame(1.0 / 60.0);

    let px, py = pixel_of(2.0, 1.0, 0.0);
    testing::check(py < 120 && py > 114, "the projected row is the hand-computed one");
    testing::check(is_color(g3::read_pixel(px, py), 0, 255, 0, 2), "the child is drawn where its parent puts it");
    testing::check(is_color(g3::read_pixel(200, 200), 255, 0, 255, 2), "and nowhere else");
}

// An imported local matrix translating the parent by one places the child at
// x = 1.5. It must compose with the child's ordinary TRS transform.
fn case_import_matrix() {
    g3::scene_clear();
    flat_camera();
    let parent = g3::node_group();
    let p .= g3::node(parent);
    p.local_matrix = g3::mat4_translate(float3 { 1.0, 0.0, 0.0 });
    p.use_local_matrix = true;
    let child = g3::node_add(g3::mesh_cube(0.25));
    g3::node_parent(child, parent);
    let n .= g3::node(child);
    n.pos.x = 0.5;
    n.unlit = true;
    g3::frame(1.0 / 60.0);
    let x, y = pixel_of(1.5, 0.0, 0.25);
    testing::check(is_color(g3::read_pixel(x, y), 255, 255, 255, 2), "imported matrix composes with child transform");
}

// The camera turns around: the cube is behind it and the frustum leaves it out.
fn case_culling() {
    g3::scene_clear();
    flat_camera();
    let n .= g3::node(g3::node_add(g3::mesh_cube(1.0)));
    n.color = float4_1;
    let c .= g3::camera();
    c.pos = float3 { 0.0, 0.0, 5.0 };
    c.target = float3 { 0.0, 0.0, 60.0 };           // looking the other way
    g3::frame(1.0 / 60.0);

    testing::check(g3::stats().culled == 1, "a node behind the camera is culled");
    testing::check(g3::stats().drawn == 0, "and nothing is drawn");
    testing::check(is_color(g3::read_pixel(200, 200), 255, 0, 255, 2), "the frame is background only");
}

// The ground plane faces up, so from below it is a back face and is not drawn:
// the two backends must agree on the winding they cull.
fn case_backface() {
    g3::scene_clear();
    flat_camera();
    let n .= g3::node(g3::node_add(g3::mesh_plane(8.0, 1)));
    n.color = float4_1;
    n.spec = 0.0;
    let c .= g3::camera();
    c.pos = float3 { 0.0, -5.0, 0.0 };
    c.target = float3_0;
    c.up = float3 { 0.0, 1.0, 0.0 };
    g3::frame(1.0 / 60.0);
    testing::check(is_color(g3::read_pixel(200, 200), 255, 0, 255, 2), "a plane seen from below is culled");

    // The same frame from above shows it, so the mesh is not simply missing.
    let c2 .= g3::camera();
    c2.pos = float3 { 0.0, 5.0, 0.0 };
    c2.target = float3_0;
    g3::frame(1.0 / 60.0);
    testing::check(is_color(g3::read_pixel(200, 200), 255, 255, 255, 2), "a plane seen from above is drawn");
}

// The front face spans x/y 96.5..303.5. At 120/280 each coordinate
// lies past the centre of its nearest texel, so clamp-to-edge gives the
// exact corner colour; the midpoint is the average of all four colours.
fn case_texture() {
    g3::scene_clear();
    flat_camera();
    let pixels: u8[16] = [255, 0, 0, 255, 0, 255, 0, 255,
                          0, 0, 255, 255, 255, 255, 255, 255];
    let texture = g3::texture_create(2, 2, pixels[..]);
    testing::check(texture >= 0 && g3::texture_create(2, 3, pixels[..]) == -1, "texture dimensions are validated");
    let n .= g3::node(g3::node_add(g3::mesh_cube(1.0)));
    n.texture = texture;
    n.unlit = true;
    g3::frame(1.0 / 60.0);
    testing::check(is_color(g3::read_pixel(120, 280), 255, 0, 0, 1), "texture lower left is red");
    testing::check(is_color(g3::read_pixel(280, 280), 0, 255, 0, 1), "texture lower right is green");
    testing::check(is_color(g3::read_pixel(120, 120), 0, 0, 255, 1), "texture upper left is blue");
    testing::check(is_color(g3::read_pixel(280, 120), 255, 255, 255, 1), "texture upper right is white");
    testing::check(is_color(g3::read_pixel(200, 200), 128, 128, 128, 3), "texture centre bilinearly mixes all four texels");
}

fn case_lights() {
    g3::scene_clear();
    flat_camera();
    g3::set_ambient(float3_0, 0.0);
    g3::clear_lights();
    g3::set_environment(float3_0, float3_0, 0.0);
    let n .= g3::node(g3::node_add(g3::mesh_cube(1.0)));
    n.spec = 0.0;
    // Two lights point directly onto the front (+z) face: the diffuse
    // contribution is their colour because dot(normal, light) is 1.
    let a = g3::add_directional_light(float3 { 0.0, 0.0, -1.0 }, float3 { 0.25, 0.0, 0.0 });
    let b = g3::add_directional_light(float3 { 0.0, 0.0, -1.0 }, float3 { 0.0, 0.5, 0.0 });
    g3::frame(1.0 / 60.0);
    testing::check(a && b && is_color(g3::read_pixel(200, 200), 64, 128, 0, 2), "directional lights add their contributions");
    g3::clear_lights();
    // The front face is two units from a light of range four, giving
    // (1 - 2/4)^2 = 0.25 of the light's colour.
    let point = g3::add_point_light(float3 { 0.0, 0.0, 3.0 }, float3 { 1.0, 0.0, 0.0 }, 4.0);
    g3::frame(1.0 / 60.0);
    testing::check(point && is_color(g3::read_pixel(200, 200), 64, 0, 0, 2), "point light falls off with distance");
    g3::clear_lights();
    let spot = g3::add_spot_light(float3 { 0.0, 0.0, 3.0 }, float3 { 0.0, 0.0, -1.0 }, float3 { 0.0, 0.0, 1.0 }, 4.0, 0.2, 0.4);
    g3::frame(1.0 / 60.0);
    testing::check(spot && is_color(g3::read_pixel(200, 200), 0, 0, 64, 2), "spot light illuminates its cone");
    g3::clear_lights();
    let away = g3::add_spot_light(float3 { 0.0, 0.0, 3.0 }, float3 { 1.0, 0.0, 0.0 }, float3_1, 4.0, 0.2, 0.4);
    g3::frame(1.0 / 60.0);
    testing::check(away && is_color(g3::read_pixel(200, 200), 0, 0, 0, 1), "spot light excludes surfaces outside its cone");
    g3::clear_lights();
    g3::set_environment(float3 { 0.0, 0.0, 1.0 }, float3 { 1.0, 0.0, 0.0 }, 1.0);
    g3::frame(1.0 / 60.0);
    testing::check(is_color(g3::read_pixel(200, 200), 128, 0, 128, 2), "environment mixes sky and ground on a vertical face");
    g3::set_environment(float3_0, float3_0, 0.0);
    let env_pixel: u8[4] = [64, 128, 192, 255];
    let env = g3::texture_create(1, 1, env_pixel[..]);
    g3::set_environment_map(env, 0.5);
    g3::frame(1.0 / 60.0);
    testing::check(is_color(g3::read_pixel(200, 200), 32, 64, 96, 2), "environment map contributes its sampled colour");
    g3::set_environment_map(-1, 0.0);
    testing::check(!g3::add_point_light(float3_0, float3_1, 0.0), "invalid light range is rejected");
}

fn case_shadow() {
    g3::scene_clear();
    flat_camera();
    g3::clear_lights();
    g3::set_environment(float3_0, float3_0, 0.0);
    g3::set_ambient(float3_0, 0.0);
    g3::set_light(float3 { 1.0, -1.0, 0.0 }, float3_1);
    let ground .= g3::node(g3::node_add(g3::mesh_plane(8.0, 1)));
    ground.spec = 0.0;
    let cube .= g3::node(g3::node_add(g3::mesh_cube(0.5)));
    cube.pos.y = 1.0;
    cube.spec = 0.0;
    let camera .= g3::camera();
    camera.pos = float3 { 0.0, 6.0, 0.0 };
    camera.target = float3_0;
    camera.up = float3 { 0.0, 0.0, -1.0 };
    // Light direction (1,-1,0) carries the cube's shadow toward +x.
    // At x=1.5 the ground lies under that shadow; x=-1.5 stays lit.
    let enabled = g3::set_directional_shadows(float3 { 0.0, 1.0, 0.0 }, 6.0, 0.002);
    g3::frame(1.0 / 60.0);
    testing::check(enabled && is_color(g3::read_pixel(303, 200), 0, 0, 0, 3), "cube casts a shadow on the ground");
    testing::check(is_color(g3::read_pixel(96, 200), 180, 180, 180, 3), "ground outside the shadow stays lit");
    g3::clear_shadows();
    g3::frame(1.0 / 60.0);
    testing::check(is_color(g3::read_pixel(303, 200), 180, 180, 180, 3), "disabling shadows restores the light");
}

fn main() {
    guard g3::init(W, H, "g3 self-test") else {
        print("g3: no surface to draw on");
        exit(1);
    }
    print("g3 engine self-test, ", W, "x", H);

    case_projection();
    case_blending();
    case_depth();
    case_hierarchy();
    case_import_matrix();
    case_culling();
    case_backface();
    case_texture();
    case_lights();
    case_shadow();

    g3::shutdown();
    if !testing::finish() { exit(1); }
}
