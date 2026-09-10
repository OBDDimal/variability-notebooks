# uvllang 0.4.0 crashes Pyodide (fatal error) when its Zig backend allocates

> **Resolved in uvllang 0.4.1.** The 0.4.1 Emscripten wheel no longer crashes:
> `UVL(from_file=...).to_dimacs(...)` runs to completion under Pyodide 314.0.6,
> verified both in bare Node Pyodide and in the notebook (browser Web Worker).
> No change needed on the consuming side beyond the Pyodide 314 upgrade — the
> notebook's `- uvllang` dependency now resolves to 0.4.1 via the micropip
> fallback and works. The analysis below is kept for the record.

## Summary

`uvllang` 0.4.0's Emscripten wheel
(`uvllang-0.4.0-py3-none-pyemscripten_2026_0_wasm32.whl`) bundles a native
library, `uvllang/_zig_libs/libuvlparser.so`, that is **not a valid Emscripten
side module**. It carries its own allocator and grows the shared WebAssembly
linear memory with a raw `memory.grow` instruction, without going through
Emscripten. This detaches every typed-array view Pyodide holds and takes the
whole interpreter down with a fatal error the first time uvllang actually calls
into the Zig backend and it allocates enough to force a heap grow.

The bug is in the wheel's `.so`, not in the consuming application. It reproduces
in bare Node Pyodide with no bundler and no service worker.

## Environment

- Pyodide 314.0.6 — `platform: emscripten_5_0_3`, `abi_version: 2026_0`,
  `python: 3.14.2` (from the distribution's `pyodide-lock.json`), i.e. exactly
  the ABI advertised by the wheel's `pyemscripten_2026_0_wasm32` tag.
- `uvllang` 0.4.0 installed via `micropip.install(["uvllang"])`.
- `python-sat` (uvllang's runtime dependency) resolved from the Pyodide
  distribution.

## Reproduction (bare Node Pyodide)

```js
import { loadPyodide } from "pyodide"; // 314.0.6

const py = await loadPyodide();
await py.loadPackage("micropip");
await py.pyimport("micropip").install(["uvllang"]);

py.FS.writeFile("example.uvl", `features
  Root
    mandatory
      Child1
        or
          Child1_1
          Child1_2
      Child2
    optional
      OptionalChild

constraints
  Child1_2 => OptionalChild
`);

py.runPython(`
from uvllang import UVL
model = UVL(from_file="example.uvl")
cnf = model.to_dimacs("example.dimacs")   # <-- fatal error here
`);
```

### Output

```
Pyodide has suffered a fatal error. Please report this to the Pyodide maintainers.
The cause of the fatal error was:
Error: Unexpected rtype undefined
    at ffi_call_js (pyodide.asm.mjs)
    at wasm://wasm/0249d42a:wasm-function[5365]
    ...
Another error occurred while handling the fatal error:
TypeError: Cannot perform Construct on a detached ArrayBuffer
    at new Uint8Array (<anonymous>)
    at Object.bufferAsUint8Array [as typedArrayAsUint8Array] (pyodide.asm.mjs)
    ...
RuntimeError: table index is out of bounds
```

Same crash occurs in a browser Web Worker; the environment is not a factor.

## What works and what doesn't

Narrowing it down step by step in Pyodide:

| step | result |
| --- | --- |
| `import uvllang` | OK |
| `ctypes.CDLL(".../libuvlparser.so")` | OK — loads as a side module |
| `lib.uvl_last_error()` (`restype=c_char_p`, no args, no allocation) | OK |
| `UVL(from_file=...).to_dimacs(...)` → `lib.uvl_source_to_cnf(...)` | **fatal error** |

So the `.so` links and trivial FFI calls work. The crash is specifically a call
that parses a model and allocates.

Note: `backend="lark"` and `backend="antlr"` do **not** avoid this — both route
CNF/DIMACS generation back through `_zig.hierarchy_to_cnf`, i.e. the same `.so`.

## Root cause

Dumping the import section of `uvllang/_zig_libs/libuvlparser.so` — it imports
**five items and zero functions**:

```
mem    env.memory
table  env.__indirect_function_table
global env.__stack_pointer
global env.__memory_base
global env.__table_base
```

There is no `malloc`, no `free`, no `emscripten_resize_heap`, no
`emscripten_notify_memory_growth`, and no imported functions of any kind. The
library brings its own allocator and grows `env.memory` itself via the raw
`memory.grow` wasm instruction (consistent with a Zig `wasm32-freestanding`
build using `std.heap.WasmAllocator` / `@wasmMemoryGrow`).

In Pyodide there is a single shared `WebAssembly.Memory`. When it is grown, the
backing `ArrayBuffer` is replaced and **every** typed-array view over it
(`HEAP8`, `HEAPU16`, `HEAPU32`, …) is detached. Emscripten only re-creates those
views (`updateMemoryViews()`) when growth happens through its own
`emscripten_resize_heap`. A module that calls `memory.grow` directly bypasses
that, so Pyodide's cached `HEAPU16` inside libffi's `ffi_call_js` trampoline is
left pointing at a detached buffer:

- reading the return-type descriptor yields `undefined` → `Unexpected rtype
  undefined`
- the fatal-error handler then tries to build a fresh `Uint8Array` over the same
  detached buffer → `Cannot perform Construct on a detached ArrayBuffer`

This is why a no-allocation call succeeds and the first allocating call kills the
runtime.

## Fix (uvllang side)

The wheel's platform tag (`pyemscripten_2026_0_wasm32`) advertises Pyodide
compatibility, but a runtime-loaded dynamic library has to be an actual
Emscripten side module built against the same ABI — a matching tag is not
sufficient. Options:

1. **Build `libuvlparser` with the Emscripten toolchain as the linker**
   (`emcc -sSIDE_MODULE=2`, or via `pyodide build` / the pyodide-build
   cross-env), so it imports `malloc` / `free` / `emscripten_resize_heap` from
   the Pyodide main module instead of bundling its own allocator and growing
   memory itself. This is the supported way to produce a ctypes-loadable `.so`
   for Pyodide.
2. If a self-contained build is kept: **do not call `memory.grow` directly.**
   Either pre-reserve a fixed maximum heap, or import and call
   `emscripten_resize_heap` so Emscripten runs `updateMemoryViews()` after every
   grow. Zig's `wasm32-freestanding` target and `std.heap.WasmAllocator` /
   `@wasmMemoryGrow` are incompatible with a shared-memory Emscripten host for
   this reason; target `wasm32-emscripten` and link against Emscripten libc
   instead.

## Consuming-side status (variability-notebooks)

For reference — nothing here blocks the fix, which is upstream:

- Pyodide upgraded to 314.0.6 (required for the wheel's `2026_0` ABI); PySAT
  notebook still works on it.
- Dependency install falls back to `micropip` for packages not in the Pyodide
  distribution, with the service worker caching PyPI + `files.pythonhosted.org`
  responses. `uvllang` downloads and imports cleanly; only the Zig backend call
  crashes.
- The uvllang notebook stays non-functional until the `.so` is rebuilt as a
  proper Emscripten side module.
