import { describe, expect, it } from 'vitest';
import { backoff } from '../src/net/transport';

describe('reconnect backoff', () => {
  it('doubles from 800 ms to a 5 s cap, spread by a quarter either way', () => {
    expect([1, 2, 3, 4, 9].map((n) => backoff(n, 0.5))).toEqual([800, 1600, 3200, 5000, 5000]);
    expect(backoff(1, 0)).toBe(600);
    expect(backoff(1, 1)).toBe(1000);
    expect(backoff(9, 1)).toBe(6250);
  });

  it('phones that lost the relay together come back spread out', () => {
    const waits = new Set(Array.from({ length: 50 }, () => Math.round(backoff(3))));
    expect(waits.size).toBeGreaterThan(40);
  });
});
