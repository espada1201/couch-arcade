import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { PotatoState } from '../src/core/potato';
import type { TerritoryState } from '../src/core/territory';
import { POTATO_RULES, runGame, territoryRules } from '../src/host/game';
import { lastProgram, room } from './harness';

beforeEach(() => {
  vi.stubGlobal('window', globalThis);
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('crowd games follow who is actually here', () => {
  it('a phone that left never gets the potato, and one that came back can', async () => {
    const r = await room([0, 0.5, 1]);
    vi.spyOn(Math, 'random').mockReturnValue(0);
    runGame<PotatoState>(r.session, r.director, r.say, { ...POTATO_RULES, show: () => {} });
    expect(lastProgram(r.phones[0].inbox, 'potato')!.state.holder).toBe(0);
    r.phones[1].drop();
    r.phones[2].drop();
    const back = r.join('p2');
    r.tick(1600);
    r.phones[0].tap();
    expect(lastProgram(back.inbox, 'potato')!.state.holder).toBe(2);
  });

  it('a phone that left does not count toward its team', async () => {
    const r = await room([0, 0.1, 1]);
    runGame<TerritoryState>(r.session, r.director, r.say, { ...territoryRules(45_000, [[1, 1, 1], [2, 2, 2]]), show: () => {} });
    expect(r.say).toHaveBeenCalledWith('');
    expect(lastProgram(r.phones[0].inbox, 'territory')).not.toBeNull();
    // Teams start as {0} and {1, 2}; with phone 1 gone, one tap from phone 2 is a whole team's push.
    r.phones[1].drop();
    r.tick(100);
    r.phones[2].tap();
    const s = lastProgram(r.phones[0].inbox, 'territory')!.state;
    expect(s.phase).toBe('over');
    expect(s.winner).toBe(1);
  });

  it('needs two placed phones to start', async () => {
    const r = await room([0.5]);
    runGame<PotatoState>(r.session, r.director, r.say, { ...POTATO_RULES, show: () => {} });
    expect(r.say).toHaveBeenCalledWith('Hot Potato needs at least 2 connected, placed phones.');
    expect(r.director.run).not.toHaveBeenCalled();
  });
});
