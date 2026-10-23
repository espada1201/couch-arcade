import { describe, expect, it } from 'vitest';
import type { Room } from '../src/core/layout';
import { PHONE_ASPECT, wallPixelSize, wallTiles, type Rect } from '../src/core/wall';

const a = PHONE_ASPECT;
const room = (aspect: number, pts: [number, number][]): Room => ({ aspect, positions: new Map(pts.map(([x, y], i) => [i, { x, y }])) });
const none = new Map<number, number>();
const tile = (w: ReturnType<typeof wallTiles>, seat: number): Rect => w.tiles.get(seat)!;

function expectRect(r: Rect, want: Rect): void {
  expect(r.x).toBeCloseTo(want.x, 6);
  expect(r.y).toBeCloseTo(want.y, 6);
  expect(r.w).toBeCloseTo(want.w, 6);
  expect(r.h).toBeCloseTo(want.h, 6);
}

describe('wallTiles lays the picture over the phones as they sit', () => {
  it('three phones in a row, a little off level, get three equal abutting tiles', () => {
    const w = wallTiles(room(2, [[0, 0.5], [0.25, 0.52], [0.5, 0.49]]), none);
    expect(w.aspect).toBeCloseTo(3 * a, 6);
    expectRect(tile(w, 0), { x: 0, y: 0, w: 1 / 3, h: 1 });
    expectRect(tile(w, 1), { x: 1 / 3, y: 0, w: 1 / 3, h: 1 });
    expectRect(tile(w, 2), { x: 2 / 3, y: 0, w: 1 / 3, h: 1 });
  });

  it('the order on the wall follows where the phones sit, not their seat numbers', () => {
    const w = wallTiles(room(2, [[0.5, 0.5], [0, 0.5], [0.25, 0.5]]), none);
    expect(tile(w, 1).x).toBeCloseTo(0, 6);
    expect(tile(w, 2).x).toBeCloseTo(1 / 3, 6);
    expect(tile(w, 0).x).toBeCloseTo(2 / 3, 6);
  });

  it('a 2 by 3 grid is six abutting tiles', () => {
    const pts: [number, number][] = [];
    for (const y of [0, 0.5]) for (const x of [0, 1, 2]) pts.push([(x * a * 0.5) / 2, y]);
    const w = wallTiles(room(2, pts), none);
    expect(w.aspect).toBeCloseTo((3 * a) / 2, 6);
    pts.forEach((_, i) => expectRect(tile(w, i), { x: (i % 3) / 3, y: Math.floor(i / 3) / 2, w: 1 / 3, h: 1 / 2 }));
  });

  it('a lone phone, or phones all on one spot, show the whole picture', () => {
    const one = wallTiles(room(1, [[0.5, 0.5]]), new Map([[0, 0.6]]));
    expect(one.aspect).toBe(0.6);
    expectRect(tile(one, 0), { x: 0, y: 0, w: 1, h: 1 });
    const stacked = wallTiles(room(1, [[0.3, 0.3], [0.3, 0.3], [0.3, 0.3]]), none);
    expect(stacked.aspect).toBeCloseTo(a, 6);
    for (const s of [0, 1, 2]) expectRect(tile(stacked, s), { x: 0, y: 0, w: 1, h: 1 });
  });

  it('two phones on the same spot do not collapse the width of the rest', () => {
    const w = wallTiles(room(2, [[0, 0.5], [0, 0.5], [0.25, 0.5], [0.5, 0.5]]), none);
    expect(w.aspect).toBeCloseTo(3 * a, 6);
    expect(tile(w, 0)).toEqual(tile(w, 1));
    expect(tile(w, 3).x).toBeCloseTo(2 / 3, 6);
  });

  it('a phone held sideways gets a sideways tile, and every tile keeps its screen’s shape', () => {
    const screens = new Map([[0, 2], [1, a], [2, a]]);
    const w = wallTiles(room(2, [[0, 0.5], [0.25, 0.5], [0.5, 0.5]]), screens);
    for (const [seat, aspect] of screens) {
      const t = tile(w, seat);
      expect((t.w / t.h) * w.aspect).toBeCloseTo(aspect, 6);
    }
    expect(tile(w, 0).h).toBeLessThan(1);
  });

  it('uses the median screen shape when working out the size of a phone', () => {
    const wide = wallTiles(room(2, [[0, 0.5], [0.25, 0.5], [0.5, 0.5]]), new Map([[0, 0.5], [1, 0.5], [2, 0.5]]));
    expect(wide.aspect).toBeCloseTo(1.5, 6);
  });

  it('every tile stays inside the picture, however scattered the phones', () => {
    const pts: [number, number][] = [[0.2, 0.25], [0.38, 0.3], [0.78, 0.2], [0.25, 0.75], [0.6, 0.8], [0.8, 0.68]];
    const w = wallTiles(room(1.33, pts), none);
    expect(w.tiles.size).toBe(6);
    for (const t of w.tiles.values()) {
      expect(t.x).toBeGreaterThanOrEqual(0);
      expect(t.y).toBeGreaterThanOrEqual(0);
      expect(t.x + t.w).toBeLessThanOrEqual(1);
      expect(t.y + t.h).toBeLessThanOrEqual(1);
      expect(t.w).toBeGreaterThan(0);
      expect(t.h).toBeGreaterThan(0);
    }
  });

  it('phones one above the other make a tall wall, and the room’s shape sets the distances', () => {
    const w = wallTiles(room(1, [[0.5, 0], [0.5, 0.5 / a / 2]]), none);
    expect(w.aspect).toBeCloseTo(a / 2, 6);
    expectRect(tile(w, 0), { x: 0, y: 0, w: 1, h: 0.5 });
    expectRect(tile(w, 1), { x: 0, y: 0.5, w: 1, h: 0.5 });
  });

  it('no phones is an empty wall in the shape of one phone', () => {
    const w = wallTiles(room(1, []), none);
    expect(w.tiles.size).toBe(0);
    expect(w.aspect).toBeCloseTo(a, 6);
  });
});

describe('wallPixelSize', () => {
  it('gives the wall’s shape with its long side at 1600 px', () => {
    expect(wallPixelSize(2)).toEqual([1600, 800]);
    expect(wallPixelSize(0.5)).toEqual([800, 1600]);
    expect(wallPixelSize(1)).toEqual([1600, 1600]);
  });

  it('never gives a side of no pixels', () => {
    const [w, h] = wallPixelSize(1e-6);
    expect(w).toBeGreaterThanOrEqual(1);
    expect(h).toBe(1600);
  });
});
