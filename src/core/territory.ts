// Territory: the room is split by a vertical front line. Every tap pushes the line
// into the other team's half, and any phone the line passes over defects to the
// side that now owns its floor. A team's push is divided by its head count, so it
// is the crowd's average fervour that wins, not its size.
import type { Room } from './layout';

export interface TerritoryState {
  phase: 'playing' | 'over';
  /** x of the front line in room space: team 0 owns [0, boundary), team 1 the rest. */
  boundary: number;
  endsAt: number;
  taps: [number, number];
  winner: 0 | 1 | null;
}

export const PUSH_PER_TAP = 0.06;

export function teamOf(s: TerritoryState, x: number): 0 | 1 {
  // At the walls the line has swept the whole floor, including phones standing on the wall.
  if (s.boundary >= 1) return 0;
  return x < s.boundary ? 0 : 1;
}

export function teamSizes(s: TerritoryState, room: Room): [number, number] {
  const sizes: [number, number] = [0, 0];
  for (const p of room.positions.values()) sizes[teamOf(s, p.x)]++;
  return sizes;
}

export function startTerritory(room: Room, now: number, durationMs = 45_000): TerritoryState {
  const xs = [...room.positions.values()].map((p) => p.x).sort((a, b) => a - b);
  // Split at the gap nearest the middle so the halves start as even as the room allows.
  let boundary = 0.5;
  if (xs.length >= 2) {
    const m = xs.length >> 1;
    boundary = (xs[m - 1] + xs[m]) / 2;
    if (xs[m - 1] === xs[m]) boundary = xs[m] + 1e-6;
  }
  return { phase: 'playing', boundary, endsAt: now + durationMs, taps: [0, 0], winner: null };
}

export function territoryTap(s: TerritoryState, room: Room, seat: number, now: number): TerritoryState {
  if (s.phase !== 'playing') return s;
  if (now >= s.endsAt) return territoryTick(s, now);
  const p = room.positions.get(seat);
  if (!p) return s;
  const team = teamOf(s, p.x);
  const size = Math.max(1, teamSizes(s, room)[team]);
  const boundary = s.boundary + (team === 0 ? 1 : -1) * (PUSH_PER_TAP / size);
  const taps: [number, number] = [...s.taps];
  taps[team]++;
  if (boundary >= 1) return { ...s, boundary: 1, taps, phase: 'over', winner: 0 };
  if (boundary <= 0) return { ...s, boundary: 0, taps, phase: 'over', winner: 1 };
  return { ...s, boundary, taps };
}

export function territoryTick(s: TerritoryState, now: number): TerritoryState {
  if (s.phase !== 'playing' || now < s.endsAt) return s;
  const winner = s.boundary > 0.5 ? 0 : s.boundary < 0.5 ? 1 : null;
  return { ...s, phase: 'over', winner };
}
