import { describe, expect, it } from 'vitest';
import { normalize, type Point } from '../src/core/layout';
import { FIRST_FUSE, MIN_FUSE, ballAt, potatoTap, potatoTick, startPotato } from '../src/core/potato';
import { PUSH_PER_TAP, startTerritory, teamOf, teamSizes, territoryTap, territoryTick } from '../src/core/territory';
import { rng } from './rng';

function roomOf(points: [number, number][]) {
  return normalize(new Map(points.map(([x, y], i) => [i, { x, y } as Point])));
}

// 3 x 4 grid of phones.
const ROOM = roomOf(Array.from({ length: 12 }, (_, i) => [(i % 4) / 3, Math.floor(i / 4) / 2] as [number, number]));

describe('territory', () => {
  it('starts with even halves', () => {
    const s = startTerritory(ROOM, 0);
    expect(teamSizes(s, ROOM)).toEqual([6, 6]);
  });

  it('a tap pushes the front line into the other half, scaled by team size', () => {
    const s0 = startTerritory(ROOM, 0);
    const s1 = territoryTap(s0, ROOM, 0, 10);
    expect(s1.boundary).toBeCloseTo(s0.boundary + PUSH_PER_TAP / 6);
    expect(s1.taps).toEqual([1, 0]);
    const s2 = territoryTap(s1, ROOM, 3, 20);
    expect(s2.boundary).toBeCloseTo(s0.boundary);
  });

  it('phones the line passes over defect, and reaching the wall wins', () => {
    let s = startTerritory(ROOM, 0);
    const right = ROOM.positions.get(2)!; // x = 2/3, starts on team 1
    expect(teamOf(s, right.x)).toBe(1);
    let t = 0;
    while (s.phase === 'playing') s = territoryTap(s, ROOM, 0, (t += 50));
    expect(teamOf(s, right.x)).toBe(0);
    expect(s.winner).toBe(0);
    expect(s.boundary).toBe(1);
    // Even the phone standing on the far wall has been taken.
    expect(teamOf(s, 1)).toBe(0);
    expect(territoryTap(s, ROOM, 3, t + 1)).toBe(s);
  });

  it('time up: whoever holds more floor wins, exact middle is a draw', () => {
    const s = startTerritory(ROOM, 0, 1000);
    expect(territoryTick(s, 999)).toBe(s);
    expect(territoryTick({ ...s, boundary: 0.3 }, 1000).winner).toBe(1);
    expect(territoryTick({ ...s, boundary: 0.5 }, 1000).winner).toBeNull();
    expect(territoryTap(s, ROOM, 0, 2000).phase).toBe('over');
  });
});

describe('hot potato', () => {
  it('needs at least two phones', () => {
    expect(startPotato(roomOf([[0, 0]]), 0, rng(1))).toBeNull();
  });

  it('only the holder can throw, only after the ball lands, and only to a near neighbour', () => {
    const r = rng(4);
    const s0 = startPotato(ROOM, 0, r)!;
    expect(s0.deadline).toBe(FIRST_FUSE);
    const other = (s0.holder + 1) % 12;
    expect(potatoTap(s0, ROOM, other, 100, r)).toBe(s0);
    const s1 = potatoTap(s0, ROOM, s0.holder, 100, r);
    expect(s1.holder).not.toBe(s0.holder);
    expect(s1.passes).toBe(1);
    expect(s1.fuse).toBeLessThan(FIRST_FUSE);
    const d = (a: Point, b: Point) => Math.hypot((a.x - b.x) * ROOM.aspect, a.y - b.y);
    const from = ROOM.positions.get(s0.holder)!;
    const nearestDistances = [...ROOM.positions].filter(([k]) => k !== s0.holder).map(([, p]) => d(from, p)).sort((a, b) => a - b);
    expect(d(from, ROOM.positions.get(s1.holder)!)).toBeLessThanOrEqual(nearestDistances[2] + 1e-9);
    // In flight: the new holder can't throw until it lands.
    expect(potatoTap(s1, ROOM, s1.holder, s1.arrive - 1, r)).toBe(s1);
    expect(potatoTap(s1, ROOM, s1.holder, s1.arrive, r).passes).toBe(2);
  });

  it('a missed fuse burns the holder and the ball moves to the nearest survivor; last one wins', () => {
    const r = rng(9);
    let s = startPotato(ROOM, 0, r)!;
    const first = s.holder;
    s = potatoTick(s, ROOM, s.deadline + 1);
    expect(s.out).toEqual([first]);
    expect(s.holder).not.toBe(first);
    let guard = 0;
    while (s.phase === 'playing' && guard++ < 100) s = potatoTick(s, ROOM, s.deadline + 1);
    expect(s.phase).toBe('over');
    expect(s.out).toHaveLength(11);
    expect(s.winner).not.toBeNull();
    expect(s.out).not.toContain(s.winner);
  });

  it('the fuse never drops below the minimum', () => {
    const r = rng(2);
    let s = startPotato(ROOM, 0, r)!;
    for (let i = 0; i < 60; i++) s = potatoTap(s, ROOM, s.holder, s.arrive, r);
    expect(s.fuse).toBe(MIN_FUSE);
    expect(s.passes).toBe(60);
  });

  it('the ball glides from thrower to catcher', () => {
    const s = { from: { x: 0, y: 0 }, to: { x: 1, y: 1 }, depart: 0, arrive: 100 };
    expect(ballAt(s, -5)).toEqual({ x: 0, y: 0 });
    expect(ballAt(s, 50)).toEqual({ x: 0.5, y: 0.5 });
    expect(ballAt(s, 200)).toEqual({ x: 1, y: 1 });
  });
});
