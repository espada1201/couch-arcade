// One Flip press at a time: it is dropped when the room changes hands or the host changes the picture or style.
import { FLIP_LEAD_MS, type FlipControl, type FlipOutcome } from './cardstyles';
import type { Director, Hold } from './director';

export interface FlipView {
  say(text: string): void;
  fail(text: string): void;
  /** The Flip button is busy: it stays focusable, and pressing it again does nothing. */
  busy(on: boolean): void;
}

/** One frame, so the busy button and status get painted before the work that follows blocks the page. A hidden tab never gets its frame, so a timer is the fallback. */
const painted = () =>
  new Promise<void>((done) => {
    if (typeof requestAnimationFrame === 'function') requestAnimationFrame(() => done());
    setTimeout(done, 50);
  });

export function flipper(director: Director, view: FlipView, stop?: () => void) {
  let ctl: AbortController | null = null;
  /** The run this flipper started, for as long as it holds the room. */
  let hold: Hold | null = null;
  const cancel = () => {
    if (!ctl) return;
    ctl.abort();
    ctl = null;
    view.busy(false);
    view.say('');
  };
  // Every release, including the one our own run causes: by then `ctl` is already clear.
  director.onHandover(cancel);
  /** Runs `prepare` as the one thing in flight; the outcome, or null when the press was dropped meanwhile. */
  const prepared = async (mine: AbortController, prepare: (c: FlipControl) => Promise<FlipOutcome>, lead: number): Promise<FlipOutcome | null> => {
    const out: FlipOutcome = mine.signal.aborted
      ? { cancelled: true }
      : await prepare({ lead, say: view.say, signal: mine.signal }).finally(() => {
          if (ctl !== mine) return;
          ctl = null;
          view.busy(false);
        });
    if (mine.signal.aborted) return null;
    if ('refuse' in out) view.fail(out.refuse);
    return out;
  };
  return {
    get inFlight() {
      return ctl !== null;
    },
    /** A flip this flipper started is still on the phones. */
    get lit() {
      return hold?.active ?? false;
    },
    cancel,
    /** Prepares a flip and hands it to the director. Whether the room was flipped. */
    async press(prepare: (c: FlipControl) => Promise<FlipOutcome>): Promise<boolean> {
      if (ctl) return false;
      const mine = (ctl = new AbortController());
      view.busy(true);
      await painted();
      const out = await prepared(mine, prepare, FLIP_LEAD_MS);
      if (!out || !('go' in out)) return false;
      hold = director.run({ ...out.go, stop });
      return true;
    },
    /**
     * The room changed under a flip that is still on: prepares it again and sends it to the phones at once, with no
     * countdown, while the flip keeps holding the room. Whether the phones got it; false when no flip of ours is on.
     */
    async refresh(prepare: (c: FlipControl) => Promise<FlipOutcome>): Promise<boolean> {
      const on = hold;
      if (ctl || !on?.active) return false;
      const mine = (ctl = new AbortController());
      view.busy(true);
      const out = await prepared(mine, prepare, 0);
      return !!out && 'go' in out && !!out.go.program && on.update(out.go.program, { frame: out.go.frame });
    },
  };
}
