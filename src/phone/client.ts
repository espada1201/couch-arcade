// A phone's connection to the host: joins (and rejoins) under a stable token so a
// refresh lands back in the same seat, keeps its clock locked to the host's, and
// holds whatever program the host last sent.
import { ClockEstimator, sampleFrom } from '../core/clock';
import type { Program } from '../core/effects';
import type { Point } from '../core/layout';
import type { HostMsg, PhoneMsg } from '../core/protocol';
import { randomId, type Link, type Transport } from '../net/transport';

export type Status = 'connecting' | 'live' | 'reconnecting' | 'full' | 'failed';

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
    const key = `swarm-phone-${room}`;
    let token = '';
    try {
      token = sessionStorage.getItem(key) ?? '';
      if (!token) sessionStorage.setItem(key, (token = randomId(16)));
    } catch {
      token = randomId(16);
    }
    this.token = token;
  }

  /** Host-clock time now. */
  hostNow(): number {
    return performance.now() + this.clock.offset;
  }

  async connect(): Promise<void> {
    try {
      const link = await this.transport.join(this.room);
      this.link = link;
      this.retries = 0;
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
      this.send({ t: 'ping', c0: performance.now() });
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
        this.error = '';
        break;
      case 'full':
        this.status = 'full';
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
    if (this.status === 'full') return;
    this.retries++;
    this.status = this.retries > 8 ? 'failed' : 'reconnecting';
    this.onChange();
    if (this.status === 'reconnecting') setTimeout(() => this.connect(), Math.min(5000, 400 * 2 ** this.retries));
  }

  retry(): void {
    this.retries = 0;
    this.status = 'connecting';
    this.onChange();
    void this.connect();
  }
}
