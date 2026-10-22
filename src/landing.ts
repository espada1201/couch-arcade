import { cssFloor, makeWave, render } from './core/effects';
import { fitCanvas } from './ui/canvas';
import { h } from './ui/dom';

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
  const wave = makeWave(0, { period: 3600, shape: 'ripple', origin: { x: 0.8, y: 0.35 }, width: 0.16 });
  const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const draw = (t: number) => {
    if (fitCanvas(c)) {
      const ctx = c.getContext('2d')!;
      ctx.clearRect(0, 0, c.width, c.height);
      const cw = c.width / cols;
      const ch = c.height / rows;
      const aspect = c.width / c.height;
      const pw = cw * 0.42;
      const ph = ch * 0.7;
      const at = reduced ? 1400 : t + 1200;
      for (let y = 0; y < rows; y++)
        for (let x = 0; x < cols; x++) {
          const f = render(wave, { seat: 0, pos: { x: x / (cols - 1), y: y / (rows - 1) }, aspect }, at);
          ctx.fillStyle = cssFloor(f.rgb, 22);
          ctx.beginPath();
          ctx.roundRect(x * cw + (cw - pw) / 2, y * ch + (ch - ph) / 2, pw, ph, pw * 0.18);
          ctx.fill();
        }
    }
    if (!reduced && c.isConnected) requestAnimationFrame(draw);
  };
  requestAnimationFrame(draw);
  return c;
}

export function landing(app: HTMLElement, params: URLSearchParams): void {
  const code = h('input', { id: 'code', maxlength: 4, autocomplete: 'off', autocapitalize: 'characters', spellcheck: 'false', placeholder: 'ABCD', 'aria-describedby': 'code-hint code-error' });
  const error = h('small.error', { id: 'code-error', hidden: true }, 'Room codes are 4 letters or numbers, like ABCD.');
  const flag = (bad: boolean) => {
    if (bad) code.setAttribute('aria-invalid', 'true');
    else code.removeAttribute('aria-invalid');
    error.hidden = !bad;
  };
  code.addEventListener('input', () => flag(false));
  const join = (e: Event) => {
    e.preventDefault();
    const v = code.value.trim().toUpperCase();
    if (/^[A-Z0-9]{4}$/.test(v)) location.search = carry(params, { room: v });
    else {
      flag(true);
      code.focus();
    }
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
        h('p.lede', {}, h('strong', {}, 'Turn the phones in the room into a speaker, a screen and a light show. No app, no projector.')),
        h(
          'p.lede',
          {},
          'Everyone scans a QR code and their phone joins in seconds. Play sound across every phone, put words and pictures on every screen, flip a card stunt for a wedding or a birthday, count down to midnight together, ask the room a question and watch the answer light up the crowd, or play icebreaker games that need no TV.',
        ),
        h(
          'div.landing-actions',
          {},
          h('a.btn.primary', { href: carry(params, { host: '1' }) }, 'Host a room'),
          h(
            'form.join-form',
            { onsubmit: join },
            h('label', { for: 'code' }, 'Joining? Enter the room code'),
            h('div.join-row', {}, code, h('button.btn', { type: 'submit' }, 'Join')),
            error,
            h('small', { id: 'code-hint' }, 'Or just scan the QR code on the host screen.'),
          ),
        ),
      ),
    ),
  );
}
