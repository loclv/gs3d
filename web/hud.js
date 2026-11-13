// What the page says: a status overlay while it boots or when something fails,
// and a live line of engine statistics.

// The full-screen overlay. `fail` replaces the message it is showing; the boot
// path uses it to say why the engine will not start, and the backend calls the
// page's hooks to do the same from C.
export function createStatusLine(element) {
  let message = null;

  return {
    // What it is showing, or null if it is hidden. A caller uses this to avoid
    // replacing a specific reason (a shader log) with a generic one.
    get message() {
      return message;
    },

    fail(text) {
      message = text;
      element.textContent = text;
      element.classList.remove('hidden');
    },

    // Keep whatever is already showing, for fallbacks that fire after the
    // thing they are a fallback for.
    failIfSilent(text) {
      if (message === null) this.fail(text);
    },

    hide() {
      message = null;
      element.classList.add('hidden');
    },
  };
}

// The statistics line: four updates a second is plenty to read, and the first
// frame draws one straight away so the line is never left saying "starting".
export function createStatsLine(element, engine) {
  let frames = 0;
  let seconds = 0;
  let fps = 0;
  let ticks = 0;

  function draw() {
    const rate = fps > 0 ? `${fps.toFixed(0)} fps` : '— fps';
    const sceneCalls = typeof engine._g3_host_scene_draw_calls === 'function'
      ? ` · ${engine._g3_host_scene_draw_calls()} GPU calls`
      : '';
    const feedbackSkips = typeof engine._g3_app_feedback_items_suppressed === 'function'
      ? engine._g3_app_feedback_items_suppressed()
      : 0;
    const feedback = feedbackSkips > 0 ? ` · ${feedbackSkips} feedback skips` : '';
    element.textContent =
      `${rate} · ${engine._g3_app_nodes()} nodes · ` +
      `${engine._g3_app_drawn()} drawn${sceneCalls} · ${engine._g3_app_culled()} culled${feedback} · ` +
      `${engine._g3_app_triangles()} tris · ${engine._g3_app_meshes()} meshes`;
  }

  return {
    frame(dt) {
      ticks += 1;
      frames += 1;
      seconds += dt;
      if (seconds >= 0.25) {
        fps = frames / seconds;
        frames = 0;
        seconds = 0;
        draw();
      } else if (ticks === 1) {
        draw();
      }
    },
  };
}
