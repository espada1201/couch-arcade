import { describe, expect, it } from 'vitest';
import { FRAME_BUDGET, FrameGate, dataUrlBytes, diffScore, encodeWithin, lumaOf } from '../src/core/frames';

const flat = (v: number, n = 64) => new Uint8Array(n).fill(v);

describe('frame change detector', () => {
  it('turns RGBA pixels into one luma byte each', () => {
    expect([...lumaOf(new Uint8ClampedArray([255, 255, 255, 255, 0, 0, 0, 255, 255, 0, 0, 255]))]).toEqual([255, 0, 77]);
  });

  it('scores identical thumbnails 0 and opposite ones 255', () => {
    expect(diffScore(flat(10), flat(10))).toBe(0);
    expect(diffScore(flat(0), flat(255))).toBe(255);
  });

  it('sends the first frame, skips a still picture, and sends real changes', () => {
    const g = new FrameGate({ threshold: 3, keyframeMs: 4000 });
    expect(g.next(flat(100), 0)).toBe('change');
    expect(g.next(flat(101), 500)).toBe('skip');
    expect(g.next(flat(140), 1000)).toBe('change');
  });

  it('compares with the last frame sent, so a slow fade still gets through', () => {
    const g = new FrameGate({ threshold: 3, keyframeMs: 60_000 });
    g.next(flat(100), 0);
    expect(g.next(flat(102), 500)).toBe('skip');
    expect(g.next(flat(104), 1000)).toBe('change');
  });

  it('resends the picture every few seconds for phones that just joined', () => {
    const g = new FrameGate({ threshold: 3, keyframeMs: 4000 });
    g.next(flat(100), 0);
    expect(g.next(flat(100), 3999)).toBe('skip');
    expect(g.next(flat(100), 4000)).toBe('keyframe');
    expect(g.next(flat(100), 5000)).toBe('skip');
  });

  it('a new thumbnail size counts as a change', () => {
    const g = new FrameGate();
    g.next(flat(1, 64), 0);
    expect(g.next(flat(1, 32), 10)).toBe('change');
  });

  it('reset makes the next frame go out', () => {
    const g = new FrameGate();
    g.next(flat(1), 0);
    g.reset();
    expect(g.next(flat(1), 10)).toBe('change');
  });
});

describe('encodeWithin', () => {
  const url = (bytes: number) => 'data:image/jpeg;base64,' + 'A'.repeat(Math.ceil(bytes / 3) * 4);
  // A fake JPEG encoder: size grows with quality and with the square of the scale.
  const fake = (k: number) => (q: number, s: number) => url(k * q * s * s);

  it('measures the decoded size of a base64 data URL', () => {
    expect(dataUrlBytes('data:image/jpeg;base64,AAAA')).toBe(3);
    expect(dataUrlBytes('data:image/jpeg;base64,AAA=')).toBe(2);
  });

  it('keeps quality when the frame is already small, and nudges it up', () => {
    const r = encodeWithin(fake(20_000), FRAME_BUDGET, 0.7)!;
    expect(r.scale).toBe(1);
    expect(dataUrlBytes(r.data)).toBeLessThanOrEqual(FRAME_BUDGET);
    expect(r.quality).toBeGreaterThan(0.7);
  });

  it('lowers quality until a busy frame fits the budget', () => {
    const r = encodeWithin(fake(100_000), FRAME_BUDGET, 0.8)!;
    expect(dataUrlBytes(r.data)).toBeLessThanOrEqual(FRAME_BUDGET);
    expect(r.quality).toBeLessThan(0.8);
  });

  it('shrinks the picture when even the lowest quality is too big', () => {
    const r = encodeWithin(fake(400_000), FRAME_BUDGET, 0.8)!;
    expect(dataUrlBytes(r.data)).toBeLessThanOrEqual(FRAME_BUDGET);
    expect(r.scale).toBeLessThan(1);
  });

  it('gives up (null) rather than send an oversize frame', () => {
    expect(encodeWithin(() => url(100_000), FRAME_BUDGET, 0.8)).toBeNull();
  });
});
