export interface Throttled {
  (): void;
  /** Count a send made some other way, so the next call waits its turn. */
  sent(): void;
  /** Drop a waiting trailing call. */
  cancel(): void;
}

/** Calls `fn` at most once per `ms`, always ending on the latest call. */
export function throttle(fn: () => void, ms: number): Throttled {
  let last = -Infinity;
  let pending = 0;
  const fire = () => {
    pending = 0;
    last = performance.now();
    fn();
  };
  const t = () => {
    const wait = ms - (performance.now() - last);
    if (wait <= 0) fire();
    else pending ||= window.setTimeout(fire, wait);
  };
  t.sent = () => (last = performance.now());
  t.cancel = () => {
    clearTimeout(pending);
    pending = 0;
  };
  return t;
}
