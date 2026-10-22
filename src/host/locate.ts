// Step one: work out where every phone is. The camera route makes all phones flash
// their codes at once and decodes the burst; the fallbacks are typed seat numbers or
// dragging phones around the map by hand.
import { DEFAULT_HALF_MS, DEFAULT_REPEATS, scheduleDuration, type BlinkSchedule } from '../core/blinkcode';
import { seatGridPoint, type Point } from '../core/layout';
import { validCorners } from '../core/homography';
import { localize, type GrayFrame, type LocalizeResult } from '../core/localize';
import { h, plural } from '../ui/dom';
import { CameraSource, SyntheticSource, type FrameSource } from './camera';
import type { Director, Hold } from './director';
import type { HostSession } from './session';

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export function locatePanel(session: HostSession, params: URLSearchParams, director: Director): HTMLElement {
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

  // Labels (and often the full list) only appear once camera permission is granted, so refresh after starting.
  const listCameras = async () => {
    if (synthetic) return;
    const list = await CameraSource.list();
    const keep = devices.value;
    devices.replaceChildren(...list.map((d, i) => h('option', { value: d.deviceId, selected: d.deviceId === keep }, d.label || `Camera ${i + 1}`)));
    devices.hidden = list.length < 2;
  };
  devices.hidden = true;
  void listCameras();

  // The preview is letterboxed (object-fit: contain); work out where the picture actually is.
  const picture = () => {
    const w = view.clientWidth;
    const hh = view.clientHeight;
    const a = source?.aspect ?? 4 / 3;
    const pw = Math.min(w, hh * a);
    const ph = pw / a;
    return { x: (w - pw) / 2, y: (hh - ph) / 2, w: pw, h: ph };
  };
  let corners: Point[] = [];
  let marking = false;
  // Named as they appear in the picture, which stays unambiguous whichever way the camera faces.
  const CORNER_NAMES = ['top-left', 'top-right', 'bottom-right', 'bottom-left'];
  const drawOverlay = () => {
    if (!source) return;
    overlay.width = view.clientWidth;
    overlay.height = view.clientHeight;
    const r = picture();
    const ctx = overlay.getContext('2d')!;
    ctx.clearRect(0, 0, overlay.width, overlay.height);
    const pts = marking ? corners : (session.perspective?.corners ?? []);
    if (pts.length) {
      ctx.strokeStyle = '#00c4b4';
      ctx.fillStyle = 'rgba(0, 196, 180, 0.12)';
      ctx.lineWidth = 2;
      ctx.beginPath();
      pts.forEach((p, i) => (i ? ctx.lineTo : ctx.moveTo).call(ctx, r.x + p.x * r.w, r.y + p.y * r.h));
      if (pts.length === 4) ctx.closePath();
      ctx.stroke();
      if (pts.length === 4) ctx.fill();
    }
    ctx.font = '600 12px "Archivo Variable", sans-serif';
    for (const d of lastScan?.detections ?? []) {
      const x = r.x + d.x * r.w;
      const y = r.y + d.y * r.h;
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
      perspectiveBtn.disabled = false;
      requestAnimationFrame(drawOverlay);
      camMsg.textContent = synthetic
        ? 'Simulated camera: it films phone tabs open on this computer.'
        : 'Point the camera so every phone screen is in view. Dim the room lights if you can.';
      scanBtn.disabled = false;
      startBtn.textContent = 'Restart camera';
      void listCameras();
    } catch (e) {
      source?.stop();
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
    const src = source;
    if (!src || scanning) return;
    const online = session.online;
    if (online.length === 0) {
      result.textContent = 'No phones are connected yet.';
      return;
    }
    scanning = true;
    scanBtn.disabled = true;
    let cancelled = false;
    let tick = 0;
    const finish = () => {
      src.onFrame = null;
      clearInterval(tick);
      progress.hidden = true;
      scanBtn.disabled = false;
      scanning = false;
    };
    // Something else took the crowd mid-scan: drop the burst rather than decode it and blank the screens.
    const hold = director.run({
      stop: () => {
        if (!scanning || cancelled) return;
        cancelled = true;
        finish();
        result.textContent = 'Scan stopped.';
      },
    });
    // Phones flash on the shared clock, so give late joiners a moment to lock on first.
    for (let i = 0; i < 30 && session.worstSync > 40; i++) {
      result.textContent = 'Waiting for every phone’s clock to lock on…';
      await sleep(100);
      if (cancelled) return;
    }
    const shaky = session.online.filter((s) => s.sync > 40).map((s) => s.seat + 1);
    const schedule: BlinkSchedule = { t0: session.now() + 1200, halfMs: DEFAULT_HALF_MS, repeats: DEFAULT_REPEATS };
    const frames: GrayFrame[] = [];
    src.onFrame = (f) => {
      if (f.t >= schedule.t0 - 100) frames.push(f);
    };
    session.setProgram({ kind: 'blink', schedule });
    const total = schedule.t0 - session.now() + scheduleDuration(schedule) + 600;
    progress.hidden = false;
    const started = session.now();
    tick = window.setInterval(() => (progress.value = Math.min(1, (session.now() - started) / total)), 100);
    result.textContent = `${plural(online.length, 'phone')} ${online.length === 1 ? 'is' : 'are'} flashing their codes. Keep the camera still…`;
    await sleep(total);
    if (cancelled) return;
    clearInterval(tick);
    src.onFrame = null;
    result.textContent = 'Decoding…';
    await sleep(30);
    if (cancelled) return;
    lastScan = localize(frames, schedule);
    session.sourceAspect = src.aspect;
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
    const missing = online.filter((s) => !found.has(s.seat)).map((s) => s.seat + 1);
    result.textContent =
      found.size === 0
        ? `Couldn’t see any codes (${frames.length} frames). Check every screen faces the camera at full brightness, then scan again.`
        : `Placed ${found.size} of ${plural(online.length, 'phone')}.` + (missing.length ? ` Not seen: ${missing.join(', ')}. Scan again, or drag them onto the map.` : '');
    if (shaky.length && missing.length) result.textContent += ` Phones ${shaky.join(', ')} had a weak connection during the scan.`;
    finish();
    hold.end();
    drawOverlay();
  });

  mirror.addEventListener('change', () => session.setMirror(mirror.checked));

  // Perspective: click the seating area's corners on the camera picture.
  const perspectiveMsg = h('p.note', { role: 'status' });
  const areaW = h('input', { type: 'number', min: 1, max: 200, step: 0.5, value: session.perspective?.width ?? 6, id: 'area-w' });
  const areaD = h('input', { type: 'number', min: 1, max: 200, step: 0.5, value: session.perspective?.depth ?? 6, id: 'area-d' });
  const perspectiveBtn = h('button.btn', { type: 'button', disabled: true }, 'Correct perspective');
  const clearBtn = h('button.btn.ghost', { type: 'button', hidden: !session.perspective }, 'Remove correction');
  const commit = () => {
    if (corners.length !== 4) return;
    session.setPerspective({ corners, width: Number(areaW.value) || 6, depth: Number(areaD.value) || 6 });
    clearBtn.hidden = false;
  };
  perspectiveBtn.addEventListener('click', () => {
    marking = true;
    corners = [];
    view.classList.add('marking');
    perspectiveMsg.textContent = `Click the ${CORNER_NAMES[0]} corner of the area, as it appears in the camera picture.`;
    drawOverlay();
  });
  overlay.addEventListener('click', (e) => {
    if (!marking) return;
    const r = picture();
    const b = overlay.getBoundingClientRect();
    corners.push({ x: (e.clientX - b.left - r.x) / r.w, y: (e.clientY - b.top - r.y) / r.h });
    if (corners.length < 4) perspectiveMsg.textContent = `Now the ${CORNER_NAMES[corners.length]} corner.`;
    else {
      marking = false;
      view.classList.remove('marking');
      if (!validCorners(corners)) {
        perspectiveMsg.textContent = 'Those corners cross over. Click “Correct perspective” and go round in order: top-left, top-right, bottom-right, bottom-left.';
        corners = [];
      } else {
        commit();
        perspectiveMsg.textContent = session.perspectiveActive
          ? 'Perspective corrected: the map is now a true floor plan.'
          : 'Saved. It applies to phones placed by the camera, so scan the room to use it.';
      }
    }
    drawOverlay();
  });
  for (const input of [areaW, areaD]) input.addEventListener('change', () => session.perspective && ((corners = session.perspective.corners), commit()));
  clearBtn.addEventListener('click', () => {
    session.setPerspective(null);
    clearBtn.hidden = true;
    perspectiveMsg.textContent = '';
    drawOverlay();
  });

  identify.addEventListener('click', () => {
    const on = identify.getAttribute('aria-pressed') !== 'true';
    if (on) director.run({ stop: () => identify.setAttribute('aria-pressed', 'false'), program: { kind: 'identify' } });
    else director.idle();
    identify.setAttribute('aria-pressed', String(on));
  });

  // No-camera fallback: everyone types their row and seat.
  const rows = h('input', { type: 'number', min: 1, max: 60, value: 3, id: 'grid-rows' });
  const seats = h('input', { type: 'number', min: 1, max: 60, value: 6, id: 'grid-seats' });
  const answered = h('p.note', { role: 'status' });
  const useBtn = h('button.btn.primary', { type: 'button', disabled: true }, 'Use typed seats');
  let asking: Hold | null = null;
  const askBtn = h(
    'button.btn',
    {
      type: 'button',
      onclick: () => {
        session.gridEntries.clear();
        asking = director.run({
          stop: () => {
            asking = null;
            useBtn.disabled = true;
          },
          program: { kind: 'grid', rows: Number(rows.value) || 1, seats: Number(seats.value) || 1 },
        });
        useBtn.disabled = false;
      },
    },
    'Ask phones for their seat',
  );
  useBtn.addEventListener('click', () => {
    const r = Number(rows.value) || 1;
    const s = Number(seats.value) || 1;
    const updates = new Map<number, Point | null>();
    // Only typed-in seats share this coordinate space; everyone else becomes unplaced.
    for (const seat of session.seats.keys()) updates.set(seat, null);
    for (const [seat, e] of session.gridEntries) updates.set(seat, seatGridPoint(e.row, e.seat, r, s));
    session.sourceAspect = r > 1 && s > 1 ? (s - 1) / (r - 1) : 1;
    session.mirror = false;
    session.setRaw(updates, 'grid');
    asking?.end();
  });
  session.subscribe(() => {
    if (asking) answered.textContent = `${session.gridEntries.size} of ${plural(session.online.length, 'phone')} ${session.gridEntries.size === 1 ? 'has' : 'have'} answered.`;
  });

  return h(
    'div.panel-body',
    {},
    h('p.panel-intro', {}, 'Every phone flashes a unique code for about ten seconds. The camera watches, decodes each flash and pins every phone to the map.'),
    h('div.row', {}, startBtn, devices),
    camMsg,
    view,
    h('label.check', { for: 'mirror' }, mirror, h('span', {}, 'Camera faces the crowd (flip left and right)')),
    h(
      'details.fallback',
      { open: !!session.perspective },
      h('summary', {}, 'Camera at an angle? Correct perspective'),
      h('p.note', {}, 'Far rows look squashed together from a low camera. Click the four corners of any rectangle on the floor (the seating area, or four phones at its corners) and the map becomes a true floor plan.'),
      h('div.row', {}, h('label.num', { for: 'area-w' }, 'Area width (m)', areaW), h('label.num', { for: 'area-d' }, 'Area depth (m)', areaD)),
      h('div.row', {}, perspectiveBtn, clearBtn),
      perspectiveMsg,
    ),
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
