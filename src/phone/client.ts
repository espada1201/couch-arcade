// A phone's connection to the host: joins (and rejoins) under a stable token so a
// refresh lands back in the same seat, keeps its clock locked to the host's, and
// holds whatever program the host last sent.
import { ClockEstimator, sampleFrom } from '../core/clock';
import type { Program } from '../core/effects';
import type { Point } from '../core/layout';
import type { Track } from '../core/speaker';
import type { HostMsg, PhoneMsg } from '../core/protocol';
import type { ChunkMsg } from '../net/chunks';
import { backoff, type Link, type Transport } from '../net/transport';
import { stableId } from '../storage';
import { errorText } from '../ui/dom';

export type Status = 'connecting' | 'live' | 'reconnecting' | 'full' | 'replaced' | 'failed';

/** A host that hasn't sent anything (a pong, a chunk, a program) for this long is gone, even if the link never said so. */
const SILENT_MS = 6000;

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
  private lastHeard = 0;

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
      // The host's clock restarts if the host page reloads; never mix samples across links.
      this.clock.reset();
      link.onMessage((m) => this.receive(m as HostMsg));
      link.onClose(() => this.lost());
      this.send({ t: 'hello', token: this.token });
      this.startPinging();
    } catch (e) {
      this.error = errorText(e);
      this.lost();
    }
  }

  tap(): void {
    this.send({ t: 'tap' });
  }

  vote(choice: number): void {
    this.send({ t: 'vote', choice });
  }

  enterSeat(row: number, seat: number): void {
    this.send({ t: 'seat', row, seat });
  }

  /** Tell the host how much of a file this phone holds. */
  have(m: Extract<PhoneMsg, { t: 'have' }>): void {
    this.send(m);
  }

  private send(m: PhoneMsg): void {
    this.link?.send(m);
  }

  private startPinging(): void {
    clearTimeout(this.pingTimer);
    this.lastHeard = performance.now();
    let n = 0;
    const tick = () => {
      // Closing runs the usual reconnect path.
      if (performance.now() - this.lastHeard > SILENT_MS) return void this.link?.close();
      const u = this.clock.uncertainty;
      this.send({ t: 'ping', c0: performance.now(), u: Number.isFinite(u) ? Math.round(u) : undefined });
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
        if (m.ack !== undefined) this.send({ t: 'ack', n: m.ack });
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
    // Never seated: most likely a wrong room code, so say so soon. Seated: the host or its relay
    // may be restarting, so keep trying for about two minutes before asking for a tap.
    const joined = this.seat >= 0;
    this.status = this.retries > (joined ? 26 : 2) ? 'failed' : joined ? 'reconnecting' : 'connecting';
    this.onChange();
    if (this.status === 'failed') return;
    const again = () => {
      // A hidden tab (a second copy, a locked phone) shouldn't fight for the seat.
      if (document.hidden) document.addEventListener('visibilitychange', again, { once: true });
      else void this.connect();
    };
    setTimeout(again, backoff(this.retries));
  }

  retry(): void {
    this.retries = 0;
    this.status = 'connecting';
    this.onChange();
    void this.connect();
  }
}
