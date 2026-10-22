// One button for the whole evening: a looping choreography that walks the crowd through
// pictures, waves, sound and live animation, so the host can put the laptop down.
import { AMBER, TEAL, WHITE, makeWave, type WaveParams } from '../core/effects';
import type { RGB } from '../core/layout';
import { clockTime } from '../core/speaker';
import { canvas2d } from '../ui/canvas';
import { h, setText } from '../ui/dom';
import { keepScreenOn } from '../ui/wakelock';
import type { Director } from './director';
import { comingYear, presets, textStunt } from './images';
import { H, W, aurora, broadcast, fire } from './live';
import { cardStuntPointer, panel, placementNote, requirePlaced, stopButton } from './panel';
import { flipCards } from './play';
import { recorder } from './record';
import type { HostSession } from './session';

interface Cue {
  name: string;
  ms: number;
  /** An event moment: played on its own from its button, never in the loop. */
  moment?: true;
  /** Plays on every phone, placed or not. */
  unplaced?: true;
  /** Can be timed so its big moment lands at the next midnight. */
  timed?: true;
  /** Starts the cue; may return a function that stops it. `zeroAt` (host time) is when a timed cue's big moment lands. */
  run(session: HostSession, opts: { title: string; sound: boolean; zeroAt?: number }): (() => void) | void;
}

/** Milliseconds from `d` to the next local midnight. */
export function msToMidnight(d: Date): number {
  const next = new Date(d.getFullYear(), d.getMonth(), d.getDate() + 1);
  return next.getTime() - d.getTime();
}

/** "1:02:03", "4:05". */
function hms(ms: number): string {
  const t = Math.max(0, Math.ceil(ms / 1000));
  const h = Math.floor(t / 3600);
  return h ? `${h}:${clockTime(t % 3600).padStart(5, '0')}` : clockTime(t);
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

/** Seconds of countdown on the phones, the lead before the first number, and how long the burst holds after zero. */
const COUNT_FROM = 10;
const COUNT_LEAD = 500;
const COUNT_AFTER = 6000;
/** A midnight countdown films from just before the numbers start, not the whole wait. */
const FILM_BEFORE = COUNT_FROM * 1000 + 2000;
/** Further than this, the host most likely meant a midnight that has just passed. */
const MIDNIGHT_MAX_WAIT = 12 * 3_600_000;
/** The phones are sent the moment again once the host clock and the wall clock disagree on it by more than this. */
const MIDNIGHT_SLIP = 100;

/** Why a countdown to a midnight `ms` away can't be timed, or null. */
export function midnightProblem(ms: number): string | null {
  if (ms <= MIDNIGHT_MAX_WAIT) return null;
  return `Midnight is ${hms(ms)} away by this computer’s clock. Untick the midnight box to count down now.`;
}

/**
 * Times the countdown to `target` on the wall clock (Date). The host clock that the phones share
 * (performance.now) drifts from it and stands still while the computer sleeps, so every tick reads
 * the wall clock again: the phones are re-sent the moment when it has moved, and filming and the
 * end follow the wall clock too. Returns ms left to midnight.
 */
export function midnightTimer(target: number, clock: { wall: () => number; host: () => number }, on: { send(zeroAt: number): void; film(ms: number): void; done(): void }) {
  let sent = NaN;
  let filming = false;
  let over = false;
  return {
    tick(): number {
      const left = target - clock.wall();
      const zeroAt = clock.host() + left;
      if (!(Math.abs(zeroAt - sent) <= MIDNIGHT_SLIP)) on.send((sent = zeroAt));
      if (!filming && left <= FILM_BEFORE) (filming = true), on.film(left + COUNT_AFTER);
      if (!over && left <= -COUNT_AFTER) (over = true), on.done();
      return left;
    },
  };
}

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
    ms: COUNT_LEAD + COUNT_FROM * 1000 + COUNT_AFTER,
    moment: true,
    unplaced: true,
    timed: true,
    run: (session, { zeroAt }) => session.setProgram({ kind: 'countdown', at: zeroAt ?? session.now() + COUNT_LEAD + COUNT_FROM * 1000, from: COUNT_FROM, text: String(comingYear()) }),
  },
  // About the length of a song; the wash keeps going until Stop.
  { name: 'First dance', ms: 240_000, moment: true, run: live(warmWash) },
];

const LOOP = CUES.filter((c) => !c.moment);

