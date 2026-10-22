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
      ctx.fillStyle = '#0e0d0b';
      ctx.fillRect(0, 0, s, s);
      ctx.fillStyle = '#ff3b4f';
      ctx.beginPath();
      ctx.moveTo(s / 2, s * 0.85);
      ctx.bezierCurveTo(s * 0.05, s * 0.55, s * 0.12, s * 0.12, s / 2, s * 0.3);
      ctx.bezierCurveTo(s * 0.88, s * 0.12, s * 0.95, s * 0.55, s / 2, s * 0.85);
      ctx.fill();
    }),
  ]);
}

export function textStunt(text: string, aspect: number): Stunt {
  const w = STUNT_SIZE * Math.max(1, aspect);
  const hgt = STUNT_SIZE * Math.max(1, 1 / aspect);
  const [c, ctx] = canvas2d(Math.round(w), Math.round(hgt));
  ctx.fillStyle = '#0e0d0b';
  ctx.fillRect(0, 0, c.width, c.height);
  ctx.fillStyle = '#ffb000';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  let size = c.height * 0.8;
  ctx.font = `900 ${size}px "Archivo Variable", sans-serif`;
  while (size > 8 && ctx.measureText(text).width > c.width * 0.92) {
    size *= 0.9;
    ctx.font = `900 ${size}px "Archivo Variable", sans-serif`;
  }
  ctx.fillText(text, c.width / 2, c.height / 2);
  return { name: text, canvas: c, image: toImage(c) };
}

export async function fileStunt(file: File): Promise<Stunt> {
  const bmp = await createImageBitmap(file);
  const k = Math.min(1, 480 / Math.max(bmp.width, bmp.height));
  const [c, ctx] = canvas2d(Math.max(1, Math.round(bmp.width * k)), Math.max(1, Math.round(bmp.height * k)));
  ctx.drawImage(bmp, 0, 0, c.width, c.height);
  return { name: file.name, canvas: c, image: toImage(c) };
}
