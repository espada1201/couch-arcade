import { afterEach, describe, expect, it, vi } from 'vitest';
import { MAX_IDS } from '../src/core/blinkcode';
import { POLL_COLORS } from '../src/core/poll';
import { runPoll, savedPoll } from '../src/host/poll';
import { lastProgram, memoryStorage, room } from './harness';

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

  it('an offline phone’s vote is hidden from the live count and comes back with the phone; a late joiner can still vote', async () => {
    const r = await room([0, 1]);
    const poll = runPoll(r.session, r.director, 'Q', ['A', 'B'], () => {});
    r.phones[0].say({ t: 'vote', choice: 0 });
    r.phones[1].say({ t: 'vote', choice: 1 });
    r.phones[1].drop();
    expect(poll.counts()).toEqual([1, 0]);
    // The same phone reconnects (a reload, a dead spot in the Wi-Fi) and sees its pick again.
    const back = r.join('p1');
    expect(poll.counts()).toEqual([1, 1]);
    expect(ballot(back.inbox).mine).toBe(1);
    const late = r.join('late');
    expect(ballot(late.inbox).phase).toBe('open');
    late.say({ t: 'vote', choice: 1 });
    expect(poll.counts()).toEqual([1, 2]);
  });

  it('a seat handed to a new phone once the room is full does not inherit the old phone’s vote', async () => {
    const r = await room([0]);
    const poll = runPoll(r.session, r.director, 'Q', ['A', 'B'], () => {});
    const gone = r.join('gone');
    const seat = [...r.session.seats.values()].find((x) => x.token === 'gone')!.seat;
    gone.say({ t: 'vote', choice: 1 });
    gone.drop();
    poll.dispatch({ type: 'reveal' });
    expect(poll.counts()).toEqual([0, 1]);
    poll.dispatch({ type: 'reopen' });
    for (let i = 0; r.session.seats.size < MAX_IDS; i++) r.join(`fill${i}`);
    const heir = r.join('heir');
    expect([...r.session.seats.values()].find((x) => x.token === 'heir')?.seat).toBe(seat);
    expect(ballot(heir.inbox).mine).toBeNull();
    poll.dispatch({ type: 'reveal' });
    expect(poll.counts()).toEqual([0, 0]);
  });

  it('Reveal counts every phone that voted, offline ones included; only Forget offline drops a vote', async () => {
    const r = await room([0, 0.5, 1]);
    const poll = runPoll(r.session, r.director, 'Q', ['A', 'B'], () => {});
    r.phones[0].say({ t: 'vote', choice: 0 });
    r.phones[1].say({ t: 'vote', choice: 1 });
    r.phones[2].say({ t: 'vote', choice: 1 });
    r.phones[2].drop();
    poll.dispatch({ type: 'reveal' });
    expect(poll.counts()).toEqual([1, 2]);
    expect(ballot(r.phones[0].inbox).result?.pct).toEqual([33, 67]);
    poll.dispatch({ type: 'reopen' });
    r.session.forgetOffline();
    poll.dispatch({ type: 'reveal' });
    expect(poll.counts()).toEqual([1, 1]);
  });

  it('anonymous: phones still learn their own pick, and the setting reaches every phone', async () => {
    const r = await room([0, 1]);
    const poll = runPoll(r.session, r.director, 'Q', ['A', 'B'], () => {}, true);
    r.phones[0].say({ t: 'vote', choice: 1 });
    expect(ballot(r.phones[0].inbox)).toMatchObject({ anon: true, mine: 1 });
    // A vote was cast on the promise of anonymity, so it holds until Reveal.
    poll.dispatch({ type: 'anon', on: false });
    expect(ballot(r.phones[1].inbox).anon).toBe(true);
    poll.dispatch({ type: 'reveal' });
    poll.dispatch({ type: 'anon', on: false });
    expect(ballot(r.phones[1].inbox).anon).toBe(false);
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

  it('a saved poll that is not the shape a poll saves is ignored rather than restored', () => {
    const store = memoryStorage();
    vi.stubGlobal('localStorage', store);
    try {
      const good = { room: 'TEST', question: 'Q', options: ['A', 'B'], phase: 'open', anon: false, votes: [[0, 1]] };
      const junk = [
        'not json',
        JSON.stringify(42),
        JSON.stringify({ ...good, votes: 5 }),
        JSON.stringify({ ...good, votes: [[0, 7]] }),
        JSON.stringify({ ...good, votes: [[-1, 0]] }),
        JSON.stringify({ ...good, votes: [['0', 1]] }),
        JSON.stringify({ ...good, options: ['A'] }),
        JSON.stringify({ ...good, options: ['A', 'B', 'C', 'D', 'E'] }),
        JSON.stringify({ ...good, options: ['A', 2] }),
        JSON.stringify({ ...good, phase: 'paused' }),
        JSON.stringify({ ...good, anon: 'yes' }),
        JSON.stringify({ ...good, question: '' }),
      ];
      for (const raw of junk) {
        store.setItem('swarm-poll', raw);
        expect(savedPoll('TEST'), raw).toBeNull();
      }
      store.setItem('swarm-poll', JSON.stringify(good));
      expect(savedPoll('TEST')).toMatchObject({ question: 'Q', options: ['A', 'B'], phase: 'open', anon: false });
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('a running poll survives a host reload, votes and all, and is forgotten once stopped', async () => {
    vi.stubGlobal('localStorage', memoryStorage());
    try {
      const r = await room([0, 1]);
      const poll = runPoll(r.session, r.director, 'Q', ['A', 'B'], () => {}, true);
      r.phones[0].say({ t: 'vote', choice: 1 });
      poll.dispatch({ type: 'close' });
      const saved = savedPoll('TEST')!;
      expect(saved).toMatchObject({ question: 'Q', options: ['A', 'B'], phase: 'closed', anon: true });
      expect([...saved.votes]).toEqual([[0, 1]]);
      expect(savedPoll('OTHER')).toBeNull();
      // The reloaded host picks it up again.
      const again = runPoll(r.session, r.director, 'Q', ['A', 'B'], () => {}, true, saved);
      expect(again.counts()).toEqual([0, 1]);
      expect(ballot(r.phones[0].inbox)).toMatchObject({ phase: 'closed', mine: 1 });
      r.director.idle();
      expect(savedPoll('TEST')).toBeNull();
    } finally {
      vi.unstubAllGlobals();
    }
  });
});
