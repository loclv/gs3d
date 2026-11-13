// Input-only orbit controls. Callbacks apply deltas to the application's camera.
export function createOrbitControls(canvas, { onOrbit, onZoom, onPan = () => {}, onSelect = () => {}, rotateSpeedX = 0.006, rotateSpeedY = 0.005, panSpeed = 1, wheelSpeed = 0.001, clickTolerance = 4, keyRotateStep = 0.06, keyPanPixels = 24, keyZoomFactor = 0.9 } = {}) {
  if (typeof onOrbit !== 'function' || typeof onZoom !== 'function') throw new TypeError('onOrbit and onZoom are required');
  const pointers = new Map();
  const previousTouchAction = canvas.style.touchAction;
  const previousTabIndex = canvas.tabIndex;
  const addedTabIndex = previousTabIndex < 0;
  if (addedTabIndex) canvas.tabIndex = 0;
  canvas.style.touchAction = 'none';
  let candidate = null, disposed = false;

  function down(event) {
    const pan = event.pointerType !== 'touch' && (event.button === 2 || (event.button === 0 && event.shiftKey));
    if (event.pointerType !== 'touch' && event.button !== 0 && !pan) return;
    pointers.set(event.pointerId, { x: event.clientX, y: event.clientY, pan });
    if (pointers.size === 1 && !pan) candidate = { id: event.pointerId, x: event.clientX, y: event.clientY, travel: 0 };
    else candidate = null;
    canvas.setPointerCapture(event.pointerId);
  }
  function move(event) {
    const point = pointers.get(event.pointerId);
    if (!point) return;
    const dx = event.clientX - point.x, dy = event.clientY - point.y;
    if (candidate && candidate.id === event.pointerId) candidate.travel += Math.abs(dx) + Math.abs(dy);
    if (pointers.size === 1) {
      if (dx || dy) {
        if (point.pan) onPan(dx * panSpeed, dy * panSpeed);
        else onOrbit(-dx * rotateSpeedX, dy * rotateSpeedY);
      }
    } else if (pointers.size === 2) {
      const other = [...pointers.entries()].find(([id]) => id !== event.pointerId)[1];
      const before = Math.hypot(point.x - other.x, point.y - other.y);
      const after = Math.hypot(event.clientX - other.x, event.clientY - other.y);
      if (before > 0 && after > 0) onZoom(before / after);
      if (dx || dy) onPan(dx * 0.5 * panSpeed, dy * 0.5 * panSpeed);
    }
    point.x = event.clientX; point.y = event.clientY;
  }
  function end(event, select) {
    if (!pointers.has(event.pointerId)) return;
    const point = pointers.get(event.pointerId);
    pointers.delete(event.pointerId);
    if (candidate && candidate.id === event.pointerId) candidate.travel += Math.abs(event.clientX - point.x) + Math.abs(event.clientY - point.y);
    if (select && candidate && candidate.id === event.pointerId && candidate.travel < clickTolerance) onSelect(event.clientX, event.clientY, event);
    candidate = null;
  }
  function up(event) { end(event, true); }
  function cancel(event) { end(event, false); }
  function wheel(event) {
    event.preventDefault();
    // Convert DOM line/page units to approximate pixels before applying speed.
    const units = event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? canvas.clientHeight : 1;
    onZoom(Math.exp(Math.max(-1, Math.min(1, event.deltaY * units * wheelSpeed))));
  }
  function contextMenu(event) { event.preventDefault(); }
  function keyDown(event) {
    let handled = true;
    switch (event.key.toLowerCase()) {
      case 'arrowleft': onOrbit(-keyRotateStep, 0); break;
      case 'arrowright': onOrbit(keyRotateStep, 0); break;
      case 'arrowup': onOrbit(0, keyRotateStep); break;
      case 'arrowdown': onOrbit(0, -keyRotateStep); break;
      case 'a': onPan(-keyPanPixels * panSpeed, 0); break;
      case 'd': onPan(keyPanPixels * panSpeed, 0); break;
      case 'w': onPan(0, -keyPanPixels * panSpeed); break;
      case 's': onPan(0, keyPanPixels * panSpeed); break;
      case '+': case '=': onZoom(keyZoomFactor); break;
      case '-': case '_': onZoom(1 / keyZoomFactor); break;
      default: handled = false;
    }
    if (handled) event.preventDefault();
  }
  const listeners = [['pointerdown', down], ['pointermove', move], ['pointerup', up], ['pointercancel', cancel], ['lostpointercapture', cancel], ['wheel', wheel, { passive: false }], ['contextmenu', contextMenu], ['keydown', keyDown]];
  for (const [name, listener, options] of listeners) canvas.addEventListener(name, listener, options);
  return { dispose() {
    if (disposed) return;
    disposed = true;
    for (const [name, listener, options] of listeners) canvas.removeEventListener(name, listener, options);
    for (const id of pointers.keys()) if (canvas.hasPointerCapture(id)) canvas.releasePointerCapture(id);
    pointers.clear(); candidate = null;
    canvas.style.touchAction = previousTouchAction;
    if (addedTabIndex) canvas.tabIndex = previousTabIndex;
  } };
}
