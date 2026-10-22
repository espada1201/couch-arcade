import { describe, expect, it } from 'vitest';
import { plural } from '../src/ui/dom';

describe('plural', () => {
  it('counts one thing, and none or many things', () => {
    expect(plural(1, 'phone')).toBe('1 phone');
    expect(plural(0, 'phone')).toBe('0 phones');
    expect(plural(12, 'throw')).toBe('12 throws');
  });
});
