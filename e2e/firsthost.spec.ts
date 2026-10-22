// What a first-time host runs into: messages they can't miss, controls that say why they're off, and a page a screen reader can navigate.
import { expect, test, type Page } from '@playwright/test';
import { joinPhone, openHost, wav } from './room';

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
    await host.getByRole('tab', { name: /Card stunt/ }).click();
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
    // Card stunt is the tallest panel: the one that used to stretch the map away from its tray.
    await host.getByRole('tab', { name: /Card stunt/ }).click();
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
  await expect(host.locator('.count')).toContainText('0 on the map');
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

test('Big screen, Show and Live screen each point to Card stunt, and Card stunt says it spreads your photo', async ({ context }) => {
  const errors: string[] = [];
  const { host } = await openHost(context, errors);
  await host.setViewportSize({ width: 1280, height: 800 });
  for (const tab of [/Big screen/, /Show/, /Live screen/]) {
    await host.getByRole('tab', { name: tab }).click();
    const go = host.getByRole('tabpanel').getByRole('button', { name: 'Go to Card stunt' });
    await expect(go).toBeVisible();
    expect(await inViewport(host, '[role=tabpanel] .pointer button')).toBe(true);
    await expect(host.getByRole('tabpanel').locator('.pointer')).toContainText(/one photo.*each.*its own piece/i);
    await go.click();
    await expect(host.getByRole('tab', { name: /Card stunt/ })).toHaveAttribute('aria-selected', 'true');
    await expect(host.locator('.panel-intro').first()).toContainText(/your photo/i);
  }
  // Show no longer promises pictures it cannot do.
  await host.getByRole('tab', { name: /Show/ }).click();
  await expect(host.locator('.panel-intro').first()).not.toContainText(/pictures on every phone/i);
  await expect(host.locator('.panel-intro').first()).toContainText(/cannot show your own photo/i);
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

test('every control on the Music and Card stunt panels shows a focus ring, the song picker included', async ({ context }) => {
  const { host } = await openHost(context, []);
  await host.setViewportSize({ width: 1280, height: 800 });
  for (const tab of [/Music/, /Card stunt/]) {
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
  for (const tab of [/Locate/, /Music/, /Poll/, /Show/, /Card stunt/]) {
    await host.getByRole('tab', { name: tab }).click();
    expect(await small(), String(tab)).toEqual([]);
  }
  expect(await host.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});
