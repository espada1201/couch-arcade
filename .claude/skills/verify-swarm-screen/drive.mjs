#!/usr/bin/env node
// Drives the REAL Swarm Screen build: `npm start` (built app + LAN relay) on a free port in
// 4550-4560, a host tab and phone tabs in Chromium. Every check is one command; see SKILL.md.
//   node .claude/skills/verify-swarm-screen/drive.mjs [options] <check> [<check> ...]
//   node .claude/skills/verify-swarm-screen/drive.mjs play-song ~/song.mp3
import { spawn, execSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync, appendFileSync, statSync } from 'node:fs';
import { createServer } from 'node:net';
import { basename, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium, expect } from '@playwright/test';
import WebSocket from 'ws';
import { CHROME_PATH, QUADRANTS_PNG, QUADRANT_COLOURS_BY_SIM, SIMS, bg, pictureSpread, scan, wav } from '../../../e2e/room.ts';
import { DEFAULT_HALF_MS, HALVES_PER_CODE, encodeHalves } from '../../../src/core/blinkcode.ts';
import { POLL_COLORS } from '../../../src/core/poll.ts';

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
const PORTS = [4550, 4560];

// ---------- options ----------
const argv = process.argv.slice(2);
const opt = { transport: 'lan', out: resolve(process.env.VERIFY_OUT ?? '/tmp/verify-swarm-screen'), headed: false, port: 0, url: '' };
const queue = [];
for (let i = 0; i < argv.length; i++) {
  const a = argv[i];
  if (a === '--transport') opt.transport = argv[++i];
  else if (a === '--out') opt.out = resolve(argv[++i]);
  else if (a === '--port') opt.port = Number(argv[++i]);
  else if (a === '--url') opt.url = argv[++i].replace(/\/?$/, '/');
  else if (a === '--headed') opt.headed = true;
  else queue.push(a);
}
mkdirSync(opt.out, { recursive: true });
const log = (...m) => console.log(`[drive] ${m.join(' ')}`);

// ---------- server ----------
const canListen = (port) =>
  new Promise((res) => {
    const s = createServer();
    s.once('error', () => res(false));
    s.listen(port, () => s.close(() => res(true)));
  });

async function freePort() {
  for (let p = PORTS[0]; p <= PORTS[1]; p++) if (await canListen(p)) return p;
  throw new Error(`no free port in ${PORTS.join('-')}`);
}

let server = null; // { pid, port, url }

/** `npm start` on a free port; ready = startup line printed AND / and /relay.json answer. */
async function launch(fixed = 0) {
  const port = fixed || opt.port || (await freePort());
  const logFile = resolve(opt.out, 'server.log');
  writeFileSync(logFile, '');
  const child = spawn('npm', ['start'], { cwd: REPO, env: { ...process.env, PORT: String(port) }, detached: true, stdio: ['ignore', 'pipe', 'pipe'] });
  child.stdout.on('data', (d) => appendFileSync(logFile, d));
  child.stderr.on('data', (d) => appendFileSync(logFile, d));
  writeFileSync(resolve(opt.out, 'server.pid'), `${child.pid} ${port}\n`);
  server = { pid: child.pid, port, url: `http://localhost:${port}/` };
  const t0 = Date.now();
  while (Date.now() - t0 < 180_000) {
    if (child.exitCode !== null) throw new Error(`npm start exited ${child.exitCode}; see ${logFile}`);
    if (readFileSync(logFile, 'utf8').includes('Swarm Screen is running')) {
      const r = await fetch(`${server.url}relay.json`).catch(() => null);
      if (r?.ok) {
        log(`server ready ${server.url} (pgid ${child.pid}) in ${Math.round((Date.now() - t0) / 1000)} s`);
        return server;
      }
    }
    await new Promise((r) => setTimeout(r, 300));
  }
  throw new Error('server not ready after 180 s');
}

function stopServer() {
  if (!server) return;
  try {
    process.kill(-server.pid, 'SIGTERM'); // the process group we spawned: npm -> sh -> node
  } catch {}
  server = null;
}

const base = () => opt.url || server.url;

// ---------- browser + room ----------
const BASE_ARGS = ['--autoplay-policy=no-user-gesture-required', '--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream', '--auto-select-desktop-capture-source=Entire screen',
  // The room is all on this machine/LAN; an agent proxy in the environment would 403 the LAN-address WebSocket.
  '--no-proxy-server',
];

class Run {
  constructor(name) {
    this.name = name;
    this.dir = resolve(opt.out, name);
    mkdirSync(this.dir, { recursive: true });
    this.status = 'PASS';
    this.notes = [];
    this.readings = {};
    this.errors = [];
    this.allowErrors = /$^/;
    this.browsers = [];
  }
  note(k, v) {
    this.readings[k] = v;
    log(`${this.name}: ${k} = ${typeof v === 'string' ? v : JSON.stringify(v)}`);
  }
  issue(why) {
    this.status = 'ISSUES';
    this.notes.push(why);
    log(`${this.name}: ISSUE ${why}`);
  }
  inconclusive(why) {
    if (this.status === 'PASS') this.status = 'INCONCLUSIVE';
    this.notes.push(why);
    log(`${this.name}: INCONCLUSIVE ${why}`);
  }
  async shot(page, name) {
    await page.screenshot({ path: resolve(this.dir, `${name}.png`) }).catch(() => {});
  }
  watch(page) {
    page.on('console', (m) => m.type() === 'error' && !this.allowErrors.test(m.text()) && this.errors.push(`${page.url()}: ${m.text()}`));
    page.on('pageerror', (e) => this.errors.push(`${page.url()}: ${e.message}`));
  }
  async browser(args = [], init) {
    const b = await chromium.launch({ headless: !opt.headed, executablePath: CHROME_PATH, args: [...BASE_ARGS, ...args] });
    this.browsers.push(b);
    const context = await b.newContext({ baseURL: base(), permissions: ['camera', 'microphone'], acceptDownloads: true });
    if (init) await context.addInitScript(init);
    return context;
  }
  async close() {
    for (const b of this.browsers) await b.close().catch(() => {});
  }
}

const q = (o) => new URLSearchParams(Object.entries(o).filter(([, v]) => v !== null && v !== undefined)).toString();
const seatOf = async (p) => Number((await p.locator('.status').textContent()).match(/Seat (\d+)/)[1]) - 1;
/** How the relay answers a WebSocket to `url`: the refusal's HTTP status, 'open', or the error. */
const wsStatus = (url) =>
  new Promise((res) => {
    const ws = new WebSocket(url);
    ws.on('unexpected-response', (_req, r) => res(r.statusCode));
    ws.on('open', () => (ws.close(), res('open')));
    ws.on('error', (e) => res(`error ${e.message}`));
  });

/**
 * A host tab and one phone tab per `sims` entry, all joined. `camera: 'synthetic'` films the
 * phone tabs (BroadcastChannel); 'real' uses getUserMedia. `transport: null` lets the app pick.
 */
async function openRoom(run, { sims = SIMS, transport = opt.transport, camera = 'synthetic', args = [], init, phone = { width: 390, height: 844 } } = {}) {
  const context = await run.browser(args, init);
  const host = await context.newPage();
  run.watch(host);
  await host.setViewportSize({ width: 1440, height: 900 });
  await host.goto(`./?${q({ host: 1, transport, camera: camera === 'synthetic' ? 'synthetic' : null, fresh: 1 })}`);
  const code = await host.locator('[data-room]').getAttribute('data-room');
  const room = { context, host, code, phones: [], seats: [], transport };
  room.addPhone = async (sim, url) => {
    const p = await context.newPage();
    run.watch(p);
    await p.setViewportSize(phone);
    await p.goto(url ?? `./?${q({ room: code, transport, sim: sim.join() })}`);
    await p.getByRole('button', { name: 'Join the swarm' }).click();
    await expect(p.locator('.status')).toContainText('Seat', { timeout: 15_000 });
    room.phones.push(p);
    room.seats.push(await seatOf(p));
    return p;
  };
  for (const s of sims) await room.addPhone(s);
  await expect(host.locator('.count')).toHaveText(new RegExp(`^${sims.length} phones? `), { timeout: 15_000 });
  return room;
}

