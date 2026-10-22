import { describe, expect, it } from 'vitest';
import type { Program } from '../src/core/effects';
import { MOMENTS, comingYear, missingNames } from '../src/host/images';
import { keepsakeName, pickMime, recorder } from '../src/host/record';
import type { HostSession } from '../src/host/session';
import { CUES, midnightProblem, midnightTimer, msToMidnight } from '../src/host/show';

describe('moment kit', () => {
  it('the New Year stunt and countdown name the year about to start', () => {
    expect(comingYear(new Date(2026, 9, 22))).toBe(2027);
    expect(comingYear(new Date(2026, 11, 31, 23, 59))).toBe(2027);
    // Just after midnight the party is still celebrating the year that began.
    expect(comingYear(new Date(2027, 0, 1, 0, 30))).toBe(2027);
  });

  it('the countdown cue counts every phone down from 10 together, then bursts on the new year', () => {
    const cue = CUES.find((c) => c.name === 'New Year countdown')!;
    expect(cue.moment).toBe(true);
    let sent: Program | null = null;
    const session = { now: () => 5000, setProgram: (p: Program) => (sent = p), layout: { positions: new Map(), aspect: 1 } } as unknown as HostSession;
    cue.run(session, { title: 'HELLO', sound: false });
    expect(sent).toMatchObject({ kind: 'countdown', from: 10, text: String(comingYear()) });
    const at = (sent as unknown as { at: number }).at;
    expect(at - 5000).toBeGreaterThan(10_000);
    expect(at - 5000).toBeLessThan(11_000);
    expect(cue.ms).toBeGreaterThan(at - 5000);
  });

  it('the countdown can be timed to end at the next local midnight, and needs no placed phones', () => {
    const cue = CUES.find((c) => c.name === 'New Year countdown')!;
    expect(cue.unplaced).toBe(true);
    expect(cue.timed).toBe(true);
    let sent: Program | null = null;
    const session = { now: () => 5000, setProgram: (p: Program) => (sent = p) } as unknown as HostSession;
    cue.run(session, { title: 'HELLO', sound: false, zeroAt: 3_600_000 });
    expect(sent).toMatchObject({ kind: 'countdown', at: 3_600_000, from: 10 });
  });

  it('time to midnight is measured on the local clock', () => {
    expect(msToMidnight(new Date(2026, 11, 31, 23, 59, 50))).toBe(10_000);
    expect(msToMidnight(new Date(2026, 11, 31, 22, 0, 0))).toBe(2 * 3_600_000);
    // At midnight itself, the next one is a day away.
    expect(msToMidnight(new Date(2027, 0, 1, 0, 0, 0))).toBe(24 * 3_600_000);
  });

  describe('a countdown timed to midnight follows the wall clock', () => {
    const HOUR = 3_600_000;
    /** Wall clock and host clock (performance.now on the host) as functions of real time. */
    function run(target: number, from: number, host: (t: number) => number) {
      let t = from;
      const sent: number[] = [];
      const filmed: { at: number; ms: number }[] = [];
      const done: number[] = [];
      const timer = midnightTimer(target, { wall: () => t, host: () => host(t) }, { send: (z) => sent.push(z), film: (ms) => filmed.push({ at: t, ms }), done: () => done.push(t) });
      const until = (end: number, step = 1000) => {
        for (; t <= end; t += step) timer.tick();
      };
      return { sent, filmed, done, until };
    }

    it('re-sends the moment as the host clock drifts, so zero lands at midnight on the wall clock', () => {
      const target = 10 * HOUR;
      // The host clock loses a second an hour against the wall clock.
      const host = (t: number) => 5000 + t * (1 - 1 / 3600);
      const r = run(target, target - HOUR, host);
      r.until(target - 10_000);
      // A fixed zero, worked out an hour ahead, would land a second late.
      expect(Math.abs(r.sent[0] - host(target))).toBeGreaterThan(900);
      expect(Math.abs(r.sent.at(-1)! - host(target))).toBeLessThan(100);
      // Only when it has moved: not once a second.
      expect(r.sent.length).toBeLessThan(20);
    });

    it('a host clock that stood still while the computer slept is corrected on waking', () => {
      const target = 10 * HOUR;
      // Asleep for ten minutes, half an hour before midnight: the host clock missed them.
      const host = (t: number) => (t < target - 30 * 60_000 ? t : t - Math.min(10 * 60_000, t - (target - 30 * 60_000)));
      const r = run(target, target - HOUR, host);
      r.until(target - 10_000);
      expect(Math.abs(r.sent.at(-1)! - host(target))).toBeLessThan(100);
    });

    it('films from just before the numbers start and ends after the burst, by the wall clock', () => {
      const target = 10 * HOUR;
      const r = run(target, target - 60_000, (t) => t - 123_456);
      r.until(target + 10_000);
      expect(r.filmed).toEqual([{ at: target - 12_000, ms: 18_000 }]);
      expect(r.done).toEqual([target + 6000]);
    });

    it('a countdown started in the last seconds films at once and still lands at midnight', () => {
      const target = 10 * HOUR;
      const r = run(target, target - 7000, (t) => t + 1);
      r.until(target - 7000);
      expect(r.sent).toEqual([target + 1]);
      expect(r.filmed).toEqual([{ at: target - 7000, ms: 13_000 }]);
    });

    it('a midnight more than 12 hours away is refused, saying how far it is', () => {
      expect(midnightProblem(12 * HOUR)).toBeNull();
      expect(midnightProblem(5000)).toBeNull();
      expect(midnightProblem(23 * HOUR + 59 * 60_000 + 30_000)).toMatch(/23:59:30/);
    });
  });

  it('templates with names need the names, and say which are missing', () => {
    const heart = MOMENTS.find((m) => m.name === 'Names with a heart')!;
    const birthday = MOMENTS.find((m) => m.name === 'Happy birthday')!;
    const married = MOMENTS.find((m) => m.name === 'Just married')!;
    expect(missingNames(heart, ['', ''])).toBe('Type both names for “Names with a heart”.');
    expect(missingNames(heart, ['ANA', ''])).toBe('Type the second name for “Names with a heart”.');
    expect(missingNames(heart, ['ANA', 'BEN'])).toBeNull();
    expect(missingNames(birthday, ['', 'BEN'])).toBe('Type a name for “Happy birthday”.');
    expect(missingNames(birthday, ['SAM', ''])).toBeNull();
    expect(missingNames(married, ['', ''])).toBeNull();
  });

  it('moments sit outside the looping show', () => {
    const moments = CUES.filter((c) => c.moment).map((c) => c.name);
    expect(moments).toEqual(['New Year countdown', 'First dance']);
  });

  it('a keepsake is dated, and its extension matches what the browser recorded', () => {
    expect(keepsakeName(new Date(2026, 11, 31, 23, 59), 'video/webm;codecs=vp9,opus')).toBe('swarm-moment-2026-12-31-2359.webm');
    // Safari records MP4.
    expect(keepsakeName(new Date(2026, 11, 31, 23, 59), 'video/mp4;codecs=avc1')).toBe('swarm-moment-2026-12-31-2359.mp4');
    expect(keepsakeName(new Date(2026, 11, 31, 23, 59), '')).toBe('swarm-moment-2026-12-31-2359.webm');
  });

  it('records in the best webm this browser supports, or lets the browser choose', () => {
    expect(pickMime((t) => t === 'video/webm;codecs=vp8,opus' || t === 'video/webm')).toBe('video/webm;codecs=vp8,opus');
    expect(pickMime(() => false)).toBe('');
    expect(pickMime((t) => t === 'video/mp4')).toBe('video/mp4');
  });

  it('no recorder where MediaRecorder is missing', () => {
    expect(globalThis.MediaRecorder).toBeUndefined();
    expect(recorder()).toBeNull();
  });
});
