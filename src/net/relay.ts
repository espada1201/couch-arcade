// LAN transport: a WebSocket relay served by `npm start` on the host computer, so a
// room works on any Wi-Fi network with no internet at all.
import { stableId } from '../storage';
import { BasicLink, RoomTakenError, backoff, type HostEnd, type Link, type ServerState, type Transport } from './transport';

// The host's socket carries every phone. Up (host to relay): `msg` for one phone, `all` for the
// same message to many (one copy on the host's socket, fanned out by the relay), `close`. Down:
// `open`, `msg` and `close` per phone.
type Down = { t: 'open'; id: string } | { t: 'msg'; id: string; data: unknown } | { t: 'close'; id: string };

/** A phone as the host sees it through the relay. */
function relayPhone(id: string, sock: WebSocket): BasicLink {
  return new BasicLink(
    (data) => sock.send(`{"t":"msg","id":${JSON.stringify(id)},"data":${JSON.stringify(data)}}`),
    () => sock.send(JSON.stringify({ t: 'close', id })),
  );
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

/** What the relay would answer this socket: 204 it would be let in, else why not. null: the relay did not answer. */
async function probe(url: string): Promise<number | null> {
  try {
    return (await fetch(url.replace(/^ws/, 'http'), { cache: 'no-store' })).status;
  } catch {
    return null;
  }
}

/** Whether the relay would refuse this host because another host holds (or just held) the room. */
async function taken(url: string): Promise<boolean> {
  return (await probe(url)) === 409;
}

/**
 * Why a phone could not join, from what the relay says it would answer (`status`, null when it
 * does not answer). The browser hides the reason itself, so anything unknown is most likely a
 * phone on a different network.
 */
export function joinFailure(status: number | null, room: string): string {
  if (status === 404) return `Room ${room} is not open on this network. Check the room code, then try again.`;
  if (status === 429) return 'Too many phones are joining from this device. Close the other tabs and try again.';
  if (status === 503) return 'The relay is full, so no more phones can join right now. Try again in a minute.';
  return `Can’t reach the host. Check you’re on the same Wi-Fi as the host computer, then try again. Room code: ${room}.`;
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
    try {
      await opened(first, `Could not start room ${room} on the local relay.`);
    } catch (e) {
      if (await taken(url)) throw new RoomTakenError(`Room code ${room} is already in use on this relay. Start a new room.`);
      throw e;
    }
    /** Phone id -> its link, and back. */
    const phones = new Map<string, BasicLink>();
    const ids = new Map<Link, string>();
    let onLink: (l: Link) => void = () => {};
    let onServer: (state: ServerState) => void = () => {};
    let ws = first;
    let closed = false;
    let tries = 0;

    const drop = (link: BasicLink, id: string) => {
      phones.delete(id);
      ids.delete(link);
      link.ended();
    };
    const attach = (sock: WebSocket) => {
      ws = sock;
      tries = 0;
      sock.onerror = null;
      sock.onmessage = (e) => {
        const m = JSON.parse(e.data as string) as Down;
        const link = phones.get(m.id);
        if (m.t === 'open') {
          const phone = relayPhone(m.id, sock);
          phones.set(m.id, phone);
          ids.set(phone, m.id);
          onLink(phone);
        } else if (!link) return;
        else if (m.t === 'msg') link.deliver(m.data);
        else drop(link, m.id);
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
      const to = links.flatMap((l) => ids.get(l) ?? []);
      if (to.length) ws.send(`{"t":"all","ids":${JSON.stringify(to)},"data":${JSON.stringify(msg)}}`);
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
        // Someone took the room code while this page was away: say so instead of knocking forever.
        if (await taken(url)) return onServer('taken');
        return retry();
      }
      if (closed) return sock.close();
      attach(sock);
      onServer('up');
    };

    attach(first);
    return {
      heartbeat: true,
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
    const url = socketUrl(room, 'phone');
    const ws = new WebSocket(url);
    await opened(ws, 'unreachable').catch(async () => {
      throw new Error(joinFailure(await probe(url), room));
    });
    const link = new BasicLink((data) => ws.send(JSON.stringify(data)), () => ws.close());
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
