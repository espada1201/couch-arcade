import type { ChildProcess } from 'node:child_process';
import { once } from 'node:events';
import { mkdirSync, rmSync } from 'node:fs';
import { connect, createServer } from 'node:net';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { networkInterfaces } from 'node:os';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { freePort, rawPhone, startRelay } from './relayserver';

let child: ChildProcess;
let port = 0;

/** Sends a raw WebSocket handshake, returns the status code, then writes `after` if it was accepted. */
function upgrade(query: string, after?: Buffer): Promise<number> {
  return new Promise((resolve, reject) => {
    const sock = connect(port, '127.0.0.1');
    sock.once('error', reject);
    sock.write(
      `GET /relay?${query} HTTP/1.1\r\nHost: localhost\r\nUpgrade: websocket\r\nConnection: Upgrade\r\n` +
        `Sec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==\r\nSec-WebSocket-Version: 13\r\n\r\n`,
    );
    sock.once('data', (buf) => {
      const status = Number(/^HTTP\/1\.1 (\d+)/.exec(String(buf))?.[1]);
      if (status === 101 && after) sock.write(after, () => setTimeout(() => (sock.destroy(), resolve(status)), 100));
      else {
        sock.destroy();
        resolve(status);
      }
    });
  });
}

async function relayJsonStatus(): Promise<number> {
  return (await fetch(`http://127.0.0.1:${port}/relay.json`)).status;
}

beforeAll(async () => {
  port = await freePort();
  child = await startRelay(port);
});

afterAll(() => {
  child.kill();
});

describe('relay server', () => {
  it('answers a malformed URL with 400 and keeps serving', async () => {
    expect((await fetch(`http://127.0.0.1:${port}/%E0`)).status).toBe(400);
    expect(await relayJsonStatus()).toBe(200);
  });

  it('survives a file it cannot read', async () => {
    // A socket file in dist/: it exists and is no directory, yet opening it to read fails (ENXIO).
    const dist = fileURLToPath(new URL('../dist/', import.meta.url));
    mkdirSync(dist, { recursive: true });
    const path = join(dist, 'unreadable.sock');
    rmSync(path, { force: true });
    const sock = createServer().listen(path);
    await once(sock, 'listening');
    try {
      const res = await fetch(`http://127.0.0.1:${port}/unreadable.sock`).then((r) => r.text().then(() => r.status), () => 'dropped');
      expect(res).not.toBe(200);
    } finally {
      sock.close();
      rmSync(path, { force: true });
    }
    expect(await relayJsonStatus()).toBe(200);
  });

  it('survives an invalid WebSocket frame', async () => {
    // Masked frame with reserved opcode 3: a protocol error on the server side.
    expect(await upgrade('room=CRASH&role=host&key=secretkey1', Buffer.from([0x83, 0x80, 0, 0, 0, 0]))).toBe(101);
    expect(await relayJsonStatus()).toBe(200);
  });

  it('survives an oversized frame', async () => {
    const header = Buffer.from([0x81, 0xff, 0, 0, 0, 0, 0, 0x10, 0, 0, 0, 0, 0, 0]); // 1 MB text frame, zero mask
    expect(await upgrade('room=BIG&role=host&key=secretkey1', header)).toBe(101);
    expect(await relayJsonStatus()).toBe(200);
  });

  it('refuses phones before the upgrade when there is no host or a bad room', async () => {
    expect(await upgrade('room=NOHOST&role=phone')).toBe(404);
    expect(await upgrade('room=bad!&role=phone')).toBe(400);
  });

  it('refuses a second host with a different key', async () => {
    const sock = connect(port, '127.0.0.1');
    sock.write(
      `GET /relay?room=MINE&role=host&key=ownerkey1 HTTP/1.1\r\nHost: localhost\r\nUpgrade: websocket\r\nConnection: Upgrade\r\n` +
        `Sec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==\r\nSec-WebSocket-Version: 13\r\n\r\n`,
    );
    await new Promise((r) => sock.once('data', r));
    expect(await upgrade('room=MINE&role=host&key=thiefkey1')).toBe(409);
    expect(await upgrade('room=MINE&role=host')).toBe(400);
    expect(await upgrade('room=MINE&role=phone')).toBe(101);
    sock.destroy();
  });
});

