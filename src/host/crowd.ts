// The loop every crowd feature shares (games, polls): hold the room, fold phone input,
// host actions and clock ticks through pure rules, and broadcast each new state.
import type { Program } from '../core/effects';
import type { Director } from './director';
import type { HostSession, InputHandlers, PhoneInput } from './session';

export interface CrowdRules<S> {
  program(s: S): Program | ((seat: number) => Program);
  /** Phone input folded into the state. */
  input?: { [K in PhoneInput['t']]?: (s: S, seat: number, m: Extract<PhoneInput, { t: K }>) => S };
  /** Clock steps, every `tickMs`, until `over`. */
  tick?(s: S): S;
  tickMs?: number;
  over?(s: S): boolean;
  /** Changes closer together than this (ms) are not broadcast; the final state always is. */
  throttleMs?: number;
  /** Re-broadcast an unchanged state this often (ms), so throttled changes still land. */
  resendMs?: number;
  /** The roster changed (joins, leaves, moves): the new state; it is always re-broadcast. */
  roster?(s: S): S;
  /** Hears every new state; `prev` is the state before this one (null at the start). */
  show(s: S, prev: S | null): void;
  /** Runs once when the loop stops. */
  stop?(): void;
}

export interface Crowd<S> {
  /** A host action (close, reveal...). */
  dispatch(f: (s: S) => S): void;
  /** The running state, or null once stopped. */
  state(): S | null;
}

export function runCrowd<S>(session: HostSession, director: Pick<Director, 'run'>, start: S, rules: CrowdRules<S>): Crowd<S> {
  let state: S | null = null;
  let timer = 0;
  let last = -Infinity;
  let unsubscribe = () => {};
  const send = (s: S) => {
    last = performance.now();
    session.setProgram(rules.program(s));
  };
  const push = (s: S, force = false) => {
    const prev = state;
    state = s;
    const over = rules.over?.(s) ?? false;
    if (force || (s !== prev && (!rules.throttleMs || performance.now() - last > rules.throttleMs || over))) send(s);
    rules.show(s, prev);
    if (over) clearInterval(timer);
  };
  const onInput: Record<string, (seat: number, m: PhoneInput) => void> = {};
  for (const [t, fold] of Object.entries(rules.input ?? {}) as [PhoneInput['t'], (s: S, seat: number, m: PhoneInput) => S][])
    onInput[t] = (seat, m) => state !== null && push(fold(state, seat, m));
  director.run({
    stop: () => {
      clearInterval(timer);
      unsubscribe();
      state = null;
      rules.stop?.();
    },
    program: rules.program(start),
    onInput: onInput as InputHandlers,
  });
  last = performance.now();
  state = start;
  rules.show(start, null);
  const roster = rules.roster;
  if (roster) unsubscribe = session.subscribe(() => state !== null && push(roster(state), true));
  const tick = rules.tick;
  if (tick && !rules.over?.(start))
    timer = window.setInterval(() => {
      if (state === null) return;
      const next = tick(state);
      if (next !== state) push(next);
      else if (rules.resendMs !== undefined && performance.now() - last > rules.resendMs) push(state, true);
    }, rules.tickMs);
  return { dispatch: (f) => state !== null && push(f(state)), state: () => state };
}
