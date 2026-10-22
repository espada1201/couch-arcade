import type { Program } from './effects';
import type { Point } from './layout';
import { MAX_OPTIONS } from './poll';

export type PhoneMsg =
  | { t: 'hello'; token: string; sim?: Point }
  | { t: 'ping'; c0: number; u?: number }
  | { t: 'tap' }
  | { t: 'seat'; row: number; seat: number }
  | { t: 'vote'; choice: number };

export type HostMsg =
  | { t: 'welcome'; seat: number; room: string }
  | { t: 'full' }
  | { t: 'replaced' }
  | { t: 'pong'; c0: number; h1: number; h2: number }
  | { t: 'program'; program: Program }
  | { t: 'pos'; pos: Point | null; aspect: number };

function isObj(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null;
}

const num = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);

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
