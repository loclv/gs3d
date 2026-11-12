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
import g3.picking;
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

fn case_texture_alpha() {
    g3::scene_clear();
    flat_camera();
    let pixels: u8[8] = [255, 255, 255, 0, 255, 255, 255, 255];
    let texture = g3::texture_create(2, 1, pixels[..]);
    let cube = g3::mesh_cube(1.0);
    let back .= g3::node(g3::node_add(cube));
    back.pos.z = -1.0;
    back.color = float4 { 0.0, 1.0, 0.0, 1.0 };
    back.unlit = true;
    let front .= g3::node(g3::node_add(cube));
    front.texture = texture;
    front.unlit = true;
    front.alpha_mode = 1;
    front.alpha_cutoff = 0.5;
    g3::frame(1.0 / 60.0);
    testing::check(is_color(g3::read_pixel(120, 200), 0, 255, 0, 2), "alpha mask reveals geometry behind the cutout");
    testing::check(is_color(g3::read_pixel(280, 200), 255, 255, 255, 2), "alpha mask keeps opaque texels");
    front.alpha_mode = 2;
    front.color.w = 0.5;
    g3::frame(1.0 / 60.0);
    testing::check(is_color(g3::read_pixel(120, 200), 0, 255, 0, 2), "transparent texture texel contributes nothing");
    testing::check(is_color(g3::read_pixel(280, 200), 128, 255, 128, 2), "texture alpha and material alpha blend together");
    front.alpha_mode = 0;
    front.color.w = 1.0;
    g3::frame(1.0 / 60.0);
    testing::check(is_color(g3::read_pixel(120, 200), 255, 255, 255, 2), "opaque material ignores texture alpha");
}

fn uv_triangle(u: f32, v: f32) -> i32 {
    let fv = g3::g_verts.len;
    let fi = g3::g_indices.len;
    let normal = float3 { 0.0, 0.0, 1.0 };
    g3::push_vertex_uv(float3 { -1.0, -1.0, 0.0 }, normal, float2 { u, v });
    g3::push_vertex_uv(float3 { 1.0, -1.0, 0.0 }, normal, float2 { u, v });
    g3::push_vertex_uv(float3 { 0.0, 1.0, 0.0 }, normal, float2 { u, v });
    g3::push_triangle(0, 1, 2);
    return g3::mesh_close(fv, fi);
}

fn case_texture_wrap() {
    g3::scene_clear();
    flat_camera();
    // First row red/green, second row blue/white. At (1.25,-0.25),
    // clamp gives green, repeat blue, and mirrored repeat green.
    let pixels: u8[16] = [255, 0, 0, 255, 0, 255, 0, 255,
                          0, 0, 255, 255, 255, 255, 255, 255];
    let tex = g3::texture_create(2, 2, pixels[..]);
    let n .= g3::node(g3::node_add(uv_triangle(1.25, -0.25)));
    n.texture = tex;
    n.unlit = true;
    g3::frame(1.0 / 60.0);
    testing::check(is_color(g3::read_pixel(200, 200), 0, 255, 0, 2), "clamp samples the edge texel");
    let repeat = g3::texture_set_wrap(tex, g3::WRAP_REPEAT, g3::WRAP_REPEAT);
    g3::frame(1.0 / 60.0);
    testing::check(repeat && is_color(g3::read_pixel(200, 200), 0, 0, 255, 2), "repeat wraps positive and negative UVs");
    let mirror = g3::texture_set_wrap(tex, g3::WRAP_MIRROR, g3::WRAP_MIRROR);
    g3::frame(1.0 / 60.0);
    testing::check(mirror && is_color(g3::read_pixel(200, 200), 0, 255, 0, 2), "mirrored repeat reflects both axes");
    let mixed = g3::texture_set_wrap(tex, g3::WRAP_MIRROR, g3::WRAP_REPEAT);
    g3::frame(1.0 / 60.0);
    testing::check(mixed && is_color(g3::read_pixel(200, 200), 255, 255, 255, 2), "U and V wrap modes are independent");
    n.mesh = uv_triangle(1.0, 0.25);
    let seam = g3::texture_set_wrap(tex, g3::WRAP_REPEAT, g3::WRAP_CLAMP);
    g3::frame(1.0 / 60.0);
    testing::check(seam && is_color(g3::read_pixel(200, 200), 128, 128, 0, 2), "repeat blends across the texture seam");
    testing::check(!g3::texture_set_wrap(tex, 7, 0), "invalid wrap modes are rejected");
}