const tab = (room, name) => room.host.getByRole('tab', { name: new RegExp(name) }).click();
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Records when every Web Audio source on the page is told to start, as wall-clock ms. */
const AUDIO_TAP = () => {
  window.__starts = [];
  const orig = AudioScheduledSourceNode.prototype.start;
  AudioScheduledSourceNode.prototype.start = function (when = 0, ...rest) {
    const ctx = this.context;
    window.__starts.push({ type: this.constructor.name, at: performance.timeOrigin + performance.now() + (Math.max(when, ctx.currentTime) - ctx.currentTime) * 1000 });
    return orig.call(this, when, ...rest);
  };
};

/** Start logging every change of a phone's colour and label, in wall-clock ms. */
const watchScreens = (phones) =>
  Promise.all(
    phones.map((p) =>
      p.evaluate(() => {
        window.__screen = [];
        const s = document.querySelector('.screen');
        const l = document.querySelector('.label');
        const log = () => window.__screen.push({ t: performance.timeOrigin + performance.now(), bg: s.style.backgroundColor, label: l.textContent });
        new MutationObserver(log).observe(s, { attributes: true, attributeFilter: ['style'], subtree: true, childList: true, characterData: true });
        log();
      }),
    ),
  );
/** Per phone, when the countdown's last number gave way to the card (ms after the earliest), or null. */
async function flipMoments(phones) {
  const logs = await Promise.all(phones.map((p) => p.evaluate(() => window.__screen)));
  // Phones show their seat number until the countdown starts, so look only after the "3".
  const at = logs.map((log) => {
    const start = log.findIndex((e) => e.label === '3');
    return start < 0 ? null : (log.find((e, i) => i > start && e.label === '' && log[i - 1].label === '1')?.t ?? null);
  });
  const t0 = Math.min(...at.filter((x) => x !== null));
  return at.map((t) => (t === null ? null : Math.round(t - t0)));
}

/** Distinct colours a phone shows over `ms`. */
async function colours(p, ms = 1500, step = 150) {
  const seen = new Set();
  for (let t = 0; t < ms; t += step) {
    seen.add((await bg(p)).join());
    await sleep(step);
  }
  return seen;
}

// ---------- real-camera room video (Chrome's fake camera plays it) ----------
const CAM = { W: 480, H: 360, FPS: 25, HALF_MS: DEFAULT_HALF_MS, HEIGHT: 1.9, TILT: (16 * Math.PI) / 180, F: 360 };
const CAM_PHONES = Array.from({ length: 9 }, (_, id) => ({ id, x: -1.5 + (id % 3) * 1.5, z: 3 + Math.floor(id / 3) * 2.8 }));
function project(x, y, z) {
  const dy = y - CAM.HEIGHT;
  const zc = z * Math.cos(CAM.TILT) - dy * Math.sin(CAM.TILT);
  const yc = z * Math.sin(CAM.TILT) + dy * Math.cos(CAM.TILT);
  return [CAM.W / 2 + (CAM.F * x) / zc, CAM.H / 2 - (CAM.F * yc) / zc];
}
/** Perspective room, rolling shutter, blur and noise: phones far back are a few pixels tall. */
function renderRoomVideo(path) {
  const { W, H, FPS, HALF_MS } = CAM;
  const frames = (HALVES_PER_CODE * HALF_MS * FPS) / 1000;
  const codes = CAM_PHONES.map((p) => encodeHalves(p.id));
  const parts = [Buffer.from(`YUV4MPEG2 W${W} H${H} F${FPS}:1 Ip A1:1 C420jpeg\n`)];
  const chroma = Buffer.alloc((W / 2) * (H / 2) * 2, 128);
  const img = new Float32Array(W * H);
  let seed = 7;
  const rand = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  for (let f = 0; f < frames; f++) {
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) img[y * W + x] = y < H * 0.3 ? 46 : 30 + (y / H) * 18;
    for (const [i, p] of CAM_PHONES.entries()) {
      const [u0, v0] = project(p.x - 0.035, 0.155, p.z);
      const [u1, v1] = project(p.x + 0.035, 0.005, p.z);
      for (let y = Math.floor(v0); y <= Math.ceil(v1); y++) {
        const t = (f * 1000) / FPS + (y / H) * 22; // rolling shutter
        const level = codes[i][Math.floor(t / HALF_MS) % HALVES_PER_CODE] ? 235 : 52;
        for (let x = Math.floor(u0); x <= Math.ceil(u1); x++) {
          if (x < 0 || y < 0 || x >= W || y >= H) continue;
          const k = Math.max(0, Math.min(1, x + 1 - u0, u1 - x)) * Math.max(0, Math.min(1, y + 1 - v0, v1 - y));
          img[y * W + x] = img[y * W + x] * (1 - k) + level * k;
        }
      }
    }
    const y4 = Buffer.alloc(W * H);
    for (let y = 0; y < H; y++)
      for (let x = 0; x < W; x++) {
        let s = 0;
        let n = 0;
        for (let dy = -1; dy <= 1; dy++)
          for (let dx = -1; dx <= 1; dx++) {
            const v = img[(y + dy) * W + x + dx];
            if (v !== undefined && x + dx >= 0 && x + dx < W) (s += v), n++;
          }
        y4[y * W + x] = Math.max(0, Math.min(255, (s / n) * (0.9 + 0.1 * Math.sin(f / 13)) + (rand() - 0.5) * 8));
      }
    parts.push(Buffer.from('FRAME\n'), y4, chroma);
  }
  writeFileSync(path, Buffer.concat(parts));
}

