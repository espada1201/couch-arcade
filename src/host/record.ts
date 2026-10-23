// "Record the moment": the host's camera films the crowd while a cue or stunt runs,
// and the host gets a video to keep. Only offered where the browser can record.
import { errorText, h, setText } from '../ui/dom';
import { openCamera, stopStream } from './media';

/** A looping show could run all night; a keepsake stops here. */
export const RECORD_MAX_MS = 5 * 60_000;

/** WebM where the browser writes it (Chrome, Firefox), MP4 where it doesn't (Safari). */
const MIMES = ['video/webm;codecs=vp9,opus', 'video/webm;codecs=vp8,opus', 'video/webm', 'video/mp4'];

/** The best format the browser can write, or '' to let it choose. */
export function pickMime(supported: (type: string) => boolean): string {
  return MIMES.find(supported) ?? '';
}

/** A dated file name whose extension matches what the recorder actually wrote. */
export function keepsakeName(d: Date, mimeType: string): string {
  const p = (n: number) => String(n).padStart(2, '0');
  const ext = mimeType.startsWith('video/mp4') ? 'mp4' : 'webm';
  return `swarm-moment-${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}.${ext}`;
}

export interface Recorder {
  /** The opt-in checkbox, the recording status and the download link. */
  el: HTMLElement;
  /** Start filming if the host opted in (does nothing if already filming). */
  begin(maxMs?: number): void;
  /** Stop filming and offer the download. */
  end(): void;
}

let ids = 0;

/** A record toggle for one panel, or null where this browser can't record. */
export function recorder(): Recorder | null {
  if (typeof MediaRecorder === 'undefined' || !navigator.mediaDevices?.getUserMedia) return null;
  const id = `record-${++ids}`;
  const on = h('input', { type: 'checkbox', id, 'aria-describedby': `${id}-about` });
  const status = h('p.note', { role: 'status' });
  const failed = (e: unknown) => setText(status, `Couldn’t record: ${errorText(e)}`);
  const link = h('a.btn.small', { hidden: true });
  let rec: MediaRecorder | null = null;
  /** Opened when the box is ticked, so the permission prompt never lands on the big moment; kept until it is unticked. */
  let stream: Promise<MediaStream> | null = null;
  /** Cleared by end(), so a stop that lands while the camera is still opening wins. */
  let wanted = false;
  let timer = 0;
  let url = '';
  let began = 0;

  const release = () => {
    void stream?.then(stopStream, () => {});
    stream = null;
  };

  const live = (s: MediaStream) => s.getVideoTracks().some((t) => t.readyState === 'live');

  /** The camera, opened once and reused; the room's sound (the cheer at midnight) belongs in the keepsake too. */
  const camera = async (): Promise<MediaStream> => {
    if (stream) {
      const s = await stream;
      if (live(s)) return s;
      stopStream(s);
    }
    const opening = openCamera(true, { audio: true });
    stream = opening;
    opening.catch(() => stream === opening && (stream = null));
    return opening;
  };

  on.addEventListener('change', async () => {
    if (!on.checked) return release(), setText(status, '');
    setText(status, 'Opening the camera…');
    try {
      await camera();
      if (on.checked) setText(status, 'Camera ready. It films the next moment you start.');
    } catch (e) {
      on.checked = false;
      failed(e);
    }
  });

  const begin = async (maxMs = RECORD_MAX_MS) => {
    if (!on.checked || rec || wanted) return;
    wanted = true;
    let s: MediaStream;
    try {
      s = await camera();
    } catch (e) {
      wanted = false;
      failed(e);
      return;
    }
    if (!wanted) return;
    const mimeType = pickMime((t) => MediaRecorder.isTypeSupported?.(t) ?? false);
    const chunks: Blob[] = [];
    let r: MediaRecorder;
    try {
      r = new MediaRecorder(s, mimeType ? { mimeType } : {});
      r.ondataavailable = (e) => e.data.size && chunks.push(e.data);
      r.start(1000);
    } catch (e) {
      wanted = false;
      failed(e);
      return;
    }
    // Also runs when the browser stops on its own (the camera unplugged), so the next moment can film.
    r.onstop = () => {
      if (rec === r) end();
      if (!on.checked) release();
      if (url) URL.revokeObjectURL(url);
      const type = r.mimeType || mimeType || 'video/webm';
      const blob = new Blob(chunks, { type });
      url = URL.createObjectURL(blob);
      link.href = url;
      link.download = keepsakeName(new Date(), type);
      const secs = Math.round((performance.now() - began) / 1000);
      link.textContent = `Download the keepsake (${secs} s, ${(blob.size / 1e6).toFixed(1)} MB)`;
      link.hidden = false;
      setText(status, 'Recorded. The video stays on this computer until you download it.');
    };
    rec = r;
    began = performance.now();
    timer = window.setTimeout(end, maxMs);
    setText(status, '● Recording the moment…');
  };

  const end = () => {
    wanted = false;
    clearTimeout(timer);
    if (rec?.state === 'recording') rec.stop();
    rec = null;
  };

  const el = h(
    'div.record',
    {},
    h('label.check', { for: id }, on, h('span', {}, 'Record the moment with this computer’s camera')),
    h('p.note', { id: `${id}-about` }, 'This computer’s camera films the crowd for the flip and a few seconds after. The video stays on this computer; you can download it.'),
    status,
    link,
  );
  return { el, begin: (maxMs) => void begin(maxMs), end };
}
