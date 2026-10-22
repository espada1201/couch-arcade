// The crowd as a live television. A moving source (the host's camera, a video file,
// or a generated animation) is sampled several times a second and every phone gets
// its own pixel, all switching on the same synced instant so the picture never tears.
import { BLACK } from '../core/effects';
import { sampleCrowd, type RGB } from '../core/layout';
import { errorText, h, plural, segmented, slider } from '../ui/dom';
import type { Director } from './director';
import { openCamera, stopStream } from './media';
import { panel, requirePlaced, stopButton } from './panel';
import { every, type Broadcast } from './ticker';
import type { HostSession } from './session';

type SourceKind = 'aurora' | 'fire' | 'camera' | 'video';
const NAMES: Record<SourceKind, string> = { aurora: 'Aurora', fire: 'Fire', camera: 'the camera', video: 'the video' };

export const W = 96;
export const H = 72;

// One W x H buffer per canvas, reused every frame (nothing keeps the old pixels).
const buffers = new WeakMap<CanvasRenderingContext2D, ImageData>();
function buffer(ctx: CanvasRenderingContext2D): ImageData {
  let img = buffers.get(ctx);
  if (!img) buffers.set(ctx, (img = ctx.createImageData(W, H)));
  return img;
}

export function aurora(ctx: CanvasRenderingContext2D, t: number) {
  const img = buffer(ctx);
  const px = img.data;
  for (let y = 0; y < H; y++)
    for (let x = 0; x < W; x++) {
      const u = x / W;
      const v = y / H;
      const a = Math.sin(u * 6 + t * 0.0011) + Math.sin(v * 5 - t * 0.0013) + Math.sin((u + v) * 4 + t * 0.0007);
      const k = (a + 3) / 6;
      const i = (y * W + x) * 4;
      px[i] = 20 + 60 * k * k;
      px[i + 1] = 60 + 180 * k;
      px[i + 2] = 90 + 120 * (1 - k);
      px[i + 3] = 255;
    }
  ctx.putImageData(img, 0, 0);
}

// Heat rises from a fuel line below the picture, averaging its neighbours and cooling as it climbs.
// Fuel comes in gusts a few columns wide: per-pixel fuel noise averages out within a few rows, which
// left the upper rows flat, while a gust survives the climb, so every row of phones keeps flickering.
const heat = new Float32Array(W * (H + 2));
const fuel = new Float32Array(W).fill(0.6);
let lit = false;
function rise() {
  const at = Math.floor(Math.random() * W);
  const r = 3 + Math.floor(Math.random() * 6);
  const v = 0.3 + Math.random() * 0.8;
  for (let d = -r; d <= r; d++) fuel[(at + d + W) % W] = v;
  for (let x = 0; x < W; x++) heat[(H + 1) * W + x] = fuel[x] * (Math.random() > 0.45 ? 1 : 0.3);
  for (let y = 0; y <= H; y++)
    for (let x = 0; x < W; x++) {
      const b = (y + 1) * W;
      const s = heat[b + x] + heat[b + ((x + W - 1) % W)] + heat[b + ((x + 1) % W)] + heat[Math.min(H + 1, y + 2) * W + x];
      heat[y * W + x] = Math.max(0, (s / 4) * 0.995 - 0.003);
    }
}
export function fire(ctx: CanvasRenderingContext2D) {
  // Heat climbs one row per step: warm up the whole height at once, then climb a few rows a frame.
  for (let n = lit ? 3 : 2 * H; n > 0; n--) rise();
  lit = true;
  const img = buffer(ctx);
  const px = img.data;
  for (let i = 0, j = 0; i < W * H; i++, j += 4) {
    const k = Math.min(1, heat[i] * 1.6);
    px[j] = 255 * Math.min(1, k * 1.6);
    px[j + 1] = 200 * k * k;
    px[j + 2] = 60 * k * k * k;
    px[j + 3] = 255;
  }
  ctx.putImageData(img, 0, 0);
}

/** Sample the picture on `ctx` for every placed phone and schedule the swap; returns the colours sent. */
export function castFrame(session: HostSession, ctx: CanvasRenderingContext2D, prev: Map<number, RGB>): Map<number, RGB> {
  const image = { w: W, h: H, data: ctx.getImageData(0, 0, W, H).data };
  const next = sampleCrowd(image, session.layout, Math.min(0.2, 0.5 / Math.sqrt(Math.max(1, session.layout.positions.size))));
  // Leave enough headroom for the slowest link before everyone flips.
  const at = session.now() + 140;
  session.setProgram((seat) => ({ kind: 'live', rgb: next.get(seat) ?? BLACK, prev: prev.get(seat) ?? BLACK, at }));
  return next;
}

/** Draw a picture onto `ctx` and cast it to the crowd `fps` times a second until stopped. */
export function broadcast(session: HostSession, ctx: CanvasRenderingContext2D, draw: (ctx: CanvasRenderingContext2D, t: number) => void, fps: number): Broadcast {
  let last = new Map<number, RGB>();
  return every(fps, () => {
    draw(ctx, performance.now());
    last = castFrame(session, ctx, last);
  });
}

