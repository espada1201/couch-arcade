import type { ChildProcess } from 'node:child_process';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import type { HostMsg } from '../src/core/protocol';
import type { Program } from '../src/core/effects';
import { HostSession } from '../src/host/session';
import { RelayTransport } from '../src/net/relay';
import { LATEST_BACKLOG, type Link } from '../src/net/transport';
import { memoryStorage } from './harness';
import { freePort, rawPhone, startRelay } from './relayserver';

let relay: ChildProcess;
let port = 0;

function stopRelay(child: ChildProcess): Promise<void> {
  return new Promise((resolve) => {
    child.removeAllListeners('exit');
    child.once('exit', () => resolve());
    child.kill();
  });
}

const until = (ok: () => boolean, ms = 15_000) => vi.waitFor(() => expect(ok()).toBe(true), { timeout: ms, interval: 50 });

beforeAll(async () => {
  port = await freePort();
  vi.stubGlobal('location', new URL(`http://127.0.0.1:${port}/`));
  vi.stubGlobal('localStorage', memoryStorage());
  relay = await startRelay(port);
});

afterAll(async () => {
  vi.unstubAllGlobals();
  await stopRelay(relay);
});

describe('relay host end', () => {
  it('reclaims its room after the relay restarts, says so while down, and takes phones again', async () => {
    const t = new RelayTransport();
    const end = await t.host('BACK');
    const server: string[] = [];
    const links: Link[] = [];
    end.onServer((state) => server.push(state));
    end.onLink((l) => links.push(l));

    const phone = await t.join('BACK');
    await until(() => links.length === 1);
    let phoneClosed = false;
    phone.onClose(() => (phoneClosed = true));

    await stopRelay(relay);
    await until(() => phoneClosed && server.at(-1) === 'down');
    relay = await startRelay(port);
    await until(() => server.at(-1) === 'up');

    const again = await t.join('BACK');
    await until(() => links.length === 2);
    const got: unknown[] = [];
    links[1].onMessage((m) => got.push(m));
    again.send({ t: 'hello' });
    await until(() => got.length === 1);
    expect(got[0]).toEqual({ t: 'hello' });
    expect(server).toEqual(['down', 'up']);
    end.close();
  }, 30_000);

  it('stops reconnecting once closed', async () => {
    const t = new RelayTransport();
    const end = await t.host('GONE');
    const server: string[] = [];
    end.onServer((state) => server.push(state));
    end.close();
    await new Promise((r) => setTimeout(r, 1500));
    expect(server).toEqual([]);
    await expect(t.join('GONE')).rejects.toThrow('No host');
  });
});

/** A Big screen frame of about `kb` KB, numbered `seq`. */
const picture = (seq: number, kb = 50): Program => ({ kind: 'follow', view: { show: 'picture', src: `data:image/jpeg;base64,${'A'.repeat(kb * 1024)}`, seq } });
const seqOf = (m: unknown) => {
  const p = (m as HostMsg).t === 'program' ? (m as Extract<HostMsg, { t: 'program' }>).program : null;
  return p?.kind === 'follow' && p.view.show === 'picture' ? p.view.seq : -1;
};

/** A HostSession on the relay with `n` phones seated through RelayTransport. */
async function relayRoom(code: string, n: number) {
  const t = new RelayTransport();
  const session = new HostSession(t, code);
  await session.open();
  const phones = await Promise.all(
    Array.from({ length: n }, async (_, i) => {
      const link = await t.join(code);
      const got: unknown[] = [];
      link.onMessage((m) => got.push(m));
      link.send({ t: 'hello', token: `${code}-phone-${i}` });
      return { link, got };
    }),
  );
  await until(() => session.online.length === n);
  return { t, session, phones };
}

describe('Big screen frames through the relay', () => {
  it('every phone in the room gets each 50 KB picture, not just the first two', async () => {
    const { session, phones } = await relayRoom('PICS', 6);
    for (let seq = 1; seq <= 3; seq++) {
      session.setProgram(picture(seq), { latest: true });
      await until(() => phones.every((p) => p.got.some((m) => seqOf(m) === seq)), 5000);
    }
  }, 20_000);

  it('a phone that stops reading skips frames, then gets the newest once it drains', async () => {
    const { session, phones } = await relayRoom('SLOW', 3);
    const slow = await rawPhone(port, 'SLOW');
    slow.send({ t: 'hello', token: 'SLOW-raw' });
    await until(() => session.online.length === 4);
    const link = session.online.find((s) => s.token === 'SLOW-raw')!.link!;
    slow.pause();
    let seq = 0;
    // Fill the slow phone's socket and the kernel buffers behind it until the host holds frames back.
    while (link.buffered() <= LATEST_BACKLOG && seq < 2000) {
      session.setProgram(picture(++seq), { latest: true });
      await new Promise((r) => setTimeout(r, 5));
    }
    expect(link.buffered()).toBeGreaterThan(LATEST_BACKLOG);
    const sent = seq;
    for (let i = 0; i < 5; i++) session.setProgram(picture(++seq), { latest: true });
    // The phones that keep up see every frame, the newest included.
    await until(() => phones.every((p) => p.got.some((m) => seqOf(m) === seq)), 5000);
    // The slow phone's backlog stays bounded: the five newer frames were not all queued for it.
    expect(link.buffered()).toBeLessThan(LATEST_BACKLOG + 3 * 52 * 1024);
    slow.resume();
    await until(() => slow.got.some((m) => seqOf(m) === seq), 10_000);
    const seen = slow.got.map(seqOf).filter((x) => x > sent);
    expect(seen).toEqual([seq]);
    slow.destroy();
  }, 60_000);
});

describe('the same room opened in a second host tab', () => {
  it('moves every phone to the new tab, and the old tab says the room moved', async () => {
    const first = new HostSession(new RelayTransport(), 'MOVE');
    await first.open();
    const t = new RelayTransport();
    // A phone that, like PhoneClient, says hello on every link and rejoins when one closes.
    const phone = (token: string) => {
      const state = { links: 0, live: true };
      const join = async () => {
        if (!state.live) return;
        const link = await t.join('MOVE').catch(() => null);
        if (!link) return void setTimeout(join, 200);
        state.links++;
        link.onClose(() => setTimeout(join, 200));
        link.send({ t: 'hello', token });
      };
      void join();
      return state;
    };
    const phones = [phone('MOVE-a'), phone('MOVE-b')];
    await until(() => first.online.length === 2);

    const second = new HostSession(new RelayTransport(), 'MOVE');
    await second.open();
    await until(() => second.online.length === 2, 8000);
    expect(second.online.map((s) => s.token).sort()).toEqual(['MOVE-a', 'MOVE-b']);
    await until(() => first.server === 'moved');
    for (const p of phones) p.live = false;
  }, 20_000);
});
