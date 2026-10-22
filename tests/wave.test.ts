import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { WAVE_DEFAULTS, frontAt, type Program, type WaveProgram } from '../src/core/effects';
import { liveWave } from '../src/host/play';
import type { HostSession } from '../src/host/session';

beforeEach(() => {
  vi.useFakeTimers();
  vi.stubGlobal('window', globalThis);
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

function fakeSession() {
  let clock = 10_000;
  const sent: WaveProgram[] = [];
  const session = { now: () => clock, setProgram: (p: Program) => sent.push(p as WaveProgram) } as unknown as HostSession;
  return { session, sent, tick: (ms: number) => (clock += ms) };
}

describe('a live wave', () => {
  it('changes speed mid-roll without the band jumping', () => {
    const { session, sent, tick } = fakeSession();
    const wave = liveWave(session);
    wave.start(WAVE_DEFAULTS, 400);
    tick(400 + 900);
    vi.advanceTimersByTime(200);
    wave.retune({ ...WAVE_DEFAULTS, period: WAVE_DEFAULTS.period / 2 });
    expect(sent).toHaveLength(2);
    const [before, after] = sent;
    expect(after.period).toBe(WAVE_DEFAULTS.period / 2);
    expect(frontAt(after, 11_300)).toBeCloseTo(frontAt(before, 11_300)!, 9);
  });

  it('sends at most one edit per 150 ms, keeping the last', () => {
    const { session, sent } = fakeSession();
    const wave = liveWave(session);
    wave.start(WAVE_DEFAULTS, 400);
    wave.retune({ ...WAVE_DEFAULTS, width: 0.2 });
    wave.retune({ ...WAVE_DEFAULTS, width: 0.3 });
    expect(sent).toHaveLength(1);
    vi.advanceTimersByTime(150);
    expect(sent).toHaveLength(2);
    expect(sent[1].width).toBe(0.3);
  });

  it('does nothing once stopped', () => {
    const { session, sent } = fakeSession();
    const wave = liveWave(session);
    wave.retune(WAVE_DEFAULTS);
    wave.start(WAVE_DEFAULTS, 400);
    wave.retune({ ...WAVE_DEFAULTS, width: 0.2 });
    wave.stop();
    vi.advanceTimersByTime(500);
    expect(sent).toHaveLength(1);
  });
});
