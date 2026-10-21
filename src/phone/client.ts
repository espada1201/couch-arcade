// A phone's connection to the host: joins (and rejoins) under a stable token so a
// refresh lands back in the same seat, keeps its clock locked to the host's, and
// holds whatever program the host last sent.
import { ClockEstimator, sampleFrom } from '../core/clock';
import type { Program } from '../core/effects';
import type { Point } from '../core/layout';
import type { HostMsg, PhoneMsg } from '../core/protocol';
import { randomId, type Link, type Transport } from '../net/transport';

export type Status = 'connecting' | 'live' | 'reconnecting' | 'full' | 'replaced' | 'failed';

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
  private link: Link | null = null;
  private pingTimer = 0;
  private retries = 0;

  constructor(
    private readonly transport: Transport,
    readonly room: string,
    private readonly sim?: Point,
  ) {
    // Simulated phones are tabs of one browser, so each needs its own identity.
    const key = `swarm-phone-${room}${sim ? `@${sim.x},${sim.y}` : ''}`;
    let token = '';
    try {
      // localStorage so closing the tab and rescanning the QR code lands in the same seat.
      token = localStorage.getItem(key) ?? '';
      if (!token) localStorage.setItem(key, (token = randomId(16)));
    } catch {
      token = randomId(16);
    }
    this.token = token;
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

  private send(m: PhoneMsg): void {
    this.link?.send(m);
  }

  private startPinging(): void {
    clearTimeout(this.pingTimer);
    let n = 0;
    const tick = () => {
      const u = this.clock.uncertainty;
      this.send({ t: 'ping', c0: performance.now(), u: Number.isFinite(u) ? Math.round(u) : undefined });
      // A quick burst to lock on, then a slow trickle to track drift.
      this.pingTimer = window.setTimeout(tick, n++ < 16 ? 150 : 2000);
    };
    tick();
  }

  private receive(m: HostMsg): void {
    switch (m.t) {
      case 'pong':
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
    this.status = this.retries > 8 ? 'failed' : 'reconnecting';
    this.onChange();
    if (this.status !== 'reconnecting') return;
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
