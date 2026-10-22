import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { throttle } from '../src/host/throttle';

beforeEach(() => {
  vi.stubGlobal('window', globalThis);
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('throttle', () => {
  it('runs at once, then at most once per interval, always ending on the latest call', () => {
    const fn = vi.fn();
    const t = throttle(fn, 150);
    t();
    expect(fn).toHaveBeenCalledTimes(1);
    t();
    t();
    expect(fn).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(150);
    expect(fn).toHaveBeenCalledTimes(2);
    vi.advanceTimersByTime(1000);
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it('sent() counts as a send, and cancel() drops the trailing call', () => {
    const fn = vi.fn();
    const t = throttle(fn, 150);
    t.sent();
    t();
    expect(fn).not.toHaveBeenCalled();
    t.cancel();
    vi.advanceTimersByTime(500);
    expect(fn).not.toHaveBeenCalled();
    t();
    expect(fn).toHaveBeenCalledTimes(1);
  });
});
