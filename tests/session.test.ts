import { describe, expect, it, vi } from 'vitest';
import { MAX_IDS } from '../src/core/blinkcode';
import { wallTiles } from '../src/core/wall';
import { HostSession } from '../src/host/session';
import { BasicLink, sendEach, type HostEnd } from '../src/net/transport';
import { MAX_MESSAGE_BYTES, fits, type HostMsg } from '../src/core/protocol';
import { memoryStorage, testTransport } from './harness';
import { PHONE_BUDGET, PHONE_MESSAGE_BYTES } from '../src/net/limits.js';

/** Several phones against a real HostSession. */
function harness(opts: { heartbeat?: boolean } = {}) {
  const { transport, accept, server } = testTransport(opts);
  let clock = 1000;
  const session = new HostSession(transport, 'TEST', () => clock);
  const phone = () => {
    const inbox: HostMsg[] = [];
    const hostSide = new BasicLink((m) => inbox.push(m as HostMsg));
    let closed = false;
    hostSide.onClose(() => (closed = true));
    accept(hostSide);
    return { inbox, say: (m: unknown) => hostSide.deliver(m), drop: () => hostSide.ended(), onClose: (cb: () => void) => hostSide.onClose(cb), closed: () => closed };
  };
  return { session, phone, server, tick: (ms: number) => (clock += ms) };
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

  describe('lining phones up', () => {
    const join = async (n: number) => {
      const { session, phone } = harness();
      await session.open();
      const phones = Array.from({ length: n }, () => phone());
      phones.forEach((p, i) => p.say({ t: 'hello', token: `t${i}` }));
      return { session, phones };
    };

    it('puts phones that are not on the map into one row, phone 1 on the left, each its own third of a Photo wall', async () => {
      const { session } = await join(3);
      expect(session.lineUp()).toEqual([0, 1, 2]);
      const at = [0, 1, 2].map((s) => session.layout.positions.get(s)!);
      expect(at[0].x).toBeLessThan(at[1].x);
      expect(at[1].x).toBeLessThan(at[2].x);
      expect(new Set(at.map((p) => p.y)).size).toBe(1);
      for (const p of at) expect(p.x >= 0 && p.x <= 1 && p.y >= 0 && p.y <= 1).toBe(true);
      const tiles = wallTiles(session.layout, new Map()).tiles;
      expect([...tiles.values()].map((r) => [r.x, r.w].map((v) => Math.round(v * 1000) / 1000))).toEqual([[0, 0.333], [0.333, 0.333], [0.667, 0.333]]);
      for (const r of tiles.values()) expect([r.y, r.h]).toEqual([0, 1]);
    });

    it('leaves phones that are already on the map exactly where they are and lines the rest up after them, in seat order', async () => {
      const { session } = await join(4);
      session.setRaw(new Map([[1, { x: 0.2, y: 0.5 }], [2, { x: 0.6, y: 0.5 }]]), 'camera');
      const before = [1, 2].map((s) => session.layout.positions.get(s)!);
      const physical = () => [1, 2].map((s) => session.layout.positions.get(s)!.x * session.layout.aspect);
      const was = physical();
      expect(session.lineUp()).toEqual([0, 3]);
      // Nothing moved on the floor, even though the room grew to hold the new phones.
      expect(physical().map((v) => Math.round(v * 1e6))).toEqual(was.map((v) => Math.round(v * 1e6)));
      expect(session.layout.positions.get(1)!.y).toBe(before[0].y);
      const [p0, p1, p2, p3] = [0, 1, 2, 3].map((s) => session.layout.positions.get(s)!);
      expect(p3.x).toBeGreaterThan(p0.x);
      expect(p0.x).toBeGreaterThan(p2.x);
      expect(p1.x).toBeLessThan(p2.x);
      expect(p0.y).toBe(p2.y);
      for (const p of [p0, p1, p2, p3]) expect(p.x >= 0 && p.x <= 1).toBe(true);
    });

    it('does nothing when every connected phone is on the map, and skips phones that are away', async () => {
      const { session, phones } = await join(3);
      phones[1].drop();
      expect(session.lineUp()).toEqual([0, 2]);
      expect(session.layout.positions.has(1)).toBe(false);
      expect(session.lineUp()).toEqual([]);
    });
  });

  describe('swapping two phones', () => {
    const lined = async () => {
      const { session, phone } = harness();
      await session.open();
      for (const t of ['a', 'b', 'c']) phone().say({ t: 'hello', token: t });
      session.lineUp();
      return session;
    };

    it('trades the two places and leaves the third phone and the room where they were', async () => {
      const session = await lined();
      const [a, b, c] = [0, 1, 2].map((s) => session.layout.positions.get(s)!);
      const aspect = session.layout.aspect;
      expect(session.swapPlaces(0, 2)).toBe(true);
      expect(session.layout.positions.get(0)).toEqual(c);
      expect(session.layout.positions.get(2)).toEqual(a);
      expect(session.layout.positions.get(1)).toEqual(b);
      expect(session.layout.aspect).toBe(aspect);
      // The Photo wall follows: phone 3 now cuts the left third.
      const tiles = wallTiles(session.layout, new Map()).tiles;
      expect(tiles.get(2)!.x).toBe(0);
      expect(tiles.get(0)!.x).toBeGreaterThan(0.6);
    });

    it('does nothing for a phone that is not on the map, or for the same phone twice', async () => {
      const session = await lined();
      const before = JSON.stringify([...session.layout.positions]);
      expect(session.swapPlaces(0, 7)).toBe(false);
      expect(session.swapPlaces(1, 1)).toBe(false);
      expect(JSON.stringify([...session.layout.positions])).toBe(before);
    });

    it('keeps the swap after a camera scan placed the phones, and tells the phones their new spots', async () => {
      const { session, phone } = harness();
      await session.open();
      const ps = ['a', 'b'].map((t) => {
        const p = phone();
        p.say({ t: 'hello', token: t });
        return p;
      });
      session.setRaw(new Map([[0, { x: 0.1, y: 0.2 }], [1, { x: 0.9, y: 0.7 }]]), 'camera');
      const [a, b] = [0, 1].map((s) => session.layout.positions.get(s)!);
      session.swapPlaces(0, 1);
      expect(session.layout.positions.get(0)).toEqual(b);
      expect(session.layout.positions.get(1)).toEqual(a);
      const lastPos = (p: (typeof ps)[number]) => p.inbox.filter((m) => m.t === 'pos').at(-1);
      expect(lastPos(ps[0])).toMatchObject({ pos: b });
      expect(lastPos(ps[1])).toMatchObject({ pos: a });
    });
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
    session.input({ tap: (s) => taps.push(s) });
    p.say({ t: 'tap' });
    p.say({ t: 'tap' });
    tick(50);
    p.say({ t: 'tap' });
    expect(taps).toEqual([0, 0]);
  });

  it('passes a seated phone’s vote on, and ignores one from a phone that never said hello', async () => {
    const { session, phone } = harness();
    await session.open();
    const votes: [number, number][] = [];
    session.input({ vote: (seat, m) => votes.push([seat, m.choice]) });
    phone().say({ t: 'vote', choice: 1 });
    const p = phone();
    p.say({ t: 'hello', token: 'v' });
    p.say({ t: 'vote', choice: 2 });
    p.say({ t: 'vote', choice: 'x' });
    expect(votes).toEqual([[0, 2]]);
  });

  it('ignores malformed messages from phones', async () => {
    const { session, phone } = harness();
    await session.open();
    const p = phone();
    for (const junk of [null, 3, 'hi', { t: 'hello' }, { t: 'ping', c0: 'x' }, { t: 'nope' }]) p.say(junk);
    expect(session.seats.size).toBe(0);
  });

  it('a room is saved as soon as it opens, so a reload before anyone joins keeps the code', async () => {
    vi.stubGlobal('localStorage', memoryStorage());
    try {
      const { session } = harness();
      await session.open();
      expect(HostSession.restore(session.transport, false).room).toBe('TEST');
    } finally {
      vi.unstubAllGlobals();
    }
  });
  it('passes well-formed file acks to the speaker, and only from seated phones', async () => {
    const { session, phone } = harness();
    await session.open();
    const seen: [number, unknown][] = [];
    session.input({ have: (seat, m) => seen.push([seat, m]) });
    const a = phone();
    a.say({ t: 'have', id: 'trk', next: 0, got: 0 }); // not seated yet
    a.say({ t: 'hello', token: 'aaa' });
    a.say({ t: 'have', id: 'trk', next: 2, got: 3, state: 'ready' });
    a.say({ t: 'have', id: 'trk', next: -1, got: 3 });
    a.say({ t: 'have', id: 'trk', next: 1.5, got: 3 });
    a.say({ t: 'have', id: 7, next: 1, got: 3 });
    a.say({ t: 'have', id: 'trk', next: 1, got: 1, state: 'bogus' });
    expect(seen).toEqual([
      [0, { t: 'have', id: 'trk', next: 2, got: 3, state: 'ready' }],
      [0, { t: 'have', id: 'trk', next: 1, got: 1, state: undefined }],
    ]);
    expect(session.send(0, { t: 'full' })).toBe(true);
    expect(a.inbox.at(-1)).toEqual({ t: 'full' });
    a.drop();
    expect(session.send(0, { t: 'full' })).toBe(false);
  });
});

