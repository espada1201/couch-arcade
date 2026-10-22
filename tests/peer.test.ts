import { afterEach, describe, expect, it, vi } from 'vitest';
import { pack, unpack } from 'peerjs-js-binarypack';
import { PHONE_LIMIT, PHONE_MESSAGE_BYTES } from '../src/net/limits.js';
import { settleWithin, wrap } from '../src/net/peer';

afterEach(() => vi.useRealTimers());

describe('settleWithin', () => {
  it('resolves with the first success and ignores later outcomes', async () => {
    const onFail = vi.fn();
    let fail!: (e: Error) => void;
    const p = settleWithin<number>(1000, 'slow', onFail, (ok, f) => {
      fail = f;
      ok(1);
      ok(2);
    });
    fail(new Error('late'));
    await expect(p).resolves.toBe(1);
    expect(onFail).not.toHaveBeenCalled();
  });

  it('times out once, cleans up, and tells a late success it lost', async () => {
    vi.useFakeTimers();
    const onFail = vi.fn();
    let ok!: (v: string) => void;
    let done!: () => boolean;
    const p = settleWithin<string>(500, 'too slow', onFail, (o, _f, d) => ((ok = o), (done = d)));
    const failed = expect(p).rejects.toThrow('too slow');
    expect(done()).toBe(false);
    await vi.advanceTimersByTimeAsync(500);
    await failed;
    expect(done()).toBe(true);
    ok('late');
    expect(onFail).toHaveBeenCalledTimes(1);
  });

  it('fails on the first error with cleanup', async () => {
    const onFail = vi.fn();
    const p = settleWithin<number>(1000, 'slow', onFail, (_ok, fail) => {
      fail(new Error('broker down'));
      fail(new Error('again'));
    });
    await expect(p).rejects.toThrow('broker down');
    expect(onFail).toHaveBeenCalledTimes(1);
  });
});

describe('wrap', () => {
  const fakeConn = () => {
    const dataChannel = new EventTarget();
    const handlers: Record<string, (d?: unknown) => void> = {};
    const conn = { dataChannel, on: (e: string, cb: (d?: unknown) => void) => (handlers[e] = cb), send: vi.fn(), close: vi.fn() };
    const piece = (bytes: number) => dataChannel.dispatchEvent(new MessageEvent('message', { data: new ArrayBuffer(bytes) }));
    return { conn: conn as unknown as Parameters<typeof wrap>[0], piece, handlers };
  };

  it('ends a link at the first piece over its limit, before PeerJS can stitch a big message together', () => {
    const { conn, piece } = fakeConn();
    const link = wrap(conn, PHONE_MESSAGE_BYTES);
    const closed = vi.fn();
    link.onClose(closed);
    piece(PHONE_MESSAGE_BYTES);
    expect(closed).not.toHaveBeenCalled();
    piece(16300);
    expect(closed).toHaveBeenCalledTimes(1);
    expect(conn.close).toHaveBeenCalled();
  });

  it('takes pieces of any size from the host', () => {
    const { conn, piece, handlers } = fakeConn();
    const link = wrap(conn);
    const got = vi.fn();
    link.onMessage(got);
    piece(16300);
    handlers.data({ t: 'chunk' });
    expect(got).toHaveBeenCalledWith({ t: 'chunk' });
    expect(conn.close).not.toHaveBeenCalled();
  });
});

describe('wrap against a phone that chunks on purpose', () => {
  // PeerJS keeps the pieces of a chunked message until the last one arrives and says nothing in
  // between, so a phone sending pieces that claim a million more to come fills the host's memory.
  // This stands in for that stitcher: it listens before wrap does, as PeerJS's own listener does.
  const stitcher = () => {
    const dataChannel = new EventTarget();
    const held = new Map<number, ArrayBuffer[]>();
    const handlers: Record<string, (d?: unknown) => void> = {};
    dataChannel.addEventListener('message', (e) => {
      const piece = unpack((e as MessageEvent<ArrayBuffer>).data) as { __peerData?: number; data: ArrayBuffer };
      if (piece.__peerData) held.set(piece.__peerData, [...(held.get(piece.__peerData) ?? []), piece.data]);
    });
    const conn = { dataChannel, on: (e: string, cb: (d?: unknown) => void) => (handlers[e] = cb), send: vi.fn(), close: vi.fn(() => held.clear()) };
    const send = (data: ArrayBuffer | string) => dataChannel.dispatchEvent(new MessageEvent('message', { data }));
    const chunk = (id: number, n: number) => pack({ __peerData: id, n, total: 1_000_000, data: new Uint8Array(512) }) as ArrayBuffer;
    return { conn: conn as unknown as Parameters<typeof wrap>[0], send, chunk, held: () => [...held.values()].flat().length };
  };

  it('ends the link at the first chunk piece, however small, and holds nothing', () => {
    const { conn, send, chunk, held } = stitcher();
    const link = wrap(conn, PHONE_MESSAGE_BYTES);
    const closed = vi.fn();
    link.onClose(closed);
    send(chunk(1, 0));
    expect(closed).toHaveBeenCalledTimes(1);
    expect(conn.close).toHaveBeenCalled();
    expect(held()).toBe(0);
  });

  it('counts every piece against the rate limit, so a stream of pieces cannot pass as a phone', () => {
    const { conn, send, chunk } = stitcher();
    const link = wrap(conn, PHONE_MESSAGE_BYTES);
    const closed = vi.fn();
    link.onClose(closed);
    const tiny = pack({ t: 'ping' }) as ArrayBuffer;
    for (let i = 0; i < PHONE_LIMIT.burst; i++) send(tiny);
    expect(closed).not.toHaveBeenCalled();
    send(tiny);
    expect(closed).toHaveBeenCalledTimes(1);
    send(chunk(2, 0));
    expect(closed).toHaveBeenCalledTimes(1);
  });

  it('measures a string piece by its length', () => {
    const a = stitcher();
    const la = wrap(a.conn, PHONE_MESSAGE_BYTES);
    const closeA = vi.fn();
    la.onClose(closeA);
    a.send('x'.repeat(PHONE_MESSAGE_BYTES));
    expect(closeA).not.toHaveBeenCalled();
    const b = stitcher();
    const lb = wrap(b.conn, PHONE_MESSAGE_BYTES);
    const closeB = vi.fn();
    lb.onClose(closeB);
    b.send('x'.repeat(PHONE_MESSAGE_BYTES + 1));
    expect(closeB).toHaveBeenCalledTimes(1);
  });
});
