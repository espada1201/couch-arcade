// NTP-style offset estimation between a phone's clock and the host's.
// Each ping gives offset = ((t1 - t0) + (t2 - t3)) / 2, which is exact when the
// two legs take equal time. Queueing delay is what breaks symmetry, so we trust
// only the fastest round trips and take the median of those.

export interface ClockSample {
  offset: number;
  rtt: number;
}

export function sampleFrom(t0: number, t1: number, t2: number, t3: number): ClockSample {
  return { offset: (t1 - t0 + (t2 - t3)) / 2, rtt: t3 - t0 - (t2 - t1) };
}

export class ClockEstimator {
  private samples: ClockSample[] = [];

  constructor(private readonly keep = 40) {}

  add(s: ClockSample): void {
    if (!Number.isFinite(s.offset) || s.rtt < 0) return;
    this.samples.push(s);
    if (this.samples.length > this.keep) this.samples.shift();
  }

  get count(): number {
    return this.samples.length;
  }

  /** Estimated host - local offset (ms); add it to local time to get host time. */
  get offset(): number {
    const best = this.fastest();
    if (best.length === 0) return 0;
    const v = best.map((s) => s.offset).sort((a, b) => a - b);
    const m = v.length >> 1;
    return v.length % 2 ? v[m] : (v[m - 1] + v[m]) / 2;
  }

  /** Worst-case error bound of the estimate: half the RTT of the samples we trusted. */
  get uncertainty(): number {
    const best = this.fastest();
    return best.length ? Math.max(...best.map((s) => s.rtt)) / 2 : Infinity;
  }

  private fastest(): ClockSample[] {
    const sorted = [...this.samples].sort((a, b) => a.rtt - b.rtt);
    return sorted.slice(0, Math.max(1, Math.ceil(sorted.length / 4)));
  }
}
