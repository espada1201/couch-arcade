import type { Program } from '../core/effects';
import type { HostSession, InputHandlers } from './session';

const LOBBY: Program = { kind: 'lobby' };

export interface Run {
  /** Called once, when something else takes the room or the run ends. */
  stop?: () => void;
  /** What every phone shows from the start; the lobby when left out. */
  program?: Program | ((seat: number) => Program);
  /** Phone input this run hears for as long as it holds the room. */
  onInput?: InputHandlers;
  /** The program is a picture frame: each phone gets the next only once it confirms this one (see HostSession.setProgram). */
  frame?: boolean;
}

export interface Hold {
  /** Whether this run still holds the room. */
  readonly active: boolean;
  /** Stop this run, if it still holds the room, and send the phones back to the lobby. */
  end(): void;
}

/** Owns what the phones run: starting something stops whatever was running (games, taps, stage picking). */
export class Director {
  private current: (() => void) | null = null;
  private readonly handovers: (() => void)[] = [];

  constructor(private readonly session: HostSession) {}

  /** Clears room-wide state no single run owns (the stage's ripple aim) each time the room changes hands. */
  onHandover(clear: () => void): void {
    this.handovers.push(clear);
  }

  run({ stop, program, onInput, frame }: Run = {}): Hold {
    this.release();
    const unhear = onInput ? this.session.input(onInput) : () => {};
    const mine = () => {
      unhear();
      stop?.();
    };
    this.current = mine;
    this.session.setProgram(program ?? LOBBY, { frame });
    const self = this;
    return {
      get active() {
        return self.current === mine;
      },
      end: () => self.current === mine && self.idle(),
    };
  }

  /** Stop everything and send every phone back to the lobby. */
  idle(): void {
    this.release();
    this.session.setProgram(LOBBY);
  }

  private release(): void {
    const stop = this.current;
    // Cleared first, so a stop that ends its own run can't recurse.
    this.current = null;
    for (const clear of this.handovers) clear();
    stop?.();
    // A run started from a stop would be replaced as soon as this returns, its own stop never called.
    // That is a bug: in development it throws; for a host mid-party it is stopped and logged, so the
    // click that got here still works.
    const stray = this.current as (() => void) | null;
    if (!stray) return;
    if (import.meta.env.DEV) throw new Error('A run’s stop started another run');
    console.error('A run’s stop started another run; it was stopped.');
    this.current = null;
    stray();
  }
}
