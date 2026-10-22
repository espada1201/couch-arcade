// Internet transport: WebRTC data channels brokered by the free public PeerJS server.
// Only signalling goes through the broker; everything after that is phone <-> host.
import type { DataConnection, Peer as PeerType } from 'peerjs';
import { PHONE_LIMIT, PHONE_MESSAGE_BYTES, tokenBucket } from './limits.js';
import { BasicLink, RoomTakenError, backoff, sendEach, type HostEnd, type Link, type ServerState, type Transport } from './transport';

const PREFIX = 'swarmscreen-v1-';

/**
 * Settles once: `run` calls ok or fail, and after `ms` it fails with `timeout`. `onFail` cleans up
 * after any failure; `done` tells a late success that it lost the race.
 */
export function settleWithin<T>(ms: number, timeout: string, onFail: () => void, run: (ok: (v: T) => void, fail: (err: Error) => void, done: () => boolean) => void): Promise<T> {
  return new Promise((resolve, reject) => {
    let settled = false;
    const settle = () => {
      if (settled) return false;
      settled = true;
      clearTimeout(timer);
      return true;
    };
    const fail = (err: Error) => {
      if (!settle()) return;
      onFail();
      reject(err);
    };
    const timer = setTimeout(() => fail(new Error(timeout)), ms);
    run((v) => settle() && resolve(v), fail, () => settled);
  });
}

async function makePeer(id?: string): Promise<PeerType> {
  const { Peer } = await import('peerjs');
  const peer = id ? new Peer(id) : new Peer();
  return settleWithin(12000, 'Could not reach the PeerJS broker', () => peer.destroy(), (ok, fail) => {
    peer.on('open', () => ok(peer));
    peer.on('error', fail);
  });
}

const CHUNK_MARK = '__peerData';
const text = new TextDecoder();

/** Bytes (a buffer) or characters (a string) in one piece off the data channel. */
const pieceSize = (d: ArrayBuffer | string): number => (typeof d === 'string' ? d.length : d.byteLength);

/** Whether a piece is one of PeerJS's own: a slice of a bigger message, or its close notice. */
const isPeerPiece = (d: ArrayBuffer | string): boolean => (typeof d === 'string' ? d : text.decode(d)).includes(CHUNK_MARK);

/**
 * A data connection as a Link. `limit`: the largest piece the other end may send, and while it is
 * set the other end is an untrusted phone. PeerJS holds the pieces of a chunked message and says
 * nothing until the last one comes, so none of it reaches the host's own size and rate checks, and
 * a phone could fill the host's memory with pieces that promise more. An honest phone's messages
 * fit one piece, so the host counts every piece against the phone's rate and ends the link at the
 * first oversized one, or one that is part of a chunked message.
 */
export function wrap(conn: DataConnection, limit = Infinity): BasicLink {
  const link = new BasicLink((m) => conn.send(m), () => conn.close());
  if (limit < Infinity) {
    const wall = tokenBucket(PHONE_LIMIT, performance.now());
    conn.dataChannel.addEventListener('message', (e: MessageEvent<ArrayBuffer | string>) => {
      if (!wall.take(performance.now()) || pieceSize(e.data) > limit || isPeerPiece(e.data)) link.close();
    });
  }
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
    let onServer: (state: ServerState) => void = () => {};
    let tries = 0;
    peer.on('connection', (conn) => conn.on('open', () => onLink(wrap(conn, PHONE_MESSAGE_BYTES))));
    // The broker connection can drop while the data channels stay up; keep it alive for late joiners.
    // A failed reconnect disconnects again, so this keeps trying with backoff until the broker answers.
    peer.on('disconnected', () => {
      if (peer.destroyed) return;
      onServer('down');
      setTimeout(() => !peer.destroyed && peer.disconnected && peer.reconnect(), backoff(++tries));
    });
    peer.on('error', (err) => {
      if ((err as { type?: unknown }).type === 'unavailable-id') onServer('taken');
    });
    peer.on('open', () => {
      if (tries) onServer('up');
      tries = 0;
    });
    return { heartbeat: false, onLink: (cb) => (onLink = cb), onServer: (cb) => (onServer = cb), broadcast: sendEach, close: () => peer.destroy() };
  }

  async join(room: string): Promise<Link> {
    const peer = await makePeer();
    // Binary: PeerJS cuts messages into 16 KB pieces, so 60 KB song chunks and frames get through.
    // JSON would refuse anything at or over 16300 bytes and close the link.
    const conn = peer.connect(PREFIX + room, { reliable: true, serialization: 'binary' });
    return settleWithin<Link>(15000, 'Can’t reach the host. Check the room code and your internet connection, then try again.', () => peer.destroy(), (ok, fail, done) => {
      conn.on('open', () => {
        if (done()) return conn.close();
        const link = wrap(conn);
        link.onClose(() => peer.destroy());
        ok(link);
      });
      peer.on('error', fail);
    });
  }
}