fn case_texture_filter() {
    g3::scene_clear();
    flat_camera();
    let pixels: u8[16] = [255, 0, 0, 255, 0, 255, 0, 255,
                          0, 0, 255, 255, 255, 255, 255, 255];
    let tex = g3::texture_create(2, 2, pixels[..]);
    let n .= g3::node(g3::node_add(uv_triangle(0.5, 0.25)));
    n.texture = tex;
    n.unlit = true;
    g3::frame(1.0 / 60.0);
    testing::check(is_color(g3::read_pixel(200, 200), 128, 128, 0, 2), "linear filtering mixes adjacent texels");
    let nearest = g3::texture_set_filter(tex, g3::FILTER_LINEAR, g3::FILTER_NEAREST);
    g3::frame(1.0 / 60.0);
    testing::check(nearest && is_color(g3::read_pixel(200, 200), 0, 255, 0, 2), "nearest magnification selects one texel");
    let fv = g3::g_verts.len;
    let fi = g3::g_indices.len;
    let normal = float3 { 0.0, 0.0, 1.0 };
    g3::push_vertex_uv(float3 { -1.0, -1.0, 0.0 }, normal, float2 { 0.0, 0.0 });
    g3::push_vertex_uv(float3 { 1.0, -1.0, 0.0 }, normal, float2 { 400.0, 0.0 });
    g3::push_vertex_uv(float3 { 0.0, 1.0, 0.0 }, normal, float2 { 200.0, 400.0 });
    g3::push_triangle(0, 1, 2);
    n.mesh = g3::mesh_close(fv, fi);
    let wrap = g3::texture_set_wrap(tex, g3::WRAP_REPEAT, g3::WRAP_REPEAT);
    let mip = g3::texture_set_filter(tex, g3::FILTER_LINEAR_MIPMAP_LINEAR, g3::FILTER_LINEAR);
    g3::frame(1.0 / 60.0);
    // At this scale a pixel spans several repeats, so the 1x1 mip is the
    // average of red, green, blue and white: (128,128,128).
    testing::check(wrap && mip && is_color(g3::read_pixel(200, 200), 128, 128, 128, 2), "mipmap filtering averages a highly minified texture");
    for filter in 9984..9988 {
        let ok = g3::texture_set_filter(tex, filter as i32, g3::FILTER_NEAREST);
        g3::frame(1.0 / 60.0);
        testing::check(ok && is_color(g3::read_pixel(200, 200), 128, 128, 128, 2), "each mipmap filter selects the 1x1 level when minified");
    }
    testing::check(!g3::texture_set_filter(tex, 9988, g3::FILTER_LINEAR), "invalid minification filter is rejected");
    testing::check(!g3::texture_set_filter(tex, g3::FILTER_LINEAR, 9987), "mipmap magnification filter is rejected");
}

