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
 * This computer's camera; with `audio`, the microphone too when it is allowed (and the
 * camera alone when it isn't). Throws an Error whose message is ready to show.
 */
export async function openCamera(video: MediaTrackConstraints | true = true, { audio = false } = {}): Promise<MediaStream> {
  const md = navigator.mediaDevices;
  if (!md?.getUserMedia) throw new Error('This browser cannot use a camera here (it needs https or localhost).');
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
