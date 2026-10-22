// The outside judge: instead of the synthetic camera, the host uses its REAL camera code
// path (getUserMedia, <video>, downscale, decode) fed by Chrome's fake camera, playing a
// video of a room rendered here with the things real cameras do: perspective, defocus
// blur, screen glare, rolling shutter, sensor noise, vignetting, a flickering lamp and
// auto-exposure drift. Phones far from the camera are only a few pixels tall.
import { mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { expect, test } from '@playwright/test';
import { DEFAULT_HALF_MS as HALF_MS, HALVES_PER_CODE, encodeHalves } from '../src/core/blinkcode';
import { CHROME_PATH, FAKE_MEDIA, openHost } from './room';

const W = 480;
const H = 360;
const FPS = 25;
// One blink loop is 84 frames exactly.
const FRAMES = (HALVES_PER_CODE * HALF_MS * FPS) / 1000;

interface Phone {
  id: number;
  /** Metres: x across the room, z away from the camera. */
  x: number;
  z: number;
}

// 12 phones on tables spread over a 4 m x 6 m area, 3 m to 9 m from the camera.
const PHONES: Phone[] = Array.from({ length: 12 }, (_, id) => ({
  id,
  x: -1.7 + (id % 4) * 1.1 + (id % 3) * 0.15,
  z: 3 + Math.floor(id / 4) * 2.9 + (id % 2) * 0.3,
}));

const CAM_HEIGHT = 1.9; // metres above the phones
const TILT = (16 * Math.PI) / 180; // looking down
const F = 360; // focal length, px

function project(x: number, y: number, z: number): [number, number] {
  // Camera at (0, CAM_HEIGHT, 0) pitched down by TILT.
  const dy = y - CAM_HEIGHT;
  const zc = z * Math.cos(TILT) - dy * Math.sin(TILT);
  const yc = z * Math.sin(TILT) + dy * Math.cos(TILT);
  return [W / 2 + (F * x) / zc, H / 2 - (F * yc) / zc];
}

/** Where each phone's screen centre lands in the frame (normalised): the answer key. */
const TRUTH = PHONES.map((p) => {
  const [u, v] = project(p.x, 0.08, p.z);
  return { id: p.id, x: u / W, y: v / H };
});

function renderVideo(path: string) {
  const header = Buffer.from(`YUV4MPEG2 W${W} H${H} F${FPS}:1 Ip A1:1 C420jpeg\n`);
  const chroma = Buffer.alloc((W / 2) * (H / 2) * 2, 128);
  const codes = PHONES.map((p) => encodeHalves(p.id));
  let seed = 7;
  const rand = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  const gauss = () => Math.sqrt(-2 * Math.log(rand() || 1e-9)) * Math.cos(2 * Math.PI * rand());
  const parts: Buffer[] = [header];
  const img = new Float32Array(W * H);
  const tmp = new Float32Array(W * H);
  for (let f = 0; f < FRAMES; f++) {
    // Dim room with a brighter back wall and a floor gradient.
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) img[y * W + x] = y < H * 0.3 ? 46 : 30 + (y / H) * 18;
    for (const [i, p] of PHONES.entries()) {
      const [u0, v0] = project(p.x - 0.035, 0.155, p.z);
      const [u1, v1] = project(p.x + 0.035, 0.005, p.z);
      for (let y = Math.floor(v0); y <= Math.ceil(v1); y++) {
        // Rolling shutter: each row is exposed a little later than the one above.
        const t = (f * 1000) / FPS + (y / H) * 22;
        const lit = codes[i][Math.floor(t / HALF_MS) % HALVES_PER_CODE] === 1;
        const level = lit ? 235 : 52;
        for (let x = Math.floor(u0); x <= Math.ceil(u1); x++) {
          if (x < 0 || y < 0 || x >= W || y >= H) continue;
          // Partial coverage at the edges of tiny far-away screens.
          const cx = Math.max(0, Math.min(1, x + 1 - u0, u1 - x));
          const cy = Math.max(0, Math.min(1, y + 1 - v0, v1 - y));
          const k = cx * cy;
          img[y * W + x] = img[y * W + x] * (1 - k) + level * k;
        }
        // Glare: a lit screen bleeds light around it.
        if (lit)
          for (let gy = -4; gy <= 4; gy++)
            for (let gx = -4; gx <= 4; gx++) {
              const yy = y + gy;
              const xx = Math.round((u0 + u1) / 2) + gx;
              if (xx >= 0 && yy >= 0 && xx < W && yy < H) img[yy * W + xx] += 5 * Math.exp(-(gx * gx + gy * gy) / 8);
            }
      }
    }
    // A lamp on the back wall flickering at mains frequency, aliased by the frame rate.
    const lamp = 140 + 90 * Math.sin(f * 2.1);
    for (let y = 20; y < 44; y++) for (let x = 400; x < 418; x++) img[y * W + x] = lamp;
    // Defocus: two box-blur passes.
    for (let pass = 0; pass < 2; pass++) {
      for (let y = 1; y < H - 1; y++)
        for (let x = 1; x < W - 1; x++) {
          let s = 0;
          for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) s += img[(y + dy) * W + x + dx];
          tmp[y * W + x] = s / 9;
        }
      img.set(tmp);
    }
    const exposure = 0.85 + 0.15 * Math.sin(f / 13);
    const y4 = Buffer.alloc(W * H);
    for (let y = 0; y < H; y++)
      for (let x = 0; x < W; x++) {
        const r2 = ((x - W / 2) / W) ** 2 + ((y - H / 2) / H) ** 2;
        const vignette = 1 - 0.8 * r2;
        y4[y * W + x] = Math.max(0, Math.min(255, img[y * W + x] * exposure * vignette + gauss() * 4));
      }
    parts.push(Buffer.from('FRAME\n'), y4, chroma);
  }
  writeFileSync(path, Buffer.concat(parts));
}

