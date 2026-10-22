import { describe, expect, it } from 'vitest';
import type { Program } from '../src/core/effects';
import type { HostMsg } from '../src/core/protocol';
import { room } from './harness';

const frame = (seq: number): Program => ({ kind: 'follow', view: { show: 'picture', src: 'data:image/jpeg;base64,AAAA', seq } });
const programs = (inbox: HostMsg[]) => inbox.flatMap((m) => (m.t === 'program' ? [m] : []));
const seqs = (inbox: HostMsg[]) => programs(inbox).flatMap((m) => (m.program.kind === 'follow' && m.program.view.show === 'picture' ? [m.program.view.seq] : []));

describe('picture frames to a phone that falls behind', () => {
  it('sends the next frame only once the phone has the one before, and then the newest', async () => {
    const r = await room([0.2, 0.8]);
    const [fast, slow] = r.phones;
    for (let seq = 1; seq <= 4; seq++) {
      r.session.setProgram(frame(seq), { frame: true });
      const m = programs(fast.inbox).at(-1)!;
      fast.say({ t: 'ack', n: m.ack! });
    }
    expect(seqs(fast.inbox)).toEqual([1, 2, 3, 4]);
    // The slow phone confirmed nothing: it holds frame 1 and nothing more is queued for it.
    expect(seqs(slow.inbox)).toEqual([1]);
    slow.say({ t: 'ack', n: programs(slow.inbox).at(-1)!.ack! });
    expect(seqs(slow.inbox)).toEqual([1, 4]);
  });

  it('a program that is not a frame goes at once and drops the held frame', async () => {
    const r = await room([0.5]);
    const [p] = r.phones;
    r.session.setProgram(frame(1), { frame: true });
    r.session.setProgram(frame(2), { frame: true });
    r.session.setProgram({ kind: 'lobby' });
    expect(programs(p.inbox).at(-1)!.program).toEqual({ kind: 'lobby' });
    p.say({ t: 'ack', n: programs(p.inbox).find((m) => m.ack)!.ack! });
    expect(seqs(p.inbox)).toEqual([1]);
    expect(programs(p.inbox).at(-1)!.program).toEqual({ kind: 'lobby' });
  });

  it('a phone that reconnects is not left waiting for an ack from its old link', async () => {
    const r = await room([0.5]);
    r.session.setProgram(frame(1), { frame: true });
    r.phones[0].drop();
    const again = r.join('p0');
    r.session.setProgram(frame(2), { frame: true });
    expect(seqs(again.inbox)).toEqual([1, 2]);
  });

  it('a stale or bogus ack changes nothing', async () => {
    const r = await room([0.5]);
    const [p] = r.phones;
    r.session.setProgram(frame(1), { frame: true });
    r.session.setProgram(frame(2), { frame: true });
    p.say({ t: 'ack', n: 0 });
    p.say({ t: 'ack', n: -1 });
    expect(seqs(p.inbox)).toEqual([1]);
  });
});
