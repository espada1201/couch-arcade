import type { ChildProcess } from 'node:child_process';
import { networkInterfaces } from 'node:os';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { RelayTransport, joinFailure } from '../src/net/relay';
import { memoryStorage } from './harness';
import { freePort, startRelay } from './relayserver';

const lanAddress = Object.values(networkInterfaces())
  .flat()
  .find((a) => a && a.family === 'IPv4' && !a.internal)?.address;

let relay: ChildProcess | undefined;
afterEach(() => {
  relay?.kill();
  relay = undefined;
  vi.unstubAllGlobals();
});

async function relayAt(host: string, env: Record<string, string> = {}) {
  const port = await freePort();
  relay = await startRelay(port, env);
  vi.stubGlobal('location', new URL(`http://${host}:${port}/`));
  vi.stubGlobal('localStorage', memoryStorage());
  return port;
}

const reason = (p: Promise<unknown>) => p.then(() => '', (e: Error) => e.message);

describe('a phone that cannot join says why', () => {
  it('names the room when the relay answers and nobody hosts it', async () => {
    await relayAt('127.0.0.1');
    expect(await reason(new RelayTransport().join('NOHOST'))).toBe('Room NOHOST is not open on this network. Check the room code, then try again.');
  });

  it('tells the phone to check the Wi-Fi, with the room code, when the relay cannot be reached at all', async () => {
    const port = await freePort();
    vi.stubGlobal('location', new URL(`http://127.0.0.1:${port}/`));
    expect(await reason(new RelayTransport().join('GONE'))).toBe('Can’t reach the host. Check you’re on the same Wi-Fi as the host computer, then try again. Room code: GONE.');
  });

  it.skipIf(!lanAddress)('says when one device is holding too many sockets', async () => {
    const port = await relayAt('127.0.0.1', { RELAY_PER_DEVICE: '1' });
    const host = await new RelayTransport().host('CROWDED');
    vi.stubGlobal('location', new URL(`http://${lanAddress}:${port}/`));
    const t = new RelayTransport();
    const first = await t.join('CROWDED');
    expect(await reason(t.join('CROWDED'))).toBe('Too many phones are joining from this device. Close the other tabs and try again.');
    first.close();
    host.close();
  });
});

describe('joinFailure', () => {
  it('maps what the relay says to words, and anything else to the Wi-Fi advice', () => {
    expect(joinFailure(404, 'ABCD')).toContain('Room ABCD is not open');
    expect(joinFailure(429, 'ABCD')).toContain('Too many phones');
    expect(joinFailure(503, 'ABCD')).toContain('relay is full');
    for (const status of [204, 400, 500, null]) expect(joinFailure(status, 'ABCD')).toContain('same Wi-Fi as the host computer');
    expect(joinFailure(null, 'ABCD')).toContain('ABCD');
  });
});