describe('relay heartbeat', () => {
  it('closes a socket that stops answering pings, host or phone, and keeps one that answers', async () => {
    const hbPort = await freePort();
    const relay = await startRelay(hbPort, { RELAY_HEARTBEAT_MS: '200' });
    try {
      const host = await rawPhone(hbPort, 'BEAT', 'role=host&key=beatkey123');
      const deaf = await rawPhone(hbPort, 'BEAT');
      const live = new WebSocket(`ws://127.0.0.1:${hbPort}/relay?room=BEAT&role=phone`);
      await new Promise((r) => (live.onopen = r));
      let liveClosed = false;
      live.onclose = () => (liveClosed = true);
      // The bare sockets never answer a ping: gone within two beats. The host going closes its phones.
      await vi.waitFor(() => expect(deaf.closed() && host.closed()).toBe(true), { timeout: 3000 });
      await vi.waitFor(() => expect(liveClosed).toBe(true), { timeout: 3000 });
      // A browser-like socket answers pings and stays as long as its room exists.
      const host2 = new WebSocket(`ws://127.0.0.1:${hbPort}/relay?room=BEAT2&role=host&key=beatkey123`);
      await new Promise((r) => (host2.onopen = r));
      const phone2 = new WebSocket(`ws://127.0.0.1:${hbPort}/relay?room=BEAT2&role=phone`);
      await new Promise((r) => (phone2.onopen = r));
      await new Promise((r) => setTimeout(r, 1000));
      expect(phone2.readyState).toBe(WebSocket.OPEN);
      expect(host2.readyState).toBe(WebSocket.OPEN);
      host2.close();
      phone2.close();
    } finally {
      relay.kill();
    }
  });
});

describe('phones are untrusted', () => {
  const room = async (code: string) => {
    const host = new WebSocket(`ws://127.0.0.1:${port}/relay?room=${code}&role=host&key=floodkey123`);
    const got: string[] = [];
    host.onmessage = (e) => got.push(String(e.data));
    await new Promise((r) => (host.onopen = r));
    const phone = new WebSocket(`ws://127.0.0.1:${port}/relay?room=${code}&role=phone`);
    await new Promise((r) => (phone.onopen = r));
    const closed = new Promise<number>((r) => (phone.onclose = (e) => r(e.code)));
    return { host, phone, got, closed };
  };

  it('closes a phone that sends a message over 2 KB', async () => {
    const { host, phone, closed } = await room('BIGMSG');
    phone.send(JSON.stringify({ t: 'tap', pad: 'x'.repeat(3000) }));
    expect(await closed).toBe(1009);
    host.close();
  });

  it('closes a phone that floods, and keeps one that sends at a normal pace', async () => {
    const a = await room('FLOOD');
    for (let i = 0; i < 200; i++) a.phone.send('{"t":"tap"}');
    expect(await a.closed).toBe(1008);
    a.host.close();
    const b = await room('CALM');
    for (let i = 0; i < 60; i++) {
      b.phone.send('{"t":"ping","c0":1}');
      await new Promise((r) => setTimeout(r, 50));
    }
    expect(b.phone.readyState).toBe(WebSocket.OPEN);
    expect(b.got.filter((m) => m.includes('"ping"'))).toHaveLength(60);
    b.phone.close();
    b.host.close();
  });
});

describe('a room whose host dropped', () => {
  it('is not held when no phone ever joined and the host was gone within 5 s', async () => {
    const tPort = await freePort();
    const relay = await startRelay(tPort);
    const ws = (q: string) => new WebSocket(`ws://127.0.0.1:${tPort}/relay?${q}`);
    const probe = async (q: string) => (await fetch(`http://127.0.0.1:${tPort}/relay?${q}`)).status;
    try {
      const host = ws('room=BLINK&role=host&key=ownerkey123');
      await new Promise((r) => (host.onopen = r));
      host.close();
      await new Promise((r) => (host.onclose = r));
      expect(await probe('room=BLINK&role=host&key=otherkey123')).toBe(204);
    } finally {
      relay.kill();
    }
  });

  it('is kept for its host for a while: another key gets 409, the same key gets back in', async () => {
    const tPort = await freePort();
    const relay = await startRelay(tPort, { RELAY_TOMB_MS: '1500' });
    const ws = (q: string) => new WebSocket(`ws://127.0.0.1:${tPort}/relay?${q}`);
    const probe = async (q: string) => (await fetch(`http://127.0.0.1:${tPort}/relay?${q}`)).status;
    try {
      const host = ws('room=TOMB&role=host&key=ownerkey123');
      await new Promise((r) => (host.onopen = r));
      expect(await probe('room=TOMB&role=host&key=thiefkey123')).toBe(409);
      // A phone has been in the room, so there is someone to come back for.
      const phone = ws('room=TOMB&role=phone');
      await new Promise((r) => (phone.onopen = r));
      host.close();
      await new Promise((r) => (host.onclose = r));
      // Gone, but its code is held for it: a squatter is refused, and says so to a probe.
      expect(await probe('room=TOMB&role=host&key=thiefkey123')).toBe(409);
      expect(await probe('room=TOMB&role=host&key=ownerkey123')).toBe(204);
      expect(await probe('room=TOMB&role=phone')).toBe(404);
      const back = ws('room=TOMB&role=host&key=ownerkey123');
      await new Promise((r) => (back.onopen = r));
      back.close();
      await new Promise((r) => (back.onclose = r));
      // After the hold runs out the code is free again.
      await new Promise((r) => setTimeout(r, 1700));
      expect(await probe('room=TOMB&role=host&key=thiefkey123')).toBe(204);
    } finally {
      relay.kill();
    }
  });
});

