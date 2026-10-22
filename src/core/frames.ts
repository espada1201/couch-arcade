// The host side of streaming a picture to phones as JPEG stills: skip frames that
// haven't changed (judged on a tiny thumbnail), resend now and then for late joiners,
// and keep every frame under a byte budget that fits one transport message.
import { luma } from './effects';
import { clamp } from './math';
import { payloadBytes } from './protocol';

/** Most bytes one JPEG frame may take: as a base64 data URL it still fits one message, with 1 KB for the rest. */
export const FRAME_BUDGET = payloadBytes(1024);
const MIN_QUALITY = 0.3;
const MAX_QUALITY = 0.85;

/** RGBA pixels to one luma byte each. */
export function lumaOf(rgba: ArrayLike<number>): Uint8Array {
  const out = new Uint8Array(rgba.length >> 2);
  for (let i = 0, j = 0; j < out.length; i += 4, j++) out[j] = Math.round(luma([rgba[i], rgba[i + 1], rgba[i + 2]]));
  return out;
}

/** Mean absolute difference, 0 (same) to 255; thumbnails of different sizes differ fully. */
export function diffScore(a: Uint8Array, b: Uint8Array): number {
  if (a.length !== b.length || a.length === 0) return 255;
  let sum = 0;
  for (let i = 0; i < a.length; i++) sum += Math.abs(a[i] - b[i]);
  return sum / a.length;
}

export type GateDecision = 'change' | 'keyframe' | 'skip';

export class FrameGate {
  private last: Uint8Array | null = null;
  private sentAt = 0;
  private readonly threshold: number;
  private readonly keyframeMs: number;

  constructor({ threshold = 3, keyframeMs = 15_000 } = {}) {
    this.threshold = threshold;
    this.keyframeMs = keyframeMs;
  }

  /** Whether to send this frame: it changed since the last one sent, or a refresh is due. */
  next(thumb: Uint8Array, now: number): GateDecision {
    if (!this.last || diffScore(this.last, thumb) >= this.threshold) {
      this.last = thumb;
      this.sentAt = now;
      return 'change';
    }
    if (now - this.sentAt < this.keyframeMs) return 'skip';
    this.sentAt = now;
    return 'keyframe';
  }

  reset(): void {
    this.last = null;
  }
}

/** Decoded size of a base64 data URL. */
export function dataUrlBytes(url: string): number {
  const b64 = url.slice(url.indexOf(',') + 1);
  return Math.floor((b64.length * 3) / 4) - (b64.endsWith('==') ? 2 : b64.endsWith('=') ? 1 : 0);
}

export interface Encoded {
  data: string;
  /** Quality to start the next frame at. */
  quality: number;
  scale: number;
}

/**
 * Encode with `encode(quality, scale)` until the result fits `budget` bytes: lower the
 * quality first, then shrink the picture. Null if it never fits.
 */
export function encodeWithin(encode: (quality: number, scale: number) => string, budget: number, quality: number): Encoded | null {
  let q = clamp(quality, MIN_QUALITY, MAX_QUALITY);
  let scale = 1;
  for (let attempt = 0; attempt < 8; attempt++) {
    const data = encode(q, scale);
    const bytes = dataUrlBytes(data);
    if (bytes <= budget) return { data, scale, quality: bytes < budget * 0.6 ? Math.min(MAX_QUALITY, q + 0.05) : q };
    if (q > MIN_QUALITY) q = Math.max(MIN_QUALITY, q * (budget / bytes) * 0.9);
    else scale *= 0.75;
  }
  return null;
}
