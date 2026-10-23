import { expect, test, type Locator, type Page } from '@playwright/test';
import { BLUE, GREEN, QUADRANTS_PNG, RED, YELLOW, bg, joinPhone, openRoom, scan, screenCentre, stripsPng } from './room';

/** Each channel within `by` of the colour wanted: the piece went through a JPEG. */
function near(got: number[], want: number[], by = 45): void {
  expect(got.map((c, i) => Math.abs(c - want[i])).every((d) => d <= by), `${got} is not near ${want}`).toBe(true);
}

async function flipWall(host: Page, name: string, picture: Buffer): Promise<void> {
  await host.getByRole('tab', { name: /Photo & cards/ }).click();
  await host.locator('#stunt-file').setInputFiles({ name, mimeType: 'image/png', buffer: picture });
  await host.getByRole('button', { name: 'Flip the cards' }).click();
}

test('Photo wall: three phones in a row show one picture across all three, and Stadium cards still gives one colour each', async ({ context }) => {
  test.setTimeout(150_000);
  const errors: string[] = [];
  const room = await openRoom(context, errors, [[0.2, 0.5], [0.5, 0.5], [0.8, 0.5]]);
  await scan(room);
  const { host, phones } = room;
  await host.getByRole('tab', { name: /Photo & cards/ }).click();
  await expect(host.getByRole('radio', { name: 'Photo wall' })).toBeChecked();
  await host.locator('#stunt-file').setInputFiles({ name: 'strips.png', mimeType: 'image/png', buffer: stripsPng([RED, GREEN, BLUE]) });
  await expect(host.locator('.stunt-preview canvas')).toHaveAttribute('aria-label', 'Photo wall preview: 3 phones, each outlined with its number');
  await host.getByRole('button', { name: 'Flip the cards' }).click();
  await expect(host.getByText('3, 2, 1… 3 phones show their piece of the picture.')).toBeVisible();

  await expect(phones[0].locator('.label')).toHaveText(/^[123]$/, { timeout: 3000 });
  await expect(phones[0].locator('img.tile-picture')).toBeHidden();
  for (const p of phones) await expect(p.locator('img.tile-picture')).toBeVisible({ timeout: 8000 });
  await host.screenshot({ path: 'test-results/host-wall.png' });
  for (const [i, want] of [RED, GREEN, BLUE].entries()) {
    const box = (await phones[i].locator('img.tile-picture').boundingBox())!;
    expect(box.width).toBeCloseTo(390, 0);
    expect(box.height).toBeCloseTo(844, 0);
    near(await screenCentre(phones[i]), want);
  }
  await phones[1].screenshot({ path: 'test-results/phone-wall.png' });

  await host.getByRole('radio', { name: 'Stadium cards' }).check();
  await expect(host.getByText('Best for a big crowd far away.')).toBeVisible();
  await host.getByRole('button', { name: 'Flip the cards' }).click();
  await expect(host.getByText('3, 2, 1… 3 phones flip together.')).toBeVisible();
  await expect(phones[0].locator('img.tile-picture')).toBeHidden();
  await expect.poll(async () => bg(phones[0]), { timeout: 8000 }).toEqual(RED);
  expect(await bg(phones[1])).toEqual(GREEN);
  expect(await bg(phones[2])).toEqual(BLUE);
  for (const p of phones) await expect(p.locator('img.tile-picture')).toBeHidden();
  expect(errors).toEqual([]);
});

test('Photo wall: four phones in a square each show their quadrant of the picture', async ({ context }) => {
  test.setTimeout(150_000);
  const errors: string[] = [];
  const room = await openRoom(context, errors, [[0.3, 0.3], [0.7, 0.3], [0.3, 0.7], [0.7, 0.7]]);
  await scan(room);
  await flipWall(room.host, 'quadrants.png', QUADRANTS_PNG);
  for (const p of room.phones) await expect(p.locator('img.tile-picture')).toBeVisible({ timeout: 8000 });
  for (const [i, want] of [RED, GREEN, BLUE, YELLOW].entries()) near(await screenCentre(room.phones[i]), want);
  expect(errors).toEqual([]);
});