/** This machine's own non-loopback address: connections from it count as another device on the Wi-Fi. */
const lanAddress = Object.values(networkInterfaces())
  .flat()
  .find((a) => a && a.family === 'IPv4' && !a.internal)?.address;

describe('one guest cannot crowd out the rest', () => {
  const open = (url: string) =>
    new Promise<number | 'open'>((resolve) => {
      const ws = new WebSocket(url);
      ws.onopen = () => resolve('open');
      ws.onerror = () => resolve(0);
    });

  /** Fills the room CROWD from this machine's LAN address until the relay says no, then checks the computer itself is not capped. */
  const crowd = async (tPort: number, cap: number) => {
    const url = (q: string, h = lanAddress) => `ws://${h}:${tPort}/relay?${q}`;
    const probe = async (q: string) => (await fetch(`http://${lanAddress}:${tPort}/relay?${q}`)).status;
    const host = new WebSocket(url('room=CROWD&role=host&key=crowdkey123', '127.0.0.1'));
    await new Promise((r) => (host.onopen = r));
    const phones = await Promise.all(Array.from({ length: cap }, () => open(url('room=CROWD&role=phone'))));
    expect(phones).toEqual(Array(cap).fill('open'));
    expect(await probe('room=CROWD&role=phone')).toBe(429);
    expect(await open(url('room=CROWD&role=phone'))).toBe(0);
    // Tabs on the host computer (and anything behind a proxy on it) are not one guest.
    const local = await Promise.all(Array.from({ length: cap + 2 }, () => open(url('room=CROWD&role=phone', '127.0.0.1'))));
    expect(local).toEqual(Array(cap + 2).fill('open'));
    const rooms = await Promise.all(Array.from({ length: cap }, (_, i) => open(url(`room=CROWD${i}&role=host&key=crowdkey12${i}`))));
    expect(rooms).toEqual(Array(cap).fill('open'));
    expect(await probe('room=CROWDX&role=host&key=crowdkeyxxx')).toBe(429);
    host.close();
  };

  it.skipIf(!lanAddress)('lets one device open 16 phone sockets and host 16 rooms by default; the computer itself is not capped', async () => {
    await crowd(port, 16);
  });

  it.skipIf(!lanAddress)('takes the cap from RELAY_PER_DEVICE', async () => {
    const tPort = await freePort();
    const relay = await startRelay(tPort, { RELAY_PER_DEVICE: '3' });
    try {
      await crowd(tPort, 3);
    } finally {
      relay.kill();
    }
  });
});

describe('a full relay', () => {
  it('still takes back a host returning to the room it holds', async () => {
    const tPort = await freePort();
    const relay = await startRelay(tPort);
    const ws = (q: string) => new WebSocket(`ws://127.0.0.1:${tPort}/relay?${q}`);
    const opened = (w: WebSocket) => new Promise((r) => (w.onopen = r));
    const probe = async (q: string) => (await fetch(`http://127.0.0.1:${tPort}/relay?${q}`)).status;
    try {
      const owner = ws('room=OWNED&role=host&key=ownerkey123');
      await opened(owner);
      const guest = ws('room=OWNED&role=phone');
      await opened(guest);
      const others = Array.from({ length: 63 }, (_, i) => ws(`room=FILL${i}&role=host&key=fillkey12${i}`));
      await Promise.all(others.map(opened));
      owner.close();
      await new Promise((r) => (owner.onclose = r));
      const late = ws('room=LATE&role=host&key=latekey1234');
      await opened(late);
      expect(await probe('room=NEW&role=host&key=newkey12345')).toBe(503);
      expect(await probe('room=OWNED&role=host&key=ownerkey123')).toBe(204);
      const back = ws('room=OWNED&role=host&key=ownerkey123');
      await opened(back);
      for (const w of [...others, late, back]) w.close();
    } finally {
      relay.kill();
    }
  });
});
