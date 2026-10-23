import { describe, expect, it } from 'vitest';
import { WAVE_DEFAULTS, arrivals, frontAt, luma, makeWave, noteFor, render, travel, waveLevel, type WaveProgram } from '../src/core/effects';
import { startTerritory } from '../src/core/territory';
import { normalize } from '../src/core/layout';

const wave = (over: Partial<WaveProgram> = {}): WaveProgram => ({
  kind: 'wave',
  t0: 1000,
  period: 2000,
  shape: 'sweep',
  angle: 0,
  origin: { x: 0.5, y: 0.5 },
  width: 0.1,
  rgb: [255, 255, 255],
  voice: 'off',
  ...over,
});

describe('waves', () => {
  it('a left-to-right sweep reaches phones in order of x', () => {
    const w = wave();
    expect(travel(w, { x: 0, y: 0.3 }, 1.5)).toBeCloseTo(0);
    expect(travel(w, { x: 1, y: 0.9 }, 1.5)).toBeCloseTo(1);
    const ts = [0, 0.25, 0.5, 1].map((x) => arrivals(w, travel(w, { x, y: 0.5 }, 1), 0, 3000)[0]);
    expect([...ts].sort((a, b) => a - b)).toEqual(ts);
  });

  it('a phone is brightest exactly when the front arrives', () => {
    for (const shape of ['sweep', 'pingpong', 'ripple'] as const) {
      const w = wave({ shape });
      const u = travel(w, { x: 0.3, y: 0.8 }, 1.3);
      const hits = arrivals(w, u, 1000, 9000);
      expect(hits.length).toBe(4);
      for (const t of hits) {
        expect(waveLevel(w, u, t)).toBeCloseTo(1, 6);
        expect(waveLevel(w, u, t + 300)).toBeLessThan(0.5);
      }
    }
  });

  it('ping-pong runs back the other way on odd passes', () => {
    const w = wave({ shape: 'pingpong' });
    expect(frontAt(w, 1000 + 100)!).toBeLessThan(frontAt(w, 1000 + 1900)!);
    expect(frontAt(w, 3000 + 100)!).toBeGreaterThan(frontAt(w, 3000 + 1900)!);
    expect(frontAt(w, 999)).toBeNull();
  });

  it('makeWave fills in the defaults and keeps what it is given', () => {
    expect(makeWave(5)).toEqual({ kind: 'wave', t0: 5, ...WAVE_DEFAULTS });
    expect(makeWave(5, { shape: 'ripple', period: 900 })).toMatchObject({ t0: 5, shape: 'ripple', period: 900, width: WAVE_DEFAULTS.width });
  });

  it('a ripple reaches phones in order of distance from its origin', () => {
    const w = wave({ shape: 'ripple', origin: { x: 0.2, y: 0.5 } });
    expect(travel(w, { x: 0.2, y: 0.5 }, 1)).toBe(0);
    expect(travel(w, { x: 0.3, y: 0.5 }, 1)).toBeLessThan(travel(w, { x: 0.9, y: 0.5 }, 1));
  });
});

describe('rendering', () => {
  const me = { seat: 4, pos: { x: 0.2, y: 0.5 }, aspect: 1 };

  it('card stunt counts down then flips everyone at the same instant', () => {
    expect(render({ kind: 'card', rgb: [1, 2, 3], at: 5000 }, me, 2500).label).toBe('3');
    expect(render({ kind: 'card', rgb: [1, 2, 3], at: 5000 }, me, 5000).rgb).toEqual([1, 2, 3]);
  });

  it('photo wall counts down like a card, then every phone takes its average colour until its picture is up', () => {
    const tile = { kind: 'tile' as const, src: 'data:image/jpeg;base64,AAAA', rgb: [1, 2, 3] as [number, number, number], at: 5000 };
    expect(render(tile, me, 2500).label).toBe('3');
    expect(render(tile, me, 4999).rgb).toEqual(render({ kind: 'card', rgb: [1, 2, 3], at: 5000 }, me, 4999).rgb);
    expect(render(tile, me, 5000)).toEqual({ rgb: [1, 2, 3] });
  });

  it('live frames swap on the shared clock, not on arrival', () => {
    const live = { kind: 'live' as const, rgb: [9, 9, 9] as [number, number, number], prev: [1, 1, 1] as [number, number, number], at: 100 };
    expect(render(live, me, 99).rgb).toEqual([1, 1, 1]);
    expect(render(live, me, 100).rgb).toEqual([9, 9, 9]);
  });

  it('lobby and identify show the seat number', () => {
    expect(render({ kind: 'lobby' }, me, 0).label).toBe('5');
    expect(render({ kind: 'identify' }, me, 0).label).toBe('5');
  });

  it('territory colours each phone by the side of the line it sits on', () => {
    const room = normalize(new Map([[0, { x: 0, y: 0 }], [1, { x: 1, y: 0 }]]));
    const state = startTerritory(room, 0);
    const colors: [[number, number, number], [number, number, number]] = [[255, 0, 0], [0, 0, 255]];
    const left = render({ kind: 'territory', state, colors }, { seat: 0, pos: { x: 0, y: 0 }, aspect: 1 }, 10);
    const right = render({ kind: 'territory', state, colors }, { seat: 1, pos: { x: 1, y: 0 }, aspect: 1 }, 10);
    expect(left.rgb).toEqual([255, 0, 0]);
    expect(right.rgb).toEqual([0, 0, 255]);
    expect(left.tappable).toBe(true);
  });

  it('notes rise from left to right', () => {
    expect(noteFor({ x: 1, y: 0.5 })).toBeGreaterThan(noteFor({ x: 0, y: 0.5 }));
  });
});

describe('countdown', () => {
  const cd = { kind: 'countdown', at: 11_000, from: 10, text: '2027' } as const;
  const me = { seat: 0, pos: { x: 0.5, y: 0.5 }, aspect: 1 };

  it('every phone shows the same big number, counting down to the instant', () => {
    expect(render(cd, me, 0).label).toBeUndefined();
    expect(render(cd, me, 1000).label).toBe('10');
    expect(render(cd, me, 1001).label).toBe('10');
    expect(render(cd, me, 6500).label).toBe('5');
    expect(render(cd, me, 10_999).label).toBe('1');
    expect(render(cd, { ...me, pos: null }, 6500).label).toBe('5');
  });

  it('then bursts into light and settles on the text', () => {
    const at = (t: number) => render(cd, me, t);
    expect(at(11_000).label).toBe('2027');
    expect(luma(at(11_050).rgb)).toBeGreaterThan(200);
    expect(luma(at(20_000).rgb)).toBeLessThan(luma(at(11_050).rgb));
    expect(luma(render(cd, { ...me, pos: null }, 11_050).rgb)).toBeGreaterThan(200);
  });
});
