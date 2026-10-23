import qrcode from 'qrcode-generator';
import { carry } from '../landing';
import { RoomTakenError, type ServerState } from '../net/transport';
import { pickTransport } from '../net/pick';
import { errorText, h, plural, setText } from '../ui/dom';
import { followPanel } from './follow';
import { livePanel } from './live';
import { locatePanel } from './locate';
import { Director } from './director';
import { ALL_PLACED, GOTO_TAB } from './panel';
import { cardPanel, potatoPanel, soundPanel, territoryPanel, wavePanel } from './play';
import { pollPanel, savedPoll } from './poll';
import { HostSession } from './session';
import { showPanel } from './show';
import { Stage } from './stage';

function qrSvg(text: string): SVGSVGElement {
  const qr = qrcode(0, 'M');
  qr.addData(text);
  qr.make();
  const n = qr.getModuleCount();
  const m = 2;
  let d = '';
  for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) if (qr.isDark(y, x)) d += `M${x + m},${y + m}h1v1h-1z`;
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', `0 0 ${n + 2 * m} ${n + 2 * m}`);
  svg.setAttribute('role', 'img');
  svg.setAttribute('aria-label', 'QR code to join this room');
  svg.innerHTML = `<rect width="100%" height="100%" fill="#f2ead8"/><path d="${d}" fill="#0e0d0b" shape-rendering="crispEdges"/>`;
  return svg;
}

/** What the header says while phones can't reach the room. */
const SERVER_SAYS: Record<ServerState, string> = {
  up: '',
  down: 'Reconnecting to the room server…',
  moved: 'This room moved to another tab',
  taken: 'Another host took this room code while this page was away. Start a new room.',
};

const TRANSPORTS: Record<string, { badge: string; note: string }> = {
  local: { badge: 'This browser', note: 'Test mode: open the link in other tabs of this browser.' },
  lan: { badge: 'Wi-Fi', note: 'Wi-Fi mode: phones must be on the same network as this computer.' },
  internet: { badge: 'Internet', note: 'Internet mode: phones on any network can join.' },
};

