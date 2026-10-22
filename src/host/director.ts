import type { Program } from '../core/effects';
import type { HostSession, InputHandlers } from './session';
import type { Stage } from './stage';

const LOBBY: Program = { kind: 'lobby' };

export interface Run {
  /** Called once, when something else takes the room or the run ends. */
  stop?: () => void;
  /** What every phone shows from the start; the lobby when left out. */
  program?: Program | ((seat: number) => Program);
  /** Phone input this run hears for as long as it holds the room. */
  onInput?: InputHandlers;
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

  constructor(
    private readonly session: HostSession,
    private readonly stage: Pick<Stage, 'onPick'>,
  ) {}

  run({ stop, program, onInput }: Run = {}): Hold {
    this.release();
    const unhear = onInput ? this.session.input(onInput) : () => {};
    const mine = () => {
      unhear();
      stop?.();
    };
    this.current = mine;
    this.session.setProgram(program ?? LOBBY);
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
    // Cleared first, so a stop that ends its own run (or starts another) can't recurse.
    this.current = null;
    this.stage.onPick = null;
    stop?.();
  }
}