fn case_color_space() {
    g3::scene_clear();
    flat_camera();
    g3::set_background(float4 { 0.0, 0.0, 0.0, 1.0 });
    let gray: u8[4] = [128, 128, 128, 128];
    let tex = g3::texture_create_srgb(1, 1, gray[..]);
    let n .= g3::node(g3::node_add(uv_triangle(0.5, 0.5)));
    n.texture = tex;
    n.unlit = true;
    // sRGB 128/255 decodes to about 0.216 linear, or 55/255.
    g3::set_output_srgb(false);
    g3::frame(1.0 / 60.0);
    testing::check(is_color(g3::read_pixel(200, 200), 55, 55, 55, 1), "sRGB texture decodes to linear");
    g3::set_output_srgb(true);
    g3::frame(1.0 / 60.0);
    testing::check(is_color(g3::read_pixel(200, 200), 128, 128, 128, 2), "sRGB output encodes linear texture colour");
    n.alpha_mode = 2;
    g3::frame(1.0 / 60.0);
    // Alpha is linear 128/255: 0.216 * 0.502 over black encodes to ~92.
    testing::check(is_color(g3::read_pixel(200, 200), 93, 93, 93, 2), "alpha blends in linear space before output encoding");
    n.alpha_mode = 0;
    let bw: u8[8] = [0, 0, 0, 255, 255, 255, 255, 255];
    n.texture = g3::texture_create_srgb(2, 1, bw[..]);
    n.mesh = uv_triangle(0.5, 0.5);
    g3::set_output_srgb(false);
    g3::frame(1.0 / 60.0);
    testing::check(is_color(g3::read_pixel(200, 200), 128, 128, 128, 2), "sRGB texels are decoded before linear filtering");
    g3::set_output_srgb(true);
    g3::frame(1.0 / 60.0);
    testing::check(is_color(g3::read_pixel(200, 200), 188, 188, 188, 2), "linear texture midpoint encodes to sRGB");
    let fv = g3::g_verts.len;
    let fi = g3::g_indices.len;
    let normal = float3 { 0.0, 0.0, 1.0 };
    g3::push_vertex_uv(float3 { -1.0, -1.0, 0.0 }, normal, float2 { 0.0, 0.0 });
    g3::push_vertex_uv(float3 { 1.0, -1.0, 0.0 }, normal, float2 { 400.0, 0.0 });
    g3::push_vertex_uv(float3 { 0.0, 1.0, 0.0 }, normal, float2 { 200.0, 400.0 });
    g3::push_triangle(0, 1, 2);
    n.mesh = g3::mesh_close(fv, fi);
    let wrap = g3::texture_set_wrap(n.texture, g3::WRAP_REPEAT, g3::WRAP_REPEAT);
    let mip = g3::texture_set_filter(n.texture, g3::FILTER_LINEAR_MIPMAP_LINEAR, g3::FILTER_LINEAR);
    g3::frame(1.0 / 60.0);
    testing::check(wrap && mip && is_color(g3::read_pixel(200, 200), 188, 188, 188, 2), "sRGB mipmaps average texels in linear space");
    n.visible = false;
    g3::set_background(float4 { 0.25, 0.25, 0.25, 1.0 });
    g3::frame(1.0 / 60.0);
    testing::check(is_color(g3::read_pixel(3, 3), 137, 137, 137, 2), "sRGB output encodes the background too");
    g3::set_output_srgb(false);
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
    let transparent: u8[4] = [255, 255, 255, 0];
    cube.texture = g3::texture_create(1, 1, transparent[..]);
    cube.alpha_mode = 1;
    g3::frame(1.0 / 60.0);
    testing::check(is_color(g3::read_pixel(303, 200), 180, 180, 180, 3), "masked texels do not cast shadows");
    g3::clear_shadows();
    g3::frame(1.0 / 60.0);
    testing::check(is_color(g3::read_pixel(303, 200), 180, 180, 180, 3), "disabling shadows restores the light");
}

fn case_clipping() {
    g3::scene_clear();
    flat_camera();
    g3::camera().near = 1.0;
    let fv = g3::g_verts.len;
    let fi = g3::g_indices.len;
    let normal = float3 { 0.0, 0.0, 1.0 };
    // Two vertices are two units from the eye; the third is only 0.5 away,
    // inside the near plane. The middle-lower portion remains visible.
    g3::push_vertex(float3 { -1.0, -1.0, 3.0 }, normal);
    g3::push_vertex(float3 { 1.0, -1.0, 3.0 }, normal);
    g3::push_vertex(float3 { 0.0, 1.0, 4.5 }, normal);
    g3::push_triangle(0, 1, 2);
    let n .= g3::node(g3::node_add(g3::mesh_close(fv, fi)));
    n.unlit = true;
    g3::frame(1.0 / 60.0);
    testing::check(is_color(g3::read_pixel(200, 250), 255, 255, 255, 2), "triangle crossing near plane remains visible");
    // Move the whole triangle between the eye and the near plane.
    n.pos.z = 1.6;
    g3::frame(1.0 / 60.0);
    testing::check(is_color(g3::read_pixel(200, 250), 255, 0, 255, 2), "triangle entirely before near plane is clipped");
}

