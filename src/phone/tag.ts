import type { PhoneClient } from './client';

/** 1 reads 1st, 2 2nd, 11 11th, 22 22nd. */
export function ordinal(n: number): string {
  const tens = n % 100;
  const suffix = tens >= 11 && tens <= 13 ? 'th' : ({ 1: 'st', 2: 'nd', 3: 'rd' } as Record<number, string>)[n % 10] ?? 'th';
  return `${n}${suffix}`;
}

export interface TagInfo {
  room: string;
  /** 0-based; -1 before the host has given one. */
  seat: number;
  status: PhoneClient['status'];
  onMap: boolean;
  /** Where the phone stands from the left (0 first) among `of` phones on the map. */
  rank?: number;
  of?: number;
}

/**
 * The line at the top of a phone: the room, the seat (who the phone is) and, once the phone is on the map beside
 * others, where it stands from the left (which changes when the host swaps phones).
 */
export function phoneTag({ room, seat, status, onMap, rank, of }: TagInfo): string {
  const who = seat >= 0 ? `Seat ${seat + 1}` : 'Joining';
  const where = status === 'live' && onMap && rank !== undefined && of !== undefined && of > 1 ? ` · ${ordinal(rank + 1)} from left` : '';
  const state = { connecting: 'connecting…', live: onMap ? 'on the map' : 'not on the map yet', reconnecting: 'reconnecting…', full: 'room full', replaced: 'open in another tab', failed: 'disconnected' }[status];
  return `${room} · ${who}${where} · ${state}`;
}
