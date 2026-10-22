import { describe, expect, it } from 'vitest';
import { fitText, type Measure } from '../src/core/textfit';

// A monospace stand-in for canvas measureText: every character is 0.6 em wide.
const mono: Measure = (text, size) => text.length * size * 0.6;

const fits = (fit: ReturnType<typeof fitText>, box: { w: number; h: number }, lineHeight = 1.2) =>
  fit.lines.every((l) => mono(l.text, fit.size) <= box.w) && fit.lines.length * fit.size * lineHeight <= box.h;

describe('fitText', () => {
  it('a short word fills the box, capped by its height', () => {
    const box = { w: 1000, h: 100 };
    const fit = fitText('Hi', box, mono);
    expect(fit.lines.map((l) => l.text)).toEqual(['Hi']);
    expect(fit.size).toBe(Math.floor(100 / 1.2));
    expect(fits(fit, box)).toBe(true);
  });

  it('picks the largest size that fits, wrapping at spaces', () => {
    const box = { w: 300, h: 400 };
    const fit = fitText('The quick brown fox jumps over the lazy dog', box, mono);
    expect(fits(fit, box)).toBe(true);
    expect(fit.lines.length).toBeGreaterThan(1);
    // One pixel bigger would no longer fit.
    const bigger = fitText('The quick brown fox jumps over the lazy dog', box, mono, { min: fit.size + 1 });
    expect(fits(bigger, box)).toBe(false);
  });

  it('longer text gets smaller type', () => {
    const box = { w: 390, h: 700 };
    const a = fitText('Cake at 8', box, mono);
    const b = fitText('Cake at 8, then speeches by the best man and the maid of honour, then dancing until late', box, mono);
    expect(b.size).toBeLessThan(a.size);
  });

  it('respects the max size and keeps paragraphs on their own lines', () => {
    const fit = fitText('one\ntwo', { w: 2000, h: 2000 }, mono, { max: 64 });
    expect(fit.size).toBe(64);
    expect(fit.lines).toEqual([
      { text: 'one', para: 0 },
      { text: 'two', para: 1 },
    ]);
  });

  it('breaks a word too long for the box at the minimum size instead of overflowing', () => {
    const box = { w: 60, h: 1000 };
    const fit = fitText('Supercalifragilistic', box, mono, { min: 10 });
    expect(fit.size).toBe(10);
    expect(fit.lines.length).toBeGreaterThan(1);
    expect(fit.lines.every((l) => mono(l.text, 10) <= box.w)).toBe(true);
    expect(fit.lines.map((l) => l.text).join('')).toBe('Supercalifragilistic');
  });

  it('empty text and an empty box are safe', () => {
    expect(fitText('', { w: 100, h: 100 }, mono).lines).toEqual([]);
    expect(fitText('Hello', { w: 0, h: 0 }, mono, { min: 12 }).size).toBe(12);
  });
});