fn case_normal_transform() {
    g3::scene_clear();
    flat_camera();
    g3::set_ambient(float3_0, 0.0);
    g3::set_light(float3 { 0.0, 0.0, -1.0 }, float3_1);
    let fv = g3::g_verts.len;
    let fi = g3::g_indices.len;
    let normal = float3 { 0.70710678, 0.0, 0.70710678 };
    g3::push_vertex(float3 { -1.0, -1.0, 0.0 }, normal);
    g3::push_vertex(float3 { 1.0, -1.0, 0.0 }, normal);
    g3::push_vertex(float3 { 0.0, 1.0, 0.0 }, normal);
    g3::push_triangle(0, 1, 2);
    let n .= g3::node(g3::node_add(g3::mesh_close(fv, fi)));
    n.scale = float3 { 2.0, 1.0, 1.0 };
    n.spec = 0.0;
    g3::frame(1.0 / 60.0);
    // Inverse-transpose gives normal (1,0,2)/sqrt(5); its dot with +z
    // is 2/sqrt(5), so white under this light is approximately 228/255.
    testing::check(is_color(g3::read_pixel(200, 200), 228, 228, 228, 2), "non-uniform scale uses the inverse-transpose normal");
    // Rotating +90° about z sends the transformed x component to +y.
    n.rot.z = PI * 0.5;
    g3::set_light(float3 { 0.0, -1.0, 0.0 }, float3_1);
    g3::frame(1.0 / 60.0);
    testing::check(is_color(g3::read_pixel(200, 200), 114, 114, 114, 2), "rotated non-uniform normal has the correct direction");
}

fn case_asset_reuse() {
    g3::scene_clear();
    flat_camera();
    let vertices: g3::Vertex[3] = [
        g3::Vertex { pos: float3 { -1.0, -1.0, 0.0 }, normal: float3 { 0.0, 0.0, 1.0 }, uv: float2 { 0.0, 0.0 } },
        g3::Vertex { pos: float3 { 1.0, -1.0, 0.0 }, normal: float3 { 0.0, 0.0, 1.0 }, uv: float2 { 0.0, 0.0 } },
        g3::Vertex { pos: float3 { 0.0, 1.0, 0.0 }, normal: float3 { 0.0, 0.0, 1.0 }, uv: float2 { 0.0, 0.0 } }];
    let indices: u32[3] = [0, 1, 2];
    let mesh = g3::mesh_asset_create(vertices[..], indices[..]);
    let mesh_handle = g3::mesh_handle(mesh);
    let first = g3::node_asset_add(mesh);
    let first_handle = g3::node_handle(first);
    g3::node(first).unlit = true;
    let vertex_count = g3::g_verts.len;
    let index_count = g3::g_indices.len;
    let node_count = g3::node_count();
    g3::frame(1.0 / 60.0);
    testing::check(is_color(g3::read_pixel(200, 200), 255, 255, 255, 2), "asset geometry renders before release");
    g3::node_asset_release(first);
    g3::mesh_asset_release(mesh);
    let replacement = g3::mesh_asset_create(vertices[..], indices[..]);
    let replacement_handle = g3::mesh_handle(replacement);
    testing::check(!g3::mesh_handle_valid(mesh_handle) && g3::mesh_handle_valid(replacement_handle) &&
        !g3::mesh_asset_release_handle(mesh_handle), "stale mesh handle cannot release a reused slot");
    let second = g3::node_asset_add(replacement);
    let second_handle = g3::node_handle(second);
    testing::check(!g3::node_handle_valid(first_handle) && g3::node_handle_valid(second_handle) &&
        !g3::node_asset_release_handle(first_handle), "stale node handle cannot release a reused slot");
    g3::node(second).unlit = true;
    g3::frame(1.0 / 60.0);
    testing::check(first == second && mesh == replacement && g3::node_count() == node_count &&
        g3::g_verts.len == vertex_count && g3::g_indices.len == index_count,
        "asset reload reuses node and geometry storage");
    testing::check(is_color(g3::read_pixel(200, 200), 255, 255, 255, 2), "reused asset geometry renders");
    for i in 100 {
        g3::node_asset_release(second);
        g3::mesh_asset_release(replacement);
        let again = g3::mesh_asset_create(vertices[..], indices[..]);
        let node_again = g3::node_asset_add(again);
        g3::node(node_again).unlit = true;
    }
    testing::check(g3::node_count() == node_count && g3::g_verts.len == vertex_count && g3::g_indices.len == index_count,
        "repeated load and release keeps arena lengths bounded");
    let texture = g3::texture_asset_create();
    let texture_handle = g3::texture_handle(texture);
    g3::texture_asset_release(texture);
    g3::texture_asset_release(texture);
    let replacement_texture = g3::texture_asset_create();
    let other_texture = g3::texture_asset_create();
    let replacement_texture_handle = g3::texture_handle(replacement_texture);
    testing::check(!g3::texture_handle_valid(texture_handle) && g3::texture_handle_valid(replacement_texture_handle) &&
        !g3::texture_asset_release_handle(texture_handle), "stale texture handle cannot release a reused slot");
    testing::check(replacement_texture == texture && other_texture != texture, "released texture id is reused only once");
    g3::node_asset_release(second);
    g3::mesh_asset_release(replacement);
}

