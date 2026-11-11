---
name: goose-language-notes
description: Use when writing or fixing Goose (.goose) code in this repository — references vs copies, arenas without a heap, struct literals, conversions, build sidecars and the compiler warnings that catch mistakes here.
---

# Goose, as this repository uses it

Everything below was learned on this codebase and is checked against
Goose **v2026.3**, the version the repo builds with. When in doubt, the
language reference ships with the compiler: `$GOOSE_HOME/docs/reference.md`
(the archive also has `docs/packages.md` for sidecars and imports).

Goose is memory-safe, has **no heap and no garbage collector**, and is designed
so the compiler can prove absence of leaks and dangling references without
lifetime annotations. Most of its idioms follow from that.

## 1. Data lives in grow-only globals

There is no `new`, no `malloc`, no `Box`. A growable array declared as a global
is the engine's only dynamic storage:

```goose
var g_verts: Vertex[>..];      // growable array of Vertex
var g_indices: u32[>..];
var g_nodes: Node[>..];
```

* `T[>..]` is a growable array; `T[:]` is a slice (a view, read-only here);
  `T[N]` is a fixed array.
* Operations: `.push(x)`, `.len`, `.clear()`, indexing `arr[i]`, slicing
  `arr[a..b]` and `arr[..]` for the whole thing.
* **Growth never moves existing elements' identity.** An index into
  `g_nodes` stays valid forever, which is why a "handle" in this engine is just
  an `i64` index. Do not build parallel bookkeeping that assumes otherwise.
* Locals are fine (`var x = ...`), but nothing large and variable-sized goes on
  the stack: that is what the arenas are for.

## 2. References, and the copy trap that bites everyone

A function may return a reference: `fn node(id: i64) -> Node&`. Binding it with
`=` **copies the value** when the target's type is inferred:

```goose
let c = g3::camera();     // a COPY of the camera (fixed-size struct)
c.pos = whatever;         // edits the copy; the world does not move
```

Bind the reference explicitly with `.=`:

```goose
let c .= g3::camera();    // the reference itself
c.pos = whatever;         // edits the global
```

Rules of thumb used throughout this repo:

* Inside the engine, `node()`, `mesh()` and `camera()` all return references;
  code that writes through them uses `.=`.
* Public API functions that *mutate* (e.g. `camera_look_at`, `aabb_add(b, p)`
  with `b: Aabb&`) take or return references so callers cannot silently edit a
  copy.
* `let a, b = f()` is how a multi-return function is destructured:
  `fn pixel_of(x, y, z) -> i32, i32`.

Loop forms you will see:

```goose
for &n in g_nodes { ... }      // iterate by reference (writes visible)
for i in 16 { ... }            // i is i64, 0..15
for i in 0..count { ... }      // explicit range
while cond { ... }
loop { ... }                   // infinite; break inside
```

## 3. Control flow and errors

`guard <cond> else { ... }` is the idiomatic early exit and returns from the
function in the `else` block:

```goose
fn key_down(key: i32) -> bool {
    guard key_tracked(key) else { return false; }
    return g_keys[key];
}

guard g3::init(width, height, "title") else { return false; }
```

There are no exceptions. Failures are `bool`, or a flag out-parameter, or a
printed message plus `exit(1)` in a test root.

## 4. Structs

```goose
struct Node {
    mesh: i32 = -1,        // default value
    parent: i32 = -1,
    pos: float3,           // zero-initialised by default
    scale: float3 = float3_1,
    world: Mat4,           // filled per frame; do not set
}
```

* A struct literal may omit fields that have defaults, and `..` spreads the
  defaults in: `Node { mesh: id, .. }`, `g_stats = Stats { .. }` (a reset).
* `float3_0` / `float3_1` / `float4_1` come from `vec`.
* Structs are **packed with no padding**; a `Mat4` is exactly 64 bytes. That is
  what makes the ABI possible, and it also means field order is meaningful.
* From another module, qualify both type and literal: `g3::Aabb { lo: a, hi: b }`.
  (The tests avoid literals across modules by building boxes through
  `g3::aabb_empty()` + `g3::aabb_add()`.)

## 5. Modules

