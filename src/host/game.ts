// Crowd games: start on the placed phones and run the crowd loop with each game's pure rules.
import type { Program } from '../core/effects';
import type { RGB, Room } from '../core/layout';
import { potatoTap, potatoTick, startPotato, type PotatoState } from '../core/potato';
import { startTerritory, territoryTap, territoryTick, type TerritoryState } from '../core/territory';
import { runCrowd, type CrowdRules } from './crowd';
import type { Director } from './director';
import type { HostSession } from './session';

export interface GameRules<S extends { phase: 'playing' | 'over' }> extends Pick<CrowdRules<S>, 'throttleMs' | 'resendMs'> {
  name: string;
  start(room: Room, now: number): S;
  tap(s: S, room: Room, seat: number, now: number): S;
  tick(s: S, room: Room, now: number): S;
  program(s: S): Program;
  tickMs: number;
  /** Update the host's scoreboard; `prev` is the state before this one. */
  show(s: S, prev: S | null, room: Room): void;
}

export function runGame<S extends { phase: 'playing' | 'over' }>(session: HostSession, director: Pick<Director, 'run'>, say: (text: string) => void, rules: GameRules<S>): void {
  // Who is in this game is fixed at the start; where they are and whether they are still here is not.
  const players = session.playRoom();
  if (players.positions.size < 2) return say(`${rules.name} needs at least 2 connected, placed phones.`);
  const room = (): Room => {
    const now = session.playRoom();
    for (const seat of now.positions.keys()) if (!players.positions.has(seat)) now.positions.delete(seat);
    return now;
  };
  say('');
  runCrowd<S>(session, director, rules.start(players, session.now()), {
    program: rules.program,
    input: { tap: (s, seat) => rules.tap(s, room(), seat, session.now()) },
    tick: (s) => rules.tick(s, room(), session.now()),
    tickMs: rules.tickMs,
    over: (s) => s.phase === 'over',
    throttleMs: rules.throttleMs,
    resendMs: rules.resendMs,
    show: (s, prev) => rules.show(s, prev, room()),
  });
}

/** Territory's rules minus the scoreboard. */
export function territoryRules(durationMs: number, colors: [RGB, RGB]): Omit<GameRules<TerritoryState>, 'show'> {
  return {
    name: 'Territory',
    start: (room, now) => startTerritory(room, now, durationMs),
    tap: territoryTap,
    tick: (s, _room, now) => territoryTick(s, now),
    program: (state) => ({ kind: 'territory', state, colors }),
    tickMs: 100,
    throttleMs: 40,
    resendMs: 120,
  };
}

/** Hot Potato's rules minus the scoreboard. */
export const POTATO_RULES: Omit<GameRules<PotatoState>, 'show'> = {
  name: 'Hot Potato',
  // Two or more placed phones always give a game.
  start: (room, now) => startPotato(room, now + 1500, Math.random)!,
  tap: (s, room, seat, now) => potatoTap(s, room, seat, now, Math.random),
  tick: potatoTick,
  program: (state) => ({ kind: 'potato', state }),
  tickMs: 50,
};
