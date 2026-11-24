# Using the engine

```goose
import std;
import vec;
import math;
import g3.math;
import g3.platform;
import g3.mesh;
import g3.scene;
import g3.render;
import g3.engine;
import g3.physics;

fn main() {
    guard g3::init(1280, 720, "hello") else { return; }

    // Ordinary meshes live in two arenas and keep their numeric IDs.
    let cube = g3::mesh_cube(1.0);
    let ball = g3::mesh_sphere(0.5, 16, 24);

    // Attach a dynamic box and a static floor to scene nodes. Step physics
    // before rendering each frame; body positions are copied to their nodes.
    let player = g3::node_add(cube);
    let player_body = g3::physics_body_add(player, float3 { 0.5, 0.5, 0.5 }, 1.0);
    let floor = g3::node_add(g3::mesh_plane(10.0, 10.0));
    let floor_body = g3::physics_body_add(floor, float3 { 5.0, 0.1, 5.0 }, 0.0);
    g3::physics_body_set_restitution(player_body, 0.1);
    g3::physics_body_set_friction(player_body, 0.7);
    g3::physics_body_set_restitution(floor_body, 0.0);
    g3::physics_body_set_friction(floor_body, 0.8);

    // `node` returns a reference into the scene's arena: keep it and write
    // through it. `.=` binds the reference; `=` would copy the node.
    let n .= g3::node(g3::node_add(cube));
    n.pos = float3 { 0.0, 1.0, 0.0 };
    n.color = float4 { 0.9, 0.55, 0.25, 1.0 };
    n.spec = 0.3;
    n.shine = 32.0;

    // Parenting is an index, so hierarchies turn as one.
    let pivot = g3::node_group();
    let child = g3::node_add(ball);
    g3::node_parent(child, pivot);

    g3::set_light(float3 { -0.4, -0.8, -0.4 }, float3 { 1.0, 0.96, 0.88 });
    g3::set_ambient(float3 { 0.34, 0.38, 0.5 }, 0.7);
    g3::set_fog(float3 { 0.09, 0.1, 0.14 }, 0.002);
    g3::camera_orbit(0.6, 0.3, 8.0, float3 { 0.0, 1.0, 0.0 });

    loop {
        n.rot.y += 0.01;
        g3::physics_step(1.0 / 60.0);
        g3::frame(1.0 / 60.0);        // input, transforms, cull, sort, draw
        if g3::key_pressed(g3::KEY_ESCAPE) { break; }
    }
    g3::shutdown();
}
```

In the browser, the page owns the clock, so the root file has no loop: it
exports `g3_app_init(width, height)` and `g3_app_frame(dt)`, and `web/shell.js`
calls them (`src/app_web.goose` is 30 lines long).

What the API gives you:

* Physics — `import g3.physics`, attach an oriented box to a node with
  `physics_body_add(node, half_extents, mass)`, a sphere with
  `physics_body_add_sphere(node, radius, mass)`, or a capsule (a
  `half_length` cylinder capped by `radius` spheres, along the body's local
  Y) with `physics_body_add_capsule(node, radius, half_length, mass)`; call
  `physics_step(dt)` before `frame(dt)`. Colliders rotate with their body:
  the box uses a 15-axis SAT test, capsules follow the body's orientation,
  and `physics_step` writes both `pos` and `rot` back onto nodes. Mass zero
  makes a static collider. Gravity defaults to `(0, -9.81, 0)` and can be
  changed with `physics_set_gravity`; apply forces and torques for one step
  with `physics_apply_force`/`physics_apply_torque`, set velocities
  directly, and tune restitution and friction from 0 to 1. Pairwise overlap
  uses adaptive substeps (capped at 1/60 s, shrinking for fast bodies),
  positional correction, and normal impulses with full angular response;
  friction applies linearly. Bodies sleep automatically after resting
  briefly. `physics_body_remove(id)` tombstones a body without renumbering
  the others, `physics_body_set_mass` and `physics_body_set_kinematic`
  change it after creation — kinematic bodies follow their velocity and
  angular velocity exactly and push dynamic bodies without being pushed
  back — and `physics_body_sync(id)` adopts a node transform that gameplay
  code moved directly. `physics_contact_count()`/`physics_contact(i)` list
  the overlaps detected during the last step (ids, normal, world contact
  point, penetration), and `physics_raycast(origin, dir, max_dist)` returns
  the nearest `PhysicsRayHit` (body, distance, point, normal) against every
  live collider. `physics_clear()` removes all bodies. Nodes flagged
  `use_local_matrix` (asset and facade imports) work too: the solver
  decomposes the affine matrix into position/rotation/scale and writes the
  simulated transform back into it, preserving scale.
  `import g3.rapier` offers the same solver in RapierPhysics vocabulary —
  `rapier_body_add_cuboid/ball/capsule`, `rapier_set_timestep` +
  `rapier_world_step`, `rapier_body_translation/linvel/angvel` accessors,
  `rapier_body_rotation`/`set_rotation` (euler, node convention),
  `rapier_body_apply_impulse`/`apply_impulse_at`, `rapier_body_add_torque`,
  `rapier_body_set_translation` (teleports and zeroes velocity),
  `rapier_body_is_dynamic` (mass > 0), `rapier_body_set_kinematic`,
  `rapier_body_set_mass`, `rapier_body_remove`, `rapier_body_sync` and
  `rapier_world_raycast`. There is one collider per body.
