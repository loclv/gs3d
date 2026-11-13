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
import g3.gltf_native;
import json;
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

    // glTF double-sided materials draw the same face from the reverse winding
    // and flip its normal before lighting.
    g3::set_ambient(float3_0, 0.0);
    g3::set_light(float3 { 0.0, 1.0, 0.0 }, float3_1);
    let material_id = g3::material_add();
    let material .= g3::material(material_id);
    material.double_sided = true;
    n.material = material_id;
    g3::frame(1.0 / 60.0);
    testing::check(is_color(g3::read_pixel(200, 200), 255, 255, 255, 2), "a double-sided plane is drawn from below");

    // The same frame from above shows it, so the mesh is not simply missing.
    g3::set_light(float3 { 0.0, -1.0, 0.0 }, float3_1);
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
    let material_id = g3::material_add();
    let surface .= g3::material(material_id);
    surface.texture = texture;
    surface.unlit = true;
    surface.base_color_uv = g3::UvTransform { offset: float2 { 1.0, 0.0 }, scale: float2 { 1.0, 1.0 }, .. };
    n.material = material_id;
    g3::frame(1.0 / 60.0);
    testing::check(is_color(g3::read_pixel(120, 280), 0, 255, 0, 1), "base-colour UV offset shifts sampling into the neighboring texel");

    // A mesh keeps eight UV sets independent, and a material selects each.
    g3::scene_clear();
    flat_camera();
    let uv1_texture = g3::texture_create(2, 2, pixels[..]);
    let verts: g3::Vertex[4] = [
        g3::Vertex { pos: float3 { -1.0, -1.0, 0.0 }, normal: float3 { 0.0, 0.0, 1.0 }, uv: float2_0, uv1: float2 { 1.0, 0.0 }, uv2: float2_0, uv3: float2 { 0.0, 1.0 }, uv4: float2 { 1.0, 1.0 }, uv5: float2 { 1.0, 0.0 }, uv6: float2 { 0.0, 1.0 }, uv7: float2 { 1.0, 1.0 }, color: float4_1, .. },
        g3::Vertex { pos: float3 { 1.0, -1.0, 0.0 }, normal: float3 { 0.0, 0.0, 1.0 }, uv: float2_0, uv1: float2 { 1.0, 0.0 }, uv2: float2_0, uv3: float2 { 0.0, 1.0 }, uv4: float2 { 1.0, 1.0 }, uv5: float2 { 1.0, 0.0 }, uv6: float2 { 0.0, 1.0 }, uv7: float2 { 1.0, 1.0 }, color: float4_1, .. },
        g3::Vertex { pos: float3 { 1.0, 1.0, 0.0 }, normal: float3 { 0.0, 0.0, 1.0 }, uv: float2_0, uv1: float2 { 1.0, 0.0 }, uv2: float2_0, uv3: float2 { 0.0, 1.0 }, uv4: float2 { 1.0, 1.0 }, uv5: float2 { 1.0, 0.0 }, uv6: float2 { 0.0, 1.0 }, uv7: float2 { 1.0, 1.0 }, color: float4_1, .. },
        g3::Vertex { pos: float3 { -1.0, 1.0, 0.0 }, normal: float3 { 0.0, 0.0, 1.0 }, uv: float2_0, uv1: float2 { 1.0, 0.0 }, uv2: float2_0, uv3: float2 { 0.0, 1.0 }, uv4: float2 { 1.0, 1.0 }, uv5: float2 { 1.0, 0.0 }, uv6: float2 { 0.0, 1.0 }, uv7: float2 { 1.0, 1.0 }, color: float4_1, .. },
    ];
    let indices: u32[6] = [0, 1, 2, 0, 2, 3];
    let mesh = g3::mesh_asset_create(verts[..], indices[..]);
    let uv1_node .= g3::node(g3::node_add(mesh));
    let uv1_material = g3::material_add();
    let uv1_surface .= g3::material(uv1_material);
    uv1_surface.texture = uv1_texture;
    uv1_surface.unlit = true;
    uv1_surface.base_color_uv = g3::UvTransform { offset: float2_0, scale: float2_1, texcoord: 1, .. };
    uv1_node.material = uv1_material;
    g3::frame(1.0 / 60.0);
    testing::check(is_color(g3::read_pixel(200, 200), 0, 255, 0, 1), "base-colour texture samples TEXCOORD_1 independently of TEXCOORD_0");
    uv1_surface.base_color_uv.texcoord = 2;
    g3::frame(1.0 / 60.0);
    testing::check(is_color(g3::read_pixel(200, 200), 255, 0, 0, 1), "base-colour texture samples TEXCOORD_2 independently of TEXCOORD_0 and TEXCOORD_1");
    uv1_surface.base_color_uv.texcoord = 3;
    g3::frame(1.0 / 60.0);
    testing::check(is_color(g3::read_pixel(200, 200), 0, 0, 255, 1), "base-colour texture samples TEXCOORD_3");
    uv1_surface.base_color_uv.texcoord = 4;
    g3::frame(1.0 / 60.0);
    testing::check(is_color(g3::read_pixel(200, 200), 255, 255, 255, 1), "base-colour texture samples TEXCOORD_4");
    uv1_surface.base_color_uv.texcoord = 5;
    g3::frame(1.0 / 60.0);
    testing::check(is_color(g3::read_pixel(200, 200), 0, 255, 0, 1), "base-colour texture samples TEXCOORD_5");
    uv1_surface.base_color_uv.texcoord = 6;
    g3::frame(1.0 / 60.0);
    testing::check(is_color(g3::read_pixel(200, 200), 0, 0, 255, 1), "base-colour texture samples TEXCOORD_6");
    uv1_surface.base_color_uv.texcoord = 7;
    g3::frame(1.0 / 60.0);
    testing::check(is_color(g3::read_pixel(200, 200), 255, 255, 255, 1), "base-colour texture samples TEXCOORD_7");
}

fn case_native_hdr_load() {
    let hdr = g3::texture_load_hdr("testdata/radiance-white-8x1.hdr");
    let handle = g3::texture_handle(hdr);
    testing::check(hdr >= 0 && g3::texture_handle_valid(handle), "native Radiance HDR loader creates a live texture");
    g3::scene_clear();
    flat_camera();
    g3::clear_lights();
    g3::set_ambient(float3_0, 0.0);
    g3::set_environment(float3_0, float3_0, 0.0);
    let n .= g3::node(g3::node_add(g3::mesh_cube(1.0)));
    n.spec = 0.0;
    g3::set_environment_map(hdr, 0.5);
    g3::frame(1.0 / 60.0);
    testing::check(is_color(g3::read_pixel(200, 200), 254, 254, 254, 2), "native HDR RGBE values retain radiance in environment sampling");
    g3::set_environment_map(-1, 0.0);
    testing::check(g3::texture_remove(handle) && !g3::texture_handle_valid(handle), "native HDR texture follows ordinary texture removal lifecycle");
    testing::check(g3::texture_load_hdr("testdata/missing.hdr") == -1, "native Radiance HDR loader reports missing files");
}

