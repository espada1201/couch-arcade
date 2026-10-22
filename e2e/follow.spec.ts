import { existsSync } from 'node:fs';
import { expect, test, type BrowserContext, type Page } from '@playwright/test';

const CHROME = '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';

test.use({
  launchOptions: {
    executablePath: existsSync(CHROME) ? CHROME : undefined,
    // A fake camera, and screen capture that picks the whole screen without asking.
    args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream', '--auto-select-desktop-capture-source=Entire screen', '--autoplay-policy=no-user-gesture-required'],
  },
  permissions: ['camera'],
});

// Follow mode: every phone shows the whole picture. Phones need not be placed for it.

function watchErrors(page: Page, errors: string[]) {
  page.on('console', (m) => m.type() === 'error' && errors.push(`${page.url()}: ${m.text()}`));
  page.on('pageerror', (e) => errors.push(`${page.url()}: ${e.message}`));
}

async function joinPhone(context: BrowserContext, code: string, i: number, errors: string[]): Promise<Page> {
  const p = await context.newPage();
  watchErrors(p, errors);
  await p.setViewportSize({ width: 390, height: 844 });
  // A distinct sim spot gives each tab its own identity (and seat).
  await p.goto(`./?room=${code}&transport=local&sim=0.${i + 1},0.5`);
  await p.getByRole('button', { name: 'Join the swarm' }).click();
  await expect(p.locator('.status')).toContainText('Seat');
  return p;
}

async function openRoom(context: BrowserContext, errors: string[], phones: number) {
  const host = await context.newPage();
  watchErrors(host, errors);
  await host.setViewportSize({ width: 1440, height: 900 });
  await host.goto('./?host=1&transport=local&fresh=1');
  const code = (await host.locator('[data-room]').getAttribute('data-room'))!;
  const list: Page[] = [];
  for (let i = 0; i < phones; i++) list.push(await joinPhone(context, code, i, errors));
  await expect(host.locator('.count')).toContainText(`${phones} phones`);
  await host.getByRole('tab', { name: /Live screen/ }).click();
  const whole = host.getByRole('button', { name: 'Every phone shows it all' });
  await whole.click();
  await expect(whole).toHaveAttribute('aria-pressed', 'true');
  await expect(host.getByRole('button', { name: 'Spread across phones' })).toHaveAttribute('aria-pressed', 'false');
  return { host, phones: list, code };
}

/** Spread of grey levels in the phone's picture: 0 for a blank (flat) image. */
async function pictureSpread(p: Page): Promise<number> {
  return p.locator('.follow-picture').evaluate((img: HTMLImageElement) => {
    const c = document.createElement('canvas');
    c.width = 64;
    c.height = 36;
    const ctx = c.getContext('2d')!;
    ctx.drawImage(img, 0, 0, c.width, c.height);
    const d = ctx.getImageData(0, 0, c.width, c.height).data;
    let lo = 255;
    let hi = 0;
    for (let i = 0; i < d.length; i += 4) {
      const y = (d[i] + d[i + 1] + d[i + 2]) / 3;
      lo = Math.min(lo, y);
      hi = Math.max(hi, y);
    }
    return hi - lo;
  });
}

test('text cards: every phone shows the card, Next and the arrow keys step, a late joiner catches up', async ({ context }) => {
  const errors: string[] = [];
  const room = await openRoom(context, errors, 3);
  const { host, phones } = room;
  await host.getByLabel(/Cards, one per line/).fill('Happy birthday, Sam\nDinner at 7\n\nSpeeches at 8');
  await expect(host.locator('.follow-pos')).toHaveText('Card 1 of 3');
  await host.getByRole('button', { name: 'Show on phones' }).click();
  for (const p of phones) await expect(p.locator('.follow-text')).toHaveText('Happy birthday, Sam');
  await expect(phones[0].locator('.follow-count')).toHaveText('1 / 3');

  await host.getByRole('button', { name: 'Next card' }).click();
  for (const p of phones) await expect(p.locator('.follow-text')).toHaveText('Dinner at 7');

  // A presenter clicker or the arrow keys, with focus anywhere outside a text field.
  await host.locator('body').click({ position: { x: 5, y: 5 } });
  await host.keyboard.press('ArrowRight');
  for (const p of phones) await expect(p.locator('.follow-text')).toHaveText('Speeches at 8');
  await expect(host.getByRole('button', { name: 'Next card' })).toBeDisabled();
  await host.keyboard.press('PageUp');
  await expect(phones[1].locator('.follow-text')).toHaveText('Dinner at 7');

  // The text is big: a short card fills a good part of the phone.
  const size = await phones[0].locator('.follow-text').evaluate((el) => parseFloat(getComputedStyle(el).fontSize));
  expect(size).toBeGreaterThan(48);

  // Someone arriving late sees the current card straight away.
  const late = await joinPhone(context, room.code, 3, errors);
  await expect(late.locator('.follow-text')).toHaveText('Dinner at 7');
  await phones[0].screenshot({ path: 'test-results/phone-follow-card.png' });
  await host.screenshot({ path: 'test-results/host-follow-cards.png' });

  // Stop sends everyone back to the lobby.
  await host.getByRole('button', { name: 'Stop' }).last().click();
  await expect(phones[0].locator('.follow')).toBeHidden();
  expect(errors).toEqual([]);
});

test('camera: every phone shows the picture as a JPEG under the message limit', async ({ context }) => {
  const errors: string[] = [];
  const { host, phones } = await openRoom(context, errors, 2);
  await host.getByRole('radio', { name: 'Camera' }).check();
  await host.getByRole('button', { name: 'Show on phones' }).click();
  await expect(host.getByText(/Showing the camera on 2 phones/)).toBeVisible({ timeout: 15_000 });
  for (const p of phones) {
    const img = p.locator('.follow-picture');
    await expect(img).toBeVisible();
    await expect.poll(() => img.evaluate((i: HTMLImageElement) => i.naturalWidth)).toBeGreaterThan(100);
    const src = (await img.getAttribute('src'))!;
    expect(src.startsWith('data:image/jpeg;base64,')).toBe(true);
    expect(src.length).toBeLessThan(60 * 1024);
    expect(await pictureSpread(p)).toBeGreaterThan(20);
    // Letterboxed, never cropped: the picture box is the whole screen.
    const box = (await img.boundingBox())!;
    expect(box.width).toBeCloseTo(390, -1);
  }
  await phones[0].screenshot({ path: 'test-results/phone-follow-camera.png' });
  await host.getByRole('button', { name: 'Stop' }).last().click();
  expect(errors).toEqual([]);
});

test('share my screen: every phone shows the captured screen', async ({ context }) => {
  const errors: string[] = [];
  const { host, phones } = await openRoom(context, errors, 2);
  await host.getByRole('radio', { name: 'Share my screen' }).check();
  await host.getByRole('button', { name: 'Show on phones' }).click();
  await expect(host.getByText(/Showing your screen on 2 phones/)).toBeVisible({ timeout: 15_000 });
  for (const p of phones) {
    await expect.poll(() => p.locator('.follow-picture').evaluate((i: HTMLImageElement) => i.naturalWidth)).toBeGreaterThan(100);
    expect(await pictureSpread(p)).toBeGreaterThan(0);
  }
  await host.getByRole('button', { name: 'Stop' }).last().click();
  expect(errors).toEqual([]);
});
