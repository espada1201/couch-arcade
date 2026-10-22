import { expect, test, type Page } from '@playwright/test';
import { joinPhone, openHost, wav } from './room';

/** Host time at which each phone's audio passes position 0, as the phone measures it. */
async function anchors(phones: Page[]): Promise<number[]> {
  return Promise.all(phones.map(async (p) => Number(await p.locator('.nowplaying').getAttribute('data-anchor'))));
}

const spread = (xs: number[]) => Math.max(...xs) - Math.min(...xs);

test('party speaker: a song reaches every phone and plays in step, late joiners included', async ({ context }) => {
  test.setTimeout(120_000);
  const errors: string[] = [];
  const { host, code } = await openHost(context, errors);
  const phones: Page[] = [];
  for (let i = 0; i < 3; i++) phones.push(await joinPhone(context, code, i, errors));
  await expect(host.locator('.count')).toContainText('3 phones');

  await host.getByRole('tab', { name: /Music/ }).click();
  // Party speaker is what the Music tab opens on.
  await expect(host.getByRole('radio', { name: 'Party speaker' })).toBeChecked();
  // 12 s of 22 kHz audio is about 530 KB: a dozen chunks per phone.
  await host.locator('#speaker-file').setInputFiles({ name: 'Test Tone.wav', mimeType: 'audio/wav', buffer: wav(12) });
  await expect(host.getByText('3 of 3 phones ready')).toBeVisible({ timeout: 20_000 });
  for (const p of phones) {
    await expect(p.locator('.nowplaying')).toHaveAttribute('data-state', 'ready');
    await expect(p.locator('.np-title')).toHaveText('Test Tone');
    // Picking the song fetched it in the background; the phones' screens are untouched until Play.
    await expect(p.locator('.nowplaying')).toBeHidden();
  }
  await host.screenshot({ path: 'test-results/host-speaker.png' });

  await host.getByRole('button', { name: 'Play', exact: true }).click();
  for (const p of phones) await expect(p.locator('.nowplaying')).toHaveAttribute('data-state', 'playing', { timeout: 4000 });
  await expect.poll(async () => (await anchors(phones)).every(Number.isFinite)).toBe(true);
  const a = await anchors(phones);
  expect(spread(a), `anchors ${a.join(', ')}`).toBeLessThan(50);
  // The track really is advancing on each phone.
  const before = Number(await phones[0].locator('.nowplaying').getAttribute('data-pos'));
  await phones[0].waitForTimeout(800);
  expect(Number(await phones[0].locator('.nowplaying').getAttribute('data-pos'))).toBeGreaterThan(before + 0.4);
  await phones[1].screenshot({ path: 'test-results/phone-speaker.png' });

  // A phone that joins mid-song downloads it and falls in step with the others.
  phones.push(await joinPhone(context, code, 3, errors));
  await expect(host.getByText(/4 of 4 phones ready/)).toBeVisible({ timeout: 20_000 });
  await expect(phones[3].locator('.nowplaying')).toHaveAttribute('data-state', 'playing', { timeout: 4000 });
  await expect.poll(async () => Number.isFinite(Number(await phones[3].locator('.nowplaying').getAttribute('data-anchor')))).toBe(true);
  // Its clock estimate is still settling, so allow a drift check or two (2 s apart) to pull it in.
  await expect.poll(async () => spread(await anchors(phones)), { timeout: 8000 }).toBeLessThan(50);

  // Pause lands on every phone together.
  await host.getByRole('button', { name: 'Pause' }).click();
  for (const p of phones) await expect(p.locator('.np-state')).toHaveText('Paused', { timeout: 3000 });
  expect(errors).toEqual([]);
});
