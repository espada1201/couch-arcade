import { describe, expect, it } from 'vitest';
import { plural, setText } from '../src/ui/dom';

describe('plural', () => {
  it('counts one thing, and none or many things', () => {
    expect(plural(1, 'phone')).toBe('1 phone');
    expect(plural(0, 'phone')).toBe('0 phones');
    expect(plural(12, 'throw')).toBe('12 throws');
  });
});

describe('status text', () => {
  it('is written only when it changes, so screen readers hear it once', () => {
    let writes = 0;
    let text = 'a';
    const el = {
      get textContent() {
        return text;
      },
      set textContent(v: string) {
        writes++;
        text = v;
      },
    } as unknown as Element;
    setText(el, 'a');
    setText(el, 'b');
    setText(el, 'b');
    expect(writes).toBe(1);
    expect(text).toBe('b');
  });
});
