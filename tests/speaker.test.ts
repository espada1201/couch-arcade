import { describe, expect, it } from 'vitest';
import { audioClock, audioFileProblem, channelFor, clockTime, DRIFT_TOLERANCE_MS, deliveryStatus, durationProblem, MAX_TRACK_BYTES, MAX_TRACK_SECONDS, PAUSED, pendingStart, positionAt, reconcile, schedule, segments, startPoint, type Timeline } from '../src/core/speaker';
import { gaussian, rng } from './rng';

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
  const playing = (anchor: number, strikes = 0) => ({ planned: 1000, anchor, strikes });

  it('keeps a source that is within tolerance', () => {
    expect(reconcile(tl, DUR, 20_000, playing(1012))).toEqual({ keep: { anchor: 1000, from: 20_000, until: 101_000 }, start: [], strikes: 0 });
  });

  it('re-schedules a source only once it has been more than 20 ms out on two checks in a row', () => {
    const once = reconcile(tl, DUR, 20_000, playing(1031));
    expect(once).toEqual({ keep: { anchor: 1000, from: 20_000, until: 101_000 }, start: [], strikes: 1 });
    const twice = reconcile(tl, DUR, 22_000, playing(1031, once.strikes));
    expect(twice).toEqual({ keep: null, start: [{ anchor: 1000, from: 22_000, until: 101_000 }], strikes: 0 });
    // A reading back in tolerance clears the count.
    expect(reconcile(tl, DUR, 22_000, playing(1005, once.strikes)).strikes).toBe(0);
  });

  it('replaces the source at once when the plan moves (a seek), however close the anchors are', () => {
    const seek = schedule(tl, 5000, 500, DUR, { seek: 4.49 }); // the new anchor is 10 ms from the old one
    const d = reconcile(seek, DUR, 6000, playing(1000));
    expect(d.keep).toBeNull();
    expect(d.start).toEqual([{ anchor: 5500 - 4490, from: 6000, until: 5500 - 4490 + DUR * 1000 }]);
  });

  it('starts from scratch when nothing is sounding, and stays silent while paused', () => {
    expect(reconcile(tl, DUR, 20_000, null).start).toHaveLength(1);
    const paused = schedule(tl, 30_000, 0, DUR, 'pause');
    expect(reconcile(paused, DUR, 40_000, playing(1000))).toEqual({ keep: null, start: [], strikes: 0 });
  });

  it('keeps the current source through a scheduled pause, and queues the next stretch', () => {
    let t = schedule(tl, 5000, 500, DUR, 'pause');
    t = schedule(t, 5000, 2000, DUR, 'play');
    const d = reconcile(t, DUR, 5100, playing(1000));
    expect(d.keep).toEqual({ anchor: 1000, from: 5100, until: 5500 });
    expect(d.start).toEqual([{ anchor: 7000 - 4500, from: 7000, until: 7000 - 4500 + DUR * 1000 }]);
  });
});