test('Photo wall: a phone that was away at the flip shows its piece when it comes back, and its neighbours were cut around it', async ({ context }) => {
  test.setTimeout(150_000);
  const errors: string[] = [];
  const room = await openRoom(context, errors, [[0.2, 0.5], [0.5, 0.5], [0.8, 0.5]]);
  await scan(room);
  const { host, phones } = room;
  const url = phones[2].url();
  await phones[2].goto('about:blank');
  await expect(host.locator('.stage-away')).toContainText('Phone 3 has left');
  await flipWall(host, 'strips.png', stripsPng([RED, GREEN, BLUE]));
  await expect(host.getByText(/^3, 2, 1… 2 phones show their piece/)).toBeVisible();
  for (const p of phones.slice(0, 2)) await expect(p.locator('img.tile-picture')).toBeVisible({ timeout: 8000 });
  near(await screenCentre(phones[0]), RED);
  near(await screenCentre(phones[1]), GREEN);
  await phones[2].goto(url);
  await phones[2].getByRole('button', { name: 'Join the swarm' }).click();
  await expect(phones[2].locator('img.tile-picture')).toBeVisible({ timeout: 8000 });
  near(await screenCentre(phones[2]), BLUE);
  expect(errors).toEqual([]);
});

test('Photo wall: "Line them up for me" puts three phones nobody scanned in a row, and each shows its own third', async ({ context }) => {
  test.setTimeout(150_000);
  const errors: string[] = [];
  const { host, phones } = await openRoom(context, errors, [[0.2, 0.5], [0.5, 0.5], [0.8, 0.5]]);
  await host.getByRole('tab', { name: /Photo & cards/ }).click();
  const need = host.locator('.needs');
  await expect(need).toContainText('0 of 3 phones are on the map');
  const lineUp = need.getByRole('button', { name: 'Line them up for me' });
  await expect(lineUp).toBeVisible();
  await expect(need.getByRole('button', { name: 'Go to Locate' })).toBeVisible();
  await lineUp.click();
  await expect(host.getByText('Done. Phones 1 to 3 are in a row, phone 1 on the left. Ask your friends to hold or lay their phones in that order.')).toBeVisible();
  await expect(need).toContainText('All 3 phones are on the map');
  await expect(lineUp).toBeHidden();
  await expect(host.getByRole('tab', { name: /Photo & cards/ })).toHaveAttribute('aria-selected', 'true');
  await expect(host.locator('#stunt-file')).toBeFocused();
  await host.locator('#stunt-file').setInputFiles({ name: 'strips.png', mimeType: 'image/png', buffer: stripsPng([RED, GREEN, BLUE]) });
  await expect(host.locator('.stunt-preview canvas')).toHaveAttribute('aria-label', 'Photo wall preview: 3 phones, each outlined with its number');
  await host.getByRole('button', { name: 'Flip the cards' }).click();
  for (const p of phones) await expect(p.locator('img.tile-picture')).toBeVisible({ timeout: 8000 });
  for (const [i, want] of [RED, GREEN, BLUE].entries()) near(await screenCentre(phones[i]), want);

  await host.getByRole('radio', { name: 'Stadium cards' }).check();
  await host.getByRole('button', { name: 'Flip the cards' }).click();
  await expect(phones[0].locator('img.tile-picture')).toBeHidden();
  await expect.poll(async () => bg(phones[0]), { timeout: 8000 }).toEqual(RED);
  expect(await bg(phones[1])).toEqual(GREEN);
  expect(await bg(phones[2])).toEqual(BLUE);
  expect(errors).toEqual([]);
});

