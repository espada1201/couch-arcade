import { afterEach, describe, expect, it, vi } from 'vitest';
import { cameraProblem, dropVideo, openCamera, secureOnlyAdvice, stopStream } from '../src/host/media';

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

describe('letting go of a video', () => {
  const fakeVideo = (src: string) => {
    const v = { src, srcObject: {} as unknown, pause: vi.fn(), load: vi.fn(), removeAttribute: vi.fn((a: string) => a === 'src' && (v.src = '')) };
    return v;
  };

  it('stops it playing and empties it, so a dropped video is not kept alive decoding', () => {
    const v = fakeVideo('');
    dropVideo(v as unknown as HTMLVideoElement);
    expect(v.pause).toHaveBeenCalled();
    expect(v.srcObject).toBeNull();
    expect(v.load).toHaveBeenCalled();
  });

  it('frees a picked file once, and tolerates no video', () => {
    const revoke = vi.fn();
    vi.stubGlobal('URL', { revokeObjectURL: revoke });
    const v = fakeVideo('blob:abc');
    dropVideo(v as unknown as HTMLVideoElement);
    expect(revoke).toHaveBeenCalledWith('blob:abc');
    expect(() => dropVideo(null)).not.toThrow();
  });
});

describe('a host page opened on a network address', () => {
  it('tells the host to open localhost on this computer instead, and says nothing on a secure page', async () => {
    expect(secureOnlyAdvice('4321')).toBeNull();
    vi.stubGlobal('isSecureContext', true);
    expect(secureOnlyAdvice('4321')).toBeNull();
    vi.stubGlobal('isSecureContext', false);
    expect(secureOnlyAdvice('4321')).toContain('open http://localhost:4321/ instead');
    expect(secureOnlyAdvice('')).toContain('open http://localhost/ instead');
    vi.stubGlobal('navigator', {});
    await expect(openCamera()).rejects.toThrow('http://localhost');
  });
});
