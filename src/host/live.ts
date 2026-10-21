// The crowd as a live television. A moving source (the host's camera, a video file,
// or a generated animation) is sampled several times a second and every phone gets
// its own pixel, all switching on the same synced instant so the picture never tears.
import { sampleCover, type RGB } from '../core/layout';
import { h, segmented, slider } from '../ui/dom';
import type { Director } from './play';
import type { HostSession } from './session';

type SourceKind = 'aurora' | 'fire' | 'camera' | 'video';

export const W = 96;
export const H = 72;

export function aurora(ctx: CanvasRenderingContext2D, t: number) {
  const img = ctx.createImageData(W, H);
  for (let y = 0; y < H; y++)
    for (let x = 0; x < W; x++) {
      const u = x / W;
      const v = y / H;
      const a = Math.sin(u * 6 + t * 0.0011) + Math.sin(v * 5 - t * 0.0013) + Math.sin((u + v) * 4 + t * 0.0007);
      const k = (a + 3) / 6;
      const i = (y * W + x) * 4;
      img.data[i] = 20 + 60 * k * k;
      img.data[i + 1] = 60 + 180 * k;
      img.data[i + 2] = 90 + 120 * (1 - k);
      img.data[i + 3] = 255;
    }
  ctx.putImageData(img, 0, 0);
}

const heat = new Float32Array(W * (H + 2));
export function fire(ctx: CanvasRenderingContext2D) {
  for (let x = 0; x < W; x++) heat[(H + 1) * W + x] = Math.random() > 0.45 ? 1 : 0.2;
  for (let y = 0; y <= H; y++)
    for (let x = 0; x < W; x++) {
      const b = (y + 1) * W;
      const s = heat[b + x] + heat[b + ((x + W - 1) % W)] + heat[b + ((x + 1) % W)] + heat[Math.min(H + 1, y + 2) * W + x];
      heat[y * W + x] = Math.max(0, (s / 4) * 0.985 - 0.004);
    }
  const img = ctx.createImageData(W, H);
  for (let i = 0; i < W * H; i++) {
    const k = Math.min(1, heat[i] * 1.6);
    img.data.set([255 * Math.min(1, k * 1.6), 200 * k * k, 60 * k * k * k, 255], i * 4);
  }
  ctx.putImageData(img, 0, 0);
}

/** Sample the picture on `ctx` for every placed phone and schedule the swap; returns the colours sent. */
export function castFrame(session: HostSession, ctx: CanvasRenderingContext2D, prev: Map<number, RGB>): Map<number, RGB> {
  const { positions, aspect } = session.layout;
  const image = { w: W, h: H, data: ctx.getImageData(0, 0, W, H).data };
  const patch = Math.min(0.2, 0.5 / Math.sqrt(Math.max(1, positions.size)));
  const next = new Map<number, RGB>();
  for (const [seat, p] of positions) next.set(seat, sampleCover(image, p, aspect, patch));
  // Leave enough headroom for the slowest link before everyone flips.
  const at = session.now() + 140;
  session.setProgram((seat) => ({ kind: 'live', rgb: next.get(seat) ?? [0, 0, 0], prev: prev.get(seat) ?? [0, 0, 0], at }));
  return next;
}

export function livePanel(session: HostSession, director: Director): HTMLElement {
  const canvas = h('canvas.live-preview', { width: W, height: H, 'aria-label': 'What the crowd is showing' });
  const ctx = canvas.getContext('2d', { willReadFrequently: true })!;
  const msg = h('p.note', { role: 'status' });
  const file = h('input', { type: 'file', accept: 'video/*', id: 'live-file', hidden: true });
  const fileLabel = h('label.file', { for: 'live-file', hidden: true }, 'Video file', file);
  let kind: SourceKind = 'aurora';
  let fps = 10;
  let timer = 0;
  let video: HTMLVideoElement | null = null;
  let stream: MediaStream | null = null;
  let last = new Map<number, RGB>();

  const release = () => {
    stream?.getTracks().forEach((t) => t.stop());
    stream = null;
    if (video?.src) URL.revokeObjectURL(video.src);
    video = null;
  };

  const prepare = async (): Promise<boolean> => {
    release();
    if (kind === 'camera') {
      try {
        stream = await navigator.mediaDevices.getUserMedia({ video: { width: { ideal: 640 } }, audio: false });
      } catch {
        msg.textContent = 'The camera could not be opened. Allow it in the address bar, or pick another source.';
        return false;
      }
      video = h('video', { muted: true, playsinline: true });
      video.srcObject = stream;
    } else if (kind === 'video') {
      const f = file.files?.[0];
      if (!f) {
        msg.textContent = 'Choose a video file first.';
        return false;
      }
      video = h('video', { muted: true, playsinline: true, loop: true });
      video.src = URL.createObjectURL(f);
    }
    if (video) {
      video.muted = true;
      try {
        await video.play();
      } catch {
        msg.textContent = 'That video could not be played in this browser.';
        return false;
      }
    }
    return true;
  };

  const frame = () => {
    const t = performance.now();
    if (kind === 'aurora') aurora(ctx, t);
    else if (kind === 'fire') fire(ctx);
    else if (video && video.readyState >= 2) ctx.drawImage(video, 0, 0, W, H);
    last = castFrame(session, ctx, last);
  };

  const stop = () => {
    clearInterval(timer);
    timer = 0;
    release();
  };

  const start = async () => {
    if (session.layout.positions.size === 0) return void (msg.textContent = 'Place some phones on the map first (Locate tab).');
    director.take(stop);
    if (!(await prepare())) return;
    last = new Map();
    timer = window.setInterval(frame, 1000 / fps);
    msg.textContent = `Broadcasting to ${session.layout.positions.size} phones at ${fps} frames a second.`;
  };

  return h(
    'div.panel-body',
    {},
    h('p.panel-intro', {}, 'Turn the crowd into a live screen. Point your camera at the stage, play a video, or let a generated animation run, and every phone becomes one pixel of the moving picture.'),
    segmented<SourceKind>('Source', [['aurora', 'Aurora'], ['fire', 'Fire'], ['camera', 'Camera'], ['video', 'Video']], kind, (v) => {
      kind = v;
      fileLabel.hidden = file.hidden = v !== 'video';
      if (timer) void start();
    }),
    fileLabel,
    slider('Frame rate', 2, 20, 1, fps, (v) => `${v} fps`, (v) => {
      fps = v;
      if (timer) {
        clearInterval(timer);
        timer = window.setInterval(frame, 1000 / fps);
      }
    }),
    canvas,
    h('div.row', {}, h('button.btn.primary', { type: 'button', onclick: start }, 'Go live'), h('button.btn.ghost', { type: 'button', onclick: () => (director.take(), session.setProgram({ kind: 'lobby' }), (msg.textContent = '')) }, 'Stop')),
    msg,
  );
}
