import { expect, test } from '@playwright/test';
import { CHROME_PATH, FAKE_MEDIA, bg, openRoom, scan, wallClockAt } from './room';

// Chrome's built-in fake camera and microphone stand in for the host's, so the keepsake can be recorded.
test.use({
  launchOptions: {
    executablePath: CHROME_PATH,
    args: FAKE_MEDIA,
  },
  permissions: ['camera', 'microphone'],
});

test('a New Year countdown runs on every phone in step, and the host keeps a recording', async ({ context }) => {
  test.setTimeout(150_000);
  const errors: string[] = [];
  // Two hours before midnight on the host's wall clock, whatever the time of the run.
  await context.addInitScript(wallClockAt(22, 0, 0));
  const room = await openRoom(context, errors, [
    [0.2, 0.4],
    [0.5, 0.6],
    [0.8, 0.4],
  ]);
  await scan(room);
  const { host, phones } = room;

  await host.getByRole('tab', { name: /Show/ }).click();
  await host.getByLabel('Record the moment with this computer’s camera').check();
  await host.getByRole('button', { name: 'New Year countdown' }).click();
  await expect(host.getByText('● Recording the moment…')).toBeVisible();

  // Big numbers, the same on every phone at the same moment.
  await expect(phones[0].locator('.label')).toHaveText(/^(10|9|8)$/, { timeout: 3000 });
  const read = () => Promise.all(phones.map((p) => p.locator('.label').textContent()));
  let same = false;
  for (let i = 0; i < 5 && !same; i++) {
    const labels = await read();
    same = labels.every((l) => l === labels[0]) && /^\d+$/.test(labels[0] ?? '') && Number(labels[0]) <= 10;
  }
  expect(same).toBe(true);
  await expect(phones[1].locator('.label')).toHaveText(/^[123]$/, { timeout: 10_000 });
  await phones[1].screenshot({ path: 'test-results/phone-countdown.png' });

  // Zero: every phone bursts into light and shows the year.
  const year = String(new Date().getFullYear() + (new Date().getMonth() >= 6 ? 1 : 0));
  for (const p of phones) await expect(p.locator('.label')).toHaveText(year, { timeout: 5000 });
  expect((await bg(phones[1])).reduce((a, b) => a + b)).toBeGreaterThan(300);

  // When the moment ends the recording stops and the keepsake is offered.
  const link = host.getByRole('link', { name: /Download the keepsake/ });
  await expect(link).toBeVisible({ timeout: 15_000 });
  const [download] = await Promise.all([host.waitForEvent('download'), link.click()]);
  expect(download.suggestedFilename()).toMatch(/^swarm-moment-\d{4}-\d\d-\d\d-\d{4}\.webm$/);
  await host.screenshot({ path: 'test-results/host-moment.png' });

  // Timed for midnight: the host sees how long is left.
  await host.getByLabel(/end at midnight/).check();
  await host.getByRole('button', { name: 'New Year countdown' }).click();
  await expect(host.getByRole('status').filter({ hasText: /^Midnight in 1:5\d:\d\d\./ })).toBeVisible();
  await host.getByRole('button', { name: 'Stop', exact: true }).click();

  // A card-stunt template with the couple's names flips on the crowd like any other picture,
  // but only once the names are typed: the placeholder never goes on the crowd.
  await host.getByRole('tab', { name: /Photo & cards/ }).click();
  await host.getByRole('button', { name: 'Names with a heart' }).click();
  await host.getByRole('button', { name: 'Flip the cards' }).click();
  await expect(host.getByText('Type both names for “Names with a heart”.')).toBeVisible();
  await expect(host.getByLabel('Name (birthday, couple)')).toBeFocused();
  await host.getByLabel('Name (birthday, couple)').fill('Ana');
  await host.getByLabel('Second name (couple)').fill('Ben');
  await host.getByRole('button', { name: 'Names with a heart' }).click();
  await expect(host.getByRole('button', { name: 'Names with a heart' })).toHaveAttribute('aria-pressed', 'true');
  await host.getByRole('button', { name: 'Flip the cards' }).click();
  await expect(phones[0].locator('.label')).toHaveText(/^[123]$/, { timeout: 3000 });
  await expect(phones[0].locator('.label')).toHaveText('', { timeout: 5000 });
  await host.screenshot({ path: 'test-results/host-template.png' });
  expect(errors).toEqual([]);
});

test('a recorder that fails to start says why, and the next moment still films', async ({ context }) => {
  const errors: string[] = [];
  // The browser's recorder refuses its first start, as a busy encoder does.
  await context.addInitScript(() => {
    const start = MediaRecorder.prototype.start;
    let refused = false;
    MediaRecorder.prototype.start = function (this: MediaRecorder, ms?: number) {
      if (!refused) throw ((refused = true), new DOMException('The encoder is busy', 'NotSupportedError'));
      return start.call(this, ms);
    };
  });
  const room = await openRoom(context, errors, [[0.3, 0.5], [0.7, 0.5]]);
  const { host } = room;
  await host.getByRole('tab', { name: /Show/ }).click();
  await host.getByLabel('Record the moment with this computer’s camera').check();
  await expect(host.getByText('Camera ready')).toBeVisible();
  await host.getByRole('button', { name: 'New Year countdown' }).click();
  await expect(host.getByText('Couldn’t record: The encoder is busy')).toBeVisible();
  await host.getByRole('button', { name: 'Stop', exact: true }).click();
  await host.getByRole('button', { name: 'New Year countdown' }).click();
  await expect(host.getByText('● Recording the moment…')).toBeVisible();
  await host.getByRole('button', { name: 'Stop', exact: true }).click();
  await expect(host.getByRole('link', { name: /Download the keepsake/ })).toBeVisible({ timeout: 10_000 });
  expect(errors).toEqual([]);
});
