// Moving a file that is bigger than one message: the sender cuts it into numbered base64
// chunks and keeps a small window in flight per receiver; the receiver acks the lowest
// chunk it is still missing. Every transport here is JSON over an ordered channel whose
// messages must stay under 64 KB (the relay's maxPayload, PeerJS data channels), so a
// chunk message is sized to fit in MAX_MESSAGE_BYTES with room for the relay's envelope.
import { payloadBytes } from '../core/protocol';

/** Raw bytes per chunk, with 512 bytes left for the envelope. */
export const CHUNK_BYTES = payloadBytes(512);

export interface ChunkMsg {
  t: 'chunk';
  /** Which transfer this chunk belongs to. */
  id: string;
  i: number;
  n: number;
  /** The chunk's bytes, base64. */
  d: string;
}

export function chunkCount(size: number, chunkBytes = CHUNK_BYTES): number {
  return Math.ceil(size / chunkBytes);
}

export function chunkMsg(id: string, data: Uint8Array, i: number, chunkBytes = CHUNK_BYTES): ChunkMsg {
  return { t: 'chunk', id, i, n: chunkCount(data.length, chunkBytes), d: toBase64(data.subarray(i * chunkBytes, (i + 1) * chunkBytes)) };
}

export function toBase64(b: Uint8Array): string {
  let s = '';
  // In slices: spreading a whole chunk into one call can overflow the argument stack.
  for (let i = 0; i < b.length; i += 0x2000) s += String.fromCharCode(...b.subarray(i, i + 0x2000));
  return btoa(s);
}

export function fromBase64(s: string): Uint8Array {
  const bin = atob(s);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

/** Collects chunks in any order, ignoring duplicates and nonsense indices. */
export class Reassembler {
  private parts: (Uint8Array | undefined)[];
  private count = 0;
  private low = 0;

  constructor(readonly n: number) {
    this.parts = new Array(n);
  }

  /** True when the chunk was new. Throws nothing on bad input: senders are untrusted. */
  add(i: number, data: string): boolean {
    if (!Number.isInteger(i) || i < 0 || i >= this.n || this.parts[i]) return false;
    try {
      this.parts[i] = fromBase64(data);
    } catch {
      return false;
    }
    this.count++;
    while (this.low < this.n && this.parts[this.low]) this.low++;
    return true;
  }

  /** How many distinct chunks have arrived. */
  get got(): number {
    return this.count;
  }

  /** The lowest chunk index still missing (n once complete). */
  get next(): number {
    return this.low;
  }

  get done(): boolean {
    return this.low >= this.n;
  }

  bytes(): Uint8Array {
    const parts = this.parts as Uint8Array[];
    const out = new Uint8Array(parts.reduce((s, p) => s + p.length, 0));
    let at = 0;
    for (const p of parts) {
      out.set(p, at);
      at += p.length;
    }
    return out;
  }
}

/**
 * One receiver's side of a transfer, as the sender sees it. Pure: the caller passes the
 * time, sends whatever `due` returns, and feeds back the receiver's acks. A chunk lost in
 * flight (a reconnect, a dropped ack) holds the window shut; after `stallMs` with no
 * progress the sender goes back to the first missing chunk and sends from there again.
 */
export class ChunkSender {
  private hi = 0;
  private low = 0;
  private got = 0;
  private lastProgress = -Infinity;
  private readonly window: number;
  private readonly stallMs: number;

  constructor(
    readonly n: number,
    opts: { window?: number; stallMs?: number } = {},
  ) {
    this.window = opts.window ?? 8;
    this.stallMs = opts.stallMs ?? 2000;
  }

  /** The receiver holds everything below `next`, and `got` chunks in all. */
  ack(next: number, got: number, now: number): void {
    if (next > this.low || got > this.got || this.lastProgress === -Infinity) this.lastProgress = now;
    this.low = Math.max(this.low, Math.min(next, this.n));
    this.got = Math.max(this.got, got);
    this.hi = Math.max(this.hi, this.low);
  }

  /** Chunk indices to send now. */
  due(now: number): number[] {
    if (this.done) return [];
    if (this.lastProgress === -Infinity) this.lastProgress = now;
    else if (now - this.lastProgress > this.stallMs) {
      this.hi = this.low;
      this.lastProgress = now;
    }
    const out: number[] = [];
    while (this.hi < this.n && this.hi < this.low + this.window) out.push(this.hi++);
    return out;
  }

  get done(): boolean {
    return this.low >= this.n;
  }

  /** Fraction of the file the receiver holds. */
  get progress(): number {
    return this.n === 0 ? 1 : Math.min(1, this.got / this.n);
  }
}
