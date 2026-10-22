import { expect, test, type BrowserContext, type Page } from '@playwright/test';
import { CHROME_PATH, FAKE_MEDIA, joinPhone, openHost, pictureSpread } from './room';

test.use({
  launchOptions: {
    executablePath: CHROME_PATH,
    // A fake camera, and screen capture that picks the whole screen without asking.
    args: [...FAKE_MEDIA, '--auto-select-desktop-capture-source=Entire screen'],
  },
  permissions: ['camera'],
});

// Follow mode: every phone shows the whole picture. Phones need not be placed for it.

async function openRoom(context: BrowserContext, errors: string[], phones: number) {
  const { host, code } = await openHost(context, errors);
  const list: Page[] = [];
  for (let i = 0; i < phones; i++) list.push(await joinPhone(context, code, i, errors));
  await expect(host.locator('.count')).toContainText(`${phones} phones`);
  // Every phone showing the whole picture has its own tab, named for what hosts want.
  const big = host.getByRole('tab', { name: /Big screen/ });
  await big.click();
  await expect(big).toHaveAttribute('aria-selected', 'true');
  await expect(host.getByRole('tab', { name: /Live screen/ })).toHaveAttribute('aria-selected', 'false');
  await expect(host.locator('.panel-intro')).toContainText('slides');
  return { host, phones: list, code };
}

test('text cards: every phone shows the card, Next and the arrow keys step, a late joiner catches up', async ({ context }) => {
  const errors: string[] = [];
  const room = await openRoom(context, errors, 3);
  const { host, phones } = room;
  // No cards yet: the host is told, and the room isn't taken (the phones stay in the lobby).
  await host.getByRole('button', { name: 'Show on phones' }).click();
  await expect(host.getByText('Type at least one line first.')).toBeVisible();
  await expect(phones[0].locator('.follow')).toBeHidden();
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
    expect(await pictureSpread(p.locator('.follow-picture'))).toBeGreaterThan(20);
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
    expect(await pictureSpread(p.locator('.follow-picture'))).toBeGreaterThan(0);
  }
  await host.getByRole('button', { name: 'Stop' }).last().click();
  expect(errors).toEqual([]);
});
