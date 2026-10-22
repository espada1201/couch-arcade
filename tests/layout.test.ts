import { describe, expect, it } from 'vitest';
import { distance, nearest, normalize, sampleCover, sampleCrowd, seatGridPoint, type Image } from '../src/core/layout';

function quadrants(w: number, h: number): Image {
  const data = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4;
      const right = x >= w / 2;
      const bottom = y >= h / 2;
      data.set(!bottom ? (right ? [0, 255, 0, 255] : [255, 0, 0, 255]) : right ? [255, 255, 0, 255] : [0, 0, 255, 255], i);
    }
  return { w, h, data };
}

describe('room layout', () => {
  it('stretches the crowd to fill room space and keeps the true aspect', () => {
    const room = normalize(new Map([[0, { x: 0.2, y: 0.4 }], [1, { x: 0.6, y: 0.4 }], [2, { x: 0.4, y: 0.6 }]]), { sourceAspect: 4 / 3 });
    expect(room.positions.get(0)).toEqual({ x: 0, y: 0 });
    expect(room.positions.get(1)).toEqual({ x: 1, y: 0 });
    expect(room.positions.get(2)!.x).toBeCloseTo(0.5);
    expect(room.positions.get(2)!.y).toBe(1);
    expect(room.aspect).toBeCloseTo((0.4 * 4) / 3 / 0.2);
  });

  it('mirrors when the camera faces the crowd', () => {
    const room = normalize(new Map([[0, { x: 0.1, y: 0 }], [1, { x: 0.9, y: 1 }]]), { mirror: true });
    expect(room.positions.get(0)!.x).toBe(1);
    expect(room.positions.get(1)!.x).toBe(0);
  });

  it('handles a single phone and a single row without dividing by zero', () => {
    expect(normalize(new Map([[4, { x: 0.3, y: 0.3 }]])).positions.get(4)).toEqual({ x: 0.5, y: 0.5 });
    const row = normalize(new Map([[0, { x: 0.1, y: 0.5 }], [1, { x: 0.9, y: 0.5 }]]));
    expect(row.positions.get(1)).toEqual({ x: 1, y: 0.5 });
    expect(row.aspect).toBe(1);
    expect(normalize(new Map()).positions.size).toBe(0);
  });

  it('maps typed row/seat numbers onto the grid', () => {
    expect(seatGridPoint(1, 1, 5, 10)).toEqual({ x: 0, y: 0 });
    expect(seatGridPoint(5, 10, 5, 10)).toEqual({ x: 1, y: 1 });
    expect(seatGridPoint(3, 99, 5, 10)).toEqual({ x: 1, y: 0.5 });
    expect(seatGridPoint(1, 1, 1, 1)).toEqual({ x: 0.5, y: 0.5 });
  });

  it('finds physical neighbours using real distances', () => {
    const room = normalize(new Map([[0, { x: 0, y: 0 }], [1, { x: 0.1, y: 0 }], [2, { x: 0, y: 0.3 }], [3, { x: 1, y: 1 }]]));
    expect(nearest(0, room, 2)).toEqual([1, 2]);
    expect(nearest(0, room, 3, new Set([1]))).toEqual([2, 3]);
    expect(distance({ x: 0, y: 0 }, { x: 1, y: 0 }, 2)).toBe(2);
  });

  it('samples the image quadrant each phone covers', () => {
    const img = quadrants(40, 40);
    expect(sampleCover(img, { x: 0.1, y: 0.1 }, 1)).toEqual([255, 0, 0]);
    expect(sampleCover(img, { x: 0.9, y: 0.1 }, 1)).toEqual([0, 255, 0]);
    expect(sampleCover(img, { x: 0.1, y: 0.9 }, 1)).toEqual([0, 0, 255]);
    expect(sampleCover(img, { x: 0.9, y: 0.9 }, 1)).toEqual([255, 255, 0]);
  });

  it('crops a square image to cover a wide crowd and averages patches', () => {
    const img = quadrants(40, 40);
    // Crowd 4x wider than tall: only the middle band of rows is used, columns are full.
    expect(sampleCover(img, { x: 0.05, y: 0 }, 4)).toEqual([255, 0, 0]);
    expect(sampleCover(img, { x: 0.05, y: 1 }, 4)).toEqual([0, 0, 255]);
    // A patch straddling the red/green border averages to a mix.
    const [r, g, b] = sampleCover(img, { x: 0.5, y: 0.1 }, 1, 0.5);
    expect(r).toBeGreaterThan(100);
    expect(g).toBeGreaterThan(100);
    expect(b).toBe(0);
  });

  it('gives every placed phone the colour of the patch it covers', () => {
    const img = quadrants(40, 40);
    const room = { positions: new Map([[3, { x: 0.1, y: 0.1 }], [8, { x: 0.9, y: 0.9 }], [5, { x: 0.5, y: 0.1 }]]), aspect: 1 };
    const colours = sampleCrowd(img, room, 0.5);
    expect([...colours.keys()]).toEqual([3, 8, 5]);
    expect(colours.get(3)).toEqual(sampleCover(img, { x: 0.1, y: 0.1 }, 1, 0.5));
    expect(colours.get(8)).toEqual(sampleCover(img, { x: 0.9, y: 0.9 }, 1, 0.5));
    expect(colours.get(5)).toEqual(sampleCover(img, { x: 0.5, y: 0.1 }, 1, 0.5));
    expect(sampleCrowd(img, { positions: new Map(), aspect: 1 }, 0.1).size).toBe(0);
  });
});
