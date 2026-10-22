import { describe, expect, it } from 'vitest';
import { H, W, fire } from '../src/host/live';

/** A 2D context that keeps the last frame put on it. */
function canvas() {
  let frame = new Uint8ClampedArray(0);
  const ctx = {
    createImageData: (w: number, h: number) => ({ width: w, height: h, data: new Uint8ClampedArray(w * h * 4) }),
    putImageData: (img: ImageData) => (frame = img.data.slice()),
  } as unknown as CanvasRenderingContext2D;
  return { ctx, frame: () => frame };
}

const luma = (px: Uint8ClampedArray, i: number) => 0.2126 * px[i * 4] + 0.7152 * px[i * 4 + 1] + 0.0722 * px[i * 4 + 2];

function stats(xs: number[]) {
  const mean = xs.reduce((a, b) => a + b, 0) / xs.length;
  return { mean, variance: xs.reduce((a, b) => a + (b - mean) ** 2, 0) / xs.length };
}

/** Rows [from, to) of a frame. */
const band = (px: Uint8ClampedArray, from: number, to: number) =>
  Array.from({ length: (to - from) * W }, (_, k) => luma(px, from * W + k));

const thirds = [
  ['top', 0, H / 3],
  ['middle', H / 3, (2 * H) / 3],
  ['bottom', (2 * H) / 3, H],
] as const;

describe('fire', () => {
  it('lights every third of the picture, not only the bottom, from the first frame', () => {
    const { ctx, frame } = canvas();
    fire(ctx);
    for (const [name, from, to] of thirds) {
      const { mean, variance } = stats(band(frame(), from, to));
      expect(mean, `${name} third brightness`).toBeGreaterThan(20);
      expect(variance, `${name} third has flames, not a flat wash`).toBeGreaterThan(100);
    }
  });

  it('flickers in every third, so a phone anywhere in the room keeps changing colour', () => {
    const { ctx, frame } = canvas();
    const frames = Array.from({ length: 12 }, () => (fire(ctx), frame()));
    for (const [name, from, to] of thirds) {
      // A phone samples a small patch; follow the patch in the middle of this third over time.
      const y = Math.floor((from + to) / 2);
      const patch = frames.map((px) => stats(Array.from({ length: 4 }, (_, k) => luma(px, y * W + W / 2 - 2 + k))).mean);
      expect(stats(patch).variance, `${name} third flicker`).toBeGreaterThan(20);
    }
  });

  it('keeps the look: brighter and yellower at the base, darker and redder toward the top', () => {
    const { ctx, frame } = canvas();
    for (let i = 0; i < 5; i++) fire(ctx);
    const px = frame();
    const top = stats(band(px, 0, H / 3)).mean;
    const bottom = stats(band(px, (2 * H) / 3, H)).mean;
    expect(bottom).toBeGreaterThan(top);
    for (let i = 0; i < W * H; i++) {
      expect(px[i * 4]).toBeGreaterThanOrEqual(px[i * 4 + 1]);
      expect(px[i * 4 + 1]).toBeGreaterThanOrEqual(px[i * 4 + 2]);
    }
  });
});
