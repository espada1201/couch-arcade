// The only seam between Swarm Screen and the network. Star topology: one host,
// many phones, each phone holding a single ordered link to the host.

export interface Link {
  send(msg: unknown): void;
  /** Bytes queued on this link and not yet sent (0 where the transport can't tell). */
  buffered(): number;
  onMessage(cb: (msg: unknown) => void): void;
  onClose(cb: () => void): void;
  close(): void;
}

export interface HostEnd {
  onLink(cb: (link: Link) => void): void;
  /** The room server (relay or broker) went away (false) or took the room back (true). */
  onServer(cb: (up: boolean) => void): void;
  close(): void;
}

/** Wait before reconnect attempt `n` (from 1): doubling from 800 ms, capped at 5 s. */
export function backoff(n: number): number {
  return Math.min(5000, 400 * 2 ** n);
}

export interface Transport {
  readonly name: string;
  host(room: string): Promise<HostEnd>;
  join(room: string): Promise<Link>;
}

/** A Link whose plumbing is supplied by the concrete transport. */
export class BasicLink implements Link {
  private msgCbs: ((m: unknown) => void)[] = [];
  private closeCbs: (() => void)[] = [];
  private closed = false;

  constructor(
    private readonly sender: (m: unknown) => void,
    private readonly closer: () => void = () => {},
    private readonly backlog: () => number = () => 0,
  ) {}

  send(msg: unknown): void {
    if (!this.closed) this.sender(msg);
  }
  buffered(): number {
    return this.closed ? 0 : this.backlog();
  }
  onMessage(cb: (m: unknown) => void): void {
    this.msgCbs.push(cb);
  }
  onClose(cb: () => void): void {
    this.closeCbs.push(cb);
  }
  deliver(msg: unknown): void {
    if (!this.closed) for (const cb of this.msgCbs) cb(msg);
  }
  /** Mark closed (remote side went away) and notify listeners once. */
  ended(): void {
    if (this.closed) return;
    this.closed = true;
    for (const cb of this.closeCbs) cb();
  }
  close(): void {
    if (this.closed) return;
    this.closer();
    this.ended();
  }
}

/** Random string from `abc`; the default alphabet drops look-alikes (l, o, 0, 1). */
export function randomId(len = 10, abc = 'abcdefghijkmnpqrstuvwxyz23456789'): string {
  const bytes = crypto.getRandomValues(new Uint8Array(len));
  return Array.from(bytes, (b) => abc[b % abc.length]).join('');
}
