import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { HostMsg } from '../src/core/protocol';
import { FileShare } from '../src/host/fileshare';
import { CHUNK_BYTES } from '../src/net/chunks';
import { room } from './harness';

beforeEach(() => {
  vi.stubGlobal('window', globalThis);
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

const chunks = (inbox: HostMsg[]) => inbox.filter((m) => m.t === 'chunk');

describe('sharing a file with the room', () => {
  it('encodes each chunk once, however many phones fetch it', async () => {
    const r = await room([0, 1]);
    const share = new FileShare(r.session, 'song', new Uint8Array(CHUNK_BYTES * 2 + 10).fill(7));
    share.start();
    r.session.input({ have: (seat, m) => share.have(seat, m) });
    for (const p of r.phones) p.say({ t: 'have', id: 'song', next: 0, got: 0 });
    const [a, b] = r.phones.map((p) => chunks(p.inbox));
    expect(a).toHaveLength(3);
    expect(b).toHaveLength(3);
    // The very same message objects: base64 was done once for the whole room.
    a.forEach((m, i) => expect(b[i]).toBe(m));
    share.stop();
  });

  it('keeps answering acks while another feature holds the room', async () => {
    const r = await room([0]);
    const share = new FileShare(r.session, 'song', new Uint8Array(10));
    share.start();
    r.session.input({ have: (seat, m) => share.have(seat, m) });
    r.director.run({ onInput: { tap: () => {} } });
    r.phones[0].say({ t: 'have', id: 'song', next: 0, got: 0 });
    expect(chunks(r.phones[0].inbox)).toHaveLength(1);
    share.stop();
  });

  it('a phone that joins later is offered the song', async () => {
    const r = await room([0]);
    const track = { id: 'song', name: 'Song', size: 10, n: 1, duration: 3 };
    r.session.offer(track);
    expect(r.phones[0].inbox.at(-1)).toEqual({ t: 'offer', track });
    const late = r.join('late');
    expect(late.inbox).toContainEqual({ t: 'offer', track });
  });
});
