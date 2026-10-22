// A camera looking across a room sees the floor in perspective: far rows bunch up near
// the horizon. Surveyors undo that with a plane-to-plane homography fixed by four known
// points. Click the four corners of the seating area once and every phone the camera
// finds lands on a true floor plan.
import type { Point } from './layout';
import { clamp } from './math';

/** 3x3 matrix, row-major. */
export type Homography = number[];

/** Solve A x = b by Gaussian elimination with partial pivoting. */
function solve(A: number[][], b: number[]): number[] | null {
  const n = b.length;
  const M = A.map((row, i) => [...row, b[i]]);
  for (let c = 0; c < n; c++) {
    let p = c;
    for (let r = c + 1; r < n; r++) if (Math.abs(M[r][c]) > Math.abs(M[p][c])) p = r;
    if (Math.abs(M[p][c]) < 1e-12) return null;
    [M[c], M[p]] = [M[p], M[c]];
    for (let r = 0; r < n; r++) {
      if (r === c) continue;
      const k = M[r][c] / M[c][c];
      for (let j = c; j <= n; j++) M[r][j] -= k * M[c][j];
    }
  }
  return M.map((row, i) => row[n] / row[i]);
}

/** The homography taking each `from[i]` to `to[i]` (exactly four point pairs). Null if degenerate. */
export function fitHomography(from: Point[], to: Point[]): Homography | null {
  if (from.length !== 4 || to.length !== 4) return null;
  const A: number[][] = [];
  const b: number[] = [];
  for (let i = 0; i < 4; i++) {
    const { x, y } = from[i];
    const { x: u, y: v } = to[i];
    A.push([x, y, 1, 0, 0, 0, -u * x, -u * y]);
    b.push(u);
    A.push([0, 0, 0, x, y, 1, -v * x, -v * y]);
    b.push(v);
  }
  const h = solve(A, b);
  return h ? [...h, 1] : null;
}

/**
 * Floor position of an image point, or null for points at or beyond the horizon (they
 * are not on the floor). Far-off results are clamped so one stray phone can't squash the map.
 */
export function applyHomography(H: Homography, p: Point): Point | null {
  const w = H[6] * p.x + H[7] * p.y + H[8];
  if (w <= 1e-6) return null;
  return { x: clamp((H[0] * p.x + H[1] * p.y + H[2]) / w, -0.5, 1.5), y: clamp((H[3] * p.x + H[4] * p.y + H[5]) / w, -0.5, 1.5) };
}

/** Corners must form a convex quad clicked clockwise on screen (top-left, top-right, bottom-right, bottom-left). */
export function validCorners(c: Point[]): boolean {
  if (c.length !== 4) return false;
  for (let i = 0; i < 4; i++) {
    const a = c[i];
    const b = c[(i + 1) % 4];
    const d = c[(i + 2) % 4];
    // Screen y points down, so a clockwise turn has a positive cross product.
    if ((b.x - a.x) * (d.y - b.y) - (b.y - a.y) * (d.x - b.x) <= 0) return false;
  }
  return true;
}

/** Corners clicked in the camera image, in order: top-left, top-right, bottom-right, bottom-left of the area. */
export function floorPlan(corners: Point[]): Homography | null {
  if (!validCorners(corners)) return null;
  const H = fitHomography(corners, [
    { x: 0, y: 0 },
    { x: 1, y: 0 },
    { x: 1, y: 1 },
    { x: 0, y: 1 },
  ]);
  if (!H) return null;
  // Scale so the floor side of the horizon has w > 0; applyHomography relies on that sign.
  const cx = corners.reduce((a, c) => a + c.x, 0) / 4;
  const cy = corners.reduce((a, c) => a + c.y, 0) / 4;
  return H[6] * cx + H[7] * cy + H[8] < 0 ? H.map((v) => -v) : H;
}
