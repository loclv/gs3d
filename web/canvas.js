// Sizing the canvas.
//
// The drawing buffer must be the CSS box in device pixels: if it is not, the
// browser scales the frame and every edge goes soft on a high-density display.
// Both the boot path and the resize handler need that, so it lives here.

// Beyond 2x the extra pixels cost more than they show.
const MAX_DEVICE_PIXEL_RATIO = 2;

// The size the canvas wants, in physical pixels.
export function pixelSizeOf(canvas) {
  const dpr = Math.min(window.devicePixelRatio || 1, MAX_DEVICE_PIXEL_RATIO);
  return {
    width: Math.max(1, Math.round(canvas.clientWidth * dpr)),
    height: Math.max(1, Math.round(canvas.clientHeight * dpr)),
  };
}

// Resize the drawing buffer to fit its display. Returns the size it settled on.
export function fitToDisplay(canvas) {
  const { width, height } = pixelSizeOf(canvas);
  if (canvas.width !== width) canvas.width = width;
  if (canvas.height !== height) canvas.height = height;
  return { width, height };
}