export function showPanel(session: HostSession, director: Director): HTMLElement {
  const title = h('input', { type: 'text', id: 'show-title', maxlength: 16, value: 'HELLO', autocomplete: 'off' });
  const sound = h('input', { type: 'checkbox', id: 'show-sound', checked: true });
  const midnight = h('input', { type: 'checkbox', id: 'show-midnight' });
  const now = h('p.score', { role: 'status', 'aria-live': 'polite' }, 'Ready when you are.');
  const bar = h('progress', { max: 1, value: 0, 'aria-label': 'Cue progress' });
  const list = h('ol.cues', {}, ...LOOP.map((c) => h('li', {}, c.name, h('span', {}, `${Math.round(c.ms / 1000)}s`))));
  const rec = recorder();
  let timer = 0;
  let ticker = 0;
  /** Wake-ups for the midnight countdown's filming and end, which a hidden tab's interval can miss by a minute. */
  let wakes: number[] = [];
  let stopCue: (() => void) | void;
  // The host walks away, and a sleeping display throttles the cue timers to a crawl.
  let release: (() => void) | undefined;

  const halt = () => {
    release?.();
    release = undefined;
    clearTimeout(timer);
    wakes.forEach(clearTimeout);
    clearInterval(ticker);
    stopCue?.();
    stopCue = undefined;
    rec?.end();
    list.querySelectorAll('li').forEach((li) => li.removeAttribute('aria-current'));
    setText(now, 'Stopped.');
    bar.value = 0;
  };

  const cueOpts = () => ({ title: title.value.trim().toUpperCase() || 'HELLO', sound: sound.checked });

  /** Run one cue with its progress bar and status line; `done` runs when its time is up. */
  const runCue = (cue: Cue, status: string, done: () => void) => {
    stopCue?.();
    stopCue = cue.run(session, cueOpts());
    setText(now, status);
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

  /** Take over the crowd for the show; false (and a hint) if it needs placed phones and none are. */
  const takeOver = (placed = true): boolean => {
    if (placed && !requirePlaced(session, fail)) return false;
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
    const timed = cue.timed && midnight.checked;
    const away = msToMidnight(new Date());
    const problem = timed ? midnightProblem(away) : null;
    if (problem) return fail(problem);
    if (!takeOver(!cue.unplaced)) return;
    const done = () => {
      clearInterval(ticker);
      bar.value = 1;
      rec?.end();
      setText(now, `${cue.name} done. The phones hold it until you press Stop.`);
    };
    if (!timed) {
      rec?.begin(cue.ms);
      return runCue(cue, `Now: ${cue.name}`, done);
    }
    const target = Date.now() + away;
    const opts = cueOpts();
    const countdown = midnightTimer(
      target,
      { wall: Date.now, host: () => session.now() },
      { send: (zeroAt) => (stopCue = cue.run(session, { ...opts, zeroAt })), film: (ms) => rec?.begin(ms), done },
    );
    const step = () => {
      const left = countdown.tick();
      if (left <= -COUNT_AFTER) return;
      bar.value = Math.min(1, 1 - (left + COUNT_AFTER) / (away + COUNT_AFTER));
      setText(now, left > COUNT_FROM * 1000 ? `Midnight in ${hms(left)}. The phones count down the last ${COUNT_FROM} seconds.` : `Now: ${cue.name}`);
    };
    stopCue?.();
    clearTimeout(timer);
    clearInterval(ticker);
    ticker = window.setInterval(step, 1000);
    wakes = [away - FILM_BEFORE, away + COUNT_AFTER].map((ms) => window.setTimeout(step, Math.max(0, ms)));
    step();
    if (away <= COUNT_FROM * 1000) say(`Midnight is only ${Math.ceil(away / 1000)} s away: the phones count down what is left.`);
  };

  const { el, say, fail } = panel(
    'Press one button and walk away. The show loops through your title, waves of light and sound, live animation, a bullseye and a heart, until you press Stop. It cannot show your own photo. Or play one event moment on its own.',
    placementNote(session, 'The show needs phones on the map (the New Year countdown does not).'),
    cardStuntPointer(''),
    h('div.row', {}, h('label.grow', { for: 'show-title' }, 'Title on the crowd', title)),
    h('label.check', { for: 'show-sound' }, sound, h('span', {}, 'With sound')),
    list,
    h('div.row', { role: 'group', 'aria-label': 'Event moments' }, ...CUES.filter((c) => c.moment).map((c) => h('button.btn', { type: 'button', onclick: () => moment(c) }, c.name))),
    h('label.check', { for: 'show-midnight' }, midnight, h('span', {}, 'Time the New Year countdown to end at midnight, by this computer’s clock')),
    rec?.el,
    bar,
    now,
    h('div.row', {}, h('button.btn.primary', { type: 'button', onclick: start }, 'Start the show'), stopButton(director)),
  );
  return el;
}
