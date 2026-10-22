import type { HostSession } from './session';
import type { Stage } from './stage';

/** Starting something stops whatever was running (games, taps, stage picking). */
export class Director {
  private stopCurrent: (() => void) | undefined;

  constructor(
    private readonly session: HostSession,
    private readonly stage: Stage,
  ) {}

  take(stop?: () => void): void {
    this.stopCurrent?.();
    this.stopCurrent = stop;
    this.stage.onPick = null;
  }

  /** Stop everything and send every phone back to the lobby. */
  idle(): void {
    this.take();
    this.session.setProgram({ kind: 'lobby' });
  }
}