describe('drift correction against sampling noise', () => {
  const LONG = 10_000; // seconds, so the track never ends mid-simulation
  const CHECK_MS = 2000;

  /**
   * Reading a phone's anchor pairs its audio clock with the system clock. Paired through currentTime
   * that reading is only as precise as the audio callback: headless Chromium's 10 ms callbacks gave a
   * 14.9 ms spread, and phones run 20 ms buffers, so ±10 ms. The clock offset estimate adds about 2 ms,
   * and now and then a reading is far out: the page stalls between the two clock reads, or one slow
   * ping moves the estimate (1 reading in 100, ±30 ms).
   */
  function fallbackNoise(seed: number) {
    const r = rng(seed);
    return () => (r() - 0.5) * 20 + gaussian(r) * 2 + (r() < 1 / 100 ? (r() < 0.5 ? -30 : 30) : 0);
  }

  /** A phone checked every 2 s: its source's real anchor error grows by `drift` ms a check, or jumps once. */
  function simulate(checks: number, noise: () => number, { drift = 0, jumpAt = -1, jump = 0 } = {}) {
    const tl = schedule(PAUSED, 0, 1000, LONG, 'play');
    let real = 1000;
    let strikes = 0;
    let worst = 0;
    let noisy = 0;
    const resyncs: number[] = [];
    for (let i = 0; i < checks; i++) {
      real += drift + (i === jumpAt ? jump : 0);
      worst = Math.max(worst, Math.abs(real - 1000));
      const measured = real + noise();
      if (Math.abs(measured - 1000) > DRIFT_TOLERANCE_MS) noisy++;
      const d = reconcile(tl, LONG, 2000 + i * CHECK_MS, { planned: 1000, anchor: measured, strikes });
      if (d.keep) strikes = d.strikes;
      else [real, strikes] = [1000, (resyncs.push(i), 0)];
    }
    return { resyncs, worst, noisy };
  }

  it('a phone that is in step is never re-scheduled, though single readings stray past the tolerance', () => {
    for (const seed of [1, 2, 3]) {
      const run = simulate(900, fallbackNoise(seed)); // half an hour
      expect(run.noisy).toBeGreaterThan(5);
      expect(run.resyncs).toEqual([]);
    }
  });

  it('a phone whose audio clock really drifts is re-scheduled before it is far out', () => {
    // 100 ppm, a fast phone crystal: 0.2 ms a check, so 20 ms after under 3.5 minutes.
    const run = simulate(600, fallbackNoise(4), { drift: 0.2 });
    expect(run.resyncs.length).toBeGreaterThanOrEqual(3);
    // Past the tolerance by no more than one reading's sampling error.
    expect(run.worst).toBeLessThan(DRIFT_TOLERANCE_MS + 15);
  });

  it('a real jump (the clock offset estimate moving 40 ms) is fixed on the second check after it', () => {
    const run = simulate(100, fallbackNoise(5), { jumpAt: 50, jump: 40 });
    expect(run.resyncs).toEqual([51]);
  });
});

describe('audio clock', () => {
  // A phone's audio device: audio time c (s) leaves the speaker at system time 5000 + c * 1000 ms,
  // currentTime runs 42 ms of latency ahead of that and moves in 20 ms callbacks.
  const BASE = 5000;
  const LATENCY = 0.042;
  const heardAt = (c: number) => BASE + c * 1000;
  const currentTimeAt = (perf: number) => Math.floor(((perf - BASE) / 1000 + LATENCY) / 0.02) * 0.02;
  /** The browser's stamp, taken at the last callback (up to 20 ms before now). */
  const stampAt = (perf: number, age: number) => ({ contextTime: (perf - age - BASE) / 1000, performanceTime: perf - age });
  const HOST_OFFSET = 123_456;

  it('maps through the output timestamp to within a millisecond of when the sound is heard', () => {
    const r = rng(9);
    for (let i = 0; i < 200; i++) {
      const perf = 10_000 + r() * 60_000;
      const clock = audioClock({ stamp: stampAt(perf, r() * 20), currentTime: currentTimeAt(perf), perfNow: perf, latency: LATENCY, hostOffset: HOST_OFFSET });
      const c = (perf - BASE) / 1000 + 0.5;
      expect(Math.abs(clock.toHost(c) - (heardAt(c) + HOST_OFFSET))).toBeLessThan(1);
      expect(clock.toCtx(clock.toHost(c))).toBeCloseTo(c, 9);
    }
  });

  it('falls back to currentTime plus the latency, to within one callback, without a usable stamp', () => {
    const r = rng(10);
    for (const stamp of [undefined, null, { contextTime: 0, performanceTime: 0 }, 'stale'] as const) {
      const perf = 10_000 + r() * 60_000;
      // A stamp from before a suspend: the audio clock stood still since, the system clock did not.
      const s = stamp === 'stale' ? { contextTime: (perf - 900 - BASE) / 1000 - 0.5, performanceTime: perf - 900 } : stamp;
      const clock = audioClock({ stamp: s, currentTime: currentTimeAt(perf), perfNow: perf, latency: LATENCY, hostOffset: HOST_OFFSET });
      const c = (perf - BASE) / 1000 + 0.5;
      expect(Math.abs(clock.toHost(c) - (heardAt(c) + HOST_OFFSET))).toBeLessThanOrEqual(20);
    }
  });
});

