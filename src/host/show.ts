// One button for the whole evening: a looping choreography that walks the crowd through
// pictures, waves, sound and live animation, so the host can put the laptop down.
import { AMBER, TEAL, WHITE, makeWave, type WaveParams } from '../core/effects';
import type { RGB } from '../core/layout';
import { canvas2d } from '../ui/canvas';
import { h } from '../ui/dom';
import { keepScreenOn } from '../ui/wakelock';
import type { Director } from './director';
import { comingYear, presets, textStunt } from './images';
import { H, W, aurora, broadcast, fire } from './live';
import { panel, requirePlaced, stopButton } from './panel';
import { flipCards } from './play';
import { recorder } from './record';
import type { HostSession } from './session';

interface Cue {
  name: string;
  ms: number;
  /** An event moment: played on its own from its button, never in the loop. */
  moment?: true;
  /** Starts the cue; may return a function that stops it. */
  run(session: HostSession, opts: { title: string; sound: boolean }): (() => void) | void;
}

function wave(w: Partial<WaveParams> & { rgb: RGB }): Cue['run'] {
  return (session, { sound }) => session.setProgram(makeWave(session.now() + 200, { ...w, voice: sound ? (w.voice ?? 'pluck') : 'off' }));
}

function live(draw: (ctx: CanvasRenderingContext2D, t: number) => void): Cue['run'] {
  return (session) => broadcast(session, canvas2d(W, H)[1], draw, 10).stop;
}

const picture = (name: string): Cue['run'] => (session) => flipCards(session, presets().find((p) => p.name === name)!.image, 1500);

const WARM: [number, number, number, string][] = [
  [0.0003, 0, 0.55, 'rgba(255, 150, 40, 0.9)'],
  [0.00022, 2, 0.5, 'rgba(255, 70, 90, 0.8)'],
  [0.00017, 4, 0.45, 'rgba(255, 205, 130, 0.7)'],
];

