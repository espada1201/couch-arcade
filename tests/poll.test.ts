import { describe, expect, it } from 'vitest';
import { normalize, type Point } from '../src/core/layout';
import { DIM, render, type Program } from '../src/core/effects';
import { POLL_COLORS, apportion, leaders, pollReduce, startPoll, tally, zones } from '../src/core/poll';
import { parsePhoneMsg } from '../src/core/protocol';

function roomOf(points: [number, number][]) {
  return normalize(new Map(points.map(([x, y], i) => [i, { x, y } as Point])));
}

const poll = () => startPoll('Pizza or tacos?', ['Pizza', 'Tacos', 'Both']);

describe('room poll', () => {
  it('opens with no votes and a count of zero for every option', () => {
    const s = poll();
    expect(s.phase).toBe('open');
    expect(tally(s)).toEqual([0, 0, 0]);
  });

  it('counts one vote per phone, and a changed vote moves instead of adding', () => {
    let s = poll();
    s = pollReduce(s, { type: 'vote', seat: 0, choice: 0 });
    s = pollReduce(s, { type: 'vote', seat: 1, choice: 1 });
    expect(tally(s)).toEqual([1, 1, 0]);
    s = pollReduce(s, { type: 'vote', seat: 0, choice: 2 });
    expect(tally(s)).toEqual([0, 1, 1]);
    // Voting the same thing twice changes nothing.
    expect(pollReduce(s, { type: 'vote', seat: 0, choice: 2 })).toBe(s);
  });

  it('ignores votes for options that do not exist', () => {
    const s = poll();
    expect(pollReduce(s, { type: 'vote', seat: 0, choice: 3 })).toBe(s);
    expect(pollReduce(s, { type: 'vote', seat: 0, choice: -1 })).toBe(s);
  });

  it('a phone that leaves takes its vote with it', () => {
    let s = poll();
    s = pollReduce(s, { type: 'vote', seat: 0, choice: 0 });
    s = pollReduce(s, { type: 'vote', seat: 1, choice: 0 });
    s = pollReduce(s, { type: 'leave', seat: 1 });
    expect(tally(s)).toEqual([1, 0, 0]);
    expect(pollReduce(s, { type: 'leave', seat: 7 })).toBe(s);
  });

  it('a closed poll takes no votes until it reopens, and reopening keeps the votes', () => {
    let s = pollReduce(poll(), { type: 'vote', seat: 0, choice: 1 });
    s = pollReduce(s, { type: 'close' });
    expect(s.phase).toBe('closed');
    expect(pollReduce(s, { type: 'vote', seat: 0, choice: 0 })).toBe(s);
    s = pollReduce(s, { type: 'reopen' });
    expect(s.phase).toBe('open');
    expect(tally(s)).toEqual([0, 1, 0]);
  });

  it('reveal stops voting; reopening goes back to the buttons', () => {
    let s = pollReduce(poll(), { type: 'reveal' });
    expect(s.phase).toBe('revealed');
    expect(pollReduce(s, { type: 'vote', seat: 0, choice: 0 })).toBe(s);
    expect(pollReduce(s, { type: 'reopen' }).phase).toBe('open');
  });

  it('percentages always add up to 100, and zero votes gives zeros', () => {
    expect(apportion([1, 1, 1], 100)).toEqual([34, 33, 33]);
    expect(apportion([2, 1], 100)).toEqual([67, 33]);
    expect(apportion([0, 0, 0], 100)).toEqual([0, 0, 0]);
    expect(apportion([0, 5], 100)).toEqual([0, 100]);
  });

  it('ties: every option sharing the top count leads, and nobody leads with zero votes', () => {
    expect(leaders([2, 2, 1])).toEqual([0, 1]);
    expect(leaders([0, 3, 1])).toEqual([1]);
    expect(leaders([0, 0])).toEqual([]);
  });

  it('zones: the room becomes the chart, left to right, sized by share', () => {
    // Six phones in a row, listed out of order.
    const room = roomOf([
      [0.9, 0.5],
      [0.1, 0.5],
      [0.5, 0.5],
      [0.3, 0.5],
      [0.7, 0.5],
      [0.0, 0.5],
    ]);
    // A: 2 votes, B: 0, C: 1  ->  4 phones of A on the left, then 2 of C.
    const z = zones(room, [2, 0, 1]);
    const byX = [...room.positions].sort((a, b) => a[1].x - b[1].x).map(([seat]) => z.get(seat));
    expect(byX).toEqual([0, 0, 0, 0, 2, 2]);
  });

  it('zones: a tie splits the room evenly, the first option on the left', () => {
    const room = roomOf([
      [0, 0],
      [1, 0],
      [0.5, 1],
    ]);
    const z = zones(room, [1, 1]);
    expect([z.get(0), z.get(2), z.get(1)]).toEqual([0, 0, 1]);
  });

  it('zones: no votes colours nobody', () => {
    expect(zones(roomOf([[0, 0], [1, 1]]), [0, 0, 0]).size).toBe(0);
  });

  it('zones: phones in the same column are split front to back, so the result is stable', () => {
    const room = roomOf([
      [0.5, 1],
      [0.5, 0],
    ]);
    const z = zones(room, [1, 1]);
    expect(z.get(1)).toBe(0);
    expect(z.get(0)).toBe(1);
  });
});

describe('poll on the wire and on the phone', () => {
  it('a vote message must name a whole option number', () => {
    expect(parsePhoneMsg({ t: 'vote', choice: 2 })).toEqual({ t: 'vote', choice: 2 });
    for (const choice of [1.5, -1, 4, '1', null, Infinity]) expect(parsePhoneMsg({ t: 'vote', choice })).toBeNull();
  });

  const prog = (over: Partial<Extract<Program, { kind: 'poll' }>> = {}): Program => ({
    kind: 'poll',
    question: 'Q',
    options: ['Yes', 'No'],
    phase: 'revealed',
    mine: null,
    result: { pct: [67, 33], zone: null },
    ...over,
  });

  it('after Reveal a placed phone wears its zone’s colour and share, whatever it voted', () => {
    const f = render(prog({ mine: 1, result: { pct: [67, 33], zone: 0 } }), { seat: 0, pos: { x: 0.1, y: 0.5 }, aspect: 1 }, 0);
    expect(f.rgb).toEqual(POLL_COLORS[0]);
    expect(f.label).toBe('A 67%');
  });

  it('after Reveal an unplaced phone shows its own choice and that choice’s share', () => {
    const f = render(prog({ mine: 1 }), { seat: 0, pos: null, aspect: 1 }, 0);
    expect(f.rgb).toEqual(POLL_COLORS[1]);
    expect(f.label).toBe('B 33%');
    expect(render(prog(), { seat: 0, pos: null, aspect: 1 }, 0).rgb).toEqual(DIM);
  });

  it('while voting, a phone glows faintly in the colour it picked', () => {
    const f = render(prog({ phase: 'open', result: null, mine: 1 }), { seat: 0, pos: null, aspect: 1 }, 0);
    expect(f.rgb).not.toEqual(DIM);
    expect(f.rgb[2]).toBeGreaterThan(f.rgb[0]);
    expect(render(prog({ phase: 'open', result: null }), { seat: 0, pos: null, aspect: 1 }, 0).rgb).toEqual(DIM);
  });
});
