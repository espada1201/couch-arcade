import { describe, expect, it } from 'vitest';
import type { PollProgram, Program } from '../src/core/effects';
import { ballotKey, connectionKey, gridKey, youVotedKey } from '../src/phone/overlays';
import type { ClientView } from '../src/phone/layers';

const live: ClientView = { status: 'live', error: '', seat: 0, pos: null };
const poll = (over: Partial<PollProgram> = {}): Program => ({ kind: 'poll', question: 'Q', options: ['A', 'B'], phase: 'open', mine: null, result: null, anon: false, ...over });

describe('phone overlay layers', () => {
  it('a connection problem shows only when the phone cannot take part', () => {
    expect(connectionKey({ kind: 'lobby' }, live)).toBeNull();
    expect(connectionKey({ kind: 'lobby' }, { ...live, status: 'reconnecting' })).toBeNull();
    expect(connectionKey({ kind: 'lobby' }, { ...live, status: 'failed', error: 'gone' })).toBe('failed:gone');
  });

  it('the seat form is rebuilt only when the grid changes', () => {
    expect(gridKey({ kind: 'grid', rows: 3, seats: 6 }, live)).toBe('3x6');
    expect(gridKey({ kind: 'grid', rows: 3, seats: 6 }, { ...live, status: 'connecting' })).toBeNull();
    expect(gridKey({ kind: 'lobby' }, live)).toBeNull();
  });

  it('the ballot changes key with the pick and the phase, and goes at Reveal', () => {
    const k = ballotKey(poll(), live);
    expect(k).not.toBeNull();
    expect(ballotKey(poll(), live)).toBe(k);
    expect(ballotKey(poll({ mine: 1 }), live)).not.toBe(k);
    expect(ballotKey(poll({ phase: 'closed' }), live)).not.toBe(k);
    expect(ballotKey(poll({ phase: 'revealed', result: { pct: [50, 50], zone: 0 } }), live)).toBeNull();
  });

  it('after Reveal each phone that voted is told its own pick, whatever zone it stands in', () => {
    const revealed = (mine: number | null) => poll({ phase: 'revealed', mine, result: { pct: [50, 50], zone: 0 } });
    expect(youVotedKey(revealed(1), live)).toBe('You voted B');
    expect(youVotedKey(revealed(null), live)).toBeNull();
    expect(youVotedKey(poll({ mine: 1 }), live)).toBeNull();
  });
});
