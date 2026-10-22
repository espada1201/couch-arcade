// Keeps the screen awake. The Screen Wake Lock API does it where the page may use it (https and
// localhost). A phone that joined over the Wi-Fi relay's plain http has no Wake Lock, so a tiny
// muted looping video plays instead, since a playing video keeps a phone awake.
import { NOSLEEP_MP4, NOSLEEP_WEBM } from './nosleep';

/** What holds the screen on. 'none': the owner has to set Auto-Lock to Never. */
export type Awake = 'wake-lock' | 'video' | 'none';

export interface Hold {
  awake: Awake;
  release(): void;
}

/** The ways this browser offers; each resolves once it holds the screen on, or rejects. */
export interface Ways {
  lock?: () => Promise<{ release(): Promise<void> }>;
  video: () => Promise<() => void>;
}

/** The Wake Lock API when there is one and it is granted, otherwise the video, otherwise nothing. */
export async function hold(ways: Ways): Promise<Hold> {
  if (ways.lock) {
    try {
      const sentinel = await ways.lock();
      return { awake: 'wake-lock', release: () => void sentinel.release().catch(() => {}) };
    } catch {
      // Denied (low battery, hidden tab): the video may still work.
    }
  }
  try {
    return { awake: 'video', release: await ways.video() };
  } catch {
    return { awake: 'none', release: () => {} };
  }
}

/** Plays the looping video; call it from a tap, which some phones need before a video may play. */
function loopVideo(): Promise<() => void> {
  const v = document.createElement('video');
  v.className = 'nosleep';
  v.muted = v.loop = v.playsInline = true;
  v.setAttribute('playsinline', '');
  v.setAttribute('aria-hidden', 'true');
  for (const [src, type] of [
    [NOSLEEP_MP4, 'video/mp4'],
    [NOSLEEP_WEBM, 'video/webm'],
  ]) {
    const s = document.createElement('source');
    s.src = src;
    s.type = type;
    v.append(s);
  }
  document.body.append(v);
  return v.play().then(
    () => () => (v.pause(), v.remove()),
    (e: unknown) => {
      v.remove();
      throw e;
    },
  );
}

/**
 * Keep the screen awake until the returned function is called; `onAwake` hears how. The browser
 * lets go whenever the page is hidden, so it is taken again each time the page comes back.
 */
export function keepScreenOn(onAwake: (a: Awake) => void = () => {}): () => void {
  let held: Hold | null = null;
  let on = true;
  let gen = 0;
  const grab = () => {
    const mine = ++gen;
    held?.release();
    held = null;
    const wl = navigator.wakeLock;
    void hold({ lock: wl && (() => wl.request('screen')), video: loopVideo }).then((h) => {
      if (!on || mine !== gen) return h.release();
      held = h;
      onAwake(h.awake);
    });
  };
  const relock = () => document.visibilityState === 'visible' && grab();
  document.addEventListener('visibilitychange', relock);
  grab();
  return () => {
    on = false;
    document.removeEventListener('visibilitychange', relock);
    held?.release();
    held = null;
  };
}
