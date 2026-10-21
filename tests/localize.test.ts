import { describe, expect, it } from 'vitest';
import { scheduleDuration, litAt, type BlinkSchedule } from '../src/core/blinkcode';
import { localize, type GrayFrame } from '../src/core/localize';
import { gaussian, rng } from './rng';

interface Phone { id: number; x: number; y: number; w: number; h: number }

interface SceneOpts {
  fps?: number;
  latencyMs?: number;
  noise?: number;
  drop?: number;
  dup?: number;
  jitterMs?: number;
  W?: number;
  H?: number;
  extra?: (t: number, data: Uint8Array, W: number, H: number) => void;
  gain?: (t: number) => number;
  seed?: number;
}

/** Simulates a camera watching phones that flash their codes, with the usual real-world damage. */
function film(phones: Phone[], s: BlinkSchedule, o: SceneOpts = {}): GrayFrame[] {
  const { fps = 30, latencyMs = 120, noise = 6, drop = 0, dup = 0, jitterMs = 4, W = 160, H = 120, seed = 1 } = o;
  const r = rng(seed);
  const frames: GrayFrame[] = [];
  const end = s.t0 + scheduleDuration(s) + 3000;
  let last: GrayFrame | null = null;
  for (let tc = s.t0 - 300; tc < end; tc += 1000 / fps) {
    const capture = tc + gaussian(r) * jitterMs;
    const delivered = capture + latencyMs;
    if (last && r() < dup) {
      frames.push({ ...last, t: delivered });
      continue;
    }
    if (r() < drop) continue;
    const data = new Uint8Array(W * H);
    const g = o.gain ? o.gain(capture) : 1;
    for (let p = 0; p < data.length; p++) data[p] = 28;
    for (const ph of phones) {
      const v = litAt(ph.id, s, capture) ? 235 : 40;
      const x0 = Math.round(ph.x * W - ph.w / 2);
      const y0 = Math.round(ph.y * H - ph.h / 2);
      for (let y = Math.max(0, y0); y < Math.min(H, y0 + ph.h); y++)
        for (let x = Math.max(0, x0); x < Math.min(W, x0 + ph.w); x++) data[y * W + x] = v;
    }
    o.extra?.(capture, data, W, H);
    for (let p = 0; p < data.length; p++) data[p] = Math.max(0, Math.min(255, data[p] * g + gaussian(r) * noise));
    last = { t: delivered, w: W, h: H, data };
    frames.push(last);
  }
  return frames;
}

function grid(n: number, cols: number, size = { w: 8, h: 11 }): Phone[] {
  const rows = Math.ceil(n / cols);
  return Array.from({ length: n }, (_, id) => ({
    id,
    x: 0.08 + (0.84 * (id % cols)) / Math.max(1, cols - 1),
    y: 0.12 + (0.76 * Math.floor(id / cols)) / Math.max(1, rows - 1),
    ...size,
  }));
}

function expectFound(phones: Phone[], res: ReturnType<typeof localize>, tolPx = 1.5, W = 160, H = 120) {
  expect(res.detections.map((d) => d.id)).toEqual(phones.map((p) => p.id));
  for (const p of phones) {
    const d = res.detections.find((q) => q.id === p.id)!;
    expect(Math.abs(d.x - p.x) * W).toBeLessThan(tolPx);
    expect(Math.abs(d.y - p.y) * H).toBeLessThan(tolPx);
  }
}

const S: BlinkSchedule = { t0: 10_000, halfMs: 120, repeats: 3 };

describe('localize', () => {
  it('finds 12 phones under noise, latency, dropped and duplicated frames', () => {
    const phones = grid(12, 4);
    const frames = film(phones, S, { latencyMs: 140, noise: 10, drop: 0.15, dup: 0.08 });
    const res = localize(frames, S);
    expectFound(phones, res);
    expect(Math.abs(res.lagMs - 140)).toBeLessThanOrEqual(20);
  });

  it('scales to 64 phones packed into a 160x120 frame', () => {
    const phones = grid(64, 8, { w: 6, h: 8 });
    const res = localize(film(phones, S, { noise: 8, drop: 0.05, seed: 7 }), S);
    expectFound(phones, res);
  });

  it('separates phones lying edge to edge', () => {
    const phones: Phone[] = [
      { id: 3, x: 0.45, y: 0.5, w: 10, h: 14 },
      { id: 4, x: 0.45 + 10 / 160, y: 0.5, w: 10, h: 14 },
      { id: 5, x: 0.45, y: 0.5 + 14 / 120, w: 10, h: 14 },
    ];
    const res = localize(film(phones, S, { seed: 3 }), S);
    expectFound(phones, res, 1.5);
  });

  it('ignores a flickering lamp and survives auto-exposure drift', () => {
    const phones = grid(6, 3);
    const frames = film(phones, S, {
      seed: 11,
      gain: (t) => 0.7 + 0.3 * Math.sin((t - S.t0) / 1500),
      extra: (t, data, W) => {
        const v = 120 + 120 * Math.sin(t * 0.37);
        for (let y = 50; y < 70; y++) for (let x = 70; x < 90; x++) data[y * W + x] = v;
      },
    });
    const res = localize(frames, S);
    expectFound(phones, res);
  });

  it('needs no calibration: recovers 2.1 s of camera delay (capture card / phone-as-webcam)', () => {
    const phones = grid(10, 5);
    const res = localize(film(phones, S, { latencyMs: 2100, noise: 8, drop: 0.1, seed: 13 }), S);
    expectFound(phones, res);
    expect(Math.abs(res.lagMs - 2100)).toBeLessThanOrEqual(20);
  });

  it('a single phone is identified correctly whatever the delay', () => {
    for (const latencyMs of [40, 900, 2600]) {
      const phones = [{ id: 93, x: 0.4, y: 0.6, w: 10, h: 14 }];
      expectFound(phones, localize(film(phones, S, { latencyMs, seed: latencyMs }), S));
    }
  });

  it('copes with a slow 15 fps camera', () => {
    const phones = grid(9, 3);
    const res = localize(film(phones, S, { fps: 15, drop: 0.1, seed: 5 }), S);
    expectFound(phones, res);
  });

  it('returns nothing for an empty room', () => {
    const res = localize(film([], S, { seed: 2 }), S);
    expect(res.detections).toEqual([]);
  });
});