fn case_node_epoch() {
    g3::scene_clear();
    let original = g3::node_asset_add(-1);
    let stale = g3::node_handle(original);
    g3::scene_clear();
    let next = g3::node_asset_add(-1);
    let current = g3::node_handle(next);
    testing::check(original == next && !g3::node_handle_valid(stale) && g3::node_handle_valid(current) &&
        !g3::node_asset_release_handle(stale), "scene reset invalidates old handles even when an index is reused");
    testing::check(g3::node_asset_release_handle(current) && !g3::node_handle_valid(current), "checked release invalidates the current handle");
    let ordinary = g3::node_add(-1);
    let ordinary_handle = g3::node_handle(ordinary);
    testing::check(!g3::node_asset_release_handle(ordinary_handle) && g3::node_handle_valid(ordinary_handle),
        "asset release cannot remove an ordinary node");
}

fn case_node_removal() {
    g3::scene_clear();
    flat_camera();
    let root = g3::node_group();
    g3::node(root).pos.x = 1.0;
    let parent = g3::node_group();
    g3::node(parent).pos.y = 2.0;
    g3::node(parent).rot.z = 0.5;
    g3::node_parent(parent, root);
    let child = g3::node_add(g3::mesh_cube(0.25));
    g3::node(child).pos.x = 1.0;
    g3::node_parent(child, parent);
    g3::node_update_worlds();
    let before = g3::mat4_apply(g3::node(child).world, float3_0);
    let old = g3::node_handle(parent);
    testing::check(g3::node_remove(old) && !g3::node_handle_valid(old), "ordinary node removal invalidates its handle");
    g3::node_update_worlds();
    let after = g3::mat4_apply(g3::node(child).world, float3_0);
    testing::check(length(after - before) < 0.0001 && g3::node(child).parent == root,
        "removed parent's children keep their world transforms and hierarchy");
    let replacement = g3::node_group();
    testing::check(replacement == parent && !g3::node_remove(old) && g3::node_handle_valid(g3::node_handle(replacement)),
        "stale handle cannot remove reused ordinary node");
    let asset = g3::node_asset_add(-1);
    let external = g3::node_group();
    g3::node(asset).pos.z = 2.0;
    g3::node(external).pos.x = 3.0;
    g3::node_parent(external, asset);
    testing::check(!g3::node_remove(g3::node_handle(asset)), "ordinary removal cannot remove an asset-owned node");
    g3::node_asset_release(asset);
    let asset_replacement = g3::node_asset_add(-1);
    g3::node(asset_replacement).pos.z = 9.0;
    g3::node_update_worlds();
    let external_world = g3::mat4_apply(g3::node(external).world, float3_0);
    testing::check(asset == asset_replacement && g3::node(external).parent == -1 &&
        length(external_world - float3 { 3.0, 0.0, 2.0 }) < 0.0001,
        "asset release detaches surviving children before slot reuse");
}