test('Photo wall: "Line them up for me" with a picture already chosen moves focus to Flip, and Enter flips', async ({ context }) => {
  test.setTimeout(150_000);
  const errors: string[] = [];
  const { host, phones } = await openRoom(context, errors, [[0.2, 0.5], [0.5, 0.5], [0.8, 0.5]]);
  await host.getByRole('tab', { name: /Photo & cards/ }).click();
  await host.locator('#stunt-file').setInputFiles({ name: 'strips.png', mimeType: 'image/png', buffer: stripsPng([RED, GREEN, BLUE]) });
  const lineUp = host.locator('.needs').getByRole('button', { name: 'Line them up for me' });
  await expect(lineUp).toBeVisible();
  await lineUp.click();
  await expect(host.getByRole('button', { name: 'Flip the cards' })).toBeFocused();
  await host.keyboard.press('Enter');
  for (const p of phones) await expect(p.locator('img.tile-picture')).toBeVisible({ timeout: 8000 });
  for (const [i, want] of [RED, GREEN, BLUE].entries()) near(await screenCentre(phones[i]), want);
  expect(errors).toEqual([]);
});

test('the line under Flip is cleared when the picture, words, template or style change, and a greeting is called a greeting', async ({ context }) => {
  test.setTimeout(150_000);
  const errors: string[] = [];
  const room = await openRoom(context, errors, [[0.2, 0.5], [0.5, 0.5], [0.8, 0.5]]);
  await scan(room);
  const { host } = room;
  await host.getByRole('tab', { name: /Photo & cards/ }).click();
  const said = host.locator('.panel-body .notice > .note');
  const flip = host.getByRole('button', { name: 'Flip the cards' });
  await host.locator('#stunt-file').setInputFiles({ name: 'strips.png', mimeType: 'image/png', buffer: stripsPng([RED, GREEN, BLUE]) });
  await flip.click();
  await expect(said).toHaveText('3, 2, 1… 3 phones show their piece of the picture.');
  await host.locator('#stunt-words').fill('GO TEAM');
  await host.keyboard.press('Enter');
  await expect(said).toHaveText('');
  await flip.click();
  await expect(said).toHaveText('3, 2, 1… 3 phones show their piece of the greeting.');
  await host.getByRole('button', { name: 'Just married' }).click();
  await expect(said).toHaveText('');
  await flip.click();
  await expect(said).toHaveText('3, 2, 1… 3 phones show their piece of the greeting.');
  await host.getByRole('button', { name: 'Stripes' }).click();
  await expect(said).toHaveText('');
  await flip.click();
  await expect(said).toHaveText('3, 2, 1… 3 phones show their piece of the picture.');
  await host.getByRole('radio', { name: 'Stadium cards' }).check();
  await expect(said).toHaveText('');
  expect(errors).toEqual([]);
});

for (const [how, press] of [
  ['a click that never blurs the field', (flip: Locator) => flip.dispatchEvent('click')],
  ['Tab-style focus then Space', async (flip: Locator) => (await flip.focus(), flip.press('Space'))],
] as const) {
  test(`Flip right after typing "Or your words" (${how}) flips the words, and the typing pause does not cancel it`, async ({ context }) => {
    test.setTimeout(150_000);
    const errors: string[] = [];
    const room = await openRoom(context, errors, [[0.2, 0.5], [0.5, 0.5], [0.8, 0.5]]);
    await scan(room);
    const { host, phones } = room;
    await host.getByRole('tab', { name: /Photo & cards/ }).click();
    await host.locator('#stunt-words').pressSequentially('GO TEAM');
    await press(host.getByRole('button', { name: 'Flip the cards' }));
    const said = host.locator('.panel-body .notice > .note');
    await expect(said).toHaveText('3, 2, 1… 3 phones show their piece of the greeting.');
    await host.waitForTimeout(600);
    await expect(said).toHaveText('3, 2, 1… 3 phones show their piece of the greeting.');
    for (const p of phones) await expect(p.locator('img.tile-picture')).toBeVisible({ timeout: 8000 });
    expect(errors).toEqual([]);
  });
}

