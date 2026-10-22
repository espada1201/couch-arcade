import { DIM, luma, render, type Frame } from '../core/effects';
import { pickTransport } from '../net/pick';
import { OPTICS_CHANNEL, type Optics } from '../core/protocol';
import { css, h } from '../ui/dom';
import { Speaker } from './audio';
import { PhoneClient } from './client';

function parseSim(v: string | null): { x: number; y: number } | undefined {
  const m = v?.match(/^([\d.]+),([\d.]+)$/);
  return m ? { x: Number(m[1]), y: Number(m[2]) } : undefined;
}

async function keepAwake(): Promise<void> {
  type WL = { request(t: 'screen'): Promise<unknown> };
  const wl = (navigator as Navigator & { wakeLock?: WL }).wakeLock;
  if (!wl) return;
  const grab = () => wl.request('screen').catch(() => {});
  await grab();
  document.addEventListener('visibilitychange', () => document.visibilityState === 'visible' && void grab());
}

export async function phoneView(app: HTMLElement, room: string, params: URLSearchParams): Promise<void> {
  document.body.classList.add('phone');
  const sim = parseSim(params.get('sim'));
  const { transport } = await pickTransport(params);
  const client = new PhoneClient(transport, room, sim);
  const speaker = new Speaker();

  const joinBtn = h('button.btn.primary.big', { type: 'button' }, 'Join the swarm');
  app.replaceChildren(
    h(
      'section.phone-gate',
      {},
      h('p.eyebrow', {}, 'Room'),
      h('p.room-code', {}, room),
      h('p.gate-copy', {}, 'Your phone is about to become one pixel and one speaker in something much bigger. Turn the brightness all the way up, sound on, and keep this page open.'),
      'wakeLock' in navigator ? null : h('p.gate-copy', {}, 'This phone can’t be kept awake from here, so set Auto-Lock (screen timeout) to Never for the show.'),
      joinBtn,
    ),
  );

  await new Promise<void>((resolve) => joinBtn.addEventListener('click', () => resolve(), { once: true }));
  speaker.unlock();
  document.documentElement.requestFullscreen?.().catch(() => {});
  void keepAwake();

  const label = h('div.label', { 'aria-live': 'polite' });
  const status = h('div.status', { role: 'status' });
  const overlay = h('div.overlay', { hidden: true });
  const screen = h('div.screen', {}, label, status, overlay);
  app.replaceChildren(screen);

  let frame: Frame = { rgb: DIM };
  let lastLum = -1;
  let lastPost = 0;
  let lastPaint = -Infinity;
  let lastCss = '';
  const optics = sim ? new BroadcastChannel(OPTICS_CHANNEL) : null;

  const paint = () => {
    lastPaint = performance.now();
    frame = render(client.program, { seat: client.seat, pos: client.pos, aspect: client.aspect }, client.hostNow());
    const bg = css(frame.rgb);
    if (bg !== lastCss) screen.style.backgroundColor = lastCss = bg;
    const text = frame.label ?? '';
    if (label.textContent !== text) label.textContent = text;
    const y = luma(frame.rgb);
    screen.classList.toggle('light', y > 150);
    if (optics && client.seat >= 0) {
      const lum = Math.round(y);
      const at = performance.timeOrigin + performance.now();
      if (lum !== lastLum || at - lastPost > 200) {
        optics.postMessage({ key: client.token, sim: sim!, lum, at } satisfies Optics);
        lastLum = lum;
        lastPost = at;
      }
    }
  };
  // rAF stops in background tabs; the interval keeps timing-critical output going anyway.
  const loop = () => {
    paint();
    requestAnimationFrame(loop);
  };
  requestAnimationFrame(loop);
  // While rAF is running it has painted moments ago, so the interval only steps in once rAF stalls.
  setInterval(() => performance.now() - lastPaint > 25 && paint(), 30);
  setInterval(() => speaker.pump(client.program, client.pos, client.aspect, client.hostNow()), 200);

  screen.addEventListener('pointerdown', (e) => {
    if (!frame.tappable || (e.target as HTMLElement).closest('.overlay')) return;
    navigator.vibrate?.(12);
    speaker.blip('tap');
    client.tap();
  });

  let lastHolder = -1;
  let wasOut = false;
  const showStatus = () => {
    const seat = client.seat >= 0 ? `Seat ${client.seat + 1}` : 'Joining';
    const place = client.pos ? 'placed' : 'not placed yet';
    const state = { connecting: 'connecting…', live: place, reconnecting: 'reconnecting…', full: 'room full', replaced: 'open in another tab', failed: 'disconnected' }[client.status];
    status.textContent = `${room} · ${seat} · ${state}`;
    status.dataset.state = client.status;

    const p = client.program;
    if (p.kind === 'potato') {
      const s = p.state;
      if (s.holder === client.seat && lastHolder !== client.seat && !s.out.includes(client.seat)) {
        navigator.vibrate?.([30, 40, 30]);
        speaker.blip('catch');
      }
      const out = s.out.includes(client.seat);
      if (out && !wasOut) {
        navigator.vibrate?.(400);
        speaker.blip('burn');
      }
      lastHolder = s.holder;
      wasOut = out;
    }

    if (client.status === 'failed' || client.status === 'full' || client.status === 'replaced') {
      overlay.hidden = false;
      const why = { full: 'This room is full.', replaced: 'This phone joined again in another tab, so this one has stepped aside.', failed: `Can’t reach the host. ${client.error}` }[client.status];
      overlay.replaceChildren(
        h('p', {}, why),
        ...(client.status === 'failed' ? [h('button.btn.primary', { type: 'button', onclick: () => client.retry() }, 'Try again')] : []),
      );
    } else if (p.kind === 'grid' && client.status === 'live') {
      const ask = `${p.rows}x${p.seats}`;
      if (overlay.hidden || overlay.dataset.ask !== ask) {
        overlay.dataset.ask = ask;
        overlay.hidden = false;
        const row = h('input', { type: 'number', inputmode: 'numeric', min: 1, max: p.rows, required: true, id: 'row' });
        const seat = h('input', { type: 'number', inputmode: 'numeric', min: 1, max: p.seats, required: true, id: 'seatno' });
        const done = h('p.done', { hidden: true }, 'Got it. Hold tight.');
        overlay.replaceChildren(
          h(
            'form.seat-form',
            {
              onsubmit: (e: Event) => {
                e.preventDefault();
                client.enterSeat(Number(row.value), Number(seat.value));
                done.hidden = false;
              },
            },
            h('h2', {}, 'Where are you sitting?'),
            h('label', { for: 'row' }, `Row (1 = front, up to ${p.rows})`),
            row,
            h('label', { for: 'seatno' }, `Seat (1 = far left, up to ${p.seats})`),
            seat,
            h('button.btn.primary', { type: 'submit' }, 'Done'),
            done,
          ),
        );
      }
    } else {
      overlay.hidden = true;
      delete overlay.dataset.ask;
      overlay.replaceChildren();
    }
  };
  client.onChange = showStatus;
  showStatus();
  await client.connect();
}
