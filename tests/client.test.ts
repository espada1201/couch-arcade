import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PhoneClient } from '../src/phone/client';
import { BasicLink, type Link, type Transport } from '../src/net/transport';
import { PHONE_BUDGET, PHONE_LIMIT, tokenBucket } from '../src/net/limits.js';

beforeEach(() => {
  vi.useFakeTimers();
  vi.stubGlobal('window', globalThis);
  vi.stubGlobal('document', { addEventListener: () => {}, removeEventListener: () => {}, visibilityState: 'visible', hidden: false });
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

/** A host that welcomes the phone, then may stop answering without ever closing the link. */
function silentHost() {
  const links: BasicLink[] = [];
  let answering = true;
  let away = false;
  let joins = 0;
  const transport: Transport = {
    name: 'test',
    host: async () => {
      throw new Error('unused');
    },
    join: async (): Promise<Link> => {
      joins++;
      if (away) throw new Error('No host is running room ABCD on this network.');
      const link: BasicLink = new BasicLink((m) => {
        const msg = m as { t: string; c0?: number };
        if (!answering) return;
        if (msg.t === 'hello') queueMicrotask(() => link.deliver({ t: 'welcome', seat: 4, room: 'ABCD' }));
        if (msg.t === 'ping') queueMicrotask(() => link.deliver({ t: 'pong', c0: msg.c0, h1: 0, h2: 0 }));
      });
      links.push(link);
      return link;
    },
  };
  return {
    transport,
    links,
    joins: () => joins,
    goQuiet: () => (answering = false),
    /** The relay restarted: the room is gone (join refused) until the host reclaims it. */
    setAway: (v: boolean) => {
      away = v;
      if (v) links.at(-1)?.ended();
    },
  };
}

describe('phone client', () => {
  it('notices a host that went away without closing the link, and reconnects', async () => {
    const host = silentHost();
    const client = new PhoneClient(host.transport, 'ABCD');
    await client.connect();
    await vi.advanceTimersByTimeAsync(5000);
    expect(client.status).toBe('live');
    host.goQuiet();
    await vi.advanceTimersByTimeAsync(9000);
    expect(host.links.length).toBeGreaterThan(1);
    expect(client.status).not.toBe('live');
  });

  it('counts any message from the host as alive, so pongs queued behind song chunks do not drop the link', async () => {
    const host = silentHost();
    const client = new PhoneClient(host.transport, 'ABCD');
    await client.connect();
    await vi.advanceTimersByTimeAsync(1000);
    host.goQuiet();
    // No pongs for 12 s, but a chunk arrives every second.
    for (let s = 0; s < 12; s++) {
      host.links.at(-1)!.deliver({ t: 'chunk', id: 'song', i: s, n: 99, d: '' });
      await vi.advanceTimersByTimeAsync(1000);
    }
    expect(host.links).toHaveLength(1);
    expect(client.status).toBe('live');
  });

  it('sends a quick run of file acks as the newest, at most one per 40 ms', async () => {
    const sent: { t: string; next?: number }[] = [];
    const transport: Transport = {
      name: 'test',
      host: async () => {
        throw new Error('unused');
      },
      join: async () => new BasicLink((m) => sent.push(m as { t: string })),
    };
    const client = new PhoneClient(transport, 'ABCD');
    await client.connect();
    for (let i = 1; i <= 10; i++) client.have({ t: 'have', id: 'song', next: i, got: i });
    await vi.advanceTimersByTimeAsync(100);
    expect(sent.filter((m) => m.t === 'have').map((m) => m.next)).toEqual([1, 10]);
  });

  it('a seated phone keeps reconnecting through a long relay restart and gets its seat back', async () => {
    const host = silentHost();
    const client = new PhoneClient(host.transport, 'ABCD');
    await client.connect();
    await vi.advanceTimersByTimeAsync(1000);
    expect(client.status).toBe('live');
    host.setAway(true);
    await vi.advanceTimersByTimeAsync(60_000);
    expect(client.status).toBe('reconnecting');
    host.setAway(false);
    await vi.advanceTimersByTimeAsync(6000);
    expect(client.status).toBe('live');
    expect(client.seat).toBe(4);
  });

  it('a seated phone keeps knocking about every 15 s after the first two minutes, for as long as the host holds the room', async () => {
    const host = silentHost();
    const client = new PhoneClient(host.transport, 'ABCD');
    await client.connect();
    await vi.advanceTimersByTimeAsync(1000);
    host.setAway(true);
    await vi.advanceTimersByTimeAsync(3 * 60_000);
    const before = host.joins();
    await vi.advanceTimersByTimeAsync(2 * 60_000);
    expect(host.joins() - before).toBeGreaterThanOrEqual(7);
    expect(host.joins() - before).toBeLessThanOrEqual(9);
    expect(client.status).toBe('reconnecting');
    await vi.advanceTimersByTimeAsync(4 * 60_000);
    host.setAway(false);
    await vi.advanceTimersByTimeAsync(16_000);
    expect(client.status).toBe('live');
    expect(client.seat).toBe(4);
  });

  it('a seated phone gives up after 10 minutes without its host and offers to try again', async () => {
    const host = silentHost();
    const client = new PhoneClient(host.transport, 'ABCD');
    await client.connect();
    await vi.advanceTimersByTimeAsync(1000);
    host.setAway(true);
    await vi.advanceTimersByTimeAsync(9 * 60_000);
    expect(client.status).toBe('reconnecting');
    await vi.advanceTimersByTimeAsync(2 * 60_000);
    expect(client.status).toBe('failed');
    const joins = host.joins();
    await vi.advanceTimersByTimeAsync(60_000);
    expect(host.joins()).toBe(joins);
    host.setAway(false);
    client.retry();
    await vi.advanceTimersByTimeAsync(1000);
    expect(client.status).toBe('live');
  });

  it('a phone woken after a long lock gets a fresh run of quick retries while its host restarts', async () => {
    const wake: (() => void)[] = [];
    const doc = { addEventListener: (_: string, cb: () => void) => wake.push(cb), removeEventListener: () => {}, visibilityState: 'visible', hidden: false };
    vi.stubGlobal('document', doc);
    const host = silentHost();
    const client = new PhoneClient(host.transport, 'ABCD');
    await client.connect();
    await vi.advanceTimersByTimeAsync(1000);
    doc.hidden = true;
    host.setAway(true);
    await vi.advanceTimersByTimeAsync(15 * 60_000);
    doc.hidden = false;
    for (const cb of wake.splice(0)) cb();
    await vi.advanceTimersByTimeAsync(100);
    expect(client.status).toBe('reconnecting');
    host.setAway(false);
    await vi.advanceTimersByTimeAsync(6000);
    expect(client.status).toBe('live');
  });

  it('a first join to a room nobody hosts says connecting, then fails soon with the reason', async () => {
    const transport: Transport = {
      name: 'test',
      host: async () => {
        throw new Error('unused');
      },
      join: () => Promise.reject(new Error('No host is running room ZZZZ on this network.')),
    };
    const seen: string[] = [];
    const client = new PhoneClient(transport, 'ZZZZ');
    client.onChange = () => seen.push(client.status);
    await client.connect();
    await vi.advanceTimersByTimeAsync(10_000);
    expect(seen).not.toContain('reconnecting');
    expect(client.status).toBe('failed');
    expect(client.error).toContain('No host is running room ZZZZ');
  });

  it('mashing taps through a fast song download keeps the phone inside its own message budget', async () => {
    const sent: { t: string; at: number }[] = [];
    let link!: BasicLink;
    const transport: Transport = {
      name: 'test',
      host: async () => {
        throw new Error('unused');
      },
      join: async () => (link = new BasicLink((m) => sent.push({ t: (m as { t: string }).t, at: performance.now() }))),
    };
    const client = new PhoneClient(transport, 'ABCD');
    await client.connect();
    link.deliver({ t: 'welcome', seat: 0, room: 'ABCD' });
    let next = 0;
    for (let ms = 0; ms < 20_000; ms += 5) {
      // Chunks land every 5 ms on fast Wi-Fi, a picture frame every 100 ms, and a tap every 66 ms.
      client.have({ t: 'have', id: 'song', next: ++next, got: next });
      if (ms % 100 === 0) link.deliver({ t: 'program', program: { kind: 'lobby' }, ack: ms / 100 + 1 });
      if (ms % 66 < 5) client.tap();
      await vi.advanceTimersByTimeAsync(5);
    }
    // The phone keeps to its own budget, which leaves the host's and relay's limit real headroom.
    const own = tokenBucket(PHONE_BUDGET, 0);
    expect(sent.filter((m) => m.t !== 'hello' && !own.take(m.at))).toEqual([]);
    expect(PHONE_LIMIT.rate).toBeGreaterThanOrEqual(2 * PHONE_BUDGET.rate);
    const count = (t: string) => sent.filter((m) => m.t === t).length;
    // Every tap a person makes at 15 a second still goes, and the song and frames keep moving.
    expect(count('tap')).toBeGreaterThanOrEqual(300);
    expect(count('have')).toBeGreaterThan(100);
    expect(count('ack')).toBeGreaterThan(50);
    expect(sent.filter((m) => m.t === 'ack').at(-1)!.at).toBeGreaterThan(19_000);
  });

  it('sends a song’s ready ack at once, never left to a timer a hidden tab may hold back, and nothing stale after it', async () => {
    const sent: { t: string; next?: number; state?: string }[] = [];
    const transport: Transport = {
      name: 'test',
      host: async () => {
        throw new Error('unused');
      },
      join: async () => new BasicLink((m) => sent.push(m as { t: string })),
    };
    const client = new PhoneClient(transport, 'ABCD');
    await client.connect();
    client.have({ t: 'have', id: 'song', next: 9, got: 9 });
    client.have({ t: 'have', id: 'song', next: 10, got: 10 });
    // Decoded a few ms later: no timer runs in between.
    client.have({ t: 'have', id: 'song', next: 10, got: 10, state: 'ready' });
    expect(sent.filter((m) => m.t === 'have').at(-1)).toMatchObject({ state: 'ready' });
    await vi.advanceTimersByTimeAsync(1000);
    expect(sent.filter((m) => m.t === 'have').at(-1)).toMatchObject({ state: 'ready' });
  });
});
