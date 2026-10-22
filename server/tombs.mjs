// Rooms a dropped host may come back for: a reload, a laptop asleep or a Wi-Fi blip must not lose the code.

/**
 * Holds a dropped host's room code for `holdMs`, for at most `max` rooms at once (the oldest goes
 * first). Only a room somebody was waiting on is held: one that had a phone, or lasted more than
 * `minLifeMs`. A host that opened and closed at once has no phones to bring back.
 */
export function tombstones({ max, holdMs, minLifeMs, now = Date.now }) {
  /** room -> { key, until }, oldest first: a Map keeps the order its keys were added in. */
  const held = new Map();
  const live = (room) => {
    const tomb = held.get(room);
    return tomb && tomb.until > now() ? tomb : undefined;
  };
  return {
    get size() {
      return held.size;
    },
    hold(room, key, { born, hadPhone }) {
      if (!hadPhone && now() - born <= minLifeMs) return;
      held.delete(room);
      held.set(room, { key, until: now() + holdMs });
      for (const oldest of held.keys()) {
        if (held.size <= max) break;
        held.delete(oldest);
      }
    },
    /** The key of the host this room is held for, if it is held now. */
    heldFor: (room) => live(room)?.key,
    release: (room) => held.delete(room),
    sweep() {
      for (const room of held.keys()) if (!live(room)) held.delete(room);
    },
  };
}