* Meshes — `mesh_cube(half)`, `mesh_sphere(radius, rings, segments)`,
  `mesh_plane(size, tiles)`, plus `push_vertex`/`push_triangle`/`mesh_close`
  for your own geometry. Pushes stage one mesh and `mesh_close(fv, fi)` closes
  that batch; the two offset arguments remain accepted for source compatibility.
  `mesh_compact()` packs live geometry and reuploads it without changing mesh IDs.
  `mesh_handle` and `mesh_handle_valid` check ordinary
  and asset mesh IDs; call `mesh_remove(handle)` after removing all nodes that
  use an ordinary mesh. Removal releases backend geometry and makes its arena
  spans available to ordinary meshes and asset loads. Numeric mesh IDs are
  never reused.
* Textures — import `g3.texture`, call `texture_create(width, height, rgba)`
  with row-major RGBA8 pixels or `texture_create_hdr(width, height, rgba)` with
  linear RGBA32F pixels for HDR radiance, then select an environment with
  `set_environment_map`.
  `render_target_create(width, height)` creates a sampleable linear RGBA8
  texture with RGB clamped to 0..1 and opaque alpha. Select it with
  `render_target_set(id)` before `frame(dt)` and resize it with
  `render_target_resize(id, width, height)`; resizing clears its contents. Pass
  `-1` to return to the window. Targets keep their own size and can be removed
  with `render_target_remove(id)` after scene and material references are
  cleared. Render targets bypass screen tone mapping, sRGB output encoding, and
  FXAA; apply display effects after sampling the target. Sampling the active
  target in the same frame skips that item to avoid framebuffer feedback.
  `stats().feedback_items_suppressed` reports the skipped draw-item count for
  the current frame; the browser sample HUD shows it when nonzero.
  Texture coordinate v=0 addresses the bottom row of a render target.
  Targets are limited to 4,194,304 pixels each.
  `render_target_handle(id)` returns a generation-checked handle with matching
  `render_target_set_handle`, `render_target_resize_handle`, and
  `render_target_remove_handle` operations. `render_target_texture_id(handle)`
  returns the texture ID to assign to a node or material.
  `post_process_run(source, destination, effect)` applies a built-in
  `POST_PROCESS_COPY`, `POST_PROCESS_GRAYSCALE`, `POST_PROCESS_INVERT`, or
  `POST_PROCESS_FXAA` pass to a distinct render target. Chain calls to control
  pass order. These passes keep linear RGBA8 values and do not tone map or
  encode sRGB; use `set_fxaa` for the existing screen-output convenience pass.
  For deferred execution, `post_process_queue_add` (or
  `post_process_queue_add_shader`) appends a pass to a fixed eight-pass queue;
  `post_process_queue_execute` runs them in order and clears the queue.
  WebGL projects can create a fragment-body pass with
  `post_process_shader_create(body)`, run it with
  `post_process_shader_run(shader, source, destination)`, and release it with
  `post_process_shader_remove(shader)`. The GLSL ES 3.00 body can read `vec2 uv`,
  `vec4 color`, and `sampler2D g3_source`, then assign the output to `color`.
  Bodies are limited to 16 KiB and 64 shader IDs per engine lifetime; custom
  passes do not run on the CPU backend, which returns -1 at creation.
  `texture_handle` and `texture_handle_valid` check ordinary and asset textures;
  `texture_remove(handle)` releases an ordinary texture only when no live node,
  material or environment uses it. Asset textures are released by their owner.
  Built-in meshes have UVs and white vertex colours; custom `Vertex` values can
  set linear RGBA vertex colours. glTF `COLOR_0` multiplies the material base
  colour, and custom meshes can use `push_vertex_uv`,
  `push_vertex_uv_sets` for two UV sets, `push_vertex_uv_3sets` for three,
  `push_vertex_uv_8sets` for custom geometry with all eight,
  `push_vertex_uv_6sets` for six, or
  `push_vertex_uv_tangent` to provide a tangent and handedness for normal maps.
  Both backends support nearest, linear, and mipmapped filtering via
  `texture_set_filter`, and clamp, repeat, and mirrored repeat per axis via
  `texture_set_wrap`. Uploading pixels resets those settings. Raster image
  decoding belongs to the host; Radiance HDR is supported by the native API and
  browser asset loader. The game demonstrates browser-side decoding. Texture RGB
  multiplies the node colour. `node.alpha_mode` chooses colour-driven blending
  (0), an alpha cutoff (1), or blending (2). Masking and blending multiply
  texture alpha, vertex colour alpha and node colour alpha; opaque items ignore
  resulting alpha.
  Use `texture_create_srgb` for sRGB colour images; RGB is decoded before
  filtering and alpha stays linear. `set_output_srgb(true)` renders and blends
  in linear space before encoding the finished frame. Output encoding is opt-in
  for compatibility with existing scenes. `set_tone_mapping_mode(mode)` selects
  none, Reinhard, or ACES; `set_tone_mapping(true)` remains an ACES alias.
  `set_fxaa(true)` adds an optional full-screen edge-smoothing pass.
  `set_exposure(value)` sets the linear exposure multiplier (0–32). The CPU backend composites into a floating-point buffer;
  WebGL uses an RGBA16F target when floating-point color rendering and blending
  are available, and otherwise maps each fragment before blending. Tone mapping
  works with HDR lighting values. Browser projects can use `loadHDRImage`;
  native projects can load the supported Radiance RGBE subset with
  `texture_load_hdr(path)`.
