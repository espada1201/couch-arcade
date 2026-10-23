import { describe, expect, it, vi } from 'vitest';
import type { Program } from '../src/core/effects';
import type { Wall } from '../src/core/wall';
import type { Stunt } from '../src/host/images';
import { wallFlip, type Flip, type WallPiece } from '../src/host/photowall';
import { room } from './harness';

const stunt = { render: () => ({}) as HTMLCanvasElement } as unknown as Stunt;
const piece = (n: number): WallPiece => ({ src: `data:image/jpeg;base64,${n}`, rgb: [n, n, n] });
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
    const flip = await wallFlip(session, stunt, { lead: 3200, say, alive: () => true }, cutInto(seen));
    expect(seen).toEqual([[0, 1, 2]]);
    expect(flip).toMatchObject({ frame: true });
    session.setProgram((flip as Flip).program!, { frame: true });
    const back = join('p2');
    expect(back.inbox.find((m) => m.t === 'program')).toMatchObject({ program: { kind: 'tile', src: 'data:image/jpeg;base64,2' } });
  });

  it('says how many pieces it is cutting, and counts the lead from after the last piece', async () => {
    const { session, say, tick } = await room([0.2, 0.5, 0.8]);
    const start = session.now();
    const flip = await wallFlip(session, stunt, { lead: 3200, say, alive: () => true }, cutInto([], () => tick(900)));
    expect(say).toHaveBeenCalledWith('Cutting the picture into 3 pieces…');
    const program = (flip as Flip).program as (seat: number) => Program;
    expect(program(0)).toMatchObject({ kind: 'tile', at: start + 900 + 3200 });
  });

  it('gives up with nothing when the picture or style changed while it was being cut', async () => {
    const { session, say } = await room([0.2, 0.5]);
    let alive = true;
    expect(await wallFlip(session, stunt, { lead: 3200, say, alive: () => alive }, cutInto([], () => (alive = false)))).toBeNull();
  });

  it('says so, and cuts nothing, when none of the placed phones is connected', async () => {
    const { session, phones, say } = await room([0.2, 0.5]);
    for (const p of phones) p.drop();
    const cut = vi.fn();
    expect(await wallFlip(session, stunt, { lead: 3200, say, alive: () => true }, cut)).toBe('None of the phones on the map are connected right now.');
    expect(cut).not.toHaveBeenCalled();
  });
});
