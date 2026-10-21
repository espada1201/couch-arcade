// Recovers where each phone sits in the host camera's view from a burst of frames
// captured while every phone flashes its blink code at once. Every changing pixel
// is decoded on its own, then pixels are grouped by the id they spell out, so two
// phones touching edge to edge still separate cleanly.
import { BITS_PER_CODE, HALVES_PER_CODE, decodeBits, scheduleDuration, type BlinkSchedule } from './blinkcode';

export interface GrayFrame {
  /** Host-clock time the frame was delivered (ms). Includes unknown camera latency. */
  t: number;
  w: number;
  h: number;
  data: Uint8Array;
}

export interface Detection {
  id: number;
  /** Normalised camera coordinates, 0..1. */
  x: number;
  y: number;
  pixels: number;
  confidence: number;
}

export interface LocalizeResult {
  lagMs: number;
  detections: Detection[];
  activePixels: number;
}

export interface LocalizeOptions {
  lagMinMs?: number;
  lagMaxMs?: number;
  lagStepMs?: number;
  minRange?: number;
  minPixels?: number;
  /** Weakest bit contrast (fraction of the pixel's own range) a pixel may have and still count. */
  minConfidence?: number;
}

interface Accum {
  sums: Float32Array;
  weights: Float32Array;
}

function accumulate(frames: GrayFrame[], s: BlinkSchedule, lag: number, pix: Int32Array): Accum {
  const H = HALVES_PER_CODE;
  const total = H * s.repeats;
  const sums = new Float32Array(pix.length * H);
  const weights = new Float32Array(H);
  for (const f of frames) {
    const pos = (f.t - lag - s.t0) / s.halfMs;
    const k = Math.floor(pos);
    if (k < 0 || k >= total) continue;
    // Frames near a half-slot edge may straddle two symbols; trust the middle most.
    const phase = pos - k;
    const w = Math.max(0.1, 1 - Math.abs(phase - 0.5) * 1.8);
    const h = k % H;
    weights[h] += w;
    const d = f.data;
    for (let i = 0; i < pix.length; i++) sums[i * H + h] += w * d[pix[i]];
  }
  return { sums, weights };
}

function decodePixel(acc: Accum, i: number, range: number, bits: number[]): { id: number; conf: number } {
  const H = HALVES_PER_CODE;
  const { sums, weights } = acc;
  let conf = Infinity;
  for (let j = 0; j < BITS_PER_CODE; j++) {
    const wa = weights[2 * j];
    const wb = weights[2 * j + 1];
    if (wa === 0 || wb === 0) return { id: -1, conf: 0 };
    const diff = sums[i * H + 2 * j] / wa - sums[i * H + 2 * j + 1] / wb;
    bits[j] = diff > 0 ? 1 : 0;
    conf = Math.min(conf, Math.abs(diff) / range);
  }
  return { id: decodeBits(bits), conf };
}

function median(values: number[]): number {
  const v = [...values].sort((a, b) => a - b);
  const m = v.length >> 1;
  return v.length % 2 ? v[m] : (v[m - 1] + v[m]) / 2;
}

export function localize(frames: GrayFrame[], s: BlinkSchedule, opts: LocalizeOptions = {}): LocalizeResult {
  const { lagMinMs = 0, lagMaxMs = 400, lagStepMs = 10, minRange = 24, minPixels = 3, minConfidence = 0.3 } = opts;
  if (frames.length === 0) return { lagMs: 0, detections: [], activePixels: 0 };
  const { w, h } = frames[0];
  const end = s.t0 + scheduleDuration(s) + lagMaxMs;
  const window = frames.filter((f) => f.t >= s.t0 + lagMinMs && f.t <= end && f.w === w && f.h === h);
  if (window.length === 0) return { lagMs: 0, detections: [], activePixels: 0 };

  const n = w * h;
  const lo = new Uint8Array(n).fill(255);
  const hi = new Uint8Array(n);
  for (const f of window) {
    const d = f.data;
    for (let p = 0; p < n; p++) {
      const v = d[p];
      if (v < lo[p]) lo[p] = v;
      if (v > hi[p]) hi[p] = v;
    }
  }
  let maxRange = 0;
  for (let p = 0; p < n; p++) maxRange = Math.max(maxRange, hi[p] - lo[p]);
  const threshold = Math.max(minRange, maxRange * 0.3);
  const active: number[] = [];
  for (let p = 0; p < n; p++) if (hi[p] - lo[p] >= threshold) active.push(p);
  if (active.length === 0) return { lagMs: 0, detections: [], activePixels: 0 };

  const pix = Int32Array.from(active);
  // Coarse lag search on a subsample: score = summed confidence of pixels whose code checks out.
  const stride = Math.max(1, Math.floor(active.length / 1500));
  const sample = Int32Array.from(active.filter((_, i) => i % stride === 0));
  const bits = new Array<number>(BITS_PER_CODE);
  let bestLag = lagMinMs;
  let bestScore = -1;
  for (let lag = lagMinMs; lag <= lagMaxMs; lag += lagStepMs) {
    const acc = accumulate(window, s, lag, sample);
    let score = 0;
    for (let i = 0; i < sample.length; i++) {
      const r = decodePixel(acc, i, hi[sample[i]] - lo[sample[i]], bits);
      if (r.id >= 0 && r.conf >= minConfidence) score += r.conf;
    }
    if (score > bestScore) {
      bestScore = score;
      bestLag = lag;
    }
  }

  const acc = accumulate(window, s, bestLag, pix);
  const groups = new Map<number, { xs: number[]; ys: number[]; conf: number }>();
  for (let i = 0; i < pix.length; i++) {
    const p = pix[i];
    const r = decodePixel(acc, i, hi[p] - lo[p], bits);
    if (r.id < 0 || r.conf < minConfidence) continue;
    let g = groups.get(r.id);
    if (!g) groups.set(r.id, (g = { xs: [], ys: [], conf: 0 }));
    g.xs.push(p % w);
    g.ys.push(Math.floor(p / w));
    g.conf += r.conf;
  }

  const detections: Detection[] = [];
  for (const [id, g] of groups) {
    if (g.xs.length < minPixels) continue;
    detections.push({
      id,
      x: (median(g.xs) + 0.5) / w,
      y: (median(g.ys) + 0.5) / h,
      pixels: g.xs.length,
      confidence: g.conf / g.xs.length,
    });
  }
  detections.sort((a, b) => a.id - b.id);
  return { lagMs: bestLag, detections, activePixels: active.length };
}