// ---------- checks ----------
const CHECKS = {
  async landing(run) {
    const ctx = await run.browser();
    const page = await ctx.newPage();
    run.watch(page);
    await page.goto('./');
    await expect(page.getByRole('heading', { name: /swarm/i })).toBeVisible();
    await run.shot(page, 'landing');
    const href = await page.getByRole('link', { name: 'Host a room' }).getAttribute('href');
    run.note('host link', href);
    const code = page.getByLabel('Joining? Enter the room code');
    await code.fill('AB');
    await page.getByRole('button', { name: 'Join' }).click();
    await expect(code).toHaveAttribute('aria-invalid', 'true');
    await expect(page.getByText('Room codes are 4 letters or numbers')).toBeVisible();
    await run.shot(page, 'landing-invalid');
    await code.fill('abcd');
    await page.getByRole('button', { name: 'Join' }).click();
    await expect(page).toHaveURL(/room=ABCD/);
    await expect(page.getByRole('button', { name: 'Join the swarm' })).toBeVisible();
    await run.shot(page, 'phone-gate');
    await page.goto('./');
    await page.getByRole('link', { name: 'Host a room' }).click();
    await expect(page.locator('[data-room]')).toBeVisible();
    run.note('host badge via landing', await page.locator('.badge').textContent());
    await page.setViewportSize({ width: 390, height: 844 });
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - innerWidth);
    run.note('host console overflow at 390px', overflow);
    if (overflow > 0) run.issue(`host console scrolls sideways by ${overflow}px at 390px`);
    await run.shot(page, 'host-390');
  },

  async lan(run) {
    const info = await (await fetch(`${base()}relay.json`)).json();
    run.note('relay.json lanUrl', info.lanUrl);
    const port = new URL(base()).port;
    expect(new URL(info.lanUrl).port).toBe(port);
    // No ?transport: served by npm start the app must pick the relay itself.
    const room = await openRoom(run, { sims: [], transport: null });
    const { host } = room;
    await expect(host.locator('.badge')).toHaveAttribute('data-transport', 'lan');
    await expect(host.locator('.badge')).toHaveText('Wi-Fi');
    await expect(host.getByRole('img', { name: 'QR code to join this room' })).toBeVisible();
    const joinUrl = await host.locator('.join-url').getAttribute('href');
    run.note('join url', joinUrl);
    expect(joinUrl.startsWith(info.lanUrl)).toBe(true);
    // A phone opens the join URL exactly as the QR code encodes it (LAN address, not localhost).
    const frames = [];
    room.context.on('page', (p) => p.on('websocket', (ws) => (frames.push({ url: ws.url(), n: 0 }), ws.on('framereceived', () => frames.at(-1).n++))));
    const phone = await room.addPhone(null, `${joinUrl}&sim=0.5,0.5`);
    await expect(host.locator('.count')).toHaveText(/^1 phone /);
    await sleep(1500);
    run.note('phone websockets', frames);
    expect(frames.some((f) => /\/relay\?room=\w+&role=phone/.test(f.url) && f.n > 3)).toBe(true);
    await run.shot(host, 'host-lan');
    await run.shot(phone, 'phone-lan');
    // The relay refuses a second host without the room's key, and phones for a room nobody hosts.
    const status = (path) => wsStatus(`${base().replace('http', 'ws')}${path}`);
    run.note('second host, wrong key', await status(`relay?room=${room.code}&role=host&key=wrongkey123`));
    run.note('phone, unknown room', await status('relay?room=ZZZZ9&role=phone'));
    expect(run.readings['second host, wrong key']).toBe(409);
    expect(run.readings['phone, unknown room']).toBe(404);
    // Host leaves: the relay drops the room and the phone says it is reconnecting.
    run.allowErrors = /WebSocket|relay/;
    await host.close();
    await expect(phone.locator('.status')).toContainText(/reconnecting|connecting/, { timeout: 10_000 });
    await run.shot(phone, 'phone-host-left');
  },

  async scan(run) {
    const room = await openRoom(run);
    await scan(room);
    await run.shot(room.host, 'host-located');
    const err = [];
    for (let i = 0; i < SIMS.length; i++) {
      const row = room.host.locator(`tr[data-seat="${room.seats[i]}"]`);
      const dx = Math.abs(Number(await row.getAttribute('data-raw-x')) - SIMS[i][0]);
      const dy = Math.abs(Number(await row.getAttribute('data-raw-y')) - SIMS[i][1]);
      err.push([+dx.toFixed(3), +dy.toFixed(3)]);
      if (dx > 0.025 || dy > 0.035) run.issue(`phone ${i} placed ${dx.toFixed(3)},${dy.toFixed(3)} off`);
      await expect(room.phones[i].locator('.status')).toContainText('placed');
    }
    run.note('position error |dx|,|dy|', err);
    run.note('host count', await room.host.locator('.count').textContent());
    await run.shot(room.phones[0], 'phone-placed');
  },

  async 'real-camera'(run) {
    const video = resolve(opt.out, 'room.y4m');
    if (!existsSync(video)) renderRoomVideo(video);
    const room = await openRoom(run, {
      sims: CAM_PHONES.map((p) => [p.id, 0]),
      camera: 'real',
      args: [`--use-file-for-fake-video-capture=${video}`],
      phone: { width: 120, height: 200 },
    });
    const { host } = room;
    await host.bringToFront();
    await host.getByRole('button', { name: 'Start camera' }).click();
    await expect(host.locator('.cam-view video')).toBeVisible();
    await host.getByRole('button', { name: 'Scan the room' }).click();
    await expect(host.locator('.result')).toContainText(`Placed ${CAM_PHONES.length} of ${CAM_PHONES.length} phones`, { timeout: 60_000 });
    await run.shot(host, 'host-real-camera');
    const err = [];
    for (const p of CAM_PHONES) {
      const [u, v] = project(p.x, 0.08, p.z);
      const row = host.locator(`tr[data-seat="${room.seats[p.id]}"]`);
      const dx = Math.abs(Number(await row.getAttribute('data-raw-x')) - u / CAM.W);
      const dy = Math.abs(Number(await row.getAttribute('data-raw-y')) - v / CAM.H);
      err.push([+dx.toFixed(3), +dy.toFixed(3)]);
      if (dx > 0.015 || dy > 0.02) run.issue(`phone ${p.id} camera position off by ${dx.toFixed(3)},${dy.toFixed(3)}`);
    }
    run.note('camera position error', err);
    // Perspective: click the area's four corners; the map becomes a floor plan.
    const A = { x0: -1.6, x1: 1.6, z0: 3, z1: 8.6 };
    await host.getByText('Camera at an angle? Correct perspective').click();
    await host.locator('#area-w').fill(String(A.x1 - A.x0));
    await host.locator('#area-d').fill(String(A.z1 - A.z0));
    await host.getByRole('button', { name: 'Correct perspective' }).click();
    const box = await host.locator('.cam-overlay').boundingBox();
    const pw = Math.min(box.width, (box.height * CAM.W) / CAM.H);
    const ph = (pw * CAM.H) / CAM.W;
    for (const [x, z] of [[A.x0, A.z1], [A.x1, A.z1], [A.x1, A.z0], [A.x0, A.z0]]) {
      const [u, v] = project(x, 0.08, z);
      await host.mouse.click(box.x + (box.width - pw) / 2 + (u / CAM.W) * pw, box.y + (box.height - ph) / 2 + (v / CAM.H) * ph);
    }
    await expect(host.getByText('Perspective corrected')).toBeVisible();
    await run.shot(host, 'host-perspective');
    const xs = CAM_PHONES.map((p) => p.x);
    const zs = CAM_PHONES.map((p) => p.z);
    const floor = [];
    for (const p of CAM_PHONES) {
      const row = host.locator(`tr[data-seat="${room.seats[p.id]}"]`);
      const fx = (p.x - Math.min(...xs)) / (Math.max(...xs) - Math.min(...xs));
      const fy = (Math.max(...zs) - p.z) / (Math.max(...zs) - Math.min(...zs));
      const ex = Math.abs(Number(await row.getAttribute('data-x')) - fx);
      const ey = Math.abs(Number(await row.getAttribute('data-y')) - fy);
      floor.push([+ex.toFixed(3), +ey.toFixed(3)]);
      if (ex > 0.04 || ey > 0.04) run.issue(`phone ${p.id} floor plan off by ${ex.toFixed(3)},${ey.toFixed(3)}`);
    }
    run.note('floor-plan error', floor);
  },

  async 'seat-grid'(run) {
    const room = await openRoom(run, { sims: [[0.1, 0.1], [0.2, 0.2], [0.3, 0.3], [0.4, 0.4]] });
    const { host, phones } = room;
    await host.getByText('No camera? Use seat numbers').click();
    await host.locator('#grid-rows').fill('2');
    await host.locator('#grid-seats').fill('3');
    await host.getByRole('button', { name: 'Ask phones for their seat' }).click();
    const typed = [[1, 1], [1, 3], [2, 1], [2, 3]];
    for (const [i, p] of phones.entries()) {
      await expect(p.getByRole('heading', { name: 'Where are you sitting?' })).toBeVisible();
      if (i === 0) await run.shot(p, 'phone-seat-form');
      await p.locator('#row').fill(String(typed[i][0]));
      await p.locator('#seatno').fill(String(typed[i][1]));
      await p.getByRole('button', { name: 'Done' }).click();
    }
    await expect(host.getByText('4 of 4 phones have answered.')).toBeVisible();
    await host.getByRole('button', { name: 'Use typed seats' }).click();
    const got = [];
    for (const [i, s] of room.seats.entries()) {
      const row = host.locator(`tr[data-seat="${s}"]`);
      await expect(row).toHaveAttribute('data-source', 'grid');
      got.push([Number(await row.getAttribute('data-x')), Number(await row.getAttribute('data-y'))]);
      await expect(phones[i].locator('.status')).toContainText('placed');
    }
    run.note('typed row,seat', typed);
    run.note('map x,y', got);
    expect(got[0][0]).toBeLessThan(got[1][0]); // seat 1 left of seat 3
    expect(got[0][1]).toBeLessThan(got[2][1]); // row 1 in front of row 2
    await run.shot(host, 'host-grid');
  },

  async drag(run) {
    const room = await openRoom(run, { sims: [[0.1, 0.1], [0.2, 0.2]] });
    const { host } = room;
    const canvas = host.locator('.stage-canvas');
    // Room space -> page pixels: the map is a 16:9 box inside a 28 px (css) pad once placed by hand.
    const toPage = (x, y) =>
      canvas.evaluate((c, [x, y]) => {
        const r = c.getBoundingClientRect();
        const dpr = c.width / r.width;
        const pad = 28 * dpr;
        const w = Math.min(c.width - 2 * pad, (c.height - 2 * pad) * (16 / 9));
        const hh = w / (16 / 9);
        return [r.left + ((c.width - w) / 2 + x * w) / dpr, r.top + ((c.height - hh) / 2 + y * hh) / dpr];
      }, [x, y]);
    const pos = async (seat) => {
      const row = host.locator(`tr[data-seat="${seat}"]`);
      return [Number(await row.getAttribute('data-x')), Number(await row.getAttribute('data-y'))];
    };
    const [s0, s1] = room.seats;
    await expect(host.getByRole('group', { name: 'Phones not placed yet' })).toBeVisible();
    await host.locator('.tray .chip', { hasText: String(s0 + 1) }).click();
    const [cx, cy] = await toPage(0.3, 0.5);
    await host.mouse.click(cx, cy);
    await expect(host.locator(`tr[data-seat="${s0}"]`)).toHaveAttribute('data-source', 'manual');
    const placed = await pos(s0);
    run.note('tap-to-place at 0.30,0.50 ->', placed);
    expect(Math.abs(placed[0] - 0.3)).toBeLessThan(0.03);
    // Drag it to the right.
    const [tx, ty] = await toPage(0.7, 0.4);
    await host.mouse.move(cx, cy);
    await host.mouse.down();
    await host.mouse.move((cx + tx) / 2, (cy + ty) / 2, { steps: 5 });
    await host.mouse.move(tx, ty, { steps: 5 });
    await host.mouse.up();
    await expect.poll(async () => (await pos(s0))[0]).toBeGreaterThan(0.6);
    run.note('after drag to 0.70,0.40', await pos(s0));
    // Second phone from the tray, then keyboard: ] picks a phone, Shift+arrow nudges by 0.1.
    await host.locator('.tray .chip', { hasText: String(s1 + 1) }).click();
    const [bx, by] = await toPage(0.2, 0.8);
    await host.mouse.click(bx, by);
    await expect(host.locator(`tr[data-seat="${s1}"]`)).toHaveAttribute('data-source', 'manual');
    await canvas.focus();
    await host.keyboard.press(']');
    const picked = (await host.locator('.stage').textContent()).match(/Phone (\d+) picked/)?.[1];
    run.note('] picked phone', picked);
    const seat = Number(picked) - 1;
    const before = await pos(seat);
    await host.keyboard.press('Shift+ArrowLeft');
    await expect.poll(async () => (await pos(seat))[0]).toBeLessThan(before[0] - 0.08);
    run.note('Shift+ArrowLeft moved', [before, await pos(seat)]);
    await expect(room.phones[0].locator('.status')).toContainText('placed');
    await run.shot(host, 'host-manual');
  },

  async 'play-song'(run, file) {
    const song = file ? { name: basename(file), mimeType: '', buffer: readFileSync(file) } : { name: 'Test Tone.wav', mimeType: 'audio/wav', buffer: wav(12) };
    run.note('song', `${song.name} (${Math.round(song.buffer.length / 1024)} KB)`);
    const room = await openRoom(run, { sims: [[0.1, 0.5], [0.2, 0.5], [0.3, 0.5]] });
    const { host, phones } = room;
    await tab(room, 'Music');
    await expect(host.getByRole('radio', { name: 'Party speaker' })).toBeChecked();
    await host.locator('#speaker-file').setInputFiles(song);
    await expect(host.getByText('3 of 3 phones ready')).toBeVisible({ timeout: 60_000 });
    const title = song.name.replace(/\.[^.]+$/, '');
    for (const p of phones) await expect(p.locator('.np-title')).toHaveText(title);
    await run.shot(host, 'host-ready');
    await host.getByRole('button', { name: 'Play', exact: true }).click();
    for (const p of phones) await expect(p.locator('.nowplaying')).toHaveAttribute('data-state', 'playing', { timeout: 5000 });
    const anchors = () => Promise.all(phones.map(async (p) => Number(await p.locator('.nowplaying').getAttribute('data-anchor'))));
    await expect.poll(async () => (await anchors()).every(Number.isFinite)).toBe(true);
    const a = await anchors();
    const spread = Math.max(...a) - Math.min(...a);
    run.note('anchor spread ms', +spread.toFixed(1));
    if (spread >= 50) run.issue(`phones ${spread.toFixed(0)} ms apart`);
    const p0 = Number(await phones[0].locator('.nowplaying').getAttribute('data-pos'));
    await sleep(1000);
    const p1 = Number(await phones[0].locator('.nowplaying').getAttribute('data-pos'));
    run.note('position advance in 1 s', +(p1 - p0).toFixed(2));
    expect(p1 - p0).toBeGreaterThan(0.5);
    await run.shot(phones[1], 'phone-playing');
    // Late joiner falls in step.
    const late = await room.addPhone([0.4, 0.5]);
    await expect(host.getByText(/4 of 4 phones ready/)).toBeVisible({ timeout: 60_000 });
    await expect(late.locator('.nowplaying')).toHaveAttribute('data-state', 'playing', { timeout: 5000 });
    await expect.poll(async () => { const x = await anchors(); return Math.max(...x) - Math.min(...x); }, { timeout: 10_000 }).toBeLessThan(50);
    run.note('late joiner in step', true);
    await host.getByRole('button', { name: 'Pause' }).click();
    for (const p of phones) await expect(p.locator('.np-state')).toHaveText('Paused', { timeout: 3000 });
    await run.shot(host, 'host-paused');
  },

  async tones(run) {
    const room = await openRoom(run, { sims: [[0.15, 0.5], [0.5, 0.5], [0.85, 0.5]], init: AUDIO_TAP });
    await scan(room);
    await tab(room, 'Music');
    await room.host.getByRole('radio', { name: 'Spatial tones' }).check();
    for (const p of room.phones) await p.evaluate(() => (window.__starts.length = 0));
    await room.host.getByRole('button', { name: 'Play', exact: true }).click();
    await expect(room.host.getByText(/Playing Pluck sweep/)).toBeVisible();
    await sleep(3500);
    const starts = await Promise.all(room.phones.map((p) => p.evaluate(() => window.__starts.map((s) => s.at))));
    const t0 = Math.min(...starts.flat());
    run.note('notes scheduled per phone', starts.map((s) => s.length));
    run.note('first note ms (left, centre, right)', starts.map((s) => Math.round(Math.min(...s) - t0)));
    if (starts.some((s) => !s.length)) throw new Error('a phone scheduled no notes');
    const first = starts.map((s) => Math.min(...s));
    expect(first[0]).toBeLessThan(first[1]);
    expect(first[1]).toBeLessThan(first[2]);
    await run.shot(room.host, 'host-tones');
    await room.host.getByRole('button', { name: 'Stop' }).first().click();
  },

  async cards(run) {
    const room = await openRoom(run, { sims: [[0.1, 0.5], [0.2, 0.5], [0.3, 0.5]] });
    const { host, phones } = room;
    await tab(room, 'Big screen');
    await host.getByRole('button', { name: 'Show on phones' }).click();
    await expect(host.getByText('Type at least one line first.')).toBeVisible();
    await host.getByLabel(/Cards, one per line/).fill('Happy birthday, Sam\nDinner at 7\n\nSpeeches at 8');
    await host.getByRole('button', { name: 'Show on phones' }).click();
    for (const p of phones) await expect(p.locator('.follow-text')).toHaveText('Happy birthday, Sam');
    await host.getByRole('button', { name: 'Next card' }).click();
    for (const p of phones) await expect(p.locator('.follow-text')).toHaveText('Dinner at 7');
    await host.locator('body').click({ position: { x: 5, y: 5 } });
    await host.keyboard.press('ArrowRight');
    for (const p of phones) await expect(p.locator('.follow-text')).toHaveText('Speeches at 8');
    await host.keyboard.press('PageUp');
    await expect(phones[1].locator('.follow-text')).toHaveText('Dinner at 7');
    run.note('phone font px', await phones[0].locator('.follow-text').evaluate((el) => parseFloat(getComputedStyle(el).fontSize)));
    const late = await room.addPhone([0.4, 0.5]);
    await expect(late.locator('.follow-text')).toHaveText('Dinner at 7');
    await run.shot(phones[0], 'phone-card');
    await run.shot(host, 'host-cards');
    await host.getByRole('button', { name: 'Stop' }).last().click();
    await expect(phones[0].locator('.follow')).toBeHidden();
  },

  async camera(run) {
    await followPicture(run, 'Camera', /Showing the camera on 2 phones/, 20);
  },

  async 'screen-share'(run) {
    await followPicture(run, 'Share my screen', /Showing your screen on 2 phones/, 0);
  },

  async captions(run) {
    // 1) The real recogniser, as a host would use it.
    let room = await openRoom(run, { sims: [[0.1, 0.5], [0.2, 0.5]] });
    await tab(room, 'Big screen');
    const radio = room.host.getByRole('radio', { name: 'Live captions' });
    if (!(await radio.count())) run.inconclusive('this Chromium has no SpeechRecognition, so the Live captions source is hidden');
    else {
      await radio.check();
      await room.host.getByRole('button', { name: 'Show on phones' }).click();
      await sleep(6000);
      const said = await room.host.locator('.panel-body > .note[role=status]').last().textContent();
      run.note('host status with real recogniser', said);
      run.inconclusive('headless: no microphone speech and no speech service, so real captions cannot be proven here');
    }
    await room.context.browser().close();
    // 2) Same path with the browser recogniser replaced at its boundary: phones must show the words.
    room = await openRoom(run, {
      sims: [[0.1, 0.5], [0.2, 0.5]],
      init: () => {
        window.SpeechRecognition = class {
          start() {
            const say = (text, isFinal, d) => setTimeout(() => this.onresult?.({ resultIndex: 0, results: [Object.assign([{ transcript: text }], { isFinal })] }), d);
            say('welcome every', false, 300);
            say('welcome everyone to the party', true, 900);
          }
          stop() {}
        };
      },
    });
    await tab(room, 'Big screen');
    await room.host.getByRole('radio', { name: 'Live captions' }).check();
    await room.host.getByRole('button', { name: 'Show on phones' }).click();
    for (const p of room.phones) await expect(p.locator('.follow-text')).toContainText('welcome everyone to the party', { timeout: 5000 });
    run.note('phones show stubbed-recogniser captions', true);
    await run.shot(room.phones[0], 'phone-captions-stub');
  },

  async poll(run) {
    const room = await openRoom(run, { sims: [[0.2, 0.5], [0.5, 0.5], [0.8, 0.5]] });
    await scan(room);
    const { host, phones } = room;
    await tab(room, 'Poll');
    await host.getByLabel('Question').fill('Pizza or tacos?');
    await host.getByLabel('Answer A').fill('Pizza');
    await host.getByLabel('Answer B').fill('Tacos');
    await host.getByLabel(/Anonymous/).uncheck();
    await host.getByRole('button', { name: 'Start the poll' }).click();
    for (const p of phones) await expect(p.getByRole('heading', { name: 'Pizza or tacos?' })).toBeVisible();
    await phones[0].getByRole('button', { name: /Pizza/ }).click();
    await phones[0].getByRole('button', { name: /Tacos/ }).click();
    await phones[1].getByRole('button', { name: /Pizza/ }).click();
    await phones[2].getByRole('button', { name: /Pizza/ }).click();
    await run.shot(phones[0], 'phone-ballot');
    const bar = (n) => host.locator('.poll-bar', { hasText: n }).locator('.poll-num');
    await expect(bar('Pizza')).toHaveText('2 votes · 67%');
    await expect(bar('Tacos')).toHaveText('1 vote · 33%');
    await host.getByRole('button', { name: 'Close voting' }).click();
    await expect(phones[2].getByRole('button', { name: /Tacos/ })).toBeDisabled();
    await host.getByRole('button', { name: 'Reveal' }).click();
    await expect.poll(() => bg(phones[0])).toEqual(POLL_COLORS[0]);
    await expect.poll(() => bg(phones[2])).toEqual(POLL_COLORS[1]);
    await expect(phones[2].locator('.you-voted')).toHaveText('You voted A');
    run.note('reveal labels', await Promise.all(phones.map((p) => p.locator('.label').textContent())));
    await run.shot(host, 'host-reveal');
    await run.shot(phones[1], 'phone-reveal');
    await host.getByLabel(/Anonymous/).check();
    await host.getByRole('button', { name: 'Reopen voting' }).click();
    await expect(bar('Pizza')).toHaveText('hidden');
  },

  async show(run) {
    const room = await openRoom(run, { sims: [[0.2, 0.4], [0.5, 0.6], [0.8, 0.4]] });
    await scan(room);
    const { host, phones } = room;
    await tab(room, 'Show');
    await host.locator('#show-title').fill('HI');
    await watchScreens(phones);
    await host.getByRole('button', { name: 'Start the show' }).click();
    await expect(host.locator('.score')).toContainText('Now: Title card');
    await sleep(4000);
    const flips = await flipMoments(phones);
    run.note('title card flip per phone, ms after the first', flips);
    if (flips.includes(null) || Math.max(...flips) > 150) run.issue(`title card did not flip together: ${flips.join(', ')}`);
    await expect(host.locator('.score')).toContainText('Now: Amber sweep', { timeout: 9000 });
    run.note('cue after 6.5 s', await host.locator('.score').textContent());
    await run.shot(host, 'host-show');
    await host.getByRole('button', { name: 'Stop' }).click();
    await expect(host.locator('.score')).toHaveText('Stopped.');
  },

  async countdown(run) {
    // Unplaced phones: the countdown is meant to run without a scan.
    const room = await openRoom(run, { sims: [[0.2, 0.4], [0.5, 0.6], [0.8, 0.4]] });
    const { host, phones } = room;
    await tab(room, 'Show');
    await host.getByLabel('Record the moment with this computer’s camera').check();
    await host.getByRole('button', { name: 'New Year countdown' }).click();
    await expect(host.getByText('● Recording the moment…')).toBeVisible();
    await expect(phones[0].locator('.label')).toHaveText(/^(10|9|8)$/, { timeout: 4000 });
    let same = null;
    for (let i = 0; i < 6 && !same; i++) {
      const l = await Promise.all(phones.map((p) => p.locator('.label').textContent()));
      if (l.every((x) => x === l[0]) && /^\d+$/.test(l[0])) same = l;
    }
    run.note('labels read together', same);
    if (!same) run.issue('phones never showed the same number at the same read');
    await run.shot(phones[1], 'phone-countdown');
    const year = String(new Date().getFullYear() + (new Date().getMonth() >= 6 ? 1 : 0));
    for (const p of phones) await expect(p.locator('.label')).toHaveText(year, { timeout: 14_000 });
    run.note('burst brightness', (await bg(phones[1])).reduce((a, b) => a + b));
    await run.shot(phones[1], 'phone-year');
    const link = host.getByRole('link', { name: /Download the keepsake/ });
    await expect(link).toBeVisible({ timeout: 15_000 });
    const [dl] = await Promise.all([host.waitForEvent('download'), link.click()]);
    const saved = resolve(run.dir, dl.suggestedFilename());
    await dl.saveAs(saved);
    run.note('keepsake', `${basename(saved)} ${statSync(saved).size} bytes`);
    const now = new Date();
    if (new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1) - now > 30_000) {
      await host.getByLabel(/end at midnight/).check();
      await host.getByRole('button', { name: 'New Year countdown' }).click();
      const s = host.getByRole('status').filter({ hasText: /^Midnight in \d/ });
      await expect(s).toBeVisible();
      run.note('timed to midnight', await s.textContent());
      await host.getByRole('button', { name: 'Stop', exact: true }).click();
    }
    await run.shot(host, 'host-countdown');
  },

  async 'first-dance'(run) {
    const room = await openRoom(run, { sims: [[0.2, 0.4], [0.5, 0.6], [0.8, 0.4]] });
    await scan(room);
    await tab(room, 'Show');
    await room.host.getByRole('button', { name: 'First dance' }).click();
    await expect(room.host.locator('.score')).toContainText('Now: First dance');
    await sleep(1500);
    const seen = await colours(room.phones[1], 3000, 200);
    const rgb = [...seen].map((s) => s.split(',').map(Number));
    run.note('distinct colours in 3 s', seen.size);
    run.note('warm (r > b) share', rgb.filter(([r, , b]) => r > b).length / rgb.length);
    expect(rgb.every(([r, , b]) => r >= b)).toBe(true);
    await run.shot(room.phones[1], 'phone-first-dance');
    await run.shot(room.host, 'host-first-dance');
    await room.host.getByRole('button', { name: 'Stop', exact: true }).click();
  },

  async stunt(run) {
    const room = await openRoom(run);
    await scan(room);
    const { host, phones } = room;
    await tab(room, 'Card stunt');
    await host.locator('#stunt-file').setInputFiles({
      name: 'quadrants.png',
      mimeType: 'image/png',
      buffer: QUADRANTS_PNG,
    });
    await watchScreens(phones);
    await host.getByRole('button', { name: 'Flip the cards' }).click();
    await sleep(4500);
    const flips = await flipMoments(phones);
    run.note('flip moment per phone, ms after the first', flips);
    if (flips.includes(null) || Math.max(...flips) > 150) run.issue(`phones did not flip together: ${flips.join(', ')}`);
    const got = await Promise.all(phones.map((p) => bg(p)));
    run.note('phone colours', got.map((c) => c.join(',')));
    expect(got).toEqual(QUADRANT_COLOURS_BY_SIM);
    await run.shot(host, 'host-picture');
    await host.locator('#stunt-words').fill('GO');
    await host.getByRole('button', { name: 'Use words' }).click();
    await host.getByRole('button', { name: 'Flip the cards' }).click();
    await sleep(3800);
    const words = new Set((await Promise.all(phones.map((p) => bg(p)))).map((c) => c.join()));
    run.note('distinct colours for "GO"', words.size);
    expect(words.size).toBeGreaterThan(1);
    await run.shot(host, 'host-words');
  },

  async templates(run) {
    // A 4 x 3 block of seats: words need a crowd dense enough to draw letters.
    const GRID = Array.from({ length: 12 }, (_, i) => [0.1 + (i % 4) * 0.27, 0.2 + Math.floor(i / 4) * 0.3]);
    const room = await openRoom(run, { sims: GRID, phone: { width: 160, height: 280 } });
    await scan(room);
    const { host, phones } = room;
    await tab(room, 'Card stunt');
    await host.getByRole('button', { name: 'Names with a heart' }).click();
    await host.getByRole('button', { name: 'Flip the cards' }).click();
    await expect(host.getByText('Type both names for “Names with a heart”.')).toBeVisible();
    await expect(host.getByLabel('Name (birthday, couple)')).toBeFocused();
    await host.getByLabel('Name (birthday, couple)').fill('Ana');
    await host.getByLabel('Second name (couple)').fill('Ben');
    await host.getByRole('button', { name: 'Names with a heart' }).click();
    await watchScreens(phones);
    await host.getByRole('button', { name: 'Flip the cards' }).click();
    await sleep(6000);
    const flips = await flipMoments(phones);
    run.note('flip moment per phone, ms after the first', flips);
    if (flips.includes(null)) run.issue(`phone(s) ${flips.flatMap((f, i) => (f === null ? [i + 1] : [])).join(', ')} never counted down to the flip`);
    else if (Math.max(...flips) > 150) run.issue(`phones flipped up to ${Math.max(...flips)} ms apart`);
    const nameColours = (await Promise.all(phones.map((p) => bg(p)))).map((c) => c.join());
    const names = new Set(nameColours);
    run.note('Names with a heart: distinct colours', names.size);
    run.note('Names with a heart: colours by phone', nameColours);
    run.note('map x,y by phone', await Promise.all(room.seats.map(async (seat) => { const r = host.locator(`tr[data-seat="${seat}"]`); return [+(+(await r.getAttribute('data-x'))).toFixed(2), +(+(await r.getAttribute('data-y'))).toFixed(2)]; })));
    // What the host is flipping, next to what the middle row shows.
    writeFileSync(resolve(run.dir, 'names-picture.png'), Buffer.from((await host.locator('.stunt-preview canvas').evaluate((c) => c.toDataURL())).split(',')[1], 'base64'));
    await run.shot(phones[5], 'phone-6-names');
    if (names.size < 2) run.issue('Names with a heart flipped to one flat colour on every phone');
    await run.shot(host, 'host-names');
    await host.getByLabel('Name (birthday, couple)').fill('');
    await host.getByRole('button', { name: 'Happy birthday' }).click();
    await host.getByRole('button', { name: 'Flip the cards' }).click();
    await expect(host.getByText('Type a name for “Happy birthday”.')).toBeVisible();
    await host.getByRole('button', { name: 'Just married' }).click();
    await host.getByRole('button', { name: 'Flip the cards' }).click();
    await expect(host.getByText(/3, 2, 1… 12 phones flip together/)).toBeVisible();
    await sleep(1000);
    for (const p of phones) await expect(p.locator('.label')).toHaveText('', { timeout: 8000 });
    const married = new Set((await Promise.all(phones.map((p) => bg(p)))).map((c) => c.join()));
    run.note('Just married: distinct colours', married.size);
    if (married.size < 2) run.issue('Just married flipped to one flat colour on every phone');
    await run.shot(host, 'host-just-married');
  },

  async record(run) {
    const room = await openRoom(run, { sims: [[0.2, 0.4], [0.8, 0.4]] });
    await scan(room);
    const { host } = room;
    await tab(room, 'Card stunt');
    await host.getByLabel('Record the moment with this computer’s camera').check();
    await host.getByRole('button', { name: 'Flip the cards' }).click();
    await expect(host.getByText('● Recording the moment…')).toBeVisible({ timeout: 5000 });
    const link = host.getByRole('link', { name: /Download the keepsake/ });
    await expect(link).toBeVisible({ timeout: 20_000 });
    run.note('link', await link.textContent());
    const [dl] = await Promise.all([host.waitForEvent('download'), link.click()]);
    const saved = resolve(run.dir, dl.suggestedFilename());
    await dl.saveAs(saved);
    run.note('keepsake', `${basename(saved)} ${statSync(saved).size} bytes`);
    expect(basename(saved)).toMatch(/^swarm-moment-\d{4}-\d\d-\d\d-\d{4}\.webm$/);
    expect(statSync(saved).size).toBeGreaterThan(10_000);
    await run.shot(host, 'host-recorded');
  },

  async live(run) {
    // Top, middle and bottom of the room, so a source that only lights part of the picture shows up.
    const room = await openRoom(run, { sims: [[0.15, 0.2], [0.5, 0.5], [0.85, 0.85]] });
    await scan(room);
    const { host, phones } = room;
    await tab(room, 'Live screen');
    const counts = {};
    const perPhone = async () => Promise.all(phones.map(async (p) => (await colours(p, 1200)).size));
    for (const src of ['Aurora', 'Fire', 'Camera']) {
      await host.getByRole('radio', { name: src }).check();
      if (src === 'Aurora') await host.getByRole('button', { name: 'Go live' }).click();
      await expect(host.getByText(/Broadcasting to 3 phones/)).toBeVisible({ timeout: 15_000 });
      await sleep(800);
      counts[src] = await perPhone();
      await run.shot(host, `host-live-${src.toLowerCase()}`);
    }
    // Video: a short clip the browser records itself, then uploaded like a host's file.
    const clip = await host.evaluate(async () => {
      const c = Object.assign(document.createElement('canvas'), { width: 160, height: 90 });
      const g = c.getContext('2d');
      const rec = new MediaRecorder(c.captureStream(15), { mimeType: 'video/webm' });
      const parts = [];
      rec.ondataavailable = (e) => parts.push(e.data);
      rec.start(200);
      for (let i = 0; i < 45; i++) {
        g.fillStyle = `hsl(${i * 8},90%,50%)`;
        g.fillRect(0, 0, 160, 90);
        await new Promise((r) => setTimeout(r, 66));
      }
      rec.stop();
      await new Promise((r) => (rec.onstop = r));
      const b = new Uint8Array(await new Blob(parts).arrayBuffer());
      let s = '';
      for (const x of b) s += String.fromCharCode(x);
      return btoa(s);
    });
    // Switching to Video while live, before any file is chosen, keeps the crowd showing the camera;
    // picking the file then switches over by itself, with no second Go live.
    await host.getByRole('radio', { name: 'Video' }).check();
    let waits = false;
    try {
      await expect(host.getByText(/Choose a video file to switch to it/)).toBeVisible({ timeout: 5000 });
      waits = true;
    } catch {}
    run.note('host status after picking Video with no file', await host.locator('.panel-body > .note[role=status]').last().textContent().catch(() => null));
    await run.shot(host, 'host-live-video-no-file');
    if (!waits) run.issue('switching to Video while live, before a file is chosen, does not keep the broadcast going');
    counts['Video, no file yet'] = await perPhone();
    await host.locator('#live-file').setInputFiles({ name: 'clip.webm', mimeType: 'video/webm', buffer: Buffer.from(clip, 'base64') });
    let resumed = false;
    try {
      await expect(host.getByText(/Broadcasting to 3 phones/)).toBeVisible({ timeout: 15_000 });
      resumed = true;
    } catch {}
    run.note('picking the file goes live by itself', resumed);
    if (!resumed) run.issue('picking a video file while live does not resume the broadcast without pressing Go live');
    await sleep(800);
    counts.Video = await perPhone();
    // The clip is one flat colour per frame, so phones showing it agree on their colour.
    let same = false;
    for (let i = 0; i < 10 && !same; i++) {
      const c = await Promise.all(phones.map((p) => bg(p)));
      same = c.every((x) => x.every((v, k) => Math.abs(v - c[0][k]) < 12)) && c[0].some((v) => v > 60);
      if (!same) await sleep(150);
    }
    run.note('phones show the video (same colour everywhere)', same);
    if (!same) run.issue('after picking the file the phones are not showing the video');
    run.note('distinct colours per phone (top, middle, bottom) in 1.2 s', counts);
    for (const [k, n] of Object.entries(counts)) {
      if (n.every((c) => c < 3)) run.issue(`${k}: no phone's colour moved`);
      else if (n.some((c) => c < 2)) run.issue(`${k}: phone(s) ${n.flatMap((c, i) => (c < 2 ? [['top', 'middle', 'bottom'][i]] : [])).join(', ')} stayed one flat colour`);
    }
    await run.shot(host, 'host-live-video');
  },

  async wave(run) {
    const room = await openRoom(run, { sims: [[0.15, 0.5], [0.5, 0.5], [0.85, 0.5]] });
    await scan(room);
    await tab(room, 'Wave');
    await room.host.getByRole('button', { name: 'Start the wave' }).click();
    const peaks = [0, 0, 0].map(() => ({ t: 0, v: -1 }));
    const t0 = Date.now();
    while (Date.now() - t0 < 2600)
      for (let i = 0; i < 3; i++) {
        const [r, g] = await bg(room.phones[i]);
        if (r + g > peaks[i].v) peaks[i] = { t: Date.now() - t0, v: r + g };
      }
    run.note('peak ms (left, centre, right)', peaks.map((p) => p.t));
    expect(peaks.every((p) => p.v > 300)).toBe(true);
    expect(peaks[0].t).toBeLessThan(peaks[1].t);
    expect(peaks[1].t).toBeLessThan(peaks[2].t);
    await run.shot(room.host, 'host-wave');
  },

  async territory(run) {
    const room = await openRoom(run, { sims: [[0.2, 0.3], [0.2, 0.7], [0.5, 0.5], [0.8, 0.3], [0.8, 0.7]] });
    await scan(room);
    await tab(room, 'Territory');
    await room.host.getByRole('button', { name: 'Start Territory' }).click();
    const left = room.phones[0];
    await expect(left.locator('.label')).toHaveText('TAP');
    await left.bringToFront();
    let taps = 0;
    for (; taps < 200; taps++) {
      await left.locator('.screen').click({ position: { x: 100, y: 400 } });
      if (taps % 10 === 9 && (await room.host.locator('.score').textContent())?.includes('wins')) break;
    }
    run.note('taps to win', taps + 1);
    await expect(room.host.locator('.score')).toContainText('Amber wins');
    await expect.poll(async () => (await bg(room.phones[4]))[0]).toBeGreaterThan(150);
    run.note('overrun right phone colour', (await bg(room.phones[4])).join());
    await run.shot(room.host, 'host-territory');
  },

  async potato(run) {
    const room = await openRoom(run, { sims: [[0.2, 0.3], [0.2, 0.7], [0.5, 0.5], [0.8, 0.3], [0.8, 0.7]] });
    await scan(room);
    await tab(room, 'Hot Potato');
    await room.host.getByRole('button', { name: 'Start Hot Potato' }).click();
    const holder = async () => {
      for (const p of room.phones) if ((await p.locator('.label').textContent()) === 'TAP!') return p;
      return null;
    };
    let h = null;
    await expect.poll(async () => (h = await holder()) !== null, { timeout: 5000 }).toBe(true);
    await h.bringToFront();
    await h.locator('.screen').click({ position: { x: 100, y: 400 } });
    await expect(room.host.locator('.score')).toContainText(/· 1 throw$/);
    run.note('score after one throw', await room.host.locator('.score').textContent());
    await run.shot(h, 'phone-potato');
    // Let the fuse burn on the next holder: someone goes out.
    await expect(room.host.locator('.score')).toContainText(/[0-4] still in|last one standing/, { timeout: 30_000 });
    run.note('score after a burn', await room.host.locator('.score').textContent());
    await run.shot(room.host, 'host-potato');
  },

  async reconnect(run) {
    run.allowErrors = /WebSocket|relay|ERR_|Failed to load/;
    const sockets = [];
    const room = await openRoom(run, { sims: [[0.2, 0.5], [0.5, 0.5]] });
    const { host, phones } = room;
    // Phone reload: same seat.
    const before = await seatOf(phones[0]);
    await phones[0].reload();
    await phones[0].getByRole('button', { name: 'Join the swarm' }).click();
    await expect(phones[0].locator('.status')).toContainText(`Seat ${before + 1} ·`);
    await expect(host.locator('.count')).toHaveText(/^2 phones /);
    run.note('phone reload keeps seat', before + 1);
    // Wi-Fi blip on a phone: its socket drops; it must come back by itself in the same seat.
    const p3 = await room.context.newPage();
    run.watch(p3);
    await p3.routeWebSocket(/\/relay/, (ws) => {
      const srv = ws.connectToServer();
      sockets.push({ ws, srv });
    });
    await p3.setViewportSize({ width: 390, height: 844 });
    await p3.goto(`./?${q({ room: room.code, transport: room.transport, sim: '0.8,0.5' })}`);
    await p3.getByRole('button', { name: 'Join the swarm' }).click();
    await expect(p3.locator('.status')).toContainText('Seat');
    const seat3 = await seatOf(p3);
    if (!sockets.length) run.inconclusive(`transport ${room.transport} has no WebSocket to drop`);
    else {
      const t = Date.now();
      sockets.at(-1).ws.close();
      sockets.at(-1).srv.close();
      await expect(p3.locator('.status')).toContainText(/reconnecting/, { timeout: 5000 });
      await run.shot(p3, 'phone-reconnecting');
      await expect(p3.locator('.status')).toContainText(`Seat ${seat3 + 1} · not placed yet`, { timeout: 15_000 });
      run.note('socket drop -> back live ms', Date.now() - t);
    }
    // Host reload: same room code, phones return.
    await host.reload();
    await expect(host.locator('[data-room]')).toHaveAttribute('data-room', room.code);
    await expect(host.locator('.count')).toHaveText(/^3 phones /, { timeout: 20_000 });
    for (const p of [...phones, p3]) await expect(p.locator('.status')).not.toContainText('reconnecting', { timeout: 20_000 });
    run.note('host reload keeps room', room.code);
    await run.shot(host, 'host-after-reload');
    // Relay restart (only when this run owns the server): the room must come back without anyone touching it.
    if (server && room.transport === 'lan') {
      const seatsBefore = await Promise.all([...phones, p3].map(seatOf));
      const port = server.port;
      stopServer();
      let warned = false;
      try {
        await expect(host.locator('.count')).toHaveText('Reconnecting to the room server…', { timeout: 10_000 });
        warned = true;
      } catch {}
      run.note('host warns while the relay is down', warned);
      await run.shot(host, 'host-relay-down');
      if (!warned) run.issue('while the relay is down the host shows no warning');
      await sleep(1500);
      await launch(port);
      const t = Date.now();
      let back = false;
      try {
        await expect(host.locator('.count')).toHaveText(/^3 phones /, { timeout: 30_000 });
        for (const [i, p] of [...phones, p3].entries())
          await expect(p.locator('.status')).toContainText(new RegExp(`Seat ${seatsBefore[i] + 1} · (placed|not placed yet)$`), { timeout: 30_000 });
        back = true;
      } catch {}
      run.note('room recovers after relay restart, same seats (30 s)', back);
      run.note('relay back -> room whole ms', Date.now() - t);
      run.note('phone status after relay restart', await phones[0].locator('.status').textContent());
      run.note('host count after relay restart', await host.locator('.count').textContent());
      await run.shot(host, 'host-after-relay-restart');
      await run.shot(phones[0], 'phone-after-relay-restart');
      if (!back) run.issue('after the relay restarts, the room does not come back with every phone in its old seat');
    }
  },
};

