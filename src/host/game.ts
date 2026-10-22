// The loop every crowd game shares: start on the placed phones, feed taps and clock
// ticks through pure rules, and broadcast each new state to the crowd.
import type { Program } from '../core/effects';
import type { Room } from '../core/layout';
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

export function runGame<S extends { phase: 'playing' | 'over' }>(session: HostSession, director: Director, say: (text: string) => void, rules: GameRules<S>): void {
  const room = session.playRoom();
  if (room.positions.size < 2) return say(`${rules.name} needs at least 2 connected, placed phones.`);
  let state: S | null = null;
  let timer = 0;
  let last = 0;
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
    rules.show(s, prev, room);
    if (s.phase === 'over') clearInterval(timer);
  };
  push(rules.start(room, session.now()));
  session.onTap = (seat) => state && push(rules.tap(state, room, seat, session.now()));
  timer = window.setInterval(() => {
    if (!state) return;
    const next = rules.tick(state, room, session.now());
    if (next !== state) push(next);
    else if (rules.resendMs !== undefined && performance.now() - last > rules.resendMs) {
      send(state, performance.now());
      rules.show(state, state, room);
    }
  }, rules.tickMs);
}
