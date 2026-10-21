import { describe, expect, it } from 'vitest';
import { applyHomography, fitHomography, floorPlan, validCorners } from '../src/core/homography';

/** Pinhole camera above a floor, tilted down: the textbook perspective map. */
function camera(x: number, z: number) {
  const h = 1.9;
  const tilt = 0.3;
  const zc = z * Math.cos(tilt) + h * Math.sin(tilt);
  const yc = z * Math.sin(tilt) - h * Math.cos(tilt);
  return { x: 0.5 + (0.8 * x) / zc, y: 0.5 - (0.8 * yc) / zc };
}

describe('perspective correction', () => {
  it('maps the four clicked corners exactly onto the unit floor', () => {
    const corners = [camera(-2, 9), camera(2, 9), camera(2, 3), camera(-2, 3)];
    const H = floorPlan(corners)!;
    const want = [[0, 0], [1, 0], [1, 1], [0, 1]];
    corners.forEach((c, i) => {
      const p = applyHomography(H, c)!;
      expect(p.x).toBeCloseTo(want[i][0], 9);
      expect(p.y).toBeCloseTo(want[i][1], 9);
    });
  });

  it('turns any point the camera sees back into its true floor position', () => {
    const H = floorPlan([camera(-2, 9), camera(2, 9), camera(2, 3), camera(-2, 3)])!;
    for (let x = -2; x <= 2; x += 0.5)
      for (let z = 3; z <= 9; z += 0.75) {
        const p = applyHomography(H, camera(x, z))!;
        expect(p.x).toBeCloseTo((x + 2) / 4, 9);
        expect(p.y).toBeCloseTo((9 - z) / 6, 9);
      }
  });

  it('far rows are bunched in the image but evenly spaced after correction', () => {
    const H = floorPlan([camera(-2, 9), camera(2, 9), camera(2, 3), camera(-2, 3)])!;
    const rows = [3, 5, 7, 9].map((z) => camera(0, z).y);
    expect(rows[0] - rows[1]).toBeGreaterThan(2 * (rows[2] - rows[3]));
    const fixed = [3, 5, 7, 9].map((z) => applyHomography(H, camera(0, z))!.y);
    expect(fixed[0] - fixed[1]).toBeCloseTo(fixed[2] - fixed[3], 9);
  });

  it('rejects crossed or anticlockwise corner clicks', () => {
    const good = [camera(-2, 9), camera(2, 9), camera(2, 3), camera(-2, 3)];
    expect(validCorners(good)).toBe(true);
    expect(validCorners([good[0], good[2], good[1], good[3]])).toBe(false);
    expect(validCorners([...good].reverse())).toBe(false);
    expect(floorPlan([good[1], good[0], good[2], good[3]])).toBeNull();
  });

  it('points at or above the horizon are not on the floor, and strays are clamped', () => {
    const H = floorPlan([{ x: 0.3, y: 0.5 }, { x: 0.7, y: 0.5 }, { x: 0.9, y: 0.9 }, { x: 0.1, y: 0.9 }])!;
    expect(applyHomography(H, { x: 0.5, y: 0.05 })).toBeNull();
    const far = applyHomography(H, { x: 0.5, y: 0.2 })!;
    expect(far.y).toBeGreaterThanOrEqual(-0.5);
  });

  it('refuses degenerate corners', () => {
    const p = { x: 0.5, y: 0.5 };
    expect(floorPlan([p, p, p, p])).toBeNull();
    expect(fitHomography([p], [p])).toBeNull();
  });
});
