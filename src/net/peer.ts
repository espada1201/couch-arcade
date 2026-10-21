// Internet transport: WebRTC data channels brokered by the free public PeerJS server.
// Only signalling goes through the broker; everything after that is phone <-> host.
import type { DataConnection, Peer as PeerType } from 'peerjs';
import { BasicLink, type HostEnd, type Link, type Transport } from './transport';

const PREFIX = 'swarmscreen-v1-';

/** The room code is already registered with the broker, so the UI should pick a new one. */
export class RoomTakenError extends Error {
  readonly type = 'unavailable-id';
  readonly code = 'room-taken';
}

async function makePeer(id?: string): Promise<PeerType> {
  const { Peer } = await import('peerjs');
  const peer = id ? new Peer(id) : new Peer();
  return new Promise((resolve, reject) => {
    let settled = false;
    const fail = (err: Error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      peer.destroy();
      reject(err);
    };
    const timer = setTimeout(() => fail(new Error('Could not reach the PeerJS broker')), 12000);
    peer.on('open', () => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(peer);
    });
    peer.on('error', fail);
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
    const peer = await makePeer(PREFIX + room).catch((err: unknown) => {
      if ((err as { type?: unknown }).type === 'unavailable-id')
        throw new RoomTakenError(`Room code ${room} is already in use. Start a new room.`);
      throw err;
    });
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
      let settled = false;
      const fail = (err: Error) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        peer.destroy();
        reject(err);
      };
      const timer = setTimeout(() => fail(new Error('The host did not answer. Check the room code.')), 15000);
      conn.on('open', () => {
        if (settled) return conn.close();
        settled = true;
        clearTimeout(timer);
        const link = wrap(conn);
        link.onClose(() => peer.destroy());
        resolve(link);
      });
      peer.on('error', fail);
    });
  }
}
