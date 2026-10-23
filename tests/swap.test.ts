import { describe, expect, it } from 'vitest';
import { swapLine, swapSaid, swapShape } from '../src/host/swap';

describe('what the host reads after swapping two phones', () => {
  it('names both phones and the new order from the left', () => {
    expect(swapSaid(0, 2, [2, 1, 0])).toBe('Swapped phones 1 and 3. Left to right: 3, 2, 1.');
    expect(swapSaid(3, 1, [0, 3, 2, 1])).toBe('Swapped phones 4 and 2. Left to right: 1, 4, 3, 2.');
  });
});

describe('when the swap buttons are rebuilt', () => {
  it('is the same while the order and who is away are the same, whatever else the room reports', () => {
    expect(swapShape([2, 0, 1], new Set())).toBe(swapShape([2, 0, 1], new Set()));
  });
  it('changes when the order changes, when a phone goes away and when it comes back', () => {
    const base = swapShape([0, 1, 2], new Set());
    expect(swapShape([2, 1, 0], new Set())).not.toBe(base);
    expect(swapShape([0, 1], new Set())).not.toBe(base);
    expect(swapShape([0, 1, 2], new Set([1]))).not.toBe(base);
    expect(swapShape([0, 1, 2], new Set([1]))).not.toBe(swapShape([0, 1, 2], new Set([2])));
  });
});

describe('the line under the swap buttons', () => {
  it('says which phone is picked, for as long as one is', () => {
    expect(swapLine(2, null, [0, 1, 2])).toBe('Phone 3 picked. Now pick the phone to swap it with.');
    expect(swapLine(2, { text: 'Swapped phones 1 and 2. Left to right: 2, 1, 3.', order: [1, 0, 2] }, [0, 1, 2])).toBe('Phone 3 picked. Now pick the phone to swap it with.');
  });
  it('keeps what a swap said only while the phones are still in the order it described', () => {
    const note = { text: 'Swapped phones 1 and 3. Left to right: 3, 2, 1.', order: [2, 1, 0] };
    expect(swapLine(null, note, [2, 1, 0])).toBe(note.text);
    expect(swapLine(null, note, [0, 1, 2])).toBe('');
    expect(swapLine(null, note, [2, 1, 0, 3])).toBe('');
    expect(swapLine(null, null, [0, 1, 2])).toBe('');
  });
});
