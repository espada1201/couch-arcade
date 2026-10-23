// Photo & cards after a line-up or an upload: the swap row, the preview and Flip are on screen together, at laptop size and at 150% zoom.
import { expect, test, type BrowserContext, type Page } from '@playwright/test';
import { BLUE, GREEN, RED, openRoom, scan, stripsPng } from './room';

const SIZES = [[1280, 800], [853, 533]] as const;
const STRIPS = { name: 'strips.png', mimeType: 'image/png', buffer: stripsPng([RED, GREEN, BLUE]) };

/** Whether the element sits wholly inside what the host can see of the panel: below its top edge and above the Flip bar. */
const inPanelView = (page: Page, selector: string) =>
  page.locator(selector).first().evaluate((el) => {
    const r = el.getBoundingClientRect();
    const foot = document.querySelector('.panel-foot')!.getBoundingClientRect();
    const top = Math.max(0, document.querySelector('.panel')!.getBoundingClientRect().top);
    return r.width > 0 && r.top >= top - 0.5 && r.bottom <= Math.min(foot.top, innerHeight) + 0.5;
  });

const flipInView = (page: Page) =>
  page.getByRole('button', { name: 'Flip the cards' }).evaluate((el) => {
    const r = el.getBoundingClientRect();
    return r.top >= 0 && r.bottom <= innerHeight;
  });

async function linedUp(context: BrowserContext, errors: string[], [w, h]: readonly [number, number]) {
  const room = await openRoom(context, errors, [[0.2, 0.5], [0.5, 0.5], [0.8, 0.5]]);
  await room.host.setViewportSize({ width: w, height: h });
  await room.host.getByRole('tab', { name: /Photo & cards/ }).click();
  await room.host.locator('.needs').getByRole('button', { name: 'Line them up for me' }).click();
  await expect(room.host.locator('.swap')).toBeVisible();
  return room;
}

for (const size of SIZES) {
  const at = `${size[0]}x${size[1]}`;

  test(`${at}: after "Line them up for me" the swap row and Flip are both in view, and so is the preview once a picture is uploaded`, async ({ context }) => {
    test.setTimeout(150_000);
    const errors: string[] = [];
    const { host } = await linedUp(context, errors, size);
    await expect(host.locator('#stunt-file')).toBeFocused();
    await expect.poll(() => inPanelView(host, '.swap-row')).toBe(true);
    expect(await flipInView(host)).toBe(true);
    await host.locator('#stunt-file').setInputFiles(STRIPS);
    await expect(host.locator('.stunt-preview canvas')).toHaveAttribute('aria-label', /Photo wall preview: 3 phones/);
    await expect(host.getByRole('button', { name: 'Flip the cards' })).toBeFocused();
    await expect.poll(() => inPanelView(host, '.swap-row')).toBe(true);
    expect(await inPanelView(host, '.stunt-preview canvas')).toBe(true);
    expect(await flipInView(host)).toBe(true);
    expect(errors).toEqual([]);
  });

  test(`${at}: a swap shows its result beside the swap row: the order, what the left phone shows, and the redrawn preview`, async ({ context }) => {
    test.setTimeout(150_000);
    const errors: string[] = [];
    const { host } = await linedUp(context, errors, size);
    await host.locator('#stunt-file').setInputFiles(STRIPS);
    await expect(host.locator('.stunt-preview canvas')).toBeVisible();
    await host.evaluate(() => ((window as unknown as { __before: Element | null }).__before = document.querySelector('.stunt-preview canvas')));
    const swap = host.locator('.swap');
    await swap.getByRole('button', { name: 'Phone 1' }).click();
    await swap.getByRole('button', { name: 'Phone 3' }).click();
    await expect(swap).toContainText('Swapped phones 1 and 3. Left to right: 3, 2, 1. Phone 3 is on the left now and shows the left of the picture.');
    await expect.poll(() => host.evaluate(() => (window as unknown as { __before: Element }).__before !== document.querySelector('.stunt-preview canvas'))).toBe(true);
    // The result is where the swap is: one block, and all of it on screen at once.
    expect(await host.evaluate(() => !!document.querySelector('.swap')!.parentElement!.querySelector('.stunt-preview canvas'))).toBe(true);
    expect(await inPanelView(host, '.swap-row')).toBe(true);
    expect(await inPanelView(host, '.swap p.note')).toBe(true);
    expect(await inPanelView(host, '.stunt-preview canvas')).toBe(true);
    expect(await flipInView(host)).toBe(true);
    expect(errors).toEqual([]);
  });
}

