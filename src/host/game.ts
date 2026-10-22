// The loop every crowd game shares: start on the placed phones, feed taps and clock
// ticks through pure rules, and broadcast each new state to the crowd.
import type { Program } from '../core/effects';
import type { RGB, Room } from '../core/layout';
import { potatoTap, potatoTick, startPotato, type PotatoState } from '../core/potato';
import { startTerritory, territoryTap, territoryTick, type TerritoryState } from '../core/territory';
import type { Director } from './director';
import type { HostSession } from './session';

export interface GameRules<S extends { phase: 'playing' | 'over' }> {
  name: string;
  start(room: Room, now: number): S;
  tap(s: S, room: Room, seat: number, now: number): S;
  tick(s: S, room: Room, now: number): S;
  program(s: S): Program;
  tickMs: number;
  /** Changes closer together than this (ms) are not broadcast; the final state always is. */
  throttleMs?: number;
  /** Re-broadcast an unchanged state this often (ms), so throttled changes still land. */
  resendMs?: number;
  /** Update the host's scoreboard; `prev` is the state before this one. */
  show(s: S, prev: S | null, room: Room): void;
}

export function runGame<S extends { phase: 'playing' | 'over' }>(session: HostSession, director: Pick<Director, 'take'>, say: (text: string) => void, rules: GameRules<S>): void {
  // Who is in this game is fixed at the start; where they are and whether they are still here is not.
  const players = session.playRoom();
  if (players.positions.size < 2) return say(`${rules.name} needs at least 2 connected, placed phones.`);
  const room = (): Room => {
    const now = session.playRoom();
    for (const seat of now.positions.keys()) if (!players.positions.has(seat)) now.positions.delete(seat);
    return now;
  };
  let state: S | null = null;
  let timer = 0;
  let last = -Infinity;
  director.take(() => {
    clearInterval(timer);
    session.onTap = () => {};
    state = null;
  });
  say('');
  const send = (s: S, at: number) => {
    last = at;
    session.setProgram(rules.program(s));
  };
  const push = (s: S) => {
    const prev = state;
    state = s;
    const now = performance.now();
    if (s !== prev && (!rules.throttleMs || now - last > rules.throttleMs || s.phase === 'over')) send(s, now);
    rules.show(s, prev, room());
    if (s.phase === 'over') clearInterval(timer);
  };
  push(rules.start(players, session.now()));
  session.onTap = (seat) => state && push(rules.tap(state, room(), seat, session.now()));
  timer = window.setInterval(() => {
    if (!state) return;
    const next = rules.tick(state, room(), session.now());
    if (next !== state) push(next);
    else if (rules.resendMs !== undefined && performance.now() - last > rules.resendMs) {
      send(state, performance.now());
      rules.show(state, state, room());
    }
  }, rules.tickMs);
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