async function followPicture(run, source, ok, minSpread) {
  const room = await openRoom(run, { sims: [[0.1, 0.5], [0.2, 0.5]] });
  const { host, phones } = room;
  await tab(room, 'Big screen');
  await host.getByRole('radio', { name: source }).check();
  await host.getByRole('button', { name: 'Show on phones' }).click();
  try {
    await expect(host.getByText(ok)).toBeVisible({ timeout: 15_000 });
  } catch {
    const said = await host.locator('.panel-body > .note[role=status]').last().textContent();
    run.note('host status', said);
    return run.inconclusive(`no frames in this browser: ${said}`);
  }
  for (const p of phones) {
    const img = p.locator('.follow-picture');
    await expect.poll(() => img.evaluate((i) => i.naturalWidth)).toBeGreaterThan(100);
    const src = await img.getAttribute('src');
    const spread = await pictureSpread(img);
    run.note(`phone ${phones.indexOf(p)} frame`, { type: src.slice(5, 15), kb: Math.round(src.length / 1024), spread });
    expect(src.startsWith('data:image/jpeg;base64,')).toBe(true);
    expect(src.length).toBeLessThan(60 * 1024);
    expect(spread).toBeGreaterThan(minSpread);
  }
  run.note('host status', await host.getByText(ok).textContent());
  await run.shot(phones[0], 'phone-picture');
  await run.shot(host, 'host-picture');
  await host.getByRole('button', { name: 'Stop' }).last().click();
  await expect(phones[0].locator('.follow')).toBeHidden();
}

