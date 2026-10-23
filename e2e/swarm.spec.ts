import { expect, test, type Page } from '@playwright/test';
import { QUADRANTS_PNG, QUADRANT_COLOURS_BY_SIM, SIMS, bg, openRoom, scan } from './room';

test('the camera finds every phone, then the crowd shows a card stunt', async ({ context }) => {
  const errors: string[] = [];
  const room = await openRoom(context, errors);
  await scan(room);
  await room.host.screenshot({ path: 'test-results/host-located.png' });

  // Recovered camera positions match where each tab "sits".
  for (let i = 0; i < SIMS.length; i++) {
    const row = room.host.locator(`tr[data-seat="${room.seats[i]}"]`);
    const x = Number(await row.getAttribute('data-raw-x'));
    const y = Number(await row.getAttribute('data-raw-y'));
    expect(Math.abs(x - SIMS[i][0]), `phone ${i} x`).toBeLessThan(0.025);
    expect(Math.abs(y - SIMS[i][1]), `phone ${i} y`).toBeLessThan(0.035);
    await expect(room.phones[i].locator('.status')).toContainText(/· on the map$/);
  }

  // Keyboard placement: pick a phone on the map with ] and nudge it with an arrow key.
  const firstRow = room.host.locator('tr[data-seat]').first();
  const before = Number(await firstRow.getAttribute('data-x'));
  await room.host.locator('.stage-canvas').focus();
  await room.host.keyboard.press(']');
  await room.host.keyboard.press('Shift+ArrowRight');
  await expect.poll(async () => Number(await firstRow.getAttribute('data-x'))).toBeGreaterThan(before + 0.05);
  await room.host.keyboard.press('Shift+ArrowLeft');

  // Photo & cards in Stadium cards style: a four-colour picture; every phone must show its quadrant's colour.
  await room.host.getByRole('tab', { name: /Photo & cards/ }).click();
  await room.host.getByRole('radio', { name: 'Stadium cards' }).check();
  await room.host.locator('#stunt-file').setInputFiles({
    name: 'quadrants.png',
    mimeType: 'image/png',
    buffer: QUADRANTS_PNG,
  });
  await room.host.getByRole('button', { name: 'Flip the cards' }).click();
  await expect(room.phones[0].locator('.label')).toHaveText(/^[123]$/, { timeout: 3000 });
  await room.phones[0].waitForTimeout(3600);
  for (let i = 0; i < SIMS.length; i++) expect(await bg(room.phones[i]), `phone ${i}`).toEqual(QUADRANT_COLOURS_BY_SIM[i]);
  await room.host.screenshot({ path: 'test-results/host-card.png' });
  await room.phones[2].screenshot({ path: 'test-results/phone-card.png' });
  expect(errors).toEqual([]);
});

test('a wave reaches the left of the room before the right', async ({ context }) => {
  test.setTimeout(150_000);
  const errors: string[] = [];
  const room = await openRoom(context, errors, [
    [0.15, 0.5],
    [0.5, 0.5],
    [0.85, 0.5],
  ]);
  await scan(room);
  await room.host.getByRole('tab', { name: /Wave/ }).click();
  await room.host.getByRole('button', { name: 'Start the wave' }).click();
  const peaks = [0, 0, 0].map(() => ({ t: 0, v: -1 }));
  const t0 = Date.now();
  while (Date.now() - t0 < 2600) {
    for (let i = 0; i < 3; i++) {
      const [r, g] = await bg(room.phones[i]);
      if (r + g > peaks[i].v) peaks[i] = { t: Date.now() - t0, v: r + g };
    }
  }
  expect(peaks.every((p) => p.v > 300)).toBe(true);
  expect(peaks[0].t).toBeLessThan(peaks[1].t);
  expect(peaks[1].t).toBeLessThan(peaks[2].t);
  await room.host.screenshot({ path: 'test-results/host-wave.png' });

  // Live screen: a moving picture, so each phone's colour keeps changing.
  await room.host.getByRole('tab', { name: /Live screen/ }).click();
  await room.host.getByRole('button', { name: 'Go live' }).click();
  await expect(room.host.getByText(/Broadcasting to 3 phones/)).toBeVisible();
  const seen = new Set<string>();
  for (let i = 0; i < 10; i++) {
    seen.add((await bg(room.phones[1])).join());
    await room.phones[1].waitForTimeout(150);
  }
  expect(seen.size).toBeGreaterThan(3);
  await room.host.screenshot({ path: 'test-results/host-live.png' });

  // Run the show: one button walks the crowd through the cues on its own.
  await room.host.getByRole('tab', { name: /Show/ }).click();
  await room.host.getByRole('button', { name: 'Start the show' }).click();
  await expect(room.host.locator('.score')).toContainText('Now: Title card');
  await expect(room.phones[0].locator('.label')).toHaveText(/^[123]$/, { timeout: 2500 });
  await expect(room.host.locator('.score')).toContainText('Now: Amber sweep', { timeout: 9000 });
  await room.host.screenshot({ path: 'test-results/host-show.png' });
  await room.host.getByRole('button', { name: 'Stop' }).click();
  expect(errors).toEqual([]);
});

test('territory and hot potato respond to taps; a refreshed phone keeps its seat', async ({ context }) => {
  const errors: string[] = [];
  const room = await openRoom(context, errors, [
    [0.2, 0.3],
    [0.2, 0.7],
    [0.5, 0.5],
    [0.8, 0.3],
    [0.8, 0.7],
  ]);
  await scan(room);

  await room.host.getByRole('tab', { name: /Territory/ }).click();
  await room.host.getByRole('button', { name: 'Start Territory' }).click();
  const left = room.phones[0];
  await expect(left.locator('.label')).toHaveText('TAP');
  // A player has their phone in hand: a background tab with nothing changing on screen gets no
  // animation frames in headless Chrome, and every click would wait on them.
  await left.bringToFront();
  for (let i = 0; i < 200; i++) {
    await left.locator('.screen').click({ position: { x: 100, y: 400 } });
    if (i % 10 === 9 && (await room.host.locator('.score').textContent())?.includes('wins')) break;
  }
  await expect(room.host.locator('.score')).toContainText('Amber wins');
  // The right-hand phones were overrun and now wear the winners' colour.
  await expect.poll(async () => (await bg(room.phones[4]))[0]).toBeGreaterThan(150);
  await room.host.screenshot({ path: 'test-results/host-territory.png' });

  await room.host.getByRole('tab', { name: /Hot Potato/ }).click();
  await room.host.getByRole('button', { name: 'Start Hot Potato' }).click();
  const holder = async () => {
    for (const p of room.phones) if ((await p.locator('.label').textContent()) === 'TAP!') return p;
    return null;
  };
  let h: Page | null = null;
  await expect.poll(async () => (h = await holder()) !== null, { timeout: 5000 }).toBe(true);
  await h!.locator('.screen').click({ position: { x: 100, y: 400 } });
  await expect(room.host.locator('.score')).toContainText(/· 1 throw$/);
  await h!.screenshot({ path: 'test-results/phone-potato.png' });

  // Refresh a phone: it rejoins in the same seat.
  const p = room.phones[2];
  const before = await p.locator('.status').textContent();
  await p.reload();
  await p.getByRole('button', { name: 'Join the swarm' }).click();
  await expect(p.locator('.status')).toContainText(before!.match(/Seat \d+/)![0]);
  await expect(room.host.locator('.count')).toContainText('5 phones');
  expect(errors).toEqual([]);
});
