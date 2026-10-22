// What sits on top of a phone's screen (a connection problem, the seat form, the ballot)
// is a short list of layers. Each layer turns the program into a key; it is rebuilt only
// when its key changes, so typing and focus survive the many program updates per second.
import type { Program } from '../core/effects';
import { h } from '../ui/dom';
import type { PhoneClient } from './client';

/** The part of the client a layer reads. */
export type ClientView = Pick<PhoneClient, 'status' | 'error' | 'seat' | 'pos'>;

export interface Layer {
  readonly el: HTMLElement;
  /** Show or hide for this program; true when the layer has something to show. */
  update(p: Program, c: ClientView): boolean;
  hide(): void;
}

/**
 * A layer showing `build(...)` while `key` gives a key (null hides it). After a rebuild,
 * keyboard focus that was inside the layer moves to `focus`.
 */
export function layer(tag: string, key: (p: Program, c: ClientView) => string | null, build: (p: Program, c: ClientView) => Node, focus = '[aria-pressed="true"]'): Layer {
  const el = h(tag as 'div', { hidden: true });
  let shown: string | null = null;
  const hide = () => {
    if (shown === null) return;
    shown = null;
    el.hidden = true;
    el.replaceChildren();
  };
  return {
    el,
    hide,
    update(p, c) {
      const k = key(p, c);
      if (k === null) return hide(), false;
      if (k === shown) return true;
      const focused = el.contains(document.activeElement);
      shown = k;
      el.hidden = false;
      el.replaceChildren(build(p, c));
      if (focused) el.querySelector<HTMLElement>(focus)?.focus();
      return true;
    },
  };
}

/** Show the first layer that has something to show, and hide the others. */
export function showFirst(layers: Layer[], p: Program, c: ClientView): void {
  let taken = false;
  for (const l of layers) {
    if (!taken && l.update(p, c)) taken = true;
    else l.hide();
  }
}