fn case_native_glb_load() {
    g3::scene_clear();
    flat_camera();
    var transform_doc: json::Node[>..] = [];
    var transform_decoded: u8[>..] = [];
    let transform_root, transform_error = json::parse("{\"nodes\":[{\"translation\":[10,0,0],\"children\":[1]},{\"translation\":[0,2,0],\"children\":[2]},{\"translation\":[0,0,3]}]}", transform_doc, transform_decoded);
    let world, world_ok = g3::glb_node_world_matrix(transform_root, 2);
    testing::check(transform_root && transform_error.len == 0 && world_ok &&
                   world.m[12] == 10.0 && world.m[13] == 2.0 && world.m[14] == 3.0,
                   "native GLB node transforms compose through the complete parent chain");
    var invalid_doc: json::Node[>..] = [];
    var invalid_decoded: u8[>..] = [];
    let invalid_root, invalid_error = json::parse("{\"nodes\":[{\"children\":[2]},{\"children\":[2]},{\"translation\":[0,0,1]}]}", invalid_doc, invalid_decoded);
    let invalid_world, invalid_ok = g3::glb_node_world_matrix(invalid_root, 2);
    testing::check(invalid_root && invalid_error.len == 0 && !invalid_ok,
                   "native GLB rejects nodes with multiple parents");
    var unlit_doc: json::Node[>..] = [];
    var unlit_decoded: u8[>..] = [];
    let unlit_root, unlit_error = json::parse("{\"extensionsUsed\":[\"KHR_materials_unlit\",\"KHR_materials_emissive_strength\",\"KHR_materials_ior\"],\"materials\":[{\"pbrMetallicRoughness\":{\"baseColorFactor\":[0.2,0.3,0.4,1]},\"emissiveFactor\":[0.1,0.2,0.3],\"extensions\":{\"KHR_materials_unlit\":{},\"KHR_materials_emissive_strength\":{\"emissiveStrength\":4},\"KHR_materials_ior\":{\"ior\":1.33}}}],\"primitive\":{\"material\":0}}", unlit_doc, unlit_decoded);
    let unlit_material, unlit_ok = g3::glb_material(unlit_root, json::member(unlit_root, "primitive"));
    let unlit_live = unlit_ok && g3::material_handle_valid(unlit_material) && g3::material(unlit_material.id).unlit &&
                     abs(g3::material(unlit_material.id).color.x - 0.2) < 0.001 &&
                     abs(g3::material(unlit_material.id).emissive.z - 1.2) < 0.001 &&
                     abs(g3::material(unlit_material.id).ior - 1.33) < 0.001;
    testing::check(unlit_root && unlit_error.len == 0 && unlit_live,
                   "native GLB imports declared unlit, emissive-strength, and IOR material extensions");
    if g3::material_handle_valid(unlit_material) { g3::material_asset_release(unlit_material); }
    var undeclared_doc: json::Node[>..] = [];
    var undeclared_decoded: u8[>..] = [];
    let undeclared_root, undeclared_error = json::parse("{\"materials\":[{\"extensions\":{\"KHR_materials_unlit\":{}}}],\"primitive\":{\"material\":0}}", undeclared_doc, undeclared_decoded);
    let undeclared_material, undeclared_ok = g3::glb_material(undeclared_root, json::member(undeclared_root, "primitive"));
    testing::check(undeclared_root && undeclared_error.len == 0 && !undeclared_ok && !g3::material_handle_valid(undeclared_material),
                   "native GLB rejects undeclared KHR_materials_unlit");
    var factors_doc: json::Node[>..] = [];
    var factors_decoded: u8[>..] = [];
    let factors_root, factors_error = json::parse("{\"extensionsUsed\":[\"KHR_materials_specular\",\"KHR_materials_clearcoat\",\"KHR_materials_sheen\",\"KHR_materials_anisotropy\"],\"materials\":[{\"extensions\":{\"KHR_materials_specular\":{\"specularFactor\":0.6,\"specularColorFactor\":[0.5,0.6,0.7]},\"KHR_materials_clearcoat\":{\"clearcoatFactor\":0.4,\"clearcoatRoughnessFactor\":0.25},\"KHR_materials_sheen\":{\"sheenColorFactor\":[0.1,0.2,0.3],\"sheenRoughnessFactor\":0.4},\"KHR_materials_anisotropy\":{\"anisotropyStrength\":0.8,\"anisotropyRotation\":0.5}}}],\"primitive\":{\"material\":0}}", factors_doc, factors_decoded);
    let factors_material, factors_ok = g3::glb_material(factors_root, json::member(factors_root, "primitive"));
    let factors_live = factors_ok && g3::material_handle_valid(factors_material) &&
                       abs(g3::material(factors_material.id).specular_factor - 0.6) < 0.001 &&
                       abs(g3::material(factors_material.id).specular_color_factor.z - 0.7) < 0.001 &&
                       abs(g3::material(factors_material.id).clearcoat_factor - 0.4) < 0.001 &&
                       abs(g3::material(factors_material.id).clearcoat_roughness - 0.25) < 0.001 &&
                       abs(g3::material(factors_material.id).sheen_color.y - 0.2) < 0.001 &&
                       abs(g3::material(factors_material.id).sheen_roughness - 0.4) < 0.001 &&
                       abs(g3::material(factors_material.id).anisotropy_strength - 0.8) < 0.001 &&
                       abs(g3::material(factors_material.id).anisotropy_rotation - 0.5) < 0.001;
    testing::check(factors_root && factors_error.len == 0 && factors_live,
                   "native GLB imports specular, clearcoat, sheen, and anisotropy factors");
    if g3::material_handle_valid(factors_material) { g3::material_asset_release(factors_material); }
    let model, loaded = g3::native_glb_load_primitive("web/viewer/sample.glb", 0, 0);
    let selected, selected_ok = g3::native_glb_load_node_primitive("web/viewer/sample.glb", 0, 0);
    let same_transform = selected_ok && loaded && g3::node_handle_valid(selected.node) &&
                         g3::node(selected.node.index).local_matrix.m[12] == g3::node(model.node.index).local_matrix.m[12] &&
                         g3::node(selected.node.index).local_matrix.m[13] == g3::node(model.node.index).local_matrix.m[13] &&
                         g3::node(selected.node.index).local_matrix.m[14] == g3::node(model.node.index).local_matrix.m[14];
    testing::check(same_transform && g3::native_glb_dispose(selected),
                   "native GLB loader can select an explicit node instance");
    let invalid_instance, invalid_instance_ok = g3::native_glb_load_node_primitive("web/viewer/sample.glb", 99, 0);
    testing::check(!invalid_instance_ok && invalid_instance.mesh.id < 0,
                   "native GLB node-instance loader rejects an invalid node index");
    let live = loaded && g3::mesh_handle_valid(model.mesh) && g3::node_handle_valid(model.node) &&
               g3::material_handle_valid(model.material) && g3::node(model.node.index).material == model.material.id;
    let imported_material = g3::material(model.material.id);
    let material_factors = imported_material.pbr && abs(imported_material.metallic - 0.05) < 0.001 &&
                           abs(imported_material.roughness - 0.35) < 0.001 && imported_material.color.w == 1.0;
    g3::frame(1.0 / 60.0);
    let stats = g3::stats();
    testing::check(loaded && live, "native GLB loader returns checked model resources");
    testing::check(material_factors, "native GLB loader imports metallic and roughness factors");
    testing::check(stats.drawn == 1 && stats.triangles == 12,
                   "native GLB loader renders the imported static mesh");
    testing::check(g3::native_glb_dispose(model) && !g3::mesh_handle_valid(model.mesh) &&
                   !g3::node_handle_valid(model.node) && !g3::material_handle_valid(model.material),
                   "native GLB model disposal releases checked node, mesh, and material handles");
    let mesh_model, mesh_loaded = g3::native_glb_load_node_mesh("testdata/native-two-primitives.glb", 0);
    let primitive_count = g3::native_glb_mesh_primitive_count(mesh_model);
    let mesh_root = g3::native_glb_mesh_root(mesh_model);
    let primitive_a = g3::native_glb_mesh_primitive_node(mesh_model, 0);
    let primitive_b = g3::native_glb_mesh_primitive_node(mesh_model, 1);
    let grouped = g3::node_handle_valid(mesh_root) && g3::node_handle_valid(primitive_a) && g3::node_handle_valid(primitive_b) &&
                  g3::node(primitive_a.index).parent == mesh_root.index && g3::node(primitive_b.index).parent == mesh_root.index;
    if g3::node_handle_valid(mesh_root) {
        g3::node(mesh_root.index).use_local_matrix = false;
        g3::node(mesh_root.index).pos = float3 { 0.25, 0.0, 0.0 };
        g3::node_update_worlds();
    }
    let moved_together = g3::node_handle_valid(primitive_a) && g3::node_handle_valid(primitive_b) &&
                         abs(g3::node(primitive_a.index).world.m[12] - 0.25) < 0.001 &&
                         abs(g3::node(primitive_b.index).world.m[12] - 0.25) < 0.001;
    g3::frame(1.0 / 60.0);
    let batch_stats = g3::stats();
    testing::check(mesh_loaded && primitive_count == 2 && grouped && moved_together &&
                   batch_stats.drawn == 2 && batch_stats.triangles == 24,
                   "native GLB mesh loader groups and transforms all selected-node primitives");
    testing::check(g3::native_glb_mesh_dispose(mesh_model) && !g3::native_glb_mesh_valid(mesh_model) &&
                   !g3::node_handle_valid(mesh_root) && !g3::node_handle_valid(primitive_a) && !g3::node_handle_valid(primitive_b),
                   "native GLB mesh disposal releases its group and all primitive resources");
    let reused_mesh, reused_loaded = g3::native_glb_load_node_mesh("testdata/native-two-primitives.glb", 0);
    let reused_slot = reused_loaded && reused_mesh.id == mesh_model.id && reused_mesh.generation != mesh_model.generation &&
                      g3::native_glb_mesh_primitive_count(reused_mesh) == 2;
    testing::check(reused_slot && g3::native_glb_mesh_dispose(reused_mesh),
                   "native GLB mesh owner slots are reused with a fresh generation");
    let failed_mesh, failed_mesh_loaded = g3::native_glb_load_node_mesh("testdata/native-bad-second-primitive.glb", 0);
    g3::frame(1.0 / 60.0);
    let rollback_stats = g3::stats();
    testing::check(!failed_mesh_loaded && !g3::native_glb_mesh_valid(failed_mesh) && rollback_stats.drawn == 0,
                   "native GLB mesh load rolls back earlier primitives when a later primitive fails");
    let absent, missing_file = g3::native_glb_load_primitive("testdata/missing.glb", 0, 0);
    testing::check(!missing_file && absent.mesh.id < 0, "native GLB loader reports a missing asset without creating resources");
}

