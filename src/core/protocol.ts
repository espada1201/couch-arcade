import type { Program } from './effects';
import type { Point } from './layout';
import type { Track } from './speaker';
import { MAX_OPTIONS } from './poll';
import type { ChunkMsg } from '../net/chunks';

export type PhoneMsg =
  | { t: 'hello'; token: string; sim?: Point }
  | { t: 'ping'; c0: number; u?: number }
  | { t: 'tap' }
  | { t: 'seat'; row: number; seat: number }
  | { t: 'vote'; choice: number }
  /** File transfer ack: every chunk below `next` is here, `got` in all; then whether it decoded. */
  | { t: 'have'; id: string; next: number; got: number; state?: HaveState };

export type HaveState = 'ready' | 'error';

export type HostMsg =
  | { t: 'welcome'; seat: number; room: string }
  | { t: 'full' }
  | { t: 'replaced' }
  | { t: 'pong'; c0: number; h1: number; h2: number }
  | { t: 'program'; program: Program }
  | { t: 'pos'; pos: Point | null; aspect: number }
  /** A song to fetch and get ready in the background, whatever the room is doing (null: none). */
  | { t: 'offer'; track: Track | null }
  | ChunkMsg;

function isObj(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null;
}

const num = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const count = (v: unknown): v is number => Number.isInteger(v) && (v as number) >= 0;

/** Phones are untrusted: the host only accepts well-formed messages. */
export function parsePhoneMsg(v: unknown): PhoneMsg | null {
  if (!isObj(v)) return null;
  switch (v.t) {
    case 'hello': {
      if (typeof v.token !== 'string' || v.token.length > 64) return null;
      const sim = isObj(v.sim) && num(v.sim.x) && num(v.sim.y) ? { x: v.sim.x, y: v.sim.y } : undefined;
      return { t: 'hello', token: v.token, sim };
    }
    case 'ping':
      return num(v.c0) ? { t: 'ping', c0: v.c0, u: num(v.u) ? v.u : undefined } : null;
    case 'tap':
      return { t: 'tap' };
    case 'seat':
      return num(v.row) && num(v.seat) ? { t: 'seat', row: v.row, seat: v.seat } : null;
    case 'vote':
      return Number.isInteger(v.choice) && (v.choice as number) >= 0 && (v.choice as number) < MAX_OPTIONS ? { t: 'vote', choice: v.choice as number } : null;
    case 'have': {
      if (typeof v.id !== 'string' || v.id.length > 32 || !count(v.next) || !count(v.got)) return null;
      const state = v.state === 'ready' || v.state === 'error' ? v.state : undefined;
      return { t: 'have', id: v.id, next: v.next, got: v.got, state };
    }
    default:
      return null;
  }
}

/** Light a phone tab reports emitting, so the synthetic camera can "film" tabs on one machine. */
export interface Optics {
  key: string;
  sim: Point;
  lum: number;
  /** Epoch ms, comparable across tabs. */
  at: number;
}

export const OPTICS_CHANNEL = 'swarm-optics';

/**
 * Largest message the host may send, and the one limit file chunks and picture frames
 * are cut from. PeerJS data channels and the relay's 64 KB maxPayload both need
 * headroom, so stay well under 64 KB.
 */
export const MAX_MESSAGE_BYTES = 60 * 1024;

/** Raw bytes that fit in one message as base64 (3 bytes to 4 chars), leaving `envelope` bytes for the rest. */
export function payloadBytes(envelope: number): number {
  return Math.floor((MAX_MESSAGE_BYTES - envelope) / 4) * 3;
}

/** Size of a message on the wire (UTF-8 JSON). */
export function messageBytes(m: unknown): number {
  return new TextEncoder().encode(JSON.stringify(m)).length;
}