test('Photo wall: after "Line them up for me" the host swaps phones 1 and 3 by picking one and then the other, and the pieces follow', async ({ context }) => {
  test.setTimeout(150_000);
  const errors: string[] = [];
  const { host, phones } = await openRoom(context, errors, [[0.2, 0.5], [0.5, 0.5], [0.8, 0.5]]);
  await host.getByRole('tab', { name: /Photo & cards/ }).click();
  const swap = host.locator('.swap');
  await expect(swap).toBeHidden();
  await host.locator('.needs').getByRole('button', { name: 'Line them up for me' }).click();
  await expect(swap).toBeVisible();
  await expect(swap.getByRole('button')).toHaveText(['1', '2', '3']);
  await swap.getByRole('button', { name: 'Phone 1' }).click();
  await expect(swap.getByRole('button', { name: 'Phone 1' })).toHaveAttribute('aria-pressed', 'true');
  await expect(swap).toContainText('Phone 1 picked. Now pick the phone to swap it with.');
  await swap.getByRole('button', { name: 'Phone 3' }).click();
  await expect(swap).toContainText('Swapped phones 1 and 3. Left to right: 3, 2, 1.');
  await expect(swap.getByRole('button')).toHaveText(['3', '2', '1']);
  await expect(swap.locator('[aria-pressed=true]')).toHaveCount(0);
  // The line-up instruction said phone 1 is on the left, which is no longer true.
  await expect(host.getByText(/phone 1 on the left/)).toHaveCount(0);
  await host.locator('#stunt-file').setInputFiles({ name: 'strips.png', mimeType: 'image/png', buffer: stripsPng([RED, GREEN, BLUE]) });
  await host.getByRole('button', { name: 'Flip the cards' }).click();
  for (const p of phones) await expect(p.locator('img.tile-picture')).toBeVisible({ timeout: 8000 });
  for (const [i, want] of [BLUE, GREEN, RED].entries()) near(await screenCentre(phones[i]), want);
  expect(errors).toEqual([]);
});

test('Photo wall: the swap works from the keyboard, keeps focus in the row, and picking the same phone again lets go of it', async ({ context }) => {
  test.setTimeout(150_000);
  const errors: string[] = [];
  const { host } = await openRoom(context, errors, [[0.2, 0.5], [0.5, 0.5], [0.8, 0.5]]);
  await host.getByRole('tab', { name: /Photo & cards/ }).click();
  await host.locator('.needs').getByRole('button', { name: 'Line them up for me' }).click();
  const swap = host.locator('.swap');
  await swap.getByRole('button', { name: 'Phone 2' }).focus();
  await host.keyboard.press('Enter');
  await expect(swap.getByRole('button', { name: 'Phone 2' })).toHaveAttribute('aria-pressed', 'true');
  await expect(swap.getByRole('button', { name: 'Phone 2' })).toBeFocused();
  await host.keyboard.press('Space');
  await expect(swap.locator('[aria-pressed=true]')).toHaveCount(0);
  await host.keyboard.press('Enter');
  await host.keyboard.press('Tab');
  await host.keyboard.press('Enter');
  await expect(swap).toContainText('Swapped phones 2 and 3. Left to right: 1, 3, 2.');
  await expect(swap.getByRole('button')).toHaveText(['1', '3', '2']);
  await expect(swap.getByRole('button', { name: 'Phone 3' })).toBeFocused();
  // The room map moved the two phones: its table is what a screen reader hears.
  const across = (n: number) => host.locator(`tr[data-seat="${n}"]`).getAttribute('data-x').then(Number);
  expect(await across(2)).toBeLessThan(await across(1));
  expect(errors).toEqual([]);
});

/** A room of three phones in a row, lined up, on Photo & cards, with the swap row showing. */
async function linedUpRoom(context: Parameters<typeof openRoom>[0], errors: string[]) {
  const room = await openRoom(context, errors, [[0.2, 0.5], [0.5, 0.5], [0.8, 0.5]]);
  await room.host.getByRole('tab', { name: /Photo & cards/ }).click();
  await room.host.locator('.needs').getByRole('button', { name: 'Line them up for me' }).click();
  await expect(room.host.locator('.swap')).toBeVisible();
  return room;
}

