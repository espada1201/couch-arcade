// The Swap row on Photo & cards: the phones on the map as buttons in the order they sit; pick two and they trade places.
import { seatsLeftToRight } from '../core/layout';
import { h, setText } from '../ui/dom';
import type { HostSession } from './session';

/** What the host reads once phones `a` and `b` (0-based) traded places; `order`: the seats left to right now. */
export function swapSaid(a: number, b: number, order: number[]): string {
  return `Swapped phones ${a + 1} and ${b + 1}. Left to right: ${order.map((s) => s + 1).join(', ')}.`;
}

/** What the buttons look like: the seats left to right, and which of them are away. The row is rebuilt only when this changes. */
export function swapShape(order: number[], away: ReadonlySet<number>): string {
  return JSON.stringify([order, order.map((s) => away.has(s))]);
}

/** A line about a swap, and the order it described. */
export interface SwapNote {
  text: string;
  order: number[];
}

/**
 * The line under the buttons. A picked phone is always said; what a swap said holds only while the phones
 * are still in the order it described (a scan, a new line-up or a drag on the map made it untrue).
 */
export function swapLine(picked: number | null, note: SwapNote | null, order: number[]): string {
  if (picked !== null) return `Phone ${picked + 1} picked. Now pick the phone to swap it with.`;
  return note && note.order.length === order.length && note.order.every((s, i) => s === order[i]) ? note.text : '';
}

/**
 * The phones on the map in the order they sit, as buttons: pick one, then another, and they trade places.
 * For a host whose line-up came out in the wrong order. Hidden until two phones are on the map.
 * `swapped` runs after a swap, for whatever on the page was made for the old places.
 */
export function swapPicker(session: HostSession, swapped?: (a: number, b: number) => void): HTMLElement {
  const row = h('div.swap-row', { role: 'group', 'aria-label': 'Phones on the map, left to right' });
  const said = h('p.note', { role: 'status' });
  const el = h('div.swap', { hidden: true }, h('p', {}, 'Wrong order? Pick two phones to swap their places.'), row, said);
  let picked: number | null = null;
  let note: SwapNote | null = null;
  /** The seat the host last chose, whose button gets the keyboard back if the row is rebuilt. */
  let chosen: number | null = null;
  let shape = '';
  const choose = (seat: number) => {
    chosen = seat;
    if (picked === null || picked === seat) {
      picked = picked === seat ? null : seat;
      return update();
    }
    const first = picked;
    picked = null;
    if (session.swapPlaces(first, seat)) {
      const order = seatsLeftToRight(session.layout.positions);
      note = { text: swapSaid(first, seat, order), order };
      update();
      swapped?.(first, seat);
    } else update();
  };
  const button = (seat: number, away: boolean) =>
    h(
      'button.chip',
      { type: 'button', 'data-seat': String(seat), 'data-offline': away ? 'true' : undefined, 'aria-label': away ? `Phone ${seat + 1}, away` : `Phone ${seat + 1}`, onclick: () => choose(seat) },
      String(seat + 1),
    );
  function update() {
    const order = seatsLeftToRight(session.layout.positions);
    const here = new Set(session.online.map((s) => s.seat));
    const away = new Set(order.filter((seat) => !here.has(seat)));
    el.hidden = order.length < 2;
    if (picked !== null && !order.includes(picked)) picked = null;
    // Every phone that says hello or changes shape calls this: the buttons are left alone unless they would look different,
    // or a keyboard host sitting on one loses their place.
    if (swapShape(order, away) !== shape) {
      shape = swapShape(order, away);
      const active = document.activeElement instanceof HTMLElement && row.contains(document.activeElement) ? Number(document.activeElement.dataset.seat) : null;
      row.replaceChildren(...order.map((seat) => button(seat, away.has(seat))));
      const back = chosen ?? active;
      if (back !== null) row.querySelector<HTMLElement>(`[data-seat="${back}"]`)?.focus();
    }
    chosen = null;
    row.querySelectorAll('button').forEach((b) => b.setAttribute('aria-pressed', String(Number(b.dataset.seat) === picked)));
    setText(said, swapLine(picked, note, order));
  }
  session.subscribe(update);
  update();
  return el;
}
