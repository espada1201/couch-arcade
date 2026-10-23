// What a first-time host runs into: messages they can't miss, controls that say why they're off, and a page a screen reader can navigate.
import { expect, test, type Page } from '@playwright/test';
import { joinPhone, openHost, png, wav } from './room';

const inViewport = (page: Page, selector: string) =>
  page.locator(selector).evaluate((el) => {
    const r = el.getBoundingClientRect();
    return r.width > 0 && r.top >= 0 && r.bottom <= innerHeight;
  });

for (const [w, h] of [[1280, 720], [390, 844]]) {
  test(`${w}px: Flip with no placed phones says so inside the viewport, and Go to Locate leads to Locate`, async ({ context }) => {
    const errors: string[] = [];
    const { host, code } = await openHost(context, errors);
    await host.setViewportSize({ width: w, height: h });
    await joinPhone(context, code, 0, errors);
    await host.getByRole('tab', { name: /Photo & cards/ }).click();
    await host.getByRole('button', { name: 'Flip the cards' }).click();
    const alert = host.getByRole('alert').filter({ hasText: 'Place some phones on the map first.' });
    await expect(alert).toBeVisible();
    expect(await inViewport(host, '[role=alert]:not(:empty)')).toBe(true);
    await alert.getByRole('button', { name: 'Go to Locate' }).click();
    await expect(host.getByRole('tab', { name: /Locate/ })).toHaveAttribute('aria-selected', 'true');
    await expect(host.getByRole('button', { name: 'Start camera' })).toBeVisible();
    expect(errors).toEqual([]);
  });

  test(`${w}px: a song over the limit is refused right under the picker, in view`, async ({ context }) => {
    const errors: string[] = [];
    const { host } = await openHost(context, errors);
    await host.setViewportSize({ width: w, height: h });
    await host.getByRole('tab', { name: /Music/ }).click();
    // 5:30 at 8 kHz: over the 5 minute cap, small enough to be quick.
    await host.locator('#speaker-file').setInputFiles({ name: 'long.wav', mimeType: 'audio/wav', buffer: wav(330, 8000) });
    const alert = host.getByRole('alert').filter({ hasText: 'The limit is 5 minutes' });
    await expect(alert).toBeVisible();
    expect(await inViewport(host, '[role=alert]:not(:empty)')).toBe(true);
    // It sits directly after the picker, not at the foot of the panel.
    const below = await host.locator('.drop').evaluate((drop) => drop.nextElementSibling?.matches('.notice, .alert, [role=status], [role=alert]') ?? false);
    expect(below).toBe(true);
    expect(errors).toEqual([]);
  });
}

for (const [w, h] of [[1280, 800], [820, 1180]]) {
  test(`${w}px: the tray of phones not yet on the map stays in view next to the map, and a chip click does not move the page`, async ({ context }) => {
    const errors: string[] = [];
    const { host, code } = await openHost(context, errors);
    await host.setViewportSize({ width: w, height: h });
    for (let i = 0; i < 3; i++) await joinPhone(context, code, i, errors);
    // Photo & cards is the tallest panel: the one that used to stretch the map away from its tray.
    await host.getByRole('tab', { name: /Photo & cards/ }).click();
    expect(await inViewport(host, '.tray')).toBe(true);
    await host.locator('.tray .chip').first().click();
    expect(await host.evaluate(() => scrollY)).toBe(0);
    expect(await inViewport(host, '.tray')).toBe(true);
    const box = (await host.locator('.stage-canvas').boundingBox())!;
    await host.mouse.click(box.x + box.width * 0.3, box.y + box.height * 0.5);
    expect(await host.evaluate(() => scrollY)).toBe(0);
    expect(await inViewport(host, '.tray')).toBe(true);
    await host.locator('.tray .chip').first().click();
    expect(await inViewport(host, '.tray')).toBe(true);
    expect(errors).toEqual([]);
  });
}

test('the map text counts the phones that are here, and says when one has left', async ({ context }) => {
  const errors: string[] = [];
  const { host, code } = await openHost(context, errors);
  const phones = [await joinPhone(context, code, 0, errors), await joinPhone(context, code, 1, errors), await joinPhone(context, code, 2, errors)];
  await expect(host.locator('.stage-empty')).toContainText('3 phones joined');
  await phones[1].close();
  await expect(host.locator('.stage-empty')).toContainText('2 phones are here');
  await expect(host.locator('.stage-empty')).toContainText('1 phone has left');
  await expect(host.locator('.stage-empty')).not.toContainText('3 phones joined');
  expect(errors).toEqual([]);
});

test('a phone that left is labelled away on the map and the page says how to remove it', async ({ context }) => {
  const errors: string[] = [];
  const { host, code } = await openHost(context, errors);
  const phones = [await joinPhone(context, code, 0, errors), await joinPhone(context, code, 1, errors)];
  await phones[1].close();
  await expect(host.locator('.tray .chip', { hasText: '2 (away)' })).toBeVisible();
  await expect(host.locator('.stage-away')).toContainText(/Phone 2 has left.*Remove disconnected phones/);
  await host.getByRole('button', { name: 'Remove disconnected phones' }).click();
  await expect(host.locator('.stage-away')).toBeHidden();
  await expect(host.locator('.tray .chip', { hasText: 'away' })).toHaveCount(0);
  expect(errors).toEqual([]);
});