test('Photo wall: a phone resizing does not take the keyboard host out of the swap row', async ({ context }) => {
  test.setTimeout(150_000);
  const errors: string[] = [];
  const { host, phones } = await linedUpRoom(context, errors);
  await host.locator('#stunt-file').setInputFiles({ name: 'strips.png', mimeType: 'image/png', buffer: stripsPng([RED, GREEN, BLUE]) });
  const swap = host.locator('.swap');
  const two = swap.getByRole('button', { name: 'Phone 2' });
  await two.focus();
  await host.evaluate(() => {
    const w = window as unknown as { __two: Element | null; __preview: Element | null };
    w.__two = document.activeElement;
    w.__preview = document.querySelector('.stunt-preview canvas');
  });
  // A different screen shape reshapes the wall: the preview is redrawn once the host has heard.
  await phones[0].setViewportSize({ width: 360, height: 640 });
  await expect.poll(() => host.evaluate(() => (window as unknown as { __preview: Element }).__preview !== document.querySelector('.stunt-preview canvas'))).toBe(true);
  await expect(two).toBeFocused();
  expect(await host.evaluate(() => (window as unknown as { __two: Element }).__two.isConnected)).toBe(true);
  // The keys still work from where the host is.
  await host.keyboard.press('Enter');
  await expect(two).toHaveAttribute('aria-pressed', 'true');
  expect(errors).toEqual([]);
});

test('Photo wall: a swap line is dropped once the line-up it described is gone, and a picked phone that is removed is let go', async ({ context }) => {
  test.setTimeout(150_000);
  const errors: string[] = [];
  const { host, phones, code } = await linedUpRoom(context, errors);
  const swap = host.locator('.swap');
  await swap.getByRole('button', { name: 'Phone 1' }).click();
  await swap.getByRole('button', { name: 'Phone 3' }).click();
  await expect(swap).toContainText('Swapped phones 1 and 3. Left to right: 3, 2, 1.');
  // A fourth phone joins and the host lines everyone up again: the order is not the one the line described.
  phones.push(await joinPhone(context, code, 3, errors));
  await host.locator('.needs').getByRole('button', { name: 'Line them up for me' }).click();
  await expect(swap.getByRole('button')).toHaveCount(4);
  await expect(swap.getByText(/^Swapped phones/)).toHaveCount(0);
  // Pick phone 4, then it leaves and is removed from the map.
  await swap.getByRole('button', { name: 'Phone 4' }).click();
  await expect(swap).toContainText('Phone 4 picked.');
  await phones[3].close();
  await host.getByRole('button', { name: 'Remove disconnected phones' }).click();
  await expect(swap.getByRole('button')).toHaveCount(3);
  await expect(swap.getByText(/picked/)).toHaveCount(0);
  await expect(swap.locator('[aria-pressed=true]')).toHaveCount(0);
  expect(errors).toEqual([]);
});

test('Photo wall: a phone that is away shows dashed in the swap row and is named as away', async ({ context }) => {
  test.setTimeout(150_000);
  const errors: string[] = [];
  const { host, phones } = await linedUpRoom(context, errors);
  const swap = host.locator('.swap');
  await expect(swap.getByRole('button', { name: 'Phone 3', exact: true })).not.toHaveAttribute('data-offline', /.*/);
  await phones[2].close();
  const away = swap.getByRole('button', { name: 'Phone 3, away' });
  await expect(away).toBeVisible();
  await expect(away).toHaveAttribute('data-offline', 'true');
  expect(await away.evaluate((b) => getComputedStyle(b).borderStyle)).toBe('dashed');
  await expect(swap.getByRole('button', { name: 'Phone 1', exact: true })).not.toHaveAttribute('data-offline', /.*/);
  expect(errors).toEqual([]);
});
