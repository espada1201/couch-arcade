// The only seam between Swarm Screen and the network. Star topology: one host,
// many phones, each phone holding a single ordered link to the host.

export interface SendOptions {
  /**
   * This message replaces the previous `latest` one (a picture frame). A link that is backed up
   * holds only the newest and sends it once it drains, so a slow phone skips frames but never goes stale.
   */
  latest?: boolean;
}

export interface Link {
  send(msg: unknown, opts?: SendOptions): void;
  /** Bytes queued for this one phone and not yet sent (0 where the transport can't tell). */
  buffered(): number;
  onMessage(cb: (msg: unknown) => void): void;
  onClose(cb: () => void): void;
  close(): void;
}

/**
 * The room server (relay or broker) as the host sees it. 'down': gone, and the host keeps trying
 * to take the room back. 'moved': this page opened the room in another tab, which now owns it.
 * 'taken': while the host was away another host took the room code. 'moved' and 'taken' are final.
 */
export type ServerState = 'up' | 'down' | 'moved' | 'taken';

export interface HostEnd {
  onLink(cb: (link: Link) => void): void;
  onServer(cb: (state: ServerState) => void): void;
  /** One message to many of this end's links; a transport that can fans it out on the server. */
  broadcast(links: Link[], msg: unknown, opts?: SendOptions): void;
  close(): void;
}

/** Backlog past which a `latest` message waits: about two picture frames. */
export const LATEST_BACKLOG = 120 * 1024;

/** `broadcast` for transports with nothing better than a send per link. */
export function sendEach(links: Link[], msg: unknown, opts?: SendOptions): void {
  for (const l of links) l.send(msg, opts);
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
  private parked: { msg: unknown } | null = null;

  constructor(
    private readonly sender: (m: unknown) => void,
    private readonly closer: () => void = () => {},
    private readonly backlog: () => number = () => 0,
  ) {}

  send(msg: unknown, opts?: SendOptions): void {
    if (this.take(msg, opts?.latest)) this.sender(msg);
  }

  /**
   * Whether `msg` goes out now. A `latest` message on a backed-up link is parked instead, replacing
   * any parked one; a newer `latest` that does go out drops it, and anything else sends it first.
   */
  take(msg: unknown, latest = false): boolean {
    if (this.closed) return false;
    if (latest) {
      const room = this.backlog() <= LATEST_BACKLOG;
      this.parked = room ? null : { msg };
      return room;
    }
    this.release();
    return true;
  }

  /** The transport saw this link's backlog fall: a parked message goes out if there is room now. */
  drained(): void {
    if (this.parked && !this.closed && this.backlog() <= LATEST_BACKLOG) this.release();
  }

  private release(): void {
    const p = this.parked;
    this.parked = null;
    if (p) this.sender(p.msg);
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
    this.parked = null;
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
