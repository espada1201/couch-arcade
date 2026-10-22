// A phone's connection to the host: joins (and rejoins) under a stable token so a
// refresh lands back in the same seat, keeps its clock locked to the host's, and
// holds whatever program the host last sent.
import { ClockEstimator, sampleFrom } from '../core/clock';
import type { Program } from '../core/effects';
import type { Point } from '../core/layout';
import type { HostMsg, PhoneMsg } from '../core/protocol';
import type { ChunkMsg } from '../net/chunks';
import type { Link, Transport } from '../net/transport';
import { stableId } from '../storage';

export type Status = 'connecting' | 'live' | 'reconnecting' | 'full' | 'replaced' | 'failed';

/** A host that hasn't answered a ping for this long is gone, even if the link never said so. */
const SILENT_MS = 6000;

export class PhoneClient {
  seat = -1;
  pos: Point | null = null;
  aspect = 1;
  program: Program = { kind: 'lobby' };
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
  private lastPong = 0;

  constructor(
    private readonly transport: Transport,
    readonly room: string,
    private readonly sim?: Point,
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
      this.send({ t: 'hello', token: this.token, sim: this.sim });
      this.startPinging();
    } catch (e) {
      this.error = e instanceof Error ? e.message : String(e);
      this.lost();
    }
  }

  tap(): void {
    this.send({ t: 'tap' });
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
    this.lastPong = performance.now();
    let n = 0;
    const tick = () => {
      // Closing runs the usual reconnect path.
      if (performance.now() - this.lastPong > SILENT_MS) return void this.link?.close();
      const u = this.clock.uncertainty;
      this.send({ t: 'ping', c0: performance.now(), u: Number.isFinite(u) ? Math.round(u) : undefined });
      // A quick burst to lock on, then a slow trickle to track drift.
      this.pingTimer = window.setTimeout(tick, n++ < 16 ? 150 : 2000);
    };
    tick();
  }

  private receive(m: HostMsg): void {
    switch (m.t) {
      case 'chunk':
        return this.onChunk(m);
      case 'pong':
        this.lastPong = performance.now();
        this.clock.add(sampleFrom(m.c0, m.h1, m.h2, performance.now()));
        return;
      case 'welcome':
        this.seat = m.seat;
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
        this.program = m.program;
        break;
    }
    this.onChange();
  }

  private lost(): void {
    clearTimeout(this.pingTimer);
    this.link = null;
    if (this.status === 'full' || this.status === 'replaced') return this.onChange();
    this.retries++;
    // Never seated: most likely a wrong room code, so say so soon rather than retry for a minute.
    const joined = this.seat >= 0;
    this.status = this.retries > (joined ? 8 : 2) ? 'failed' : joined ? 'reconnecting' : 'connecting';
    this.onChange();
    if (this.status === 'failed') return;
    const again = () => {
      // A hidden tab (a second copy, a locked phone) shouldn't fight for the seat.
      if (document.hidden) document.addEventListener('visibilitychange', again, { once: true });
      else void this.connect();
    };
    setTimeout(again, Math.min(5000, 400 * 2 ** this.retries));
  }

  retry(): void {
    this.retries = 0;
    this.status = 'connecting';
    this.onChange();
    void this.connect();
  }
}
