// One button for the whole evening: a looping choreography that walks the crowd through
// pictures, waves, sound and live animation, so the host can put the laptop down.
import { AMBER, TEAL, WHITE, makeWave, type WaveParams } from '../core/effects';
import type { RGB } from '../core/layout';
import { h } from '../ui/dom';
import { presets, textStunt } from './images';
import { H, W, aurora, castFrame, fire } from './live';
import { flipCards, type Director } from './play';
import type { HostSession } from './session';

interface Cue {
  name: string;
  ms: number;
  /** Starts the cue; may return a function that stops it. */
  run(session: HostSession, opts: { title: string; sound: boolean }): (() => void) | void;
}

function wave(w: Partial<WaveParams> & { rgb: RGB }): Cue['run'] {
  return (session, { sound }) => session.setProgram(makeWave(session.now() + 200, { ...w, voice: sound ? (w.voice ?? 'pluck') : 'off' }));
}

function live(draw: (ctx: CanvasRenderingContext2D, t: number) => void): Cue['run'] {
  return (session) => {
    const c = document.createElement('canvas');
    c.width = W;
    c.height = H;
    const ctx = c.getContext('2d', { willReadFrequently: true })!;
    let last = new Map<number, RGB>();
    const timer = window.setInterval(() => {
      draw(ctx, performance.now());
      last = castFrame(session, ctx, last);
    }, 100);
    return () => clearInterval(timer);
  };
}

const picture = (name: string): Cue['run'] => (session) => flipCards(session, presets().find((p) => p.name === name)!.image, 1500);

export const CUES: Cue[] = [
  { name: 'Title card', ms: 6500, run: (session, { title }) => flipCards(session, textStunt(title, session.layout.aspect).image, 3000) },
  { name: 'Amber sweep', ms: 7200, run: wave({ rgb: AMBER, voice: 'pluck' }) },
  { name: 'Drum ripple', ms: 6400, run: wave({ rgb: TEAL, shape: 'ripple', period: 1600, voice: 'drum' }) },
  { name: 'Aurora', ms: 9000, run: live(aurora) },
  { name: 'Bullseye', ms: 5000, run: picture('Bullseye') },
  { name: 'Bell ping-pong', ms: 6400, run: wave({ rgb: WHITE, shape: 'pingpong', period: 3200, voice: 'bell' }) },
  { name: 'Fire', ms: 9000, run: live((ctx) => fire(ctx)) },
  { name: 'Heart', ms: 5000, run: picture('Heart') },
];

export function showPanel(session: HostSession, director: Director): HTMLElement {
  const title = h('input', { type: 'text', id: 'show-title', maxlength: 16, value: 'HELLO', autocomplete: 'off' });
  const sound = h('input', { type: 'checkbox', id: 'show-sound', checked: true });
  const now = h('p.score', { role: 'status', 'aria-live': 'polite' }, 'Ready when you are.');
  const bar = h('progress', { max: 1, value: 0, 'aria-label': 'Cue progress' });
  const list = h('ol.cues', {}, ...CUES.map((c) => h('li', {}, c.name, h('span', {}, `${Math.round(c.ms / 1000)}s`))));
  const msg = h('p.note', { role: 'status' });
  let timer = 0;
  let ticker = 0;
  let stopCue: (() => void) | void;
  let running = false;
  let wake: WakeLockSentinel | null = null;

  // The host walks away, and a sleeping display throttles the cue timers to a crawl.
  const lock = async () => {
    try {
      const w = (await navigator.wakeLock?.request('screen')) ?? null;
      const old = running ? wake : w;
      if (running) wake = w;
      void old?.release().catch(() => {});
    } catch {
      // Denied (low battery, hidden tab): the show still runs, it just may stutter.
    }
  };
  // The browser drops the lock whenever the tab is hidden.
  const relock = () => running && document.visibilityState === 'visible' && void lock();

  const halt = () => {
    running = false;
    document.removeEventListener('visibilitychange', relock);
    void wake?.release().catch(() => {});
    wake = null;
    clearTimeout(timer);
    clearInterval(ticker);
    stopCue?.();
    stopCue = undefined;
    list.querySelectorAll('li').forEach((li) => li.removeAttribute('aria-current'));
    now.textContent = 'Stopped.';
    bar.value = 0;
  };

  const play = (i: number) => {
    const cue = CUES[i % CUES.length];
    stopCue?.();
    stopCue = cue.run(session, { title: title.value.trim().toUpperCase() || 'HELLO', sound: sound.checked });
    list.querySelectorAll('li').forEach((li, k) => (k === i % CUES.length ? li.setAttribute('aria-current', 'step') : li.removeAttribute('aria-current')));
    now.textContent = `Now: ${cue.name} (${(i % CUES.length) + 1} of ${CUES.length})`;
    const start = performance.now();
    clearInterval(ticker);
    ticker = window.setInterval(() => (bar.value = Math.min(1, (performance.now() - start) / cue.ms)), 100);
    timer = window.setTimeout(() => play(i + 1), cue.ms);
  };

  const start = () => {
    if (session.layout.positions.size === 0) return void (msg.textContent = 'Place some phones on the map first (Locate tab).');
    msg.textContent = '';
    director.take(halt);
    running = true;
    document.addEventListener('visibilitychange', relock);
    void lock();
    play(0);
  };

  return h(
    'div.panel-body',
    {},
    h('p.panel-intro', {}, 'Press one button and walk away. The show loops through your title, waves of light and sound, live animation and pictures, timed for the whole crowd.'),
    h('div.row', {}, h('label.grow', { for: 'show-title' }, 'Title on the crowd', title)),
    h('label.check', { for: 'show-sound' }, sound, h('span', {}, 'With sound')),
    list,
    bar,
    now,
    h('div.row', {}, h('button.btn.primary', { type: 'button', onclick: start }, 'Start the show'), h('button.btn.ghost', { type: 'button', onclick: () => (director.take(), session.setProgram({ kind: 'lobby' })) }, 'Stop')),
    msg,
  );
}
