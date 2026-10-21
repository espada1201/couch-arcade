// The only seam between Swarm Screen and the network. Star topology: one host,
// many phones, each phone holding a single ordered link to the host.

export interface Link {
  send(msg: unknown): void;
  onMessage(cb: (msg: unknown) => void): void;
  onClose(cb: () => void): void;
  close(): void;
}

export interface HostEnd {
  onLink(cb: (link: Link) => void): void;
  close(): void;
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

export function randomId(len = 10): string {
  const abc = 'abcdefghijkmnpqrstuvwxyz23456789';
  const bytes = crypto.getRandomValues(new Uint8Array(len));
  return Array.from(bytes, (b) => abc[b % abc.length]).join('');
}
