import { describe, expect, it } from 'vitest';
import { BITS_PER_CODE, HALVES_PER_CODE, MAX_IDS, SYNC, decodeBits, encodeBits, encodeHalves, isSync, litAt } from '../src/core/blinkcode';

describe('blink code', () => {
  it('round-trips every id', () => {
    for (let id = 0; id < MAX_IDS; id++) expect(decodeBits(encodeBits(id))).toBe(id);
  });

  it('rejects every single-bit error', () => {
    for (let id = 0; id < MAX_IDS; id++) {
      const bits = encodeBits(id);
      for (let i = 0; i < BITS_PER_CODE; i++) {
        const bad = [...bits];
        bad[i] ^= 1;
        expect(decodeBits(bad)).toBe(-1);
      }
    }
  });

  it('data is DC balanced: every bit is one lit and one dark half', () => {
    const halves = encodeHalves(77).slice(SYNC.length);
    for (let i = 0; i < halves.length; i += 2) expect(halves[i] + halves[i + 1]).toBe(1);
  });

  it('the sync mark lines up only at the true start of every code (any camera delay is recoverable)', () => {
    for (let id = 0; id < MAX_IDS; id++) {
      const halves = encodeHalves(id);
      for (let r = 0; r < HALVES_PER_CODE; r++) {
        const rotated = [...halves.slice(r), ...halves.slice(0, r)];
        expect(isSync(rotated), `id ${id} rotation ${r}`).toBe(r === 0);
      }
    }
  });

  it('is dark outside the schedule and loops the pattern inside', () => {
    const s = { t0: 1000, halfMs: 100, repeats: 2 };
    const halves = encodeHalves(5);
    expect(litAt(5, s, 999)).toBe(false);
    expect(litAt(5, s, 1000 + 100 * halves.length * 2 + 1)).toBe(false);
    for (let k = 0; k < halves.length * 2; k++) expect(litAt(5, s, 1050 + k * 100)).toBe(halves[k % halves.length] === 1);
  });
});
