// Input-only orbit controls. Callbacks apply deltas to the application's camera.
export function createOrbitControls(canvas, { onOrbit, onZoom, onPan = () => {}, onSelect = () => {}, rotateSpeedX = 0.006, rotateSpeedY = 0.005, panSpeed = 1, wheelSpeed = 0.001, clickTolerance = 4 } = {}) {
  if (typeof onOrbit !== 'function' || typeof onZoom !== 'function') throw new TypeError('onOrbit and onZoom are required');
  const pointers = new Map();
  const previousTouchAction = canvas.style.touchAction;
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
  const listeners = [['pointerdown', down], ['pointermove', move], ['pointerup', up], ['pointercancel', cancel], ['lostpointercapture', cancel], ['wheel', wheel, { passive: false }], ['contextmenu', contextMenu]];
  for (const [name, listener, options] of listeners) canvas.addEventListener(name, listener, options);
  return { dispose() {
    if (disposed) return;
    disposed = true;
    for (const [name, listener, options] of listeners) canvas.removeEventListener(name, listener, options);
    for (const id of pointers.keys()) if (canvas.hasPointerCapture(id)) canvas.releasePointerCapture(id);
    pointers.clear(); candidate = null;
    canvas.style.touchAction = previousTouchAction;
  } };
}
