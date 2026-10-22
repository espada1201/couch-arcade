// localStorage that never throws: when storage is blocked, things just don't survive a reload.
import { randomId } from './net/transport';

export function loadJson<T>(key: string): T | null {
  try {
    return JSON.parse(localStorage.getItem(key) ?? 'null') as T | null;
  } catch {
    return null;
  }
}

export function saveJson(key: string, value: unknown): void {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // Storage unavailable.
  }
}

export function forget(key: string): void {
  try {
    localStorage.removeItem(key);
  } catch {
    // Nothing saved to clear.
  }
}

/** A random id kept under `key` across reloads (for this page only if storage is blocked). */
export function stableId(key: string, len: number): string {
  try {
    const saved = localStorage.getItem(key);
    if (saved) return saved;
  } catch {
    // Storage blocked: make one up below.
  }
  const id = randomId(len);
  try {
    localStorage.setItem(key, id);
  } catch {
    // As above.
  }
  return id;
}