test('plain words: not on the map yet, put phones on the map, and the phone says the host does it', async ({ context }) => {
  const errors: string[] = [];
  const { host, code } = await openHost(context, errors);
  await expect(host.getByRole('heading', { level: 3, name: 'Put phones on the map' })).toBeVisible();
  await expect(host.getByRole('tab', { name: /Locate/ })).toBeVisible();
  const phone = await joinPhone(context, code, 0, errors);
  await expect(phone.locator('.status')).toContainText(/· not on the map yet$/);
  await expect(phone.locator('.map-hint')).toContainText('The host will put your phone on the map');
  await expect(host.getByRole('group', { name: 'Phones not on the map yet' })).toContainText('Not on the map yet');
  await expect(host.locator('.count')).toContainText('1 phone · 0 of 1 on the map');
  await expect(host.getByText(/not placed|Not placed/)).toHaveCount(0);
  expect(errors).toEqual([]);
});

test('typed seats take effect by themselves once every phone has answered, and the phone says what happens next', async ({ context }) => {
  const errors: string[] = [];
  const { host, code } = await openHost(context, errors);
  await host.setViewportSize({ width: 1280, height: 800 });
  const phones = [await joinPhone(context, code, 0, errors), await joinPhone(context, code, 1, errors)];
  await host.getByText('No camera? Use seat numbers').click();
  await host.locator('#grid-rows').fill('2');
  await host.locator('#grid-seats').fill('3');
  await host.getByRole('button', { name: 'Ask phones for their seat' }).click();
  // The count and the control stay in view.
  expect(await inViewport(host, '#grid-answers')).toBe(true);
  await expect(host.locator('#grid-answers')).toContainText('0 of 2 phones have answered.');
  await phones[0].locator('#row').fill('1');
  await phones[0].locator('#seatno').fill('1');
  await phones[0].getByRole('button', { name: 'Done' }).click();
  await expect(phones[0].locator('.done')).toContainText(/host.*every phone has answered/i);
  await expect(host.locator('#grid-answers')).toContainText('1 of 2 phones has answered.');
  // Not applied yet: one answer on its own would wipe the others.
  await expect(host.locator('tr[data-seat="0"]')).toHaveAttribute('data-source', '');
  await phones[1].locator('#row').fill('2');
  await phones[1].locator('#seatno').fill('3');
  await phones[1].getByRole('button', { name: 'Done' }).click();
  for (const seat of [0, 1]) await expect(host.locator(`tr[data-seat="${seat}"]`)).toHaveAttribute('data-source', 'grid');
  await expect(host.locator('#grid-answers')).toContainText('Seats are on the map');
  for (const p of phones) await expect(p.locator('.status')).toContainText(/· on the map$/);
  expect(errors).toEqual([]);
});

test('typed seats can also be used before everyone has answered, from a button that is in view', async ({ context }) => {
  const errors: string[] = [];
  const { host, code } = await openHost(context, errors);
  await host.setViewportSize({ width: 1280, height: 800 });
  const phones = [await joinPhone(context, code, 0, errors), await joinPhone(context, code, 1, errors)];
  await host.getByText('No camera? Use seat numbers').click();
  const use = host.getByRole('button', { name: 'Use typed seats' });
  await expect(use).toBeDisabled();
  await host.getByRole('button', { name: 'Ask phones for their seat' }).click();
  await expect(use).toBeDisabled();
  await phones[0].locator('#row').fill('1');
  await phones[0].locator('#seatno').fill('2');
  await phones[0].getByRole('button', { name: 'Done' }).click();
  await expect(use).toBeEnabled();
  expect(await inViewport(host, 'button:has-text("Use typed seats")')).toBe(true);
  await use.click();
  await expect(host.locator('tr[data-seat="0"]')).toHaveAttribute('data-source', 'grid');
  expect(errors).toEqual([]);
});

test('Big screen, Show and Live screen each point to Photo & cards, and Photo & cards says it spreads your photo', async ({ context }) => {
  const errors: string[] = [];
  const { host } = await openHost(context, errors);
  await host.setViewportSize({ width: 1280, height: 800 });
  for (const tab of [/Big screen/, /Show/, /Live screen/]) {
    await host.getByRole('tab', { name: tab }).click();
    const go = host.getByRole('tabpanel').getByRole('button', { name: 'Go to Photo & cards' });
    await expect(go).toBeVisible();
    expect(await inViewport(host, '[role=tabpanel] .pointer button')).toBe(true);
    await expect(host.getByRole('tabpanel').locator('.pointer')).toContainText(/one photo.*each.*its own piece/i);
    await go.click();
    await expect(host.getByRole('tab', { name: /Photo & cards/ })).toHaveAttribute('aria-selected', 'true');
    await expect(host.locator('.panel-intro').first()).toContainText(/your photo/i);
  }
  // Show no longer promises pictures it cannot do.
  await host.getByRole('tab', { name: /Show/ }).click();
  await expect(host.locator('.panel-intro').first()).not.toContainText(/pictures on every phone/i);
  await expect(host.locator('.panel-intro').first()).toContainText(/cannot show your own photo/i);
  expect(errors).toEqual([]);
});

for (const [w, h] of [[1280, 800], [820, 1180]]) {
  test(`${w}px: Photo & cards offers the picture upload first, in view`, async ({ context }) => {
    const errors: string[] = [];
    const { host } = await openHost(context, errors);
    await host.setViewportSize({ width: w, height: h });
    await host.getByRole('tab', { name: /Photo & cards/ }).click();
    const above = await host.evaluate(() => document.querySelector('#stunt-file')!.getBoundingClientRect().top < document.querySelector('.thumbs')!.getBoundingClientRect().top);
    expect(above).toBe(true);
    expect(await inViewport(host, '#stunt-file')).toBe(true);
    expect(errors).toEqual([]);
  });
}

