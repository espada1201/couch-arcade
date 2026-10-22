// The phone's overlay layers, in priority order: a connection problem, the seat form, the ballot.
import type { Program } from '../core/effects';
import { h } from '../ui/dom';
import type { PhoneClient } from './client';
import { layer, type ClientView, type Layer } from './layers';
import { ballot } from './poll';

/** Only while the phone can't take part: the room is full, it moved to another tab, or the host is gone. */
export function connectionKey(_p: Program, c: ClientView): string | null {
  return c.status === 'failed' || c.status === 'full' || c.status === 'replaced' ? `${c.status}:${c.error}` : null;
}

export function gridKey(p: Program, c: ClientView): string | null {
  return p.kind === 'grid' && c.status === 'live' ? `${p.rows}x${p.seats}` : null;
}

/** The ballot until Reveal; its key changes with the question, the phase and this phone's pick. */
export function ballotKey(p: Program, c: ClientView): string | null {
  return p.kind === 'poll' && !p.result && c.status === 'live' ? JSON.stringify([p.question, p.options, p.phase, p.mine]) : null;
}

export function overlays(client: PhoneClient, vote: (choice: number) => void): Layer[] {
  const connection = layer('div.overlay', connectionKey, (_p, c) => {
    const why = { full: 'This room is full.', replaced: 'This phone joined again in another tab, so this one has stepped aside.', failed: `Can’t reach the host. ${c.error}` }[c.status as 'full' | 'replaced' | 'failed'];
    return h(
      'div',
      {},
      h('p', {}, why),
      c.status === 'failed' ? h('button.btn.primary', { type: 'button', onclick: () => client.retry() }, 'Try again') : null,
    );
  });
  const grid = layer(
    'div.overlay',
    gridKey,
    (p) => {
      const { rows, seats } = p as Extract<Program, { kind: 'grid' }>;
      const row = h('input', { type: 'number', inputmode: 'numeric', min: 1, max: rows, required: true, id: 'row' });
      const seat = h('input', { type: 'number', inputmode: 'numeric', min: 1, max: seats, required: true, id: 'seatno' });
      const done = h('p.done', { hidden: true }, 'Got it. Hold tight.');
      return h(
        'form.seat-form',
        {
          onsubmit: (e: Event) => {
            e.preventDefault();
            client.enterSeat(Number(row.value), Number(seat.value));
            done.hidden = false;
          },
        },
        h('h2', {}, 'Where are you sitting?'),
        h('label', { for: 'row' }, `Row (1 = front, up to ${rows})`),
        row,
        h('label', { for: 'seatno' }, `Seat (1 = far left, up to ${seats})`),
        seat,
        h('button.btn.primary', { type: 'submit' }, 'Done'),
        done,
      );
    },
    'input',
  );
  const poll = layer('div.overlay', ballotKey, (p) => ballot(p as Extract<Program, { kind: 'poll' }>, vote), '.vote[aria-pressed="true"]');
  return [connection, grid, poll];
}
