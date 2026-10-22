// A phone on a slow connection can't keep up with Follow mode's picture frames. Each new
// frame replaces the last, so once its socket holds about two of them the relay drops
// frames for that phone instead of queueing them without bound.

/** Bytes waiting on a phone's socket past which picture frames are dropped (about two frames). */
export const PICTURE_BACKLOG = 2 * 64 * 1024;

/** Whether to skip `data` (a host message) for a phone with `buffered` bytes still waiting. */
export function skipForSlowPhone(data, buffered) {
  return buffered > PICTURE_BACKLOG && data?.t === 'program' && data.program?.kind === 'follow' && data.program.view?.show === 'picture';
}
