/* The input queue: key state and mouse deltas, shared by every backend.
   See g3_input.h for the contract; this file is only the storage. */

#include "g3_input.h"
#include "g3_abi.h"

static uint8_t keys[G3_INPUT_KEYS];
static float accum_dx, accum_dy;

/* --- what the engine reads, once per frame (src/g3/platform.goose) --- */

uint8_t g3p_key_down(int32_t key) {
    if (key < 0 || key >= G3_INPUT_KEYS) return 0;
    return keys[key];
}

/* The deltas are consumed by reading them: the engine hands the sum of a
   frame's movement to the camera and starts the next frame at zero. */
float g3p_mouse_dx(void) {
    float v = accum_dx;
    accum_dx = 0.0f;
    return v;
}

float g3p_mouse_dy(void) {
    float v = accum_dy;
    accum_dy = 0.0f;
    return v;
}

/* --- what the host writes --- */

void g3_input_key(int key, int down) {
    if (key >= 0 && key < G3_INPUT_KEYS) keys[key] = down ? 1 : 0;
}

void g3_input_mouse(float dx, float dy) {
    accum_dx += dx;
    accum_dy += dy;
}

int g3_input_resize(int width, int height) {
    if (width <= 0 || height <= 0) return 0;
    return g3_backend_resize(width, height);
}
