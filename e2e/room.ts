// Shared end-to-end set-up: a host page and phone tabs on the in-browser transport,
// placed by the simulated camera, plus helpers to read what each phone shows.
import { deflateSync } from 'node:zlib';
import { expect, type BrowserContext, type Page } from '@playwright/test';

// Six phone tabs at known spots in the simulated camera's view.
export const SIMS: [number, number][] = [
  [0.2, 0.25],
  [0.38, 0.3],
  [0.78, 0.2],
  [0.25, 0.75],
  [0.6, 0.8],
  [0.8, 0.68],
];

/** Minimal RGBA PNG encoder so the test can upload a picture it fully controls. */
export function png(w: number, h: number, px: (x: number, y: number) => [number, number, number]): Buffer {
  const crcTable = Array.from({ length: 256 }, (_, n) => {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    return c >>> 0;
  });
  const crc = (b: Buffer) => {
    let c = 0xffffffff;
    for (const x of b) c = crcTable[(c ^ x) & 0xff] ^ (c >>> 8);
    return (c ^ 0xffffffff) >>> 0;
  };
  const chunk = (type: string, data: Buffer) => {
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length);
    const td = Buffer.concat([Buffer.from(type), data]);
    const c = Buffer.alloc(4);
    c.writeUInt32BE(crc(td));
    return Buffer.concat([len, td, c]);
  };
  const raw = Buffer.alloc(h * (w * 4 + 1));
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const [r, g, b] = px(x, y);
      raw.set([r, g, b, 255], y * (w * 4 + 1) + 1 + x * 4);
    }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr.set([8, 6, 0, 0, 0], 8);
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}

export const RED = [255, 0, 0];
export const GREEN = [0, 255, 0];
export const BLUE = [0, 0, 255];
export const YELLOW = [255, 255, 0];

export interface Room {
  host: Page;
  phones: Page[];
  seats: number[];
  code: string;
}

function watchErrors(page: Page, errors: string[]) {
  page.on('console', (m) => m.type() === 'error' && errors.push(`${page.url()}: ${m.text()}`));
  page.on('pageerror', (e) => errors.push(`${page.url()}: ${e.message}`));
}

export async function openRoom(context: BrowserContext, errors: string[], sims = SIMS): Promise<Room> {
  const host = await context.newPage();
  watchErrors(host, errors);
  await host.setViewportSize({ width: 1440, height: 900 });
  await host.goto('./?host=1&transport=local&camera=synthetic&fresh=1');
  const code = (await host.locator('[data-room]').getAttribute('data-room'))!;
  const phones: Page[] = [];
  for (const [x, y] of sims) {
    const p = await context.newPage();
    watchErrors(p, errors);
    await p.setViewportSize({ width: 390, height: 844 });
    await p.goto(`./?room=${code}&transport=local&sim=${x},${y}`);
    await p.getByRole('button', { name: 'Join the swarm' }).click();
    phones.push(p);
  }
  await expect(host.locator('.count')).toContainText(`${sims.length} phones`);
  const seats: number[] = [];
  for (const p of phones) {
    await expect(p.locator('.status')).toContainText('Seat');
    seats.push(Number((await p.locator('.status').textContent())!.match(/Seat (\d+)/)![1]) - 1);
  }
  return { host, phones, seats, code };
}

export async function scan(room: Room) {
  const { host } = room;
  await host.getByRole('button', { name: 'Start simulated camera' }).click();
  await host.getByRole('button', { name: 'Scan the room' }).click();
  await expect(host.locator('.result')).toContainText(`Placed ${room.phones.length} of ${room.phones.length} phones`, { timeout: 40_000 });
}

export async function bg(p: Page): Promise<number[]> {
  const s = await p.locator('.screen').evaluate((el) => getComputedStyle(el).backgroundColor);
  return s.match(/\d+/g)!.slice(0, 3).map(Number);
}
