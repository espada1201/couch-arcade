// Internet transport: WebRTC data channels brokered by the free public PeerJS server.
// Only signalling goes through the broker; everything after that is phone <-> host.
import type { DataConnection, Peer as PeerType } from 'peerjs';
import { BasicLink, type HostEnd, type Link, type Transport } from './transport';

const PREFIX = 'swarmscreen-v1-';

async function makePeer(id?: string): Promise<PeerType> {
  const { Peer } = await import('peerjs');
  const peer = id ? new Peer(id) : new Peer();
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('Could not reach the PeerJS broker')), 12000);
    peer.on('open', () => {
      clearTimeout(timer);
      resolve(peer);
    });
    peer.on('error', (err) => {
      clearTimeout(timer);
      reject(err);
    });
  });
}

function wrap(conn: DataConnection): BasicLink {
  const link = new BasicLink((m) => conn.send(m), () => conn.close());
  conn.on('data', (d) => link.deliver(d));
  conn.on('close', () => link.ended());
  conn.on('error', () => link.ended());
  return link;
}

export class PeerTransport implements Transport {
  readonly name = 'internet';

  async host(room: string): Promise<HostEnd> {
    const peer = await makePeer(PREFIX + room);
    let onLink: (l: Link) => void = () => {};
    peer.on('connection', (conn) => conn.on('open', () => onLink(wrap(conn))));
    // The broker connection can drop while the data channels stay up; keep it alive for late joiners.
    peer.on('disconnected', () => setTimeout(() => !peer.destroyed && peer.reconnect(), 1000));
    return { onLink: (cb) => (onLink = cb), close: () => peer.destroy() };
  }

  async join(room: string): Promise<Link> {
    const peer = await makePeer();
    const conn = peer.connect(PREFIX + room, { reliable: true, serialization: 'json' });
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('The host did not answer. Check the room code.')), 15000);
      conn.on('open', () => {
        clearTimeout(timer);
        const link = wrap(conn);
        link.onClose(() => peer.destroy());
        resolve(link);
      });
      peer.on('error', (err) => {
        clearTimeout(timer);
        reject(err);
      });
    });
  }
}
