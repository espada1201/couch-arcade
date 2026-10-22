// Sends one file to every phone that asks for it. Phones pull: they ack what they hold
// (starting with "nothing"), and each ack slides that phone's window along. A phone that
// joins late or reconnects acks again on its new link and is resumed from what it has.
import { ChunkSender, chunkCount, chunkMsg, type ChunkMsg } from '../net/chunks';
import { MAX_MESSAGE_BYTES, type HaveState, type PhoneMsg } from '../core/protocol';
import type { Link } from '../net/transport';
import type { HostSession } from './session';

/**
 * A phone's backlog past which no more chunks are queued for it: about two chunks, so its
 * pongs and programs never wait behind a whole window of song on slow Wi-Fi.
 */
export const CHUNK_BACKLOG = 2 * MAX_MESSAGE_BYTES;

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
  private live = false;
  /** Re-sends stalled chunks; runs only while some phone is still fetching. */
  private timer = 0;
  /** Each chunk is base64-encoded once and the same message goes to every phone. */
  private chunks: ChunkMsg[] = [];

  constructor(
    private readonly session: HostSession,
    readonly id: string,
    private readonly data: Uint8Array,
  ) {
    this.n = chunkCount(data.length);
  }

  /** Begin answering acks and re-sending stalled chunks. */
  start(): void {
    this.live = true;
  }

  stop(): void {
    this.live = false;
    this.peers.clear();
    this.keepPumping();
  }

  have(seat: number, m: Extract<PhoneMsg, { t: 'have' }>): void {
    const link = this.session.seats.get(seat)?.link;
    if (!this.live || m.id !== this.id || !link) return;
    let peer = this.peers.get(seat);
    // A new link means a reconnect: whatever was in flight on the old one is gone.
    if (!peer || peer.link !== link) this.peers.set(seat, (peer = { link, sender: new ChunkSender(this.n) }));
    peer.sender.ack(m.next, m.got, performance.now());
    // A phone's state for a song only ever moves on to ready or error, so a stale ack can't take it back.
    peer.state = m.state ?? peer.state;
    this.pump(seat, peer);
    this.keepPumping();
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
    this.keepPumping();
  }

  /** The timer runs exactly while a connected phone still lacks part of the file. */
  private keepPumping(): void {
    const busy = [...this.peers.values()].some((p) => !p.sender.done);
    if (busy && !this.timer) this.timer = window.setInterval(() => this.pumpAll(), 300);
    else if (!busy && this.timer) {
      clearInterval(this.timer);
      this.timer = 0;
    }
  }

  private pump(seat: number, peer: Peer): void {
    // Gone or back on a new link: forget it (a new link acks again and starts afresh).
    if (this.session.seats.get(seat)?.link !== peer.link) return void this.peers.delete(seat);
    const now = performance.now();
    while (peer.link.buffered() < CHUNK_BACKLOG) {
      const [i] = peer.sender.due(now, 1);
      if (i === undefined) return;
      this.session.send(seat, (this.chunks[i] ??= chunkMsg(this.id, this.data, i)));
    }
  }
}
