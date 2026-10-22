// The phone's ballot: the question and one big button per answer, each in its own
// colour and lettered, so the choice never rests on colour alone.
import type { PollProgram } from '../core/effects';
import { LETTERS, POLL_COLORS } from '../core/poll';
import { css, h } from '../ui/dom';

/** Put the ballot in `overlay`, rebuilding only when it changed and keeping keyboard focus on the pick. */
export function showBallot(overlay: HTMLElement, p: PollProgram, vote: (choice: number) => void): void {
  const key = JSON.stringify([p.question, p.options, p.phase, p.mine]);
  if (!overlay.hidden && overlay.dataset.ask === key) return;
  const focused = overlay.contains(document.activeElement);
  overlay.dataset.ask = key;
  overlay.hidden = false;
  overlay.replaceChildren(ballot(p, vote));
  if (focused) overlay.querySelector<HTMLElement>('.vote[aria-pressed="true"]')?.focus();
}

function ballot(p: PollProgram, vote: (choice: number) => void): HTMLElement {
  const open = p.phase === 'open';
  const buttons = p.options.map((name, i) =>
    h(
      'button.vote',
      {
        type: 'button',
        style: `--c:${css(POLL_COLORS[i])}`,
        'aria-pressed': String(p.mine === i),
        disabled: !open,
        onclick: () => {
          // Show the pick at once; the host's echo confirms it a moment later.
          for (const b of buttons) b.setAttribute('aria-pressed', String(b === buttons[i]));
          vote(i);
        },
      },
      h('span.vote-letter', { 'aria-hidden': 'true' }, LETTERS[i]),
      h('span.vote-name', {}, name),
    ),
  );
  const note = open ? (p.mine === null ? 'Tap your answer. You can change it until voting closes.' : 'Vote in. Tap another answer to change it.') : 'Voting is closed. Watch the room for the result.';
  return h('div.ballot', { role: 'group', 'aria-labelledby': 'ballot-q' }, h('h2', { id: 'ballot-q' }, p.question), ...buttons, h('p.ballot-note', { role: 'status' }, note));
}
