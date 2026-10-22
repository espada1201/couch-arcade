// Room Poll on the host: a question with 2-4 answers goes to every phone, votes come
// back through the session, and Reveal turns the placed crowd into the chart. Phones
// don't need to be placed to vote; placement only decides who forms the chart.
import { MAX_IDS } from '../core/blinkcode';
import type { PollProgram } from '../core/effects';
import { LETTERS, MAX_OPTIONS, MIN_OPTIONS, POLL_COLORS, anonLocked, apportion, leaders, liveTally, pollReduce, startPoll, zones, type PollAction, type PollPhase, type PollState } from '../core/poll';
import { forget, loadJson, saveJson } from '../storage';
import { css, h, plural, setText } from '../ui/dom';
import type { Director } from './director';
import { runCrowd } from './crowd';
import { panel, stopButton } from './panel';
import type { HostSession } from './session';

export interface PollRun {
  dispatch(a: PollAction): void;
  /** The count the host sees: phones here now, or every vote once revealed. */
  counts(): number[];
}

const STORE = 'swarm-poll';

interface Saved {
  room: string;
  question: string;
  options: string[];
  phase: PollState['phase'];
  anon: boolean;
  votes: [number, number][];
}

const isIndex = (n: unknown, below = Infinity): n is number => Number.isInteger(n) && (n as number) >= 0 && (n as number) < below;

/** The poll that was running in `room` when the host page went away, if any. Anything else in storage (an older shape, a hand edit) is ignored. */
export function savedPoll(room: string): PollState | null {
  const s = loadJson<Partial<Saved>>(STORE);
  if (!s || typeof s !== 'object' || s.room !== room) return null;
  const { question, options, phase, anon, votes } = s;
  if (typeof question !== 'string' || !question || typeof anon !== 'boolean' || !['open', 'closed', 'revealed'].includes(phase as string)) return null;
  if (!Array.isArray(options) || options.length < MIN_OPTIONS || options.length > MAX_OPTIONS || !options.every((o) => typeof o === 'string')) return null;
  if (!Array.isArray(votes) || !votes.every((v) => Array.isArray(v) && v.length === 2 && isIndex(v[0]) && isIndex(v[1], options.length))) return null;
  return { question, options, phase: phase as PollPhase, anon, votes: new Map(votes) };
}

/** Run a poll on the crowd until the director moves on (or resume one from `from`). `show` hears every new state. */
export function runPoll(session: HostSession, director: Pick<Director, 'run'>, question: string, options: string[], show: (s: PollState) => void, anon = false, from?: PollState): PollRun {
  const online = () => new Set(session.online.map((x) => x.seat));
  const crowd = runCrowd<PollState>(session, director, from ?? startPoll(question, options, anon), {
    program: (s) => {
      const counts = liveTally(s, online());
      const result = s.phase === 'revealed' ? { pct: apportion(counts, 100), zones: zones(session.playRoom(), counts) } : null;
      return (seat): PollProgram => ({
        kind: 'poll',
        question: s.question,
        options: s.options,
        phase: s.phase,
        mine: s.votes.get(seat) ?? null,
        result: result && { pct: result.pct, zone: result.zones.get(seat) ?? null },
        anon: s.anon,
      });
    },
    input: { vote: (s, seat, m) => pollReduce(s, { type: 'vote', seat, choice: m.choice }) },
    // A vote outlives a dropped connection; only a phone the host forgets loses it. Joins, leaves and moves reshape the count and the chart.
    roster: (s) => {
      for (const seat of s.votes.keys()) if (!session.seats.has(seat)) s = pollReduce(s, { type: 'leave', seat });
      return s;
    },
    show: (s) => {
      saveJson(STORE, { room: session.room, question: s.question, options: s.options, phase: s.phase, anon: s.anon, votes: [...s.votes] } satisfies Saved);
      show(s);
    },
    stop: () => forget(STORE),
  });
  return {
    dispatch: (a) => crowd.dispatch((s) => pollReduce(s, a)),
    counts: () => {
      const s = crowd.state();
      return s ? liveTally(s, online()) : options.map(() => 0);
    },
  };
}

/** "Pizza leads with 67%", "Pizza and Tacos tie on 50%", or nothing yet. */
function verdict(s: PollState, counts: number[], pct: number[]): string {
  const top = leaders(counts);
  if (top.length === 0) return 'No votes yet.';
  const names = top.map((i) => `${LETTERS[i]} (${s.options[i]})`);
  if (top.length === 1) return `${names[0]} leads with ${pct[top[0]]}%.`;
  return `Tie: ${names.slice(0, -1).join(', ')} and ${names.at(-1)}, ${plural(counts[top[0]], 'vote')} each.`;
}

