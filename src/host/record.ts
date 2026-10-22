// "Record the moment": the host's camera films the crowd while a cue or stunt runs,
// and the host gets a .webm to keep. Only offered where the browser can record.
import { h } from '../ui/dom';

/** A looping show could run all night; a keepsake stops here. */
export const RECORD_MAX_MS = 5 * 60_000;

const MIMES = ['video/webm;codecs=vp9,opus', 'video/webm;codecs=vp8,opus', 'video/webm'];

/** The best webm the browser can write, or '' to let it choose. */
export function pickMime(supported: (type: string) => boolean): string {
  return MIMES.find(supported) ?? '';
}

export function keepsakeName(d: Date): string {
  const p = (n: number) => String(n).padStart(2, '0');
  return `swarm-moment-${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}.webm`;
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
  const on = h('input', { type: 'checkbox', id });
  const status = h('p.note', { role: 'status' });
  const link = h('a.btn.small', { hidden: true });
  let rec: MediaRecorder | null = null;
  let stream: MediaStream | null = null;
  let starting = false;
  /** Cleared by end(), so a stop that lands while the camera is still opening wins. */
  let wanted = false;
  let timer = 0;
  let url = '';
  let began = 0;

  const release = () => {
    stream?.getTracks().forEach((t) => t.stop());
    stream = null;
  };

  const open = async (): Promise<MediaStream> => {
    try {
      // The room's sound (the cheer at midnight) belongs in the keepsake too.
      return await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
    } catch {
      return navigator.mediaDevices.getUserMedia({ video: true });
    }
  };

  const begin = async (maxMs = RECORD_MAX_MS) => {
    if (!on.checked || rec || starting) return;
    starting = wanted = true;
    status.textContent = 'Opening the camera…';
    try {
      stream = await open();
    } catch (e) {
      status.textContent = `Couldn’t open the camera to record: ${e instanceof Error ? e.message : String(e)}`;
      return;
    } finally {
      starting = false;
    }
    if (!wanted) {
      release();
      status.textContent = '';
      return;
    }
    const mimeType = pickMime((t) => MediaRecorder.isTypeSupported?.(t) ?? false);
    const r = new MediaRecorder(stream, mimeType ? { mimeType } : {});
    const chunks: Blob[] = [];
    r.ondataavailable = (e) => e.data.size && chunks.push(e.data);
    r.onstop = () => {
      release();
      if (url) URL.revokeObjectURL(url);
      const blob = new Blob(chunks, { type: r.mimeType || 'video/webm' });
      url = URL.createObjectURL(blob);
      link.href = url;
      link.download = keepsakeName(new Date());
      const secs = Math.round((performance.now() - began) / 1000);
      link.textContent = `Download the keepsake (${secs} s, ${(blob.size / 1e6).toFixed(1)} MB)`;
      link.hidden = false;
      status.textContent = 'Recorded. The video stays on this computer until you download it.';
    };
    rec = r;
    began = performance.now();
    r.start(1000);
    timer = window.setTimeout(end, maxMs);
    status.textContent = '● Recording the moment…';
  };

  const end = () => {
    wanted = false;
    clearTimeout(timer);
    if (rec?.state === 'recording') rec.stop();
    else release();
    rec = null;
  };

  const el = h(
    'div.record',
    {},
    h('label.check', { for: id }, on, h('span', {}, 'Record the moment with this computer’s camera')),
    status,
    link,
  );
  return { el, begin: (maxMs) => void begin(maxMs), end };
}
