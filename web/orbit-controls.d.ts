export interface OrbitControlOptions {
  /** Apply azimuth and elevation deltas, in radians. */
  onOrbit: (azimuth: number, elevation: number) => void;
  /** Apply a multiplicative camera distance factor. */
  onZoom: (factor: number) => void;
  /** Apply horizontal and vertical pan deltas, in CSS pixels by default. */
  onPan?: (dx: number, dy: number) => void;
  /** Called on a click or tap that did not move beyond clickTolerance. */
  onSelect?: (clientX: number, clientY: number, event: PointerEvent) => void;
  rotateSpeedX?: number;
  rotateSpeedY?: number;
  panSpeed?: number;
  wheelSpeed?: number;
  clickTolerance?: number;
  keyRotateStep?: number;
  keyPanPixels?: number;
  keyZoomFactor?: number;
}

export interface OrbitControls {
  /** Remove input listeners, release pointer captures, and restore canvas settings. */
  dispose(): void;
}

/** Attach orbit, pan, zoom, selection, touch, and keyboard input to a canvas. */
export function createOrbitControls(
  canvas: HTMLCanvasElement,
  options: OrbitControlOptions
): OrbitControls;
