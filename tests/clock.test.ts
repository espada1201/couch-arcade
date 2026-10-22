import { describe, expect, it } from 'vitest';
import { ClockEstimator, sampleFrom } from '../src/core/clock';
import { rng } from './rng';

/** Simulates pings over a link with a base delay plus heavy-tailed, asymmetric queueing jitter. */
function simulate(trueOffset: number, seed: number, pings = 40, base = 15, spike = 0.2) {
  const r = rng(seed);
  const est = new ClockEstimator();
  let local = 5000;
  const leg = (extra: number) => base + r() * 6 + (r() < spike ? r() * 250 : 0) + extra;
  for (let i = 0; i < pings; i++) {
    const t0 = local;
    const t1 = t0 + trueOffset + leg(0);
    const t2 = t1 + r() * 2;
    const t3 = t2 - trueOffset + leg(8); // return leg is systematically slower (wifi upload)
    est.add(sampleFrom(t0, t1, t2, t3));
    local = t3 + 250;
  }
  return est;
}

describe('clock sync', () => {
  it('is exact on a symmetric link', () => {
    const s = sampleFrom(0, 1010, 1011, 21);
    expect(s.offset).toBe(1000);
    expect(s.rtt).toBe(20);
  });

  it('recovers offsets within 10 ms over a jittery, asymmetric link', () => {
    for (let seed = 1; seed <= 50; seed++) {
      const truth = (seed * 7919) % 100000 - 50000;
      const est = simulate(truth, seed);
      expect(Math.abs(est.offset - truth)).toBeLessThan(10);
      expect(est.uncertainty).toBeLessThan(40);
    }
  });

  it('two phones agree with each other well inside the 30 ms spread target', () => {
    const spread: number[] = [];
    for (let seed = 1; seed <= 50; seed++) {
      const a = simulate(1234, seed);
      const b = simulate(-777, seed + 100);
      spread.push(Math.abs(a.offset - 1234 - (b.offset + 777)));
    }
    expect(Math.max(...spread)).toBeLessThan(15);
  });

  it('ignores nonsense samples and starts at zero', () => {
    const est = new ClockEstimator();
    expect(est.offset).toBe(0);
    est.add({ offset: NaN, rtt: 3 });
    est.add({ offset: 4, rtt: -1 });
    expect(est.count).toBe(0);
  });
});

describe('clock reset', () => {
  it('keeps showing the last offset until new samples land, with unknown uncertainty', () => {
    const est = simulate(500, 3);
    const before = est.offset;
    est.reset();
    expect(est.count).toBe(0);
    expect(est.offset).toBe(before);
    expect(est.uncertainty).toBe(Infinity);
    est.add({ offset: 42, rtt: 10 });
    expect(est.offset).toBe(42);
    expect(est.uncertainty).toBe(5);
  });
});
