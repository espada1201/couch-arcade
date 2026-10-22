import { describe, expect, it } from 'vitest';
import { BasicLink, LATEST_BACKLOG } from '../src/net/transport';

/** A link whose backlog the test sets, recording what it actually sends. */
function link() {
  const out: unknown[] = [];
  let backlog = 0;
  const l = new BasicLink((m) => out.push(m), () => {}, () => backlog);
  return { l, out, setBacklog: (b: number) => (backlog = b) };
}

describe('backpressure on one link', () => {
  it('holds a latest message back on a backed-up link, and nothing else', () => {
    const { l, out, setBacklog } = link();
    l.send('frame 1', { latest: true });
    setBacklog(LATEST_BACKLOG + 1);
    l.send('frame 2', { latest: true });
    expect(out).toEqual(['frame 1']);
    // Cards, file chunks, pongs and the rest always go, after the held frame so order holds.
    l.send('pong');
    expect(out).toEqual(['frame 1', 'frame 2', 'pong']);
  });

  it('keeps only the newest held frame and sends it once the link drains', () => {
    const { l, out, setBacklog } = link();
    setBacklog(LATEST_BACKLOG + 1);
    for (const f of ['a', 'b', 'c']) l.send(f, { latest: true });
    l.drained();
    expect(out).toEqual([]);
    setBacklog(0);
    l.drained();
    l.drained();
    expect(out).toEqual(['c']);
  });

  it('drops a held frame when a newer one goes out', () => {
    const { l, out, setBacklog } = link();
    setBacklog(LATEST_BACKLOG + 1);
    l.send('old', { latest: true });
    setBacklog(0);
    l.send('new', { latest: true });
    l.drained();
    expect(out).toEqual(['new']);
  });

  it('the bound is about two full frames', () => {
    expect(LATEST_BACKLOG).toBe(2 * 60 * 1024);
  });

  it('a closed link sends nothing it held', () => {
    const { l, out, setBacklog } = link();
    setBacklog(LATEST_BACKLOG + 1);
    l.send('frame', { latest: true });
    l.ended();
    setBacklog(0);
    l.drained();
    expect(out).toEqual([]);
  });
});
