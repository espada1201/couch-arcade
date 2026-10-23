import { describe, expect, it, vi } from 'vitest';
import type { Program } from '../src/core/effects';
import type { Wall } from '../src/core/wall';
import type { Flip, FlipControl } from '../src/host/cardstyles';
import type { Director } from '../src/host/director';
import { flipper } from '../src/host/flipper';
import type { Stunt } from '../src/host/images';
import { wallFlip, type WallPiece } from '../src/host/photowall';
import { lastProgram, room } from './harness';

const stunt = { render: () => ({}) as HTMLCanvasElement } as unknown as Stunt;
const piece = (n: number): WallPiece => ({ src: `data:image/jpeg;base64,${n}`, rgb: [n, n, n] });
const control = (say = vi.fn(), signal = new AbortController().signal): FlipControl => ({ lead: 3200, say, signal });
const flipOf = (out: Awaited<ReturnType<typeof wallFlip>>): Flip => (out as { go: Flip }).go;
const cutInto = (seen: number[][] = [], during = () => {}) => async (_: HTMLCanvasElement, wall: Wall) => {
  seen.push([...wall.tiles.keys()]);
  during();
  return new Map([...wall.tiles.keys()].map((s) => [s, piece(s)]));
};

describe('the Photo wall flip', () => {
  it('cuts the wall over every placed phone, including one that is away, and gives it its piece when it returns', async () => {
    const { session, phones, join, say } = await room([0.2, 0.5, 0.8]);
    phones[2].drop();
    expect(session.online.length).toBe(2);
    const seen: number[][] = [];
    const out = await wallFlip(session, stunt, control(say), cutInto(seen));
    expect(seen).toEqual([[0, 1, 2]]);
    expect(out).toMatchObject({ go: { frame: true } });
    session.setProgram(flipOf(out).program!, { frame: true });
    const back = join('p2');
    expect(back.inbox.find((m) => m.t === 'program')).toMatchObject({ program: { kind: 'tile', src: 'data:image/jpeg;base64,2' } });
  });

  it('says how many pieces it is cutting, and counts the lead from after the last piece', async () => {
    const { session, say, tick } = await room([0.2, 0.5, 0.8]);
    const start = session.now();
    const out = await wallFlip(session, stunt, control(say), cutInto([], () => tick(900)));
    expect(say).toHaveBeenCalledWith('Cutting the picture into 3 pieces…');
    const program = flipOf(out).program as (seat: number) => Program;
    expect(program(0)).toMatchObject({ kind: 'tile', at: start + 900 + 3200 });
  });

  it('gives up with nothing when the picture or style changed while it was being cut', async () => {
    const { session, say } = await room([0.2, 0.5]);
    const ctl = new AbortController();
    expect(await wallFlip(session, stunt, control(say, ctl.signal), cutInto([], () => ctl.abort()))).toEqual({ cancelled: true });
  });

  it('says so, and cuts nothing, when none of the placed phones is connected', async () => {
    const { session, phones, say } = await room([0.2, 0.5]);
    for (const p of phones) p.drop();
    const cut = vi.fn();
    expect(await wallFlip(session, stunt, control(say), cut)).toEqual({ refuse: 'None of the phones on the map are connected right now.' });
    expect(cut).not.toHaveBeenCalled();
  });

  it('says the picture could not be cut when cutting throws, unless the press was dropped meanwhile', async () => {
    const { session, say } = await room([0.2, 0.5]);
    const boom = async () => {
      throw new Error('canvas');
    };
    expect(await wallFlip(session, stunt, control(say), boom)).toEqual({ refuse: 'Could not cut the picture.' });
    const ctl = new AbortController();
    const dropped = async () => {
      ctl.abort();
      throw new Error('canvas');
    };
    expect(await wallFlip(session, stunt, control(say, ctl.signal), dropped)).toEqual({ cancelled: true });
  });
});

