// The one way the host opens its camera (Locate, Live screen, Big screen, the keepsake
// recorder): the same error copy everywhere, and the same teardown.

import { errorText } from '../ui/dom';

/** Why the camera didn't open, in words for the host. */
export function cameraProblem(e: unknown): string {
  const name = e instanceof Error ? e.name : '';
  if (name === 'NotAllowedError' || name === 'SecurityError') return 'Camera permission was refused. Allow it in the browser’s address bar.';
  if (name === 'NotFoundError' || name === 'OverconstrainedError') return 'No camera found.';
  if (name === 'NotReadableError' || name === 'AbortError') return 'The camera is busy in another app. Close it and try again.';
  return `Could not start the camera: ${errorText(e)}`;
}

/**
 * What to tell a host whose page is open on a LAN address (http://192.168...): browsers allow the
 * camera, microphone and screen sharing only on https or localhost. Null when this page qualifies.
 */
export function secureOnlyAdvice(port: string = globalThis.location?.port ?? ''): string | null {
  if (globalThis.isSecureContext !== false) return null;
  return `The browser blocks the camera, microphone and screen sharing on this address. On this computer, open http://localhost${port ? `:${port}` : ''}/ instead. It starts a new room, so phones scan its QR code.`;
}

/**
 * This computer's camera; with `audio`, the microphone too when it is allowed (and the
 * camera alone when it isn't). Throws an Error whose message is ready to show.
 */
export async function openCamera(video: MediaTrackConstraints | true = true, { audio = false } = {}): Promise<MediaStream> {
  const md = navigator.mediaDevices;
  if (!md?.getUserMedia) throw new Error(secureOnlyAdvice() ?? 'This browser cannot use a camera here (it needs https or localhost).');
  if (audio)
    try {
      return await md.getUserMedia({ video, audio: true });
    } catch {
      // No microphone, or it was refused: film without sound.
    }
  try {
    return await md.getUserMedia({ video, audio: false });
  } catch (e) {
    throw Object.assign(new Error(cameraProblem(e)), { name: e instanceof Error ? e.name : 'Error' });
  }
}

/** Turn a stream's camera (and microphone) off. */
export function stopStream(s: MediaStream | null | undefined): void {
  s?.getTracks().forEach((t) => t.stop());
}

/**
 * Let go of a video the host played only to read frames from. A playing video stays alive, and keeps
 * decoding, after the last reference to it is dropped, even off the page, until it is paused or emptied.
 */
export function dropVideo(v: HTMLVideoElement | null | undefined): void {
  if (!v) return;
  v.pause();
  if (v.src.startsWith('blob:')) URL.revokeObjectURL(v.src);
  v.srcObject = null;
  v.removeAttribute('src');
  v.load();
}
