/* The input queue that every backend shares.
 
   A backend's input job is small and identical everywhere: record the state a
   host pushes at it, and make its surface a new size when asked. So it lives
   here once and each backend supplies only `g3_backend_resize`. Keeping it in
   one file is also what makes the keyboard behave the same in a browser, in a
   test script and in a future native window: the engine reads its keys back
   through the same three `g3p_*` calls regardless (see src/g3/platform.goose).
 
   The `g3_input_*` functions are the host API, not part of the Goose ABI:
   compiled with Emscripten they are exported to JavaScript, which is how
   web/shell.js feeds them. */

#ifndef G3_INPUT_H
#define G3_INPUT_H

#include <stdint.h>

/* Key codes are the classic ones the engine names (src/g3/engine.goose), all
   below this bound; anything higher is not tracked. */
#define G3_INPUT_KEYS 512

#if defined(__EMSCRIPTEN__)
#include <emscripten/emscripten.h>
#define G3_HOST_API EMSCRIPTEN_KEEPALIVE
#else
#define G3_HOST_API
#endif

/* --- the host API: what a page or a test calls --- */

G3_HOST_API void g3_input_key(int key, int down);
G3_HOST_API void g3_input_mouse(float dx, float dy);
G3_HOST_API int g3_input_resize(int width, int height);

/* --- the hook a backend implements --- */

/* Resize the backend's own surface; 0 if it cannot. Called only with a
   positive width and height. */
int g3_backend_resize(int width, int height);

#endif /* G3_INPUT_H */
