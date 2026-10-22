import { spawn, type ChildProcess } from 'node:child_process';
import { connect, createServer } from 'node:net';
import { fileURLToPath } from 'node:url';

const SCRIPT = fileURLToPath(new URL('../server/relay.mjs', import.meta.url));

export function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const s = createServer();
    s.once('error', reject);
    s.listen(0, '127.0.0.1', () => {
      const { port } = s.address() as { port: number };
      s.close(() => resolve(port));
    });
  });
}

/** Runs server/relay.mjs on `port` and resolves once it says it is running. */
export function startRelay(port: number): Promise<ChildProcess> {
  const child = spawn(process.execPath, [SCRIPT], { env: { ...process.env, PORT: String(port) }, stdio: ['ignore', 'pipe', 'inherit'] });
  return new Promise((resolve, reject) => {
    child.once('exit', (code) => reject(new Error(`relay exited with ${code}`)));
    child.stdout!.on('data', (d) => String(d).includes('running') && resolve(child));
  });
}

/**
 * A phone on the relay over a bare TCP socket, so a test can stop reading (`pause`) and let the
 * relay's socket to it back up, as a phone on weak Wi-Fi does. Sends and receives JSON text frames.
 */
export async function rawPhone(port: number, room: string) {
  const sock = connect(port, '127.0.0.1');
  sock.write(
    `GET /relay?room=${room}&role=phone HTTP/1.1\r\nHost: localhost\r\nUpgrade: websocket\r\nConnection: Upgrade\r\n` +
      `Sec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==\r\nSec-WebSocket-Version: 13\r\n\r\n`,
  );
  const got: unknown[] = [];
  let buf = Buffer.alloc(0);
  let upgraded = false;
  let closed = false;
  sock.on('close', () => (closed = true));
  sock.on('data', (d) => {
    buf = Buffer.concat([buf, d]);
    if (!upgraded) {
      const end = buf.indexOf('\r\n\r\n');
      if (end < 0) return;
      upgraded = true;
      buf = buf.subarray(end + 4);
    }
    for (;;) {
      if (buf.length < 2) return;
      let len = buf[1] & 0x7f;
      let at = 2;
      if (len === 126) [len, at] = [buf.readUInt16BE(2), 4];
      else if (len === 127) [len, at] = [Number(buf.readBigUInt64BE(2)), 10];
      if (buf.length < at + len) return;
      if ((buf[0] & 0x0f) === 1) got.push(JSON.parse(buf.subarray(at, at + len).toString()));
      buf = buf.subarray(at + len);
    }
  });
  await new Promise((r) => sock.once('data', r));
  const send = (m: unknown) => {
    const body = Buffer.from(JSON.stringify(m));
    const head = body.length < 126 ? Buffer.from([0x81, 0x80 | body.length]) : Buffer.from([0x81, 0x80 | 126, body.length >> 8, body.length & 0xff]);
    sock.write(Buffer.concat([head, Buffer.alloc(4), body])); // zero mask: the payload goes as is
  };
  return { got, send, pause: () => sock.pause(), resume: () => sock.resume(), destroy: () => sock.destroy(), closed: () => closed };
}