test('853x533 (150% zoom): the tab strip is one short row, so the panel gets more than half the height, and the preview is still big enough to recognise', async ({ context }) => {
  test.setTimeout(150_000);
  const errors: string[] = [];
  const { host } = await linedUp(context, errors, [853, 533]);
  await host.locator('#stunt-file').setInputFiles(STRIPS);
  await expect(host.locator('.stunt-preview canvas')).toBeVisible();
  const preview = (await host.locator('.stunt-preview canvas').boundingBox())!;
  expect(preview.width).toBeGreaterThanOrEqual(200);
  expect(preview.height).toBeGreaterThanOrEqual(100);
  await host.evaluate(() => scrollTo(0, 0));
  const room = await host.evaluate(() => {
    const tabs = document.querySelector('.tabs')!.getBoundingClientRect();
    const foot = document.querySelector('.panel-foot')!.getBoundingClientRect();
    return { tabsHeight: tabs.height, content: foot.top - tabs.bottom, height: innerHeight };
  });
  expect(room.tabsHeight).toBeLessThanOrEqual(60);
  expect(room.content).toBeGreaterThanOrEqual(room.height / 2);
  // Every tab is still there to reach, by mouse and by the arrow keys.
  await host.getByRole('tab', { name: /Hot Potato/ }).click();
  await expect(host.getByRole('tab', { name: /Hot Potato/ })).toHaveAttribute('aria-selected', 'true');
  await host.keyboard.press('Home');
  await expect(host.getByRole('tab', { name: /Locate/ })).toBeFocused();
  expect(await host.getByRole('tab', { name: /Locate/ }).evaluate((el) => el.getBoundingClientRect().left >= 0)).toBe(true);
  expect(errors).toEqual([]);
});

test('the swap number buttons are at least 44 by 44 pixels', async ({ context }) => {
  test.setTimeout(150_000);
  const errors: string[] = [];
  const { host } = await linedUp(context, errors, [1280, 800]);
  for (const b of await host.locator('.swap-row button').all()) {
    const box = (await b.boundingBox())!;
    expect(box.width).toBeGreaterThanOrEqual(44);
    expect(box.height).toBeGreaterThanOrEqual(44);
  }
  expect(errors).toEqual([]);
});

test('each phone says where it stands from the left, and says it again after a swap, without overflowing a 390 px screen', async ({ context }) => {
  test.setTimeout(150_000);
  const errors: string[] = [];
  const { host, phones } = await linedUp(context, errors, [1280, 800]);
  const tags = () => Promise.all(phones.map((p) => p.locator('.status').textContent()));
  await expect.poll(tags).toEqual(['Seat 1 · 1st from left · on the map', 'Seat 2 · 2nd from left · on the map', 'Seat 3 · 3rd from left · on the map'].map((s) => expect.stringContaining(s)));
  const swap = host.locator('.swap');
  await swap.getByRole('button', { name: 'Phone 1' }).click();
  await swap.getByRole('button', { name: 'Phone 3' }).click();
  await expect.poll(tags).toEqual(['Seat 1 · 3rd from left · on the map', 'Seat 2 · 2nd from left · on the map', 'Seat 3 · 1st from left · on the map'].map((s) => expect.stringContaining(s)));
  for (const p of phones) {
    const fits = await p.evaluate(() => {
      const s = document.querySelector('.status')!.getBoundingClientRect();
      return { right: s.right, width: innerWidth, page: document.documentElement.scrollWidth, tall: s.height };
    });
    expect(fits.right).toBeLessThanOrEqual(fits.width);
    expect(fits.page).toBeLessThanOrEqual(fits.width);
    expect(fits.tall).toBeLessThanOrEqual(48);
  }
  await phones[2].screenshot({ path: 'test-results/phone-position-tag.png' });
  expect(errors).toEqual([]);
});

test('after "Placed 3 of 3 phones." the host is told what comes next, with a button that goes there and moves focus', async ({ context }) => {
  test.setTimeout(150_000);
  const errors: string[] = [];
  const room = await openRoom(context, errors, [[0.2, 0.5], [0.5, 0.5], [0.8, 0.5]]);
  const { host } = room;
  const next = host.locator('.locate-next');
  await expect(next).toBeHidden();
  await scan(room);
  await expect(host.locator('.result')).toContainText('Placed 3 of 3 phones.');
  await expect(next).toContainText('Next: open Photo & cards to show a picture.');
  const go = next.getByRole('button', { name: 'Open Photo & cards' });
  await expect(go).toBeVisible();
  await expect(go).toBeFocused();
  await host.keyboard.press('Enter');
  await expect(host.getByRole('tab', { name: /Photo & cards/ })).toHaveAttribute('aria-selected', 'true');
  await expect(host.getByRole('tab', { name: /Photo & cards/ })).toBeFocused();
  await host.getByRole('tab', { name: /Locate/ }).click();
  await expect(next).toBeVisible();
  expect(errors).toEqual([]);
});