describe('a Flip press', () => {
  /** A cut that waits for `finish`, as a real one waits for the page. */
  const slowCut = () => {
    let finish = () => {};
    const gate = new Promise<void>((done) => (finish = done));
    const cut = async (_: HTMLCanvasElement, wall: Wall) => (await gate, new Map([...wall.tiles.keys()].map((s) => [s, piece(s)])));
    return { cut, finish };
  };
  const setup = async (xs = [0.2, 0.5, 0.8]) => {
    const r = await room(xs);
    const view = { say: vi.fn(), fail: vi.fn(), busy: vi.fn() };
    return { ...r, view, flips: flipper(r.director, view) };
  };
  const tiles = (inbox: Parameters<typeof lastProgram>[0]) => lastProgram(inbox, 'tile');

  it('is busy while it cuts, then flips the room with a frame stream and is free again', async () => {
    const { phones, director, view, flips, session } = await setup();
    const { cut, finish } = slowCut();
    const done = flips.press((c) => wallFlip(session, stunt, c, cut));
    expect(flips.inFlight).toBe(true);
    expect(view.busy).toHaveBeenLastCalledWith(true);
    await vi.waitFor(() => expect(view.say).toHaveBeenCalledWith('Cutting the picture into 3 pieces…'));
    finish();
    expect(await done).toBe(true);
    expect(view.busy.mock.calls).toEqual([[true], [false]]);
    expect(flips.inFlight).toBe(false);
    expect(director.run).toHaveBeenCalledWith(expect.objectContaining({ frame: true }));
    expect(tiles(phones[0].inbox)).not.toBeNull();
  });

  it('lets the page paint the busy button before it starts cutting', async () => {
    const { flips, view } = await setup();
    const prepare = vi.fn(async () => ({ refuse: 'no' }));
    const done = flips.press(prepare);
    expect(view.busy).toHaveBeenCalledWith(true);
    expect(prepare).not.toHaveBeenCalled();
    await done;
    expect(prepare).toHaveBeenCalledTimes(1);
  });

  it('ignores a second press while one is being cut', async () => {
    const { flips, session } = await setup();
    const { cut, finish } = slowCut();
    const first = flips.press((c) => wallFlip(session, stunt, c, cut));
    const prepare = vi.fn();
    expect(await flips.press(prepare)).toBe(false);
    expect(prepare).not.toHaveBeenCalled();
    finish();
    expect(await first).toBe(true);
  });

  it.each([
    ['Stop or Lights off', (d: Director) => d.idle()],
    ['a Wave or Show starting', (d: Director) => d.run({ program: { kind: 'card', rgb: [9, 9, 9], at: 1 } })],
  ])('does not take the room back when %s took it mid-cut', async (_, handover) => {
    const { phones, director, view, flips, session } = await setup();
    const { cut, finish } = slowCut();
    const done = flips.press((c) => wallFlip(session, stunt, c, cut));
    await vi.waitFor(() => expect(view.say).toHaveBeenCalledWith('Cutting the picture into 3 pieces…'));
    handover(director);
    expect(flips.inFlight).toBe(false);
    expect(view.busy).toHaveBeenLastCalledWith(false);
    finish();
    expect(await done).toBe(false);
    expect(director.run).not.toHaveBeenCalledWith(expect.objectContaining({ frame: true }));
    expect(tiles(phones[0].inbox)).toBeNull();
    expect(view.fail).not.toHaveBeenCalled();
  });

  it('can be pressed again right after it was dropped, without waiting for the old cut', async () => {
    const { flips, session } = await setup();
    const old = slowCut();
    const first = flips.press((c) => wallFlip(session, stunt, c, old.cut));
    flips.cancel();
    expect(await first).toBe(false);
    expect(await flips.press((c) => wallFlip(session, stunt, c, cutInto()))).toBe(true);
    old.finish();
  });

  it('is dropped before it starts when the picture changed while the page painted', async () => {
    const { flips } = await setup();
    const prepare = vi.fn();
    const done = flips.press(prepare);
    flips.cancel();
    expect(await done).toBe(false);
    expect(prepare).not.toHaveBeenCalled();
  });

  it('tells the host when cutting threw, and is free again', async () => {
    const { flips, view, session, director } = await setup();
    const boom = async () => {
      throw new Error('toDataURL');
    };
    expect(await flips.press((c) => wallFlip(session, stunt, c, boom))).toBe(false);
    expect(view.fail).toHaveBeenCalledWith('Could not cut the picture.');
    expect(flips.inFlight).toBe(false);
    expect(view.busy).toHaveBeenLastCalledWith(false);
    expect(director.run).not.toHaveBeenCalled();
  });

  it('does not clear the status when its own run takes the room', async () => {
    const { flips, view, session } = await setup();
    await flips.press((c) => wallFlip(session, stunt, c, cutInto()));
    expect(view.say).not.toHaveBeenCalledWith('');
  });
});
