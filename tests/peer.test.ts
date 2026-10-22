import { afterEach, describe, expect, it, vi } from 'vitest';
import { settleWithin } from '../src/net/peer';

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