* A file declares `namespace g3;` (or `demo;`) and its declarations live there.
* `import g3.math;` then call `g3::mat4_mul(...)` — **qualified**, always.
* `export fn g3_app_init(...)` makes a symbol callable from C/JS; that is how
  the browser build talks to the engine.
* Root files (`src/app_*.goose`, `src/test_*.goose`) are separate programs:
  each has `main()` or is built `--standalone` and exports functions.

## 6. Conversions, and the "redundant cast" warning

* **Widening is implicit**: `i32` → `i64` → `f64`, `i32` → `f32`.
  `var k: f32 = some_i32;` and `return some_i32;` in an `-> f32` function are
  fine, and `some_i32 as f32` is *redundant* — the compiler says so.
* **Narrowing needs `as`**: `frames as i32`, `n as i64`, `count as u32`.
* **Every warning is a defect here.** `goose check` output like
  `warning: redundant 'as f32'` must be fixed by deleting the cast, not
  silenced. The repo is warning-free; keep it that way.

## 7. Small language pieces worth knowing

* `sort(g_draws) { a, b => a.key < b.key };` sorts a growable array with a
  comparator closure.
* `if` is an expression: `let w = if width < 1 { 1 } else { width };`.
* `abs`, `min`, `max`, `sin`, `cos`, `tan`, `sqrt`, `floor`, `ceil`, `pow`,
  `PI`, `TAU` come from `math`; `print`, `exit`, `args`, `parse_int` from `std`;
  `float3`, `float4`, `length`, `dot`, `cross`, `normalize` from `vec`.
* `length()`/`normalize()` exist for both float3 and float4 — be explicit about
  which you mean.
* **`index_of` cannot take a reference rooted outside the array** it searches.
  Asking a grow-only array "which slot is this item in?" via a reference
  obtained from elsewhere is rejected; return the index from wherever you
  created it instead (`node_add` returns `g_nodes.len - 1` for exactly this
  reason).

## 8. Building: `goose build`, sidecars, wasm

```bash
goose check src/app_native.goose            # typecheck, no output binary
goose build -o build/app_native src/app_native.goose
goose build --standalone --header build/web/g3.h -o build/web/g3.c src/app_web.goose
goose build --help                          # -O0/-O1/-O2, -D, --standalone, --cc, ...
```

A **sidecar** next to a root file configures the C that gets linked in. The
sidecar's name is the root's name plus `.build` (`src/app_native.build`):

```goose
// paths are relative to this file's directory
c_sources = ["../platform/g3_soft.c", "../platform/g3_input.c"];
c_include = ["../platform"];
c_libs = ["m"];
output = "app_native";
```

Facts that cost time to discover:

* `goose build`'s default optimisation is **`-O2`** (`-O0`/`-O1`/`-O2` are the
  only levels exposed).
* `-D NAME=VALUE` defines a macro **in the generated program only** — it does
  *not* reach files listed in `c_sources`, and the sidecar has no `c_flags` key.
  That is why `g3_soft.c` takes its switches from the environment
  (`G3_PROFILE`, `G3_THREADS`) instead of from the build.
* **A `--standalone` program has no `main` in the C it generates**: you provide
  it (or an exported entry point) and call `goose_init(argc, argv)` yourself.
* Each Goose **data stack reserves 2 GiB of address space by default**. Free on
  a 64-bit host, fatal in wasm: the web build passes
  `-DGS_STACK_RESERVE='(64ull<<20)'` because the engine keeps several arenas and
  browsers refuse a 4 GB heap.
* `bool` crosses the ABI as `uint8_t`; a Goose slice `T[:]` is
  `{ const T *data; int64_t len; }` in C; generated names get a `_g` suffix.
* The generated header (`build/web/g3.h`) is where the exported functions'
  exact C signatures are; read it rather than guessing.

## 9. Workflow habits that pay off in this language

1. `goose check` after every edit — the typechecker is fast and catches casts,
   reference/copy mistakes and unused-of-default problems immediately.
2. When something "does nothing", suspect the copy trap (§2) first.
3. When an index or reference is refused, re-read §1 and §7: the compiler is
   usually enforcing the arena's validity rule, not being awkward.
4. Prefer adding a function to an existing module over a new global: globals in
   Goose are program-wide, so a new one is a new invariant for everyone.
