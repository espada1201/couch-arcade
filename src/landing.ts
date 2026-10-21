import { render, type WaveProgram } from './core/effects';
import { css, h } from './ui/dom';

/** Keeps test/dev overrides (transport, camera) when moving between pages. */
export function carry(params: URLSearchParams, extra: Record<string, string>): string {
  const q = new URLSearchParams();
  for (const k of ['transport', 'camera']) {
    const v = params.get(k);
    if (v) q.set(k, v);
  }
  for (const [k, v] of Object.entries(extra)) q.set(k, v);
  return `?${q}`;
}

/** A field of tiny phones running a ripple: the whole idea in one glance. */
function heroField(): HTMLCanvasElement {
  const c = h('canvas.hero-field', { 'aria-hidden': 'true' });
  const cols = 22;
  const rows = 9;
  const wave: WaveProgram = { kind: 'wave', t0: 0, period: 3600, shape: 'ripple', angle: 0, origin: { x: 0.18, y: 0.7 }, width: 0.16, rgb: [255, 176, 0], voice: 'off' };
  const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const draw = (t: number) => {
    const r = c.getBoundingClientRect();
    const dpr = devicePixelRatio || 1;
    if (c.width !== Math.round(r.width * dpr)) {
      c.width = Math.round(r.width * dpr);
      c.height = Math.round(r.height * dpr);
    }
    const ctx = c.getContext('2d')!;
    ctx.clearRect(0, 0, c.width, c.height);
    const cw = c.width / cols;
    const ch = c.height / rows;
    const aspect = c.width / c.height;
    for (let y = 0; y < rows; y++)
      for (let x = 0; x < cols; x++) {
        const pos = { x: x / (cols - 1), y: y / (rows - 1) };
        const f = render(wave, { seat: 0, pos, aspect }, reduced ? 1400 : t);
        ctx.fillStyle = css(f.rgb.map((v) => Math.max(v, 22)));
        const pw = cw * 0.42;
        const ph = ch * 0.7;
        ctx.beginPath();
        ctx.roundRect(x * cw + (cw - pw) / 2, y * ch + (ch - ph) / 2, pw, ph, pw * 0.18);
        ctx.fill();
      }
    if (!reduced && c.isConnected) requestAnimationFrame(draw);
  };
  requestAnimationFrame(draw);
  return c;
}

export function landing(app: HTMLElement, params: URLSearchParams): void {
  const code = h('input', { id: 'code', maxlength: 4, autocomplete: 'off', autocapitalize: 'characters', spellcheck: 'false', placeholder: 'ABCD', 'aria-describedby': 'code-hint' });
  const join = (e: Event) => {
    e.preventDefault();
    const v = code.value.trim().toUpperCase();
    if (/^[A-Z0-9]{4}$/.test(v)) location.search = carry(params, { room: v });
    else code.focus();
  };
  app.replaceChildren(
    h(
      'section.landing',
      {},
      heroField(),
      h(
        'div.landing-copy',
        {},
        h('h1.wordmark', {}, 'Swarm ', h('span', {}, 'Screen')),
        h('p.lede', {}, 'Every phone in the room is a pixel and a speaker. A camera works out where each one is sitting, then the crowd becomes one display: card stunts, light waves rolling across the floor, sound that travels from seat to seat, and games played with your body’s place in the room.'),
        h(
          'div.landing-actions',
          {},
          h('a.btn.primary', { href: carry(params, { host: '1' }) }, 'Host a room'),
          h(
            'form.join-form',
            { onsubmit: join },
            h('label', { for: 'code' }, 'Joining? Enter the room code'),
            h('div.join-row', {}, code, h('button.btn', { type: 'submit' }, 'Join')),
            h('small', { id: 'code-hint' }, 'Or just scan the QR code on the host screen.'),
          ),
        ),
      ),
    ),
  );
}
