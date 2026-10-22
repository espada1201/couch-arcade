/** Sizes a canvas's backing store to its box on screen; returns the device pixel ratio, or 0 while it has no size. */
export function fitCanvas(c: HTMLCanvasElement): number {
  const r = c.getBoundingClientRect();
  if (r.width === 0) return 0;
  const dpr = devicePixelRatio || 1;
  const w = Math.round(r.width * dpr);
  const hh = Math.round(r.height * dpr);
  if (c.width !== w || c.height !== hh) {
    c.width = w;
    c.height = hh;
  }
  return dpr;
}

/** An offscreen canvas and a context tuned for reading pixels back. */
export function canvas2d(w: number, h: number): [HTMLCanvasElement, CanvasRenderingContext2D] {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  return [c, c.getContext('2d', { willReadFrequently: true })!];
}
