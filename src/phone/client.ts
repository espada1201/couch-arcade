// A phone's connection to the host: joins (and rejoins) under a stable token so a
// refresh lands back in the same seat, keeps its clock locked to the host's, and
// holds whatever program the host last sent.
import { ClockEstimator, sampleFrom } from '../core/clock';
import type { Program } from '../core/effects';
import type { Point } from '../core/layout';
import type { Track } from '../core/speaker';
import { TAP_MS, type HostMsg, type PhoneMsg } from '../core/protocol';
import type { ChunkMsg } from '../net/chunks';
import { PHONE_BUDGET, tokenBucket } from '../net/limits.js';
import { backoff, type Link, type Transport } from '../net/transport';
import { stableId } from '../storage';
import { errorText } from '../ui/dom';
import { throttle } from '../host/throttle';

export type Status = 'connecting' | 'live' | 'reconnecting' | 'full' | 'replaced' | 'failed';

/** A host that hasn't sent anything (a pong, a chunk, a program) for this long is gone, even if the link never said so. */
const SILENT_MS = 6000;
/** Shortest gap between two file acks. */
const HAVE_MS = 40;
/** A seated phone that lost its host tries at the backoff pace this many times (about two minutes), then every SLOW_RETRY_MS. */
const FAST_RETRIES = 26;
const SLOW_RETRY_MS = 15_000;
/** The relay keeps a dropped host's room ten minutes, so a seated phone knocks that long before asking for a tap. */
const GIVE_UP_MS = 10 * 60_000;
/** Budget a message that can wait (a file or frame ack) leaves for taps and pings. */
const RESERVE = 5;

/** Acks: each sums up all before it, so only the newest of each kind waits for the budget. */
type Ack = Extract<PhoneMsg, { t: 'have' | 'ack' }>;

export class PhoneClient {
  seat = -1;
  pos: Point | null = null;
  aspect = 1;
  program: Program = { kind: 'lobby' };
  /** Counts programs as they arrive, so a player can tell a new one from a resend of the same. */
  programSeq = 0;
  /** Counts welcomes, so a player can tell a fresh (re)join from another message. */
  joins = 0;
  /** A song the host wants every phone to have ready, whatever is running now. */
  offer: Track | null = null;
  status: Status = 'connecting';
  error = '';
  readonly clock = new ClockEstimator();
  readonly token: string;
  onChange: () => void = () => {};
  /** A piece of a file the host is sending (not a state change, so no onChange). */
  onChunk: (m: ChunkMsg) => void = () => {};
  private link: Link | null = null;
  private pingTimer = 0;
  private retries = 0;
  /** When the connection was first lost in this run of retries. */
  private lostAt: number | null = null;
  private lastHeard = 0;
  private pendingHave: Extract<PhoneMsg, { t: 'have' }> | null = null;
  private readonly sendHave = throttle(() => {
    const m = this.pendingHave;
    this.pendingHave = null;
    if (m) this.later(m);
  }, HAVE_MS);
  /** Taps, pings and acks share it, so an honest phone stays well inside what the relay allows. */
  private readonly budget = tokenBucket(PHONE_BUDGET, performance.now());
  private readonly waiting = new Map<Ack['t'], Ack>();
  private flushTimer = 0;
  private lastTap = -Infinity;

