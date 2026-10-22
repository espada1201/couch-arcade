import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { HostMsg } from '../src/core/protocol';
import { CHUNK_BACKLOG, FileShare } from '../src/host/fileshare';
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
    for (const p of r.phones) p.say({ t: 'have', id: 'song', next: 2, got: 2 });
    const [a, b] = r.phones.map((p) => chunks(p.inbox));
    expect(a).toHaveLength(3);
    expect(b).toHaveLength(3);
    // The very same message objects: base64 was done once for the whole room.
    a.forEach((m, i) => expect(b[i]).toBe(m));
    share.stop();
  });

  it('queues no more song for a phone whose link is backed up, and resumes as it drains', async () => {
    const r = await room([]);
    // The link holds every chunk sent to it until the test lets `drained` bytes through.
    let drained = -CHUNK_BACKLOG;
    const phone = r.join('slow', () => chunks(phone.inbox).length * 60_000 - drained);
    const share = new FileShare(r.session, 'song', new Uint8Array(CHUNK_BYTES * 20));
    share.start();
    r.session.input({ have: (seat, m) => share.have(seat, m) });
    phone.say({ t: 'have', id: 'song', next: 0, got: 0 });
    vi.advanceTimersByTime(1000);
    expect(chunks(phone.inbox)).toHaveLength(0);
    drained = 60_000 - CHUNK_BACKLOG;
    vi.advanceTimersByTime(300);
    // Room for one chunk on the link, though the window allows two.
    expect(chunks(phone.inbox)).toHaveLength(1);
    drained = 120_000 - CHUNK_BACKLOG;
    vi.advanceTimersByTime(300);
    expect(chunks(phone.inbox)).toHaveLength(2);
    drained = 2 * 60_000;
    phone.say({ t: 'have', id: 'song', next: 2, got: 2 });
    expect(chunks(phone.inbox).map((m) => m.i)).toEqual([0, 1, 2, 3]);
    share.stop();
  });

  it('runs its resend timer only while a phone is still fetching', async () => {
    const r = await room([0]);
    const share = new FileShare(r.session, 'song', new Uint8Array(CHUNK_BYTES * 3));
    share.start();
    r.session.input({ have: (seat, m) => share.have(seat, m) });
    // The session's own sweep timer is the baseline.
    const base = vi.getTimerCount();
    r.phones[0].say({ t: 'have', id: 'song', next: 0, got: 0 });
    expect(vi.getTimerCount()).toBe(base + 1);
    r.phones[0].say({ t: 'have', id: 'song', next: 3, got: 3, state: 'ready' });
    expect(vi.getTimerCount()).toBe(base);
    expect(share.progress()).toEqual([{ seat: 0, progress: 1, state: 'ready' }]);
    // A phone that drops mid-download is forgotten at the next tick, and the timer stops with it.
    const late = r.join('late');
    late.say({ t: 'have', id: 'song', next: 0, got: 0 });
    expect(vi.getTimerCount()).toBe(base + 1);
    late.drop();
    vi.advanceTimersByTime(300);
    expect(vi.getTimerCount()).toBe(base);
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

  it('a phone that said ready stays ready on that link, whatever ack comes after', async () => {
    const r = await room([0.5]);
    const share = new FileShare(r.session, 'song', new Uint8Array(10));
    share.start();
    r.session.input({ have: (seat, m) => share.have(seat, m) });
    const [p] = r.phones;
    p.say({ t: 'have', id: 'song', next: 1, got: 1, state: 'ready' });
    p.say({ t: 'have', id: 'song', next: 1, got: 1 });
    expect(share.progress()).toEqual([{ seat: 0, progress: 1, state: 'ready' }]);
    // Back on a new link it must say so again.
    p.drop();
    const again = r.join('p0');
    again.say({ t: 'have', id: 'song', next: 1, got: 1 });
    expect(share.progress()).toEqual([{ seat: 0, progress: 1, state: undefined }]);
    share.stop();
  });

  it('a link whose seat a newer link took is not heard: its late acks are not taken for the new one', async () => {
    const r = await room([0.5]);
    const share = new FileShare(r.session, 'song', new Uint8Array(10));
    share.start();
    r.session.input({ have: (seat, m) => share.have(seat, m) });
    const [old] = r.phones;
    const now = r.join('p0');
    now.say({ t: 'have', id: 'song', next: 1, got: 1, state: 'ready' });
    old.say({ t: 'have', id: 'song', next: 0, got: 0, state: 'error' });
    expect(share.progress()).toEqual([{ seat: 0, progress: 1, state: 'ready' }]);
    share.stop();
  });
});
