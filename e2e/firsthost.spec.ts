// What a first-time host runs into: messages they can't miss, controls that say why they're off, and a page a screen reader can navigate.
import { expect, test, type Page } from '@playwright/test';
import { joinPhone, openHost, wav } from './room';

const inViewport = (page: Page, selector: string) =>
  page.locator(selector).evaluate((el) => {
    const r = el.getBoundingClientRect();
    return r.width > 0 && r.top >= 0 && r.bottom <= innerHeight;
  });

for (const [w, h] of [[1280, 720], [390, 844]]) {
  test(`${w}px: Flip with no placed phones says so inside the viewport, and Go to Locate leads to Locate`, async ({ context }) => {
    const errors: string[] = [];
    const { host, code } = await openHost(context, errors);
    await host.setViewportSize({ width: w, height: h });
    await joinPhone(context, code, 0, errors);
    await host.getByRole('tab', { name: /Card stunt/ }).click();
    await host.getByRole('button', { name: 'Flip the cards' }).click();
    const alert = host.getByRole('alert').filter({ hasText: 'Place some phones on the map first.' });
    await expect(alert).toBeVisible();
    expect(await inViewport(host, '[role=alert]:not(:empty)')).toBe(true);
    await alert.getByRole('button', { name: 'Go to Locate' }).click();
    await expect(host.getByRole('tab', { name: /Locate/ })).toHaveAttribute('aria-selected', 'true');
    await expect(host.getByRole('button', { name: 'Start camera' })).toBeVisible();
    expect(errors).toEqual([]);
  });

  test(`${w}px: a song over the limit is refused right under the picker, in view`, async ({ context }) => {
    const errors: string[] = [];
    const { host } = await openHost(context, errors);
    await host.setViewportSize({ width: w, height: h });
    await host.getByRole('tab', { name: /Music/ }).click();
    // 5:30 at 8 kHz: over the 5 minute cap, small enough to be quick.
    await host.locator('#speaker-file').setInputFiles({ name: 'long.wav', mimeType: 'audio/wav', buffer: wav(330, 8000) });
    const alert = host.getByRole('alert').filter({ hasText: 'The limit is 5 minutes' });
    await expect(alert).toBeVisible();
    expect(await inViewport(host, '[role=alert]:not(:empty)')).toBe(true);
    // It sits directly after the picker, not at the foot of the panel.
    const below = await host.locator('.drop').evaluate((drop) => drop.nextElementSibling?.matches('.notice, .alert, [role=status], [role=alert]') ?? false);
    expect(below).toBe(true);
    expect(errors).toEqual([]);
  });
}

test('Scan the room says to start the camera first, and the header buttons say what they do', async ({ context }) => {
  const errors: string[] = [];
  const { host } = await openHost(context, errors, 'transport=local&camera=synthetic&fresh=1');
  const scan = host.getByRole('button', { name: 'Scan the room' });
  await expect(scan).toBeDisabled();
  await expect(scan).toHaveAccessibleDescription('Start the camera first.');
  await host.getByRole('button', { name: 'Start simulated camera' }).click();
  await expect(scan).toBeEnabled();
  await expect(host.getByText('Start the camera first.')).toBeHidden();

  await expect(host.getByRole('button', { name: 'Forget offline' })).toHaveCount(0);
  await expect(host.getByRole('button', { name: 'Remove disconnected phones' })).toHaveAttribute('title', /off the map/);
  await expect(host.getByRole('button', { name: 'Lights off' })).toHaveAttribute('title', /Stop whatever is running/);
  expect(errors).toEqual([]);
});

test('the host page has a heading outline, and the tab list takes Home and End', async ({ context }) => {
  const errors: string[] = [];
  const { host } = await openHost(context, errors);
  await expect(host.getByRole('heading', { level: 1 })).toHaveText('Swarm Screen host console');
  await expect(host.getByRole('heading', { level: 2, name: 'Locate' })).toBeAttached();
  await expect(host.getByRole('heading', { level: 2, name: 'Join this room' })).toBeAttached();
  const tabs = host.getByRole('tab');
  await tabs.first().focus();
  await host.keyboard.press('End');
  await expect(tabs.last()).toHaveAttribute('aria-selected', 'true');
  await expect(tabs.last()).toBeFocused();
  await expect(host.getByRole('heading', { level: 2, name: 'Hot Potato' })).toBeAttached();
  await host.keyboard.press('Home');
  await expect(tabs.first()).toHaveAttribute('aria-selected', 'true');
  await expect(tabs.first()).toBeFocused();
  expect(errors).toEqual([]);
});

test('the Mode legend sits right above its toggle, and the speaker copy has no leftover placeholders', async ({ context }) => {
  const { host } = await openHost(context, []);
  await host.getByRole('tab', { name: /Music/ }).click();
  const gap = await host.locator('.sound-modes > .seg').evaluate((seg) => seg.querySelector('label')!.getBoundingClientRect().top - seg.querySelector('legend')!.getBoundingClientRect().bottom);
  expect(gap).toBeLessThan(10);
  const intro = await host.locator('.panel-intro').first().innerText();
  expect(intro).toMatch(/^Play one song on every phone at once\./);
  expect(intro).not.toMatch(/±N|In our tests|10 ms/);
});

test('a phone gate warns about the iPhone silent switch', async ({ page }) => {
  await page.goto('./?room=ABCD&transport=local');
  await expect(page.getByText(/Silent mode off/)).toBeVisible();
});

test('the web app manifest starts at the app and carries 192 and 512 pixel icons that exist', async ({ page, request }) => {
  await page.goto('./');
  const href = await page.locator('link[rel=manifest]').getAttribute('href');
  const res = await request.get(new URL(href!, page.url()).href);
  const manifest = await res.json();
  expect(manifest.start_url).toBe('./');
  const sizes = manifest.icons.map((i: { sizes: string }) => i.sizes);
  expect(sizes).toEqual(expect.arrayContaining(['192x192', '512x512']));
  for (const icon of manifest.icons) expect((await request.get(new URL(icon.src, new URL(href!, page.url())).href)).status()).toBe(200);
});
