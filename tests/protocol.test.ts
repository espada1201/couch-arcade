import { describe, expect, it } from 'vitest';
import { parsePhoneMsg } from '../src/core/protocol';

describe('the screen message', () => {
  it('carries a phone’s screen shape, as sent', () => {
    expect(parsePhoneMsg({ t: 'screen', aspect: 0.46 })).toEqual({ t: 'screen', aspect: 0.46 });
    expect(parsePhoneMsg({ t: 'screen', aspect: 2.16 })).toEqual({ t: 'screen', aspect: 2.16 });
  });

  it('is refused unless the shape is a number a phone could have', () => {
    for (const aspect of [NaN, Infinity, -1, 0, 0.19, 5.1, 100, '0.5', null, undefined]) expect(parsePhoneMsg({ t: 'screen', aspect })).toBeNull();
    expect(parsePhoneMsg({ t: 'screen' })).toBeNull();
  });

  it('keeps only the shape, whatever else comes along', () => {
    expect(parsePhoneMsg({ t: 'screen', aspect: 0.5, extra: 'x' })).toEqual({ t: 'screen', aspect: 0.5 });
  });
});
