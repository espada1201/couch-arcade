import { deflateSync } from 'node:zlib';
import { expect, test, type BrowserContext, type Page } from '@playwright/test';

// Six phone tabs at known spots in the simulated camera's view.
const SIMS: [number, number][] = [
  [0.2, 0.25],
  [0.38, 0.3],
  [0.78, 0.2],
  [0.25, 0.75],
  [0.6, 0.8],
  [0.8, 0.68],
];

/** Minimal RGBA PNG encoder so the test can upload a picture it fully controls. */
function png(w: number, h: number, px: (x: number, y: number) => [number, number, number]): Buffer {
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

const RED = [255, 0, 0];
const GREEN = [0, 255, 0];
const BLUE = [0, 0, 255];
const YELLOW = [255, 255, 0];

interface Room {
  host: Page;
  phones: Page[];
  seats: number[];
  code: string;
}

function watchErrors(page: Page, errors: string[]) {
  page.on('console', (m) => m.type() === 'error' && errors.push(`${page.url()}: ${m.text()}`));
  page.on('pageerror', (e) => errors.push(`${page.url()}: ${e.message}`));
}

async function openRoom(context: BrowserContext, errors: string[], sims = SIMS): Promise<Room> {
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

async function scan(room: Room) {
  const { host } = room;
  await host.getByRole('button', { name: 'Start simulated camera' }).click();
  await host.getByRole('button', { name: 'Scan the room' }).click();
  await expect(host.locator('.result')).toContainText(`Placed ${room.phones.length} of ${room.phones.length} phones`, { timeout: 40_000 });
}

async function bg(p: Page): Promise<number[]> {
  const s = await p.locator('.screen').evaluate((el) => getComputedStyle(el).backgroundColor);
  return s.match(/\d+/g)!.slice(0, 3).map(Number);
}

test('the camera finds every phone, then the crowd shows a card stunt', async ({ context }) => {
  const errors: string[] = [];
  const room = await openRoom(context, errors);
  await scan(room);
  await room.host.screenshot({ path: 'test-results/host-located.png' });

  // Recovered camera positions match where each tab "sits".
  for (let i = 0; i < SIMS.length; i++) {
    const row = room.host.locator(`tr[data-seat="${room.seats[i]}"]`);
    const x = Number(await row.getAttribute('data-raw-x'));
    const y = Number(await row.getAttribute('data-raw-y'));
    expect(Math.abs(x - SIMS[i][0]), `phone ${i} x`).toBeLessThan(0.025);
    expect(Math.abs(y - SIMS[i][1]), `phone ${i} y`).toBeLessThan(0.035);
    await expect(room.phones[i].locator('.status')).toContainText('placed');
  }

  // Card stunt: a four-colour picture; every phone must show its quadrant's colour.
  await room.host.getByRole('tab', { name: /Card stunt/ }).click();
  await room.host.locator('#stunt-file').setInputFiles({
    name: 'quadrants.png',
    mimeType: 'image/png',
    buffer: png(64, 64, (x, y) => (y < 32 ? (x < 32 ? [255, 0, 0] : [0, 255, 0]) : x < 32 ? [0, 0, 255] : [255, 255, 0])),
  });
  await room.host.getByRole('button', { name: 'Flip the cards' }).click();
  await expect(room.phones[0].locator('.label')).toHaveText(/^[123]$/, { timeout: 3000 });
  await room.phones[0].waitForTimeout(3600);
  const expected = [RED, RED, GREEN, BLUE, YELLOW, YELLOW];
  for (let i = 0; i < SIMS.length; i++) expect(await bg(room.phones[i]), `phone ${i}`).toEqual(expected[i]);
  await room.host.screenshot({ path: 'test-results/host-card.png' });
  await room.phones[2].screenshot({ path: 'test-results/phone-card.png' });
  expect(errors).toEqual([]);
});

test('a wave reaches the left of the room before the right', async ({ context }) => {
  const errors: string[] = [];
  const room = await openRoom(context, errors, [
    [0.15, 0.5],
    [0.5, 0.5],
    [0.85, 0.5],
  ]);
  await scan(room);
  await room.host.getByRole('tab', { name: /Wave/ }).click();
  await room.host.getByRole('button', { name: 'Start the wave' }).click();
  const peaks = [0, 0, 0].map(() => ({ t: 0, v: -1 }));
  const t0 = Date.now();
  while (Date.now() - t0 < 2600) {
    for (let i = 0; i < 3; i++) {
      const [r, g] = await bg(room.phones[i]);
      if (r + g > peaks[i].v) peaks[i] = { t: Date.now() - t0, v: r + g };
    }
  }
  expect(peaks.every((p) => p.v > 300)).toBe(true);
  expect(peaks[0].t).toBeLessThan(peaks[1].t);
  expect(peaks[1].t).toBeLessThan(peaks[2].t);
  await room.host.screenshot({ path: 'test-results/host-wave.png' });
  expect(errors).toEqual([]);
});

test('territory and hot potato respond to taps; a refreshed phone keeps its seat', async ({ context }) => {
  const errors: string[] = [];
  const room = await openRoom(context, errors, [
    [0.2, 0.3],
    [0.2, 0.7],
    [0.5, 0.5],
    [0.8, 0.3],
    [0.8, 0.7],
  ]);
  await scan(room);

  await room.host.getByRole('tab', { name: /Territory/ }).click();
  await room.host.getByRole('button', { name: 'Start Territory' }).click();
  const left = room.phones[0];
  await expect(left.locator('.label')).toHaveText('TAP');
  for (let i = 0; i < 200; i++) {
    await left.locator('.screen').click({ position: { x: 100, y: 400 } });
    if (i % 10 === 9 && (await room.host.locator('.score').textContent())?.includes('wins')) break;
  }
  await expect(room.host.locator('.score')).toContainText('Amber wins');
  // The right-hand phones were overrun and now wear the winners' colour.
  await expect.poll(async () => (await bg(room.phones[4]))[0]).toBeGreaterThan(150);
  await room.host.screenshot({ path: 'test-results/host-territory.png' });

  await room.host.getByRole('tab', { name: /Hot Potato/ }).click();
  await room.host.getByRole('button', { name: 'Start Hot Potato' }).click();
  const holder = async () => {
    for (const p of room.phones) if ((await p.locator('.label').textContent()) === 'TAP!') return p;
    return null;
  };
  let h: Page | null = null;
  await expect.poll(async () => (h = await holder()) !== null, { timeout: 5000 }).toBe(true);
  await h!.locator('.screen').click({ position: { x: 100, y: 400 } });
  await expect(room.host.locator('.score')).toContainText('1 throws');
  await h!.screenshot({ path: 'test-results/phone-potato.png' });

  // Refresh a phone: it rejoins in the same seat.
  const p = room.phones[2];
  const before = await p.locator('.status').textContent();
  await p.reload();
  await p.getByRole('button', { name: 'Join the swarm' }).click();
  await expect(p.locator('.status')).toContainText(before!.match(/Seat \d+/)![0]);
  await expect(room.host.locator('.count')).toContainText('5 phones');
  expect(errors).toEqual([]);
});
