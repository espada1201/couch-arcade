import { spawn, type ChildProcess } from 'node:child_process';
import { createServer } from 'node:net';
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
