import { describe, expect, it } from 'vitest';
import { HostSession } from '../src/host/session';
import { BasicLink, type HostEnd, type Link, type Transport } from '../src/net/transport';
import type { HostMsg } from '../src/core/protocol';

/** In-memory transport: lets a test play several phones against a real HostSession. */
function harness() {
  let accept: (l: Link) => void = () => {};
  const transport: Transport = {
    name: 'test',
    host: async (): Promise<HostEnd> => ({ onLink: (cb) => (accept = cb), close: () => {} }),
    join: async () => {
      throw new Error('unused');
    },
  };
  let clock = 1000;
  const session = new HostSession(transport, 'TEST', () => clock);
  const phone = () => {
    const inbox: HostMsg[] = [];
    const hostSide = new BasicLink((m) => inbox.push(m as HostMsg));
    accept(hostSide);
    return { inbox, say: (m: unknown) => hostSide.deliver(m), drop: () => hostSide.ended() };
  };
  return { session, phone, tick: (ms: number) => (clock += ms) };
}

describe('host session', () => {
  it('gives each phone one seat, and a returning phone its old seat back', async () => {
    const { session, phone } = harness();
    await session.open();
    const a = phone();
    a.say({ t: 'hello', token: 'aaa' });
    a.say({ t: 'hello', token: 'bbb' }); // a second hello on the same link is ignored
    const b = phone();
    b.say({ t: 'hello', token: 'ccc' });
    expect([...session.seats.keys()]).toEqual([0, 1]);
    a.drop();
    expect(session.online.map((s) => s.seat)).toEqual([1]);
    const a2 = phone();
    a2.say({ t: 'hello', token: 'aaa' });
    expect(a2.inbox.find((m) => m.t === 'welcome')).toMatchObject({ seat: 0 });
  });

  it('tells the old tab to stand down when the same phone opens a new one', async () => {
    const { session, phone } = harness();
    await session.open();
    const old = phone();
    old.say({ t: 'hello', token: 'same' });
    phone().say({ t: 'hello', token: 'same' });
    expect(old.inbox.at(-1)).toEqual({ t: 'replaced' });
    expect(session.seats.size).toBe(1);
  });

  it('dragging one phone never moves the others, even at the edge of the room', async () => {
    const { session, phone } = harness();
    await session.open();
    for (const t of ['a', 'b', 'c']) phone().say({ t: 'hello', token: t });
    session.setRaw(new Map([[0, { x: 0.1, y: 0.2 }], [1, { x: 0.5, y: 0.8 }], [2, { x: 0.9, y: 0.5 }]]), 'camera');
    const before = new Map(session.layout.positions);
    session.placeManually(0, { x: 0.3, y: 0.4 });
    expect(session.layout.positions.get(0)).toEqual({ x: 0.3, y: 0.4 });
    expect(session.layout.positions.get(1)).toEqual(before.get(1));
    expect(session.layout.positions.get(2)).toEqual(before.get(2));
    session.placeManually(2, { x: 0.6, y: 0.5 });
    expect(session.layout.positions.get(1)).toEqual(before.get(1));
    // Frozen positions are room coordinates now; a later camera scan must not treat them as camera ones.
    expect([...session.seats.values()].map((x) => x.source)).toEqual(['manual', 'manual', 'manual']);
  });

  it('games only see phones that are connected and placed', async () => {
    const { session, phone } = harness();
    await session.open();
    const ps = ['a', 'b', 'c'].map((t) => {
      const p = phone();
      p.say({ t: 'hello', token: t });
      return p;
    });
    session.setRaw(new Map([[0, { x: 0, y: 0 }], [1, { x: 1, y: 1 }]]), 'camera');
    ps[1].drop();
    expect([...session.playRoom().positions.keys()]).toEqual([0]);
  });

  it('answers pings, records each phone’s sync quality and rate-limits taps', async () => {
    const { session, phone, tick } = harness();
    await session.open();
    const p = phone();
    p.say({ t: 'hello', token: 'x' });
    expect(session.worstSync).toBe(Infinity);
    p.say({ t: 'ping', c0: 5, u: 12 });
    expect(p.inbox.at(-1)).toMatchObject({ t: 'pong', c0: 5 });
    expect(session.worstSync).toBe(12);
    const taps: number[] = [];
    session.onTap = (s) => taps.push(s);
    p.say({ t: 'tap' });
    p.say({ t: 'tap' });
    tick(50);
    p.say({ t: 'tap' });
    expect(taps).toEqual([0, 0]);
  });

  it('ignores malformed messages from phones', async () => {
    const { session, phone } = harness();
    await session.open();
    const p = phone();
    for (const junk of [null, 3, 'hi', { t: 'hello' }, { t: 'ping', c0: 'x' }, { t: 'nope' }]) p.say(junk);
    expect(session.seats.size).toBe(0);
  });
});
