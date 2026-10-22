import { describe, expect, it } from 'vitest';
import type { Program } from '../src/core/effects';
import { MOMENTS, comingYear, missingNames } from '../src/host/images';
import { keepsakeName, pickMime, recorder } from '../src/host/record';
import type { HostSession } from '../src/host/session';
import { CUES, msToMidnight } from '../src/host/show';

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
