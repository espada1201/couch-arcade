// Recovers where each phone sits in the host camera's view from a burst of frames
// captured while every phone flashes its blink code at once. Every changing pixel
// is decoded on its own, then pixels are grouped by the id they spell out, so two
// phones touching edge to edge still separate cleanly.
// The code loops, so the decoder skips the first loop and searches every possible
// camera delay up to a whole loop: webcams, phones used as webcams and capture cards
// with seconds of lag all work without calibration.
import { BITS_PER_CODE, HALVES_PER_CODE, SYNC, cycleMs, decodeBits, isSync, type BlinkSchedule } from './blinkcode';
import { median } from './math';

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
  /** Every half-slot got at least one frame; without that no pixel can decode at this lag. */
  full: boolean;
}

/**
 * Mean brightness of the pixels that never blink: it follows the camera's auto-exposure
 * but not the phones themselves, even when one phone fills most of the frame.
 */
function frameLevel(d: Uint8Array, still: Int32Array): number {
  if (still.length === 0) return 0;
  let sum = 0;
  for (let i = 0; i < still.length; i++) sum += d[still[i]];
  return sum / still.length;
}

/** Fills `acc` (reused across calls, sized for the largest `pix`) with this lag's half-slot sums. */
function accumulate(acc: Accum, frames: GrayFrame[], levels: number[], s: BlinkSchedule, lag: number, pix: Int32Array): Accum {
  const H = HALVES_PER_CODE;
  const { sums, weights } = acc;
  sums.fill(0, 0, pix.length * H);
  weights.fill(0);
  for (let fi = 0; fi < frames.length; fi++) {
    const f = frames[fi];
    const level = levels[fi];
    const pos = (f.t - lag - s.t0) / s.halfMs;
    const k = Math.floor(pos);
    // Frames near a half-slot edge may straddle two symbols; trust the middle most.
    const phase = pos - k;
    const w = Math.max(0.1, 1 - Math.abs(phase - 0.5) * 1.8);
    const h = ((k % H) + H) % H;
    weights[h] += w;
    const d = f.data;
    for (let i = 0; i < pix.length; i++) sums[i * H + h] += w * (d[pix[i]] - level);
  }
  acc.full = weights.every((w) => w !== 0);
  return acc;
}

/** Confidence of the last decodePixel call (a scratch slot, so decoding allocates nothing). */
let decodedConf = 0;
const syncLevels = new Float64Array(SYNC.length);

/** The id pixel `i` spells out, or -1; its confidence is left in `decodedConf`. */
function decodePixel(acc: Accum, i: number, range: number, bits: number[]): number {
  const H = HALVES_PER_CODE;
  const { sums, weights } = acc;
  decodedConf = 0;
  if (!acc.full) return -1;
  const sync = syncLevels;
  for (let k = 0; k < SYNC.length; k++) sync[k] = sums[i * H + k] / weights[k];
  if (!isSync(sync)) return -1;
  let conf = (Math.min(sync[0], sync[1], sync[2]) - Math.max(sync[3], sync[4], sync[5])) / range;
  const off = SYNC.length;
  for (let j = 0; j < BITS_PER_CODE; j++) {
    const a = off + 2 * j;
    const diff = sums[i * H + a] / weights[a] - sums[i * H + a + 1] / weights[a + 1];
    bits[j] = diff > 0 ? 1 : 0;
    conf = Math.min(conf, Math.abs(diff) / range);
  }
  decodedConf = conf;
  return decodeBits(bits);
}

export function localize(frames: GrayFrame[], s: BlinkSchedule, opts: LocalizeOptions = {}): LocalizeResult {
  const cycle = cycleMs(s);
  const { lagMinMs = 0, lagMaxMs = cycle - 1, lagStepMs = 10, minRange = 24, minPixels = 3, minConfidence = 0.3 } = opts;
  if (frames.length === 0 || s.repeats < 2) return { lagMs: 0, detections: [], activePixels: 0 };
  const { w, h } = frames[0];
  // Skip the first loop: with up to a loop of camera delay, everything after it is mid-code.
  const window = frames.filter((f) => f.t >= s.t0 + cycle && f.t <= s.t0 + cycle * s.repeats && f.w === w && f.h === h);
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
  // A fixed floor, not a fraction of the brightest phone, so distant dim phones still count.
  // Noise that sneaks past it is rejected by the sync mark, the CRC and the contrast check.
  const active: number[] = [];
  const quiet: number[] = [];
  for (let p = 0; p < n; p++) (hi[p] - lo[p] >= minRange ? active : quiet).push(p);
  if (active.length === 0) return { lagMs: 0, detections: [], activePixels: 0 };

  const pix = Int32Array.from(active);
  // Lag search on a subsample: a coarse sweep over every possible delay, then a refine around the
  // winner. score = summed confidence of pixels whose code checks out.
  const stride = Math.max(1, Math.floor(active.length / 1500));
  const sample = Int32Array.from(active.filter((_, i) => i % stride === 0));
  const bits = new Array<number>(BITS_PER_CODE);
  const still = quiet.length < 50 ? new Int32Array(0) : Int32Array.from(quiet.filter((_, i) => i % Math.max(1, Math.floor(quiet.length / 2000)) === 0));
  const levels = window.map((f) => frameLevel(f.data, still));
  const acc: Accum = { sums: new Float32Array(pix.length * HALVES_PER_CODE), weights: new Float32Array(HALVES_PER_CODE), full: false };
  const score = (lag: number) => {
    if (!accumulate(acc, window, levels, s, lag, sample).full) return 0;
    let total = 0;
    for (let i = 0; i < sample.length; i++)
      if (decodePixel(acc, i, hi[sample[i]] - lo[sample[i]], bits) >= 0 && decodedConf >= minConfidence) total += decodedConf;
    return total;
  };
  let bestLag = lagMinMs;
  let bestScore = -1;
  const coarse = lagStepMs * 2;
  for (let lag = lagMinMs; lag <= lagMaxMs; lag += coarse) {
    const v = score(lag);
    if (v > bestScore) [bestScore, bestLag] = [v, lag];
  }
  const centre = bestLag;
  for (let lag = Math.max(lagMinMs, centre - coarse); lag <= Math.min(lagMaxMs, centre + coarse); lag += lagStepMs / 2) {
    const v = score(lag);
    if (v > bestScore) [bestScore, bestLag] = [v, lag];
  }

  const groups = new Map<number, { xs: number[]; ys: number[]; conf: number }>();
  // Phones disagree a little about the time (clock error, display lag). Pixels that don't
  // decode at the crowd's delay get a second chance at nearby delays.
  let pending = pix;
  for (const offset of [0, -0.25, 0.25, -0.5, 0.5, -0.75, 0.75]) {
    if (pending.length === 0) break;
    accumulate(acc, window, levels, s, bestLag + offset * s.halfMs, pending);
    const failed: number[] = [];
    for (let i = 0; i < pending.length; i++) {
      const p = pending[i];
      const id = decodePixel(acc, i, hi[p] - lo[p], bits);
      if (id < 0 || decodedConf < minConfidence) {
        failed.push(p);
        continue;
      }
      let g = groups.get(id);
      if (!g) groups.set(id, (g = { xs: [], ys: [], conf: 0 }));
      g.xs.push(p % w);
      g.ys.push(Math.floor(p / w));
      g.conf += decodedConf;
    }
    pending = Int32Array.from(failed);
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
