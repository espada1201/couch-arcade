// Photo wall on the host: cut the wall picture into one JPEG per phone, and draw the preview.
import { BLACK, type Program } from '../core/effects';
import { FRAME_BUDGET, encodeWithin } from '../core/frames';
import type { RGB } from '../core/layout';
import { wallPixelSize, type Wall } from '../core/wall';
import { canvas2d } from '../ui/canvas';

/** Longest side of one phone's piece: more than its screen can use, and encodeWithin shrinks it to the message anyway. */
const TILE_LONG_SIDE = 1000;
const TILE_QUALITY = 0.8;
const AVERAGE_SIDE = 16;
const PREVIEW_LONG_SIDE = 480;

/** One phone's piece: a JPEG data URL, or none when it could not be made small enough for a message. */
export interface Piece {
  src: string | null;
  rgb: RGB;
}

function averageColour(c: HTMLCanvasElement): RGB {
  const [, ctx] = canvas2d(AVERAGE_SIDE, AVERAGE_SIDE);
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(c, 0, 0, AVERAGE_SIDE, AVERAGE_SIDE);
  const d = ctx.getImageData(0, 0, AVERAGE_SIDE, AVERAGE_SIDE).data;
  const sum: RGB = [0, 0, 0];
  for (let i = 0; i < d.length; i += 4) for (let k = 0; k < 3; k++) sum[k] += d[i + k];
  const n = d.length / 4;
  return [Math.round(sum[0] / n), Math.round(sum[1] / n), Math.round(sum[2] / n)];
}

/** Every placed phone's piece of `picture`, which is drawn in the wall's shape. */
export function encodeTiles(picture: HTMLCanvasElement, wall: Wall): Map<number, Piece> {
  const [out, outCtx] = canvas2d(2, 2);
  const pieces = new Map<number, Piece>();
  for (const [seat, r] of wall.tiles) {
    const sw = Math.max(1, Math.round(r.w * picture.width));
    const sh = Math.max(1, Math.round(r.h * picture.height));
    const k = Math.min(1, TILE_LONG_SIDE / Math.max(sw, sh));
    const [crop, cropCtx] = canvas2d(Math.max(2, Math.round(sw * k)), Math.max(2, Math.round(sh * k)));
    cropCtx.imageSmoothingQuality = 'high';
    cropCtx.drawImage(picture, Math.round(r.x * picture.width), Math.round(r.y * picture.height), sw, sh, 0, 0, crop.width, crop.height);
    const encoded = encodeWithin(
      (quality, scale) => {
        out.width = Math.max(2, Math.round(crop.width * scale));
        out.height = Math.max(2, Math.round(crop.height * scale));
        outCtx.drawImage(crop, 0, 0, out.width, out.height);
        return out.toDataURL('image/jpeg', quality);
      },
      FRAME_BUDGET,
      TILE_QUALITY,
    );
    pieces.set(seat, { src: encoded?.data ?? null, rgb: averageColour(crop) });
  }
  return pieces;
}

/** What each phone runs: its piece from `at`, or just its colour when the piece would not fit a message (never a blank phone). */
export function tileProgram(pieces: ReadonlyMap<number, Piece>, at: number): (seat: number) => Program {
  return (seat) => {
    const piece = pieces.get(seat);
    if (!piece) return { kind: 'card', rgb: BLACK, at };
    return piece.src ? { kind: 'tile', src: piece.src, rgb: piece.rgb, at } : { kind: 'card', rgb: piece.rgb, at };
  };
}

/** The picture in the wall's shape with each phone's piece outlined and numbered (phone N is seat + 1, as on the map). */
export function wallPreview(render: (w: number, h: number) => HTMLCanvasElement, wall: Wall): HTMLCanvasElement {
  const [w, h] = wallPixelSize(wall.aspect, PREVIEW_LONG_SIDE);
  const c = render(w, h);
  const ctx = c.getContext('2d')!;
  ctx.textBaseline = 'top';
  ctx.lineJoin = 'round';
  for (const [seat, r] of wall.tiles) {
    const [x, y, tw, th] = [r.x * w, r.y * h, r.w * w, r.h * h];
    // A dark line under a light one reads on any picture.
    for (const [color, width] of [['rgba(0,0,0,0.75)', 4], ['#fff', 2]] as const) {
      ctx.strokeStyle = color;
      ctx.lineWidth = width;
      ctx.strokeRect(x + 1, y + 1, tw - 2, th - 2);
    }
    const size = Math.max(12, Math.min(28, Math.min(tw, th) * 0.3));
    ctx.font = `800 ${size}px "Archivo Variable", sans-serif`;
    ctx.lineWidth = 4;
    ctx.strokeStyle = 'rgba(0,0,0,0.75)';
    ctx.fillStyle = '#fff';
    ctx.strokeText(String(seat + 1), x + 6, y + 5);
    ctx.fillText(String(seat + 1), x + 6, y + 5);
  }
  return c;
}
