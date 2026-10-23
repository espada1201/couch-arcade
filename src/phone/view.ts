import { DIM, luma, render, type Frame, type Program } from '../core/effects';
import { pickTransport } from '../net/pick';
import { OPTICS_CHANNEL, type Optics } from '../core/protocol';
import { css, h, setText } from '../ui/dom';
import { FollowScreen, isJpegDataUrl } from '../ui/follow';
import { keepScreenOn } from '../ui/wakelock';
import { Speaker } from './audio';
import { PhoneClient } from './client';
import { showFirst } from './layers';
import { overlays, youVoted } from './overlays';
import { PartySpeaker } from './music';

function parseSim(v: string | null): { x: number; y: number } | undefined {
  const m = v?.match(/^([\d.]+),([\d.]+)$/);
  return m ? { x: Number(m[1]), y: Number(m[2]) } : undefined;
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
      h('p.gate-copy', {}, 'This phone becomes part of the room’s screen and speaker. Turn the brightness all the way up, turn the sound on, and keep this page open.'),
      h('p.gate-copy.gate-tip', {}, 'On an iPhone, switch Silent mode off first (the switch on the side) or you will hear nothing.'),
      joinBtn,
    ),
  );

  const awakeHint = h('p.awake-hint', { role: 'status', hidden: true }, 'This phone can’t keep itself awake, so set Auto-Lock (screen timeout) to Never for the show.');
  let hintTimer = 0;
  // Inside the tap itself: sound, full screen and the wake-lock video may each need one.
  await new Promise<void>((resolve) =>
    joinBtn.addEventListener(
      'click',
      () => {
        speaker.unlock();
        document.documentElement.requestFullscreen?.().catch(() => {});
        // Held for the life of the page: a phone that dims drops out of the picture.
        keepScreenOn((awake) => {
          document.documentElement.dataset.awake = awake;
          // Shown for a while each time: it comes back whenever the phone wakes from a sleep it couldn't prevent.
          awakeHint.hidden = awake !== 'none';
          clearTimeout(hintTimer);
          hintTimer = window.setTimeout(() => (awakeHint.hidden = true), 30000);
        });
        resolve();
      },
      { once: true },
    ),
  );

  const label = h('div.label', { 'aria-live': 'polite' });
  const status = h('div.status', { role: 'status' });
  // Said on the waiting screen until the host has put this phone on the map; the host does it, not the owner.
  const mapHint = h('p.map-hint', { hidden: true }, 'The host will put your phone on the map. You do not need to do anything. Keep this page open.');
  const layers = overlays(client, (choice) => (navigator.vibrate?.(12), client.vote(choice)));
  const mine = youVoted();
  const follow = new FollowScreen();
  const tile = h('img.tile-picture', { alt: '', hidden: true });
  const party = new PartySpeaker(client, speaker);
  client.onChunk = (m) => party.chunk(m);
  const screen = h('div.screen', {}, tile, label, follow.el, party.el, status, awakeHint, mapHint, mine.el, ...layers.map((l) => l.el));
  app.replaceChildren(screen);

  let frame: Frame = { rgb: DIM };
  let lastLum = -1;
  let lastPost = 0;
  let lastPaint = -Infinity;
  let won = false;
  let lastCss = '';
  const themeColor = document.querySelector('meta[name="theme-color"]');
  const optics = sim ? new BroadcastChannel(OPTICS_CHANNEL) : null;

  /** This phone's piece of the Photo wall, up from the flip instant; decoded beforehand so it appears with the rest. */
  let tileSrc = '';
  const showTile = (p: Program, t: number) => {
    const src = p.kind === 'tile' && isJpegDataUrl(p.src) ? p.src : null;
    if (src && src !== tileSrc) {
      tileSrc = src;
      tile.src = src;
      void tile.decode().catch(() => {});
    }
    tile.hidden = !(src && p.kind === 'tile' && t >= p.at);
  };

  const paint = () => {
    lastPaint = performance.now();
    frame = render(client.program, { seat: client.seat, pos: client.pos, aspect: client.aspect }, client.hostNow());
    const bg = css(frame.rgb);
    if (bg !== lastCss) {
      screen.style.backgroundColor = lastCss = bg;
      // The browser's bars take the frame's colour too, so the whole phone is one pixel of the picture.
      themeColor?.setAttribute('content', bg);
    }
    showTile(client.program, client.hostNow());
    const text = frame.label ?? '';
    setText(label, text);
    const win = text === 'WIN';
    if (win && !won) {
      navigator.vibrate?.([80, 60, 80, 60, 200]);
      speaker.blip('win');
    }
    won = win;
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
  setInterval(() => speaker.pump(client.program, client.programSeq, client.pos, client.aspect, client.hostNow()), 200);

  screen.addEventListener('pointerdown', (e) => {
    if (!frame.tappable || (e.target as HTMLElement).closest('.overlay')) return;
    navigator.vibrate?.(12);
    speaker.blip('tap');
    client.tap();
  });

  let lastHolder = -1;
  let wasOut = false;
  const showStatus = () => {
    party.sync();
    const seat = client.seat >= 0 ? `Seat ${client.seat + 1}` : 'Joining';
    const place = client.pos ? 'on the map' : 'not on the map yet';
    const state = { connecting: 'connecting…', live: place, reconnecting: 'reconnecting…', full: 'room full', replaced: 'open in another tab', failed: 'disconnected' }[client.status];
    setText(status, `${room} · ${seat} · ${state}`);
    status.dataset.state = client.status;
    mapHint.hidden = !(client.status === 'live' && !client.pos && client.program.kind === 'lobby');

    const p = client.program;
    follow.show(p.kind === 'follow' ? p.view : null);
    if (p.kind === 'potato') {
      const s = p.state;
      const out = s.out.includes(client.seat);
      if (s.holder === client.seat && lastHolder !== client.seat && !out) {
        navigator.vibrate?.([30, 40, 30]);
        speaker.blip('catch');
      }
      if (out && !wasOut) {
        navigator.vibrate?.(400);
        speaker.blip('burn');
      }
      lastHolder = s.holder;
      wasOut = out;
    }

    showFirst(layers, p, client);
    mine.update(p, client);
  };
  // Rotating the phone, or leaving full screen, changes the shape of its piece of a Photo wall.
  let resized = 0;
  window.addEventListener('resize', () => {
    clearTimeout(resized);
    resized = window.setTimeout(() => client.reportScreen(), 300);
  });
  client.onChange = showStatus;
  showStatus();
  await client.connect();
}
