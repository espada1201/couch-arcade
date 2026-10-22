// What a phone may send, shared by the app and the relay (server/relay.mjs runs this file as is).
// Phones are untrusted: the host and the relay close a phone past these limits, so an honest
// phone keeps to a budget of its own well inside them.

/** Largest message a phone may send: phones send only small control messages. */
export const PHONE_MESSAGE_BYTES = 2048;

/** What an honest phone sends at most (taps, pings, acks): messages a second, and its burst. */
export const PHONE_BUDGET = { rate: 25, burst: 25 };

/** What the host and the relay allow a phone: twice its own budget, in bursts of two seconds' worth. */
export const PHONE_LIMIT = { rate: 2 * PHONE_BUDGET.rate, burst: 4 * PHONE_BUDGET.rate };

/**
 * `rate` messages a second on average, in bursts of up to `burst`. `take(now, reserve)` spends one
 * if at least `reserve` more would be left, so a message that can wait leaves room for one that can't.
 */
export function tokenBucket({ rate, burst }, now) {
  let tokens = burst;
  let at = now;
  const fill = (t) => {
    tokens = Math.min(burst, tokens + ((t - at) * rate) / 1000);
    at = t;
  };
  return {
    take(t, reserve = 0) {
      fill(t);
      if (tokens < 1 + reserve) return false;
      tokens--;
      return true;
    },
    /** Milliseconds from `t` until `take(t, reserve)` would succeed. */
    wait(t, reserve = 0) {
      fill(t);
      return Math.max(0, ((1 + reserve - tokens) * 1000) / rate);
    },
  };
}