describe('pings', () => {
  it('only a seated phone gets pongs, so one the host never met times out and says hello', async () => {
    const { session, phone } = harness();
    await session.open();
    const a = phone();
    a.say({ t: 'ping', c0: 1 });
    expect(a.inbox).toEqual([]);
    a.say({ t: 'hello', token: 'aaa' });
    a.say({ t: 'ping', c0: 2, u: 7 });
    expect(a.inbox.at(-1)).toMatchObject({ t: 'pong', c0: 2 });
    expect(session.seats.get(0)!.sync).toBe(7);
  });
});

describe('links that go quiet', () => {
  it('drops a seated phone the host has not heard from for 15 s, and keeps one that pings (no server heartbeat)', async () => {
    const { session, phone, tick } = harness();
    await session.open();
    const [quiet, chatty] = [phone(), phone()];
    quiet.say({ t: 'hello', token: 'quiet' });
    chatty.say({ t: 'hello', token: 'chatty' });
    for (let s = 0; s < 16; s++) {
      tick(1000);
      chatty.say({ t: 'ping', c0: s });
      session.sweep();
    }
    expect(session.online.map((x) => x.token)).toEqual(['chatty']);
  });

  it('keeps a quiet seated phone when the room server pings every link itself, as the relay does', async () => {
    const { session, phone, tick } = harness({ heartbeat: true });
    await session.open();
    const pocketed = phone();
    pocketed.say({ t: 'hello', token: 'pocket' });
    for (let s = 0; s < 60; s++) {
      tick(1000);
      session.sweep();
    }
    expect(session.online.map((x) => x.token)).toEqual(['pocket']);
    // A link that never says hello still goes.
    const mute = phone();
    let closed = false;
    mute.onClose(() => (closed = true));
    tick(11_000);
    session.sweep();
    expect(closed).toBe(true);
  });

  it('closes a link that never says hello', async () => {
    const { session, phone, tick } = harness();
    await session.open();
    const mute = phone();
    let closed = false;
    mute.onClose(() => (closed = true));
    tick(9000);
    session.sweep();
    expect(closed).toBe(false);
    tick(2000);
    session.sweep();
    expect(closed).toBe(true);
  });

  it('closes a link that has no seat 10 s after it opened, however much it sends', async () => {
    const { session, phone, tick } = harness();
    await session.open();
    const chatter = phone();
    let closed = false;
    chatter.onClose(() => (closed = true));
    for (let s = 0; s < 9; s++) {
      tick(1000);
      chatter.say({ t: 'ping', c0: s });
      chatter.say({ t: 'tap' });
      session.sweep();
    }
    expect(closed).toBe(false);
    tick(1500);
    chatter.say({ t: 'ping', c0: 99 });
    session.sweep();
    expect(closed).toBe(true);
  });
});

