import assert from 'node:assert/strict';
import { createOrbitControls } from './orbit-controls.js';

class Canvas {
  style = { touchAction: 'pan-y' };
  clientHeight = 400;
  listeners = new Map();
  captures = new Set();
  addEventListener(name, fn) { this.listeners.set(name, fn); }
  removeEventListener(name, fn) { if (this.listeners.get(name) === fn) this.listeners.delete(name); }
  setPointerCapture(id) { this.captures.add(id); }
  hasPointerCapture(id) { return this.captures.has(id); }
  releasePointerCapture(id) { this.captures.delete(id); }
  emit(name, fields = {}) {
    const event = { pointerId: 1, pointerType: 'mouse', button: 0, clientX: 0, clientY: 0, deltaY: 0, deltaMode: 0, preventDefault() { this.prevented = true; }, ...fields };
    this.listeners.get(name)?.(event);
    return event;
  }
}

const canvas = new Canvas(), orbits = [], zooms = [], selections = [];
const controls = createOrbitControls(canvas, { onOrbit: (...v) => orbits.push(v), onZoom: v => zooms.push(v), onSelect: (x, y) => selections.push([x, y]) });
assert.equal(canvas.style.touchAction, 'none');
canvas.emit('pointerdown', { clientX: 10, clientY: 20 });
canvas.emit('pointermove', { clientX: 20, clientY: 24 });
canvas.emit('pointerup', { clientX: 20, clientY: 24 });
assert.deepEqual(orbits, [[-0.06, 0.02]]);
assert.deepEqual(selections, []);
canvas.emit('pointerdown', { pointerType: 'touch', clientX: 40, clientY: 50 });
canvas.emit('pointerup', { pointerType: 'touch', clientX: 41, clientY: 50 });
assert.deepEqual(selections, [[41, 50]]);
canvas.emit('pointerdown', { pointerType: 'touch', pointerId: 1, clientX: 0 });
canvas.emit('pointerdown', { pointerType: 'touch', pointerId: 2, clientX: 100 });
canvas.emit('pointermove', { pointerType: 'touch', pointerId: 2, clientX: 200 });
assert.equal(zooms.at(-1), 0.5);
canvas.emit('pointerup', { pointerType: 'touch', pointerId: 2, clientX: 200 });
canvas.emit('pointerup', { pointerType: 'touch', pointerId: 1, clientX: 0 });
assert.equal(selections.length, 1);
canvas.emit('pointerdown'); canvas.emit('pointercancel'); canvas.emit('pointerup');
assert.equal(selections.length, 1);
canvas.emit('pointerdown'); canvas.emit('lostpointercapture'); canvas.emit('pointerup');
assert.equal(selections.length, 1);
const wheel = canvas.emit('wheel', { deltaY: 10, deltaMode: 1 });
assert.equal(wheel.prevented, true);
assert.ok(Math.abs(zooms.at(-1) - Math.exp(0.16)) < 1e-12);
canvas.emit('pointerdown', { pointerId: 9 });
controls.dispose(); controls.dispose();
assert.equal(canvas.style.touchAction, 'pan-y');
assert.equal(canvas.listeners.size, 0);
assert.equal(canvas.hasPointerCapture(9), false);
assert.throws(() => createOrbitControls(new Canvas()), TypeError);
console.log('orbit controls checks passed');
