// The only seam between Swarm Screen and the network. Star topology: one host,
// many phones, each phone holding a single ordered link to the host.

export interface Link {
  send(msg: unknown): void;
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
  /**
   * The room server pings every link and closes dead ones itself (the relay), so the host must not
   * time out a phone that merely went quiet: a locked phone runs no script but its socket answers.
   */
  readonly heartbeat: boolean;
  onLink(cb: (link: Link) => void): void;
  onServer(cb: (state: ServerState) => void): void;
  /** One message to many of this end's links; a transport that can fans it out on the server. */
  broadcast(links: Link[], msg: unknown): void;
  close(): void;
}

/** `broadcast` for transports with nothing better than a send per link. */
export function sendEach(links: Link[], msg: unknown): void {
  for (const l of links) l.send(msg);
}

/**
 * Wait before reconnect attempt `n` (from 1): doubling from 800 ms, capped at 5 s, then spread by
 * ±25% so a room of phones that lost the relay together don't all knock at the same instant.
 */
export function backoff(n: number, random = Math.random()): number {
  return Math.min(5000, 400 * 2 ** n) * (0.75 + 0.5 * random);
}

/** The room code is already held by another host, so the UI should pick a new one. */
export class RoomTakenError extends Error {
  readonly code = 'room-taken';
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
  ) {}

  send(msg: unknown): void {
    if (!this.closed) this.sender(msg);
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