// ---------- doctor / serve / main ----------
async function doctor() {
  const url = base();
  const out = { url, commit: execSync('git rev-parse --short HEAD', { cwd: REPO }).toString().trim() };
  const pidFile = resolve(opt.out, 'server.pid');
  if (!opt.url && existsSync(pidFile)) {
    const [pid] = readFileSync(pidFile, 'utf8').split(' ').map(Number);
    try {
      process.kill(pid, 0);
      out.serverPid = `${pid} alive`;
    } catch {
      out.serverPid = `${pid} dead`;
    }
  }
  const page = await fetch(url).catch((e) => ({ ok: false, status: e.message }));
  out.page = page.ok ? `${page.status} ${(await page.text()).match(/<title>(.*?)<\/title>/)?.[1]}` : `DOWN ${page.status}`;
  const relay = await fetch(`${url}relay.json`).then((r) => r.json()).catch(() => null);
  out.relayJson = relay?.lanUrl ?? 'missing (not npm start?)';
  const socket = await wsStatus(`${url.replace('http', 'ws')}relay?room=ZZZZ9&role=phone`);
  out.relaySocket = socket === 404 ? '404 for an unhosted room (relay answering)' : typeof socket === 'number' ? `unexpected ${socket}` : socket === 'open' ? 'opened?!' : socket;
  const dist = resolve(REPO, 'dist/index.html');
  out.build = existsSync(dist) ? `dist built ${statSync(dist).mtime.toISOString()}` : 'dist missing';
  out.healthy = page.ok && !!relay && out.relaySocket.startsWith('404');
  console.log(JSON.stringify(out, null, 2));
  return out.healthy;
}

