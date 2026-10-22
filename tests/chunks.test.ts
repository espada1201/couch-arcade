import { describe, expect, it } from 'vitest';
import { CHUNK_BYTES, ChunkSender, MAX_MESSAGE, Reassembler, chunkCount, chunkMsg, fromBase64, toBase64 } from '../src/net/chunks';

function bytes(n: number): Uint8Array {
  const b = new Uint8Array(n);
  for (let i = 0; i < n; i++) b[i] = (i * 31 + 7) & 0xff;
  return b;
}

/** Sends every due chunk of `data` into `r`, optionally dropping some, and returns what was sent. */
function deliver(data: Uint8Array, sender: ChunkSender, r: Reassembler, now: number, drop: (i: number) => boolean = () => false): number[] {
  const sent = sender.due(now);
  for (const i of sent) {
    const m = chunkMsg('song', data, i);
    if (!drop(i)) r.add(m.i, m.d);
  }
  sender.ack(r.next, r.got, now);
  return sent;
}

describe('chunks', () => {
  it('base64 round-trips every byte value', () => {
    const all = Uint8Array.from({ length: 256 * 3 + 1 }, (_, i) => i & 0xff);
    expect(fromBase64(toBase64(all))).toEqual(all);
  });

  it('keeps every serialized chunk message under the 60 KB limit', () => {
    const data = bytes(CHUNK_BYTES * 2 + 5);
    expect(chunkCount(data.length)).toBe(3);
    for (let i = 0; i < 3; i++) expect(JSON.stringify(chunkMsg('a-long-track-id-0123456789abcdef', data, i)).length).toBeLessThanOrEqual(MAX_MESSAGE);
  });

  it('reassembles chunks that arrive out of order and twice', () => {
    const data = bytes(CHUNK_BYTES * 4 + 100);
    const n = chunkCount(data.length);
    const r = new Reassembler(n);
    for (const i of [3, 0, 4, 0, 2, 3, 1]) r.add(i, chunkMsg('x', data, i).d);
    expect(r.got).toBe(n);
    expect(r.done).toBe(true);
    expect(r.bytes()).toEqual(data);
  });

  it('reports the lowest missing chunk and ignores junk indices', () => {
    const data = bytes(CHUNK_BYTES * 3);
    const r = new Reassembler(3);
    expect(r.add(7, 'AAAA')).toBe(false);
    expect(r.add(-1, 'AAAA')).toBe(false);
    expect(r.add(1.5, 'AAAA')).toBe(false);
    r.add(0, chunkMsg('x', data, 0).d);
    r.add(2, chunkMsg('x', data, 2).d);
    expect(r.next).toBe(1);
    expect(r.got).toBe(2);
    expect(r.done).toBe(false);
  });

  it('keeps a bounded window in flight and slides it as acks come back', () => {
    const sender = new ChunkSender(20, { window: 4, stallMs: 1000 });
    expect(sender.due(0)).toEqual([0, 1, 2, 3]);
    expect(sender.due(0)).toEqual([]);
    sender.ack(2, 2, 10);
    expect(sender.due(10)).toEqual([4, 5]);
  });

  it('resends a lost chunk after the receiver stalls, then finishes', () => {
    const data = bytes(CHUNK_BYTES * 9 + 1);
    const n = chunkCount(data.length);
    const sender = new ChunkSender(n, { window: 4, stallMs: 500 });
    const r = new Reassembler(n);
    let now = 0;
    deliver(data, sender, r, now, (i) => i === 2);
    // The hole at 2 holds the window shut: nothing new goes out until the stall timer fires.
    for (let k = 0; k < 3; k++) deliver(data, sender, r, (now += 50));
    expect(r.next).toBe(2);
    expect(sender.due((now += 50))).toEqual([]);
    const resent = deliver(data, sender, r, (now += 600));
    expect(resent[0]).toBe(2);
    while (!sender.done) deliver(data, sender, r, (now += 50));
    expect(r.bytes()).toEqual(data);
  });

  it('a receiver that already holds part of the file (a reconnect) resumes where it left off', () => {
    const sender = new ChunkSender(10, { window: 3 });
    sender.ack(6, 6, 0);
    expect(sender.due(0)).toEqual([6, 7, 8]);
  });

  it('an empty file is done at once', () => {
    expect(chunkCount(0)).toBe(0);
    expect(new Reassembler(0).done).toBe(true);
    expect(new ChunkSender(0).done).toBe(true);
  });
});
