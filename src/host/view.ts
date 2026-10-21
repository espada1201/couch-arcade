import qrcode from 'qrcode-generator';
import { carry } from '../landing';
import { pickTransport } from '../net/pick';
import { h } from '../ui/dom';
import { locatePanel } from './locate';
import { cardPanel, potatoPanel, soundPanel, territoryPanel, wavePanel, type Director } from './play';
import { HostSession } from './session';
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

const TRANSPORT_NOTES: Record<string, string> = {
  local: 'Test mode: open the link in other tabs of this browser.',
  lan: 'Wi-Fi mode: phones must be on the same network as this computer.',
  internet: 'Internet mode: phones on any network can join.',
};

export async function hostView(app: HTMLElement, params: URLSearchParams): Promise<void> {
  document.body.classList.add('host');
  const { transport, relay } = await pickTransport(params);
  const session = HostSession.restore(transport, params.has('fresh'));

  const status = h('p.boot', { role: 'status' }, 'Opening the room…');
  app.replaceChildren(status);
  try {
    await session.open();
  } catch (e) {
    status.replaceChildren(
      `Couldn’t open a room: ${e instanceof Error ? e.message : String(e)}. `,
      transport.name === 'internet' ? 'Check the internet connection, or run the app on your own computer with `npm start` to use Wi-Fi only. ' : '',
      h('button.btn', { type: 'button', onclick: () => location.reload() }, 'Try again'),
    );
    return;
  }

  const base = relay?.lanUrl ?? `${location.origin}${location.pathname}`;
  const q = new URLSearchParams(carry(params, { room: session.room }));
  q.delete('camera');
  const joinUrl = `${base}?${q}`;

  const stage = new Stage(session);
  let stopCurrent: (() => void) | undefined;
  const director: Director = {
    take(stop) {
      stopCurrent?.();
      stopCurrent = stop;
      stage.onPick = null;
    },
  };

  const count = h('span.count', { role: 'status' });
  const updateCount = () => {
    const online = session.online.length;
    const placed = [...session.layout.positions.keys()].filter((s) => session.seats.get(s)?.link).length;
    count.textContent = `${online} phone${online === 1 ? '' : 's'} · ${placed} placed`;
  };
  session.subscribe(updateCount);
  updateCount();

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

  const tabs: [string, string, () => HTMLElement][] = [
    ['locate', 'Locate', () => locatePanel(session, params, () => director.take())],
    ['card', 'Card stunt', () => cardPanel(session, director)],
    ['wave', 'Wave', () => wavePanel(session, stage, director)],
    ['sound', 'Sound', () => soundPanel(session, stage, director)],
    ['territory', 'Territory', () => territoryPanel(session, director)],
    ['potato', 'Hot Potato', () => potatoPanel(session, director)],
  ];
  const panels = new Map<string, HTMLElement>();
  const tablist = h('div.tabs', { role: 'tablist', 'aria-label': 'Experiences' });
  const panelHost = h('div.panel', { role: 'tabpanel', tabindex: 0 });
  const select = (id: string, focus = false) => {
    for (const b of tablist.querySelectorAll<HTMLButtonElement>('button')) {
      const on = b.dataset.tab === id;
      b.setAttribute('aria-selected', String(on));
      b.tabIndex = on ? 0 : -1;
      if (on && focus) b.focus();
      if (on) panelHost.setAttribute('aria-labelledby', b.id);
    }
    if (!panels.has(id)) panels.set(id, tabs.find((t) => t[0] === id)![2]());
    panelHost.replaceChildren(panels.get(id)!);
  };
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
            const d = k === 'ArrowRight' ? 1 : k === 'ArrowLeft' ? -1 : 0;
            if (d) select(tabs[(i + d + tabs.length) % tabs.length][0], true);
          },
        },
        h('span.tab-num', {}, String(i + 1).padStart(2, '0')),
        label,
      ),
    ),
  );

  app.replaceChildren(
    h(
      'div.console',
      {},
      h(
        'header.topbar',
        {},
        h('a.mark', { href: './', 'aria-label': 'Swarm Screen home' }, 'Swarm Screen'),
        h('span.room', {}, h('span.room-label', {}, 'Room'), h('span.room-code', { 'data-room': session.room }, session.room)),
        count,
        h('span.badge', { 'data-transport': transport.name }, transport.name === 'lan' ? 'Wi-Fi' : transport.name === 'local' ? 'This browser' : 'Internet'),
        h(
          'div.top-actions',
          {},
          h('button.btn.ghost.small', { type: 'button', onclick: () => (director.take(), session.setProgram({ kind: 'lobby' })) }, 'Lights off'),
          h('button.btn.ghost.small', { type: 'button', onclick: () => session.forgetOffline() }, 'Forget offline'),
          h(
            'button.btn.ghost.small',
            {
              type: 'button',
              onclick: () => {
                if (!confirm('Start a new room? Everyone will need to scan the new code.')) return;
                localStorage.removeItem('swarm-host');
                location.search = carry(params, { host: '1', fresh: '1' });
              },
            },
            'New room',
          ),
        ),
      ),
      h(
        'aside.join',
        { 'aria-label': 'Join this room' },
        h('div.qr', {}, qrSvg(joinUrl)),
        h('p.join-step', {}, 'Point a phone camera here, open the link and tap ', h('strong', {}, 'Join the swarm'), '.'),
        h('a.join-url', { href: joinUrl, target: '_blank', rel: 'noopener' }, joinUrl.replace(/^https?:\/\//, '')),
        copy,
        h('p.note', {}, TRANSPORT_NOTES[transport.name] ?? ''),
      ),
      stage.el,
      h('section.controls', { 'aria-label': 'Controls' }, tablist, panelHost),
    ),
  );
  select('locate');
}