const ALL = Object.keys(CHECKS);

async function main() {
  if (!queue.length || queue[0] === 'help') {
    console.log(`checks: ${ALL.join(' ')}\nalso: all, doctor, serve\noptions: --transport lan|local  --port N  --url URL  --out DIR  --headed`);
    return;
  }
  if (queue[0] === 'doctor' && opt.url) return void (process.exitCode = (await doctor()) ? 0 : 1);
  if (!opt.url) await launch();
  if (queue[0] === 'serve') {
    log(`serving ${server.url}; Ctrl-C stops it (or: kill -- -${server.pid})`);
    process.on('SIGINT', () => (stopServer(), process.exit(0)));
    return new Promise(() => {});
  }
  const results = [];
  try {
    if (queue[0] === 'doctor') return void (process.exitCode = (await doctor()) ? 0 : 1);
    if (!(await doctor())) throw new Error('doctor: instance not healthy');
    const todo = [];
    for (let i = 0; i < queue.length; i++) {
      const name = queue[i];
      if (name === 'all') todo.push(...ALL.map((n) => [n]));
      else if (!CHECKS[name]) throw new Error(`unknown check ${name}; try: ${ALL.join(' ')}`);
      else if (name === 'play-song' && queue[i + 1] && !CHECKS[queue[i + 1]] && queue[i + 1] !== 'all') todo.push([name, queue[++i]]);
      else todo.push([name]);
    }
    for (const [name, arg] of todo) {
      const run = new Run(arg ? `${name}-${basename(arg).replace(/\W+/g, '_')}` : name);
      const t0 = Date.now();
      log(`--- ${name}${arg ? ` ${arg}` : ''} (${opt.transport})`);
      try {
        await CHECKS[name](run, arg);
      } catch (e) {
        run.issue(e.message.split('\n').slice(0, 6).join(' | '));
        for (const b of run.browsers) for (const c of b.contexts()) for (const [i, p] of c.pages().entries()) await run.shot(p, `failure-tab${i}`);
      }
      if (run.errors.length) run.issue(`page errors: ${[...new Set(run.errors)].slice(0, 5).join(' | ')}`);
      await run.close();
      const r = { check: name, transport: opt.transport, status: run.status, secs: Math.round((Date.now() - t0) / 1000), notes: run.notes, readings: run.readings, evidence: run.dir };
      writeFileSync(resolve(run.dir, 'result.json'), JSON.stringify(r, null, 2));
      results.push(r);
      log(`=== ${name}: ${run.status}`);
    }
  } finally {
    stopServer();
  }
  const table = ['| check | result | notes |', '| --- | --- | --- |', ...results.map((r) => `| ${r.check} | ${r.status} | ${r.notes.join('; ').replace(/\|/g, '/')} |`)].join('\n');
  appendFileSync(resolve(opt.out, 'results.md'), `\n## ${new Date().toISOString()} transport=${opt.transport}\n\n${table}\n`);
  console.log(`\n${table}\n\nevidence: ${opt.out}`);
  process.exitCode = results.every((r) => r.status === 'PASS') ? 0 : 1;
}

process.on('SIGTERM', () => (stopServer(), process.exit(143)));
main().catch((e) => {
  stopServer();
  console.error(e);
  process.exitCode = 2;
});
