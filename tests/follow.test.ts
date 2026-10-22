import { describe, expect, it } from 'vitest';
import { MAX_CARD_CHARS, NO_CAPTIONS, captionLines, deckFrom, heard, parseCards, step } from '../src/core/follow';
import { FRAME_BUDGET, dataUrlBytes } from '../src/core/frames';
import { MAX_MESSAGE_BYTES, messageBytes, payloadBytes } from '../src/core/protocol';
import { CHUNK_BYTES } from '../src/net/chunks';

describe('text cards', () => {
  it('one card per non-empty line, trimmed', () => {
    expect(parseCards('  Welcome \n\n Agenda\r\nCake at 8\n   ')).toEqual(['Welcome', 'Agenda', 'Cake at 8']);
  });

  it('caps a pasted wall of text so a card always fits in one message', () => {
    const [card] = parseCards('x'.repeat(5000));
    expect(card.length).toBe(MAX_CARD_CHARS);
  });

  it('steps forward and back and stops at both ends', () => {
    let d = deckFrom('a\nb\nc');
    expect(d.at).toBe(0);
    d = step(d, 1);
    d = step(d, 1);
    expect(d.cards[d.at]).toBe('c');
    expect(step(d, 1).at).toBe(2);
    expect(step(step(step(d, -1), -1), -1).at).toBe(0);
  });

  it('editing the lines keeps your place, clamped to the new length', () => {
    const d = step(step(deckFrom('a\nb\nc'), 1), 1);
    expect(deckFrom('a\nb\nc\nd', d.at).at).toBe(2);
    expect(deckFrom('a', d.at).at).toBe(0);
    expect(deckFrom('', 3)).toEqual({ cards: [], at: 0 });
  });
});

describe('captions', () => {
  it('shows interim words as they come, then keeps them once final', () => {
    let c = heard(NO_CAPTIONS, 'thank you all', false);
    expect(captionLines(c)).toEqual(['thank you all']);
    c = heard(c, 'thank you all for coming', true);
    expect(captionLines(c)).toEqual(['thank you all for coming']);
    expect(c.interim).toBe('');
  });

  it('keeps only the last few lines, counting the interim one', () => {
    let c = NO_CAPTIONS;
    for (const s of ['one', 'two', 'three', 'four']) c = heard(c, s, true);
    expect(captionLines(c)).toEqual(['two', 'three', 'four']);
    c = heard(c, 'fi', false);
    expect(captionLines(c)).toEqual(['three', 'four', 'fi']);
    expect(captionLines(c, 2)).toEqual(['four', 'fi']);
  });

  it('splits a long final result into readable lines at word boundaries', () => {
    const long = Array.from({ length: 60 }, (_, i) => `word${i}`).join(' ');
    const c = heard(NO_CAPTIONS, long, true);
    const lines = captionLines(c);
    expect(lines.length).toBe(3);
    expect(lines.every((l) => l.length <= 90)).toBe(true);
    expect(lines.at(-1)!.endsWith('word59')).toBe(true);
  });

  it('ignores blank results', () => {
    expect(heard(NO_CAPTIONS, '   ', true)).toEqual(NO_CAPTIONS);
  });
});

describe('message size', () => {
  it('counts UTF-8 bytes of the serialized message', () => {
    expect(messageBytes({ t: 'x' })).toBe(9);
    expect(messageBytes({ s: 'é' })).toBe(10);
  });

  it('the biggest card in emoji still fits under the transport limit', () => {
    const card = parseCards('😀'.repeat(MAX_CARD_CHARS))[0];
    const msg = { t: 'program', program: { kind: 'follow', view: { show: 'card', text: card, n: 1, of: 1 } } };
    expect(messageBytes(msg)).toBeLessThanOrEqual(MAX_MESSAGE_BYTES);
  });
});

describe('one message limit', () => {
  it('a full-budget picture frame, as a program message, fits under the transport limit', () => {
    const b64 = 'A'.repeat(Math.ceil(FRAME_BUDGET / 3) * 4);
    const msg = { t: 'program', program: { kind: 'follow', view: { show: 'picture', src: `data:image/jpeg;base64,${b64}`, seq: 1e9 } } };
    expect(dataUrlBytes(msg.program.view.src)).toBeGreaterThanOrEqual(FRAME_BUDGET);
    expect(messageBytes(msg)).toBeLessThanOrEqual(MAX_MESSAGE_BYTES);
  });

  it('chunks and frames are both cut from the one 60 KB limit', () => {
    expect(MAX_MESSAGE_BYTES).toBe(60 * 1024);
    expect(CHUNK_BYTES).toBe(payloadBytes(512));
    expect(FRAME_BUDGET).toBe(payloadBytes(1024));
  });
});
