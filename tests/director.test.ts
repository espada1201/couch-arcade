import { describe, expect, it, vi } from 'vitest';
import { lastProgram, room } from './harness';

describe('the director owns what the phones run', () => {
  it('a run sets its program, hears input, and stops when the next one takes the room', async () => {
    const r = await room([0, 1]);
    const stop = vi.fn();
    const tap = vi.fn();
    r.director.run({ stop, program: { kind: 'identify' }, onInput: { tap } });
    expect(lastProgram(r.phones[0].inbox, 'identify')).not.toBeNull();
    r.phones[1].tap();
    expect(tap).toHaveBeenCalledWith(1, { t: 'tap' });
    r.director.run({});
    expect(stop).toHaveBeenCalledOnce();
    // The new run set no program, so the phones are back in the lobby, and the old input is released.
    expect(r.phones[0].inbox.at(-1)).toEqual({ t: 'program', program: { kind: 'lobby' } });
    r.tick(100);
    r.phones[1].tap();
    expect(tap).toHaveBeenCalledOnce();
  });

  it('a run that fails ends itself and the phones go back to the lobby', async () => {
    const r = await room([0]);
    const stop = vi.fn();
    const hold = r.director.run({ stop, program: { kind: 'identify' } });
    expect(hold.active).toBe(true);
    hold.end();
    expect(stop).toHaveBeenCalledOnce();
    expect(hold.active).toBe(false);
    expect(r.phones[0].inbox.at(-1)).toEqual({ t: 'program', program: { kind: 'lobby' } });
  });

  it('a superseded run ending late does not touch the run that replaced it', async () => {
    const r = await room([0]);
    const old = r.director.run({ program: { kind: 'identify' } });
    const stop = vi.fn();
    r.director.run({ stop, program: { kind: 'grid', rows: 2, seats: 2 } });
    old.end();
    expect(stop).not.toHaveBeenCalled();
    expect(r.phones[0].inbox.at(-1)).toMatchObject({ program: { kind: 'grid' } });
  });

  it('a stop that ends its own run does not recurse', async () => {
    const r = await room([0]);
    const hold = r.director.run({ stop: () => hold.end() });
    r.director.idle();
    expect(hold.active).toBe(false);
  });

  it('a stop that starts another run is a bug, and says so instead of orphaning that run', async () => {
    const r = await room([0]);
    r.director.run({ stop: () => void r.director.run({ program: { kind: 'identify' } }) });
    expect(() => r.director.run({})).toThrow(/started another run/);
  });

  it('in production that bug stops the stray run and logs, so the click that got there still works', async () => {
    vi.stubEnv('DEV', false);
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      const r = await room([0]);
      const strayStop = vi.fn();
      r.director.run({ stop: () => void r.director.run({ program: { kind: 'identify' }, stop: strayStop }) });
      const next = r.director.run({ program: { kind: 'grid', rows: 2, seats: 2 } });
      expect(strayStop).toHaveBeenCalledTimes(1);
      expect(next.active).toBe(true);
      expect(r.phones[0].inbox.at(-1)).toMatchObject({ program: { kind: 'grid' } });
      expect(error).toHaveBeenCalled();
    } finally {
      vi.unstubAllEnvs();
      error.mockRestore();
    }
  });

  it('room-wide state registered for handovers is cleared whenever the room changes hands', async () => {
    const r = await room([0]);
    const handover = vi.fn();
    r.director.onHandover(handover);
    r.director.run({});
    expect(handover).toHaveBeenCalledTimes(1);
    r.director.idle();
    expect(handover).toHaveBeenCalledTimes(2);
  });

  it('file acks reach a listener outside the director while another feature runs', async () => {
    const r = await room([0]);
    const have = vi.fn();
    r.session.input({ have });
    r.director.run({ onInput: { tap: () => {} } });
    r.phones[0].say({ t: 'have', id: 'song', next: 2, got: 2 });
    expect(have).toHaveBeenCalledWith(0, { t: 'have', id: 'song', next: 2, got: 2, state: undefined });
    r.director.idle();
    r.phones[0].say({ t: 'have', id: 'song', next: 3, got: 3 });
    expect(have).toHaveBeenCalledTimes(2);
  });
});
