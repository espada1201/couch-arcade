import { describe, expect, it, vi } from 'vitest';
import { lineUpSaid, notice, requirePlaced, swapSaid } from '../src/host/panel';
import { fakeDocument, room } from './harness';

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

describe('the message that asks for placed phones', () => {
  /** A notice over fake elements, whose error slot is `alert.kids`, and a session that counts its listeners. */
  async function setup() {
    vi.stubGlobal('document', fakeDocument().document);
    const msg = notice();
    const alert = (msg.el as unknown as { kids: { kids: unknown[] }[] }).kids[1];
    const r = await room([]);
    r.join('a');
    const real = r.session.subscribe.bind(r.session);
    const listeners = new Set<object>();
    vi.spyOn(r.session, 'subscribe').mockImplementation((cb) => {
      const off = real(cb);
      const mine = {};
      listeners.add(mine);
      return () => (listeners.delete(mine), off());
    });
    const place = (x: number) => r.session.placeManually(0, { x, y: 0.5 });
    return { ...r, msg, alert, listeners, place };
  }

  it('is shown while no phone is on the map, and goes by itself once one is', async () => {
    const { session, msg, alert, place } = await setup();
    expect(requirePlaced(session, msg)).toBe(false);
    expect(alert.kids[0]).toBe('Place some phones on the map first.');
    place(0.5);
    expect(alert.kids).toEqual([]);
    expect(requirePlaced(session, msg)).toBe(true);
  });

  it('listens to the session once however often the host presses, and stops when it is done', async () => {
    const { session, msg, listeners, place } = await setup();
    for (let i = 0; i < 5; i++) requirePlaced(session, msg);
    expect(listeners.size).toBe(1);
    place(0.5);
    expect(listeners.size).toBe(0);
  });

  it('leaves a different message alone, even one that begins with the same words', async () => {
    const { session, msg, alert, place } = await setup();
    requirePlaced(session, msg);
    msg.fail('Place some phones on the map first. Then try again.');
    place(0.5);
    expect(alert.kids[0]).toBe('Place some phones on the map first. Then try again.');
  });
});

describe('what the host reads after swapping two phones', () => {
  it('names both phones and the new order from the left', () => {
    expect(swapSaid(0, 2, [2, 1, 0])).toBe('Swapped phones 1 and 3. Left to right: 3, 2, 1.');
    expect(swapSaid(3, 1, [0, 3, 2, 1])).toBe('Swapped phones 4 and 2. Left to right: 1, 4, 3, 2.');
  });
});
