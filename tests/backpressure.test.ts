import { describe, expect, it } from 'vitest';
import { PICTURE_BACKLOG, skipForSlowPhone } from '../server/backpressure.mjs';

const picture = { t: 'program', program: { kind: 'follow', view: { show: 'picture', src: 'data:image/jpeg;base64,AAAA', seq: 3 } } };
const card = { t: 'program', program: { kind: 'follow', view: { show: 'card', text: 'Hi', n: 1, of: 1 } } };

describe('relay backpressure', () => {
  it('drops picture frames to a phone whose socket is backed up, and nothing else', () => {
    expect(skipForSlowPhone(picture, 0)).toBe(false);
    expect(skipForSlowPhone(picture, PICTURE_BACKLOG + 1)).toBe(true);
    // Cards, file chunks, pongs and the rest always go through: they are not replaced by the next frame.
    for (const m of [card, { t: 'chunk', id: 'a', i: 0, n: 1, d: '' }, { t: 'pong', c0: 1, h1: 2, h2: 3 }, null, 'x'])
      expect(skipForSlowPhone(m, PICTURE_BACKLOG * 10)).toBe(false);
  });

  it('the bound is about two full frames', () => {
    expect(PICTURE_BACKLOG).toBe(2 * 64 * 1024);
  });
});
