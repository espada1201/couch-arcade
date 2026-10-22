// NTP-style offset estimation between a phone's clock and the host's.
// Each ping gives offset = ((t1 - t0) + (t2 - t3)) / 2, which is exact when the
// two legs take equal time. Queueing delay is what breaks symmetry, so we trust
// only the fastest round trips and take the median of those.
import { median } from './math';

export interface ClockSample {
  offset: number;
  rtt: number;
}

export function sampleFrom(t0: number, t1: number, t2: number, t3: number): ClockSample {
  return { offset: (t1 - t0 + (t2 - t3)) / 2, rtt: t3 - t0 - (t2 - t1) };
}

export class ClockEstimator {
  private samples: ClockSample[] = [];
  private off = 0;
  private unc = Infinity;

  constructor(private readonly keep = 40) {}

  add(s: ClockSample): void {
    if (!Number.isFinite(s.offset) || s.rtt < 0) return;
    this.samples.push(s);
    if (this.samples.length > this.keep) this.samples.shift();
    // Queueing only ever adds delay, so trust the fastest quarter of round trips.
    const sorted = [...this.samples].sort((a, b) => a.rtt - b.rtt);
    const best = sorted.slice(0, Math.max(1, Math.ceil(sorted.length / 4)));
    this.off = median(best.map((b) => b.offset));
    this.unc = Math.max(...best.map((b) => b.rtt)) / 2;
  }

  /** Forget everything: the host's clock may have restarted, or this device slept. */
  reset(): void {
    // Keep showing the last estimate until the first new round trip lands, rather than jumping to 0.
    this.samples = [];
    this.unc = Infinity;
  }

  get count(): number {
    return this.samples.length;
  }

  /** Estimated host - local offset (ms); add it to local time to get host time. */
  get offset(): number {
    return this.off;
  }

  /** Worst-case error bound of the estimate: half the RTT of the samples we trusted. */
  get uncertainty(): number {
    return this.unc;
  }
}