// Outside test-results: Playwright empties that folder when a run starts.
const dir = resolve(tmpdir(), 'swarm-screen-e2e');
const video = resolve(dir, 'room.y4m');
mkdirSync(dir, { recursive: true });
renderVideo(video);

test.use({
  launchOptions: {
    executablePath: CHROME_PATH,
    args: [...FAKE_MEDIA, `--use-file-for-fake-video-capture=${video}`],
  },
  permissions: ['camera'],
});

test('the real camera pipeline locates 12 phones in a rendered room', async ({ context }) => {
  test.setTimeout(120_000);
  const errors: string[] = [];
  const { host, code } = await openHost(context, errors);
  // Twelve phones join so seats 0-11 exist; the video is what the camera sees.
  for (const p of PHONES) {
    const ph = await context.newPage();
    // Headless Chrome rasterises every tab in software; keep the phone tabs tiny so they don't starve the host.
    await ph.setViewportSize({ width: 120, height: 200 });
    await ph.goto(`./?room=${code}&transport=local&sim=${p.id},0`);
    await ph.getByRole('button', { name: 'Join the swarm' }).click();
    await expect(ph.locator('.status')).toContainText(`Seat ${p.id + 1}`);
  }
  await expect(host.locator('.count')).toContainText('12 phones');
  await host.bringToFront();
  await host.getByRole('button', { name: 'Start camera' }).click();
  await expect(host.locator('.cam-view video')).toBeVisible();
  await host.getByRole('button', { name: 'Scan the room' }).click();
  await expect(host.locator('.result')).toContainText('Placed 12 of 12 phones', { timeout: 60_000 });
  await host.screenshot({ path: 'test-results/host-real-camera.png' });
  for (const t of TRUTH) {
    const row = host.locator(`tr[data-seat="${t.id}"]`);
    const x = Number(await row.getAttribute('data-raw-x'));
    const y = Number(await row.getAttribute('data-raw-y'));
    expect(Math.abs(x - t.x), `phone ${t.id} x`).toBeLessThan(0.015);
    expect(Math.abs(y - t.y), `phone ${t.id} y`).toBeLessThan(0.02);
  }

  // Perspective: click the corners of the seating area; the map should become a true floor plan.
  const AREA = { x0: -1.8, x1: 1.8, z0: 3, z1: 9 };
  await host.getByText('Camera at an angle? Correct perspective').click();
  await host.locator('#area-w').fill(String(AREA.x1 - AREA.x0));
  await host.locator('#area-d').fill(String(AREA.z1 - AREA.z0));
  await host.getByRole('button', { name: 'Correct perspective' }).click();
  const box = (await host.locator('.cam-overlay').boundingBox())!;
  const pw = Math.min(box.width, (box.height * W) / H);
  const ph = (pw * H) / W;
  for (const [x, z] of [[AREA.x0, AREA.z1], [AREA.x1, AREA.z1], [AREA.x1, AREA.z0], [AREA.x0, AREA.z0]]) {
    const [u, v] = project(x, 0.08, z);
    await host.mouse.click(box.x + (box.width - pw) / 2 + (u / W) * pw, box.y + (box.height - ph) / 2 + (v / H) * ph);
  }
  await expect(host.getByText('Perspective corrected')).toBeVisible();
  await host.screenshot({ path: 'test-results/host-perspective.png' });
  const xs = PHONES.map((p) => p.x);
  const zs = PHONES.map((p) => p.z);
  for (const p of PHONES) {
    const row = host.locator(`tr[data-seat="${p.id}"]`);
    const fx = (p.x - Math.min(...xs)) / (Math.max(...xs) - Math.min(...xs));
    const fy = (Math.max(...zs) - p.z) / (Math.max(...zs) - Math.min(...zs));
    expect(Math.abs(Number(await row.getAttribute('data-x')) - fx), `phone ${p.id} floor x`).toBeLessThan(0.04);
    expect(Math.abs(Number(await row.getAttribute('data-y')) - fy), `phone ${p.id} floor y`).toBeLessThan(0.04);
  }
  expect(errors).toEqual([]);
});
