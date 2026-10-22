import { h, type Child } from '../ui/dom';
import type { Director } from './director';
import type { HostSession } from './session';

/** A control panel: an intro line, the controls, and a status line at the bottom that `say` writes to. */
export function panel(intro: string, ...body: Child[]): { el: HTMLElement; say: (text: string) => void } {
  const msg = h('p.note', { role: 'status' });
  const el = h('div.panel-body', {}, h('p.panel-intro', {}, intro), ...body, msg);
  return { el, say: (text) => (msg.textContent = text) };
}

/** True when there are phones on the map; otherwise says so and returns false. */
export function requirePlaced(session: HostSession, say: (text: string) => void): boolean {
  if (session.layout.positions.size > 0) return true;
  say('Place some phones on the map first (Locate tab).');
  return false;
}

export function stopButton(director: Director, after?: () => void): HTMLButtonElement {
  return h('button.btn.ghost', { type: 'button', onclick: () => (director.idle(), after?.()) }, 'Stop');
}
