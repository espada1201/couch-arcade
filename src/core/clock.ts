// NTP-style offset estimation between a phone's clock and the host's.
// Each ping/pong bounds the offset: the trip out takes no less than zero, so the offset is at most
// h1 - t0, and the trip back takes no less than zero, so it is at least h2 - t3. Queueing, retries
// and a busy page only ever add delay, so over many pings the tightest bounds come from each
// direction's own fastest trip, even when no single round trip was fast both ways. The estimate is
// the middle of the tightest bounds; what remains is half the difference between the two
// directions' fastest trips, which no clock sync can see.

/** Pongs kept: about two minutes at the steady ping rate, short enough that clock drift stays small. */
const KEEP = 60;

export interface ClockSample {
  offset: number;
  rtt: number;
}

export function sampleFrom(t0: number, t1: number, t2: number, t3: number): ClockSample {
  return { offset: (t1 - t0 + (t2 - t3)) / 2, rtt: t3 - t0 - (t2 - t1) };
}

/** What one pong says: the offset lies in [lo, hi]. */
interface Bound {
  lo: number;
  hi: number;
}

export class ClockEstimator {
  private bounds: Bound[] = [];
  private off = 0;
  private err = Infinity;
  /** The link was replaced: the next pong decides whether the host's clock is still the same one. */
  private relinked = false;

  add(s: ClockSample): void {
    if (!Number.isFinite(s.offset) || !(s.rtt >= 0)) return;
    const b = { lo: s.offset - s.rtt / 2, hi: s.offset + s.rtt / 2 };
    // A new host page (or a clock that jumped) shows as a pong that rules out the current estimate.
    if (this.relinked && (b.lo > this.off || b.hi < this.off)) this.bounds = [];
    this.relinked = false;
    this.bounds.push(b);
    if (this.bounds.length > KEEP) this.bounds.shift();
    // Bounds that no longer overlap mean the clocks drifted or jumped: the oldest are wrong.
    while (this.tightest().lo > this.tightest().hi) this.bounds.shift();
    const { lo, hi, lo3, hi3 } = this.tightest();
    this.off = (lo + hi) / 2;
    // How far the fastest trips might still be from the true fastest: the gaps to the third-fastest
    // trips say how thinly the fast end is sampled. Typical, not worst case: in simulations of links
    // from a quiet LAN to 300 ms of jitter the real error stayed inside it about 9 times in 10.
    this.err = Number.isFinite(lo3 + hi3) ? Math.max(1, (lo - lo3 + hi3 - hi) / 2) : (hi - lo) / 2;
  }

  /** The tightest bounds, and the third-tightest of each kind (-Infinity/Infinity with fewer than three). */
  private tightest(): Bound & { lo3: number; hi3: number } {
    const los = this.bounds.map((b) => b.lo).sort((a, b) => b - a);
    const his = this.bounds.map((b) => b.hi).sort((a, b) => a - b);
    return { lo: los[0], hi: his[0], lo3: los[2] ?? -Infinity, hi3: his[2] ?? Infinity };
  }

  /** Forget everything: this device slept, so its own clock may have stopped. */
  reset(): void {
    // Keep showing the last estimate until the first new round trip lands, rather than jumping to 0.
    this.bounds = [];
    this.err = Infinity;
    this.relinked = false;
  }

  /**
   * A new link to the room. The host is most likely the same page, so its clock and everything
   * learned about it still hold; the first pong on the new link checks that before it is trusted.
   */
  relink(): void {
    if (this.bounds.length) this.relinked = true;
  }

  get count(): number {
    return this.bounds.length;
  }

  /** Estimated host - local offset (ms); add it to local time to get host time. */
  get offset(): number {
    return this.off;
  }

  /** Typical error of the estimate (ms), at least 1; Infinity before the first pong. */
  get uncertainty(): number {
    return this.err;
  }
}
