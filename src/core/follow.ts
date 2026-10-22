// Follow mode: every phone shows the whole picture (a shared screen, the camera, a
// text card or live captions) instead of one pixel of it. This module holds what the
// phones are told to show and the small state machines behind cards and captions.
import { clamp } from './math';

export type FollowView =
  /** A JPEG frame as a data URL; seq rises with every new picture. */
  | { show: 'picture'; src: string; seq: number }
  | { show: 'card'; text: string; n: number; of: number }
  /** The last few caption lines; when `interim`, the last one is still being heard. */
  | { show: 'captions'; lines: string[]; interim: boolean }
  /** A holding message while a source starts up. */
  | { show: 'wait'; text: string };

/** Longest card, in characters: keeps any card (even all emoji) far inside one transport message. */
export const MAX_CARD_CHARS = 400;

/** One card per non-empty line. */
export function parseCards(text: string): string[] {
  return text
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean)
    .map((l) => Array.from(l).slice(0, MAX_CARD_CHARS).join(''));
}

export interface Deck {
  cards: string[];
  at: number;
}


/** A deck from the host's text, keeping the current place where it still exists. */
export function deckFrom(text: string, at = 0): Deck {
  const cards = parseCards(text);
  return { cards, at: cards.length ? clamp(at, 0, cards.length - 1) : 0 };
}

export function step(d: Deck, delta: number): Deck {
  return d.cards.length ? { ...d, at: clamp(d.at + delta, 0, d.cards.length - 1) } : d;
}

export interface Captions {
  done: string[];
  interim: string;
}

export const NO_CAPTIONS: Captions = { done: [], interim: '' };

/** Longest caption line, so a long sentence becomes several readable lines. */
const LINE_CHARS = 90;
/** Finished lines remembered (more than are ever shown). */
const HISTORY = 6;

function splitLine(text: string): string[] {
  const out: string[] = [];
  let line = '';
  for (const word of text.split(/\s+/).filter(Boolean)) {
    if (line && line.length + 1 + word.length > LINE_CHARS) {
      out.push(line);
      line = '';
    }
    line = line ? `${line} ${word}` : word.slice(0, LINE_CHARS);
  }
  if (line) out.push(line);
  return out;
}

/** Fold one speech-recognition result into the caption buffer. */
export function heard(c: Captions, text: string, final: boolean): Captions {
  const t = text.trim();
  if (!final) return { done: c.done, interim: t };
  if (!t) return c.interim ? { done: c.done, interim: '' } : c;
  return { done: [...c.done, ...splitLine(t)].slice(-HISTORY), interim: '' };
}

/** What a phone shows: the newest `keep` lines, the still-being-heard words last. */
export function captionLines(c: Captions, keep = 3): string[] {
  return [...c.done, ...splitLine(c.interim)].slice(-keep);
}
