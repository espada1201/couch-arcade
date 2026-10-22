// Shared end-to-end set-up: a host page and phone tabs on the in-browser transport,
// placed by the simulated camera, plus helpers to read what each phone shows.
import { existsSync } from 'node:fs';
import { deflateSync } from 'node:zlib';
import { expect, type BrowserContext, type Locator, type Page } from '@playwright/test';

const CHROME = '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
/** The container's preinstalled Chromium when it is there, else Playwright's own. */
export const CHROME_PATH = existsSync(CHROME) ? CHROME : undefined;
/** Chrome's fake camera and microphone, allowed without a prompt, and sound without a tap. */
export const FAKE_MEDIA = ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream', '--autoplay-policy=no-user-gesture-required'];

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

/** A 64x64 picture in four colour quadrants, and the colour each of the SIMS phones lands on. */
export const QUADRANTS_PNG = png(64, 64, (x, y) => (y < 32 ? (x < 32 ? [255, 0, 0] : [0, 255, 0]) : x < 32 ? [0, 0, 255] : [255, 255, 0]));
export const QUADRANT_COLOURS_BY_SIM = [RED, RED, GREEN, BLUE, YELLOW, YELLOW];

/** A mono 16-bit WAV of a soft tone, big enough to travel in several chunks. */
export function wav(seconds: number, rate = 22050): Buffer {
  const n = Math.round(seconds * rate);
  const b = Buffer.alloc(44 + n * 2);
  b.write('RIFF', 0);
  b.writeUInt32LE(36 + n * 2, 4);
  b.write('WAVEfmt ', 8);
  b.writeUInt32LE(16, 16);
  b.writeUInt16LE(1, 20); // PCM
  b.writeUInt16LE(1, 22); // mono
  b.writeUInt32LE(rate, 24);
  b.writeUInt32LE(rate * 2, 28);
  b.writeUInt16LE(2, 32);
  b.writeUInt16LE(16, 34);
  b.write('data', 36);
  b.writeUInt32LE(n * 2, 40);
  for (let i = 0; i < n; i++) b.writeInt16LE(Math.round(Math.sin((2 * Math.PI * 440 * i) / rate) * 3000), 44 + i * 2);
  return b;
}

/**
 * An init script that sets the page's wall clock (Date) to `h:m:s` local time today as it loads,
 * running on from there. The shared host clock (performance.now) is untouched.
 */
export function wallClockAt(h: number, m: number, s: number): string {
  const shift = (h: number, m: number, s: number) => {
    const Real = Date;
    const today = new Real();
    const by = new Real(today.getFullYear(), today.getMonth(), today.getDate(), h, m, s).getTime() - Real.now();
    class Shifted extends Real {
      constructor(...a: []) {
        super(...((a.length ? a : [Real.now() + by]) as []));
      }
      static now() {
        return Real.now() + by;
      }
    }
    window.Date = Shifted as DateConstructor;
  };
  return `(${shift})(${h}, ${m}, ${s})`;
}

export interface Room {
  host: Page;
  phones: Page[];
  seats: number[];
  code: string;
}

export function watchErrors(page: Page, errors: string[]) {
  page.on('console', (m) => m.type() === 'error' && errors.push(`${page.url()}: ${m.text()}`));
  page.on('pageerror', (e) => errors.push(`${page.url()}: ${e.message}`));
}

/** A host tab on the in-browser transport, and its room code. */
export async function openHost(context: BrowserContext, errors: string[], query = 'transport=local&fresh=1') {
  const host = await context.newPage();
  watchErrors(host, errors);
  await host.setViewportSize({ width: 1440, height: 900 });
  await host.goto(`./?host=1&${query}`);
  const code = (await host.locator('[data-room]').getAttribute('data-room'))!;
  return { host, code };
}

/** Phone tab `i`, joined and seated. A distinct sim spot gives each tab its own identity (and seat). */
export async function joinPhone(context: BrowserContext, code: string, i: number, errors: string[]): Promise<Page> {
  const p = await context.newPage();
  watchErrors(p, errors);
  await p.setViewportSize({ width: 390, height: 844 });
  await p.goto(`./?room=${code}&transport=local&sim=0.${i + 1},0.5`);
  await p.getByRole('button', { name: 'Join the swarm' }).click();
  await expect(p.locator('.status')).toContainText('Seat');
  return p;
}

/** Spread of grey levels in a picture: 0 for a blank (flat) image. */
export function pictureSpread(img: Locator): Promise<number> {
  return img.evaluate((i: HTMLImageElement) => {
    const c = document.createElement('canvas');
    c.width = 64;
    c.height = 36;
    const ctx = c.getContext('2d')!;
    ctx.drawImage(i, 0, 0, c.width, c.height);
    const d = ctx.getImageData(0, 0, c.width, c.height).data;
    let lo = 255;
    let hi = 0;
    for (let k = 0; k < d.length; k += 4) {
      const y = (d[k] + d[k + 1] + d[k + 2]) / 3;
      lo = Math.min(lo, y);
      hi = Math.max(hi, y);
    }
    return hi - lo;
  });
}

export async function openRoom(context: BrowserContext, errors: string[], sims = SIMS): Promise<Room> {
  const { host, code } = await openHost(context, errors, 'transport=local&camera=synthetic&fresh=1');
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
