import { describe, expect, it, vi } from 'vitest';
import { HostSession } from '../src/host/session';
import { BasicLink } from '../src/net/transport';
import { MAX_MESSAGE_BYTES, fits, type HostMsg } from '../src/core/protocol';
import { memoryStorage, testTransport } from './harness';

/** Several phones against a real HostSession. */
function harness() {
  const { transport, accept, server } = testTransport();
  let clock = 1000;
  const session = new HostSession(transport, 'TEST', () => clock);
  const phone = () => {
    const inbox: HostMsg[] = [];
    const hostSide = new BasicLink((m) => inbox.push(m as HostMsg));
    accept(hostSide);
    return { inbox, say: (m: unknown) => hostSide.deliver(m), drop: () => hostSide.ended(), onClose: (cb: () => void) => hostSide.onClose(cb) };
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
  it('drops a seated phone the host has not heard from for 15 s, and keeps one that pings', async () => {
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
    a.say({ t: 'seat', row: 99, seat: -5.4 });
    expect(session.gridEntries.get(0)).toEqual({ row: 4, seat: 1 });
    a.say({ t: 'seat', row: 99, seat: -5.4 });
    a.say({ t: 'seat', row: 4, seat: 1 });
    expect(changes).toBe(1);
    a.say({ t: 'seat', row: 2.4, seat: 7 });
    expect(session.gridEntries.get(0)).toEqual({ row: 2, seat: 7 });
  });

  it('refuses new links while 32 are open without a seat', async () => {
    const { session, phone } = harness();
    await session.open();
    const idle = Array.from({ length: 32 }, () => phone());
    const extra = phone();
    extra.say({ t: 'hello', token: 'xxx' });
    expect(extra.inbox).toEqual([]);
    // One of them takes a seat, which frees a place.
    idle[0].say({ t: 'hello', token: 'aaa' });
    const next = phone();
    next.say({ t: 'hello', token: 'bbb' });
    expect(next.inbox[0]).toMatchObject({ t: 'welcome' });
    expect(session.online).toHaveLength(2);
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

describe('links', () => {
  it('local links never report a backlog', () => {
    expect(new BasicLink(() => {}).buffered()).toBe(0);
  });
});

