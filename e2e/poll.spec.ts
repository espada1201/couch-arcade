import { expect, test } from '@playwright/test';
import { bg, openRoom, scan } from './room';

// The poll's colours for answers A and B (src/core/poll.ts).
const A = [255, 176, 0];
const B = [86, 180, 233];

test('three phones vote, the host counts them, and Reveal turns the room into the chart', async ({ context }) => {
  const errors: string[] = [];
  const room = await openRoom(context, errors, [
    [0.2, 0.5],
    [0.5, 0.5],
    [0.8, 0.5],
  ]);
  await scan(room);
  const { host, phones } = room;

  await host.getByRole('tab', { name: /Poll/ }).click();
  await host.getByLabel('Question').fill('Pizza or tacos?');
  await host.getByLabel('Answer A').fill('Pizza');
  await host.getByLabel('Answer B').fill('Tacos');
  await host.getByLabel(/Anonymous/).uncheck();
  await host.getByRole('button', { name: 'Start the poll' }).click();

  for (const p of phones) await expect(p.getByRole('heading', { name: 'Pizza or tacos?' })).toBeVisible();
  // The leftmost phone votes Pizza, then changes its mind to Tacos: still one vote.
  await phones[0].getByRole('button', { name: /Pizza/ }).click();
  await phones[0].getByRole('button', { name: /Tacos/ }).click();
  await expect(phones[0].getByRole('button', { name: /Tacos/ })).toHaveAttribute('aria-pressed', 'true');
  await phones[0].screenshot({ path: 'test-results/phone-ballot.png' });
  await phones[1].getByRole('button', { name: /Pizza/ }).click();
  await phones[2].getByRole('button', { name: /Pizza/ }).click();

  const bar = (name: string) => host.locator('.poll-bar', { hasText: name }).locator('.poll-num');
  await expect(bar('Pizza')).toHaveText('2 votes · 67%');
  await expect(bar('Tacos')).toHaveText('1 vote · 33%');
  await expect(host.getByRole('status').filter({ hasText: '3 of 3 phones voted' })).toContainText('A (Pizza) leads with 67%');

  // Closed: the buttons go inert and votes no longer count.
  await host.getByRole('button', { name: 'Close voting' }).click();
  await expect(phones[2].getByRole('button', { name: /Tacos/ })).toBeDisabled();

  await host.getByRole('button', { name: 'Reveal' }).click();
  // Two thirds of the room from the left is Pizza; the right third is Tacos, though that phone voted Pizza.
  await expect.poll(() => bg(phones[0])).toEqual(A);
  await expect.poll(() => bg(phones[1])).toEqual(A);
  await expect.poll(() => bg(phones[2])).toEqual(B);
  await expect(phones[0].locator('.label')).toHaveText('A 67%');
  await expect(phones[2].locator('.label')).toHaveText('B 33%');
  // That phone stands in the Tacos zone but voted Pizza, and is told so.
  await expect(phones[2].locator('.you-voted')).toHaveText('You voted A');
  await host.screenshot({ path: 'test-results/host-poll.png' });
  await phones[1].screenshot({ path: 'test-results/phone-poll.png' });

  // Anonymous mode hides the counts until Reveal.
  await host.getByLabel(/Anonymous/).check();
  await host.getByRole('button', { name: 'Reopen voting' }).click();
  await expect(bar('Pizza')).toHaveText('hidden');
  await expect(phones[1].getByRole('button', { name: /Pizza/ })).toHaveAttribute('aria-pressed', 'true');
  // Neighbours can't read a pick off the screen: a Tacos phone and a Pizza phone glow alike.
  await expect.poll(async () => JSON.stringify(await bg(phones[0])) === JSON.stringify(await bg(phones[1]))).toBe(true);
  expect(await bg(phones[0])).not.toEqual(A);
  expect(errors).toEqual([]);
});
