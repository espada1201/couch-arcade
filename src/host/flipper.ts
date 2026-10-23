// One Flip press at a time: it is dropped when the room changes hands or the host changes the picture or style.
import { FLIP_LEAD_MS, type FlipControl, type FlipOutcome } from './cardstyles';
import type { Director } from './director';

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
  const cancel = () => {
    if (!ctl) return;
    ctl.abort();
    ctl = null;
    view.busy(false);
    view.say('');
  };
  // Every release, including the one our own run causes: by then `ctl` is already clear.
  director.onHandover(cancel);
  return {
    get inFlight() {
      return ctl !== null;
    },
    cancel,
    /** Prepares a flip and hands it to the director. Whether the room was flipped. */
    async press(prepare: (c: FlipControl) => Promise<FlipOutcome>): Promise<boolean> {
      if (ctl) return false;
      const mine = (ctl = new AbortController());
      view.busy(true);
      await painted();
      const out: FlipOutcome = mine.signal.aborted
        ? { cancelled: true }
        : await prepare({ lead: FLIP_LEAD_MS, say: view.say, signal: mine.signal }).finally(() => {
            if (ctl !== mine) return;
            ctl = null;
            view.busy(false);
          });
      if (mine.signal.aborted) return false;
      if ('refuse' in out) view.fail(out.refuse);
      if (!('go' in out)) return false;
      director.run({ ...out.go, stop });
      return true;
    },
  };
}