fn case_asset_fragmentation() {
    let v = g3::Vertex { pos: float3 { 1.0, 2.0, 3.0 }, normal: float3 { 0.0, 0.0, 1.0 }, uv: float2 { 0.0, 0.0 } };
    let small: g3::Vertex[6] = [v; 6];
    let large: g3::Vertex[12] = [v; 12];
    let small_i: u32[6] = [0, 1, 2, 3, 4, 5];
    let large_i: u32[12] = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11];
    let a = g3::mesh_asset_create(small[..], small_i[..]);
    let b = g3::mesh_asset_create(small[..], small_i[..]);
    let live = g3::mesh_asset_create(small[..], small_i[..]);
    let a_start = g3::mesh(a).first_vertex;
    let b_start = g3::mesh(b).first_vertex;
    let live_start = g3::mesh(live).first_vertex;
    g3::g_verts[live_start].pos.x = 9.0; // sentinel in the still-live allocation
    let before_v = g3::g_verts.len;
    let before_i = g3::g_indices.len;
    g3::mesh_asset_release(a);
    g3::mesh_asset_release(a); // duplicate releases must not create overlapping free spans
    g3::mesh_asset_release(b);
    let combined = g3::mesh_asset_create(large[..], large_i[..]);
    testing::check(b_start == a_start + 6 && g3::mesh(combined).first_vertex == a_start &&
        g3::g_verts.len == before_v && g3::g_indices.len == before_i,
        "adjacent free asset spans coalesce for a larger mesh");
    g3::mesh_asset_release(combined);
    let first = g3::mesh_asset_create(small[..], small_i[..]);
    let second = g3::mesh_asset_create(small[..], small_i[..]);
    testing::check(g3::mesh(first).first_vertex == a_start && g3::mesh(second).first_vertex == b_start &&
        g3::mesh(live).first_vertex == live_start && g3::g_verts[live_start].pos.x == 9.0 &&
        g3::g_verts.len == before_v && g3::g_indices.len == before_i,
        "free spans split without moving a live mesh");
    g3::mesh_asset_release(first);
    g3::mesh_asset_release(second);
    g3::mesh_asset_release(live);
    let initial_v = g3::g_verts.len;
    let initial_i = g3::g_indices.len;
    let small_id = g3::mesh_asset_create(small[..], small_i[..]);
    g3::mesh_asset_release(small_id);
    let bigger = g3::mesh_asset_create(large[..], large_i[..]);
    testing::check(g3::g_verts.len == initial_v && g3::g_indices.len == initial_i,
        "changing asset sizes reuses merged storage");
    g3::mesh_asset_release(bigger);
    let huge: g3::Vertex[24] = [v; 24];
    let huge_i: u32[24] = [0; 24];
    let grown = g3::mesh_asset_create(huge[..], huge_i[..]);
    testing::check(g3::g_verts.len <= initial_v + 6 && g3::g_indices.len <= initial_i + 6,
        "a larger asset extends a free tail instead of abandoning it");
    g3::mesh_asset_release(grown);
}