/** A slow, warm drift of amber, rose and candlelight for a first dance. */
export function warmWash(ctx: CanvasRenderingContext2D, t: number): void {
  ctx.fillStyle = '#3a0f0a';
  ctx.fillRect(0, 0, W, H);
  for (const [speed, phase, r, color] of WARM) {
    const x = W * (0.5 + 0.4 * Math.sin(t * speed + phase));
    const y = H * (0.5 + 0.35 * Math.cos(t * speed * 0.8 + phase));
    const g = ctx.createRadialGradient(x, y, 0, x, y, r * W);
    g.addColorStop(0, color);
    g.addColorStop(1, 'rgba(58, 15, 10, 0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, W, H);
  }
}

/** Seconds of countdown on the phones, and the lead before the first number. */
const COUNT_FROM = 10;
const COUNT_LEAD = 500;

export const CUES: Cue[] = [
  { name: 'Title card', ms: 6500, run: (session, { title }) => flipCards(session, textStunt(title, session.layout.aspect).image, 3000) },
  { name: 'Amber sweep', ms: 7200, run: wave({ rgb: AMBER, voice: 'pluck' }) },
  { name: 'Drum ripple', ms: 6400, run: wave({ rgb: TEAL, shape: 'ripple', period: 1600, voice: 'drum' }) },
  { name: 'Aurora', ms: 9000, run: live(aurora) },
  { name: 'Bullseye', ms: 5000, run: picture('Bullseye') },
  { name: 'Bell ping-pong', ms: 6400, run: wave({ rgb: WHITE, shape: 'pingpong', period: 3200, voice: 'bell' }) },
  { name: 'Fire', ms: 9000, run: live((ctx) => fire(ctx)) },
  { name: 'Heart', ms: 5000, run: picture('Heart') },
  {
    name: 'New Year countdown',
    ms: COUNT_LEAD + COUNT_FROM * 1000 + 6000,
    moment: true,
    run: (session) => session.setProgram({ kind: 'countdown', at: session.now() + COUNT_LEAD + COUNT_FROM * 1000, from: COUNT_FROM, text: String(comingYear()) }),
  },
  // About the length of a song; the wash keeps going until Stop.
  { name: 'First dance', ms: 240_000, moment: true, run: live(warmWash) },
];

const LOOP = CUES.filter((c) => !c.moment);

export function showPanel(session: HostSession, director: Director): HTMLElement {
  const title = h('input', { type: 'text', id: 'show-title', maxlength: 16, value: 'HELLO', autocomplete: 'off' });
  const sound = h('input', { type: 'checkbox', id: 'show-sound', checked: true });
  const now = h('p.score', { role: 'status', 'aria-live': 'polite' }, 'Ready when you are.');
  const bar = h('progress', { max: 1, value: 0, 'aria-label': 'Cue progress' });
  const list = h('ol.cues', {}, ...LOOP.map((c) => h('li', {}, c.name, h('span', {}, `${Math.round(c.ms / 1000)}s`))));
  const rec = recorder();
  let timer = 0;
  let ticker = 0;
  let stopCue: (() => void) | void;
  // The host walks away, and a sleeping display throttles the cue timers to a crawl.
  let release: (() => void) | undefined;

  const halt = () => {
    release?.();
    release = undefined;
    clearTimeout(timer);
    clearInterval(ticker);
    stopCue?.();
    stopCue = undefined;
    rec?.end();
    list.querySelectorAll('li').forEach((li) => li.removeAttribute('aria-current'));
    now.textContent = 'Stopped.';
    bar.value = 0;
  };

  /** Run one cue with its progress bar and status line; `done` runs when its time is up. */
  const runCue = (cue: Cue, status: string, done: () => void) => {
    stopCue?.();
    stopCue = cue.run(session, { title: title.value.trim().toUpperCase() || 'HELLO', sound: sound.checked });
    now.textContent = status;
    const start = performance.now();
    clearInterval(ticker);
    ticker = window.setInterval(() => (bar.value = Math.min(1, (performance.now() - start) / cue.ms)), 100);
    clearTimeout(timer);
    timer = window.setTimeout(done, cue.ms);
  };

  const play = (i: number) => {
    const k = i % LOOP.length;
    list.querySelectorAll('li').forEach((li, j) => (j === k ? li.setAttribute('aria-current', 'step') : li.removeAttribute('aria-current')));
    runCue(LOOP[k], `Now: ${LOOP[k].name} (${k + 1} of ${LOOP.length})`, () => play(i + 1));
  };

  /** Take over the crowd for the show; false (and a hint) if no phone is placed. */
  const takeOver = (): boolean => {
    if (!requirePlaced(session, say)) return false;
    say('');
    director.run({ stop: halt });
    release = keepScreenOn();
    return true;
  };

  const start = () => {
    if (!takeOver()) return;
    rec?.begin();
    play(0);
  };

  const moment = (cue: Cue) => {
    if (!takeOver()) return;
    rec?.begin(cue.ms);
    runCue(cue, `Now: ${cue.name}`, () => {
      clearInterval(ticker);
      bar.value = 1;
      rec?.end();
      now.textContent = `${cue.name} done. The phones hold it until you press Stop.`;
    });
  };

  const { el, say } = panel(
    'Press one button and walk away. The show loops through your title, waves of light and sound, live animation and pictures, timed for the whole crowd. Or play one event moment on its own.',
    h('div.row', {}, h('label.grow', { for: 'show-title' }, 'Title on the crowd', title)),
    h('label.check', { for: 'show-sound' }, sound, h('span', {}, 'With sound')),
    list,
    h('div.row', { role: 'group', 'aria-label': 'Event moments' }, ...CUES.filter((c) => c.moment).map((c) => h('button.btn', { type: 'button', onclick: () => moment(c) }, c.name))),
    rec?.el,
    bar,
    now,
    h('div.row', {}, h('button.btn.primary', { type: 'button', onclick: start }, 'Start the show'), stopButton(director)),
  );
  return el;
}
