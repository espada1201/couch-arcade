// What each phone shows (and plays) is a pure function of the current program, the
// phone's own position, and the shared clock. The host sends one small message per
// change; every phone renders the whole room's choreography locally, in step.
import { litAt, type BlinkSchedule } from './blinkcode';
import { distance, type Point, type RGB } from './layout';
import { ballAt, type PotatoState } from './potato';
import type { SpeakerProgram } from './speaker';
import { teamOf, type TerritoryState } from './territory';

export type WaveShape = 'sweep' | 'pingpong' | 'ripple';
export type Voice = 'off' | 'pluck' | 'bell' | 'drum';

export interface WaveProgram {
  kind: 'wave';
  t0: number;
  period: number;
  shape: WaveShape;
  /** Sweep direction in degrees (0 = left to right). */
  angle: number;
  origin: Point;
  /** Width of the bright band, as a fraction of the room. */
  width: number;
  rgb: RGB;
  voice: Voice;
}

export type Program =
  | { kind: 'lobby' }
  | { kind: 'identify' }
  | { kind: 'blink'; schedule: BlinkSchedule }
  | { kind: 'grid'; rows: number; seats: number }
  | { kind: 'card'; rgb: RGB; at: number }
  | { kind: 'live'; rgb: RGB; prev: RGB; at: number }
  | WaveProgram
  | { kind: 'territory'; state: TerritoryState; colors: [RGB, RGB] }
  | { kind: 'potato'; state: PotatoState }
  | SpeakerProgram;

export interface Me {
  seat: number;
  pos: Point | null;
  aspect: number;
}

export interface Frame {
  rgb: RGB;
  /** Short caption drawn over the colour (seat number, "TAP!", countdown). */
  label?: string;
  /** Whether a tap does something right now. */
  tappable?: boolean;
}

export const BLACK: RGB = [0, 0, 0];
/** The resting glow of an idle phone: not quite off, so the crowd can see it is in. */
export const DIM: RGB = [14, 13, 11];
export const WHITE: RGB = [255, 255, 255];
export const AMBER: RGB = [255, 176, 0];
export const TEAL: RGB = [0, 196, 180];
export const EMBER: RGB = [120, 18, 8];

/** Everything about a wave except when it starts. */
export type WaveParams = Omit<WaveProgram, 'kind' | 't0'>;

export const WAVE_DEFAULTS: WaveParams = { period: 2400, shape: 'sweep', angle: 0, origin: { x: 0.5, y: 0.5 }, width: 0.12, rgb: AMBER, voice: 'off' };

export function makeWave(t0: number, w: Partial<WaveParams> = {}): WaveProgram {
  return { kind: 'wave', t0, ...WAVE_DEFAULTS, ...w };
}

const CORNERS: Point[] = [
  { x: 0, y: 0 },
  { x: 1, y: 0 },
  { x: 0, y: 1 },
  { x: 1, y: 1 },
];

export function scale(c: RGB, k: number): RGB {
  return [Math.round(c[0] * k), Math.round(c[1] * k), Math.round(c[2] * k)];
}

/** Perceived brightness, 0..255. */
export function luma(c: RGB): number {
  return c[0] * 0.3 + c[1] * 0.59 + c[2] * 0.11;
}

/** CSS colour with every channel lifted to at least `min`, so dark phones stay visible on a map. */
export function cssFloor(c: RGB, min: number): string {
  return `rgb(${Math.max(c[0], min)}, ${Math.max(c[1], min)}, ${Math.max(c[2], min)})`;
}

export function mix(a: RGB, b: RGB, k: number): RGB {
  return [0, 1, 2].map((i) => Math.round(a[i] + (b[i] - a[i]) * k)) as RGB;
}

/** How far along the wave's path (0..1) a phone sits. */
export function travel(w: WaveProgram, p: Point, aspect: number): number {
  if (w.shape === 'ripple') {
    const max = Math.max(...CORNERS.map((c) => distance(c, w.origin, aspect)));
    return max < 1e-9 ? 0 : distance(p, w.origin, aspect) / max;
  }
  const a = (w.angle * Math.PI) / 180;
  const proj = (q: Point) => q.x * aspect * Math.cos(a) + q.y * Math.sin(a);
  const ps = CORNERS.map(proj);
  const lo = Math.min(...ps);
  const hi = Math.max(...ps);
  return hi - lo < 1e-9 ? 0 : (proj(p) - lo) / (hi - lo);
}

/** Where the wave front is at time t along 0..1 (it starts and ends just off the edges). */
export function frontAt(w: WaveProgram, t: number): number | null {
  if (t < w.t0) return null;
  const c = (t - w.t0) / w.period;
  let f = c - Math.floor(c);
  if (w.shape === 'pingpong' && Math.floor(c) % 2 === 1) f = 1 - f;
  return -w.width + f * (1 + 2 * w.width);
}

