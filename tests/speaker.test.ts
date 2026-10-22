import { describe, expect, it } from 'vitest';
import { audioFileProblem, channelFor, clockTime, MAX_TRACK_BYTES, PAUSED, positionAt, reconcile, schedule, segments, type Timeline } from '../src/core/speaker';

const DUR = 100; // seconds

describe('party speaker timeline', () => {
  it('starts paused at the top of the track', () => {
    expect(positionAt(PAUSED, 5000, DUR)).toBe(0);
    expect(segments(PAUSED, DUR, 0)).toEqual([]);
  });

  it('play is scheduled ahead on the shared clock and the position runs from then', () => {
    const tl = schedule(PAUSED, 10_000, 1500, DUR, 'play');
    expect(tl.at(-1)).toEqual({ at: 11_500, pos: 0, playing: true });
    expect(positionAt(tl, 11_000, DUR)).toBe(0);
    expect(positionAt(tl, 13_500, DUR)).toBeCloseTo(2);
    expect(positionAt(tl, 500_000, DUR)).toBe(DUR);
  });

  it('pause holds the position it reaches at the scheduled instant', () => {
    let tl = schedule(PAUSED, 0, 1000, DUR, 'play');
    tl = schedule(tl, 5000, 500, DUR, 'pause');
    expect(tl.at(-1)).toEqual({ at: 5500, pos: 4.5, playing: false });
    // Until the pause lands, phones keep playing.
    expect(positionAt(tl, 5200, DUR)).toBeCloseTo(4.2);
    expect(positionAt(tl, 9000, DUR)).toBeCloseTo(4.5);
  });

  it('seek keeps playing or paused as it was, and resume picks up where pause left off', () => {
    let tl = schedule(PAUSED, 0, 1000, DUR, 'play');
    tl = schedule(tl, 3000, 500, DUR, { seek: 60 });
    expect(tl.at(-1)).toEqual({ at: 3500, pos: 60, playing: true });
    tl = schedule(tl, 4000, 500, DUR, 'pause');
    tl = schedule(tl, 9000, 1500, DUR, 'play');
    expect(positionAt(tl, 10_500, DUR)).toBeCloseTo(61);
    expect(positionAt(tl, 11_500, DUR)).toBeCloseTo(62);
  });

  it('a second command before the first lands queues behind it rather than rewriting history', () => {
    let tl = schedule(PAUSED, 0, 1500, DUR, 'play');
    tl = schedule(tl, 200, 500, DUR, 'pause'); // pressed pause before play even started
    expect(tl.map((k) => k.at)).toEqual([0, 1500, 1500]);
    expect(positionAt(tl, 3000, DUR)).toBe(0);
  });

  it('play after the end of the track starts again from the top', () => {
    let tl = schedule(PAUSED, 0, 0, DUR, 'play');
    tl = schedule(tl, 200_000, 1000, DUR, 'play');
    expect(tl.at(-1)).toMatchObject({ pos: 0, playing: true });
  });

  it('forgets keyframes that no longer matter', () => {
    let tl: Timeline = PAUSED;
    for (let i = 0; i < 20; i++) tl = schedule(tl, i * 10_000, 500, DUR, i % 2 ? 'pause' : 'play');
    expect(tl.length).toBeLessThanOrEqual(2);
  });

  it('segments cover only the playing stretches from a given time on', () => {
    let tl = schedule(PAUSED, 0, 1000, DUR, 'play');
    tl = schedule(tl, 5000, 500, DUR, 'pause');
    tl = schedule(tl, 5000, 3000, DUR, 'play');
    expect(segments(tl, DUR, 2000)).toEqual([
      { anchor: 1000, from: 2000, until: 5500 },
      { anchor: 8000 - 4500, from: 8000, until: 8000 - 4500 + DUR * 1000 },
    ]);
  });
});

describe('drift correction', () => {
  const tl = schedule(PAUSED, 0, 1000, DUR, 'play'); // anchor 1000

  it('keeps a source that is within tolerance', () => {
    expect(reconcile(tl, DUR, 20_000, { anchor: 1012 })).toEqual({ keep: { anchor: 1000, from: 20_000, until: 101_000 }, start: [] });
  });

  it('re-schedules a source that has drifted more than 20 ms', () => {
    const d = reconcile(tl, DUR, 20_000, { anchor: 1031 });
    expect(d.keep).toBeNull();
    expect(d.start).toEqual([{ anchor: 1000, from: 20_000, until: 101_000 }]);
  });

  it('starts from scratch when nothing is sounding, and stays silent while paused', () => {
    expect(reconcile(tl, DUR, 20_000, null).start).toHaveLength(1);
    const paused = schedule(tl, 30_000, 0, DUR, 'pause');
    expect(reconcile(paused, DUR, 40_000, { anchor: 1000 })).toEqual({ keep: null, start: [] });
  });

  it('keeps the current source through a scheduled pause, and queues the next stretch', () => {
    let t = schedule(tl, 5000, 500, DUR, 'pause');
    t = schedule(t, 5000, 2000, DUR, 'play');
    const d = reconcile(t, DUR, 5100, { anchor: 1000 });
    expect(d.keep).toEqual({ anchor: 1000, from: 5100, until: 5500 });
    expect(d.start).toEqual([{ anchor: 7000 - 4500, from: 7000, until: 7000 - 4500 + DUR * 1000 }]);
  });
});

describe('stereo spread', () => {
  it('splits the room into left and right, with unplaced and centre phones in mono', () => {
    expect(channelFor({ x: 0.1, y: 0.5 }, true)).toBe('left');
    expect(channelFor({ x: 0.9, y: 0.5 }, true)).toBe('right');
    expect(channelFor({ x: 0.5, y: 0.5 }, true)).toBe('mono');
    expect(channelFor(null, true)).toBe('mono');
    expect(channelFor({ x: 0.1, y: 0.5 }, false)).toBe('stereo');
    expect(channelFor(null, false)).toBe('stereo');
  });
});

describe('track files', () => {
  it('accepts the common audio formats and refuses the rest with a reason', () => {
    for (const name of ['a.mp3', 'B.M4A', 'c.wav', 'd.ogg']) expect(audioFileProblem(name, '', 1000)).toBeNull();
    expect(audioFileProblem('song', 'audio/mpeg', 1000)).toBeNull();
    expect(audioFileProblem('notes.txt', 'text/plain', 1000)).toMatch(/MP3, M4A, WAV or OGG/);
    expect(audioFileProblem('empty.mp3', 'audio/mpeg', 0)).toMatch(/empty/);
  });

  it('refuses files over 25 MB, saying how big this one is', () => {
    expect(audioFileProblem('ok.mp3', '', MAX_TRACK_BYTES)).toBeNull();
    expect(audioFileProblem('big.wav', '', 52_000_000)).toMatch(/49\.6 MB.*25 MB/);
  });

  it('formats track times as m:ss', () => {
    expect(clockTime(0)).toBe('0:00');
    expect(clockTime(65.9)).toBe('1:05');
    expect(clockTime(600)).toBe('10:00');
  });
});
