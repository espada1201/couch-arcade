import { expect, test } from '@playwright/test';

test('landing renders', async ({ page }) => {
  const errors: string[] = [];
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
  await page.goto('./');
  await expect(page.getByRole('heading', { name: /swarm/i })).toBeVisible();
  await page.screenshot({ path: 'test-results/landing.png' });
  expect(errors).toEqual([]);
});

test('host console fits a phone-width screen', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('./?host=1&transport=local&fresh=1');
  await expect(page.locator('[data-room]')).toBeVisible();
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - innerWidth);
  expect(overflow).toBeLessThanOrEqual(0);
  await page.screenshot({ path: 'test-results/host-390.png', fullPage: true });
  await page.goto('./?room=ABCD&transport=local');
  await page.screenshot({ path: 'test-results/phone-gate.png' });
});

test('a new room stays the same room when the host page reloads', async ({ page }) => {
  await page.goto('./?host=1&transport=local&fresh=1');
  const code = await page.locator('[data-room]').getAttribute('data-room');
  await expect(page).not.toHaveURL(/fresh=/);
  await page.reload();
  await expect(page.locator('[data-room]')).toHaveAttribute('data-room', code!);
});

test('a malformed room code is flagged on the landing page', async ({ page }) => {
  await page.goto('./');
  const code = page.getByLabel('Joining? Enter the room code');
  await code.fill('AB');
  await page.getByRole('button', { name: 'Join' }).click();
  await expect(code).toHaveAttribute('aria-invalid', 'true');
  await expect(page.getByText('Room codes are 4 letters or numbers')).toBeVisible();
  await code.fill('ABCD');
  await expect(code).not.toHaveAttribute('aria-invalid', 'true');
});
