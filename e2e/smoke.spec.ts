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
