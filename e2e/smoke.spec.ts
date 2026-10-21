import { expect, test } from '@playwright/test';

test('landing renders', async ({ page }) => {
  const errors: string[] = [];
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
  await page.goto('./');
  await expect(page.getByRole('heading', { name: /swarm/i })).toBeVisible();
  await page.screenshot({ path: 'test-results/landing.png' });
  expect(errors).toEqual([]);
});
