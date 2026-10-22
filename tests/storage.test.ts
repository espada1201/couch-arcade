import { afterEach, describe, expect, it, vi } from 'vitest';
import { forget, loadJson, saveJson, stableId } from '../src/storage';
import { randomId } from '../src/net/transport';

function memory() {
  const m = new Map<string, string>();
  return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v), removeItem: (k: string) => void m.delete(k) };
}

const blocked = {
  getItem: () => {
    throw new Error('blocked');
  },
  setItem: () => {
    throw new Error('blocked');
  },
  removeItem: () => {
    throw new Error('blocked');
  },
};

afterEach(() => vi.unstubAllGlobals());

describe('storage', () => {
  it('round-trips JSON and forgets it', () => {
    vi.stubGlobal('localStorage', memory());
    expect(loadJson('k')).toBeNull();
    saveJson('k', { a: [1, 2] });
    expect(loadJson('k')).toEqual({ a: [1, 2] });
    forget('k');
    expect(loadJson('k')).toBeNull();
  });

  it('keeps a stable id per key, stored as plain text', () => {
    const store = memory();
    vi.stubGlobal('localStorage', store);
    const a = stableId('id-a', 16);
    expect(a).toHaveLength(16);
    expect(stableId('id-a', 16)).toBe(a);
    expect(store.getItem('id-a')).toBe(a);
    expect(stableId('id-b', 16)).not.toBe(a);
  });

  it('never throws when storage is blocked or holds junk', () => {
    vi.stubGlobal('localStorage', blocked);
    expect(loadJson('k')).toBeNull();
    expect(() => saveJson('k', 1)).not.toThrow();
    expect(() => forget('k')).not.toThrow();
    expect(stableId('k', 8)).toHaveLength(8);
    const junk = memory();
    junk.setItem('k', '{nope');
    vi.stubGlobal('localStorage', junk);
    expect(loadJson('k')).toBeNull();
  });

  it('random ids draw from the alphabet asked for', () => {
    expect(randomId(64, 'AB')).toMatch(/^[AB]{64}$/);
    expect(randomId()).toMatch(/^[a-z2-9]{10}$/);
  });
});
