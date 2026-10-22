import { describe, expect, it } from 'vitest';
import { clamp01, median } from '../src/core/math';

describe('math', () => {
  it('clamps to 0..1', () => {
    expect([-2, 0, 0.3, 1, 7].map(clamp01)).toEqual([0, 0, 0.3, 1, 1]);
  });

  it('takes the middle value, averaging the two middles of an even list, without reordering its input', () => {
    const odd = [5, 1, 3];
    expect(median(odd)).toBe(3);
    expect(odd).toEqual([5, 1, 3]);
    expect(median([4, 1, 3, 2])).toBe(2.5);
  });
});
