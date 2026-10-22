import { describe, expect, it } from 'vitest';
import { tombstones } from '../server/tombs.mjs';

const setup = (max = 3) => {
  let t = 1000;
  const tombs = tombstones({ max, holdMs: 600, minLifeMs: 5000, now: () => t });
  return { tombs, advance: (ms: number) => (t += ms), at: () => t };
};

describe('tombstones', () => {
  it('holds a room that had a phone, or lasted more than 5 s, for its host', () => {
    const { tombs, at } = setup();
    tombs.hold('PHONE', 'key-a', { born: at(), hadPhone: true });
    tombs.hold('LONG', 'key-b', { born: at() - 5001, hadPhone: false });
    expect(tombs.heldFor('PHONE')).toBe('key-a');
    expect(tombs.heldFor('LONG')).toBe('key-b');
  });

  it('forgets a room that never had a phone and was gone within 5 s: nobody was waiting on it', () => {
    const { tombs, at } = setup();
    tombs.hold('BLINK', 'key-a', { born: at() - 5000, hadPhone: false });
    expect(tombs.heldFor('BLINK')).toBeUndefined();
    expect(tombs.size).toBe(0);
  });

  it('lets the hold run out', () => {
    const { tombs, advance, at } = setup();
    tombs.hold('ROOM', 'key-a', { born: at(), hadPhone: true });
    advance(599);
    expect(tombs.heldFor('ROOM')).toBe('key-a');
    advance(1);
    expect(tombs.heldFor('ROOM')).toBeUndefined();
    tombs.sweep();
    expect(tombs.size).toBe(0);
  });

  it('keeps at most `max`, dropping the oldest first, so churning room codes cannot grow it', () => {
    const { tombs, advance, at } = setup(3);
    for (const room of ['A', 'B', 'C', 'D']) {
      tombs.hold(room, `key-${room}`, { born: at(), hadPhone: true });
      advance(10);
    }
    expect(tombs.size).toBe(3);
    expect(tombs.heldFor('A')).toBeUndefined();
    expect(tombs.heldFor('D')).toBe('key-D');
  });

  it('a room held again counts as the newest', () => {
    const { tombs, advance, at } = setup(2);
    tombs.hold('A', 'key-A', { born: at(), hadPhone: true });
    tombs.hold('B', 'key-B', { born: at(), hadPhone: true });
    advance(10);
    tombs.hold('A', 'key-A', { born: at(), hadPhone: true });
    tombs.hold('C', 'key-C', { born: at(), hadPhone: true });
    expect(tombs.heldFor('B')).toBeUndefined();
    expect(tombs.heldFor('A')).toBe('key-A');
  });

  it('frees a room its host came back for', () => {
    const { tombs, at } = setup();
    tombs.hold('ROOM', 'key-a', { born: at(), hadPhone: true });
    tombs.release('ROOM');
    expect(tombs.heldFor('ROOM')).toBeUndefined();
  });
});
