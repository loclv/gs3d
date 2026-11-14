import assert from 'node:assert/strict';
import { createOrbitControls } from 'goose3d/orbit-controls';

class Canvas {
  style = { touchAction: 'pan-y' };
  tabIndex = -1;
  clientHeight = 400;
  listeners = new Map();
  captures = new Set();
  addEventListener(name, fn) { this.listeners.set(name, fn); }
  removeEventListener(name, fn) { if (this.listeners.get(name) === fn) this.listeners.delete(name); }
  setPointerCapture(id) { this.captures.add(id); }
  hasPointerCapture(id) { return this.captures.has(id); }
  releasePointerCapture(id) { this.captures.delete(id); }
  emit(name, fields = {}) {
    const event = { pointerId: 1, pointerType: 'mouse', button: 0, clientX: 0, clientY: 0, deltaY: 0, deltaMode: 0, key: '', preventDefault() { this.prevented = true; }, ...fields };
    this.listeners.get(name)?.(event);
    return event;
  }
}

const canvas = new Canvas(), orbits = [], zooms = [], pans = [], selections = [];
const controls = createOrbitControls(canvas, { onOrbit: (...v) => orbits.push(v), onZoom: v => zooms.push(v), onPan: (...v) => pans.push(v), onSelect: (x, y) => selections.push([x, y]) });
assert.equal(canvas.style.touchAction, 'none');
assert.equal(canvas.tabIndex, 0);
assert.equal(canvas.emit('keydown', { key: 'ArrowLeft' }).prevented, true);
assert.deepEqual(orbits.at(-1), [-0.06, 0]);
canvas.emit('keydown', { key: 'W' });
assert.deepEqual(pans.at(-1), [0, -24]);
canvas.emit('keydown', { key: '+' });
assert.equal(zooms.at(-1), 0.9);
assert.equal(canvas.emit('keydown', { key: 'Tab' }).prevented, undefined);
canvas.emit('pointerdown', { clientX: 10, clientY: 20 });
canvas.emit('pointermove', { clientX: 20, clientY: 24 });
canvas.emit('pointerup', { clientX: 20, clientY: 24 });
assert.deepEqual(orbits, [[-0.06, 0], [-0.06, 0.02]]);
assert.deepEqual(selections, []);
canvas.emit('pointerdown', { button: 2, clientX: 10, clientY: 10 });
canvas.emit('pointermove', { button: -1, clientX: 25, clientY: 5 });
canvas.emit('pointerup', { button: 2, clientX: 25, clientY: 5 });
assert.deepEqual(pans, [[0, -24], [15, -5]]);
canvas.emit('pointerdown', { shiftKey: true, clientX: 1, clientY: 2 });
canvas.emit('pointermove', { clientX: 3, clientY: 6 });
canvas.emit('pointerup', { clientX: 3, clientY: 6 });
assert.deepEqual(pans.at(-1), [2, 4]);
canvas.emit('pointerdown', { pointerType: 'touch', clientX: 40, clientY: 50 });
canvas.emit('pointerup', { pointerType: 'touch', clientX: 41, clientY: 50 });
assert.deepEqual(selections, [[41, 50]]);
canvas.emit('pointerdown', { pointerType: 'touch', pointerId: 1, clientX: 0 });
canvas.emit('pointerdown', { pointerType: 'touch', pointerId: 2, clientX: 100 });
canvas.emit('pointermove', { pointerType: 'touch', pointerId: 2, clientX: 200 });
assert.equal(zooms.at(-1), 0.5);
assert.deepEqual(pans.at(-1), [50, 0]);
canvas.emit('pointerup', { pointerType: 'touch', pointerId: 2, clientX: 200 });
canvas.emit('pointerup', { pointerType: 'touch', pointerId: 1, clientX: 0 });
assert.equal(selections.length, 1);
canvas.emit('pointerdown', { pointerType: 'touch', pointerId: 1, clientX: 0, clientY: 0 });
canvas.emit('pointerdown', { pointerType: 'touch', pointerId: 2, clientX: 10, clientY: 0 });
canvas.emit('pointermove', { pointerType: 'touch', pointerId: 1, clientX: 4, clientY: 6 });
assert.deepEqual(pans.at(-1), [2, 3]);
canvas.emit('pointerup', { pointerType: 'touch', pointerId: 1, clientX: 4, clientY: 6 });
canvas.emit('pointerup', { pointerType: 'touch', pointerId: 2, clientX: 10, clientY: 0 });
canvas.emit('pointerdown'); canvas.emit('pointercancel'); canvas.emit('pointerup');
assert.equal(selections.length, 1);
canvas.emit('pointerdown'); canvas.emit('lostpointercapture'); canvas.emit('pointerup');
assert.equal(selections.length, 1);
const wheel = canvas.emit('wheel', { deltaY: 10, deltaMode: 1 });
assert.equal(wheel.prevented, true);
assert.ok(Math.abs(zooms.at(-1) - Math.exp(0.16)) < 1e-12);
const contextMenu = canvas.emit('contextmenu');
assert.equal(contextMenu.prevented, true);
canvas.emit('pointerdown', { pointerId: 9 });
controls.dispose(); controls.dispose();
assert.equal(canvas.style.touchAction, 'pan-y');
assert.equal(canvas.tabIndex, -1);
assert.equal(canvas.listeners.size, 0);
assert.equal(canvas.hasPointerCapture(9), false);
assert.throws(() => createOrbitControls(new Canvas()), TypeError);
console.log('orbit controls checks passed');