for (const [tab, button] of [[/Photo & cards/, 'Flip the cards'], [/Wave/, 'Start the wave']] as const) {
  test(`${tab.source}: the red "Place some phones on the map first." goes away once a phone is on the map`, async ({ context }) => {
    const errors: string[] = [];
    const { host, code } = await openHost(context, errors);
    await joinPhone(context, code, 0, errors);
    await host.getByRole('tab', { name: tab }).click();
    await host.getByRole('button', { name: button }).click();
    const alert = host.getByRole('alert').filter({ hasText: 'Place some phones on the map first.' });
    await expect(alert).toBeVisible();
    await host.locator('.tray .chip').first().click();
    const box = (await host.locator('.stage-canvas').boundingBox())!;
    await host.mouse.click(box.x + box.width * 0.5, box.y + box.height * 0.5);
    await expect(host.locator('.needs')).toContainText('Your phone is on the map');
    await expect(alert).toHaveCount(0);
    expect(errors).toEqual([]);
  });
}

test('an error that is still true stays when phones get placed: only the placing message goes', async ({ context }) => {
  const errors: string[] = [];
  const { host, code } = await openHost(context, errors);
  await joinPhone(context, code, 0, errors);
  await host.getByRole('tab', { name: /Photo & cards/ }).click();
  await host.getByRole('button', { name: 'Flip the cards' }).click();
  await expect(host.getByRole('alert').filter({ hasText: 'Place some phones on the map first.' })).toBeVisible();
  // A different message took its place: placing phones must not wipe it.
  await host.locator('#stunt-file').setInputFiles({ name: 'notes.txt', mimeType: 'text/plain', buffer: Buffer.from('not a picture') });
  await expect(host.getByRole('alert').filter({ hasText: 'could not be read as a picture' })).toBeVisible();
  await host.locator('.tray .chip').first().click();
  const box = (await host.locator('.stage-canvas').boundingBox())!;
  await host.mouse.click(box.x + box.width * 0.5, box.y + box.height * 0.5);
  await expect(host.locator('.needs')).toContainText('Your phone is on the map');
  await expect(host.getByRole('alert').filter({ hasText: 'could not be read as a picture' })).toBeVisible();
  expect(errors).toEqual([]);
});

for (const [w, h] of [[1280, 800], [390, 844]]) {
  test(`${w}px: Flip and its message stay in view while the rest of Photo & cards scrolls`, async ({ context }) => {
    const errors: string[] = [];
    const { host } = await openHost(context, errors);
    await host.setViewportSize({ width: w, height: h });
    await host.getByRole('tab', { name: /Photo & cards/ }).click();
    const flip = host.getByRole('button', { name: 'Flip the cards' });
    await expect(flip).toBeVisible();
    expect(await inViewport(host, 'button.btn.primary:text("Flip the cards")'), 'at the top of the panel').toBe(true);
    await host.locator('.stunt-preview').scrollIntoViewIfNeeded();
    expect(await inViewport(host, '.stunt-preview canvas'), 'the preview').toBe(true);
    expect(await inViewport(host, 'button.btn.primary:text("Flip the cards")'), 'beside the preview').toBe(true);
    await host.locator('#stunt-name-1').scrollIntoViewIfNeeded();
    expect(await inViewport(host, '#stunt-name-1'), 'the Name field').toBe(true);
    expect(await inViewport(host, 'button.btn.primary:text("Flip the cards")'), 'beside the Name field').toBe(true);
    await flip.click();
    expect(await inViewport(host, '[role=alert]:not(:empty)'), 'the message').toBe(true);
    expect(errors).toEqual([]);
  });
}

test('320px: a focused field stops above the bar even when a message wraps and makes the bar taller', async ({ context }) => {
  const errors: string[] = [];
  const { host } = await openHost(context, errors);
  await host.setViewportSize({ width: 320, height: 640 });
  await host.getByRole('tab', { name: /Photo & cards/ }).click();
  await host.getByRole('button', { name: 'Flip the cards' }).click();
  await expect(host.getByRole('alert').filter({ hasText: 'Place some phones on the map first.' })).toBeVisible();
  await host.locator('.panel-foot [role=alert]').evaluate((el) => el.append(' This is a long message that has to wrap onto several lines in a narrow window.'.repeat(3)));
  const gap = async (field: string) => {
    await host.evaluate(() => scrollTo(0, 0));
    await host.locator(field).evaluate((el) => el.scrollIntoView({ block: 'nearest' }));
    return host.evaluate((f) => document.querySelector('.panel-foot')!.getBoundingClientRect().top - document.querySelector(f)!.getBoundingClientRect().bottom, field);
  };
  const bar = await host.locator('.panel-foot').evaluate((el) => el.getBoundingClientRect().height);
  expect(bar).toBeGreaterThan(200);
  for (const field of ['#stunt-words', '#stunt-name-2']) expect(await gap(field), field).toBeGreaterThanOrEqual(0);
  expect(errors).toEqual([]);
});

test('keyboard: Enter in a Name field or in "Or your words" moves focus to Flip, and Enter in words uses them first', async ({ context }) => {
  const errors: string[] = [];
  const { host } = await openHost(context, errors);
  await host.getByRole('tab', { name: /Photo & cards/ }).click();
  const flip = host.getByRole('button', { name: 'Flip the cards' });
  await host.getByRole('button', { name: 'Happy birthday' }).click();
  await host.locator('#stunt-name-1').fill('MAYA');
  await host.keyboard.press('Enter');
  await expect(flip).toBeFocused();
  await host.locator('#stunt-name-2').focus();
  await host.keyboard.press('Enter');
  await expect(flip).toBeFocused();
  await expect(host.getByRole('button', { name: 'Happy birthday' })).toHaveAttribute('aria-pressed', 'true');
  await host.locator('#stunt-words').fill('GO TEAM');
  await host.keyboard.press('Enter');
  await expect(flip).toBeFocused();
  await expect(host.locator('.thumbs button[aria-pressed=true], .moments button[aria-pressed=true]')).toHaveCount(0);
  expect(errors).toEqual([]);
});