describe('late start', () => {
  it('a start still ahead keeps its time and offset', () => {
    expect(startPoint(10.5, 3, 10.2)).toEqual({ when: 10.5, offset: 3 });
  });

  it('a start that has already passed begins now, that much further in, so the track stays on its anchor', () => {
    const p = startPoint(10, 3, 10.35);
    expect(p.when).toBe(10.35);
    expect(p.offset).toBeCloseTo(3.35, 9);
    // The track position at any audio time t is (t - when + offset) either way.
    expect(p.when - p.offset).toBeCloseTo(10 - 3, 9);
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

  it('refuses tracks over 5 minutes, because every phone holds the whole song unpacked', () => {
    expect(durationProblem(5 * 60)).toBeNull();
    expect(durationProblem(3 * 60 + 30)).toBeNull();
    expect(durationProblem(5 * 60 + 1)).toMatch(/5:01.*5 minutes/);
    expect(durationProblem(15 * 60 + 20)).toMatch(/15:20.*5 minutes/);
  });

  it('the longest track a phone accepts decodes to no more than 120 MB (48 kHz, stereo, 32-bit float)', () => {
    expect(MAX_TRACK_SECONDS * 48_000 * 2 * 4).toBeLessThanOrEqual(120e6);
  });

  it('formats track times as m:ss', () => {
    expect(clockTime(0)).toBe('0:00');
    expect(clockTime(65.9)).toBe('1:05');
    expect(clockTime(600)).toBe('10:00');
  });
});

describe('the host clock during the lead-in', () => {
  it('knows a Play is on its way until the phones start, and not after', () => {
    const tl = schedule(PAUSED, 10_000, 1500, DUR, 'play');
    expect(pendingStart(tl, 10_200, DUR)).toEqual({ at: 11_500, pos: 0, playing: true });
    expect(pendingStart(tl, 11_500, DUR)).toBeNull();
    expect(pendingStart(PAUSED, 10_000, DUR)).toBeNull();
  });

  it('replaying a finished song starts from 0:00 straight away, while the old end position still reads as finished', () => {
    let tl = schedule(PAUSED, 0, 0, DUR, 'play');
    tl = schedule(tl, 200_000, 1500, DUR, 'play');
    expect(positionAt(tl, 200_100, DUR)).toBe(DUR);
    expect(pendingStart(tl, 200_100, DUR)).toMatchObject({ pos: 0 });
  });

  it('a pause or a seek while the song is sounding is not a start', () => {
    let tl = schedule(PAUSED, 0, 0, DUR, 'play');
    tl = schedule(tl, 5000, 600, DUR, { seek: 50 });
    expect(pendingStart(tl, 5100, DUR)).toBeNull();
  });
});

describe('the delivery line under the song picker', () => {
  const d = { online: 3, ready: 0, failed: 0, playing: false };
  it('counts up while the song is on its way, then says Play', () => {
    expect(deliveryStatus({ ...d, ready: 2 })).toBe('Sending to phones… 2 of 3 ready');
    expect(deliveryStatus({ ...d, ready: 3 })).toBe('Ready on all 3 phones. Press Play.');
    expect(deliveryStatus({ ...d, online: 1, ready: 1 })).toBe('Ready on 1 phone. Press Play.');
  });
  it('goes quiet while playing once everyone has the song, and stays honest when someone is late', () => {
    expect(deliveryStatus({ ...d, ready: 3, playing: true })).toBe('');
    expect(deliveryStatus({ ...d, ready: 2, playing: true })).toBe('Playing. Sending to phones… 2 of 3 ready');
  });
  it('names the phones that cannot play the file', () => {
    expect(deliveryStatus({ ...d, ready: 2, failed: 1 })).toBe('Ready on 2 of 3 phones. 1 phone can’t play this file. Press Play.');
    expect(deliveryStatus({ ...d, ready: 0, failed: 3 })).toBe('No phone can play this file. Try an MP3.');
    expect(deliveryStatus({ ...d, ready: 1, failed: 1 })).toBe('Sending to phones… 1 of 3 ready. 1 phone can’t play this file.');
  });
  it('asks for phones when none are here', () => {
    expect(deliveryStatus({ ...d, online: 0 })).toMatch(/No phones yet/);
  });
});
