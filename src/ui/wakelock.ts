/**
 * Keep the screen awake until the returned function is called. The browser drops the lock
 * whenever the page is hidden, so it is taken again each time the page comes back.
 */
export function keepScreenOn(): () => void {
  let held: WakeLockSentinel | null = null;
  let on = true;
  const grab = async () => {
    try {
      const w = (await navigator.wakeLock?.request('screen')) ?? null;
      const old = on ? held : w;
      if (on) held = w;
      void old?.release().catch(() => {});
    } catch {
      // Denied (low battery, hidden tab): carry on without it.
    }
  };
  const relock = () => document.visibilityState === 'visible' && void grab();
  document.addEventListener('visibilitychange', relock);
  void grab();
  return () => {
    on = false;
    document.removeEventListener('visibilitychange', relock);
    void held?.release().catch(() => {});
    held = null;
  };
}
