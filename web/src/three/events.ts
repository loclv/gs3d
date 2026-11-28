/* --- event dispatcher ---------------------------------------------------------
 * three.js EventDispatcher: the listener registry every Object3D, Material,
 * BufferGeometry and AnimationMixer shares. Events are plain objects with a
 * `type`; listeners may return false to signal "handled" (three semantics). */

export class EventDispatcher {
  isEventDispatcher: boolean;
  _listeners: Map<string, Function[]>;
  constructor() {
    this.isEventDispatcher = true;
    this._listeners = new Map();
  }
  addEventListener(type: string, listener: Function) {
    if (typeof listener !== 'function') return this;
    let list = this._listeners.get(type);
    if (!list) this._listeners.set(type, list = []);
    if (!list.includes(listener)) list.push(listener);
    return this;
  }
  hasEventListener(type: string, listener: Function) {
    const list = this._listeners.get(type);
    return !!list && list.includes(listener);
  }
  removeEventListener(type: string, listener: Function) {
    const list = this._listeners.get(type);
    if (list) {
      const i = list.indexOf(listener);
      if (i >= 0) list.splice(i, 1);
      if (!list.length) this._listeners.delete(type);
    }
    return this;
  }
  dispatchEvent(event: any) {
    const type = typeof event === 'string' ? event : event && event.type;
    if (!type) return false;
    const ev = typeof event === 'string' ? { type: event } : event;
    ev.target = ev.target || this;
    const list = this._listeners.get(type);
    if (list) {
      // Copy so listeners may unsubscribe mid-dispatch.
      for (const fn of [...list]) {
        const result = fn.call(this, ev);
        if (result === false) return false;
      }
    }
    return true;
  }
}
