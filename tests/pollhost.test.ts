import { afterEach, describe, expect, it, vi } from 'vitest';
import { POLL_COLORS } from '../src/core/poll';
import { runPoll } from '../src/host/poll';
import { lastProgram, room } from './harness';

afterEach(() => vi.restoreAllMocks());

const ballot = (inbox: Parameters<typeof lastProgram>[0]) => lastProgram(inbox, 'poll')!;

describe('room poll on the host', () => {
  it('every phone gets the ballot, votes are counted, and each phone is told its own vote', async () => {
    const r = await room([0, 0.5, 1]);
    const seen = vi.fn();
    const poll = runPoll(r.session, r.director, 'Pizza or tacos?', ['Pizza', 'Tacos'], seen);
    expect(r.director.run).toHaveBeenCalled();
    expect(ballot(r.phones[2].inbox)).toMatchObject({ question: 'Pizza or tacos?', options: ['Pizza', 'Tacos'], phase: 'open', mine: null, result: null });
    r.phones[0].say({ t: 'vote', choice: 1 });
    r.phones[1].say({ t: 'vote', choice: 0 });
    r.phones[0].say({ t: 'vote', choice: 0 });
    expect(poll.counts()).toEqual([2, 0]);
    expect(ballot(r.phones[0].inbox).mine).toBe(0);
    expect(ballot(r.phones[2].inbox).mine).toBeNull();
    expect(seen).toHaveBeenLastCalledWith(expect.objectContaining({ phase: 'open' }));
  });

  it('a phone that leaves loses its vote, and a phone that joins late can still vote', async () => {
    const r = await room([0, 1]);
    const poll = runPoll(r.session, r.director, 'Q', ['A', 'B'], () => {});
    r.phones[0].say({ t: 'vote', choice: 0 });
    r.phones[1].say({ t: 'vote', choice: 1 });
    r.phones[1].drop();
    expect(poll.counts()).toEqual([1, 0]);
    const late = r.join('late');
    expect(ballot(late.inbox).phase).toBe('open');
    late.say({ t: 'vote', choice: 1 });
    expect(poll.counts()).toEqual([1, 1]);
  });

  it('Reveal turns the placed room into zones sized by share; Close and Reopen gate voting', async () => {
    const r = await room([0.2, 0.5, 0.8]);
    const poll = runPoll(r.session, r.director, 'Q', ['A', 'B'], () => {});
    r.phones[0].say({ t: 'vote', choice: 1 });
    r.phones[1].say({ t: 'vote', choice: 0 });
    r.phones[2].say({ t: 'vote', choice: 0 });
    poll.dispatch({ type: 'close' });
    r.phones[2].say({ t: 'vote', choice: 1 });
    expect(poll.counts()).toEqual([2, 1]);
    poll.dispatch({ type: 'reveal' });
    // Two thirds of the room, from the left, is A; the rightmost phone is B even though it voted A.
    expect(r.phones.map((p) => ballot(p.inbox).result?.zone)).toEqual([0, 0, 1]);
    expect(ballot(r.phones[2].inbox).result?.pct).toEqual([67, 33]);
    poll.dispatch({ type: 'reopen' });
    expect(ballot(r.phones[0].inbox)).toMatchObject({ phase: 'open', result: null, mine: 1 });
    expect(POLL_COLORS).toHaveLength(4);
  });

  it('stopping hands the phones back and ignores later votes', async () => {
    const r = await room([0, 1]);
    const poll = runPoll(r.session, r.director, 'Q', ['A', 'B'], () => {});
    r.director.idle();
    expect(r.phones[0].inbox.at(-1)).toEqual({ t: 'program', program: { kind: 'lobby' } });
    r.phones[0].say({ t: 'vote', choice: 0 });
    expect(poll.counts()).toEqual([0, 0]);
  });
});