  constructor(
    private readonly transport: Transport,
    readonly room: string,
    sim?: Point,
  ) {
    // Simulated phones are tabs of one browser, so each needs its own identity.
    // Kept in localStorage so closing the tab and rescanning the QR code lands in the same seat.
    this.token = stableId(`swarm-phone-${room}${sim ? `@${sim.x},${sim.y}` : ''}`, 16);
    // A sleeping phone's clock may have stopped; relearn the offset when it wakes.
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible' && this.link) {
        this.clock.reset();
        this.startPinging();
      }
    });
  }

  /** Host-clock time now. */
  hostNow(): number {
    return performance.now() + this.clock.offset;
  }

  async connect(): Promise<void> {
    try {
      const link = await this.transport.join(this.room);
      this.link = link;
      // Acks were for the old link: the host starts this one afresh, and the music re-acks on welcome.
      this.waiting.clear();
      // Usually the same host page on a new link, so the clock estimate carries over; the first pong checks.
      this.clock.relink();
      link.onMessage((m) => this.receive(m as HostMsg));
      link.onClose(() => this.lost());
      this.send({ t: 'hello', token: this.token });
      this.startPinging();
    } catch (e) {
      this.error = errorText(e);
      this.lost();
    }
  }

  /** The host counts one tap per TAP_MS; a sooner one, or one past the budget, is not sent. */
  tap(): void {
    const now = performance.now();
    if (now - this.lastTap < TAP_MS || !this.budget.take(now)) return;
    this.lastTap = now;
    this.send({ t: 'tap' });
  }

  vote(choice: number): void {
    this.send({ t: 'vote', choice });
  }

  enterSeat(row: number, seat: number): void {
    this.send({ t: 'seat', row, seat });
  }

  /**
   * Tell the host how much of a file this phone holds. Each ack sums up all before it, so a quick
   * run of them goes as the newest, at most every HAVE_MS: on fast Wi-Fi chunks land faster than
   * the relay lets a phone send. One that says ready or can't play goes at once.
   */
  have(m: Extract<PhoneMsg, { t: 'have' }>): void {
    this.pendingHave = m;
    if (!m.state) return this.sendHave();
    // Ready (or can't play) goes now, with nothing older left to follow it: a hidden tab may hold a
    // timer back for a minute, and the host would wait that long to count this phone ready.
    this.sendHave.cancel();
    this.pendingHave = null;
    this.waiting.delete('have');
    this.sendHave.sent();
    this.send(m);
  }

  private send(m: PhoneMsg): void {
    this.link?.send(m);
  }

  /** Send an ack once the budget allows, keeping RESERVE for taps and pings. */
  private later(m: Ack): void {
    this.waiting.set(m.t, m);
    this.flush();
  }

  private readonly flush = (): void => {
    clearTimeout(this.flushTimer);
    this.flushTimer = 0;
    for (const [t, m] of this.waiting) {
      const now = performance.now();
      if (!this.budget.take(now, RESERVE)) return void (this.flushTimer = window.setTimeout(this.flush, this.budget.wait(now, RESERVE)));
      this.waiting.delete(t);
      this.send(m);
    }
  };

  private startPinging(): void {
    clearTimeout(this.pingTimer);
    this.lastHeard = performance.now();
    let n = 0;
    const tick = () => {
      // Closing runs the usual reconnect path.
      if (performance.now() - this.lastHeard > SILENT_MS) return void this.link?.close();
      const u = this.clock.uncertainty;
      // Out of budget: this ping is skipped, and the next tick tries again.
      if (this.budget.take(performance.now())) this.send({ t: 'ping', c0: performance.now(), u: Number.isFinite(u) ? Math.round(u) : undefined });
      // A quick burst to lock on, then a slow trickle to track drift.
      this.pingTimer = window.setTimeout(tick, n++ < 16 ? 150 : 2000);
    };
    tick();
  }

  private receive(m: HostMsg): void {
    // On slow Wi-Fi a pong can queue behind song chunks; whatever arrives proves the host is there.
    this.lastHeard = performance.now();
    switch (m.t) {
      case 'chunk':
        return this.onChunk(m);
      case 'pong':
        this.clock.add(sampleFrom(m.c0, m.h1, m.h2, performance.now()));
        return;
      case 'welcome':
        this.seat = m.seat;
        this.joins++;
        this.status = 'live';
        this.retries = 0;
        this.lostAt = null;
        this.error = '';
        break;
      case 'full':
        this.status = 'full';
        break;
      case 'replaced':
        this.status = 'replaced';
        break;
      case 'pos':
        this.pos = m.pos;
        this.aspect = m.aspect;
        break;
      case 'program':
        if (m.ack !== undefined) this.later({ t: 'ack', n: m.ack });
        this.program = m.program;
        this.programSeq++;
        break;
      case 'offer':
        this.offer = m.track;
        break;
    }
    this.onChange();
  }

  private lost(): void {
    clearTimeout(this.pingTimer);
    this.link = null;
    if (this.status === 'full' || this.status === 'replaced') return this.onChange();
    this.retries++;
    const now = performance.now();
    const since = (this.lostAt ??= now);
    // Never seated: most likely a wrong room code, so say so soon. Seated: the host or its relay
    // may be restarting or asleep, so keep trying, slowly after the first two minutes, until its
    // room would be gone from the relay anyway.
    const joined = this.seat >= 0;
    this.status = (joined ? now - since > GIVE_UP_MS : this.retries > 2) ? 'failed' : joined ? 'reconnecting' : 'connecting';
    this.onChange();
    if (this.status === 'failed') return;
    const again = () => {
      // A hidden tab (a second copy, a locked phone) shouldn't fight for the seat. Once it wakes,
      // the time asleep doesn't count: its host may be mid-restart, so start the retries afresh.
      if (document.hidden) document.addEventListener('visibilitychange', woke, { once: true });
      else void this.connect();
    };
    const woke = () => {
      this.lostAt = null;
      this.retries = 0;
      again();
    };
    setTimeout(again, joined && this.retries > FAST_RETRIES ? SLOW_RETRY_MS : backoff(this.retries));
  }

  retry(): void {
    this.retries = 0;
    this.lostAt = null;
    this.status = 'connecting';
    this.onChange();
    void this.connect();
  }
}