fn case_vertex_colors() {
    g3::scene_clear();
    flat_camera();
    let verts: g3::Vertex[3] = [
        g3::Vertex { pos: float3 { -1.0, -1.0, 0.0 }, normal: float3 { 0.0, 0.0, 1.0 }, color: float4 { 1.0, 0.0, 0.0, 1.0 }, .. },
        g3::Vertex { pos: float3 { 1.0, -1.0, 0.0 }, normal: float3 { 0.0, 0.0, 1.0 }, color: float4 { 0.0, 1.0, 0.0, 1.0 }, .. },
        g3::Vertex { pos: float3 { 0.0, 1.0, 0.0 }, normal: float3 { 0.0, 0.0, 1.0 }, color: float4 { 0.0, 0.0, 1.0, 1.0 }, .. },
    ];
    let indices: u32[3] = [0, 1, 2];
    let mesh = g3::mesh_asset_create(verts[..], indices[..]);
    let n .= g3::node(g3::node_add(mesh));
    let material_id = g3::material_add();
    let surface .= g3::material(material_id);
    surface.unlit = true;
    n.material = material_id;
    g3::frame(1.0 / 60.0);
    // At screen centre the triangle barycentrics are 1/4, 1/4, 1/2.
    testing::check(is_color(g3::read_pixel(200, 200), 64, 64, 128, 2),
        "vertex colours interpolate perspective-correctly and multiply unlit base colour");

    g3::scene_clear();
    flat_camera();
    let masked_verts: g3::Vertex[3] = [
        g3::Vertex { pos: float3 { -1.0, -1.0, 0.0 }, normal: float3 { 0.0, 0.0, 1.0 }, color: float4 { 1.0, 1.0, 1.0, 0.0 }, .. },
        g3::Vertex { pos: float3 { 1.0, -1.0, 0.0 }, normal: float3 { 0.0, 0.0, 1.0 }, color: float4 { 1.0, 1.0, 1.0, 0.0 }, .. },
        g3::Vertex { pos: float3 { 0.0, 1.0, 0.0 }, normal: float3 { 0.0, 0.0, 1.0 }, color: float4 { 1.0, 1.0, 1.0, 0.0 }, .. },
    ];
    let masked_mesh = g3::mesh_asset_create(masked_verts[..], indices[..]);
    let masked_node .= g3::node(g3::node_add(masked_mesh));
    let masked_material = g3::material_add();
    let masked_surface .= g3::material(masked_material);
    masked_surface.unlit = true;
    masked_surface.alpha_mode = 1;
    masked_surface.alpha_cutoff = 0.5;
    masked_node.material = masked_material;
    g3::frame(1.0 / 60.0);
    testing::check(g3::read_pixel(200, 200) == MAGENTA,
        "vertex colour alpha participates in masked material rejection");
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

fn case_tone_mapping() {
    g3::scene_clear();
    flat_camera();
    g3::set_output_srgb(false);
    g3::set_background(float4 { 0.5, 0.5, 0.5, 1.0 });
    testing::check(!g3::set_tone_mapping_mode(-1) && !g3::set_tone_mapping_mode(3), "unknown tone mapping modes are rejected");
    testing::check(g3::set_tone_mapping_mode(g3::TONE_MAPPING_NONE), "linear tone mapping mode is accepted");
    g3::frame(1.0 / 60.0);
    testing::check(is_color(g3::read_pixel(3, 3), 128, 128, 128, 1), "no tone mapping preserves linear mid-gray");
    testing::check(g3::set_tone_mapping_mode(g3::TONE_MAPPING_REINHARD), "Reinhard tone mapping mode is accepted");
    g3::frame(1.0 / 60.0);
    // Reinhard maps 0.5 to 0.5 / 1.5 = 1/3, or 85/255.
    testing::check(is_color(g3::read_pixel(3, 3), 85, 85, 85, 1), "Reinhard maps linear HDR values with x/(1+x)");
    testing::check(g3::set_tone_mapping_mode(g3::TONE_MAPPING_ACES), "ACES tone mapping mode is accepted");
    g3::frame(1.0 / 60.0);
    // The fitted ACES curve maps 0.5 to ~0.616, or 157/255.
    testing::check(is_color(g3::read_pixel(3, 3), 157, 157, 157, 1), "ACES retains its fitted HDR curve");
    g3::set_tone_mapping(true);
    g3::frame(1.0 / 60.0);
    testing::check(is_color(g3::read_pixel(3, 3), 157, 157, 157, 1), "legacy boolean tone mapping still selects ACES");
    g3::set_tone_mapping(false);
}

fn case_fxaa() {
    g3::scene_clear();
    flat_camera();
    g3::set_tone_mapping_mode(g3::TONE_MAPPING_NONE);
    g3::set_output_srgb(false);
    g3::set_fxaa(false);
    let cube .= g3::node(g3::node_add(g3::mesh_cube(1.0)));
    cube.color = float4_1;
    cube.unlit = true;
    g3::frame(1.0 / 60.0);
    testing::check(is_color(g3::read_pixel(303, 200), 255, 255, 255, 1) &&
          is_color(g3::read_pixel(305, 200), 255, 0, 255, 1), "FXAA starts disabled with a hard silhouette");
    g3::set_fxaa(true);
    g3::frame(1.0 / 60.0);
    let edge = g3::read_pixel(303, 200);
    testing::check(channel(edge, 8) < 250 && is_color(g3::read_pixel(280, 200), 255, 255, 255, 1) &&
          is_color(g3::read_pixel(310, 200), 255, 0, 255, 1), "FXAA smooths only high-contrast silhouette pixels");
    g3::set_fxaa(false);
}

fn draw_target_texture(texture: i32) -> u32 {
    g3::scene_clear();
    flat_camera();
    let cube .= g3::node(g3::node_add(g3::mesh_cube(1.0)));
    cube.texture = texture;
    cube.unlit = true;
    g3::frame(1.0 / 60.0);
    return g3::read_pixel(200, 200);
}

fn render_target_feedback(target: i32) -> u32, i64 {
    g3::render_target_set(target);
    g3::set_background(float4 { 0.0, 0.0, 0.0, 1.0 });
    g3::frame(1.0 / 60.0);
    let suppressed = g3::stats().feedback_items_suppressed;
    g3::render_target_set(-1);
    g3::frame(1.0 / 60.0);
    return g3::read_pixel(200, 200), suppressed;
}

fn set_first_node_texture(texture: i32) {
    let cube .= g3::node(0);
    cube.texture = texture;
}

fn case_render_target() {
    g3::scene_clear();
    flat_camera();
    g3::set_fxaa(true);
    g3::set_output_srgb(true);
    g3::set_tone_mapping_mode(g3::TONE_MAPPING_ACES);
    g3::set_background(float4 { 0.5, 0.5, 0.5, 1.0 });
    let target = g3::render_target_create(80, 40);
    let target_handle = g3::render_target_handle(target);
    testing::check(target >= 0 && g3::render_target_handle_valid(target_handle) &&
                   g3::render_target_texture_id(target_handle) == target && g3::render_target_set_handle(target_handle),
                   "typed render-target handle validates, exposes its texture ID, and can be selected");
    testing::check(!g3::render_target_set(99999), "unknown render targets are rejected");
    g3::frame(1.0 / 60.0);
    testing::check(!g3::render_target_resize_handle(target_handle, 0, 80) &&
                   g3::render_target_resize_handle(target_handle, 40, 80) && abs(g3::aspect() - 0.5) < 0.001,
                   "resize validates dimensions and updates the active camera aspect");
    g3::frame(1.0 / 60.0);

    // The target stores linear RGBA8 values: screen ACES and sRGB encoding
    // must not turn 0.5 into the display-referred value before it is sampled.
    g3::render_target_set(-1);
    g3::set_output_srgb(false);
    g3::set_tone_mapping_mode(g3::TONE_MAPPING_NONE);
    g3::set_fxaa(false);
    g3::scene_clear();
    flat_camera();
    let cube .= g3::node(g3::node_add(g3::mesh_cube(1.0)));
    cube.texture = target;
    cube.unlit = true;
    g3::frame(1.0 / 60.0);
    testing::check(is_color(g3::read_pixel(200, 200), 128, 128, 128, 2), "render target texture can be sampled with linear values");

    let processed = g3::render_target_create(40, 80);
    testing::check(processed >= 0, "secondary render target allocates");
    let custom_shader = g3::post_process_shader_create("color.rgb = vec3(1.0) - color.rgb;");
    testing::check(custom_shader == -1 && !g3::post_process_shader_run(custom_shader, target, processed),
                   "CPU backend reports custom fragment shaders as unsupported");
    let red_pixels: u8[4] = [255, 0, 0, 255];
    let red_texture = g3::texture_create(1, 1, red_pixels[..]);
    testing::check(g3::post_process_run(target, processed, g3::POST_PROCESS_COPY) &&
                   is_color(draw_target_texture(processed), 128, 128, 128, 2), "copy pass preserves the source target values");
    testing::check(g3::post_process_run(target, processed, g3::POST_PROCESS_INVERT),
                   "invert pass writes to a distinct target");
    testing::check(!g3::post_process_run(target, target, g3::POST_PROCESS_COPY) &&
                   !g3::post_process_run(target, processed, 99), "post-processing rejects feedback and unknown effects");
    testing::check(is_color(draw_target_texture(processed), 127, 127, 127, 2), "invert output is sampleable on the next frame");
    var passes_added = true;
    g3::post_process_queue_clear();
    for i in 0..g3::POST_PROCESS_MAX_PASSES {
        if !g3::post_process_queue_add(target, processed, g3::POST_PROCESS_COPY) { passes_added = false; }
    }
    let overflow_rejected = !g3::post_process_queue_add(target, processed, g3::POST_PROCESS_COPY);
    g3::post_process_queue_clear();
    testing::check(passes_added && overflow_rejected, "post-process queue enforces its fixed pass limit");
    testing::check(g3::post_process_queue_add(target, processed, g3::POST_PROCESS_INVERT) &&
                   g3::post_process_queue_add(processed, target, g3::POST_PROCESS_INVERT) &&
                   g3::post_process_queue_execute(), "queued post-process passes execute in order");
    testing::check(is_color(draw_target_texture(target), 128, 128, 128, 2), "two invert passes restore the original target colour");

    testing::check(g3::post_process_run(red_texture, processed, g3::POST_PROCESS_GRAYSCALE) &&
                   is_color(draw_target_texture(processed), 76, 76, 76, 2), "grayscale uses the 0.299 red luma weight");
    let edge_pixels: u8[12] = [0,0,0,255, 255,255,255,255, 0,0,0,255];
    let edge_texture = g3::texture_create(3, 1, edge_pixels[..]);
    let fxaa_target = g3::render_target_create(3, 1);
    testing::check(g3::post_process_run(edge_texture, fxaa_target, g3::POST_PROCESS_FXAA) &&
                   is_color(draw_target_texture(fxaa_target), 128, 128, 128, 2), "FXAA pass averages a high-contrast centre pixel with its across-edge neighbours");

    set_first_node_texture(target);
    let feedback_pixel, feedback_skips = render_target_feedback(target);
    testing::check(is_color(feedback_pixel, 0, 0, 0, 1) && feedback_skips == 1,
                   "sampling the active target is suppressed and reported without creating feedback");
    testing::check(!g3::render_target_remove_handle(target_handle), "a render target referenced by a live node cannot be removed");
    g3::scene_clear();
    testing::check(g3::render_target_remove_handle(target_handle) && !g3::render_target_handle_valid(target_handle) &&
                   g3::render_target_texture_id(target_handle) == -1, "render target removal invalidates its stale typed handle");
    testing::check(g3::render_target_remove(processed), "post-process destination is removable after references are removed");
    testing::check(g3::render_target_remove(fxaa_target), "FXAA destination is removable after references are removed");
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
    var all_eight_added = true;
    for i in 8 {
        all_eight_added = all_eight_added && g3::add_directional_light(float3 { 0.0, 0.0, -1.0 }, float3 { 0.0625, 0.0625, 0.0625 });
    }
    let ninth_rejected = !g3::add_directional_light(float3 { 0.0, 0.0, -1.0 }, float3_1);
    g3::frame(1.0 / 60.0);
    testing::check(all_eight_added && ninth_rejected && g3::g_view_state.light_count == 8,
                   "the engine accepts eight extra directional lights and rejects the ninth");
    testing::check(is_color(g3::read_pixel(200, 200), 128, 128, 128, 2), "all eight extra lights contribute to shading");
    let eight_light_lease = g3::asset_light_set_begin();
    let overlay_added = g3::add_point_light(float3_0, float3_1, 5.0);
    let eight_restored = g3::asset_light_set_release(eight_light_lease);
    testing::check(overlay_added && eight_restored && g3::g_view_state.light_count == 8 &&
                   g3::g_view_state.lights[7].color.x == 0.0625,
                   "asset light overlays restore all eight saved light slots");
    g3::clear_lights();
    // The front face is two units from a light of range four, giving
    // (1 - 2/4)^2 = 0.25 of the light's colour.
    let point = g3::add_point_light(float3 { 0.0, 0.0, 3.0 }, float3 { 1.0, 0.0, 0.0 }, 4.0);
    g3::frame(1.0 / 60.0);
    testing::check(point && is_color(g3::read_pixel(200, 200), 64, 0, 0, 2), "point light falls off with distance");
    g3::clear_lights();
    // At distance 2, inverse-square attenuation is 1/4. The squared linear
    // range fade at range 8 is (1 - 2/8)^2 = 9/16; together they yield 9/64.
    let physical_point = g3::add_point_light_physical(float3 { 0.0, 0.0, 3.0 }, float3 { 1.0, 0.0, 0.0 }, 8.0);
    g3::frame(1.0 / 60.0);
    testing::check(physical_point && is_color(g3::read_pixel(200, 200), 36, 0, 0, 2), "physical point light uses inverse-square attenuation");
    g3::clear_lights();
    let unbounded_point = g3::add_point_light_physical(float3 { 0.0, 0.0, 3.0 }, float3 { 1.0, 0.0, 0.0 }, 0.0);
    g3::frame(1.0 / 60.0);
    let unbounded_shadow = g3::set_point_light_shadows(0, 0.001);
    testing::check(unbounded_point && unbounded_shadow && is_color(g3::read_pixel(200, 200), 64, 0, 0, 2),
                   "zero physical range disables lighting cutoff and uses a bounded shadow projection");
    g3::clear_point_light_shadows();
    g3::clear_lights();
    let spot = g3::add_spot_light(float3 { 0.0, 0.0, 3.0 }, float3 { 0.0, 0.0, -1.0 }, float3 { 0.0, 0.0, 1.0 }, 4.0, 0.2, 0.4);
    g3::frame(1.0 / 60.0);
    testing::check(spot && is_color(g3::read_pixel(200, 200), 0, 0, 64, 2), "spot light illuminates its cone");
    g3::clear_lights();
    let physical_spot = g3::add_spot_light_physical(float3 { 0.0, 0.0, 3.0 }, float3 { 0.0, 0.0, -1.0 }, float3 { 0.0, 0.0, 1.0 }, 8.0, 0.2, 0.4);
    g3::frame(1.0 / 60.0);
    testing::check(physical_spot && is_color(g3::read_pixel(200, 200), 0, 0, 36, 2), "physical spot light uses inverse-square attenuation inside its cone");
    g3::clear_lights();
    let away = g3::add_spot_light(float3 { 0.0, 0.0, 3.0 }, float3 { 1.0, 0.0, 0.0 }, float3_1, 4.0, 0.2, 0.4);
    g3::frame(1.0 / 60.0);
    testing::check(away && is_color(g3::read_pixel(200, 200), 0, 0, 0, 1), "spot light excludes surfaces outside its cone");
    g3::clear_lights();
    let environment_material = g3::material_add();
    n.material = environment_material;
    testing::check(g3::material_set_environment_intensity(environment_material, 0.5) &&
                   !g3::material_set_environment_intensity(environment_material, -1.0),
                   "material environment intensity accepts non-negative factors only");
    let hemisphere_valid = g3::set_environment(float3 { 0.0, 0.0, 1.0 }, float3 { 1.0, 0.0, 0.0 }, 1.0);
    let negative_hemisphere_rejected = !g3::set_environment(float3 { -1.0, 0.0, 0.0 }, float3_0, 1.0);
    g3::frame(1.0 / 60.0);
    testing::check(hemisphere_valid && negative_hemisphere_rejected && is_color(g3::read_pixel(200, 200), 64, 0, 64, 2),
                   "hemisphere lighting accepts finite non-negative HDR colours and rejects negatives");
    g3::set_environment(float3_0, float3_0, 0.0);
    let env_pixel: u8[4] = [64, 128, 192, 255];
    let env = g3::texture_create(1, 1, env_pixel[..]);
    g3::set_environment_map(env, 0.5);
    g3::frame(1.0 / 60.0);
    testing::check(is_color(g3::read_pixel(200, 200), 16, 32, 48, 2), "material environment intensity scales texture fill");
    let orientation_pixels: u8[8] = [255, 0, 0, 255, 0, 255, 0, 255];
    let orientation = g3::texture_create(2, 1, orientation_pixels[..]);
    g3::set_environment_map(orientation, 1.0);
    let zero_rotation = g3::set_environment_rotation(0.0);
    g3::frame(1.0 / 60.0);
    let east_sample = g3::read_pixel(200, 200);
    let half_turn = g3::set_environment_rotation(PI);
    g3::frame(1.0 / 60.0);
    testing::check(zero_rotation && half_turn && is_color(east_sample, 0, 128, 0, 2) &&
                   is_color(g3::read_pixel(200, 200), 128, 0, 0, 2),
                   "environment yaw rotates the diffuse equirectangular lookup by half a turn");
    g3::set_environment_rotation(0.0);
    g3::set_environment_map(-1, 0.0);
    g3::material_remove(environment_material);
    testing::check(!g3::add_point_light(float3_0, float3_1, 0.0), "invalid light range is rejected");

    g3::clear_lights();
    g3::add_directional_light(float3 { 0.0, 0.0, -1.0 }, float3 { 0.125, 0.0, 0.0 });
    let first = g3::asset_light_set_begin();
    g3::add_point_light(float3_0, float3 { 0.0, 0.25, 0.0 }, 5.0);
    let second = g3::asset_light_set_begin();
    g3::add_spot_light(float3_0, float3 { 0.0, 0.0, -1.0 }, float3 { 0.0, 0.0, 0.5 }, 5.0, 0.1, 0.2);
    let removed_earlier = g3::asset_light_set_release(first);
    let restored_original = g3::asset_light_set_release(second);
    testing::check(removed_earlier && restored_original && g3::g_view_state.light_count == 1 &&
                   g3::g_view_state.lights[0].position.w == 0.0 && g3::g_view_state.lights[0].color.x == 0.125,
                   "out-of-order asset light disposal restores the original set, not a disposed overlay");
    let first_reuse = g3::asset_light_set_begin();
    g3::asset_light_set_release(first_reuse);
    let second_reuse = g3::asset_light_set_begin();
    let bounded = first_reuse == second_reuse && g3::asset_light_set_release(second_reuse);
    testing::check(bounded, "released asset light snapshots reuse their descriptor slots");
    g3::clear_lights();
    let original_point = g3::add_point_light(float3_0, float3_1, 5.0);
    let original_shadow = g3::set_point_light_shadows(0, 0.001);
    let shadow_lease = g3::asset_light_set_begin();
    let imported_spot = g3::add_spot_light_physical(float3_0, float3 { 0.0, 0.0, -1.0 }, float3_1, 5.0, 0.1, 0.2);
    let imported_shadow = g3::set_spot_light_shadows(0, 0.002);
    let shadows_restored = g3::asset_light_set_release(shadow_lease);
    testing::check(original_point && original_shadow && imported_spot && imported_shadow && shadows_restored &&
                   g3::g_view_state.light_count == 1 && g3::g_view_state.point_shadow_light_index == 0 &&
                   g3::g_view_state.spot_shadow_light_index == -1 && g3::g_view_state.point_shadow_params.x > 0.5,
                   "disposing imported lights restores the prior point shadow and clears the imported spot shadow");
    g3::clear_lights();
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
    let edge_alpha: u8[8] = [255, 255, 255, 255, 255, 255, 255, 0];
    let edge_texture = g3::texture_create(2, 1, edge_alpha[..]);
    let masked_material = g3::material_add();
    let masked_surface .= g3::material(masked_material);
    masked_surface.texture = edge_texture;
    masked_surface.alpha_mode = 1;
    masked_surface.base_color_uv = g3::UvTransform { offset: float2 { 10.0, 0.0 }, scale: float2 { 1.0, 1.0 }, .. };
    cube.material = masked_material;
    g3::frame(1.0 / 60.0);
    testing::check(is_color(g3::read_pixel(303, 200), 180, 180, 180, 3), "base-colour transform also controls masked shadow sampling");
    g3::clear_shadows();
    g3::frame(1.0 / 60.0);
    testing::check(is_color(g3::read_pixel(303, 200), 180, 180, 180, 3), "disabling shadows restores the light");
}

fn case_point_shadow() {
    g3::scene_clear();
    flat_camera();
    g3::clear_lights();
    g3::set_environment(float3_0, float3_0, 0.0);
    g3::set_ambient(float3_0, 0.0);
    let ground .= g3::node(g3::node_add(g3::mesh_plane(8.0, 1)));
    ground.spec = 0.0;
    let cube .= g3::node(g3::node_add(g3::mesh_cube(0.5)));
    cube.pos.y = 1.0;
    cube.spec = 0.0;
    let camera .= g3::camera();
    camera.pos = float3 { 0.0, 6.0, 0.0 };
    camera.target = float3_0;
    camera.up = float3 { 0.0, 0.0, -1.0 };

    // The cube top is y=1.5. A ray from (-2,4,0) through (0,1.5,0)
    // reaches the ground at x=1.2; the ray to x=2.5 misses the cube.
    let added = g3::add_point_light(float3 { -2.0, 4.0, 0.0 }, float3_1, 20.0);
    let enabled = g3::set_point_light_shadows(0, 0.0001);
    g3::frame(1.0 / 60.0);
    let shadowed = channel(g3::read_pixel(283, 200), 16);
    let lit = channel(g3::read_pixel(372, 200), 16);
    g3::clear_point_light_shadows();
    g3::frame(1.0 / 60.0);
    let unshadowed = channel(g3::read_pixel(283, 200), 16);
    testing::check(added && enabled && lit > 10, "a point light illuminates ground beyond its cube caster");
    testing::check(unshadowed - shadowed > 20, "point-light cube shadow darkens the projected ground footprint");
    g3::clear_lights();
}

fn case_spot_shadow() {
    g3::scene_clear();
    flat_camera();
    g3::clear_lights();
    g3::set_environment(float3_0, float3_0, 0.0);
    g3::set_ambient(float3_0, 0.0);
    let ground .= g3::node(g3::node_add(g3::mesh_plane(8.0, 1)));
    ground.spec = 0.0;
    let cube .= g3::node(g3::node_add(g3::mesh_cube(0.5)));
    cube.pos.y = 1.0;
    cube.spec = 0.0;
    let camera .= g3::camera();
    camera.pos = float3 { 0.0, 6.0, 0.0 };
    camera.target = float3_0;
    camera.up = float3 { 0.0, 0.0, -1.0 };

    // The spot axis from (-2,4,0) through the cube top at (0,1.5,0)
    // reaches x=1.2 on the ground. At x=2.5 the ray stays in the cone but
    // misses the cube.
    let added = g3::add_spot_light(float3 { -2.0, 4.0, 0.0 }, float3 { 1.0, -1.0, 0.0 },
                                   float3_1, 20.0, 0.2, 0.4);
    let enabled = g3::set_spot_light_shadows(0, 0.0001);
    g3::frame(1.0 / 60.0);
    let shadowed = channel(g3::read_pixel(283, 200), 16);
    let lit = channel(g3::read_pixel(372, 200), 16);
    g3::clear_spot_light_shadows();
    g3::frame(1.0 / 60.0);
    let unshadowed = channel(g3::read_pixel(283, 200), 16);
    testing::check(added && enabled && lit > 10, "a spot light illuminates ground within its cone beyond its caster");
    testing::check(unshadowed - shadowed > 20, "spot-light shadow darkens the projected ground footprint");
    g3::clear_lights();
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
        g3::Vertex { pos: float3 { -1.0, -1.0, 0.0 }, normal: float3 { 0.0, 0.0, 1.0 }, uv: float2 { 0.0, 0.0 }, tangent: float4_0, color: float4_1, .. },
        g3::Vertex { pos: float3 { 1.0, -1.0, 0.0 }, normal: float3 { 0.0, 0.0, 1.0 }, uv: float2 { 0.0, 0.0 }, tangent: float4_0, color: float4_1, .. },
        g3::Vertex { pos: float3 { 0.0, 1.0, 0.0 }, normal: float3 { 0.0, 0.0, 1.0 }, uv: float2 { 0.0, 0.0 }, tangent: float4_0, color: float4_1, .. }];
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
    let mesh_count = g3::g_meshes.len;
    for i in 100 {
        g3::node_asset_release(second);
        g3::mesh_asset_release(replacement);
        let again = g3::mesh_asset_create(vertices[..], indices[..]);
        let node_again = g3::node_asset_add(again);
        g3::node(node_again).unlit = true;
    }
    testing::check(g3::node_count() == node_count && g3::g_meshes.len == mesh_count &&
        g3::g_verts.len == vertex_count && g3::g_indices.len == index_count,
        "repeated load and release keeps node, mesh descriptor, and geometry arena lengths bounded");
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

fn case_ordinary_mesh_removal() {
    g3::scene_clear();
    flat_camera();
    let mesh = g3::mesh_cube(1.0);
    let handle = g3::mesh_handle(mesh);
    let node = g3::node_add(mesh);
    let node_handle = g3::node_handle(node);
    testing::check(!g3::mesh_remove(handle), "a mesh with a live node cannot be removed");
    testing::check(g3::node_remove(node_handle), "remove the ordinary node before its mesh");
    testing::check(g3::mesh_remove(handle) && !g3::mesh_handle_valid(handle), "ordinary mesh removal invalidates its checked handle");
    testing::check(!g3::mesh_remove(handle) && g3::node_add(mesh) == -1, "removed mesh IDs cannot be removed twice or attached again");
    let stale_node = g3::node_group();
    g3::node(stale_node).mesh = mesh;
    g3::frame(1.0 / 60.0);
    testing::check(g3::stats().nodes == 0, "rendering skips a removed mesh assigned through a stale node reference");
    let arena_vertices = g3::g_verts.len;
    let arena_indices = g3::g_indices.len;
    var all_removed = true;
    for i in 100 {
        let next = g3::mesh_cube(1.0 + i * 0.001);
        if !g3::mesh_remove(g3::mesh_handle(next)) { all_removed = false; }
    }
    testing::check(all_removed && g3::g_verts.len == arena_vertices && g3::g_indices.len == arena_indices,
        "repeated ordinary mesh creation reuses released geometry spans");
}

fn case_ordinary_texture_removal() {
    g3::scene_clear();
    g3::set_environment_map(-1, 0.0);
    let pixels: u8[4] = [255, 128, 64, 255];
    let texture = g3::texture_create(1, 1, pixels[..]);
    let handle = g3::texture_handle(texture);
    let node = g3::node_group();
    g3::node(node).texture = texture;
    testing::check(!g3::texture_remove(handle), "a texture referenced by a live node cannot be removed");
    g3::node(node).texture = -1;
    let material = g3::material_add();
    g3::material(material).normal_texture = texture;
    testing::check(!g3::texture_remove(handle), "a texture referenced by a live material cannot be removed");
    g3::material(material).normal_texture = -1;
    g3::material(material).clearcoat_texture = texture;
    testing::check(!g3::texture_remove(handle), "a clearcoat strength map keeps its texture alive");
    g3::material(material).clearcoat_texture = -1;
    g3::material(material).clearcoat_roughness_texture = texture;
    testing::check(!g3::texture_remove(handle), "a clearcoat roughness map keeps its texture alive");
    g3::material(material).clearcoat_roughness_texture = -1;
    g3::material(material).clearcoat_normal_texture = texture;
    testing::check(!g3::texture_remove(handle), "a clearcoat normal map keeps its texture alive");
    g3::material(material).clearcoat_normal_texture = -1;
    g3::material(material).sheen_color_texture = texture;
    testing::check(!g3::texture_remove(handle), "a sheen color map keeps its texture alive");
    g3::material(material).sheen_color_texture = -1;
    g3::material(material).sheen_roughness_texture = texture;
    testing::check(!g3::texture_remove(handle), "a sheen roughness map keeps its texture alive");
    g3::material(material).sheen_roughness_texture = -1;
    g3::material(material).anisotropy_texture = texture;
    testing::check(!g3::texture_remove(handle), "an anisotropy direction map keeps its texture alive");
    g3::material_remove(material);
    g3::set_environment_map(texture, 1.0);
    testing::check(!g3::texture_remove(handle), "the active environment texture cannot be removed");
    g3::set_environment_map(-1, 0.0);
    testing::check(g3::texture_remove(handle) && !g3::texture_handle_valid(handle),
        "ordinary texture removal frees backend storage and invalidates its handle");
    testing::check(!g3::texture_remove(handle) && !g3::texture_set_wrap(texture, 0, 0),
        "removed texture IDs cannot be removed twice or modified");
    let replacement = g3::texture_create(1, 1, pixels[..]);
    testing::check(replacement > texture, "ordinary texture IDs remain stable after removal");
}

fn case_mesh_compaction() {
    g3::scene_clear();
    flat_camera();
    let first = g3::mesh_sphere(1.0, 8, 12);
    let removed = g3::mesh_sphere(0.5, 8, 12);
    let last = g3::mesh_sphere(0.75, 8, 12);
    let first_node = g3::node_add(first);
    let last_node = g3::node_add(last);
    g3::node(first_node).unlit = true;
    g3::node(last_node).unlit = true;
    testing::check(g3::mesh_remove(g3::mesh_handle(removed)), "remove an unreferenced mesh before compaction");
    g3::mesh_compact();

    var live_vertices: i64 = 0;
    var live_indices: i64 = 0;
    for m in g3::g_meshes { if !m.asset_free && !m.removed { live_vertices += m.vertex_count; live_indices += m.index_count; } }
    var vertex_tail = false;
    var index_tail = false;
    for span in g3::g_free_spans {
        if span.kind == 0 { vertex_tail = span.first == live_vertices && span.count == g3::g_verts.len - live_vertices; }
        if span.kind == 1 { index_tail = span.first == live_indices && span.count == g3::g_indices.len - live_indices; }
    }
    testing::check(vertex_tail && index_tail, "compaction packs live geometry and leaves reusable tail spans");
    let vertex_capacity = g3::g_verts.len;
    let index_capacity = g3::g_indices.len;
    let recycled = g3::mesh_sphere(0.5, 8, 12);
    let recycled_in_place = g3::g_verts.len == vertex_capacity && g3::g_indices.len == index_capacity;
    g3::mesh_remove(g3::mesh_handle(recycled));
    testing::check(recycled_in_place, "ordinary mesh creation allocates from compacted tail spans");
    g3::frame(1.0 / 60.0);
    testing::check(g3::stats().nodes == 2 && g3::stats().drawn == 2 && is_color(g3::read_pixel(200, 200), 255, 255, 255, 2),
        "compaction reuploads meshes so rendering and node IDs remain valid");
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
    let v = g3::Vertex { pos: float3 { 1.0, 2.0, 3.0 }, normal: float3 { 0.0, 0.0, 1.0 }, uv: float2 { 0.0, 0.0 }, tangent: float4_0, color: float4_1, .. };
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
    c.near = 0.1;
    c.aspect = 2.0;
    g3::frame(1.0 / 60.0);
    testing::check(g3::pick_screen(0.25, 0.0, 1.0).node == right && g3::pick_screen(0.5, 0.0, 1.0).node == -1,
        "orthographic picking honors authored xmag-to-ymag framing");
    testing::check(abs(g3::view_proj_matrix().m[0] - 0.25) < 0.001,
        "orthographic projection uses the authored width as well as height");
    c.aspect = 0.0;
    c.orthographic = false;
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
    testing::check(g3::camera_remove(orthographic) && g3::camera_count() == 1 && g3::camera_active() == perspective,
        "removing the active camera selects a remaining camera");
    testing::check(!g3::camera_select(orthographic) && !g3::camera_remove(orthographic),
        "removed camera IDs cannot be selected or removed twice");
    testing::check(g3::camera_remove(perspective) && g3::camera_count() == 0 && g3::camera_active() == -1,
        "removing the final camera leaves no active saved camera");
    let replacement = g3::camera_add();
    testing::check(replacement > orthographic && g3::camera_count() == 1 && g3::camera_active() == replacement,
        "new cameras get stable IDs after removed slots");
}

fn case_camera_pan() {
    g3::camera_orbit(0.0, 0.0, 10.0, float3_0);
    let perspective_scale = 2.0 * 10.0 * tan(0.45) / 400.0;
    testing::check(g3::camera_pan(100.0, 50.0, 400) &&
        abs(g3::camera().target.x + 100.0 * perspective_scale) < 0.0001 &&
        abs(g3::camera().target.y - 50.0 * perspective_scale) < 0.0001 &&
        length((g3::camera().pos - g3::camera().target) - float3 { 0.0, 0.0, 10.0 }) < 0.0001,
        "perspective panning follows drag direction and scales with distance");
    g3::camera_orbit(0.0, 0.0, 10.0, float3_0);
    g3::camera().orthographic = true;
    g3::camera().ortho_height = 8.0;
    testing::check(g3::camera_pan(50.0, 100.0, 400) &&
        abs(g3::camera().target.x + 1.0) < 0.0001 && abs(g3::camera().target.y - 2.0) < 0.0001,
        "orthographic panning scales with the visible world height");
    testing::check(!g3::camera_pan(1.0, 1.0, 0), "camera panning rejects a zero-height viewport");
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
    let asset = g3::material_asset_add();
    let stale = g3::material_handle(asset);
    g3::node(left).material = asset;
    testing::check(!g3::material_remove(asset) && g3::material_asset_release(stale) && g3::node(left).material == -1,
        "asset material release requires ownership and detaches nodes");
    let reused = g3::material_asset_add();
    let current = g3::material_handle(reused);
    testing::check(reused == asset && !g3::material_handle_valid(stale) && g3::material_handle_valid(current) &&
        !g3::material_asset_release(stale), "reused asset material rejects a stale handle");
    g3::material_asset_release(current);
    let material_count = g3::g_materials.len;
    for i in 100 {
        let loaded = g3::material_asset_add();
        g3::material_asset_release(g3::material_handle(loaded));
    }
    testing::check(g3::g_materials.len == material_count, "repeated asset material loads reuse bounded storage");
    g3::camera().orthographic = false;
}

// At normal incidence, roughness 1 gives GGX D=1/pi and Smith V=1/4.
// With light 0.5, base 0.5 and dielectric F0=0.04, output is
// 0.5 * (0.96 * 0.5 / pi + 0.04 / (4*pi)) = 0.078, or 20/255.
fn case_pbr() {
    g3::scene_clear();
    flat_camera();
    g3::set_ambient(float3_0, 0.0);
    g3::set_environment(float3_0, float3_0, 0.0);
    g3::set_environment_map(-1, 0.0);
    g3::clear_lights();
    g3::set_light(float3 { 0.0, 0.0, -1.0 }, float3 { 0.5, 0.5, 0.5 });
    g3::camera().orthographic = true;
    let node = g3::node_add(g3::mesh_cube(1.0));
    let mat = g3::material_add();
    g3::node(node).material = mat;
    g3::material(mat).pbr = true;
    g3::material(mat).metallic = 0.0;
    g3::material(mat).roughness = 1.0;
    g3::material(mat).color = float4 { 0.5, 0.5, 0.5, 1.0 };
    g3::frame(1.0 / 60.0);
    testing::check(is_color(g3::read_pixel(200, 200), 20, 20, 20, 2), "PBR dielectric matches normal-incidence GGX calculation");
    g3::material(mat).roughness = 0.5;
    g3::material(mat).metallic = 1.0;
    g3::material(mat).color = float4_1;
    g3::frame(1.0 / 60.0);
    let isotropic = g3::read_pixel(200, 200);
    g3::material(mat).anisotropy_strength = 1.0;
    g3::frame(1.0 / 60.0);
    let anisotropic = g3::read_pixel(200, 200);
    testing::check(channel(anisotropic, 16) + 1 < channel(isotropic, 16),
        "full anisotropy redistributes the normal-incidence metallic highlight");
    let zero_strength_pixels: u8[4] = [255, 128, 0, 255];
    let zero_strength_map = g3::texture_create(1, 1, zero_strength_pixels[..]);
    g3::material(mat).anisotropy_texture = zero_strength_map;
    g3::frame(1.0 / 60.0);
    let map_off = g3::read_pixel(200, 200);
    testing::check(abs(channel(map_off, 16) - channel(isotropic, 16)) <= 1,
        "anisotropy texture blue channel scales the strength to zero");
    let direction_x_pixels: u8[4] = [255, 128, 255, 255];
    let direction_y_pixels: u8[4] = [128, 255, 255, 255];
    let direction_x_map = g3::texture_create(1, 1, direction_x_pixels[..]);
    let direction_y_map = g3::texture_create(1, 1, direction_y_pixels[..]);
    g3::set_light(float3 { -0.6, 0.0, -0.8 }, float3_1);
    g3::material(mat).anisotropy_texture = direction_x_map;
    g3::frame(1.0 / 60.0);
    let direction_x = g3::read_pixel(200, 200);
    g3::material(mat).anisotropy_texture = direction_y_map;
    g3::frame(1.0 / 60.0);
    let direction_y = g3::read_pixel(200, 200);
    testing::check(abs(channel(direction_x, 16) - channel(direction_y, 16)) > 2,
        "anisotropy texture red and green channels rotate the stretched highlight");
    g3::material(mat).anisotropy_texture = -1;
    g3::texture_remove(g3::texture_handle(zero_strength_map));
    g3::texture_remove(g3::texture_handle(direction_x_map));
    g3::texture_remove(g3::texture_handle(direction_y_map));
    g3::set_light(float3 { 0.0, 0.0, -1.0 }, float3 { 0.5, 0.5, 0.5 });
    g3::material(mat).anisotropy_strength = 0.0;
    g3::material(mat).metallic = 0.0;
    g3::material(mat).roughness = 1.0;
    g3::material(mat).color = float4 { 0.5, 0.5, 0.5, 1.0 };
    // At normal incidence, clearcoat F0=0.04 adds a roughness-0.5 GGX
    // highlight (0.04 * D * V * 0.5 = 0.0255) and attenuates the base by 0.96.
    g3::material(mat).clearcoat_factor = 1.0;
    g3::material(mat).clearcoat_roughness = 0.5;
    g3::frame(1.0 / 60.0);
    testing::check(is_color(g3::read_pixel(200, 200), 26, 26, 26, 2), "clearcoat adds a GGX top layer and Fresnel attenuates the base");
    let clearcoat_off: u8[4] = [0, 255, 255, 255];
    g3::material(mat).clearcoat_texture = g3::texture_create(1, 1, clearcoat_off[..]);
    g3::frame(1.0 / 60.0);
    testing::check(is_color(g3::read_pixel(200, 200), 20, 20, 20, 2), "clearcoat strength map red channel disables the top layer");
    let clearcoat_on: u8[4] = [255, 0, 0, 255];
    g3::material(mat).clearcoat_texture = g3::texture_create(1, 1, clearcoat_on[..]);
    g3::material(mat).clearcoat_roughness_texture = g3::texture_create(1, 1, clearcoat_on[..]);
    g3::frame(1.0 / 60.0);
    testing::check(is_color(g3::read_pixel(200, 200), 255, 255, 255, 2), "clearcoat roughness map green channel sharpens the top highlight");
    let clearcoat_normal: u8[4] = [255, 128, 128, 255];
    g3::material(mat).clearcoat_roughness_texture = -1;
    g3::material(mat).clearcoat_normal_texture = g3::texture_create(1, 1, clearcoat_normal[..]);
    g3::frame(1.0 / 60.0);
    testing::check(is_color(g3::read_pixel(200, 200), 0, 0, 0, 2), "clearcoat normal map changes only the coat lighting frame");
    g3::material(mat).clearcoat_factor = 0.0;
    g3::material(mat).clearcoat_texture = -1;
    g3::material(mat).clearcoat_roughness_texture = -1;
    // Charlie sheen is zero at normal incidence; the angled light produces a
    // grazing response that only raises the red channel of this red cloth.
    g3::set_light(float3 { -0.6, 0.0, -0.8 }, float3 { 0.5, 0.5, 0.5 });
    g3::material(mat).sheen_roughness = 0.5;
    g3::frame(1.0 / 60.0);
    let sheen_base = g3::read_pixel(200, 200);
    g3::material(mat).sheen_color = float3 { 1.0, 0.0, 0.0 };
    g3::frame(1.0 / 60.0);
    let sheen_red = g3::read_pixel(200, 200);
    testing::check(channel(sheen_red, 16) > channel(sheen_base, 16) &&
        abs(channel(sheen_red, 8) - channel(sheen_base, 8)) <= 1 &&
        abs(channel(sheen_red, 0) - channel(sheen_base, 0)) <= 1,
        "sheen adds a coloured grazing-angle reflection");
    let roughness_zero: u8[4] = [255, 255, 255, 0];
    g3::material(mat).sheen_roughness_texture = g3::texture_create(1, 1, roughness_zero[..]);
    g3::frame(1.0 / 60.0);
    let sheen_smooth = g3::read_pixel(200, 200);
    let roughness_one: u8[4] = [0, 0, 0, 255];
    g3::material(mat).sheen_roughness_texture = g3::texture_create(1, 1, roughness_one[..]);
    g3::frame(1.0 / 60.0);
    let sheen_rough = g3::read_pixel(200, 200);
    testing::check(abs(channel(sheen_smooth, 16) - channel(sheen_rough, 16)) > 1,
        "sheen roughness map alpha changes the lobe width");
    let sheen_off: u8[4] = [0, 0, 0, 255];
    g3::material(mat).sheen_color_texture = g3::texture_create(1, 1, sheen_off[..]);
    g3::frame(1.0 / 60.0);
    testing::check(is_color(g3::read_pixel(200, 200), channel(sheen_base, 16), channel(sheen_base, 8), channel(sheen_base, 0), 1),
        "sheen color map multiplies its RGB factor");
    g3::material(mat).sheen_color_texture = -1;
    g3::material(mat).sheen_color = float3_0;
    g3::material(mat).sheen_roughness_texture = -1;
    g3::set_light(float3 { 0.0, 0.0, -1.0 }, float3 { 0.5, 0.5, 0.5 });
    // At IOR 2.333, dielectric F0 is about 0.16. For roughness 1 the
    // normal-incidence response is 0.5 * (0.84*0.5/pi + 0.16/(4*pi))
    // = 0.0732, or 19/255.
    g3::material(mat).ior = 2.333;
    g3::frame(1.0 / 60.0);
    testing::check(is_color(g3::read_pixel(200, 200), 19, 19, 19, 0), "IOR controls dielectric reflectance in direct lighting");
    g3::material(mat).ior = 1.5;
    g3::material(mat).metallic = 1.0;
    g3::material(mat).color = float4 { 0.8, 0.4, 0.2, 1.0 };
    g3::frame(1.0 / 60.0);
    testing::check(is_color(g3::read_pixel(200, 200), 8, 4, 2, 2), "PBR metal has coloured specular and no diffuse term");
    let packed_mr: u8[4] = [255, 255, 0, 255];
    g3::material(mat).metallic_roughness_texture = g3::texture_create(1, 1, packed_mr[..]);
    g3::frame(1.0 / 60.0);
    testing::check(is_color(g3::read_pixel(200, 200), 32, 16, 8, 2), "metallic-roughness texture green controls roughness and blue controls metallic");
    packed_mr[2] = 255;
    g3::texture_create(1, 1, packed_mr[..]);
    g3::material(mat).metallic_roughness_texture = g3::g_texture_count - 1;
    g3::frame(1.0 / 60.0);
    testing::check(is_color(g3::read_pixel(200, 200), 8, 4, 2, 2), "metallic-roughness texture blue selects metallic response");
    g3::material(mat).roughness = 0.5;
    g3::frame(1.0 / 60.0);
    testing::check(is_color(g3::read_pixel(200, 200), 130, 65, 32, 3), "lower roughness sharpens the normal-incidence highlight");
    g3::material(mat).roughness = 1.0;
    g3::add_directional_light(float3 { 0.0, 0.0, -1.0 }, float3 { 0.5, 0.5, 0.5 });
    g3::frame(1.0 / 60.0);
    testing::check(is_color(g3::read_pixel(200, 200), 16, 8, 4, 2), "additional lights use the PBR model");
    // The preceding 0.5 directional light yields (16, 8, 4). An unbounded
    // physical point light at distance 2 has 1/d^2 = 1/4 attenuation.
    g3::clear_lights();
    g3::set_light(float3 { 0.0, 0.0, -1.0 }, float3_0);
    let physical_pbr = g3::add_point_light_physical(float3 { 0.0, 0.0, 3.0 }, float3 { 0.5, 0.5, 0.5 }, 0.0);
    g3::frame(1.0 / 60.0);
    testing::check(physical_pbr && is_color(g3::read_pixel(200, 200), 4, 2, 1, 2),
                   "inverse-square attenuation scales direct PBR lighting");
    g3::camera().orthographic = false;
    g3::material_remove(mat);
}

// A tangent-space +X normal on a +Z triangle receives full +X directional
// light; without the normal map its diffuse response is zero.
fn case_normal_map() {
    g3::scene_clear();
    flat_camera();
    g3::set_ambient(float3_0, 0.0);
    g3::set_environment(float3_0, float3_0, 0.0);
    g3::set_environment_map(-1, 0.0);
    g3::clear_lights();
    g3::set_light(float3 { -1.0, 0.0, 0.0 }, float3_1);
    let fv = g3::g_verts.len;
    let fi = g3::g_indices.len;
    let normal = float3 { 0.0, 0.0, 1.0 };
    g3::push_vertex_uv(float3 { -1.0, -1.0, 0.0 }, normal, float2 { 0.0, 0.0 });
    g3::push_vertex_uv(float3 { 1.0, -1.0, 0.0 }, normal, float2 { 1.0, 0.0 });
    g3::push_vertex_uv(float3 { 0.0, 1.0, 0.0 }, normal, float2 { 0.5, 1.0 });
    g3::push_triangle(0, 1, 2);
    let node = g3::node_add(g3::mesh_close(fv, fi));
    let mat = g3::material_add();
    g3::node(node).material = mat;
    g3::material(mat).color = float4_1;
    g3::material(mat).spec = 0.0;
    let normal_pixels: u8[4] = [255, 128, 128, 255];
    g3::material(mat).normal_texture = g3::texture_create(1, 1, normal_pixels[..]);
    g3::frame(1.0 / 60.0);
    testing::check(is_color(g3::read_pixel(200, 200), 255, 255, 255, 2), "normal map rotates the surface normal into tangent-space +X light");

    // An authored tangent overrides the derivative-derived +X frame: with a
    // +Y tangent-space direction and +Y light, the center pixel is fully lit.
    g3::scene_clear();
    flat_camera();
    g3::set_ambient(float3_0, 0.0);
    g3::set_environment(float3_0, float3_0, 0.0);
    g3::set_environment_map(-1, 0.0);
    g3::clear_lights();
    g3::set_light(float3 { 0.0, -1.0, 0.0 }, float3_1);
    let fv2 = g3::g_verts.len;
    let fi2 = g3::g_indices.len;
    let authored_tangent = float4 { 0.0, 1.0, 0.0, -1.0 };
    g3::push_vertex_uv_tangent(float3 { -1.0, -1.0, 0.0 }, normal, float2 { 0.0, 0.0 }, authored_tangent);
    g3::push_vertex_uv_tangent(float3 { 1.0, -1.0, 0.0 }, normal, float2 { 1.0, 0.0 }, authored_tangent);
    g3::push_vertex_uv_tangent(float3 { 0.0, 1.0, 0.0 }, normal, float2 { 0.5, 1.0 }, authored_tangent);
    g3::push_triangle(0, 1, 2);
    let authored_node = g3::node_add(g3::mesh_close(fv2, fi2));
    let authored_material = g3::material_add();
    g3::node(authored_node).material = authored_material;
    g3::material(authored_material).color = float4_1;
    g3::material(authored_material).spec = 0.0;
    g3::material(authored_material).normal_texture = g3::texture_create(1, 1, normal_pixels[..]);
    g3::frame(1.0 / 60.0);
    testing::check(is_color(g3::read_pixel(200, 200), 255, 255, 255, 2), "authored tangent controls the normal-map frame");
}

// The environment map's +Z texel is white: a smooth metal reflects it at
// full strength. Roughness one selects the generated 1x1 average mip (50%).
fn case_environment_specular() {
    g3::scene_clear();
    flat_camera();
    g3::set_ambient(float3_0, 0.0);
    g3::set_environment(float3_0, float3_0, 0.0);
    g3::set_environment_map(-1, 0.0);
    g3::clear_lights();
    g3::set_light(float3 { 0.0, 0.0, -1.0 }, float3_0);
    let fv = g3::g_verts.len;
    let fi = g3::g_indices.len;
    let normal = float3 { 0.0, 0.0, 1.0 };
    g3::push_vertex_uv(float3 { -1.0, -1.0, 0.0 }, normal, float2 { 0.0, 0.0 });
    g3::push_vertex_uv(float3 { 1.0, -1.0, 0.0 }, normal, float2 { 1.0, 0.0 });
    g3::push_vertex_uv(float3 { 0.0, 1.0, 0.0 }, normal, float2 { 0.5, 1.0 });
    g3::push_triangle(0, 1, 2);
    let node = g3::node_add(g3::mesh_close(fv, fi));
    let mat = g3::material_add();
    g3::node(node).material = mat;
    g3::material(mat).pbr = true;
    g3::material(mat).metallic = 1.0;
    g3::material(mat).roughness = 0.045;
    g3::material(mat).color = float4_1;
    let pixels: u8[8] = [0, 0, 0, 255, 255, 255, 255, 255];
    let env = g3::texture_create(2, 1, pixels[..]);
    g3::texture_set_wrap(env, g3::WRAP_REPEAT, g3::WRAP_CLAMP);
    g3::set_environment_map(env, 1.0);
    g3::frame(1.0 / 60.0);
    // With F0=1, the near-smooth normal-incidence lobe retains nearly all of
    // the white source texel. At roughness 1 the lobe spans both longitude
    // halves; the split-sum BRDF reduces the result below one quarter of sharp.
    let sharp = g3::read_pixel(200, 200);
    testing::check(channel(sharp, 16) > 240 && channel(sharp, 8) > 240 && channel(sharp, 0) > 240,
                   "smooth metal retains nearly full white environment reflection");
    g3::material(mat).roughness = 1.0;
    g3::frame(1.0 / 60.0);
    let rough = g3::read_pixel(200, 200);
    testing::check(channel(rough, 16) > 0 && channel(rough, 16) * 4 < channel(sharp, 16) &&
                   abs(channel(rough, 16) - channel(rough, 8)) <= 1 && abs(channel(rough, 8) - channel(rough, 0)) <= 1,
                   "rough metal gets a dim, neutral response from the averaged environment mip");
    // Keep diffuse environment light fixed and dim so the Fresnel reflection
    // remains below clipping; changing IOR must strengthen the environment lobe.
    g3::material(mat).metallic = 0.0;
    g3::material(mat).roughness = 0.045;
    g3::material(mat).ior = 1.5;
    g3::set_environment_map(env, 0.1);
    g3::frame(1.0 / 60.0);
    let dielectric_low_ior = g3::read_pixel(200, 200);
    g3::material(mat).ior = 2.333;
    g3::frame(1.0 / 60.0);
    let dielectric_high_ior = g3::read_pixel(200, 200);
    testing::check(channel(dielectric_high_ior, 16) > channel(dielectric_low_ior, 16) + 2,
                   "IOR controls dielectric environment reflection");
}

// A grazing view of a white environment map contributes the coloured sheen
// Fresnel response even with black base colour and no direct light.
fn case_environment_sheen() {
    g3::scene_clear();
    flat_camera();
    g3::set_ambient(float3_0, 0.0);
    g3::set_environment(float3_0, float3_0, 0.0);
    g3::clear_lights();
    g3::set_light(float3 { 0.0, 0.0, -1.0 }, float3_0);
    let fv = g3::g_verts.len;
    let fi = g3::g_indices.len;
    let normal = float3 { 0.8660254, 0.0, 0.5 };
    g3::push_vertex_uv(float3 { -1.0, -1.0, 0.0 }, normal, float2 { 0.0, 0.0 });
    g3::push_vertex_uv(float3 { 1.0, -1.0, 0.0 }, normal, float2 { 1.0, 0.0 });
    g3::push_vertex_uv(float3 { 0.0, 1.0, 0.0 }, normal, float2 { 0.5, 1.0 });
    g3::push_triangle(0, 1, 2);
    let node = g3::node_add(g3::mesh_close(fv, fi));
    let mat = g3::material_add();
    g3::node(node).material = mat;
    g3::material(mat).pbr = true;
    g3::material(mat).metallic = 0.0;
    g3::material(mat).color = float4 { 0.0, 0.0, 0.0, 1.0 };
    g3::material(mat).sheen_color = float3 { 1.0, 0.0, 0.0 };
    g3::material(mat).sheen_roughness = 0.5;
    let white: u8[4] = [255, 255, 255, 255];
    let env = g3::texture_create(1, 1, white[..]);
    g3::set_environment_map(env, 1.0);
    g3::frame(1.0 / 60.0);
    let pixel = g3::read_pixel(200, 200);
    testing::check(channel(pixel, 16) > channel(pixel, 8) + 2 &&
        abs(channel(pixel, 8) - channel(pixel, 0)) <= 1,
        "environment map adds a coloured grazing sheen reflection");
}

// glTF occlusion reduces indirect ambient light according to strength, while
// leaving direct illumination untouched.
fn case_occlusion_map() {
    g3::scene_clear();
    flat_camera();
    g3::set_environment(float3_0, float3_0, 0.0);
    g3::set_environment_map(-1, 0.0);
    g3::clear_lights();
    g3::set_ambient(float3_1, 1.0);
    g3::set_light(float3 { 0.0, 0.0, -1.0 }, float3_0);
    let fv = g3::g_verts.len;
    let fi = g3::g_indices.len;
    let normal = float3 { 0.0, 0.0, 1.0 };
    g3::push_vertex_uv(float3 { -1.0, -1.0, 0.0 }, normal, float2 { 0.0, 0.0 });
    g3::push_vertex_uv(float3 { 1.0, -1.0, 0.0 }, normal, float2 { 1.0, 0.0 });
    g3::push_vertex_uv(float3 { 0.0, 1.0, 0.0 }, normal, float2 { 0.5, 1.0 });
    g3::push_triangle(0, 1, 2);
    let node = g3::node_add(g3::mesh_close(fv, fi));
    let mat = g3::material_add();
    g3::node(node).material = mat;
    g3::material(mat).color = float4_1;
    g3::material(mat).spec = 0.0;
    g3::material(mat).pbr = true;
    g3::material(mat).metallic = 0.0;
    g3::material(mat).roughness = 1.0;
    let ao_pixels: u8[4] = [128, 128, 128, 255];
    g3::material(mat).occlusion_texture = g3::texture_create(1, 1, ao_pixels[..]);
    g3::material(mat).occlusion_strength = 1.0;
    g3::frame(1.0 / 60.0);
    testing::check(is_color(g3::read_pixel(200, 200), 128, 128, 128, 2), "occlusion map attenuates ambient illumination");
    g3::set_ambient(float3_0, 0.0);
    g3::set_light(float3 { 0.0, 0.0, -1.0 }, float3_1);
    g3::material(mat).pbr = false;
    g3::frame(1.0 / 60.0);
    testing::check(is_color(g3::read_pixel(200, 200), 255, 255, 255, 2), "occlusion map leaves direct light intact");
    g3::set_ambient(float3_1, 1.0);
    g3::set_light(float3 { 0.0, 0.0, -1.0 }, float3_0);
    g3::material(mat).occlusion_strength = 0.0;
    g3::frame(1.0 / 60.0);
    testing::check(is_color(g3::read_pixel(200, 200), 255, 255, 255, 2), "zero occlusion strength restores ambient light");
}

// With lighting disabled, linear emissive texture RGB times its factor is
// added directly to the surface. 128/64/32 texels times 0.5 round to 64/32/16.
fn case_emissive_material() {
    g3::scene_clear();
    flat_camera();
    g3::set_ambient(float3_0, 0.0);
    g3::set_environment(float3_0, float3_0, 0.0);
    g3::set_environment_map(-1, 0.0);
    g3::clear_lights();
    g3::set_light(float3 { 0.0, 0.0, -1.0 }, float3_0);
    let node = g3::node_add(uv_triangle(0.0, 0.0));
    let mat = g3::material_add();
    g3::node(node).material = mat;
    g3::material(mat).emissive = float3 { 0.5, 0.5, 0.5 };
    let pixels: u8[4] = [128, 64, 32, 255];
    g3::material(mat).emissive_texture = g3::texture_create(1, 1, pixels[..]);
    g3::frame(1.0 / 60.0);
    testing::check(is_color(g3::read_pixel(200, 200), 64, 32, 16, 2), "emissive texture is multiplied by its linear factor");
}

// Moving this retained triangle by half a unit puts its interior at x=0.5
// (pixel 241 at depth 5); pixel 188 at depth 5 is clearly outside the moved
// triangle. This checks both the updated CPU arena and backend mesh upload.
fn case_asset_mesh_update() {
    g3::scene_clear();
    flat_camera();
    let verts: g3::Vertex[3] = [
        g3::Vertex { pos: float3 { -1.0, -1.0, 0.0 }, normal: float3 { 0.0, 0.0, 1.0 }, uv: float2_0, tangent: float4_0, color: float4_1, .. },
        g3::Vertex { pos: float3 { 1.0, -1.0, 0.0 }, normal: float3 { 0.0, 0.0, 1.0 }, uv: float2_0, tangent: float4_0, color: float4_1, .. },
        g3::Vertex { pos: float3 { 0.0, 1.0, 0.0 }, normal: float3 { 0.0, 0.0, 1.0 }, uv: float2_0, tangent: float4_0, color: float4_1, .. },
    ];
    let indices: u32[3] = [0, 1, 2];
    let mesh = g3::mesh_asset_create(verts[..], indices[..]);
    let positions: f32[9] = [-0.5, -1.0, 0.0, 1.5, -1.0, 0.0, 0.5, 1.0, 0.0];
    let normals: f32[9] = [0.0, 0.0, 1.0, 0.0, 0.0, 1.0, 0.0, 0.0, 1.0];
    let tangents: f32[12] = [1.0, 0.0, 0.0, 1.0, 1.0, 0.0, 0.0, 1.0, 1.0, 0.0, 0.0, 1.0];
    testing::check(g3::mesh_asset_update(mesh, positions[..], normals[..], tangents[..]),
        "asset mesh deformation accepts matching finite position, normal, and tangent buffers");
    testing::check(g3::g_verts[g3::mesh(mesh).first_vertex].tangent.x == 1.0 &&
        g3::g_verts[g3::mesh(mesh).first_vertex].tangent.w == 1.0,
        "asset mesh deformation updates retained tangent directions and handedness");
    testing::check(g3::mesh(mesh).bounds.lo.x == -0.5 && g3::mesh(mesh).bounds.hi.x == 1.5,
                    "asset mesh deformation refreshes local bounds");
    let node = g3::node_add(mesh);
    g3::node(node).color = float4_1;
    g3::node(node).spec = 0.0;
    g3::frame(1.0 / 60.0);
    testing::check(is_color(g3::read_pixel(241, 200), 255, 255, 255, 2), "updated vertex data renders at its deformed position");
    testing::check(is_color(g3::read_pixel(188, 200), 255, 0, 255, 2), "the original left-side position is no longer rendered");
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
    case_vertex_colors();
    case_native_hdr_load();
    case_native_glb_load();
    case_texture_alpha();
    case_texture_wrap();
    case_texture_filter();
    case_color_space();
    case_tone_mapping();
    case_fxaa();
    case_render_target();
    case_lights();
    case_shadow();
    case_point_shadow();
    case_spot_shadow();
    case_clipping();
    case_normal_transform();
    case_asset_reuse();
    case_node_epoch();
    case_node_removal();
    case_asset_fragmentation();
    case_picking();
    case_orthographic_camera();
    case_multiple_cameras();
    case_camera_pan();
    case_shared_material();
    case_pbr();
    case_normal_map();
    case_environment_specular();
    case_environment_sheen();
    case_occlusion_map();
    case_emissive_material();
    case_asset_mesh_update();
    case_ordinary_mesh_removal();
    case_ordinary_texture_removal();
    case_mesh_compaction();

    g3::shutdown();
    if !testing::finish() { exit(1); }
}