export async function hostView(app: HTMLElement, params: URLSearchParams): Promise<void> {
  document.body.classList.add('host');
  const { transport, relay } = await pickTransport(params);
  const mode = TRANSPORTS[transport.name] ?? TRANSPORTS.internet;
  const fresh = params.has('fresh');
  let session = HostSession.restore(transport, fresh);

  const status = h('p.boot', { role: 'status' }, 'Opening the room…');
  app.replaceChildren(status);
  const newRoom = () => {
    HostSession.forget();
    location.search = carry(params, { host: '1', fresh: '1' });
  };
  for (let attempt = 0; ; attempt++) {
    try {
      await session.open();
      break;
    } catch (e) {
      // A brand-new code that happens to be taken: quietly roll another.
      if (fresh && attempt < 3 && e instanceof RoomTakenError) {
        session = HostSession.restore(transport, true);
        continue;
      }
      status.replaceChildren(
        `Couldn’t open room ${session.room}: ${errorText(e)}. `,
        transport.name === 'internet' ? 'Check the internet connection, or run the app on your own computer with `npm start` to use Wi-Fi only. ' : '',
        h('span.row', {}, h('button.btn', { type: 'button', onclick: () => location.reload() }, 'Try again'), h('button.btn.primary', { type: 'button', onclick: newRoom }, 'Start a new room')),
      );
      return;
    }
  }

  if (fresh) {
    // A reload must come back to this room, not roll yet another one.
    const q = new URLSearchParams(location.search);
    q.delete('fresh');
    history.replaceState(history.state, '', `${location.pathname}?${q}${location.hash}`);
  }

  const base = relay?.lanUrl ?? `${location.origin}${location.pathname}`;
  const q = new URLSearchParams(carry(params, { room: session.room }));
  q.delete('camera');
  const joinUrl = `${base}?${q}`;

  const director = new Director(session);
  const stage = new Stage(session, director);

  const count = h('span.count', { role: 'status' });
  // The sync figure never splits across two lines when the bar is tight.
  const updateCount = () => {
    const server = SERVER_SAYS[session.server];
    if (server) return setText(count, server);
    const online = session.online.length;
    const placed = [...session.layout.positions.keys()].filter((s) => session.seats.get(s)?.link).length;
    const sync = session.worstSync;
    setText(count, `${plural(online, 'phone')} · ${online ? `${placed} of ${online}` : placed} on the map` + (online && Number.isFinite(sync) ? ` · in\u00a0sync\u00a0to\u00a0±${sync}\u00a0ms` : online ? ' · syncing…' : ''));
  };
  session.subscribe(updateCount);
  updateCount();
  // Sync quality arrives with every ping, which is not a roster change; refresh it on a clock.
  setInterval(updateCount, 1000);

  const skip = h('a.skip-link', { href: '#controls' }, 'Skip to controls');
  skip.addEventListener('click', (e) => {
    e.preventDefault();
    tablist.querySelector<HTMLElement>('[aria-selected=true]')?.focus();
  });

  const copy = h('button.btn.ghost.small', { type: 'button' }, 'Copy link');
  copy.addEventListener('click', async () => {
    try {
      await navigator.clipboard.writeText(joinUrl);
      copy.textContent = 'Copied';
    } catch {
      copy.textContent = 'Select and copy the link';
    }
    setTimeout(() => (copy.textContent = 'Copy link'), 1800);
  });

  // The ones hosts come for first, then the rest.
  const tabs: [string, string, () => HTMLElement][] = [
    ['locate', 'Locate', () => locatePanel(session, params, director)],
    ['music', 'Music', () => soundPanel(session, director)],
    ['big', 'Big screen', () => followPanel(session, director)],
    ['poll', 'Poll', () => pollPanel(session, director)],
    ['show', 'Show', () => showPanel(session, director)],
    ['card', 'Photo & cards', () => cardPanel(session, director)],
    ['live', 'Live screen', () => livePanel(session, director)],
    ['wave', 'Wave', () => wavePanel(session, stage, director)],
    ['territory', 'Territory', () => territoryPanel(session, director)],
    ['potato', 'Hot Potato', () => potatoPanel(session, director)],
  ];
  const panels = new Map<string, HTMLElement>();
  const tablist = h('div.tabs', { role: 'tablist', 'aria-label': 'Experiences' });
  const panelHost = h('div.panel', { role: 'tabpanel' });
  // A panel with something to operate sends Tab straight to it. Only a panel with nothing to operate becomes a stop of its own, so it can still be scrolled with the keys.
  const FOCUSABLE = 'a[href], button, input, select, textarea, summary, [tabindex]';
  const syncPanelStop = () => {
    const inside = [...panelHost.querySelectorAll<HTMLElement>(FOCUSABLE)].some((el) => !el.matches(':disabled') && el.tabIndex >= 0 && !el.closest('[hidden]'));
    if (inside) panelHost.removeAttribute('tabindex');
    else panelHost.tabIndex = 0;
  };
  new MutationObserver(syncPanelStop).observe(panelHost, { subtree: true, childList: true, attributes: true, attributeFilter: ['disabled', 'hidden', 'tabindex'] });
  /** In a short window the tabs scroll sideways: keep the chosen one in sight. */
  const showTab = (b: HTMLElement) => {
    const edge = b.offsetLeft + b.offsetWidth - tablist.clientWidth;
    if (b.offsetLeft < tablist.scrollLeft) tablist.scrollLeft = b.offsetLeft;
    else if (edge > tablist.scrollLeft) tablist.scrollLeft = edge;
  };
  let current = '';
  let back: HTMLButtonElement | null = null;
  /** `from`: the tab that sent the host here with "Go to …", so the way back is one press. */
  const select = (id: string, focus = false, from: string | null = null) => {
    current = id;
    for (const b of tablist.querySelectorAll<HTMLButtonElement>('button')) {
      const on = b.dataset.tab === id;
      b.setAttribute('aria-selected', String(on));
      b.tabIndex = on ? 0 : -1;
      if (on && focus) b.focus();
      if (on) panelHost.setAttribute('aria-labelledby', b.id);
      if (on) showTab(b);
    }
    if (!panels.has(id)) panels.set(id, tabs.find((t) => t[0] === id)![2]());
    back = from ? h('button.btn.small', { type: 'button', onclick: () => select(from, true) }, `Back to ${tabs.find((t) => t[0] === from)![1]}`) : null;
    panelHost.replaceChildren(h('h2.sr-only', {}, tabs.find((t) => t[0] === id)![1]), ...(back ? [h('div.back-to', {}, back, h('span', {}, ' when you are done here.'))] : []), panels.get(id)!);
    // Every tab opens at its top, not wherever the last one was scrolled to.
    panelHost.scrollTop = 0;
    syncPanelStop();
  };
  // A panel can send the host to another tab ("Go to Locate"); the tab strip lives here.
  panelHost.addEventListener(GOTO_TAB, (e) => select((e as CustomEvent<string>).detail, true, current));
  // A scan that placed everyone ends at the way back to the task that sent the host here, if there is one.
  panelHost.addEventListener(ALL_PLACED, (e) => back && (back.focus(), e.preventDefault()));
  tabs.forEach(([id, label], i) =>
    tablist.append(
      h(
        'button.tab',
        {
          type: 'button',
          role: 'tab',
          id: `tab-${id}`,
          'data-tab': id,
          onclick: () => select(id),
          onkeydown: (e: Event) => {
            const k = (e as KeyboardEvent).key;
            const to = k === 'Home' ? 0 : k === 'End' ? tabs.length - 1 : k === 'ArrowRight' ? (i + 1) % tabs.length : k === 'ArrowLeft' ? (i + tabs.length - 1) % tabs.length : -1;
            if (to < 0) return;
            (e as KeyboardEvent).preventDefault();
            select(tabs[to][0], true);
          },
        },
        h('span.tab-num', {}, String(i + 1).padStart(2, '0')),
        label,
      ),
    ),
  );

  app.replaceChildren(
    skip,
    h(
      'div.console',
      {},
      h('h1.sr-only', {}, 'Swarm Screen host console'),
      h(
        'header.topbar',
        {},
        h('a.mark', { href: './', 'aria-label': 'Swarm Screen home' }, 'Swarm Screen'),
        h('span.room', {}, h('span.room-label', {}, 'Room'), h('span.room-code', { 'data-room': session.room }, session.room)),
        count,
        h('span.badge', { 'data-transport': transport.name }, mode.badge),
        h(
          'div.top-actions',
          {},
          h('button.btn.ghost.small', { type: 'button', title: 'Stop whatever is running. Every phone goes back to its dim waiting screen.', onclick: () => director.idle() }, 'Lights off'),
          // Whatever runs keeps running; a poll drops the forgotten phones' votes.
          h('button.btn.ghost.small', { type: 'button', title: 'Take phones that have lost their connection off the map and the count. Connected phones stay.', onclick: () => session.forgetOffline() }, 'Remove disconnected phones'),
          h(
            'button.btn.ghost.small',
            {
              type: 'button',
              onclick: () => confirm('Start a new room? Everyone will need to scan the new code.') && newRoom(),
            },
            'New room',
          ),
        ),
      ),
      h(
        'aside.join',
        { 'aria-label': 'Join this room' },
        h('h2.sr-only', {}, 'Join this room'),
        h('div.qr', {}, qrSvg(joinUrl)),
        h('p.join-step', {}, 'Point a phone camera here, open the link and tap ', h('strong', {}, 'Join the swarm'), '.'),
        h('a.join-url', { href: joinUrl, target: '_blank', rel: 'noopener' }, joinUrl.replace(/^https?:\/\//, '')),
        copy,
        h('p.note', {}, mode.note),
      ),
      stage.el,
      h('section.controls', { id: 'controls', 'aria-label': 'Controls' }, tablist, panelHost),
    ),
  );
  // A poll that was running when this page reloaded carries on in its tab.
  select(savedPoll(session.room) ? 'poll' : 'locate');
}