/** The Live screen: one pixel per phone across the room. (Every phone showing the whole picture is the Big screen tab.) */
export function livePanel(session: HostSession, director: Director): HTMLElement {
  const canvas = h('canvas.live-preview', { width: W, height: H, 'aria-label': 'What the crowd is showing' });
  const ctx = canvas.getContext('2d', { willReadFrequently: true })!;
  const file = h('input', { type: 'file', accept: 'video/*', id: 'live-file', hidden: true });
  const fileLabel = h('label.file', { for: 'live-file', hidden: true }, 'Video file', file);
  let kind: SourceKind = 'aurora';
  let fps = 10;
  let loop: Broadcast | null = null;
  /** What the crowd is showing now. While live it changes only once the next source is ready to play. */
  let shown: { kind: SourceKind; video: HTMLVideoElement | null; stream: MediaStream | null } = { kind, video: null, stream: null };
  // Bumped by every start, switch and stop, so a camera prompt or video load that resolves
  // after it was superseded drops what it opened instead of leaving the camera on.
  let gen = 0;

  const drop = (s: MediaStream | null, v: HTMLVideoElement | null) => {
    stopStream(s);
    if (v?.src) URL.revokeObjectURL(v.src);
  };

  /** Opens the selected source; on failure says why and returns null. */
  const prepare = async (mine: number): Promise<typeof shown | null> => {
    const want = kind;
    const fail = (text: string) => {
      if (mine === gen) say(text);
      return null;
    };
    let s: MediaStream | null = null;
    let v: HTMLVideoElement | null = null;
    if (want === 'camera') {
      try {
        s = await openCamera({ width: { ideal: 640 } });
      } catch (e) {
        return fail(`${errorText(e)} Or pick another source.`);
      }
      v = h('video', { muted: true, playsinline: true });
      v.srcObject = s;
    } else if (want === 'video') {
      const f = file.files?.[0];
      if (!f) return fail(loop ? `Choose a video file to switch to it. The crowd keeps showing ${NAMES[shown.kind]} until then.` : 'Choose a video file first.');
      v = h('video', { muted: true, playsinline: true, loop: true });
      v.src = URL.createObjectURL(f);
    }
    if (v) {
      v.muted = true;
      try {
        await v.play();
      } catch {
        drop(s, v);
        return fail('That video could not be played in this browser.');
      }
    }
    if (mine !== gen) return drop(s, v), null;
    return { kind: want, video: v, stream: s };
  };

  const show = (next: typeof shown) => {
    drop(shown.stream, shown.video);
    shown = next;
  };

  const draw = (c: CanvasRenderingContext2D, t: number) => {
    if (shown.kind === 'aurora') aurora(c, t);
    else if (shown.kind === 'fire') fire(c);
    else if (shown.video && shown.video.readyState >= 2) c.drawImage(shown.video, 0, 0, W, H);
  };

  const goLive = h('button.btn.primary', { type: 'button' }, 'Go live');
  const broadcasting = () => say(`Broadcasting to ${plural(session.playRoom().positions.size, 'phone')} at ${fps} frames a second.`);

  const stop = () => {
    gen++;
    goLive.disabled = false;
    loop?.stop();
    loop = null;
    show({ kind, video: null, stream: null });
  };

  const start = async () => {
    if (!requirePlaced(session, say)) return;
    const hold = director.run({ stop });
    const mine = ++gen;
    goLive.disabled = true;
    const next = await prepare(mine);
    if (mine !== gen) return;
    goLive.disabled = false;
    if (!next) return hold.end();
    show(next);
    loop = broadcast(session, ctx, draw, fps);
    broadcasting();
  };
  goLive.addEventListener('click', start);

  /** Live already: keep the current picture on the phones until the new source plays, then cut over. */
  const switchSource = async () => {
    const next = await prepare(++gen);
    // null also when a stop or another switch superseded this one (prepare dropped what it opened).
    if (!next) return;
    show(next);
    broadcasting();
  };
  file.addEventListener('change', () => loop && kind === 'video' && void switchSource());

  const { el, say } = panel(
    'Turn the crowd into a live screen. Point your camera at the stage, play a video, or let a generated animation run, and every phone becomes one pixel of the moving picture.',
    segmented<SourceKind>('Source', [['aurora', 'Aurora'], ['fire', 'Fire'], ['camera', 'Camera'], ['video', 'Video']], kind, (v) => {
      kind = v;
      fileLabel.hidden = file.hidden = v !== 'video';
      if (loop) void switchSource();
      // A start still waiting on its camera or video: start over with the new pick.
      else if (goLive.disabled) void start();
    }),
    fileLabel,
    slider('Frame rate', 2, 20, 1, fps, (v) => `${v} fps`, (v) => {
      fps = v;
      loop?.setFps(fps);
    }),
    canvas,
    h('div.row', {}, goLive, stopButton(director, () => say(''))),
  );
  return el;
}
