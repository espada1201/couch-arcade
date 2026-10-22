import { describe, expect, it, vi } from 'vitest';
import { hold, type Ways } from '../src/ui/wakelock';

const granted = () => {
  const release = vi.fn(async () => {});
  return { lock: vi.fn(async () => ({ release })), release };
};
const playing = () => {
  const stop = vi.fn();
  return { video: vi.fn(async () => stop), stop };
};

describe('keeping the screen awake', () => {
  it('uses the Wake Lock API when the page has it, and never starts the video', async () => {
    const { lock, release } = granted();
    const { video } = playing();
    const h = await hold({ lock, video });
    expect(h.awake).toBe('wake-lock');
    expect(video).not.toHaveBeenCalled();
    h.release();
    expect(release).toHaveBeenCalledOnce();
  });

  it('plays the video on plain http, where there is no Wake Lock', async () => {
    const { video, stop } = playing();
    const h = await hold({ video });
    expect(h.awake).toBe('video');
    h.release();
    expect(stop).toHaveBeenCalledOnce();
  });

  it('starts the video in the same turn as the tap when there is no Wake Lock', () => {
    const { video } = playing();
    void hold({ video });
    expect(video).toHaveBeenCalledOnce();
  });

  it('falls back to the video when the Wake Lock is refused', async () => {
    const ways: Ways = { lock: async () => Promise.reject(new Error('NotAllowedError')), video: playing().video };
    expect((await hold(ways)).awake).toBe('video');
  });

  it('reports none when the video cannot play either, so the phone asks for Auto-Lock off', async () => {
    const h = await hold({ video: async () => Promise.reject(new Error('NotAllowedError')) });
    expect(h.awake).toBe('none');
    expect(() => h.release()).not.toThrow();
  });
});
