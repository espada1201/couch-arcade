// The Card stunt styles: what each one flips, how it previews and what it tells the host.
import { BLACK, type Program } from '../core/effects';
import { sampleCrowd, type Image } from '../core/layout';
import { plural } from '../ui/dom';
import type { Run } from './director';
import type { Stunt } from './images';
import { wallFlip, wallPreviewer } from './photowall';
import type { HostSession } from './session';

/** How long the crowd counts down before a card stunt flips. */
export const FLIP_LEAD_MS = 3200;

/** `image` across the crowd: each phone takes its patch, and all flip together after a countdown. */
export function cardProgram(session: HostSession, image: Image, leadMs = FLIP_LEAD_MS): (seat: number) => Program {
  const colors = sampleCrowd(image, session.layout, Math.min(0.25, 0.6 / Math.sqrt(Math.max(1, session.layout.positions.size))));
  const at = session.now() + leadMs;
  return (seat) => ({ kind: 'card', rgb: colors.get(seat) ?? BLACK, at });
}

export function flipCards(session: HostSession, image: Image, leadMs = FLIP_LEAD_MS): void {
  session.setProgram(cardProgram(session, image, leadMs));
}

/** What the director needs to flip the room: the program, and whether it is a stream of pictures. */
export type Flip = Pick<Run, 'program' | 'frame'>;

/** What a style does with a Flip press: `lead` is the countdown; `say` the status line; `signal` aborts once the press is out of date. */
export interface FlipControl {
  lead: number;
  say(text: string): void;
  signal: AbortSignal;
}

/** How a Flip press ended: the flip to run, a message for the host, or nothing because the press was dropped. */
export type FlipOutcome = { go: Flip } | { refuse: string } | { cancelled: true };

/** How one style of card stunt reads, previews and flips. */
interface CardStyleDef {
  label: string;
  note: string;
  /** What the host reads once the flip is on, for `n` connected phones. */
  status(n: number): string;
  flip(session: HostSession, stunt: Stunt, ctl: FlipControl): Promise<FlipOutcome>;
  /** Keeps `into` showing the picture the way this style will use it. */
  preview(session: HostSession, into: HTMLElement): (stunt: Stunt) => void;
}

/** Photo wall: each phone shows its own piece of the picture. Stadium cards: each phone shows one colour of it. */
export const STYLES = {
  wall: {
    label: 'Photo wall',
    note: 'Lay the phones side by side, screens up, and each one shows its own piece of the picture.',
    status: (n) => `3, 2, 1… ${plural(n, 'phone')} ${n === 1 ? 'shows its' : 'show their'} piece of the picture.`,
    flip: wallFlip,
    preview: wallPreviewer,
  },
  cards: {
    label: 'Stadium cards',
    note: 'Each phone shows one colour of the picture, so the more phones, the sharper it gets. Best for a big crowd far away.',
    status: (n) => `3, 2, 1… ${plural(n, 'phone')} ${n === 1 ? 'flips' : 'flip'} together.`,
    flip: async (session, stunt, { lead }) => ({ go: { program: cardProgram(session, stunt.image, lead) } }),
    preview: (_, into) => (stunt) => {
      if (into.firstChild !== stunt.canvas) into.replaceChildren(stunt.canvas);
    },
  },
} satisfies Record<string, CardStyleDef>;
export type CardStyle = keyof typeof STYLES;
export const STYLE_KEYS = Object.keys(STYLES) as CardStyle[];