test('typing "Or your words" updates the preview by itself, like the Name field, and "Use words" still works', async ({ context }) => {
  const errors: string[] = [];
  const { host } = await openHost(context, errors);
  await host.getByRole('tab', { name: /Photo & cards/ }).click();
  const chosen = host.locator('.thumbs button[aria-pressed=true], .moments button[aria-pressed=true]');
  await expect(chosen).toHaveCount(1);
  const picture = () => host.locator('.stunt-preview canvas').evaluate((c: HTMLCanvasElement) => c.toDataURL());
  const before = await picture();
  await host.locator('#stunt-words').pressSequentially('HAPPY BIRTHDAY MAYA');
  await expect(chosen).toHaveCount(0);
  expect(await picture()).not.toBe(before);
  const typed = await picture();
  await host.locator('#stunt-words').pressSequentially('!');
  await expect.poll(picture).not.toBe(typed);
  const latest = await picture();
  await host.locator('#stunt-words').fill('');
  await host.waitForTimeout(600);
  expect(await picture()).toBe(latest);
  await host.locator('#stunt-words').fill('GO');
  await host.getByRole('button', { name: 'Use words' }).click();
  await expect.poll(picture).not.toBe(typed);
  expect(errors).toEqual([]);
});

const DONE = 'Done. Phones 1 and 2 are in a row, phone 1 on the left. Ask your friends to hold or lay their phones in that order.';

test('the line-up instruction stays when a picture is chosen, and goes when the host flips', async ({ context }) => {
  const errors: string[] = [];
  const { host, code } = await openHost(context, errors);
  for (let i = 0; i < 2; i++) await joinPhone(context, code, i, errors);
  await host.getByRole('tab', { name: /Photo & cards/ }).click();
  await host.locator('.needs').getByRole('button', { name: 'Line them up for me' }).click();
  await expect(host.getByText(DONE)).toBeVisible();
  await host.locator('.thumbs button').nth(1).click();
  await host.locator('#stunt-words').fill('GO');
  await host.getByRole('radio', { name: 'Stadium cards' }).check();
  await expect(host.getByText(DONE)).toBeVisible();
  await host.getByRole('button', { name: 'Flip the cards' }).click();
  await expect(host.getByText(DONE)).toHaveCount(0);
  expect(errors).toEqual([]);
});

test('the line-up instruction goes when the layout changes', async ({ context }) => {
  const errors: string[] = [];
  const { host, code } = await openHost(context, errors);
  for (let i = 0; i < 2; i++) await joinPhone(context, code, i, errors);
  await host.getByRole('tab', { name: /Photo & cards/ }).click();
  await host.locator('.needs').getByRole('button', { name: 'Line them up for me' }).click();
  await expect(host.getByText(DONE)).toBeVisible();
  await joinPhone(context, code, 2, errors);
  await expect(host.locator('.needs')).toContainText('2 of 3 phones are on the map');
  await expect(host.getByText(DONE)).toBeVisible();
  await host.locator('.tray .chip').first().click();
  const box = (await host.locator('.stage-canvas').boundingBox())!;
  await host.mouse.click(box.x + box.width * 0.5, box.y + box.height * 0.2);
  await expect(host.locator('.needs')).toContainText('All 3 phones are on the map');
  await expect(host.getByText(DONE)).toHaveCount(0);
  expect(errors).toEqual([]);
});

test('Photo & cards says what to expect from few phones', async ({ context }) => {
  const errors: string[] = [];
  const { host } = await openHost(context, errors);
  await host.getByRole('tab', { name: /Photo & cards/ }).click();
  await expect(host.getByText('Each phone shows one colour of the picture, so the more phones, the sharper it gets.')).toBeAttached();
  expect(errors).toEqual([]);
});

for (const [w, h] of [[1280, 800], [820, 1180]]) {
  test(`${w}px: Photo & cards says up front that it needs phones on the map, with a live count`, async ({ context }) => {
    const errors: string[] = [];
    const { host, code } = await openHost(context, errors);
    await host.setViewportSize({ width: w, height: h });
    await host.getByRole('tab', { name: /Photo & cards/ }).click();
    const need = host.locator('.needs');
    await expect(need).toContainText('No phones have joined yet');
    for (let i = 0; i < 3; i++) await joinPhone(context, code, i, errors);
    await expect(need).toContainText('0 of 3 phones are on the map');
    await expect(need.getByRole('button', { name: 'Go to Locate' })).toBeVisible();
    expect(await inViewport(host, '.needs')).toBe(true);
    // Placing phones by hand moves the count; Flip still refuses with its own message for a host who skips the note.
    await host.locator('.tray .chip').first().click();
    const box = (await host.locator('.stage-canvas').boundingBox())!;
    await host.mouse.click(box.x + box.width * 0.3, box.y + box.height * 0.5);
    await expect(need).toContainText('1 of 3 phones are on the map');
    await expect(need.getByRole('button', { name: 'Go to Locate' })).toBeVisible();
    for (const n of [2, 3]) {
      await host.locator('.tray .chip').first().click();
      await host.mouse.click(box.x + box.width * (0.3 + n * 0.15), box.y + box.height * 0.5);
    }
    await expect(need).toContainText('All 3 phones are on the map');
    await expect(need.getByRole('button', { name: 'Go to Locate' })).toBeHidden();
    expect(errors).toEqual([]);
  });
}

