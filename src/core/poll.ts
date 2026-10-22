// Room Poll: every phone votes, and on Reveal the room itself becomes the chart. The
// crowd is sorted left to right and handed out to the options in proportion to their
// votes, so a 60/40 result is literally 60% of the room in one colour.
import type { RGB, Room } from './layout';

export const MAX_OPTIONS = 4;
export const MIN_OPTIONS = 2;

/** Distinct to most colour-blind eyes (after Okabe and Ito); every place a colour appears also carries a letter. */
export const POLL_COLORS: readonly RGB[] = [
  [255, 176, 0],
  [86, 180, 233],
  [204, 121, 167],
  [0, 158, 115],
];

export const LETTERS = 'ABCD';

export type PollPhase = 'open' | 'closed' | 'revealed';

export interface PollState {
  question: string;
  options: string[];
  phase: PollPhase;
  /** Seat -> option index. One vote per phone, kept while the phone is offline; only forgetting the phone drops it. */
  votes: ReadonlyMap<number, number>;
  /** Anonymous: until Reveal nobody, host included, sees counts or who picked what. Once anyone has voted it stays on until Reveal. */
  anon: boolean;
}

export type PollAction =
  | { type: 'vote'; seat: number; choice: number }
  /** The phone was forgotten (Remove disconnected phones). */
  | { type: 'leave'; seat: number }
  | { type: 'anon'; on: boolean }
  | { type: 'close' }
  | { type: 'reopen' }
  | { type: 'reveal' };

export function startPoll(question: string, options: string[], anon = false): PollState {
  return { question, options, phase: 'open', votes: new Map(), anon };
}

/** Someone voted on the promise that nobody sees their pick before Reveal, so anonymity can't be turned off until then. */
export function anonLocked(s: PollState): boolean {
  return s.anon && s.votes.size > 0 && s.phase !== 'revealed';
}

/** Pure: returns the same object when nothing changed. */
export function pollReduce(s: PollState, a: PollAction): PollState {
  switch (a.type) {
    case 'vote': {
      if (s.phase !== 'open' || !Number.isInteger(a.choice) || a.choice < 0 || a.choice >= s.options.length) return s;
      if (s.votes.get(a.seat) === a.choice) return s;
      return { ...s, votes: new Map(s.votes).set(a.seat, a.choice) };
    }
    case 'leave': {
      if (!s.votes.has(a.seat)) return s;
      const votes = new Map(s.votes);
      votes.delete(a.seat);
      return { ...s, votes };
    }
    case 'anon':
      if (s.anon === a.on || (!a.on && anonLocked(s))) return s;
      return { ...s, anon: a.on };
    case 'close':
      return s.phase === 'open' ? { ...s, phase: 'closed' } : s;
    case 'reopen':
      return s.phase === 'open' ? s : { ...s, phase: 'open' };
    case 'reveal':
      return s.phase === 'revealed' ? s : { ...s, phase: 'revealed' };
  }
}

/** Votes per option, from the seats `counted` accepts (all of them by default). */
export function tally(s: PollState, counted: (seat: number) => boolean = () => true): number[] {
  const counts = s.options.map(() => 0);
  for (const [seat, c] of s.votes) if (counted(seat)) counts[c]++;
  return counts;
}

/** The count to show: before Reveal only phones that are here, so the bars follow the room; at Reveal every vote cast. */
export function liveTally(s: PollState, online: ReadonlySet<number>): number[] {
  return s.phase === 'revealed' ? tally(s) : tally(s, (seat) => online.has(seat));
}

/**
 * Share out `units` whole units in proportion to `weights` (largest remainder), so the
 * parts always add up: percentages sum to 100, zones cover every phone. Ties go to the
 * earlier option. All-zero weights give all zeros.
 */
export function apportion(weights: number[], units: number): number[] {
  const total = weights.reduce((a, b) => a + b, 0);
  if (total <= 0) return weights.map(() => 0);
  const exact = weights.map((w) => (w / total) * units);
  const out = exact.map(Math.floor);
  let left = units - out.reduce((a, b) => a + b, 0);
  const order = exact.map((e, i) => [e - Math.floor(e), i] as const).sort((a, b) => b[0] - a[0] || a[1] - b[1]);
  for (const [, i] of order) {
    if (left <= 0) break;
    out[i]++;
    left--;
  }
  return out;
}

/** The option(s) with the most votes; more than one is a tie, none means no votes yet. */
export function leaders(counts: number[]): number[] {
  const top = Math.max(0, ...counts);
  return top === 0 ? [] : counts.flatMap((c, i) => (c === top ? [i] : []));
}

/** Which option's zone each placed phone stands in: the room, left to right, sized by vote share. */
export function zones(room: Room, counts: number[]): Map<number, number> {
  const out = new Map<number, number>();
  const phones = [...room.positions].sort(([sa, a], [sb, b]) => a.x - b.x || a.y - b.y || sa - sb);
  const sizes = apportion(counts, phones.length);
  let k = 0;
  sizes.forEach((n, option) => {
    for (let i = 0; i < n; i++) out.set(phones[k++][0], option);
  });
  return out;
}
