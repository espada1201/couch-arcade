import { afterEach, describe, expect, it, vi } from 'vitest';
import { PHONE_MESSAGE_BYTES } from '../src/net/limits.js';
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
