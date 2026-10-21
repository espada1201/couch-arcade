// Temporal blink code that every phone flashes at the same moment.
// Each bit is Manchester-coded as two half-slots (1 = on,off; 0 = off,on) so the
// decoder only ever compares a pixel against itself a moment later: no absolute
// brightness threshold, immune to auto-exposure drift and screen brightness.

export const ID_BITS = 7; // up to 128 phones
export const MAX_IDS = 1 << ID_BITS;
const PREAMBLE = [1, 1, 0, 1];
const CRC_BITS = 4;

export const BITS_PER_CODE = PREAMBLE.length + ID_BITS + CRC_BITS;
export const HALVES_PER_CODE = BITS_PER_CODE * 2;

export interface BlinkSchedule {
  /** Host-clock time (ms) at which half-slot 0 starts. */
  t0: number;
  halfMs: number;
  repeats: number;
}

export const DEFAULT_HALF_MS = 120;
export const DEFAULT_REPEATS = 3;

/** CRC-4 (poly x^4 + x + 1) over the id bits, MSB first. */
export function crc4(bits: number[]): number[] {
  let reg = 0;
  for (const b of bits) {
    const top = ((reg >> 3) & 1) ^ b;
    reg = (reg << 1) & 0xf;
    if (top) reg ^= 0x3;
  }
  return [3, 2, 1, 0].map((i) => (reg >> i) & 1);
}

export function idBits(id: number): number[] {
  if (!Number.isInteger(id) || id < 0 || id >= MAX_IDS) throw new RangeError(`id ${id} out of range`);
  return Array.from({ length: ID_BITS }, (_, i) => (id >> (ID_BITS - 1 - i)) & 1);
}

/** Full bit sequence: preamble, id, crc. */
export function encodeBits(id: number): number[] {
  const bits = idBits(id);
  return [...PREAMBLE, ...bits, ...crc4(bits)];
}

/** Half-slot on/off pattern (1 = screen lit) for one code repetition. */
export function encodeHalves(id: number): number[] {
  return encodeBits(id).flatMap((b) => (b ? [1, 0] : [0, 1]));
}

/** Validate a decoded bit sequence; returns the id or -1. */
export function decodeBits(bits: number[]): number {
  if (bits.length !== BITS_PER_CODE) return -1;
  for (let i = 0; i < PREAMBLE.length; i++) if (bits[i] !== PREAMBLE[i]) return -1;
  const data = bits.slice(PREAMBLE.length, PREAMBLE.length + ID_BITS);
  const crc = bits.slice(PREAMBLE.length + ID_BITS);
  const want = crc4(data);
  for (let i = 0; i < CRC_BITS; i++) if (crc[i] !== want[i]) return -1;
  return data.reduce((v, b) => (v << 1) | b, 0);
}

export function scheduleDuration(s: BlinkSchedule): number {
  return s.halfMs * HALVES_PER_CODE * s.repeats;
}

/** Whether a phone with this id should be lit at host time t (dark outside the schedule). */
export function litAt(id: number, s: BlinkSchedule, t: number, halves = encodeHalves(id)): boolean {
  const k = Math.floor((t - s.t0) / s.halfMs);
  if (k < 0 || k >= HALVES_PER_CODE * s.repeats) return false;
  return halves[k % HALVES_PER_CODE] === 1;
}