test('every panel that needs phones on the map says so up front', async ({ context }) => {
  const errors: string[] = [];
  const { host } = await openHost(context, errors);
  for (const tab of [/Music/, /Show/, /Live screen/, /Wave/, /Territory/, /Hot Potato/]) {
    await host.getByRole('tab', { name: tab }).click();
    if (tab.source === 'Music') await host.getByRole('radio', { name: 'Spatial tones' }).check();
    await expect(host.getByRole('tabpanel').locator('.needs')).toBeVisible();
  }
  expect(errors).toEqual([]);
});

test('Scan the room says to start the camera first, and the header buttons say what they do', async ({ context }) => {
  const errors: string[] = [];
  const { host } = await openHost(context, errors, 'transport=local&camera=synthetic&fresh=1');
  const scan = host.getByRole('button', { name: 'Scan the room' });
  await expect(scan).toBeDisabled();
  await expect(scan).toHaveAccessibleDescription('Start the camera first.');
  await host.getByRole('button', { name: 'Start simulated camera' }).click();
  await expect(scan).toBeEnabled();
  await expect(host.getByText('Start the camera first.')).toBeHidden();

  await expect(host.getByRole('button', { name: 'Forget offline' })).toHaveCount(0);
  await expect(host.getByRole('button', { name: 'Remove disconnected phones' })).toHaveAttribute('title', /off the map/);
  await expect(host.getByRole('button', { name: 'Lights off' })).toHaveAttribute('title', /Stop whatever is running/);
  expect(errors).toEqual([]);
});

test('the host page has a heading outline, and the tab list takes Home and End', async ({ context }) => {
  const errors: string[] = [];
  const { host } = await openHost(context, errors);
  await expect(host.getByRole('heading', { level: 1 })).toHaveText('Swarm Screen host console');
  await expect(host.getByRole('heading', { level: 2, name: 'Locate' })).toBeAttached();
  await expect(host.getByRole('heading', { level: 2, name: 'Join this room' })).toBeAttached();
  const tabs = host.getByRole('tab');
  await tabs.first().focus();
  await host.keyboard.press('End');
  await expect(tabs.last()).toHaveAttribute('aria-selected', 'true');
  await expect(tabs.last()).toBeFocused();
  await expect(host.getByRole('heading', { level: 2, name: 'Hot Potato' })).toBeAttached();
  await host.keyboard.press('Home');
  await expect(tabs.first()).toHaveAttribute('aria-selected', 'true');
  await expect(tabs.first()).toBeFocused();
  expect(errors).toEqual([]);
});

test('the Mode legend sits right above its toggle, and the speaker copy has no leftover placeholders', async ({ context }) => {
  const { host } = await openHost(context, []);
  await host.getByRole('tab', { name: /Music/ }).click();
  const gap = await host.locator('.sound-modes > .seg').evaluate((seg) => seg.querySelector('label')!.getBoundingClientRect().top - seg.querySelector('legend')!.getBoundingClientRect().bottom);
  expect(gap).toBeLessThan(10);
  const intro = await host.locator('.panel-intro').first().innerText();
  expect(intro).toMatch(/^Play one song on every phone at once\./);
  expect(intro).not.toMatch(/±N|In our tests|10 ms/);
});

test('a phone gate warns about the iPhone silent switch', async ({ page }) => {
  await page.goto('./?room=ABCD&transport=local');
  await expect(page.getByText(/Silent mode off/)).toBeVisible();
});

test('the web app manifest starts at the app and carries 192 and 512 pixel icons that exist', async ({ page, request }) => {
  await page.goto('./');
  const href = await page.locator('link[rel=manifest]').getAttribute('href');
  const res = await request.get(new URL(href!, page.url()).href);
  const manifest = await res.json();
  expect(manifest.start_url).toBe('./');
  const sizes = manifest.icons.map((i: { sizes: string }) => i.sizes);
  expect(sizes).toEqual(expect.arrayContaining(['192x192', '512x512']));
  for (const icon of manifest.icons) expect((await request.get(new URL(icon.src, new URL(href!, page.url())).href)).status()).toBe(200);
});

test('a keyboard-only host reaches the experience tabs with Tab and Enter, and Tab from a tab lands on the first control', async ({ context }) => {
  const errors: string[] = [];
  const { host } = await openHost(context, errors);
  await host.setViewportSize({ width: 1280, height: 800 });
  // A page that has just opened: nothing has focus yet.
  expect(await host.evaluate(() => document.activeElement === document.body)).toBe(true);

  // Tab 1 is the skip link, and it can be seen while it has focus.
  await host.keyboard.press('Tab');
  const skip = host.getByRole('link', { name: 'Skip to controls' });
  await expect(skip).toBeFocused();
  expect(await inViewport(host, 'a.skip-link')).toBe(true);
  await host.screenshot({ path: 'test-results/host-skip-link.png' });

  // Enter on it lands on the selected tab: two key presses in all. Without it the strip is the 11th Tab stop.
  await host.keyboard.press('Enter');
  await expect(host.getByRole('tab', { name: /Locate/ })).toBeFocused();
  expect(new URL(host.url()).hash).toBe('');

  // From the selected tab, the next Tab goes into the panel's first control, not onto the panel box itself.
  await host.keyboard.press('Tab');
  const where = await host.evaluate(() => {
    const el = document.activeElement as HTMLElement;
    return { inPanel: !!el.closest('.panel'), isPanel: el.matches('[role=tabpanel]'), tag: el.tagName };
  });
  expect(where).toMatchObject({ inPanel: true, isPanel: false });

  // Arrow keys still move along the strip.
  await host.getByRole('tab', { name: /Locate/ }).focus();
  await host.keyboard.press('ArrowRight');
  await expect(host.getByRole('tab', { name: /Music/ })).toBeFocused();
  await expect(host.getByRole('tab', { name: /Music/ })).toHaveAttribute('aria-selected', 'true');
  expect(errors).toEqual([]);
});

