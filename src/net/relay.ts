// LAN transport: a WebSocket relay served by `npm start` on the host computer, so a
// room works on any Wi-Fi network with no internet at all.
import { BasicLink, type HostEnd, type Link, type Transport } from './transport';

type Down = { t: 'open'; id: string } | { t: 'msg'; id: string; data: unknown } | { t: 'close'; id: string };

function socketUrl(room: string, role: 'host' | 'phone'): string {
  const u = new URL('relay', location.href);
  u.protocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
  u.search = `room=${encodeURIComponent(room)}&role=${role}`;
  return u.href;
}

function opened(ws: WebSocket): Promise<void> {
  return new Promise((resolve, reject) => {
    ws.onopen = () => resolve();
    ws.onerror = () => reject(new Error('Could not reach the local relay'));
  });
}

export class RelayTransport implements Transport {
  readonly name = 'lan';

  async host(room: string): Promise<HostEnd> {
    const ws = new WebSocket(socketUrl(room, 'host'));
    await opened(ws);
    const links = new Map<string, BasicLink>();
    let onLink: (l: Link) => void = () => {};
    ws.onmessage = (e) => {
      const m = JSON.parse(e.data as string) as Down;
      if (m.t === 'open') {
        const link = new BasicLink(
          (data) => ws.send(JSON.stringify({ t: 'msg', id: m.id, data })),
          () => ws.send(JSON.stringify({ t: 'close', id: m.id })),
        );
        links.set(m.id, link);
        onLink(link);
      } else if (m.t === 'msg') links.get(m.id)?.deliver(m.data);
      else {
        links.get(m.id)?.ended();
        links.delete(m.id);
      }
    };
    ws.onclose = () => links.forEach((l) => l.ended());
    return { onLink: (cb) => (onLink = cb), close: () => ws.close() };
  }

  async join(room: string): Promise<Link> {
    const ws = new WebSocket(socketUrl(room, 'phone'));
    await opened(ws);
    const link = new BasicLink((data) => ws.send(JSON.stringify(data)), () => ws.close());
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
