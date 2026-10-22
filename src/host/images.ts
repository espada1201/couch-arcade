// Pictures for the card stunt. Everything is drawn on a canvas so it can be sampled
// per phone: built-in designs, the host's own words, or an uploaded photo.
import type { Image } from '../core/layout';
import { canvas2d } from '../ui/canvas';

export const STUNT_SIZE = 240;

function toImage(c: HTMLCanvasElement): Image {
  const data = c.getContext('2d')!.getImageData(0, 0, c.width, c.height).data;
  return { w: c.width, h: c.height, data };
}

export interface Stunt {
  name: string;
  canvas: HTMLCanvasElement;
  image: Image;
}

function make(name: string, draw: (ctx: CanvasRenderingContext2D, s: number) => void): Stunt {
  const [c, ctx] = canvas2d(STUNT_SIZE, STUNT_SIZE);
  draw(ctx, STUNT_SIZE);
  return { name, canvas: c, image: toImage(c) };
}

let built: Stunt[] | null = null;

/** The built-in pictures, drawn once and shared (nothing draws on them afterwards). */
export function presets(): Stunt[] {
  return (built ??= [
    make('Sunrise', (ctx, s) => {
      const g = ctx.createLinearGradient(0, 0, 0, s);
      g.addColorStop(0, '#16233b');
      g.addColorStop(0.55, '#ff6a2b');
      g.addColorStop(1, '#ffd166');
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, s, s);
      ctx.fillStyle = '#fff3c4';
      ctx.beginPath();
      ctx.arc(s / 2, s * 0.78, s * 0.22, 0, Math.PI * 2);
      ctx.fill();
    }),
    make('Bullseye', (ctx, s) => {
      ['#ffb000', '#0e0d0b', '#ffb000', '#0e0d0b', '#f2ead8'].forEach((c, i) => {
        ctx.fillStyle = c;
        ctx.beginPath();
        ctx.arc(s / 2, s / 2, s * 0.75 - i * s * 0.15, 0, Math.PI * 2);
        ctx.fill();
      });
    }),
    make('Stripes', (ctx, s) => {
      ['#00c4b4', '#f2ead8', '#ff5a36'].forEach((c, i) => {
        ctx.fillStyle = c;
        ctx.fillRect((i * s) / 3, 0, s / 3 + 1, s);
      });
    }),
    make('Heart', (ctx, s) => {
      ctx.fillStyle = INK;
      ctx.fillRect(0, 0, s, s);
      heart(ctx, 0, 0, s);
    }),
  ]);
}

const INK = '#0e0d0b';
const GOLD = '#ffb000';
const ROSE = '#ff3b4f';

/** A heart filling the s-by-s square at (x, y). */
function heart(ctx: CanvasRenderingContext2D, x: number, y: number, s: number): void {
  ctx.fillStyle = ROSE;
  ctx.beginPath();
  ctx.moveTo(x + s / 2, y + s * 0.85);
  ctx.bezierCurveTo(x + s * 0.05, y + s * 0.55, x + s * 0.12, y + s * 0.12, x + s / 2, y + s * 0.3);
  ctx.bezierCurveTo(x + s * 0.88, y + s * 0.12, x + s * 0.95, y + s * 0.55, x + s / 2, y + s * 0.85);
  ctx.fill();
}

/** A heart in a line of words. */
export const HEART = Symbol('heart');
type Piece = string | typeof HEART;

/**
 * Lines of big words (and hearts) shaped to the crowd: the canvas takes the room's
 * aspect so nothing is cropped, each line gets an equal band, and each is shrunk to fit.
 */
function wordsStunt(name: string, lines: Piece[][], aspect: number, color = GOLD): Stunt {
  const w = STUNT_SIZE * Math.max(1, aspect);
  const hgt = STUNT_SIZE * Math.max(1, 1 / aspect);
  const [c, ctx] = canvas2d(Math.round(w), Math.round(hgt));
  ctx.fillStyle = INK;
  ctx.fillRect(0, 0, c.width, c.height);
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  const band = c.height / lines.length;
  const font = (size: number) => (ctx.font = `900 ${size}px "Archivo Variable", sans-serif`);
  lines.forEach((line, row) => {
    const gap = (size: number) => size * 0.2;
    const widths = (size: number) => (font(size), line.map((p) => (p === HEART ? size * 0.9 : ctx.measureText(p).width)));
    const total = (size: number) => widths(size).reduce((a, b) => a + b, 0) + gap(size) * (line.length - 1);
    let size = band * 0.8;
    while (size > 8 && total(size) > c.width * 0.92) size *= 0.9;
    const ws = widths(size);
    const cy = band * (row + 0.5);
    let x = (c.width - total(size)) / 2;
    line.forEach((p, i) => {
      if (p === HEART) heart(ctx, x, cy - ws[i] * 0.55, ws[i]);
      else {
        ctx.fillStyle = color;
        ctx.fillText(p, x + ws[i] / 2, cy);
      }
      x += ws[i] + gap(size);
    });
  });
  return { name, canvas: c, image: toImage(c) };
}

export function textStunt(text: string, aspect: number): Stunt {
  return wordsStunt(text, [[text]], aspect);
}

/** The year a New Year party is counting down to (or, just after midnight, has just begun). */
export function comingYear(d = new Date()): number {
  return d.getFullYear() + (d.getMonth() >= 6 ? 1 : 0);
}

/** An event template: a card stunt built from the host's names, laid out for the room's shape. */
export interface Moment {
  name: string;
  /** How many of the custom names it uses. */
  names: 0 | 1 | 2;
  make(names: [string, string], aspect: number): Stunt;
}

/** What the host still has to type before a template can go on the crowd, or null when it is ready. */
export function missingNames(m: Moment, [a, b]: [string, string]): string | null {
  const what = m.names === 2 ? (!a && !b ? 'both names' : !a ? 'the first name' : !b ? 'the second name' : null) : m.names === 1 && !a ? 'a name' : null;
  return what && `Type ${what} for “${m.name}”.`;
}

/** Wide rooms read one long line; deep rooms stack the words. */
const wide = (aspect: number) => aspect >= 1.6;

export const MOMENTS: Moment[] = [
  {
    name: 'Names with a heart',
    names: 2,
    make: ([a, b], aspect) => wordsStunt('Names with a heart', wide(aspect) ? [[a, HEART, b]] : [[a], [HEART], [b]], aspect),
  },
  {
    name: 'Just married',
    names: 0,
    make: (_, aspect) => wordsStunt('Just married', wide(aspect) ? [['JUST MARRIED']] : [['JUST'], ['MARRIED']], aspect, '#f2ead8'),
  },
  {
    name: 'Happy birthday',
    names: 1,
    make: ([a], aspect) => wordsStunt('Happy birthday', [...(wide(aspect) ? [['HAPPY BIRTHDAY']] : [['HAPPY'], ['BIRTHDAY']]), ...(a ? [[a]] : [])], aspect),
  },
  {
    name: String(comingYear()),
    names: 0,
    make: (_, aspect) => wordsStunt(String(comingYear()), [[String(comingYear())]], aspect),
  },
];

export async function fileStunt(file: File): Promise<Stunt> {
  const bmp = await createImageBitmap(file);
  const k = Math.min(1, 480 / Math.max(bmp.width, bmp.height));
  const [c, ctx] = canvas2d(Math.max(1, Math.round(bmp.width * k)), Math.max(1, Math.round(bmp.height * k)));
  ctx.drawImage(bmp, 0, 0, c.width, c.height);
  return { name: file.name, canvas: c, image: toImage(c) };
}
