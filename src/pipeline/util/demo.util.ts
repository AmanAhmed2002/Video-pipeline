/**
 * Geometry for the "demo panel" — the framed region where an uploaded screen
 * recording is composited on top of the stickman animation.
 *
 * This is the single source of truth shared by TWO subsystems that must agree
 * pixel-for-pixel: the renderer (which draws the bezel/frame around the panel)
 * and the assembly step (which overlays the scaled recording into the panel
 * with ffmpeg). If they disagree, the video spills outside its frame.
 */
export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** Round to the nearest even number — libx264 requires even dimensions. */
const even = (n: number): number => Math.round(n / 2) * 2;

/**
 * A 16:9 panel centred horizontally in the upper portion of the frame, leaving
 * the lower half for the stickman to stand and gesture upward at it.
 */
export function demoPanelRect(width: number, height: number): Rect {
  const w = even(width * 0.84);
  const h = even((w * 9) / 16);
  const x = even((width - w) / 2);
  const y = even(height * 0.17);
  return { x, y, w, h };
}
