import { afterEach, describe, expect, it, vi } from 'vitest';
import { cameraProblem, openCamera, stopStream } from '../src/host/media';

afterEach(() => vi.unstubAllGlobals());

const named = (name: string, message = 'x') => Object.assign(new Error(message), { name });

describe('opening the camera', () => {
  it('explains each failure the same way everywhere', () => {
    expect(cameraProblem(named('NotAllowedError'))).toBe('Camera permission was refused. Allow it in the browser’s address bar.');
    expect(cameraProblem(named('NotFoundError'))).toBe('No camera found.');
    expect(cameraProblem(named('NotReadableError'))).toBe('The camera is busy in another app. Close it and try again.');
    expect(cameraProblem(named('TypeError', 'boom'))).toBe('Could not start the camera: boom');
  });

  it('asks for the microphone too when wanted, and films without it if that is refused', async () => {
    const stream = { getTracks: () => [] };
    const getUserMedia = vi.fn(async (c: MediaStreamConstraints) => {
      if (c.audio) throw named('NotAllowedError');
      return stream;
    });
    vi.stubGlobal('navigator', { mediaDevices: { getUserMedia } });
    expect(await openCamera({ width: { ideal: 640 } }, { audio: true })).toBe(stream);
    expect(getUserMedia.mock.calls.map((c) => c[0].audio)).toEqual([true, false]);
  });

  it('turns a refusal into the shared message', async () => {
    vi.stubGlobal('navigator', { mediaDevices: { getUserMedia: async () => Promise.reject(named('NotAllowedError')) } });
    await expect(openCamera()).rejects.toThrow('Camera permission was refused');
    vi.stubGlobal('navigator', {});
    await expect(openCamera()).rejects.toThrow('needs https or localhost');
  });

  it('stopping a stream stops every track, and a missing stream is fine', () => {
    const stop = vi.fn();
    stopStream({ getTracks: () => [{ stop }, { stop }] } as unknown as MediaStream);
    expect(stop).toHaveBeenCalledTimes(2);
    stopStream(null);
  });
});