export function pollPanel(session: HostSession, director: Director): HTMLElement {
  const question = h('input', { type: 'text', id: 'poll-q', maxlength: 80, placeholder: 'Where should we eat?', autocomplete: 'off' });
  const fields = Array.from({ length: MAX_OPTIONS }, (_, i) =>
    h('input', { type: 'text', id: `poll-opt-${i}`, maxlength: 24, placeholder: ['Yes', 'No', 'Optional', 'Optional'][i], autocomplete: 'off', required: i < MIN_OPTIONS }),
  );
  // Answers fill in order: an optional answer opens once the one before it has text.
  const fillInOrder = () => fields.forEach((f, i) => (f.disabled = i >= MIN_OPTIONS && !f.value.trim() && !fields[i - 1].value.trim()));
  for (const f of fields) f.addEventListener('input', fillInOrder);
  const anon = h('input', { type: 'checkbox', id: 'poll-anon', checked: true });
  const anonText = h('span', {}, 'Anonymous: hide the counts and everyone’s pick until Reveal');
  const summary = h('p.score', { role: 'status', 'aria-live': 'polite' }, 'Phones vote without being placed. Place them to turn the room into the chart on Reveal.');
  const chart = h('ul.poll-chart', { 'aria-label': 'Results' });
  const startBtn = h('button.btn.primary', { type: 'button' }, 'Start the poll');
  const closeBtn = h('button.btn', { type: 'button', disabled: true }, 'Close voting');
  const revealBtn = h('button.btn', { type: 'button', disabled: true }, 'Reveal');
  let run: PollRun | null = null;
  let last: PollState | null = null;

  const draw = (s: PollState | null) => {
    last = s;
    anon.disabled = !!s && anonLocked(s);
    if (s) anon.checked = s.anon;
    setText(anonText, anon.disabled ? 'Anonymous until Reveal: people have voted on that promise' : 'Anonymous: hide the counts and everyone’s pick until Reveal');
    closeBtn.disabled = revealBtn.disabled = !s;
    closeBtn.textContent = s && s.phase !== 'open' ? 'Reopen voting' : 'Close voting';
    revealBtn.disabled = !s || s.phase === 'revealed';
    if (!s) {
      setText(summary, 'No poll running.');
      return chart.replaceChildren();
    }
    const online = new Set(session.online.map((x) => x.seat));
    const counts = liveTally(s, online);
    const pct = apportion(counts, 100);
    const voted = counts.reduce((a, b) => a + b, 0);
    const hidden = s.anon && s.phase !== 'revealed';
    chart.replaceChildren(
      ...s.options.map((name, i) =>
        h(
          'li.poll-bar',
          { style: `--c:${css(POLL_COLORS[i])}; --w:${hidden ? 0 : pct[i]}%` },
          h('span.poll-letter', { 'aria-hidden': 'true' }, LETTERS[i]),
          h('span.poll-name', {}, h('span.sr-only', {}, `${LETTERS[i]}: `), name),
          h('span.poll-num', { 'data-count': hidden ? undefined : counts[i] }, hidden ? 'hidden' : `${plural(counts[i], 'vote')} · ${pct[i]}%`),
          h('span.poll-track', { 'aria-hidden': 'true' }, h('span.poll-fill')),
        ),
      ),
    );
    const away = [...s.votes.keys()].filter((seat) => !online.has(seat)).length;
    const of =
      s.phase === 'revealed'
        ? `${plural(voted, 'vote')}${away ? `, ${away} from ${away === 1 ? 'a phone' : 'phones'} now offline` : ''}`
        : `${voted} of ${plural(online.size, 'phone')} voted${away ? ` (${away} more offline, counted at Reveal)` : ''}`;
    const state = { open: 'Voting is open', closed: 'Voting is closed', revealed: 'Revealed' }[s.phase];
    setText(summary, `${state} · ${of}. ${hidden ? 'Counts stay hidden until Reveal.' : verdict(s, counts, pct)}`);
  };

  const begin = (q: string, options: string[], from?: PollState) => {
    run = runPoll(session, { run: (r = {}) => director.run({ ...r, stop: () => (r.stop?.(), (run = null), draw(null)) }) }, q, options, draw, anon.checked, from);
    startBtn.textContent = 'Restart with these answers';
  };

  const start = () => {
    const q = question.value.trim();
    const typed = fields.map((f) => f.value.trim());
    const options = typed.filter(Boolean);
    if (!q) return say('Type a question first.'), question.focus();
    if (options.length < MIN_OPTIONS) return say(`Give at least ${MIN_OPTIONS} answers.`), fields[typed.findIndex((t) => !t)].focus();
    const gap = typed.findIndex((t, i) => !t && typed.slice(i + 1).some(Boolean));
    if (gap >= 0) return say(`Fill the answers in order: answer ${LETTERS[gap]} is empty.`), fields[gap].focus();
    if (session.online.length === 0) return say('No phones yet. Scan the QR code with a phone to join.');
    say('');
    begin(q, options);
  };
  startBtn.addEventListener('click', start);
  closeBtn.addEventListener('click', () => run?.dispatch({ type: last?.phase === 'open' ? 'close' : 'reopen' }));
  revealBtn.addEventListener('click', () => run?.dispatch({ type: 'reveal' }));
  anon.addEventListener('change', () => run?.dispatch({ type: 'anon', on: anon.checked }));

  const { el, say } = panel(
    `Ask the room a question. Every phone gets big answer buttons: no sign-up, no TV, up to ${MAX_IDS} phones. On Reveal the room becomes the chart, each answer a block of the crowd sized by its share.`,
    h('div.row', {}, h('label.grow', { for: 'poll-q' }, 'Question', question)),
    h(
      'div.poll-options',
      {},
      ...fields.map((f, i) => h('label.grow.poll-option', { for: f.id, style: `--c:${css(POLL_COLORS[i])}` }, `Answer ${LETTERS[i]}${i < MIN_OPTIONS ? '' : ' (optional)'}`, f)),
    ),
    h('label.check', { for: 'poll-anon' }, anon, anonText),
    h('div.row', {}, startBtn, closeBtn, revealBtn, stopButton(director)),
    summary,
    chart,
  );

  // A poll that was running when the host page reloaded picks up where it was.
  const saved = savedPoll(session.room);
  if (saved) {
    question.value = saved.question;
    saved.options.forEach((o, i) => (fields[i].value = o));
    anon.checked = saved.anon;
    begin(saved.question, saved.options, saved);
    say('The poll that was running before the reload carries on, votes and all.');
  }
  fillInOrder();
  return el;
}
