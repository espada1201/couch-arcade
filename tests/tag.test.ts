import { describe, expect, it } from 'vitest';
import { ordinal, phoneTag } from '../src/phone/tag';

describe('ordinal', () => {
  it('reads 1st, 2nd, 3rd, 4th, 11th, 12th, 13th, 21st and 112th', () => {
    expect([1, 2, 3, 4, 11, 12, 13, 21, 22, 23, 101, 111, 112].map(ordinal)).toEqual(['1st', '2nd', '3rd', '4th', '11th', '12th', '13th', '21st', '22nd', '23rd', '101st', '111th', '112th']);
  });
});

describe('the tag at the top of a phone', () => {
  const live = { room: 'UQSU', seat: 2, status: 'live' as const };
  it('says the seat and where the phone stands from the left once it is on the map beside others', () => {
    expect(phoneTag({ ...live, onMap: true, rank: 0, of: 3 })).toBe('UQSU · Seat 3 · 1st from left · on the map');
    expect(phoneTag({ ...live, onMap: true, rank: 2, of: 3 })).toBe('UQSU · Seat 3 · 3rd from left · on the map');
  });
  it('keeps the plain wording for a phone that stands alone, is not on the map, or has no connection', () => {
    expect(phoneTag({ ...live, onMap: true, rank: 0, of: 1 })).toBe('UQSU · Seat 3 · on the map');
    expect(phoneTag({ ...live, onMap: true })).toBe('UQSU · Seat 3 · on the map');
    expect(phoneTag({ ...live, onMap: false, rank: 0, of: 3 })).toBe('UQSU · Seat 3 · not on the map yet');
    expect(phoneTag({ ...live, status: 'reconnecting', onMap: true, rank: 1, of: 3 })).toBe('UQSU · Seat 3 · reconnecting…');
    expect(phoneTag({ room: 'UQSU', seat: -1, status: 'connecting', onMap: false })).toBe('UQSU · Joining · connecting…');
  });
});
