import { h, type Child } from '../ui/dom';
import type { Director } from './director';
import type { HostSession } from './session';

export interface Notice {
  el: HTMLElement;
  /** A status line. Replaces whatever was said or failed before; '' clears both. */
  say(text: string): void;
  /** Something the host has to fix. Shown in the `.result` look, in red, brought into view, with an optional button. */
  fail(text: string, action?: { label: string; run: (button: HTMLElement) => void }): void;
}

/** Brings a message the host just caused into view if it sits below the fold or under the edge of the panel. */
function reveal(el: HTMLElement): void {
  if (el.isConnected) el.scrollIntoView({ block: 'nearest' });
}

/** A status line plus an error slot. Panels keep one at the bottom; a control that needs its own message keeps one beside it. */
export function notice(): Notice {
  const status = h('p.note', { role: 'status' });
  const alert = h('div.alert', { role: 'alert' });
  const el = h('div.notice', {}, status, alert);
  return {
    el,
    say(text) {
      const first = !status.textContent;
      if (alert.firstChild) alert.replaceChildren();
      if (status.textContent !== text) status.textContent = text;
      // Only the first line of a run is brought into view: a status that updates every frame must not keep scrolling the page.
      if (text && first) reveal(status);
    },
    fail(text, action) {
      status.textContent = '';
      alert.replaceChildren(text, ...(action ? [' ', h('button.btn.small', { type: 'button', onclick: (e: Event) => action.run(e.currentTarget as HTMLElement) }, action.label)] : []));
      reveal(alert);
    },
  };
}

/** A control panel: an intro line, the controls, and a status line at the bottom that `say` and `fail` write to. */
export function panel(intro: string, ...body: Child[]): Notice {
  const msg = notice();
  const el = h('div.panel-body', {}, h('p.panel-intro', {}, intro), ...body, msg.el);
  return { ...msg, el };
}

/** Asks the host page to show another tab. The tab strip lives in the host view; panels only send the request. */
export const GOTO_TAB = 'swarm:goto-tab';
export const gotoTab = (from: Element, id: string): boolean => from.dispatchEvent(new CustomEvent(GOTO_TAB, { bubbles: true, detail: id }));

/** True when there are phones on the map; otherwise says so, offers the way to Locate, and returns false. */
export function requirePlaced(session: HostSession, fail: Notice['fail']): boolean {
  if (session.layout.positions.size > 0) return true;
  fail('Place some phones on the map first.', { label: 'Go to Locate', run: (button) => gotoTab(button, 'locate') });
  return false;
}

export function stopButton(director: Director, after?: () => void): HTMLButtonElement {
  return h('button.btn.ghost', { type: 'button', onclick: () => (director.idle(), after?.()) }, 'Stop');
}
