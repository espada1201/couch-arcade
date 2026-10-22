// Same-machine transport over BroadcastChannel: every tab of this origin is in the
// room. Used by the end-to-end tests and for trying the app with several tabs.
import { BasicLink, randomId, sendEach, type HostEnd, type Link, type Transport } from './transport';

type Wire =
  | { t: 'open'; id: string }
  | { t: 'accept'; id: string }
  | { t: 'msg'; id: string; dir: 'up' | 'down'; data: unknown }
  | { t: 'close'; id: string; dir: 'up' | 'down' };

export class LocalTransport implements Transport {
  readonly name = 'local';

  async host(room: string): Promise<HostEnd> {
    const ch = new BroadcastChannel(`swarm-${room}`);
    const links = new Map<string, BasicLink>();
    let onLink: (l: Link) => void = () => {};
    ch.onmessage = (e: MessageEvent<Wire>) => {
      const w = e.data;
      if (w.t === 'open') {
        links.get(w.id)?.ended();
        const link = new BasicLink(
          (data) => ch.postMessage({ t: 'msg', id: w.id, dir: 'down', data } satisfies Wire),
          () => ch.postMessage({ t: 'close', id: w.id, dir: 'down' } satisfies Wire),
        );
        links.set(w.id, link);
        ch.postMessage({ t: 'accept', id: w.id } satisfies Wire);
        onLink(link);
      } else if (w.t === 'msg' && w.dir === 'up') links.get(w.id)?.deliver(w.data);
      else if (w.t === 'close' && w.dir === 'up') {
        links.get(w.id)?.ended();
        links.delete(w.id);
      }
    };
    return {
      heartbeat: false,
      onLink: (cb) => (onLink = cb),
      // Same-browser channel: there is no server to lose.
      onServer: () => {},
      broadcast: sendEach,
      close: () => {
        for (const l of links.values()) l.close();
        ch.close();
      },
    };
  }

  join(room: string): Promise<Link> {
    const ch = new BroadcastChannel(`swarm-${room}`);
    const id = randomId();
    const link = new BasicLink(
      (data) => ch.postMessage({ t: 'msg', id, dir: 'up', data } satisfies Wire),
      () => {
        ch.postMessage({ t: 'close', id, dir: 'up' } satisfies Wire);
        ch.close();
      },
    );
    const hide = () => link.close();
    addEventListener('pagehide', hide);
    link.onClose(() => removeEventListener('pagehide', hide));
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        removeEventListener('pagehide', hide);
        ch.close();
        reject(new Error('No host answered in this room'));
      }, 4000);
      ch.onmessage = (e: MessageEvent<Wire>) => {
        const w = e.data;
        if (w.id !== id) return;
        if (w.t === 'accept') {
          clearTimeout(timer);
          resolve(link);
        } else if (w.t === 'msg' && w.dir === 'down') link.deliver(w.data);
        else if (w.t === 'close' && w.dir === 'down') link.ended();
      };
      ch.postMessage({ t: 'open', id } satisfies Wire);
    });
  }
}