fn case_picking() {
    g3::scene_clear();
    flat_camera();
    let mesh = g3::mesh_cube(0.5);
    let far = g3::node_add(mesh);
    g3::node(far).pos.z = -1.0;
    let parent = g3::node_group();
    g3::node(parent).pos.x = 0.25;
    let near = g3::node_add(mesh);
    g3::node_parent(near, parent);
    g3::node(near).scale = float3 { 2.0, 1.0, 1.0 };
    // Eye (0,0,5) reaches the front face z=0.5 at distance 4.5.
    let hit = g3::raycast(float3 { 0.0, 0.0, 5.0 }, float3 { 0.0, 0.0, -2.0 }, 0.0, 20.0);
    testing::check(hit.node == near && abs(hit.distance - 4.5) < 0.0001 && abs(hit.point.z - 0.5) < 0.0001,
        "raycast chooses nearest transformed mesh and world distance");
    testing::check(g3::pick_screen(0.0, 0.0, 1.0).node == near, "screen center picks nearest visible mesh");
    testing::check(g3::pick_screen(0.99, 0.99, 1.0).node == -1, "screen ray misses empty space");
    g3::node(near).visible = false;
    testing::check(g3::pick_screen(0.0, 0.0, 1.0).node == far, "hidden mesh does not block picking");
    g3::camera().near = 6.0;
    testing::check(g3::pick_screen(0.0, 0.0, 1.0).node == -1, "screen picking respects the camera near plane");
    testing::check(g3::raycast(float3_0, float3_0, 0.0, 20.0).node == -1, "zero direction produces no hit");
}

// An orthographic 4-unit-high view on a square surface maps one unit to
// 100 pixels regardless of depth. The two cubes are equal on screen.
fn case_orthographic_camera() {
    g3::scene_clear();
    flat_camera();
    let c .= g3::camera();
    c.orthographic = true;
    c.ortho_height = 4.0;
    let mesh = g3::mesh_cube(0.5);
    let left = g3::node_add(mesh);
    g3::node(left).pos = float3 { -1.0, 0.0, 1.0 };
    g3::node(left).unlit = true;
    let right = g3::node_add(mesh);
    g3::node(right).pos = float3 { 1.0, 0.0, -2.0 };
    g3::node(right).unlit = true;
    g3::frame(1.0 / 60.0);
    testing::check(is_color(g3::read_pixel(140, 200), 255, 255, 255, 2) &&
        is_color(g3::read_pixel(340, 200), 255, 255, 255, 2), "orthographic objects keep their size at different depths");
    testing::check(is_color(g3::read_pixel(155, 200), 255, 0, 255, 2) &&
        is_color(g3::read_pixel(355, 200), 255, 0, 255, 2), "orthographic silhouettes end at the expected positions");
    testing::check(g3::pick_screen(-0.5, 0.0, 1.0).node == left && g3::pick_screen(0.5, 0.0, 1.0).node == right,
        "orthographic picking uses parallel offset rays");
    g3::set_ambient(float3_0, 0.0);
    g3::set_light(float3 { 0.0, 0.0, -1.0 }, float3 { 0.25, 0.25, 0.25 });
    g3::node(left).unlit = false; g3::node(right).unlit = false;
    g3::node(left).spec = 1.0; g3::node(right).spec = 1.0;
    g3::frame(1.0 / 60.0);
    testing::check(is_color(g3::read_pixel(100, 200), 128, 128, 128, 2) &&
        is_color(g3::read_pixel(300, 200), 128, 128, 128, 2), "orthographic specular viewing direction is parallel across the frame");
    c.near = 5.0;
    testing::check(g3::pick_screen(-0.5, 0.0, 1.0).node == -1 && g3::pick_screen(0.5, 0.0, 1.0).node == right,
        "orthographic picking respects near clipping");
    c.orthographic = false;
    c.near = 0.1;
    g3::frame(1.0 / 60.0);
    testing::check(is_color(g3::read_pixel(340, 200), 255, 0, 255, 2), "switching back restores perspective projection");
}