describe('untrusted phones', () => {
  it('takes a typed seat only while the seat grid asks, inside its size, and ignores repeats', async () => {
    const { session, phone } = harness();
    await session.open();
    const a = phone();
    a.say({ t: 'hello', token: 'aaa' });
    a.say({ t: 'seat', row: 2, seat: 3 });
    expect(session.gridEntries.size).toBe(0);
    session.setProgram({ kind: 'grid', rows: 4, seats: 10 });
    let changes = 0;
    session.subscribe(() => changes++);
    // Out of range is ignored, not moved to the nearest edge seat, where it would clash with a real one.
    a.say({ t: 'seat', row: 99, seat: -5.4 });
    a.say({ t: 'seat', row: 0, seat: 3 });
    a.say({ t: 'seat', row: 2, seat: 11 });
    expect(session.gridEntries.size).toBe(0);
    expect(changes).toBe(0);
    a.say({ t: 'seat', row: 4, seat: 1 });
    a.say({ t: 'seat', row: 4, seat: 1 });
    expect(session.gridEntries.get(0)).toEqual({ row: 4, seat: 1 });
    expect(changes).toBe(1);
    a.say({ t: 'seat', row: 2.4, seat: 7 });
    expect(session.gridEntries.get(0)).toEqual({ row: 2, seat: 7 });
  });

  it('refuses a new link while the oldest of 32 unspoken links is still within its first 1.5 s', async () => {
    const { session, phone, tick } = harness();
    await session.open();
    const idle = Array.from({ length: 32 }, () => {
      tick(10);
      const p = phone();
      let closed = false;
      p.onClose(() => (closed = true));
      return { ...p, closed: () => closed };
    });
    // A flood of sockets must not shove out a link that has had no time to say hello.
    expect(phone().closed()).toBe(true);
    expect(idle.some((p) => p.closed())).toBe(false);
    tick(1500);
    const honest = phone();
    expect(idle.map((p) => p.closed())).toEqual([true, ...Array(31).fill(false)]);
    honest.say({ t: 'hello', token: 'aaa' });
    expect(honest.inbox[0]).toMatchObject({ t: 'welcome' });
  });

  it('makes room for a new link by closing the oldest of 32 that never said hello', async () => {
    const { session, phone, tick } = harness();
    await session.open();
    const idle = Array.from({ length: 32 }, () => {
      tick(100);
      const p = phone();
      let closed = false;
      p.onClose(() => (closed = true));
      return { ...p, closed: () => closed };
    });
    const honest = phone();
    expect(idle.map((p) => p.closed())).toEqual([true, ...Array(31).fill(false)]);
    honest.say({ t: 'hello', token: 'aaa' });
    expect(honest.inbox[0]).toMatchObject({ t: 'welcome' });
    // A seated phone is no longer waiting, so the next link closes nobody.
    phone();
    expect(idle.filter((p) => p.closed())).toHaveLength(1);
    phone();
    expect(idle.filter((p) => p.closed())).toHaveLength(2);
    expect(idle[1].closed()).toBe(true);
  });

  it('gives the room up if it is closed while the transport is still opening it', async () => {
    vi.useFakeTimers();
    let finish!: () => void;
    const close = vi.fn();
    const transport = {
      name: 'slow',
      host: () => new Promise<HostEnd>((r) => (finish = () => r({ heartbeat: false, onLink: () => {}, onServer: () => {}, broadcast: sendEach, close }))),
      join: async () => {
        throw new Error('unused');
      },
    };
    const session = new HostSession(transport, 'TEST', () => 0);
    const opening = session.open();
    session.close();
    finish();
    await opening;
    const timers = vi.getTimerCount();
    vi.useRealTimers();
    expect(close).toHaveBeenCalledTimes(1);
    expect(timers).toBe(0);
  });

  it('does not count phones the full room turned away against new links', async () => {
    const { session, phone } = harness();
    await session.open();
    for (let i = 0; i < MAX_IDS; i++) phone().say({ t: 'hello', token: `t${i}` });
    const turned = Array.from({ length: 32 }, (_, i) => {
      const p = phone();
      let closed = false;
      p.onClose(() => (closed = true));
      p.say({ t: 'hello', token: `late${i}` });
      return { ...p, closed: () => closed };
    });
    expect(turned.every((p) => p.inbox[0]?.t === 'full')).toBe(true);
    // 32 new links all stay open: each is still there to hear its answer.
    const waiting = Array.from({ length: 32 }, () => phone());
    for (const [i, p] of waiting.entries()) p.say({ t: 'hello', token: `new${i}` });
    expect(waiting.map((p) => p.inbox[0]?.t)).toEqual(Array(32).fill('full'));
    expect(turned.some((p) => p.closed())).toBe(false);
  });
});

