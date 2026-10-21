// Hot Potato: a glowing ball physically travels across the crowd from phone to phone.
// Whoever it lands on has a shrinking fuse to tap and throw it to a near neighbour;
// miss it and your phone burns out. Last phone standing wins.
import { distance, nearest, type Point, type Room } from './layout';

export interface PotatoState {
  phase: 'playing' | 'over';
  holder: number;
  prev: number | null;
  from: Point;
  to: Point;
  depart: number;
  arrive: number;
  deadline: number;
  fuse: number;
  out: number[];
  passes: number;
  winner: number | null;
}

export const FIRST_FUSE = 3000;
export const MIN_FUSE = 700;
const FUSE_DECAY = 0.93;
const NEIGHBOURS = 3;

export function flightTime(a: Point, b: Point, aspect: number): number {
  return Math.round(250 + 700 * Math.min(1.5, distance(a, b, aspect)));
}

function alive(s: { out: number[] }, room: Room): number[] {
  return [...room.positions.keys()].filter((seat) => !s.out.includes(seat));
}

function throwTo(s: PotatoState, room: Room, next: number, now: number, fuse: number): PotatoState {
  const from = room.positions.get(s.holder)!;
  const to = room.positions.get(next)!;
  const arrive = now + flightTime(from, to, room.aspect);
  return { ...s, prev: s.holder, holder: next, from, to, depart: now, arrive, deadline: arrive + fuse, fuse };
}

export function startPotato(room: Room, now: number, rand: () => number): PotatoState | null {
  const seats = [...room.positions.keys()];
  if (seats.length < 2) return null;
  const holder = seats[Math.floor(rand() * seats.length)];
  const at = room.positions.get(holder)!;
  return {
    phase: 'playing',
    holder,
    prev: null,
    from: at,
    to: at,
    depart: now,
    arrive: now,
    deadline: now + FIRST_FUSE,
    fuse: FIRST_FUSE,
    out: [],
    passes: 0,
    winner: null,
  };
}

export function potatoTap(s: PotatoState, room: Room, seat: number, now: number, rand: () => number): PotatoState {
  if (s.phase !== 'playing' || seat !== s.holder || now < s.arrive) return s;
  if (now > s.deadline) return potatoTick(s, room, now);
  const exclude = new Set(s.out);
  // Don't bounce straight back unless there is nobody else nearby.
  let options = nearest(seat, room, NEIGHBOURS, new Set([...exclude, ...(s.prev === null ? [] : [s.prev])]));
  if (options.length === 0) options = nearest(seat, room, NEIGHBOURS, exclude);
  if (options.length === 0) return s;
  const next = options[Math.floor(rand() * options.length)];
  return { ...throwTo(s, room, next, now, Math.max(MIN_FUSE, Math.round(s.fuse * FUSE_DECAY))), passes: s.passes + 1 };
}

export function potatoTick(s: PotatoState, room: Room, now: number): PotatoState {
  if (s.phase !== 'playing' || now <= s.deadline) return s;
  const burnt: PotatoState = { ...s, out: [...s.out, s.holder] };
  const left = alive(burnt, room);
  if (left.length <= 1) return { ...burnt, phase: 'over', winner: left[0] ?? null };
  const next = nearest(s.holder, room, 1, new Set(burnt.out))[0];
  return throwTo(burnt, room, next, now, Math.max(MIN_FUSE, s.fuse));
}

/** Where the ball is at time t (it sits on the holder once it lands). */
export function ballAt(s: Pick<PotatoState, 'from' | 'to' | 'depart' | 'arrive'>, t: number): Point {
  if (t >= s.arrive || s.arrive <= s.depart) return s.to;
  const k = Math.max(0, (t - s.depart) / (s.arrive - s.depart));
  const e = k * k * (3 - 2 * k);
  return { x: s.from.x + (s.to.x - s.from.x) * e, y: s.from.y + (s.to.y - s.from.y) * e };
}
