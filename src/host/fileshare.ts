// Sends one file to every phone that asks for it. Phones pull: they ack what they hold
// (starting with "nothing"), and each ack slides that phone's window along. A phone that
// joins late or reconnects acks again on its new link and is resumed from what it has.
import { ChunkSender, chunkCount, chunkMsg } from '../net/chunks';
import type { HaveState, PhoneMsg } from '../core/protocol';
import type { Link } from '../net/transport';
import type { HostSession } from './session';

export interface PhoneProgress {
  seat: number;
  /** 0..1 of the file received. */
  progress: number;
  state?: HaveState;
}

interface Peer {
  link: Link;
  sender: ChunkSender;
  state?: HaveState;
}

export class FileShare {
  readonly n: number;
  private peers = new Map<number, Peer>();
  private timer = 0;

  constructor(
    private readonly session: HostSession,
    readonly id: string,
    private readonly data: Uint8Array,
  ) {
    this.n = chunkCount(data.length);
  }

  /** Begin answering acks and re-sending stalled chunks. */
  start(): void {
    if (!this.timer) this.timer = window.setInterval(() => this.pumpAll(), 300);
  }

  stop(): void {
    clearInterval(this.timer);
    this.timer = 0;
  }

  have(seat: number, m: Extract<PhoneMsg, { t: 'have' }>): void {
    const link = this.session.seats.get(seat)?.link;
    if (!this.timer || m.id !== this.id || !link) return;
    let peer = this.peers.get(seat);
    // A new link means a reconnect: whatever was in flight on the old one is gone.
    if (!peer || peer.link !== link) this.peers.set(seat, (peer = { link, sender: new ChunkSender(this.n) }));
    peer.sender.ack(m.next, m.got, performance.now());
    peer.state = m.state;
    this.pump(seat, peer);
  }

  /** Progress of every connected phone that has asked for the file. */
  progress(): PhoneProgress[] {
    return this.session.online.flatMap((s) => {
      const p = this.peers.get(s.seat);
      return p && p.link === s.link ? [{ seat: s.seat, progress: p.sender.progress, state: p.state }] : [];
    });
  }

  private pumpAll(): void {
    for (const [seat, peer] of this.peers) this.pump(seat, peer);
  }

  private pump(seat: number, peer: Peer): void {
    if (this.session.seats.get(seat)?.link !== peer.link) return void this.peers.delete(seat);
    for (const i of peer.sender.due(performance.now())) this.session.send(seat, chunkMsg(this.id, this.data, i));
  }
}
