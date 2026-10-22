import { describe, expect, it } from 'vitest';
import { MAX_MESSAGE_BYTES } from '../src/core/protocol';
import { CHUNK_BYTES, ChunkSender, Reassembler, chunkCount, chunkMsg, fromBase64, toBase64 } from '../src/net/chunks';

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
    for (let i = 0; i < 3; i++) expect(JSON.stringify(chunkMsg('a-long-track-id-0123456789abcdef', data, i)).length).toBeLessThanOrEqual(MAX_MESSAGE_BYTES);
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

  it('a receiver whose acks come back slowly is not sent the same chunks twice', () => {
    const sender = new ChunkSender(20, { window: 4, stallMs: 2000 });
    expect(sender.due(0)).toEqual([0, 1, 2, 3]);
    // Slow Wi-Fi: the first chunk took 3 s to arrive and be acked.
    sender.ack(1, 1, 3000);
    expect(sender.due(3000)).toEqual([4]);
    // 2.5 s with no further ack is longer than stallMs but well inside a few round trips.
    expect(sender.due(5500)).toEqual([]);
    expect(sender.stall).toBe(12_000);
    // A chunk really lost still comes back, once the round trip based stall has passed.
    expect(sender.due(15_001)).toEqual([1, 2, 3, 4]);
    // The ack for a resent chunk can't tell which copy arrived, so it doesn't shrink the round trip;
    // and a second stall in a row waits twice as long.
    sender.ack(2, 2, 15_100);
    expect(sender.stall).toBe(12_000);
    expect(sender.due(15_100 + 12_001)).toEqual([2, 3, 4, 5]);
    expect(sender.due(15_100 + 12_001 + 20_000)).toEqual([]);
    expect(sender.stall).toBe(24_000);
  });

  it('hands out at most the chunks asked for, keeping the rest for later', () => {
    const sender = new ChunkSender(10, { window: 4 });
    expect(sender.due(0, 1)).toEqual([0]);
    expect(sender.due(0, 2)).toEqual([1, 2]);
    expect(sender.due(0)).toEqual([3]);
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