fn case_multiple_cameras() {
    g3::scene_clear();
    flat_camera();
    g3::camera_orbit(0.0, 0.0, 5.0, float3_0);
    let perspective = g3::camera_add();
    let orthographic = g3::camera_add();
    testing::check(g3::camera_count() == 2 && g3::camera_active() == perspective && !g3::camera_select(-1),
        "camera creation retains the active camera and rejects invalid selections");
    let cube = g3::node_add(g3::mesh_cube(0.5));
    g3::node(cube).pos.x = 1.0;
    g3::node(cube).unlit = true;
    g3::frame(1.0 / 60.0);
    testing::check(is_color(g3::read_pixel(340, 200), 255, 0, 255, 2) && g3::pick_screen(0.7, 0.0, 1.0).node == -1,
        "perspective camera projects and picks its view");
    testing::check(g3::camera_select(orthographic), "select a second camera");
    g3::camera().orthographic = true;
    g3::camera().ortho_height = 4.0;
    g3::frame(1.0 / 60.0);
    testing::check(is_color(g3::read_pixel(340, 200), 255, 255, 255, 2) && g3::pick_screen(0.7, 0.0, 1.0).node == cube,
        "selected orthographic camera controls rendering and picking");
    g3::camera_orbit(0.5, 0.0, 8.0, float3_0);
    let ortho_pos = g3::camera().pos;
    g3::camera_select(perspective);
    g3::camera_orbit_nudge(0.0, 0.0);
    testing::check(!g3::camera().orthographic && length(g3::camera().pos - float3 { 0.0, 0.0, 5.0 }) < 0.0001,
        "switching restores perspective and its orbit state");
    g3::camera_select(orthographic);
    g3::camera_orbit_nudge(0.0, 0.0);
    testing::check(g3::camera().orthographic && length(g3::camera().pos - ortho_pos) < 0.0001,
        "switching restores orthographic and its orbit state");
    g3::scene_clear();
    testing::check(g3::camera_select(perspective) && g3::camera_active() == perspective, "cameras persist across scene reset");
}

fn case_shared_material() {
    g3::scene_clear();
    flat_camera();
    g3::camera().orthographic = true;
    g3::camera().ortho_height = 4.0;
    let mesh = g3::mesh_cube(0.5);
    let left = g3::node_add(mesh);
    let right = g3::node_add(mesh);
    g3::node(left).pos.x = -1.0;
    g3::node(right).pos.x = 1.0;
    g3::node(left).color = float4 { 1.0, 0.0, 0.0, 1.0 };
    g3::node(left).unlit = true;
    g3::node(right).unlit = true;
    let mat = g3::material_add();
    g3::material(mat).unlit = true;
    g3::material(mat).color = float4 { 0.0, 1.0, 0.0, 1.0 };
    g3::node(left).material = mat;
    g3::node(right).material = mat;
    g3::frame(1.0 / 60.0);
    testing::check(is_color(g3::read_pixel(100, 200), 0, 255, 0, 2) &&
        is_color(g3::read_pixel(300, 200), 0, 255, 0, 2), "two nodes render the same shared material");
    g3::material(mat).color = float4 { 0.0, 0.0, 1.0, 0.5 };
    g3::frame(1.0 / 60.0);
    testing::check(is_color(g3::read_pixel(100, 200), 128, 0, 255, 2) &&
        is_color(g3::read_pixel(300, 200), 128, 0, 255, 2), "shared material updates and alpha blending affect both nodes");
    testing::check(g3::material_remove(mat) && !g3::material_valid(mat) && !g3::material_remove(mat),
        "material removal is checked and idempotent");
    g3::frame(1.0 / 60.0);
    testing::check(is_color(g3::read_pixel(100, 200), 255, 0, 0, 2) &&
        is_color(g3::read_pixel(300, 200), 255, 255, 255, 2), "removing a material restores each node's inline fields");
    testing::check(g3::material_add() != mat, "removed material IDs are not reused");
    g3::camera().orthographic = false;
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
    case_texture_alpha();
    case_texture_wrap();
    case_texture_filter();
    case_color_space();
    case_lights();
    case_shadow();
    case_clipping();
    case_normal_transform();
    case_asset_reuse();
    case_node_epoch();
    case_node_removal();
    case_asset_fragmentation();
    case_picking();
    case_orthographic_camera();
    case_multiple_cameras();
    case_shared_material();

    g3::shutdown();
    if !testing::finish() { exit(1); }
}
