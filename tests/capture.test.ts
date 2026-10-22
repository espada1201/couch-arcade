import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Rate, captureFrames, pickDriver } from '../src/host/capture';

beforeEach(() => {
  vi.stubGlobal('window', globalThis);
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('capturing a shared screen', () => {
  it('prefers reading the track itself, which keeps going while the host tab is hidden', () => {
    expect(pickDriver({ trackProcessor: true, videoFrameCallback: true })).toBe('track');
    expect(pickDriver({ trackProcessor: false, videoFrameCallback: true })).toBe('video');
    expect(pickDriver({ trackProcessor: false, videoFrameCallback: false })).toBe('interval');
  });

  it('lets through at most fps frames a second, and the rate can change', () => {
    const r = new Rate(2);
    expect(r.due(0)).toBe(true);
    expect(r.due(200)).toBe(false);
    expect(r.due(500)).toBe(true);
    r.fps = 4;
    expect(r.due(750)).toBe(true);
    expect(r.due(800)).toBe(false);
  });

  it('driven by the video’s own frames, with the interval stepping in only when they stall', () => {
    let cb: ((now: number) => void) | null = null;
    const video = { videoWidth: 640, videoHeight: 360, readyState: 4, requestVideoFrameCallback: (f: (now: number) => void) => ((cb = f), 1) };
    const seen: number[] = [];
    const cap = captureFrames(video as unknown as HTMLVideoElement, undefined, 2, () => seen.push(performance.now()), 'video');
    // Frames arrive every 100 ms: two a second get through.
    for (let i = 0; i < 10; i++) {
      vi.advanceTimersByTime(100);
      cb!(performance.now());
    }
    expect(seen).toHaveLength(2);
    // The tab is hidden and the video stops calling back: the interval keeps the picture coming.
    vi.advanceTimersByTime(3000);
    expect(seen.length).toBeGreaterThanOrEqual(4);
    cap.stop();
    const n = seen.length;
    vi.advanceTimersByTime(3000);
    cb!(performance.now());
    expect(seen).toHaveLength(n);
  });
});
