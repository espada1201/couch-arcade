// Draws a Follow view (picture, text card, captions) full size inside its box. The
// phone uses it full screen; the host uses the same thing as a small preview, so what
// the host sees is exactly what the crowd sees.
import type { FollowView } from '../core/follow';
import { fitText, type Measure } from '../core/textfit';
import { h } from './dom';

const JPEG = 'data:image/jpeg;base64,';

/** Only a JPEG data URL is ever shown: a message never points the phone at an outside address. */
export const isJpegDataUrl = (src: string): boolean => src.startsWith(JPEG);
const LINE_HEIGHT = 1.15;
/** Measured widths are trusted to within this, so real glyph metrics never spill over the edge. */
const WIDTH_SLACK = 0.94;

let measureCtx: CanvasRenderingContext2D | null = null;
function measurer(el: HTMLElement): Measure {
  measureCtx ??= document.createElement('canvas').getContext('2d')!;
  const ctx = measureCtx;
  const cs = getComputedStyle(el);
  return (text, size) => {
    ctx.font = `${cs.fontWeight} ${size}px ${cs.fontFamily}`;
    return ctx.measureText(text).width;
  };
}

export class FollowScreen {
  readonly el: HTMLElement;
  private readonly img: HTMLImageElement;
  private readonly text = h('div.follow-text');
  private readonly count = h('p.follow-count');
  private view: FollowView | null = null;

  /** `label` is the picture's alt text. */
  constructor(extraClass = '', label = 'What the host is showing') {
    this.img = h('img.follow-picture', { alt: label });
    this.el = h(`div.follow${extraClass ? `.${extraClass}` : ''}`, { hidden: true }, this.img, this.text, this.count);
    new ResizeObserver(() => this.fit()).observe(this.el);
    void document.fonts?.ready.then(() => this.fit());
  }

  /** Show a view, or hide (null). Showing the same view object again costs nothing. */
  show(view: FollowView | null): void {
    if (view === this.view) return;
    this.view = view;
    this.el.hidden = !view;
    if (!view) return;
    this.el.dataset.show = view.show;
    const picture = view.show === 'picture';
    this.img.hidden = !picture;
    this.text.hidden = picture;
    if (picture) {
      // Only ever a JPEG data URL: never let a message point the phone at an outside address.
      if (isJpegDataUrl(view.src) && this.img.getAttribute('src') !== view.src) this.img.src = view.src;
    }
    this.count.textContent = view.show === 'card' && view.of > 1 ? `${view.n} / ${view.of}` : '';
    this.fit();
  }

  /** Lay the text out at the largest size that fits the box. */
  private fit(): void {
    const v = this.view;
    if (!v || v.show === 'picture') return;
    const words = v.show === 'card' ? v.text : v.show === 'wait' ? v.text : v.lines.length ? v.lines.join('\n') : 'Listening…';
    const cs = getComputedStyle(this.el);
    const w = (this.el.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight)) * WIDTH_SLACK;
    const hh = this.el.clientHeight - parseFloat(cs.paddingTop) - parseFloat(cs.paddingBottom);
    if (w <= 0 || hh <= 0) return;
    // Captions hold a steady size as lines come and go; cards and notes fill the screen.
    const max = v.show === 'captions' ? hh / 4.2 : v.show === 'wait' ? hh / 10 : hh * 0.45;
    const fit = fitText(words, { w, h: hh }, measurer(this.text), { min: 14, max, lineHeight: LINE_HEIGHT });
    const last = fit.lines.at(-1)?.para;
    const interim = v.show === 'captions' && v.interim;
    this.text.style.fontSize = `${fit.size}px`;
    // A space between the line boxes keeps the words apart for screen readers and copy-paste.
    this.text.replaceChildren(...fit.lines.flatMap((l, i) => [i ? ' ' : '', h('span', { class: interim && l.para === last ? 'interim' : undefined }, l.text)]));
  }
}
