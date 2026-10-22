import { spawn, type ChildProcess } from 'node:child_process';
import { createServer } from 'node:net';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { RelayTransport } from '../src/net/relay';
import type { Link } from '../src/net/transport';

const SCRIPT = fileURLToPath(new URL('../server/relay.mjs', import.meta.url));
let relay: ChildProcess;
let port = 0;

function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const s = createServer();
    s.once('error', reject);
    s.listen(0, '127.0.0.1', () => {
      const { port } = s.address() as { port: number };
      s.close(() => resolve(port));
    });
  });
}

function startRelay(): Promise<ChildProcess> {
  const child = spawn(process.execPath, [SCRIPT], { env: { ...process.env, PORT: String(port) }, stdio: ['ignore', 'pipe', 'inherit'] });
  return new Promise((resolve, reject) => {
    child.once('exit', (code) => reject(new Error(`relay exited with ${code}`)));
    child.stdout!.on('data', (d) => String(d).includes('running') && resolve(child));
  });
}

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
  relay = await startRelay();
});

afterAll(async () => {
  vi.unstubAllGlobals();
  await stopRelay(relay);
});

describe('relay host end', () => {
  it('reclaims its room after the relay restarts, says so while down, and takes phones again', async () => {
    const t = new RelayTransport();
    const end = await t.host('BACK');
    const server: boolean[] = [];
    const links: Link[] = [];
    end.onServer((up) => server.push(up));
    end.onLink((l) => links.push(l));

    const phone = await t.join('BACK');
    await until(() => links.length === 1);
    let phoneClosed = false;
    phone.onClose(() => (phoneClosed = true));

    await stopRelay(relay);
    await until(() => phoneClosed && server.at(-1) === false);
    relay = await startRelay();
    await until(() => server.at(-1) === true);

    const again = await t.join('BACK');
    await until(() => links.length === 2);
    const got: unknown[] = [];
    links[1].onMessage((m) => got.push(m));
    again.send({ t: 'hello' });
    await until(() => got.length === 1);
    expect(got[0]).toEqual({ t: 'hello' });
    expect(server).toEqual([false, true]);
    end.close();
  }, 30_000);

  it('stops reconnecting once closed', async () => {
    const t = new RelayTransport();
    const end = await t.host('GONE');
    const server: boolean[] = [];
    end.onServer((up) => server.push(up));
    end.close();
    await new Promise((r) => setTimeout(r, 1500));
    expect(server).toEqual([]);
    await expect(t.join('GONE')).rejects.toThrow('No host');
  });
});
