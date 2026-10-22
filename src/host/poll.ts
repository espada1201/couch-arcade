// Room Poll on the host: a question with 2-4 answers goes to every phone, votes come
// back through the session, and Reveal turns the placed crowd into the chart. Phones
// don't need to be placed to vote; placement only decides who forms the chart.
import { MAX_IDS } from '../core/blinkcode';
import type { PollProgram } from '../core/effects';
import { LETTERS, MAX_OPTIONS, MIN_OPTIONS, POLL_COLORS, apportion, leaders, pollReduce, startPoll, tally, zones, type PollAction, type PollState } from '../core/poll';
import { css, h, plural } from '../ui/dom';
import type { Director } from './director';
import { runCrowd } from './crowd';
import { panel, stopButton } from './panel';
import type { HostSession } from './session';

export interface PollRun {
  dispatch(a: PollAction): void;
  counts(): number[];
}

/** Run a poll on the crowd until the director moves on. `show` hears every new state. */
export function runPoll(session: HostSession, director: Pick<Director, 'run'>, question: string, options: string[], show: (s: PollState) => void): PollRun {
  const crowd = runCrowd<PollState>(session, director, startPoll(question, options), {
    program: (s) => {
      const counts = tally(s);
      const result = s.phase === 'revealed' ? { pct: apportion(counts, 100), zones: zones(session.playRoom(), counts) } : null;
      return (seat): PollProgram => ({
        kind: 'poll',
        question: s.question,
        options: s.options,
        phase: s.phase,
        mine: s.votes.get(seat) ?? null,
        result: result && { pct: result.pct, zone: result.zones.get(seat) ?? null },
      });
    },
    input: { vote: (s, seat, m) => pollReduce(s, { type: 'vote', seat, choice: m.choice }) },
    // Phones that leave take their vote with them; joins and moves reshape the chart.
    roster: (s) => {
      const here = new Set(session.online.map((x) => x.seat));
      for (const seat of s.votes.keys()) if (!here.has(seat)) s = pollReduce(s, { type: 'leave', seat });
      return s;
    },
    show: (s) => show(s),
  });
  return {
    dispatch: (a) => crowd.dispatch((s) => pollReduce(s, a)),
    counts: () => {
      const s = crowd.state();
      return s ? tally(s) : options.map(() => 0);
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
  const anon = h('input', { type: 'checkbox', id: 'poll-anon', checked: true });
  const summary = h('p.score', { role: 'status', 'aria-live': 'polite' }, 'Phones vote without being placed. Place them to turn the room into the chart on Reveal.');
  const chart = h('ul.poll-chart', { 'aria-label': 'Results' });
  const startBtn = h('button.btn.primary', { type: 'button' }, 'Start the poll');
  const closeBtn = h('button.btn', { type: 'button', disabled: true }, 'Close voting');
  const revealBtn = h('button.btn', { type: 'button', disabled: true }, 'Reveal');
  let run: PollRun | null = null;
  let last: PollState | null = null;

  const draw = (s: PollState | null) => {
    last = s;
    closeBtn.disabled = revealBtn.disabled = !s;
    closeBtn.textContent = s && s.phase !== 'open' ? 'Reopen voting' : 'Close voting';
    revealBtn.disabled = !s || s.phase === 'revealed';
    if (!s) {
      summary.textContent = 'No poll running.';
      return chart.replaceChildren();
    }
    const counts = tally(s);
    const pct = apportion(counts, 100);
    const voted = s.votes.size;
    const hidden = anon.checked && s.phase !== 'revealed';
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
    const of = `${voted} of ${plural(session.online.length, 'phone')} voted`;
    const state = { open: 'Voting is open', closed: 'Voting is closed', revealed: 'Revealed' }[s.phase];
    summary.textContent = `${state} · ${of}. ${hidden ? 'Counts stay hidden until Reveal.' : verdict(s, counts, pct)}`;
  };

  const start = () => {
    const q = question.value.trim();
    const options = fields.map((f) => f.value.trim()).filter(Boolean);
    if (!q) return say('Type a question first.'), question.focus();
    if (options.length < MIN_OPTIONS) return say(`Give at least ${MIN_OPTIONS} answers.`), fields[options.length].focus();
    if (session.online.length === 0) return say('No phones yet. Scan the QR code with a phone to join.');
    say('');
    run = runPoll(session, { run: (r = {}) => director.run({ ...r, stop: () => (r.stop?.(), (run = null), draw(null)) }) }, q, options, draw);
    startBtn.textContent = 'Restart with these answers';
  };
  startBtn.addEventListener('click', start);
  closeBtn.addEventListener('click', () => run?.dispatch({ type: last?.phase === 'open' ? 'close' : 'reopen' }));
  revealBtn.addEventListener('click', () => run?.dispatch({ type: 'reveal' }));
  anon.addEventListener('change', () => last && draw(last));

  const { el, say } = panel(
    `Ask the room a question. Every phone gets big answer buttons: no sign-up, no TV, up to ${MAX_IDS} phones. On Reveal the room becomes the chart, each answer a block of the crowd sized by its share.`,
    h('div.row', {}, h('label.grow', { for: 'poll-q' }, 'Question', question)),
    h(
      'div.poll-options',
      {},
      ...fields.map((f, i) => h('label.grow.poll-option', { for: f.id, style: `--c:${css(POLL_COLORS[i])}` }, `Answer ${LETTERS[i]}${i < MIN_OPTIONS ? '' : ' (optional)'}`, f)),
    ),
    h('label.check', { for: 'poll-anon' }, anon, h('span', {}, 'Anonymous: hide the counts until Reveal')),
    h('div.row', {}, startBtn, closeBtn, revealBtn, stopButton(director)),
    summary,
    chart,
  );
  return el;
}