describe('phone screen shapes', () => {
  it('keeps the shape each seated phone reports, and nothing for one that has not', async () => {
    const { session, phone } = harness();
    await session.open();
    const a = phone();
    const b = phone();
    a.say({ t: 'hello', token: 'aaa' });
    b.say({ t: 'hello', token: 'bbb' });
    expect(session.screens().size).toBe(0);
    a.say({ t: 'screen', aspect: 0.46 });
    expect(session.screens()).toEqual(new Map([[0, 0.46]]));
    a.say({ t: 'screen', aspect: 2.1 });
    b.say({ t: 'screen', aspect: 0.5 });
    expect(session.screens()).toEqual(new Map([[0, 2.1], [1, 0.5]]));
  });

  it('ignores a shape from a link with no seat, or one that is not a believable screen', async () => {
    const { session, phone } = harness();
    await session.open();
    phone().say({ t: 'screen', aspect: 0.46 });
    const a = phone();
    a.say({ t: 'hello', token: 'aaa' });
    for (const aspect of [0, 99, NaN, '0.5']) a.say({ t: 'screen', aspect });
    expect(session.screens().size).toBe(0);
  });

  it('tells the host page only when a shape changed, and does not save it with the room', async () => {
    const storage = memoryStorage();
    vi.stubGlobal('localStorage', storage);
    try {
      const { session, phone } = harness();
      await session.open();
      const a = phone();
      a.say({ t: 'hello', token: 'aaa' });
      let changes = 0;
      session.subscribe(() => changes++);
      let writes = 0;
      const set = storage.setItem;
      storage.setItem = (k, v) => (writes++, set(k, v));
      const before = writes;
      a.say({ t: 'screen', aspect: 0.46 });
      a.say({ t: 'screen', aspect: 0.46 });
      expect(changes).toBe(1);
      expect(writes).toBe(before);
      expect(storage.getItem('swarm-host')).toContain('"token":"aaa"');
      expect(storage.getItem('swarm-host')).not.toContain('0.46');
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('a phone that comes back keeps its shape', async () => {
    const { session, phone } = harness();
    await session.open();
    const a = phone();
    a.say({ t: 'hello', token: 'aaa' });
    a.say({ t: 'screen', aspect: 0.46 });
    a.drop();
    phone().say({ t: 'hello', token: 'aaa' });
    expect(session.screens().get(0)).toBe(0.46);
  });
});

describe('the same limits on every transport', () => {
  const watched = (p: { onClose: (cb: () => void) => void }) => {
    let closed = false;
    p.onClose(() => (closed = true));
    return () => closed;
  };

  it('closes a link that sends a message over 2 KB, seated or not', async () => {
    const { session, phone } = harness();
    await session.open();
    const a = phone();
    const aClosed = watched(a);
    a.say({ t: 'hello', token: 'aaa' });
    a.say({ t: 'vote', choice: 1, pad: 'x'.repeat(PHONE_MESSAGE_BYTES - 40) });
    expect(aClosed()).toBe(false);
    a.say({ t: 'vote', choice: 1, pad: 'x'.repeat(PHONE_MESSAGE_BYTES) });
    expect(aClosed()).toBe(true);
    const b = phone();
    const bClosed = watched(b);
    b.say({ t: 'hello', token: 'x'.repeat(PHONE_MESSAGE_BYTES) });
    expect(bClosed()).toBe(true);
    expect(session.seats.size).toBe(1);
  });

  it('closes a link that floods, and keeps one at twice an honest phone’s budget', async () => {
    const { session, phone, tick } = harness();
    await session.open();
    const flood = phone();
    const floodClosed = watched(flood);
    flood.say({ t: 'hello', token: 'flood' });
    for (let i = 0; i < 200; i++) flood.say({ t: 'tap' });
    expect(floodClosed()).toBe(true);
    const busy = phone();
    const busyClosed = watched(busy);
    busy.say({ t: 'hello', token: 'busy' });
    for (let ms = 0; ms < 10_000; ms += 20) {
      tick(20);
      busy.say({ t: 'ping', c0: ms });
    }
    expect(1000 / 20).toBe(2 * PHONE_BUDGET.rate);
    expect(busyClosed()).toBe(false);
  });
});

describe('a full room', () => {
  it('gives a new phone the seat held longest by one that left unplaced, never a placed one', async () => {
    const { session, phone, tick } = harness();
    await session.open();
    const phones = Array.from({ length: MAX_IDS }, (_, i) => {
      const p = phone();
      p.say({ t: 'hello', token: `t${i}` });
      return p;
    });
    expect(session.seats.size).toBe(MAX_IDS);
    session.setRaw(new Map([[5, { x: 0.5, y: 0.5 }]]), 'camera');
    tick(10);
    phones[5].drop(); // placed: keeps its seat for when it comes back
    tick(10);
    phones[9].drop();
    tick(10);
    phones[7].drop();
    const late = phone();
    late.say({ t: 'hello', token: 'late' });
    expect(late.inbox[0]).toEqual({ t: 'welcome', seat: 9, room: 'TEST' });
    const later = phone();
    later.say({ t: 'hello', token: 'later' });
    expect(later.inbox[0]).toMatchObject({ seat: 7 });
    const full = phone();
    full.say({ t: 'hello', token: 'full' });
    expect(full.inbox).toEqual([{ t: 'full' }]);
    // The placed phone still has its seat when it returns.
    const back = phone();
    back.say({ t: 'hello', token: 't5' });
    expect(back.inbox[0]).toMatchObject({ seat: 5 });
  });
});

describe('song offers', () => {
  it('tells a joining phone there is no song, so one from before the host reloaded is dropped', async () => {
    const { session, phone } = harness();
    await session.open();
    const a = phone();
    a.say({ t: 'hello', token: 'aaa' });
    expect(a.inbox).toContainEqual({ t: 'offer', track: null });
  });
});

describe('message size', () => {
  it('never hands a link a message over the limit, whatever sends it', async () => {
    const { session, phone } = harness();
    await session.open();
    const a = phone();
    a.say({ t: 'hello', token: 'aaa' });
    const before = a.inbox.length;
    const big = 'x'.repeat(MAX_MESSAGE_BYTES);
    session.setProgram({ kind: 'follow', view: { show: 'card', text: big, n: 1, of: 1 } });
    expect(a.inbox.length).toBe(before);
    // The program in place stays, so a late joiner isn't handed the oversized one either.
    expect(session.programOf(0)).toEqual({ kind: 'lobby' });
    session.setProgram(() => ({ kind: 'follow', view: { show: 'card', text: big, n: 1, of: 1 } }));
    expect(a.inbox.length).toBe(before);
    expect(session.send(0, { t: 'chunk', id: 'f', i: 0, n: 1, d: big })).toBe(false);
    expect(a.inbox.length).toBe(before);
    expect(session.send(0, { t: 'chunk', id: 'f', i: 0, n: 1, d: 'AAAA' })).toBe(true);
  });

  it('judges size in UTF-8 bytes', () => {
    expect(fits({ s: 'a'.repeat(MAX_MESSAGE_BYTES - 20) })).toBe(true);
    expect(fits({ s: 'é'.repeat(MAX_MESSAGE_BYTES / 2) })).toBe(false);
    expect(fits({ s: 'é'.repeat(MAX_MESSAGE_BYTES / 2 - 20) })).toBe(true);
  });
});

describe('room server outage', () => {
  it('tells listeners while the room server is down, and when it is back', async () => {
    const { session, server } = harness();
    await session.open();
    const seen: string[] = [];
    session.subscribe(() => seen.push(session.server));
    server('down');
    server('up');
    expect(seen).toEqual(['down', 'up']);
  });
});


describe('closing the room', () => {
  it('stops the sweep and closes every link', async () => {
    vi.useFakeTimers();
    try {
      const { session, phone } = harness();
      const sweep = vi.spyOn(session, 'sweep');
      await session.open();
      const p = phone();
      let closed = false;
      p.onClose(() => (closed = true));
      vi.advanceTimersByTime(3000);
      expect(sweep).toHaveBeenCalledTimes(3);
      session.close();
      expect(closed).toBe(true);
      vi.advanceTimersByTime(5000);
      expect(sweep).toHaveBeenCalledTimes(3);
    } finally {
      vi.useRealTimers();
    }
  });
});
