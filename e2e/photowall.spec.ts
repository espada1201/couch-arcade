import { expect, test, type Page } from '@playwright/test';
import { BLUE, GREEN, QUADRANTS_PNG, RED, YELLOW, bg, openRoom, scan, screenCentre, stripsPng } from './room';

/** Each channel within `by` of the colour wanted: the piece went through a JPEG. */
function near(got: number[], want: number[], by = 45): void {
  expect(got.map((c, i) => Math.abs(c - want[i])).every((d) => d <= by), `${got} is not near ${want}`).toBe(true);
}

async function flipWall(host: Page, name: string, picture: Buffer): Promise<void> {
  await host.getByRole('tab', { name: /Card stunt/ }).click();
  await host.locator('#stunt-file').setInputFiles({ name, mimeType: 'image/png', buffer: picture });
  await host.getByRole('button', { name: 'Flip the cards' }).click();
}

test('Photo wall: three phones in a row show one picture across all three, and Stadium cards still gives one colour each', async ({ context }) => {
  test.setTimeout(150_000);
  const errors: string[] = [];
  const room = await openRoom(context, errors, [[0.2, 0.5], [0.5, 0.5], [0.8, 0.5]]);
  await scan(room);
  const { host, phones } = room;
  await host.getByRole('tab', { name: /Card stunt/ }).click();
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
