// Where the host's eyes come from. The real source is the computer's camera; the
// synthetic one is a stand-in for tests and demos that "films" phone tabs on this
// machine by listening to the light they report emitting.
import type { GrayFrame } from '../core/localize';
import { OPTICS_CHANNEL, type Optics } from '../core/protocol';

export interface FrameSource {
  readonly preview: HTMLElement;
  /** Width / height of the frames. */
  readonly aspect: number;
  start(): Promise<void>;
  stop(): void;
  onFrame: ((f: GrayFrame) => void) | null;
}

// Enough resolution that a phone across a large room still covers a handful of pixels.
const W = 320;

function toGray(rgba: Uint8ClampedArray, n: number): Uint8Array {
  const g = new Uint8Array(n);
  for (let i = 0, j = 0; i < n; i++, j += 4) g[i] = (rgba[j] * 77 + rgba[j + 1] * 150 + rgba[j + 2] * 29) >> 8;
  return g;
}

export class CameraSource implements FrameSource {
  readonly preview: HTMLVideoElement = document.createElement('video');
  onFrame: ((f: GrayFrame) => void) | null = null;
  private stream: MediaStream | null = null;
  private canvas = document.createElement('canvas');
  private running = false;

  constructor(private readonly deviceId?: string) {
    this.preview.muted = true;
    this.preview.playsInline = true;
    this.preview.setAttribute('aria-label', 'Camera view of the room');
  }

  get aspect(): number {
    return this.preview.videoWidth && this.preview.videoHeight ? this.preview.videoWidth / this.preview.videoHeight : 4 / 3;
  }

  static async list(): Promise<MediaDeviceInfo[]> {
    try {
      return (await navigator.mediaDevices.enumerateDevices()).filter((d) => d.kind === 'videoinput');
    } catch {
      return [];
    }
  }

  async start(): Promise<void> {
    if (!navigator.mediaDevices?.getUserMedia) throw new Error('This browser cannot use a camera here (it needs https or localhost).');
    this.stream = await navigator.mediaDevices.getUserMedia({
      audio: false,
      video: {
        deviceId: this.deviceId ? { exact: this.deviceId } : undefined,
        width: { ideal: 1280 },
        height: { ideal: 720 },
        frameRate: { ideal: 30 },
      },
    });
    this.preview.srcObject = this.stream;
    await this.preview.play();
    this.canvas.width = W;
    this.canvas.height = Math.round(W / this.aspect);
    this.running = true;
    const ctx = this.canvas.getContext('2d', { willReadFrequently: true })!;
    const grab = (t: number) => {
      // Only pay for grayscale conversion while someone (a scan) is listening.
      if (!this.running || !this.onFrame) return;
      const { width: w, height: h } = this.canvas;
      ctx.drawImage(this.preview, 0, 0, w, h);
      this.onFrame?.({ t, w, h, data: toGray(ctx.getImageData(0, 0, w, h).data, w * h) });
    };
    const v = this.preview as HTMLVideoElement & {
      requestVideoFrameCallback?: (cb: (now: number, meta: { captureTime?: number }) => void) => number;
    };
    if (v.requestVideoFrameCallback) {
      const loop = (now: number, meta: { captureTime?: number }) => {
        // captureTime shares performance.now()'s clock when present; distrust anything wild.
        const cap = meta.captureTime;
        grab(cap && Math.abs(cap - now) < 1000 ? cap : now);
        if (this.running) v.requestVideoFrameCallback!(loop);
      };
      v.requestVideoFrameCallback(loop);
    } else {
      const loop = () => {
        grab(performance.now());
        if (this.running) requestAnimationFrame(loop);
      };
      requestAnimationFrame(loop);
    }
  }

  stop(): void {
    this.running = false;
    this.stream?.getTracks().forEach((t) => t.stop());
    this.stream = null;
  }
}

export class SyntheticSource implements FrameSource {
  readonly preview: HTMLCanvasElement = document.createElement('canvas');
  readonly aspect = 4 / 3;
  onFrame: ((f: GrayFrame) => void) | null = null;
  private ch: BroadcastChannel | null = null;
  private timer = 0;
  private history = new Map<string, { sim: Optics['sim']; samples: [number, number][] }>();

  constructor(
    private readonly latencyMs = 70,
    private readonly drop = 0.08,
  ) {
    this.preview.width = W;
    this.preview.height = W / this.aspect;
    this.preview.setAttribute('aria-label', 'Simulated camera view of the room');
  }

  async start(): Promise<void> {
    this.ch = new BroadcastChannel(OPTICS_CHANNEL);
    this.ch.onmessage = (e: MessageEvent<Optics>) => {
      const o = e.data;
      let h = this.history.get(o.key);
      if (!h) this.history.set(o.key, (h = { sim: o.sim, samples: [] }));
      h.sim = o.sim;
      h.samples.push([o.at, o.lum]);
      while (h.samples.length > 2 && h.samples[1][0] < o.at - 3000) h.samples.shift();
    };
    const w = this.preview.width;
    const h = this.preview.height;
    const ctx = this.preview.getContext('2d')!;
    const img = ctx.createImageData(w, h);
    this.timer = window.setInterval(() => {
      if (Math.random() < this.drop) return;
      const t = performance.now();
      const seen = performance.timeOrigin + t - this.latencyMs;
      const data = new Uint8Array(w * h);
      for (let i = 0; i < data.length; i++) data[i] = 26 + Math.random() * 10;
      for (const ph of this.history.values()) {
        let lum = 0;
        for (const [at, l] of ph.samples) if (at <= seen) lum = l;
        const v = 40 + lum * 0.75;
        const x0 = Math.round(ph.sim.x * w - 4);
        const y0 = Math.round(ph.sim.y * h - 6);
        for (let y = Math.max(0, y0); y < Math.min(h, y0 + 12); y++)
          for (let x = Math.max(0, x0); x < Math.min(w, x0 + 9); x++) data[y * w + x] = v + Math.random() * 8;
      }
      const px = img.data;
      for (let i = 0, j = 0; i < data.length; i++, j += 4) {
        px[j] = px[j + 1] = px[j + 2] = data[i];
        px[j + 3] = 255;
      }
      ctx.putImageData(img, 0, 0);
      this.onFrame?.({ t, w, h, data });
    }, 1000 / 30);
  }

  stop(): void {
    clearInterval(this.timer);
    this.ch?.close();
  }
}
