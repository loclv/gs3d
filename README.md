# goose-3d — a 3D engine for Goose, on the web

A small 3D engine written in [Goose](https://github.com/aardappel/goose), a memory-safe systems language without a heap or garbage collector. It runs in the browser through WebGPU or WebGL2, and headlessly through a CPU reference renderer.

```bash
./build_web.sh --serve # build and open http://localhost:8080/
./build_native.sh --test # build and run native checks
```

See [Getting started](docs/getting-started.md) for prerequisites, native rendering, and tests. The browser build prefers WebGPU and falls back to WebGL2; [Browser examples and benchmarks](docs/browser.md) covers the viewer, games, supported renderer features, and measurements.

## Three.js-compatible interface

The browser package provides a Three.js-style facade at `gs3d/three` (also
available as `gs3d/webgpu`). For applications using the supported subset, change
the import and initialize the renderer before rendering:

```js
import * as THREE from 'gs3d/three';

const canvas = document.createElement('canvas');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
await renderer.init();
renderer.setSize(window.innerWidth, window.innerHeight);
document.body.appendChild(renderer.domElement);

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(50, window.innerWidth / window.innerHeight, 0.1, 100);
camera.position.z = 5;
scene.add(new THREE.Mesh(new THREE.BoxGeometry(), new THREE.MeshBasicMaterial({ color: 0x44aa88 })));
renderer.setAnimationLoop(() => renderer.render(scene, camera));
```

The facade includes scene graphs, cameras, common geometries and materials,
lights, textures, raycasting, and orbit controls. It is a **subset**, not a
complete drop-in implementation of Three.js: some APIs, addons, shader and
material behavior, and rendering results differ. Both renderer classes require
an explicit canvas and `await renderer.init()` before rendering. The package also exposes its own
`gs3d/gltf-loader` asset API, which is not Three.js's `GLTFLoader` interface.
See the [Three.js roadmap](docs/threejs-roadmap.md) and
[browser documentation](docs/browser.md) for current capabilities and limits.

## Documentation

- [Project map](docs/project-map.md) — source files and their responsibilities.
- [Using the engine](docs/using-the-engine.md) — scene construction, API examples, and current limits.
- [Frame and backend overview](docs/readme-frame-flow.md) and [architecture](docs/architecture.md) — data flow, rendering, and design decisions.
- [Backend ABI](docs/abi.md) — packed structures, drawing rules, and backend integration.
- [Performance](docs/performance.md) — profiling and benchmark methods.
- [Assets](docs/assets.md) and [model authoring](docs/model-authoring.md) — loading and creating models.
- [Project ideals](docs/ideals.md) and [Three.js roadmap](docs/threejs-roadmap.md) — principles and planned work.

Repository-specific agent guides live in [.agents/skills](.agents/skills/).
