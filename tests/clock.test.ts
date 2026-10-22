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

/** The stress proxy's bad Wi-Fi: 150 ms each way plus up to 200 ms of jitter, 2% stalls of 0.2-1 s, order kept per direction. */
function badWifi(trueOffset: number, seed: number, pings = 60) {
  const r = rng(seed);
  const est = new ClockEstimator();
  const errors: { err: number; u: number }[] = [];
  let up = 0;
  let down = 0;
  const leg = () => 150 + r() * 200 + (r() < 0.02 ? 200 + r() * 800 : 0);
  for (let i = 0, t0 = 1000; i < pings; i++, t0 += i < 16 ? 150 : 2000) {
    const arrive = (up = Math.max(t0 + leg(), up));
    const back = (down = Math.max(arrive + leg(), down));
    est.add(sampleFrom(t0, arrive + trueOffset, arrive + trueOffset, back));
    if (i >= 20) errors.push({ err: Math.abs(est.offset - trueOffset), u: est.uncertainty });
  }
  return { est, errors };
}

describe('clock sync on bad Wi-Fi', () => {
  it('stays within a few ms of the truth under 300 ms round trips with 200 ms of jitter', () => {
    const errs = Array.from({ length: 30 }, (_, k) => badWifi(2500, k + 1).errors.map((e) => e.err)).flat().sort((a, b) => a - b);
    expect(errs[Math.floor(errs.length * 0.5)]).toBeLessThan(3);
    expect(errs[Math.floor(errs.length * 0.95)]).toBeLessThan(10);
  });

  it('reports a typical error, not the worst-case half round trip, and it is usually right', () => {
    const all = Array.from({ length: 30 }, (_, k) => badWifi(-800, k + 1).errors).flat();
    const us = all.map((e) => e.u).sort((a, b) => a - b);
    expect(us[Math.floor(us.length / 2)]).toBeLessThan(20);
    expect(all.filter((e) => e.err <= e.u).length / all.length).toBeGreaterThan(0.8);
  });

  it('is at least 1 ms on a quiet link', () => {
    const est = new ClockEstimator();
    for (let i = 0; i < 10; i++) est.add({ offset: 100, rtt: 2 });
    expect(est.offset).toBe(100);
    expect(est.uncertainty).toBe(1);
  });
});

describe('clock across links', () => {
  it('keeps what it learned when the link is replaced and the host is the same page', () => {
    const { est } = badWifi(300, 7);
    const n = est.count;
    est.relink();
    est.add({ offset: est.offset + 3, rtt: 400 });
    expect(est.count).toBe(n + 1 > 60 ? 60 : n + 1);
    expect(Math.abs(est.offset - 300)).toBeLessThan(10);
  });

  it('starts over when the first pong on a new link rules the old estimate out (the host page restarted)', () => {
    const { est } = badWifi(300, 7);
    est.relink();
    est.add({ offset: 9000, rtt: 20 });
    expect(est.count).toBe(1);
    expect(est.offset).toBe(9000);
  });

  it('drops old pongs once the clocks have drifted or jumped past them', () => {
    const est = new ClockEstimator();
    for (let i = 0; i < 10; i++) est.add({ offset: 0, rtt: 4 });
    est.add({ offset: 50, rtt: 4 });
    expect(est.offset).toBe(50);
    expect(est.count).toBe(1);
  });
});

describe('clock drift', () => {
  it('expires bounds older than a minute: a fast trip from 90 s ago no longer vouches for an offset that has drifted since', () => {
    let t = 0;
    const est = new ClockEstimator(() => t);
    for (let i = 0; i < 5; i++) est.add({ offset: 0, rtt: 2 });
    // 100 ppm of drift over 90 s is 9 ms; the pings since are slower, so their bounds are wide.
    t = 90_000;
    est.add({ offset: 10, rtt: 30 });
    est.add({ offset: 10, rtt: 30 });
    expect(est.count).toBe(2);
    expect(est.offset).toBe(10);
  });

  it('keeps bounds a minute old or less', () => {
    let t = 0;
    const est = new ClockEstimator(() => t);
    est.add({ offset: 0, rtt: 2 });
    t = 60_000;
    est.add({ offset: 4, rtt: 30 });
    expect(est.count).toBe(2);
    expect(est.offset).toBe(0);
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
