// Temporal blink code that every phone flashes at the same moment, on a loop.
// Each data bit is Manchester-coded as two half-slots (1 = on,off; 0 = off,on) so the
// decoder only ever compares a pixel against itself a moment later: no absolute
// brightness threshold, immune to auto-exposure drift and screen brightness.
// Every loop starts with a sync mark of three lit then three dark half-slots. Valid
// Manchester never holds a level for more than two half-slots, so the mark can only
// line up in one place: the decoder can find where the loop starts without knowing
// the camera's delay at all.

export const ID_BITS = 7; // up to 128 phones
export const MAX_IDS = 1 << ID_BITS;
const CRC_BITS = 4;
export const SYNC = [1, 1, 1, 0, 0, 0];

export const BITS_PER_CODE = ID_BITS + CRC_BITS;
export const HALVES_PER_CODE = SYNC.length + BITS_PER_CODE * 2;

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

/** Data bits: id then crc. */
export function encodeBits(id: number): number[] {
  const bits = idBits(id);
  return [...bits, ...crc4(bits)];
}

/** Half-slot on/off pattern (1 = screen lit) for one loop of the code. */
export function encodeHalves(id: number): number[] {
  return [...SYNC, ...encodeBits(id).flatMap((b) => (b ? [1, 0] : [0, 1]))];
}

/** Validate decoded data bits; returns the id or -1. */
export function decodeBits(bits: number[]): number {
  if (bits.length !== BITS_PER_CODE) return -1;
  const data = bits.slice(0, ID_BITS);
  const want = crc4(data);
  for (let i = 0; i < CRC_BITS; i++) if (bits[ID_BITS + i] !== want[i]) return -1;
  return data.reduce((v, b) => (v << 1) | b, 0);
}

/** True when the first six half-slots of `halves` are exactly the sync mark. */
export function isSync(halves: ArrayLike<number>): boolean {
  return Math.min(halves[0], halves[1], halves[2]) > Math.max(halves[3], halves[4], halves[5]);
}

export function cycleMs(s: Pick<BlinkSchedule, 'halfMs'>): number {
  return s.halfMs * HALVES_PER_CODE;
}

export function scheduleDuration(s: BlinkSchedule): number {
  return cycleMs(s) * s.repeats;
}

/** Whether a phone with this id should be lit at host time t (dark outside the schedule). */
export function litAt(id: number, s: BlinkSchedule, t: number, halves = encodeHalves(id)): boolean {
  const k = Math.floor((t - s.t0) / s.halfMs);
  if (k < 0 || k >= HALVES_PER_CODE * s.repeats) return false;
  return halves[k % HALVES_PER_CODE] === 1;
}
