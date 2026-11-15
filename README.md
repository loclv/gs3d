# goose-3d — a 3D engine for Goose, on the web

A small 3D engine written in [Goose](https://github.com/aardappel/goose), a memory-safe systems language without a heap or garbage collector. It runs in the browser through WebGPU or WebGL2, and headlessly through a CPU reference renderer.

```bash
./build_web.sh --serve       # build and open http://localhost:8080/
./build_native.sh --test     # build and run native checks
```

See [Getting started](docs/getting-started.md) for prerequisites, native rendering, and tests. The browser build prefers WebGPU and falls back to WebGL2; [Browser examples and benchmarks](docs/browser.md) covers the viewer, games, supported renderer features, and measurements.

## Documentation

- [Project map](docs/project-map.md) — source files and their responsibilities.
- [Using the engine](docs/using-the-engine.md) — scene construction, API examples, and current limits.
- [Frame and backend overview](docs/readme-frame-flow.md) and [architecture](docs/architecture.md) — data flow, rendering, and design decisions.
- [Backend ABI](docs/abi.md) — packed structures, drawing rules, and backend integration.
- [Performance](docs/performance.md) — profiling and benchmark methods.
- [Assets](docs/assets.md) and [model authoring](docs/model-authoring.md) — loading and creating models.
- [Project ideals](docs/ideals.md) and [Three.js roadmap](docs/threejs-roadmap.md) — principles and planned work.

Repository-specific agent guides live in [.agents/skills](.agents/skills/).
