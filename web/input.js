// Input: browser events turned into the numbers the backend keeps.
//
// The engine never sees a DOM event. It reads key state and pointer deltas
// from the backend once per frame (src/g3/platform.goose), and this is what
// fills them in: `g3_input_key(code, down)` and `g3_input_mouse(dx, dy)`,
// exported by platform/g3_input.c.

// Key codes as the engine names them (src/g3/engine.goose): the classic
// numbers, so the mapping stays in one obvious place.
export const KEY_CODES = {
  Escape: 27, Space: 32,
  ArrowLeft: 37, ArrowUp: 38, ArrowRight: 39, ArrowDown: 40,
  KeyA: 65, KeyD: 68, KeyE: 69, KeyQ: 81, KeyS: 83, KeyW: 87,
  ShiftLeft: 16, ShiftRight: 16,
};

// Every distinct engine key the page can set, for letting go of all of them.
const ALL_CODES = [...new Set(Object.values(KEY_CODES))];

// Keys the page handles itself, so the browser does not also scroll or type.
const HANDLED = new Set(Object.keys(KEY_CODES));

export function attachInput(canvas, engine) {
  attachKeyboard(engine);
  attachPointer(canvas, engine);
}

function attachKeyboard(engine) {
  const send = (event, down) => {
    if (!HANDLED.has(event.code)) return;
    engine._g3_input_key(KEY_CODES[event.code], down);
    event.preventDefault();
  };

  window.addEventListener('keydown', (event) => send(event, 1), { passive: false });
  window.addEventListener('keyup', (event) => send(event, 0), { passive: false });

  // Losing focus with a key held would leave it stuck down for good.
  window.addEventListener('blur', () => {
    for (const code of ALL_CODES) engine._g3_input_key(code, 0);
  });
}

// Drag to look: the pointer is captured on press, so the drag survives leaving
// the canvas, and the deltas are handed over as the movement they were.
function attachPointer(canvas, engine) {
  let dragging = false;

  canvas.addEventListener('pointerdown', (event) => {
    dragging = true;
    canvas.setPointerCapture(event.pointerId);
  });

  canvas.addEventListener('pointerup', (event) => {
    dragging = false;
    if (canvas.hasPointerCapture(event.pointerId)) canvas.releasePointerCapture(event.pointerId);
  });

  canvas.addEventListener('pointermove', (event) => {
    if (!dragging) return;
    engine._g3_input_mouse(event.movementX || 0, event.movementY || 0);
  });

  canvas.addEventListener('contextmenu', (event) => event.preventDefault());
}
