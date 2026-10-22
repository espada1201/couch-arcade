import type { ChildProcess } from 'node:child_process';
import { connect } from 'node:net';
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