test('every control on the Music and Photo & cards panels shows a focus ring, the song picker included', async ({ context }) => {
  const { host } = await openHost(context, []);
  await host.setViewportSize({ width: 1280, height: 800 });
  for (const tab of [/Music/, /Photo & cards/]) {
    await host.getByRole('tab', { name: tab }).click();
    await host.getByRole('tab', { name: tab }).focus();
    const seen: string[] = [];
    for (let i = 0; i < 12; i++) {
      await host.keyboard.press('Tab');
      const ring = await host.evaluate(() => {
        const el = document.activeElement as HTMLElement;
        if (!el.closest('.panel')) return null;
        // A visually hidden input shows its ring on the control it stands for.
        const shown = el.matches('input[type=file]') ? ((el.closest('label') as HTMLElement | null) ?? el) : el;
        const own = getComputedStyle(el);
        const lab = getComputedStyle(shown);
        const has = (s: CSSStyleDeclaration) => s.outlineStyle !== 'none' && parseFloat(s.outlineWidth) >= 2;
        return { name: el.id || el.tagName, ok: has(own) || has(lab) || (el.matches('input[type=file]') && !!el.closest('label:focus-within')) };
      });
      if (ring) {
        seen.push(ring.name);
        expect(ring.ok, `focus ring on ${ring.name}`).toBe(true);
      }
    }
    expect(seen.length).toBeGreaterThan(2);
  }
  await host.getByRole('tab', { name: /Music/ }).click();
  await host.locator('#speaker-file').focus();
  await host.screenshot({ path: 'test-results/host-picker-focus.png' });
});

test('Music: one short intro, a big Pick a song button, and a live status under it', async ({ context }) => {
  test.setTimeout(90_000);
  const errors: string[] = [];
  const { host, code } = await openHost(context, errors);
  await host.setViewportSize({ width: 1280, height: 800 });
  for (let i = 0; i < 2; i++) await joinPhone(context, code, i, errors);
  await expect(host.locator('.count')).toContainText('2 phones');
  await host.getByRole('tab', { name: /Music/ }).click();

  const intro = await host.locator('.panel-intro').first().innerText();
  expect(intro.split(/[.!?](?:\s|$)/).filter(Boolean).length).toBeLessThanOrEqual(2);
  expect(intro).toMatch(/same moment/i);
  expect(intro).toMatch(/install/i);
  expect(intro).toMatch(/file/i);

  const pick = host.locator('.drop .pick');
  await expect(pick).toHaveText('Pick a song');
  expect((await pick.boundingBox())!.height).toBeGreaterThanOrEqual(56);

  await host.locator('#speaker-file').setInputFiles({ name: 'Test Tone.wav', mimeType: 'audio/wav', buffer: wav(12) });
  // The line right under the picker tells the story: never the old "Sending the song…" sentence that stays forever.
  const status = host.locator('.drop + .notice > .note');
  await expect(status).toHaveText('Ready on all 2 phones. Press Play.', { timeout: 20_000 });
  expect(await inViewport(host, '.drop + .notice > .note')).toBe(true);
  await expect(host.getByText('3 of 3 phones ready')).toHaveCount(0);
  await expect(host.getByText('2 of 2 phones ready')).toBeVisible();
  await expect(host.locator('.np-phones li')).toHaveCount(2);

  // Play: the clock says it is starting during the 1.5 s lead-in, then runs.
  await host.getByRole('button', { name: 'Play', exact: true }).click();
  await expect(host.locator('.np-time')).toContainText('Starting');
  await expect(host.locator('.np-time')).not.toContainText('Starting', { timeout: 4000 });
  await expect(status).toHaveText('');
  expect(errors).toEqual([]);
});

test('Poll answer boxes look empty: their hints are examples, not typed words', async ({ context }) => {
  const { host } = await openHost(context, []);
  await host.getByRole('tab', { name: /Poll/ }).click();
  const hints = await host.locator('#poll-q, [id^=poll-opt-]').evaluateAll((els) => els.map((e) => (e as HTMLInputElement).placeholder));
  expect(hints).toHaveLength(5);
  for (const hint of hints) expect(hint === '' || /^e\.g\. |^Optional/.test(hint), hint).toBe(true);
  expect(hints).not.toContain('Yes');
  expect(hints).not.toContain('No');
  expect(hints[1]).toBe('e.g. Yes');
});

