import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PhoneClient } from '../src/phone/client';
import { BasicLink, type Link, type Transport } from '../src/net/transport';

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
  const transport: Transport = {
    name: 'test',
    host: async () => {
      throw new Error('unused');
    },
    join: async (): Promise<Link> => {
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
  return { transport, links, goQuiet: () => (answering = false) };
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
});
