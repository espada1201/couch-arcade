// Turns raw positions (camera coordinates or seat-grid entries) into "room space":
// the crowd's bounding box stretched to 0..1 on both axes, plus the box's true aspect
// ratio so effects that care about real distances (ripples, image framing) stay round.
import { clamp } from './math';

export interface Point {
  x: number;
  y: number;
}

export interface Room {
  /** Seat -> position in room space (0..1, 0..1). */
  positions: Map<number, Point>;
  /** Width / height of the crowd's bounding box in the source space. */
  aspect: number;
}

export function normalize(raw: Map<number, Point>, opts: { mirror?: boolean; sourceAspect?: number } = {}): Room {
  const { mirror = false, sourceAspect = 4 / 3 } = opts;
  const pts = [...raw.values()];
  if (pts.length === 0) return { positions: new Map(), aspect: 1 };
  const xs = pts.map((p) => p.x);
  const ys = pts.map((p) => p.y);
  const [x0, x1, y0, y1] = [Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)];
  const span = (lo: number, hi: number, v: number) => (hi - lo < 1e-6 ? 0.5 : (v - lo) / (hi - lo));
  const positions = new Map<number, Point>();
  for (const [seat, p] of raw) {
    const x = span(x0, x1, p.x);
    positions.set(seat, { x: mirror ? 1 - x : x, y: span(y0, y1, p.y) });
  }
  const w = (x1 - x0) * sourceAspect;
  const h = y1 - y0;
  const aspect = w < 1e-6 || h < 1e-6 ? 1 : clamp(w / h, 1 / 8, 8);
  return { positions, aspect };
}

/** Position for someone who typed their row and seat number instead of using the camera. */
export function seatGridPoint(row: number, seat: number, rows: number, seats: number): Point {
  const f = (v: number, n: number) => (n <= 1 ? 0.5 : (clamp(v, 1, n) - 1) / (n - 1));
  return { x: f(seat, seats), y: f(row, rows) };
}

export function distance(a: Point, b: Point, aspect: number): number {
  return Math.hypot((a.x - b.x) * aspect, a.y - b.y);
}

/** The k seats physically closest to `seat`, nearest first. */
export function nearest(seat: number, room: Room, k: number, exclude: Set<number> = new Set()): number[] {
  const me = room.positions.get(seat);
  if (!me) return [];
  return [...room.positions]
    .filter(([s]) => s !== seat && !exclude.has(s))
    .map(([s, p]) => [s, distance(me, p, room.aspect)] as const)
    .sort((a, b) => a[1] - b[1])
    .slice(0, k)
    .map(([s]) => s);
}

export type RGB = [number, number, number];

export interface Image {
  w: number;
  h: number;
  /** RGBA, row-major. */
  data: Uint8ClampedArray | Uint8Array;
}

/**
 * Colour a phone should show so the crowd reproduces `img`: the image is scaled to cover
 * the crowd's bounding box (cropping the overflow, like a stadium card stunt), and each phone
 * averages the patch of image it is responsible for rather than a single noisy pixel.
 */
export function sampleCover(img: Image, p: Point, aspect: number, patch = 0): RGB {
  const imgAspect = img.w / img.h;
  let sw = img.w;
  let sh = img.h;
  if (imgAspect > aspect) sw = img.h * aspect;
  else sh = img.w / aspect;
  const ox = (img.w - sw) / 2;
  const oy = (img.h - sh) / 2;
  const cx = ox + p.x * sw;
  const cy = oy + p.y * sh;
  const rx = Math.max(0, (patch * sw) / 2);
  const ry = Math.max(0, (patch * sh) / 2);
  const xa = Math.max(0, Math.floor(cx - rx));
  const xb = Math.min(img.w - 1, Math.max(xa, Math.ceil(cx + rx) - 1));
  const ya = Math.max(0, Math.floor(cy - ry));
  const yb = Math.min(img.h - 1, Math.max(ya, Math.ceil(cy + ry) - 1));
  let r = 0;
  let g = 0;
  let b = 0;
  let n = 0;
  for (let y = ya; y <= yb; y++)
    for (let x = xa; x <= xb; x++) {
      const i = (y * img.w + x) * 4;
      r += img.data[i];
      g += img.data[i + 1];
      b += img.data[i + 2];
      n++;
    }
  return [Math.round(r / n), Math.round(g / n), Math.round(b / n)];
}

/** Every placed phone's colour for `img`, each averaging a patch `patch` of the room wide. */
export function sampleCrowd(img: Image, room: Room, patch: number): Map<number, RGB> {
  const out = new Map<number, RGB>();
  for (const [seat, p] of room.positions) out.set(seat, sampleCover(img, p, room.aspect, patch));
  return out;
}