* Nodes — `node_add(mesh)`, `node_group()`, `node(id) -> Node&`,
  `node_parent(child, parent)`, `scene_clear()`, and `node_count()`. A node has
  position, euler rotation, scale, colour, `unlit`, `visible`, specular
  strength and shininess. `node_handle(id)` and `node_handle_valid(handle)`
  add generation and scene-epoch checks for retained handles. Call
  `node_remove(handle)` to remove an ordinary node without releasing its mesh
  or texture. Its children are reparented to its former parent with their
  transforms preserved; their local transforms become baked matrices. Raw
  indices and references must not be used after removal or scene reset.
* Materials — `material_add()` creates a shared surface, and
  `material(id)` exposes its colour, texture, alpha, unlit and specular fields.
  Set `pbr = true` to use metallic-roughness direct lighting with `metallic`
  and `roughness` factors in [0, 1]; set `ior` (default 1.5) to adjust
  dielectric Fresnel reflectance. Assign a linear data texture to
  `metallic_roughness_texture` to modulate metallic and roughness from its B
  and G channels.
  Otherwise the legacy specular model applies.
  Assign the ID to `node.material` to use it on any number of nodes; edits
  affect each of them on the next frame. With `node.material = -1`, the node's
  own surface fields apply. `material_remove(id)` detaches the material from
  its nodes, which revert to their inline fields. Ordinary material IDs are not reused;
  materials and their textures are separate resources, and `scene_clear()`
  does not remove them. glTF materials are shared within each loaded model and
  their asset-owned slots are reused after disposal.
* Camera — `camera() -> Camera&` (fov, near, far, up), `camera_look_at`,
  `camera_orbit(yaw, pitch, distance, target)`, `camera_orbit_nudge`,
  `camera_zoom`. Set `camera().orthographic = true` and a positive
  `camera().ortho_height` (the full vertical extent in world units) for an
  orthographic view; set it to false to restore perspective. Width follows
  the viewport aspect ratio. Picking uses the selected projection.
  `camera_add()` saves a copy of the current camera and returns its ID;
  `camera_select(id)` saves the active camera's edits and restores that copy,
  including orbit state. `camera_remove(id)` invalidates the saved camera
  without changing other IDs; removing the active camera selects the first
  remaining camera, and removing the last leaves no active saved camera.
  `camera_count()` counts live cameras. IDs are append-only. The first added
  camera becomes active. Configure an inactive camera by selecting it first.
  Cameras persist across `scene_clear()`;
  `camera_active()` returns `-1` until the first is added. A reference returned
  by `camera()` refers to the active camera storage and should not be retained
  across a switch.
