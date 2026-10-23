import { h, plural, type Child } from '../ui/dom';
import type { Director } from './director';
import type { HostSession } from './session';

export interface Notice {
  el: HTMLElement;
  /** A status line. Replaces whatever was said or failed before; '' clears both. */
  say(text: string): void;
  /** Something the host has to fix. Shown in the `.result` look, in red, brought into view, with an optional button. */
  fail(text: string, action?: { label: string; run: (button: HTMLElement) => void }): void;
  /**
   * `fail` for an error that stays true only until `until` calls `done`: the error then goes by itself.
   * A status or another error that took its place stays. `until` returns how to stop listening.
   * Only one such error is waited on at a time.
   */
  failUntil(key: string, text: string, until: (done: () => void) => () => void, action?: { label: string; run: (button: HTMLElement) => void }): void;
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
  /** The `failUntil` key of the error the alert shows, or '' when it shows something else or nothing. */
  let shown = '';
  let stopWaiting: (() => void) | null = null;
  const write: Notice['fail'] = (text, action) => {
    status.textContent = '';
    alert.replaceChildren(text, ...(action ? [' ', h('button.btn.small', { type: 'button', onclick: (e: Event) => action.run(e.currentTarget as HTMLElement) }, action.label)] : []));
    reveal(alert);
  };
  return {
    el,
    say(text) {
      const first = !status.textContent;
      if (alert.firstChild) alert.replaceChildren();
      shown = '';
      if (status.textContent !== text) status.textContent = text;
      // Only the first line of a run is brought into view: a status that updates every frame must not keep scrolling the page.
      if (text && first) reveal(status);
    },
    fail(text, action) {
      shown = '';
      write(text, action);
    },
    failUntil(key, text, until, action) {
      stopWaiting?.();
      write(text, action);
      shown = key;
      stopWaiting = until(() => {
        stopWaiting?.();
        stopWaiting = null;
        if (shown !== key) return;
        shown = '';
        alert.replaceChildren();
      });
    },
  };
}

/** A control panel: an intro line, the controls, and a status line at the bottom that `say` and `fail` write to. */
export function panel(intro: string, ...body: Child[]): Notice {
  const msg = notice();
  const el = h('div.panel-body', {}, h('p.panel-intro', {}, intro), ...body, msg.el);
  return { ...msg, el };
}

export function footedPanel(intro: string, body: Child[], foot: Child[]): Notice & { show(el: HTMLElement): void } {
  const msg = notice();
  const bar = h('div.panel-foot', {}, ...foot, msg.el);
  const el = h('div.panel-body', {}, h('p.panel-intro', {}, intro), ...body, bar);
  // A message that wraps makes the bar taller; scrolling to a field must stop above the bar, whatever its height.
  const measureBar = () => el.style.setProperty('--foot-h', `${bar.offsetHeight}px`);
  new ResizeObserver(measureBar).observe(bar);
  return {
    ...msg,
    el,
    // The observer runs after the frame, so a message just written has not made the bar taller yet: measure it now.
    show(target) {
      measureBar();
      target.scrollIntoView({ block: 'nearest' });
      // "nearest" leaves a target that only the bar's margin overlaps where it is, so its foot would sit under the bar.
      const r = target.getBoundingClientRect();
      const barTop = bar.getBoundingClientRect().top;
      const roof = Math.max(0, el.parentElement?.getBoundingClientRect().top ?? 0);
      if (r.bottom > barTop + 0.5 && r.height <= barTop - roof) target.scrollIntoView({ block: 'end' });
    },
  };
}

/** Asks the host page to show another tab. The tab strip lives in the host view; panels only send the request. */
export const GOTO_TAB = 'swarm:goto-tab';
export const gotoTab = (from: Element, id: string): boolean => from.dispatchEvent(new CustomEvent(GOTO_TAB, { bubbles: true, detail: id }));

export const ALL_PLACED = 'swarm:all-placed';

/**
 * True when there are phones on the map; otherwise says so on `notice`, offers the way to Locate, and returns false.
 * The message goes again as soon as a phone is on the map.
 */
export function requirePlaced(session: HostSession, notice: Notice): boolean {
  if (session.layout.positions.size > 0) return true;
  const action = { label: 'Go to Locate', run: (button: HTMLElement) => gotoTab(button, 'locate') };
  notice.failUntil('needs-placement', 'Place some phones on the map first.', (done) => session.subscribe(() => session.layout.positions.size > 0 && done()), action);
  return false;
}

/**
 * A boxed pointer for panels where people look for a photo spread across the phones.
 * `lead` says what this tab does instead, so the host knows why they are being sent away.
 */
export function cardStuntPointer(lead: string): HTMLElement {
  return h(
    'div.pointer',
    {},
    h('p', {}, lead ? `${lead} ` : '', 'For one photo spread across the phones, each showing its own piece, use ', h('strong', {}, 'Photo & cards'), '.'),
    h('button.btn.small', { type: 'button', onclick: (e: Event) => gotoTab(e.currentTarget as HTMLElement, 'card') }, 'Go to Photo & cards'),
  );
}

/**
 * The up-front version of `requirePlaced`: how many connected phones are on the map right now, kept
 * live, with the way to Locate while some are not. For every panel that only works on placed phones.
 * `lineUp` adds a main button that puts the phones that are not on the map in a row, for panels that can use one.
 */
export function placementNote(session: HostSession, needs: string, lineUp?: () => void): HTMLElement {
  const text = h('p', {});
  const row = lineUp && h('button.btn.small.primary', { type: 'button', onclick: lineUp }, 'Line them up for me');
  const go = h('button.btn.small', { type: 'button', onclick: (e: Event) => gotoTab(e.currentTarget as HTMLElement, 'locate') }, 'Go to Locate');
  const el = h('div.needs', { role: 'status' }, text, row, go);
  const update = () => {
    const online = session.online.length;
    const onMap = session.playRoom().positions.size;
    go.hidden = online === 0 || onMap === online;
    if (row) row.hidden = go.hidden;
    if (online === 0) text.textContent = `${needs} No phones have joined yet. Scan the QR code with a phone to join.`;
    else if (onMap === online) text.textContent = `${needs} ${online === 1 ? 'Your phone is' : `All ${online} phones are`} on the map.`;
    else text.textContent = `${needs} ${onMap} of ${plural(online, 'phone')} ${online === 1 && onMap === 0 ? 'is' : 'are'} on the map.`;
  };
  session.subscribe(update);
  update();
  return el;
}

/** What the host reads once `seats` (0-based) were put in a row; `after`: some phones were already on the map. */
export function lineUpSaid(seats: number[], after: boolean): string {
  const n = seats.map((s) => s + 1);
  if (n.length === 1) return `Done. Phone ${n[0]} is on the map${after ? ' after the others' : ''}.`;
  const run = n.length > 2 && n.every((v, i) => v === n[0] + i);
  const list = run ? `${n[0]} to ${n[n.length - 1]}` : `${n.slice(0, -1).join(', ')} and ${n[n.length - 1]}`;
  return `Done. Phones ${list} are in a row${after ? ' after the ones already on the map' : ''}, phone ${n[0]} on the left. Ask your friends to hold or lay their phones in that order.`;
}

export function stopButton(director: Director, after?: () => void): HTMLButtonElement {
  return h('button.btn.ghost', { type: 'button', onclick: () => (director.idle(), after?.()) }, 'Stop');
}
