// A small TCP proxy that makes a connection behave like bad Wi-Fi: one-way latency with
// jitter, a bandwidth cap per connection and direction, retransmit-like stalls (TCP never
// loses bytes; a lost packet shows up as a head-of-line stall of ~RTO), and drops.
// Order is preserved per direction, as on a real TCP stream. From the stress scout's proxy.mjs.
import net from 'node:net';

export function impairProxy({ listen, target, host = '192.0.2.2' }) {
  const p = {
    latencyMs: 0,
    jitterMs: 0,
    kbps: 0, // 0 = unlimited; kilobits per second per direction
    stallProb: 0, // per write chunk, chance of a retransmit stall
    stallMs: [200, 1000],
    conns: new Set(),
    bytes: { up: 0, down: 0 },
  };
  const pipe = (from, to, dir) => {
    let txFree = 0; // when the "radio" is next free
    let lastDeliver = 0;
    // One timer releases buffers in arrival order: a timer per buffer can fire out of order when
    // delays round to the same millisecond, which garbles the stream.
    const queue = [];
    let timer = null;
    const release = () => {
      timer = null;
      while (queue.length && queue[0].at <= performance.now() + 1) {
        const { buf } = queue.shift();
        if (!to.destroyed) to.write(buf);
      }
      if (queue.length) timer = setTimeout(release, queue[0].at - performance.now());
    };
    from.on('data', (buf) => {
      if (p.hole) return; // packets vanish: no FIN, no RST
      p.bytes[dir] += buf.length;
      const now = performance.now();
      const tx = p.kbps ? (buf.length * 8) / p.kbps : 0; // ms
      txFree = Math.max(txFree, now) + tx;
      let at = txFree + p.latencyMs + Math.random() * p.jitterMs;
      if (p.stallProb && Math.random() < p.stallProb) at += p.stallMs[0] + Math.random() * (p.stallMs[1] - p.stallMs[0]);
      at = Math.max(at, lastDeliver);
      lastDeliver = at;
      // Without backpressure the proxy would hide the cap from the sender; pause when far behind.
      if (txFree - now > 2000) {
        from.pause();
        setTimeout(() => from.resume(), txFree - now - 1000);
      }
      queue.push({ buf, at });
      timer ??= setTimeout(release, Math.max(0, at - now));
    });
    from.on('close', () => setTimeout(() => to.destroy(), Math.max(0, lastDeliver - performance.now())));
    from.on('error', () => to.destroy());
  };
  const server = net.createServer((c) => {
    const s = net.connect(target, host);
    c.setNoDelay(true);
    s.setNoDelay(true);
    const pair = { c, s };
    p.conns.add(pair);
    c.on('close', () => p.conns.delete(pair));
    pipe(c, s, 'up');
    pipe(s, c, 'down');
  });
  server.listen(listen, '0.0.0.0');
  p.server = server;
  /** Wi-Fi drop: kill every connection with no FIN reaching either side in time. */
  p.dropAll = () => {
    for (const { c, s } of p.conns) {
      c.destroy();
      s.destroy();
    }
  };
  /** Blackhole: hold all traffic for `ms` (a Wi-Fi dead spot that does not reset TCP). */
  p.close = () => server.close();
  return p;
}
