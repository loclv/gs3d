# Project map

## What's here

| Path | |
|---|---|
| `src/g3/math.goose` | column-major `Mat4`, transforms, perspective, AABB, frustum planes |
| `src/g3/mesh.goose` | the geometry arena and its primitives: cube, sphere, plane |
| `src/g3/scene.goose` | nodes, the parent hierarchy, the camera and its orbit controls |
| `src/g3/physics.goose` | rigid-body core: `PhysicsBody` + arenas, body lifecycle and property API, node↔body pose bridge, transforms/bounds, water level + buoyancy/drag |
| `src/g3/physics_solver.goose` | `physics_step`/substeps, integration, sweep-and-prune broadphase, warm-start, sequential-impulse solve |
| `src/g3/physics_contacts.goose` | `Contact` + SAT/manifold narrowphase for box/sphere/capsule pairs |
| `src/g3/physics_query.goose` | contact store/accessors and raycasts |
| `src/g3/rapier.goose` | RapierPhysics-style facade over `g3.physics`: timestep/step, cuboid/ball/capsule bodies, linvel/angvel/rotation and impulse accessors, body-type/mass/removal, raycast, water level |
| `src/g3/physics_web.goose` | `g3_phys_*` wasm exports of the rapier facade plus contacts and raycast for the `gs3d/physics` package module |
| `src/g3/render.goose` | per frame: transforms, frustum cull, draw-list pack, sort, submit |
| `src/g3/engine.goose` | `init` / `frame` / `shutdown`, input state, stats |
| `src/g3/gltf_native.goose` | native static GLB and JSON glTF scene and primitive loading into checked handles |
| `src/g3/texture_native.goose` | native PPM P6, PNG and JPEG decoding into checked sRGB textures with queryable load errors |
| `src/g3/platform.goose` | the backend contract: `DrawItem`, `ViewState`, the `g3p_*` calls |
| `src/demo/scene.goose` | the demo scene, written against the public API only |
| `src/app_web.goose` | the browser entry point (no `main`; exported `g3_app_*`) |
| `src/app_native.goose` | the headless entry point: builds, renders N frames, writes a PPM |
| `src/test_math.goose` | known-answer transforms, matrices and frustum planes, no backend |
| `src/test_engine.goose` | known-answer frames, checked by reading pixels back |
| `src/test_game.goose` | Beacon Run rules: scoring, win/lose, reset |
| `src/test_siege.goose` | Rift Siege rules plus the physics solver checks: colliders, contacts, raycasts, water |
| `src/benchmark_transforms.goose` | native transform benchmark |
| `src/benchmark_physics*.goose` | headless solver benchmarks |
| `src/game_web.goose` | Beacon Run browser entry point (`--game`) |
| `src/siege_web.goose` | Rift Siege browser entry point (`--siege`) |
| `src/viewer_web.goose` | model viewer and animation benchmark entry point |
| `src/gs3d_web.goose` | `gs3d` package facade entry point (`--gs3d`) |
| `src/benchmark_web.goose` | draw-call benchmark entry point (`--benchmark`) |
| `src/reference_web.goose` | WebGL API reference-checks entry point |
| `src/testing.goose` | the `check`/`finish` harness the test roots report through |
| `platform/g3_abi.h` | the C side of the contract, with static asserts on the layout |
| `platform/g3_input.{h,c}` | the key and mouse queue both backends share; each supplies only `g3_backend_resize` |
| `platform/g3_web.c` | the WebGL2 backend (Emscripten), scene and shadow shaders, opaque instancing, GPU skin and morph deformation |
| `platform/g3_webgpu.c`, `web/webgpu.js` | WebGPU backend and JavaScript WebGPU bridge used by the default landing page; WebGL2 remains its fallback |
| `platform/g3_soft.c` | the CPU backend: a z-buffered reference rasterizer, threaded over row blocks |
| `docs/` | `architecture.md`, `abi.md`, `performance.md`, `performance-scene-sync.md` — the reference detail |
| `.agents/skills/` | five `SKILL.md` guides for working in this repo (map, language, ABI, features, testing) |
| `web/index.html` | the page: a canvas, the stats line, and a status overlay |
| `web/shell.js` | boot and the frame loop — the order things happen in |
| `web/canvas.js`, `web/input.js`, `web/hud.js` | sizing in device pixels, events, and the two lines of text |