* Lighting — a primary directional light (`set_light`), up to eight extra
  directional, point or spot lights (`add_directional_light`, `add_point_light`,
  `add_spot_light`, `clear_lights`), ambient light and a hemispherical sky/ground
  fill (`set_ambient`, `set_environment`) or an equirectangular map uploaded
  with `texture_create` or `texture_create_hdr` and selected by
  `set_environment_map`, plus fog and background colour. The map is sampled
  along the surface normal for diffuse fill. Metallic-roughness
  materials reflect it using a GGX importance-sampled mip chain and a
  split-sum BRDF integration LUT. HDR input uses Radiance RGBE in browser
  builds; a skybox is not implemented.
  Add functions return false when parameters are invalid or the limit is reached.
  Point and spot lights use squared linear range falloff by default; their
  spot angles are inner and outer half-angles in radians.
  `add_point_light_physical` and `add_spot_light_physical` use inverse-square
  distance attenuation with the same smooth finite-range fade; passing range
  zero disables the cutoff for those physical lights.
  `set_directional_shadows(center,
  extent, bias)` enables a 512×512 shadow map for the primary directional
  light; `clear_shadows()` disables it. Call `set_point_light_shadows(index,
  bias)` after adding a point light to enable its six-face 512×512 shadow map;
  call `set_spot_light_shadows(index, bias)` after adding a spot light for its
  512×512 perspective map. Each API selects one extra light of its type, and
  both can be active at once. Spot outer half-angles must be under 90 degrees.
  `clear_point_light_shadows()` and `clear_spot_light_shadows()` disable those
  maps; `clear_lights()` clears both. All shadow maps use normalized depth
  bias and opaque or masked casters; blended objects do not cast shadows.
  `set_shadow_filter_radius(0..2)` chooses hard shadows, 3×3 PCF, or 5×5 PCF
  for all three shadow types; hard shadows are the default. Use
  `set_shadow_resolution(256|512|1024)` to choose map dimensions; 512 is the
  default.
* Frame — `init`, `frame(dt)`, `shutdown`, `width`/`height`/`aspect`/`time`,
  `stats()` (nodes, drawn, culled, triangles, draws), `read_pixel`,
  `save_frame` where the backend can write one.
* Input — `key_down`, `key_pressed`, `key_released` with `KEY_*` codes, and
  `mouse_dx`/`mouse_dy` deltas.

## A Goose trap worth knowing

`let c = g3::camera()` copies the camera, because a reference to a
fixed-size value decays to a copy when the variable's type is inferred. Writing
`c.pos = ...` then edits the copy and nothing moves. Use one of:

```goose
let c .= g3::camera();     // . binds the reference
g3::camera_look_at(p, q);  // or a function that writes the global itself
```

The engine's own code uses `.=` everywhere it means a reference, and the demo
and tests show both forms.

## Limits, and what would come next

Deliberately out of scope for now, in rough order of how much they would add:

* Partial PBR. Shared materials support metallic-roughness factors and
  maps, tangent-space normal maps for surface shading, and occlusion maps for
  indirect fill, plus emissive factors and textures. Static, skinned, and
  morphed glTF meshes use authored tangent attributes and tangent morph deltas
  for normal maps; meshes without authored tangents use a UV-derived frame.
  GGX-prefiltered environment lighting, Reinhard and ACES tone
  mapping, FXAA-style edge smoothing, exposure controls, and Radiance RGBE
  environment image loading are available. Full colour
  management remains incomplete.
* Limited shadows, environment lighting, and normals. The primary
  directional light, one selected extra point light, and one selected spot
  light cast shadows; PCF filtering has hard, 3×3, and 5×5 settings, and
  blended objects do not cast them. Map resolution is selectable from 256 to
  1024 pixels per face or spot map, directional shadows have explicit bounds,
  and shadow-enabled frames submit off-camera nodes so they can cast shadows.
  Environment textures provide diffuse fill and GGX-prefiltered reflections.
  Browser and native Radiance RGBE loaders preserve HDR radiance; a skybox is
  not available.
* WebGL deformation limits. WebGL morph targets support up to 64 targets
  per primitive and a 64 MiB delta-texture budget; larger or unsupported meshes
  fall back to CPU deformation. GPU skin palettes and GPU morph weights can
  combine, and CPU geometry remains synchronized for picking. The CPU reference
  backend always deforms on the CPU. Native glTF loading supports a static subset; see [Assets](assets.md) for browser asset support.
* Limited removal. Ordinary nodes can be removed and reused. Unreferenced
  ordinary meshes and textures can be removed; mesh backend allocations are
  freed and their arena spans can be reused by ordinary meshes and asset loads.
  Browser-loaded assets recycle their owned nodes, mesh spans, and texture IDs
  on disposal. `mesh_compact()` packs live geometry but retains arena capacity;
  mesh descriptor records remain append-only. `scene_clear()`
  clears the scene; asset handles are invalid after their owner is disposed.
* Singular transforms. A zero-scale transform has no inverse normal matrix;
  its surface normals become zero rather than receiving directional lighting.
* f32 only, and no frustum-cone/AABB hierarchy — culling is per node, which
  is fine to a few thousand nodes and would want a BVH beyond that.
