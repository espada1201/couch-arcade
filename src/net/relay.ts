// LAN transport: a WebSocket relay served by `npm start` on the host computer, so a
// room works on any Wi-Fi network with no internet at all.
import { stableId } from '../storage';
import { BasicLink, backoff, type HostEnd, type Link, type Transport } from './transport';

type Down = { t: 'open'; id: string } | { t: 'msg'; id: string; data: unknown } | { t: 'close'; id: string };

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
    const links = new Map<string, BasicLink>();
    let onLink: (l: Link) => void = () => {};
    let onServer: (up: boolean) => void = () => {};
    let ws = first;
    let closed = false;
    let tries = 0;

    const attach = (sock: WebSocket) => {
      ws = sock;
      tries = 0;
      sock.onerror = null;
      sock.onmessage = (e) => {
        const m = JSON.parse(e.data as string) as Down;
        if (m.t === 'open') {
          const link = new BasicLink(
            (data) => sock.send(JSON.stringify({ t: 'msg', id: m.id, data })),
            () => sock.send(JSON.stringify({ t: 'close', id: m.id })),
            // One socket carries every phone, so this is the whole room's backlog; the relay checks each phone's.
            () => sock.bufferedAmount,
          );
          links.set(m.id, link);
          onLink(link);
        } else if (m.t === 'msg') links.get(m.id)?.deliver(m.data);
        else {
          links.get(m.id)?.ended();
          links.delete(m.id);
        }
      };
      sock.onclose = (e) => {
        links.forEach((l) => l.ended());
        links.clear();
        // 'replaced': this page opened the room again in another tab, which now owns it.
        if (closed || e.reason === 'replaced') return;
        onServer(false);
        retry();
      };
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
      onServer(true);
    };

    attach(first);
    return {
      onLink: (cb) => (onLink = cb),
      onServer: (cb) => (onServer = cb),
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
