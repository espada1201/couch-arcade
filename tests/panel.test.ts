import { describe, expect, it } from 'vitest';
import { lineUpSaid } from '../src/host/panel';

describe('what the host reads after Line them up for me', () => {
  it('numbers the phones as the map does, phone 1 on the left', () => {
    expect(lineUpSaid([0, 1, 2], false)).toBe('Done. Phones 1 to 3 are in a row, phone 1 on the left. Ask your friends to hold or lay their phones in that order.');
    expect(lineUpSaid([0, 1, 2, 3, 4, 5], false)).toContain('Phones 1 to 6 are in a row');
  });

  it('says "and" for two phones and lists phones that are not next to each other', () => {
    expect(lineUpSaid([0, 1], false)).toContain('Phones 1 and 2 are in a row, phone 1 on the left.');
    expect(lineUpSaid([1, 4, 5], false)).toContain('Phones 2, 5 and 6 are in a row, phone 2 on the left.');
  });

  it('is singular for one phone, and says when others were already on the map', () => {
    expect(lineUpSaid([0], false)).toBe('Done. Phone 1 is on the map.');
    expect(lineUpSaid([3], true)).toBe('Done. Phone 4 is on the map after the others.');
    expect(lineUpSaid([2, 3], true)).toBe('Done. Phones 3 and 4 are in a row after the ones already on the map, phone 3 on the left. Ask your friends to hold or lay their phones in that order.');
  });
});
