import { describe, expect, it } from 'vitest';
import type { Program } from '../src/core/effects';
import { comingYear } from '../src/host/images';
import { keepsakeName, pickMime, recorder } from '../src/host/record';
import type { HostSession } from '../src/host/session';
import { CUES } from '../src/host/show';

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

  it('moments sit outside the looping show', () => {
    const moments = CUES.filter((c) => c.moment).map((c) => c.name);
    expect(moments).toEqual(['New Year countdown', 'First dance']);
  });

  it('a keepsake is a dated webm', () => {
    expect(keepsakeName(new Date(2026, 11, 31, 23, 59))).toBe('swarm-moment-2026-12-31-2359.webm');
  });

  it('records in the best webm this browser supports, or lets the browser choose', () => {
    expect(pickMime((t) => t === 'video/webm;codecs=vp8,opus' || t === 'video/webm')).toBe('video/webm;codecs=vp8,opus');
    expect(pickMime(() => false)).toBe('');
  });

  it('no recorder where MediaRecorder is missing', () => {
    expect(globalThis.MediaRecorder).toBeUndefined();
    expect(recorder()).toBeNull();
  });
});
