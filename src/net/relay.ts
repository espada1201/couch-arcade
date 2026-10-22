// LAN transport: a WebSocket relay served by `npm start` on the host computer, so a
// room works on any Wi-Fi network with no internet at all.
import { stableId } from '../storage';
import { BasicLink, backoff, type HostEnd, type Link, type ServerState, type Transport } from './transport';

// The host's socket carries every phone. Up (host to relay): `msg` for one phone, `all` for the
// same message to many (one copy on the host's socket, fanned out by the relay), `close`. Down:
// `open`, `msg` and `close` per phone, and `drain`: the relay has written the first `n` messages
// it got for that phone onto the phone's socket, so the host knows each phone's own backlog.
type Down = { t: 'open'; id: string } | { t: 'msg'; id: string; data: unknown } | { t: 'close'; id: string } | { t: 'drain'; id: string; n: number };

/** A phone as the host sees it through the relay: sizes of the messages the relay hasn't written yet. */
class RelayPhone {
  readonly link: BasicLink;
  private sizes: number[] = [];
  private confirmed = 0;
  private backlog = 0;

  constructor(
    readonly id: string,
    sock: WebSocket,
  ) {
    this.link = new BasicLink(
      (data) => {
        const json = JSON.stringify(data);
        this.queued(json.length);
        sock.send(`{"t":"msg","id":${JSON.stringify(id)},"data":${json}}`);
      },
      () => sock.send(JSON.stringify({ t: 'close', id })),
      () => this.backlog,
    );
  }

  /** A message of `size` chars is on its way to this phone. */
  queued(size: number): void {
    this.sizes.push(size);
    this.backlog += size;
  }

  /** The relay has written `n` messages in all to the phone. */
  drain(n: number): void {
    for (; this.confirmed < n && this.sizes.length; this.confirmed++) this.backlog -= this.sizes.shift()!;
  }
}

function socketUrl(room: string, role: 'host' | 'phone', key?: string): string {
  const u = new URL('relay', location.href);
  u.protocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
  const q = new URLSearchParams({ room, role });
  if (key) q.set('key', key);
  u.search = q.toString();
  return u.href;
}

/** The browser hides the relay's HTTP status, so any failure before open gets the caller's message. */
function opened(ws: WebSocket, failure: string): Promise<void> {
  return new Promise((resolve, reject) => {
    ws.onopen = () => resolve();
    ws.onerror = ws.onclose = () => reject(new Error(failure));
  });
}

/** Proves to the relay that a reloaded host page owns its room, so nobody else can take it over. */
function hostKey(room: string): string {
  return stableId(`swarm-relay-key-${room}`, 24);
}

export class RelayTransport implements Transport {
  readonly name = 'lan';

  async host(room: string): Promise<HostEnd> {
    const url = socketUrl(room, 'host', hostKey(room));
    const first = new WebSocket(url);
    await opened(first, `Could not start room ${room} on the local relay. It may be running on another device.`);
    const phones = new Map<string, RelayPhone>();
    const byLink = new Map<Link, RelayPhone>();
    let onLink: (l: Link) => void = () => {};
    let onServer: (state: ServerState) => void = () => {};
    let ws = first;
    let closed = false;
    let tries = 0;

    const drop = (p: RelayPhone) => {
      phones.delete(p.id);
      byLink.delete(p.link);
      p.link.ended();
    };
    const attach = (sock: WebSocket) => {
      ws = sock;
      tries = 0;
      sock.onerror = null;
      sock.onmessage = (e) => {
        const m = JSON.parse(e.data as string) as Down;
        const p = phones.get(m.id);
        if (m.t === 'open') {
          const phone = new RelayPhone(m.id, sock);
          phones.set(m.id, phone);
          byLink.set(phone.link, phone);
          onLink(phone.link);
        } else if (!p) return;
        else if (m.t === 'msg') p.link.deliver(m.data);
        else if (m.t === 'drain') p.drain(m.n);
        else drop(p);
      };
      sock.onclose = (e) => {
        phones.forEach(drop);
        if (closed) return;
        if (e.reason === 'replaced') return onServer('moved');
        onServer('down');
        retry();
      };
    };
    const broadcast = (links: Link[], msg: unknown) => {
      const to = links.flatMap((l) => byLink.get(l) ?? []);
      if (!to.length) return;
      const json = JSON.stringify(msg);
      for (const p of to) p.queued(json.length);
      ws.send(`{"t":"all","ids":${JSON.stringify(to.map((p) => p.id))},"data":${json}}`);
    };
    // The relay restarted (or the Wi-Fi dropped): reclaim the same room with the same key.
    // Phones keep retrying on their side and get their seats back by token.
    const retry = () => setTimeout(reopen, backoff(++tries));
    const reopen = async () => {
      if (closed) return;
      const sock = new WebSocket(url);
      try {
        await opened(sock, 'relay unreachable');
      } catch {
        return retry();
      }
      if (closed) return sock.close();
      attach(sock);
      onServer('up');
    };

    attach(first);
    return {
      onLink: (cb) => (onLink = cb),
      onServer: (cb) => (onServer = cb),
      broadcast,
      close: () => {
        closed = true;
        ws.close();
      },
    };
  }

  async join(room: string): Promise<Link> {
    const ws = new WebSocket(socketUrl(room, 'phone'));
    await opened(ws, `No host is running room ${room} on this network.`);
    const link = new BasicLink((data) => ws.send(JSON.stringify(data)), () => ws.close(), () => ws.bufferedAmount);
    ws.onerror = null;
    ws.onmessage = (e) => link.deliver(JSON.parse(e.data as string));
    ws.onclose = () => link.ended();
    return link;
  }
}

export interface RelayInfo {
  /** URL phones on the same network should open (uses the computer's LAN address). */
  lanUrl: string;
}

/** Present only when the page is served by the bundled `npm start` server. */
export async function relayInfo(): Promise<RelayInfo | null> {
  try {
    const res = await fetch('relay.json', { cache: 'no-store' });
    if (!res.ok) return null;
    const info = (await res.json()) as RelayInfo;
    return typeof info.lanUrl === 'string' ? info : null;
  } catch {
    return null;
  }
}
