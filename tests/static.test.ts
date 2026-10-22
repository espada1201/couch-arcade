import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

const fs = vi.hoisted(() => ({ gone: new Set<string>() }));
vi.mock('node:fs', async (original) => {
  const real = await original<typeof import('node:fs')>();
  // A file that existsSync saw and that is gone by the time statSync looks: the race a deploy or a cleaner opens.
  return {
    ...real,
    statSync: ((path: string, ...rest: unknown[]) => {
      if (fs.gone.has(String(path))) throw Object.assign(new Error('ENOENT'), { code: 'ENOENT' });
      return (real.statSync as (...a: unknown[]) => unknown)(path, ...rest);
    }) as typeof real.statSync,
  };
});

const { serveStatic } = await import('../server/static.mjs');

const root = mkdtempSync(join(tmpdir(), 'static-')) + '/';
beforeAll(() => {
  writeFileSync(join(root, 'index.html'), '<title>home</title>');
  writeFileSync(join(root, 'app.js'), 'console.log(1)');
  mkdirSync(join(root, 'sub'));
});
afterAll(() => rmSync(root, { recursive: true, force: true }));

/** A response that records what it was given. */
function fakeRes() {
  const res = {
    status: 0,
    headers: {} as Record<string, string>,
    body: [] as Buffer[],
    ended: false,
    writeHead(status: number, headers: Record<string, string> = {}) {
      res.status = status;
      res.headers = headers;
    },
    end(chunk?: string) {
      if (chunk) res.body.push(Buffer.from(chunk));
      res.ended = true;
    },
    write(chunk: Buffer) {
      res.body.push(Buffer.from(chunk));
      return true;
    },
    on() {
      return res;
    },
    once() {
      return res;
    },
    emit() {
      return true;
    },
  };
  return res;
}
const get = async (path: string) => {
  const res = fakeRes();
  serveStatic(res as never, root, path);
  await vi.waitFor(() => expect(res.ended).toBe(true));
  return { ...res, text: Buffer.concat(res.body).toString() };
};

describe('serveStatic', () => {
  it('serves a file with its type, and the app shell for a path with no file or a folder', async () => {
    expect((await get('/app.js')).headers['content-type']).toBe('text/javascript');
    expect((await get('/app.js')).text).toBe('console.log(1)');
    expect((await get('/nothing/here')).text).toBe('<title>home</title>');
    expect((await get('/sub')).text).toBe('<title>home</title>');
  });

  it('refuses a path that climbs out of the folder', async () => {
    expect((await get('/../secret')).status).toBe(403);
  });

  it('falls back to the app shell when a file vanishes between the existence check and the stat', async () => {
    fs.gone.add(join(root, 'app.js'));
    const res = await get('/app.js');
    fs.gone.clear();
    expect(res.status).toBe(200);
    expect(res.text).toBe('<title>home</title>');
  });

  it('says the build is missing when even the app shell is gone', async () => {
    fs.gone.add(join(root, 'app.js'));
    fs.gone.add(join(root, 'index.html'));
    const missing = await get('/app.js');
    fs.gone.clear();
    expect(missing.status).toBe(500);
    expect(missing.text).toContain('Build missing');
  });
});
