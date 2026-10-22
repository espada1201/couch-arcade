import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { LocalTransport } from '../src/net/local';

const listeners = new Set<EventListenerOrEventListenerObject>();

beforeEach(() => {
  listeners.clear();
  vi.stubGlobal('addEventListener', (type: string, cb: EventListenerOrEventListenerObject) => type === 'pagehide' && listeners.add(cb));
  vi.stubGlobal('removeEventListener', (type: string, cb: EventListenerOrEventListenerObject) => type === 'pagehide' && listeners.delete(cb));
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe('local transport', () => {
  it('drops its pagehide listener once a link closes', async () => {
    const t = new LocalTransport();
    const end = await t.host('LEAK');
    for (let i = 0; i < 3; i++) (await t.join('LEAK')).close();
    expect(listeners.size).toBe(0);
    end.close();
  });

  it('drops its pagehide listener when no host answers', async () => {
    vi.useFakeTimers();
    const joining = new LocalTransport().join('NOBODY');
    const failed = expect(joining).rejects.toThrow('No host');
    await vi.advanceTimersByTimeAsync(4000);
    await failed;
    expect(listeners.size).toBe(0);
  });
});