test('on a touch screen the small buttons and chips are at least 44 px tall', async ({ browser }) => {
  const ctx = await browser.newContext({ hasTouch: true, isMobile: true, viewport: { width: 820, height: 1000 } });
  const page = await ctx.newPage();
  await page.goto('./?host=1&transport=local&fresh=1');
  await expect(page.getByRole('tab', { name: /Locate/ })).toBeVisible();
  expect(await page.evaluate(() => matchMedia('(pointer: coarse)').matches)).toBe(true);
  const heights = await page.locator('.btn.small').evaluateAll((els) => els.map((e) => e.getBoundingClientRect().height));
  expect(heights.length).toBeGreaterThan(2);
  for (const h of heights) expect(h).toBeGreaterThanOrEqual(44);
  const chip = await page.evaluate(() => {
    const b = document.createElement('button');
    b.className = 'chip';
    b.textContent = '1';
    document.body.append(b);
    return b.getBoundingClientRect().height;
  });
  expect(chip).toBeGreaterThanOrEqual(44);
  await ctx.close();
});

test('help and secondary text on the host console is at least 15 px', async ({ context }) => {
  const { host } = await openHost(context, []);
  await host.setViewportSize({ width: 1280, height: 800 });
  const small = async () =>
    host.evaluate(() => {
      const out: string[] = [];
      const walker = document.createTreeWalker(document.querySelector('.console')!, NodeFilter.SHOW_TEXT);
      for (let n = walker.nextNode(); n; n = walker.nextNode()) {
        const el = n.parentElement!;
        if (!n.textContent!.trim() || el.closest('.sr-only, .tab-num, .room-code, script, style')) continue;
        const r = el.getBoundingClientRect();
        if (r.width === 0) continue;
        if (parseFloat(getComputedStyle(el).fontSize) < 15) out.push(`${el.className || el.tagName}: ${n.textContent!.trim().slice(0, 30)}`);
      }
      return out;
    });
  for (const tab of [/Locate/, /Music/, /Poll/, /Show/, /Photo & cards/]) {
    await host.getByRole('tab', { name: tab }).click();
    expect(await small(), String(tab)).toEqual([]);
  }
  expect(await host.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});

test('a picked picture says it is ready and brings Flip into view; each tab opens at its top', async ({ context }) => {
  const errors: string[] = [];
  const { host } = await openHost(context, errors);
  await host.getByRole('tab', { name: /Photo & cards/ }).click();
  await host.locator('#stunt-file').setInputFiles({ name: 'beach.png', mimeType: 'image/png', buffer: png(60, 40, (x) => (x < 30 ? [80, 160, 240] : [230, 210, 150])) });
  await expect(host.getByText('Your picture is ready. Press Flip the cards.')).toBeVisible();
  expect(await host.getByRole('button', { name: 'Flip the cards' }).evaluate((el) => el.getBoundingClientRect().bottom <= innerHeight)).toBe(true);
  await host.getByRole('tab', { name: /Music/ }).click();
  expect(await host.locator('.panel').evaluate((el) => el.scrollTop)).toBe(0);
  expect(errors).toEqual([]);
});

test('a song file brings Play into view, and the picker names WAV too', async ({ context }) => {
  const errors: string[] = [];
  const { host } = await openHost(context, errors);
  await host.getByRole('tab', { name: /Music/ }).click();
  await expect(host.locator('.drop-hint')).toContainText('MP3, M4A or WAV');
  await host.locator('#speaker-file').setInputFiles({ name: 'tune.wav', mimeType: 'audio/wav', buffer: wav(3) });
  await expect(host.locator('.np-host-title')).toHaveText('tune');
  const play = host.getByRole('button', { name: 'Play', exact: true });
  await expect(play).toBeEnabled();
  expect(await play.evaluate((el) => el.getBoundingClientRect().bottom <= innerHeight)).toBe(true);
  expect(errors).toEqual([]);
});

test('keyboard: Enter on a tray number then Enter on the map puts that phone on the map', async ({ context }) => {
  const errors: string[] = [];
  const { host, code } = await openHost(context, errors);
  for (let i = 0; i < 2; i++) await joinPhone(context, code, i, errors);
  await expect(host.locator('.tray .chip')).toHaveCount(2);
  await host.locator('.tray .chip').first().focus();
  await host.keyboard.press('Enter');
  await expect(host.locator('.stage-canvas')).toBeFocused();
  await host.keyboard.press('Enter');
  await expect(host.locator('.tray .chip')).toHaveCount(1);
  await expect(host.getByRole('status').filter({ hasText: 'is on the map. Arrows move it.' })).toBeAttached();
  expect(errors).toEqual([]);
});

test('Go to Locate from Photo & cards offers the way back, and a started camera puts Scan under the keyboard', async ({ context }) => {
  const errors: string[] = [];
  const { host, code } = await openHost(context, errors, 'transport=local&camera=synthetic&fresh=1');
  await joinPhone(context, code, 0, errors);
  await host.getByRole('tab', { name: /Photo & cards/ }).click();
  await host.locator('.needs').getByRole('button', { name: 'Go to Locate' }).click();
  await expect(host.getByRole('tab', { name: /Locate/ })).toHaveAttribute('aria-selected', 'true');
  await host.getByRole('button', { name: 'Start simulated camera' }).click();
  await expect(host.getByRole('button', { name: 'Scan the room' })).toBeFocused();
  await host.keyboard.press('Enter');
  await expect(host.getByText(/Placed 1 of 1 phone/)).toBeVisible({ timeout: 20000 });
  await expect(host.getByRole('button', { name: 'Back to Photo & cards' })).toBeFocused();
  await host.keyboard.press('Enter');
  await expect(host.getByRole('tab', { name: /Photo & cards/ })).toHaveAttribute('aria-selected', 'true');
  // Picking a tab directly carries no way back.
  await host.getByRole('tab', { name: /Locate/ }).click();
  await expect(host.getByRole('button', { name: /^Back to/ })).toHaveCount(0);
  expect(errors).toEqual([]);
});

test('a scan that places everyone leaves keyboard focus on Scan when the host did not come from another tab', async ({ context }) => {
  const errors: string[] = [];
  const { host, code } = await openHost(context, errors, 'transport=local&camera=synthetic&fresh=1');
  await joinPhone(context, code, 0, errors);
  await host.getByRole('button', { name: 'Start simulated camera' }).click();
  await host.getByRole('button', { name: 'Scan the room' }).press('Enter');
  await expect(host.getByText(/Placed 1 of 1 phone/)).toBeVisible({ timeout: 20000 });
  await expect(host.getByRole('button', { name: /^Back to/ })).toHaveCount(0);
  await expect(host.getByRole('button', { name: 'Scan the room' })).toBeFocused();
  expect(errors).toEqual([]);
});

test('1280x800: after an upload the preview and Flip are both in view, without scrolling', async ({ context }) => {
  const errors: string[] = [];
  const { host } = await openHost(context, errors);
  await host.setViewportSize({ width: 1280, height: 800 });
  await host.getByRole('tab', { name: /Photo & cards/ }).click();
  await host.locator('#stunt-file').setInputFiles({ name: 'beach.png', mimeType: 'image/png', buffer: png(60, 40, (x) => (x < 30 ? [80, 160, 240] : [230, 210, 150])) });
  await expect(host.getByText('Your picture is ready. Press Flip the cards.')).toBeVisible();
  const seen = () =>
    host.evaluate(() => {
      const [pre, foot] = ['.stunt-preview', '.panel-foot'].map((s) => document.querySelector(s)!.getBoundingClientRect());
      const flip = [...document.querySelectorAll('button')].find((b) => b.textContent === 'Flip the cards')!.getBoundingClientRect();
      const panel = document.querySelector('.panel')!.getBoundingClientRect();
      return { previewShown: pre.top >= panel.top && pre.bottom <= foot.top + 1, flipShown: flip.top >= foot.top && flip.bottom <= innerHeight };
    });
  await expect.poll(seen).toEqual({ previewShown: true, flipShown: true });
  expect(errors).toEqual([]);
});

test('1280x800: a tall portrait picture shows the top of its preview and Flip together, and a wide one does too', async ({ context }) => {
  const errors: string[] = [];
  const { host } = await openHost(context, errors);
  await host.setViewportSize({ width: 1280, height: 800 });
  await host.getByRole('tab', { name: /Photo & cards/ }).click();
  const seen = () =>
    host.evaluate(() => {
      const pre = document.querySelector('.stunt-preview canvas')!.getBoundingClientRect();
      const foot = document.querySelector('.panel-foot')!.getBoundingClientRect();
      const flip = [...document.querySelectorAll('button')].find((b) => b.textContent === 'Flip the cards')!.getBoundingClientRect();
      const panel = document.querySelector('.panel')!.getBoundingClientRect();
      return { previewTopShown: pre.top >= panel.top, previewAboveFoot: pre.bottom <= foot.top + 1, previewHeight: Math.round(pre.height), flipShown: flip.top >= foot.top && flip.bottom <= innerHeight };
    });
  for (const [name, w, h] of [['tall.png', 30, 240], ['wide.png', 240, 30]] as const) {
    await host.locator('#stunt-file').setInputFiles({ name, mimeType: 'image/png', buffer: png(w, h, (x, y) => ((x + y) % 2 ? [80, 160, 240] : [230, 210, 150])) });
    await expect(host.getByText('Your picture is ready. Press Flip the cards.')).toBeVisible();
    await expect.poll(seen).toMatchObject({ previewTopShown: true, previewAboveFoot: true, flipShown: true });
    // Tall or wide, the preview is a sensible size: all of it is in view, so it must also be small enough to fit above the footer.
    expect((await seen()).previewHeight).toBeGreaterThan(40);
    await host.getByRole('button', { name: 'Flip the cards' }).focus();
  }
  expect(errors).toEqual([]);
});

test('1280x800: the top bar is one row, so the console keeps its height for the panels', async ({ context }) => {
  const errors: string[] = [];
  const { host, code } = await openHost(context, errors);
  await host.setViewportSize({ width: 1280, height: 800 });
  for (let i = 0; i < 3; i++) await joinPhone(context, code, i, errors);
  await expect(host.locator('.count')).toContainText('3 phones · 0 of 3 on the map · in sync to');
  // One row of 34 px buttons plus padding is about 60 px; a second row of buttons made it 110.
  expect((await host.locator('.topbar').boundingBox())!.height).toBeLessThan(75);
  const actions = (await host.locator('.top-actions').boundingBox())!;
  const room = (await host.locator('.topbar .room').boundingBox())!;
  expect(actions.y).toBeLessThan(room.y + room.height);
  expect(await host.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  expect(errors).toEqual([]);
});

test('the two unexplained options say what they do: flip left and right on Locate, record the moment on Photo & cards', async ({ context }) => {
  const errors: string[] = [];
  const { host } = await openHost(context, errors);
  await host.setViewportSize({ width: 1280, height: 800 });
  const mirror = host.getByRole('checkbox', { name: /Camera faces the crowd/ });
  await expect(mirror).toHaveAccessibleDescription(/camera looks back at the crowd from the front.*flipped left to right/i);
  await host.getByRole('tab', { name: /Photo & cards/ }).click();
  const record = host.getByRole('checkbox', { name: /Record the moment/ });
  await expect(record).toHaveAccessibleDescription(/films the crowd for the flip and a few seconds after.*stays on this computer/i);
  await expect(host.locator('.record .note').first()).toBeVisible();
  expect(errors).toEqual([]);
});
