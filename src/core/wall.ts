// Photo wall: lay one picture over the phones where they physically sit, so phones side by side
// show the picture across all of them, like a jumbotron made of phones. Pure; no DOM.
import type { Room } from './layout';
import { clamp01, median } from './math';

/** A rectangle as fractions (0..1) of the wall picture. */
export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface Wall {
  /** Width / height of the whole wall, so the picture can be drawn in exactly that shape. */
  aspect: number;
  /** Placed seat -> the piece of the wall picture that phone shows. */
  tiles: Map<number, Rect>;
}

/** Width / height of a phone screen held upright, used until the phone says otherwise. */
export const PHONE_ASPECT = 9 / 19.5;

/** Pixel size of a picture drawn in the wall's shape, `long` pixels on its longer side. */
export function wallPixelSize(aspect: number, long = 1600): [number, number] {
  return aspect >= 1 ? [long, Math.max(1, Math.round(long / aspect))] : [Math.max(1, Math.round(long * aspect)), long];
}

/** Each value replaced by the mean of its cluster, where a cluster is a run of values no further than `gap` apart. */
function snap(values: number[], gap: number): number[] {
  const order = values.map((_, i) => i).sort((i, j) => values[i] - values[j]);
  const out = [...values];
  let from = 0;
  for (let k = 1; k <= order.length; k++) {
    if (k < order.length && values[order[k]] - values[order[k - 1]] <= gap) continue;
    const run = order.slice(from, k);
    const mean = run.reduce((sum, i) => sum + values[i], 0) / run.length;
    for (const i of run) out[i] = mean;
    from = k;
  }
  return out;
}

/**
 * Lay the picture over the phones as they physically sit.
 * `room`: positions in room space with the room's aspect (session.layout).
 * `screens`: each phone's reported screen width/height (missing -> PHONE_ASPECT).
 */
export function wallTiles(room: Room, screens: ReadonlyMap<number, number>): Wall {
  const seats = [...room.positions.keys()];
  if (seats.length === 0) return { aspect: PHONE_ASPECT, tiles: new Map() };
  const shapes = seats.map((s) => screens.get(s) ?? PHONE_ASPECT);
  const a = median(shapes);
  // Physical points: one unit is the crowd's height.
  const pts = seats.map((s) => ({ x: room.positions.get(s)!.x * room.aspect, y: room.positions.get(s)!.y }));
  // The width at which two screens would just touch; a phone's own is to its nearest neighbour.
  const nearest = pts.flatMap((p, i) => {
    const reach = pts.flatMap((q, j) => (j === i ? [] : [Math.max(Math.abs(q.x - p.x), Math.abs(q.y - p.y) * a)])).filter((d) => d > 1e-9);
    return reach.length ? [Math.min(...reach)] : [];
  });
  if (nearest.length === 0) return { aspect: a, tiles: new Map(seats.map((s) => [s, { x: 0, y: 0, w: 1, h: 1 }])) };
  const width = median(nearest);
  // Camera noise: rows and columns of phones become straight.
  const xs = snap(pts.map((p) => p.x), width / 2);
  const ys = snap(pts.map((p) => p.y), width / a / 2);
  const screen = seats.map((_, i) => ({ x: xs[i] - width / 2, y: ys[i] - width / shapes[i] / 2, h: width / shapes[i] }));
  const x0 = Math.min(...screen.map((r) => r.x));
  const y0 = Math.min(...screen.map((r) => r.y));
  const wallW = Math.max(...screen.map((r) => r.x + width)) - x0;
  const wallH = Math.max(...screen.map((r) => r.y + r.h)) - y0;
  const tiles = new Map<number, Rect>();
  seats.forEach((seat, i) => {
    const r = screen[i];
    const x = clamp01((r.x - x0) / wallW);
    const y = clamp01((r.y - y0) / wallH);
    tiles.set(seat, { x, y, w: Math.min(width / wallW, 1 - x), h: Math.min(r.h / wallH, 1 - y) });
  });
  return { aspect: wallW / wallH, tiles };
}
