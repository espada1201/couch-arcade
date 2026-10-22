import { expect, test, type BrowserContext, type Page } from '@playwright/test';

/** A mono 16-bit WAV of a soft tone, big enough to travel in several chunks. */
function wav(seconds: number, rate = 22050): Buffer {
  const n = Math.round(seconds * rate);
  const b = Buffer.alloc(44 + n * 2);
  b.write('RIFF', 0);
  b.writeUInt32LE(36 + n * 2, 4);
  b.write('WAVEfmt ', 8);
  b.writeUInt32LE(16, 16);
  b.writeUInt16LE(1, 20); // PCM
  b.writeUInt16LE(1, 22); // mono
  b.writeUInt32LE(rate, 24);
  b.writeUInt32LE(rate * 2, 28);
  b.writeUInt16LE(2, 32);
  b.writeUInt16LE(16, 34);
  b.write('data', 36);
  b.writeUInt32LE(n * 2, 40);
  for (let i = 0; i < n; i++) b.writeInt16LE(Math.round(Math.sin((2 * Math.PI * 440 * i) / rate) * 3000), 44 + i * 2);
  return b;
}

function watchErrors(page: Page, errors: string[]) {
  page.on('console', (m) => m.type() === 'error' && errors.push(`${page.url()}: ${m.text()}`));
  page.on('pageerror', (e) => errors.push(`${page.url()}: ${e.message}`));
}

async function joinPhone(context: BrowserContext, code: string, i: number, errors: string[]): Promise<Page> {
  const p = await context.newPage();
  watchErrors(p, errors);
  await p.setViewportSize({ width: 390, height: 844 });
  await p.goto(`./?room=${code}&transport=local&sim=0.${i + 1},0.5`);
  await p.getByRole('button', { name: 'Join the swarm' }).click();
  await expect(p.locator('.status')).toContainText('Seat');
  return p;
}

/** Host time at which each phone's audio passes position 0, as the phone measures it. */
async function anchors(phones: Page[]): Promise<number[]> {
  return Promise.all(phones.map(async (p) => Number(await p.locator('.nowplaying').getAttribute('data-anchor'))));
}

const spread = (xs: number[]) => Math.max(...xs) - Math.min(...xs);

test('party speaker: a song reaches every phone and plays in step, late joiners included', async ({ context }) => {
  test.setTimeout(120_000);
  const errors: string[] = [];
  const host = await context.newPage();
  watchErrors(host, errors);
  await host.setViewportSize({ width: 1440, height: 900 });
  await host.goto('./?host=1&transport=local&fresh=1');
  const code = (await host.locator('[data-room]').getAttribute('data-room'))!;
  const phones: Page[] = [];
  for (let i = 0; i < 3; i++) phones.push(await joinPhone(context, code, i, errors));
  await expect(host.locator('.count')).toContainText('3 phones');

  await host.getByRole('tab', { name: /Sound/ }).click();
  // 12 s of 22 kHz audio is about 530 KB: a dozen chunks per phone.
  await host.locator('#speaker-file').setInputFiles({ name: 'Test Tone.wav', mimeType: 'audio/wav', buffer: wav(12) });
  await expect(host.getByText('3 of 3 phones ready')).toBeVisible({ timeout: 20_000 });
  for (const p of phones) {
    await expect(p.locator('.nowplaying')).toHaveAttribute('data-state', 'ready');
    await expect(p.locator('.np-title')).toHaveText('Test Tone');
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
  const b = await anchors(phones);
  expect(spread(b), `anchors ${b.join(', ')}`).toBeLessThan(50);

  // Pause lands on every phone together.
  await host.getByRole('button', { name: 'Pause' }).click();
  for (const p of phones) await expect(p.locator('.np-state')).toHaveText('Paused', { timeout: 3000 });
  expect(errors).toEqual([]);
});