export function waveLevel(w: WaveProgram, u: number, t: number): number {
  const f = frontAt(w, t);
  if (f === null) return 0;
  const d = (u - f) / w.width;
  return Math.exp(-4 * d * d);
}

/** Host times in [from, to) at which the front crosses a phone sitting at u. */
export function arrivals(w: WaveProgram, u: number, from: number, to: number): number[] {
  const fStar = (u + w.width) / (1 + 2 * w.width);
  const out: number[] = [];
  const k0 = Math.max(0, Math.floor((from - w.t0) / w.period) - 1);
  for (let k = k0; ; k++) {
    const start = w.t0 + k * w.period;
    if (start >= to) break;
    const f = w.shape === 'pingpong' && k % 2 === 1 ? 1 - fStar : fStar;
    const t = start + f * w.period;
    if (t >= from && t < to) out.push(t);
  }
  return out;
}

const PENTATONIC = [0, 2, 4, 7, 9];

/** MIDI note a phone sings: rises left to right, and front rows sit an octave above the back. */
export function noteFor(p: Point): number {
  const degree = Math.round(p.x * 7) + Math.round((1 - p.y) * 5);
  return 50 + 12 * Math.floor(degree / 5) + PENTATONIC[degree % 5];
}

export function render(prog: Program, me: Me, t: number): Frame {
  switch (prog.kind) {
    case 'lobby':
      return { rgb: DIM, label: String(me.seat + 1) };
    case 'identify':
      return { rgb: AMBER, label: String(me.seat + 1) };
    case 'blink':
      return { rgb: litAt(me.seat, prog.schedule, t) ? WHITE : BLACK };
    case 'grid':
      return { rgb: DIM };
    case 'card': {
      if (t >= prog.at) return { rgb: prog.rgb };
      const left = Math.ceil((prog.at - t) / 1000);
      return { rgb: DIM, label: left <= 3 ? String(left) : undefined };
    }
    case 'live':
      // Every phone swaps to the new frame at the same synced instant: no tearing across the crowd.
      return { rgb: t >= prog.at ? prog.rgb : prog.prev };
    case 'wave': {
      if (!me.pos) return { rgb: BLACK };
      const level = waveLevel(prog, travel(prog, me.pos, me.aspect), t);
      return { rgb: scale(prog.rgb, 0.04 + 0.96 * level) };
    }
    case 'territory': {
      const s = prog.state;
      if (!me.pos) return { rgb: DIM };
      const team = teamOf(s, me.pos.x);
      const base = prog.colors[team];
      if (s.phase === 'over') {
        const won = s.winner === team;
        return { rgb: won ? scale(base, 0.6 + 0.4 * Math.abs(Math.sin(t / 150))) : scale(base, 0.12), label: won ? 'WIN' : s.winner === null ? 'DRAW' : '' };
      }
      // Phones close to the front line flicker: they are about to change sides.
      const edge = Math.abs(me.pos.x - s.boundary);
      const shimmer = edge < 0.12 ? 0.75 + 0.25 * Math.sin(t / 40) : 1;
      return { rgb: scale(base, shimmer), label: 'TAP', tappable: true };
    }
    case 'speaker':
      // The phone's now-playing card sits on top; the screen just stays dark.
      return { rgb: DIM };
    case 'potato': {
      const s = prog.state;
      if (s.out.includes(me.seat)) return { rgb: EMBER, label: s.phase === 'over' ? '' : 'OUT' };
      if (s.phase === 'over') {
        const won = s.winner === me.seat;
        return { rgb: won ? scale(AMBER, 0.6 + 0.4 * Math.abs(Math.sin(t / 120))) : [20, 18, 14], label: won ? 'WIN' : '' };
      }
      if (!me.pos) return { rgb: BLACK };
      const ball = ballAt(s, t);
      const d = distance(me.pos, ball, me.aspect);
      const glow = Math.exp(-(d * d) / (2 * 0.06 * 0.06));
      const base: RGB = [18, 16, 12];
      if (me.seat === s.holder && t >= s.arrive) {
        // Pulse faster as the fuse burns down.
        const left = Math.max(0, s.deadline - t);
        const rate = 60 + (left / s.fuse) * 220;
        const pulse = 0.7 + 0.3 * Math.sin(t / rate);
        return { rgb: scale([255, 96, 16], pulse), label: 'TAP!', tappable: true };
      }
      return { rgb: mix(base, [255, 120, 20], glow) };
    }
  }
}
