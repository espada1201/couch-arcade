// Step one: work out where every phone is. The camera route makes all phones flash
// their codes at once and decodes the burst; the fallbacks are typed seat numbers or
// dragging phones around the map by hand.
import { DEFAULT_HALF_MS, DEFAULT_REPEATS, scheduleDuration, type BlinkSchedule } from '../core/blinkcode';
import { seatGridPoint, type Point } from '../core/layout';
import { localize, type GrayFrame, type LocalizeResult } from '../core/localize';
import { h } from '../ui/dom';
import { CameraSource, SyntheticSource, type FrameSource } from './camera';
import type { HostSession } from './session';

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export function locatePanel(session: HostSession, params: URLSearchParams, takeOver: () => void): HTMLElement {
  const synthetic = params.get('camera') === 'synthetic';
  let source: FrameSource | null = null;
  let lastScan: LocalizeResult | null = null;
  let scanning = false;

  const view = h('div.cam-view', { hidden: true });
  const overlay = h('canvas.cam-overlay', { 'aria-hidden': 'true' });
  const camMsg = h('p.note', { role: 'status' });
  const devices = h('select', { id: 'cam-device', 'aria-label': 'Camera' });
  const startBtn = h('button.btn', { type: 'button' }, synthetic ? 'Start simulated camera' : 'Start camera');
  const scanBtn = h('button.btn.primary', { type: 'button', disabled: true }, 'Scan the room');
  const progress = h('progress', { max: 1, value: 0, hidden: true, 'aria-label': 'Scan progress' });
  const result = h('p.result', { role: 'status', 'aria-live': 'polite' });
  const mirror = h('input', { type: 'checkbox', id: 'mirror', checked: session.mirror });
  const identify = h('button.btn.ghost', { type: 'button', 'aria-pressed': 'false' }, 'Show numbers on phones');

  if (!synthetic)
    void CameraSource.list().then((list) => {
      devices.replaceChildren(...list.map((d, i) => h('option', { value: d.deviceId }, d.label || `Camera ${i + 1}`)));
      devices.hidden = list.length < 2;
    });
  devices.hidden = true;

  const drawOverlay = () => {
    if (!source || !lastScan) return;
    const w = (overlay.width = view.clientWidth);
    const hh = (overlay.height = view.clientHeight);
    const ctx = overlay.getContext('2d')!;
    ctx.clearRect(0, 0, w, hh);
    ctx.font = '600 12px "Archivo Variable", sans-serif';
    for (const d of lastScan.detections) {
      const x = d.x * w;
      const y = d.y * hh;
      ctx.strokeStyle = '#ffb000';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(x, y, 9, 0, Math.PI * 2);
      ctx.stroke();
      ctx.fillStyle = '#ffb000';
      ctx.fillText(String(d.id + 1), x + 12, y + 4);
    }
  };

  startBtn.addEventListener('click', async () => {
    source?.stop();
    camMsg.textContent = 'Starting camera…';
    try {
      source = synthetic ? new SyntheticSource() : new CameraSource(devices.value || undefined);
      await source.start();
      view.replaceChildren(source.preview, overlay);
      view.hidden = false;
      camMsg.textContent = synthetic
        ? 'Simulated camera: it films phone tabs open on this computer.'
        : 'Point the camera so every phone screen is in view. Dim the room lights if you can.';
      scanBtn.disabled = false;
      startBtn.textContent = 'Restart camera';
    } catch (e) {
      source = null;
      const name = e instanceof Error ? e.name : '';
      camMsg.textContent =
        name === 'NotAllowedError'
          ? 'Camera permission was refused. Allow it in the browser’s address bar, or use typed seat numbers below.'
          : name === 'NotFoundError'
            ? 'No camera found. Use typed seat numbers below, or place phones by hand on the map.'
            : `Could not start the camera: ${e instanceof Error ? e.message : String(e)}`;
    }
  });

  scanBtn.addEventListener('click', async () => {
    if (!source || scanning) return;
    const online = session.online;
    if (online.length === 0) {
      result.textContent = 'No phones are connected yet.';
      return;
    }
    scanning = true;
    scanBtn.disabled = true;
    takeOver();
    const schedule: BlinkSchedule = { t0: session.now() + 1200, halfMs: DEFAULT_HALF_MS, repeats: DEFAULT_REPEATS };
    const frames: GrayFrame[] = [];
    source.onFrame = (f) => {
      if (f.t >= schedule.t0 - 100) frames.push(f);
    };
    session.setProgram({ kind: 'blink', schedule });
    const total = schedule.t0 - session.now() + scheduleDuration(schedule) + 600;
    progress.hidden = false;
    const started = session.now();
    const tick = setInterval(() => (progress.value = Math.min(1, (session.now() - started) / total)), 100);
    result.textContent = `${online.length} phone${online.length === 1 ? ' is' : 's are'} flashing their codes. Keep the camera still…`;
    await sleep(total);
    clearInterval(tick);
    source.onFrame = null;
    result.textContent = 'Decoding…';
    await sleep(30);
    lastScan = localize(frames, schedule);
    session.sourceAspect = source.aspect;
    const updates = new Map<number, Point | null>();
    const found = new Set<number>();
    for (const d of lastScan.detections)
      if (session.seats.has(d.id)) {
        updates.set(d.id, { x: d.x, y: d.y });
        found.add(d.id);
      }
    // Positions from another method live in a different space; drop them rather than mix.
    for (const s of session.seats.values()) if (!found.has(s.seat) && s.source !== 'camera') updates.set(s.seat, null);
    session.mirror = mirror.checked;
    session.setRaw(updates, 'camera');
    session.setProgram({ kind: 'lobby' });
    const missing = online.filter((s) => !found.has(s.seat)).map((s) => s.seat + 1);
    result.textContent =
      found.size === 0
        ? `Couldn’t see any codes (${frames.length} frames). Check every screen faces the camera at full brightness, then scan again.`
        : `Placed ${found.size} of ${online.length} phones.` + (missing.length ? ` Not seen: ${missing.join(', ')}. Scan again, or drag them onto the map.` : '');
    progress.hidden = true;
    scanBtn.disabled = false;
    scanning = false;
    drawOverlay();
  });

  mirror.addEventListener('change', () => session.setMirror(mirror.checked));

  identify.addEventListener('click', () => {
    const on = identify.getAttribute('aria-pressed') !== 'true';
    identify.setAttribute('aria-pressed', String(on));
    takeOver();
    session.setProgram({ kind: on ? 'identify' : 'lobby' });
  });

  // No-camera fallback: everyone types their row and seat.
  const rows = h('input', { type: 'number', min: 1, max: 60, value: 3, id: 'grid-rows' });
  const seats = h('input', { type: 'number', min: 1, max: 60, value: 6, id: 'grid-seats' });
  const answered = h('p.note', { role: 'status' });
  const useBtn = h('button.btn.primary', { type: 'button', disabled: true }, 'Use typed seats');
  let asking = false;
  const askBtn = h(
    'button.btn',
    {
      type: 'button',
      onclick: () => {
        takeOver();
        session.gridEntries.clear();
        asking = true;
        session.setProgram({ kind: 'grid', rows: Number(rows.value) || 1, seats: Number(seats.value) || 1 });
        useBtn.disabled = false;
      },
    },
    'Ask phones for their seat',
  );
  useBtn.addEventListener('click', () => {
    const r = Number(rows.value) || 1;
    const s = Number(seats.value) || 1;
    const updates = new Map<number, Point | null>();
    for (const [seat, e] of session.gridEntries) updates.set(seat, seatGridPoint(e.row, e.seat, r, s));
    session.sourceAspect = r > 1 && s > 1 ? (s - 1) / (r - 1) : 1;
    session.mirror = false;
    session.setRaw(updates, 'grid');
    session.setProgram({ kind: 'lobby' });
    asking = false;
    useBtn.disabled = true;
  });
  session.subscribe(() => {
    if (asking) answered.textContent = `${session.gridEntries.size} of ${session.online.length} phones have answered.`;
  });

  return h(
    'div.panel-body',
    {},
    h('p.panel-intro', {}, 'Every phone flashes a unique code for about ten seconds. The camera watches, decodes each flash and pins every phone to the map.'),
    h('div.row', {}, startBtn, devices),
    camMsg,
    view,
    h('label.check', { for: 'mirror' }, mirror, h('span', {}, 'Camera faces the crowd (flip left and right)')),
    h('div.row', {}, scanBtn, identify),
    progress,
    result,
    h(
      'details.fallback',
      {},
      h('summary', {}, 'No camera? Use seat numbers'),
      h('p.note', {}, 'Each phone asks its owner for their row and seat. Good for theatres and classrooms.'),
      h('div.row', {}, h('label.num', { for: 'grid-rows' }, 'Rows', rows), h('label.num', { for: 'grid-seats' }, 'Seats per row', seats)),
      h('div.row', {}, askBtn, useBtn),
      answered,
    ),
  );
}
